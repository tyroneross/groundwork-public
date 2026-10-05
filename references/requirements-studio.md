---
name: requirements-studio
description: Capture product requirements adaptively in the browser — the host agent reads the Spec-so-far, chooses the next material question, the browser renders it, and every answer lands in the agent's hands with a provenance tag. A presentation upgrade to the design flow, not a parallel requirements system.
---

# Groundwork: Requirements — flow contract

Groundwork: Requirements is the `designer-server.mjs` agent-contract machine pointed at
**questions instead of swatches**. The host agent (you) is the only brain: you read
the Spec-so-far, pick the next high-leverage question from the graph, the browser
renders it as chips / text / cards / allocation rounds, the answer comes back to
you tagged with provenance, and the server persists a typed observation batch.
The host applies that batch to the **same `SpecSchema` JSON the chat design flow
emits** (`references/design.md` §2–3) through the deterministic mapper in
`engine/src/observations.ts`. There is no new emitter and no second Spec model.

Most questions are **static**: their prompt and chips/cards are authored in the
graph and do not depend on the user's words. For those the **server serves the
next question itself** on `/api/answer` — no agent round-trip (see *Hybrid: static
auto-advance + dynamic prefetch* below). You (the agent) are still the only brain
for the **dynamic** nodes — the ones whose content is drawn from the user's own
prior answers — and for assembling the Spec at the end. This is purely additive:
the wire contract, turn-guard seq semantics, deliver-once, and provenance are all
unchanged.

Use this flow when a browser is available and the user wants interactive capture.
The chat design flow (`references/design.md`) remains a first-class fallback; the
Spec and emitter contract are **identical either way**.

## Launch

```bash
node "${CLAUDE_PLUGIN_ROOT}/designer/server/survey-server.mjs" \
  --out ./.designdoc --project my-app --port 8901
```

- `--out <dir>` owns `survey-state.json`, `observation-batch.json`, and the emitted Spec.
- `--project <slug>` is the header label.
- `--port <n>` is preferred; a free-port fallback scan walks upward if it is busy.
- `--resume` reloads an existing `survey-state.json` and replays the coverage bar.
  The file is **reconciled against the current schema**, not trusted: every field
  it predates is backfilled from the canonical default, collections are
  type-guarded, and `--out`/`--project` come from the CLI rather than the file (so
  resuming into a different directory writes and displays the directory you
  launched with). A `survey-state.json` written by an older version therefore
  resumes and completes normally — before this, resuming one and posting the
  documented `POST /api/done { emitted }` crashed with a 500 and left the walk
  permanently unfinishable. A v1 coverage block that still deep-equals the old
  all-zero seed normalizes to unknown (`—`), since v1 could not express "not
  measured"; any other value is a real agent measurement and is preserved.

Then open the printed `http://localhost:<port>` and attach as the host agent by
polling `GET /api/agent/contract`.

## Endpoints (frozen)

`test_survey_server.mjs` parses this table and asserts every route responds.

