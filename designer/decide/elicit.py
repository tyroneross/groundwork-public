#!/usr/bin/env python3
# ───────────────────────────────────────────────────────────────────────
# Groundwork — decision-elicitation engine (the "how to decide" layer)
#
# WHAT: turns a vague design/product query into a confident direction in the
#       FEWEST interactions, by running the information-gain pipeline from
#       decision science rather than a fixed question template. This is the
#       formal engine behind Groundwork's iterate/canvas loop.
#
# WHY:  large decision spaces are k-sparse — only 3-5 dimensions actually
#       drive any one person's choice. Find + prune the space BEFORE asking
#       preference questions and you go from 1000+ options to a confident
#       shortlist in ~7-12 interactions. A zero-shot LLM alone follows stated
#       preferences at <10% accuracy by turn 10 (PrefEval, ICLR 2025) — you
#       need explicit structure UNDER the LLM. The math decides WHICH question;
#       the LLM (the host agent) only phrases it and extracts features from the
#       freeform answer. (decision-doctor cross-disciplinary framework, 2026;
#       build-loop-memory/references/decision-elicitation-minimal-questions.md)
#
# THE PIPELINE (each layer cuts the space before the next):
#   1. VALUES  — what outcome matters (not which option). Prunes whole domains.
#   2. VETO    — hardest dealbreaker first. One veto removes 80-95%, no compare.
#   3. WEIGHTS — on the SURVIVING set, ask the highest expected-info-gain
#                question:  IG(dim) = uncertainty(dim) * importance(dim).
#   4. DOMINANCE / 5. RANK — computational, 0 questions.
#   6. PROFILE — remembered across sessions (see profile.py); compounds.
#
# HOW IT REUSES THE EXISTING GATE:
#   designer/gate/convergence.py already ports the style-calibrator stop-gate
#   (overall_confidence / info_gain_remaining / convergence_status) over
#   DimState = {uncertainty, importance, excluded}. This module is a thin layer
#   on that STABLE CONTRACT:
#     * VETO / VALUES-prune / a DECIDED dimension  -> excluded = True
#       (pinned to a value; the gate already drops excluded dims from info-gain)
#     * next_question()  -> argmax of uncertainty*importance over eligible dims
#       (convergence.info_gain_remaining returns the max VALUE; we need the
#        arg — the dimension to actually ask about next)
#     * stop  -> convergence.convergence_status(...)["ready"]
#
# Pure stdlib. No third-party imports. No network. No API calls.
# Self-test:  python3 -m designer.decide.elicit --selftest
# ───────────────────────────────────────────────────────────────────────

from __future__ import annotations

import argparse
import json
import math
import sys
from typing import Any, Optional

# Reuse the ported gate math — the stable contract. Fall back to a vendored copy
# of the three functions if run outside the package (keeps the module portable).
try:
    from designer.gate.convergence import (
        convergence_status,
        info_gain_remaining,
        overall_confidence,
    )
except Exception:  # pragma: no cover - portability fallback
    _CONF_T, _GAIN_T = 0.80, 0.25

    def overall_confidence(ds):  # type: ignore
        num = sum(float(d["uncertainty"]) * float(d["importance"]) for d in ds.values())
        den = sum(float(d["importance"]) for d in ds.values())
        return 1.0 - num / den if den else 0.0

    def info_gain_remaining(ds):  # type: ignore
        return max(
            (float(d["uncertainty"]) * float(d["importance"])
             for d in ds.values() if not d.get("excluded")),
            default=0.0,
        )

    def convergence_status(ds, round_count, next_dim, last_rating=None, max_rounds=30):  # type: ignore
        conf, gain = overall_confidence(ds), info_gain_remaining(ds)
        ready = (conf >= _CONF_T and gain < _GAIN_T) or round_count >= max_rounds or next_dim is None
        converged = ready and last_rating is not None and float(last_rating) >= 4
        return {"confidence": conf, "info_gain": gain, "ready": ready, "converged": converged}


