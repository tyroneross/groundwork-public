# Groundwork

Groundwork is the whole-app UI/UX planning tool for Claude Code and Codex. It
starts from a raw idea, existing artifacts, a functioning implementation, or
known UI preferences, then codifies the product schema, requirements, UX flows,
screens and states, design patterns, architecture, implementation plan, and
acceptance criteria that humans and AI builders can execute.

The plugin does not build the app. Per `SPEC.md`, the intended endpoint is a
handoff-ready artifact set plus a versioned exchange with Build Loop: Groundwork
publishes intended truth, Build Loop returns implementation evidence, and
Groundwork independently calculates convergence.

## Quick Start

Type `/groundwork:run` and describe what you have: a raw idea, an existing app, a set of mockups, or
a UI direction you want to evolve. That single command is the entry point for every Groundwork flow.
It picks the stage, asks only for what it needs, and writes the artifact set described below. To
report a plugin bug or request a feature, use `/groundwork:submit-feedback`.

## North Star

Groundwork plans the whole app before production code changes. A user can enter
with a rough idea, a well-formed concept, an existing app or agent, or known UI
preferences. Groundwork uses chat to resolve product and technical decisions,
interactive visual choices to refine UI/UX direction, and one canonical Spec to
keep the schema, plans, patterns, architecture, tasks, and tests consistent.

The result is a self-contained, paste-ready builder packet: the relevant
requirements, architecture, UI direction, implementation tasks, tests, and
traceability needed by an AI coding tool are embedded in `builder-handoff.md`.
Confirmed design tokens and selected mockups are embedded when present.
Implementable code and states should be fully wired. Only unavoidable external
provider/account/credential actions may remain manual, and those include exact
setup and verification instructions.

## Planning experiences

Groundwork offers several ways to work through the same product definition. The
surface changes; the canonical Spec, provenance rules, emitter, and Build Loop
handoff do not.

| Experience | Best for | Interaction |
|---|---|---|
| **Guided ideation** | A rough idea or a user who wants structured help | The browser dashboard asks one plain-language decision at a time, offers editable examples and low-fidelity choices, shows an adaptive progress estimate, saves/resumes, and continues from requirements into interface, architecture, and build preparation. |
| **Chat planning** | Fast expert synthesis or non-visual technical decisions | The host agent resolves the same requirements in conversation and writes the same Spec. |
| **Mockup comparison** | Broad visual divergence | Groundwork presents a small set of meaningfully different full-screen directions for comparison. |
| **Live canvas** | Refining one selected direction | Groundwork keeps one interface visible while comments and decisions update it in place. |

When the user asks to be guided through an idea, prefers a dashboard, or has not
chosen a planning experience, Groundwork should offer **Guided ideation** as a
concrete option. It is implemented by Groundwork: Requirements and follows the
interaction contract in
[`references/guided-ideation.md`](references/guided-ideation.md).

## Artifact Set

Groundwork emits or updates the relevant subset for the user's current stage;
it does not force every artifact on every run.

- `spec.json`: canonical Spec v3 product model, starting-point provenance, platform topology, intended architecture, change lifecycle, UI constraints, and resumable source for every downstream flow. Legacy v1/v2 inputs migrate deterministically.
- `steering.md`: durable product, design, voice, and operating boundaries, refreshed with confirmed visual evidence.
- `requirements.md`: needs, personas, scope, non-goals, metrics, and EARS-shaped acceptance criteria.
- `design.md`: data model, API contracts, integration boundaries, architecture decisions, observability, and risks.
- `design-system.md`: screen-level design direction, component states, voice, and tone from the design flow.
- `design-tokens.md`: color/type/space/motion token system + AI prompt pack from the revealed-preference walk; complements — never overwrites — `design-system.md`.
- `tasks.md`: build-loop native implementation plan with stable task IDs, integration work, dependencies, definition of done, and requirement references.
- `builder-handoff.md`: self-contained implementation contract for an AI coding tool, including the exact manual-integration boundary.
- `traceability.json`: Need-to-feature-to-screen-to-task-to-test traceability,
  plus a per-screen UI impact index linking elements, data entities,
  architecture components/contracts/flows, unresolved gaps, tasks, and tests.
