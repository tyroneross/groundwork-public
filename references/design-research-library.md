# Design Research Library

Use research to reduce a named decision risk. Select the smallest method that
can change the decision and preserve the boundary of what the evidence proves.

## Method selector

| Decision risk | Preferred method | Evidence produced | Does not prove |
|---|---|---|---|
| Problem or job is unclear | Contextual interview or workflow observation | Goals, triggers, workarounds, language | Market size or frequency |
| Navigation or grouping is unclear | Card sort, tree test, first-click test | Findability and mental-model fit | End-to-end usability |
| Flow or control is unclear | Moderated task test or instrumented prototype test | Task success, errors, hesitation, recovery | Long-term adoption |
| Existing UI has obvious friction | Heuristic and accessibility review | Expert-identified risks and standards gaps | User severity or prevalence |
| Competing directions need narrowing | Comparative concept test | Preference reasons and comprehension differences | Production behavior |
| Shipped behavior needs diagnosis | Funnel, event, search, support, or session evidence | Where behavior changes or fails | Why without qualitative evidence |
| Content is unclear | Comprehension, cloze, or terminology test | Meaning, expectation, recall | Full interaction quality |

## Research contract

Record:

1. Decision and live alternatives.
2. Known evidence and assumptions.
3. Method, sample, recruitment or source-selection rule.
4. Tasks, prompts, success signals, and stopping rule.
5. Raw observations with source/date/provenance.
6. Findings, confidence, limitations, and contradictory evidence.
7. Decision impact: keep, change, investigate, or defer.
8. Spec fields and change records affected.

Use behavioral evidence before stated preference when the question concerns
ability to complete a task. Use stated preference when the question is taste,
trust, perceived fit, or language, and label it accordingly.

## Source hierarchy

1. Current user-provided or product-owned evidence.
2. Current repository, runtime, analytics, support, and prior-research records.
3. Official platform and standards documentation for mutable requirements.
4. Peer-reviewed or primary research for generalizable claims.
5. Secondary synthesis for orientation, corroborated before a consequential
   decision.

Groundwork's local references are decision aids, not current external facts:

- `references/design.md` — canonical product and architecture definition.
- `references/explore-ui.md` — adaptive preference elicitation.
- `references/mockups.md` — comparative direction testing.
- `references/iterate.md` — one-canvas convergence.
- `references/requirements-studio.md` — adaptive browser-based requirements.
- `references/design-library/` — cross-project design-route map plus dated
  dashboard/writing capability inventory. Use it to select reusable guidance;
  re-resolve host runtime state before invoking a listed capability.
- `designer/references/modes/` — authored visual-direction references.
- `designer/references/dashboards/` — reviewed or review-pending UI examples;
  preserve each file's review and provenance status.

The validated local corpus has explicit authority tiers:

- **Foundations:** ProductPilot for adaptive typed product definition and
  mockup-gallery for visual review plus route-level design handoff boundaries.
- **Reusable method sources:** Build Loop Memory's Apache-2.0 UI Guidance
  corpus and Decision Doctor's research/implemented decision stages. Re-check
  provenance and applicability before adopting a claim.
- **Examples:** `~/dev/designs/` and Atomize's `.designdoc/` show complete and
  incomplete Groundwork outcomes. Sample them to find coverage gaps; do not
  convert their product choices into universal rules.
- **Experiments:** Build Loop Memory's `experiments/_design-docs/` contains
  candidates that remain non-authoritative until measured and adopted.

For mutable external requirements, capture the URL, publisher, access date,
supported platform/version, and the exact claim it informs. Provider silence,
an unavailable source, or zero analytics rows is a coverage gap, not evidence
that no issue exists.

## Primary standards routing

Verified on 2026-08-26:

- Use the W3C WCAG 2.2 Recommendation for normative web accessibility
  requirements: `https://www.w3.org/TR/WCAG22/`.
- Use the W3C ARIA Authoring Practices Guide for informative widget, keyboard,
  focus, naming, and state patterns:
  `https://www.w3.org/WAI/ARIA/apg/`. APG explicitly is not a normative standard
  or a production UI design system; test implementations with relevant assistive
  technology instead of treating an example as conformance proof.

Re-check the latest published version and target-platform support when the
decision is made. A standards citation does not prove the rendered interface is
accessible; verification still requires semantic inspection, keyboard testing,
automated checks, and representative assistive-technology use proportional to
risk.

## Synthesis rule

Lead with observed behavior, then interpretation, then recommendation. A single
participant can reveal a failure mode; it cannot establish prevalence. A
heuristic can identify risk; it cannot establish user impact. Preserve negative
and contradictory evidence when it would change the decision.
