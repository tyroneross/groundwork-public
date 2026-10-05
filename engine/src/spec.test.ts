// ───────────────────────────────────────────────────────────────────────
// Groundwork — SpecSchema wave-1 delta tests (element data I/O, pointer-grade
// entity layer, design-intent depth switch).
//
// Run: npx tsx --test engine/src/spec.test.ts
// (also wired into `npm test` via scripts/check.sh)
// ───────────────────────────────────────────────────────────────────────

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { SpecSchema } from "./spec.js";
import { renderDocs } from "./render.js";
import { renderBuilderHandoff } from "./handoff.js";
import { calculateBuildRequestDigest, calculateSpecDigest } from "./build-exchange.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(HERE, "..", "fixtures", "sample-spec.json");
const V3_FIXTURE_PATH = path.join(
  HERE,
  "..",
  "..",
  "docs",
  "contracts",
  "fixtures",
  "spectra-spec-v3-extension.json",
);

function minimalSpec(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    id: "spec-min",
    productName: "MinimalApp",
    productDescription: "A minimal spec used for schema testing.",
    ...overrides,
  };
}

test("old sample-spec.json fixture (no new fields) still validates unchanged", () => {
  const raw = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  assert.equal(("dataModel" in raw), false, "fixture predates dataModel — sanity check on the fixture itself");
  assert.equal(("designIntent" in raw), false, "fixture predates designIntent — sanity check on the fixture itself");

  const parsed = SpecSchema.parse(raw);
  assert.equal(parsed.schemaVersion, 3);
  assert.deepEqual(parsed.dataModel, [], "dataModel defaults to an empty array");
  assert.equal(parsed.designIntent, "unspecified", "designIntent defaults to unspecified");
  // Spot-check a couple of untouched fields to confirm nothing else drifted.
  assert.equal(parsed.productName, "StrideStreak");
  assert.equal(parsed.screens[0].elements?.[0].name, "Current streak counter");
  assert.equal(parsed.screens[0].elements?.[0].id, "element-screen-today-current-streak-counter");
  assert.equal(parsed.screens[0].elements?.[0].dataIn, undefined);
  assert.equal(parsed.platformSurfaces.length, 1);
  assert.equal(parsed.platformSurfaces[0].platform, "ios");
  assert.deepEqual(parsed.architecture, {
    components: [], contracts: [], relationships: [], flows: [], specDependencies: [],
  });
});

test("designIntent defaults to 'unspecified' on a bare minimal spec", () => {
  const parsed = SpecSchema.parse(minimalSpec());
  assert.equal(parsed.designIntent, "unspecified");
});

test("explicit ownership is additive and declared-new files must be owned", () => {
  const parsed = SpecSchema.parse(minimalSpec({
    features: [{ id: "f", title: "F", ownedFiles: ["Sources/F.swift"] }],
    projectContext: { declaredNewFiles: [{ path: "Sources/F.swift", because: "New native feature boundary." }] },
  }));
  assert.deepEqual(parsed.features[0].ownedFiles, ["Sources/F.swift"]);
  assert.equal(parsed.projectContext.declaredNewFiles?.[0].path, "Sources/F.swift");
  assert.equal(SpecSchema.parse(minimalSpec()).projectContext.declaredNewFiles, undefined);
});

test("explicit ownership rejects unsafe, duplicate, and orphan declared-new paths", () => {
  assert.throws(() => SpecSchema.parse(minimalSpec({ features: [{ id: "f", title: "F", ownedFiles: ["../escape.ts"] }] })), /repository-relative/);
  assert.throws(() => SpecSchema.parse(minimalSpec({ features: [{ id: "f", title: "F", ownedFiles: ["src/f.ts", "src/f.ts"] }] })), /Duplicate owned file/);
  assert.throws(() => SpecSchema.parse(minimalSpec({ projectContext: { declaredNewFiles: [{ path: "src/new.ts", because: "Needed." }] } })), /not owned by any entity/);
  for (const unsafe of ["Sources/%2e%2e/Secret.swift", "Sources/%00Secret.swift", "Sources/%73ecrets/key.swift", "Sources/.env.production"]) {
    assert.throws(() => SpecSchema.parse(minimalSpec({ features: [{ id: "f", title: "F", ownedFiles: [unsafe] }] })), /non-private repository-relative/);
    assert.throws(() => SpecSchema.parse(minimalSpec({ screens: [{ id: "s", name: "S", purpose: "S", featureIds: [], ownedFiles: [unsafe] }] })), /non-private repository-relative/);
  }
});

