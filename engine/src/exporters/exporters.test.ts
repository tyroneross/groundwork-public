import test from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { completeSpec } from "../handoff-acceptance.test.js";
import { exportSpecKit, SPEC_KIT_SOURCE } from "./spec-kit.js";
import { exportOpenSpec, OPENSPEC_SOURCE } from "./openspec.js";
import { compileTaskGraph } from "../graph.js";
import { deriveTasks } from "../handoff.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function digestTree(files: Array<{ path: string; content: string }>) {
  return files.map((file) => ({
    path: file.path,
    sha256: crypto.createHash("sha256").update(file.content).digest("hex"),
  }));
}

for (const [format, build, source] of [
  ["spec-kit", exportSpecKit, SPEC_KIT_SOURCE],
  ["openspec", exportOpenSpec, OPENSPEC_SOURCE],
] as const) {
  test(`${format} export is pure, deterministic, source-stamped, and matches its golden tree`, () => {
    const spec = completeSpec();
    const before = JSON.stringify(spec);
    const first = build(spec);
    const second = build(spec);
    assert.deepEqual(first, second);
    assert.equal(JSON.stringify(spec), before, "exporter must not mutate the canonical Spec");
    assert.equal(first.source, source);
    assert.equal(source.retrievedDate, "2026-08-07");
    assert.match(source.repository, /^https:\/\/github\.com\//);
    assert.match(source.stableCommit, /^[a-f0-9]{40}$/);
    assert.match(source.mainCommit, /^[a-f0-9]{40}$/);
    assert.deepEqual(first.files.map((file) => file.path), [...first.files.map((file) => file.path)].sort());
    assert.equal(first.files.filter((file) => file.path.endsWith("groundwork-source.json")).length, 1);
    const golden = JSON.parse(fs.readFileSync(path.join(HERE, "__fixtures__", `${format}.golden.json`), "utf8"));
    assert.deepEqual(digestTree(first.files), golden);
  });
}

test("exports fail closed until governance and change semantics are populated", () => {
  const candidate = completeSpec();
  candidate.governance = { constraints: [], decisions: [], owners: [] };
  candidate.changeSet = { id: "change-empty", current: [], proposed: [], verified: [] };
  assert.throws(() => exportSpecKit(candidate), /populated governance/);
  assert.throws(() => exportOpenSpec(candidate), /populated governance/);

  candidate.governance = { constraints: ["Keep the boundary explicit."], decisions: [], owners: [] };
  assert.throws(() => exportSpecKit(candidate), /populated current, proposed, or verified change set/);
  assert.throws(() => exportOpenSpec(candidate), /populated current, proposed, or verified change set/);
});

test("Spec Kit validates its explicit feature number", () => {
  assert.throws(() => exportSpecKit(completeSpec(), { featureNumber: 0 }), /1 through 999/);
  assert.match(exportSpecKit(completeSpec(), { featureNumber: 12 }).files[0].path, /^specs\/012-/);
});

test("Spec Kit preserves dependency, flow, contract-port, security, and owned-file traces", () => {
  const spec = completeSpec();
  const exported = exportSpecKit(spec);
  const plan = exported.files.find((file) => file.path.endsWith("plan.md"))!.content;
  const tasks = exported.files.find((file) => file.path.endsWith("tasks.md"))!.content;
  for (const relationship of spec.architecture.relationships) assert.match(plan, new RegExp(relationship.id));
  for (const flow of spec.architecture.flows) assert.match(plan, new RegExp(flow.id));
  for (const contract of spec.architecture.contracts) {
    assert.match(plan, new RegExp(contract.id));
    assert.ok(plan.includes(`${contract.provider.specId}:${contract.provider.kind}:${contract.provider.id}`));
    for (const consumer of contract.consumers) assert.ok(plan.includes(`${consumer.specId}:${consumer.kind}:${consumer.id}`));
    for (const port of contract.ports) {
      assert.match(plan, new RegExp(port.id));
      assert.match(plan, new RegExp(port.required ? "required" : "optional"));
    }
    for (const note of contract.securityNotes) assert.ok(plan.includes(note));
  }
  for (const flow of spec.architecture.flows) {
    for (const exchange of flow.exchanges) {
      for (const reference of [exchange.from, exchange.to, exchange.contractRef, ...exchange.inputRefs, ...exchange.outputRefs]) {
        assert.ok(plan.includes(`${reference.specId}:${reference.kind}:${reference.id}`));
      }
    }
  }
  for (const task of compileTaskGraph(spec, deriveTasks(spec))) {
    for (const ownedFile of task.ownedFiles) assert.ok(tasks.includes(ownedFile), `${task.id} must retain ${ownedFile}`);
  }
});

test("OpenSpec uses normative requirements and never promotes verified evidence into intent", () => {
  const spec = completeSpec();
  const verifiedSummary = "Verified delivery must remain evidence only.";
  spec.changeSet.verified = [{
    id: "verified-evidence-only",
    target: spec.changeSet.proposed[0].target,
    summary: verifiedSummary,
    provenance: "derived",
    evidenceRefs: [],
  }];
  const exported = exportOpenSpec(spec);
  const markdown = exported.files.filter((file) => file.path.endsWith("spec.md")).map((file) => file.content).join("\n");
  assert.match(markdown, /The system SHALL/);
  assert.equal(markdown.includes(verifiedSummary), false);
  const proposal = exported.files.find((file) => file.path.endsWith("proposal.md"))!.content;
  assert.match(proposal, /### Modified Capabilities/);
  assert.match(proposal, /`pulse`/);
  const design = exported.files.find((file) => file.path.endsWith("design.md"))!.content;
  for (const relationship of spec.architecture.relationships) assert.match(design, new RegExp(relationship.id));
  for (const contract of spec.architecture.contracts) {
    for (const port of contract.ports) {
      assert.ok(design.includes(port.id));
      assert.ok(design.includes(port.required ? "required" : "optional"));
    }
    for (const note of contract.securityNotes) assert.ok(design.includes(note));
  }

  const verifiedOnly = completeSpec();
  verifiedOnly.changeSet.current = [];
  verifiedOnly.changeSet.proposed = [];
  assert.throws(() => exportOpenSpec(verifiedOnly), /verified delivery evidence cannot substitute for intent/);
});
