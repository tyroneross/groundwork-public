"""Low-fidelity schematic preview engine.

Renders per-platform HTML fragment strings from a resolved token state. The
output is a SCHEMATIC — device-framed box layouts that visibly reflect live
token values (accent color, radius, density, nav style, separator, elevation,
etc.) — NOT a pixel-perfect mockup.

All rendering is server-side (pure Python string templating). No client-side JS,
no external stylesheets, no network, no third-party deps.

Public API
----------
render_platform_schematic(platform, tokens, decision=None) -> str
    HTML fragment for one platform using the given (already-resolved) token dict.

render_all_platforms(tokens_or_overrides) -> dict[str, str]
    {platform: html} for the current state across all three platforms.

render_decision_previews(decision, options, base_overrides) -> dict
    {option_id: {platform: html}} showing what each candidate option would look
    like if picked, by resolving base_overrides ⊕ option.token_delta per platform.

Pure stdlib. No deps, no network, no vendor SDK.
"""

from __future__ import annotations

import os
import sys
from typing import Any

# ---------------------------------------------------------------------------
# Path bootstrap: allow running this file directly from anywhere.
# ---------------------------------------------------------------------------
_HERE = os.path.dirname(os.path.abspath(__file__))
_PKG_ROOT = os.path.dirname(os.path.dirname(_HERE))
if _PKG_ROOT not in sys.path:
    sys.path.insert(0, _PKG_ROOT)

from designer.engine.resolver import merge_delta, resolve, resolve_all
from designer.engine.schema import PLATFORMS
from designer.preview.highfi.router import render_high_fi, tier_for
from designer.preview.focus_spec import (
    focus_for,
    target_ring_style,
)
from designer.preview import scope_preview

# ---------------------------------------------------------------------------
# Template loading
# ---------------------------------------------------------------------------
_TMPL_DIR = os.path.join(_HERE, "templates")


def _load_template(name: str) -> str:
    path = os.path.join(_TMPL_DIR, name)
    with open(path, encoding="utf-8") as fh:
        return fh.read()


_WEB_FRAME: str | None = None
_IOS_FRAME: str | None = None
_MACOS_FRAME: str | None = None


def _web_frame() -> str:
    global _WEB_FRAME
    if _WEB_FRAME is None:
        _WEB_FRAME = _load_template("web_frame.html")
    return _WEB_FRAME


def _ios_frame() -> str:
    global _IOS_FRAME
    if _IOS_FRAME is None:
        _IOS_FRAME = _load_template("ios_frame.html")
    return _IOS_FRAME


def _macos_frame() -> str:
    global _MACOS_FRAME
    if _MACOS_FRAME is None:
        _MACOS_FRAME = _load_template("macos_frame.html")
    return _MACOS_FRAME


# ---------------------------------------------------------------------------
# Token helpers
# ---------------------------------------------------------------------------

def _t(tokens: dict[str, Any], group: str, key: str, fallback: Any = "") -> Any:
    """Safe token accessor."""
    return tokens.get(group, {}).get(key, fallback)


def _density_padding(density: str) -> str:
    return {"comfortable": "12px", "compact": "8px", "spacious": "16px"}.get(density, "12px")


def _radius_px(r: Any) -> str:
    """Return a CSS border-radius value from a token (int -> px, str -> as-is)."""
    if isinstance(r, int):
        return f"{r}px"
    return str(r) if r else "8px"


def _elevation_shadow(style: str, depth: str, accent: str) -> str:
    if style == "soft-shadow":
        return f"0 4px 12px {accent}33"
    if style == "glass":
        return "0 2px 16px rgba(0,0,0,0.15)"
    if style in ("gradient", "gradient-mesh", "gradient-duotone"):
        return "0 2px 8px rgba(0,0,0,0.10)"
    if depth == "raised":
        return "0 2px 6px rgba(0,0,0,0.10)"
    return "none"


def _button_bg(tokens: dict[str, Any]) -> str:
    """Return gradient or solid bg for button based on elevation style."""
    style = _t(tokens, "elevation", "style", "flat-border")
    accent = _t(tokens, "color", "accent", "#0A84FF")
    if "gradient" in style:
        # Very subtle gradient from accent → slightly darker
        return f"linear-gradient(to bottom, {accent}, {accent}cc)"
    return accent


