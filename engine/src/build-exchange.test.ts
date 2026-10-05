import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BuildRequestSchema,
  BuildTaskSchema,
  ConvergenceSchema,
  ExchangeValidationError,
  ImplementationMapSchema,
  bindBuildRequest,
  bindImplementationMap,
  calculateBuildRequestDigest,
  calculateConvergence,
  calculateImplementationMapDigest,
  calculateTaskDigest,
  digestNormalizedJson,
  normalizeJson,
  validateBuildRequest,
  validateEvidencePath,
  validateImplementationMap,
  validateReturnVersions,
  type BuildRequest,
  type BuildRequestDraft,
  type ImplementationMap,
  type ImplementationMapDraft,
  type ImplementationMapping,
} from "./build-exchange.js";

test("Build Task ownedFiles rejects encoded traversal, NUL, and private paths", () => {
  const base = { id: "task-owned", title: "Owned", componentRefs: [], contractRefs: [], requirementIds: [], dependsOn: [], acceptanceCriterionIds: [] };
  for (const unsafe of ["Sources/%2e%2e/Secret.swift", "Sources/%00Secret.swift", "Sources/%73ecrets/key.swift", "Sources/.ssh/key"]) {
    assert.throws(() => BuildTaskSchema.parse({ ...base, ownedFiles: [unsafe] }), /non-private repository-relative/);
  }
  assert.deepEqual(BuildTaskSchema.parse({ ...base, ownedFiles: ["Sources/Plan.swift"] }).ownedFiles, ["Sources/Plan.swift"]);
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(HERE, "../../docs/contracts/fixtures");

function readFixture(name: string): any {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));
}

function canonicalSpec(): Record<string, unknown> {
  return { schemaVersion: 3, id: "spec-spectra", productName: "Spectra" };
}

function requestDraft(taskIds: string[] = ["task-guidance"]): BuildRequestDraft {
  const raw = readFixture("build-request.json");
  const tasks = taskIds.map((id, index) => ({
    ...raw.tasks[0],
    id,
    title: `Task ${index + 1}`,
    dependsOn: index === 0 ? [] : [taskIds[index - 1]],
    requirementIds: [`requirement-${id}`],
  }));
  const { specDigest: _specDigest, taskDigest: _taskDigest, requestDigest: _requestDigest, ...draft } = raw;
  return BuildRequestSchema.omit({ specDigest: true, taskDigest: true, requestDigest: true }).parse({
    ...draft,
    tasks,
  });
}

function validRequest(taskIds?: string[]): BuildRequest {
  return bindBuildRequest(requestDraft(taskIds), canonicalSpec());
}

function resealRequest(request: BuildRequest): BuildRequest {
  request.taskDigest = calculateTaskDigest(request.tasks);
  request.requestDigest = calculateBuildRequestDigest(request);
  return request;
}

function mapDraft(
  mappings?: ImplementationMapping[],
  evidence?: ImplementationMapDraft["evidence"],
  deviations?: ImplementationMapDraft["deviations"],
): ImplementationMapDraft {
  const raw = readFixture("implementation-map.json");
  const {
    runId: _runId,
    buildRequestDigest: _buildRequestDigest,
    specDigest: _specDigest,
    taskDigest: _taskDigest,
    implementationMapDigest: _implementationMapDigest,
    ...draft
  } = raw;
  return ImplementationMapSchema.omit({
    runId: true,
    buildRequestDigest: true,
    specDigest: true,
    taskDigest: true,
    implementationMapDigest: true,
  }).parse({
    ...draft,
    mappings: mappings ?? draft.mappings,
    evidence: evidence ?? draft.evidence,
    deviations: deviations ?? draft.deviations,
  });
}

