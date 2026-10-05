# Groundwork — capability spec

> Working name (unconfirmed; alts: Blueprint, DesignPilot). A Claude Code and
> Codex plugin that takes a raw idea through design/product planning and emits an
> AI-and-human-consumable spec set, ending at a versioned handoff to Build Loop.
> It plans the design of apps and evaluates returned delivery evidence; it does
> not build them.

Status: DRAFT · Owner: Tyrone · Date: 2026-07-07
Source: 4-asset discovery + 3-brief research + Fable synthesis (this session).

---

## North star

Groundwork is the premier guidance layer for defining, understanding, and
evolving an app, agent, or product and its UI preferences. It meets the user at
any stage: rough idea, well-developed concept, existing definition, functioning
implementation, or known preference set.

It combines two engagement modes:

- **Chat:** understand current state, resolve material questions, make and
  explain product/architecture decisions, reconcile returned implementation
  evidence, and produce the written definition.
- **Interactive visual guidance:** extract or import an existing visual system,
  compare concrete full-screen directions, and help the user confirm or evolve
  preferences through choices rather than abstract interviews.

The terminal outcome is a paste-ready build packet that an AI coding tool can
turn into a high-fidelity, near-production-ready result. All implementable
flows, states, architecture, validation, tests, and integration code are wired.
Only external account, dashboard, credential, approval, or provider actions may
remain manual; Groundwork must state exactly what the user needs to do and how
to verify it.

### Entry and iteration contract

| Entry point | Groundwork behavior |
|---|---|
| Initial idea | Define the minimum complete product, architecture, UI direction, and build plan without forcing unnecessary questions. |
| Existing artifacts | Read and preserve confirmed decisions, then update the canonical Spec and only the projections affected by the requested change. |
| Existing app or agent | Inspect source, runtime, tests, and design artifacts before describing current state or proposing a delta. |
| Known preferences | Capture them as constraints or seeds; do not ask the user to rediscover them. |
| Iteration | Keep provenance between observed facts, user decisions, and assumptions; regenerate deterministic projections from `spec.json`. |

## Non-goals
- Not a builder. Output ends at the spec set + build-loop handoff.
- Not a hosted app. No baked-in LLM API key — host agent is the LLM.
- Does not modify ProductPilot or the published ui-guidance plugin.
- v1: no cross-device / phone ideation (that was the ProductPilot-as-demo path, declined).

---

## Architecture

