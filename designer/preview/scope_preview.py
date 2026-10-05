"""Layer-1 scope schematics — low-fi previews for platform-target and nav-structure.

Each public function returns a small self-contained HTML fragment (inline styles
only, no external CSS, no JS, no network) that makes the SCOPE CHOICE legible
to the user. These are NOT generic token-driven cards — they are silhouette
diagrams whose shape communicates the decision being made.

Calm Precision visual contract:
  - Hairline borders (1px solid), no pills
  - Single accent stroke (from the live token) — the rest is neutral greys
  - No background badges; status/labels are text-color only
  - Visually DISTINCT per option (this is the entire user-value point)

Pure stdlib. No deps, no network, no vendor SDK.
"""

from __future__ import annotations

import html as _html_mod
from typing import Any


def _e(text: str) -> str:
    """HTML-escape a string."""
    return _html_mod.escape(str(text))


def _accent(tokens: dict[str, Any]) -> str:
    """Extract accent color from tokens, with Calm Precision default."""
    return (tokens.get("color") or {}).get("accent") or "#0A84FF"


def _border(tokens: dict[str, Any]) -> str:
    return (tokens.get("color") or {}).get("border") or "#E5E5EA"


def _surface(tokens: dict[str, Any]) -> str:
    return (tokens.get("color") or {}).get("surface") or "#F5F5F7"


def _text_p(tokens: dict[str, Any]) -> str:
    return (tokens.get("color") or {}).get("textPrimary") or "#1C1C1E"


def _text_s(tokens: dict[str, Any]) -> str:
    return (tokens.get("color") or {}).get("textSecondary") or "#6E6E73"


# ---------------------------------------------------------------------------
# Platform scope schematics
# ---------------------------------------------------------------------------

def render_platform_scope(option_id: str, tokens: dict[str, Any]) -> "str | None":
    """Return a small device-silhouette schematic for the given platform option.

    Parameters
    ----------
    option_id : str
        One of: "platform-web", "platform-ios", "platform-macos", "platform-multi".
    tokens : dict
        The resolved effective token dict for this platform (used for accent color).

    Returns
    -------
    str or None
        Self-contained HTML fragment, or None if option_id is not recognized
        (caller should fall back to the generic schematic).
    """
    dispatch = {
        "platform-web":    _scope_web,
        "platform-ios":    _scope_ios,
        "platform-macos":  _scope_macos,
        "platform-multi":  _scope_multi,
    }
    fn = dispatch.get(option_id)
    if fn is None:
        return None
    return fn(tokens)


def _scope_web(tokens: dict[str, Any]) -> str:
    """Browser window silhouette: address bar + top chrome + content area."""
    acc = _accent(tokens)
    brd = _border(tokens)
    srf = _surface(tokens)
    tp = _text_p(tokens)
    ts = _text_s(tokens)

    # Browser chrome: 3 traffic-like dots + address bar
    dots_html = (
        f'<div style="display:flex;align-items:center;gap:3px;padding:5px 6px 4px;">'
        f'<span style="width:5px;height:5px;border-radius:50%;background:{brd};display:inline-block;"></span>'
        f'<span style="width:5px;height:5px;border-radius:50%;background:{brd};display:inline-block;"></span>'
        f'<span style="width:5px;height:5px;border-radius:50%;background:{brd};display:inline-block;"></span>'
        f'<div style="flex:1;height:5px;border:1px solid {brd};border-radius:2px;margin-left:4px;'
        f'background:#fff;"></div>'
        f'</div>'
    )

    # Top nav strip
    nav_strip = (
        f'<div style="display:flex;gap:8px;padding:3px 6px 3px;border-bottom:1px solid {brd};">'
        f'<span style="font-size:7px;color:{tp};font-weight:600;border-bottom:2px solid {acc};padding-bottom:1px;">Home</span>'
        f'<span style="font-size:7px;color:{ts};">Explore</span>'
        f'<span style="font-size:7px;color:{ts};">Settings</span>'
        f'</div>'
    )

    # Content area — two card rows
    card = (
        f'<div style="background:{srf};border:1px solid {brd};border-radius:3px;'
        f'height:14px;margin-bottom:4px;"></div>'
    )
    content = (
        f'<div style="padding:5px 6px 4px;">'
        f'{card}{card}'
        f'<div style="background:{acc};border-radius:2px;height:7px;width:40%;margin-top:2px;"></div>'
        f'</div>'
    )

    label = f'<div style="font-size:8px;font-weight:600;color:{tp};text-align:center;padding:3px 0 2px;">{_e("Web")}</div>'

    return (
        f'<div style="width:120px;border:1px solid {brd};border-radius:4px;'
        f'background:#fff;font-family:system-ui,sans-serif;overflow:hidden;">'
        f'{dots_html}'
        f'<div style="height:1px;background:{brd};"></div>'
        f'{nav_strip}'
        f'{content}'
        f'<div style="height:1px;background:{brd};"></div>'
        f'{label}'
        f'</div>'
    )


