// ───────────────────────────────────────────────────────────────────────
// Groundwork — pointer-grade entity layer end-to-end trace test (a3 test
// gap: feature feat-pointer-entity-layer).
//
// spec.test.ts proves dataModel entities validate against SpecSchema.
// cli.ts's buildTraceability() (which derives entityToFeatures) is private
// to the built CLI and has no prior test proving a dataModel entity actually
// flows all the way through the emitted output. This test runs the real
// built engine/dist/cli.js against a spec with a dataModel entity and
// verifies:
//   1. traceability.json's entityToFeatures maps the entity to the features
//      that read/write it (the trace).
//   2. builder-handoff.md's "Data wire map" -> "Data model entities" section
//      surfaces the same entity with the same read/write features (the
//      emitted output a human/build-loop agent actually reads).
//
// Run: npx tsx --test engine/src/cli-entity-trace.test.ts
// (also wired into `npm test` via scripts/check.sh; requires a built
//  engine/dist/cli.js — `npm run build:engine`)
// ───────────────────────────────────────────────────────────────────────

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const CLI = path.join(ROOT, "engine", "dist", "cli.js");

test("dataModel entities flow into traceability.json (entityToFeatures) and builder-handoff.md", (t) => {
  if (!fs.existsSync(CLI)) {
    t.skip(`engine/dist/cli.js not built — run \`npm run build:engine\` first (looked at ${CLI})`);
    return;
  }

  const spec = {
    schemaVersion: 2,
    id: "spec-entity-trace-e2e",
    productName: "EntityTraceE2E",
    productDescription: "A minimal spec proving dataModel entities reach the emitted trace.",
    features: [
      { id: "feat-search", title: "Search catalog", surface: "ui", needIds: [] },
      { id: "feat-restock", title: "Restock catalog", surface: "api", needIds: [] },
    ],
    dataModel: [
      {
        id: "entity-item",
        name: "Item",
        description: "A single searchable catalog item.",
        fields: [{ name: "id", type: "string" }, { name: "name", type: "string" }],
        readByFeatureIds: ["feat-search"],
        writtenByFeatureIds: ["feat-restock"],
        elementRefs: ["screen-search:Results list"],
      },
    ],
  };

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "gw-entity-trace-"));
  const specPath = path.join(tmpBase, "spec.json");
  const outDir = path.join(tmpBase, "out");
  fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));

  execFileSync(process.execPath, [CLI, specPath, "--out", outDir], {
    cwd: ROOT,
    encoding: "utf8",
  });

  // 1. Trace: entity_id -> feature_ids that read or write it.
  const traceability = JSON.parse(fs.readFileSync(path.join(outDir, "traceability.json"), "utf8"));
  assert.deepEqual(
    [...traceability.entityToFeatures["entity-item"]].sort(),
    ["feat-restock", "feat-search"],
    "entityToFeatures must union read + written feature ids for the entity",
  );

  // 2. Emitted output: the human/build-loop-facing handoff doc carries the
  // same entity with the same read/write features (not just the machine
  // trace index).
  const handoff = fs.readFileSync(path.join(outDir, "builder-handoff.md"), "utf8");
  assert.match(handoff, /### Data model entities/);
  assert.match(handoff, /\*\*Item\*\* \(`entity-item`\) — A single searchable catalog item\./);
  assert.match(handoff, /Read by: Search catalog \(`feat-search`\)/);
  assert.match(handoff, /Written by: Restock catalog \(`feat-restock`\)/);

  fs.rmSync(tmpBase, { recursive: true, force: true });
});