def _separator_style(sep: str, border: str) -> str:
    if sep == "none":
        return "none"
    if sep == "full-line":
        return f"1px solid {border}"
    if sep == "card-per-row":
        return "none"  # cards use their own border
    # default: inset-line
    return f"1px solid {border}"


# ---------------------------------------------------------------------------
# Content slot builders
# ---------------------------------------------------------------------------

def _build_text_ladder(tokens: dict[str, Any]) -> str:
    """A three-level text hierarchy block using real token values."""
    tp = _t(tokens, "color", "textPrimary", "#1C1C1E")
    ts = _t(tokens, "color", "textSecondary", "#6E6E73")
    tt = _t(tokens, "color", "textTertiary", "#9A9AA0")
    hw = _t(tokens, "typography", "headingWeight", 600)
    bw = _t(tokens, "typography", "bodyWeight", 400)
    tracking = _t(tokens, "typography", "tracking", "normal")
    track_css = "-0.03em" if tracking == "tight" else "normal"
    return (
        f'<div style="margin-bottom:4px;font-size:15px;font-weight:{hw};'
        f'color:{tp};letter-spacing:{track_css};">Section Title</div>'
        f'<div style="font-size:12px;font-weight:{bw};color:{ts};margin-bottom:2px;">'
        f'Body description text goes here</div>'
        f'<div style="font-size:10px;color:{tt};">Meta · Secondary info</div>'
    )


def _build_card(tokens: dict[str, Any], label: str = "Content Card") -> str:
    """A content card reflecting radius, elevation, separator tokens."""
    surface = _t(tokens, "color", "surface", "#F5F5F7")
    border = _t(tokens, "color", "border", "#E5E5EA")
    accent = _t(tokens, "color", "accent", "#0A84FF")
    rad = _radius_px(_t(tokens, "radius", "card", 10))
    style = _t(tokens, "elevation", "style", "flat-border")
    depth = _t(tokens, "elevation", "depth", "minimal")
    sep = _t(tokens, "components", "separator", "inset-line")
    shadow = _elevation_shadow(style, depth, accent)
    use_card_per_row = sep == "card-per-row"
    card_border = f"1px solid {border}" if (style == "flat-border" or use_card_per_row) else "none"
    if style == "glass":
        card_bg = "rgba(255,255,255,0.60)"
        card_border = f"1px solid rgba(255,255,255,0.4)"
    elif style in ("gradient", "gradient-mesh", "gradient-duotone"):
        card_bg = f"linear-gradient(135deg, {surface}, {surface}cc)"
    else:
        card_bg = surface
    return (
        f'<div style="background:{card_bg};border:{card_border};border-radius:{rad};'
        f'padding:8px 10px;margin-bottom:8px;box-shadow:{shadow};">'
        f'{_build_text_ladder(tokens)}'
        f'</div>'
    )


def _build_primary_button(tokens: dict[str, Any]) -> str:
    """Primary CTA button reflecting accent, radius, shape tokens."""
    accent = _t(tokens, "color", "accent", "#0A84FF")
    accent_text = _t(tokens, "color", "accentText", "#FFFFFF")
    shape = _t(tokens, "components", "buttonShape", "flat")
    rad_token = _t(tokens, "radius", "button", 8)
    if shape == "pill":
        rad = "999px"
    elif shape in ("soft", "glass"):
        rad = _radius_px(int(rad_token) + 4 if isinstance(rad_token, int) else 12)
    else:
        rad = _radius_px(rad_token)
    bg = _button_bg(tokens)
    style = _t(tokens, "elevation", "style", "flat-border")
    border = "none"
    if style == "glass":
        bg = f"rgba(255,255,255,0.25)"
        border = f"1px solid rgba(255,255,255,0.5)"
    return (
        f'<div style="background:{bg};color:{accent_text};border:{border};'
        f'border-radius:{rad};padding:6px 14px;font-size:11px;font-weight:600;'
        f'text-align:center;margin-top:4px;">Primary Action</div>'
    )


