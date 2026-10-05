# Design Profiles

Profiles accelerate exploration; they do not replace user evidence. Treat each
profile as a coherent starting hypothesis, then preserve, combine, or reject it
through Groundwork's elicitation and visual flows.

Universal constraints and profile choices are separate layers. Accessibility,
truthful state, perceivable feedback, coherent hierarchy, platform conventions,
content fit, recovery, and responsive behavior apply across profiles. Density,
shape, warmth, depth, expressiveness, motion texture, and visual atmosphere are
contextual choices.

## Profile registry

| Profile | Use when | Primary qualities | Existing reference |
|---|---|---|---|
| Calm precision | Trust, legibility, focus, and low cognitive load dominate | Clear hierarchy, restrained surfaces, explicit state, quiet confidence | `references/design.md` Calm Precision guidance |
| Warm craft | The product should feel personal, tactile, or editorial | Warm neutrals, human detail, gentle depth, deliberate imperfection | `designer/references/modes/warm-craft.md` |
| Glass workspace | Spatial layering and active context improve expert work | Layered panes, translucent depth, clear focus and containment | `designer/references/modes/glass-workspace.md` |
| Data narrative | Users must understand a dense system, sequence, or metric story | Evidence hierarchy, annotated transitions, progressive detail | `designer/references/modes/data-narrative.md` |
| Atmospheric immersion | Focus and emotional environment matter more than dense utility | Strong field, controlled motion, low chrome, high continuity | `designer/references/modes/atmospheric-immersion.md` |
| Aurora deep | A high-contrast, expressive dark system fits the product | Luminous accents, deep surfaces, controlled glow, strong focus | `designer/references/modes/style-mode-aurora-deep.md` |

The registry is intentionally plural. Calm Precision is one useful doctrine,
not Groundwork's house style or default answer for every product.

Read the referenced file completely before using a profile. Additional authored
modes live in `designer/references/modes/README.md`; keep the registry and that
index aligned.

## Selection rules

1. Start with product outcome, user context, platform convention, accessibility,
   density, and trust requirements.
2. Check the cross-session taste profile with
   `PYTHONPATH=<groundwork-root> python3 -m designer.decide.profile show` when it
   exists. Treat it as preference evidence with confidence, not a mandate.
3. Select at most three meaningfully different profiles during divergence.
4. State which product constraints each profile serves and which it risks.
5. Capture the user's keep/kill reasons, not only the winning label.
6. Convert the selected profile into concrete layout, type, color-relationship,
   spacing, motion, component, state, and content decisions.
7. Validate contrast, keyboard and assistive-technology behavior, responsive
   behavior, reduced motion, and every material non-default state.

Do not mix profiles by averaging their aesthetics. Combine only named qualities
that serve the product, and record which source profile each quality came from.
