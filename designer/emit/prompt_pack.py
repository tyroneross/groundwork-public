"""AI prompt pack — second-person imperative instructions derived from the
resolved tokens of a completed walk.

The pack is the "give a coding agent the design system in words" deliverable:
short, imperative, grounded in the actual resolved token values + the picks the
user made. Reflects resolved tokens (so it stays in sync with the DESIGN.md).

Pure stdlib.
"""

from __future__ import annotations

from typing import Any

from ..engine import resolver


def _g(tokens: dict[str, Any], group: str, key: str, default: Any = None) -> Any:
    return tokens.get(group, {}).get(key, default)


def build_prompt_pack(state: Any, catalog: Any = None) -> list[str]:
    """Return a list of imperative prompt lines from the resolved web tokens
    (the platform-neutral-ish view) plus per-platform call-outs and pick notes.
    """
    overrides = getattr(state, "overrides", {}) or {}
    per_platform = getattr(state, "per_platform", {}) or {}
    resolved = resolver.resolve_all(overrides, per_platform)
    web = resolved["web"]

    lines: list[str] = []

    accent = _g(web, "color", "accent")
    accent_text = _g(web, "color", "accentText")
    if accent:
        lines.append(
            f"Use accent {accent} (text {accent_text}) for the single primary action "
            f"on each screen. Accent means 'do something here' — never decorate with it."
        )

    bg = _g(web, "color", "bg")
    surface = _g(web, "color", "surface")
    border = _g(web, "color", "border")
    lines.append(
        f"Surfaces: page {bg}, grouped card {surface}, 1px {border} borders. "
        f"One border around a related group; dividers between rows, never per-item borders."
    )

    font = _g(web, "typography", "fontFamily")
    hw = _g(web, "typography", "headingWeight")
    bw = _g(web, "typography", "bodyWeight")
    lines.append(
        f"Type ladder is strict (title -> body -> meta, no 4th size). Font {font}; "
        f"headings weight {hw}, body weight {bw}."
    )

    num = _g(web, "typography", "numericStyle")
    if num:
        lines.append(f"Numeric/data display style: {num} (apply to timers, stats, tables).")

    density = _g(web, "spacing", "density")
    grid = _g(web, "spacing", "grid")
    lines.append(
        f"Spacing on an {grid}pt grid, {density} density. Content >= 70% of pixels; "
        f"whitespace before borders."
    )

    radius_btn = _g(web, "radius", "button")
    lines.append(f"Button radius {radius_btn}px; button shape '{_g(web,'components','buttonShape')}'.")

    elev = _g(web, "elevation", "style")
    lines.append(f"Elevation: '{elev}'. Prefer whitespace and hairline borders over heavy shadows.")

    nav_active = _g(web, "nav", "activeStyle")
    nav_tab = _g(web, "nav", "tabStyle")
    lines.append(
        f"Navigation: active state '{nav_active}', tab style '{nav_tab}'. "
        f"Selected nav uses text weight + indicator, not a background pill (unless picked)."
    )

    motion_t = _g(web, "motion", "transition")
    motion_i = _g(web, "motion", "intensity")
    lines.append(f"Motion: '{motion_t}' transitions at '{motion_i}' intensity. Keep motion purposeful.")

    sep = _g(web, "components", "separator")
    empty = _g(web, "components", "emptyState")
    toast = _g(web, "components", "toast")
    lines.append(
        f"Components: list separator '{sep}', empty state '{empty}', notifications '{toast}'. "
        f"Status = text color + icon, never a filled badge."
    )

    # Per-platform call-outs (where a platform diverges from web).
    for plat in ("ios", "macos"):
        ptoks = resolved[plat]
        pf = _g(ptoks, "typography", "fontFamily")
        if pf and pf != font:
            lines.append(f"[{plat}] Use font {pf}.")
        if plat == "ios":
            lines.append("[ios] 44px minimum touch targets; SF Symbols for tab icons.")
        if plat == "macos":
            lines.append("[macos] Compact control heights — this is a desktop window, never oversize buttons.")

    # Pick notes (what the user actually chose), if catalog provided.
    history = getattr(state, "history", None)
    if history and catalog is not None:
        opts = catalog.options_by_id()
        cats = catalog.by_id()
        picked = []
        for rec in history:
            oid = rec.get("option_id")
            cid = rec.get("category_id")
            o = opts.get(oid)
            c = cats.get(cid)
            if o and c:
                picked.append(f"{c.title}: {o.label}")
        if picked:
            lines.append("Revealed preferences (the walk's picks): " + "; ".join(picked) + ".")

    return lines