| Method | Path | Purpose |
|---|---|---|
| GET | /api/init | Boot the browser: wire contract + graph + resumed state. |
| GET | /api/agent/contract | Agent READ side: long-poll for its turn; deliver-once last answer + steering; returns `nextNode` (the deterministic next DYNAMIC node to compose, carrying the `payloadSchema` it must produce), `payloadSchemas` (all shapes), + `complete`. |
| POST | /api/agent/ask | Agent WRITE side: `seed` (OBSERVED inspection), `record` (DECIDED structured facts tied to user answers), `infer` (ASSUMED), `ask`, or `done`; may carry `coverage`; `queue:true` pre-posts the next dynamic question ahead of its turn. |
| POST | /api/answer | Browser submits the user answer (DECIDED); server validates + persists, then auto-advances the next STATIC node (or serves a pre-posted dynamic one) with no agent turn. |
| POST | /api/save-draft | Persists the unfinished current answer and steering without advancing or marking it DECIDED. |
| POST | /api/export-draft | Atomically writes `requirements-working-draft.md` from submitted answers, saved unfinished input, and observed context. The file states that it is incomplete and is not a validated Spec. |
| POST | /api/generate-packet | After the walk is complete, confirms the captured requirements and creates the local Groundwork planning draft with the deterministic emitter. Returns the emitted files, replaces the displayed gap count with the emitted traceability gaps, and returns updated state. |
| POST | /api/workflow/continue | Requests `interface`, `architecture`, or `build` as the next Groundwork stage. The server enforces stage dependencies, persists the request, and exposes it to the agent with all prior decisions, files, and measured gaps. |
| POST | /api/workflow/report | The attached host reports the exact requested stage `complete` or `blocked`, with optional emitted files and summary. The durable history unlocks the next stage without inferring completion from old files. |
| GET | /api/state | Non-mutating: answers + provenance + coverage bar (restart recovery). |
| GET | /api/observations | Returns the typed `groundwork.observation-batch/v1` handoff; identical to persisted `observation-batch.json`. |
| POST | /api/done | Agent signals the walk is complete; reports `emitted[]` (the artifact paths it wrote) so the browser can honestly claim the packet exists. |

## Frozen wire contract

The per-turn question payload is a **superset of `OpenQuestionSchema`**
(`engine/src/spec.ts` :389–399), whose `answerKind` enum is only `text|choice`.
The wire contract keeps `text`, renders `choice`+`answerChips` as `chips`, and
**adds `cards` and `allocation`** — without touching `engine/src/spec.ts`
(extending the engine enum is out of scope; no chunk owns `engine/`). The superset
constants live in the top-of-file block in `survey-server.mjs` (single source);
`survey.js` reads them via `GET /api/init`.

- **answerKinds:** `text`, `chips`, `cards`, `allocation`.
- **Question payload fields:** `nodeId`, `prompt`, `answerKind`, `chips` (≤8),
  `cards[]` (keep/kill or single-choice; optionally carrying a typed low-fidelity
  `mockup`), `examples[]` for editable text starting points, `feedsField` (a real Spec path string, e.g.
  `personas[0].jobs`), `seq`. The browser also receives `axes` on an allocation
  question, but it is **server-owned, not agent-suppliable**: all six tradeoff axes
  are always served (`TradeoffWeightsSchema` requires all six summing to 100, so a
  subset could not produce a valid Spec), and `POST /api/agent/ask` **rejects** an
  `axes` key rather than accepting it and silently substituting the six.
- **Turn guard:** a monotonically-increasing `seq`, stale-turn rejection on both
  write sides (`/api/agent/ask` and `/api/answer`), and deliver-once mailboxes for
  the last answer + steering. The browser and the agent both echo `seq`; a write
  against a superseded turn is rejected with `{ stale: true, seq }`. A **static
  auto-advance** and a **prefetch serve** each advance `seq` exactly like an agent
  `ask` (recorded in `turnLog` as `actor:'server'`), so the guard is unbroken. A
  **prefetch pre-post** (`queue:true`) is the one write NOT bound by the seq/turn
  guard — it is speculative and lands in a FIFO, never a live question.

### Question payload shapes (frozen — published, not merely documented)

**You should never need to read this section to compose a question.** The shape is
published to you by the machine, at the moment of use:

- `GET /api/agent/contract` → `nextNode.payloadSchema` — the shape for the very
  node you are being asked to compose — plus `payloadSchemas` (the whole map).
- `GET /api/init` → `wireContract.payloadSchemas` (same object; the browser reads
  `wireContract.cardPriorities` from here rather than holding its own copy).
- Any rejection from `POST /api/agent/ask` → `{ ok:false, error, expected, example }`,
  so a wrong guess is self-correcting from the response alone.

This section is the human-readable mirror of that machine contract, and it is
**gate-enforced, not hand-maintained**: the block below is parsed by
`test_survey_server.mjs` and deep-equalled against `QUESTION_PAYLOAD_SCHEMA` in
`survey-server.mjs`. Change the constant without changing this block and the gate
fails — the doc cannot silently drift from the wire.

