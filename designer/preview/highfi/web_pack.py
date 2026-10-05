"""High-fidelity web preview fragments.

Each fragment is a self-contained HTML string showing how a web UI renders a
particular design dimension (color, elevation/depth, motion).

Rules:
- Wrap in <div class="hf-web-<optid>">; all CSS selectors prefixed by it.
- Every @keyframes uniquely named hf-web-<optid>-<anim>.
- Token-parameterized: changing a token must change rendered output.
- Web platform truth: CSS box-shadow elevation, gradient CTAs, @keyframes motion,
  Inter/system-ui font, top-nav bar with underline active state.
- Calm Precision: status = text-color only (no background badges), content >= chrome,
  single border around groups not individual items. 4.5:1 contrast minimum.

Pure stdlib. No deps, no network, no vendor SDK.
"""

from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# Token accessor
# ---------------------------------------------------------------------------

def _t(tokens: dict[str, Any] | None, group: str, key: str, fallback: Any = "") -> Any:
    if not tokens:
        return fallback
    return tokens.get(group, {}).get(key, fallback)


# ---------------------------------------------------------------------------
# Web floor defaults (Calm Precision 6.4.2 grounded)
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
        "button": 8,
    },
    "spacing": {
        "density": "comfortable",
    },
    "typography": {
        "fontFamily": "'Inter', system-ui, sans-serif",
    },
}


def _tok(tokens: dict[str, Any] | None, group: str, key: str) -> Any:
    val = _t(tokens, group, key, None)
    if val is not None:
        return val
    return _DEFAULTS.get(group, {}).get(key, "")


def _radius_px(r: Any) -> str:
    if isinstance(r, int):
        return f"{r}px"
    return str(r) if r else "8px"


# ---------------------------------------------------------------------------
# Shared web chrome shell
# ---------------------------------------------------------------------------

def _top_nav(accent: str, text_p: str, text_s: str, border: str) -> str:
    """Top navigation bar with Calm Precision active state: underline, no pill bg."""
    return (
        f'<div style="border-bottom:1px solid {border};padding:0 16px;'
        f'display:flex;align-items:center;gap:20px;background:inherit;">'
        f'<span style="font-size:13px;font-weight:700;color:{text_p};margin-right:auto;">App</span>'
        f'<span data-focus-region="nav_active" style="font-size:12px;color:{text_p};font-weight:600;'
        f'border-bottom:2px solid {accent};padding:10px 0;">Home</span>'
        f'<span style="font-size:12px;color:{text_s};padding:10px 0;">Explore</span>'
        f'<span style="font-size:12px;color:{text_s};padding:10px 0;">Settings</span>'
        f'</div>'
    )


def _web_shell(tokens: dict[str, Any] | None, content: str, *, title: str = "Preview") -> str:
    """Wrap content in a web browser chrome shell."""
    bg = _tok(tokens, "color", "bg")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    font = _tok(tokens, "typography", "fontFamily") or "'Inter', system-ui, sans-serif"
    nav = _top_nav(accent, text_p, text_s, border)
    return (
        f'<div style="font-family:{font};background:{bg};border:1px solid {border};'
        f'border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">'
        # browser address bar simulation
        f'<div style="background:{surface};border-bottom:1px solid {border};'
        f'padding:6px 12px;display:flex;align-items:center;gap:8px;">'
        f'<div style="display:flex;gap:4px;">'
        f'<div style="width:10px;height:10px;border-radius:50%;background:#FF5F57;"></div>'
        f'<div style="width:10px;height:10px;border-radius:50%;background:#FEBC2E;"></div>'
        f'<div style="width:10px;height:10px;border-radius:50%;background:#28C840;"></div>'
        f'</div>'
        f'<div style="flex:1;background:#fff;border:1px solid {border};border-radius:4px;'
        f'padding:2px 8px;font-size:10px;color:{text_s};">app.example.com</div>'
        f'</div>'
        # top nav
        + nav
        # main content
        + f'<div style="padding:12px 16px;min-height:160px;">{content}</div>'
        + '</div>'
    )


# ---------------------------------------------------------------------------
# COLOR fragments
# ---------------------------------------------------------------------------

def _hf_web_accent_cta_only(tokens: dict[str, Any] | None) -> str:
    oid = "accent-cta-only"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    content = (
        f'<div style="font-size:13px;font-weight:600;color:{text_p};margin-bottom:6px;">Accent reserved for CTA</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">Chrome stays neutral; accent only on the primary button.</div>'
        f'<div style="border:1px solid {border};border-radius:{rad_card};padding:10px 12px;margin-bottom:6px;">'
        f'<div style="font-size:12px;color:{text_p};">Dashboard overview</div>'
        f'<div style="font-size:10px;color:{text_s};">Updated 2 hours ago</div>'
        f'</div>'
        f'<div style="border:1px solid {border};border-radius:{rad_card};padding:10px 12px;margin-bottom:12px;">'
        f'<div style="font-size:12px;color:{text_p};">Recent activity</div>'
        f'<div style="font-size:10px;color:{text_s};">3 new items</div>'
        f'</div>'
        f'<button data-focus-region="cta_button" style="background:{accent};color:#fff;border:none;border-radius:{rad_btn};'
        f'padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;">Get Started</button>'
    )
    return f'<div class="hf-web-{oid}">{_web_shell(tokens, content, title="Accent: CTA only")}</div>'