def _build_nav_item(label: str, active: bool, tokens: dict[str, Any]) -> str:
    accent = _t(tokens, "color", "accent", "#0A84FF")
    text_p = _t(tokens, "color", "textPrimary", "#1C1C1E")
    text_s = _t(tokens, "color", "textSecondary", "#6E6E73")
    active_style = _t(tokens, "nav", "activeStyle", "text-underline")
    if not active:
        return (
            f'<span style="font-size:10px;color:{text_s};padding:4px 6px;">'
            f'{label}</span>'
        )
    if active_style == "fill-color":
        return (
            f'<span style="font-size:10px;color:{accent};font-weight:600;padding:4px 6px;">'
            f'{label}</span>'
        )
    if active_style == "pill-bg":
        return (
            f'<span style="font-size:10px;color:{accent};font-weight:600;'
            f'background:{accent}22;border-radius:12px;padding:3px 8px;">{label}</span>'
        )
    if active_style == "dot":
        return (
            f'<span style="font-size:10px;color:{text_p};font-weight:600;'
            f'padding:4px 6px;position:relative;">'
            f'{label}'
            f'<span style="display:block;width:4px;height:4px;border-radius:50%;'
            f'background:{accent};margin:1px auto 0;"></span></span>'
        )
    # default: text-underline
    return (
        f'<span style="font-size:10px;color:{text_p};font-weight:600;'
        f'border-bottom:2px solid {accent};padding:4px 6px;">{label}</span>'
    )


def _build_toast_band(tokens: dict[str, Any]) -> str:
    toast = _t(tokens, "components", "toast", "inline")
    accent = _t(tokens, "color", "accent", "#0A84FF")
    success = _t(tokens, "color", "success", "#1E874B")
    border = _t(tokens, "color", "border", "#E5E5EA")
    surface = _t(tokens, "color", "surface", "#F5F5F7")
    if toast == "top-banner":
        return (
            f'<div style="background:{accent};color:#fff;font-size:9px;'
            f'padding:4px 8px;text-align:center;margin-bottom:6px;">'
            f'Saved successfully</div>'
        )
    if toast == "bottom-pill":
        return (
            f'<div style="background:{surface};border:1px solid {border};color:{success};'
            f'font-size:9px;border-radius:20px;padding:3px 10px;'
            f'text-align:center;margin-top:6px;">Saved</div>'
        )
    if toast == "center-hud":
        return (
            f'<div style="background:rgba(0,0,0,0.7);color:#fff;font-size:9px;'
            f'border-radius:10px;padding:4px 10px;text-align:center;margin:4px auto;">'
            f'Done</div>'
        )
    # inline (Calm Precision default): text color, no background badge
    return (
        f'<div style="font-size:9px;color:{success};padding:2px 0;">Saved</div>'
    )


def _build_separator(tokens: dict[str, Any]) -> str:
    sep = _t(tokens, "components", "separator", "inset-line")
    border = _t(tokens, "color", "border", "#E5E5EA")
    if sep == "none":
        return '<div style="height:6px;"></div>'
    if sep == "full-line":
        return f'<div style="height:1px;background:{border};margin:4px 0;"></div>'
    # inset-line
    return f'<div style="height:1px;background:{border};margin:4px 0 4px 16px;"></div>'


# ---------------------------------------------------------------------------
# Per-platform schematic builders
# ---------------------------------------------------------------------------