SCHEMA = "groundwork.decide.session/v1"

# Decision TYPES (the taxonomy's primary axis — the epistemic goal). The POSTURE
# a Groundwork run takes is chosen from the type, not hardcoded. See
# references/iterate.md for how the router tags these.
#   descriptive  — "what is true / understand this app"   (Type 1)
#   diagnostic   — "why does this feel off"                (Type 2)
#   choice       — "which direction should I pick"         (Type 4)  <- default UI
#   policy       — "what should I refine next as we go"    (Type 6)  <- iterate loop
DECISION_TYPES = ("descriptive", "diagnostic", "choice", "policy")

# Default starting uncertainty for a dimension nobody has touched (matches the
# gate's _U_UNSEEN so seeded and unseen dims are comparable).
U_UNSEEN = 0.9
U_FLOOR = 0.05
# Multiplicative shrink applied to a dimension's uncertainty each time an answer
# CONFIRMS its current leaning (repeat -> more certain).
U_CONFIRM_SHRINK = 0.5
# A veto / values-prune / explicit decision pins a dimension: near-zero
# uncertainty + excluded, so the gate never spends a question on it again.
U_DECIDED = U_FLOOR

# ── Bayesian belief model (the upgrade) ─────────────────────────────────────
# Each OPEN dimension's belief is a categorical distribution over its candidate
# values. A dimension nobody has touched is near-uniform (max entropy); a lean /
# confirm concentrates mass on the leaned value; a decided/vetoed dim is a point
# mass and is excluded from question selection entirely.
#
# We do NOT store a probability vector for every dim (that would break the
# {uncertainty} contract profile.py writes to). Instead the belief is DERIVED
# on demand from the existing (uncertainty, value) fields, so profile-seeding —
# which only ever lowers `uncertainty` and pre-fills `value` — automatically
# sharpens the belief. A caller/test that needs an exact distribution can pin an
# explicit "belief" vector via set_candidates(); when present it wins.
#
# Default candidate cardinality for a dim whose values weren't specified. Real
# Groundwork dims are token choices; the host LLM maps concrete options, but the
# NUMBER of live alternatives is what drives entropy, so a sane default matters.
DEFAULT_VALUES = ["a", "b", "c"]
# Answer-reliability of the symmetric observation channel used for EIG. α<1 makes
# EIG a genuine expected-posterior-entropy reduction (mutual information), not a
# trivial "entropy fully collapses" identity. Documented approximation, tunable.
ANSWER_RELIABILITY = 0.85


# ---------------------------------------------------------------------------
# Session shape
# ---------------------------------------------------------------------------
# {
#   "schema": SCHEMA,
#   "goal": "<the VALUES answer: what outcome matters, in the user's words>",
#   "decision_type": "choice",
#   "dimensions": {
#       "<dim>": {"importance": float, "uncertainty": float,
#                  "value": <decided value|null>, "excluded": bool,
#                  "reason": "<why decided/vetoed|null>"}
#   },
#   "round": int,                      # questions asked so far
#   "last_rating": float|null,         # most recent canvas reaction (1-5), for `converged`
#   "history": [ {"dim","value","kind","note"} ],   # kind: veto|value-prune|answer|confirm
#   "profile_seeded": [ "<dim>", ... ] # dims pre-answered from cross-session profile
# }


def _dim_spec(spec: Any) -> tuple[float, list[Any], Optional[list[float]]]:
    """Normalize a `dimensions` entry into (importance, values, belief|None).

    Backward-compatible: a bare float/int is the importance with DEFAULT_VALUES
    candidates. A richer dict form {"importance": float, "values": [...],
    "belief": [...]} lets a caller declare the actual candidate set (and an
    optional prior) WITHOUT breaking the old {dim: importance} contract.
    """
    if isinstance(spec, dict):
        imp = float(spec.get("importance", 0.6))
        values = list(spec.get("values") or DEFAULT_VALUES)
        belief = spec.get("belief")
        belief = [float(x) for x in belief] if belief else None
        return imp, values, belief
    return float(spec), list(DEFAULT_VALUES), None


