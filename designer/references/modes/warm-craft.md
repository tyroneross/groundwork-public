# Mode: Warm Craft

> Catalog brief — not a trigger-shaped skill. Load directly when a plan selects this mode.

*For apps where the experience should feel personal, made by hand, inviting. Like a well-organized notebook or a woodworker's shop — everything has a place, and the materials themselves are beautiful. Works across all platforms.*

## When to use

| Use this mode for | Don't use it for |
|---|---|
| Personal / creative / journaling / crafts | High-density data dashboards (use Glass Workspace) |
| Reflective writing or knowledge work | Focus / timer / wellness (use Atmospheric Immersion) |
| Human-in-the-loop planning | News / research / data display (use Data Narrative) |

Best fits: web editor-workbench / content-publication archetypes. iOS Productivity + Editorial archetypes.

## Philosophy

Warm Craft rejects the cold precision of most software. Warm blacks and browns instead of blue-blacks, DM Sans instead of system fonts (where possible), amber instead of blue. The subtle dot-texture overlay on backgrounds says "this was made, not generated." Every surface has a material quality.

## Color palette

| Token | Value | Usage |
|-------|-------|-------|
| Background | `#1a1714` | Base surface |
| Surface | `#211e19` / `#2a2620` | Cards, sidebar |
| Primary accent | `#e8a23d` (amber) | Active states, CTA, left-border accents |
| Secondary accents | `#7cb587` (sage), `#cf6b54` (rust), `#6ba3cf` (sky), `#9b7ec8` (plum) | Category colors |
| Text: warm white | `#f5f0e8` | Primary text (0.87 equivalent) |
| Text: warm dim | `#b8af8a` | Secondary text (0.55 equivalent) |
| Text: warm muted | `#7d7468` | Tertiary text (0.35 equivalent) |
| Border | `#302c26` / `#3d3830` | Dividers, card edges |

## Typography

| Role | Font | Size | Weight | Notes |
|------|------|------|--------|-------|
| Page title | DM Sans | 28px | 700 | Warm white |
| Card title | DM Sans | 14–15px | 600 | |
| Body / description | DM Sans | 13–14px | 400 | Warm dim |
| Code / paths | DM Mono | 12px | 400 | |
| Section label | DM Sans | 11px | 600 | Uppercase |
| Filter chip | DM Sans | 12px | 500 | In pill chips |

When DM Sans is unavailable (iOS, Watch): fall back to SF Pro but keep the warm color palette. The warmth comes more from color than from font.

## Key components

**Warm Card** — `background: #211e19`, `border: 1px solid #302c26`, `border-left: 3px solid #e8a23d` (amber), `border-radius: 10px`. On hover: `translateY(-1px)` + border color brightens to `#3d3830`. Padding: 14–16px. Header has colored source dot (8px) + title.

**Dot-Texture Background** — Subtle repeating dot pattern (1px dots at 3% opacity, 16px grid) overlaid on the base background via `position: fixed` pseudo-element. Creates a "paper" material quality:

```css
background-image: radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px);
background-size: 16px 16px;
```

**Chip Pills** — Rounded pill shapes (`border-radius: 20px`) for filters and tags. Active: amber border + amber text + warm glow background. Inactive: muted border + muted text.

**Source Label** — Colored underline bar (12×2px) as a pseudo-element before the source name. Each source gets a category color.

**Sidebar** — 230px, same warm surface color. Brand icon (28×28 gradient square) + app name. Nav items with 3px left border (transparent → amber on active). Rounded right corners (8px).

## Platform notes

### Web (full implementation)

- Sidebar (230px) + Content (padding 32–36px). Card grid: `repeat(auto-fill, minmax(300px, 1fr))` with 10px gaps.
- Editor layout: 3-column split (source/preview/companions at 190px) for editing interfaces. Line numbers in DM Mono.
- Hover states: subtle — `translateY(-1px)`, border color shift, shadow lift. No scale transforms. Opacity 0.9 on button hover. The warm aesthetic is quiet.

### macOS

Warm Craft works well on Mac with some adaptation.

- Window chrome: standard Mac window frame with warm-tinted sidebar. Use custom `NSAppearance` with warm tint colors.
- Typography: DM Sans can be bundled as a custom font. If system font is required, SF Pro with the warm color palette retains 80% of the feel.
- Sidebar: standard sidebar with custom tint. Left-border amber indicators.
- Texture overlay: subtle repeating pattern image rendered in a background `NSView`. Keep it at 3–5% opacity.
- **Key difference from Glass Workspace on Mac:** no glass/blur effects. Warm Craft uses solid surfaces with visible borders. Mac version should feel more like a Craft-style app than a system utility.

### iOS

- Warm black background (`#1a1714` or equivalent), amber accent, no texture overlay (too subtle at phone DPI).
- Standard iOS tab bar + navigation controller, but with warm tinting. Custom tab bar appearance with warm colors.
- Same warm card pattern but with iOS padding (12–14px). Left-border amber accents.
- Fall back to SF Pro on iOS. Warm white text color (`#f5f0e8`) to maintain the warm feel.
- 44pt minimum touch targets. Chip pills should be at least 44pt tall when used as tap targets.

### Watch

Simplified: true black background, ember accent (`#e8a23d`) for active states, warm white text. No texture, no cards with visible borders. Just the warm color palette on black.

- List items: left-border amber accent at 2px. Warm white text. Ember-colored status dots.

## Style-mode sibling (fuller token spec)

- `references/modes/style-mode-warm-craft.md` — additional token detail and historical context.

## See also

- `Skill("ui-guidance:web")` — semantic HTML for editor-workbench archetype.
- `Skill("ui-guidance:ios")` / `Skill("ui-guidance:macos")` — platform-native chrome at Mac/iOS densities.
- `Skill("ui-guidance:hierarchy")` — warm three-tier luminance system (warm white → warm dim → warm muted).

*Source: distilled from `cross-platform-design-patterns/references/full.md` §Mode 3 (now dissolved into platform + topic skills).*
