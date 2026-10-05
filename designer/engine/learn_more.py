"""Learn-more explainer builder — progressive-disclosure HTML per category.

Returns a collapsed <details> block (Hick's Law: no open= attribute) that
explains what a design decision controls, what it does, and the key Calm
Precision tradeoff for that dimension.

Pure stdlib. No deps, no network, no vendor SDK.
"""

from __future__ import annotations

import html
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .catalog_loader import Category


# ---------------------------------------------------------------------------
# Hand-authored learn-more content table, keyed by category id.
# Each entry is a 3-tuple:
#   (what_controls: str, what_does: str, considerations: list[str])
# ---------------------------------------------------------------------------

_LEARN_MORE: dict[str, tuple[str, str, list[str]]] = {
    "nav-tabbar": (
        "The visual layout and persistent navigation strip anchored at the bottom of the screen.",
        "Determines whether tabs show icons, labels, or both, and how the bar itself is positioned. "
        "Label presence affects scanability; a floating style changes spatial grounding.",
        [
            "Calm Precision: selected state uses text color + 2 px bottom border — avoid background boxes.",
            "Icon-only tabs save vertical space but raise the cognitive load for first-time users unfamiliar with the icon set.",
            "Auto-hiding tabs recover screen real estate but add discovery friction on return.",
        ],
    ),
    "nav-active-state": (
        "The visual indicator that marks which tab or navigation item is currently selected.",
        "Controls whether the active tab is distinguished by color fill, a pill background, a dot, or a structural line. "
        "The treatment signals the app's overall UI language and how much visual weight the navigation claims.",
        [
            "Calm Precision specifies text color change + 2 px bottom border; pill backgrounds add boxing that competes with content.",
            "Color-fill active states rely on a meaningful accent color — a neutral palette makes them invisible.",
            "Top-border lines reference desktop tab conventions; test whether the target audience reads the affordance correctly.",
        ],
    ),
    "nav-back": (
        "The affordance that lets users move backward through a navigation hierarchy or dismiss a modal.",
        "Sets whether back navigation shows the parent screen's name, a bare chevron, or an × close button. "
        "The label choice directly affects context retention across deep hierarchies.",
        [
            "Apple HIG default is parent-name label; it costs space but provides strong spatial context in deep hierarchies.",
            "Chevron-only saves space but removes destination context — best when hierarchy is shallow or the user is experienced.",
            "The × close button signals modal context (a layer to dismiss), not hierarchical back — mixing them causes navigational confusion.",
        ],
    ),
    "sheet-handle": (
        "The visible drag indicator at the top of a bottom sheet that signals it can be moved.",
        "Determines whether a gray pill, dark pill, hidden-drag-zone, or full top-bar handle appears. "
        "Handle presence is the primary affordance that teaches users a sheet is interactive.",
        [
            "Calm Precision recommends bottom sheets over modals for detail views; the handle makes that interaction discoverable.",
            "No-handle patterns require an alternative teaching moment — onboarding callout or gesture hint.",
            "Full top-bar adds the most chrome; only justified when the sheet also needs a persistent title and close button.",
        ],
    ),
    "sheet-size": (
        "How a bottom sheet determines its height and responds to drag gestures — its snap points and resting positions.",
        "Controls whether the sheet locks to a fixed half-height, snaps between two stops (like Apple Maps), "
        "or allows free drag to any height. Each approach trades predictability for flexibility.",
        [
            "Calm Precision defines three canonical detents: 40 vh small, 60 vh medium, 85 vh large — snapping to these keeps context visible behind the sheet.",
            "Two-stop snapping (compact ↔ expanded) is the clearest UX: users learn one drag gesture and get two useful states.",
            "Free continuous drag gives maximum control but requires the user to reason about height; it raises cognitive load mid-flow.",
        ],
    ),
    "swipe-reveal": (
        "The hidden actions that appear when a user swipes left or right on a list item.",
        "Sets the visual form of revealed actions: labeled buttons, icon-only circles, or a full-width destructive sweep. "
        "The treatment balances discoverability against screen density.",
        [
            "Calm Precision: right swipe = positive (save/archive), left swipe = negative (delete) — inversion breaks user muscle memory.",
            "Icon-only actions are compact but require icon recognition; add labels when actions are infrequently used.",
            "Full-width destructive (swipe-to-delete) is irreversible by feel — always confirm or offer undo before data loss.",
        ],
    ),
    "press-feedback": (
        "The visual and tactile response an element gives when a user presses it.",
        "Determines whether a tap triggers a scale-down, an opacity dim, a background flash, or a ripple. "
        "The feedback style shapes how physical and responsive the app feels.",
        [
            "Calm Precision: active:scale-[0.98] + 100 ms ease-out is the baseline — subtle enough not to distract, present enough to confirm.",
            "Scale-down works on bounded elements; avoid it on full-width rows where the compression looks wrong.",
            "Ripple effects are not native iOS; they read as cross-platform to experienced users — use deliberately.",
        ],
    ),
    "button-shadow": (
        "The elevation treatment of primary action buttons — how much depth or lift they project.",
        "Controls whether buttons appear flat, carry a colored drop shadow, show a subtle inner highlight, or use frosted glass. "
        "Shadow signals importance and interactivity weight.",
        [
            "Calm Precision (Affordance Theory): interactive elements must visually signal clickability — a flat button relies entirely on color contrast.",
            "Colored shadows (matching the button tint) look more intentional than gray shadows, which read as a generic OS artifact.",
            "Glass buttons require a sufficiently varied background to read; on a plain white surface they become invisible.",
        ],
    ),
    "page-transition": (
        "The animation that plays when the user navigates between screens.",
        "Sets the direction, style, and spatial metaphor of screen changes: slide push, hero expansion, crossfade, or upward modal. "
        "The choice communicates hierarchy and layer depth.",
        [
            "Calm Precision: push transitions reinforce hierarchy — use them only for navigation moves, not for modal layering.",
            "Hero expansion (shared element transition) requires the tapped element to be visible on both screens; plan layouts accordingly.",
            "Crossfade is directionless — use it for tab switches or peer-level navigation, not for parent→child drill-down.",
        ],
    ),
    "pull-refresh": (
        "The animation and indicator shown when a user drags down to reload content.",
        "Controls whether refresh feedback is a system spinner, a progress arc that tracks pull distance, or a branded animation. "
        "The choice sets the perceived responsiveness of the data layer.",
        [
            "Calm Precision: 60 px threshold, spinner visible during active refresh — do not dismiss the indicator until data has settled.",
            "Progress-arc patterns give 1:1 tactile feedback during the pull gesture; they feel more responsive than a spinner that appears only at threshold.",
            "Branded animations are high-identity but must complete within ~1 s before feeling like loading friction.",
        ],
    ),
    "list-separator": (
        "The visual boundary between items in a list or feed.",
        "Determines whether rows are divided by inset hairlines, full-width lines, individual cards, or whitespace alone. "
        "The treatment sets perceived density and the relationship between items.",
        [
            "Calm Precision core rule: one border around a related group, dividers between items — never individual borders on each row.",
            "Card-per-row adds the most chrome and works best when items are heterogeneous; hairlines suit uniform, scannable lists.",
            "Whitespace-only separation requires consistent row height and strong typography to maintain visual rhythm.",
        ],
    ),
    "search-bar": (
        "The placement and visibility of the search input within a list or feed view.",
        "Controls whether search lives in the navigation bar (scrolls away), stays pinned at the top, or occupies a dedicated tab. "
        "Position determines how quickly users can reach search and how much content space is traded.",
        [
            "Apple HIG default: search in nav bar row 3, revealed by pull-down — preserves full content area on initial load.",
            "A sticky search bar permanently costs 44–56 px of content height; only justified when search is the dominant interaction.",
            "A dedicated search tab communicates that search is a primary experience, not a utility — match the tab weight to actual usage frequency.",
        ],
    ),
    "loading-state": (
        "The placeholder UI shown while content is being fetched from the network.",
        "Sets whether loading is represented by a shimmer skeleton, a pulsing fade, or blurred actual content. "
        "The pattern determines how long a wait feels and how much layout shift occurs on load.",
        [
            "Calm Precision: skeleton screens for 1–3 s waits; shimmer 1.5 s; match the three-line layout so content lands without jarring reflow.",
            "Shimmer direction (left-to-right) implies progress; pulse fades are calmer but give no sense of advancement.",
            "Blurred content shows real layout immediately — zero shift on load — but can feel teasing if data takes more than ~1 s.",
        ],
    ),
    "empty-state": (
        "The visual design of a screen or section when no content exists yet.",
        "Controls whether an empty state uses a system icon, a custom illustration, or text alone. "
        "The choice sets the emotional register — encouraging versus minimal — and the brand investment visible at first run.",
        [
            "Calm Precision: first-run empty states should state the value promise and offer a setup CTA, not just announce emptiness.",
            "Custom illustrations create personality but require ongoing maintenance as the app evolves; system icons cost nothing and age well.",
            "Text-only empty states work best in productivity apps where an illustration would feel out of register with the dense, functional UI.",
        ],
    ),
    "notification-toast": (
        "The position and form of brief in-app feedback messages after user actions.",
        "Controls whether confirmation toasts appear as top banners, bottom pills, contextual inline tips, or center HUDs. "
        "Placement determines visibility, disruption level, and overlap with other UI elements.",
        [
            "Calm Precision: confirmation must state what happened and what changed — position follows severity (top for errors, bottom for confirmations).",
            "Bottom pills avoid content overlap and pair well with tab bars; verify the toast clears the tab bar height on devices with home indicators.",
            "Center HUDs interrupt the current task — reserve them for rare, unambiguous completions (AirDrop success, save confirmed).",
        ],
    ),
    "color-gradient-style": (
        "How gradients are applied to buttons, cards, and primary surfaces across the app.",
        "Controls the gradient style — linear depth, organic mesh, duotone wash, or flat fill — and therefore the perceived richness and brand expressiveness.",
        [
            "Calm Precision default is flat fills; gradients add visual weight and signal premium quality when used consistently.",
            "Mesh and aurora gradients (iOS 18 MeshGradient API) are expensive to render; test frame rates on older devices before shipping.",
            "Duotone washes are editorial and opinionated — ensure they complement images and do not wash out text contrast below 4.5:1.",
        ],
    ),
    "color-dark-mode": (
        "How surface layers are differentiated from each other in dark mode.",
        "Determines whether dark surfaces use true black (#000), layered near-blacks, a chromatic tint, or frosted glass. "
        "The choice controls OLED power use, depth perception, and brand temperature.",
        [
            "True black vs. near-black (#111) is the single biggest dark-mode quality signal; cards at #1C1C1E read as elevated without any shadow.",
            "Deep chromatic darks (navy, forest) retain brand identity in dark mode but require checking all text contrast ratios against the tinted background.",
            "Frosted glass (Liquid Glass) is the iOS 26 direction; content bleed-through requires careful z-index management to avoid readability failures.",
        ],
    ),
    "color-accent-system": (
        "How liberally the brand or accent color is distributed across interactive and decorative elements.",
        "Controls whether the accent appears only on the primary CTA, follows a semantic system (CTAs, active states, progress), "
        "or spreads expressively into backgrounds, gradients, and icon fills. More uses dilutes the signal of each use.",
        [
            "Calm Precision: accent only on primary CTA and critical state — every additional placement reduces the signal strength of the accent.",
            "A semantic accent system (CTA, active state, selection, progress) gives the color purpose and makes the UI feel systematic rather than arbitrary.",
            "Expressive accent spread is high-identity but risks visual noise; establish clear rules for which surfaces receive the color before applying broadly.",
        ],
    ),
    "type-heading-style": (
        "How display headings are styled beyond point size — weight, letter-spacing, and case treatment.",
        "Controls whether headings use system defaults, extreme weight contrast, tight negative tracking, or a custom typeface. "
        "The choice determines how much the typography contributes to brand identity versus staying invisible.",
        [
            "Calm Precision three-line hierarchy: title (14–16 px bold) → description (12–14 px) → metadata (11–12 px muted); heading style amplifies this.",
            "Tight negative tracking (−0.03 em to −0.05 em) on large headings reads as intentional craft; it fails below ~24 px where glyphs start to collide.",
            "Custom fonts are high-identity but require licensing, WOFF2/TTF embedding in the app bundle, and fallback specification for every text style.",
        ],
    ),
    "type-numbers": (
        "How numbers, prices, statistics, and data values are typeset throughout the app.",
        "Determines whether numeric data uses a hero display treatment, tabular monospacing, or mixed-weight styling. "
        "The choice directly affects scan speed and perceived data precision.",
        [
            "Tabular figures (font-variant-numeric: tabular-nums) ensure decimal alignment in tables and lists; proportional figures cause columns to shift.",
            "Hero number displays (48–64 pt, light weight) work for single-metric dashboards; they fail in data-dense contexts where multiple numbers compete.",
            "Mixed-weight numerics (bold integer, light decimal) direct the eye to significant digits — a strong pattern for financial and health data.",
        ],
    ),
    "micro-icon-anim": (
        "How tab bar icons animate when tapped to change the selected tab.",
        "Controls whether the icon switches instantly, bounces with a spring, morphs between outline and fill, or plays a custom Lottie animation. "
        "This is among the most-seen interactions in the app — its quality signals overall craft.",
        [
            "The tab tap is one of the highest-frequency interactions; any animation must complete within 200 ms or it becomes a perceived lag.",
            "Spring bounce (scale 1.2×) adds delight but can feel out of register in calm, productivity-focused apps.",
            "Lottie/Rive animated icons require asset delivery at every icon size and dark/light variant — plan the asset pipeline before committing.",
        ],
    ),
    "micro-haptics": (
        "Which interactions trigger haptic feedback and how intense that feedback is.",
        "Controls whether haptics fire only at key moments (errors, success), follow the standard UIKit vocabulary, or use custom Core Haptics waveforms. "
        "Wrong haptics are more damaging to trust than no haptics.",
        [
            "Calm Precision: every vibration is a claim that something meaningful happened — haptics on routine navigation dilutes that signal.",
            "UIFeedbackGenerator covers the majority of real cases: light selection ticks, medium confirmation thuds, and error double-taps.",
            "Custom CHHaptic patterns are powerful but require device-capability checks; the engine is not available on older hardware.",
        ],
    ),
    "micro-toggle": (
        "How boolean toggles and multi-option segmented controls animate when their state changes.",
        "Controls whether toggles use the native UISwitch, a custom spring-stretch thumb, a pill slider, or a checkbox-morph animation. "
        "Toggle animation quality is a proxy for the app's overall craft level.",
        [
            "Native UISwitch requires zero implementation cost and is instantly recognized — use it unless the design requires a non-binary pattern.",
            "Spring-stretch custom thumbs must match the timing of native UISwitch (spring 0.5 s, 0.6 damping) to feel iOS-native rather than sluggish.",
            "Segmented pill sliders work for 2–4 options; beyond four options, the pill becomes too small to tap and the pattern breaks.",
        ],
    ),
    "onboard-structure": (
        "The overall approach to first-run onboarding — how many screens, what content, and in what order.",
        "Determines whether users see the product first (value-first), follow guided steps, complete an interactive tutorial, or answer a personalization quiz. "
        "Each adds or removes time-to-first-value.",
        [
            "Every extra onboarding screen costs roughly 10 % of users who entered it — keep the path to first value under 60 seconds.",
            "Value-first (drop into the app with demo content) is the highest-retention pattern but requires pre-populated state at launch.",
            "Personalization quizzes justify their screen count only when the answers meaningfully change the post-onboarding experience.",
        ],
    ),
    "onboard-progress": (
        "The indicator that shows users where they are within the onboarding flow.",
        "Controls whether progress is shown as dot pagination, a linear fill bar, a step counter, or not at all. "
        "Visible progress reduces drop-off by signaling that the end is near.",
        [
            "Showing more than 5 dots creates anxiety rather than relief — use a step counter or progress bar for flows with 6+ steps.",
            "A linear fill bar (Duolingo pattern) creates completion pull because the visual gap shrinks continuously.",
            "No progress indicator is appropriate only when the flow is 1–2 screens or when the onboarding is entirely value-first.",
        ],
    ),
    "onboard-animation": (
        "The animation style used to introduce content and transitions across onboarding screens.",
        "Controls whether onboarding uses parallax slides, Lottie scene animations, morphing shapes, or staggered element entry. "
        "This is the first animation the user sees — it sets quality expectations for the whole app.",
        [
            "Onboarding is the most-seen screen in the app's lifetime; animation quality here establishes the bar for every subsequent view.",
            "Lottie scene animations require asset delivery and Lottie runtime dependency — plan build-size impact before committing.",
            "Staggered element entry (60–80 ms between elements) is the lightest implementation and the most broadly appropriate default.",
        ],
    ),
    "profile-header": (
        "The layout and visual structure of the user profile header section.",
        "Controls whether the header uses a cover photo with overlapping avatar, a centered identity-first layout, a compact card, or a dynamic gradient. "
        "This is the user's identity real estate — it signals both app quality and user ownership.",
        [
            "Cover photo + overlapping avatar is the most recognized social pattern but requires fallback when no cover photo is set.",
            "Compact card headers are efficient in settings-page or in-app profile contexts where hierarchy depth matters more than identity expression.",
            "Auto-generated gradient backgrounds (from avatar or brand color) eliminate the empty-state problem without requiring a photo upload.",
        ],
    ),
    "profile-avatar-edit": (
        "How the user's profile avatar is displayed and how users trigger an edit or replacement.",
        "Controls whether editing is triggered by a camera badge tap, a long-press action sheet, or handled via a generated default. "
        "Avatar editing is often a first-session action and a quality signal before the user has seen anything else.",
        [
            "Camera badge is the most recognized pattern — small enough not to distract when not editing, obvious enough to find on first visit.",
            "Long-press action sheets are cleaner (no persistent badge) but require discovery — add a hint or onboarding callout for first-time users.",
            "Generated default avatars (initials, gradient, identicon) eliminate the blank-avatar state and reduce friction to profile completion.",
        ],
    ),
    "profile-stats": (
        "How user statistics, streaks, and activity history are visualized on the profile.",
        "Controls whether stats appear as a number row, an activity heatmap, progress rings, or rich analytic cards. "
        "The right visualization turns a number into a habit driver.",
        [
            "Stat rows (large number over muted label) are scannable and recognizable but provide no trend context — pair with sparklines for data-rich apps.",
            "Heatmap grids (GitHub-style) are streak-reinforcing but require months of data to be meaningful; avoid showing an empty grid at first run.",
            "Progress rings are goal-oriented by nature — only use them when the metric has a defined target the user set.",
        ],
    ),
    "delight-celebration": (
        "How the app celebrates a completed task, earned streak, or reached milestone.",
        "Controls the celebration intensity: confetti burst, checkmark morph, full-screen takeover, or score glow. "
        "Intensity must match the significance of the achievement — too much for small wins creates noise.",
        [
            "Calm Precision: reward completion with appropriate motion — confetti for finishing a to-do item is noise; save it for meaningful milestones.",
            "Checkmark-morph + ripple is the highest-ratio delight pattern: deeply satisfying, subtle, and appropriate at any task completion.",
            "Full-screen takeovers should be rare — if they fire more than once per session they lose impact and become interruptions.",
        ],
    ),
    "delight-splash": (
        "The animation or treatment shown during the 0.5–1.5 second app launch window.",
        "Controls whether launch shows a logo fade, a drawn logo, a splash-to-UI morph, or an ambient particle background. "
        "This is the first impression before any interaction.",
        [
            "The iOS launch screen is mandatory; Apple requires a static storyboard as the actual LaunchScreen — animation plays after the app has loaded.",
            "Logo-draw animations (SVG stroke build) are high-craft signals but must complete within 900 ms before feeling like loading friction.",
            "Splash-to-UI morphs require that the launch shape matches a real UI element on the first screen — plan the coordinate math early.",
        ],
    ),
    "delight-scroll-physics": (
        "How scroll behavior feels at content edges, during free scroll, and at section boundaries.",
        "Controls whether scrolling uses iOS system defaults, sticky section headers, parallax backgrounds, or snap-to-card paging. "
        "Scroll feel is a persistent tactile identity signal throughout the app.",
        [
            "Apple's scroll physics (rubber-band edges, momentum deceleration) are famous for quality — never override them with custom physics unless you can match the quality.",
            "Sticky headers provide always-visible context but require testing at all content heights to avoid a header-stacking visual bug.",
            "Snap-to-card paging prevents partial card views but removes the user's ability to see that more content exists below — add a peek offset.",
        ],
    ),
}


