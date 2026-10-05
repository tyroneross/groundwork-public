import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  bindImplementationMap,
  validateBuildRequest,
  type ImplementationMapDraft,
} from "./build-exchange.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const CLI = path.join(ROOT, "engine", "src", "cli.ts");
const BUILT_CLI = path.join(ROOT, "engine", "dist", "cli.js");
const SAMPLE = path.join(ROOT, "engine", "fixtures", "sample-spec.json");

function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function runBuiltCli(args: string[]) {
  return spawnSync(process.execPath, [BUILT_CLI, ...args], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
  });
}

test("CLI publishes architecture and digest-bound build request in one committed generation", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "groundwork-build-packet-"));
  try {
    const result = runCli([SAMPLE, "--out", out, "--created-at", "2026-08-05T05:00:00Z"]);
    assert.equal(result.status, 0, result.stderr);
    const specPacket = JSON.parse(fs.readFileSync(path.join(out, "spec.json"), "utf8"));
    const request = JSON.parse(fs.readFileSync(path.join(out, "build-request.json"), "utf8"));
    const architecture = JSON.parse(fs.readFileSync(path.join(out, "architecture.json"), "utf8"));
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "artifact-manifest.json"), "utf8"));

    assert.equal(validateBuildRequest(request, specPacket).requestDigest, request.requestDigest);
    assert.equal(architecture.contract, "groundwork.architecture/v1");
    assert.equal(architecture.rootSpecId, specPacket.id);
    assert.equal(architecture.specDigest, request.specDigest);
    assert.ok(request.tasks.every((task: any, index: number) =>
      task.dependsOn.every((id: string) => request.tasks.findIndex((candidate: any) => candidate.id === id) < index)));
    assert.deepEqual(
      manifest.files.filter((entry: any) => ["architecture.json", "build-request.json"].includes(entry.name)).map((entry: any) => entry.name),
      ["architecture.json", "build-request.json"],
    );
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("owned-file checker distinguishes existing regular files from safe planned-new files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groundwork-owned-root-"));
  const specPath = path.join(root, "spec.json");
  fs.mkdirSync(path.join(root, "Sources"));
  fs.writeFileSync(path.join(root, "Sources", "Existing.swift"), "// existing\n");
  fs.writeFileSync(specPath, JSON.stringify({
    schemaVersion: 2, id: "owned", productName: "Owned", productDescription: "Owned",
    features: [{ id: "f", title: "F", ownedFiles: ["Sources/Existing.swift", "Sources/New.swift"] }],
    projectContext: { declaredNewFiles: [{ path: "Sources/New.swift", because: "New feature." }] },
  }));
  const result = runCli([specPath, "--check-owned-files", "--repo-root", root]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).checked, 2);
  fs.writeFileSync(path.join(root, "Sources", "New.swift"), "// collision\n");
  const collision = runCli([specPath, "--check-owned-files", "--repo-root", root]);
  assert.notEqual(collision.status, 0);
  assert.match(collision.stderr, /already exists/);
  fs.unlinkSync(path.join(root, "Sources", "New.swift"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "groundwork-owned-outside-"));
  fs.mkdirSync(path.join(root, "Linked"));
  fs.symlinkSync(outside, path.join(root, "Linked", "escape"), "dir");
  const unsafe = JSON.parse(fs.readFileSync(specPath, "utf8"));
  unsafe.features[0].ownedFiles = ["Linked/escape/New.swift"];
  unsafe.projectContext.declaredNewFiles[0].path = "Linked/escape/New.swift";
  fs.writeFileSync(specPath, JSON.stringify(unsafe));
  const escaped = runCli([specPath, "--check-owned-files", "--repo-root", root]);
  assert.notEqual(escaped.status, 0);
  assert.match(escaped.stderr, /symlink ancestor/);
});

