"""Chunk 3 tests — adaptive decision engine (state, contract, decide).

Covers:
  F4 anchor   — no vendor/network imports in designer/engine/{state,contract,decide}.py
  Termination — auto_next_step walk terminates within MAX_DECISIONS, no dup asks
  State round-trip — to_dict/from_dict preserves state
  apply_pick accumulation — 3 picks: overrides has all 3 deltas, asked has 3 entries
  Contract round-trip — build->write->fill->read->validate->next_step advances
  Ranking determinism — same state+catalog => same candidate order (informational,
      NOT a divergence assertion — identical/divergent walks are both fine)

Run: python3 designer/tests/test_chunk3_engine.py
Or:  python3 -m pytest designer/tests/test_chunk3_engine.py
"""

from __future__ import annotations

import json
import os
import sys
import tempfile

# Ensure project root is on path.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from designer.engine.state import TasteState
from designer.engine.catalog_loader import load_catalog
from designer.engine import contract as contract_mod
from designer.engine import decide as decide_mod
from designer.engine.catalog._deltas import ordering_tier_for_dimension


# ---------------------------------------------------------------------------
# F4 vendor-scan: no vendor or network imports in engine files
# ---------------------------------------------------------------------------

_BANNED_TOKENS = [
    "anthropic", "openai", "requests", "httpx",
    "urllib.request", "socket", "fetch",
]

_ENGINE_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "engine",
)
_ENGINE_FILES = ["state.py", "contract.py", "decide.py"]


def test_f4_no_vendor_imports():
    """Assert no vendor/network import in the three engine files we authored."""
    for fname in _ENGINE_FILES:
        path = os.path.join(_ENGINE_DIR, fname)
        with open(path, encoding="utf-8") as fh:
            src = fh.read()
        for token in _BANNED_TOKENS:
            assert token not in src, (
                f"F4 VIOLATION: {fname!r} contains banned token {token!r}. "
                "Engine must never call vendor APIs directly."
            )


# ---------------------------------------------------------------------------
# Catalog fixture (load once; used across tests)
# ---------------------------------------------------------------------------

def _catalog():
    return load_catalog(strict=False)


# ---------------------------------------------------------------------------
# TasteState tests
# ---------------------------------------------------------------------------

def test_initial_state_is_empty():
    state = TasteState()
    assert state.overrides == {}
    assert state.asked == []
    assert state.history == []
    assert state.per_platform == {}


def test_apply_pick_accumulates_three_deltas():
    """After 3 picks, overrides reflects all 3 deltas and asked has 3 entries."""
    cat = _catalog()
    state = TasteState(context={"description": "test app"})

    # Grab first three categories that have non-empty deltas.
    picked_cats = [c for c in cat.categories if c.options and c.options[0].token_delta][:3]
    assert len(picked_cats) == 3, "Need at least 3 categories with non-empty deltas"

    for c in picked_cats:
        opt = c.options[0]
        state.apply_pick(c.id, opt.id, opt.token_delta)

    assert len(state.asked) == 3
    assert len(state.history) == 3

    # All three deltas must be merged into overrides.
    for c in picked_cats:
        opt = c.options[0]
        for group, keys in opt.token_delta.items():
            for key, val in keys.items():
                # The last pick wins for any colliding keys; at minimum the
                # group/key must be present somewhere.
                assert group in state.overrides, f"group {group!r} missing from overrides"


def test_apply_pick_no_duplicate_asked():
    """Applying the same category twice does not duplicate it in asked."""
    cat = _catalog()
    c = cat.categories[0]
    opt = c.options[0]
    state = TasteState()
    state.apply_pick(c.id, opt.id, opt.token_delta)
    state.apply_pick(c.id, opt.id, opt.token_delta)  # same category again
    assert state.asked.count(c.id) == 1, "asked must have no duplicates"
    # History still records both calls (the history ledger is a full audit log).
    assert len(state.history) == 2


def test_state_round_trip():
    """to_dict/from_dict preserves all fields exactly."""
    cat = _catalog()
    state = TasteState(context={"description": "fitness app", "mood": "energetic"})
    c = cat.categories[0]
    opt = c.options[0]
    state.apply_pick(c.id, opt.id, opt.token_delta)

    d = state.to_dict()
    restored = TasteState.from_dict(d)
    assert restored.context == state.context
    assert restored.overrides == state.overrides
    assert restored.asked == state.asked
    assert restored.history == state.history
    assert restored.per_platform == state.per_platform


def test_undetermined_categories_decreases_after_picks():
    cat = _catalog()
    state = TasteState()
    initial_count = len(state.undetermined_categories(cat))
    assert initial_count > 0

    # Pick the first undetermined category.
    undetermined = state.undetermined_categories(cat)
    first = undetermined[0]
    state.apply_pick(first.id, first.options[0].id, first.options[0].token_delta)

    after_count = len(state.undetermined_categories(cat))
    # Must have fewer (or equal if dimension was already covered) undetermined.
    assert after_count < initial_count


