"""Tests for designer/preview/focus_spec.py — FOCUS-SPEC engine.

Assertions:
  1. color.accent uses opacity_only (no "grayscale" in its CSS).
  2. spacing.density uses opacity_and_grayscale (contains "grayscale").
  3. target_ring_style("#0A84FF") contains "#0A84FF33", "outline",
     "outline-offset", and does NOT contain "border:".
  4. No "blur" substring appears in any style string the module can produce
     (scan non_target_style for every FOCUS_SPECS dim + target_ring_style).
  5. focus_for on an unknown dim returns the _default entry (never raises).
  6. Every catalog dimension resolves to SOME entry via focus_for (no crash).

Pure stdlib. No deps, no network, no vendor SDK.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from designer.engine.catalog_loader import load_catalog
from designer.preview.focus_spec import (
    FOCUS_SPECS,
    REGION_NAMES,
    focus_for,
    is_target_region,
    non_target_style,
    target_ring_style,
)


# ---------------------------------------------------------------------------
# 1. color.accent uses opacity_only — no grayscale in its CSS
# ---------------------------------------------------------------------------

def test_color_accent_opacity_only_no_grayscale():
    style = non_target_style("color.accent")
    assert "opacity" in style, "expected 'opacity' in color.accent style"
    assert "grayscale" not in style, (
        f"color.accent must NOT use grayscale (hides accent token); got: {style!r}"
    )


def test_color_accent_focus_spec_is_opacity_only():
    spec = focus_for("color.accent")
    assert spec["non_target_treatment"] == "opacity_only", (
        f"color.accent focus spec must be opacity_only, got {spec['non_target_treatment']!r}"
    )


# ---------------------------------------------------------------------------
# 2. Non-color dim (spacing.density) uses opacity_and_grayscale
# ---------------------------------------------------------------------------

def test_spacing_density_opacity_and_grayscale():
    style = non_target_style("spacing.density")
    assert "grayscale" in style, (
        f"spacing.density must use grayscale de-emphasis; got: {style!r}"
    )
    assert "opacity" in style, "expected 'opacity' in spacing.density style"


def test_spacing_density_focus_spec_is_opacity_and_grayscale():
    spec = focus_for("spacing.density")
    assert spec["non_target_treatment"] == "opacity_and_grayscale", (
        f"spacing.density focus spec must be opacity_and_grayscale, got {spec['non_target_treatment']!r}"
    )


# ---------------------------------------------------------------------------
# 3. target_ring_style content requirements
# ---------------------------------------------------------------------------

def test_target_ring_contains_accent_with_alpha():
    style = target_ring_style("#0A84FF")
    assert "#0A84FF33" in style, (
        f"ring style must contain '#0A84FF33'; got: {style!r}"
    )


def test_target_ring_contains_outline():
    style = target_ring_style("#0A84FF")
    assert "outline" in style, f"ring style must contain 'outline'; got: {style!r}"


def test_target_ring_contains_outline_offset():
    style = target_ring_style("#0A84FF")
    assert "outline-offset" in style, (
        f"ring style must contain 'outline-offset'; got: {style!r}"
    )


def test_target_ring_no_border_shorthand():
    style = target_ring_style("#0A84FF")
    # "border:" (shorthand) must not appear — only OUTLINE avoids layout shift.
    # "border-radius" is allowed (it's in the spec).
    # Check for "border:" specifically (not "border-radius").
    border_shorthand = style.replace("border-radius", "")
    assert "border:" not in border_shorthand, (
        f"ring style must use outline not border shorthand; got: {style!r}"
    )


# ---------------------------------------------------------------------------
# 4. No "blur" in any style string the module can produce
# ---------------------------------------------------------------------------

def test_no_blur_in_non_target_styles():
    for dim in FOCUS_SPECS:
        style = non_target_style(dim)
        assert "blur" not in style, (
            f"'blur' found in non_target_style({dim!r}): {style!r}"
        )


def test_no_blur_in_target_ring_style():
    style = target_ring_style("#0A84FF")
    assert "blur" not in style, f"'blur' found in target_ring_style: {style!r}"


# ---------------------------------------------------------------------------
# 5. focus_for on unknown dim returns _default, never raises
# ---------------------------------------------------------------------------

def test_focus_for_unknown_returns_default():
    result = focus_for("totally.unknown.dimension")
    default = FOCUS_SPECS["_default"]
    assert result == default, (
        f"focus_for(unknown) should return _default; got {result!r}"
    )


def test_focus_for_never_raises():
    # A variety of invalid / edge-case keys must not raise
    for key in ("", ".", "x.y.z.w", "COLOR.ACCENT", "1234", " "):
        try:
            result = focus_for(key)
            assert result is not None
        except Exception as exc:  # noqa: BLE001
            raise AssertionError(f"focus_for({key!r}) raised {type(exc).__name__}: {exc}") from exc


# ---------------------------------------------------------------------------
# 6. Every catalog dimension resolves without crash
# ---------------------------------------------------------------------------

def test_all_catalog_dimensions_resolve():
    catalog = load_catalog()
    dims = {c.dimension for c in catalog.categories}
    for dim in dims:
        try:
            result = focus_for(dim)
            assert result is not None, f"focus_for({dim!r}) returned None"
            # Must have the required keys
            assert "target_regions" in result
            assert "non_target_treatment" in result
            assert "target_ring" in result
        except AssertionError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise AssertionError(
                f"focus_for({dim!r}) raised {type(exc).__name__}: {exc}"
            ) from exc


def test_all_catalog_category_ids_resolve():
    catalog = load_catalog()
    for cat in catalog.categories:
        result = focus_for(cat.id)
        assert result is not None
        assert "target_regions" in result


# ---------------------------------------------------------------------------
# Bonus: REGION_NAMES is a frozenset and is_target_region works
# ---------------------------------------------------------------------------

def test_region_names_is_frozenset():
    assert isinstance(REGION_NAMES, frozenset)
    assert len(REGION_NAMES) > 0


def test_is_target_region_true():
    focus = focus_for("color.accent")
    assert is_target_region("cta_button", focus) is True


def test_is_target_region_false():
    focus = focus_for("color.accent")
    assert is_target_region("toast_band", focus) is False


def test_is_target_region_on_default():
    focus = focus_for("_default")
    # default has no target regions
    assert is_target_region("cta_button", focus) is False


# ---------------------------------------------------------------------------
# stdlib runner
# ---------------------------------------------------------------------------

def _run() -> int:
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
