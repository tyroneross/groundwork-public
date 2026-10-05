// ───────────────────────────────────────────────────────────────────────
// Groundwork — anti-dead-UI handoff wire-map tests (a3 test gap: feature
// feat-io-annotation-ui / handoff).
//
// Proves builder-handoff.md's "Data wire map" section:
//   1. lists each interactive ScreenElement with its resolved data wire
//      (dataIn.source [+ expectedType] -> dataOut), and
//   2. flags DEAD-CONTROL RISK for an interactive element (button / nav /
//      search / link / field-like role) that has neither dataIn nor dataOut
//      resolved — the exact defect class this section exists to catch.
//
// Pure: renderBuilderHandoff() takes no I/O, so this needs no server/CLI.
//
// Run: npx tsx --test engine/src/handoff.test.ts
// (also wired into `npm test` via scripts/check.sh)
// ───────────────────────────────────────────────────────────────────────

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SpecSchema, type Spec } from "./spec.js";
import { renderBuilderHandoff, renderTasks, deriveTasks } from "./handoff.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(HERE, "..", "fixtures", "sample-spec.json");

function minimalSpec(overrides: Record<string, unknown> = {}): Spec {
  return SpecSchema.parse({
    schemaVersion: 2,
    id: "spec-handoff-wiremap",
    productName: "WireMapTestApp",
    productDescription: "A spec used to test the anti-dead-UI wire-map.",
    ...overrides,
  });
}

function handoffFor(spec: Spec): string {
  return renderBuilderHandoff(spec, {
    docs: {},
    tasks: "",
    traceability: {},
  });
}