test("a spec using element dataIn/dataOut + a dataModel entity + designIntent validates", () => {
  const spec = minimalSpec({
    designIntent: "design-app",
    features: [
      { id: "feat-search", title: "Search", surface: "ui", needIds: [] },
    ],
    screens: [
      {
        id: "screen-search",
        name: "Search",
        purpose: "Find an item by name.",
        featureIds: ["feat-search"],
        elements: [
          {
            name: "Search box",
            role: "primary input",
            dataIn: { source: "user-entry", expectedType: "string", note: "free-text query" },
          },
          {
            name: "Results list",
            role: "primary view",
            dataOut: { shows: "matching items", expectedType: "Item[]", note: "from data-item entity" },
          },
        ],
      },
    ],
    dataModel: [
      {
        id: "entity-item",
        name: "Item",
        description: "A single searchable catalog item.",
        fields: [
          { name: "id", type: "string" },
          { name: "name", type: "string", note: "display name" },
        ],
        readByFeatureIds: ["feat-search"],
        writtenByFeatureIds: [],
        elementRefs: ["screen-search:Results list"],
      },
    ],
  });

  const parsed = SpecSchema.parse(spec);
  assert.equal(parsed.designIntent, "design-app");
  assert.equal(parsed.dataModel.length, 1);
  assert.equal(parsed.dataModel[0].id, "entity-item");
  assert.equal(parsed.dataModel[0].readByFeatureIds?.[0], "feat-search");
  assert.equal(parsed.screens[0].elements?.[0].dataIn?.source, "user-entry");
  assert.equal(parsed.screens[0].elements?.[1].dataOut?.shows, "matching items");
});

test("designIntent 'iterate-ui' still validates and keeps element notes optional (no stall)", () => {
  const spec = minimalSpec({
    designIntent: "iterate-ui",
    screens: [
      {
        id: "screen-home",
        name: "Home",
        purpose: "Landing screen.",
        elements: [
          { name: "Hero button", role: "primary action" },
        ],
      },
    ],
  });
  const parsed = SpecSchema.parse(spec);
  assert.equal(parsed.designIntent, "iterate-ui");
  // No dataIn/dataOut required — iterate-ui path must not stall on missing detail.
  assert.equal(parsed.screens[0].elements?.[0].dataIn, undefined);
});

test("dataModel entity referencing an unknown feature id is rejected", () => {
  const spec = minimalSpec({
    dataModel: [
      {
        id: "entity-orphan",
        name: "Orphan",
        readByFeatureIds: ["feat-does-not-exist"],
      },
    ],
  });
  assert.throws(() => SpecSchema.parse(spec), /Unknown feature reference/);
});

test("invalid dataIn.source enum value is rejected", () => {
  const spec = minimalSpec({
    screens: [
      {
        id: "screen-bad",
        name: "Bad",
        purpose: "invalid element",
        elements: [
          { name: "Weird control", dataIn: { source: "telepathy" } },
        ],
      },
    ],
  });
  assert.throws(() => SpecSchema.parse(spec));
});

// ───────────────────────────────────────────────────────────────────────
// projectContext.repoLayout (owned-file paths ignore the inspected repo)
// ───────────────────────────────────────────────────────────────────────

test("repoLayout is purely additive: a spec without it still validates with repoLayout undefined", () => {
  const parsed = SpecSchema.parse(minimalSpec());
  assert.equal(parsed.projectContext.repoLayout, undefined);
});