def _scope_ios(tokens: dict[str, Any]) -> str:
    """Phone silhouette: rounded frame + notch/status bar + content + tab bar."""
    acc = _accent(tokens)
    brd = _border(tokens)
    srf = _surface(tokens)
    tp = _text_p(tokens)
    ts = _text_s(tokens)

    # Notch (dark hardware bar)
    notch = (
        f'<div style="background:#1C1C1E;height:10px;display:flex;align-items:center;'
        f'justify-content:center;">'
        f'<div style="width:22px;height:4px;background:#333;border-radius:3px;"></div>'
        f'</div>'
    )

    # Content area
    card = (
        f'<div style="background:{srf};border:1px solid {brd};border-radius:3px;'
        f'height:12px;margin-bottom:3px;"></div>'
    )
    content = (
        f'<div style="padding:5px 6px 3px;background:#fff;">'
        f'{card}{card}'
        f'</div>'
    )

    # Bottom tab bar — 4 tab dots
    def _tab(active: bool) -> str:
        color = acc if active else ts
        fw = "700" if active else "400"
        return (
            f'<div style="flex:1;text-align:center;">'
            f'<div style="width:5px;height:5px;border-radius:50%;background:{color};'
            f'margin:0 auto 1px;"></div>'
            f'<div style="font-size:5px;color:{color};font-weight:{fw};">tab</div>'
            f'</div>'
        )

    tab_bar = (
        f'<div style="display:flex;align-items:flex-start;border-top:1px solid {brd};'
        f'padding:3px 4px 2px;background:#fff;">'
        f'{_tab(True)}{_tab(False)}{_tab(False)}{_tab(False)}'
        f'</div>'
    )

    label = f'<div style="font-size:8px;font-weight:600;color:{tp};text-align:center;padding:2px 0;">{_e("iOS")}</div>'

    # Phone outer frame: rounded corners, border, narrower than web
    return (
        f'<div style="width:72px;border:2px solid {brd};border-radius:10px;'
        f'background:#fff;font-family:system-ui,sans-serif;overflow:hidden;'
        f'margin:0 auto;">'
        f'{notch}'
        f'{content}'
        f'{tab_bar}'
        f'</div>'
        f'{label}'
    )


def _scope_macos(tokens: dict[str, Any]) -> str:
    """Mac window: traffic-light dots top-left + sidebar + content split."""
    acc = _accent(tokens)
    brd = _border(tokens)
    srf = _surface(tokens)
    tp = _text_p(tokens)
    ts = _text_s(tokens)

    # Title bar with traffic-light dots
    title_bar = (
        f'<div style="display:flex;align-items:center;gap:3px;padding:5px 6px 4px;'
        f'background:{srf};border-bottom:1px solid {brd};">'
        f'<span style="width:5px;height:5px;border-radius:50%;background:#FF5F57;display:inline-block;"></span>'
        f'<span style="width:5px;height:5px;border-radius:50%;background:#FEBC2E;display:inline-block;"></span>'
        f'<span style="width:5px;height:5px;border-radius:50%;background:#28C840;display:inline-block;"></span>'
        f'<span style="flex:1;font-size:7px;color:{ts};text-align:center;">Window Title</span>'
        f'</div>'
    )

    # Sidebar + content
    sidebar = (
        f'<div style="width:32px;background:{srf};border-right:1px solid {brd};'
        f'padding:4px 3px;flex-shrink:0;">'
        f'<div style="font-size:6px;color:{acc};font-weight:600;margin-bottom:3px;border-bottom:1px solid {acc};padding-bottom:1px;">Home</div>'
        f'<div style="font-size:6px;color:{ts};margin-bottom:2px;">Library</div>'
        f'<div style="font-size:6px;color:{ts};">Settings</div>'
        f'</div>'
    )

    content_col = (
        f'<div style="flex:1;padding:4px;">'
        f'<div style="background:#fff;border:1px solid {brd};border-radius:2px;height:10px;margin-bottom:3px;"></div>'
        f'<div style="background:#fff;border:1px solid {brd};border-radius:2px;height:10px;margin-bottom:3px;"></div>'
        f'<div style="background:{acc};border-radius:2px;height:6px;width:50%;"></div>'
        f'</div>'
    )

    body = (
        f'<div style="display:flex;min-height:44px;">'
        f'{sidebar}'
        f'{content_col}'
        f'</div>'
    )

    label = f'<div style="font-size:8px;font-weight:600;color:{tp};text-align:center;padding:3px 0 2px;">{_e("macOS")}</div>'

    return (
        f'<div style="width:120px;border:1px solid {brd};border-radius:4px;'
        f'background:#fff;font-family:system-ui,sans-serif;overflow:hidden;">'
        f'{title_bar}'
        f'{body}'
        f'<div style="height:1px;background:{brd};"></div>'
        f'{label}'
        f'</div>'
    )


