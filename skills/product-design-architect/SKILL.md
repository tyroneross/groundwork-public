---
name: product-design-architect
description: Connect Groundwork interface and product decisions to functional application architecture. Use when adding or changing a screen, workflow, control, data display, integration, API, event, platform surface, or design-system behavior; when auditing UI-to-spec completeness; or before producing a build-ready handoff that must trace data, components, contracts, flows, tasks, and tests.
user-invocable: false
---

# Product Design Architect

Translate design intent into the minimum complete system contract without
inventing implementation facts.

## Trace each design decision

Trace baseline, direction, delta, rigidity, effects, write boundaries, and verification alongside the existing screen-to-architecture mapping.

1. Resolve the Groundwork root and read
   `../../references/product-design-operating-model.md` completely.
2. Read `../../references/application-architecture-library.md` completely.
3. Load the canonical `spec.json` and generated `traceability.json` when they
   exist. Inspect the target repository for existing architecture before
   proposing a delta.
4. For every affected screen and element, map:
   - user need, feature, flow, state, and action;
   - data input, data output, entity, ownership, retention, and sensitivity;
   - UI, service, data, integration, agent, library, or platform component;
   - provider/consumer contract, typed ports, transport, failures, and security;
   - ordered architecture flow or event path;
   - observability, implementation task, dependency, and acceptance test.
5. Reuse existing components and contracts when their semantics match. Add a
   new boundary only when behavior, ownership, scaling, security, or failure
   isolation requires it.
6. Mark architecture items `observed`, `decided`, `assumed`, or `derived`.
   Leave unsupported topology unresolved instead of presenting it as current.
7. Update the Spec and regenerate artifacts with the deterministic emitter.
8. Read `traceability.json.uiImpact` and resolve every build-blocking gap or
   carry it into the handoff as an explicit unresolved decision.

Groundwork owns intended architecture and pointer-grade data needs. Build Loop
owns implementation detail and returns evidence; never treat a local mapping as
proof that the application is deployed or live.
