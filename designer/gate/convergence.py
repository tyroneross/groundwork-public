"""convergence.py — the ported style-calibrator convergence gate + a Designer adapter.

PROVENANCE
----------
This is a faithful port of three functions in the style-calibrator prototype
(`style-calibrator/style-calibrator.html`, client-side JS):

    overallConfidence()   ~line 4533 : 1 - importance-weighted mean uncertainty
                                        over ALL dims.
    infoGainRemaining()   ~line 4547 : max(uncertainty * importance) over the
                                        dims still eligible (not skip-excluded).
    convergenceStatus()   ~line 4563 : stop condition.

The exact stop condition, ported verbatim (JS -> Python):

    capped    = roundCount >= MAX_ROUNDS
    exhausted = nextDimension() === null
    ready     = (conf >= 0.80 && gain < 0.25) || capped || exhausted
    converged = ready && last calibration exists && last.rating >= 4

MAX_ROUNDS = 30 in the source (line 4365); reused here as the default.
The source's per-dim `skips` counter (excluded when skips >= MAX_SKIPS=3) has no
Designer analogue, so the port exposes an `excluded` flag per dim instead — the
caller (or the adapter) decides exclusion. The adapter never excludes.

DESIGNER ADAPTER
----------------
`dim_states_from_history` bridges the Designer engine to this gate. Designer pick
history is a list of rows {category_id, option_id, delta, source} (see
designer/engine/state.py TasteState), and each of the 32 categories maps to
exactly one token dimension "group.key" (designer/engine/catalog/_deltas.py
CATEGORY_DIMENSION). The adapter groups history by target dimension and derives
{uncertainty, importance} per dimension. Both derivations are DOCUMENTED
HEURISTICS chosen as a starting point — NOT claimed-optimal. Tune freely; the
gate math above is the stable contract, the heuristics are not.

Pure stdlib. No third-party imports.
"""

from __future__ import annotations

import json
from typing import Any, Optional

# Matches MAX_ROUNDS in style-calibrator.html line 4365. The loop offers
# calibration unconditionally after this many picks so a non-cooperative picker
# can never pin the loop open forever.
MAX_ROUNDS = 30

# Confidence/info-gain thresholds — ported verbatim from convergenceStatus().
_CONF_THRESHOLD = 0.80
_GAIN_THRESHOLD = 0.25
# Rating a calibration must meet/exceed for `converged` (source line 4571).
_CONVERGE_RATING = 4

DimState = dict[str, Any]  # {"uncertainty": float, "importance": float, "excluded": bool}


# ---------------------------------------------------------------------------
# Ported gate math
# ---------------------------------------------------------------------------

def _eligible(dim_states: dict[str, DimState]) -> list[DimState]:
    """Dims not skip-excluded — mirrors the `.filter(skips < MAX_SKIPS)` in JS."""
    return [d for d in dim_states.values() if not d.get("excluded", False)]


def overall_confidence(dim_states: dict[str, DimState]) -> float:
    """1 - importance-weighted mean uncertainty over ALL dims.

    Faithful port of overallConfidence() (line 4533). Note: the source sums over
    ALL dims (no skip filter), so this does too. Returns 0.0 when total
    importance is 0 (matches the `den ? ... : 0` guard).
    """
    num = 0.0
    den = 0.0
    for d in dim_states.values():
        num += float(d["uncertainty"]) * float(d["importance"])
        den += float(d["importance"])
    return 1.0 - num / den if den else 0.0


def info_gain_remaining(dim_states: dict[str, DimState]) -> float:
    """max(uncertainty * importance) over eligible dims; 0 when none eligible.

    Faithful port of infoGainRemaining() (line 4547) — the best single-round
    payoff still available.
    """
    m = 0.0
    for d in _eligible(dim_states):
        score = float(d["uncertainty"]) * float(d["importance"])
        if score > m:
            m = score
    return m


