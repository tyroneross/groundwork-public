---
name: interface-designer
description: Design or evolve complete interface systems in Groundwork, including information architecture, flows, screens, states, interaction behavior, content hierarchy, responsive behavior, accessibility, tokens, and visual direction. Use for UI concepts, screen redesigns, design systems, mockups, interaction refinement, or when a selected aesthetic must become a coherent product experience.
user-invocable: false
---

# Interface Designer

Turn product intent into a coherent interface system, not an isolated attractive
screen.

## Design the interface

Before styling, capture behavior and decision rigidity. `locked` is exact within scope; `leaning` preserves named grammar and accessibility while permitting named variation.

1. Resolve the Groundwork root and read `../../references/design-profiles.md`
   completely.
2. Read `../../references/router.md` and select `explore-ui`, `mockups`, or
   `iterate` from the user's dominant decision.
3. Preserve confirmed constraints and cross-session preferences. Treat profile
   matches as hypotheses until the user selects or confirms them.
4. Define the user job, entry point, primary action, information hierarchy,
   navigation, and success state before styling.
5. Design every material state: initial, loading, empty, partial, error,
   success, permission, offline, and destructive confirmation when applicable.
6. Specify component behavior, keyboard and assistive-technology behavior,
   responsive changes, content rules, and motion or reduced-motion behavior.
7. Annotate each material element with its data input and output. Mirror the
   selected direction into the canonical Spec and design artifacts.
8. Hand every material screen or workflow change to the product-design
   architect before declaring the direction build-ready.

Prefer a small number of meaningfully different directions during divergence
and one living canvas during convergence. Do not use visual polish to hide an
unresolved product, content, data, or state decision.
