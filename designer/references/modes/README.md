# Design Mode Catalog

Mode briefs the orchestrator can hand to a UI implementer. **Catalog entries, not trigger-shaped skills** — load directly when a plan selects one of these modes.

## Modes

| File | Mode | Best fit |
|---|---|---|
| `atmospheric-immersion.md` | Atmospheric Immersion | Focus / timer / wellness / meditation. iOS Utility + Consumer/Habit; watch-native |
| `glass-workspace.md` | Glass Workspace | Developer tools / dashboards / workspaces. Web SaaS / macOS productivity |
| `warm-craft.md` | Warm Craft | Personal / creative / journaling / crafts. Web editor / iOS Productivity-Editorial |
| `data-narrative.md` | Data Narrative | News / intel / research / visualization. Web data-research / publication |
| `style-mode-aurora-deep.md` | Aurora Deep (variant of Glass Workspace) | Dense developer/data workspace |
| `style-mode-aurora-glass.md` | Aurora Glass (variant of Glass Workspace) | Translucent surface variant |
| `style-mode-warm-craft.md` | Warm Craft (extended) | Reflective writing, knowledge work |

## Mode selection table

| App purpose | Primary mode |
|---|---|
| Focus / timer / wellness | Atmospheric Immersion |
| Developer tools / dashboards | Glass Workspace |
| Personal / creative / journaling | Warm Craft |
| News / intel / research / visualization | Data Narrative |

## Surface treatment techniques (style layer, not a skill)

Depth and materiality are *style techniques* a mode applies, not standalone skills. The expert UI design guide (`references/research/expert-ui-design-guide.md` §II + §IX) documents these; they live here because they are mode-level surface treatments, expressed through tokens (`Skill("ui-guidance:tokens")`) when adopted.

**Layering architecture — the z-axis planes:** Base (page background, muted) → Surface (cards/modals/panels, slight elevation) → Overlay (tooltips/dropdowns/popovers) → Top (modals/drawers/critical alerts). Each plane transition gets its own elevation-shadow signature (Material's dp 0–24 codifies this). **Dark-mode elevation is expressed through lightness, not shadow** — higher elevations use slightly lighter surface values, not darker shadows.

**Glassmorphism** — frosted glass via `backdrop-filter: blur()` + semi-transparency + a subtle border highlight (macOS Big Sur, Windows Fluent). Creates layered depth over gradient/photo backgrounds. **Constraints:** ensure sufficient contrast between foreground text and the blurred background; never stack multiple glass layers (depth loses clarity). Used by the Glass Workspace + Aurora Glass modes above.

**Neumorphism** — dual soft shadows simulating extrusion (elevated = clickable, inset = pressed). **High accessibility risk — inherently low contrast.** Use only for decorative/non-critical UI, never primary text. Generally avoid; documented here so an audit can flag it.

**Gradient + tinted layering** — gradient overlays (`rgba(0,0,0,0)` → `rgba(0,0,0,0.6)`) to guarantee text contrast over images; tinted transparency (a semi-transparent brand color over a neutral surface) for depth without solid blocks; layered box-shadows at different radii/offsets for realistic material depth.

## Foundational rules apply to every mode

All four modes inherit the 11 foundational rules (luminance hierarchy, left-border accent, frosted pills, decision-first data, content-to-chrome ratio, reduced-motion respect, etc.) per the topic skills:

- `Skill("ui-guidance:principles")` — the floor
- `Skill("ui-guidance:hierarchy")` — luminance tiers, type ladder
- `Skill("ui-guidance:navigation")` — landmarks, sheets, sidebars
- `Skill("ui-guidance:feedback")` — action states, haptics, errors
- `Skill("ui-guidance:motion")` — durations, stagger cap, reduced motion
- `Skill("ui-guidance:responsive")` — form-factor scaling, viewport-scale tokens
- `Skill("ui-guidance:data-viz")` — chart, KPI, table patterns
- `Skill("ui-guidance:states")` — element-state lifecycle (hover/focus/active/selected/disabled/loading/empty)
- `Skill("ui-guidance:components")` — button/icon/form component craft
- `Skill("ui-guidance:audio")` — auditory channel (sound roles, opt-in, congruence)

A mockup can follow a mode brief perfectly and still fail if it breaks one of these foundations.

## Provenance

The four primary modes were synthesized from 67 rated mockups across 6 projects (FloDoro, Atomize AI/News, Skill Bank, Prompt Test Lab, Interface Built Right) as of 2026-03-24 — 23 YAY, 17 OK, 23 NAY, 4 removed. Original synthesis lived in `skills/cross-platform-design-patterns/references/full.md` (now dissolved as of v0.2.0).

The three style-mode variants (`aurora-deep`, `aurora-glass`, `warm-craft`) were authored earlier as standalone Skill Bank entries; preserved here for token-detail depth.
