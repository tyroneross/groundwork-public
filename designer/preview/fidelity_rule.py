"""Fidelity escalation rule for the preview engine.

Phase 1 only ever renders LOW-fidelity schematics. This module flags which
design dimensions would require a HIGH-fidelity renderer (Phase 2) to make a
meaningful pick — because a schematic can't convey the visual difference between
e.g. two color hues or two motion curves well enough for a valid revealed-preference
pick.

HIGH-FIDELITY is needed when fidelity materially changes which option wins:

  color.*     — two accent colors look identical as a block on a schematic; a
                real pixel render would show the perceptual difference.
  elevation.* — shadows, glass layers, and gradient depth only differentiate at
                actual pixel density; flat box schematics collapse them.
  motion.*    — transition curves and press physics are invisible in static HTML.

Everything else (typography weight, spacing density, nav style, separator style,
button shape, radius, component idioms) is legible in a low-fi schematic.

Phase 2 would swap in a high-fidelity renderer when `fidelity_for(category)` returns
"high". That renderer is out of scope for Chunk 4 — this module only provides the
classification so Phase 2 can route correctly.

Pure stdlib. No deps, no network, no vendor SDK.
"""

from __future__ import annotations

# The token group prefixes that require high-fidelity rendering.
# A dimension string like "color.accent" starts with "color" -> high-fi.
HIGH_FI_TOKEN_PREFIXES: tuple[str, ...] = ("color", "elevation", "motion")


def needs_high_fidelity(dimension_or_category: str) -> bool:
    """Return True if the given dimension (e.g. 'color.accent', 'motion.intensity')
    or short group name (e.g. 'color') would require high-fidelity rendering.

    Used by Phase 2 to decide whether to escalate beyond the low-fi schematic.
    Phase 1 ignores the return value and always renders low-fi.
    """
    # normalise: strip leading 'dimension:' prefix if someone passes the full path
    token = dimension_or_category.strip().split(":")[0]
    # check if the first segment (group) is in the high-fi prefix set
    group = token.split(".")[0]
    return group in HIGH_FI_TOKEN_PREFIXES


def fidelity_for(category_dimension: str) -> str:
    """Return 'high' or 'low' for a catalog category's token dimension.

    category_dimension is the Category.dimension string from catalog_loader
    (e.g. 'color.accent', 'nav.tabStyle', 'spacing.density').

    Phase 1 always renders 'low' regardless of what this returns.
    Phase 2 should call this and escalate when 'high' is returned.
    """
    return "high" if needs_high_fidelity(category_dimension) else "low"
