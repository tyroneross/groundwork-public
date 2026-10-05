"""Authored option -> token_delta mapping (the V2-deferred `tokenMap`).

Chunk 2 is the SOLE AUTHOR of option->token_delta. Chunk 3 (engine) and Chunk 5
(emitter) are CONSUMERS only — they import this, never define deltas.

Each catalog category determines ONE token dimension (`dimension`), addressed as
"group.key" in the design.md/v1 vocabulary (designer/engine/schema.py). Each
option under that category supplies the token_delta it would apply when picked.

A delta is a partial token map: {group: {key: value}}. Picking an option merges
its delta onto the accumulated taste-state (resolver precedence handles floor).

Every delta validates against schema.validate_token_delta at load time
(catalog_loader.py asserts this), so a typo here is caught immediately.

Backfill note: the original prototype's `getGuideline` covered only ~15 of 32
categories. ALL 32 are mapped here (the 17 backfilled categories carry deltas
grounded in the Calm Precision ruleset, not left empty).
"""

from __future__ import annotations

# category_id -> the single design.md token dimension it determines.
CATEGORY_DIMENSION: dict[str, str] = {
    # --- Layer 1: Scope & Skeleton (must be first) ------------------------
    "platform-target": "platform.target",
    "nav-structure": "nav.layoutModel",

    "nav-tabbar": "nav.tabStyle",
    "nav-active-state": "nav.activeStyle",
    "nav-back": "components.buttonShape",     # back affordance -> control idiom
    "sheet-handle": "components.separator",   # surface affordance treatment
    "sheet-size": "spacing.density",          # detent behavior -> density posture
    "swipe-reveal": "components.buttonShape",
    "press-feedback": "motion.press",
    "button-shadow": "elevation.style",
    "page-transition": "motion.transition",
    "pull-refresh": "motion.intensity",
    "list-separator": "components.separator",
    "search-bar": "nav.tabStyle",             # search placement -> nav idiom
    "loading-state": "motion.intensity",
    "empty-state": "components.emptyState",
    "notification-toast": "components.toast",
    "color-gradient-style": "elevation.style",
    "color-dark-mode": "color.surface",
    "color-accent-system": "color.accent",
    "type-heading-style": "typography.headingWeight",
    "type-numbers": "typography.numericStyle",
    "micro-icon-anim": "motion.intensity",
    "micro-haptics": "motion.intensity",
    "micro-toggle": "components.buttonShape",
    "onboard-structure": "spacing.density",
    "onboard-progress": "components.separator",
    "onboard-animation": "motion.intensity",
    "profile-header": "spacing.density",
    "profile-avatar-edit": "components.buttonShape",
    "profile-stats": "typography.numericStyle",
    "delight-celebration": "motion.intensity",
    "delight-splash": "motion.intensity",
    "delight-scroll-physics": "motion.transition",
}

# ---------------------------------------------------------------------------
# Ordering-tier mapping  (DISTINCT from the preview-fidelity "tier")
# ---------------------------------------------------------------------------
#
# Ordering tier controls the PRIMARY SORT of undetermined categories during
# the adaptive walk:
#   Tier 1 "Direction"   — big visual direction decisions; do these first
#   Tier 2 "Foundations" — structural/systemic choices; do next
#   Tier 3 "Details"     — micro, surface-specific, or dependent choices; last
#
# This mirrors the primitive→semantic→component cascade used by Material,
# Atlassian, and USWDS design-token systems: paint block-in general→specific,
# and surface the highest-leverage choice to the user first (progressive
# disclosure / Hick's Law).
#
# Rationale for specific assignments:
#   color.accent  → Tier 1: accent application is the single biggest visual
#                   direction signal; sets the emotional register of the whole UI.
#   typography.headingWeight, spacing.density, components.buttonShape,
#   nav.tabStyle, typography.numericStyle
#                 → Tier 2: foundational type, density, shape, and nav
#                   language — cascades through every screen.
#   Everything else (color.surface, elevation.style, motion.*, nav.activeStyle,
#   components.toast/separator/emptyState)
#                 → Tier 3: surface-treatment details that depend on Tier 1+2.
#                   color.surface (dark-mode treatment) is the user's specific
#                   complaint: it must NOT surface 3rd — it must be last because
#                   its correct answer depends on accent + density decisions.