def _hf_web_accent_semantic(tokens: dict[str, Any] | None) -> str:
    oid = "accent-semantic"
    accent = _tok(tokens, "color", "accent")
    success = _tok(tokens, "color", "success")
    warning = _tok(tokens, "color", "warning")
    error = _tok(tokens, "color", "error")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    # Calm Precision: status text-color only
    content = (
        f'<div style="font-size:13px;font-weight:600;color:{text_p};margin-bottom:6px;">Semantic color</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">Status via text color — no background pills per Calm Precision.</div>'
        f'<div style="border:1px solid {border};border-radius:{rad_card};padding:10px 12px;margin-bottom:4px;'
        f'display:flex;justify-content:space-between;align-items:center;">'
        f'<span style="font-size:12px;color:{text_p};">API service</span>'
        f'<span data-focus-region="accent_indicators" style="font-size:11px;color:{success};font-weight:500;">Operational</span>'
        f'</div>'
        f'<div style="border:1px solid {border};border-radius:{rad_card};padding:10px 12px;margin-bottom:4px;'
        f'display:flex;justify-content:space-between;align-items:center;">'
        f'<span style="font-size:12px;color:{text_p};">Storage quota</span>'
        f'<span data-focus-region="accent_indicators" style="font-size:11px;color:{warning};font-weight:500;">80% used</span>'
        f'</div>'
        f'<div style="border:1px solid {border};border-radius:{rad_card};padding:10px 12px;margin-bottom:12px;'
        f'display:flex;justify-content:space-between;align-items:center;">'
        f'<span style="font-size:12px;color:{text_p};">Build pipeline</span>'
        f'<span data-focus-region="accent_indicators" style="font-size:11px;color:{error};font-weight:500;">Failed</span>'
        f'</div>'
        f'<button data-focus-region="cta_button" style="background:{accent};color:#fff;border:none;border-radius:{rad_btn};'
        f'padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;">Resolve</button>'
    )
    return f'<div class="hf-web-{oid}">{_web_shell(tokens, content, title="Semantic Color")}</div>'


def _hf_web_accent_expressive(tokens: dict[str, Any] | None) -> str:
    oid = "accent-expressive"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    border = _tok(tokens, "color", "border")
    surface = _tok(tokens, "color", "surface")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    content = (
        f'<div style="font-size:13px;font-weight:600;color:{text_p};margin-bottom:6px;">Expressive accent</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">Accent present throughout: links, section headers, indicators.</div>'
        f'<div data-focus-region="accent_indicators" style="font-size:11px;font-weight:600;color:{accent};text-transform:uppercase;'
        f'letter-spacing:0.06em;margin-bottom:8px;">Featured</div>'
        f'<div data-focus-region="accent_indicators" style="border-left:4px solid {accent};padding:8px 12px;background:{accent}0D;'
        f'border-radius:0 {rad_card} {rad_card} 0;margin-bottom:8px;">'
        f'<div style="font-size:12px;color:{text_p};font-weight:600;">Highlighted item</div>'
        f'<div style="font-size:10px;color:{text_s};">Accent used as structural signal</div>'
        f'</div>'
        f'<div style="border:1px solid {border};border-radius:{rad_card};padding:10px 12px;margin-bottom:12px;">'
        f'<div style="font-size:12px;color:{text_p};">Regular item</div>'
        f'</div>'
        f'<button data-focus-region="cta_button" style="background:{accent};color:#fff;border:none;border-radius:{rad_btn};'
        f'padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;">Explore</button>'
    )
    return f'<div class="hf-web-{oid}">{_web_shell(tokens, content, title="Expressive")}</div>'


def _hf_web_dark_true_black(tokens: dict[str, Any] | None) -> str:
    oid = "dark-true-black"
    accent = _tok(tokens, "color", "accent")
    text_p = "#F5F5F7"
    text_s = "#8E8E93"
    border = "#2C2C2E"
    bg_dark = "#000000"
    surface_dark = "#1C1C1E"
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    font = _tok(tokens, "typography", "fontFamily") or "'Inter', system-ui, sans-serif"
    nav = (
        f'<div style="border-bottom:1px solid {border};padding:0 16px;'
        f'display:flex;align-items:center;gap:20px;background:{surface_dark};">'
        f'<span style="font-size:13px;font-weight:700;color:{text_p};margin-right:auto;">App</span>'
        f'<span style="font-size:12px;color:{text_p};font-weight:600;'
        f'border-bottom:2px solid {accent};padding:10px 0;">Home</span>'
        f'<span style="font-size:12px;color:{text_s};padding:10px 0;">Explore</span>'
        f'<span style="font-size:12px;color:{text_s};padding:10px 0;">Settings</span>'
        f'</div>'
    )
    content = (
        f'<div style="font-size:13px;font-weight:600;color:{text_p};margin-bottom:6px;">True black dark mode</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">OLED-optimized #000 bg, cards at #1C1C1E.</div>'
        f'<div style="background:{surface_dark};border:1px solid {border};border-radius:{rad_card};'
        f'padding:10px 12px;margin-bottom:6px;">'
        f'<div style="font-size:12px;color:{text_p};">Content card</div>'
        f'<div style="font-size:10px;color:{text_s};">Elevated surface</div>'
        f'</div>'
        f'<div style="background:{surface_dark};border:1px solid {border};border-radius:{rad_card};'
        f'padding:10px 12px;margin-bottom:12px;">'
        f'<div style="font-size:12px;color:{text_p};">Another card</div>'
        f'</div>'
        f'<button style="background:{accent};color:#fff;border:none;border-radius:{rad_btn};'
        f'padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;">Action</button>'
    )
    return (
        f'<div class="hf-web-{oid}">'
        f'<div style="font-family:{font};background:{bg_dark};border:1px solid {border};'
        f'border-radius:8px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.6);">'
        f'<div style="background:{surface_dark};border-bottom:1px solid {border};'
        f'padding:6px 12px;display:flex;align-items:center;gap:8px;">'
        f'<div style="display:flex;gap:4px;">'
        f'<div style="width:10px;height:10px;border-radius:50%;background:#FF5F57;"></div>'
        f'<div style="width:10px;height:10px;border-radius:50%;background:#FEBC2E;"></div>'
        f'<div style="width:10px;height:10px;border-radius:50%;background:#28C840;"></div>'
        f'</div>'
        f'<div style="flex:1;background:{border};border:1px solid {border};border-radius:4px;'
        f'padding:2px 8px;font-size:10px;color:{text_s};">app.example.com</div>'
        f'</div>'
        + nav
        + f'<div style="padding:12px 16px;min-height:160px;">{content}</div>'
        + '</div></div>'
    )


