# Groundwork capability contract

Groundwork defines a product and its interface before a builder implements it.
It combines host-agent reasoning with deterministic specification, design,
review, export, and reconciliation tools. Claude Code and Codex load the same
product contracts through their respective plugin entrypoints.

## Inputs and ownership

The user can start with an idea, an existing repository, a design document,
mockups, or an explicit set of preferences. The host agent inspects available
source evidence, preserves confirmed decisions, and identifies missing
information. The user chooses between designs and provides feedback; the host
agent authors the next design iteration.

`spec.json` is the canonical product record. Requirements, flows, screens,
states, architecture, implementation tasks, tests, and acceptance criteria
derive from that record. Generated project records belong in the target
project workspace. Groundwork's source repository contains synthetic examples.

## Design and review tools

- The Designer imports or elicits a visual system, records choices, derives
  token changes, and preserves imported document structure during promotion.
- The canvas serves an HTML design with section navigation, screen previews,
  and feedback controls. Its server appends feedback to a local journal and
  exposes status through the versioned canvas protocol.
- The host explicitly reads and acknowledges new feedback. The canvas server
  relays messages and files; it does not invoke a reasoning model.
- The compare board presents A and B beside each other and persists the user's
  ruling. Revise B and Neither require a note. Export translates answered
  decisions into the mockup selection contract.
- Process and data diagrams use Diagram Intelligence by default, with source
  evidence and directed edges. Readability requires rendered inspection.

The contracts live in `references/canvas-workspace.md`,
`designer/canvas/PROTOCOL.md`, `designer/decisions/README.md`,
`references/mockups.md`, and `references/process-diagrams.md`.

## Builder exchange

Groundwork emits an immutable `groundwork.build-request/v1` containing ordered
tasks, acceptance criteria, manual actions, and normalized specification and
task digests. The builder returns `build-loop.implementation-map/v1` delivery
evidence. Groundwork validates the return and writes
`groundwork.convergence/v1` without overwriting intended architecture.

Reconciliation rejects unsupported versions, run or digest mismatches, unknown
references, unsafe paths, malformed timestamps, and verification claims that
lack passing test or runtime evidence. Each intended target is classified as
unverified, implemented, verified, diverged, blocked, or manual.

`docs/contracts/exchange.md` defines the exchange. The schemas and synthetic
fixtures under `docs/contracts/` are the integration source of truth. OpenSpec
and Spec Kit exports are explicit derived views; they do not replace the
canonical specification or invoke upstream initialization commands.

## Verification and limits

`npm test` runs the deterministic source, TypeScript, Python, protocol,
reconstruction, and browser gates. Missing or skipped required layers fail.
Release staging rebuilds the engine and includes licensing and attribution.
It excludes local preference journals, captured dashboards, and private state.

Public CI runs the complete source gate, builds the plugin bundle, and issues
artifact provenance on trusted branch runs. Authenticated host activation is a
separate local check; source and browser tests alone do not prove installed
host behavior. The publication boundary and provenance limits are documented
in `PUBLICATION-ATTESTATION.md`.
