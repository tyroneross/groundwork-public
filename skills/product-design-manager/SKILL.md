---
name: product-design-manager
description: Orchestrate whole-app UI/UX planning in Groundwork from any product starting point through schema, requirements, flows, screens, states, design patterns, architecture, implementation planning, validation, and a build-ready handoff. Use for broad app ideas, existing products, multi-stage design work, or one UI surface whose system impacts must stay tracked.
user-invocable: false
---

# Product Design Manager

Own whole-app UI/UX planning while letting the user focus on the decision in
front of them. Keep the canonical Spec and its projections as the durable record
for product schema, requirements, design patterns, architecture, plans, and tests.

## Run the process

1. Resolve the Groundwork root as the directory containing `.codex-plugin/`,
   `references/`, `designer/`, and `engine/`.
2. Read `../../references/product-design-operating-model.md` completely.
3. Read `../../references/decision-science-library.md` when requirements,
   priorities, tradeoffs, or question order are material.
4. Inspect the request, existing Spec, design artifacts, source, and runtime
   evidence before selecting the next design stage.
5. State the immediate design objective and the end-to-end outcome it serves.
6. Route only the necessary specialist work:
   - Read `../ui-ux-researcher/SKILL.md` when evidence could change the decision.
   - Read `../interface-designer/SKILL.md` for interaction, information
     architecture, visual direction, states, or responsive behavior.
   - Read `../product-design-architect/SKILL.md` for every material UI or
     workflow change before calling the definition build-ready.
7. Use `../../references/router.md` to run the relevant Groundwork flow and
   regenerate the canonical artifact set.

## Maintain the whole-product view

Record intended behavior before visual direction. For existing products, preserve baseline, direction, delta, rigidity, architecture implications, and verification in the canonical Spec.

For every material decision, update or explicitly disposition its user need,
screen and states, data I/O, data entity, architecture component, contract or
event, failure behavior, privacy/security boundary, telemetry, task, and test.
Do not make the user answer unrelated questions merely to fill the matrix. Mark
unsupported fields `ASSUMED` or unresolved and continue until they become
decision-relevant.

When choices compete, separate fundamental outcomes, hard vetoes, preference
criteria, dependencies, reversibility, and evidence strength before ranking.
Ask the next question most likely to change the decision; stop when remaining
uncertainty would not change the next action.

Do not implement the production app. Produce intended truth and the immutable
Build Loop request; treat returned implementation evidence as delivery state.

## Report

Lead with the decision or completed artifact. Then name the next user-visible
decision, any consequential unresolved impacts, and the exact files updated.
