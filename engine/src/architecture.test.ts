import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ArchitectureSchema,
  validateArchitecture,
  type Architecture,
  type ArchitectureValidationContext,
  type QualifiedRef,
  type Relationship,
} from "./architecture.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPECTRA_FIXTURE = path.resolve(
  HERE,
  "../../docs/contracts/fixtures/spectra-spec-v3-extension.json",
);

function ref(specId: string, kind: QualifiedRef["kind"], id: string): QualifiedRef {
  return { specId, kind, id };
}

function context(localRefs: QualifiedRef[] = []): ArchitectureValidationContext {
  return { specId: "spec-spectra", localRefs };
}

function emptyArchitecture(
  overrides: Partial<Record<keyof Architecture, unknown>> = {},
): Architecture {
  return ArchitectureSchema.parse({
    components: [],
    contracts: [],
    relationships: [],
    flows: [],
    specDependencies: [],
    ...overrides,
  });
}

function component(id: string) {
  return {
    id,
    name: id,
    kind: "service" as const,
    featureIds: [],
    owner: "architecture-test",
  };
}

test("architecture preserves optional ownership, exchange effects, and write-boundary notes", () => {
  const parsed = ArchitectureSchema.parse({
    components: [{ ...component("component-a"), ownership: ["daily-plan"] }],
    contracts: [{ id: "contract-a", name: "A", provider: ref("spec-spectra", "component", "component-a"), consumers: [ref("spec-remote", "component", "component-b")], ports: [{ id: "port-a", name: "a", type: "A", direction: "output" }], transport: "local", failureModes: ["none"], securityNotes: ["local"], writeBoundaryNotes: ["calendar writes require confirmation"] }],
    relationships: [],
    flows: [{ id: "flow-a", name: "A", trigger: "user", exchanges: [{ id: "exchange-a", order: 1, from: ref("spec-spectra", "component", "component-a"), to: ref("spec-remote", "component", "component-b"), contractRef: ref("spec-remote", "contract", "contract-b"), inputRefs: [], outputRefs: [], failurePaths: ["none"], effects: ["save"], writes: ["daily-plan"] }] }],
    specDependencies: [{ id: "dependency-remote", specId: "spec-remote", location: { kind: "local", path: "../remote/spec.json" }, schemaVersion: 3, revision: "r1", digest: `sha256:${"b".repeat(64)}`, relationship: "uses" }],
  });
  assert.deepEqual(parsed.components[0]?.ownership, ["daily-plan"]);
  assert.deepEqual(parsed.flows[0]?.exchanges[0]?.writes, ["daily-plan"]);
});

test("component and contract explicit owned files are optional, safe, and duplicate-free", () => {
  const value = emptyArchitecture({
    components: [{ ...component("component-a"), ownedFiles: ["Sources/A.swift"] }],
    contracts: [{ id: "contract-a", name: "A", provider: ref("spec-spectra", "component", "component-a"), consumers: [ref("other", "component", "component-b")], ports: [{ id: "p", name: "P", type: "P", direction: "output" }], transport: "local", failureModes: ["none"], securityNotes: ["local"], ownedFiles: ["Sources/AProtocol.swift"] }],
  });
  const parsed = ArchitectureSchema.parse(value);
  assert.deepEqual(parsed.components[0]?.ownedFiles, ["Sources/A.swift"]);
  assert.deepEqual(parsed.contracts[0]?.ownedFiles, ["Sources/AProtocol.swift"]);
  assert.throws(() => emptyArchitecture({ components: [{ ...component("component-a"), ownedFiles: ["../A.swift"] }] }), /repository-relative/);
  for (const unsafe of ["Sources/%2e%2e/Secret.swift", "Sources/%00Secret.swift", "Sources/%73ecrets/key.swift", "Sources/id_ed25519"]) {
    assert.throws(() => emptyArchitecture({ components: [{ ...component("component-a"), ownedFiles: [unsafe] }] }), /non-private repository-relative/);
    assert.throws(() => emptyArchitecture({
      components: [component("component-a")],
      contracts: [{ id: "contract-a", name: "A", provider: ref("spec-spectra", "component", "component-a"), consumers: [ref("other", "component", "component-b")], ports: [{ id: "p", name: "P", type: "P", direction: "output" }], transport: "local", failureModes: ["none"], securityNotes: ["local"], ownedFiles: [unsafe] }],
    }), /non-private repository-relative/);
  }
});