def _hf_web_dark_elevated_layers(tokens: dict[str, Any] | None) -> str:
    oid = "dark-elevated-layers"
    accent = _tok(tokens, "color", "accent")
    text_p = "#F5F5F7"
    text_s = "#8E8E93"
    bg0 = "#1C1C1E"
    bg1 = "#2C2C2E"
    bg2 = "#3A3A3C"
    border = "#3A3A3C"
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    font = _tok(tokens, "typography", "fontFamily") or "'Inter', system-ui, sans-serif"
    nav = (
        f'<div style="border-bottom:1px solid {border};padding:0 16px;'
        f'display:flex;align-items:center;gap:20px;background:{bg1};">'
        f'<span style="font-size:13px;font-weight:700;color:{text_p};margin-right:auto;">App</span>'
        f'<span style="font-size:12px;color:{text_p};font-weight:600;'
        f'border-bottom:2px solid {accent};padding:10px 0;">Home</span>'
        f'<span style="font-size:12px;color:{text_s};padding:10px 0;">Explore</span>'
        f'</div>'
    )
    content = (
        f'<div style="font-size:13px;font-weight:600;color:{text_p};margin-bottom:6px;">Elevated dark layers</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">Luminance step depth: base → card → inset.</div>'
        f'<div style="background:{bg1};border:1px solid {border};border-radius:{rad_card};padding:10px 12px;margin-bottom:6px;">'
        f'<div style="font-size:12px;color:{text_p};font-weight:600;margin-bottom:6px;">Card layer</div>'
        f'<div style="background:{bg2};border-radius:6px;padding:7px 10px;">'
        f'<div style="font-size:11px;color:{text_s};">Inset popover layer</div>'
        f'</div></div>'
        f'<div style="margin-top:10px;">'
        f'<button style="background:{accent};color:#fff;border:none;border-radius:{rad_btn};'
        f'padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;">Action</button>'
        f'</div>'
    )
    return (
        f'<div class="hf-web-{oid}">'
        f'<div style="font-family:{font};background:{bg0};border:1px solid {border};'
        f'border-radius:8px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.5);">'
        f'<div style="background:{bg1};border-bottom:1px solid {border};'
        f'padding:6px 12px;display:flex;align-items:center;gap:8px;">'
        f'<div style="display:flex;gap:4px;">'
        f'<div style="width:10px;height:10px;border-radius:50%;background:#FF5F57;"></div>'
        f'<div style="width:10px;height:10px;border-radius:50%;background:#FEBC2E;"></div>'
        f'<div style="width:10px;height:10px;border-radius:50%;background:#28C840;"></div>'
        f'</div>'
        f'<div style="flex:1;background:{bg2};border:1px solid {border};border-radius:4px;'
        f'padding:2px 8px;font-size:10px;color:{text_s};">app.example.com</div>'
        f'</div>'
        + nav
        + f'<div style="padding:12px 16px;min-height:160px;">{content}</div>'
        + '</div></div>'
    )


def _hf_web_dark_deep_color(tokens: dict[str, Any] | None) -> str:
    oid = "dark-deep-color"
    accent = _tok(tokens, "color", "accent")
    text_p = "#F5F5F7"
    text_s = "#AEAEB2"
    border = f"{accent}33"
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    font = _tok(tokens, "typography", "fontFamily") or "'Inter', system-ui, sans-serif"
    nav = (
        f'<div style="border-bottom:1px solid {accent}33;padding:0 16px;'
        f'display:flex;align-items:center;gap:20px;background:{accent}22;">'
        f'<span style="font-size:13px;font-weight:700;color:{text_p};margin-right:auto;">App</span>'
        f'<span style="font-size:12px;color:{text_p};font-weight:600;'
        f'border-bottom:2px solid {accent};padding:10px 0;">Home</span>'
        f'<span style="font-size:12px;color:{text_s};padding:10px 0;">Explore</span>'
        f'</div>'
    )
    content = (
        f'<div style="font-size:13px;font-weight:600;color:{text_p};margin-bottom:6px;">Deep color dark</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">Accent-tinted background — immersive brand presence.</div>'
        f'<div style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);'
        f'border-radius:{rad_card};padding:10px 12px;margin-bottom:6px;">'
        f'<div style="font-size:12px;color:{text_p};">Card on deep bg</div>'
        f'<div style="font-size:10px;color:{text_s};">Subtle frosted lift</div>'
        f'</div>'
        f'<div style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.10);'
        f'border-radius:{rad_card};padding:10px 12px;margin-bottom:12px;">'
        f'<div style="font-size:12px;color:{text_p};">Second card</div>'
        f'</div>'
        f'<button style="background:{accent};color:#fff;border:none;border-radius:{rad_btn};'
        f'padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;">Dive In</button>'
    )
    return (
        f'<div class="hf-web-{oid}">'
        f'<div style="font-family:{font};background:{accent}1A;border:1px solid {accent}44;'
        f'border-radius:8px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.5);">'
        f'<div style="background:{accent}22;border-bottom:1px solid {accent}33;'
        f'padding:6px 12px;display:flex;align-items:center;gap:8px;">'
        f'<div style="display:flex;gap:4px;">'
        f'<div style="width:10px;height:10px;border-radius:50%;background:#FF5F57;"></div>'
        f'<div style="width:10px;height:10px;border-radius:50%;background:#FEBC2E;"></div>'
        f'<div style="width:10px;height:10px;border-radius:50%;background:#28C840;"></div>'
        f'</div>'
        f'<div style="flex:1;background:rgba(255,255,255,0.10);border:1px solid rgba(255,255,255,0.15);'
        f'border-radius:4px;padding:2px 8px;font-size:10px;color:{text_s};">app.example.com</div>'
        f'</div>'
        + nav
        + f'<div style="padding:12px 16px;min-height:160px;">{content}</div>'
        + '</div></div>'
    )