- `architecture.json`: resolved local multi-Spec architecture graph with qualified component, contract, relationship, flow, and dependency identities.
- `build-request.json`: immutable `groundwork.build-request/v1` intent packet with ordered tasks, acceptance criteria, manual actions, accepted return versions, and normalized Spec/task/request digests.
- `convergence.json`: Groundwork-owned reconciliation of a validated Build Loop implementation map. It reports `unverified`, `implemented`, `verified`, `diverged`, `blocked`, or `manual` without changing intended Spec truth.
- `artifact-manifest.json`: generation ID and SHA-256 commit marker for the atomically published artifact set.

## Derived Framework Exports

Groundwork can explicitly project a completed Spec v3 into Spec Kit or OpenSpec
without changing canonical intent or running either framework's CLI:

```bash
node "${GROUNDWORK_ROOT}/engine/dist/cli.js" <spec.json> \
  --out <groundwork-output> \
  --export spec-kit \
  --export-out <exact-owned-spec-kit-tree>

node "${GROUNDWORK_ROOT}/engine/dist/cli.js" <spec.json> \
  --out <groundwork-output> \
  --export openspec \
  --export-out <exact-owned-openspec-tree>
```

Both flags are required, and the canonical and derived roots must be disjoint.
The output root is an exact Groundwork-owned derived tree: a first run adopts
only a missing or empty directory; later runs require an intact
`.groundwork-export-manifest.json`. Groundwork rejects traversal, symlinks,
unmanaged files, modified generated files, and malformed prior manifests before
replacement. If concurrent bytes appear during the final rename window,
Groundwork restores the prior tree and preserves those bytes in a sibling
`.groundwork-export-conflict-*` quarantine directory. The final tree and
manifest are deterministic and source-stamped. A generation-bound two-phase
transaction keeps the canonical and derived roots on the same prior generation
if either publication fails, and uses the canonical manifest as crash-recovery
proof before finalizing an interrupted derived commit. Source stamps point
to the dated upstream layouts in `docs/contracts/upstream-layouts/` and bind the
projection to the canonical Spec digest. Canonical publication also verifies
installed bytes before commit; concurrent replacements are retained in sibling
`.groundwork-artifact-conflict-*` directories instead of being deleted.

The adapters never invoke `specify init` or `openspec init`, install upstream
packages, fetch the network, or make their directories authoritative. Update
`spec.json` and regenerate when intent changes.

## Build Loop Exchange

1. Generate the Groundwork artifact set. `build-request.json` is the
   machine-readable handoff; `builder-handoff.md` remains the self-contained
   human/agent directive.
2. Give the immutable request to Build Loop. Build Loop validates the request
   and produces `build-loop.implementation-map/v1` with repository-relative
   code, commit, test, runtime, deviation, and manual evidence.
3. Reconcile the returned map into the existing Groundwork output directory:

   ```bash
   node "${GROUNDWORK_ROOT}/engine/dist/cli.js" \
     --reconcile <implementation-map.json> \
     --out <existing-groundwork-output>
   ```

The reconciliation fails closed on unsupported versions, stale or mismatched
digests, unknown IDs, unsafe evidence paths, and overstated verification. An
`implemented` item has mapped code; a `verified` item also has passing test or
runtime evidence. Groundwork never copies the Build Loop-owned implementation
map into its intended Spec.

## Host Compatibility

- Claude Code exposes `/groundwork:run` through `commands/run.md`.
- Codex exposes the `groundwork` skill through `.codex-plugin/plugin.json` and `skills/groundwork/SKILL.md`.
- Both entrypoints use the product design manager and `references/router.md` as
  the routing source of truth, then execute the same `design`, `mockups`,
  `explore-ui`, or `iterate` flow.

Groundwork also exposes bounded product-design skills for end-to-end product
management, UI/UX research, interface design, and product-design architecture.
Its research, decision-science, application-architecture, and design-profile
references distinguish universal constraints from contextual hypotheses and
project examples.

The deterministic TypeScript emitter and absorbed Python Designer remain shared across hosts. Host manifests and entrypoints are thin adapters; the workflow is not duplicated into host-specific trees.

Process-flow, workflow, data-flow, and sequence diagrams default to Diagram
Intelligence through the shared router on every host. The
[process-diagram contract](references/process-diagrams.md) covers evidence,
explicit versus automatic calls, readable drilldowns, IBR review, and the
fallback when Diagram Intelligence is unavailable. This is a planning route,
not a required runtime dependency or a restriction on the user's chosen format.

## Verification