def _render_web(tokens: dict[str, Any], decision: Any = None, *, focus: Any = None) -> str:
    bg = _t(tokens, "color", "bg", "#FFFFFF")
    surface = _t(tokens, "color", "surface", "#F5F5F7")
    border = _t(tokens, "color", "border", "#E5E5EA")
    accent = _t(tokens, "color", "accent", "#0A84FF")
    font = _t(tokens, "typography", "fontFamily", "'Inter', system-ui, sans-serif")
    density = _t(tokens, "spacing", "density", "comfortable")
    padding = _density_padding(density)

    nav_labels = ["Home", "Explore", "Settings"]
    nav_items_html = "".join(
        _build_nav_item(lbl, i == 0, tokens) for i, lbl in enumerate(nav_labels)
    )

    # nav_bar region — wraps nav items so focus can target it
    nav_bar_html = (
        f'<div data-focus-region="nav_bar" style="display:contents;">'
        f'{nav_items_html}</div>'
    )

    # Build content sections with data-focus-region markers on relevant groups
    primary_button_html = (
        f'<div data-focus-region="primary_button cta_button">'
        f'{_build_primary_button(tokens)}</div>'
    )
    toast_html = (
        f'<div data-focus-region="toast_band">'
        f'{_build_toast_band(tokens)}</div>'
    )
    list_rows_html = (
        f'<div data-focus-region="list_rows">'
        f'{_build_separator(tokens)}</div>'
    )
    sheet_html = (
        f'<div data-focus-region="sheet_element accent_indicators">'
        f'{_build_card(tokens, "Primary Card")}</div>'
        f'<div data-focus-region="sheet_element">'
        f'{_build_card(tokens, "Secondary Card")}</div>'
    )

    content_html = (
        sheet_html
        + list_rows_html
        + primary_button_html
        + toast_html
    )

    tmpl = _web_frame()
    return tmpl.replace("{slot}", content_html) \
               .replace("{bg}", bg) \
               .replace("{surface}", surface) \
               .replace("{border}", border) \
               .replace("{accent}", accent) \
               .replace("{font_family}", font) \
               .replace("{content_padding}", padding) \
               .replace("{nav_items}", nav_bar_html) \
               .replace("{radius_card}", _radius_px(_t(tokens, "radius", "card", 10)))


def _render_ios(tokens: dict[str, Any], decision: Any = None, *, focus: Any = None) -> str:
    bg = _t(tokens, "color", "bg", "#FFFFFF")
    surface = _t(tokens, "color", "surface", "#F5F5F7")
    border = _t(tokens, "color", "border", "#E5E5EA")
    accent = _t(tokens, "color", "accent", "#0A84FF")
    font = _t(tokens, "typography", "fontFamily", "-apple-system, 'SF Pro Text', sans-serif")
    density = _t(tokens, "spacing", "density", "comfortable")
    padding = _density_padding(density)
    hw = _t(tokens, "typography", "headingWeight", 600)
    ts = _t(tokens, "color", "textSecondary", "#6E6E73")
    tp = _t(tokens, "color", "textPrimary", "#1C1C1E")
    tab_style = _t(tokens, "nav", "tabStyle", "icon-label")

    # Notch: dark in all cases (hardware element)
    notch_bg = "#1C1C1E"

    # Tab items
    tab_labels = ["Home", "Search", "Profile", "Settings"]
    tabs_html = ""
    for i, lbl in enumerate(tab_labels):
        is_active = (i == 0)
        active_style = _t(tokens, "nav", "activeStyle", "fill-color")
        color = accent if is_active else ts
        fw = "600" if is_active else "400"
        if tab_style == "icon-only":
            dot = f'<span style="width:6px;height:6px;border-radius:50%;background:{accent};display:block;margin:0 auto 1px;"></span>' if is_active else ""
            tabs_html += (
                f'<div style="text-align:center;flex:1;">'
                f'{dot}<span style="font-size:6px;color:{color};">[icon]</span></div>'
            )
        elif tab_style == "floating-pill":
            bg_pill = f"{accent}22" if is_active else "transparent"
            tabs_html += (
                f'<div style="text-align:center;flex:1;background:{bg_pill};'
                f'border-radius:14px;padding:2px 0;">'
                f'<span style="font-size:6px;color:{color};">[i]</span>'
                f'<div style="font-size:7px;color:{color};font-weight:{fw};">{lbl}</div></div>'
            )
        else:
            # icon-label default
            tabs_html += (
                f'<div style="text-align:center;flex:1;">'
                f'<span style="font-size:6px;color:{color};">[icon]</span>'
                f'<div style="font-size:7px;color:{color};font-weight:{fw};">{lbl}</div></div>'
            )

    # Wrap tabs_html in nav_bar focus region
    tabs_html_wrapped = (
        f'<div data-focus-region="nav_bar" style="display:contents;">'
        f'{tabs_html}</div>'
    )

    content_html = (
        f'<div data-focus-region="sheet_element accent_indicators">'
        f'{_build_card(tokens, "Primary Card")}</div>'
        f'<div data-focus-region="list_rows">'
        f'{_build_separator(tokens)}</div>'
        f'<div data-focus-region="sheet_element">'
        f'{_build_card(tokens, "Secondary Card")}</div>'
        f'<div data-focus-region="primary_button cta_button">'
        f'{_build_primary_button(tokens)}</div>'
        f'<div data-focus-region="toast_band">'
        f'{_build_toast_band(tokens)}</div>'
    )

    tmpl = _ios_frame()
    return tmpl.replace("{slot}", content_html) \
               .replace("{bg}", bg) \
               .replace("{surface}", surface) \
               .replace("{border}", border) \
               .replace("{accent}", accent) \
               .replace("{font_family}", font) \
               .replace("{content_padding}", padding) \
               .replace("{heading_weight}", str(hw)) \
               .replace("{text_primary}", tp) \
               .replace("{text_secondary}", ts) \
               .replace("{notch_bg}", notch_bg) \
               .replace("{tab_items}", tabs_html_wrapped) \
               .replace("{radius_card}", _radius_px(_t(tokens, "radius", "card", 10)))