def _hf_web_dark_glass_layers(tokens: dict[str, Any] | None) -> str:
    oid = "dark-glass-layers"
    accent = _tok(tokens, "color", "accent")
    text_p = "#F5F5F7"
    text_s = "#AEAEB2"
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    font = _tok(tokens, "typography", "fontFamily") or "'Inter', system-ui, sans-serif"
    nav = (
        f'<div style="border-bottom:1px solid rgba(255,255,255,0.10);padding:0 16px;'
        f'display:flex;align-items:center;gap:20px;'
        f'background:rgba(255,255,255,0.06);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);">'
        f'<span style="font-size:13px;font-weight:700;color:{text_p};margin-right:auto;">App</span>'
        f'<span style="font-size:12px;color:{text_p};font-weight:600;'
        f'border-bottom:2px solid {accent};padding:10px 0;">Home</span>'
        f'<span style="font-size:12px;color:{text_s};padding:10px 0;">Explore</span>'
        f'</div>'
    )
    content = (
        f'<div style="font-size:13px;font-weight:600;color:{text_p};margin-bottom:6px;">Glass dark layers</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">Frosted glass cards over dark gradient background.</div>'
        f'<div style="background:rgba(255,255,255,0.10);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);'
        f'border:1px solid rgba(255,255,255,0.18);border-radius:{rad_card};padding:10px 12px;margin-bottom:6px;">'
        f'<div style="font-size:12px;color:{text_p};">Glass card</div>'
        f'<div style="font-size:10px;color:{text_s};">backdrop-filter: blur</div>'
        f'</div>'
        f'<div style="background:rgba(255,255,255,0.06);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);'
        f'border:1px solid rgba(255,255,255,0.10);border-radius:{rad_card};padding:10px 12px;margin-bottom:12px;">'
        f'<div style="font-size:12px;color:{text_p};">Deeper glass</div>'
        f'</div>'
        # accent tint on CTA so the accent token is always present in output
        f'<button style="background:{accent}33;backdrop-filter:blur(16px);color:{accent};'
        f'border:1px solid {accent}55;border-radius:{rad_btn};'
        f'padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;">Glass CTA</button>'
    )
    bg_gradient = "linear-gradient(135deg, #0D0D1A 0%, #1A1A2E 100%)"
    return (
        f'<div class="hf-web-{oid}">'
        f'<div style="font-family:{font};background:{bg_gradient};border:1px solid rgba(255,255,255,0.12);'
        f'border-radius:8px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.7);">'
        f'<div style="background:rgba(255,255,255,0.05);border-bottom:1px solid rgba(255,255,255,0.08);'
        f'padding:6px 12px;display:flex;align-items:center;gap:8px;">'
        f'<div style="display:flex;gap:4px;">'
        f'<div style="width:10px;height:10px;border-radius:50%;background:#FF5F57;"></div>'
        f'<div style="width:10px;height:10px;border-radius:50%;background:#FEBC2E;"></div>'
        f'<div style="width:10px;height:10px;border-radius:50%;background:#28C840;"></div>'
        f'</div>'
        f'<div style="flex:1;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);'
        f'border-radius:4px;padding:2px 8px;font-size:10px;color:{text_s};">app.example.com</div>'
        f'</div>'
        + nav
        + f'<div style="padding:12px 16px;min-height:160px;">{content}</div>'
        + '</div></div>'
    )


def _hf_web_gradient_linear(tokens: dict[str, Any] | None) -> str:
    oid = "gradient-linear"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    content = (
        f'<div style="font-size:13px;font-weight:600;color:{text_p};margin-bottom:6px;">Linear gradient</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:8px;">Top-to-bottom brand gradient on hero and CTA button.</div>'
        f'<div style="background:linear-gradient(to bottom, {accent}, {accent}99);'
        f'border-radius:{rad_card};padding:14px;margin-bottom:10px;text-align:center;">'
        f'<div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:3px;">Your dashboard</div>'
        f'<div style="font-size:11px;color:rgba(255,255,255,0.85);">Everything in one place</div>'
        f'</div>'
        f'<div style="background:{surface};border:1px solid {border};border-radius:{rad_card};'
        f'padding:10px 12px;margin-bottom:10px;">'
        f'<div style="font-size:12px;color:{text_p};">Content card</div>'
        f'</div>'
        f'<button style="background:linear-gradient(to bottom, {accent}, {accent}CC);color:#fff;'
        f'border:none;border-radius:{rad_btn};padding:8px 18px;font-size:12px;font-weight:600;'
        f'cursor:pointer;box-shadow:0 2px 8px {accent}44;">Get Started</button>'
    )
    return f'<div class="hf-web-{oid}">{_web_shell(tokens, content, title="Linear Gradient")}</div>'