def _scope_multi(tokens: dict[str, Any]) -> str:
    """Three mini silhouettes side by side: browser + phone + mac window."""
    acc = _accent(tokens)
    brd = _border(tokens)
    srf = _surface(tokens)
    tp = _text_p(tokens)

    # Mini browser
    mini_web = (
        f'<div style="width:38px;border:1px solid {brd};border-radius:3px;'
        f'background:#fff;overflow:hidden;flex-shrink:0;">'
        f'<div style="display:flex;gap:2px;padding:2px 3px;background:{srf};'
        f'border-bottom:1px solid {brd};">'
        f'<span style="width:3px;height:3px;border-radius:50%;background:{brd};display:inline-block;"></span>'
        f'<span style="width:3px;height:3px;border-radius:50%;background:{brd};display:inline-block;"></span>'
        f'<div style="flex:1;height:3px;background:#fff;border:1px solid {brd};border-radius:1px;"></div>'
        f'</div>'
        f'<div style="padding:2px 3px;">'
        f'<div style="background:{srf};height:5px;border-radius:1px;margin-bottom:2px;"></div>'
        f'<div style="background:{srf};height:5px;border-radius:1px;margin-bottom:2px;"></div>'
        f'<div style="background:{acc};height:3px;width:50%;border-radius:1px;"></div>'
        f'</div>'
        f'</div>'
    )

    # Mini phone
    mini_ios = (
        f'<div style="width:22px;border:2px solid {brd};border-radius:5px;'
        f'background:#fff;overflow:hidden;flex-shrink:0;">'
        f'<div style="background:#1C1C1E;height:4px;"></div>'
        f'<div style="padding:2px;">'
        f'<div style="background:{srf};height:4px;border-radius:1px;margin-bottom:1px;"></div>'
        f'<div style="background:{srf};height:4px;border-radius:1px;"></div>'
        f'</div>'
        f'<div style="display:flex;justify-content:space-around;border-top:1px solid {brd};padding:1px 0;">'
        f'<div style="width:3px;height:3px;border-radius:50%;background:{acc};"></div>'
        f'<div style="width:3px;height:3px;border-radius:50%;background:{brd};"></div>'
        f'<div style="width:3px;height:3px;border-radius:50%;background:{brd};"></div>'
        f'</div>'
        f'</div>'
    )

    # Mini mac
    mini_mac = (
        f'<div style="width:38px;border:1px solid {brd};border-radius:3px;'
        f'background:#fff;overflow:hidden;flex-shrink:0;">'
        f'<div style="display:flex;align-items:center;gap:2px;padding:2px 3px;'
        f'background:{srf};border-bottom:1px solid {brd};">'
        f'<span style="width:3px;height:3px;border-radius:50%;background:#FF5F57;display:inline-block;"></span>'
        f'<span style="width:3px;height:3px;border-radius:50%;background:#FEBC2E;display:inline-block;"></span>'
        f'<span style="width:3px;height:3px;border-radius:50%;background:#28C840;display:inline-block;"></span>'
        f'</div>'
        f'<div style="display:flex;">'
        f'<div style="width:10px;background:{srf};border-right:1px solid {brd};padding:2px;">'
        f'<div style="height:3px;background:{acc};border-radius:1px;margin-bottom:1px;"></div>'
        f'<div style="height:2px;background:{brd};border-radius:1px;margin-bottom:1px;"></div>'
        f'<div style="height:2px;background:{brd};border-radius:1px;"></div>'
        f'</div>'
        f'<div style="flex:1;padding:2px;">'
        f'<div style="height:4px;background:{srf};border-radius:1px;margin-bottom:1px;"></div>'
        f'<div style="height:4px;background:{srf};border-radius:1px;"></div>'
        f'</div>'
        f'</div>'
        f'</div>'
    )

    label = f'<div style="font-size:8px;font-weight:600;color:{tp};text-align:center;padding:4px 0 2px;">{_e("All platforms")}</div>'

    return (
        f'<div style="font-family:system-ui,sans-serif;display:inline-block;">'
        f'<div style="display:flex;align-items:flex-end;gap:4px;justify-content:center;">'
        f'{mini_web}'
        f'{mini_ios}'
        f'{mini_mac}'
        f'</div>'
        f'{label}'
        f'</div>'
    )