def _render_macos(tokens: dict[str, Any], decision: Any = None, *, focus: Any = None) -> str:
    bg = _t(tokens, "color", "bg", "#FFFFFF")
    surface = _t(tokens, "color", "surface", "#F5F5F7")
    border = _t(tokens, "color", "border", "#E5E5EA")
    accent = _t(tokens, "color", "accent", "#0A84FF")
    font = _t(tokens, "typography", "fontFamily", "-apple-system, 'SF Pro Text', 'Inter', sans-serif")
    density = _t(tokens, "spacing", "density", "compact")
    padding = _density_padding(density)
    ts = _t(tokens, "color", "textSecondary", "#6E6E73")

    sidebar_labels = ["Home", "Library", "Settings"]
    sidebar_html = ""
    for i, lbl in enumerate(sidebar_labels):
        is_active = (i == 0)
        sidebar_html += _build_nav_item(lbl, is_active, tokens) + "<br>"

    # Wrap sidebar in nav_bar focus region
    sidebar_html_wrapped = (
        f'<div data-focus-region="nav_bar" style="display:contents;">'
        f'{sidebar_html}</div>'
    )

    content_html = (
        f'<div data-focus-region="sheet_element accent_indicators">'
        f'{_build_card(tokens, "Primary Card")}</div>'
        f'<div data-focus-region="list_rows">'
        f'{_build_separator(tokens)}</div>'
        f'<div data-focus-region="sheet_element">'
        f'{_build_card(tokens, "Secondary Card")}</div>'
        f'<div data-focus-region="primary_button cta_button">'
        f'{_build_primary_button(tokens)}</div>'
        f'<div data-focus-region="toast_band">'
        f'{_build_toast_band(tokens)}</div>'
    )

    tmpl = _macos_frame()
    return tmpl.replace("{slot}", content_html) \
               .replace("{bg}", bg) \
               .replace("{surface}", surface) \
               .replace("{border}", border) \
               .replace("{accent}", accent) \
               .replace("{font_family}", font) \
               .replace("{content_padding}", padding) \
               .replace("{text_secondary}", ts) \
               .replace("{sidebar_items}", sidebar_html_wrapped) \
               .replace("{radius_card}", _radius_px(_t(tokens, "radius", "card", 10)))


# ---------------------------------------------------------------------------
# Focus post-wrap
# ---------------------------------------------------------------------------