def _hf_web_gradient_mesh(tokens: dict[str, Any] | None) -> str:
    oid = "gradient-mesh"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    mesh_bg = (
        f"radial-gradient(ellipse at 20% 20%, {accent}44 0%, transparent 55%),"
        f"radial-gradient(ellipse at 80% 80%, {accent}66 0%, transparent 50%),"
        f"linear-gradient(135deg, {surface} 0%, #ffffff 100%)"
    )
    content = (
        f'<div style="font-size:13px;font-weight:600;color:{text_p};margin-bottom:6px;">Mesh gradient</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:8px;">Multi-point radial gradient for organic, airy backgrounds.</div>'
        f'<div style="background:{mesh_bg};border-radius:{rad_card};padding:14px;margin-bottom:10px;">'
        f'<div style="font-size:14px;font-weight:700;color:{text_p};margin-bottom:3px;">Mesh hero</div>'
        f'<div style="font-size:11px;color:{text_s};">Layered radial gradient depth</div>'
        f'</div>'
        f'<button style="background:{accent};color:#fff;border:none;border-radius:{rad_btn};'
        f'padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;">Explore</button>'
    )
    return f'<div class="hf-web-{oid}">{_web_shell(tokens, content, title="Mesh Gradient")}</div>'


def _hf_web_gradient_duotone(tokens: dict[str, Any] | None) -> str:
    oid = "gradient-duotone"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    warm = "#FF6B35"
    content = (
        f'<div style="font-size:13px;font-weight:600;color:{text_p};margin-bottom:6px;">Duotone gradient</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:8px;">Two-tone diagonal: accent to warm complement.</div>'
        f'<div style="background:linear-gradient(135deg, {accent} 0%, {warm} 100%);'
        f'border-radius:{rad_card};padding:14px;margin-bottom:10px;text-align:center;">'
        f'<div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:3px;">Duotone hero</div>'
        f'<div style="font-size:11px;color:rgba(255,255,255,0.9);">Accent + warm complement</div>'
        f'</div>'
        f'<button style="background:linear-gradient(135deg, {accent} 0%, {warm} 100%);color:#fff;'
        f'border:none;border-radius:{rad_btn};padding:8px 18px;font-size:12px;font-weight:600;'
        f'cursor:pointer;">Create Now</button>'
    )
    return f'<div class="hf-web-{oid}">{_web_shell(tokens, content, title="Duotone Gradient")}</div>'


def _hf_web_gradient_none(tokens: dict[str, Any] | None) -> str:
    oid = "gradient-none"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    content = (
        f'<div style="font-size:13px;font-weight:600;color:{text_p};margin-bottom:6px;">No gradient</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">Flat solid fills — maximum legibility, Calm Precision default.</div>'
        f'<div style="background:{surface};border:1px solid {border};border-radius:{rad_card};'
        f'padding:10px 12px;margin-bottom:6px;">'
        f'<div style="font-size:12px;color:{text_p};">Card one</div>'
        f'<div style="font-size:10px;color:{text_s};">Flat surface</div>'
        f'</div>'
        f'<div style="background:{surface};border:1px solid {border};border-radius:{rad_card};'
        f'padding:10px 12px;margin-bottom:12px;">'
        f'<div style="font-size:12px;color:{text_p};">Card two</div>'
        f'<div style="font-size:10px;color:{text_s};">Flat surface</div>'
        f'</div>'
        f'<button style="background:{accent};color:#fff;border:none;border-radius:{rad_btn};'
        f'padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;">Action</button>'
    )
    return f'<div class="hf-web-{oid}">{_web_shell(tokens, content, title="No Gradient")}</div>'


# ---------------------------------------------------------------------------
# ELEVATION / DEPTH fragments
# ---------------------------------------------------------------------------

def _hf_web_btn_flat(tokens: dict[str, Any] | None) -> str:
    oid = "btn-flat"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    content = (
        f'<div style="font-size:13px;font-weight:600;color:{text_p};margin-bottom:6px;">Flat button</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">Solid fill, zero shadow — unambiguous, no depth distraction.</div>'
        f'<div style="background:{surface};border:1px solid {border};border-radius:{rad_card};'
        f'padding:10px 12px;margin-bottom:12px;">'
        f'<div style="font-size:12px;color:{text_p};">Content area</div>'
        f'</div>'
        f'<button data-focus-region="primary_button" style="background:{accent};color:#fff;border:none;border-radius:{rad_btn};'
        f'padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;box-shadow:none;">Flat Action</button>'
    )
    return f'<div class="hf-web-{oid}">{_web_shell(tokens, content, title="Flat Button")}</div>'


def _hf_web_btn_soft_shadow(tokens: dict[str, Any] | None) -> str:
    oid = "btn-soft-shadow"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    content = (
        f'<div style="font-size:13px;font-weight:600;color:{text_p};margin-bottom:6px;">Soft shadow button</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">Accent-tinted drop shadow gives lift and depth.</div>'
        f'<div style="background:{surface};border:1px solid {border};border-radius:{rad_card};'
        f'padding:10px 12px;margin-bottom:12px;">'
        f'<div style="font-size:12px;color:{text_p};">Content area</div>'
        f'</div>'
        f'<button data-focus-region="primary_button" style="background:{accent};color:#fff;border:none;border-radius:{rad_btn};'
        f'padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;'
        f'box-shadow:0 4px 12px {accent}55;">Soft Shadow</button>'
    )
    return f'<div class="hf-web-{oid}">{_web_shell(tokens, content, title="Soft Shadow")}</div>'


