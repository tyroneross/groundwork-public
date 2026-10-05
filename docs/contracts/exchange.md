# Groundwork / Build Loop exchange

## Ownership

Groundwork writes `build-request.json`. Build Loop validates it and writes a new
`implementation-map.json`. Groundwork validates that return and writes a new
`convergence.json`. Files are immutable inputs at each boundary; a producer must
never update an artifact owned by the other producer.

## Normalization and digests

Normalization recursively sorts object keys, preserves array order, encodes
UTF-8 JSON without insignificant whitespace, and excludes no fields unless the
specific digest field names its projection. Digests are lowercase hexadecimal
SHA-256 with a `sha256:` prefix.

- `specDigest` binds the normalized canonical Spec.
- `taskDigest` binds the final ordered task list after graph derivation.
- `requestDigest` binds the normalized build request with `requestDigest`
  omitted.
- `implementationMapDigest` binds the normalized implementation map with its own
  digest omitted.

## Evidence policy

An implementation map reports only evidence Build Loop can substantiate:
repository-relative files, symbols, commit IDs, test commands/results, runtime
evidence, status, and deviations. It cannot claim product intent or convergence.
Groundwork independently derives convergence for each intended entity.

Evidence outside the target repository, absolute private paths, secrets, and
credential-bearing URLs are invalid. Manual outcomes are explicit and never
upgraded to `verified` without machine-checkable evidence.

## Version and freshness checks

The request declares accepted implementation-map and convergence versions. The
return must match an accepted version, the request/spec/task digests, and a
non-stale run identity. Groundwork rejects fabricated IDs, overstated status,
unknown trace IDs, duplicate evidence IDs, malformed timestamps, and declared
verification without passing evidence.

Convergence statuses are `unverified`, `implemented`, `verified`, `diverged`,
`blocked`, or `manual`. `implemented` requires mapped code evidence; `verified`
also requires passing test or runtime evidence. A declared deviation produces
`diverged` unless the intended entity is independently blocked or manual.
