"""Behavior-annotation preview path — orthogonal to the fidelity/color path.

DESIGN CONTRACT
---------------
``fidelity_for(dimension)`` classifies COLOR/ELEVATION/MOTION dimensions as
"high" so the high-fi renderer fires for those.  This module is a SEPARATE,
PARALLEL path for BEHAVIOR/MOTION dimensions where the difference between
options is not a color perception question but a structural-motion question
(snap points, drag mechanics, transition geometry).

Critically:
  - ``fidelity_for`` is NOT touched.  ``spacing.density`` stays "low" forever.
  - The behavior annotation fires on OPTION_ID, not dimension — because
    ``spacing.density`` is shared by non-behavior categories
    (profile-header, onboard-structure) whose option ids are NOT registered
    here and therefore get None (low-fi fallback).

Public API
----------
BEHAVIOR_DIMENSIONS : frozenset[str]
    Dimension paths that are behaviour/motion decisions.
BEHAVIOR_CATEGORY_IDS : frozenset[str]
    Category ids whose options are behaviour decisions even if their dimension
    string is shared with non-behaviour categories.
is_behavior(key: str) -> bool
    True when key is in BEHAVIOR_DIMENSIONS OR BEHAVIOR_CATEGORY_IDS.
render_behavior_annotation(category_id: str, option_id: str,
                            tokens: dict | None) -> str | None
    Returns an annotated schematic fragment for (category_id, option_id), or
    None if no annotation exists.  Delegates to ios_pack detent fragments for
    the sheet-size options.
render_behavior_annotation_by_option(option_id: str,
                                      tokens: dict | None) -> str | None
    Dimension-agnostic entry point: looks up option_id in the registered
    option→fragment map and returns the fragment or None.  This is what
    router.render_high_fi calls so it never needs to see a category_id.

Pure stdlib.  No deps, no network, no vendor SDK.
"""

from __future__ import annotations

from typing import Any, Optional

# Lazy import to avoid circular: ios_pack imports nothing from here.
from .highfi.ios_pack import (
    _hf_ios_detent_fixed_40,
    _hf_ios_detent_snap_30_85,
    _hf_ios_detent_free,
)

# ---------------------------------------------------------------------------
# Classification sets
# ---------------------------------------------------------------------------

BEHAVIOR_DIMENSIONS: frozenset[str] = frozenset({
    "motion.press",
    "motion.transition",
    "motion.intensity",
    # spacing.density IS here because sheet-size uses it as its dimension —
    # but is_behavior() alone is NOT the dispatch gate; option-id lookup is.
    "spacing.density",
})

# Category ids whose options represent behaviour decisions even when their
# dimension string is shared with purely-visual categories.
BEHAVIOR_CATEGORY_IDS: frozenset[str] = frozenset({
    "sheet-size",
    "swipe-reveal",
    "micro-toggle",
    "nav-back",
})


def is_behavior(key: str) -> bool:
    """True when *key* is a behaviour dimension path OR a behaviour category id.

    >>> is_behavior("spacing.density")   # sheet-size uses this dimension
    True
    >>> is_behavior("sheet-size")
    True
    >>> is_behavior("typography.headingWeight")
    False
    """
    return key in BEHAVIOR_DIMENSIONS or key in BEHAVIOR_CATEGORY_IDS


# ---------------------------------------------------------------------------
# Option-id → fragment registry (the dispatch table)
# ---------------------------------------------------------------------------
# Keys: the globally-unique option ids from categories.json for behavior
# categories.  Values: zero-arg callables that accept tokens.
#
# Only sheet-size's three option ids are registered for now; swipe-reveal,
# micro-toggle, and nav-back can be added here as fragments are authored.

def _make_detent_registry() -> dict[str, Any]:
    return {
        "detent-medium-only": _hf_ios_detent_fixed_40,
        "detent-snap-two":    _hf_ios_detent_snap_30_85,
        "detent-continuous":  _hf_ios_detent_free,
    }


# Populated once at module load.
_BEHAVIOR_OPTION_RENDERERS: dict[str, Any] = _make_detent_registry()

# Which option-ids belong to which category (for render_behavior_annotation).
_OPTION_TO_CATEGORY: dict[str, str] = {
    "detent-medium-only": "sheet-size",
    "detent-snap-two":    "sheet-size",
    "detent-continuous":  "sheet-size",
}


# ---------------------------------------------------------------------------
# Public render functions
# ---------------------------------------------------------------------------

def render_behavior_annotation(
    category_id: str,
    option_id: str,
    tokens: Optional[dict[str, Any]] = None,
) -> Optional[str]:
    """Return an annotated schematic fragment for (category_id, option_id).

    Returns None if no annotation is registered for this combination.  The
    caller (schematic.render_decision_previews_tiered or tests) can use this
    as a direct lookup when both ids are known.
    """
    # Validate that the option belongs to the stated category to prevent
    # cross-category option id collisions from dispatching incorrectly.
    expected_cat = _OPTION_TO_CATEGORY.get(option_id)
    if expected_cat is not None and expected_cat != category_id:
        return None
    fn = _BEHAVIOR_OPTION_RENDERERS.get(option_id)
    if fn is None:
        return None
    return fn(tokens)


def render_behavior_annotation_by_option(
    option_id: str,
    tokens: Optional[dict[str, Any]] = None,
) -> Optional[str]:
    """Dimension-agnostic entry point used by router.render_high_fi.

    Returns the fragment for option_id or None if not registered.
    Only the explicitly-registered behavior option ids produce art — all other
    spacing.density option ids (profile-cover-avatar, onboard-value-first, etc.)
    return None and therefore fall back to low-fi.
    """
    fn = _BEHAVIOR_OPTION_RENDERERS.get(option_id)
    if fn is None:
        return None
    return fn(tokens)
