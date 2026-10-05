# Mode: Atmospheric Immersion

> Catalog brief — not a trigger-shaped skill. Load directly when a plan selects this mode.

*For apps where the user enters a focused state. The interface creates a sense of place — like stepping into a room designed for concentration. Mobile-first, watch-native.*

## When to use

| Use this mode for | Don't use it for |
|---|---|
| Focus / timer / wellness / meditation apps | Data-dense dashboards (use Glass Workspace) |
| Single-task immersive flows | Editing or creation tools (use Warm Craft or Glass Workspace) |
| Apps used at night or during deep focus periods | News, research, or browsing (use Data Narrative) |

Best fits: iOS Utility + Consumer/Habit archetypes. Watch-native.

## Philosophy

The atmospheric quality is functional, not decorative. Gradient backgrounds signal which mode the user is in. Glow effects on borders signal session state. Thin-weight typography at large sizes creates calm. Everything is in service of: *"What am I doing, how far along am I, what should I do next?"*

## Color palette

| Context | Background | Accent | Glow |
|---------|-----------|--------|------|
| Focus / Pomodoro | `#0e1225` → `#252d55` gradient | `#3a4878` (steel indigo) | `rgba(58,72,120,0.3)` |
| Flow | `#0c1214` → `#1e2848` | `#2d5560` (deep teal) | `rgba(45,85,96,0.3)` |
| Adaptive | `#100c14` → `#1a1428` | `#4a3560` (purple) | `rgba(74,53,96,0.3)` |
| Break / Rest | `#0c140e` → `#1a2820` | `#059669` (green) | `rgba(5,150,105,0.3)` |
| Insights (data overlay) | `#000000` flat | `#2563eb` (blue) | None |
| Circadian / Night | `#0a0a0a` | `#D4943A` (amber) | `rgba(212,148,58,0.2)` |

Warm circadian variants for each mode: amber (#D4943A), copper (#C47850), rose (#B8607A), sage (#8B9A4B). Apply these when the app is used in evening or the user has enabled a "night" preference.

## Typography

| Role | Font | Size | Weight | Notes |
|------|------|------|--------|-------|
| Hero number (timer) | SF Pro / SF Mono | 44–48pt | 200–300 | `tabular-nums`, ultralight |
| Screen title | SF Pro Display | 28px | 700 | One per screen |
| Card title | SF Pro Text | 15px | 600 | |
| Body / description | SF Pro Text | 12–13px | 400 | Secondary opacity |
| Timestamp / metadata | SF Mono | 11px | 400 | Tertiary opacity, monospace |
| Section header | SF Pro Text | 11px | 600 | Uppercase, `letter-spacing: 1.5px` |

## Key components

**Frosted Glass Card** — The primary content container. `background: rgba(255,255,255,0.08)`, `backdrop-filter: blur(20px)`, `border: 1px solid rgba(255,255,255,0.08)`, `border-left: 2px solid [mode-color]`, `border-radius: 10-12px`, `box-shadow: 0 0 6px rgba([mode-color], 0.3)`. Padding 12–14px.

**Progress Ring** — SVG circle, stroke-width 3–5px, `stroke-linecap: round`, background track at 8% opacity, progress arc in mode color. On watch: this is the primary visual. On phone: secondary to the hero number.

**Thin Progress Bar** — Alternative to ring. 3px height, full width, rounded ends. Simpler for glance use.

**Quality Dots** — 5 filled/empty circles (6px), color matches category. Use for 1–5 ratings, quality scores.

**Insight Callout** — `background: rgba(accent, 0.05)`, `border: 1px solid rgba(accent, 0.1)`, `border-left: 2px solid accent`, border-radius 12px. Contains title (12px/600) + body (12px/400). Placed inline in content flow.

**Atmospheric Background** — Two radial gradient blobs positioned off-screen edges (top-left and bottom-right). Low opacity (15–18%). Blurred at 35px. They create mood without competing with content.

## Platform notes

### iOS (primary)

- True black or gradient mesh background. Content starts at 50px below top to clear the notch. 20px horizontal padding.
- Title (28px/700) left-aligned + action button right-aligned in fixed header.
- For multi-section apps: bottom tab bar (system) for top-level nav, glass pill segmented control for in-page filtering.
- Vertical timeline/list with date-based section headers (11px uppercase, 1.5px letter-spacing). 28px section spacing.
- Tap the card row, not a tiny button. Cards are the tap target. 44pt minimum per HIG.

### Apple Watch (essential expression)

- **One metric per screen.** No dashboards. The hero number IS the interface.
- Digital Crown drives vertical tab switching. Timer / daily stats / session history.
- Hero number 44–48pt dominates. Thin progress bar (3px) or ring (120px) is secondary. One pause/resume button below.
- Maximum 3 accent colors. Circadian warm palette for evening use.
- Background: always true black `#000000`. OLED power budget critical.

### macOS

Limited use — menu bar popovers and focus timers only. Don't build a full Mac app in this mode.

- Menu bar extra: 280px wide glass popover. Timer, current mode, one start/stop action.
- Focus timer window: small floating window (320×400px). Transparent title bar, traffic lights inset.

### Web

Limited to hero sections, onboarding flows, or single-purpose focus web apps. For full dashboards, use Glass Workspace.

- Single-purpose web app (e.g., Pomodoro timer): full-viewport, centered. Hero at 72px, progress ring at 200px.

## Cross-platform foundational rules apply

This mode inherits all 11 foundational rules (luminance hierarchy, left-border accent, frosted pills, etc.) per `Skill("ui-guidance:principles")` and the focused skills (`hierarchy`, `navigation`, `feedback`, `motion`, `responsive`).

## See also

- `references/modes/glass-workspace.md` — companion mode for desktop-first productivity.
- `Skill("ui-guidance:ios")` — Apple Watch + iOS platform primitives.
- `Skill("ui-guidance:motion")` — sequenced reveal + reduced-motion conformance for Atmospheric Immersion's gradient and stagger patterns.

*Source: distilled from `cross-platform-design-patterns/references/full.md` §Mode 1 (now dissolved into platform + topic skills).*