# ---------------------------------------------------------------------------
# Default builder — used when a category is NOT in the hand-authored table.
# Derives content from cp_note, title, and the first two option descriptions.
# ---------------------------------------------------------------------------


def _default_learn_more(category: "Category") -> tuple[str, str, list[str]]:
    """Derive learn-more content from structured catalog fields."""
    title = category.title or category.name or category.id
    what_controls = f"The {title.lower()} treatment applied to emitted designs."

    # Build "what it does" from description + first two option descs.
    base = category.description.rstrip("?.") if category.description else ""
    option_notes: list[str] = []
    for opt in category.options[:2]:
        if opt.desc:
            # Take just the first sentence of each option desc.
            first_sentence = opt.desc.split(".")[0].strip()
            if first_sentence:
                option_notes.append(first_sentence)
    if base and option_notes:
        what_does = f"{base}. Options range from {option_notes[0].lower()}" + (
            f" to {option_notes[1].lower()}." if len(option_notes) > 1 else "."
        )
    elif base:
        what_does = f"{base}."
    else:
        what_does = f"Determines the {title.lower()} in the emitted design."

    # Build considerations from cp_note.
    considerations: list[str] = []
    if category.cp_note:
        considerations.append(category.cp_note)
    if not considerations:
        considerations.append(
            f"Choose the option that best fits your product's visual language and target audience."
        )
    return what_controls, what_does, considerations


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def build_learn_more(category: "Category") -> str:
    """Return an HTML <details> explainer block for the given category.

    The block is collapsed by default (no ``open`` attribute) per Hick's Law:
    users who want the explanation can expand it; others are not slowed.

    All dynamic text is HTML-escaped.
    """
    entry = _LEARN_MORE.get(category.id)
    if entry is not None:
        what_controls, what_does, considerations = entry
    else:
        what_controls, what_does, considerations = _default_learn_more(category)

    # HTML-escape every dynamic value.
    esc_what_controls = html.escape(what_controls)
    esc_what_does = html.escape(what_does)
    esc_considerations = [html.escape(c) for c in considerations]

    li_items = "\n".join(f"        <li>{c}</li>" for c in esc_considerations)

    return (
        '<details class="decision-explainer">\n'
        '  <summary class="decision-explainer-summary">About this decision</summary>\n'
        '  <div class="decision-explainer-body">\n'
        f'    <p class="dex-what"><strong>What this controls:</strong> {esc_what_controls}</p>\n'
        f'    <p class="dex-does"><strong>What it does:</strong> {esc_what_does}</p>\n'
        '    <ul class="dex-considerations">\n'
        f"{li_items}\n"
        "    </ul>\n"
        "  </div>\n"
        "</details>"
    )
