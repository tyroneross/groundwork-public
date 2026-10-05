"""Calm Precision floor tokens — the design.md/v1 baseline every DESIGN.md
extends.

Sourced from the UI Guidance ruleset (references/, skills/{ios,macos,web,tokens,
principles}) and the canonical Sample Notes DESIGN.md (schema: design.md/v1).
This is the floor layer in `effective = floor ⊕ overrides ⊕ per-platform`.

FLOOR_VERSION pins the ruleset version the floor was authored against
(calm-precision@6.4.2, per the user's standing reference note). A DESIGN.md
that `extends: calm-precision@6.4.2` resolves against THIS floor.

Pure stdlib. No deps, no network, no vendor SDK.
"""

from __future__ import annotations

import copy
from typing import Any

FLOOR_VERSION = "calm-precision@6.4.2"

# Shared base — platform-neutral Calm Precision defaults.
# Values trace to Sample Notes DESIGN.md + the principles/tokens skills.
_BASE: dict[str, dict[str, Any]] = {
    "color": {
        "bg": "#FFFFFF",
        "surface": "#F5F5F7",
        "surfaceSunken": "#FAFAFA",
        "border": "#E5E5EA",
        "textPrimary": "#1C1C1E",
        "textSecondary": "#6E6E73",
        "textTertiary": "#9A9AA0",
        "accent": "#0A84FF",
        "accentText": "#FFFFFF",
        "warning": "#C2410C",
        "danger": "#FF3B30",
        "success": "#1E874B",
    },
    "typography": {
        # System-first, strict 3-step ladder (no 4th size).
        "fontFamily": "system-ui, -apple-system, 'Inter', sans-serif",
        "scaleRatio": 1.25,        # L3 13 -> L2 15 -> L1 21-ish
        "headingWeight": 600,
        "bodyWeight": 400,
        "tracking": "normal",
        "numericStyle": "tabular",  # timers/timecodes/data align
    },
    "spacing": {
        "grid": 8,                  # 8pt grid
        "density": "comfortable",   # content >= 70% of pixels; whitespace first
    },
    "radius": {
        "button": 8,
        "card": 10,
        "pill": 999,
    },
    "elevation": {
        # Whitespace and 1px borders before shadows. Low chrome.
        "style": "flat-border",     # "1px solid border", not drop shadow
        "depth": "minimal",
    },
    "motion": {
        "transition": "push-slide",  # predictable, native
        "press": "opacity-dim",      # subtle, not ripple
        "intensity": "restrained",
    },
    "nav": {
        # Calm Precision: text + bottom border, never background pills.
        "activeStyle": "text-underline",
        "tabStyle": "icon-label",
        "layoutModel": "tab-bar",       # Layer-1 default: mobile-first tab bar
    },
    "platform": {
        "target": "multi",              # Layer-1 default: unscoped (all platforms)
    },
    "components": {
        "buttonShape": "flat",       # no soft shadow / glass by default
        "separator": "inset-line",   # single border around group, divider between
        "emptyState": "icon-text",   # quiet, no heavy illustration
        "toast": "inline",           # text color status, not filled banner
    },
}

# Per-platform overrides on TOP of base. Each layer is itself a token_delta;
# the resolver applies base, then base⊕overrides, then ⊕ this platform layer.
_PLATFORM: dict[str, dict[str, dict[str, Any]]] = {
    "web": {
        "typography": {
            "fontFamily": "'Inter', system-ui, -apple-system, sans-serif",
        },
        "spacing": {
            # 24px desktop touch target convention (vs 44px mobile).
            "density": "comfortable",
        },
    },
    "ios": {
        "typography": {
            "fontFamily": "-apple-system, 'SF Pro Text', system-ui, sans-serif",
        },
        "nav": {
            "tabStyle": "icon-label",      # SF Symbols icon + 10pt label
            "activeStyle": "fill-color",   # iOS-native filled variant + accent
        },
        "motion": {
            "press": "opacity-dim",        # 44px mobile target handled in preview
        },
    },
    "macos": {
        "typography": {
            "fontFamily": "-apple-system, 'SF Pro Text', 'Inter', sans-serif",
        },
        "spacing": {
            "density": "compact",          # desktop window, compact controls
        },
        "components": {
            "buttonShape": "flat",         # standard control height, no oversize
        },
    },
}


def floor_base() -> dict[str, Any]:
    """Deep copy of the platform-neutral base layer."""
    return copy.deepcopy(_BASE)


def floor_platform(platform: str) -> dict[str, Any]:
    """Deep copy of a platform's override layer ({} if none)."""
    return copy.deepcopy(_PLATFORM.get(platform, {}))


def floor_document() -> dict[str, Any]:
    """The complete floor as a (non-flattened) design.md/v1 doc skeleton."""
    return {
        "schema": "design.md/v1",
        "name": "Calm Precision Floor",
        "version": FLOOR_VERSION,
        "base": floor_base(),
        "platforms": {p: floor_platform(p) for p in _PLATFORM},
    }