test("old sample-spec.json fixture predates repoLayout and still validates unchanged", () => {
  const raw = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  assert.equal("repoLayout" in (raw.projectContext ?? {}), false, "fixture predates repoLayout — sanity check");
  const parsed = SpecSchema.parse(raw);
  assert.equal(parsed.projectContext.repoLayout, undefined);
});

test("a spec with a full repoLayout validates and every field round-trips", () => {
  const spec = minimalSpec({
    projectContext: {
      startingPoint: "existing-app",
      sourceRepo: "/workspace/example-project",
      repoLayout: {
        dataModel: "prisma/schema.prisma",
        apiFilePattern: "app/api/{path}/route.ts",
        integrationsDir: "lib/integrations",
        featuresDir: "lib",
        screensDir: "components/v3",
        testsDir: "tests",
        testFileSuffix: ".test.ts",
      },
    },
  });
  const parsed = SpecSchema.parse(spec);
  assert.deepEqual(parsed.projectContext.repoLayout, {
    dataModel: "prisma/schema.prisma",
    apiFilePattern: "app/api/{path}/route.ts",
    integrationsDir: "lib/integrations",
    featuresDir: "lib",
    screensDir: "components/v3",
    testsDir: "tests",
    testFileSuffix: ".test.ts",
  });
});

test("a repoLayout with only one field set still validates (every field independently optional)", () => {
  const spec = minimalSpec({
    projectContext: { repoLayout: { apiFilePattern: "app/api/{path}/route.ts" } },
  });
  const parsed = SpecSchema.parse(spec);
  assert.equal(parsed.projectContext.repoLayout?.apiFilePattern, "app/api/{path}/route.ts");
  assert.equal(parsed.projectContext.repoLayout?.dataModel, undefined);
});

test("the frozen Spectra Spec v3 extension validates with full topology and architecture", () => {
  const raw = JSON.parse(fs.readFileSync(V3_FIXTURE_PATH, "utf8"));
  const parsed = SpecSchema.parse({
    productDescription: "A native campaign editor with a web review companion.",
    ...raw,
    screens: raw.screens.map((screen: Record<string, unknown>) => ({
      purpose: "Exercise the frozen Spec v3 extension contract.",
      ...screen,
    })),
  });

  assert.equal(parsed.schemaVersion, 3);
  assert.equal(parsed.platformTarget, "macos");
  assert.deepEqual(
    parsed.platformSurfaces.map((surface) => `${surface.platform}:${surface.role}`),
    ["macos:primary", "web:companion"],
  );
  assert.equal(parsed.architecture.contracts[0].id, "contract-review-publish");
  assert.equal(parsed.changeSet.proposed[0].target.id, "screen-editor");
});

test("v2 migration assigns deterministic globally unique element IDs", () => {
  const input = minimalSpec({
    screens: [
      {
        id: "screen-one",
        name: "One",
        purpose: "First screen.",
        elements: [{ name: "Save" }, { name: "Save" }],
      },
      {
        id: "screen-two",
        name: "Two",
        purpose: "Second screen.",
        elements: [{ name: "Save" }],
      },
    ],
  });

  const first = SpecSchema.parse(input);
  const second = SpecSchema.parse(input);
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.screens.flatMap((screen) => (screen.elements ?? []).map((element) => element.id)),
    [
      "element-screen-one-save",
      "element-screen-one-save-2",
      "element-screen-two-save",
    ],
  );
});

test("v2 migration preserves explicit element IDs and avoids them when deriving new IDs", () => {
  const parsed = SpecSchema.parse(minimalSpec({
    screens: [{
      id: "screen-one",
      name: "One",
      purpose: "First screen.",
      elements: [
        { id: "element-screen-one-save", name: "Existing save" },
        { name: "Save" },
      ],
    }],
  }));

  assert.deepEqual(
    parsed.screens[0].elements?.map((element) => element.id),
    ["element-screen-one-save", "element-screen-one-save-2"],
  );
});

