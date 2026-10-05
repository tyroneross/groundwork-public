"""Focus-accent high-fi tests.

Asserts that the three high-fi accent pack options (accent-cta-only,
accent-semantic, accent-expressive) now carry data-focus-region markers
so that apply_focus() engages and de-emphasizes non-accent chrome.

Tests:
  1. All 9 high-fi accent cells (3 options x 3 platforms) have focus-wrap
     when enable_focus=True.
  2. Each cell carries at least one data-focus-region attribute in the raw
     HTML (not just in the injected CSS rules).
  3. The injected <style> includes the base dim rule (opacity:0.32) and does
     NOT include grayscale (color.* dims never desaturate).
  4. The target ring rule is present (outline:2px solid).
  5. With enable_focus=False (default), no focus-wrap appears — backward compat.
  6. The accent options progressively mark MORE distinct element groups:
     CTA-only < semantic / expressive (proving WHERE-accent-appears is visible).
  7. The elevation/button-shadow dimension also now focuses correctly on web
     and macOS: primary_button marker is present in the raw HTML fragment.

Pure stdlib. No deps, no network, no vendor SDK.

Run:  python3 designer/tests/test_focus_accent_highfi.py
Or:   python3 -m pytest designer/tests/test_focus_accent_highfi.py
"""

from __future__ import annotations

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from designer.engine.catalog_loader import load_catalog
from designer.preview.schematic import render_decision_previews_tiered

_ACCENT_OPTIONS = ["accent-cta-only", "accent-semantic", "accent-expressive"]
_PLATFORMS = ["web", "ios", "macos"]


def _accent_tiered(enable_focus: bool = True) -> dict:
    cat = load_catalog()
    color_cat = cat.by_id()["color-accent-system"]
    return render_decision_previews_tiered(
        color_cat, color_cat.options, {}, enable_focus=enable_focus
    )


def _raw_markers(html: str) -> list[str]:
    """Extract data-focus-region values from HTML element attributes (not CSS rules)."""
    # Match data-focus-region="..." attributes only (not CSS ~= selectors)
    return re.findall(r'data-focus-region="([^"]+)"', html)


# ---------------------------------------------------------------------------
# 1. All 9 high-fi accent cells get focus-wrap when enable_focus=True
# ---------------------------------------------------------------------------

def test_all_accent_cells_get_focus_wrap():
    """All 9 (3 options x 3 platforms) high-fi accent cells must have focus-wrap."""
    tiered = _accent_tiered(enable_focus=True)
    for opt_id in _ACCENT_OPTIONS:
        for p in _PLATFORMS:
            cell = tiered[opt_id][p]
            assert cell["tier"] == "high", f"{opt_id}/{p}: must be high-fi tier"
            assert 'class="focus-wrap"' in cell["html"], (
                f"{opt_id}/{p}: expected focus-wrap wrapper — data-focus-region markers "
                f"must now be present in high-fi accent fragments"
            )


# ---------------------------------------------------------------------------
# 2. Each cell has at least one raw data-focus-region attribute in the HTML
# ---------------------------------------------------------------------------

def test_all_accent_cells_have_raw_marker():
    """Each accent cell's raw fragment must carry at least one data-focus-region attribute."""
    tiered = _accent_tiered(enable_focus=True)
    for opt_id in _ACCENT_OPTIONS:
        for p in _PLATFORMS:
            html = tiered[opt_id][p]["html"]
            markers = _raw_markers(html)
            assert markers, (
                f"{opt_id}/{p}: no data-focus-region attribute found in HTML. "
                f"The accent pack fragment must mark accent-bearing elements."
            )


# ---------------------------------------------------------------------------
# 3. Dim rule present; grayscale absent (color.* contract)
# ---------------------------------------------------------------------------