def _hf_web_btn_inner_highlight(tokens: dict[str, Any] | None) -> str:
    oid = "btn-inner-highlight"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    content = (
        f'<div style="font-size:13px;font-weight:600;color:{text_p};margin-bottom:6px;">Inner highlight button</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">Top-edge inset highlight adds tactile depth without external shadow.</div>'
        f'<div style="background:{surface};border:1px solid {border};border-radius:{rad_card};'
        f'padding:10px 12px;margin-bottom:12px;">'
        f'<div style="font-size:12px;color:{text_p};">Content area</div>'
        f'</div>'
        f'<button data-focus-region="primary_button" style="background:linear-gradient(to bottom, {accent}EE, {accent});color:#fff;'
        f'border:none;border-radius:{rad_btn};padding:8px 18px;font-size:12px;font-weight:600;'
        f'cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,0.25), 0 1px 3px rgba(0,0,0,0.18);">'
        f'Highlighted</button>'
    )
    return f'<div class="hf-web-{oid}">{_web_shell(tokens, content, title="Inner Highlight")}</div>'


def _hf_web_btn_glass(tokens: dict[str, Any] | None) -> str:
    oid = "btn-glass"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    content = (
        f'<div style="font-size:13px;font-weight:600;color:{text_p};margin-bottom:6px;">Glass button</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">Translucent frosted glass CTA via backdrop-filter.</div>'
        f'<div style="background:{surface};border:1px solid {border};border-radius:{rad_card};'
        f'padding:10px 12px;margin-bottom:12px;">'
        f'<div style="font-size:12px;color:{text_p};">Content below</div>'
        f'</div>'
        f'<button data-focus-region="primary_button" style="background:rgba(255,255,255,0.25);backdrop-filter:blur(16px);'
        f'-webkit-backdrop-filter:blur(16px);color:{accent};'
        f'border:1px solid rgba(255,255,255,0.45);border-radius:{rad_btn};'
        f'padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;">Glass Action</button>'
    )
    return f'<div class="hf-web-{oid}">{_web_shell(tokens, content, title="Glass Button")}</div>'


# ---------------------------------------------------------------------------
# MOTION fragments — CSS @keyframes via inline <style>
# ---------------------------------------------------------------------------

def _hf_web_press_scale_down(tokens: dict[str, Any] | None) -> str:
    oid = "press-scale-down"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    anim = f"hf-web-{oid}-press"
    content = (
        f'<style>'
        f'.hf-web-{oid} .web-press-btn {{'
        f'  animation:{anim} 0.7s cubic-bezier(0.36,0.07,0.19,0.97) infinite;'
        f'  background:{accent};color:#fff;border:none;border-radius:{rad_btn};'
        f'  padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;display:inline-block;}}'
        f'@keyframes {anim} {{'
        f'  0%,100% {{transform:scale(1);}}'
        f'  35% {{transform:scale(0.95);}}'
        f'  65% {{transform:scale(0.95);}}'
        f'}}'
        f'</style>'
        f'<div style="font-size:13px;font-weight:600;color:{text_p};margin-bottom:6px;">Press: scale down</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">Button compresses to 95% on press — clear tactile affordance.</div>'
        f'<div style="background:{surface};border:1px solid {border};border-radius:{rad_card};'
        f'padding:10px 12px;margin-bottom:12px;">'
        f'<div style="font-size:12px;color:{text_p};">Content card</div>'
        f'</div>'
        f'<div class="web-press-btn">Click Me</div>'
    )
    return f'<div class="hf-web-{oid}">{_web_shell(tokens, content, title="Press: Scale")}</div>'


def _hf_web_press_opacity_dim(tokens: dict[str, Any] | None) -> str:
    oid = "press-opacity-dim"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    anim = f"hf-web-{oid}-dim"
    content = (
        f'<style>'
        f'.hf-web-{oid} .web-dim-btn {{'
        f'  animation:{anim} 0.7s ease-in-out infinite;'
        f'  background:{accent};color:#fff;border:none;border-radius:{rad_btn};'
        f'  padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;display:inline-block;}}'
        f'@keyframes {anim} {{'
        f'  0%,100% {{opacity:1;}}'
        f'  35% {{opacity:0.6;}}'
        f'  65% {{opacity:0.6;}}'
        f'}}'
        f'</style>'
        f'<div style="font-size:13px;font-weight:600;color:{text_p};margin-bottom:6px;">Press: opacity dim</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">60% opacity on press — lightweight non-spatial feedback.</div>'
        f'<div style="background:{surface};border:1px solid {border};border-radius:{rad_card};'
        f'padding:10px 12px;margin-bottom:12px;">'
        f'<div style="font-size:12px;color:{text_p};">Content card</div>'
        f'</div>'
        f'<div class="web-dim-btn">Click Me</div>'
    )
    return f'<div class="hf-web-{oid}">{_web_shell(tokens, content, title="Press: Dim")}</div>'