def apply_focus(html: str, dimension: str, accent: str) -> str:
    """Wrap *html* with focus de-emphasis if the fragment carries data-focus-region markers.

    Design contract
    ---------------
    - If the fragment has NO ``data-focus-region`` attributes (e.g. a high-fi pack
      fragment, which you cannot instrument), return *html* UNCHANGED.  High-fi
      fragments already differentiate options by where the accent appears; applying
      a blanket dim without any targets to un-dim would harm clarity.
    - If the fragment has markers: wrap it in a ``<div class="focus-wrap">`` +
      ``<div class="focus-ground">`` and inject a ``<style>`` that:
        1. Lays a semi-transparent SCRIM veil over the chrome via
           ``.focus-ground::after`` (no element opacity is changed, so the veil
           never compounds onto the target). Non-color dims also desaturate the
           veil; color.* dims do NOT (that would hide the accent being decided).
        2. For each region in ``focus["target_regions"]``, emits a rule that
           lifts it ABOVE the veil (``position:relative;z-index:2``) and adds the
           accent ring + glow (``target_ring_style(accent)``).
    - If the dimension's ``target_regions`` list is empty (the ``_default`` case or
      typography/motion dims), return *html* unchanged — dimming without targets
      produces undifferentiated fog.
    - Keyword-only parameters and new params default to None so existing callers
      are byte-identical (the focus path requires an explicit ``dimension`` + ``accent``).

    Parameters
    ----------
    html : str
        The rendered HTML fragment (low-fi schematic or high-fi pack output).
    dimension : str
        The catalog dimension being decided (e.g. "color.accent").
    accent : str
        The resolved accent hex color string (e.g. "#0A84FF") for ring styling.

    Returns
    -------
    str
        Wrapped HTML with focus styles injected, OR the original *html* unchanged.
    """
    # Guard 1: high-fi fragments (no data-focus-region markers) — return unchanged.
    if 'data-focus-region' not in html:
        return html

    focus = focus_for(dimension)
    target_regions = focus.get("target_regions", [])

    # Guard 2: dimension has no defined targets (e.g. typography, motion) — no-op.
    if not target_regions:
        return html

    ring_style = target_ring_style(accent)
    # color.* dims must not desaturate the accent being decided; other dims may.
    group = dimension.split(".")[0] if "." in dimension else dimension
    desaturate = "" if group == "color" else "backdrop-filter:grayscale(0.6);"

    # De-emphasis strategy — a SCRIM, not ancestor opacity. CSS ``opacity``
    # compounds down the DOM tree (a descendant can never be more opaque than a
    # dimmed ancestor), so dimming a common ancestor and "un-dimming" the target
    # inside it is physically impossible. Instead we lay a semi-transparent veil
    # (``.focus-ground::after``) OVER the whole fragment to mute the chrome, then
    # lift the marked target(s) ABOVE the veil with ``position:relative;
    # z-index`` so they read as the lit figure against a recessed ground. The
    # target's own pixels are never dimmed — only the chrome is veiled — so the
    # decision element always pops, regardless of how deep it sits.
    #   * The veil sits at z-index:1; targets at z-index:2 poke through.
    #   * Ring + accent glow add the Signal-to-Noise / figure-ground cue.
    #   * The injected <style> stays display:none (never forced to block), so the
    #     stylesheet is applied, never printed as visible source text.
    target_selectors = ", ".join(
        f'.focus-wrap [data-focus-region~="{r}"]' for r in target_regions
    )
    glow = f"box-shadow:0 0 0 1px {accent}55,0 2px 12px {accent}45;"

    style_block = (
        f'<style>'
        f'.focus-wrap > style{{display:none !important;}}'
        f'\n      .focus-wrap{{position:relative;}}'
        f'\n      .focus-ground{{position:relative;}}'
        # The scrim: a white veil over the chrome (the ground recedes). It does
        # NOT change any element opacity, so descendants stay paintable.
        f'\n      .focus-ground::after{{content:"";position:absolute;inset:0;'
        f'background:rgba(255,255,255,0.62);{desaturate}'
        f'pointer-events:none;z-index:1;border-radius:8px;}}'
        # The lit figure: targets ride above the veil with the ring + glow.
        f'\n      {target_selectors}{{position:relative;z-index:2;'
        f'{ring_style}{glow}}}'
        f'</style>'
    )

    return (
        f'<div class="focus-wrap">'
        f'{style_block}'
        f'<div class="focus-ground">{html}</div>'
        f'</div>'
    )


# ---------------------------------------------------------------------------
# Platform column scoping
# ---------------------------------------------------------------------------