<!-- payload-schema:begin — GENERATED CONTRACT: deep-equalled against QUESTION_PAYLOAD_SCHEMA by test_survey_server.mjs. Edit the constant, not this block. -->
```json
{
  "text": {
    "field": "examples",
    "element": true,
    "expected": {
      "label": "string (required) — non-empty short title",
      "text": "string (required) — non-empty answer that can be edited before submission"
    },
    "example": {
      "label": "Share a decision-ready dashboard",
      "text": "Turn project files and data into a polished HTML dashboard that teammates can open and use."
    },
    "note": "The browser always renders a free-form textarea. Optional examples appear as selectable starting points that fill the textarea but never auto-submit."
  },
  "chips": {
    "field": "chips",
    "element": false,
    "expected": {
      "chips": "string[] (optional) — 1..8 non-empty labels"
    },
    "example": {
      "chips": [
        "Compact",
        "Spacious"
      ]
    },
    "note": "Rendered as multi-select buttons; a free-text box is always offered alongside."
  },
  "cards": {
    "field": "cards",
    "element": true,
    "expected": {
      "label": "string (required) — non-empty",
      "priority": "P0|P1|P2|P3 (optional)",
      "mockup": "{ layout: single-focus|sidebar-canvas|three-pane, regions: string[1..6] } (optional)"
    },
    "example": {
      "label": "Quick capture",
      "priority": "P0"
    },
    "note": "The browser renders card.label into the name input and card.priority into the priority select. A card with no non-empty label renders as a BLANK box."
  },
  "allocation": {
    "field": null,
    "element": false,
    "expected": {},
    "example": {},
    "note": "No agent-suppliable payload: the server always serves all six tradeoff axes (speed_to_alpha|scalability|ux_polish|maintainability|cost|security), because TradeoffWeightsSchema requires all six summing to 100. The browser derives the weights + unacceptable_tradeoff from the user's best-worst rounds. An \"axes\" key, if sent, is validated against the six but never substituted."
  }
}
```
<!-- payload-schema:end -->

Reading it: `field` is the payload key the kind uses; `element: true` means
`expected`/`example` describe **one array element**, not the field. Every field is
optional — a bare `{ nodeId }` ask inherits the node's graph-authored content —
and each is validated only when present.

**Why this is a published contract rather than a table.** This section once said
`cards[]` with no inner shape. The element shape existed in exactly one place: the
browser's `renderCards`, which reads `card.label` and `card.priority`. A host agent
followed the documented contract, posted `[{ id, title, why }]`, got `ok:true`, and
the browser rendered **ten blank input boxes**; the user reported "this survey
doesn't have any features." Nothing was careless — the shape was simply not
knowable from the contract. Server-side validation alone would not have fixed that
either: rejecting a payload whose shape is still undiscoverable turns a silent
blank screen into a guess-reject-guess loop. So the shape is now declared once in
`survey-server.mjs`, published on the agent's read side, echoed in every rejection,
consumed by the browser, and mirrored here under a drift gate. The validator is the
last line, not the mechanism. The graph's own authored cards + static fallbacks are
trusted at runtime and asserted against the same validator in tests, so a fallback
can never drift into something unrenderable.

### Allocation semantics (frozen)

The **browser** converts the user's best-worst picks into integer weights summing
to exactly **100** across the six axes (`speed_to_alpha`, `scalability`,
`ux_polish`, `maintainability`, `cost`, `security`) and collects the required
`unacceptable_tradeoff` choice (both mandated by `TradeoffWeightsSchema`,
`engine/src/spec.ts` :343–366). The **server** validates sum-100 + presence before
persisting. The **agent** receives finished weights, never raw picks. The answer
payload is `{ weights: { …six ints }, unacceptable_tradeoff: "<axis>" }`.

### Provenance (frozen)

Every recorded answer carries a provenance tag that maps 1:1 onto
`EvidenceStatus` (`engine/src/spec.ts` :453):

