import test from "node:test";
import assert from "node:assert/strict";
import { compileTaskGraph } from "./graph.js";
import { deriveTasks } from "./handoff.js";
import { SpecSchema } from "./spec.js";
import { buildTraceability } from "./traceability.js";

function uiSpec(options: { architecture?: boolean; completeElementData?: boolean; test?: boolean } = {}) {
  const withArchitecture = options.architecture ?? true;
  const completeElementData = options.completeElementData ?? true;
  const withTest = options.test ?? true;
  return SpecSchema.parse({
    schemaVersion: 2,
    id: "spec-ui-impact",
    productName: "UI Impact",
    productDescription: "A compact end-to-end UI impact fixture.",
    platformTarget: "web",
    designIntent: "design-app",
    needs: [{ id: "need-search", title: "Find a record", priority: "P0" }],
    features: [{
      id: "feature-search",
      title: "Search",
      surface: "ui",
      priority: "P0",
      needIds: ["need-search"],
    }],
    uxFlows: [{
      id: "flow-search",
      name: "Search records",
      steps: ["Enter query", "Review results"],
      screenIds: ["screen-search"],
    }],
    screens: [{
      id: "screen-search",
      name: "Search",
      purpose: "Find a record.",
      featureIds: ["feature-search"],
      states: ["loading", "empty", "results", "error"],
      elements: [{
        id: "element-query",
        name: "Query input",
        role: "searchbox",
        ...(completeElementData ? {
          dataIn: { source: "user-entry", expectedType: "string" },
          dataOut: { shows: "query", expectedType: "string" },
        } : {}),
      }],
      data: [{ field: "query", source: "api-search" }],
    }],
    dataModel: completeElementData ? [{
      id: "entity-query",
      name: "Search query",
      fields: [{ name: "query", type: "string" }],
      readByFeatureIds: ["feature-search"],
      writtenByFeatureIds: ["feature-search"],
      elementRefs: ["screen-search:element-query"],
    }] : [],
    apiContracts: [{
      id: "api-search",
      method: "GET",
      path: "/search",
      featureIds: ["feature-search"],
    }],
    tests: withTest ? [{
      id: "test-search",
      description: "Search results and failure states remain visible.",
      needIds: ["need-search"],
      featureIds: ["feature-search"],
      screenIds: ["screen-search"],
      stateRefs: [{ screenId: "screen-search", state: "error" }],
      kind: "acceptance",
      testFramework: "Playwright",
    }] : [],
    architecture: withArchitecture ? {
      components: [
        {
          id: "component-search-ui",
          name: "Search UI",
          kind: "ui",
          featureIds: ["feature-search"],
          owner: "product-ui",
          provenance: "decided",
        },
        {
          id: "component-search-service",
          name: "Search service",
          kind: "service",
          featureIds: ["feature-search"],
          owner: "product-service",
          provenance: "decided",
        },
      ],
      contracts: [{
        id: "contract-search",
        name: "Search request",
        provider: { specId: "spec-ui-impact", kind: "component", id: "component-search-service" },
        consumers: [{ specId: "spec-ui-impact", kind: "component", id: "component-search-ui" }],
        ports: [{ id: "port-search", name: "search", type: "SearchRequest -> SearchResult", direction: "bidirectional" }],
        transport: "HTTPS JSON",
        failureModes: ["timeout", "partial results"],
        securityNotes: ["Authorize the caller before returning records."],
        provenance: "decided",
      }],
      relationships: [],
      flows: [{
        id: "architecture-flow-search",
        name: "Run search",
        trigger: "The user submits a query.",
        provenance: "decided",
        exchanges: [{
          id: "exchange-search",
          order: 1,
          from: { specId: "spec-ui-impact", kind: "component", id: "component-search-ui" },
          to: { specId: "spec-ui-impact", kind: "component", id: "component-search-service" },
          contractRef: { specId: "spec-ui-impact", kind: "contract", id: "contract-search" },
          inputRefs: [{ specId: "spec-ui-impact", kind: "element", id: "element-query" }],
          outputRefs: [{ specId: "spec-ui-impact", kind: "screen", id: "screen-search" }],
          stateRefs: [{ screenId: "screen-search", state: "error" }],
          failurePaths: ["Render retryable error state."],
        }],
      }],
      specDependencies: [],
    } : undefined,
  });
}

