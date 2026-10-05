"""High-fidelity macOS preview fragments.

Each fragment is a self-contained HTML string that simulates how a macOS app
would render a particular design dimension (color, elevation, motion).

Rules:
- Wrap in <div class="hf-macos-<optid>">; all CSS selectors prefixed by it.
- Every @keyframes uniquely named hf-macos-<optid>-<anim>.
- Token-parameterized: changing a token changes the rendered output.
- macOS platform truth: vibrancy sidebar, SF Pro, compact density (~15% tighter
  than iOS/web), traffic-light dots, restrained shadows (macOS depth is subtle).
- Calm Precision: status = text-color only (no background badges), content >= chrome,
  single border around groups not individual items.

Pure stdlib. No deps, no network, no vendor SDK.
"""

from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# Token accessor (mirrors schematic.py _t())
# ---------------------------------------------------------------------------

def _t(tokens: dict[str, Any] | None, group: str, key: str, fallback: Any = "") -> Any:
    if not tokens:
        return fallback
    return tokens.get(group, {}).get(key, fallback)


# ---------------------------------------------------------------------------
# macOS floor defaults (Calm Precision 6.4.2 + macOS HIG grounded)
# ---------------------------------------------------------------------------

_DEFAULTS: dict[str, dict[str, Any]] = {
    "color": {
        "accent": "#0A84FF",
        "accentText": "#FFFFFF",
        "bg": "#FFFFFF",
        "surface": "#F5F5F7",
        "border": "#E5E5EA",
        "textPrimary": "#1C1C1E",
        "textSecondary": "#6E6E73",
        "textTertiary": "#9A9AA0",
        "success": "#1E874B",
        "warning": "#B25000",
        "error": "#C0392B",
    },
    "elevation": {
        "style": "flat-border",
        "depth": "minimal",
    },
    "radius": {
        "card": 10,
        "button": 6,
    },
    "spacing": {
        "density": "compact",
    },
}


def _tok(tokens: dict[str, Any] | None, group: str, key: str) -> Any:
    """Token with Calm Precision floor fallback."""
    val = _t(tokens, group, key, None)
    if val is not None:
        return val
    return _DEFAULTS.get(group, {}).get(key, "")


def _radius_px(r: Any) -> str:
    if isinstance(r, int):
        return f"{r}px"
    return str(r) if r else "8px"


# ---------------------------------------------------------------------------
# Shared macOS chrome widget (traffic lights + sidebar chrome)
# ---------------------------------------------------------------------------

def _traffic_lights() -> str:
    """Three macOS traffic-light dots: 12pt diameter, 6pt apart, per HIG."""
    return (
        '<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;">'
        '<div style="width:12px;height:12px;border-radius:50%;background:#FF5F57;border:0.5px solid rgba(0,0,0,0.12);"></div>'
        '<div style="width:12px;height:12px;border-radius:50%;background:#FEBC2E;border:0.5px solid rgba(0,0,0,0.12);"></div>'
        '<div style="width:12px;height:12px;border-radius:50%;background:#28C840;border:0.5px solid rgba(0,0,0,0.12);"></div>'
        '</div>'
    )


def _sidebar_chrome(accent: str, text_p: str, text_s: str) -> str:
    """Vibrancy sidebar strip — sidebar material, hairline selection + accent tint."""
    items = [("Home", True), ("Library", False), ("Settings", False)]
    rows = ""
    for label, active in items:
        if active:
            rows += (
                f'<div data-focus-region="nav_active" style="background:{accent}22;border-radius:5px;padding:4px 8px;'
                f'font-size:12px;color:{accent};font-weight:600;margin-bottom:2px;">{label}</div>'
            )
        else:
            rows += (
                f'<div style="padding:4px 8px;font-size:12px;color:{text_s};'
                f'margin-bottom:2px;">{label}</div>'
            )
    return (
        '<div style="width:120px;background:rgba(246,246,248,0.85);'
        'backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);'
        'border-right:1px solid rgba(0,0,0,0.08);padding:8px 6px;flex-shrink:0;">'
        + rows + '</div>'
    )


def _mac_window(tokens: dict[str, Any] | None, content: str, *, title: str = "Preview") -> str:
    """Wrap content in a macOS window chrome shell."""
    bg = _tok(tokens, "color", "bg")
    border = _tok(tokens, "color", "border")
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    font = "-apple-system, 'SF Pro Text', 'Helvetica Neue', sans-serif"
    sidebar = _sidebar_chrome(accent, text_p, text_s)
    return (
        f'<div style="font-family:{font};background:{bg};border:1px solid {border};'
        f'border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.12);">'
        # titlebar
        f'<div style="background:rgba(246,246,248,0.95);border-bottom:1px solid {border};'
        f'padding:8px 12px;display:flex;align-items:center;gap:8px;">'
        + _traffic_lights()
        + f'<span style="font-size:12px;color:{text_s};font-weight:500;'
          f'margin:0 auto;letter-spacing:-0.01em;">{title}</span>'
        + '</div>'
        # body: sidebar + main
        + f'<div style="display:flex;min-height:160px;">'
        + sidebar
        + f'<div style="flex:1;padding:10px 12px;overflow:hidden;">{content}</div>'
        + '</div></div>'
    )


# ---------------------------------------------------------------------------
# COLOR fragments
# ---------------------------------------------------------------------------