def convergence_status(
    dim_states: dict[str, DimState],
    round_count: int,
    next_dim: Optional[str],
    last_rating: Optional[float] = None,
    max_rounds: int = MAX_ROUNDS,
) -> dict[str, Any]:
    """Ported convergenceStatus() (line 4563).

    Parameters
    ----------
    dim_states : {dim: {"uncertainty", "importance", "excluded"}}
    round_count : picks taken so far (source: s.roundCount).
    next_dim : the dimension the loop would probe next, or None if exhausted
        (source: nextDimension() === null). The caller owns this decision —
        in Designer, exhaustion means no undetermined categories remain.
    last_rating : the most recent calibration rating, or None if the user has
        not calibrated yet (source: last.rating).
    max_rounds : cap; defaults to MAX_ROUNDS (30, matching source).

    Returns
    -------
    {"confidence": float, "info_gain": float, "ready": bool, "converged": bool}

    Stop condition (verbatim from source):
        ready = (confidence >= 0.80 and info_gain < 0.25)
                or (round_count >= max_rounds)      # capped
                or (next_dim is None)               # exhausted
        converged = ready and last_rating is not None and last_rating >= 4
    """
    conf = overall_confidence(dim_states)
    gain = info_gain_remaining(dim_states)
    capped = round_count >= max_rounds
    exhausted = next_dim is None
    ready = (conf >= _CONF_THRESHOLD and gain < _GAIN_THRESHOLD) or capped or exhausted
    converged = ready and (last_rating is not None) and (float(last_rating) >= _CONVERGE_RATING)
    return {
        "confidence": conf,
        "info_gain": gain,
        "ready": ready,
        "converged": converged,
    }


# ---------------------------------------------------------------------------
# Designer adapter: pick history -> per-dimension {uncertainty, importance}
# ---------------------------------------------------------------------------

# --- Heuristic tuning constants (ALL tunable — see module docstring) --------
_U_UNSEEN = 0.9         # uncertainty for a dimension with no pick yet
_U_FLOOR = 0.05         # never fully certain (mirrors source's max(0.05, ...))
_U_SHRINK = 0.6         # per-confirming-pick multiplicative shrink
_U_RECENCY = 0.85       # extra shrink when the most recent pick == dominant value
_IMP_BASE = 0.5         # base importance for any mapped dimension
_IMP_PER_CATEGORY = 0.1  # + this per category that maps to the dimension (leverage)


def _delta_value_at(delta: dict[str, Any], dim: str) -> Any:
    """Extract the value a pick's token_delta sets at dimension `dim` ("group.key").

    Returns a JSON-normalized string (stable for dict values) or None if the
    delta does not touch this path.
    """
    if "." not in dim:
        return None
    group, key = dim.split(".", 1)
    sub = delta.get(group)
    if not isinstance(sub, dict) or key not in sub:
        return None
    return json.dumps(sub[key], sort_keys=True)