test("v3 requires stable screen element IDs instead of silently migrating them", () => {
  const migrated = SpecSchema.parse(minimalSpec({
    screens: [{ id: "screen-one", name: "One", purpose: "First.", elements: [{ name: "Save" }] }],
  }));
  const invalidV3 = structuredClone(migrated) as any;
  delete invalidV3.screens[0].elements[0].id;

  assert.throws(() => SpecSchema.parse(invalidV3), /screens/);
});

test("platformTarget must match the primary v3 surface and companions remain intact", () => {
  const migrated = SpecSchema.parse(minimalSpec({ platformTarget: "macos" }));
  const invalid = structuredClone(migrated);
  invalid.platformTarget = "web";
  invalid.platformSurfaces.push({
    id: "surface-web-companion",
    platform: "web",
    role: "companion",
    name: "Web companion",
    interactionModes: ["pointer"],
    featureIds: [],
    provenance: "observed",
  });

  assert.throws(() => SpecSchema.parse(invalid), /must match primary platform macos/);
  assert.equal(migrated.platformSurfaces[0].platform, "macos");
});

test("Spec integration rejects architecture and change-set references outside the canonical graph", () => {
  const migrated = SpecSchema.parse(minimalSpec());
  const invalidArchitecture = structuredClone(migrated);
  invalidArchitecture.architecture.components.push({
    id: "component-orphan",
    name: "Orphan",
    kind: "service",
    featureIds: ["feature-missing"],
    owner: "test",
  });
  assert.throws(() => SpecSchema.parse(invalidArchitecture), /Unknown local reference/);

  const invalidChange = structuredClone(migrated);
  invalidChange.changeSet.proposed.push({
    id: "change-orphan",
    target: { specId: migrated.id, kind: "component", id: "component-missing" },
    summary: "Change a component that does not exist.",
    provenance: "decided",
    evidenceRefs: [],
  });
  assert.throws(() => SpecSchema.parse(invalidChange), /Unknown change target/);
});

test("future Spec versions fail closed", () => {
  assert.throws(
    () => SpecSchema.parse({ ...minimalSpec(), schemaVersion: 4 }),
    /schemaVersion/,
  );
});

function reproducibleSpec() {
  return minimalSpec({
    screens: [{ id: "screen-plan", name: "Plan", purpose: "Plan work.", states: ["preview"], elements: [{ id: "element-save", name: "Save" }] }],
    behaviorContracts: [{
      id: "behavior-plan", name: "Daily plan", scope: { kind: "screen", refs: ["screen-plan"] }, trigger: "User reviews plan",
      states: [{ id: "state-preview", name: "Preview" }],
      actions: [{ id: "action-save", name: "Save", fromStateIds: ["state-preview"], toStateId: "state-preview", effects: [{ kind: "update", targetRef: "screen-plan" }], writes: [{ storeRef: "local-plan", entity: "Plan", fields: ["blocks"], mode: "update" }], prohibitedWrites: [{ storeRef: "calendar", entity: "Event", fields: [], mode: "create" }], feedback: { channel: "toast", timing: "immediate", message: "Saved locally." } }],
      transitions: [{ fromStateId: "state-preview", actionId: "action-save", toStateId: "state-preview" }],
    }],
    designContract: {
      baseline: { disposition: "declared", id: "baseline-plan", artifacts: [{ id: "artifact-contract", path: "reference/contract.json", type: "contract", digest: `sha256:${"a".repeat(64)}` }], precedence: [{ rank: 1, artifactId: "artifact-contract" }] },
      constraints: [{ id: "constraint-save", kind: "behavioral", scope: { kind: "screen", refs: ["screen-plan"] }, targetRef: "screen-plan", propertyPath: "save.writeBoundary", operator: "eq", value: "local-only", sourceArtifactId: "artifact-contract", verificationRefs: ["verify-save"] }],
      direction: { summary: "Keep local save separate from calendar export." },
      deltas: [{ id: "delta-plan", baselineId: "baseline-plan", targetRefs: ["screen-plan"], operation: "preserve", direction: "Keep behavior." }],
      verification: [{ id: "verify-save", kind: "assertion", targetRefs: ["screen-plan"], method: "unit", passCriteria: [] }],
    },
    adrs: [{ id: "adr-save", title: "Save boundary", context: "Planner", decision: "Save locally.", reversibility: "medium", rigidity: "locked", scope: { kind: "screen", refs: ["screen-plan"] }, constraintRefs: ["constraint-save"] }],
  });
}