- User answer via `/api/answer` → **DECIDED**.
- Agent `infer` via `/api/agent/ask` → **ASSUMED** (also mirror into `assumptions[]`).
- Inspection pre-fill (existing-app) → **OBSERVED**, posted via `/api/agent/ask`
  `{ action:'seed', startingPoint:'existing-app', platformSurfaces:[…], sourcePaths:[…], observed:[…] }`.
  Each seeded `feedsField` joins `observedFields`, so its node then skips
  server-side — you never ask what inspection already established.
- Structured facts derived from explicit user answers → **DECIDED**, posted with
  `{ action:'record', sourceAnswerNodeIds:[…], structuredObservations:[…] }`.
  Every source ID must resolve to a persisted DECIDED answer; the server rejects
  self-asserted decisions and overwrites caller-supplied provenance.

The tags survive `survey-state.json` → `observation-batch.json` → Spec v3.

## Observation batch handoff

`GET /api/init` and `GET /api/agent/contract` publish the batch contract,
endpoint, artifact name, and supported fields. The executable graph publishes the
same required-field list. The artifact shape is:

```json
{
  "contract": "groundwork.observation-batch/v1",
  "specId": "spec-spectra",
  "observations": [
    {
      "id": "obs-platform-surface-macos",
      "target": { "field": "platformSurfaces", "entityId": "surface-macos" },
      "value": { "id": "surface-macos", "platform": "macos", "role": "primary" },
      "provenance": "observed",
      "sourceRefs": [{ "kind": "repo", "path": "src/SpectraApp.swift" }]
    }
  ],
  "unresolved": [
    { "field": "architecture.contracts", "reason": "No explicit architecture.contracts observation was recorded." }
  ]
}
```

The supported targets are platform surfaces; architecture components, contracts,
relationships, flows, and cross-spec dependencies; governance constraints,
decisions, and owners; and current, proposed, and verified changes. Missing
targets remain explicit in `unresolved`. The server does not fabricate topology.

`applyObservationBatch(candidateSpec, batch)` in `engine/src/observations.ts`
validates both sides, deterministically upserts each stable-ID entity, stamps its
provenance, derives the legacy `platformTarget` from the primary surface, and then
revalidates the resulting Spec. Invalid contract failure modes, dangling
architecture references, unsafe source paths, duplicate targets, and a mismatched
`specId` fail closed.

## Question graph

The nodes, skip edges, P0 flags, and the **static/dynamic** classification are the
executable graph in `designer/server/survey-graph.json`. The agent consumes it via
`GET /api/agent/contract`; **deterministic skips are applied server-side** so a
drifting agent cannot ask a skipped node (`POST /api/agent/ask` rejects it). LLM
freedom is bounded to wording, in-node follow-ups, and chip generation from the
user's own words — and only for the **dynamic** nodes; **static** nodes carry
their content in the graph and the server serves them itself.

The nodes are the design-flow "ten" (`references/design.md` :52–61) plus four
preference rounds. Two optional rounds reveal preferences through concrete
workspace and progress-feedback choices instead of abstract ratings. **Kind** is `dyn` when the
content must be agent-composed from the user's own prior answers, `static` when the
prompt + chips/cards are fixed in the graph (server auto-advances it):

| Node | Kind | answerKind | feedsField | P0 | Skip when |
|---|---|---|---|---|---|
| jtbd | dyn | text | scenarios[0].goal | ✓ | OBSERVED |
| primary-user-pain | dyn | text | personas[0] | ✓ | OBSERVED |
| top-jobs | dyn | text | personas[0].jobs | ✓ | OBSERVED |
| critical-screens | dyn | cards | screens | ✓ | platformTarget=agent-system · OBSERVED |
| platform | static | chips | platformTarget | ✓ | OBSERVED |
| info-density | static | chips | uiPreferences.informationDensity | | OBSERVED |
| workspace-layout-preference | static | cards + low-fi mockups | uiPreferences.mustKeep | | platformTarget∈{agent-system,claude-plugin} |
| progress-feedback-preference | static | chips | uiPreferences.mayEvolve | | never (optional revealed preference) |
| brand-adjectives | static | chips | uiPreferences.brandAdjectives | | OBSERVED |
| voice | static | text | voiceProfile | | OBSERVED |
| a11y-floor | static | chips | uiPreferences.accessibilityFloor | | OBSERVED |
| responsive-range | static | chips | uiPreferences.responsiveTargets | | platformTarget∈{agent-system,claude-plugin} · OBSERVED; explains viewport as app-window size and resolves platform-aware choices |
| tradeoff-allocation | static | allocation | tradeoffWeights | ✓ | never (a preference cannot be observed) |
| feature-priority | dyn | cards | features | | never (priority is a decision) |