def new_session(
    goal: str,
    dimensions: dict[str, Any],
    decision_type: str = "choice",
) -> dict[str, Any]:
    """Create a session. `dimensions` maps dim -> importance (leverage weight).

    Importance is how much of the design surface the dimension governs; the flow
    seeds it from catalog leverage (how many categories map to the dim) or 0.6.

    `dimensions` values are usually a bare importance float ({dim: importance} —
    the frozen contract). Optionally an entry may be a richer dict
    {"importance": float, "values": [...], "belief": [...]} to declare the
    dimension's candidate values (used by the Bayesian entropy/EIG model); the
    old bare-float form keeps working and defaults to DEFAULT_VALUES candidates.
    """
    if decision_type not in DECISION_TYPES:
        raise ValueError(f"decision_type must be one of {DECISION_TYPES}")
    dims: dict[str, Any] = {}
    for d, spec in dimensions.items():
        imp, values, belief = _dim_spec(spec)
        state = {
            "importance": max(0.0, min(1.0, imp)),
            "uncertainty": U_UNSEEN,
            "value": None,
            "excluded": False,
            "reason": None,
            "values": values,
        }
        if belief is not None:
            _apply_belief(state, belief)
        dims[d] = state
    return {
        "schema": SCHEMA,
        "goal": goal,
        "decision_type": decision_type,
        "dimensions": dims,
        "round": 0,
        "last_rating": None,
        "history": [],
        "profile_seeded": [],
    }


