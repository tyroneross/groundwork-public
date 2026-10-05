"""Tests for coarse-to-fine layer sort (Layer 1 Scope & Skeleton first).

Verifies:
  1. layer_for_dimension maps correctly for Layer-1, Layer-2, Layer-3, unknown.
  2. layer_label maps correctly.
  3. A fresh walk opens on Layer 1 (platform.target), NOT color.accent.
  4. build_decision_contract candidates[0] is Layer 1; each carries layer + layer_label.
  5. After both Layer-1 picks, present_next surfaces a Layer-2 category.
  6. Within Layer 2, color-accent-system is still first (tie-break preserved).

Pure stdlib + pytest. No network, no vendor SDK.
"""

from __future__ import annotations

import pytest

from designer.engine.catalog._deltas import (
    layer_for_dimension,
    layer_label,
    DIMENSION_LAYER,
)
from designer.engine.catalog_loader import load_catalog
from designer.engine.state import TasteState
from designer.engine import decide as decide_mod
from designer.engine import contract as contract_mod


# ---------------------------------------------------------------------------
# 1. layer_for_dimension correctness
# ---------------------------------------------------------------------------

def test_layer_for_dimension_layer1():
    assert layer_for_dimension("platform.target") == 1
    assert layer_for_dimension("nav.layoutModel") == 1


def test_layer_for_dimension_layer2():
    assert layer_for_dimension("color.accent") == 2
    assert layer_for_dimension("typography.headingWeight") == 2
    assert layer_for_dimension("spacing.density") == 2
    assert layer_for_dimension("components.buttonShape") == 2
    assert layer_for_dimension("nav.tabStyle") == 2
    assert layer_for_dimension("typography.numericStyle") == 2


def test_layer_for_dimension_layer3():
    assert layer_for_dimension("color.surface") == 3
    assert layer_for_dimension("elevation.style") == 3
    assert layer_for_dimension("motion.intensity") == 3
    assert layer_for_dimension("motion.transition") == 3
    assert layer_for_dimension("motion.press") == 3
    assert layer_for_dimension("nav.activeStyle") == 3
    assert layer_for_dimension("components.toast") == 3
    assert layer_for_dimension("components.separator") == 3
    assert layer_for_dimension("components.emptyState") == 3


def test_layer_for_dimension_unknown_defaults_to_2():
    """Unmapped dimensions safely default to Layer 2 (Foundations)."""
    assert layer_for_dimension("unknown.dimension") == 2
    assert layer_for_dimension("") == 2
    assert layer_for_dimension("some.future.token") == 2


# ---------------------------------------------------------------------------
# 2. layer_label correctness
# ---------------------------------------------------------------------------

def test_layer_label_maps_correctly():
    assert layer_label(1) == "Scope & Skeleton"
    assert layer_label(2) == "Foundations"
    assert layer_label(3) == "Details"


def test_layer_label_unknown_defaults_to_foundations():
    assert layer_label(0) == "Foundations"
    assert layer_label(99) == "Foundations"
    assert layer_label(-1) == "Foundations"


# ---------------------------------------------------------------------------
# 3. Fresh walk opens on Layer 1, not accent
# ---------------------------------------------------------------------------

def test_fresh_walk_opens_on_layer1_not_accent():
    """A fresh state presents platform-target first, not color-accent-system.

    This is the core assertion: the walk must start with scope/skeleton
    (highest elimination power) before visual foundations.
    """
    cat = load_catalog(strict=False)
    state = TasteState(context={})
    result = decide_mod.present_next(state, cat)

    assert result.action == "ask", f"Expected ask on fresh state, got {result.action}"
    assert result.category is not None

    first_id = result.category.id
    first_dim = result.category.dimension

    assert first_id == "platform-target", (
        f"Fresh walk opened on {first_id!r} (dimension={first_dim!r}); "
        "expected platform-target (Layer 1 Scope & Skeleton). "
        "The walk must surface scope decisions before visual foundations."
    )
    assert first_id != "color-accent-system", (
        "Fresh walk must NOT open on color-accent-system; Layer-1 scope decisions "
        "(platform, nav structure) must come first."
    )
    assert layer_for_dimension(first_dim) == 1, (
        f"First dimension {first_dim!r} should be Layer 1, got {layer_for_dimension(first_dim)}"
    )


# ---------------------------------------------------------------------------
# 4. build_decision_contract: first candidate is Layer 1; each carries layer fields
# ---------------------------------------------------------------------------

def test_contract_first_candidate_is_layer1():
    """build_decision_contract on a fresh state: candidates[0] is Layer 1."""
    cat = load_catalog(strict=False)
    state = TasteState(context={})
    ctr = contract_mod.build_decision_contract(state, cat)

    candidates = ctr["candidates"]
    assert candidates, "expected non-empty candidates"

    first = candidates[0]
    assert first["layer"] == 1, (
        f"First candidate {first['id']!r} has layer={first['layer']}; expected 1 (Scope & Skeleton)"
    )
    assert first["layer_label"] == "Scope & Skeleton", (
        f"First candidate layer_label should be 'Scope & Skeleton', got {first['layer_label']!r}"
    )


