import test from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { calculateSpecDigest } from "./build-exchange.js";
import { compileTaskGraph, refsForTask, resolveSpecGraph } from "./graph.js";
import { deriveTasks } from "./handoff.js";
import { SpecSchema, type Spec } from "./spec.js";
import { buildTraceability } from "./traceability.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const CLI = path.join(ROOT, "engine", "src", "cli.ts");

function baseSpec(id: string, featureId = `feature-${id}`): Spec {
  return SpecSchema.parse({
    schemaVersion: 2,
    id,
    productName: id,
    productDescription: `${id} product`,
    platformTarget: "web",
    features: [{ id: featureId, title: featureId }],
  });
}

function dependency(id: string, specId: string, digest: string, revision = "generation-remote") {
  return {
    id,
    specId,
    location: { kind: "local" as const, path: "deps/spec.json" },
    schemaVersion: 3,
    revision,
    digest,
    relationship: "uses" as const,
    optional: false,
  };
}

function writeRemoteArtifact(root: string, packet: unknown, generationId = "generation-remote") {
  const deps = path.join(root, "deps");
  fs.mkdirSync(deps);
  const text = JSON.stringify(packet, null, 2) + "\n";
  fs.writeFileSync(path.join(deps, "spec.json"), text);
  fs.writeFileSync(path.join(deps, "artifact-manifest.json"), JSON.stringify({
    schema: "groundwork.artifacts/v1",
    generationId,
    files: [{
      name: "spec.json",
      sha256: crypto.createHash("sha256").update(text, "utf8").digest("hex"),
    }],
  }));
  return path.join(root, "spec.json");
}

function localAndRemoteSpec() {
  const remote = baseSpec("spec-remote", "feature-remote");
  remote.architecture.components = [{
    id: "component-remote", name: "Remote", kind: "service",
    featureIds: ["feature-remote"], owner: "remote", provenance: "observed",
  }];
  const remotePacket = SpecSchema.parse(remote);
  const local = baseSpec("spec-local", "feature-local");
  local.architecture.components = [{
    id: "component-local", name: "Local", kind: "ui",
    featureIds: ["feature-local"], owner: "local", provenance: "decided",
  }];
  local.architecture.specDependencies = [dependency("dependency-remote", remote.id, calculateSpecDigest(remotePacket))];
  local.architecture.contracts = [{
    id: "contract-remote-local",
    name: "Remote to local",
    provider: { specId: remote.id, kind: "component", id: "component-remote" },
    consumers: [{ specId: local.id, kind: "component", id: "component-local" }],
    ports: [{ id: "port-value", name: "value", type: "Value", direction: "output", required: true }],
    transport: "local file",
    failureModes: ["dependency unavailable"],
    securityNotes: ["no network fetch"],
    provenance: "decided",
  }];
  local.architecture.relationships = [{
    id: "relationship-remote-local",
    from: { specId: remote.id, kind: "component", id: "component-remote" },
    to: { specId: local.id, kind: "component", id: "component-local" },
    direction: "unidirectional",
    contractRef: { specId: local.id, kind: "contract", id: "contract-remote-local" },
    criticality: "hard",
    optional: false,
    rationale: "Local UI needs the pinned remote value.",
    provenance: "decided",
  }];
  return { local: SpecSchema.parse(local), remote: remotePacket };
}

test("hard architecture edges order local work after its pinned dependency task", () => {
  const { local } = localAndRemoteSpec();
  const tasks = compileTaskGraph(local, deriveTasks(local));
  const dependencyTask = tasks.find((task) => task.layer === "dependency")!;
  const contractTask = tasks.find((task) => task.layer === "contract")!;
  const componentTask = tasks.find((task) => task.id === "task-component-component-local")!;
  const featureTask = tasks.find((task) => task.id === "task-feature-feature-local")!;
  assert.ok(dependencyTask.n < featureTask.n);
  assert.ok(contractTask.n < featureTask.n);
  assert.ok(componentTask.deps.includes(dependencyTask.n));
  assert.ok(featureTask.deps.includes(componentTask.n));
  assert.ok(featureTask.deps.includes(contractTask.n));
  assert.match(contractTask.dod.join("\n"), /Transport: local file/);
  assert.match(contractTask.dod.join("\n"), /Failure behavior: dependency unavailable/);
  assert.match(contractTask.dod.join("\n"), /Security: no network fetch/);
  assert.deepEqual(compileTaskGraph(local, deriveTasks(local)), tasks, "ordering is deterministic");
});

