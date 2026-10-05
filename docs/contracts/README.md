# Groundwork contract freeze

Status: frozen for the Spec v3 / Build Loop interoperability implementation.

These documents define the interfaces that W2-W8 implement. A consumer may add
fields, but it must not rename, reinterpret, or remove a frozen field without a
new contract version.

## Contracts

| Contract | Owner | Purpose |
|---|---|---|
| `groundwork.visual-bootstrap/v1` | Groundwork | Carries validated existing-app context into Designer without flattening a multi-surface product. |
| Spec v3 extensions | Groundwork | Adds platform topology, stable element IDs, architecture, governance, and explicit change semantics to the canonical Spec. |
| `groundwork.build-request/v1` | Groundwork | Publishes intended work and its normalized digests to a builder. |
| `build-loop.implementation-map/v1` | Build Loop | Returns implementation evidence without mutating intended product truth. |
| `groundwork.convergence/v1` | Groundwork | Reconciles validated implementation evidence against the intended graph. |

The JSON Schemas are Draft 2020-12. Example documents under `fixtures/` are
normative compatibility fixtures and must remain valid as implementation lands.

Validators consuming ownership fields must register the custom
`groundwork-owned-file` format. The format percent-decodes with strict UTF-8,
then rejects traversal, NUL, empty segments, backslashes, and private or
credential-bearing path segments. Treating unknown formats as annotations is
not sufficient; `engine/src/owned-files.test.ts` proves the required behavior.

## Frozen rules

1. `platformSurfaces` contains exactly one `primary` surface during the
   compatibility period. `platformTarget` equals that surface's `platform`.
2. A primary-surface change preserves companion/admin/extension/service
   surfaces. The legacy `platform-multi` choice represents equal peers only.
3. Every v3 screen element has a stable `id`. v2 migration persists
   deterministic IDs and does not invent architecture.
4. Architecture references are qualified by `(specId, kind, id)`. A bare ID is
   never sufficient across Specs.
5. Local Spec dependencies resolve only under explicitly allowed roots, with
   symlink/traversal rejection and pinned digest verification. URI dependencies
   are metadata-only unless a separately approved network resolver is supplied.
6. Missing targets, unsupported schemas, digest mismatches, duplicate qualified
   identities, and hard dependency cycles block graph and task generation with
   the complete reference path.
7. Groundwork owns desired truth, build requests, and convergence. Build Loop
   owns implementation maps. Neither side overwrites the other side's artifact.
8. All digests use lowercase SHA-256 over the contract-defined normalized JSON
   representation. Timestamps are RFC 3339 UTC strings.
9. Build-request target IDs are globally unique across task, component,
   contract, and requirement kinds, and every task dependency precedes its
   dependent in the final ordered task list. Implementation-map statuses are
   fail-closed: `not-started` carries no code, verification evidence, or
   deviations; `implemented` carries code without passing verification; and
   `verified` carries code plus passing test or runtime evidence.

## Compatibility lifecycle

- v1/v2 input is migrated minimally to v3. Unknown architecture remains absent
  or explicitly `assumed`; it is never presented as observed fact.
- v3 is the canonical writer format. Legacy `platformTarget` and current trace
  maps remain derived compatibility projections for one release.
- Request/return version negotiation is fail-closed. Unsupported versions and
  digest mismatches reject before evidence is used.

See `spec-v3.md` for graph semantics and `exchange.md` for ownership,
normalization, and convergence rules.