def _hf_macos_accent_cta_only(tokens: dict[str, Any] | None) -> str:
    oid = "accent-cta-only"
    accent = _tok(tokens, "color", "accent")
    bg = _tok(tokens, "color", "bg")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    border = _tok(tokens, "color", "border")
    rad = _radius_px(_tok(tokens, "radius", "button"))
    content = (
        f'<div style="font-size:12px;font-weight:600;color:{text_p};margin-bottom:8px;">Accent on CTA only</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">Interface chrome stays neutral — accent reserved for primary action.</div>'
        # neutral list row (no accent)
        f'<div style="border:1px solid {border};border-radius:7px;padding:7px 10px;margin-bottom:6px;">'
        f'<div style="font-size:12px;color:{text_p};">Document title</div>'
        f'<div style="font-size:10px;color:{text_s};">Modified 2 days ago</div>'
        f'</div>'
        f'<div style="border:1px solid {border};border-radius:7px;padding:7px 10px;margin-bottom:10px;">'
        f'<div style="font-size:12px;color:{text_p};">Another item</div>'
        f'<div style="font-size:10px;color:{text_s};">Modified today</div>'
        f'</div>'
        # accent only on CTA
        f'<div data-focus-region="cta_button" style="background:{accent};color:#fff;border-radius:{rad};padding:5px 12px;'
        f'font-size:11px;font-weight:600;text-align:center;">Open</div>'
    )
    return f'<div class="hf-macos-{oid}">{_mac_window(tokens, content, title="Accent: CTA only")}</div>'


def _hf_macos_accent_semantic(tokens: dict[str, Any] | None) -> str:
    oid = "accent-semantic"
    accent = _tok(tokens, "color", "accent")
    success = _tok(tokens, "color", "success")
    warning = _tok(tokens, "color", "warning")
    error = _tok(tokens, "color", "error")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    border = _tok(tokens, "color", "border")
    rad = _radius_px(_tok(tokens, "radius", "button"))
    # Calm Precision: status = text-color only, no background badges
    content = (
        f'<div style="font-size:12px;font-weight:600;color:{text_p};margin-bottom:8px;">Semantic color use</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">Status uses text color — no background pills.</div>'
        f'<div style="border:1px solid {border};border-radius:7px;padding:7px 10px;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;">'
        f'<span style="font-size:12px;color:{text_p};">Sync complete</span>'
        f'<span data-focus-region="accent_indicators" style="font-size:11px;color:{success};font-weight:500;">Active</span>'
        f'</div>'
        f'<div style="border:1px solid {border};border-radius:7px;padding:7px 10px;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;">'
        f'<span style="font-size:12px;color:{text_p};">Storage</span>'
        f'<span data-focus-region="accent_indicators" style="font-size:11px;color:{warning};font-weight:500;">Low</span>'
        f'</div>'
        f'<div style="border:1px solid {border};border-radius:7px;padding:7px 10px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">'
        f'<span style="font-size:12px;color:{text_p};">Connection</span>'
        f'<span data-focus-region="accent_indicators" style="font-size:11px;color:{error};font-weight:500;">Failed</span>'
        f'</div>'
        f'<div data-focus-region="cta_button" style="background:{accent};color:#fff;border-radius:{rad};padding:5px 12px;'
        f'font-size:11px;font-weight:600;text-align:center;">Retry</div>'
    )
    return f'<div class="hf-macos-{oid}">{_mac_window(tokens, content, title="Semantic Color")}</div>'


def _hf_macos_accent_expressive(tokens: dict[str, Any] | None) -> str:
    oid = "accent-expressive"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    content = (
        f'<div style="font-size:12px;font-weight:600;color:{text_p};margin-bottom:8px;">Expressive accent</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">Accent used across UI surfaces for brand presence.</div>'
        # accent-tinted section header
        f'<div data-focus-region="accent_indicators" style="font-size:11px;font-weight:600;color:{accent};text-transform:uppercase;'
        f'letter-spacing:0.04em;margin-bottom:6px;">Favorites</div>'
        f'<div data-focus-region="accent_indicators" style="border-left:3px solid {accent};padding:6px 10px;background:{accent}0D;'
        f'border-radius:0 {rad_card} {rad_card} 0;margin-bottom:8px;">'
        f'<div style="font-size:12px;color:{text_p};">Design tokens</div>'
        f'<div style="font-size:10px;color:{text_s};">Last edited just now</div>'
        f'</div>'
        f'<div data-focus-region="cta_button" style="background:{accent};color:#fff;border-radius:{rad_btn};padding:5px 12px;'
        f'font-size:11px;font-weight:600;text-align:center;">Open Collection</div>'
    )
    return f'<div class="hf-macos-{oid}">{_mac_window(tokens, content, title="Expressive Accent")}</div>'


def _hf_macos_dark_true_black(tokens: dict[str, Any] | None) -> str:
    oid = "dark-true-black"
    accent = _tok(tokens, "color", "accent")
    text_p = "#F5F5F7"
    text_s = "#8E8E93"
    border = "#2C2C2E"
    bg_dark = "#000000"
    surface_dark = "#1C1C1E"
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    content = (
        f'<div style="font-size:12px;font-weight:600;color:{text_p};margin-bottom:8px;">True Black dark mode</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">OLED-optimized: #000 bg, elevated surfaces at #1C1C1E.</div>'
        f'<div style="background:{surface_dark};border:1px solid {border};border-radius:{rad_card};'
        f'padding:7px 10px;margin-bottom:6px;">'
        f'<div style="font-size:12px;color:{text_p};">Vault entry</div>'
        f'<div style="font-size:10px;color:{text_s};">Updated 1 hour ago</div>'
        f'</div>'
        f'<div style="background:{surface_dark};border:1px solid {border};border-radius:{rad_card};'
        f'padding:7px 10px;margin-bottom:10px;">'
        f'<div style="font-size:12px;color:{text_p};">Another entry</div>'
        f'<div style="font-size:10px;color:{text_s};">Updated yesterday</div>'
        f'</div>'
        f'<div style="background:{accent};color:#fff;border-radius:{rad_btn};padding:5px 12px;'
        f'font-size:11px;font-weight:600;text-align:center;">New Entry</div>'
    )
    font = "-apple-system, 'SF Pro Text', 'Helvetica Neue', sans-serif"
    sidebar_items = (
        f'<div style="background:{accent}22;border-radius:5px;padding:4px 8px;'
        f'font-size:12px;color:{accent};font-weight:600;margin-bottom:2px;">Home</div>'
        f'<div style="padding:4px 8px;font-size:12px;color:{text_s};margin-bottom:2px;">Library</div>'
        f'<div style="padding:4px 8px;font-size:12px;color:{text_s};">Settings</div>'
    )
    sidebar = (
        f'<div style="width:120px;background:#111111;'
        f'border-right:1px solid {border};padding:8px 6px;flex-shrink:0;">'
        + sidebar_items + '</div>'
    )
    return (
        f'<div class="hf-macos-{oid}">'
        f'<div style="font-family:{font};background:{bg_dark};border:1px solid {border};'
        f'border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.5);">'
        f'<div style="background:#111111;border-bottom:1px solid {border};'
        f'padding:8px 12px;display:flex;align-items:center;gap:8px;">'
        + _traffic_lights()
        + f'<span style="font-size:12px;color:{text_s};font-weight:500;margin:0 auto;">True Black</span>'
        + f'</div>'
        f'<div style="display:flex;min-height:160px;">'
        + sidebar
        + f'<div style="flex:1;padding:10px 12px;background:{bg_dark};overflow:hidden;">{content}</div>'
        f'</div></div></div>'
    )