def _hf_web_press_highlight_bg(tokens: dict[str, Any] | None) -> str:
    oid = "press-highlight-bg"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    rad_btn = _radius_px(_tok(tokens, "radius", "button"))
    anim = f"hf-web-{oid}-flash"
    content = (
        f'<style>'
        f'.hf-web-{oid} .web-flash-btn {{'
        f'  animation:{anim} 0.7s ease-in-out infinite;'
        f'  background:{accent};color:#fff;border:none;border-radius:{rad_btn};'
        f'  padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;display:inline-block;}}'
        f'@keyframes {anim} {{'
        f'  0%,100% {{background:{accent};}}'
        f'  35% {{background:{accent}BB;}}'
        f'  65% {{background:{accent}BB;}}'
        f'}}'
        f'</style>'
        f'<div style="font-size:13px;font-weight:600;color:{text_p};margin-bottom:6px;">Press: highlight bg</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">Background color shifts on press — affirms the click without movement.</div>'
        f'<div style="background:{surface};border:1px solid {border};border-radius:{rad_card};'
        f'padding:10px 12px;margin-bottom:12px;">'
        f'<div style="font-size:12px;color:{text_p};">Content card</div>'
        f'</div>'
        f'<div class="web-flash-btn">Click Me</div>'
    )
    return f'<div class="hf-web-{oid}">{_web_shell(tokens, content, title="Press: Highlight")}</div>'


def _hf_web_transition_push_slide(tokens: dict[str, Any] | None) -> str:
    oid = "transition-push-slide"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    anim = f"hf-web-{oid}-slide"
    content = (
        f'<style>'
        f'.hf-web-{oid} .web-slide-panel {{'
        f'  animation:{anim} 1.8s cubic-bezier(0.4,0,0.2,1) infinite;'
        f'  background:{surface};border:1px solid {border};border-radius:{rad_card};padding:10px 12px;}}'
        f'@keyframes {anim} {{'
        f'  0%,100% {{transform:translateX(0);opacity:1;}}'
        f'  35% {{transform:translateX(-12px);opacity:0;}}'
        f'  50% {{transform:translateX(12px);opacity:0;}}'
        f'  85% {{transform:translateX(0);opacity:1;}}'
        f'}}'
        f'</style>'
        f'<div style="font-size:13px;font-weight:600;color:{text_p};margin-bottom:6px;">Push/slide transition</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">Panel exits left, next screen enters from right — spatial nav.</div>'
        f'<div class="web-slide-panel">'
        f'<div style="font-size:13px;font-weight:600;color:{text_p};margin-bottom:3px;">Next page</div>'
        f'<div style="font-size:11px;color:{text_s};">Slides in from the right edge</div>'
        f'</div>'
    )
    return f'<div class="hf-web-{oid}">{_web_shell(tokens, content, title="Push Slide")}</div>'


def _hf_web_transition_fade(tokens: dict[str, Any] | None) -> str:
    oid = "transition-fade"
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    anim = f"hf-web-{oid}-fade"
    content = (
        f'<style>'
        f'.hf-web-{oid} .web-fade-panel {{'
        f'  animation:{anim} 1.8s ease-in-out infinite;'
        f'  background:{surface};border:1px solid {border};border-radius:{rad_card};padding:10px 12px;}}'
        f'@keyframes {anim} {{'
        f'  0%,100% {{opacity:1;}}'
        f'  35% {{opacity:0;}}'
        f'  60% {{opacity:0;}}'
        f'}}'
        f'</style>'
        f'<div style="font-size:13px;font-weight:600;color:{text_p};margin-bottom:6px;">Fade transition</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">Cross-dissolve — no direction implied, works for non-spatial flow.</div>'
        f'<div class="web-fade-panel">'
        f'<div style="font-size:13px;font-weight:600;color:{text_p};margin-bottom:3px;">Page content</div>'
        f'<div style="font-size:11px;color:{text_s};">Fades out, then in</div>'
        f'</div>'
    )
    return f'<div class="hf-web-{oid}">{_web_shell(tokens, content, title="Fade Transition")}</div>'


def _hf_web_skeleton_shimmer_ltr(tokens: dict[str, Any] | None) -> str:
    oid = "skeleton-shimmer-ltr"
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    anim = f"hf-web-{oid}-shimmer"
    content = (
        f'<style>'
        f'.hf-web-{oid} .web-skel {{'
        f'  background:linear-gradient(90deg, {surface} 25%, rgba(255,255,255,0.9) 50%, {surface} 75%);'
        f'  background-size:200% 100%;'
        f'  animation:{anim} 1.5s ease-in-out infinite;'
        f'  border-radius:4px;height:12px;margin-bottom:8px;}}'
        f'@keyframes {anim} {{'
        f'  0% {{background-position:200% 0;}}'
        f'  100% {{background-position:-200% 0;}}'
        f'}}'
        f'</style>'
        f'<div style="font-size:13px;font-weight:600;color:{text_p};margin-bottom:6px;">Skeleton: shimmer LTR</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">Left-to-right shimmer communicates loading directionality.</div>'
        f'<div style="background:{surface};border:1px solid {border};border-radius:{rad_card};padding:10px 12px;">'
        f'<div class="web-skel" style="width:65%;"></div>'
        f'<div class="web-skel" style="width:90%;"></div>'
        f'<div class="web-skel" style="width:50%;margin-bottom:0;"></div>'
        f'</div>'
    )
    return f'<div class="hf-web-{oid}">{_web_shell(tokens, content, title="Shimmer LTR")}</div>'