test("Build Request publishes only safe ownedFiles ownership metadata", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "groundwork-owned-request-"));
  try {
    const spec = JSON.parse(fs.readFileSync(path.join(ROOT, "engine", "fixtures", "native-owned-files-spec.json"), "utf8"));
    const specPath = path.join(out, "spec.json");
    fs.writeFileSync(specPath, JSON.stringify(spec));
    const result = runCli([specPath, "--out", path.join(out, "packet"), "--created-at", "2026-08-05T05:00:00Z"]);
    assert.equal(result.status, 0, result.stderr);
    const request = JSON.parse(fs.readFileSync(path.join(out, "packet", "build-request.json"), "utf8"));
    const owned = request.tasks.filter((task: any) => task.ownedFiles);
    assert.equal(owned.length > 0, true);
    assert.equal(owned.every((task: any) => !("ownershipSource" in task) && !("plannedNewFiles" in task)), true);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("tracked built CLI publishes W6 artifacts and can reconcile Build Loop evidence", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "groundwork-built-packet-"));
  try {
    const generated = runBuiltCli([SAMPLE, "--out", out, "--created-at", "2026-08-05T05:00:00Z"]);
    assert.equal(generated.status, 0, generated.stderr);
    const request = JSON.parse(fs.readFileSync(path.join(out, "build-request.json"), "utf8"));
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, "architecture.json"), "utf8")).contract, "groundwork.architecture/v1");
    const target = request.tasks.find((task: any) => task.id !== "task-scaffold") ?? request.tasks[0];
    const draft: ImplementationMapDraft = {
      contract: "build-loop.implementation-map/v1",
      producer: { name: "build-loop", version: "0.36.9", commit: "abcdef1" },
      mappings: [{
        id: "mapping-built-cli",
        kind: "task",
        targetId: target.id,
        status: "verified",
        fileRefs: ["src/built-cli.ts"],
        symbolRefs: ["builtCli"],
        commitRefs: ["abcdef1"],
        testEvidenceIds: ["evidence-built-cli"],
        runtimeEvidenceIds: [],
        deviationIds: [],
      }],
      evidence: [{
        id: "evidence-built-cli",
        kind: "test",
        command: "npm test -- built-cli",
        outcome: "passed",
        summary: "The installed runtime path exercised W6.",
        recordedAt: "2026-08-05T05:01:00Z",
      }],
      deviations: [],
      createdAt: "2026-08-05T05:02:00Z",
    };
    const mapPath = path.join(out, "implementation-map.json");
    fs.writeFileSync(mapPath, JSON.stringify(bindImplementationMap(request, draft), null, 2) + "\n");
    const reconciled = runBuiltCli(["--reconcile", mapPath, "--out", out, "--created-at", "2026-08-05T05:03:00Z"]);
    assert.equal(reconciled.status, 0, reconciled.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, "convergence.json"), "utf8")).contract, "groundwork.convergence/v1");
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("reconcile validates Build Loop evidence and atomically adds Groundwork-owned convergence without mutating inputs", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "groundwork-reconcile-"));
  try {
    const generated = runCli([SAMPLE, "--out", out, "--created-at", "2026-08-05T05:00:00Z"]);
    assert.equal(generated.status, 0, generated.stderr);
    const request = JSON.parse(fs.readFileSync(path.join(out, "build-request.json"), "utf8"));
    const target = request.tasks.find((task: any) => task.id !== "task-scaffold") ?? request.tasks[0];
    const evidenceId = "evidence-reconcile-test";
    const draft: ImplementationMapDraft = {
      contract: "build-loop.implementation-map/v1",
      producer: { name: "build-loop", version: "0.36.9", commit: "abcdef1" },
      mappings: [{
        id: "mapping-reconcile",
        kind: "task",
        targetId: target.id,
        status: "verified",
        fileRefs: ["src/reconciled.ts"],
        symbolRefs: ["reconciled"],
        commitRefs: ["abcdef1"],
        testEvidenceIds: [evidenceId],
        runtimeEvidenceIds: [],
        deviationIds: [],
      }],
      evidence: [{
        id: evidenceId,
        kind: "test",
        command: "npm test -- reconcile",
        outcome: "passed",
        summary: "Matched request task passed.",
        recordedAt: "2026-08-05T05:01:00Z",
      }],
      deviations: [],
      createdAt: "2026-08-05T05:02:00Z",
    };
    const map = bindImplementationMap(request, draft);
    const mapPath = path.join(out, "implementation-map.json");
    const mapText = JSON.stringify(map, null, 2) + "\n";
    const specBefore = fs.readFileSync(path.join(out, "spec.json"), "utf8");
    const requestBefore = fs.readFileSync(path.join(out, "build-request.json"), "utf8");
    fs.writeFileSync(mapPath, mapText);

    const reconciled = runCli([
      "--reconcile", mapPath,
      "--out", out,
      "--created-at", "2026-08-05T05:03:00Z",
    ]);
    assert.equal(reconciled.status, 0, reconciled.stderr);
    const convergence = JSON.parse(fs.readFileSync(path.join(out, "convergence.json"), "utf8"));
    assert.equal(convergence.contract, "groundwork.convergence/v1");
    assert.equal(convergence.items.find((item: any) => item.targetId === target.id).status, "verified");
    assert.equal(fs.readFileSync(path.join(out, "spec.json"), "utf8"), specBefore);
    assert.equal(fs.readFileSync(path.join(out, "build-request.json"), "utf8"), requestBefore);
    assert.equal(fs.readFileSync(mapPath, "utf8"), mapText);
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "artifact-manifest.json"), "utf8"));
    assert.ok(manifest.files.some((entry: any) => entry.name === "convergence.json"));
    assert.ok(!manifest.files.some((entry: any) => entry.name === "implementation-map.json"), "Build Loop-owned map stays outside the Groundwork manifest");
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