def scoped_platforms(base_overrides: dict) -> list[str]:
    """Return the list of platform columns to render, based on the accumulated
    taste-state in *base_overrides*.

    When the user has already chosen a platform target (platform.target is set
    in the accumulated overrides), only that platform's column is rendered for
    downstream decisions — it declutters the picker to show the relevant column
    prominently.

    When platform.target is unset (None / missing) or "multi", all three
    platforms are returned — backward-compatible default.

    Parameters
    ----------
    base_overrides : dict
        The accumulated taste-state overrides (NOT the per-option merged delta;
        only the base state before the current decision's options are applied).

    Returns
    -------
    list[str]
        Subset of ("web", "ios", "macos"). Always non-empty.
    """
    _PLATFORM_MAP = {
        "web":   ["web"],
        "ios":   ["ios"],
        "macos": ["macos"],
    }
    target = (base_overrides.get("platform") or {}).get("target")
    if target and target != "multi":
        cols = _PLATFORM_MAP.get(target)
        if cols:
            return cols
    return list(PLATFORMS)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

_RENDERERS = {
    "web": _render_web,
    "ios": _render_ios,
    "macos": _render_macos,
}


def render_platform_schematic(
    platform: str,
    tokens: dict[str, Any],
    decision: Any = None,
    *,
    focus: Any = None,
) -> str:
    """Render a low-fi schematic HTML fragment for one platform.

    Parameters
    ----------
    platform : str
        One of "web", "ios", "macos".
    tokens : dict
        The already-resolved effective token dict for this platform (from
        resolver.resolve(platform, overrides)).
    decision : optional
        A catalog Category — unused by the low-fi renderer but passed through
        for future high-fi routing.
    focus : optional (keyword-only)
        When None (default), output is byte-identical to the pre-focus version —
        existing callers and tests are unaffected.  Pass a non-None value to
        trigger focus styling; the actual focus dimension is derived from the
        ``decision`` argument.

    Returns
    -------
    str
        Self-contained HTML fragment (no external CSS). Inline styles use
        actual token values so the schematic visibly reflects changes.
    """
    if platform not in _RENDERERS:
        raise ValueError(f"unknown platform {platform!r}; expected one of {PLATFORMS}")
    return _RENDERERS[platform](tokens, decision, focus=focus)


def render_all_platforms(
    tokens_or_overrides: dict[str, Any] | None = None,
) -> dict[str, str]:
    """Render schematics for all three platforms using the same override state.

    Parameters
    ----------
    tokens_or_overrides : dict or None
        Either a bare overrides delta (passed to resolver.resolve) or None for
        floor defaults. If the dict contains token groups as top-level keys
        (e.g. {"color": {...}}) it is treated as an overrides delta.

    Returns
    -------
    dict[str, str]
        {"web": html, "ios": html, "macos": html}
    """
    overrides = tokens_or_overrides or {}
    return {
        p: render_platform_schematic(p, resolve(p, overrides))
        for p in PLATFORMS
    }


def render_decision_previews(
    decision: Any,
    options: list[Any],
    base_state_tokens_or_overrides: dict[str, Any] | None = None,
) -> dict[str, dict[str, str]]:
    """Preview what each option candidate would look like across all platforms.

    For each option, merges its token_delta onto the current accumulated
    overrides and resolves per platform.

    Parameters
    ----------
    decision : Category
        The catalog Category being decided (used for context; not read for tokens).
    options : list[Option]
        The candidate options, each with a .token_delta attribute.
    base_state_tokens_or_overrides : dict or None
        The current taste-state as an overrides delta (accumulated user picks so
        far). None => floor defaults.

    Returns
    -------
    dict[str, dict[str, str]]
        {option_id: {platform: html_fragment}}
    """
    # Backward-compatible HTML-only shape: {option_id: {platform: html}}.
    tiered = render_decision_previews_tiered(
        decision, options, base_state_tokens_or_overrides
    )
    return {
        oid: {p: cell["html"] for p, cell in plat_map.items()}
        for oid, plat_map in tiered.items()
    }