def dim_states_from_history(
    history: list[dict[str, Any]],
    category_dimension: dict[str, str],
) -> dict[str, DimState]:
    """Derive per-token-dimension {uncertainty, importance, excluded} from picks.

    HEURISTIC — starting point, not claimed-optimal. Tune the module constants.

    Dimension set: every distinct token dimension in `category_dimension`
    values (stable regardless of history — unseen dims get max uncertainty).

    Uncertainty (high == "still needs a probe"):
      * no pick touching the dim          -> _U_UNSEEN (0.9)
      * repeatedly / recently confirmed   -> low (multiplicative shrink)
      * conflicting picks                 -> raised back toward _U_UNSEEN
      Formula, per dim with n picks setting a value at its token path:
        conf   = _U_UNSEEN * (_U_SHRINK ** n)           # more picks -> lower
        u      = conf + conflict_frac * (_U_UNSEEN - conf)  # disagreement raises it
        if last pick == dominant value: u *= _U_RECENCY  # recency reward
        u      = clamp(_U_FLOOR, _U_UNSEEN, u)
      where conflict_frac = 1 - (count of dominant value / n).

    Importance (leverage weight): more categories mapping to a dimension == more
    of the design surface it governs == higher weight.
        importance = min(1.0, _IMP_BASE + _IMP_PER_CATEGORY * n_categories)

    `excluded` is always False — Designer has no skip counter (see module
    docstring). Callers wanting skip-exclusion can post-process the result.
    """
    # How many categories map to each dimension (importance = leverage).
    cat_count: dict[str, int] = {}
    for dim in category_dimension.values():
        cat_count[dim] = cat_count.get(dim, 0) + 1

    # Collect the ordered list of picked values per dimension.
    values_by_dim: dict[str, list[Any]] = {dim: [] for dim in cat_count}
    for row in history:
        cat = row.get("category_id")
        dim = category_dimension.get(cat)
        if dim is None:
            continue  # category not in the map -> not a token dimension we gate on
        val = _delta_value_at(row.get("delta") or {}, dim)
        if val is not None:  # empty/no-op deltas don't count as a confirming pick
            values_by_dim[dim].append(val)

    dim_states: dict[str, DimState] = {}
    for dim, n_cats in cat_count.items():
        importance = min(1.0, _IMP_BASE + _IMP_PER_CATEGORY * n_cats)
        values = values_by_dim[dim]
        n = len(values)
        if n == 0:
            uncertainty = _U_UNSEEN
        else:
            # dominant value + agreement
            counts: dict[Any, int] = {}
            for v in values:
                counts[v] = counts.get(v, 0) + 1
            dominant = max(counts, key=lambda k: counts[k])
            conflict_frac = 1.0 - counts[dominant] / n
            conf = _U_UNSEEN * (_U_SHRINK ** n)
            u = conf + conflict_frac * (_U_UNSEEN - conf)
            if values[-1] == dominant:
                u *= _U_RECENCY
            uncertainty = max(_U_FLOOR, min(_U_UNSEEN, u))
        dim_states[dim] = {
            "uncertainty": uncertainty,
            "importance": importance,
            "excluded": False,
        }
    return dim_states