def _hf_macos_dark_elevated_layers(tokens: dict[str, Any] | None) -> str:
    oid = "dark-elevated-layers"
    accent = _tok(tokens, "color", "accent")
    text_p = "#F5F5F7"
    text_s = "#8E8E93"
    bg0 = "#1C1C1E"     # base
    bg1 = "#2C2C2E"     # raised card
    bg2 = "#3A3A3C"     # further raised
    border = "#3A3A3C"
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    content = (
        f'<div style="font-size:12px;font-weight:600;color:{text_p};margin-bottom:8px;">Elevated dark layers</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:8px;">Depth via luminance steps: base → card → popover.</div>'
        # Layer 1 card
        f'<div style="background:{bg1};border:1px solid {border};border-radius:{rad_card};padding:7px 10px;margin-bottom:4px;">'
        f'<div style="font-size:11px;font-weight:600;color:{text_p};margin-bottom:4px;">Card layer</div>'
        # Layer 2 inset
        f'<div style="background:{bg2};border-radius:5px;padding:5px 8px;">'
        f'<div style="font-size:10px;color:{text_s};">Inset popover layer</div>'
        f'</div></div>'
        f'<div style="background:{accent};color:#fff;border-radius:{rad_btn};padding:5px 12px;'
        f'font-size:11px;font-weight:600;text-align:center;margin-top:8px;">Action</div>'
    )
    font = "-apple-system, 'SF Pro Text', 'Helvetica Neue', sans-serif"
    sidebar_items = (
        f'<div style="background:{accent}22;border-radius:5px;padding:4px 8px;'
        f'font-size:12px;color:{accent};font-weight:600;margin-bottom:2px;">Home</div>'
        f'<div style="padding:4px 8px;font-size:12px;color:{text_s};margin-bottom:2px;">Library</div>'
        f'<div style="padding:4px 8px;font-size:12px;color:{text_s};">Settings</div>'
    )
    sidebar = (
        f'<div style="width:120px;background:#161618;'
        f'border-right:1px solid {border};padding:8px 6px;flex-shrink:0;">'
        + sidebar_items + '</div>'
    )
    return (
        f'<div class="hf-macos-{oid}">'
        f'<div style="font-family:{font};background:{bg0};border:1px solid {border};'
        f'border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.5);">'
        f'<div style="background:#161618;border-bottom:1px solid {border};'
        f'padding:8px 12px;display:flex;align-items:center;gap:8px;">'
        + _traffic_lights()
        + f'<span style="font-size:12px;color:{text_s};font-weight:500;margin:0 auto;">Elevated Layers</span>'
        + f'</div>'
        f'<div style="display:flex;min-height:160px;">'
        + sidebar
        + f'<div style="flex:1;padding:10px 12px;overflow:hidden;">{content}</div>'
        f'</div></div></div>'
    )


def _hf_macos_dark_deep_color(tokens: dict[str, Any] | None) -> str:
    oid = "dark-deep-color"
    accent = _tok(tokens, "color", "accent")
    text_p = "#F5F5F7"
    text_s = "#AEAEB2"
    border = "#3A3A3C"
    # Deep color: rich saturated dark bg derived from accent hue
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    content = (
        f'<div style="font-size:12px;font-weight:600;color:{text_p};margin-bottom:8px;">Deep color dark mode</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:8px;">Saturated bg tinted from accent — immersive, not harsh.</div>'
        f'<div style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);'
        f'border-radius:{rad_card};padding:7px 10px;margin-bottom:4px;">'
        f'<div style="font-size:12px;color:{text_p};">Creative project</div>'
        f'<div style="font-size:10px;color:{text_s};">3 collaborators</div>'
        f'</div>'
        f'<div style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);'
        f'border-radius:{rad_card};padding:7px 10px;margin-bottom:10px;">'
        f'<div style="font-size:12px;color:{text_p};">Another project</div>'
        f'<div style="font-size:10px;color:{text_s};">Solo</div>'
        f'</div>'
        f'<div style="background:{accent};color:#fff;border-radius:{rad_btn};padding:5px 12px;'
        f'font-size:11px;font-weight:600;text-align:center;">New Project</div>'
    )
    font = "-apple-system, 'SF Pro Text', 'Helvetica Neue', sans-serif"
    sidebar_items = (
        f'<div style="background:rgba(255,255,255,0.15);border-radius:5px;padding:4px 8px;'
        f'font-size:12px;color:{text_p};font-weight:600;margin-bottom:2px;">Home</div>'
        f'<div style="padding:4px 8px;font-size:12px;color:{text_s};margin-bottom:2px;">Projects</div>'
        f'<div style="padding:4px 8px;font-size:12px;color:{text_s};">Settings</div>'
    )
    sidebar = (
        f'<div style="width:120px;background:rgba(0,0,0,0.2);'
        f'border-right:1px solid rgba(255,255,255,0.08);padding:8px 6px;flex-shrink:0;">'
        + sidebar_items + '</div>'
    )
    return (
        f'<div class="hf-macos-{oid}">'
        f'<div style="font-family:{font};background:{accent}2A;border:1px solid {accent}44;'
        f'border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.4);">'
        f'<div style="background:{accent}1A;border-bottom:1px solid {accent}33;'
        f'padding:8px 12px;display:flex;align-items:center;gap:8px;">'
        + _traffic_lights()
        + f'<span style="font-size:12px;color:{text_s};font-weight:500;margin:0 auto;">Deep Color</span>'
        + f'</div>'
        f'<div style="display:flex;min-height:160px;">'
        + sidebar
        + f'<div style="flex:1;padding:10px 12px;overflow:hidden;">{content}</div>'
        f'</div></div></div>'
    )