function remap(
  request: BuildRequest,
  mutate: (draft: ImplementationMapDraft) => void,
): ImplementationMap {
  const draft = mapDraft();
  mutate(draft);
  const base = ImplementationMapSchema.parse({
    ...draft,
    runId: request.runId,
    buildRequestDigest: request.requestDigest,
    specDigest: request.specDigest,
    taskDigest: request.taskDigest,
    implementationMapDigest: `sha256:${"0".repeat(64)}`,
  });
  return ImplementationMapSchema.parse({
    ...base,
    implementationMapDigest: calculateImplementationMapDigest(base),
  });
}

test("all frozen exchange fixtures pass their strict structural schemas", () => {
  assert.equal(BuildRequestSchema.parse(readFixture("build-request.json")).contract, "groundwork.build-request/v1");
  assert.equal(ImplementationMapSchema.parse(readFixture("implementation-map.json")).contract, "build-loop.implementation-map/v1");
  assert.equal(ConvergenceSchema.parse(readFixture("convergence.json")).contract, "groundwork.convergence/v1");
});

test("normalization recursively sorts keys, preserves array order, and produces stable lowercase digests", () => {
  const left = { z: 1, a: { y: 2, b: 3 }, items: [{ d: 4, c: 5 }, "last"] };
  const right = { items: [{ c: 5, d: 4 }, "last"], a: { b: 3, y: 2 }, z: 1 };
  assert.equal(normalizeJson(left), '{"a":{"b":3,"y":2},"items":[{"c":5,"d":4},"last"],"z":1}');
  assert.equal(digestNormalizedJson(left), digestNormalizedJson(right));
  assert.match(digestNormalizedJson(left), /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(digestNormalizedJson({ items: [1, 2] }), digestNormalizedJson({ items: [2, 1] }));
});

test("request binding validates canonical Spec, ordered tasks, self digest, and input immutability", () => {
  const draft = requestDraft();
  const before = structuredClone(draft);
  const request = bindBuildRequest(draft, canonicalSpec());

  assert.deepEqual(draft, before);
  assert.equal(request.requestDigest, calculateBuildRequestDigest(request));
  assert.deepEqual(validateBuildRequest(request, canonicalSpec()), request);

  assert.throws(() => validateBuildRequest({ ...request, specDigest: `sha256:${"f".repeat(64)}` }, canonicalSpec()), /specDigest/);
  assert.throws(() => validateBuildRequest({ ...request, taskDigest: `sha256:${"e".repeat(64)}` }, canonicalSpec()), /taskDigest/);
  assert.throws(() => validateBuildRequest({ ...request, requestDigest: `sha256:${"d".repeat(64)}` }, canonicalSpec()), /requestDigest/);
});

test("Build Request target IDs are globally unique across mapping kinds", () => {
  const taskComponent = structuredClone(validRequest());
  taskComponent.architecture.components[0].id = taskComponent.tasks[0].id;
  taskComponent.tasks[0].componentRefs[0].id = taskComponent.tasks[0].id;
  assert.throws(
    () => validateBuildRequest(resealRequest(taskComponent), canonicalSpec()),
    /reused across task and component kinds/,
  );

  const taskContract = structuredClone(validRequest());
  taskContract.architecture.contracts.push({
    id: taskContract.tasks[0].id,
    name: "Editor guidance contract",
    provider: { specId: taskContract.specId, kind: "component", id: "component-editor" },
    consumers: [{ specId: taskContract.specId, kind: "component", id: "component-editor" }],
    ports: [{ id: "port-guidance", name: "Guidance", type: "Guidance", direction: "output", required: true }],
    transport: "in-process",
    failureModes: ["Guidance unavailable"],
    securityNotes: ["No sensitive data"],
  });
  assert.throws(
    () => validateBuildRequest(resealRequest(taskContract), canonicalSpec()),
    /reused across task and contract kinds/,
  );

  const taskRequirement = structuredClone(validRequest());
  taskRequirement.tasks[0].requirementIds = [taskRequirement.tasks[0].id];
  assert.throws(
    () => validateBuildRequest(resealRequest(taskRequirement), canonicalSpec()),
    /reused across task and requirement kinds/,
  );

  const componentContract = structuredClone(validRequest());
  componentContract.architecture.contracts.push({
    id: componentContract.architecture.components[0].id,
    name: "Colliding contract",
    provider: { specId: componentContract.specId, kind: "component", id: "component-editor" },
    consumers: [{ specId: componentContract.specId, kind: "component", id: "component-editor" }],
    ports: [{ id: "port-collision", name: "Collision", type: "Collision", direction: "output", required: true }],
    transport: "in-process",
    failureModes: ["Collision"],
    securityNotes: ["No sensitive data"],
  });
  assert.throws(
    () => validateBuildRequest(resealRequest(componentContract), canonicalSpec()),
    /reused across component and contract kinds/,
  );
});

test("Build Request dependencies must precede their dependent task", () => {
  const forwardDependency = structuredClone(validRequest(["task-first", "task-second"]));
  forwardDependency.tasks[0].dependsOn = ["task-second"];
  assert.throws(
    () => validateBuildRequest(resealRequest(forwardDependency), canonicalSpec()),
    /Task dependency task-second must precede task-first in the final ordered task list/,
  );
});

test("unsupported return versions reject before evidence is accepted", () => {
  const raw = readFixture("build-request.json");
  raw.returnVersions.implementationMap = ["build-loop.implementation-map/v2"];
  assert.throws(() => BuildRequestSchema.parse(raw));
  assert.throws(() => validateReturnVersions({
    implementationMap: ["build-loop.implementation-map/v2"],
    convergence: ["groundwork.convergence/v1"],
  }));

  const map = readFixture("implementation-map.json");
  map.contract = "build-loop.implementation-map/v2";
  assert.throws(() => ImplementationMapSchema.parse(map));
});

test("a matched Build Loop return reaches verified only with passing test evidence", () => {
  const request = validRequest();
  const requestBefore = structuredClone(request);
  const draft = mapDraft();
  const draftBefore = structuredClone(draft);
  const implementationMap = bindImplementationMap(request, draft);
  const mapBefore = structuredClone(implementationMap);
  const convergence = calculateConvergence(request, implementationMap, {
    groundworkVersion: "0.3.0",
    calculatedAt: "2026-08-05T00:12:00Z",
  });

  assert.equal(convergence.items.find((item) => item.kind === "task")?.status, "verified");
  assert.equal(convergence.summary.verified, 1);
  assert.deepEqual(request, requestBefore);
  assert.deepEqual(draft, draftBefore);
  assert.deepEqual(implementationMap, mapBefore);
});

test("mapped code without passing verification remains implemented", () => {
  const request = validRequest();
  const mapping = {
    ...mapDraft().mappings[0],
    status: "implemented" as const,
    testEvidenceIds: [],
    runtimeEvidenceIds: [],
  };
  const implementationMap = bindImplementationMap(request, mapDraft([mapping], []));
  const convergence = calculateConvergence(request, implementationMap, {
    groundworkVersion: "0.3.0",
    calculatedAt: "2026-08-05T00:12:00Z",
  });
  assert.equal(convergence.items.find((item) => item.kind === "task")?.status, "implemented");
});

test("not-started mappings reject code, evidence, and deviations", () => {
  const request = validRequest();

  const withCode = mapDraft();
  withCode.mappings[0].status = "not-started";
  withCode.mappings[0].testEvidenceIds = [];
  withCode.evidence = [];
  assert.throws(() => bindImplementationMap(request, withCode), /not-started must not include/);

  const withEvidence = mapDraft();
  withEvidence.mappings[0].status = "not-started";
  withEvidence.mappings[0].fileRefs = [];
  withEvidence.mappings[0].symbolRefs = [];
  withEvidence.mappings[0].commitRefs = [];
  assert.throws(() => bindImplementationMap(request, withEvidence), /not-started must not include/);

  const withDeviation = mapDraft();
  withDeviation.mappings[0].status = "not-started";
  withDeviation.mappings[0].fileRefs = [];
  withDeviation.mappings[0].symbolRefs = [];
  withDeviation.mappings[0].commitRefs = [];
  withDeviation.mappings[0].testEvidenceIds = [];
  withDeviation.mappings[0].deviationIds = ["deviation-guidance"];
  withDeviation.evidence = [];
  withDeviation.deviations = [{
    id: "deviation-guidance",
    targetId: "task-guidance",
    summary: "The implementation has not started.",
    impact: "none",
  }];
  assert.throws(() => bindImplementationMap(request, withDeviation), /not-started must not include/);
});

test("clean not-started mappings remain unverified", () => {
  const request = validRequest();
  const draft = mapDraft();
  draft.mappings[0].status = "not-started";
  draft.mappings[0].fileRefs = [];
  draft.mappings[0].symbolRefs = [];
  draft.mappings[0].commitRefs = [];
  draft.mappings[0].testEvidenceIds = [];
  draft.evidence = [];
  const implementationMap = bindImplementationMap(request, draft);
  const convergence = calculateConvergence(request, implementationMap, {
    groundworkVersion: "0.1.0",
    calculatedAt: "2026-08-05T00:12:00.000Z",
  });
  assert.equal(convergence.items.find((item) => item.kind === "task")?.status, "unverified");
});

test("implemented mappings reject passing verification evidence", () => {
  const request = validRequest();
  const draft = mapDraft();
  draft.mappings[0].status = "implemented";
  assert.throws(
    () => bindImplementationMap(request, draft),
    /implemented must not include passing test or runtime evidence; use verified/,
  );
});

test("verified mappings reject fabricated or non-passing verification evidence", () => {
  const request = validRequest();
  const draft = mapDraft();
  draft.evidence[0].outcome = "failed";
  assert.throws(() => bindImplementationMap(request, draft), /verified requires passing test or runtime evidence/);

  const inspectionDraft = mapDraft();
  inspectionDraft.evidence[0].kind = "inspection";
  assert.throws(() => bindImplementationMap(request, inspectionDraft), /not test evidence/);
});

test("stale, wrong-run, and wrong-digest implementation maps reject", () => {
  const request = validRequest();
  for (const [field, value, pattern] of [
    ["runId", "run-other", /runId/],
    ["buildRequestDigest", `sha256:${"a".repeat(64)}`, /buildRequestDigest/],
    ["specDigest", `sha256:${"b".repeat(64)}`, /specDigest/],
    ["taskDigest", `sha256:${"c".repeat(64)}`, /taskDigest/],
  ] as const) {
    const map = remap(request, () => undefined);
    const modified = { ...map, [field]: value } as ImplementationMap;
    modified.implementationMapDigest = calculateImplementationMapDigest(modified);
    assert.throws(() => validateImplementationMap(request, modified), pattern);
  }

  const stale = remap(request, (draft) => { draft.createdAt = "2026-08-04T23:59:00Z"; });
  assert.throws(() => validateImplementationMap(request, stale), /predates/);
});

test("unknown targets, duplicate mappings/evidence, and unknown evidence references reject", () => {
  const request = validRequest();
  const unknownTarget = mapDraft();
  unknownTarget.mappings[0].targetId = "task-unknown";
  assert.throws(() => bindImplementationMap(request, unknownTarget), /Unknown task target/);

  const duplicate = mapDraft();
  duplicate.mappings.push(structuredClone(duplicate.mappings[0]));
  duplicate.evidence.push(structuredClone(duplicate.evidence[0]));
  assert.throws(() => bindImplementationMap(request, duplicate), /Duplicate ID/);

  const unknownEvidence = mapDraft();
  unknownEvidence.mappings[0].testEvidenceIds = ["evidence-missing"];
  assert.throws(() => bindImplementationMap(request, unknownEvidence), /Unknown evidence/);
});

test("evidence paths reject absolute, traversal, private, URI, and credential-bearing values", () => {
  for (const value of [
    "/Users/private/project/src/file.ts",
    "../outside.ts",
    "src/../../outside.ts",
    "src%5c..%5coutside.ts",
    "C:\\Users\\private\\file.ts",
    ".env",
    ".env.local",
    ".git/config",
    "https://example.com/file.ts",
  ]) {
    assert.throws(() => validateEvidencePath(value), ExchangeValidationError, value);
  }
  assert.equal(validateEvidencePath("src/EditorGuidance.tsx"), "src/EditorGuidance.tsx");

  const request = validRequest();
  const credentialUrl = mapDraft();
  credentialUrl.evidence[0].command = "curl https://user:secret@example.com/result";
  assert.throws(() => bindImplementationMap(request, credentialUrl), /Credential-bearing URLs/);

  const credentialQuery = mapDraft();
  credentialQuery.evidence[0].command = "curl https://example.com/result?access_token=secret";
  assert.throws(() => bindImplementationMap(request, credentialQuery), /Credential-bearing URLs/);

  const privatePath = mapDraft();
  privatePath.evidence[0].summary = "Captured at /Users/private/workspace/test-results.json";
  assert.throws(() => bindImplementationMap(request, privatePath), /Absolute private paths/);
});

test("only Build Loop-owned implementation maps validate", () => {
  const raw = readFixture("implementation-map.json");
  raw.producer.name = "groundwork";
  assert.throws(() => ImplementationMapSchema.parse(raw));
});

test("Build Request validation requires manual value names and rejects secret-shaped action content", () => {
  const packet = validRequest();
  const missingName: any = structuredClone(packet);
  missingName.manualActions = [{
    id: "manual-provider",
    location: "Provider dashboard",
    action: "Create the application.",
    destination: "Deployment settings",
    verification: "Complete a test connection.",
  }];
  missingName.requestDigest = calculateBuildRequestDigest(missingName);
  assert.throws(() => validateBuildRequest(missingName, canonicalSpec()));

  const unsafe: any = structuredClone(packet);
  unsafe.manualActions = [{
    id: "manual-provider",
    location: "Provider dashboard",
    action: "Create the application.",
    requiredValueName: "sk_live_1234567890abcdefghijkl",
    destination: "Deployment settings",
    verification: "Complete a test connection.",
  }];
  unsafe.requestDigest = calculateBuildRequestDigest(unsafe);
  assert.throws(() => validateBuildRequest(unsafe, canonicalSpec()), /must not contain actual secrets/);
});

test("declared deviations converge to diverged while blocked and manual remain explicit", () => {
  const request = validRequest(["task-diverged", "task-blocked", "task-manual"]);
  const base = mapDraft().mappings[0];
  const mappings: ImplementationMapping[] = [
    { ...base, id: "mapping-diverged", targetId: "task-diverged", status: "diverged", deviationIds: ["deviation-diverged"], testEvidenceIds: [], fileRefs: ["src/diverged.ts"] },
    { ...base, id: "mapping-blocked", targetId: "task-blocked", status: "blocked", testEvidenceIds: [], fileRefs: [] },
    { ...base, id: "mapping-manual", targetId: "task-manual", status: "manual", testEvidenceIds: [], fileRefs: [] },
  ];
  const implementationMap = bindImplementationMap(request, mapDraft(mappings, [], [{
    id: "deviation-diverged",
    targetId: "task-diverged",
    summary: "The repository requires a different adapter boundary.",
    impact: "medium",
  }]));
  const convergence = calculateConvergence(request, implementationMap, {
    groundworkVersion: "0.3.0",
    calculatedAt: "2026-08-05T00:12:00Z",
  });
  const statuses = Object.fromEntries(convergence.items
    .filter((item) => item.kind === "task")
    .map((item) => [item.targetId, item.status]));
  assert.deepEqual(statuses, {
    "task-blocked": "blocked",
    "task-diverged": "diverged",
    "task-manual": "manual",
  });
});