def _hf_web_skeleton_pulse(tokens: dict[str, Any] | None) -> str:
    oid = "skeleton-pulse"
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    anim = f"hf-web-{oid}-pulse"
    content = (
        f'<style>'
        f'.hf-web-{oid} .web-pulse-skel {{'
        f'  background:{surface};border-radius:4px;height:12px;margin-bottom:8px;'
        f'  animation:{anim} 1.3s ease-in-out infinite;}}'
        f'@keyframes {anim} {{'
        f'  0%,100% {{opacity:0.4;}}'
        f'  50% {{opacity:1;}}'
        f'}}'
        f'</style>'
        f'<div style="font-size:13px;font-weight:600;color:{text_p};margin-bottom:6px;">Skeleton: pulse</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">Opacity breathing — minimal motion, no spatial cue.</div>'
        f'<div style="background:{surface};border:1px solid {border};border-radius:{rad_card};padding:10px 12px;">'
        f'<div class="web-pulse-skel" style="width:60%;"></div>'
        f'<div class="web-pulse-skel" style="width:85%;"></div>'
        f'<div class="web-pulse-skel" style="width:45%;margin-bottom:0;"></div>'
        f'</div>'
    )
    return f'<div class="hf-web-{oid}">{_web_shell(tokens, content, title="Skeleton Pulse")}</div>'


def _hf_web_ptr_native_spinner(tokens: dict[str, Any] | None) -> str:
    oid = "ptr-native-spinner"
    accent = _tok(tokens, "color", "accent")
    text_p = _tok(tokens, "color", "textPrimary")
    text_s = _tok(tokens, "color", "textSecondary")
    surface = _tok(tokens, "color", "surface")
    border = _tok(tokens, "color", "border")
    rad_card = _radius_px(_tok(tokens, "radius", "card"))
    anim = f"hf-web-{oid}-spin"
    content = (
        f'<style>'
        f'.hf-web-{oid} .web-spinner {{'
        f'  width:20px;height:20px;border:3px solid {border};border-top-color:{accent};'
        f'  border-radius:50%;animation:{anim} 0.75s linear infinite;display:inline-block;}}'
        f'@keyframes {anim} {{to {{transform:rotate(360deg);}}}}'
        f'</style>'
        f'<div style="font-size:13px;font-weight:600;color:{text_p};margin-bottom:6px;">Pull-to-refresh: spinner</div>'
        f'<div style="font-size:11px;color:{text_s};margin-bottom:10px;">CSS spinner matching browser native progress style for web PTR.</div>'
        f'<div style="text-align:center;padding:14px 0;margin-bottom:10px;">'
        f'<div class="web-spinner"></div>'
        f'<div style="font-size:11px;color:{text_s};margin-top:6px;">Refreshing…</div>'
        f'</div>'
        f'<div style="background:{surface};border:1px solid {border};border-radius:{rad_card};padding:10px 12px;">'
        f'<div style="font-size:12px;color:{text_p};">Content below spinner</div>'
        f'</div>'
    )
    return f'<div class="hf-web-{oid}">{_web_shell(tokens, content, title="Native Spinner")}</div>'


# ---------------------------------------------------------------------------
# Dispatch table
# ---------------------------------------------------------------------------

_WEB_RENDERERS: dict[str, object] = {
    "accent-cta-only":          _hf_web_accent_cta_only,
    "accent-semantic":          _hf_web_accent_semantic,
    "accent-expressive":        _hf_web_accent_expressive,
    "dark-true-black":          _hf_web_dark_true_black,
    "dark-elevated-layers":     _hf_web_dark_elevated_layers,
    "dark-deep-color":          _hf_web_dark_deep_color,
    "dark-glass-layers":        _hf_web_dark_glass_layers,
    "gradient-linear":          _hf_web_gradient_linear,
    "gradient-mesh":            _hf_web_gradient_mesh,
    "gradient-duotone":         _hf_web_gradient_duotone,
    "gradient-none":            _hf_web_gradient_none,
    "btn-flat":                 _hf_web_btn_flat,
    "btn-soft-shadow":          _hf_web_btn_soft_shadow,
    "btn-inner-highlight":      _hf_web_btn_inner_highlight,
    "btn-glass":                _hf_web_btn_glass,
    "press-scale-down":         _hf_web_press_scale_down,
    "press-opacity-dim":        _hf_web_press_opacity_dim,
    "press-highlight-bg":       _hf_web_press_highlight_bg,
    "transition-push-slide":    _hf_web_transition_push_slide,
    "transition-fade":          _hf_web_transition_fade,
    "skeleton-shimmer-ltr":     _hf_web_skeleton_shimmer_ltr,
    "skeleton-pulse":           _hf_web_skeleton_pulse,
    "ptr-native-spinner":       _hf_web_ptr_native_spinner,
}

# iOS-only ids: web returns None (correct fallback to low-fi)
_IOS_ONLY_IDS: frozenset[str] = frozenset({
    "haptic-on-confirm", "haptic-on-error", "haptic-none",
    "splash-logo-morph", "splash-fade", "splash-none",
    "onboard-scroll-reveal", "onboard-page-dots", "onboard-none",
    "celebrate-confetti", "celebrate-checkmark", "celebrate-none",
})

WEB_HIGH_FI_IDS: frozenset[str] = frozenset(_WEB_RENDERERS.keys())


def has_web_high_fi(option_id: str) -> bool:
    """Return True if a high-fi web fragment exists for this option_id."""
    return option_id in WEB_HIGH_FI_IDS


def render_web_high_fi(option_id: str, tokens: dict[str, Any] | None = None) -> str | None:
    """Render a high-fidelity web HTML fragment for the given option_id.

    Returns None when:
    - option_id is iOS-platform-only (caller falls back to low-fi).
    - option_id is not in the high-fi catalog.

    The returned HTML is self-contained: inline <style> with all selectors
    scoped under .hf-web-<optid> and unique @keyframes names.
    """
    if option_id in _IOS_ONLY_IDS:
        return None
    fn = _WEB_RENDERERS.get(option_id)
    if fn is None:
        return None
    return fn(tokens)  # type: ignore[operator]