def _hf_macos_dark_glass_layers(tokens: dict[str, Any] | None) -> str:
    oid = "dark-glass-layers"
    accent = _tok(tokens, "color", "accent")
    text_p = "#F5F5F7"
    text_s = "#AEAEB2"
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    content = (
        f'<div style="font-size:12px;font-weight:600;color:{text_p};margin-bottom:8px;">Glass layers — dark</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:8px;">NSVisualEffectView: frosted glass over dark wallpaper.</div>'
        f'<div style="background:rgba(255,255,255,0.10);backdrop-filter:blur(20px);'
        f'-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.18);'
        f'border-radius:{rad_card};padding:7px 10px;margin-bottom:4px;">'
        f'<div style="font-size:12px;color:{text_p};">Glass card</div>'
        f'<div style="font-size:10px;color:{text_s};">Frosted backdrop</div>'
        f'</div>'
        f'<div style="background:rgba(255,255,255,0.06);backdrop-filter:blur(12px);'
        f'-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.12);'
        f'border-radius:{rad_card};padding:7px 10px;margin-bottom:10px;">'
        f'<div style="font-size:12px;color:{text_p};">Deeper glass</div>'
        f'<div style="font-size:10px;color:{text_s};">Lower opacity</div>'
        f'</div>'
        # accent tint on CTA so token is always visible in output
        f'<div style="background:{accent}33;backdrop-filter:blur(20px);color:{accent};'
        f'border:1px solid {accent}55;border-radius:{rad_btn};padding:5px 12px;'
        f'font-size:11px;font-weight:600;text-align:center;">Glass CTA</div>'
    )
    font = "-apple-system, 'SF Pro Text', 'Helvetica Neue', sans-serif"
    sidebar_items = (
        # accent used for active sidebar item text + left-bar indicator
        f'<div style="border-left:2px solid {accent};padding:4px 6px;'
        f'font-size:12px;color:{accent};font-weight:600;margin-bottom:2px;">Home</div>'
        f'<div style="padding:4px 8px;font-size:12px;color:{text_s};margin-bottom:2px;">Library</div>'
        f'<div style="padding:4px 8px;font-size:12px;color:{text_s};">Settings</div>'
    )
    sidebar = (
        f'<div style="width:120px;background:rgba(255,255,255,0.05);backdrop-filter:blur(20px);'
        f'-webkit-backdrop-filter:blur(20px);border-right:1px solid rgba(255,255,255,0.10);'
        f'padding:8px 6px;flex-shrink:0;">' + sidebar_items + '</div>'
    )
    bg_gradient = f"linear-gradient(135deg, #1C1C2E 0%, #0D0D1A 100%)"
    return (
        f'<div class="hf-macos-{oid}">'
        f'<div style="font-family:{font};background:{bg_gradient};border:1px solid rgba(255,255,255,0.12);'
        f'border-radius:10px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.6);">'
        f'<div style="background:rgba(255,255,255,0.06);backdrop-filter:blur(20px);'
        f'border-bottom:1px solid rgba(255,255,255,0.10);'
        f'padding:8px 12px;display:flex;align-items:center;gap:8px;">'
        + _traffic_lights()
        + f'<span style="font-size:12px;color:{text_s};font-weight:500;margin:0 auto;">Glass Layers</span>'
        + f'</div>'
        f'<div style="display:flex;min-height:160px;">'
        + sidebar
        + f'<div style="flex:1;padding:10px 12px;overflow:hidden;">{content}</div>'
        f'</div></div></div>'
    )


def _hf_macos_gradient_linear(tokens: dict[str, Any] | None) -> str:
    oid = "gradient-linear"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    border = _tok(tokens, "color", "border")
    bg = _tok(tokens, "color", "bg")
    surface = _tok(tokens, "color", "surface")
    content = (
        f'<div style="font-size:12px;font-weight:600;color:{text_p};margin-bottom:8px;">Linear gradient</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:8px;">Top-to-bottom brand gradient on hero and CTA.</div>'
        # hero banner with linear gradient
        f'<div style="background:linear-gradient(to bottom, {accent}, {accent}99);'
        f'border-radius:{rad_card};padding:10px;margin-bottom:8px;text-align:center;">'
        f'<div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:2px;">Welcome back</div>'
        f'<div style="font-size:10px;color:rgba(255,255,255,0.8);">Your workspace is ready</div>'
        f'</div>'
        # neutral card below
        f'<div style="background:{surface};border:1px solid {border};border-radius:{rad_card};'
        f'padding:7px 10px;margin-bottom:8px;">'
        f'<div style="font-size:11px;color:{text_p};">Recent files</div>'
        f'</div>'
        f'<div style="background:linear-gradient(to bottom, {accent}, {accent}CC);color:#fff;'
        f'border-radius:{rad_btn};padding:5px 12px;font-size:11px;font-weight:600;text-align:center;">Get Started</div>'
    )
    return f'<div class="hf-macos-{oid}">{_mac_window(tokens, content, title="Linear Gradient")}</div>'