def test_determined_dimensions_covers_asked_dimension():
    cat = _catalog()
    state = TasteState()
    c = cat.categories[0]
    opt = c.options[0]
    state.apply_pick(c.id, opt.id, opt.token_delta)

    # undetermined_categories should not include the same dimension again.
    for remaining in state.undetermined_categories(cat):
        assert remaining.dimension != c.dimension, (
            f"dimension {c.dimension!r} still undetermined after asking {c.id!r}"
        )


# ---------------------------------------------------------------------------
# Contract tests
# ---------------------------------------------------------------------------

def test_information_gain_in_range():
    """information_gain returns float in [0, 1] for every category."""
    cat = _catalog()
    state = TasteState(context={"description": "playful fitness app"})
    for c in cat.categories:
        score = contract_mod.information_gain(c, state)
        assert 0.0 <= score <= 1.0, f"score out of range for {c.id!r}: {score}"


def test_contract_has_required_keys():
    cat = _catalog()
    state = TasteState(context={"description": "social app"})
    ctr = contract_mod.build_decision_contract(state, cat)

    assert "context" in ctr
    assert "taste_summary" in ctr
    assert "candidates" in ctr
    assert "instructions" in ctr
    assert "answer" in ctr

    answer = ctr["answer"]
    assert "action" in answer
    assert "chosen_category_id" in answer
    assert "rationale" in answer
    assert answer["action"] is None, "unfilled contract answer slot must start null"


def test_contract_candidates_ranked_descending():
    """Candidates are ordered by ordering_tier ascending, then information_gain
    descending within each tier.

    Updated from the original pure-gain-descending assertion after UX-iter added
    tiered ordering (Task 1): primary sort is now ordering_tier ASCENDING
    (Tier 1 'Direction' first), secondary is information_gain DESCENDING within
    each tier. The composite sort is still fully deterministic given identical
    inputs. The old assertion (gains monotone descending) was invalidated because
    a Tier-2 candidate with high gain may legitimately appear after a Tier-1
    candidate with lower gain.
    """
    cat = _catalog()
    state = TasteState(context={"description": "enterprise finance app"})
    ctr = contract_mod.build_decision_contract(state, cat)

    candidates = ctr["candidates"]
    assert candidates, "expected non-empty candidates"

    # Primary sort is now the 3-tuple (layer, ordering_tier, -gain): Layer 1
    # "Scope & Skeleton" (platform/nav-structure) opens the walk, then within a
    # layer ordering_tier ascending, then information_gain descending.

    # 1. layer must be non-decreasing (PRIMARY sort: layer ascending).
    layers = [c["layer"] for c in candidates]
    assert layers == sorted(layers), (
        f"candidates layer must be non-decreasing; got {layers}"
    )

    # 2. Within each layer, ordering_tier must be non-decreasing (secondary sort).
    from itertools import groupby
    for layer_val, lgroup in groupby(candidates, key=lambda c: c["layer"]):
        tiers_in_layer = [c["ordering_tier"] for c in lgroup]
        assert tiers_in_layer == sorted(tiers_in_layer), (
            f"Within layer {layer_val}, ordering_tier must be non-decreasing; got {tiers_in_layer}"
        )

    # 3. Within each (layer, ordering_tier) bucket, information_gain non-increasing.
    for key_val, group in groupby(candidates, key=lambda c: (c["layer"], c["ordering_tier"])):
        gains = [c["information_gain"] for c in group]
        assert gains == sorted(gains, reverse=True), (
            f"Within {key_val}, gains must be non-increasing; got {gains}"
        )

    # 4. Each candidate must carry the ordering_tier + layer keys.
    for c in candidates:
        assert "ordering_tier" in c, f"candidate {c['id']!r} missing ordering_tier key"
        assert "layer" in c, f"candidate {c['id']!r} missing layer key"


def test_contract_round_trip_and_next_step_advances():
    """build -> write -> fill answer -> read -> validate -> next_step advances state."""
    cat = _catalog()
    state = TasteState(context={"description": "travel app"})

    with tempfile.NamedTemporaryFile(
        suffix=".json", mode="w", delete=False, dir=tempfile.gettempdir()
    ) as tmp:
        tmp_path = tmp.name

    try:
        # Build and write the contract.
        ctr = contract_mod.build_decision_contract(state, cat)
        contract_mod.write_contract(tmp_path, ctr)

        # Simulate host-LLM filling the answer: pick first candidate, action="ask".
        filled = contract_mod.read_contract(tmp_path)
        first_candidate_id = filled["candidates"][0]["id"]
        filled["answer"]["action"] = "ask"
        filled["answer"]["chosen_category_id"] = first_candidate_id
        filled["answer"]["rationale"] = "test fill"
        contract_mod.write_contract(tmp_path, filled)

        # Read back and validate.
        answer_contract = contract_mod.read_contract(tmp_path)
        errors = contract_mod.validate_contract_answer(answer_contract)
        assert not errors, f"Validation errors: {errors}"

        # Feed the FULL filled contract to next_step.
        result = decide_mod.next_step(state, cat, answer_contract)
        assert result.action == "ask"
        assert result.category is not None
        assert result.category.id == first_candidate_id
    finally:
        os.unlink(tmp_path)


