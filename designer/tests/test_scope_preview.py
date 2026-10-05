"""Tests for Layer-1 scope preview schematics and platform-column scoping.

Covers:
  1. render_platform_scope — 4 distinct schematics, None for bogus, labels present.
  2. render_nav_scope — 4 distinct schematics, None for bogus, pairwise inequality.
  3. render_decision_previews_tiered on platform-target — scope schematic, not generic.
  4. Platform-column scoping — ios base -> only "ios" key; multi/unset -> all three.
  5. Backward-compat — base={} always yields three platform keys.

Pure stdlib + pytest. No network, no vendor SDK.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import pytest

from designer.engine.catalog_loader import load_catalog
from designer.engine.resolver import resolve
from designer.preview.scope_preview import render_platform_scope, render_nav_scope
from designer.preview.schematic import (
    render_decision_previews_tiered,
    scoped_platforms,
)

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

_DEFAULT_TOKENS = resolve("web")

PLATFORM_OPTION_IDS = [
    "platform-web",
    "platform-ios",
    "platform-macos",
    "platform-multi",
]

NAV_OPTION_IDS = [
    "nav-structure-left",
    "nav-structure-top",
    "nav-structure-tabbar",
    "nav-structure-none",
]


# ---------------------------------------------------------------------------
# 1. render_platform_scope
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("option_id", PLATFORM_OPTION_IDS)
def test_platform_scope_returns_non_empty_html(option_id: str):
    html = render_platform_scope(option_id, _DEFAULT_TOKENS)
    assert isinstance(html, str), f"{option_id}: expected str, got {type(html)}"
    assert len(html) > 50, f"{option_id}: html too short ({len(html)} chars)"


def test_platform_scope_bogus_returns_none():
    result = render_platform_scope("bogus-option", _DEFAULT_TOKENS)
    assert result is None, f"Expected None for unrecognized id, got {result!r:.40}"


def test_platform_scope_web_contains_web_label():
    html = render_platform_scope("platform-web", _DEFAULT_TOKENS)
    assert "Web" in html, "platform-web schematic must contain the label 'Web'"


def test_platform_scope_ios_contains_ios_label():
    html = render_platform_scope("platform-ios", _DEFAULT_TOKENS)
    assert "iOS" in html, "platform-ios schematic must contain the label 'iOS'"


def test_platform_scope_macos_contains_macos_label():
    html = render_platform_scope("platform-macos", _DEFAULT_TOKENS)
    assert "macOS" in html, "platform-macos schematic must contain the label 'macOS'"


def test_platform_scope_multi_contains_all_label():
    html = render_platform_scope("platform-multi", _DEFAULT_TOKENS)
    assert "All" in html, "platform-multi schematic must contain 'All'"


def test_platform_scope_all_distinct():
    """All four platform schematics must be visually distinct HTML."""
    htmls = [render_platform_scope(oid, _DEFAULT_TOKENS) for oid in PLATFORM_OPTION_IDS]
    for i, h_a in enumerate(htmls):
        for j, h_b in enumerate(htmls):
            if i != j:
                assert h_a != h_b, (
                    f"platform scope schematics {PLATFORM_OPTION_IDS[i]!r} and "
                    f"{PLATFORM_OPTION_IDS[j]!r} produced identical HTML"
                )


def test_platform_scope_uses_accent_token():
    """Scope schematic must embed the live accent token."""
    tokens = resolve("web", {"color": {"accent": "#FF2D55"}})
    html = render_platform_scope("platform-web", tokens)
    assert "#FF2D55" in html, "accent token not reflected in platform-web scope schematic"


# ---------------------------------------------------------------------------
# 2. render_nav_scope
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("option_id", NAV_OPTION_IDS)
def test_nav_scope_returns_non_empty_html(option_id: str):
    html = render_nav_scope(option_id, _DEFAULT_TOKENS)
    assert isinstance(html, str), f"{option_id}: expected str, got {type(html)}"
    assert len(html) > 50, f"{option_id}: html too short ({len(html)} chars)"


def test_nav_scope_bogus_returns_none():
    result = render_nav_scope("bogus-nav", _DEFAULT_TOKENS)
    assert result is None, f"Expected None for unrecognized id, got {result!r:.40}"


def test_nav_scope_left_contains_label():
    html = render_nav_scope("nav-structure-left", _DEFAULT_TOKENS)
    assert "Left" in html, "nav-structure-left schematic must mention 'Left'"


def test_nav_scope_top_contains_label():
    html = render_nav_scope("nav-structure-top", _DEFAULT_TOKENS)
    assert "Top" in html, "nav-structure-top schematic must mention 'Top'"


def test_nav_scope_tabbar_contains_label():
    html = render_nav_scope("nav-structure-tabbar", _DEFAULT_TOKENS)
    assert "Tab" in html, "nav-structure-tabbar schematic must mention 'Tab'"


def test_nav_scope_none_contains_label():
    html = render_nav_scope("nav-structure-none", _DEFAULT_TOKENS)
    assert "No" in html or "None" in html or "none" in html.lower(), (
        "nav-structure-none schematic must contain a 'No Nav' or equivalent label"
    )


def test_nav_scope_all_pairwise_distinct():
    """All four nav-scope schematics must be distinct from each other."""
    htmls = {oid: render_nav_scope(oid, _DEFAULT_TOKENS) for oid in NAV_OPTION_IDS}
    ids = list(htmls.keys())
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            assert htmls[ids[i]] != htmls[ids[j]], (
                f"nav scope schematics {ids[i]!r} and {ids[j]!r} produced identical HTML"
            )


# ---------------------------------------------------------------------------
# 3. render_decision_previews_tiered on platform-target category
# ---------------------------------------------------------------------------

def test_platform_target_previews_use_scope_schematic():
    """render_decision_previews_tiered on platform-target must produce scope
    schematics (containing the label words) not the generic card schematic."""
    cat = load_catalog()
    platform_cat = cat.by_id()["platform-target"]
    result = render_decision_previews_tiered(platform_cat, platform_cat.options, {})

    label_map = {
        "platform-web":    "Web",
        "platform-ios":    "iOS",
        "platform-macos":  "macOS",
        "platform-multi":  "All",
    }
    for opt in platform_cat.options:
        assert opt.id in result, f"option {opt.id!r} missing from result"
        platform_cells = result[opt.id]
        # At least one platform column must exist
        assert platform_cells, f"option {opt.id!r} has no platform cells"
        expected_label = label_map[opt.id]
        for p, cell in platform_cells.items():
            html = cell["html"]
            assert expected_label in html, (
                f"option {opt.id!r} platform {p!r}: expected label {expected_label!r} "
                f"in scope schematic, but not found. Got: {html[:120]!r}"
            )
            assert cell["tier"] == "low", (
                f"option {opt.id!r} platform {p!r}: scope schematic should have tier 'low', "
                f"got {cell['tier']!r}"
            )


def test_nav_structure_previews_use_scope_schematic():
    """render_decision_previews_tiered on nav-structure must produce nav-scope
    schematics not the generic card schematic."""
    cat = load_catalog()
    nav_cat = cat.by_id()["nav-structure"]
    result = render_decision_previews_tiered(nav_cat, nav_cat.options, {})

    label_map = {
        "nav-structure-left":    "Left",
        "nav-structure-top":     "Top",
        "nav-structure-tabbar":  "Tab",
        "nav-structure-none":    "No",
    }
    for opt in nav_cat.options:
        assert opt.id in result, f"option {opt.id!r} missing from result"
        platform_cells = result[opt.id]
        assert platform_cells, f"option {opt.id!r} has no platform cells"
        expected_label = label_map[opt.id]
        for p, cell in platform_cells.items():
            html = cell["html"]
            assert expected_label in html or "none" in html.lower(), (
                f"option {opt.id!r} platform {p!r}: expected label {expected_label!r} "
                f"in nav-scope schematic. Got: {html[:120]!r}"
            )


# ---------------------------------------------------------------------------
# 4. Platform-column scoping
# ---------------------------------------------------------------------------

def test_scoped_platforms_ios_returns_only_ios():
    cols = scoped_platforms({"platform": {"target": "ios"}})
    assert cols == ["ios"], f"Expected ['ios'], got {cols!r}"


def test_scoped_platforms_web_returns_only_web():
    cols = scoped_platforms({"platform": {"target": "web"}})
    assert cols == ["web"], f"Expected ['web'], got {cols!r}"


def test_scoped_platforms_macos_returns_only_macos():
    cols = scoped_platforms({"platform": {"target": "macos"}})
    assert cols == ["macos"], f"Expected ['macos'], got {cols!r}"


def test_scoped_platforms_multi_returns_all_three():
    cols = scoped_platforms({"platform": {"target": "multi"}})
    assert set(cols) == {"web", "ios", "macos"}, f"Expected all 3, got {cols!r}"


def test_scoped_platforms_unset_returns_all_three():
    cols = scoped_platforms({})
    assert set(cols) == {"web", "ios", "macos"}, f"Expected all 3, got {cols!r}"


def test_scoped_platforms_none_value_returns_all_three():
    cols = scoped_platforms({"platform": {"target": None}})
    assert set(cols) == {"web", "ios", "macos"}, f"Expected all 3 for None target, got {cols!r}"


def test_render_tiered_ios_base_returns_only_ios_column():
    """When base overrides have platform.target = 'ios', downstream category
    previews must contain ONLY the 'ios' platform key per option."""
    cat = load_catalog()
    color_accent = cat.by_id()["color-accent-system"]
    base = {"platform": {"target": "ios"}}
    result = render_decision_previews_tiered(color_accent, color_accent.options, base)
    for opt_id, platform_cells in result.items():
        assert set(platform_cells.keys()) == {"ios"}, (
            f"With platform.target=ios, option {opt_id!r} should have only 'ios' column; "
            f"got {set(platform_cells.keys())!r}"
        )


def test_render_tiered_multi_base_returns_all_three_columns():
    """When base overrides have platform.target = 'multi', all three columns render."""
    cat = load_catalog()
    color_accent = cat.by_id()["color-accent-system"]
    base = {"platform": {"target": "multi"}}
    result = render_decision_previews_tiered(color_accent, color_accent.options, base)
    for opt_id, platform_cells in result.items():
        assert set(platform_cells.keys()) == {"web", "ios", "macos"}, (
            f"With platform.target=multi, option {opt_id!r} should have all 3 columns; "
            f"got {set(platform_cells.keys())!r}"
        )


# ---------------------------------------------------------------------------
# 5. Backward-compat: base={} always yields three platform keys
# ---------------------------------------------------------------------------

def test_backward_compat_no_base_yields_three_columns():
    """render_decision_previews_tiered with base={} (no platform.target) must
    return exactly the same three platform keys as before for all options."""
    cat = load_catalog()
    color_accent = cat.by_id()["color-accent-system"]
    result = render_decision_previews_tiered(color_accent, color_accent.options, {})
    assert len(result) == len(color_accent.options), "Unexpected number of option entries"
    for opt_id, platform_cells in result.items():
        assert set(platform_cells.keys()) == {"web", "ios", "macos"}, (
            f"Backward-compat: option {opt_id!r} with base={{}} should have "
            f"web+ios+macos; got {set(platform_cells.keys())!r}"
        )


def test_backward_compat_none_base_yields_three_columns():
    """render_decision_previews_tiered with base=None must also yield three columns."""
    cat = load_catalog()
    nav_active = cat.by_id()["nav-active-state"]
    result = render_decision_previews_tiered(nav_active, nav_active.options, None)
    for opt_id, platform_cells in result.items():
        assert set(platform_cells.keys()) == {"web", "ios", "macos"}, (
            f"Backward-compat: option {opt_id!r} with base=None should have "
            f"web+ios+macos; got {set(platform_cells.keys())!r}"
        )
