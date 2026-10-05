# Guided ideation

Guided ideation is Groundwork's step-by-step browser experience for turning a
rough product idea into a coherent planning packet. It preserves the current
Groundwork: Requirements dashboard as one planning option alongside chat,
mockup comparison, and live-canvas refinement. It is a presentation of the
`design` flow, not a fifth canonical flow and not a second source of truth.

## User outcome

The user can begin with incomplete language, make one understandable decision at
a time, see how far the plan has progressed, stop without losing work, and
continue into interface, architecture, and build preparation without repeating
prior context.

Use Guided ideation when the user asks to be guided, wants an interactive
dashboard, benefits from example answers, or is still discovering the product
direction. Prefer chat planning for a mature brief or a fast non-visual
decision; mockups for broad visual divergence; and the live canvas for refining
one selected interface.

## Interaction contract learned from the Easy Terminal session

1. **Explain the decision in ordinary language.** Define unfamiliar terms such
   as viewport or device class in the prompt. When the answer is discrete, show
   the concrete options and their consequences. Always retain a free-form path.
2. **Start from context, not a blank box.** Use inspected facts and prior answers
   to provide editable examples. Examples may start an answer but never submit
   themselves or become `DECIDED` until the user confirms them.
3. **Reveal preferences through choices.** Use low-fidelity layouts, keep/kill
   cards, and comparative options before asking for abstract style ratings.
   Record the reason for a choice, not only the selected label.
4. **Show honest adaptive progress.** Display decisions captured, an upper bound
   on questions remaining, optional preference checks, and measured gaps. Label
   the estimate as adaptive; unknown is `—`, never a fabricated zero or exact
   countdown.
5. **Make interruption safe.** Save partial input without promoting it to a
   decision, resume from durable state, and allow an explicitly incomplete
   working draft at any point.
6. **Make completion actionable.** Review captured decisions, then offer one
   primary action to confirm and generate the planning packet. After generation,
   show the real output location, emitted files, measured gaps, and the next
   available stage.
7. **Keep the whole journey navigable.** Use a persistent stage rail, real routes,
   browser Back support, and `Groundwork / project / stage` breadcrumbs. A user
   can inspect earlier or later stages without changing the live stage or losing
   typed input.
8. **Carry context forward.** Interface, architecture, and build-preparation
   stages receive prior answers, provenance, emitted files, and gap counts. They
   should not ask the user to restate settled decisions.
9. **Separate planning from the target app.** Keep the static indigo planning
   frame and explicit `Groundwork planning mode` label. The frame must not
   animate or compete with the content.
10. **Keep rendering stable.** Polls, elapsed timers, progress changes, and route
    inspection must update only the affected region. They must not rebuild the
    whole screen, move focus, reset scroll, or cause flashing and jitter.
11. **Degrade without dead ends.** If the host agent is absent, use validated
    fallbacks for answerable questions. Never pretend an agent is working or a
    packet exists without evidence. Always expose the recovery or next action.

## Information and system contract

### Inputs

- the user's initial idea and steering;
- prior `DECIDED`, `OBSERVED`, and `ASSUMED` facts;
- inspected repository and existing-product evidence;
- saved partial renderer state;
- the executable adaptive question graph; and
- measured emitter and traceability results.

### Outputs

- `survey-state.json` for resumable interaction state;
- `requirements-working-draft.md` for an explicitly incomplete draft;
- `observation-batch.json` for typed, provenance-bearing decisions;
- the canonical Spec and deterministic planning packet; and
- durable workflow continuation requests and reports for interface,
  architecture, and build preparation.

### Core actions

`answer -> save progress -> draft from what we have -> review -> confirm and
build planning packet -> continue to interface -> continue to architecture ->
prepare the build`

The exact endpoint, payload, persistence, completion, and failure contracts live
in `references/requirements-studio.md`. Guided ideation adds routing and
experience rules; it does not duplicate those machine contracts.

## Architecture boundary

The browser renders and persists presentation state. The host agent supplies
context-aware reasoning. `engine/src/observations.ts` maps typed observations
into the canonical Spec, and the existing emitter writes the packet. A surface
switch changes none of those ownership boundaries. Build Loop remains the
implementation owner after Groundwork emits the immutable build request.

## Acceptance checks

- The router presents Guided ideation as an option rather than Groundwork's only
  interface.
- Guided ideation and chat produce the same Spec and emitter contract.
- Save, resume, draft, packet generation, stage navigation, breadcrumbs, and
  truthful completion remain available.
- Unfamiliar discrete questions provide explanations and concrete choices.
- Dynamic updates preserve focus, scroll, partial input, and screen stability.
- The next action remains visible in every empty, waiting, error, and completion
  state.
