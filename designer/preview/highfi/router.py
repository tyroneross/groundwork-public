"""High-fidelity tier-selection router — the heart of progressive fidelity.

The escalation rule (from `designer/preview/fidelity_rule.py`) is the ENGINE's
tier-selection logic, not a manual toggle:

  * Low-fi schematic is the DEFAULT for every dimension.
  * High-fi fires ONLY where fidelity actually changes the pick — the
    color / depth-elevation / motion dimensions (`fidelity_for(dimension) == "high"`).
  * Even on a high-fi dimension, high-fi only renders if a pack actually has art
    for that (option_id, platform); otherwise the router falls back to low-fi.
    (iOS-only delight like haptics/splash has no web/macOS art -> low-fi there.)

This keeps it cheap/fast first (Accuracy > Speed > Cost): the expensive high-fi
fragment is produced only for the ~52 option-ids on the ~14 dimensions where it
matters, across the platforms that have art for it. Everything else stays on the
already-working low-fi path.

This is a HEURISTIC the engine applies, NOT a hard gate. There is no enforced
behavior the user didn't ask for: a dimension simply renders at the tier where a
valid pick is possible. The classification lives in one place
(`fidelity_rule.fidelity_for`) so it stays flexible and tunable.

Pure stdlib. No deps, no network, no vendor SDK.
"""

from __future__ import annotations

from typing import Any, Optional

from ..fidelity_rule import fidelity_for
from ..behavior_preview import render_behavior_annotation_by_option
from .ios_pack import render_ios_high_fi
from .macos_pack import render_macos_high_fi
from .web_pack import render_web_high_fi

# platform -> high-fi renderer for that platform
_HIGH_FI_RENDERERS = {
    "ios": render_ios_high_fi,
    "macos": render_macos_high_fi,
    "web": render_web_high_fi,
}


def tier_for(dimension: str) -> str:
    """Return the tier ('high' | 'low') the engine selects for a dimension.

    Thin delegation to the single classification source. High-fi only on
    color/elevation/motion; low-fi everywhere else.
    """
    return fidelity_for(dimension)


def should_escalate(dimension: str) -> bool:
    """True iff this dimension is one where fidelity changes the pick."""
    return tier_for(dimension) == "high"


def render_high_fi(
    platform: str,
    option_id: str,
    dimension: str,
    tokens: Optional[dict[str, Any]] = None,
) -> Optional[str]:
    """Return a high-fi fragment for (platform, option_id) IF the engine selects
    high-fi for this dimension AND the platform's pack has art for the option.

    Returns None in every other case — the caller then uses the low-fi schematic.
    This is the per-(option, platform) escalation decision in one place:

      1. dimension not a high-fi dimension      -> None (low-fi default)
      2. unknown platform                        -> None
      3. platform pack has no art for option_id  -> None (graceful fallback)
      4. otherwise                               -> the scoped high-fi fragment
    """
    if not should_escalate(dimension):
        # Fidelity gate did not fire (non-color/elevation/motion dimension).
        # Try the ORTHOGONAL behavior-annotation path.  This is keyed on
        # option_id (globally unique), so only the explicitly-registered
        # behavior option ids (e.g. detent-medium-only, detent-snap-two,
        # detent-continuous) produce art — all other spacing.density option
        # ids (profile-cover-avatar, onboard-value-first, etc.) get None and
        # fall through to low-fi, leaving fidelity_for UNTOUCHED.
        #
        # Behavior annotations are iOS schematics and are platform-neutral
        # (they render the same HTML regardless of platform); we return them
        # on every platform so the decision preview shows distinct cards
        # wherever the sheet-size category is rendered.
        behavior = render_behavior_annotation_by_option(option_id, tokens)
        if behavior is not None:
            return behavior
        return None
    renderer = _HIGH_FI_RENDERERS.get(platform)
    if renderer is None:
        return None
    # renderer returns None when its pack lacks art for this option_id.
    return renderer(option_id, tokens)
