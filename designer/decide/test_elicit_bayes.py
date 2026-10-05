#!/usr/bin/env python3
# ───────────────────────────────────────────────────────────────────────
# Groundwork — Bayesian upgrade tests for the decision-elicitation engine.
#
# Proves the engine now selects questions by real EXPECTED INFORMATION GAIN
# (Bayesian Optimal Experimental Design over a categorical belief per dimension)
# rather than the old max(uncertainty*importance) proxy — WITHOUT breaking the
# public interface that profile.py, the CLI, and references/iterate.md depend on.
#
# Run:  python3 -m designer.decide.test_elicit_bayes
#       (or)  PYTHONPATH=<repo> python3 -m designer.decide.test_elicit_bayes
#
# Pure stdlib. No third-party imports. No network.
# ───────────────────────────────────────────────────────────────────────

from __future__ import annotations

import sys

from designer.decide import elicit as E
from designer.decide.elicit import (
    DEFAULT_VALUES,
    belief,
    new_session,
    next_question,
    paprika_pair,
    prune_values,
    rank_by_info_gain,
    set_candidates,
    status,
    veto,
)


def _entropy(state) -> float:
    return E._entropy(belief(state))


def _naive_proxy_argmax(session) -> str:
    """The OLD engine's pick: argmax(uncertainty*importance), tie broken by name.

    Reconstructed here so the divergence test can prove EIG != the old proxy.
    """
    scored = [
        (d, float(v["uncertainty"]) * float(v["importance"]))
        for d, v in session["dimensions"].items()
        if not v["excluded"]
    ]
    scored.sort(key=lambda t: (-t[1], t[0]))
    return scored[0][0]