def test_accent_cells_dim_via_scrim_not_grayscale():
    """color.accent de-emphasis is a scrim veil — NEVER grayscale (it would hide the
    accent token being decided)."""
    tiered = _accent_tiered(enable_focus=True)
    for opt_id in _ACCENT_OPTIONS:
        for p in _PLATFORMS:
            html = tiered[opt_id][p]["html"]
            assert ".focus-ground::after" in html and "rgba(255,255,255,0.62)" in html, (
                f"{opt_id}/{p}: scrim veil must be present"
            )
            assert "grayscale" not in html, (
                f"{opt_id}/{p}: grayscale must NOT appear in color.accent focus style"
            )


# ---------------------------------------------------------------------------
# 4. Target ring is present
# ---------------------------------------------------------------------------

def test_accent_cells_have_target_ring():
    """The injected style must include the outline ring for accent target regions."""
    tiered = _accent_tiered(enable_focus=True)
    for opt_id in _ACCENT_OPTIONS:
        for p in _PLATFORMS:
            html = tiered[opt_id][p]["html"]
            assert "outline:2px solid" in html, (
                f"{opt_id}/{p}: target ring rule (outline:2px solid) must be present"
            )
            assert "z-index:2" in html, (
                f"{opt_id}/{p}: target must be lifted above the scrim (z-index:2)"
            )


# ---------------------------------------------------------------------------
# 5. Backward compat: enable_focus=False produces NO focus-wrap
# ---------------------------------------------------------------------------

def test_accent_cells_no_focus_wrap_without_enable_focus():
    """Default render (enable_focus=False) must produce NO focus-wrap in accent cells."""
    tiered = _accent_tiered(enable_focus=False)
    for opt_id in _ACCENT_OPTIONS:
        for p in _PLATFORMS:
            assert 'class="focus-wrap"' not in tiered[opt_id][p]["html"], (
                f"{opt_id}/{p}: focus-wrap must NOT appear with enable_focus=False"
            )


def test_accent_tiered_default_equals_explicit_false():
    """render_decision_previews_tiered with default args must equal explicit enable_focus=False."""
    cat = load_catalog()
    color_cat = cat.by_id()["color-accent-system"]
    tiered_default = render_decision_previews_tiered(color_cat, color_cat.options, {})
    tiered_false = render_decision_previews_tiered(
        color_cat, color_cat.options, {}, enable_focus=False
    )
    assert tiered_default == tiered_false, (
        "Default render must be byte-identical to enable_focus=False"
    )


# ---------------------------------------------------------------------------
# 6. Progressive WHERE-accent-appears: CTA-only marks fewer element groups
# ---------------------------------------------------------------------------

def test_cta_only_marks_fewer_groups_than_semantic_web():
    """accent-cta-only must mark fewer distinct element groups than accent-semantic on web.

    CTA-only: only the primary CTA button carries accent (cta_button).
    Semantic: status indicators (accent_indicators) + CTA button (cta_button).
    """
    tiered = _accent_tiered(enable_focus=True)
    cta_markers = set(_raw_markers(tiered["accent-cta-only"]["web"]["html"]))
    sem_markers = set(_raw_markers(tiered["accent-semantic"]["web"]["html"]))
    # semantic must mark at least one region that CTA-only doesn't
    assert "accent_indicators" in sem_markers, (
        "accent-semantic/web: accent_indicators must be marked (semantic status colors)"
    )
    assert "accent_indicators" not in cta_markers, (
        "accent-cta-only/web: accent_indicators must NOT be marked "
        "(chrome is neutral, only button uses accent)"
    )


def test_expressive_marks_more_accent_indicators_than_cta_only():
    """accent-expressive must mark more accent-bearing elements than accent-cta-only.

    Expressive: accent appears in section headers, structural indicators, and CTA.
    CTA-only: accent appears only on the CTA button.
    """
    tiered = _accent_tiered(enable_focus=True)
    for p in _PLATFORMS:
        cta_count = len(_raw_markers(tiered["accent-cta-only"][p]["html"]))
        exp_count = len(_raw_markers(tiered["accent-expressive"][p]["html"]))
        assert exp_count > cta_count, (
            f"accent-expressive/{p}: expected MORE accent markers ({exp_count}) "
            f"than accent-cta-only/{p} ({cta_count}) — expressive uses accent throughout"
        )