**Spine:** a versioned typed `Spec` object (ported from ProductPilot's Zod schema) is the
single source of truth on disk (JSON). Every emitted markdown doc is a *rendered
projection* of it → iteration never drifts the docs; traceability falls out of
the existing `traceMatrix`.

```
idea | existing definition | existing app/agent
 → inspect/import      (source, runtime, design artifacts, known preferences)
 → load steering     (absorbed Designer profile + trimmed voice profile → steering.md)
 → elicit            (ported intake-controller; 10-question high-leverage brief)
 → structure         (ported 5-stage prompts → mapped onto the 3-artifact chain)
 → EXPLORE UI        (Designer engine + gallery rounds + convergence gate — see below)
 → decide forks      (mined MCDA engine only at real architecture/stack forks → ADRs)
 → compile           (qualified architecture graph → dependency-ordered tasks)
 → emit              (atomic renderer → docs + architecture + build request)
 → handoff           (immutable digest-bound request → Build Loop)
 → reconcile         (validated implementation map → Groundwork convergence)
```

## Output artifact set (per design)

| File | Sourced from | Current contract |
|---|---|---|
| `spec.json` (canonical) | Validated typed `Spec` | v3 preserves starting point, provenance, observed repository layout and bootstrap facts, multi-surface topology, intended architecture, change lifecycle, UI constraints, integration ownership, and stable references; v1/v2 inputs migrate deterministically |
| `steering.md` (durable) | Provenance + UI preferences + voice + boundaries | Opens with the reading contract (tier · context · no-compression), then the governing sentence, pillars, and conflict rule; refreshed with confirmed visual evidence |
| `requirements.md` | Stages 1–2 (Need/Persona/JTBD, scope, non-goals, metrics) | Ranked pillars, governing sentence, two-clause conflict rule, and prime-directive acceptance test lead the doc; includes EARS criteria, the NFR forcing template, provenance, and requirement IDs |
| `design.md` | Stage 4 + resolved architecture | Components, contracts, relationships, and flows alongside hard constraints, performance budgets, and executable architectural invariants; separates AI-owned setup from unavoidable external actions and includes observability |
| `design-system.md` | Stage 3 (render.ts) | Per-screen cards, states, accessibility, responsive range, must-keep/avoid/evolve preferences, voice |
| `design-tokens.md` | Designer walk emission (`explore-ui`) | Color/type/space/motion token system; separate from `design-system.md` and embedded at handoff when present |
| `tasks.md` | Stage 5 | Build Loop plan with stable IDs, integration tasks, dependency order, DoD, requirement refs, per-phase runnable acceptance, and a terminal gate |
| `builder-handoff.md` | Complete rendered contract | Self-contained paste-ready near-production directive with selected visual evidence and exact external actions |
| `traceability.json` | Spec + compiled task graph | Generated Need→Feature→Screen→Task→Test, Integration→Task→Test, Pillar→Need→Feature→Task→Acceptance, architecture-component/contract/flow, cross-Spec dependency, and task-dependency links with coverage gaps |
| `architecture.json` | Resolved Spec graph | Qualified local and pinned dependency topology, components, contracts, relationships, flows, and cross-Spec provenance |
| `build-request.json` | Spec + final ordered task graph | Immutable `groundwork.build-request/v1` with accepted return versions and normalized Spec/task/request digests |
| `convergence.json` | Validated Build Loop implementation map | Groundwork-owned per-target delivery state; emitted only during reconciliation and never merged into intended truth |
| `artifact-manifest.json` | Atomic publisher | Generation ID and per-file hashes; written last as the artifact-set commit marker |

Optional Spec Kit and OpenSpec trees are explicit one-way projections outside
the canonical artifact root. They carry
`.groundwork-export-manifest.json` plus a dated `groundwork-source.json` stamp,
use a separate crash-safe directory transaction, and refuse to adopt or replace
unmanaged or modified output. The transaction binds exact prior and intended
manifest generations and retains the prior derived tree until canonical
publication commits, so failure rolls both roots back to the prior state. They
bind each source stamp to the canonical Spec digest. Canonical publication
verifies the installed generation before commit and quarantines concurrent
replacement bytes rather than deleting them. They never initialize either framework, depend on
its runtime, or become a source of intended truth.

Zod `Spec` v3 includes EARS criteria, observability, boundaries, voice,
starting-point provenance, UI preferences, responsive/accessibility constraints,
explicit integration ownership, platform surfaces, qualified architecture, and
`current` / `proposed` / `verified` change records. Build evidence never promotes
itself into current or proposed intent.

## Build exchange and convergence

Groundwork owns `spec.json`, `build-request.json`, and `convergence.json`. Build
Loop owns `build-loop.implementation-map/v1`. Each producer treats the other
side's artifact as immutable input.

The request binds the canonical Spec and final dependency-ordered tasks with
normalized SHA-256 digests. Build Loop may return repository-relative files,
symbols, commits, tests, runtime evidence, deviations, and manual outcomes.
Groundwork rejects unsupported return versions, run/digest mismatches, unknown
target or evidence IDs, unsafe paths, malformed timestamps, and claims of
verification without passing test or runtime evidence. Valid reconciliation
classifies each intended target as `unverified`, `implemented`, `verified`,
`diverged`, `blocked`, or `manual`; it never overwrites intended architecture.

**Self-resolving output.** The generated set does not merely enumerate what was
captured — it names what is missing. Optional fields `pillars`,
`governingSentence`, `acceptanceTest`, `phaseAcceptance`, `hardConstraints`,
`performanceBudget`, `architecturalInvariants`, `nfr`, `voiceProfile.examples`,
`specCodeSync`, and `readingContract` follow one rule: a field whose absence is a legitimate
**decision** renders `_None declared._`, while a field whose absence is an
**unanswered question** renders a `TAG:UNRESOLVED` prompt stating exactly what
to supply. Rules carry their executable check, phases carry their runnable
command, and the prime-directive acceptance test becomes the terminal gate on
the plan — so an under-specified Spec produces documents that ask for what they
lack rather than documents that look finished.

Two of those fields govern how the set is READ rather than what it contains.
`readingContract` renders the config header — the model tier the set was
written for, the context it is being read in, and the standing no-compression
rule — at the top of `steering.md` and again on both build-facing docs
(`tasks.md`, `builder-handoff.md`), authored or not. The conflict rule prints
directly under the pillar list in two clauses: rank settles a pillar-vs-pillar
argument, and the prime-directive acceptance test outranks the pillars when a
system honours all of them and still fails it.

## UI navigate/select/iterate mechanism (the #1 pain)

Gallery-round convergence, self-contained (Designer engine absorbed):
1. **Diverge** — generate enough static HTML mockups of the critical screen(s) to test the distinct design hypotheses in scope. The count follows the material trade-offs and explicit user request; it is never a quota. Seed from the applicable absorbed mode briefs: Atmospheric, Glass Workspace, Warm Craft, and Data Narrative.
2. **Pick + annotate** — sub-mockup granularity ("this nav, that density, not this color"). Launch as a local page (mockup-gallery-style surface).
3. **Score** — annotations → revealed-preference signals → Designer emits token-deltas. Math scores; AI narrates *why*.
4. **Converge** — regenerate 2 variants inside the narrowed token space.
5. **Gate** — trimmed style-calibrator confidence/info-gain gate (`conf≥0.80 AND infoGain<0.25`) decides stop vs another round. No fixed count, no infinite loop.
6. **Emit** — winning tokens → DESIGN.md.

## Verification posture
- `npm run test:release` is the deterministic fail-closed source, protocol,
  browser, and staged-package gate. A missing or skipped required layer fails.
- `BUILD_LOOP_ROOT=/path/to/pinned/build-loop npm run test:host-release` is the
  separate host gate for fresh,
  isolated Claude, Codex, and Build Loop installs. It does not run in ordinary
  CI.
- The supplied Build Loop worktree must be clean and match the version, commit,
  adapter digest, and distribution-test digest in `scripts/release-policy.json`.
  The current compatibility record pins Build Loop 0.39.0 at
  `a62a3571ad971df49e483dbbd7d00f158ec40deb`.
- A Groundwork-owned authenticated activation orchestrator must generate one
  fresh random challenge, resolve the installed registries, invoke Claude
  `/groundwork:run` and Codex `groundwork:groundwork`, capture host output and
  exit status, require each entrypoint to execute its installed resolver and
  produce the exact `--bootstrap` launch contract, then independently verify the
  macOS-primary/web-companion baseline and next unresolved decision through that
  contract.
- All three gates atomically merge stable-ID results for the same staged bytes
  into `.build-loop/release/release-evidence.v2.json`; `npm run release:verify`
  keeps publication blocked until deterministic, host, and activation are
  `passed`.
- ✅ **Detachability confirmed by code review (2026-07-07).** No target module imports Express/Drizzle/Better-Auth. `schema.ts` Zod block (lines ~347–813) is separate from the Drizzle tables — clean cut. `prompt-content.ts`, `spec-renderer.ts`, `agent-handoff.ts` = pure, copy verbatim. `intake-controller.ts` + `spec-linter.ts` = ~70–80% pure logic; only coupling is the `aiService.generateStructuredOutput(messages, schema, llmConfig)` singleton (called ~5× total). The Anthropic SDK + `ANTHROPIC_API_KEY` are quarantined in `server/services/ai.ts` alone — never in a target module.
- **Phase 0 real work (all else is copy-paste):** one LLM shim implementing `generateStructuredOutput`'s contract by delegating to the host agent (shared by intake + linter), plus port/stub `scrubSecretsDeep`. Port effort: **M**.
- Peer CLI-vs-plugin audit may refine the form factor; the architecture survives either surface.