**Skip vocabulary** (declarative, in the graph JSON): `platformTargetIn`,
`startingPointIn`, and the implicit `skipWhenObserved` (default true — a node whose
`feedsField` is already an OBSERVED fact is skipped; set false for preferences).
The evaluator is the exported `isNodeSkipped(node, facts)` in `survey-server.mjs`;
the graph tests import it and walk `survey-graph.json` with the same logic.

**Dynamic vocabulary** (declarative, in the graph JSON): each node declares
`dynamic` (default false). `false` = static (server-served); `true` = the five
user-word-derived nodes above. The evaluator is the exported `isNodeDynamic(node)`;
the deterministic walk order the server auto-advances along is the exported
`computeNextNode(graph, facts, answeredIds)`. The graph tests assert the split.

Every **dynamic** node ALSO carries a required static `fallback`
(`{ prompt, chips?, cards? }`) in the graph — the server serves it when no host
agent is attached (see *Graceful degradation* below). The graph tests assert every
dynamic node carries usable fallback content.

## Checkpoints, working drafts, and adaptive progress

The browser exposes two user-controlled checkpoints while a question is live:

- **Save progress** persists the renderer's partial state and steering in
  `survey-state.json` without submitting the answer, advancing the sequence, or
  granting `DECIDED` provenance. Text, chips, cards, and partially completed
  allocation rounds restore after reload and `--resume`.
- **Draft from what we have** first saves the current partial answer, then writes
  `requirements-working-draft.md` atomically. The readback includes submitted
  decisions, provenance, the saved unfinished answer, observed context, and the
  current progress estimate. It explicitly says it is incomplete; only the
  validated emitter can create the canonical Spec and build handoff.

`GET /api/state.walkProgress` reports eligible decisions captured, total eligible
nodes, an upper bound on remaining questions, optional preference checks
remaining, and a derived percentage. The upper bound is honest: deterministic
platform and observed-field skips are already removed, but the adaptive host may
finish earlier when more questions would not change the plan.

## Hybrid: static auto-advance + dynamic prefetch

Every question used to cost one host-agent round-trip: the user answered, the turn
flipped to `await_agent`, the agent woke and composed the next question, then
`POST /api/agent/ask` made it live. For static nodes that LLM turn buys nothing —
the content is already in the graph. The hybrid removes it, **additively**.

- **Static auto-advance (the big win).** On `POST /api/answer`, the server records
  the answer, then computes the next non-skipped, unanswered node in graph order
  (`computeNextNode`). If it is **static**, the server renders it directly as the
  next live question (`await_user`) — the browser's poll loop shows it instantly,
  with **no agent turn**. It flips to `await_agent` only when the next node is
  **dynamic** (the agent must compose it) or the walk is complete (the agent
  assembles the Spec and `POST /api/done`). Server-side skip enforcement and
  DECIDED provenance are unchanged. For a greenfield web app (5 dynamic + 9 static
  nodes) this is **14 agent turns → 5** — a 64% cut; existing-app walks drop
  further as inspection pre-fills more nodes.