DIMENSION_ORDERING_TIER: dict[str, int] = {
    # --- Tier 0: Layer-1 Scope & Skeleton (before all direction/foundation) ---
    # Platform and nav-skeleton are the highest-elimination decisions — they
    # constrain everything downstream (Hick: prune the space first).
    # Assigned tier 1 so they sort before color/type/motion direction decisions.
    "platform.target":            1,
    "nav.layoutModel":            1,

    # --- Tier 1: Direction ---
    "color.accent":               1,

    # --- Tier 2: Foundations ---
    "typography.headingWeight":   2,
    "spacing.density":            2,
    "components.buttonShape":     2,
    "nav.tabStyle":               2,
    "typography.numericStyle":    2,

    # --- Tier 3: Details (dependent, surface-specific, micro) ---
    "color.surface":              3,   # dark-mode treatment depends on Tier 1+2
    "elevation.style":            3,
    "motion.intensity":           3,
    "motion.transition":          3,
    "motion.press":               3,
    "nav.activeStyle":            3,
    "components.toast":           3,
    "components.separator":       3,
    "components.emptyState":      3,
}


def ordering_tier_for_dimension(dimension: str) -> int:
    """Return the ordering tier (1, 2, or 3) for a design dimension.

    Tier 1 = Direction, Tier 2 = Foundations, Tier 3 = Details.
    Unmapped dimensions default to Tier 2 (safe middle ground — never crashes).
    """
    return DIMENSION_ORDERING_TIER.get(dimension, 2)


def ordering_tier_label(tier: int) -> str:
    """Return the human-readable label for an ordering tier number.

    1 -> "Direction", 2 -> "Foundations", 3 -> "Details".
    Any other value -> "Foundations" (safe default).
    """
    return {1: "Direction", 2: "Foundations", 3: "Details"}.get(tier, "Foundations")


# ---------------------------------------------------------------------------
# Layer mapping  (DISTINCT from ordering-tier)
# ---------------------------------------------------------------------------
#
# Layers group dimensions by their coarse-to-fine role in the design walk.
# Layer is the PRIMARY sort key; ordering-tier is the SECONDARY (within-layer
# tie-break). Together they give a strict coarse→fine walk:
#
#   Layer 1 "Scope & Skeleton" — highest elimination power; constrain ALL
#     downstream decisions (platform.target, nav.layoutModel). Decide these
#     first to prune the design space (Hick's Law, information-gain maximum).
#
#   Layer 2 "Foundations" — visual direction and structural language that
#     cascade across the whole UI (accent, type weight, density, shape, nav
#     style, numeric style). Surface after scope is fixed.
#
#   Layer 3 "Details" — surface-treatment, micro-interaction, and dependent
#     choices that are meaningful only once Layer 1+2 are decided.

DIMENSION_LAYER: dict[str, int] = {
    # --- Layer 1: Scope & Skeleton -------------------------------------------
    "platform.target":            1,
    "nav.layoutModel":            1,

    # --- Layer 2: Foundations ------------------------------------------------
    "color.accent":               2,
    "typography.headingWeight":   2,
    "spacing.density":            2,
    "components.buttonShape":     2,
    "nav.tabStyle":               2,
    "typography.numericStyle":    2,

    # --- Layer 3: Details ----------------------------------------------------
    "color.surface":              3,
    "elevation.style":            3,
    "motion.intensity":           3,
    "motion.transition":          3,
    "motion.press":               3,
    "nav.activeStyle":            3,
    "components.toast":           3,
    "components.separator":       3,
    "components.emptyState":      3,
}


def layer_for_dimension(dimension: str) -> int:
    """Return the layer (1, 2, or 3) for a design dimension.

    Layer 1 = Scope & Skeleton (highest elimination; decide first).
    Layer 2 = Foundations (visual direction and structural language).
    Layer 3 = Details (surface treatment, micro, dependent choices).
    Unmapped dimensions default to Layer 2 (safe middle — never crashes).
    """
    return DIMENSION_LAYER.get(dimension, 2)