function relationship(
  id: string,
  fromId: string,
  toId: string,
  criticality: Relationship["criticality"] = "hard",
  direction: Relationship["direction"] = "unidirectional",
): Relationship {
  return {
    id,
    from: ref("spec-spectra", "component", fromId),
    to: ref("spec-spectra", "component", toId),
    direction,
    criticality,
    optional: false,
    rationale: `${fromId} depends on ${toId}`,
  };
}

test("the frozen Spectra architecture round-trips without semantic issues", () => {
  const raw = JSON.parse(fs.readFileSync(SPECTRA_FIXTURE, "utf8")) as Record<string, any>;
  const architecture = ArchitectureSchema.parse(raw.architecture);
  const localRefs: QualifiedRef[] = [
    ...raw.features.map((feature: { id: string }) => ref(raw.id, "feature", feature.id)),
    ...raw.screens.flatMap((screen: { id: string; elements?: Array<{ id: string }> }) => [
      ref(raw.id, "screen", screen.id),
      ...(screen.elements ?? []).map((element) => ref(raw.id, "element", element.id)),
    ]),
  ];

  assert.deepEqual(validateArchitecture(architecture, context(localRefs)), []);
  assert.deepEqual(ArchitectureSchema.parse(architecture), architecture);
});

test("duplicate IDs and duplicate qualified identities reject deterministically", () => {
  const architecture = emptyArchitecture({
    components: [component("component-duplicate"), component("component-duplicate")],
  });
  const validationContext: ArchitectureValidationContext = {
    specId: "spec-spectra",
    localRefs: [ref("spec-spectra", "feature", "feature-shared")],
    resolvedRefs: [
      ref("spec-remote", "component", "component-shared"),
      ref("spec-remote", "component", "component-shared"),
    ],
  };

  const first = validateArchitecture(architecture, validationContext);
  const second = validateArchitecture(architecture, validationContext);

  assert.deepEqual(second, first);
  assert.ok(first.some((issue) => issue.code === "duplicate_id"
    && issue.path.join(".") === "components.1.id"));
  assert.ok(first.some((issue) => issue.code === "duplicate_qualified_identity"
    && issue.path.join(".") === "$resolvedRefs.1"));
});

test("dangling provider, consumer, contract, and exchange references report useful paths", () => {
  const architecture = ArchitectureSchema.parse({
    components: [component("component-present")],
    contracts: [
      {
        id: "contract-dangling",
        name: "Dangling contract",
        provider: ref("spec-spectra", "component", "component-provider-missing"),
        consumers: [ref("spec-spectra", "component", "component-consumer-missing")],
        ports: [{ id: "port-output", name: "output", type: "Payload", direction: "output" }],
        transport: "in-process",
        failureModes: ["unavailable"],
        securityNotes: ["validate input"],
      },
    ],
    relationships: [
      {
        id: "relationship-dangling",
        from: ref("spec-spectra", "component", "component-present"),
        to: ref("spec-spectra", "component", "component-target-missing"),
        direction: "unidirectional",
        contractRef: ref("spec-spectra", "contract", "contract-missing"),
        criticality: "soft",
        optional: false,
        rationale: "Test missing relationship targets.",
      },
    ],
    flows: [
      {
        id: "flow-dangling",
        name: "Dangling flow",
        trigger: "A test runs.",
        exchanges: [
          {
            id: "exchange-dangling",
            order: 1,
            from: ref("spec-spectra", "component", "component-present"),
            to: ref("spec-spectra", "component", "component-exchange-missing"),
            contractRef: ref("spec-spectra", "contract", "contract-exchange-missing"),
            inputRefs: [ref("spec-spectra", "element", "element-missing")],
            outputRefs: [],
            failurePaths: ["Stop the flow."],
          },
        ],
      },
    ],
    specDependencies: [],
  });

  const issues = validateArchitecture(architecture, context());
  const danglingPaths = issues
    .filter((issue) => issue.code === "dangling_local_reference")
    .map((issue) => issue.path.join("."));

  assert.deepEqual(danglingPaths, [
    "contracts.0.consumers.0",
    "contracts.0.provider",
    "flows.0.exchanges.0.contractRef",
    "flows.0.exchanges.0.inputRefs.0",
    "flows.0.exchanges.0.to",
    "relationships.0.contractRef",
    "relationships.0.to",
  ]);
});