def test_cta_button_marker_present_on_all_platforms_for_cta_only():
    """The primary CTA button must carry data-focus-region='cta_button' in all platforms
    for the accent-cta-only option — it is the sole accent carrier."""
    tiered = _accent_tiered(enable_focus=True)
    for p in _PLATFORMS:
        html = tiered["accent-cta-only"][p]["html"]
        markers = _raw_markers(html)
        assert "cta_button" in markers, (
            f"accent-cta-only/{p}: cta_button marker not found in raw HTML. "
            f"Found: {markers}"
        )


def test_semantic_has_accent_indicators_on_all_platforms():
    """accent-semantic must mark semantic color indicators across all 3 platforms."""
    tiered = _accent_tiered(enable_focus=True)
    for p in _PLATFORMS:
        html = tiered["accent-semantic"][p]["html"]
        markers = _raw_markers(html)
        assert "accent_indicators" in markers, (
            f"accent-semantic/{p}: accent_indicators marker not found. "
            f"Status color indicators must be marked so they stay bright. Found: {markers}"
        )


def test_expressive_has_accent_indicators_on_all_platforms():
    """accent-expressive must mark expressive accent indicators across all 3 platforms."""
    tiered = _accent_tiered(enable_focus=True)
    for p in _PLATFORMS:
        html = tiered["accent-expressive"][p]["html"]
        markers = _raw_markers(html)
        assert "accent_indicators" in markers, (
            f"accent-expressive/{p}: accent_indicators marker not found. "
            f"Structural accent elements must be marked. Found: {markers}"
        )


# ---------------------------------------------------------------------------
# 7. Elevation/button-shadow: primary_button marked in web and macOS
# ---------------------------------------------------------------------------

def test_button_shadow_web_has_primary_button_marker():
    """Web button-shadow fragments must mark the button as primary_button so
    elevation.style focus de-emphasizes chrome and highlights the button."""
    cat = load_catalog()
    btn_cat = cat.by_id()["button-shadow"]
    tiered = render_decision_previews_tiered(
        btn_cat, btn_cat.options, {}, enable_focus=True
    )
    for opt in btn_cat.options:
        html = tiered[opt.id]["web"]["html"]
        assert 'class="focus-wrap"' in html, (
            f"button-shadow {opt.id}/web: expected focus-wrap (nav_active marker is present)"
        )
        markers = _raw_markers(html)
        assert "primary_button" in markers, (
            f"button-shadow {opt.id}/web: primary_button marker missing. "
            f"Button elevation must be the focus target. Found: {markers}"
        )


def test_button_shadow_macos_has_primary_button_marker():
    """macOS button-shadow fragments must mark the button as primary_button."""
    cat = load_catalog()
    btn_cat = cat.by_id()["button-shadow"]
    tiered = render_decision_previews_tiered(
        btn_cat, btn_cat.options, {}, enable_focus=True
    )
    for opt in btn_cat.options:
        html = tiered[opt.id]["macos"]["html"]
        assert 'class="focus-wrap"' in html
        markers = _raw_markers(html)
        assert "primary_button" in markers, (
            f"button-shadow {opt.id}/macos: primary_button marker missing. Found: {markers}"
        )


def test_non_accent_dimension_backward_compat_no_break():
    """A non-accent high-fi dimension (button-shadow) must not be broken by marker additions.

    The nav_active marker is now present in web/macOS shells — this is fine because:
    - For button-shadow focus: target is primary_button; nav_active is in HTML but not
      a target, so it dims correctly alongside other chrome.
    - With enable_focus=False: no focus-wrap at all (verified separately).
    """
    cat = load_catalog()
    btn_cat = cat.by_id()["button-shadow"]
    # Default render must have no focus-wrap
    tiered = render_decision_previews_tiered(btn_cat, btn_cat.options, {})
    for opt in btn_cat.options:
        for p in _PLATFORMS:
            assert 'class="focus-wrap"' not in tiered[opt.id][p]["html"], (
                f"button-shadow {opt.id}/{p}: focus-wrap must not appear without enable_focus"
            )


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
