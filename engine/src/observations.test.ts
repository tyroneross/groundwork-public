import test from "node:test";
import assert from "node:assert/strict";
import {
  ObservationBatchSchema,
  applyObservationBatch,
  type Observation,
  type ObservationBatch,
  type ObservationField,
} from "./observations.js";

const ref = (kind: "survey" | "agent" = "survey") => kind === "survey"
  ? { kind, nodeId: "architecture-review" } as const
  : { kind, id: "requirements-host" } as const;

function observation(
  field: ObservationField,
  entityId: string,
  value: unknown,
  provenance: "observed" | "decided" | "assumed" = "decided",
): Observation {
  return {
    id: `obs-${entityId}`,
    target: { field, entityId },
    value,
    provenance,
    sourceRefs: [ref(provenance === "assumed" ? "agent" : "survey")],
    ...(provenance === "observed" ? { confidence: 0.95 } : {}),
  };
}

function candidate(id = "spec-spectra") {
  return {
    schemaVersion: 2,
    id,
    productName: "Spectra",
    productDescription: "Campaign studio with a companion review surface.",
    platformTarget: "web",
    features: [
      { id: "feature-editor", title: "Campaign editor" },
      { id: "feature-review", title: "Companion review" },
    ],
    screens: [{
      id: "screen-editor",
      name: "Editor",
      purpose: "Edit a campaign.",
      elements: [{ id: "element-publish", name: "Publish control" }],
    }],
  };
}

const componentEditor = {
  id: "component-editor",
  name: "Editor shell",
  kind: "ui",
  featureIds: ["feature-editor"],
  owner: "desktop",
};
const componentReview = {
  id: "component-review",
  name: "Review companion",
  kind: "ui",
  featureIds: ["feature-review"],
  owner: "web",
};
const contractReview = {
  id: "contract-review-publish",
  name: "Published campaign snapshot",
  provider: { specId: "spec-spectra", kind: "component", id: "component-editor" },
  consumers: [{ specId: "spec-spectra", kind: "component", id: "component-review" }],
  ports: [{ id: "port-campaign", name: "campaign", type: "CampaignSnapshot", direction: "output" }],
  transport: "versioned JSON over HTTPS",
  failureModes: ["snapshot unavailable"],
  securityNotes: ["require authenticated review access"],
};
const relationshipReview = {
  id: "relationship-editor-review",
  from: { specId: "spec-spectra", kind: "component", id: "component-editor" },
  to: { specId: "spec-spectra", kind: "component", id: "component-review" },
  contractRef: { specId: "spec-spectra", kind: "contract", id: "contract-review-publish" },
  direction: "unidirectional",
  criticality: "hard",
  optional: false,
  rationale: "Review consumes published editor snapshots.",
};
const flowReview = {
  id: "flow-publish-review",
  name: "Publish for review",
  trigger: "A creator publishes.",
  exchanges: [{
    id: "exchange-publish-review",
    order: 1,
    from: { specId: "spec-spectra", kind: "component", id: "component-editor" },
    to: { specId: "spec-spectra", kind: "component", id: "component-review" },
    contractRef: { specId: "spec-spectra", kind: "contract", id: "contract-review-publish" },
    inputRefs: [{ specId: "spec-spectra", kind: "element", id: "element-publish" }],
    outputRefs: [],
    failurePaths: ["Keep the last valid snapshot and show the error."],
  }],
};

test("an existing-app batch preserves observed Spectra topology and a decided proposed change", () => {
  const input = candidate();
  const before = structuredClone(input);
  const batch: ObservationBatch = {
    contract: "groundwork.observation-batch/v1",
    specId: "spec-spectra",
    observations: [
      observation("platformSurfaces", "surface-macos", {
        id: "surface-macos", platform: "macos", role: "primary", name: "Spectra Studio",
        interactionModes: ["pointer", "keyboard"], featureIds: ["feature-editor"],
      }, "observed"),
      observation("platformSurfaces", "surface-web", {
        id: "surface-web", platform: "web", role: "companion", name: "Spectra Review",
        interactionModes: ["pointer", "touch"], featureIds: ["feature-review"],
      }, "observed"),
      observation("architecture.components", "component-editor", componentEditor, "observed"),
      observation("architecture.components", "component-review", componentReview, "observed"),
      observation("architecture.contracts", "contract-review-publish", contractReview, "observed"),
      observation("architecture.relationships", "relationship-editor-review", relationshipReview, "observed"),
      observation("architecture.flows", "flow-publish-review", flowReview, "observed"),
      observation("governance.constraints", "constraint-primary", "Keep macOS primary and web companion.", "observed"),
      observation("changeSet.proposed", "change-guidance", {
        id: "change-guidance",
        target: { specId: "spec-spectra", kind: "screen", id: "screen-editor" },
        summary: "Add contextual first-run guidance.",
        evidenceRefs: [],
      }),
    ],
    unresolved: [
      { field: "architecture.specDependencies", reason: "No dependency was identified." },
    ],
  };

  const result = applyObservationBatch(input, batch);

  assert.deepEqual(input, before, "the candidate is not mutated");
  assert.equal(result.platformTarget, "macos");
  assert.deepEqual(result.platformSurfaces.map(({ platform, role, provenance }) => ({ platform, role, provenance })), [
    { platform: "macos", role: "primary", provenance: "observed" },
    { platform: "web", role: "companion", provenance: "observed" },
  ]);
  assert.equal(result.architecture.components[0].provenance, "observed");
  assert.equal(result.changeSet.proposed[0].provenance, "decided");
  assert.deepEqual(applyObservationBatch(input, batch), result, "reruns are deterministic");
});