test("uiImpact traces a screen through product, data, architecture, tasks, and tests", () => {
  const spec = uiSpec();
  const tasks = compileTaskGraph(spec, deriveTasks(spec));
  const trace = buildTraceability(spec, tasks);
  assert.equal(trace.uiImpact.length, 1);
  assert.deepEqual(trace.uiImpact[0], {
    screenId: "screen-search",
    needIds: ["need-search"],
    featureIds: ["feature-search"],
    uxFlowIds: ["flow-search"],
    elementIds: ["element-query"],
    stateImpacts: [
      { state: "empty", architectureFlowRefs: [], failurePaths: [], testIds: [] },
      {
        state: "error",
        architectureFlowRefs: ["spec-ui-impact:flow:architecture-flow-search"],
        failurePaths: ["Render retryable error state.", "partial results", "timeout"],
        testIds: ["test-search"],
      },
      { state: "loading", architectureFlowRefs: [], failurePaths: [], testIds: [] },
      { state: "results", architectureFlowRefs: [], failurePaths: [], testIds: [] },
    ],
    dataEntityIds: ["entity-query"],
    componentRefs: [
      "spec-ui-impact:component:component-search-service",
      "spec-ui-impact:component:component-search-ui",
    ],
    contractRefs: ["spec-ui-impact:contract:contract-search"],
    architectureFlowRefs: ["spec-ui-impact:flow:architecture-flow-search"],
    failurePaths: ["Render retryable error state.", "partial results", "timeout"],
    securityNotes: ["Authorize the caller before returning records."],
    taskIds: trace.uiImpact[0]!.taskIds,
    testIds: ["test-search"],
    unresolved: [],
  });
  assert.ok(trace.uiImpact[0]!.taskIds.includes("task-screen-screen-search"));
});

test("uiImpact exposes build-relevant gaps without forcing boundaries on static UI", () => {
  const incomplete = uiSpec({ architecture: false, completeElementData: false, test: false });
  const incompleteTrace = buildTraceability(
    incomplete,
    compileTaskGraph(incomplete, deriveTasks(incomplete)),
  );
  assert.deepEqual(incompleteTrace.uiImpact[0]!.unresolved, [
    "element-data",
    "data-entity",
    "component",
    "contract",
    "architecture-flow",
    "test",
  ]);

  const staticSpec = SpecSchema.parse({
    schemaVersion: 2,
    id: "spec-static",
    productName: "Static",
    productDescription: "A static informational screen.",
    platformTarget: "web",
    designIntent: "iterate-ui",
    features: [{ id: "feature-static", title: "About", surface: "ui" }],
    screens: [{
      id: "screen-static",
      name: "About",
      purpose: "Explain the product.",
      featureIds: ["feature-static"],
      elements: [{ id: "element-copy", name: "Product copy" }],
    }],
  });
  const staticTrace = buildTraceability(
    staticSpec,
    compileTaskGraph(staticSpec, deriveTasks(staticSpec)),
  );
  assert.ok(!staticTrace.uiImpact[0]!.unresolved.includes("contract"));
  assert.ok(!staticTrace.uiImpact[0]!.unresolved.includes("architecture-flow"));
  assert.ok(!staticTrace.uiImpact[0]!.unresolved.includes("element-data"));
});

test("uiImpact does not copy architecture across screens that only share a feature", () => {
  const parsed = uiSpec();
  const spec = SpecSchema.parse({
    ...parsed,
    screens: [
      ...parsed.screens,
      {
        id: "screen-search-help",
        name: "Search help",
        purpose: "Explain query syntax.",
        featureIds: ["feature-search"],
        states: ["ready"],
        elements: [{ id: "element-search-help", name: "Search help copy" }],
      },
    ],
  });
  const trace = buildTraceability(spec, compileTaskGraph(spec, deriveTasks(spec)));
  const help = trace.uiImpact.find((impact) => impact.screenId === "screen-search-help");
  assert.ok(help);
  assert.deepEqual(help.componentRefs, []);
  assert.deepEqual(help.contractRefs, []);
  assert.deepEqual(help.architectureFlowRefs, []);
  assert.deepEqual(help.failurePaths, []);
  assert.deepEqual(help.securityNotes, []);
  assert.deepEqual(help.stateImpacts, [{
    state: "ready",
    architectureFlowRefs: [],
    failurePaths: [],
    testIds: [],
  }]);
});

