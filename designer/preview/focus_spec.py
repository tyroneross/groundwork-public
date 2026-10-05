"""FOCUS-SPEC engine: per-dimension focus + de-emphasis data for preview clarity.

Maps each catalog dimension (and category_id) to:
  - target_regions: which preview regions to ring / keep full-opacity
  - non_target_treatment: whether to apply grayscale (never for color.* dims)
  - target_ring: whether to draw the outline ring on target regions

Also exports string helpers the renderers use:
  - non_target_style(dimension) -> CSS de-emphasis string
  - target_ring_style(accent)   -> CSS ring string using accent + "33" alpha suffix
  - is_target_region(region, focus) -> bool

Design contract (Calm Precision — exact values, do not edit):
  non-target default: opacity:0.32;filter:grayscale(0.65);
                      transition:opacity 0.15s ease,filter 0.15s ease;
                      pointer-events:none;
  non-target color.*: opacity:0.32;transition:opacity 0.15s ease;
                      pointer-events:none;
                      (NEVER grayscale — that hides the accent token being decided)
  target ring:        outline:2px solid {accent}33;outline-offset:3px;
                      border-radius:4px;
                      (OUTLINE not border — no layout shift; no blur anywhere)

Pure stdlib. No deps, no network, no vendor SDK.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Canonical region names
# ---------------------------------------------------------------------------

REGION_NAMES: frozenset[str] = frozenset({
    "cta_button",
    "nav_active",
    "accent_indicators",
    "sheet_element",
    "nav_bar",
    "primary_button",
    "toast_band",
    "list_rows",
})

# ---------------------------------------------------------------------------
# De-emphasis CSS strings (exact, from design contract)
# ---------------------------------------------------------------------------

_OPACITY_AND_GRAYSCALE: str = (
    "opacity:0.32;"
    "filter:grayscale(0.65);"
    "transition:opacity 0.15s ease,filter 0.15s ease;"
    "pointer-events:none;"
)

_OPACITY_ONLY: str = (
    "opacity:0.32;"
    "transition:opacity 0.15s ease;"
    "pointer-events:none;"
)

# ---------------------------------------------------------------------------
# FOCUS_SPECS — keyed by dimension token-path OR category_id OR "_default"
# ---------------------------------------------------------------------------
# Each value: {
#   "target_regions":       list[str],
#   "non_target_treatment": "opacity_only" | "opacity_and_grayscale",
#   "target_ring":          bool,
# }

FOCUS_SPECS: dict[str, dict] = {
    # --- color.* dimensions: NEVER grayscale ---
    "color.accent": {
        "target_regions": ["cta_button", "nav_active", "accent_indicators"],
        "non_target_treatment": "opacity_only",
        "target_ring": True,
    },
    "color.surface": {
        "target_regions": ["sheet_element"],
        "non_target_treatment": "opacity_only",
        "target_ring": True,
    },

    # --- spacing ---
    "spacing.density": {
        "target_regions": ["sheet_element"],
        "non_target_treatment": "opacity_and_grayscale",
        "target_ring": True,
    },

    # --- navigation ---
    "nav.tabStyle": {
        "target_regions": ["nav_bar"],
        "non_target_treatment": "opacity_and_grayscale",
        "target_ring": True,
    },
    "nav.activeStyle": {
        "target_regions": ["nav_bar"],
        "non_target_treatment": "opacity_and_grayscale",
        "target_ring": True,
    },

    # --- elevation ---
    "elevation.style": {
        "target_regions": ["primary_button"],
        "non_target_treatment": "opacity_and_grayscale",
        "target_ring": True,
    },

    # --- components ---
    "components.toast": {
        "target_regions": ["toast_band"],
        "non_target_treatment": "opacity_and_grayscale",
        "target_ring": True,
    },
    "components.separator": {
        "target_regions": ["list_rows"],
        "non_target_treatment": "opacity_and_grayscale",
        "target_ring": True,
    },
    "components.buttonShape": {
        "target_regions": ["primary_button", "cta_button"],
        "non_target_treatment": "opacity_and_grayscale",
        "target_ring": True,
    },

    # --- typography ---
    "typography.headingWeight": {
        "target_regions": [],
        "non_target_treatment": "opacity_and_grayscale",
        "target_ring": False,
    },
    "typography.numericStyle": {
        "target_regions": [],
        "non_target_treatment": "opacity_and_grayscale",
        "target_ring": False,
    },

    # --- motion ---
    "motion.intensity": {
        "target_regions": [],
        "non_target_treatment": "opacity_and_grayscale",
        "target_ring": False,
    },
    "motion.transition": {
        "target_regions": [],
        "non_target_treatment": "opacity_and_grayscale",
        "target_ring": False,
    },
    "motion.press": {
        "target_regions": [],
        "non_target_treatment": "opacity_and_grayscale",
        "target_ring": False,
    },

    # --- category_id aliases (so focus_for() accepts either key form) ---
    "color-accent-system": {
        "target_regions": ["cta_button", "nav_active", "accent_indicators"],
        "non_target_treatment": "opacity_only",
        "target_ring": True,
    },
    "color-dark-mode": {
        "target_regions": ["sheet_element"],
        "non_target_treatment": "opacity_only",
        "target_ring": True,
    },
    "sheet-size": {
        "target_regions": ["sheet_element"],
        "non_target_treatment": "opacity_and_grayscale",
        "target_ring": True,
    },
    "nav-tabbar": {
        "target_regions": ["nav_bar"],
        "non_target_treatment": "opacity_and_grayscale",
        "target_ring": True,
    },
    "nav-active-state": {
        "target_regions": ["nav_bar"],
        "non_target_treatment": "opacity_and_grayscale",
        "target_ring": True,
    },
    "button-shadow": {
        "target_regions": ["primary_button"],
        "non_target_treatment": "opacity_and_grayscale",
        "target_ring": True,
    },
    "notification-toast": {
        "target_regions": ["toast_band"],
        "non_target_treatment": "opacity_and_grayscale",
        "target_ring": True,
    },
    "list-separator": {
        "target_regions": ["list_rows"],
        "non_target_treatment": "opacity_and_grayscale",
        "target_ring": True,
    },

    # --- fallback ---
    "_default": {
        "target_regions": [],
        "non_target_treatment": "opacity_and_grayscale",
        "target_ring": False,
    },
}


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

def focus_for(dimension_or_cid: str) -> dict:
    """Return the FOCUS_SPECS entry for *dimension_or_cid*.

    Lookup order:
      1. Exact match against FOCUS_SPECS (handles both dimension paths and
         category_id aliases).
      2. "_default" entry.

    Never raises.
    """
    return FOCUS_SPECS.get(dimension_or_cid, FOCUS_SPECS["_default"])


def non_target_style(dimension: str) -> str:
    """Return the CSS de-emphasis string for non-target regions.

    color.* dimensions get opacity-only (no grayscale — that hides the accent
    token being decided). All other dimensions get opacity + grayscale.
    """
    group = dimension.split(".")[0] if "." in dimension else dimension
    if group == "color":
        return _OPACITY_ONLY
    return _OPACITY_AND_GRAYSCALE


def target_ring_style(accent: str) -> str:
    """Return the CSS ring string for a target region.

    *accent* must be a hex color string like "#0A84FF".  The alpha "33"
    (~20%) is appended to produce the 8-digit hex form used in the outline
    colour.  Uses OUTLINE (not border) to avoid layout shift.  No blur.
    """
    # Strip leading '#' if present, then normalise and re-add '#'
    hex_color = accent.lstrip("#")
    accent_with_alpha = f"#{hex_color}33"
    return (
        f"outline:2px solid {accent_with_alpha};"
        "outline-offset:3px;"
        "border-radius:4px;"
    )


def is_target_region(region: str, focus: dict) -> bool:
    """Return True if *region* is in focus["target_regions"]."""
    return region in focus.get("target_regions", [])
