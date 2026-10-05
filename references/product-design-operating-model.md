# Product Design Operating Model

Groundwork is the whole-app UI/UX planning layer. It manages one continuous
product-design record from the first idea to the Build Loop handoff and codifies
the product schema, requirements, flows, screens, states, design patterns,
architecture, implementation plan, acceptance criteria, and tests. A user may
focus on one screen or one decision; the system still checks downstream product
and technical impacts.

## Roles

| Role | Owns | Returns |
|---|---|---|
| Product design manager | Goal, stage selection, decision order, artifact coverage, handoff readiness | Current objective, work sequence, decisions, unresolved impacts |
| UI/UX researcher | Decision-relevant evidence, method quality, synthesis, limitations | Findings tied to Spec changes |
| Interface designer | Information architecture, flows, screens, states, interactions, visual system | Selected or testable UI direction |
| Product design architect | UI-to-system mapping and technical completeness | Components, contracts, data paths, tasks, tests, gaps |

The manager coordinates the process. Specialists own their judgment domain but
do not silently expand product scope or implementation authority.

## End-to-end loop

1. **Frame:** name the user outcome, current product state, immediate decision,
   constraints, and owned output directory.
2. **Inspect:** read existing product artifacts, source, runtime evidence, prior
   research, selected mockups, and cross-session preference evidence. For an
   existing product, record the observed or declared baseline, precedence, and
   current behavior before proposing a visual change.
3. **Research:** collect evidence only when it can change a material decision.
4. **Define:** update needs, scenarios, features, scope, success signals,
   triggers, states, effects, writes, failures, recovery, confirmation,
   information flow, and governance in the canonical Spec.
5. **Design:** use a normal change contract to express the intended direction as
   baseline-relative deltas. Use explicit conformance intent only when the
   pinned observed or declared baseline already satisfies the intended outcome;
   in that case record zero deltas and no proposed change records, cite
   source-backed baseline evidence and the executable prime acceptance test,
   and require artifact-bound constraints, verification targets, and acceptance
   predicates. Then resolve flows,
   screens, content, interactions, accessibility, responsive behavior, tokens,
   and visual direction. Mark each decision `locked`,
   `leaning`, `open`, `experimental`, or `superseded`; a locked decision needs
   an enforceable scoped constraint, while leaning preserves design grammar
   and accessibility bounds without freezing an exact value.
6. **Architect:** trace each material UI decision through data, components,
   contracts, flows, failures, security, telemetry, tasks, and tests.
7. **Verify:** regenerate artifacts, inspect traceability gaps, test the design
   at an appropriate fidelity, and separate intended truth from delivery state.
8. **Hand off:** emit the immutable `build-request.json` and self-contained
   `builder-handoff.md`. Reconcile returned implementation evidence separately.

## UI impact record

Maintain this chain for each material screen:

`need -> feature -> UX flow -> screen/state/element -> data I/O -> entity -> component -> contract/event -> architecture flow -> failure/security/telemetry -> task -> test`

The generated `traceability.json.uiImpact` is the machine-readable index.
Architecture is attached to a screen only through explicit screen, element, or
state references on an exchange; sharing a feature is not enough. Each authored
screen state receives its own `stateImpacts` row for explicitly linked
architecture flows, failure paths, and tests. Empty arrays mean no link was
authored, not that the relationship is unnecessary. A missing link is not
automatically a blocker: classify it as one of the following before continuing.

### File ownership before handoff

For an existing app or an iteration over an existing definition, attach exact
repository-relative `ownedFiles` to each Feature, Screen, Component, and
Contract that will change. Groundwork records whether task ownership is
`explicit` or `inferred`; inferred ownership cannot support a READY claim for
an existing app or an ambiguous multi-platform feature.

Declare an intentionally absent path once under
`projectContext.declaredNewFiles` as `{ "path": "...", "because": "..." }`.
Every declared-new path must also be owned by a build entity. Do not classify a
missing path from filesystem state alone: run the read-only
`--check-owned-files <spec> --repo-root <root>` gate to verify expected-existing
regular files and safe, absent planned-new paths without changing the canonical
Spec.

- `not-applicable`: the screen genuinely needs no link of that kind.
- `unresolved`: the choice is material but evidence or a decision is missing.
- `assumed`: Groundwork selected a low-risk reversible default.
- `resolved`: the Spec carries a stable reference and provenance.

Do not force remote contracts or persistence onto a local static surface. Require
them when the UI fetches, mutates, synchronizes, streams, delegates, or crosses a
trust boundary.

## Stage gates

- Research is ready when the evidence can distinguish the live options and its
  limitations are explicit.
- UI is ready when primary flows and material states work at the intended
  fidelity, not merely when the default screenshot is polished.
- Architecture is ready when every material UI path has a coherent data and
  failure path and the trace record exposes remaining gaps.
- Handoff is ready when acceptance criteria, tasks, dependencies, tests, and
  manual external actions are explicit and digest-bound.

Completion is proportional to the requested stage. Groundwork can finish a
research decision or a visual selection without pretending the entire product
is build-ready.