function conformanceSpec() {
  const spec = reproducibleSpec() as any;
  spec.projectContext = {
    startingPoint: "existing-app",
    evidence: [{ id: "evidence-baseline", status: "observed", statement: "The baseline artifact was inspected.", sourceRefs: ["reference/contract.json"] }],
  };
  spec.acceptanceTest = {
    id: "acceptance-conformance",
    statement: "The current planner preserves local-only save behavior.",
    observable: "Saving the plan does not create a calendar event.",
    timeBox: "Within one test run.",
    steps: ["Run the local-save acceptance check."],
  };
  spec.designContract.intent = {
    type: "conformance",
    evidenceRefs: ["evidence-baseline"],
    acceptanceTestRef: "acceptance-conformance",
    verificationRefs: ["verify-save"],
  };
  spec.designContract.deltas = [];
  spec.designContract.verification[0].passCriteria = [{
    subjectRef: "screen-plan",
    propertyPath: "save.writeBoundary",
    operator: "eq",
    value: "local-only",
  }];
  return spec;
}

test("behavior and reproducible design contracts validate additively and reject a locked decision without a constraint", () => {
  const valid = reproducibleSpec();
  const parsed = SpecSchema.parse(valid);
  assert.equal(parsed.behaviorContracts?.[0]?.actions[0]?.name, "Save");
  assert.equal("intent" in parsed.designContract!, false, "legacy change contracts do not gain a defaulted intent field");
  const invalid = structuredClone(valid) as any;
  invalid.adrs[0].constraintRefs = [];
  assert.throws(() => SpecSchema.parse(invalid), /locked ADR requires/);
});

test("base change contract preserves canonical bytes and spec/request digests without implicit intent", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(HERE, "..", "fixtures", "sample-planner-reproducible-design-spec.json"), "utf8"));
  const parsed = SpecSchema.parse(raw);
  assert.equal("intent" in parsed.designContract!, false);
  assert.equal(JSON.stringify(parsed).length, 11340);
  const specDigest = calculateSpecDigest(parsed);
  assert.equal(specDigest, "sha256:31088733791d84c27e52bccfd18ee62a6188f442349736f7217d759cf4c68549");
  const request = {
    contract: "groundwork.build-request/v1",
    runId: "run-legacy-digest",
    specDigest,
    taskDigest: `sha256:${"0".repeat(64)}`,
    tasks: [],
    architecture: parsed.architecture,
    visualEvidence: {},
  };
  assert.equal(calculateBuildRequestDigest(request as any), "sha256:7e6c27d332a9d09dffe36fc0bf2319ecc98a459c9d66c4f7c9ae04a7619f4287");
});

test("legacy Spec parsing does not inject optional reproducibility fields", () => {
  const parsed = SpecSchema.parse(minimalSpec({
    adrs: [{ id: "adr-legacy", title: "Legacy", context: "Existing", decision: "Keep it.", reversibility: "high" }],
  }));
  assert.equal("behaviorContracts" in parsed, false);
  assert.equal("constraintRefs" in parsed.adrs[0]!, false);
  assert.equal("mustPreserve" in parsed.adrs[0]!, false);
  assert.equal("mayVary" in parsed.adrs[0]!, false);
});