def _dim_states(session: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Project the session into the gate's DimState contract."""
    return {
        d: {
            "uncertainty": float(v["uncertainty"]),
            "importance": float(v["importance"]),
            "excluded": bool(v["excluded"]),
        }
        for d, v in session["dimensions"].items()
    }


# ---------------------------------------------------------------------------
# Bayesian belief model:  categorical prior per dim  ->  entropy, EIG, PAPRIKA
# ---------------------------------------------------------------------------

def _values(state: dict[str, Any]) -> list[Any]:
    return list(state.get("values") or DEFAULT_VALUES)


def _entropy(p: list[float]) -> float:
    """Shannon entropy in BITS of a categorical distribution."""
    h = 0.0
    for x in p:
        if x > 0.0:
            h -= x * math.log2(x)
    return h


def _binary_entropy(r: float) -> float:
    r = min(1.0, max(0.0, r))
    if r <= 0.0 or r >= 1.0:
        return 0.0
    return -(r * math.log2(r) + (1.0 - r) * math.log2(1.0 - r))


def belief(state: dict[str, Any]) -> list[float]:
    """The dimension's categorical belief over its candidate values.

    An explicit "belief" vector (pinned via set_candidates) wins. Otherwise the
    belief is DERIVED from (uncertainty, value):
      * value is None (untouched)      -> uniform  (max entropy)
      * value set, uncertainty high    -> still near-uniform (a weak lean)
      * value set, uncertainty -> floor-> point mass on the leaned value
    The concentration on the leaned value scales linearly from 1/K (uniform, at
    U_UNSEEN) to 1.0 (point mass, at U_FLOOR), so profile-seeding a dim (which
    lowers uncertainty + sets value) sharpens the belief with no extra state.
    """
    values = _values(state)
    K = len(values)
    if K == 0:
        return []
    b = state.get("belief")
    if isinstance(b, list) and len(b) == K and sum(b) > 0:
        s = float(sum(b))
        return [float(x) / s for x in b]
    if state.get("value") is None:
        return [1.0 / K] * K
    u = float(state.get("uncertainty", U_UNSEEN))
    t = (u - U_FLOOR) / (U_UNSEEN - U_FLOOR)  # 1 at unseen, 0 at floor
    t = min(1.0, max(0.0, t))
    if K == 1:
        return [1.0]
    p_lead = 1.0 - (K - 1) / K * t          # 1/K at t=1, 1.0 at t=0
    p_lead = min(1.0, max(1.0 / K, p_lead))
    rest = (1.0 - p_lead) / (K - 1)
    val = state.get("value")
    try:
        idx = values.index(val)
    except ValueError:
        idx = 0
    return [p_lead if i == idx else rest for i in range(K)]


def _expected_information_gain(state: dict[str, Any]) -> float:
    """EIG(d) = H(prior_d) - E_answer[H(posterior_d | answer)], in bits.

    Bayesian Optimal Experimental Design: model asking the dimension as one draw
    through a symmetric observation channel with accuracy α = ANSWER_RELIABILITY
    (right answer w.p. α, each of the other K-1 values w.p. (1-α)/(K-1)). The
    result is the mutual information I(value ; answer) — always >= 0, and equal
    to H(prior) when α = 1. A near-certain dim (low prior entropy) yields low EIG
    no matter how important, which is the whole point of the upgrade.
    """
    p = belief(state)
    K = len(p)
    if K <= 1:
        return 0.0
    alpha = ANSWER_RELIABILITY
    off = (1.0 - alpha) / (K - 1)
    h_prior = _entropy(p)
    exp_post = 0.0
    for a in range(K):                      # marginalize over the observed answer
        pa = 0.0
        for th in range(K):
            pa += p[th] * (alpha if a == th else off)
        if pa <= 0.0:
            continue
        post = [p[th] * (alpha if a == th else off) / pa for th in range(K)]
        exp_post += pa * _entropy(post)
    return max(0.0, h_prior - exp_post)


def _eig_score(state: dict[str, Any]) -> float:
    """Importance-weighted EIG — the decision-leverage-adjusted question value."""
    return float(state["importance"]) * _expected_information_gain(state)


def _apply_belief(state: dict[str, Any], belief_vec: list[float]) -> None:
    """Pin an explicit categorical prior on a dim and re-sync `uncertainty`.

    Keeps the scalar `uncertainty` (which the ported gate + profile.py read)
    consistent with the belief's entropy: uniform -> U_UNSEEN, point-mass ->
    U_FLOOR. This is how a crafted Bayesian belief still drives the convergence
    gate correctly.
    """
    s = float(sum(belief_vec))
    if s <= 0:
        return
    p = [float(x) / s for x in belief_vec]
    state["belief"] = p
    K = len(p)
    h_max = math.log2(K) if K > 1 else 1.0
    frac = (_entropy(p) / h_max) if h_max > 0 else 0.0
    state["uncertainty"] = U_FLOOR + (U_UNSEEN - U_FLOOR) * min(1.0, max(0.0, frac))
    # A confidently-known value is the leaned value; record it (not decided).
    if state.get("value") is None:
        state["value"] = _values(state)[max(range(K), key=lambda i: p[i])]


def set_candidates(
    session: dict[str, Any],
    dim: str,
    values: list[Any],
    belief_vec: Optional[list[float]] = None,
    importance: Optional[float] = None,
) -> dict[str, Any]:
    """Declare a dim's candidate values (and optionally an exact prior belief).

    Additive helper: lets a caller/test craft the Bayesian belief precisely.
    Creates the dim if absent. When `belief_vec` is given, `uncertainty` is
    re-synced from its entropy so the convergence gate stays consistent.
    """
    st = session["dimensions"].get(dim)
    if st is None:
        st = {"importance": 0.6, "uncertainty": U_UNSEEN, "value": None,
              "excluded": False, "reason": None, "values": list(values)}
        session["dimensions"][dim] = st
    st["values"] = list(values)
    if importance is not None:
        st["importance"] = max(0.0, min(1.0, float(importance)))
    if belief_vec is not None:
        _apply_belief(st, belief_vec)
    return session


def paprika_pair(session: dict[str, Any], dim: str) -> Optional[tuple[Any, Any]]:
    """PAPRIKA-style pairwise choice for a >2-value dim: the pair of candidate
    values whose comparison maximally reduces entropy.

    Resolving a comparison between values i,j is most informative when the two
    carry the most probability mass AND are the hardest to separate (balanced).
    We score each pair by (p_i + p_j) * H2(p_i / (p_i + p_j)) — mass in play times
    the binary entropy of the split — and return the argmax. Ties break
    deterministically by (value_i, value_j). This is the A/B fork the rail
    consumes. Returns None for a dim with <2 candidates.
    """
    st = session["dimensions"].get(dim)
    if st is None:
        return None
    values = _values(st)
    if len(values) < 2:
        return None
    if len(values) == 2:
        return (values[0], values[1])
    p = belief(st)
    best: Optional[tuple[Any, Any]] = None
    best_score = -1.0
    for i in range(len(values)):
        for j in range(i + 1, len(values)):
            mass = p[i] + p[j]
            score = mass * _binary_entropy(p[i] / mass) if mass > 0 else 0.0
            key = (values[i], values[j])
            if score > best_score + 1e-12 or (
                abs(score - best_score) <= 1e-12 and (best is None or key < best)
            ):
                best_score = score
                best = key
    return best


# ---------------------------------------------------------------------------
# Layer 1/2:  VALUES prune  +  VETO   ->   excluded = True (reuses the gate flag)
# ---------------------------------------------------------------------------

def prune_values(session: dict[str, Any], dims: list[str], goal: str = "") -> dict[str, Any]:
    """VALUES layer: mark dimensions the stated goal makes IRRELEVANT.

    Eliminates whole domains before any preference question — the cheapest cut.
    e.g. an internal data tool goal prunes brand-expression dimensions.
    """
    if goal:
        session["goal"] = goal
    for d in dims:
        if d in session["dimensions"]:
            v = session["dimensions"][d]
            v["excluded"] = True
            v["uncertainty"] = U_DECIDED
            v["reason"] = "values-prune: not relevant to the stated goal"
            session["history"].append({"dim": d, "value": None, "kind": "value-prune", "note": v["reason"]})
    return session


def veto(session: dict[str, Any], dim: str, value: Any, reason: str = "") -> dict[str, Any]:
    """VETO layer: a hard constraint pins a dimension and removes it from probing.

    This is the 80-95% cut — asked FIRST because it's the highest-leverage
    single answer. Pinning to `value` + excluding means every downstream
    question is chosen over the SURVIVING set only.
    """
    if dim not in session["dimensions"]:
        session["dimensions"][dim] = {"importance": 0.6, "uncertainty": U_UNSEEN,
                                      "value": None, "excluded": False, "reason": None,
                                      "values": list(DEFAULT_VALUES)}
    v = session["dimensions"][dim]
    v["value"] = value
    v["excluded"] = True
    v["uncertainty"] = U_DECIDED
    v["reason"] = reason or "veto: hard constraint"
    session["history"].append({"dim": dim, "value": value, "kind": "veto", "note": v["reason"]})
    return session


# ---------------------------------------------------------------------------
# Layer 3:  WEIGHTS  ->  next-question by MAX expected information gain
# ---------------------------------------------------------------------------

def rank_by_info_gain(session: dict[str, Any]) -> list[tuple[str, float]]:
    """Eligible dimensions ranked by EXPECTED INFORMATION GAIN, high first.

    Score = importance * EIG(dim), where EIG is the Bayesian expected reduction
    in the dimension's belief entropy from asking it (see
    _expected_information_gain). This is real Bayesian Optimal Experimental
    Design, not the old uncertainty*importance proxy: a near-certain dim scores
    low no matter its importance, and a dim with more live alternatives (higher
    entropy) outranks one with the same scalar uncertainty but fewer. Excluded
    (vetoed / decided / pruned) dims are omitted. Ties break by dim name
    (deterministic, for testability).
    """
    scored = [
        (d, _eig_score(v))
        for d, v in session["dimensions"].items()
        if not v["excluded"]
    ]
    scored.sort(key=lambda t: (-t[1], t[0]))
    return scored


def next_question(session: dict[str, Any]) -> Optional[str]:
    """The single dimension to ask about next, or None if nothing eligible.

    Feeds convergence_status(next_dim=...): None => the loop is exhausted.
    """
    ranked = rank_by_info_gain(session)
    return ranked[0][0] if ranked else None


# ---------------------------------------------------------------------------
# Record an answer  ->  shrink uncertainty (confirm) or pin (decide)
# ---------------------------------------------------------------------------

def answer(
    session: dict[str, Any],
    dim: str,
    value: Any,
    decided: bool = False,
    rating: Optional[float] = None,
    note: str = "",
) -> dict[str, Any]:
    """Record a preference answer for `dim`.

    decided=True  -> pin + exclude (the user committed this dimension).
    decided=False -> shrink uncertainty toward certainty (a confirming signal);
                     a repeat of the same value shrinks it further.
    rating (1-5)  -> the user's reaction to the concrete canvas this answer
                     produced; drives the gate's `converged` (needs >= 4).
    """
    if dim not in session["dimensions"]:
        session["dimensions"][dim] = {"importance": 0.6, "uncertainty": U_UNSEEN,
                                      "value": None, "excluded": False, "reason": None,
                                      "values": list(DEFAULT_VALUES)}
    v = session["dimensions"][dim]
    prev = v["value"]
    v["value"] = value
    if decided:
        v["excluded"] = True
        v["uncertainty"] = U_DECIDED
        v["reason"] = note or "decided"
        v.pop("belief", None)  # point mass -> no explicit vector to carry
        kind = "answer"
    elif isinstance(v.get("belief"), list):
        # Bayesian posterior update on the pinned belief: observe `value` through
        # the same symmetric channel, multiply by the likelihood, renormalize.
        # Concentrates mass on `value` -> lowers this dim's entropy monotonically.
        values = _values(v)
        K = len(values)
        alpha = ANSWER_RELIABILITY
        off = (1.0 - alpha) / (K - 1) if K > 1 else 0.0
        try:
            obs = values.index(value)
        except ValueError:
            obs = max(range(K), key=lambda i: belief(v)[i])
        prior = belief(v)
        post = [prior[i] * (alpha if i == obs else off) for i in range(K)]
        _apply_belief(v, post)
        v["value"] = value
        kind = "confirm" if prev == value else "answer"
    else:
        shrink = U_CONFIRM_SHRINK if (prev is None or prev == value) else 0.8
        v["uncertainty"] = max(U_FLOOR, float(v["uncertainty"]) * shrink)
        kind = "confirm" if prev == value else "answer"
    session["round"] += 1
    if rating is not None:
        session["last_rating"] = float(rating)
    session["history"].append({"dim": dim, "value": value, "kind": kind, "note": note})
    return session


# ---------------------------------------------------------------------------
# STOP:  the gate decides when to quit asking
# ---------------------------------------------------------------------------

def status(session: dict[str, Any]) -> dict[str, Any]:
    """Full elicitation status: convergence gate + the next question + why.

    `ready` True => stop asking (uncertainty over the ranking is low enough, or
    exhausted, or capped). This is what keeps the loop FAST — it converges
    instead of interrogating.
    """
    ds = _dim_states(session)
    nq = next_question(session)
    gate = convergence_status(
        ds, round_count=session.get("round", 0), next_dim=nq,
        last_rating=session.get("last_rating"),
    )
    ranked = rank_by_info_gain(session)
    decided = {d: v["value"] for d, v in session["dimensions"].items()
               if v["excluded"] and v["value"] is not None}
    # Additive Bayesian keys (consumers ignore unknowns): per-dim belief entropy
    # over eligible dims, and the PAPRIKA A/B pair for the next question when it
    # has >2 live candidate values (this is what the rail's fork consumes).
    entropy = {
        d: _entropy(belief(v))
        for d, v in session["dimensions"].items()
        if not v["excluded"]
    }
    pair = None
    if nq is not None:
        pv = paprika_pair(session, nq)
        if pv is not None and len(_values(session["dimensions"][nq])) > 2:
            pair = {"dim": nq, "a": pv[0], "b": pv[1]}
    return {
        "confidence": gate["confidence"],
        "info_gain": gate["info_gain"],
        "ready": gate["ready"],
        "converged": gate["converged"],
        "round": session.get("round", 0),
        "next_question": nq,
        "ranked": ranked[:5],
        "decided": decided,
        "goal": session.get("goal", ""),
        "decision_type": session.get("decision_type", "choice"),
        "entropy": entropy,
        "pair": pair,
    }


# ---------------------------------------------------------------------------
# CLI  (mirrors designer/engine/cli.py's present/pick JSON-relay style)
# ---------------------------------------------------------------------------

def _load(path: str) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _save(path: str, session: dict[str, Any]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(session, f, indent=2, sort_keys=False)
        f.write("\n")


def _parse_value(raw: str) -> Any:
    """Accept a JSON scalar or a bare string."""
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return raw


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="designer.decide.elicit", description=__doc__)
    ap.add_argument("--selftest", action="store_true", help="run the self-test and exit")
    sub = ap.add_subparsers(dest="cmd")

    p_init = sub.add_parser("init", help="create a session")
    p_init.add_argument("--goal", required=True)
    p_init.add_argument("--type", default="choice", choices=DECISION_TYPES)
    p_init.add_argument("--dimensions", required=True,
                        help='JSON object {dim: importance} or path to such a file')
    p_init.add_argument("--out", required=True)

    p_veto = sub.add_parser("veto", help="pin a hard-constraint dimension")
    p_veto.add_argument("--state", required=True)
    p_veto.add_argument("--dim", required=True)
    p_veto.add_argument("--value", required=True)
    p_veto.add_argument("--reason", default="")

    p_prune = sub.add_parser("prune", help="mark dims irrelevant to the goal")
    p_prune.add_argument("--state", required=True)
    p_prune.add_argument("--dims", required=True, help="comma-separated dims")

    p_present = sub.add_parser("present", help="emit the next question + status")
    p_present.add_argument("--state", required=True)

    p_answer = sub.add_parser("answer", help="record an answer")
    p_answer.add_argument("--state", required=True)
    p_answer.add_argument("--dim", required=True)
    p_answer.add_argument("--value", required=True)
    p_answer.add_argument("--decided", action="store_true")
    p_answer.add_argument("--rating", type=float, default=None)
    p_answer.add_argument("--note", default="")

    p_status = sub.add_parser("status", help="emit status only")
    p_status.add_argument("--state", required=True)

    args = ap.parse_args(argv)

    if args.selftest or args.cmd is None and not argv:
        if args.selftest:
            _selftest()
            return 0

    if args.cmd == "init":
        dims_raw = args.dimensions
        try:
            dims = json.loads(dims_raw)
        except (ValueError, TypeError):
            dims = _load(dims_raw)
        session = new_session(args.goal, dims, decision_type=args.type)
        _save(args.out, session)
        print(json.dumps(status(session), indent=2))
        return 0

    if args.cmd == "veto":
        session = _load(args.state)
        veto(session, args.dim, _parse_value(args.value), reason=args.reason)
        _save(args.state, session)
        print(json.dumps(status(session), indent=2))
        return 0

    if args.cmd == "prune":
        session = _load(args.state)
        prune_values(session, [d.strip() for d in args.dims.split(",") if d.strip()])
        _save(args.state, session)
        print(json.dumps(status(session), indent=2))
        return 0

    if args.cmd == "present" or args.cmd == "status":
        session = _load(args.state)
        print(json.dumps(status(session), indent=2))
        return 0

    if args.cmd == "answer":
        session = _load(args.state)
        answer(session, args.dim, _parse_value(args.value),
               decided=args.decided, rating=args.rating, note=args.note)
        _save(args.state, session)
        print(json.dumps(status(session), indent=2))
        return 0

    ap.print_help()
    return 1


# ---------------------------------------------------------------------------
# Self-test:  python3 -m designer.decide.elicit --selftest
# ---------------------------------------------------------------------------

def _selftest() -> None:
    fails = 0

    def check(name: str, cond: bool) -> None:
        nonlocal fails
        if not cond:
            fails += 1
            print(f"  FAIL: {name}")
        else:
            print(f"  ok:   {name}")

    dims = {
        "platform.target": 0.9,
        "color.accent": 0.7,
        "spacing.density": 0.7,
        "motion.intensity": 0.6,
        "components.separator": 0.5,
    }
    s = new_session("a fast internal data tool for ops analysts", dims, decision_type="choice")
    check("new: schema set", s["schema"] == SCHEMA)
    check("new: all dims unseen", all(v["uncertainty"] == U_UNSEEN for v in s["dimensions"].values()))
    check("new: round 0", s["round"] == 0)

    # next question is the highest importance*uncertainty = platform.target (0.9)
    check("IG-order: highest-leverage dim asked first", next_question(s) == "platform.target")

    # VETO the highest-leverage dim -> it drops out, next question shifts
    veto(s, "platform.target", "web", reason="ships as a web SPA, non-negotiable")
    check("veto: dim excluded", s["dimensions"]["platform.target"]["excluded"] is True)
    check("veto: dim pinned to value", s["dimensions"]["platform.target"]["value"] == "web")
    check("veto: next question moves off vetoed dim", next_question(s) != "platform.target")
    check("veto: next is now next-highest leverage (0.7 tie -> color.accent)",
          next_question(s) == "color.accent")

    # VALUES prune brand-ish motion out — an internal tool doesn't need it
    prune_values(s, ["motion.intensity"])
    check("prune: motion excluded", s["dimensions"]["motion.intensity"]["excluded"] is True)
    check("prune: pruned dim never surfaces as a question",
          "motion.intensity" not in [d for d, _ in rank_by_info_gain(s)])

    # Not ready yet — lots of uncertainty remains on surviving dims
    st = status(s)
    check("status: not ready with open dims", st["ready"] is False)
    check("status: next_question present", st["next_question"] is not None)

    # Answer the surviving dims decisively -> should converge
    for d in ["color.accent", "spacing.density", "components.separator"]:
        answer(s, d, "chosen", decided=True, rating=5)
    st = status(s)
    check("converge: no eligible dims left -> next_question None", st["next_question"] is None)
    check("converge: ready True (exhausted)", st["ready"] is True)
    check("converge: converged True (rating >= 4)", st["converged"] is True)
    check("converge: reached in <= 12 interactions",
          st["round"] + len([h for h in s["history"] if h["kind"] in ("veto", "value-prune")]) <= 12)

    # decided map surfaces the pins
    check("decided: includes veto pin", st["decided"].get("platform.target") == "web")

    # confirm-shrink: repeating a non-decided answer lowers uncertainty further
    s2 = new_session("g", {"color.accent": 0.7}, decision_type="choice")
    answer(s2, "color.accent", "teal", decided=False)
    u1 = s2["dimensions"]["color.accent"]["uncertainty"]
    answer(s2, "color.accent", "teal", decided=False)
    u2 = s2["dimensions"]["color.accent"]["uncertainty"]
    check("confirm: repeat answer shrinks uncertainty further", u2 < u1)

    # decision-type guard
    try:
        new_session("g", {}, decision_type="nope")
        check("type-guard: rejects bad decision_type", False)
    except ValueError:
        check("type-guard: rejects bad decision_type", True)

    print()
    if fails:
        print(f"SELFTEST: {fails} FAILED")
        raise SystemExit(1)
    print("SELFTEST: all cases pass (IG-order, veto-prune, values-prune, "
          "converge-in-few, confirm-shrink, type-guard)")


if __name__ == "__main__":
    if "--selftest" in (sys.argv[1:] or []):
        _selftest()
    else:
        raise SystemExit(main(sys.argv[1:]))