test("uiImpact preserves explicit remote contract identities", () => {
  const parsed = uiSpec();
  const flow = parsed.architecture.flows[0]!;
  const exchange = flow.exchanges[0]!;
  const spec = SpecSchema.parse({
    ...parsed,
    architecture: {
      ...parsed.architecture,
      contracts: [],
      flows: [{
        ...flow,
        exchanges: [{
          ...exchange,
          to: { specId: "spec-remote", kind: "component", id: "component-search-service" },
          contractRef: { specId: "spec-remote", kind: "contract", id: "contract-search" },
        }],
      }],
      specDependencies: [{
        id: "dependency-remote",
        specId: "spec-remote",
        location: { kind: "local", path: "../remote/spec.json" },
        schemaVersion: 3,
        revision: "remote-revision",
        digest: `sha256:${"a".repeat(64)}`,
        relationship: "uses",
      }],
    },
  });
  const trace = buildTraceability(spec, compileTaskGraph(spec, deriveTasks(spec)));
  const impact = trace.uiImpact[0]!;
  assert.deepEqual(impact.contractRefs, ["spec-remote:contract:contract-search"]);
  assert.deepEqual(impact.architectureFlowRefs, ["spec-ui-impact:flow:architecture-flow-search"]);
  assert.deepEqual(impact.failurePaths, ["Render retryable error state."]);
  assert.deepEqual(impact.securityNotes, []);
});

test("Spec rejects state references to unknown screens and states", () => {
  const parsed = uiSpec();
  assert.throws(() => SpecSchema.parse({
    ...parsed,
    tests: parsed.tests.map((candidate) => ({
      ...candidate,
      stateRefs: [{ screenId: "screen-missing", state: "error" }],
    })),
  }), /Unknown screen reference: screen-missing/);

  const flow = parsed.architecture.flows[0]!;
  const exchange = flow.exchanges[0]!;
  assert.throws(() => SpecSchema.parse({
    ...parsed,
    architecture: {
      ...parsed.architecture,
      flows: [{
        ...flow,
        exchanges: [{
          ...exchange,
          stateRefs: [{ screenId: "screen-search", state: "missing" }],
        }],
      }],
    },
  }), /Unknown state missing on screen screen-search/);
});

test("traceability projects additive behavior and baseline-delta maps", () => {
  const base = uiSpec();
  const spec = SpecSchema.parse({
    ...base,
    behaviorContracts: [{ id: "behavior-search", name: "Search", scope: { kind: "screen", refs: ["screen-search"] }, trigger: "query", states: [{ id: "state-query", name: "Query" }], actions: [{ id: "action-query", name: "Submit", fromStateIds: ["state-query"], effects: [{ kind: "update", targetRef: "screen-search" }] }], transitions: [], verificationRefs: ["verify-search"] }],
    adrs: [{ id: "adr-search", title: "Search target", context: "Touch", decision: "Keep target accessible.", reversibility: "high", rigidity: "locked", scope: { kind: "element", refs: ["element-query"] }, constraintRefs: ["constraint-target"] }],
    designContract: {
      baseline: { disposition: "declared", id: "baseline-search", artifacts: [{ id: "artifact-search", path: "reference/search.json", type: "contract", digest: `sha256:${"a".repeat(64)}` }], precedence: [{ rank: 1, artifactId: "artifact-search" }] },
      constraints: [{ id: "constraint-target", kind: "exact", scope: { kind: "element", refs: ["element-query"] }, targetRef: "element-query", propertyPath: "minimumTouchTarget", operator: "gte", value: 44, sourceArtifactId: "artifact-search", verificationRefs: ["verify-search"] }],
      direction: { summary: "Keep search focused." },
      deltas: [{ id: "delta-search", baselineId: "baseline-search", targetRefs: ["screen-search"], operation: "preserve", direction: "Keep.", verificationRefs: ["verify-search"] }],
      verification: [{ id: "verify-search", kind: "ibr", targetRefs: ["element-query"], method: "measure", passCriteria: [] }],
    },
  });
  const trace = buildTraceability(spec, compileTaskGraph(spec, deriveTasks(spec)));
  assert.deepEqual(trace.behaviorToScopeRefs["behavior-search"], ["screen-search"]);
  assert.deepEqual(trace.behaviorToScreens["behavior-search"], ["screen-search"]);
  assert.deepEqual(trace.behaviorToStates["behavior-search"], ["state-query"]);
  assert.deepEqual(trace.behaviorToActions["behavior-search"], ["action-query"]);
  assert.deepEqual(trace.behaviorToVerifications["behavior-search"], ["verify-search"]);
  assert.deepEqual(trace.behaviorToTests["behavior-search"], ["test-search"]);
  assert.deepEqual(trace.decisionToConstraints["adr-search"], ["constraint-target"]);
  assert.equal("designContractIntent" in trace, false);
  assert.deepEqual(trace.decisionToScopeRefs["adr-search"], ["element-query"]);
  assert.deepEqual(trace.baselineToDeltas["baseline-search"], ["delta-search"]);
  assert.deepEqual(trace.constraintToVerifications["constraint-target"], ["verify-search"]);
  assert.deepEqual(trace.deltaToTargets["delta-search"], ["screen-search"]);
  assert.deepEqual(trace.deltaToVerifications["delta-search"], ["verify-search"]);

  const conformance = SpecSchema.parse({
    ...spec,
    designContract: {
      ...spec.designContract!,
      intent: { type: "conformance", evidenceRefs: ["evidence-search"], acceptanceTestRef: "acceptance-search", verificationRefs: ["verify-search"] },
      deltas: [],
      verification: spec.designContract!.verification.map((item) => ({
        ...item,
        passCriteria: [{ subjectRef: "element-query", propertyPath: "minimumTouchTarget", operator: "gte", value: 44 }],
      })),
    },
    projectContext: { ...spec.projectContext, evidence: [{ id: "evidence-search", status: "observed", statement: "Inspected search baseline.", sourceRefs: ["reference/search.json"] }] },
    acceptanceTest: { id: "acceptance-search", statement: "Search remains accessible.", observable: "The target measures 44 points.", timeBox: "Within one check.", steps: ["Measure the search target."] },
  });
  const conformanceTrace = buildTraceability(conformance, compileTaskGraph(conformance, deriveTasks(conformance)));
  assert.equal(conformanceTrace.designContractIntent, "conformance");
  assert.deepEqual(conformanceTrace.baselineToDeltas["baseline-search"], []);
});