def run() -> int:
    fails = 0

    def check(name: str, cond: bool) -> None:
        nonlocal fails
        if not cond:
            fails += 1
            print(f"  FAIL: {name}")
        else:
            print(f"  ok:   {name}")

    # ── 1. EIG ordering picks the true max-EIG dim, and it DIFFERS from the old
    #       max(uncertainty*importance) proxy in at least one constructed case. ──
    #
    # Two dims: SAME importance (0.7) and SAME scalar uncertainty (both uniform ->
    # synced to U_UNSEEN=0.9), but different candidate cardinality (K=2 vs K=8).
    # The scalar proxy is BLIND to K: it ties at 0.63 and, tie-broken by name,
    # picks A_smallK. Bayesian EIG sees that an 8-way choice carries far more
    # resolvable uncertainty (3 bits vs 1 bit) and picks B_bigK. That gap is the
    # whole point of the upgrade.
    s = new_session("divergence", {"A_smallK": 0.7, "B_bigK": 0.7})
    set_candidates(s, "A_smallK", ["x", "y"], belief_vec=[0.5, 0.5])
    set_candidates(s, "B_bigK", [f"v{i}" for i in range(8)], belief_vec=[1 / 8] * 8)

    check("EIG: proxy ties -> proxy picks the small-K dim (name tiebreak)",
          _naive_proxy_argmax(s) == "A_smallK")
    ranked = rank_by_info_gain(s)
    check("EIG: engine picks the true max-EIG dim (bigger candidate set)",
          next_question(s) == "B_bigK")
    check("EIG: EIG(bigK) strictly beats EIG(smallK)",
          ranked[0][0] == "B_bigK" and ranked[0][1] > ranked[1][1])
    check("EIG: selection DIFFERS from the naive uncertainty*importance proxy",
          next_question(s) != _naive_proxy_argmax(s))

    # ── 2. A near-certain (low-entropy) dim is NOT asked even at high importance;
    #       a high-entropy high-importance dim is asked first. ──────────────────
    s2 = new_session("entropy-vs-importance", {"almost_sure": 0.98, "wide_open": 0.6})
    # almost_sure: 94% mass on one value -> tiny entropy -> tiny EIG despite imp.
    set_candidates(s2, "almost_sure", ["a", "b", "c"], belief_vec=[0.94, 0.03, 0.03])
    # wide_open: near-uniform -> max entropy -> high EIG.
    set_candidates(s2, "wide_open", ["a", "b", "c"], belief_vec=[0.34, 0.33, 0.33])
    check("near-certain: low-entropy high-importance dim is NOT asked first",
          next_question(s2) == "wide_open")
    check("near-certain: high-entropy dim outranks the near-certain one",
          _eig(s2, "wide_open") > _eig(s2, "almost_sure"))
    # sanity: it is genuinely the ENTROPY, not the importance, driving this —
    # almost_sure has the HIGHER importance yet loses.
    check("near-certain: it lost despite higher importance (entropy wins)",
          s2["dimensions"]["almost_sure"]["importance"]
          > s2["dimensions"]["wide_open"]["importance"])

    # ── 3. PAPRIKA: for a >2-value dim, the surfaced pair is the entropy-
    #       maximally-informative pair (the two contenders carrying the most,
    #       most-balanced mass). ──────────────────────────────────────────────
    s3 = new_session("paprika", {"d": 0.8})
    set_candidates(s3, "d", ["p", "q", "r"], belief_vec=[0.40, 0.35, 0.25])
    pair = paprika_pair(s3, "d")
    check("PAPRIKA: pair is the top-2-mass contenders", pair == ("p", "q"))
    # Prove it's the argmax over ALL pairs by the module's own scoring rule.
    b = belief(s3["dimensions"]["d"])
    values = ["p", "q", "r"]

    def pair_score(i, j):
        mass = b[i] + b[j]
        return mass * E._binary_entropy(b[i] / mass) if mass > 0 else 0.0

    best = max([(0, 1), (0, 2), (1, 2)], key=lambda t: pair_score(*t))
    check("PAPRIKA: surfaced pair == entropy-max-informative pair (brute force)",
          (values[best[0]], values[best[1]]) == pair)
    # And status() exposes it as the A/B fork the rail consumes.
    st3 = status(s3)
    check("PAPRIKA: status.pair exposes {dim,a,b} for the fork",
          st3["pair"] == {"dim": "d", "a": "p", "b": "q"})
    # A binary dim yields no >2-way fork in status.pair.
    s3b = new_session("binary", {"e": 0.7})
    set_candidates(s3b, "e", ["yes", "no"], belief_vec=[0.5, 0.5])
    check("PAPRIKA: binary dim exposes no A/B fork in status", status(s3b)["pair"] is None)

    # ── 4. Posterior update: answering concentrates mass and lowers that dim's
    #       entropy monotonically on repeat-confirm. ─────────────────────────
    s4 = new_session("posterior", {"d": 0.7})
    set_candidates(s4, "d", ["p", "q", "r"], belief_vec=[1 / 3, 1 / 3, 1 / 3])
    trace = [_entropy(s4["dimensions"]["d"])]
    lead = [belief(s4["dimensions"]["d"])[0]]
    for _ in range(4):
        E.answer(s4, "d", "p", decided=False)
        trace.append(_entropy(s4["dimensions"]["d"]))
        lead.append(belief(s4["dimensions"]["d"])[0])
    check("posterior: entropy is monotonically NON-increasing on repeat-confirm",
          all(trace[i + 1] <= trace[i] + 1e-12 for i in range(len(trace) - 1)))
    check("posterior: entropy STRICTLY drops on each confirm",
          all(trace[i + 1] < trace[i] - 1e-9 for i in range(len(trace) - 1)))
    check("posterior: mass concentrates on the confirmed value",
          all(lead[i + 1] > lead[i] - 1e-12 for i in range(len(lead) - 1)) and lead[-1] > 0.9)
    # The derived-belief path (no explicit vector) must also sharpen on confirm.
    s4d = new_session("posterior-derived", {"c": 0.7})
    E.answer(s4d, "c", "teal", decided=False)
    h1 = _entropy(s4d["dimensions"]["c"])
    E.answer(s4d, "c", "teal", decided=False)
    h2 = _entropy(s4d["dimensions"]["c"])
    check("posterior: derived belief (uncertainty-driven) also sharpens", h2 < h1)

    # ── 5. Convergence: a fully-answered session reaches ready/converged; an
    #       unanswered one does not. ──────────────────────────────────────────
    s5 = new_session("converge", {"a": 0.7, "b": 0.6, "c": 0.5})
    st_open = status(s5)
    check("converge: fresh session is NOT ready", st_open["ready"] is False)
    check("converge: fresh session is NOT converged", st_open["converged"] is False)
    for d in ["a", "b", "c"]:
        E.answer(s5, d, "chosen", decided=True, rating=5)
    st_done = status(s5)
    check("converge: fully-answered -> next_question None", st_done["next_question"] is None)
    check("converge: fully-answered -> ready True", st_done["ready"] is True)
    check("converge: fully-answered + rating>=4 -> converged True", st_done["converged"] is True)

    # ── 6. Interface preservation (the frozen contract). ────────────────────
    # 6a. new_session(goal, {dim: importance}) — the old bare-float form — works.
    s6 = new_session("iface", {"color.accent": 0.7, "spacing.density": 0.7})
    check("iface: new_session(goal, {dim: importance}) still works",
          set(s6["dimensions"]) == {"color.accent", "spacing.density"})
    check("iface: unseen dims start at U_UNSEEN (profile.py depends on this)",
          all(v["uncertainty"] == E.U_UNSEEN for v in s6["dimensions"].values()))
    check("iface: default candidate values applied to bare-float dims",
          s6["dimensions"]["color.accent"]["values"] == DEFAULT_VALUES)

    # 6b. status() returns AT LEAST every required key with the right shape.
    required = {
        "confidence", "info_gain", "ready", "converged", "round",
        "next_question", "ranked", "decided", "goal", "decision_type",
    }
    st6 = status(s6)
    check("iface: status() has all required keys", required <= set(st6))
    check("iface: status.ranked is top-5 [dim, score] over eligible dims",
          isinstance(st6["ranked"], list) and len(st6["ranked"]) <= 5
          and all(len(t) == 2 for t in st6["ranked"]))
    check("iface: status additive keys present (pair, entropy)",
          "pair" in st6 and "entropy" in st6)

    # 6c. rank_by_info_gain returns ELIGIBLE-only, high-first.
    veto(s6, "color.accent", "web", reason="pinned")
    ranked6 = rank_by_info_gain(s6)
    check("iface: rank_by_info_gain omits excluded (vetoed) dims",
          "color.accent" not in [d for d, _ in ranked6])
    check("iface: rank_by_info_gain is sorted high-first",
          all(ranked6[i][1] >= ranked6[i + 1][1] for i in range(len(ranked6) - 1)))

    # 6d. prune_values still excludes; veto still pins + excludes.
    s6p = new_session("prune", {"m": 0.6, "n": 0.6})
    prune_values(s6p, ["m"])
    check("iface: prune_values excludes the pruned dim",
          s6p["dimensions"]["m"]["excluded"] is True
          and "m" not in [d for d, _ in rank_by_info_gain(s6p)])

    print()
    if fails:
        print(f"BAYES SELFTEST: {fails} FAILED")
        return 1
    print("BAYES SELFTEST: all cases pass (EIG-ordering-diverges-from-proxy, "
          "low-entropy-not-asked, PAPRIKA-pair, posterior-monotone-concentration, "
          "convergence, interface-preserved)")
    return 0


def _eig(session, dim) -> float:
    return E._eig_score(session["dimensions"][dim])


if __name__ == "__main__":
    sys.exit(run())