def _hf_macos_gradient_mesh(tokens: dict[str, Any] | None) -> str:
    oid = "gradient-mesh"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    # Mesh gradient: radial spots composited
    mesh_bg = (
        f"radial-gradient(ellipse at 20% 30%, {accent}33 0%, transparent 60%),"
        f"radial-gradient(ellipse at 80% 70%, {accent}55 0%, transparent 50%),"
        f"linear-gradient(135deg, {surface} 0%, #fff 100%)"
    )
    content = (
        f'<div style="font-size:12px;font-weight:600;color:{text_p};margin-bottom:8px;">Mesh gradient</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:8px;">Multi-point radial gradient for organic depth.</div>'
        f'<div style="background:{mesh_bg};border-radius:{rad_card};padding:10px;margin-bottom:8px;">'
        f'<div style="font-size:13px;font-weight:600;color:{text_p};margin-bottom:2px;">Mesh hero</div>'
        f'<div style="font-size:10px;color:{text_s};">Organic color depth</div>'
        f'</div>'
        f'<div style="background:{accent};color:#fff;border-radius:{rad_btn};padding:5px 12px;'
        f'font-size:11px;font-weight:600;text-align:center;">Explore</div>'
    )
    return f'<div class="hf-macos-{oid}">{_mac_window(tokens, content, title="Mesh Gradient")}</div>'


def _hf_macos_gradient_duotone(tokens: dict[str, Any] | None) -> str:
    oid = "gradient-duotone"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    # Duotone: accent + complementary warm tone
    warm = "#FF6B35"
    content = (
        f'<div style="font-size:12px;font-weight:600;color:{text_p};margin-bottom:8px;">Duotone gradient</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:8px;">Two-tone: accent + warm complement.</div>'
        f'<div style="background:linear-gradient(135deg, {accent} 0%, {warm} 100%);'
        f'border-radius:{rad_card};padding:10px;margin-bottom:8px;">'
        f'<div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:2px;">Duotone header</div>'
        f'<div style="font-size:10px;color:rgba(255,255,255,0.85);">Accent to warm</div>'
        f'</div>'
        f'<div style="background:linear-gradient(135deg, {accent} 0%, {warm} 100%);color:#fff;'
        f'border-radius:{rad_btn};padding:5px 12px;font-size:11px;font-weight:600;text-align:center;">Create</div>'
    )
    return f'<div class="hf-macos-{oid}">{_mac_window(tokens, content, title="Duotone Gradient")}</div>'


def _hf_macos_gradient_none(tokens: dict[str, Any] | None) -> str:
    oid = "gradient-none"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    content = (
        f'<div style="font-size:12px;font-weight:600;color:{text_p};margin-bottom:8px;">No gradient</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:8px;">Flat solid fills only — maximum legibility, Calm Precision default.</div>'
        f'<div style="background:{surface};border:1px solid {border};border-radius:{rad_card};'
        f'padding:7px 10px;margin-bottom:4px;">'
        f'<div style="font-size:12px;color:{text_p};">Item one</div>'
        f'<div style="font-size:10px;color:{text_s};">Flat surface</div>'
        f'</div>'
        f'<div style="background:{surface};border:1px solid {border};border-radius:{rad_card};'
        f'padding:7px 10px;margin-bottom:10px;">'
        f'<div style="font-size:12px;color:{text_p};">Item two</div>'
        f'<div style="font-size:10px;color:{text_s};">Flat surface</div>'
        f'</div>'
        f'<div style="background:{accent};color:#fff;border-radius:{rad_btn};padding:5px 12px;'
        f'font-size:11px;font-weight:600;text-align:center;">Action</div>'
    )
    return f'<div class="hf-macos-{oid}">{_mac_window(tokens, content, title="No Gradient")}</div>'


# ---------------------------------------------------------------------------
# ELEVATION / DEPTH fragments
# ---------------------------------------------------------------------------

def _hf_macos_btn_flat(tokens: dict[str, Any] | None) -> str:
    oid = "btn-flat"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    content = (
        f'<div style="font-size:12px;font-weight:600;color:{text_p};margin-bottom:8px;">Flat button</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">Solid fill, no shadow — zero depth elevation.</div>'
        f'<div style="background:{surface};border:1px solid {border};border-radius:{rad_card};'
        f'padding:7px 10px;margin-bottom:10px;">'
        f'<div style="font-size:12px;color:{text_p};">Content area</div>'
        f'<div style="font-size:10px;color:{text_s};">Below the button</div>'
        f'</div>'
        # flat: solid accent, no shadow
        f'<div data-focus-region="primary_button" style="background:{accent};color:#fff;border-radius:{rad_btn};padding:5px 12px;'
        f'font-size:11px;font-weight:600;text-align:center;box-shadow:none;">Flat Action</div>'
    )
    return f'<div class="hf-macos-{oid}">{_mac_window(tokens, content, title="Flat Button")}</div>'