# ---------------------------------------------------------------------------
# Nav structure schematics
# ---------------------------------------------------------------------------

def render_nav_scope(option_id: str, tokens: dict[str, Any]) -> "str | None":
    """Return a layout-skeleton schematic for the given nav-structure option.

    Parameters
    ----------
    option_id : str
        One of: "nav-structure-left", "nav-structure-top",
                "nav-structure-tabbar", "nav-structure-none".
    tokens : dict
        The resolved effective token dict (used for accent and surface colors).

    Returns
    -------
    str or None
        Self-contained HTML fragment, or None if option_id is not recognized.
    """
    dispatch = {
        "nav-structure-left":    _nav_left,
        "nav-structure-top":     _nav_top,
        "nav-structure-tabbar":  _nav_tabbar,
        "nav-structure-none":    _nav_none,
    }
    fn = dispatch.get(option_id)
    if fn is None:
        return None
    return fn(tokens)


def _nav_frame(content: str, label_text: str, tokens: dict[str, Any]) -> str:
    """Wrap nav content in a device-neutral frame with a label below."""
    brd = _border(tokens)
    tp = _text_p(tokens)
    label = f'<div style="font-size:8px;font-weight:600;color:{tp};text-align:center;padding:3px 0 2px;">{_e(label_text)}</div>'
    return (
        f'<div style="font-family:system-ui,sans-serif;display:inline-block;">'
        f'<div style="width:100px;height:68px;border:1px solid {brd};border-radius:4px;'
        f'background:#fff;overflow:hidden;position:relative;">'
        f'{content}'
        f'</div>'
        f'{label}'
        f'</div>'
    )


def _nav_left(tokens: dict[str, Any]) -> str:
    """Left sidebar rail + content area."""
    acc = _accent(tokens)
    brd = _border(tokens)
    srf = _surface(tokens)
    ts = _text_s(tokens)

    sidebar = (
        f'<div style="position:absolute;left:0;top:0;bottom:0;width:26px;'
        f'background:{srf};border-right:1px solid {brd};padding:4px 3px;">'
        f'<div style="height:4px;background:{acc};border-radius:1px;margin-bottom:3px;"></div>'
        f'<div style="height:3px;background:{brd};border-radius:1px;margin-bottom:2px;"></div>'
        f'<div style="height:3px;background:{brd};border-radius:1px;margin-bottom:2px;"></div>'
        f'<div style="height:3px;background:{brd};border-radius:1px;"></div>'
        f'</div>'
    )

    content = (
        f'<div style="position:absolute;left:26px;top:0;right:0;bottom:0;padding:5px;">'
        f'<div style="height:8px;background:{srf};border-radius:2px;margin-bottom:4px;"></div>'
        f'<div style="height:6px;background:{srf};border-radius:2px;margin-bottom:3px;"></div>'
        f'<div style="height:6px;background:{srf};border-radius:2px;margin-bottom:3px;"></div>'
        f'<div style="height:5px;background:{acc};border-radius:2px;width:40%;"></div>'
        f'</div>'
    )

    label_html = (
        f'<div style="position:absolute;bottom:3px;right:4px;font-size:6px;color:{ts};">Left nav</div>'
    )

    return _nav_frame(sidebar + content + label_html, "Left Nav", tokens)