# ---------------------------------------------------------------------------
# Self-test:  python3 -m designer.gate.convergence
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

    # --- gate math: not-ready (low confidence) -----------------------------
    low = {
        "a": {"uncertainty": 0.9, "importance": 0.9, "excluded": False},
        "b": {"uncertainty": 0.9, "importance": 0.8, "excluded": False},
    }
    st = convergence_status(low, round_count=1, next_dim="a", last_rating=None)
    check("not-ready: low confidence -> ready False", st["ready"] is False)
    check("not-ready: confidence < 0.80", st["confidence"] < 0.80)
    check("not-ready: converged False", st["converged"] is False)

    # --- ready-by-threshold: conf >= 0.80 AND gain < 0.25 ------------------
    high = {
        "a": {"uncertainty": 0.10, "importance": 0.9, "excluded": False},
        "b": {"uncertainty": 0.10, "importance": 0.8, "excluded": False},
    }
    st = convergence_status(high, round_count=5, next_dim="a", last_rating=None)
    check("ready-by-threshold: confidence >= 0.80", st["confidence"] >= 0.80)
    check("ready-by-threshold: info_gain < 0.25", st["info_gain"] < 0.25)
    check("ready-by-threshold: ready True", st["ready"] is True)
    check("ready-by-threshold: converged False (no rating)", st["converged"] is False)

    # --- ready-by-cap: round_count >= max_rounds despite low confidence ----
    st = convergence_status(low, round_count=MAX_ROUNDS, next_dim="a", last_rating=None)
    check("ready-by-cap: ready True at cap", st["ready"] is True)
    check("ready-by-cap: still low confidence", st["confidence"] < 0.80)
    st2 = convergence_status(low, round_count=5, next_dim="a", last_rating=None, max_rounds=5)
    check("ready-by-cap: custom max_rounds honored", st2["ready"] is True)

    # --- ready-by-exhaustion: next_dim is None -----------------------------
    st = convergence_status(low, round_count=2, next_dim=None, last_rating=None)
    check("ready-by-exhaustion: ready True when next_dim None", st["ready"] is True)

    # --- converged requires rating >= 4 ------------------------------------
    st = convergence_status(high, round_count=5, next_dim="a", last_rating=3)
    check("converged: rating 3 -> converged False", st["converged"] is False)
    st = convergence_status(high, round_count=5, next_dim="a", last_rating=4)
    check("converged: ready + rating 4 -> converged True", st["converged"] is True)
    st = convergence_status(high, round_count=5, next_dim="a", last_rating=5)
    check("converged: ready + rating 5 -> converged True", st["converged"] is True)
    # not-ready but high rating must NOT converge
    st = convergence_status(low, round_count=1, next_dim="a", last_rating=5)
    check("converged: not-ready + rating 5 -> converged False", st["converged"] is False)

    # --- info_gain honors `excluded` ---------------------------------------
    ex = {
        "a": {"uncertainty": 0.9, "importance": 0.9, "excluded": True},
        "b": {"uncertainty": 0.1, "importance": 0.5, "excluded": False},
    }
    check("info_gain: excluded dim ignored", abs(info_gain_remaining(ex) - 0.05) < 1e-9)

    # --- adapter: unseen dim -> high uncertainty ---------------------------
    catmap = {
        "cat-x": "motion.intensity",
        "cat-y": "motion.intensity",
        "cat-z": "color.accent",
    }
    ds = dim_states_from_history([], catmap)
    check("adapter: dimension set from map", set(ds) == {"motion.intensity", "color.accent"})
    check("adapter: unseen -> uncertainty 0.9", ds["motion.intensity"]["uncertainty"] == 0.9)
    check(
        "adapter: importance scales with #categories",
        ds["motion.intensity"]["importance"] > ds["color.accent"]["importance"],
    )

    # --- adapter: repeated confirmation lowers uncertainty -----------------
    confirmed_hist = [
        {"category_id": "cat-x", "option_id": "o1",
         "delta": {"motion": {"intensity": "high"}}, "source": "pick"},
        {"category_id": "cat-y", "option_id": "o2",
         "delta": {"motion": {"intensity": "high"}}, "source": "pick"},
    ]
    ds = dim_states_from_history(confirmed_hist, catmap)
    check(
        "adapter: repeated confirm -> lower uncertainty than unseen",
        ds["motion.intensity"]["uncertainty"] < 0.9,
    )

    # --- adapter: conflicting picks raise uncertainty vs pure confirm ------
    conflict_hist = [
        {"category_id": "cat-x", "option_id": "o1",
         "delta": {"motion": {"intensity": "high"}}, "source": "pick"},
        {"category_id": "cat-y", "option_id": "o2",
         "delta": {"motion": {"intensity": "low"}}, "source": "pick"},
    ]
    u_conflict = dim_states_from_history(conflict_hist, catmap)["motion.intensity"]["uncertainty"]
    u_confirm = dim_states_from_history(confirmed_hist, catmap)["motion.intensity"]["uncertainty"]
    check("adapter: conflict -> higher uncertainty than confirm", u_conflict > u_confirm)

    # --- adapter feeds gate end-to-end -------------------------------------
    st = convergence_status(
        dim_states_from_history(confirmed_hist, catmap),
        round_count=2, next_dim="color.accent", last_rating=None,
    )
    check("adapter->gate: returns well-formed status",
          set(st) == {"confidence", "info_gain", "ready", "converged"})

    print()
    if fails:
        print(f"SELFTEST: {fails} FAILED")
        raise SystemExit(1)
    print("SELFTEST: all cases pass (not-ready, ready-by-threshold, ready-by-cap, "
          "ready-by-exhaustion, converged-requires-rating>=4, adapter)")


if __name__ == "__main__":
    _selftest()