test("reproducibility validation rejects cycles, domain mismatches, conflicts, and ambiguous artifact paths", () => {
  const cycle = reproducibleSpec() as any;
  cycle.adrs = [
    { id: "adr-a", title: "A", context: "A", decision: "A", reversibility: "high", rigidity: "superseded", supersededBy: "adr-b" },
    { id: "adr-b", title: "B", context: "B", decision: "B", reversibility: "high", rigidity: "superseded", supersededBy: "adr-a" },
  ];
  assert.throws(() => SpecSchema.parse(cycle), /supersession graph contains a cycle/);

  const mismatch = reproducibleSpec() as any;
  mismatch.adrs[0].scope = { kind: "element", refs: ["screen-plan"] };
  assert.throws(() => SpecSchema.parse(mismatch), /Unknown ADR scope element reference/);

  const conflict = reproducibleSpec() as any;
  conflict.designContract.constraints.push({ id: "constraint-save-remote", kind: "behavioral", scope: { kind: "screen", refs: ["screen-plan"] }, targetRef: "screen-plan", propertyPath: "save.writeBoundary", operator: "eq", value: "calendar", sourceArtifactId: "artifact-contract", verificationRefs: ["verify-save"] });
  conflict.adrs.push({ id: "adr-save-remote", title: "Remote", context: "Planner", decision: "Write calendar.", reversibility: "medium", rigidity: "locked", scope: { kind: "screen", refs: ["screen-plan"] }, constraintRefs: ["constraint-save-remote"] });
  assert.throws(() => SpecSchema.parse(conflict), /Locked constraints constraint-save and constraint-save-remote conflict/);

  const paths = reproducibleSpec() as any;
  paths.designContract.baseline.artifacts.push({ id: "artifact-overlap", path: "reference/contract.json/detail", type: "contract", digest: `sha256:${"b".repeat(64)}` });
  assert.throws(() => SpecSchema.parse(paths), /artifact path overlaps/);
  paths.designContract.baseline.artifacts[1].path = "reference/*.json";
  assert.throws(() => SpecSchema.parse(paths), /exact relative paths without globs/);
});

test("locked relational constraints are valid when scope matches and behavior references fail closed", () => {
  const relational = reproducibleSpec() as any;
  relational.designContract.constraints[0].kind = "relational";
  assert.doesNotThrow(() => SpecSchema.parse(relational));

  const dangling = reproducibleSpec() as any;
  dangling.behaviorContracts[0].preconditions = [{ subjectRef: "missing", propertyPath: "ready", operator: "eq", value: true }];
  assert.throws(() => SpecSchema.parse(dangling), /Unknown predicate subject reference: missing/);
  dangling.behaviorContracts[0].preconditions = [];
  dangling.behaviorContracts[0].verificationRefs = ["missing-verification"];
  assert.throws(() => SpecSchema.parse(dangling), /Unknown verification reference: missing-verification/);
});

test("decision lifecycle validates without a design contract", () => {
  const cycle = minimalSpec({ adrs: [
    { id: "adr-a", title: "A", context: "A", decision: "A", reversibility: "high", rigidity: "superseded", supersededBy: "adr-b" },
    { id: "adr-b", title: "B", context: "B", decision: "B", reversibility: "high", rigidity: "superseded", supersededBy: "adr-a" },
  ] });
  assert.throws(() => SpecSchema.parse(cycle), /supersession graph contains a cycle/);
  const locked = minimalSpec({ adrs: [{ id: "adr-locked", title: "Locked", context: "A", decision: "A", reversibility: "low", rigidity: "locked" }] });
  assert.throws(() => SpecSchema.parse(locked), /locked ADR requires a designContract/);
});

