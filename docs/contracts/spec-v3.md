# Spec v3 graph semantics

## Identity and provenance

All persisted entities have stable non-empty IDs. References use a qualified
object with `specId`, `kind`, and `id`; `kind` is one of `component`, `contract`,
`feature`, `screen`, `element`, `requirement`, `flow`, or `task`.

`provenance` distinguishes `observed`, `decided`, `assumed`, and `derived`
truth. Migration may derive deterministic IDs and compatibility projections,
but it must not label inferred architecture as observed.

## Platform topology

`platformSurfaces` describes the product, not the current preview filter. During
the compatibility period it has exactly one primary surface. Companion roles
survive a primary change. Features may appear on more than one surface.

The legacy `platformTarget` is derived from the primary surface. It remains a
single value so existing renderers continue to work while downstream consumers
migrate to the full topology.

## Architecture

- A component is a logical ownership boundary and links to the features it owns.
- A contract names one provider, one or more consumers, typed input/output ports,
  transport, failure modes, and security notes.
- A relationship connects qualified endpoints, declares direction and
  criticality, and may point to the governing contract.
- A flow contains ordered exchanges. Each exchange declares its source, target,
  contract, input/output references, and failure paths.
- A Spec dependency pins schema version, revision, digest, and relationship.

Hard dependency relationships participate in topological task ordering. A hard
cycle blocks generation and reports the full cycle. Event relationships may
cycle when they are not marked hard.

## Cross-Spec resolution

The resolver receives an explicit allowed-root set. Local paths must resolve
beneath one of those roots after symlinks are resolved. The pinned SHA-256 digest
must match before remote graph expansion. URI references are offline metadata by
default and remain unresolved without an explicitly approved resolver.

Resolved remote nodes retain their remote `specId` in architecture output,
traceability, task ordering, and handoff. Duplicate qualified identities block
resolution even when their payloads are identical.

## Change lifecycle

`changeSet.current` records the observed or previously accepted baseline.
`changeSet.proposed` records intended changes. `changeSet.verified` references
validated delivery evidence. Build evidence never merges back into either
`current` or `proposed` automatically.