test("explicit feature and screen ownership wins and planned-new provenance renders", () => {
  const spec = minimalSpec({
    platformTarget: "ios",
    features: [{ id: "f", title: "Plan", surface: "ui", needIds: [], ownedFiles: ["Sample Planner/PlanFeature.swift"] }],
    screens: [{ id: "s", name: "Plan", purpose: "Plan", featureIds: ["f"], ownedFiles: ["Sample Planner/PlanView.swift"] }],
    projectContext: { declaredNewFiles: [{ path: "Sample Planner/PlanView.swift", because: "New planner screen." }] },
  });
  const tasks = deriveTasks(spec);
  const feature = tasks.find((task) => task.id === "task-feature-f")!;
  const screen = tasks.find((task) => task.id === "task-screen-s")!;
  assert.deepEqual(feature.ownedFiles, ["Sample Planner/PlanFeature.swift"]);
  assert.equal(feature.ownershipSource, "explicit");
  assert.deepEqual(screen.plannedNewFiles, ["Sample Planner/PlanView.swift"]);
  assert.match(renderTasks(spec, tasks), /Sample Planner\/PlanView\.swift` — planned new/);
});

test("existing-app inferred ownership and multi-platform inference block readiness", () => {
  const spec = minimalSpec({
    schemaVersion: 3,
    platformTarget: "ios",
    platformSurfaces: [
      { id: "ios", platform: "ios", role: "primary", name: "iOS", interactionModes: ["touch"], featureIds: ["f"], provenance: "decided" },
      { id: "web", platform: "web", role: "companion", name: "Web", interactionModes: ["pointer"], featureIds: ["f"], provenance: "decided" },
    ],
    projectContext: { startingPoint: "existing-app", repoLayout: { featuresDir: "src/features" } },
    architecture: { components: [], contracts: [], relationships: [], flows: [], specDependencies: [] },
    governance: { constraints: [], decisions: [], owners: [] },
    changeSet: { id: "change-owned" },
    features: [{ id: "f", title: "Plan", surface: "ui", needIds: [], acceptanceCriteria: ["Plans"], ownedFiles: ["src/features/plan.ts"] }],
    tests: [{ id: "t", description: "plans", featureIds: ["f"], platformSurfaceIds: ["ios", "web"], testFramework: "XCTest Playwright" }],
  });
  const doc = handoffFor(spec);
  assert.match(doc, /Existing-app ownership is inferred/);
  assert.match(doc, /Multi-platform ownership is ambiguous/);
});

test("iterate-ui requires explicit ownership even when the ownership extension is omitted", () => {
  const spec = minimalSpec({
    designIntent: "iterate-ui",
    platformTarget: "ios",
    projectContext: { startingPoint: "existing-app", repoLayout: { featuresDir: "Sample Planner/Features", screensDir: "Sample Planner/Views" } },
    features: [{ id: "f", title: "Plan", surface: "ui", needIds: [], acceptanceCriteria: ["Plans"] }],
    screens: [{ id: "s", name: "Plan", purpose: "Plan", featureIds: ["f"] }],
    tests: [{ id: "t", description: "plans", featureIds: ["f"], screenIds: ["s"], testFramework: "XCTest" }],
  });
  const tasks = deriveTasks(spec);
  assert.deepEqual(tasks.find((task) => task.id === "task-feature-f")?.ownedFiles, ["Sample Planner/Features/plan.swift"]);
  assert.deepEqual(tasks.find((task) => task.id === "task-screen-s")?.ownedFiles, ["Sample Planner/Views/Plan.swift"]);
  assert.match(handoffFor(spec), /Existing-app ownership is inferred/);
  assert.match(handoffFor(spec), /\*\*BLOCKED — RETURN TO GROUNDWORK/);
});

test("multi-platform inferred ownership blocks existing-definition design-app", () => {
  const spec = minimalSpec({
    schemaVersion: 3,
    designIntent: "design-app",
    platformTarget: "ios",
    platformSurfaces: [
      { id: "ios", platform: "ios", role: "primary", name: "iOS", interactionModes: ["touch"], featureIds: ["f"], provenance: "decided" },
      { id: "web", platform: "web", role: "companion", name: "Web", interactionModes: ["pointer"], featureIds: ["f"], provenance: "decided" },
    ],
    projectContext: { startingPoint: "existing-definition" },
    architecture: { components: [], contracts: [], relationships: [], flows: [], specDependencies: [] },
    governance: { constraints: [], decisions: [], owners: [] },
    changeSet: { id: "change-multi" },
    features: [{ id: "f", title: "Plan", surface: "ui", needIds: [], acceptanceCriteria: ["Plans"] }],
    tests: [{ id: "t", description: "plans", featureIds: ["f"], platformSurfaceIds: ["ios", "web"], testFramework: "XCTest Playwright" }],
  });
  const handoff = handoffFor(spec);
  assert.match(handoff, /Multi-platform ownership is ambiguous/);
  assert.match(handoff, /\*\*BLOCKED — RETURN TO GROUNDWORK/);
});

test("wire-map lists an interactive element's resolved dataIn -> dataOut wire", () => {
  const spec = minimalSpec({
    features: [{ id: "feat-search", title: "Search", surface: "ui", needIds: [] }],
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
        ],
      },
    ],
  });

  const doc = handoffFor(spec);
  assert.match(doc, /## Data wire map/);
  assert.match(doc, /### Screen: Search \(`screen-search`\)/);
  // Element -> role -> resolved wire, in one line.
  assert.match(
    doc,
    /\*\*Search box\*\* _\(primary input\)_ — dataIn: user-entry \(`string`\) — free-text query · dataOut: _none declared_/,
  );
  // A wired interactive element must NOT be flagged.
  assert.doesNotMatch(doc.split("### Screen: Search")[1]!.split("### Data model entities")[0]!, /DEAD-CONTROL RISK/);
});

test("wire-map flags DEAD-CONTROL RISK for an interactive element with no dataIn and no dataOut", () => {
  const spec = minimalSpec({
    features: [{ id: "feat-log", title: "Log run", surface: "ui", needIds: [] }],
    screens: [
      {
        id: "screen-today",
        name: "Today",
        purpose: "Home base.",
        featureIds: ["feat-log"],
        elements: [
          // Interactive (role matches "action") but carries no data wire —
          // this is exactly the dead-control shape: renders, does nothing.
          { name: "Log Run button", role: "primary action" },
          // Non-interactive display element with no wire must NOT be flagged.
          { name: "Streak counter", role: "hero metric" },
        ],
      },
    ],
  });

  const doc = handoffFor(spec);
  assert.match(
    doc,
    /\*\*Log Run button\*\* _\(primary action\)_ — dataIn: _none declared_ · dataOut: _none declared_ — \*\*DEAD-CONTROL RISK\*\*: interactive element declares no data wire\./,
  );
  assert.match(doc, /\*\*1 DEAD-CONTROL RISK element\(s\) above\.\*\*/);
  // The non-interactive element is listed but never flagged.
  const streakLine = doc.split("\n").find((l) => l.includes("Streak counter"));
  assert.ok(streakLine, "streak counter line must be present");
  assert.doesNotMatch(streakLine!, /DEAD-CONTROL RISK/);
});

test("wire-map reports no dead-control risk when every interactive element has a wire", () => {
  const spec = minimalSpec({
    screens: [
      {
        id: "screen-today",
        name: "Today",
        purpose: "Home base.",
        elements: [
          {
            name: "Log Run button",
            role: "primary action",
            dataOut: { shows: "run logged confirmation" },
          },
        ],
      },
    ],
  });
  const doc = handoffFor(spec);
  assert.match(doc, /No dead-control risk detected: every interactive element declares at least one data wire\./);
});

test("wire-map degrades gracefully for a spec with no screens/elements (backward compatible)", () => {
  const spec = minimalSpec();
  const doc = handoffFor(spec);
  assert.match(doc, /## Data wire map/);
  assert.match(doc, /No screen elements captured — nothing to wire yet\./);
  assert.match(doc, /No dataModel entities declared\./);
});

test("wire-map surfaces dataModel entities with the features that read/write them", () => {
  const spec = minimalSpec({
    features: [{ id: "feat-search", title: "Search", surface: "ui", needIds: [] }],
    dataModel: [
      {
        id: "entity-item",
        name: "Item",
        description: "A single searchable catalog item.",
        readByFeatureIds: ["feat-search"],
        writtenByFeatureIds: [],
        elementRefs: ["screen-search:Results list"],
      },
    ],
  });
  const doc = handoffFor(spec);
  assert.match(doc, /### Data model entities/);
  assert.match(doc, /\*\*Item\*\* \(`entity-item`\) — A single searchable catalog item\./);
  assert.match(doc, /Read by: Search \(`feat-search`\)/);
  assert.match(doc, /Written by: _none declared_/);
  assert.match(doc, /Element refs: screen-search:Results list/);
});

test("real sample-spec.json fixture: pre-existing interactive elements with no declared wire are flagged", () => {
  // sample-spec.json predates dataIn/dataOut/dataModel entirely (see
  // spec.test.ts) and already carries interactive-role elements like "Log Run
  // button" (role: primary action) with no data wire. This is precisely the
  // real-world dead-control shape the wire-map exists to surface — proof the
  // feature fires on existing specs, not just synthetic fixtures.
  const raw = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  const spec = SpecSchema.parse(raw);
  const doc = handoffFor(spec);
  assert.match(doc, /\*\*Log Run button\*\* _\(primary action\)_ .* — \*\*DEAD-CONTROL RISK\*\*/);
  assert.match(doc, /DEAD-CONTROL RISK element\(s\) above\./);
  // A non-interactive, display-only element from the same fixture must not
  // be swept up as a false positive.
  const heroLine = doc.split("\n").find((l) => l.includes("Current streak counter"));
  assert.ok(heroLine);
  assert.doesNotMatch(heroLine!, /DEAD-CONTROL RISK/);
});

// ───────────────────────────────────────────────────────────────────────
// repoLayout-aware owned-file inference (DEFECT 1 — owned-file paths ignore
// the inspected repo). deriveTasks()/renderTasks() are pure, so these need no
// I/O. The CLI-level existing-app warning is tested separately below (last
// test in this file) since it's cli.ts stderr behavior, not a handoff.ts
// rendering concern.
// ───────────────────────────────────────────────────────────────────────

function ownedFilesSpec(overrides: Record<string, unknown> = {}): Spec {
  return minimalSpec({
    features: [{ id: "feat-x", title: "Feature X", surface: "ui", needIds: [] }],
    apiContracts: [
      { id: "api-x", method: "GET", path: "/api/competitive/infrastructure", featureIds: ["feat-x"] },
    ],
    integrations: [
      {
        id: "int-x",
        name: "Some Integration",
        purpose: "Fetch third-party data.",
        featureIds: ["feat-x"],
        verification: ["Call the endpoint and confirm a 200."],
      },
    ],
    screens: [
      { id: "screen-x", name: "Screen X", purpose: "Show the thing.", featureIds: ["feat-x"] },
    ],
    tests: [
      { id: "test-x", description: "Covers feature X.", featureIds: ["feat-x"], kind: "unit" },
    ],
    ...overrides,
  });
}

function ownedFilesByLayer(spec: Spec): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of deriveTasks(spec)) out[t.layer] = t.ownedFiles[0]!;
  return out;
}

test("regression guard: a spec WITHOUT repoLayout emits exactly the current generic owned-file paths", () => {
  const spec = ownedFilesSpec();
  assert.equal(spec.projectContext.repoLayout, undefined);
  const owned = ownedFilesByLayer(spec);
  assert.equal(owned.scaffold, "src/db/schema.ts");
  assert.equal(owned.integration, "src/integrations/int-x.ts");
  assert.equal(owned.api, "src/routes/competitive.ts");
  assert.equal(owned.feature, "src/features/feature-x.ts");
  assert.equal(owned.screen, "src/screens/ScreenX.tsx");
  assert.equal(owned.test, "test/test-x.test.ts");
});

test("a spec WITH repoLayout emits the repo's real paths, including {path} substitution for the API pattern", () => {
  const spec = ownedFilesSpec({
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
  const owned = ownedFilesByLayer(spec);
  assert.equal(owned.scaffold, "prisma/schema.prisma");
  assert.equal(owned.integration, "lib/integrations/int-x.ts");
  assert.equal(owned.api, "app/api/competitive/infrastructure/route.ts");
  assert.equal(owned.feature, "lib/feature-x.tsx");
  assert.equal(owned.screen, "components/v3/ScreenX.tsx");
  assert.equal(owned.test, "tests/test-x.test.ts");
  // No 'src/' scaffold path should remain anywhere in the owned-file set.
  assert.ok(!Object.values(owned).some((p) => p.startsWith("src/")));
});

test("apiFilePattern with no {path} token appends the path segment rather than dropping it", () => {
  const spec = ownedFilesSpec({
    apiContracts: [
      { id: "api-y", method: "GET", path: "/api/widgets/list", featureIds: ["feat-x"] },
    ],
    projectContext: {
      repoLayout: { apiFilePattern: "app/api" },
    },
  });
  const owned = ownedFilesByLayer(spec);
  assert.equal(owned.api, "app/api/widgets/list");
});

// ───────────────────────────────────────────────────────────────────────
// Activation Map (DEFECT 2 — emitted plan omits a section build-loop's
// plan_verify.py `activation-map-required` rule requires).
// ───────────────────────────────────────────────────────────────────────

test("Activation Map appears for a cron-bearing spec, with both trigger: and verified-live: on each entry", () => {
  const spec = minimalSpec({
    integrations: [
      {
        id: "int-sec-edgar",
        name: "SEC EDGAR companyfacts",
        purpose: "Pull filing data.",
        verification: ["Fetch a known CIK and confirm the response shape."],
        codeSetup: [
          "Port the spike's SecClient: declared User-Agent, request interval under 10/s.",
          "Add a Vercel cron entry for a quarterly refresh with a heavier Q1 cadence.",
        ],
      },
    ],
  });
  const doc = renderTasks(spec);
  assert.match(doc, /^## Activation Map$/m);
  const mapSection = doc.split("## Activation Map")[1]!.split(/\n##[^#]/)[0]!;
  const entryLine = mapSection.split("\n").find((l) => l.includes("SEC EDGAR companyfacts"));
  assert.ok(entryLine, "expected an entry for the integration that owns the cron codeSetup line");
  assert.match(entryLine!, /trigger:/);
  assert.match(entryLine!, /verified-live: pending/);
  assert.match(entryLine!, /Vercel cron schedule/);
});

test("Activation Map is absent when nothing qualifies", () => {
  const spec = minimalSpec({
    features: [{ id: "feat-search", title: "Search catalog", surface: "ui", needIds: [] }],
    integrations: [
      {
        id: "int-plain",
        name: "Plain API",
        purpose: "Fetch data.",
        verification: ["Call the endpoint."],
        codeSetup: ["Write a typed client wrapper around the REST endpoint."],
      },
    ],
  });
  const doc = renderTasks(spec);
  assert.doesNotMatch(doc, /## Activation Map/);
});

test("a bare React-style hook mention does NOT trigger the Activation Map section", () => {
  const spec = minimalSpec({
    features: [
      {
        id: "feat-scroll",
        title: "Scroll sync",
        description: "Uses the useEffect hook to sync scroll position between panes.",
        surface: "ui",
        needIds: [],
      },
    ],
  });
  const doc = renderTasks(spec);
  assert.doesNotMatch(doc, /## Activation Map/);
});

// ───────────────────────────────────────────────────────────────────────
// CLI-level existing-app-without-repoLayout warning (DEFECT 1 step 4). This
// is the one test in this file that isn't a pure renderer test — it spawns
// the real cli.ts via tsx (source, not the built dist, so it can't go stale)
// and asserts the stderr warning fires while emission still succeeds.
// ───────────────────────────────────────────────────────────────────────

test("existing-app spec without repoLayout warns on stderr; emission still succeeds", () => {
  const ROOT = path.resolve(HERE, "..", "..");
  const CLI_SRC = path.join(ROOT, "engine", "src", "cli.ts");
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "gw-repolayout-warn-"));
  const specPath = path.join(tmpBase, "spec.json");
  const outDir = path.join(tmpBase, "out");

  const spec = {
    schemaVersion: 2,
    id: "spec-existing-app-no-repolayout",
    productName: "ExistingAppNoRepoLayout",
    productDescription: "A spec claiming existing-app with no repoLayout supplied.",
    projectContext: { startingPoint: "existing-app", sourceRepo: "/some/repo" },
  };
  fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));

  const spawned = spawnSync("npx", ["tsx", CLI_SRC, specPath, "--out", outDir], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.equal(spawned.status, 0, `emission must succeed (warning, never a hard failure): ${spawned.stderr}`);
  assert.ok(fs.existsSync(path.join(outDir, "tasks.md")), "emission must still write tasks.md");
  assert.match(spawned.stderr, /existing-app/);
  assert.match(spawned.stderr, /repoLayout/);

  fs.rmSync(tmpBase, { recursive: true, force: true });
});