test("reproducibility rejects missing deltas, incompatible domains, and contains/excludes conflicts", () => {
  const missingDelta = reproducibleSpec() as any;
  missingDelta.designContract.deltas = [];
  assert.throws(() => SpecSchema.parse(missingDelta), /change design contract requires at least one linked delta/);

  const explicitChange = reproducibleSpec() as any;
  explicitChange.designContract.intent = { type: "change" };
  explicitChange.designContract.deltas = [];
  assert.throws(() => SpecSchema.parse(explicitChange), /Invalid literal value|Invalid input/);

  const notApplicable = reproducibleSpec() as any;
  notApplicable.designContract.baseline = { disposition: "not-applicable" };
  notApplicable.designContract.constraints = [];
  notApplicable.designContract.deltas = [];
  notApplicable.designContract.verification = [];
  notApplicable.adrs = [];
  assert.doesNotThrow(() => SpecSchema.parse(notApplicable));

  const incompatible = reproducibleSpec() as any;
  incompatible.designContract.constraints[0].kind = "architectural";
  assert.throws(() => SpecSchema.parse(incompatible), /architectural constraint is incompatible with screen scope/);

  const conflict = reproducibleSpec() as any;
  conflict.designContract.constraints[0].operator = "contains";
  conflict.designContract.constraints[0].value = "calendar";
  conflict.designContract.constraints.push({ ...conflict.designContract.constraints[0], id: "constraint-exclude", operator: "excludes" });
  conflict.adrs.push({ id: "adr-exclude", title: "Exclude", context: "Planner", decision: "Exclude calendar.", reversibility: "low", rigidity: "locked", scope: { kind: "screen", refs: ["screen-plan"] }, constraintRefs: ["constraint-exclude"] });
  assert.throws(() => SpecSchema.parse(conflict), /Locked constraints constraint-save and constraint-exclude conflict/);
});

