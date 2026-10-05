"""Tests for the behavior-annotation preview path (behavior_preview.py).

Asserts:
  1. is_behavior classification.
  2. Three sheet-size options produce three DISTINCT, non-empty HTML strings.
  3. Each detent fragment contains its expected numeric label + caption text.
  4. The snap fragment contains @keyframes (animation) AND its dashed
     markers / caption (frame-0 meaning intact).
  5. Integration seam: render_decision_previews_tiered for sheet-size yields 3
     options whose ios previews differ.
  6. A NON-behavior spacing.density category (profile-header) still renders
     low-fi (render_behavior_annotation_by_option returns None for its options).
"""

from __future__ import annotations

import sys
import os

# Ensure the project root is on sys.path so imports resolve.
_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import pytest

from designer.preview.behavior_preview import (
    is_behavior,
    render_behavior_annotation,
    render_behavior_annotation_by_option,
    BEHAVIOR_DIMENSIONS,
    BEHAVIOR_CATEGORY_IDS,
)


# ---------------------------------------------------------------------------
# 1. is_behavior classification
# ---------------------------------------------------------------------------

def test_is_behavior_spacing_density_true():
    """spacing.density is a behavior dimension (sheet-size maps to it)."""
    assert is_behavior("spacing.density") is True


def test_is_behavior_sheet_size_category_true():
    """sheet-size is a behavior category id."""
    assert is_behavior("sheet-size") is True


def test_is_behavior_non_behavior_dim_false():
    """typography.headingWeight is purely visual, not behavior."""
    assert is_behavior("typography.headingWeight") is False


def test_is_behavior_color_accent_false():
    assert is_behavior("color.accent") is False


def test_is_behavior_nav_active_style_false():
    assert is_behavior("nav.activeStyle") is False


def test_behavior_dimensions_contains_motion_dims():
    for dim in ("motion.press", "motion.transition", "motion.intensity"):
        assert dim in BEHAVIOR_DIMENSIONS, f"{dim} should be in BEHAVIOR_DIMENSIONS"


def test_behavior_category_ids_contains_sheet_size():
    assert "sheet-size" in BEHAVIOR_CATEGORY_IDS


# ---------------------------------------------------------------------------
# 2. Three sheet-size options produce three DIFFERENT, non-empty HTML strings
# ---------------------------------------------------------------------------

_DETENT_OPTION_IDS = ["detent-medium-only", "detent-snap-two", "detent-continuous"]


def _get_fragments(tokens=None):
    return [render_behavior_annotation_by_option(oid, tokens) for oid in _DETENT_OPTION_IDS]


def test_sheet_size_fragments_non_empty():
    frags = _get_fragments()
    for oid, frag in zip(_DETENT_OPTION_IDS, frags):
        assert frag is not None, f"{oid} returned None"
        assert len(frag.strip()) > 0, f"{oid} returned empty string"


def test_sheet_size_fragments_are_distinct():
    frags = _get_fragments()
    assert frags[0] != frags[1], "fixed-40 and snap-30-85 are identical"
    assert frags[1] != frags[2], "snap-30-85 and free are identical"
    assert frags[0] != frags[2], "fixed-40 and free are identical"


# ---------------------------------------------------------------------------
# 3. Each fragment contains its expected label and caption text
# ---------------------------------------------------------------------------

def test_fixed_40_contains_numeric_label():
    frag = render_behavior_annotation_by_option("detent-medium-only")
    assert "40%" in frag, "fixed-40 fragment missing '40%' label"


def test_fixed_40_contains_caption():
    frag = render_behavior_annotation_by_option("detent-medium-only")
    assert "Sheet locked" in frag, "fixed-40 fragment missing 'Sheet locked' caption"


def test_snap_30_85_contains_both_numeric_labels():
    frag = render_behavior_annotation_by_option("detent-snap-two")
    assert "30%" in frag, "snap fragment missing '30%' label"
    assert "85%" in frag, "snap fragment missing '85%' label"


def test_snap_30_85_contains_caption():
    frag = render_behavior_annotation_by_option("detent-snap-two")
    assert "Snaps to" in frag, "snap fragment missing 'Snaps to' in caption"


def test_free_contains_caption():
    frag = render_behavior_annotation_by_option("detent-continuous")
    assert "rests wherever" in frag, "free fragment missing 'rests wherever' in caption"


# ---------------------------------------------------------------------------
# 4. Snap fragment contains @keyframes AND dashed markers (frame-0 meaning)
# ---------------------------------------------------------------------------

def test_snap_fragment_contains_keyframes():
    frag = render_behavior_annotation_by_option("detent-snap-two")
    assert "@keyframes" in frag, "snap fragment missing @keyframes animation"


