"""Chunk 4 tests — low-fi schematic preview engine.

Tests:
  1. Each platform renders a non-empty HTML string.
  2. Token-driven: accent override appears literally in the HTML.
  3. Different accents produce different HTML.
  4. render_all_platforms returns keys {"web","ios","macos"}, each non-empty.
  5. render_decision_previews returns one entry per option, each with 3 platforms;
     accent-expressive option's HTML differs from accent-cta-only's.
  6. Fidelity rule: color/elevation/motion -> high; nav/spacing/typography -> low.

Run: python3 designer/tests/test_chunk4_preview.py
Or:  python3 -m pytest designer/tests/test_chunk4_preview.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from designer.engine.catalog_loader import load_catalog
from designer.engine.resolver import resolve
from designer.preview.fidelity_rule import fidelity_for, needs_high_fidelity
from designer.preview.schematic import (
    render_all_platforms,
    render_decision_previews,
    render_platform_schematic,
)


# ---------------------------------------------------------------------------
# 1. Each platform renders a non-empty HTML string
# ---------------------------------------------------------------------------

def test_web_renders():
    tokens = resolve("web")
    html = render_platform_schematic("web", tokens)
    assert isinstance(html, str) and len(html) > 100, \
        f"expected non-empty HTML, got {html!r:.80}"


def test_ios_renders():
    tokens = resolve("ios")
    html = render_platform_schematic("ios", tokens)
    assert isinstance(html, str) and len(html) > 100


def test_macos_renders():
    tokens = resolve("macos")
    html = render_platform_schematic("macos", tokens)
    assert isinstance(html, str) and len(html) > 100


# ---------------------------------------------------------------------------
# 2. Token-driven: accent override appears in the HTML
# ---------------------------------------------------------------------------

def test_accent_appears_in_html():
    overrides = {"color": {"accent": "#FF2D55"}}
    for platform in ("web", "ios", "macos"):
        tokens = resolve(platform, overrides)
        html = render_platform_schematic(platform, tokens)
        assert "#FF2D55" in html, \
            f"accent #FF2D55 not found in {platform} HTML"


# ---------------------------------------------------------------------------
# 3. Different accents produce different HTML
# ---------------------------------------------------------------------------

def test_different_accents_produce_different_html():
    ov_a = {"color": {"accent": "#FF2D55"}}
    ov_b = {"color": {"accent": "#34C759"}}
    for platform in ("web", "ios", "macos"):
        html_a = render_platform_schematic(platform, resolve(platform, ov_a))
        html_b = render_platform_schematic(platform, resolve(platform, ov_b))
        assert html_a != html_b, \
            f"{platform}: different accents produced identical HTML"


# ---------------------------------------------------------------------------
# 4. render_all_platforms returns {"web","ios","macos"}, each non-empty
# ---------------------------------------------------------------------------

def test_render_all_platforms_keys():
    result = render_all_platforms({})
    assert set(result.keys()) == {"web", "ios", "macos"}
    for p, html in result.items():
        assert isinstance(html, str) and len(html) > 50, \
            f"platform {p!r} returned empty/short HTML"


def test_render_all_platforms_reflects_override():
    result = render_all_platforms({"color": {"accent": "#5E5CE6"}})
    for p, html in result.items():
        assert "#5E5CE6" in html, f"{p}: accent token not in output"


# ---------------------------------------------------------------------------
# 5. render_decision_previews
# ---------------------------------------------------------------------------

def test_decision_previews_all_options_all_platforms():
    catalog = load_catalog()
    color_accent = catalog.by_id()["color-accent-system"]
    previews = render_decision_previews(color_accent, color_accent.options, {})
    # one entry per option
    assert len(previews) == len(color_accent.options), \
        f"expected {len(color_accent.options)} entries, got {len(previews)}"
    # each entry has all 3 platforms, each non-empty
    for opt_id, plat_map in previews.items():
        assert set(plat_map.keys()) == {"web", "ios", "macos"}, \
            f"option {opt_id!r} missing platforms: {set(plat_map.keys())}"
        for p, html in plat_map.items():
            assert html, f"option {opt_id!r} platform {p!r} returned empty HTML"


def test_decision_previews_expressive_differs_from_cta_only():
    catalog = load_catalog()
    color_accent = catalog.by_id()["color-accent-system"]
    previews = render_decision_previews(color_accent, color_accent.options, {})
    # accent-expressive uses a different accent (#5E5CE6) vs accent-cta-only (#0A84FF)
    for p in ("web", "ios", "macos"):
        html_expressive = previews["accent-expressive"][p]
        html_cta_only = previews["accent-cta-only"][p]
        assert html_expressive != html_cta_only, \
            f"{p}: expressive vs cta-only produced identical HTML"


# ---------------------------------------------------------------------------
# 6. Fidelity rule
# ---------------------------------------------------------------------------

def test_high_fi_dimensions():
    high_fi_dims = [
        "color.accent", "color.surface", "color.bg",
        "elevation.style", "elevation.depth",
        "motion.intensity", "motion.transition", "motion.press",
    ]
    for dim in high_fi_dims:
        assert needs_high_fidelity(dim), f"expected high-fi for {dim!r}"
        assert fidelity_for(dim) == "high", f"fidelity_for({dim!r}) should be 'high'"


def test_low_fi_dimensions():
    low_fi_dims = [
        "nav.activeStyle", "nav.tabStyle",
        "spacing.density", "spacing.grid",
        "typography.headingWeight", "typography.fontFamily",
        "radius.button", "radius.card",
        "components.buttonShape", "components.separator",
        "components.emptyState", "components.toast",
    ]
    for dim in low_fi_dims:
        assert not needs_high_fidelity(dim), f"expected low-fi for {dim!r}"
        assert fidelity_for(dim) == "low", f"fidelity_for({dim!r}) should be 'low'"


def test_fidelity_group_shorthand():
    # short group names (without .key suffix) also route correctly
    assert needs_high_fidelity("color") is True
    assert needs_high_fidelity("elevation") is True
    assert needs_high_fidelity("motion") is True
    assert needs_high_fidelity("nav") is False
    assert needs_high_fidelity("spacing") is False
    assert needs_high_fidelity("typography") is False


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