def _hf_macos_btn_soft_shadow(tokens: dict[str, Any] | None) -> str:
    oid = "btn-soft-shadow"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    # macOS soft shadow: restrained — 0 2px 6px is the HIG upper bound for buttons
    content = (
        f'<div style="font-size:12px;font-weight:600;color:{text_p};margin-bottom:8px;">Soft shadow button</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">Restrained macOS depth — 2px offset, low spread.</div>'
        f'<div style="background:{surface};border:1px solid {border};border-radius:{rad_card};'
        f'padding:7px 10px;margin-bottom:10px;">'
        f'<div style="font-size:12px;color:{text_p};">Content area</div>'
        f'</div>'
        f'<div data-focus-region="primary_button" style="background:{accent};color:#fff;border-radius:{rad_btn};padding:5px 12px;'
        f'font-size:11px;font-weight:600;text-align:center;'
        f'box-shadow:0 2px 6px {accent}55;">Soft Shadow</div>'
    )
    return f'<div class="hf-macos-{oid}">{_mac_window(tokens, content, title="Soft Shadow")}</div>'


def _hf_macos_btn_inner_highlight(tokens: dict[str, Any] | None) -> str:
    oid = "btn-inner-highlight"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    content = (
        f'<div style="font-size:12px;font-weight:600;color:{text_p};margin-bottom:8px;">Inner highlight button</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">Inset top-edge highlight gives depth without external shadow.</div>'
        f'<div style="background:{surface};border:1px solid {border};border-radius:{rad_card};'
        f'padding:7px 10px;margin-bottom:10px;">'
        f'<div style="font-size:12px;color:{text_p};">Content area</div>'
        f'</div>'
        # inner highlight: inset shadow top white + outer bottom shade
        f'<div data-focus-region="primary_button" style="background:linear-gradient(to bottom, {accent}EE, {accent});color:#fff;'
        f'border-radius:{rad_btn};padding:5px 12px;font-size:11px;font-weight:600;text-align:center;'
        f'box-shadow:inset 0 1px 0 rgba(255,255,255,0.25), 0 1px 2px rgba(0,0,0,0.18);">'
        f'Highlighted</div>'
    )
    return f'<div class="hf-macos-{oid}">{_mac_window(tokens, content, title="Inner Highlight")}</div>'


def _hf_macos_btn_glass(tokens: dict[str, Any] | None) -> str:
    oid = "btn-glass"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    content = (
        f'<div style="font-size:12px;font-weight:600;color:{text_p};margin-bottom:8px;">Glass button</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">Frosted glass CTA — vibrancy-style translucent fill.</div>'
        f'<div style="background:{surface};border:1px solid {border};border-radius:{rad_card};'
        f'padding:7px 10px;margin-bottom:10px;">'
        f'<div style="font-size:12px;color:{text_p};">Content below</div>'
        f'</div>'
        f'<div data-focus-region="primary_button" style="background:rgba(255,255,255,0.30);backdrop-filter:blur(16px);'
        f'-webkit-backdrop-filter:blur(16px);'
        f'border:1px solid rgba(255,255,255,0.50);color:{accent};'
        f'border-radius:{rad_btn};padding:5px 12px;font-size:11px;font-weight:600;'
        f'text-align:center;">Glass Action</div>'
    )
    return f'<div class="hf-macos-{oid}">{_mac_window(tokens, content, title="Glass Button")}</div>'


# ---------------------------------------------------------------------------
# MOTION fragments — CSS animation via inline <style>
# ---------------------------------------------------------------------------

def _hf_macos_press_scale_down(tokens: dict[str, Any] | None) -> str:
    oid = "press-scale-down"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    anim = f"hf-macos-{oid}-press"
    content = (
        f'<style>'
        f'.hf-macos-{oid} .mac-press-btn {{'
        f'  animation:{anim} 0.6s ease-in-out infinite;'
        f'  background:{accent};color:#fff;border-radius:{rad_btn};padding:5px 12px;'
        f'  font-size:11px;font-weight:600;text-align:center;display:inline-block;cursor:pointer;}}'
        f'@keyframes {anim} {{'
        f'  0%,100% {{transform:scale(1);}}'
        f'  40% {{transform:scale(0.96);}}'
        f'  60% {{transform:scale(0.96);}}'
        f'}}'
        f'</style>'
        f'<div style="font-size:12px;font-weight:600;color:{text_p};margin-bottom:8px;">Press: scale down</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">Button shrinks to 96% on press — tactile feedback for pointer.</div>'
        f'<div style="background:{surface};border:1px solid {border};border-radius:7px;'
        f'padding:7px 10px;margin-bottom:10px;">'
        f'<div style="font-size:11px;color:{text_p};">Content card</div>'
        f'</div>'
        f'<div class="mac-press-btn">Click Me</div>'
    )
    return f'<div class="hf-macos-{oid}">{_mac_window(tokens, content, title="Press: Scale")}</div>'


def _hf_macos_press_opacity_dim(tokens: dict[str, Any] | None) -> str:
    oid = "press-opacity-dim"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    anim = f"hf-macos-{oid}-dim"
    content = (
        f'<style>'
        f'.hf-macos-{oid} .mac-dim-btn {{'
        f'  animation:{anim} 0.6s ease-in-out infinite;'
        f'  background:{accent};color:#fff;border-radius:{rad_btn};padding:5px 12px;'
        f'  font-size:11px;font-weight:600;text-align:center;display:inline-block;}}'
        f'@keyframes {anim} {{'
        f'  0%,100% {{opacity:1;}}'
        f'  40% {{opacity:0.65;}}'
        f'  60% {{opacity:0.65;}}'
        f'}}'
        f'</style>'
        f'<div style="font-size:12px;font-weight:600;color:{text_p};margin-bottom:8px;">Press: opacity dim</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">Button dims to 65% opacity on press — lightweight feedback.</div>'
        f'<div style="background:{surface};border:1px solid {border};border-radius:7px;'
        f'padding:7px 10px;margin-bottom:10px;">'
        f'<div style="font-size:11px;color:{text_p};">Content card</div>'
        f'</div>'
        f'<div class="mac-dim-btn">Click Me</div>'
    )
    return f'<div class="hf-macos-{oid}">{_mac_window(tokens, content, title="Press: Dim")}</div>'