test("component-scoped behavior and decisions inherit containing screens, tests, and component tasks", () => {
  const base = uiSpec();
  const spec = SpecSchema.parse({
    ...base,
    behaviorContracts: [{
      id: "behavior-search-component", name: "Search component", scope: { kind: "component", refs: ["component-search-ui"] },
      trigger: "query", states: [], actions: [], transitions: [], verificationRefs: [],
    }],
    adrs: [{
      id: "adr-search-component", title: "Search component placement", context: "Search screen",
      decision: "Keep the component on the search screen.", reversibility: "high", rigidity: "leaning",
      scope: { kind: "component", refs: ["component-search-ui"] },
    }],
  });
  const trace = buildTraceability(spec, compileTaskGraph(spec, deriveTasks(spec)));
  assert.deepEqual(trace.behaviorToComponents["behavior-search-component"], ["component-search-service", "component-search-ui"]);
  assert.deepEqual(trace.behaviorToScreens["behavior-search-component"], ["screen-search"]);
  assert.deepEqual(trace.behaviorToTests["behavior-search-component"], ["test-search"]);
  assert.equal(trace.behaviorToTasks["behavior-search-component"].length > 0, true);
  assert.deepEqual(trace.decisionToComponents["adr-search-component"], ["component-search-service", "component-search-ui"]);
  assert.deepEqual(trace.decisionToScreens["adr-search-component"], ["screen-search"]);
  assert.deepEqual(trace.decisionToTests["adr-search-component"], ["test-search"]);
  assert.equal(trace.decisionToTasks["adr-search-component"].length > 0, true);
});

test("task ownership trace excludes dependency pseudo-paths", () => {
  const base = uiSpec();
  const spec = SpecSchema.parse({
    ...base,
    architecture: {
      ...base.architecture,
      specDependencies: [{ id: "dependency-shared", specId: "shared-spec", location: { kind: "local", path: "../shared/spec.json" }, schemaVersion: 3, revision: "r1", digest: `sha256:${"a".repeat(64)}`, relationship: "uses" }],
    },
    features: base.features.map((feature: any) => ({ ...feature, ownedFiles: ["src/features/search.ts"] })),
  });
  const trace = buildTraceability(spec, compileTaskGraph(spec, deriveTasks(spec)));
  assert.equal(Object.values(trace.taskToOwnedFiles!).flat().some((file) => file.startsWith("dependency:")), false);
});