test("CLI preserves typed behavior, decision, constraint, and delta trace maps", (t) => {
  if (!fs.existsSync(CLI)) {
    t.skip(`engine/dist/cli.js not built — run \`npm run build:engine\` first (looked at ${CLI})`);
    return;
  }
  const fixture = path.join(ROOT, "engine", "fixtures", "sample-planner-reproducible-design-spec.json");
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "gw-repro-trace-"));
  const outDir = path.join(tmpBase, "out");
  execFileSync(process.execPath, [CLI, fixture, "--out", outDir], { cwd: ROOT, encoding: "utf8" });
  const traceability = JSON.parse(fs.readFileSync(path.join(outDir, "traceability.json"), "utf8"));
  assert.deepEqual(traceability.behaviorToScopeRefs["behavior-planner"], ["screen-planner"]);
  assert.deepEqual(traceability.behaviorToActions["behavior-planner"], ["action-save"]);
  assert.deepEqual(traceability.behaviorToScreens["behavior-planner"], ["screen-planner"]);
  assert.deepEqual(traceability.behaviorToElements["behavior-planner"], []);
  assert.equal(traceability.behaviorToTasks["behavior-planner"].length > 0, true);
  assert.deepEqual(traceability.behaviorToTests["behavior-planner"], ["test-plan"]);
  assert.deepEqual(traceability.behaviorToScreens["behavior-save-control"], ["screen-planner"]);
  assert.deepEqual(traceability.behaviorToElements["behavior-save-control"], ["element-save"]);
  assert.equal(traceability.behaviorToTasks["behavior-save-control"].length > 0, true);
  assert.deepEqual(traceability.behaviorToTests["behavior-save-control"], ["test-plan"]);
  assert.deepEqual(traceability.decisionToConstraints["adr-save-boundary"], [
    "constraint-save-boundary",
  ]);
  assert.deepEqual(traceability.decisionToScreens["adr-save-boundary"], ["screen-planner"]);
  assert.deepEqual(traceability.decisionToElements["adr-action-style"], []);
  assert.deepEqual(traceability.decisionToScreens["adr-save-control-style"], ["screen-planner"]);
  assert.deepEqual(traceability.decisionToElements["adr-save-control-style"], ["element-save"]);
  assert.equal(traceability.decisionToTasks["adr-save-control-style"].length > 0, true);
  assert.deepEqual(traceability.decisionToTests["adr-save-control-style"], ["test-plan"]);
  assert.equal(traceability.decisionToTasks["adr-save-boundary"].length > 0, true);
  assert.deepEqual(traceability.decisionToTests["adr-save-boundary"], ["test-plan", "verify-save"]);
  assert.deepEqual(traceability.baselineToDeltas["baseline-sample-planner-day-v4"], ["delta-source-health"]);
  assert.deepEqual(traceability.constraintToVerifications["constraint-action-target"], ["verify-target"]);
  assert.deepEqual(traceability.deltaToTargets["delta-source-health"], ["screen-planner"]);
  const bundle = JSON.parse(fs.readFileSync(path.join(outDir, "baseline-artifacts.json"), "utf8"));
  const screenshot = bundle.artifacts.find((artifact: { id: string }) => artifact.id === "artifact-screenshot");
  assert.equal(crypto.createHash("sha256").update(Buffer.from(screenshot.bytes, "base64")).digest("hex"), "e5fab5274e79689fad8a84b6a6ec70d81dbaa6c84add63cc4adfe5d96b15f15c");
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

test("CLI resolves component-scoped behavior and decisions through the containing screen", (t) => {
  if (!fs.existsSync(CLI)) {
    t.skip(`engine/dist/cli.js not built — run \`npm run build:engine\` first (looked at ${CLI})`);
    return;
  }
  const source = JSON.parse(fs.readFileSync(path.join(ROOT, "engine", "fixtures", "sample-planner-reproducible-design-spec.json"), "utf8"));
  source.architecture.components = [{ id: "component-planner", name: "Planner UI", kind: "ui", featureIds: ["feature-plan"], owner: "Sample Planner" }];
  source.behaviorContracts.push({ id: "behavior-planner-component", name: "Planner component", scope: { kind: "component", refs: ["component-planner"] }, trigger: "review", states: [], actions: [], transitions: [], verificationRefs: [] });
  source.adrs.push({ id: "adr-planner-component", title: "Planner component", context: "Planner", decision: "Keep the component in the planner.", reversibility: "high", rigidity: "leaning", scope: { kind: "component", refs: ["component-planner"] } });
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "gw-component-trace-"));
  const specPath = path.join(tmpBase, "spec.json");
  const outDir = path.join(tmpBase, "out");
  fs.cpSync(path.join(ROOT, "engine", "fixtures", "sample-planner-baseline-v4"), path.join(tmpBase, "sample-planner-baseline-v4"), { recursive: true });
  fs.writeFileSync(specPath, JSON.stringify(source, null, 2));
  execFileSync(process.execPath, [CLI, specPath, "--out", outDir], { cwd: ROOT, encoding: "utf8" });
  const traceability = JSON.parse(fs.readFileSync(path.join(outDir, "traceability.json"), "utf8"));
  assert.deepEqual(traceability.behaviorToComponents["behavior-planner-component"], ["component-planner"]);
  assert.deepEqual(traceability.behaviorToScreens["behavior-planner-component"], ["screen-planner"]);
  assert.deepEqual(traceability.behaviorToTests["behavior-planner-component"], ["test-plan"]);
  assert.equal(traceability.behaviorToTasks["behavior-planner-component"].length > 0, true);
  assert.deepEqual(traceability.decisionToComponents["adr-planner-component"], ["component-planner"]);
  assert.deepEqual(traceability.decisionToScreens["adr-planner-component"], ["screen-planner"]);
  assert.deepEqual(traceability.decisionToTests["adr-planner-component"], ["test-plan"]);
  assert.equal(traceability.decisionToTasks["adr-planner-component"].length > 0, true);
  fs.rmSync(tmpBase, { recursive: true, force: true });
});