- **Dynamic prefetch (latency off the critical path).** While the user is answering
  the current question, the agent may pre-compose the next dynamic question and
  pre-post it with `queue:true`:

  ```json
  POST /api/agent/ask
  { "action": "ask", "queue": true,
    "question": { "nodeId": "primary-user-pain", "prompt": "…composed from the user's words…", "answerKind": "text" } }
  ```

  The server holds a small FIFO. When the walk reaches that dynamic node, the server
  serves the pre-posted question **instantly** instead of flipping to `await_agent`
  — the LLM composition already happened behind the user's think-time. A queued node
  that becomes skipped or is already answered is pruned, never served. Prefetch is
  ephemeral (not persisted); on `--resume` the agent simply re-composes.

- **Contract hint.** `GET /api/agent/contract` returns `nextNode` (the deterministic
  next dynamic node to compose, with `id`/`dynamic`/`feedsField`/`answerKind`) and
  `complete: true` when the walk is done. Static nodes are never surfaced here —
  the server owns them.

`--resume` reloads a mixed walk (auto-advanced static + agent-driven dynamic)
correctly: answers, provenance, and `observedFields` survive the restart, and if
the reloaded state's next node is static the resumed session serves it immediately
(seamless, no agent required to re-attach first).

## Graceful degradation: static fallback when no agent is attached

This is a **human-in-browser** survey. The user may self-pace over hours, and the
host agent may never attach or may step away mid-walk. An agent is "attached" only
while it long-polls `GET /api/agent/contract`; the server records the last poll
time. Without a control for the absent-agent case, a **dynamic** node would leave
the walk in `await_agent` indefinitely and the browser would freeze with no
question — the observed failure (it stalled at `feature-priority` after the user
had answered every prior node). The fix, additive and never a hard stall:

- **Every dynamic node carries a static `fallback`** in `survey-graph.json`
  (`{ prompt, chips?, cards? }`) — content good enough to answer without agent
  enrichment (e.g. `feature-priority` ships a default set of common product
  features to keep/cut/prioritize; `critical-screens` ships common screens).

- **Staleness threshold `AGENT_ATTACH_WINDOW_MS`** (named const in
  `survey-server.mjs`, default **25 s**, env-overridable via
  `GW_SURVEY_AGENT_STALE_MS` for tests). When the walk reaches a dynamic node:
  - an agent polled **within** the window → flip to `await_agent` as before, so
    the agent composes richer, user-word-derived content (or a prefetch hit serves
    instantly);
  - **no** recent agent poll → the server serves the node's **static fallback**
    immediately, exactly like a static node (`await_user`), so the browser never
    freezes. If the agent later attaches, the node is already answered (DECIDED) —
    no double-serve.
  A boot-time grace floor means the first window after boot is not treated as
  "absent", so agent-driven and existing-app-`seed` sessions are never pre-empted.

- **A low-frequency watchdog** covers the two cases that have no triggering user
  answer: the **first** node on a fresh no-agent boot, and a dynamic node left in
  `await_agent` because the agent attached and then **stepped away** mid-walk. It
  only acts while the walk sits in `await_agent`; once the window lapses it serves
  the fallback (or, for a completed walk with no agent, auto-finalizes to `done`
  so a fully self-paced survey reaches completion instead of soft-stalling).

- **Genuine agent-wait is visible, not blank.** While the server *is* in
  `await_agent` (an agent recently polled and is composing), the browser shows a
  calm *"Preparing your next question…"* state with a spinner — never a frozen
  screen. `GET /api/state` exposes `agentAttached` (true only if an agent polled
  within `AGENT_ATTACH_WINDOW_MS`) so the browser state and the server's fallback
  decision use the same window and never drift.

`test_survey_server.mjs` covers all three cases: recent-agent → `await_agent`;
no-agent → static fallback served; and the key regression — a survey with **no
agent ever attached** completes to `done` purely through fallbacks.

**Existing-app entry REQUIRES inspection first.** Inspect the repo, seed
`platformSurfaces`, `sourcePaths`, structured observations, and `observedFields`.
The primary app and companions are therefore already adapted when the browser
opens, and satisfied nodes skip — you never ask what is OBSERVED.

## Completion screen (review, confirm, generate, continue)