```bash
npm ci
npm run test:release
```

`test:release` is the deterministic, fail-closed source/protocol/browser/package
gate. It must fail when a declared required layer is absent or skipped and
atomically records its result in
`.build-loop/release/release-evidence.v2.json`.
It also runs golden, containment, rollback, CLI-argument, and staged-bundle
smoke tests for both derived exporters.

Release operators separately run
`BUILD_LOOP_ROOT=/path/to/pinned/build-loop npm run test:host-release` in
isolated Claude, Codex, and Build Loop homes. The host gate is intentionally not
part of ordinary CI. The Build Loop worktree must be clean at the commit pinned in
`scripts/release-policy.json`; the gate rejects a different version, commit, or
adapter/test digest. The current pin is Build Loop 0.39.0 at
`a62a3571ad971df49e483dbbd7d00f158ec40deb`; the policy records the exact adapter
and distribution-test SHA-256 values used by the gate. Publication remains ineligible until `npm run release:verify`
confirms that the same release-evidence file records all three stable gate IDs
as `passed` for the staged bytes.

The third gate is operator-run authenticated activation. Groundwork generates a
fresh challenge, resolves the installed Claude and Codex plugin roots, invokes
Claude `/groundwork:run` and Codex `groundwork:groundwork`, captures their host
output, requires each entrypoint to execute its installed resolver and return a
challenge-bound `--bootstrap` launch contract, then independently drives the
contract's installed Designer API. It
retains transcripts and bootstraps under
`.build-loop/release/live-activation/<artifactDigest>/`:

```bash
npm run release:create-activation-report -- \
  --manifest <staged-release-manifest.json>
npm run release:record-activation -- \
  --manifest <staged-release-manifest.json> \
  --activation-report <activation-report.v1.json>
npm run release:verify
```

The activation gate rejects unauthenticated or nonzero hosts, mixed candidate
bytes, expired or already-consumed challenges, missing public entrypoints, launch arguments without an
exact `--bootstrap`, incomplete macOS-primary/web-companion baselines, and
continuations that repeat Platform Target or Navigation Structure.

## One panel, one rail

Groundwork's browser surface is a single panel. A persistent left rail lists
every Groundwork component and the stage renders whichever one is selected;
Designer is one destination among them, not the whole window. Components that
have no surface in this panel — the project overview, the requirements
interview, mockups, iterate and handoff — are listed as labelled, non-clickable
entries carrying the `/groundwork:run` phrasing that starts them in chat, so the
rail is a complete map rather than only the parts that happen to be wired.

Three destinations are live in the panel: **Designer** (the visual walk),
**Saved work** (compare, select, refine, export) and **Design output**
(DESIGN.md, drafts and versions). Selecting Saved work and returning to Designer
resumes the same step.

An existing-app session opens on the baseline review. Its first control is the
real next action, named after the decision the host has posted — "Continue to
Primary Navigation Structure" rather than a bare "Continue" — and when a
decision is already posted its option cards render in place, so accepting the
baseline and answering is one click. Sending a comment is a quiet side channel
below the task, never a second primary button beside it.

## Saved design work

Designer keeps local comparison history, selected designs and feedback receipts. See [saved work](docs/designer-saved-work.md) for use, persistence and handoff boundaries. Keep these records in the target project workspace.

## Install and verify

Clone the public source with `git clone https://github.com/tyroneross/groundwork-public.git`.
For Claude Code, add the marketplace with `/plugin marketplace add tyroneross/groundwork-public`,
then install `groundwork@groundwork`. Codex can load the checkout's `skills/groundwork/SKILL.md`.

Contributors need Node.js 22+, Python 3.12+, pytest, and Chrome or Chromium.
Run `npm ci`, `python3 -m pip install pytest`, and `npm test`.
The optional `npm run test:release` also requires the Claude CLI.
Authenticated host activation is a separate local check.

## License and provenance

Groundwork is licensed under [Apache 2.0](LICENSE). [NOTICE](NOTICE) records
authorship and bundled guidance attribution. The engine uses a source-owned
contract validator and has no third-party runtime dependencies. TypeScript,
tsx, and esbuild remain development tools. [Third-party notices](THIRD-PARTY-NOTICES.md)
retain attribution for earlier bundles. The [publication attestation](PUBLICATION-ATTESTATION.md)
describes the source boundary, synthetic fixtures, and verification limits.
