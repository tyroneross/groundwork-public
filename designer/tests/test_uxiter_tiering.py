"""UX-iter tiering tests — ordering_tier, CLI payload, round-trip, soft-gate.

Tests added for the UX-iteration that introduced:
  - DIMENSION_ORDERING_TIER mapping in _deltas.py
  - ordering_tier_for_dimension / ordering_tier_label helpers
  - Composite sort (tier ASC, info-gain DESC) in contract.py and decide.py
  - ordering_tier / ordering_tier_label keys in cli.py _decision_payload
  - _load_state accepting both wrapped {"state": {...}} and bare state shapes

Run: python3 designer/tests/test_uxiter_tiering.py
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

from designer.engine.catalog._deltas import (
    CATEGORY_DIMENSION,
    DIMENSION_ORDERING_TIER,
    ordering_tier_for_dimension,
    ordering_tier_label,
)
from designer.engine.state import TasteState
from designer.engine.catalog_loader import load_catalog
from designer.engine import contract as contract_mod
from designer.engine import decide as decide_mod


# ---------------------------------------------------------------------------
# Subprocess helper (mirrors test_chunk6_integration._cli)
# ---------------------------------------------------------------------------

def _cli(args, state=None):
    """Run the CLI as a subprocess and return parsed JSON output."""
    full = [sys.executable, "-m", "designer.engine.cli", *args]
    if state is not None:
        sf = os.path.join(tempfile.gettempdir(), "tiering_test_state.json")
        with open(sf, "w") as fh:
            json.dump(state, fh)
        full += ["--state", sf]
    p = subprocess.run(full, cwd=ROOT, capture_output=True, text=True)
    assert p.returncode == 0, f"CLI exited {p.returncode}: {p.stderr}"
    return json.loads(p.stdout)


# ---------------------------------------------------------------------------
# (a) Round-trip test: wrapped output -> --state input
# ---------------------------------------------------------------------------

def test_roundtrip_wrapped_output_feeds_present():
    """init emits {"state": {...}}; that wrapped blob must feed present without error.

    This validates the cli.py:9 docstring promise: subcommand output is
    re-feedable directly as --state input.
    """
    # Write the raw init stdout (the wrapped {"state": ...} dict) to a file.
    init_result = _cli(["init", "--context", "roundtrip test app"])
    assert "state" in init_result, f"init did not emit state: {init_result}"

    # Write the FULL wrapped JSON (not just .state) to a temp file.
    with tempfile.NamedTemporaryFile(
        suffix=".json", mode="w", delete=False, dir=tempfile.gettempdir()
    ) as tf:
        json.dump(init_result, tf)   # <-- wrapped shape: {"state": {...}}
        tf_path = tf.name

    try:
        # Feed the wrapped file directly to present.
        p = subprocess.run(
            [sys.executable, "-m", "designer.engine.cli", "present", "--state", tf_path],
            cwd=ROOT, capture_output=True, text=True,
        )
        assert p.returncode == 0, f"present with wrapped state failed: {p.stderr}"
        result = json.loads(p.stdout)
        assert result["action"] in {"ask", "done"}, (
            f"expected ask or done, got {result['action']!r}"
        )
        assert "error" not in result, f"present returned error: {result}"
    finally:
        os.unlink(tf_path)


def test_roundtrip_bare_state_still_works():
    """Bare state dict (the inner .state) must still work as --state (back-compat)."""
    init_result = _cli(["init", "--context", "bare state test"])
    bare_state = init_result["state"]   # inner dict, no "state" wrapper

    with tempfile.NamedTemporaryFile(
        suffix=".json", mode="w", delete=False, dir=tempfile.gettempdir()
    ) as tf:
        json.dump(bare_state, tf)   # <-- bare shape: {...}
        tf_path = tf.name

    try:
        p = subprocess.run(
            [sys.executable, "-m", "designer.engine.cli", "present", "--state", tf_path],
            cwd=ROOT, capture_output=True, text=True,
        )
        assert p.returncode == 0, f"present with bare state failed: {p.stderr}"
        result = json.loads(p.stdout)
        assert result["action"] in {"ask", "done"}, (
            f"expected ask or done from bare state, got {result['action']!r}"
        )
    finally:
        os.unlink(tf_path)


def test_roundtrip_pick_output_feeds_present():
    """pick emits {"state": {...}}; that wrapped output must feed present."""
    init_result = _cli(["init", "--context", "pick roundtrip"])
    state = init_result["state"]

    # Get the first decision.
    step = _cli(["present"], state)
    assert step["action"] == "ask", "Expected ask on fresh state"
    dec = step["decision"]
    cat_id = dec["category_id"]
    opt_id = dec["options"][0]["id"]

    # Pick an option — emits {"state": {...}, "picked": {...}}.
    pick_result = _cli(["pick", "--category", cat_id, "--option", opt_id], state)
    assert "state" in pick_result

    # Write the FULL pick result (wrapped) and feed to present.
    with tempfile.NamedTemporaryFile(
        suffix=".json", mode="w", delete=False, dir=tempfile.gettempdir()
    ) as tf:
        json.dump(pick_result, tf)
        tf_path = tf.name

    try:
        p = subprocess.run(
            [sys.executable, "-m", "designer.engine.cli", "present", "--state", tf_path],
            cwd=ROOT, capture_output=True, text=True,
        )
        assert p.returncode == 0, f"present with wrapped pick output failed: {p.stderr}"
        result = json.loads(p.stdout)
        assert result["action"] in {"ask", "done"}, result["action"]
    finally:
        os.unlink(tf_path)


# ---------------------------------------------------------------------------
# (b) Tier-ordering test: walk order is tier-monotonic
# ---------------------------------------------------------------------------

def test_first_surfaced_decision_is_tier1():
    """In a no-context generic walk, the first surfaced decision is Tier 1."""
    cat = load_catalog(strict=False)
    state = TasteState(context={})
    result = decide_mod.present_next(state, cat)
    assert result.action == "ask", f"Expected ask on fresh state, got {result.action}"
    first_dim = result.category.dimension
    ot = ordering_tier_for_dimension(first_dim)
    assert ot == 1, (
        f"First surfaced dimension {first_dim!r} has ordering_tier={ot}; expected 1 (Tier 1 Direction). "
        "Tier 1 should contain at least color.accent."
    )


def test_walk_ordering_tier_sequence_is_nondecreasing():
    """Full present_next walk yields categories in non-decreasing ordering_tier order.

    This proves that tier is the primary sort key — all Tier-1 decisions come
    before any Tier-2, which comes before any Tier-3.
    """
    cat = load_catalog(strict=False)
    state = TasteState(context={})

    tier_sequence = []
    for _ in range(50):   # generous upper bound
        result = decide_mod.present_next(state, cat)
        if result.action == "done":
            break
        assert result.category is not None
        dim = result.category.dimension
        ot = ordering_tier_for_dimension(dim)
        tier_sequence.append((result.category.id, ot))
        # Record a pick so we advance (pick first option).
        c = result.category
        opt = c.options[0]
        state.apply_pick(c.id, opt.id, opt.token_delta)

    assert tier_sequence, "Walk produced no decisions"
    tiers_only = [t for _, t in tier_sequence]
    assert tiers_only == sorted(tiers_only), (
        f"ordering_tier sequence is NOT non-decreasing: {tier_sequence}"
    )


def test_color_dark_mode_is_tier3_and_not_early():
    """color-dark-mode (dimension color.surface) is Tier 3 and must NOT appear in
    the first 2 walk positions, because it depends on Tier-1 accent and Tier-2
    foundations being decided first.
    """
    # Direct dimension-tier check.
    ot = ordering_tier_for_dimension("color.surface")
    assert ot == 3, f"color.surface ordering_tier should be 3, got {ot}"

    # Walk check: color-dark-mode must not be in first 2 positions.
    cat = load_catalog(strict=False)
    state = TasteState(context={})

    walk_order = []
    for _ in range(50):
        result = decide_mod.present_next(state, cat)
        if result.action == "done":
            break
        walk_order.append(result.category.id)
        c = result.category
        state.apply_pick(c.id, c.options[0].id, c.options[0].token_delta)

    if "color-dark-mode" in walk_order:
        idx = walk_order.index("color-dark-mode")
        assert idx >= 2, (
            f"color-dark-mode appeared at position {idx} (0-based) — must not be in first 2 positions"
        )

    # Also verify no Tier-2 dim appears after color-dark-mode in the walk.
    tier_walk = [(cid, ordering_tier_for_dimension(
        next(c.dimension for c in load_catalog(strict=False).categories if c.id == cid)
    )) for cid in walk_order]
    seen_tiers = [t for _, t in tier_walk]
    assert seen_tiers == sorted(seen_tiers), (
        f"Walk tier sequence not non-decreasing (tier ordering violated): {tier_walk}"
    )


# ---------------------------------------------------------------------------
# (c) Decision payload carries ordering_tier and ordering_tier_label
# ---------------------------------------------------------------------------

def test_decision_payload_has_ordering_tier_keys():
    """The CLI decision payload includes ordering_tier and ordering_tier_label."""
    init_result = _cli(["init", "--context", "payload tier test"])
    state = init_result["state"]
    step = _cli(["present"], state)
    assert step["action"] == "ask", f"Expected ask, got {step['action']}"
    dec = step["decision"]
    assert "ordering_tier" in dec, f"ordering_tier missing from decision payload: {list(dec.keys())}"
    assert "ordering_tier_label" in dec, f"ordering_tier_label missing from decision payload: {list(dec.keys())}"
    assert dec["ordering_tier"] in {1, 2, 3}, f"ordering_tier out of range: {dec['ordering_tier']}"
    assert dec["ordering_tier_label"] in {"Direction", "Foundations", "Details"}, (
        f"ordering_tier_label unexpected: {dec['ordering_tier_label']!r}"
    )


def test_decision_payload_existing_tier_fidelity_key_unchanged():
    """The existing 'tier' (fidelity) key in the payload must still be present and
    must NOT be repurposed — it refers to preview fidelity ('high'|'low'), not ordering.
    """
    init_result = _cli(["init", "--context", "fidelity tier check"])
    state = init_result["state"]
    step = _cli(["present"], state)
    assert step["action"] == "ask"
    dec = step["decision"]
    assert "tier" in dec, "Fidelity 'tier' key must still exist in decision payload"
    # fidelity tier is a string ("high" or "low"), ordering_tier is an int
    assert isinstance(dec["tier"], str), (
        f"fidelity 'tier' should be a string, got {type(dec['tier'])}"
    )
    assert isinstance(dec["ordering_tier"], int), (
        f"ordering_tier should be an int, got {type(dec['ordering_tier'])}"
    )


# ---------------------------------------------------------------------------
# (d) Soft-default: all undetermined candidates listed; none dropped by tier
# ---------------------------------------------------------------------------

def test_all_undetermined_candidates_present_in_contract():
    """The contract lists ALL undetermined candidates — no candidate is dropped
    because of its tier. Tiering only controls ORDER, not inclusion.

    This verifies the SOFT nature of the default: the host LLM may still pick
    any candidate from any tier.
    """
    cat = load_catalog(strict=False)
    state = TasteState(context={"description": "soft gate test"})

    undetermined = state.undetermined_categories(cat)
    undetermined_ids = {c.id for c in undetermined}

    ctr = contract_mod.build_decision_contract(state, cat)
    contract_ids = {c["id"] for c in ctr["candidates"]}

    assert undetermined_ids == contract_ids, (
        f"Contract dropped candidates (scope breach in tiering).\n"
        f"  Missing from contract: {undetermined_ids - contract_ids}\n"
        f"  Extra in contract:     {contract_ids - undetermined_ids}"
    )


# ---------------------------------------------------------------------------
# (_deltas sanity) All CATEGORY_DIMENSION values are in DIMENSION_ORDERING_TIER
# ---------------------------------------------------------------------------

def test_all_category_dimensions_have_ordering_tier():
    """Every distinct dimension referenced by CATEGORY_DIMENSION has an explicit
    entry in DIMENSION_ORDERING_TIER. If a dimension is missing, ordering_tier_for_dimension
    returns the safe default (2 = Foundations), but we want all 32 to be explicit.
    """
    distinct_dims = set(CATEGORY_DIMENSION.values())
    missing = distinct_dims - set(DIMENSION_ORDERING_TIER.keys())
    assert not missing, (
        f"Dimensions in CATEGORY_DIMENSION not in DIMENSION_ORDERING_TIER: {sorted(missing)}\n"
        "Add them to DIMENSION_ORDERING_TIER in _deltas.py."
    )


def test_ordering_tier_label_mapping():
    """ordering_tier_label returns correct strings for 1, 2, 3 and 'Foundations' for others."""
    assert ordering_tier_label(1) == "Direction"
    assert ordering_tier_label(2) == "Foundations"
    assert ordering_tier_label(3) == "Details"
    assert ordering_tier_label(0) == "Foundations"   # unknown -> safe default
    assert ordering_tier_label(99) == "Foundations"


def test_ordering_tier_for_dimension_defaults_for_unknown():
    """ordering_tier_for_dimension returns 2 for unmapped dimensions (never crashes)."""
    assert ordering_tier_for_dimension("nonexistent.dim") == 2
    assert ordering_tier_for_dimension("") == 2


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def _run():
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {fn.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"ERROR {fn.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    return failed


if __name__ == "__main__":
    sys.exit(1 if _run() else 0)
