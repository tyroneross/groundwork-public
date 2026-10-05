# Mode: Glass Workspace

> Catalog brief — not a trigger-shaped skill. Load directly when a plan selects this mode.

*For apps where the user manages, organizes, and navigates structured information. The interface is a tool — professional but with personality. Glass and glow effects say "this is crafted software, not a generic dashboard." Desktop-first.*

## When to use

| Use this mode for | Don't use it for |
|---|---|
| Developer tools, dashboards, workspaces | Single-task focus apps (use Atmospheric Immersion) |
| Multi-pane editors and command-driven productivity | Personal/creative/journaling (use Warm Craft) |
| Dense data + organization tools | News, articles, or read-first surfaces (use Data Narrative) |

Best fits: web SaaS dashboard / editor-workbench archetypes. macOS native apps.

## Philosophy

Glass Workspace is the anti-SaaS-gray. Same sidebar+content layout as every productivity tool, but frosted glass surfaces, ambient aurora glows, and translucent layering give it a distinctive feel. The glass is always subtle — you notice the content, not the container. Ambient glow is mood, not decoration.

## Color palette

| Variant | Background | Surface | Accent | Glow |
|---------|-----------|---------|--------|------|
| **Aurora Glass** | `#09090b` | `rgba(255,255,255,0.03–0.06)` | `#818cf8` (indigo) | Multi-color ambient radials |
| **Aurora Deep** | `#060611` | `rgba(255,255,255,0.03)` | `#818cf8` | Single indigo radial + drift animation (20s) |
| **Neon Terminal** | `#0a0a0a` | `rgba(255,255,255,0.03)` | `#22d3ee` (cyan) | Cyan ambient |

Semantic colors for categorization: emerald (#34d399) for source/connected, indigo (#818cf8) for primary/upload, violet (#a78bfa) for plugin/extension, cyan (#22d3ee) for utility/system.

## Typography

| Role | Font | Size | Weight | Notes |
|------|------|------|--------|-------|
| Page title | SF Pro / Inter | 28px | 700 | |
| Card title | SF Pro / Inter | 14–15px | 600 | |
| Body / description | SF Pro / Inter | 12–13px | 400 | Secondary opacity |
| Code / paths | SF Mono / Monaco | 12px | 400 | |
| Section label | SF Pro / Inter | 11px | 600 | Uppercase, `letter-spacing: 0.08–0.12em` |
| Nav item | SF Pro / Inter | 13px | 500 | |
| Stat value | SF Mono | 14px | 600 | Color-coded by category |

## Key components

**Glass Card** — `background: rgba(255,255,255,0.03–0.06)`, `backdrop-filter: blur(12–24px)`, `border: 0.5px solid rgba(255,255,255,0.06)`, `border-radius: 10–12px`. On hover: `translateY(-1px)` + gradient line appears at top edge (opacity 0→1). Padding: 14–16px.

**Sidebar** — Fixed 220–250px. Glass background matching the variant. Nav items have left-border active indicator (2px solid accent, transparent when inactive). Sections divided by uppercase labels. User chip at bottom.

**Pill Filter** — Frosted glass pills in a row. Active pill gets accent-color glow background + text color. Inactive pills near-invisible (`rgba(255,255,255,0.03)`).

**Stats Bar** — Horizontal row of stat items above content area. Each stat: value (14px/600, colored) + label (11px, tertiary). Color-coded by meaning.

**Source Badge** — Small colored dot (6px) next to a label. Emerald for GitHub/connected, indigo for upload, violet for plugin. Used in card headers and list items.

**Ambient Background** — Body::before with radial gradients at low opacity. Aurora Deep adds a `drift` animation (translate + scale, 20s infinite) for gentle movement. Aurora Glass uses multiple static radials for multi-color glow.

## Platform notes

### Web (primary)

```
≥1280px: Sidebar (240px) + Content (flex:1, max-width 1040px, padding 32px)
1024–1279px: Sidebar collapses to icons (56px), content expands
<1024px: Sidebar becomes off-canvas drawer, content full-width with 16px padding
```

- Sidebar: brand mark + name at top. Section labels (11px uppercase). Nav items with 2px left-border active indicator. User chip at bottom with avatar.
- Card grid: `repeat(auto-fill, minmax(300-320px, 1fr))` with 12px gaps. Cards contain: header (source dot + title), description (2-line clamp), footer (metadata + count).
- Multi-pane editor: 3-column split (code/preview/companions) for editor-style layouts. Line numbers column at 40px.
- Command palette: glass overlay centered on screen. Input at top with focus ring glow. Results below as a list with keyboard navigation.

### macOS (full implementation)

Glass Workspace translates directly to native Mac apps.

- Window chrome: transparent title bar with traffic lights inset into the sidebar area. Drag region on the sidebar title. No traditional toolbar.
- Sidebar: `NSVisualEffectView` with `.sidebar` material. Left-border accent indicators translate directly. System accent colors for active states.
- Glass surfaces: `NSVisualEffectView` with `.hudWindow` or `.light` material approximates CSS blur. For cards, custom CALayer with blur + border.
- Ambient glow: `CAEmitterLayer` for subtle particle effects, or Metal view for continuous gradient animation (Aurora Deep drift).
- Density: ~15% tighter than web — card padding 12–14px, section gap 20–24px, page padding 24px, body text 13px, sidebar 220px.
- Key patterns: command palette (Cmd+K), detail pane (optional third column at 280–320px), preferences as grouped cards with dividers.

### iOS (limited — overlays and settings)

Not the primary iOS mode. Use for overlay panels, settings views, and detail sheets only.

- Settings panel: grouped card layout with dividers between rows. Each group is a glass card. Same border-radius (12px) at iOS density.
- Detail sheet: presented as a modal sheet. Glass background with content blocks. Left-border accents on items.

### Watch

**Not applicable.** Glass effects are too expensive on watch hardware and illegible at that size.

## Style-mode siblings (load for fuller token specs)

- `references/modes/style-mode-aurora-deep.md` — primary dark developer/data workspace, dense atmosphere.
- `references/modes/style-mode-aurora-glass.md` — Glass Workspace variant with translucent surfaces.

These three files together (this brief + the two style-mode files) cover the full Glass Workspace palette in implementation detail.

## See also

- `Skill("ui-guidance:web")` — semantic HTML, archetype routing, dashboard patterns.
- `Skill("ui-guidance:macos")` — `NSVisualEffectView` materials, window chrome, density.
- `Skill("ui-guidance:navigation")` — sidebar pattern detail, command palette placement.

*Source: distilled from `cross-platform-design-patterns/references/full.md` §Mode 2 (now dissolved into platform + topic skills).*
