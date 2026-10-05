---
# Synthetic design.md token format
schema: design.md/v1
name: Sample Notes
platform: macOS desktop
principles:
  - Use a quiet interface and preserve user content.
  - Preserve comments and unmodeled tokens during import and promotion.
# Synthetic fixture comment; preserve this line.
color:
  bg:            "#FFFFFF"
  surface:       "#F5F5F7"   # grouped card fill
  surfaceSunken: "#FAFAFA"
  border:        "#E5E5EA"
  textPrimary:   "#1C1C1E"
  textSecondary: "#6E6E73"
  textTertiary:  "#9A9AA0"
  accent:        "#0A84FF"   # primary actions (Save, Export)
  accentText:    "#FFFFFF"
  warning:       "#C2410C"
  warningBg:     "#FFF4ED"
  danger:        "#FF3B30"
  success:       "#1E874B"
  flagBar:       "#EA580C"   # sample marker
typography:
  fontFamily: "-apple-system, 'SF Pro Text', 'Inter', system-ui, sans-serif"
  mono: "ui-monospace, 'SF Mono', Menlo, monospace"
  L1_title:     { size: 21, weight: 600, use: "screen title" }
  L2_body:      { size: 15, weight: 400, use: "primary content / labels" }
  L2_strong:    { size: 15, weight: 600, use: "section headers, emphasis" }
  L3_meta:      { size: 13, weight: 400, color: textSecondary, use: "metadata, hints" }
spacing:
  grid: 8
  scale: [4, 8, 12, 16, 24, 32, 48]
radius:
  button: 8
  card: 10
  hero: 12
  pill: 999
elevation:
  card: "1px solid border"
  hero: "0 1px 3px rgba(0,0,0,0.08)"
components:
  button.primary:   { fill: accent, text: accentText, minHeight: 30, weight: 600, use: "the one conversion action" }
  button.secondary: { border: border, text: textPrimary, minHeight: 28, use: "alternative actions" }
  button.tertiary:  { plain: true, text: accent, minHeight: 24, use: "low-stakes / inline" }
  segmented:        { use: "mutually-exclusive choice (recording source)" }
  groupCard:        { fill: surface, border: border, radius: card, use: "ONE per gated/critical group; demote the rest to plain sections" }
  statusText:       { rule: "color + icon + text, no filled badge" }
  banner.prototype: { text: warning, fill: warningBg, persistent: true }
---

# Sample Notes Design System

Synthetic importer fixture. All values are test inputs.