test("a greenfield batch can write decided components, contracts, flows, and governance", () => {
  const batch: ObservationBatch = {
    contract: "groundwork.observation-batch/v1",
    specId: "spec-spectra",
    observations: [
      observation("platformSurfaces", "surface-web", {
        id: "surface-web", platform: "web", role: "primary", name: "Spectra Web",
        interactionModes: ["pointer", "touch"], featureIds: ["feature-editor", "feature-review"],
      }),
      observation("architecture.components", "component-editor", componentEditor),
      observation("architecture.components", "component-review", componentReview),
      observation("architecture.contracts", "contract-review-publish", contractReview),
      observation("architecture.relationships", "relationship-editor-review", relationshipReview),
      observation("architecture.flows", "flow-publish-review", flowReview),
      observation("governance.constraints", "constraint-auth", "Review access requires authentication."),
      observation("governance.owners", "owner-product", "product"),
    ],
    unresolved: [],
  };

  const result = applyObservationBatch(candidate(), batch);
  assert.equal(result.architecture.components.length, 2);
  assert.equal(result.architecture.contracts[0].provenance, "decided");
  assert.equal(result.architecture.flows[0].provenance, "decided");
  assert.deepEqual(result.governance.constraints, ["Review access requires authentication."]);
});

test("unresolved architecture remains empty instead of being fabricated", () => {
  const batch: ObservationBatch = {
    contract: "groundwork.observation-batch/v1",
    specId: "spec-empty",
    observations: [observation("platformSurfaces", "surface-web", {
      id: "surface-web", platform: "web", role: "primary", name: "Web",
      interactionModes: [], featureIds: [],
    })],
    unresolved: [
      { field: "architecture.components", reason: "No component boundary was supplied." },
      { field: "architecture.contracts", reason: "No contract was supplied." },
      { field: "architecture.relationships", reason: "No relationship was supplied." },
      { field: "architecture.flows", reason: "No flow was supplied." },
      { field: "architecture.specDependencies", reason: "No dependency was supplied." },
    ],
  };

  const result = applyObservationBatch(candidate("spec-empty"), batch);
  assert.deepEqual(result.architecture, {
    components: [], contracts: [], relationships: [], flows: [], specDependencies: [],
  });
});

test("missing contract failure modes and dangling references reject through Spec v3", () => {
  const badContract = {
    ...contractReview,
    failureModes: [],
  };
  const batch = {
    contract: "groundwork.observation-batch/v1",
    specId: "spec-spectra",
    observations: [
      observation("platformSurfaces", "surface-web", {
        id: "surface-web", platform: "web", role: "primary", name: "Web",
        interactionModes: [], featureIds: [],
      }),
      observation("architecture.contracts", "contract-review-publish", badContract),
    ],
    unresolved: [],
  };
  assert.throws(() => applyObservationBatch(candidate(), batch));

  const dangling = structuredClone(batch);
  dangling.observations = [
    observation("platformSurfaces", "surface-web", {
      id: "surface-web", platform: "web", role: "primary", name: "Web",
      interactionModes: [], featureIds: [],
    }),
    observation("architecture.components", "component-missing-feature", {
      id: "component-missing-feature", name: "Bad", kind: "ui",
      featureIds: ["feature-does-not-exist"], owner: "nobody",
    }),
  ];
  assert.throws(
    () => applyObservationBatch(candidate(), dangling),
    /Unknown feature reference|Unknown local reference/,
  );
});

test("batch validation rejects unsafe sources, duplicate targets, and mismatched entity IDs", () => {
  const first = observation("governance.constraints", "constraint-one", "One");
  assert.equal(ObservationBatchSchema.safeParse({
    contract: "groundwork.observation-batch/v1",
    specId: "spec-spectra",
    observations: [{ ...first, sourceRefs: [{ kind: "repo", path: "../secret" }] }],
    unresolved: [],
  }).success, false);
  assert.equal(ObservationBatchSchema.safeParse({
    contract: "groundwork.observation-batch/v1",
    specId: "spec-spectra",
    observations: [first, { ...first, id: "obs-other" }],
    unresolved: [],
  }).success, false);
  assert.equal(ObservationBatchSchema.safeParse({
    contract: "groundwork.observation-batch/v1",
    specId: "spec-spectra",
    observations: [first],
    unresolved: [{ field: "governance.constraints", reason: "Contradicts the recorded constraint." }],
  }).success, false);
  assert.throws(() => applyObservationBatch(candidate(), {
    contract: "groundwork.observation-batch/v1",
    specId: "spec-spectra",
    observations: [observation("architecture.components", "component-other", componentEditor)],
    unresolved: [],
  }), /targets component-other but its value has ID component-editor/);
});