def _hf_macos_press_highlight_bg(tokens: dict[str, Any] | None) -> str:
    oid = "press-highlight-bg"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    anim = f"hf-macos-{oid}-flash"
    content = (
        f'<style>'
        f'.hf-macos-{oid} .mac-flash-btn {{'
        f'  animation:{anim} 0.6s ease-in-out infinite;'
        f'  background:{accent};color:#fff;border-radius:{rad_btn};padding:5px 12px;'
        f'  font-size:11px;font-weight:600;text-align:center;display:inline-block;}}'
        f'@keyframes {anim} {{'
        f'  0%,100% {{background:{accent};}}'
        f'  40% {{background:{accent}CC;}}'
        f'  60% {{background:{accent}CC;}}'
        f'}}'
        f'</style>'
        f'<div style="font-size:12px;font-weight:600;color:{text_p};margin-bottom:8px;">Press: highlight bg</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">Background brightens slightly on press — subtle affirmation.</div>'
        f'<div style="background:{surface};border:1px solid {border};border-radius:7px;'
        f'padding:7px 10px;margin-bottom:10px;">'
        f'<div style="font-size:11px;color:{text_p};">Content card</div>'
        f'</div>'
        f'<div class="mac-flash-btn">Click Me</div>'
    )
    return f'<div class="hf-macos-{oid}">{_mac_window(tokens, content, title="Press: Highlight")}</div>'


def _hf_macos_transition_push_slide(tokens: dict[str, Any] | None) -> str:
    oid = "transition-push-slide"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    anim = f"hf-macos-{oid}-slide"
    content = (
        f'<style>'
        f'.hf-macos-{oid} .mac-slide-panel {{'
        f'  animation:{anim} 1.6s ease-in-out infinite;'
        f'  background:{surface};border:1px solid {border};border-radius:{rad_card};'
        f'  padding:8px 10px;overflow:hidden;}}'
        f'@keyframes {anim} {{'
        f'  0%,100% {{transform:translateX(0);opacity:1;}}'
        f'  40% {{transform:translateX(-8px);opacity:0;}}'
        f'  50% {{transform:translateX(8px);opacity:0;}}'
        f'  90% {{transform:translateX(0);opacity:1;}}'
        f'}}'
        f'</style>'
        f'<div style="font-size:12px;font-weight:600;color:{text_p};margin-bottom:8px;">Push/slide transition</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:8px;">Panel exits left, enters from right — directional nav.</div>'
        f'<div class="mac-slide-panel">'
        f'<div style="font-size:12px;color:{text_p};font-weight:600;">Next screen</div>'
        f'<div style="font-size:10px;color:{text_s};">Slides in from right</div>'
        f'</div>'
    )
    return f'<div class="hf-macos-{oid}">{_mac_window(tokens, content, title="Push Slide")}</div>'


def _hf_macos_transition_fade(tokens: dict[str, Any] | None) -> str:
    oid = "transition-fade"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    anim = f"hf-macos-{oid}-fadein"
    content = (
        f'<style>'
        f'.hf-macos-{oid} .mac-fade-panel {{'
        f'  animation:{anim} 1.6s ease-in-out infinite;'
        f'  background:{surface};border:1px solid {border};border-radius:{rad_card};padding:8px 10px;}}'
        f'@keyframes {anim} {{'
        f'  0%,100% {{opacity:1;}}'
        f'  40% {{opacity:0;}}'
        f'  60% {{opacity:0;}}'
        f'}}'
        f'</style>'
        f'<div style="font-size:12px;font-weight:600;color:{text_p};margin-bottom:8px;">Fade transition</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:8px;">Cross-dissolve — neutral, no direction implied.</div>'
        f'<div class="mac-fade-panel">'
        f'<div style="font-size:12px;color:{text_p};font-weight:600;">Screen content</div>'
        f'<div style="font-size:10px;color:{text_s};">Fades out and back in</div>'
        f'</div>'
    )
    return f'<div class="hf-macos-{oid}">{_mac_window(tokens, content, title="Fade Transition")}</div>'


def _hf_macos_skeleton_shimmer_ltr(tokens: dict[str, Any] | None) -> str:
    oid = "skeleton-shimmer-ltr"
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    anim = f"hf-macos-{oid}-shimmer"
    content = (
        f'<style>'
        f'.hf-macos-{oid} .mac-skel {{'
        f'  background:linear-gradient(90deg, {surface} 25%, rgba(255,255,255,0.8) 50%, {surface} 75%);'
        f'  background-size:200% 100%;'
        f'  animation:{anim} 1.4s ease-in-out infinite;'
        f'  border-radius:4px;height:10px;margin-bottom:6px;}}'
        f'@keyframes {anim} {{'
        f'  0% {{background-position:200% 0;}}'
        f'  100% {{background-position:-200% 0;}}'
        f'}}'
        f'</style>'
        f'<div style="font-size:12px;font-weight:600;color:{text_p};margin-bottom:8px;">Skeleton: shimmer LTR</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:8px;">Left-to-right shimmer while content loads.</div>'
        f'<div style="background:{surface};border:1px solid {border};border-radius:{rad_card};padding:8px 10px;">'
        f'<div class="mac-skel" style="width:60%;"></div>'
        f'<div class="mac-skel" style="width:85%;"></div>'
        f'<div class="mac-skel" style="width:40%;margin-bottom:0;"></div>'
        f'</div>'
    )
    return f'<div class="hf-macos-{oid}">{_mac_window(tokens, content, title="Shimmer LTR")}</div>'