def render_decision_previews_tiered(
    decision: Any,
    options: list[Any],
    base_state_tokens_or_overrides: dict[str, Any] | None = None,
    *,
    enable_focus: bool = False,
) -> dict[str, dict[str, dict[str, str]]]:
    """Like render_decision_previews, but returns the AUTHORITATIVE tier the
    engine selected per (option, platform) alongside the HTML — so callers read
    a structured flag instead of sniffing the HTML string for 'hf-'.

    Parameters
    ----------
    decision : Category
        The catalog Category being decided.
    options : list[Option]
        The candidate options.
    base_state_tokens_or_overrides : dict or None
        The current taste-state overrides. None => floor defaults.
    enable_focus : bool (keyword-only, default False)
        When False (default), output is byte-identical to pre-focus behavior —
        all existing callers and tests are unaffected.
        When True, each cell's HTML is passed through ``apply_focus`` using the
        decision's dimension and the resolved accent token.  For low-fi fragments
        (which carry data-focus-region markers), non-target regions are dimmed
        and target regions are ringed.  For high-fi fragments (no markers),
        apply_focus returns the HTML unchanged — see apply_focus docstring.

    Returns
    -------
    dict[str, dict[str, dict[str, str]]]
        {option_id: {platform: {"html": <fragment>, "tier": "high"|"low"}}}
    """
    base = base_state_tokens_or_overrides or {}
    # The dimension drives the tier-selection heuristic. A bare/None decision
    # (no dimension) means "render low-fi" — the safe default.
    dimension = getattr(decision, "dimension", "") or ""

    # Determine which platform columns to render.  When platform.target is set
    # in the ACCUMULATED base state (not the per-option delta), downstream
    # decisions only need to show the scoped platform column(s).  When unset or
    # "multi", all three columns render — backward-compatible default.
    platforms_to_render = scoped_platforms(base)

    result: dict[str, dict[str, dict[str, str]]] = {}
    for opt in options:
        # preview this option: merge its delta on top of current overrides
        preview_overrides = merge_delta(base, opt.token_delta)
        platform_cells: dict[str, dict[str, str]] = {}

        # Layer-1 scope detection: these dimensions render custom low-fi art
        # (device/layout silhouettes) that make the SCOPE CHOICE legible.  They
        # are platform-neutral art — render the same fragment in each column.
        # Route BEFORE the high-fi / generic-schematic branch below so they
        # never accidentally get the generic card schematic.
        scope_html: "str | None" = None
        if dimension == "platform.target":
            # Resolve once (platform-neutral tokens; use "web" as the base).
            effective_base = resolve("web", preview_overrides)
            scope_html = scope_preview.render_platform_scope(opt.id, effective_base)
        elif dimension == "nav.layoutModel":
            effective_base = resolve("web", preview_overrides)
            scope_html = scope_preview.render_nav_scope(opt.id, effective_base)

        for p in platforms_to_render:
            effective = resolve(p, preview_overrides)

            if scope_html is not None:
                # Layer-1 scope schematic: same art in every column, tier "low".
                # No focus overlay — scope schematics have no data-focus-region
                # markers and focus is not meaningful for scope decisions.
                platform_cells[p] = {"html": scope_html, "tier": "low"}
                continue

            # Progressive fidelity: the engine escalates to high-fi ONLY on the
            # color/depth/motion dimensions, and only where the platform pack has
            # art for this option. Every other case (and every miss) is the
            # already-working low-fi schematic. Tier-selection is engine logic,
            # not a manual toggle. (Accuracy > Speed > Cost: the costly high-fi
            # fragment is produced only where fidelity changes the pick.)
            high = render_high_fi(p, opt.id, dimension, effective)
            if high is not None:
                # The router returned art -> this (option, platform) is high-fi.
                html = high
                if enable_focus:
                    # apply_focus is a no-op when html has no data-focus-region
                    # markers (high-fi fragments are not instrumented).
                    accent = _t(effective, "color", "accent", "#0A84FF")
                    html = apply_focus(html, dimension, accent)
                platform_cells[p] = {"html": html, "tier": "high"}
            else:
                html = render_platform_schematic(p, effective, decision)
                if enable_focus:
                    accent = _t(effective, "color", "accent", "#0A84FF")
                    html = apply_focus(html, dimension, accent)
                platform_cells[p] = {"html": html, "tier": "low"}
        result[opt.id] = platform_cells
    return result


def tier_for_dimension(dimension: str) -> str:
    """Public helper: the tier ('high' | 'low') the engine selects for a
    dimension. Re-exported from the high-fi router so callers (the CLI decision
    payload, the picker UI) can label which previews escalated without importing
    the router directly. Low-fi default; high-fi only on color/depth/motion."""
    return tier_for(dimension)