def _nav_top(tokens: dict[str, Any]) -> str:
    """Top bar + content below."""
    acc = _accent(tokens)
    brd = _border(tokens)
    srf = _surface(tokens)
    ts = _text_s(tokens)

    topbar = (
        f'<div style="position:absolute;left:0;top:0;right:0;height:16px;'
        f'background:{srf};border-bottom:1px solid {brd};'
        f'display:flex;align-items:center;gap:6px;padding:0 5px;">'
        f'<div style="height:4px;width:18px;background:{acc};border-radius:1px;'
        f'border-bottom:2px solid {acc};padding-bottom:0;"></div>'
        f'<div style="height:4px;width:14px;background:{brd};border-radius:1px;"></div>'
        f'<div style="height:4px;width:14px;background:{brd};border-radius:1px;"></div>'
        f'</div>'
    )

    content = (
        f'<div style="position:absolute;left:0;top:16px;right:0;bottom:0;padding:5px;">'
        f'<div style="height:8px;background:{srf};border-radius:2px;margin-bottom:4px;"></div>'
        f'<div style="height:6px;background:{srf};border-radius:2px;margin-bottom:3px;"></div>'
        f'<div style="height:6px;background:{srf};border-radius:2px;margin-bottom:3px;"></div>'
        f'<div style="height:5px;background:{acc};border-radius:2px;width:40%;"></div>'
        f'</div>'
    )

    label_html = (
        f'<div style="position:absolute;bottom:3px;right:4px;font-size:6px;color:{ts};">Top nav</div>'
    )

    return _nav_frame(topbar + content + label_html, "Top Nav", tokens)


def _nav_tabbar(tokens: dict[str, Any]) -> str:
    """Content area + filled bottom bar with tab dots."""
    acc = _accent(tokens)
    brd = _border(tokens)
    srf = _surface(tokens)
    ts = _text_s(tokens)

    content = (
        f'<div style="position:absolute;left:0;top:0;right:0;bottom:18px;padding:5px;">'
        f'<div style="height:8px;background:{srf};border-radius:2px;margin-bottom:4px;"></div>'
        f'<div style="height:6px;background:{srf};border-radius:2px;margin-bottom:3px;"></div>'
        f'<div style="height:6px;background:{srf};border-radius:2px;margin-bottom:3px;"></div>'
        f'<div style="height:5px;background:{acc};border-radius:2px;width:40%;"></div>'
        f'</div>'
    )

    # Bottom tab bar with 4 tab indicators
    def _dot(active: bool) -> str:
        bg = acc if active else brd
        return f'<div style="width:5px;height:5px;border-radius:50%;background:{bg};"></div>'

    tabbar = (
        f'<div style="position:absolute;left:0;bottom:0;right:0;height:18px;'
        f'background:{srf};border-top:1px solid {brd};'
        f'display:flex;align-items:center;justify-content:space-around;padding:0 8px;">'
        f'{_dot(True)}{_dot(False)}{_dot(False)}{_dot(False)}'
        f'</div>'
    )

    label_html = (
        f'<div style="position:absolute;bottom:20px;right:4px;font-size:6px;color:{ts};">'
        f'Tab bar</div>'
    )

    return _nav_frame(content + tabbar + label_html, "Tab Bar", tokens)


def _nav_none(tokens: dict[str, Any]) -> str:
    """Clean single content surface — no chrome, no nav."""
    acc = _accent(tokens)
    brd = _border(tokens)
    srf = _surface(tokens)
    ts = _text_s(tokens)

    content = (
        f'<div style="position:absolute;left:0;top:0;right:0;bottom:0;padding:8px;">'
        f'<div style="height:10px;background:{srf};border-radius:2px;margin-bottom:5px;"></div>'
        f'<div style="height:7px;background:{srf};border-radius:2px;margin-bottom:4px;"></div>'
        f'<div style="height:7px;background:{srf};border-radius:2px;margin-bottom:4px;"></div>'
        f'<div style="height:6px;background:{srf};border-radius:2px;margin-bottom:4px;"></div>'
        f'<div style="height:6px;background:{acc};border-radius:2px;width:35%;"></div>'
        f'</div>'
    )

    label_html = (
        f'<div style="position:absolute;bottom:3px;right:4px;font-size:6px;color:{ts};">No nav</div>'
    )

    return _nav_frame(content + label_html, "No Nav", tokens)