test("conformance contracts require a pinned evidenced baseline and acceptance verification without deltas", () => {
  const valid = conformanceSpec();
  const parsed = SpecSchema.parse(valid);
  assert.equal(parsed.designContract?.intent?.type, "conformance");
  assert.deepEqual(parsed.designContract?.deltas, []);
  assert.match(renderDocs(parsed)["design.md"], /\*\*Contract intent:\*\* conformance/);
  assert.match(renderBuilderHandoff(parsed, { docs: {}, tasks: "", traceability: {} }), /Contract intent: conformance/);

  const withDelta = conformanceSpec();
  withDelta.designContract.deltas = (reproducibleSpec() as any).designContract.deltas;
  assert.throws(() => SpecSchema.parse(withDelta), /conformance design contract forbids proposed deltas/);

  const noPinnedBaseline = conformanceSpec();
  noPinnedBaseline.designContract.baseline = { disposition: "not-applicable" };
  assert.throws(() => SpecSchema.parse(noPinnedBaseline), /conformance design contract requires an observed or declared baseline/);

  const noConstraints = conformanceSpec();
  noConstraints.designContract.constraints = [];
  assert.throws(() => SpecSchema.parse(noConstraints), /requires evidence-backed constraints/);

  const noSource = conformanceSpec();
  delete noSource.designContract.constraints[0].sourceArtifactId;
  assert.throws(() => SpecSchema.parse(noSource), /Conformance constraints require sourceArtifactId and verificationRefs/);

  const noConstraintVerification = conformanceSpec();
  noConstraintVerification.designContract.constraints[0].verificationRefs = [];
  assert.throws(() => SpecSchema.parse(noConstraintVerification), /Conformance constraints require sourceArtifactId and verificationRefs/);

  const noVerification = conformanceSpec();
  noVerification.designContract.verification = [];
  assert.throws(() => SpecSchema.parse(noVerification), /requires verification with acceptance predicates/);

  const noTargets = conformanceSpec();
  noTargets.designContract.verification[0].targetRefs = [];
  assert.throws(() => SpecSchema.parse(noTargets), /requires targetRefs and acceptance predicates/);

  const noAcceptance = conformanceSpec();
  noAcceptance.designContract.verification[0].passCriteria = [];
  assert.throws(() => SpecSchema.parse(noAcceptance), /requires targetRefs and acceptance predicates/);

  const proposedChange = conformanceSpec();
  proposedChange.changeSet = {
    id: "changes-conformance",
    current: [],
    proposed: [{ id: "change-screen", target: { specId: "spec-min", kind: "screen", id: "screen-plan" }, summary: "Change the screen.", provenance: "decided", evidenceRefs: [] }],
    verified: [],
  };
  assert.throws(() => SpecSchema.parse(proposedChange), /requires an empty proposed change set/);

  const duplicateEvidence = conformanceSpec();
  duplicateEvidence.designContract.intent.evidenceRefs.push("evidence-baseline");
  assert.throws(() => SpecSchema.parse(duplicateEvidence), /evidenceRefs must be unique/);

  const assumedEvidence = conformanceSpec();
  assumedEvidence.projectContext.evidence[0].status = "assumed";
  assert.throws(() => SpecSchema.parse(assumedEvidence), /must be source-backed with status observed or decided/);

  const unbackedEvidence = conformanceSpec();
  unbackedEvidence.projectContext.evidence[0].sourceRefs = [];
  assert.throws(() => SpecSchema.parse(unbackedEvidence), /must be source-backed/);

  const wrongAcceptance = conformanceSpec();
  wrongAcceptance.designContract.intent.acceptanceTestRef = "acceptance-other";
  assert.throws(() => SpecSchema.parse(wrongAcceptance), /requires the canonical acceptanceTest/);

  const noAcceptanceSteps = conformanceSpec();
  noAcceptanceSteps.acceptanceTest.steps = [];
  assert.throws(() => SpecSchema.parse(noAcceptanceSteps), /at least one executable step/);

  const blankAcceptanceSteps = conformanceSpec();
  blankAcceptanceSteps.acceptanceTest.steps = ["  ", "\t"];
  assert.throws(() => SpecSchema.parse(blankAcceptanceSteps), /at least one executable step/);

  const danglingVerification = conformanceSpec();
  danglingVerification.designContract.intent.verificationRefs = ["verify-missing"];
  assert.throws(() => SpecSchema.parse(danglingVerification), /Unknown conformance verification reference/);

  const uncitedConstraintVerification = conformanceSpec();
  uncitedConstraintVerification.designContract.verification.push({ id: "verify-secondary", kind: "assertion", targetRefs: ["screen-plan"], method: "unit", passCriteria: [{ subjectRef: "screen-plan", propertyPath: "save.writeBoundary", operator: "eq", value: "local-only" }] });
  uncitedConstraintVerification.designContract.constraints[0].verificationRefs = ["verify-secondary"];
  assert.throws(() => SpecSchema.parse(uncitedConstraintVerification), /must cite a substantive intent verification/);

  const observedWithDecidedEvidence = conformanceSpec();
  observedWithDecidedEvidence.designContract.baseline.disposition = "observed";
  observedWithDecidedEvidence.projectContext.evidence[0].status = "decided";
  assert.throws(() => SpecSchema.parse(observedWithDecidedEvidence), /must be source-backed with status observed/);

  const duplicateArtifact = conformanceSpec();
  duplicateArtifact.designContract.baseline.artifacts.push({ ...duplicateArtifact.designContract.baseline.artifacts[0], path: "reference/conflicting.json" });
  assert.throws(() => SpecSchema.parse(duplicateArtifact), /Duplicate baseline artifact id: artifact-contract/);

  const duplicateEvidenceRecord = conformanceSpec();
  duplicateEvidenceRecord.projectContext.evidence.push({ ...duplicateEvidenceRecord.projectContext.evidence[0], status: "decided", statement: "Conflicting evidence." });
  assert.throws(() => SpecSchema.parse(duplicateEvidenceRecord), /Duplicate evidence id: evidence-baseline/);

  const duplicateVerification = conformanceSpec();
  duplicateVerification.designContract.verification.push({ ...duplicateVerification.designContract.verification[0], method: "conflicting" });
  assert.throws(() => SpecSchema.parse(duplicateVerification), /Duplicate verification id: verify-save/);

  const duplicateConstraint = conformanceSpec();
  duplicateConstraint.designContract.constraints.push({ ...duplicateConstraint.designContract.constraints[0], propertyPath: "save.conflictingBoundary" });
  assert.throws(() => SpecSchema.parse(duplicateConstraint), /Duplicate constraint id: constraint-save/);
});
