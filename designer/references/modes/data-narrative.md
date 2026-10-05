# Mode: Data Narrative

> Catalog brief — not a trigger-shaped skill. Load directly when a plan selects this mode.

*For apps that present research, news, trends, and dense information. The interface tells a story — dark atmospheric hero sections draw the user in, light content areas present the data clearly, and decision-first charts make the information actionable. Desktop-first, responsive.*

## When to use

| Use this mode for | Don't use it for |
|---|---|
| News / intel / research / visualization | Single-task immersive focus (use Atmospheric Immersion) |
| Decision-first charts and KPIs | General productivity (use Glass Workspace) |
| Dense information with story arc (dark hero → light content) | Personal / creative / journaling (use Warm Craft) |

Best fits: web data-research-tool / content-publication archetypes.

## Philosophy

Data Narrative is a hybrid mode. It breaks the "dark mode everywhere" rule by using dark hero sections for atmosphere and light content areas for readability of dense data. The dark-to-light transition creates a natural reading flow: drawn into the hero, then settle into the content. Network graph visualizations in the hero section signal "this is connected information." Decision-first chart titles tell the user what matters before they even read the data.

## Color palette

| Zone | Background | Text | Accent |
|------|-----------|------|--------|
| **Hero (dark)** | `#0c1222` | `rgba(255,255,255,0.87–0.55)` | `#3B82F6` (blue), `#6366F1` (indigo), `#8B5CF6` (purple) |
| **Content (light)** | `#F9FAFB` | `#111827` / `#4b5563` / `#9ca3af` | `#3B82F6` (blue), `#059669` (green), `#DC2626` (red) |
| **Cards** | `#FFFFFF` | Standard light-mode tiers | Subtle shadow: `0 1px 3px rgba(0,0,0,0.1)` |

Status in charts: blue for highlighted/key finding, gray for context. Green for positive, red for negative. No decorative color.

## Typography

| Role | Font | Size | Weight | Notes |
|------|------|------|--------|-------|
| Hero headline | Inter / system | 28–48px | 700–800 | Dark zone |
| Page title | Inter / system | 24px | 600 | Light zone |
| Feature card title | Inter / system | 16px | 600 | |
| Chart title | Inter / system | 14px | 500 | Decision-first: conclusion not topic |
| Chart insight | Inter / system | 12px | 400 | `color: #6b7280` |
| Body / description | Inter / system | 14px | 400 | |
| Source attribution | Inter / system | 11px | 400 | `color: #9ca3af` |
| Tag / label | Inter / system | 11px | 500 | Uppercase, `letter-spacing: 0.5px` |

## Key components

**Dark Hero Section** — Full-width, `#0c1222` background, 56–80px vertical padding. Contains: headline, search bar (glass effect), and optional network graph visualization (SVG with animated dashed lines + floating nodes at 10–30% opacity).

**Bento Grid** — 6-column grid with irregular card spans. Feature cards at 4-col wide for primary, 2-col wide for secondary. Creates visual hierarchy through size, not just content. `gap: 16–24px`.

**Decision-First Chart** — Title is a conclusion (14px/500). Insight line below (12px, gray-500). Chart body: bar/line/table. Source attribution at bottom (11px, gray-400). Key finding highlighted in blue, context in gray.

**Trending/Velocity Indicator** — Pulsing green dot ("live") + percentage with arrow ("+340%"). Signals temporal urgency. Pulse animation: opacity 1→0.4→1, 2s cycle.

**Skeleton Loader** — Shimmer animation for loading states. Gray rectangles with a sweeping gradient highlight. Never use spinners.

**Network Graph Background** — Decorative SVG: dashed connection lines with `dash-flow` animation, floating circles (3–6px) with gentle float animation (8–12s). Low opacity (10–30%). Signals "connected information" without being interactive.

**Rotating Text Carousel** — In headlines, a single word rotates through options ("Track [AI · Climate · Markets · Health]"). Fade-up animation per word. Use sparingly — one per page maximum.

## Platform notes

### Web (primary)

```
Header: Sticky dark bar (56px, z-40) with horizontal nav tabs
Hero: Full-width dark section with network viz, search, headline
Content: Light background, max-width 1200px, centered
Sections: Alternating white/gray-50 backgrounds for visual rhythm
```

- Navigation: horizontal tabs in the sticky header. Active tab gets 2px bottom border in blue-500. Underline alignment trick: `padding-bottom: 4px; margin-bottom: -17px`.
- Bento grid: `grid-template-columns: repeat(6, 1fr)` at desktop. Cards span 2–4 columns. At tablet: 2-column. At mobile: single column.
- Card hover: `translateY(-2px)` + `shadow-lg` + border color brightens. Active: `scale(0.98)` for tactile feedback.
- Staggered reveal: content sections fade-in-up with 60–300ms stagger delays. Each section begins animation as it enters viewport.
- Multi-page architecture: each major section (Search, Feed, Trends, Graph) is a full page. Page transitions use fade-in-up at 0.3–0.6s.

### macOS

Data Narrative works well on Mac with native rendering.

- Window chrome: standard title bar. Horizontal tab bar below it (segmented control or custom).
- Hero section: dark background in the toolbar/header area. Network graph visualization rendered with Core Graphics or Metal. Translucent title bar over the dark hero.
- Content area: light background with native `NSTableView` for data tables, SwiftUI Charts for visualizations.
- Skeleton loaders: animate custom `NSView` layers with shimmer gradient.
- **Key difference from Glass Workspace:** Data Narrative uses a light content background. Overall feel is brighter than Glass Workspace, with the dark hero as contrast.

### iOS

Simplified version: dark navigation bar/header with the app's network graph motif, light scrollable content below.

- Standard iOS navigation controller with a custom dark appearance on the navigation bar.
- Light background cards in a scrollable feed. Decision-first titles on each card. Bento grid simplifies to single-column on phone.
- Charts: iOS Charts framework or custom Core Graphics. Same decision-first title pattern.
- Search: full-screen search with dark background (matching the hero zone aesthetic).

### Watch

**Not applicable.** Data Narrative is too information-dense for watch screens.

## See also

- `Skill("ui-guidance:data-viz")` — decision-first titling, chart routing, KPI patterns — all central to Data Narrative.
- `Skill("ui-guidance:web")` — semantic HTML for data-research-tool archetype, bento grid, sticky-header patterns.
- `Skill("ui-guidance:hierarchy")` — hybrid dark+light luminance discipline.
- `Skill("ui-guidance:principles")` — F5 decision-first data presentation as a foundational rule.

*Source: distilled from `cross-platform-design-patterns/references/full.md` §Mode 4 (now dissolved into platform + topic skills).*