test("a feature shared by both ends of a hard relationship does not create a synthetic task cycle", () => {
  const spec = baseSpec("spec-shared", "feature-shared");
  spec.architecture.components = [
    { id: "component-provider", name: "Provider", kind: "service", featureIds: ["feature-shared"], owner: "core" },
    { id: "component-consumer", name: "Consumer", kind: "ui", featureIds: ["feature-shared"], owner: "ui" },
  ];
  spec.architecture.relationships = [{
    id: "relationship-shared",
    from: { specId: spec.id, kind: "component", id: "component-provider" },
    to: { specId: spec.id, kind: "component", id: "component-consumer" },
    direction: "unidirectional",
    criticality: "hard",
    optional: false,
    rationale: "One feature spans an internal provider and UI consumer.",
  }];
  const parsed = SpecSchema.parse(spec);
  const tasks = compileTaskGraph(parsed, deriveTasks(parsed));
  assert.equal(tasks.filter((task) => task.layer === "feature").length, 1);
  assert.deepEqual(compileTaskGraph(parsed, deriveTasks(parsed)), tasks);
});

test("flow-only remote contract references remain in dependency tasks and traceability", () => {
  const remote = baseSpec("spec-flow-remote", "feature-flow-remote");
  remote.architecture.components = [
    { id: "component-flow-source", name: "Source", kind: "service", featureIds: ["feature-flow-remote"], owner: "remote" },
    { id: "component-flow-sink", name: "Sink", kind: "data", featureIds: [], owner: "remote" },
  ];
  remote.architecture.contracts = [{
    id: "contract-flow-remote",
    name: "Remote flow contract",
    provider: { specId: remote.id, kind: "component", id: "component-flow-source" },
    consumers: [{ specId: remote.id, kind: "component", id: "component-flow-sink" }],
    ports: [{ id: "port-flow", name: "flow", type: "FlowValue", direction: "output", required: true }],
    transport: "pinned file",
    failureModes: ["missing value"],
    securityNotes: ["offline only"],
  }];
  const remotePacket = SpecSchema.parse(remote);
  const local = baseSpec("spec-flow-local", "feature-flow-local");
  local.architecture.components = [{
    id: "component-flow-local", name: "Local", kind: "ui",
    featureIds: ["feature-flow-local"], owner: "local",
  }];
  local.architecture.specDependencies = [dependency("dependency-flow-remote", remote.id, calculateSpecDigest(remotePacket))];
  local.architecture.flows = [{
    id: "flow-remote-only",
    name: "Remote contract flow",
    trigger: "Pinned input is available",
    exchanges: [{
      id: "exchange-remote-only",
      order: 1,
      from: { specId: remote.id, kind: "component", id: "component-flow-source" },
      to: { specId: local.id, kind: "component", id: "component-flow-local" },
      contractRef: { specId: remote.id, kind: "contract", id: "contract-flow-remote" },
      inputRefs: [],
      outputRefs: [],
      stateRefs: [],
      failurePaths: ["Pinned dependency unavailable"],
    }],
  }];
  const parsed = SpecSchema.parse(local);
  const tasks = compileTaskGraph(parsed, deriveTasks(parsed));
  const dependencyTask = tasks.find((task) => task.layer === "dependency")!;
  assert.deepEqual(
    refsForTask(parsed, dependencyTask).contractRefs.map((ref) => `${ref.specId}:${ref.kind}:${ref.id}`),
    ["spec-flow-remote:contract:contract-flow-remote"],
  );
  assert.ok(buildTraceability(parsed, tasks).specDependencyToRefs["dependency-flow-remote"]
    .includes("spec-flow-remote:contract:contract-flow-remote"));

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "groundwork-flow-handoff-"));
  try {
    const source = writeRemoteArtifact(temp, remotePacket);
    fs.writeFileSync(source, JSON.stringify(parsed, null, 2));
    const out = path.join(temp, "out");
    const result = spawnSync(process.execPath, [
      "--import", "tsx", CLI, source,
      "--out", out,
      "--allow-spec-root", temp,
      "--created-at", "2026-08-05T05:00:00Z",
    ], { cwd: ROOT, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const handoff = fs.readFileSync(path.join(out, "builder-handoff.md"), "utf8");
    assert.match(handoff, /Resolved architecture graph/);
    assert.match(handoff, /contract-flow-remote/);
    assert.match(handoff, /missing value/);
    assert.match(handoff, /offline only/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("local dependency resolution verifies manifest revision, bytes, digest, and remote identities", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "groundwork-spec-graph-"));
  try {
    const { local, remote } = localAndRemoteSpec();
    const source = writeRemoteArtifact(temp, remote);
    fs.writeFileSync(source, JSON.stringify(local));
    const graph = resolveSpecGraph(local, { sourcePath: source, allowedRoots: [temp] });
    assert.deepEqual(graph.dependencies.map((entry) => entry.spec.id), ["spec-remote"]);
    assert.equal(graph.dependencies[0].digest, local.architecture.specDependencies[0].digest);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("CLI carries a resolved remote edge through architecture, task order, traceability, and the self-contained handoff", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "groundwork-spec-cli-"));
  try {
    const { local, remote } = localAndRemoteSpec();
    const source = writeRemoteArtifact(temp, remote);
    fs.writeFileSync(source, JSON.stringify(local, null, 2));
    const out = path.join(temp, "out");
    const result = spawnSync(process.execPath, [
      "--import", "tsx", CLI, source,
      "--out", out,
      "--allow-spec-root", temp,
      "--created-at", "2026-08-05T05:00:00Z",
    ], { cwd: ROOT, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const architecture = JSON.parse(fs.readFileSync(path.join(out, "architecture.json"), "utf8"));
    const request = JSON.parse(fs.readFileSync(path.join(out, "build-request.json"), "utf8"));
    const trace = JSON.parse(fs.readFileSync(path.join(out, "traceability.json"), "utf8"));
    const handoff = fs.readFileSync(path.join(out, "builder-handoff.md"), "utf8");
    assert.deepEqual(architecture.specs.map((entry: any) => entry.specId), ["spec-local", "spec-remote"]);
    const dependencyIndex = request.tasks.findIndex((task: any) => task.id === "task-spec-dependency-dependency-remote");
    const componentIndex = request.tasks.findIndex((task: any) => task.id === "task-component-component-local");
    const featureIndex = request.tasks.findIndex((task: any) => task.id === "task-feature-feature-local");
    assert.ok(dependencyIndex >= 0 && dependencyIndex < componentIndex && componentIndex < featureIndex);
    assert.ok(request.tasks[componentIndex].dependsOn.includes(request.tasks[dependencyIndex].id));
    assert.ok(request.tasks[featureIndex].dependsOn.includes(request.tasks[componentIndex].id));
    assert.deepEqual(trace.specDependencyToRefs["dependency-remote"], ["spec-remote:component:component-remote"]);
    assert.match(handoff, /relationship-remote-local/);
    assert.match(handoff, /task-spec-dependency-dependency-remote/);
    assert.match(handoff, /sha256:/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("dependency resolution rejects traversal, URI fetches, digest drift, missing refs, and symlinks", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "groundwork-spec-reject-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "groundwork-spec-outside-"));
  try {
    const { local, remote } = localAndRemoteSpec();
    const source = writeRemoteArtifact(temp, remote);
    fs.writeFileSync(source, JSON.stringify(local));

    const traversal = structuredClone(local);
    traversal.architecture.specDependencies[0].location = { kind: "local", path: "../outside/spec.json" };
    assert.throws(() => resolveSpecGraph(traversal, { sourcePath: source, allowedRoots: [temp] }), /traversal-free/);

    const uri = structuredClone(local);
    uri.architecture.specDependencies[0].location = { kind: "uri", uri: "https://example.com/spec.json" };
    assert.throws(() => resolveSpecGraph(uri, { sourcePath: source, allowedRoots: [temp] }), /offline/);

    const cyclicRoot = structuredClone(local);
    cyclicRoot.architecture.specDependencies[0].specId = local.id;
    assert.throws(() => resolveSpecGraph(cyclicRoot, { sourcePath: source, allowedRoots: [temp] }), /cyclically targets the root/);

    const digest = structuredClone(local);
    digest.architecture.specDependencies[0].digest = `sha256:${"f".repeat(64)}`;
    assert.throws(() => resolveSpecGraph(digest, { sourcePath: source, allowedRoots: [temp] }), /digest mismatch/);

    const missing = structuredClone(local);
    missing.architecture.relationships[0].from.id = "component-missing";
    assert.throws(() => resolveSpecGraph(missing, { sourcePath: source, allowedRoots: [temp] }), /unknown reference/);

    fs.writeFileSync(path.join(outside, "spec.json"), JSON.stringify(remote));
    fs.symlinkSync(outside, path.join(temp, "linked-outside"));
    const parentSymlink = structuredClone(local);
    parentSymlink.architecture.specDependencies[0].location = { kind: "local", path: "linked-outside/spec.json" };
    assert.throws(
      () => resolveSpecGraph(parentSymlink, { sourcePath: source, allowedRoots: [temp] }),
      /escapes the explicit allowed roots/,
    );

    const realSpec = path.join(temp, "deps", "spec.json");
    fs.renameSync(realSpec, path.join(temp, "deps", "real-spec.json"));
    fs.symlinkSync("real-spec.json", realSpec);
    assert.throws(() => resolveSpecGraph(local, { sourcePath: source, allowedRoots: [temp] }), /non-symlink/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