The done screen used to say only *"Requirements captured. The host agent has
everything it needs. The emitted design packet is being written to the output
directory."* — no path, no readback, no progress. It asserted that writing was
happening while showing no evidence of it, and then sat there. A user who had just
answered fifteen questions could not tell whether anything had happened, or where.

It now renders from live state (`designer/server/survey-view.mjs`, pure and
imported by both the browser and `test_survey_view.mjs`):

- **Clear next action** — a self-paced walk ends at **Review and confirm your
  requirements**, not an explanation of missing host-agent plumbing. The primary
  action, **Confirm and build planning packet**, calls `POST /api/generate-packet`.
  The server assembles the captured decisions into a provenance-bearing Spec,
  runs the existing deterministic emitter in a staging directory, verifies the
  expected files, then moves them into the selected output directory. Failure
  leaves the answers intact and provides an inline retry action.
- **Navigable Groundwork journey** — every item in the persistent left rail is a
  real button and hash route. A user can inspect any stage, use browser Back to
  retrace the path, and return to the live stage without losing typed input (the
  shell saves unfinished input as a draft before leaving a question). The current
  stage remains distinct from the stage being inspected.
- **Breadcrumbs and carried context** — the main surface always shows
  `Groundwork / <project> / <stage>`. Downstream stage overviews derive their
  context from persisted answers, emitted files, workflow reports, and measured
  gaps; they do not ask the user to repeat prior decisions.
- **Durable continuation** — interface, architecture, and build actions call
  `POST /api/workflow/continue`. The request appears on the existing host-agent
  contract with the prior answers and artifact evidence. `POST
  /api/workflow/report` records completion or a blocker, and only that report
  advances the stage. The browser never claims that clicking a button performed
  agent work by itself.
- **Planning-mode frame** — a static indigo glow surrounds the viewport and the
  header says `Groundwork planning mode`, clearly separating the planning tool
  from the target application. The frame does not animate.
- **Honest gap boundary** — after the question walk but before generation, the
  gap counter shows unknown (`—`), because answered questions do not prove the
  architecture and acceptance trace is complete. After generation it shows the
  actual `traceability.json.coverageGaps` count.

- **Readback** — the answered nodes with their values summarized, in walk order
  (e.g. `Features → 10 (3× P0, 4× P1, 3× P2) · 1 cut`, `Tradeoffs → ux_polish 30
  (never sacrifice)`). Read from recorded answers only; it never invents data.
  Labels are authored in the graph as `readbackLabel`, alongside every other
  user-facing string. Rows whose provenance is not `DECIDED` are marked `assumed`
  / `observed`, so an inference is never handed back as the user's own answer.
- **Output location** — the real absolute `--out` the server was launched with,
  surfaced via `GET /api/state` (`out`) and rendered prominently and copyably.
- **Two terminal states, and the difference is honest:**

  | State | When | Shows |
  |---|---|---|
  | `working` | an older or partial state has not established completion and reports no files | spinner + **elapsed counter** + `Writing to <out>` |
  | `complete` | the user generated a packet or an agent reported `POST /api/done { emitted: [...] }` | `✅ Planning draft created — N files` + the emitted traceability gap count + file list + `Created in <out>` |
  | `no-packet` | the walk is complete and no files exist yet, whether finalized by the server or an agent | `Review and confirm your requirements` + a working generation action — no spinner, no counter |

  The `no-packet` state exists because the anti-freeze fallback can carry a
  self-paced walk to `done` with no agent present. Showing the `working` copy there
  ("the host agent is assembling your design packet") would be a fake *in-progress*
  claim — the mirror of the fake completion this screen replaced — and the server
  already knows it is false, since agent-staleness is the very condition that
  triggered auto-done. `GET /api/state` exposes `doneBy` so the browser can tell the
  two apart. An agent that attaches later and reports files still flips it to
  `complete`.

  The screen **cannot** claim files exist that no one reported: `status` is derived
  from `emitted`, and blank/non-array entries cannot fake it. If the agent never
  reports, the working state persists with the out-dir — that is the truthful
  answer, and it is strictly better than the old text, which asserted a write with
  no evidence. Progress is an **elapsed counter, not a countdown**: the agent's
  finish time is not predictable, so the screen reports time spent. The counter is
  text, so it conveys progress unchanged under `prefers-reduced-motion` (where
  `survey.css` already stops the spinner animating).

