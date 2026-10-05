"""Focus-wiring tests — apply_focus + data-focus-region + render_decision_previews_tiered.

Tests:
  1. render_platform_schematic with no focus kwarg == current output (byte-identical).
  2. _render_web emits data-focus-region attributes for nav_bar, cta_button, etc.
  3. apply_focus on a low-fi fragment with focus on color.accent injects a <style>
     with the target ring and opacity:1 rule for accent target regions, and a base dim rule.
  4. apply_focus on a string with NO data-focus-region (simulated high-fi) returns unchanged.
  5. render_decision_previews_tiered with enable_focus=True de-emphasizes non-target regions
     in LOW-FI platform cells (nav-tabbar is a low-fi dimension — uses low-fi schematic).
  6. BACKWARD COMPAT: render_decision_previews_tiered with default args == current behavior
     (no focus wrapping / no focus-wrap class in output).

Run: python3 designer/tests/test_focus_wiring.py
Or:  python3 -m pytest designer/tests/test_focus_wiring.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from designer.engine.catalog_loader import load_catalog
from designer.engine.resolver import resolve
from designer.preview.schematic import (
    apply_focus,
    render_decision_previews_tiered,
    render_platform_schematic,
)
from designer.preview.schematic import _render_web  # noqa: F401 (internal, for attr test)


# ---------------------------------------------------------------------------
# 1. render_platform_schematic with no focus kwarg is byte-identical on repeat
# ---------------------------------------------------------------------------

def test_render_platform_schematic_no_focus_is_stable():
    """Calling render_platform_schematic without focus kwarg must produce the same
    output on repeated calls — proving the default path is stateless and unchanged."""
    tokens = resolve("web")
    html_a = render_platform_schematic("web", tokens)
    html_b = render_platform_schematic("web", tokens)
    assert html_a == html_b, "Same inputs should produce identical output (no focus)"


def test_render_platform_schematic_focus_none_equals_no_kwarg():
    """Explicit focus=None must produce byte-identical output to omitting the kwarg."""
    tokens = resolve("web")
    html_default = render_platform_schematic("web", tokens)
    html_focus_none = render_platform_schematic("web", tokens, focus=None)
    assert html_default == html_focus_none, "focus=None must be byte-identical to no kwarg"


def test_render_platform_schematic_positional_still_works():
    """test_chunk4 calls render_platform_schematic('web', tokens) positionally.
    Confirm the positional call still works with the new signature."""
    tokens = resolve("web")
    html = render_platform_schematic("web", tokens)
    assert isinstance(html, str) and len(html) > 100


# ---------------------------------------------------------------------------
# 2. _render_web emits data-focus-region attributes
# ---------------------------------------------------------------------------

def test_render_web_emits_nav_bar_region():
    tokens = resolve("web")
    html = render_platform_schematic("web", tokens)
    assert 'data-focus-region="nav_bar"' in html, \
        "web schematic must emit data-focus-region='nav_bar' on the nav wrapper"


def test_render_web_emits_cta_button_region():
    tokens = resolve("web")
    html = render_platform_schematic("web", tokens)
    assert "cta_button" in html, \
        "web schematic must emit a cta_button region marker"


def test_render_web_emits_toast_band_region():
    tokens = resolve("web")
    html = render_platform_schematic("web", tokens)
    assert 'data-focus-region="toast_band"' in html


def test_render_web_emits_list_rows_region():
    tokens = resolve("web")
    html = render_platform_schematic("web", tokens)
    assert 'data-focus-region="list_rows"' in html


def test_render_web_emits_sheet_element_region():
    tokens = resolve("web")
    html = render_platform_schematic("web", tokens)
    assert "sheet_element" in html


def test_render_ios_emits_nav_bar_region():
    tokens = resolve("ios")
    html = render_platform_schematic("ios", tokens)
    assert 'data-focus-region="nav_bar"' in html


def test_render_macos_emits_nav_bar_region():
    tokens = resolve("macos")
    html = render_platform_schematic("macos", tokens)
    assert 'data-focus-region="nav_bar"' in html


# ---------------------------------------------------------------------------
# 3. apply_focus on a low-fi fragment injects correct CSS
# ---------------------------------------------------------------------------

def test_apply_focus_injects_style_block():
    """apply_focus on an instrumented fragment must inject a <style> block."""
    html = '<div data-focus-region="cta_button">Click me</div>'
    result = apply_focus(html, "color.accent", "#0A84FF")
    assert "<style>" in result, "apply_focus must inject a <style> block"


def test_apply_focus_injects_focus_wrap_class():
    html = '<div data-focus-region="cta_button">Click me</div>'
    result = apply_focus(html, "color.accent", "#0A84FF")
    assert 'class="focus-wrap"' in result


def test_apply_focus_injects_scrim_veil():
    """The de-emphasis is a SCRIM (.focus-ground::after veil), not ancestor opacity
    (which would compound onto the target). The veil mutes the chrome."""
    html = '<div data-focus-region="cta_button">Click me</div>'
    result = apply_focus(html, "color.accent", "#0A84FF")
    assert ".focus-ground::after" in result, "scrim veil rule must be present"
    assert "rgba(255,255,255,0.62)" in result, "scrim veil background must be present"
    # color.* dims must NOT desaturate (would hide the accent being decided)
    assert "grayscale" not in result, "color.* dims must NOT desaturate the scrim"
    # the injected <style> must stay hidden — never rendered as visible text
    assert "style{display:none !important;}" in result


def test_apply_focus_lifts_target_above_scrim_for_cta_button():
    """cta_button is a target for color.accent — it must be lifted above the veil
    (z-index) with the ring, so it pops without un-dimming any opacity."""
    html = '<div data-focus-region="cta_button">CTA</div>'
    result = apply_focus(html, "color.accent", "#0A84FF")
    assert 'data-focus-region~="cta_button"' in result, \
        "apply_focus must emit a rule targeting data-focus-region~='cta_button'"
    assert "z-index:2" in result, "target must be lifted above the scrim via z-index"
    assert "outline:2px solid #0A84FF33;" in result, "target must carry the accent ring"


def test_apply_focus_injects_target_un_dim_rule_for_nav_active():
    """nav_active is a target for color.accent — must appear in the injected rules."""
    html = '<div data-focus-region="nav_active">Nav</div>'
    result = apply_focus(html, "color.accent", "#0A84FF")
    assert 'data-focus-region~="nav_active"' in result


def test_apply_focus_injects_ring_style():
    """The target rule must include the outline ring from target_ring_style."""
    html = '<div data-focus-region="cta_button">CTA</div>'
    result = apply_focus(html, "color.accent", "#0A84FF")
    # target_ring_style("#0A84FF") produces "outline:2px solid #0A84FF33;..."
    assert "outline:2px solid #0A84FF33;" in result


def test_apply_focus_grayscale_for_non_color_dim():
    """Non-color dims (e.g. nav.tabStyle) must include grayscale in the base dim rule."""
    html = '<div data-focus-region="nav_bar">Nav</div>'
    result = apply_focus(html, "nav.tabStyle", "#0A84FF")
    assert "grayscale" in result, "non-color dim must include grayscale in base dim rule"


def test_apply_focus_nav_tabstyle_targets_nav_bar():
    """nav.tabStyle targets nav_bar — must lift that region above the scrim."""
    html = '<div data-focus-region="nav_bar">Nav</div>'
    result = apply_focus(html, "nav.tabStyle", "#0A84FF")
    assert 'data-focus-region~="nav_bar"' in result
    assert "z-index:2" in result


# ---------------------------------------------------------------------------
# 4. apply_focus on fragment with NO data-focus-region returns it unchanged
# ---------------------------------------------------------------------------

def test_apply_focus_no_markers_returns_unchanged():
    """High-fi fragments have no data-focus-region markers — apply_focus must be a no-op."""
    fragment = '<div class="hf-web-accent-expressive"><p>High-fi art</p></div>'
    result = apply_focus(fragment, "color.accent", "#0A84FF")
    assert result == fragment, \
        "apply_focus must return the original html unchanged when no data-focus-region present"


def test_apply_focus_no_markers_empty_string_unchanged():
    result = apply_focus("", "color.accent", "#0A84FF")
    assert result == ""


def test_apply_focus_default_dimension_empty_targets_is_noop():
    """Dimensions that map to _default (empty target_regions) must be a no-op,
    even when the fragment has data-focus-region attributes."""
    # Use an unmapped dimension — focus_for returns _default with empty targets
    html = '<div data-focus-region="nav_bar">something</div>'
    result = apply_focus(html, "unknown.dimension", "#0A84FF")
    assert result == html, \
        "apply_focus must return unchanged html when focus target_regions is empty"


def test_apply_focus_typography_dim_is_noop():
    """typography.headingWeight maps to empty target_regions -> no-op."""
    html = '<div data-focus-region="sheet_element">Text</div>'
    result = apply_focus(html, "typography.headingWeight", "#0A84FF")
    assert result == html


# ---------------------------------------------------------------------------
# 5. render_decision_previews_tiered with enable_focus=True wraps low-fi cells
# ---------------------------------------------------------------------------

def test_tiered_focus_enabled_wraps_low_fi_nav():
    """nav.tabStyle is a low-fi dimension; low-fi cells must get focus-wrap with
    data-focus-region markers un-dimming nav_bar."""
    catalog = load_catalog()
    nav_cat = catalog.by_id()["nav-tabbar"]
    tiered = render_decision_previews_tiered(nav_cat, nav_cat.options, {}, enable_focus=True)

    for opt_id, cells in tiered.items():
        for p, cell in cells.items():
            assert cell["tier"] == "low", f"{opt_id}/{p}: nav-tabbar must be low-fi"
            html = cell["html"]
            # The fragment must be wrapped (low-fi has data-focus-region markers)
            assert 'class="focus-wrap"' in html, \
                f"{opt_id}/{p}: expected focus-wrap wrapper in low-fi cell"
            # nav_bar is the target for nav.tabStyle -> lifted above the scrim
            assert 'data-focus-region~="nav_bar"' in html, \
                f"{opt_id}/{p}: expected nav_bar target rule"
            assert "z-index:2" in html


def test_tiered_focus_enabled_wraps_low_fi_separator():
    """components.separator targets list_rows — focus wrapper must ring list_rows."""
    catalog = load_catalog()
    sep_cat = catalog.by_id()["list-separator"]
    tiered = render_decision_previews_tiered(sep_cat, sep_cat.options, {}, enable_focus=True)

    for opt_id, cells in tiered.items():
        for p, cell in cells.items():
            assert cell["tier"] == "low"
            assert 'class="focus-wrap"' in cell["html"]
            assert 'data-focus-region~="list_rows"' in cell["html"]


# ---------------------------------------------------------------------------
# 6. BACKWARD COMPAT: default args == no focus wrapping
# ---------------------------------------------------------------------------

def test_tiered_default_no_focus_wrap():
    """render_decision_previews_tiered with default enable_focus=False must NOT
    produce any focus-wrap wrappers — byte-identical to pre-focus behavior."""
    catalog = load_catalog()
    nav_cat = catalog.by_id()["nav-tabbar"]
    tiered = render_decision_previews_tiered(nav_cat, nav_cat.options, {})

    for opt_id, cells in tiered.items():
        for p, cell in cells.items():
            assert 'class="focus-wrap"' not in cell["html"], \
                f"{opt_id}/{p}: focus-wrap must NOT appear with default enable_focus=False"


def test_tiered_default_produces_same_html_as_explicit_false():
    """Explicit enable_focus=False must be byte-identical to the default."""
    catalog = load_catalog()
    nav_cat = catalog.by_id()["nav-tabbar"]
    tiered_default = render_decision_previews_tiered(nav_cat, nav_cat.options, {})
    tiered_false = render_decision_previews_tiered(
        nav_cat, nav_cat.options, {}, enable_focus=False
    )
    assert tiered_default == tiered_false


def test_tiered_default_no_focus_wrap_high_fi():
    """High-fi cells (color.accent) must also NOT get focus-wrap when enable_focus=False."""
    catalog = load_catalog()
    color_cat = catalog.by_id()["color-accent-system"]
    tiered = render_decision_previews_tiered(color_cat, color_cat.options, {})

    for opt_id, cells in tiered.items():
        for p, cell in cells.items():
            assert 'class="focus-wrap"' not in cell["html"], \
                f"{opt_id}/{p}: focus-wrap must not appear when enable_focus=False"


def test_focus_high_fi_marker_free_cells_remain_unchanged_by_apply_focus():
    """apply_focus is a no-op on a high-fi fragment that carries NO data-focus-region
    markers (and whose dimension has no focus target). color-dark-mode is high-fi
    (dimension color.surface) with no focus markers and no defined target — so its
    cells are byte-identical with enable_focus=True.

    The accent packs DO carry markers by design (see test_focus_accent_highfi.py)
    and ARE focused; this test guards the fragment-driven contract: apply_focus's
    behavior is decided by what the html contains, not by the tier flag."""
    catalog = load_catalog()
    cat = catalog.by_id()["color-dark-mode"]
    tiered_focused = render_decision_previews_tiered(
        cat, cat.options, {}, enable_focus=True
    )
    tiered_plain = render_decision_previews_tiered(cat, cat.options, {})

    saw_high = False
    for opt_id, cells in tiered_focused.items():
        for p, cell in cells.items():
            if cell["tier"] == "high" and "data-focus-region" not in cell["html"]:
                saw_high = True
                plain_html = tiered_plain[opt_id][p]["html"]
                assert cell["html"] == plain_html, (
                    f"{opt_id}/{p}: marker-free high-fi cell must be UNCHANGED by apply_focus"
                )
                assert "focus-wrap" not in cell["html"]
    assert saw_high, "expected at least one marker-free high-fi cell to exercise the no-op path"


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
            print(f"ERROR {fn.__name__}: {type(e).__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    return failed


if __name__ == "__main__":
    sys.exit(1 if _run() else 0)