test("provider, consumer, relationship, and flow reference kinds are enforced", () => {
  const architecture = ArchitectureSchema.parse({
    components: [component("component-present")],
    contracts: [
      {
        id: "contract-present",
        name: "Contract",
        provider: ref("spec-spectra", "screen", "screen-present"),
        consumers: [ref("spec-spectra", "feature", "feature-present")],
        ports: [{ id: "port-present", name: "payload", type: "Payload", direction: "output" }],
        transport: "in-process",
        failureModes: ["unavailable"],
        securityNotes: ["validate input"],
      },
    ],
    relationships: [
      {
        id: "relationship-kinds",
        from: ref("spec-spectra", "flow", "flow-present"),
        to: ref("spec-spectra", "component", "component-present"),
        direction: "event",
        contractRef: ref("spec-spectra", "feature", "feature-present"),
        criticality: "soft",
        optional: false,
        rationale: "Test kind validation.",
      },
    ],
    flows: [
      {
        id: "flow-present",
        name: "Flow",
        trigger: "A test runs.",
        exchanges: [
          {
            id: "exchange-kinds",
            order: 1,
            from: ref("spec-spectra", "screen", "screen-present"),
            to: ref("spec-spectra", "component", "component-present"),
            contractRef: ref("spec-spectra", "flow", "flow-present"),
            inputRefs: [],
            outputRefs: [],
            failurePaths: ["Stop the flow."],
          },
        ],
      },
    ],
    specDependencies: [],
  });
  const localRefs = [
    ref("spec-spectra", "screen", "screen-present"),
    ref("spec-spectra", "feature", "feature-present"),
  ];

  const issues = validateArchitecture(architecture, context(localRefs));
  assert.deepEqual(
    issues.filter((issue) => issue.code === "invalid_reference_kind")
      .map((issue) => issue.path.join(".")),
    [
      "contracts.0.consumers.0.kind",
      "contracts.0.provider.kind",
      "flows.0.exchanges.0.contractRef.kind",
      "flows.0.exchanges.0.from.kind",
      "relationships.0.contractRef.kind",
      "relationships.0.from.kind",
    ],
  );
});

test("missing required endpoints fail structural parsing", () => {
  assert.throws(() => ArchitectureSchema.parse({
    components: [],
    contracts: [{
      id: "contract-no-provider",
      name: "No provider",
      consumers: [],
      ports: [],
      transport: "none",
      failureModes: [],
      securityNotes: [],
    }],
    relationships: [],
    flows: [],
    specDependencies: [],
  }));
});

test("a hard component dependency cycle reports the complete qualified path", () => {
  const architecture = emptyArchitecture({
    components: [component("component-a"), component("component-b"), component("component-c")],
    relationships: [
      relationship("relationship-a-b", "component-a", "component-b"),
      relationship("relationship-b-c", "component-b", "component-c"),
      relationship("relationship-c-a", "component-c", "component-a"),
    ],
  });

  const cycle = validateArchitecture(architecture, context())
    .find((issue) => issue.code === "hard_dependency_cycle");

  assert.ok(cycle);
  assert.deepEqual(cycle.referencePath, [
    ref("spec-spectra", "component", "component-a"),
    ref("spec-spectra", "component", "component-b"),
    ref("spec-spectra", "component", "component-c"),
    ref("spec-spectra", "component", "component-a"),
  ]);
  assert.match(cycle.message, /component-a.*component-b.*component-c.*component-a/);
});

test("a non-hard event cycle remains valid", () => {
  const architecture = emptyArchitecture({
    components: [component("component-a"), component("component-b")],
    relationships: [
      relationship("event-a-b", "component-a", "component-b", "soft", "event"),
      relationship("event-b-a", "component-b", "component-a", "informational", "event"),
    ],
  });

  assert.deepEqual(validateArchitecture(architecture, context()), []);
});

test("remote references require a declared dependency but are not resolved here", () => {
  const remoteProvider = ref("spec-remote", "component", "component-remote");
  const base = {
    components: [component("component-local")],
    contracts: [{
      id: "contract-remote",
      name: "Remote contract",
      provider: remoteProvider,
      consumers: [ref("spec-spectra", "component", "component-local")],
      ports: [{ id: "port-remote", name: "payload", type: "Payload", direction: "output" as const }],
      transport: "HTTPS",
      failureModes: ["remote unavailable"],
      securityNotes: ["authenticate requests"],
    }],
    relationships: [],
    flows: [],
  };
  const withoutDependency = emptyArchitecture(base);
  const withDependency = emptyArchitecture({
    ...base,
    specDependencies: [{
      id: "dependency-remote",
      specId: "spec-remote",
      location: { kind: "local", path: "../remote/.designdoc/spec.json" },
      schemaVersion: 3,
      revision: "revision-1",
      digest: `sha256:${"a".repeat(64)}`,
      relationship: "uses",
    }],
  });

  assert.ok(validateArchitecture(withoutDependency, context())
    .some((issue) => issue.code === "undeclared_spec_dependency"));
  assert.deepEqual(validateArchitecture(withDependency, context()), []);
});