def _hf_macos_skeleton_pulse(tokens: dict[str, Any] | None) -> str:
    oid = "skeleton-pulse"
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    anim = f"hf-macos-{oid}-pulse"
    content = (
        f'<style>'
        f'.hf-macos-{oid} .mac-pulse-skel {{'
        f'  background:{surface};border-radius:4px;height:10px;margin-bottom:6px;'
        f'  animation:{anim} 1.2s ease-in-out infinite;}}'
        f'@keyframes {anim} {{'
        f'  0%,100% {{opacity:0.5;}}'
        f'  50% {{opacity:1;}}'
        f'}}'
        f'</style>'
        f'<div style="font-size:12px;font-weight:600;color:{text_p};margin-bottom:8px;">Skeleton: pulse</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:8px;">Opacity pulse — minimal, no directional cue.</div>'
        f'<div style="background:{surface};border:1px solid {border};border-radius:{rad_card};padding:8px 10px;">'
        f'<div class="mac-pulse-skel" style="width:55%;"></div>'
        f'<div class="mac-pulse-skel" style="width:80%;"></div>'
        f'<div class="mac-pulse-skel" style="width:45%;margin-bottom:0;"></div>'
        f'</div>'
    )
    return f'<div class="hf-macos-{oid}">{_mac_window(tokens, content, title="Skeleton Pulse")}</div>'


def _hf_macos_ptr_native_spinner(tokens: dict[str, Any] | None) -> str:
    oid = "ptr-native-spinner"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    anim = f"hf-macos-{oid}-spin"
    content = (
        f'<style>'
        f'.hf-macos-{oid} .mac-spinner {{'
        f'  width:16px;height:16px;border:2px solid {border};'
        f'  border-top-color:{accent};border-radius:50%;'
        f'  animation:{anim} 0.8s linear infinite;display:inline-block;}}'
        f'@keyframes {anim} {{to {{transform:rotate(360deg);}}}}'
        f'</style>'
        f'<div style="font-size:12px;font-weight:600;color:{text_p};margin-bottom:8px;">Pull-to-refresh: native spinner</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:8px;">NSProgressIndicator-style spinner for pull-to-refresh loading.</div>'
        f'<div style="text-align:center;padding:10px 0;margin-bottom:8px;">'
        f'<div class="mac-spinner"></div>'
        f'<div style="font-size:10px;color:{text_s};margin-top:4px;">Loading…</div>'
        f'</div>'
        f'<div style="background:{surface};border:1px solid {border};border-radius:{rad_card};padding:7px 10px;">'
        f'<div style="font-size:11px;color:{text_p};">Content below spinner</div>'
        f'</div>'
    )
    return f'<div class="hf-macos-{oid}">{_mac_window(tokens, content, title="Native Spinner")}</div>'


# ---------------------------------------------------------------------------
# Dispatch table
# ---------------------------------------------------------------------------

_MACOS_RENDERERS: dict[str, object] = {
    "accent-cta-only":          _hf_macos_accent_cta_only,
    "accent-semantic":          _hf_macos_accent_semantic,
    "accent-expressive":        _hf_macos_accent_expressive,
    "dark-true-black":          _hf_macos_dark_true_black,
    "dark-elevated-layers":     _hf_macos_dark_elevated_layers,
    "dark-deep-color":          _hf_macos_dark_deep_color,
    "dark-glass-layers":        _hf_macos_dark_glass_layers,
    "gradient-linear":          _hf_macos_gradient_linear,
    "gradient-mesh":            _hf_macos_gradient_mesh,
    "gradient-duotone":         _hf_macos_gradient_duotone,
    "gradient-none":            _hf_macos_gradient_none,
    "btn-flat":                 _hf_macos_btn_flat,
    "btn-soft-shadow":          _hf_macos_btn_soft_shadow,
    "btn-inner-highlight":      _hf_macos_btn_inner_highlight,
    "btn-glass":                _hf_macos_btn_glass,
    "press-scale-down":         _hf_macos_press_scale_down,
    "press-opacity-dim":        _hf_macos_press_opacity_dim,
    "press-highlight-bg":       _hf_macos_press_highlight_bg,
    "transition-push-slide":    _hf_macos_transition_push_slide,
    "transition-fade":          _hf_macos_transition_fade,
    "skeleton-shimmer-ltr":     _hf_macos_skeleton_shimmer_ltr,
    "skeleton-pulse":           _hf_macos_skeleton_pulse,
    "ptr-native-spinner":       _hf_macos_ptr_native_spinner,
}

# iOS-platform-only ids: macOS returns None for these (correct fallback to low-fi)
_IOS_ONLY_IDS: frozenset[str] = frozenset({
    "haptic-on-confirm", "haptic-on-error", "haptic-none",
    "splash-logo-morph", "splash-fade", "splash-none",
    "onboard-scroll-reveal", "onboard-page-dots", "onboard-none",
    "celebrate-confetti", "celebrate-checkmark", "celebrate-none",
})

MACOS_HIGH_FI_IDS: frozenset[str] = frozenset(_MACOS_RENDERERS.keys())


def has_macos_high_fi(option_id: str) -> bool:
    """Return True if a high-fi macOS fragment exists for this option_id."""
    return option_id in MACOS_HIGH_FI_IDS


def render_macos_high_fi(option_id: str, tokens: dict[str, Any] | None = None) -> str | None:
    """Render a high-fidelity macOS HTML fragment for the given option_id.

    Returns None when:
    - option_id is iOS-platform-only (caller falls back to low-fi).
    - option_id is not in the high-fi catalog.

    The returned HTML is self-contained: inline <style> with all selectors
    scoped under .hf-macos-<optid> and unique @keyframes names.
    """
    if option_id in _IOS_ONLY_IDS:
        return None
    fn = _MACOS_RENDERERS.get(option_id)
    if fn is None:
        return None
    return fn(tokens)  # type: ignore[operator]