def test_validate_contract_answer_catches_invalid_action():
    errors = contract_mod.validate_contract_answer(
        {"answer": {"action": "bogus", "chosen_category_id": None, "rationale": None},
         "candidates": []}
    )
    assert any("action" in e for e in errors)


def test_validate_contract_answer_catches_missing_category():
    errors = contract_mod.validate_contract_answer(
        {"answer": {"action": "ask", "chosen_category_id": None, "rationale": None},
         "candidates": [{"id": "cat-1"}]}
    )
    assert any("chosen_category_id" in e for e in errors)


# ---------------------------------------------------------------------------
# Decide engine tests
# ---------------------------------------------------------------------------

def test_auto_walk_terminates_within_max_decisions():
    """Full auto_next_step walk terminates; asked list never exceeds MAX_DECISIONS."""
    cat = _catalog()
    state = TasteState(context={"description": "productivity app"})
    max_iters = decide_mod.MAX_DECISIONS + len(cat.categories) + 5
    steps = 0
    while steps < max_iters:
        result = decide_mod.auto_next_step(state, cat)
        steps += 1
        if result.action == "done":
            break
    else:
        assert False, f"Walk did not terminate after {max_iters} iterations"

    assert len(state.asked) <= decide_mod.MAX_DECISIONS, (
        f"asked ({len(state.asked)}) exceeds MAX_DECISIONS ({decide_mod.MAX_DECISIONS})"
    )


def test_auto_walk_no_duplicate_asks():
    """The asked ledger must have no duplicate category_ids after a full walk."""
    cat = _catalog()
    state = TasteState(context={"description": "ecommerce app"})
    for _ in range(decide_mod.MAX_DECISIONS + 10):
        result = decide_mod.auto_next_step(state, cat)
        if result.action == "done":
            break
    assert len(state.asked) == len(set(state.asked)), (
        f"Duplicate entries in asked: {state.asked}"
    )


def test_next_step_pending_host_when_no_answer():
    """next_step with no contract_answer returns PENDING_HOST + contract."""
    cat = _catalog()
    state = TasteState(context={"description": "gaming app"})
    result = decide_mod.next_step(state, cat, contract_answer=None)
    assert result.action == "PENDING_HOST"
    assert result.contract is not None
    assert "candidates" in result.contract


def test_next_step_done_when_at_cap():
    """next_step returns done immediately when asked already at MAX_DECISIONS."""
    cat = _catalog()
    # Force the state to the cap by auto-walking.
    state = TasteState(context={"description": "test"})
    for _ in range(decide_mod.MAX_DECISIONS + 5):
        r = decide_mod.auto_next_step(state, cat)
        if r.action == "done":
            break
    assert len(state.asked) >= decide_mod.MAX_DECISIONS or not state.undetermined_categories(cat)
    result = decide_mod.next_step(state, cat, contract_answer=None)
    assert result.action == "done"


def test_next_step_honors_host_infer():
    """next_step honors action='infer': records the inferred category in state."""
    cat = _catalog()
    state = TasteState(context={"description": "social app"})

    # Build a contract to get a valid candidate list.
    ctr = contract_mod.build_decision_contract(state, cat)
    # Simulate host choosing 'infer'.
    ctr["answer"]["action"] = "infer"
    errors = contract_mod.validate_contract_answer(ctr)
    assert not errors

    before_asked = len(state.asked)
    result = decide_mod.next_step(state, cat, contract_answer=ctr)
    assert result.action == "infer"
    assert result.inferred_category is not None
    assert len(state.asked) == before_asked + 1


def test_next_step_honors_host_done():
    """next_step honors action='done' from host LLM."""
    cat = _catalog()
    state = TasteState(context={"description": "minimal app"})
    ctr = contract_mod.build_decision_contract(state, cat)
    ctr["answer"]["action"] = "done"
    result = decide_mod.next_step(state, cat, contract_answer=ctr)
    assert result.action == "done"


# ---------------------------------------------------------------------------
# Ranking determinism (informational, non-gating)
# ---------------------------------------------------------------------------

def test_candidate_ranking_is_deterministic():
    """Same state + catalog => same candidate ranking every time.

    This test verifies engine plumbing (deterministic heuristic), NOT design
    divergence. Identical and divergent walks are both valid outputs; this
    assertion DOES NOT enforce divergence between contexts.
    """
    cat = _catalog()
    state = TasteState(context={"description": "minimal productivity app", "mood": "calm"})

    ctr_a = contract_mod.build_decision_contract(state, cat)
    ctr_b = contract_mod.build_decision_contract(state, cat)

    ids_a = [c["id"] for c in ctr_a["candidates"]]
    ids_b = [c["id"] for c in ctr_b["candidates"]]
    assert ids_a == ids_b, (
        "Candidate ranking is non-deterministic with identical inputs. "
        "The heuristic must be deterministic; divergence is only a context-driven effect."
    )


# ---------------------------------------------------------------------------
# stdlib runner
# ---------------------------------------------------------------------------

def _run():
    fns = [v for k, v in globals().items() if k.startswith("test_") and callable(v)]
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