`emitted` is validated like any other agent payload, and a rejection carries
`expected` + `example`. The contract is published on `GET /api/agent/contract` as
`doneContract`, so an agent learns it at the moment of use rather than from prose.

## Stop rule (deterministic)

Stopping is by **scratch-emit**, not vibes. At each checkpoint the agent reads
`GET /api/observations`, applies it to the Spec-so-far with
`applyObservationBatch`, writes the result to a temp file, and runs the existing
emitter into a temp dir:

```bash
node "${CLAUDE_PLUGIN_ROOT}/engine/dist/cli.js" "$TMP_SPEC" --out "$TMP_OUT"
```

The agent then reads `traceability.json.coverageGaps` (`engine/src/spec.ts` :644)
from the emitted set and POSTs the counts as `coverage` on its next
`/api/agent/ask`. The server stores it; `GET /api/state` surfaces it; the browser
renders the coverage bar (needs / features / screens / nonGoals + gaps remaining).

### Coverage bar: unknown is "—", never 0

The bar previously read `0 needs · 0 features · 0 screens · 0 non-goals · 0 gaps`
on a **fully answered** survey. The counters were fed only by the agent-posted
`coverage` payload above; when the agent never posted one, `freshState` seeded them
with `0` and the browser rendered `?? 0`. "Never measured" and "measured zero" were
indistinguishable, so the bar stated a confident falsehood about a complete survey.

The rule now, in precedence order:

1. **Agent-measured wins.** A posted `coverage` value is authoritative — including
   a genuine `0` and an empty `gaps: []` (the stop-rule signal). Both are real
   measurements and are rendered as such.
2. **Derived backfills what the answers establish.** The server derives a count
   only where a node's `feedsField` directly feeds that Spec array — today
   `feature-priority → features` and `critical-screens → screens`, counting kept
   cards (a `kill` is a cut, not coverage). This is live, needs no agent turn, and
   is the honest half of "derive sensible live counts".
3. **Everything else stays `null` → renders `—`.** `needs` and `nonGoals` have **no
   node feeding them** (the agent assembles them from the jtbd/pain/jobs prose) and
   `gaps` exists only after a scratch-emit. Guessing a plausible number for these
   would be the same class of error as the original zero, so the bar says it does
   not know.

So the answer to "derive (a) or neutralize (b)" is **both, split by what is
actually knowable**: derive where a node establishes the array, neutralize where
nothing does. `null` means unknown; `0` means measured zero. The distinction is the
fix. Note the two coverage views are deliberately different and must not be
conflated: `GET /api/state` serves the merged **presentation** view for the bar,
while `GET /api/agent/contract` returns the agent's **raw posted** coverage — its
own measurement ledger, which the deterministic stop rule depends on. Derived
presentation counts must never feed the stop rule.

**Done** = the emitter exits 0 (no schema/validation blockers) **AND**
`coverageGaps` is empty **AND** every P0 graph node is visited-or-skipped-with-reason.
No new engine check-mode is built; a lint-only mode is a possible future follow-up.

## Non-goals

- **No embedded AI backend / no engine bridge in the server** — the host agent is
  the only brain for *composed* content (dynamic nodes) and general Spec assembly. The
  server's static auto-advance is not reasoning: it replays graph-authored content
  along a deterministic order, which is presentation. The server remains a
  presentation + persistence relay.
- **No duplicate Spec assembler in the server** — the server records observations;
  `engine/src/observations.ts` owns their validated, deterministic mapping into the
  existing Spec v3 contract, and the existing emitter remains unchanged.
- **No new engine lint/check mode** — stopping uses scratch-emit.
- **No multi-user/remote mode** — loopback-only (127.0.0.1); personal local tool.