def layer_label(layer: int) -> str:
    """Return the human-readable label for a layer number.

    1 -> "Scope & Skeleton", 2 -> "Foundations", 3 -> "Details".
    Any other value -> "Foundations" (safe default).
    """
    return {
        1: "Scope & Skeleton",
        2: "Foundations",
        3: "Details",
    }.get(layer, "Foundations")


# option_id -> token_delta. The dimension above tells the engine WHICH token a
# category resolves; the delta below is what the chosen option writes.
OPTION_DELTA: dict[str, dict] = {
    # --- Layer 1: Scope & Skeleton ----------------------------------------
    "platform-web":         {"platform": {"target": "web"}},
    "platform-ios":         {"platform": {"target": "ios"}},
    "platform-macos":       {"platform": {"target": "macos"}},
    "platform-multi":       {"platform": {"target": "multi"}},

    "nav-structure-left":   {"nav": {"layoutModel": "left-nav"}},
    "nav-structure-top":    {"nav": {"layoutModel": "top-nav"}},
    "nav-structure-tabbar": {"nav": {"layoutModel": "tab-bar"}},
    "nav-structure-none":   {"nav": {"layoutModel": "none"}},

    # --- Navigation -------------------------------------------------------
    "tabbar-icon-label": {"nav": {"tabStyle": "icon-label"}},
    "tabbar-icon-only": {"nav": {"tabStyle": "icon-only"}},
    "tabbar-floating": {"nav": {"tabStyle": "floating-pill"}, "elevation": {"depth": "raised"}},
    "tabbar-scroll-hide": {"nav": {"tabStyle": "auto-hide"}},

    "active-fill-color": {"nav": {"activeStyle": "fill-color"}},
    "active-pill-bg": {"nav": {"activeStyle": "pill-bg"}},
    "active-dot": {"nav": {"activeStyle": "dot"}},
    "active-top-line": {"nav": {"activeStyle": "text-underline"}},

    "back-label": {"components": {"buttonShape": "flat"}},
    "back-icon-only": {"components": {"buttonShape": "flat"}},
    "back-x-close": {"components": {"buttonShape": "pill"}},

    # --- Drawers & Sheets -------------------------------------------------
    "handle-pill-gray": {"components": {"separator": "inset-line"}},
    "handle-pill-dark": {"components": {"separator": "inset-line"}, "elevation": {"depth": "raised"}},
    "handle-none-header": {"components": {"separator": "none"}},
    "handle-full-topbar": {"components": {"separator": "full-line"}},

    "detent-medium-only": {"spacing": {"density": "comfortable"}},
    "detent-snap-two": {"spacing": {"density": "comfortable"}},
    "detent-continuous": {"spacing": {"density": "spacious"}, "motion": {"intensity": "expressive"}},

    # --- Gestures ---------------------------------------------------------
    "swipe-icon-label": {"components": {"buttonShape": "flat"}},
    "swipe-icon-only": {"components": {"buttonShape": "flat"}},
    "swipe-full-destructive": {"components": {"buttonShape": "flat"}, "color": {"danger": "#FF3B30"}},

    # --- Touch Feedback ---------------------------------------------------
    "press-scale-down": {"motion": {"press": "scale-down"}},
    "press-opacity-dim": {"motion": {"press": "opacity-dim"}},
    "press-highlight-bg": {"motion": {"press": "highlight-bg"}},
    "press-ripple": {"motion": {"press": "ripple"}},

    # --- Button Design ----------------------------------------------------
    "btn-flat": {"elevation": {"style": "flat-border"}, "components": {"buttonShape": "flat"}},
    "btn-soft-shadow": {"elevation": {"style": "soft-shadow"}, "components": {"buttonShape": "soft"}},
    "btn-inner-highlight": {"elevation": {"style": "inner-highlight"}},
    "btn-glass": {"elevation": {"style": "glass"}, "components": {"buttonShape": "glass"}},

    # --- Motion -----------------------------------------------------------
    "transition-push-slide": {"motion": {"transition": "push-slide"}},
    "transition-hero-expand": {"motion": {"transition": "hero-expand", "intensity": "expressive"}},
    "transition-fade": {"motion": {"transition": "fade"}},
    "transition-sheet-up": {"motion": {"transition": "sheet-up"}},

    "ptr-native-spinner": {"motion": {"intensity": "restrained"}},
    "ptr-progress-arc": {"motion": {"intensity": "standard"}},
    "ptr-logo-morph": {"motion": {"intensity": "expressive"}},

    # --- List Design ------------------------------------------------------
    "sep-inset-line": {"components": {"separator": "inset-line"}},
    "sep-full-line": {"components": {"separator": "full-line"}},
    "sep-card-per-row": {"components": {"separator": "card-per-row"}, "elevation": {"depth": "raised"}},
    "sep-none-spacing": {"components": {"separator": "none"}, "spacing": {"density": "spacious"}},

    # --- Search & Input ---------------------------------------------------
    "search-nav-bar": {"nav": {"tabStyle": "icon-label"}},
    "search-sticky-top": {"nav": {"tabStyle": "icon-label"}},
    "search-tab-icon": {"nav": {"tabStyle": "icon-label"}},

    # --- Loading States ---------------------------------------------------
    "skeleton-shimmer-ltr": {"motion": {"intensity": "standard"}},
    "skeleton-pulse": {"motion": {"intensity": "restrained"}},
    "skeleton-blur": {"motion": {"intensity": "expressive"}},

    # --- Empty & Error States ---------------------------------------------
    "empty-icon-only": {"components": {"emptyState": "icon-text"}},
    "empty-illustration": {"components": {"emptyState": "illustration"}},
    "empty-text-only": {"components": {"emptyState": "text-only"}},

    # --- Feedback Patterns ------------------------------------------------
    "toast-top-banner": {"components": {"toast": "top-banner"}},
    "toast-bottom-pill": {"components": {"toast": "bottom-pill"}},
    "toast-inline": {"components": {"toast": "inline"}},
    "toast-center-hud": {"components": {"toast": "center-hud"}},

    # --- Color & Visual Depth ---------------------------------------------
    "gradient-linear": {"elevation": {"style": "gradient"}},
    "gradient-mesh": {"elevation": {"style": "gradient-mesh"}, "motion": {"intensity": "expressive"}},
    "gradient-duotone": {"elevation": {"style": "gradient-duotone"}},
    "gradient-none": {"elevation": {"style": "flat-border"}},

    "dark-true-black": {"color": {"surface": "#000000", "bg": "#000000"}},
    "dark-elevated-layers": {"color": {"surface": "#1C1C1E", "bg": "#000000"}},
    "dark-deep-color": {"color": {"surface": "#0B1020", "bg": "#060912"}},
    "dark-glass-layers": {"color": {"surface": "#1C1C1E"}, "elevation": {"style": "glass"}},

    "accent-cta-only": {"color": {"accent": "#0A84FF"}},
    "accent-semantic": {"color": {"accent": "#0A84FF", "success": "#1E874B", "warning": "#C2410C"}},
    "accent-expressive": {"color": {"accent": "#5E5CE6"}, "motion": {"intensity": "expressive"}},

    # --- Typography -------------------------------------------------------
    "type-sf-system": {"typography": {"headingWeight": 600, "fontFamily": "-apple-system, 'SF Pro Text', sans-serif"}},
    "type-weight-contrast": {"typography": {"headingWeight": 800}},
    "type-tight-tracking": {"typography": {"headingWeight": 700, "tracking": "tight"}},
    "type-custom-font": {"typography": {"headingWeight": 700, "fontFamily": "'Custom Brand', system-ui, sans-serif"}},

    "num-hero-large": {"typography": {"numericStyle": "hero"}},
    "num-mono-tabular": {"typography": {"numericStyle": "tabular"}},
    "num-mixed-weight": {"typography": {"numericStyle": "mixed-weight"}},

    # --- Micro-Interactions ----------------------------------------------
    "icon-instant-swap": {"motion": {"intensity": "restrained"}},
    "icon-spring-bounce": {"motion": {"intensity": "standard"}},
    "icon-morph-fill": {"motion": {"intensity": "standard"}},
    "icon-lottie-rive": {"motion": {"intensity": "expressive"}},

    "haptic-minimal": {"motion": {"intensity": "restrained"}},
    "haptic-standard-vocab": {"motion": {"intensity": "standard"}},
    "haptic-expressive": {"motion": {"intensity": "expressive"}},

    "toggle-native": {"components": {"buttonShape": "flat"}},
    "toggle-spring-stretch": {"components": {"buttonShape": "soft"}, "motion": {"intensity": "expressive"}},
    "toggle-segmented-pill": {"components": {"buttonShape": "pill"}},
    "toggle-checkbox-morph": {"components": {"buttonShape": "flat"}, "motion": {"intensity": "standard"}},

    # --- Onboarding -------------------------------------------------------
    "onboard-value-first": {"spacing": {"density": "spacious"}},
    "onboard-progressive-steps": {"spacing": {"density": "comfortable"}},
    "onboard-interactive-tutorial": {"spacing": {"density": "comfortable"}, "motion": {"intensity": "standard"}},
    "onboard-personalization-quiz": {"spacing": {"density": "comfortable"}},

    "onboard-dots": {"components": {"separator": "inset-line"}},
    "onboard-fill-bar": {"components": {"separator": "full-line"}},
    "onboard-step-counter": {"components": {"separator": "none"}},
    "onboard-no-progress": {"components": {"separator": "none"}},

    "onboard-slide-parallax": {"motion": {"intensity": "standard"}},
    "onboard-lottie-scenes": {"motion": {"intensity": "expressive"}},
    "onboard-morph-shapes": {"motion": {"intensity": "expressive"}},
    "onboard-stagger-entry": {"motion": {"intensity": "standard"}},

    # --- User Profile -----------------------------------------------------
    "profile-cover-avatar": {"spacing": {"density": "comfortable"}, "elevation": {"depth": "raised"}},
    "profile-centered-avatar": {"spacing": {"density": "spacious"}},
    "profile-compact-card": {"spacing": {"density": "compact"}},
    "profile-gradient-bg": {"spacing": {"density": "comfortable"}, "elevation": {"style": "gradient"}},

    "avatar-camera-badge": {"components": {"buttonShape": "flat"}},
    "avatar-long-press-sheet": {"components": {"buttonShape": "flat"}},
    "avatar-generated-default": {"components": {"buttonShape": "pill"}},
    "avatar-story-ring": {"components": {"buttonShape": "pill"}, "motion": {"intensity": "standard"}},

    "stats-number-row": {"typography": {"numericStyle": "tabular"}},
    "stats-heatmap": {"typography": {"numericStyle": "tabular"}},
    "stats-rings": {"typography": {"numericStyle": "hero"}, "motion": {"intensity": "standard"}},
    "stats-rich-cards": {"typography": {"numericStyle": "mixed-weight"}, "elevation": {"depth": "raised"}},

    # --- Delight & Celebration -------------------------------------------
    "celebrate-confetti": {"motion": {"intensity": "expressive"}},
    "celebrate-checkmark-ripple": {"motion": {"intensity": "standard"}},
    "celebrate-full-screen": {"motion": {"intensity": "expressive"}},
    "celebrate-score-glow": {"motion": {"intensity": "standard"}},

    "splash-fade-in": {"motion": {"intensity": "restrained"}},
    "splash-logo-build": {"motion": {"intensity": "standard"}},
    "splash-morph-ui": {"motion": {"intensity": "expressive"}},
    "splash-ambient-particle": {"motion": {"intensity": "expressive"}},

    "scroll-system": {"motion": {"transition": "push-slide"}},
    "scroll-sticky-headers": {"motion": {"transition": "push-slide"}},
    "scroll-parallax-bg": {"motion": {"transition": "hero-expand"}},
    "scroll-snap-cards": {"motion": {"transition": "sheet-up"}},
}