def test_contract_layer1_candidates_precede_layer2():
    """Both Layer-1 candidates appear before any Layer-2 (color.accent) candidate."""
    cat = load_catalog(strict=False)
    state = TasteState(context={})
    ctr = contract_mod.build_decision_contract(state, cat)

    candidates = ctr["candidates"]

    # Collect positions of layer-1 and color-accent-system.
    layer1_positions = [i for i, c in enumerate(candidates) if c["layer"] == 1]
    accent_positions = [i for i, c in enumerate(candidates) if c["id"] == "color-accent-system"]

    assert layer1_positions, "Expected Layer-1 candidates in contract"
    assert accent_positions, "Expected color-accent-system in contract"

    max_layer1_pos = max(layer1_positions)
    min_accent_pos = min(accent_positions)
    assert max_layer1_pos < min_accent_pos, (
        f"All Layer-1 candidates (positions {layer1_positions}) must appear before "
        f"color-accent-system (position {min_accent_pos[0] if isinstance(min_accent_pos, list) else min_accent_pos}). "
        f"Got: Layer-1 max pos={max_layer1_pos}, accent pos={min_accent_pos}."
    )


def test_contract_candidates_carry_layer_and_layer_label():
    """Every candidate in the contract carries 'layer' (int) and 'layer_label' (str)."""
    cat = load_catalog(strict=False)
    state = TasteState(context={})
    ctr = contract_mod.build_decision_contract(state, cat)

    for c in ctr["candidates"]:
        assert "layer" in c, f"Candidate {c['id']!r} missing 'layer' field"
        assert "layer_label" in c, f"Candidate {c['id']!r} missing 'layer_label' field"
        assert isinstance(c["layer"], int), f"Candidate {c['id']!r} layer must be int"
        assert c["layer"] in {1, 2, 3}, f"Candidate {c['id']!r} layer must be 1|2|3, got {c['layer']}"
        assert isinstance(c["layer_label"], str) and c["layer_label"], (
            f"Candidate {c['id']!r} layer_label must be non-empty string"
        )


# ---------------------------------------------------------------------------
# 5. After both Layer-1 picks, present_next surfaces Layer 2
# ---------------------------------------------------------------------------

def test_after_layer1_picks_next_is_layer2():
    """Picking both Layer-1 categories causes present_next to surface Layer 2."""
    cat = load_catalog(strict=False)
    state = TasteState(context={})
    by_id = cat.by_id()

    # Apply Layer-1 picks (platform-target and nav-structure).
    pt_cat = by_id["platform-target"]
    ns_cat = by_id["nav-structure"]
    state.apply_pick("platform-target", pt_cat.options[0].id, pt_cat.options[0].token_delta)
    state.apply_pick("nav-structure", ns_cat.options[0].id, ns_cat.options[0].token_delta)

    # Now present_next must be Layer 2.
    result = decide_mod.present_next(state, cat)
    assert result.action == "ask", f"Expected ask after Layer-1 picks, got {result.action}"
    assert result.category is not None
    next_layer = layer_for_dimension(result.category.dimension)
    assert next_layer == 2, (
        f"After Layer-1 picks, next category {result.category.id!r} "
        f"(dimension={result.category.dimension!r}) is Layer {next_layer}; expected Layer 2."
    )


# ---------------------------------------------------------------------------
# 6. Within Layer 2, color-accent-system is still first (tie-break preserved)
# ---------------------------------------------------------------------------

def test_color_accent_is_first_layer2_candidate_after_layer1_done():
    """Once Layer 1 is done, the first Layer-2 category is color-accent-system.

    This confirms the within-layer ordering_tier+information_gain tie-break is
    unchanged — color.accent (ordering_tier=1) still leads Layer 2.
    """
    cat = load_catalog(strict=False)
    state = TasteState(context={})
    by_id = cat.by_id()

    # Exhaust Layer 1.
    pt_cat = by_id["platform-target"]
    ns_cat = by_id["nav-structure"]
    state.apply_pick("platform-target", pt_cat.options[0].id, pt_cat.options[0].token_delta)
    state.apply_pick("nav-structure", ns_cat.options[0].id, ns_cat.options[0].token_delta)

    # The next decision should be color-accent-system (Layer 2, ordering_tier 1).
    result = decide_mod.present_next(state, cat)
    assert result.action == "ask"
    assert result.category is not None
    assert result.category.id == "color-accent-system", (
        f"First Layer-2 category should be color-accent-system, got {result.category.id!r} "
        f"(dimension={result.category.dimension!r}). "
        "Within Layer 2, color.accent (ordering_tier=1) should lead."
    )


# ---------------------------------------------------------------------------
# 7. Full walk layer sequence is non-decreasing (layer is the primary sort key)
# ---------------------------------------------------------------------------

def test_full_walk_layer_sequence_is_nondecreasing():
    """Full present_next walk yields categories in non-decreasing layer order.

    Proves layer is the primary sort: all Layer-1 decisions come before any
    Layer-2, which comes before any Layer-3.
    """
    cat = load_catalog(strict=False)
    state = TasteState(context={})

    layer_sequence = []
    for _ in range(50):
        result = decide_mod.present_next(state, cat)
        if result.action == "done":
            break
        assert result.category is not None
        lyr = layer_for_dimension(result.category.dimension)
        layer_sequence.append((result.category.id, lyr))
        c = result.category
        state.apply_pick(c.id, c.options[0].id, c.options[0].token_delta)

    assert layer_sequence, "Walk produced no decisions"
    layers_only = [lyr for _, lyr in layer_sequence]
    assert layers_only == sorted(layers_only), (
        f"Layer sequence is NOT non-decreasing: {layer_sequence}"
    )