def test_snap_fragment_contains_dashed_border():
    frag = render_behavior_annotation_by_option("detent-snap-two")
    assert "dashed" in frag, "snap fragment missing dashed position markers"


def test_snap_fragment_frame0_meaning_intact():
    """At frame 0 the schematic shows the 30%/85% labels + caption even without
    the animation running — the dashed lines and text carry full meaning."""
    frag = render_behavior_annotation_by_option("detent-snap-two")
    assert "30%" in frag
    assert "85%" in frag
    assert "Snaps to" in frag
    assert "dashed" in frag


# ---------------------------------------------------------------------------
# 5. Integration seam: render_decision_previews_tiered for sheet-size
# ---------------------------------------------------------------------------

def test_tiered_renderer_sheet_size_ios_previews_distinct():
    """render_decision_previews_tiered returns 3 distinct iOS previews for
    the sheet-size category (via the behavior-annotation path in router)."""
    from designer.engine.catalog_loader import load_catalog
    from designer.preview.schematic import render_decision_previews_tiered

    cat = load_catalog().by_id()
    decision = cat["sheet-size"]
    options = decision.options

    assert len(options) == 3, f"Expected 3 sheet-size options, got {len(options)}"

    result = render_decision_previews_tiered(decision, options)

    ios_htmls = [result[opt.id]["ios"]["html"] for opt in options]

    # All must be non-empty.
    for i, html in enumerate(ios_htmls):
        assert html and len(html.strip()) > 0, f"option {i} iOS html is empty"

    # All three must be distinct.
    assert ios_htmls[0] != ios_htmls[1], "options 0 and 1 are identical"
    assert ios_htmls[1] != ios_htmls[2], "options 1 and 2 are identical"
    assert ios_htmls[0] != ios_htmls[2], "options 0 and 2 are identical"


def test_tiered_renderer_sheet_size_returns_behavior_not_lowfi():
    """The router should NOT return low-fi (render_platform_schematic output)
    for sheet-size options; it should return the behavior annotation.  We can
    tell because behavior annotations contain the scoped class wrappers with
    the option id."""
    from designer.engine.catalog_loader import load_catalog
    from designer.preview.schematic import render_decision_previews_tiered

    cat = load_catalog().by_id()
    decision = cat["sheet-size"]
    options = decision.options

    result = render_decision_previews_tiered(decision, options)

    for opt in options:
        ios_html = result[opt.id]["ios"]["html"]
        # Each behavior fragment wraps with the option id in class name.
        assert opt.id in ios_html, (
            f"Expected option id {opt.id!r} in ios html (behavior annotation class), "
            f"got: {ios_html[:200]!r}"
        )


# ---------------------------------------------------------------------------
# 6. Non-behavior spacing.density options return None (low-fi fallback)
# ---------------------------------------------------------------------------

def test_profile_header_options_return_none():
    """profile-header shares spacing.density but its options are NOT registered
    in the behavior path — they must return None so low-fi fires."""
    profile_option_ids = [
        "profile-cover-avatar",
        "profile-centered-avatar",
        "profile-compact-card",
        "profile-gradient-bg",
    ]
    for oid in profile_option_ids:
        result = render_behavior_annotation_by_option(oid)
        assert result is None, (
            f"render_behavior_annotation_by_option({oid!r}) should return None "
            f"(non-behavior option), got: {result!r}"
        )


def test_onboard_structure_options_return_none():
    """onboard-structure also shares spacing.density; its options must return None."""
    onboard_option_ids = [
        "onboard-value-first",
        "onboard-progressive-steps",
        "onboard-interactive-tutorial",
        "onboard-personalization-quiz",
    ]
    for oid in onboard_option_ids:
        result = render_behavior_annotation_by_option(oid)
        assert result is None, (
            f"render_behavior_annotation_by_option({oid!r}) should return None, "
            f"got: {result!r}"
        )


def test_render_behavior_annotation_wrong_category_returns_none():
    """render_behavior_annotation with a mismatched category/option returns None."""
    # detent-medium-only belongs to sheet-size, not profile-header
    result = render_behavior_annotation("profile-header", "detent-medium-only")
    assert result is None, (
        "render_behavior_annotation should return None for mismatched category"
    )


def test_render_behavior_annotation_correct_category_returns_html():
    """render_behavior_annotation with correct category+option returns HTML."""
    result = render_behavior_annotation("sheet-size", "detent-medium-only")
    assert result is not None
    assert "40%" in result


# ---------------------------------------------------------------------------
# stdlib runner (for direct invocation)
# ---------------------------------------------------------------------------

def _run() -> int:
    import traceback
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
            traceback.print_exc()
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    return failed


if __name__ == "__main__":
    sys.exit(_run())
