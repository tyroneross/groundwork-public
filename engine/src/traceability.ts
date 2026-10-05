import { qualifiedRefIdentity, type QualifiedRef } from "./architecture.js";
import { architectureRefsForSpec, refsForTask, relationshipsForTask } from "./graph.js";
import type { Spec, TraceMatrix } from "./spec.js";
import type { Task } from "./handoff.js";

/** Build compatibility trace maps plus architecture/task dependency projections. */
export function buildTraceability(spec: Spec, tasks: readonly Task[]): TraceMatrix {
  const needToFeatures: Record<string, string[]> = {};
  const needToTests: Record<string, string[]> = {};
  const needToTasks: Record<string, string[]> = {};
  const featureToApis: Record<string, string[]> = {};
  const featureToTests: Record<string, string[]> = {};
  const featureToScreens: Record<string, string[]> = {};
  const featureToIntegrations: Record<string, string[]> = {};
  const featureToTasks: Record<string, string[]> = {};
  const screenToTasks: Record<string, string[]> = {};
  const screenToTests: Record<string, string[]> = {};
  const integrationToTasks: Record<string, string[]> = {};
  const integrationToTests: Record<string, string[]> = {};
  const taskToTests: Record<string, string[]> = {};
  const adrToTargets: Record<string, string[]> = {};
  const entityToFeatures: Record<string, string[]> = {};
  const flowToScreens: Record<string, string[]> = {};
  const pillarToNeeds: Record<string, string[]> = {};
  const pillarToFeatures: Record<string, string[]> = {};
  const pillarToInvariants: Record<string, string[]> = {};
  const pillarToTasks: Record<string, string[]> = {};
  const pillarToAcceptance: Record<string, string[]> = {};
  const platformSurfaceToTests: Record<string, string[]> = {};
  const componentToFeatures: Record<string, string[]> = {};
  const componentToTasks: Record<string, string[]> = {};
  const contractToComponents: Record<string, string[]> = {};
  const contractToTasks: Record<string, string[]> = {};
  const relationshipToTasks: Record<string, string[]> = {};
  const architectureFlowToTasks: Record<string, string[]> = {};
  const specDependencyToRefs: Record<string, string[]> = {};
  const taskDependencies: Record<string, string[]> = {};
  const taskToOwnedFiles: Record<string, string[]> = {};
  const taskOwnershipSource: Record<string, "explicit" | "inferred"> = {};
  const taskToPlannedNewFiles: Record<string, string[]> = {};
  const behaviorToScreens: Record<string, string[]> = {};
  const behaviorToElements: Record<string, string[]> = {};
  const behaviorToComponents: Record<string, string[]> = {};
  const behaviorToTasks: Record<string, string[]> = {};
  const behaviorToScopeRefs: Record<string, string[]> = {};
  const behaviorToStates: Record<string, string[]> = {};
  const behaviorToActions: Record<string, string[]> = {};
  const behaviorToVerifications: Record<string, string[]> = {};
  const behaviorToTests: Record<string, string[]> = {};
  const decisionToConstraints: Record<string, string[]> = {};
  const decisionToScopeRefs: Record<string, string[]> = {};
  const decisionToScreens: Record<string, string[]> = {};
  const decisionToElements: Record<string, string[]> = {};
  const decisionToComponents: Record<string, string[]> = {};
  const decisionToTasks: Record<string, string[]> = {};
  const decisionToTests: Record<string, string[]> = {};
  const decisionSupersession: Record<string, string> = {};
  const baselineToDeltas: Record<string, string[]> = {};
  const constraintToVerifications: Record<string, string[]> = {};
  const deltaToTargets: Record<string, string[]> = {};
  const deltaToVerifications: Record<string, string[]> = {};
  const coverageGaps: TraceMatrix["coverageGaps"] = [];
  const uiImpact: TraceMatrix["uiImpact"] = [];

  const uniqueSorted = (values: readonly string[]) => [...new Set(values)].sort();
  const intersects = (left: readonly string[], right: ReadonlySet<string>) =>
    left.some((value) => right.has(value));

  const tasksFor = (id: string) => tasks
    .filter((task) => task.layer !== "test" && task.satisfies.includes(id))
    .map((task) => task.id);
  const testsForTask = (task: Task) => spec.tests.filter((candidate) => {
    if (task.layer === "feature") return candidate.featureIds.some((id) => task.satisfies.includes(id));
    if (task.layer === "screen") return candidate.screenIds.some((id) => task.satisfies.includes(id));
    if (task.layer === "integration") return candidate.integrationIds.some((id) => task.satisfies.includes(id));
    if (task.layer === "test") return task.satisfies.includes(candidate.id);
    return false;
  }).map((candidate) => candidate.id);

  for (const task of tasks) {
    const repositoryFiles = task.ownedFiles.filter((file) => !file.startsWith("dependency:") && !file.startsWith("validators:") && !file.startsWith("TODO:"));
    taskToOwnedFiles[task.id] = repositoryFiles;
    taskOwnershipSource[task.id] = task.ownershipSource;
    if (task.plannedNewFiles.length) taskToPlannedNewFiles[task.id] = [...task.plannedNewFiles];
  }

  for (const need of spec.needs) {
    needToFeatures[need.id] = spec.features.filter((feature) => feature.needIds.includes(need.id)).map((feature) => feature.id);
    needToTests[need.id] = spec.tests.filter((test) => test.needIds.includes(need.id)).map((test) => test.id);
    needToTasks[need.id] = tasksFor(need.id);
    if (!needToFeatures[need.id].length) coverageGaps.push({ kind: "need", id: need.id, missing: "feature" });
  }
  for (const feature of spec.features) {
    featureToApis[feature.id] = spec.apiContracts.filter((api) => api.featureIds.includes(feature.id)).map((api) => api.id);
    featureToTests[feature.id] = spec.tests.filter((test) => test.featureIds.includes(feature.id)).map((test) => test.id);
    featureToScreens[feature.id] = spec.screens.filter((screen) => screen.featureIds.includes(feature.id)).map((screen) => screen.id);
    featureToIntegrations[feature.id] = spec.integrations.filter((integration) => integration.featureIds.includes(feature.id)).map((integration) => integration.id);
    featureToTasks[feature.id] = tasksFor(feature.id);
    if (feature.surface === "ui" && !featureToScreens[feature.id].length) coverageGaps.push({ kind: "feature", id: feature.id, missing: "screen" });
    if (feature.surface === "api" && !featureToApis[feature.id].length) coverageGaps.push({ kind: "feature", id: feature.id, missing: "api" });
  }
  for (const screen of spec.screens) {
    screenToTasks[screen.id] = tasksFor(screen.id);
    screenToTests[screen.id] = spec.tests.filter((test) => test.screenIds.includes(screen.id)).map((test) => test.id);
  }
  for (const integration of spec.integrations) {
    integrationToTasks[integration.id] = tasksFor(integration.id);
    integrationToTests[integration.id] = spec.tests.filter((test) => test.integrationIds.includes(integration.id)).map((test) => test.id);
  }
  const taskByNumber = new Map(tasks.map((task) => [task.n, task.id]));
  for (const task of tasks) {
    taskToTests[task.id] = testsForTask(task);
    taskDependencies[task.id] = task.deps.map((number) => taskByNumber.get(number)!).filter(Boolean);
    if (["feature", "screen", "integration"].includes(task.layer) && !taskToTests[task.id].length) {
      coverageGaps.push({ kind: "task", id: task.id, missing: "test" });
    }
  }
  for (const adr of spec.adrs) adrToTargets[adr.id] = adr.cites;
  for (const entity of spec.dataModel) {
    entityToFeatures[entity.id] = [...new Set([...(entity.readByFeatureIds ?? []), ...(entity.writtenByFeatureIds ?? [])])];
  }
  for (const flow of spec.uxFlows) flowToScreens[flow.id] = flow.screenIds;
  for (const behavior of spec.behaviorContracts ?? []) {
    const refs = uniqueSorted(behavior.scope.refs);
    const elements = uniqueSorted(refs.filter((id) => spec.screens.some((screen) => (screen.elements ?? []).some((element) => element.id === id))));
    const directlyScopedComponents = spec.architecture.components.filter((component) => refs.includes(component.id));
    const screens = uniqueSorted(spec.screens.filter((screen) => refs.includes(screen.id)
      || (screen.elements ?? []).some((element) => elements.includes(element.id))
      || directlyScopedComponents.some((component) => component.featureIds.some((id) => screen.featureIds.includes(id)))).map((screen) => screen.id));
    const reachedFeatures = new Set(spec.screens.filter((screen) => screens.includes(screen.id)).flatMap((screen) => screen.featureIds));
    const components = uniqueSorted(spec.architecture.components.filter((component) => refs.includes(component.id) || component.featureIds.some((id) => reachedFeatures.has(id))).map((component) => component.id));
    behaviorToScopeRefs[behavior.id] = refs;
    behaviorToScreens[behavior.id] = screens;
    behaviorToElements[behavior.id] = elements;
    behaviorToComponents[behavior.id] = components;
    behaviorToStates[behavior.id] = uniqueSorted(behavior.states.map((state) => state.id));
    behaviorToActions[behavior.id] = uniqueSorted(behavior.actions.map((action) => action.id));
    behaviorToVerifications[behavior.id] = uniqueSorted(behavior.verificationRefs);
    behaviorToTests[behavior.id] = uniqueSorted(spec.tests.filter((candidate) => candidate.screenIds.some((id) => behaviorToScreens[behavior.id]?.includes(id))).map((candidate) => candidate.id));
    behaviorToTasks[behavior.id] = uniqueSorted([...refs, ...screens, ...components].flatMap(tasksFor));
  }
  for (const decision of spec.adrs) {
    const constraintRefs = uniqueSorted(decision.constraintRefs ?? []);
    const constraintTargets = spec.designContract?.constraints.filter((item) => constraintRefs.includes(item.id)).map((item) => item.targetRef) ?? [];
    const refs = uniqueSorted([...(decision.scope?.refs ?? []), ...constraintTargets]);
    const elements = uniqueSorted(refs.filter((id) => spec.screens.some((screen) => (screen.elements ?? []).some((element) => element.id === id))));
    const directlyScopedComponents = spec.architecture.components.filter((component) => refs.includes(component.id));
    const screens = uniqueSorted(spec.screens.filter((screen) => refs.includes(screen.id)
      || (screen.elements ?? []).some((element) => elements.includes(element.id))
      || directlyScopedComponents.some((component) => component.featureIds.some((id) => screen.featureIds.includes(id)))).map((screen) => screen.id));
    const reachedFeatures = new Set(spec.screens.filter((screen) => screens.includes(screen.id)).flatMap((screen) => screen.featureIds));
    const components = uniqueSorted(spec.architecture.components.filter((component) => refs.includes(component.id) || component.featureIds.some((id) => reachedFeatures.has(id))).map((component) => component.id));
    const verificationRefs = uniqueSorted(spec.designContract?.constraints.filter((item) => constraintRefs.includes(item.id)).flatMap((item) => item.verificationRefs) ?? []);
    decisionToConstraints[decision.id] = constraintRefs;
    decisionToScopeRefs[decision.id] = refs;
    decisionToScreens[decision.id] = screens;
    decisionToElements[decision.id] = elements;
    decisionToComponents[decision.id] = components;
    decisionToTasks[decision.id] = uniqueSorted([...refs, ...screens, ...components].flatMap(tasksFor));
    decisionToTests[decision.id] = uniqueSorted([...spec.tests.filter((test) => test.screenIds.some((id) => screens.includes(id))).map((test) => test.id), ...verificationRefs]);
    if (decision.supersededBy) decisionSupersession[decision.id] = decision.supersededBy;
  }
  if (spec.designContract) {
    if (spec.designContract.baseline.id) baselineToDeltas[spec.designContract.baseline.id] = uniqueSorted(spec.designContract.deltas.map((delta) => delta.id));
    for (const constraint of spec.designContract.constraints) constraintToVerifications[constraint.id] = uniqueSorted(constraint.verificationRefs);
    for (const delta of spec.designContract.deltas) {
      deltaToTargets[delta.id] = uniqueSorted(delta.targetRefs);
      deltaToVerifications[delta.id] = uniqueSorted(delta.verificationRefs);
    }
  }
  const pillars = spec.pillars ?? [];
  const invariants = spec.architecturalInvariants ?? [];
  if (pillars.length) {
    for (const pillar of pillars) {
      const needIds = spec.needs.filter((need) => need.pillarIds.includes(pillar.id)).map((need) => need.id);
      const featureIds = spec.features
        .filter((feature) => feature.needIds.some((id) => needIds.includes(id)))
        .map((feature) => feature.id);
      const reached = new Set([...needIds, ...featureIds]);
      pillarToNeeds[pillar.id] = needIds;
      pillarToFeatures[pillar.id] = featureIds;
      pillarToInvariants[pillar.id] = invariants
        .filter((invariant) => invariant.pillarIds.includes(pillar.id))
        .map((invariant) => invariant.id);
      pillarToTasks[pillar.id] = tasks
        .filter((task) => task.layer !== "test" && task.satisfies.some((id) => reached.has(id)))
        .map((task) => task.id);
      const acceptance = spec.tests
        .filter((test) => test.needIds.some((id) => reached.has(id)) || test.featureIds.some((id) => reached.has(id)))
        .map((test) => test.id);
      if (spec.acceptanceTest?.pillarIds.includes(pillar.id)) acceptance.push(spec.acceptanceTest.id);
      pillarToAcceptance[pillar.id] = acceptance;
      if (!needIds.length) coverageGaps.push({ kind: "pillar", id: pillar.id, missing: "need" });
      else if (!acceptance.length) coverageGaps.push({ kind: "pillar", id: pillar.id, missing: "acceptance" });
    }
    for (const need of spec.needs) {
      if (!need.pillarIds.length) coverageGaps.push({ kind: "need", id: need.id, missing: "pillar" });
    }
  }
  for (const surface of spec.platformSurfaces) {
    platformSurfaceToTests[surface.id] = spec.tests
      .filter((candidate) => candidate.platformSurfaceIds.includes(surface.id))
      .map((candidate) => candidate.id);
  }

  const refTasks = (ref: QualifiedRef) => tasks
    .filter((task) => refsForTask(spec, task).componentRefs.some((candidate) => qualifiedRefIdentity(candidate) === qualifiedRefIdentity(ref)))
    .map((task) => task.id);
  for (const component of spec.architecture.components) {
    const key = qualifiedRefIdentity({ specId: spec.id, kind: "component", id: component.id });
    componentToFeatures[key] = component.featureIds;
    componentToTasks[key] = refTasks({ specId: spec.id, kind: "component", id: component.id });
  }
  for (const contract of spec.architecture.contracts) {
    const key = qualifiedRefIdentity({ specId: spec.id, kind: "contract", id: contract.id });
    contractToComponents[key] = [contract.provider, ...contract.consumers].map(qualifiedRefIdentity);
    contractToTasks[key] = [...new Set([contract.provider, ...contract.consumers].flatMap(refTasks))];
  }
  for (const relationship of spec.architecture.relationships) {
    relationshipToTasks[relationship.id] = [...new Set([relationship.from, relationship.to].flatMap(refTasks))];
  }
  for (const flow of spec.architecture.flows) {
    architectureFlowToTasks[flow.id] = [...new Set(flow.exchanges.flatMap((exchange) => [exchange.from, exchange.to].flatMap(refTasks)))];
  }
  for (const dependency of spec.architecture.specDependencies) {
    specDependencyToRefs[dependency.id] = [...new Set(architectureRefsForSpec(spec)
      .filter((ref) => ref.specId === dependency.specId)
      .map(qualifiedRefIdentity))].sort();
  }

  for (const screen of spec.screens) {
    const featureIds = uniqueSorted(screen.featureIds);
    const featureSet = new Set(featureIds);
    const needIds = uniqueSorted(spec.features
      .filter((feature) => featureSet.has(feature.id))
      .flatMap((feature) => feature.needIds));
    const uxFlowIds = uniqueSorted(spec.uxFlows
      .filter((flow) => flow.screenIds.includes(screen.id))
      .map((flow) => flow.id));
    const elements = screen.elements ?? [];
    const elementIds = uniqueSorted(elements.map((element) => element.id));
    const elementIdSet = new Set(elementIds);
    const elementRefs = new Set(elements.flatMap((element) => [
      `${screen.id}:${element.id}`,
      `${screen.id}:${element.name}`,
    ]));
    const dataEntityIds = uniqueSorted(spec.dataModel
      .filter((entity) =>
        intersects(entity.readByFeatureIds ?? [], featureSet)
        || intersects(entity.writtenByFeatureIds ?? [], featureSet)
        || (entity.elementRefs ?? []).some((ref) => elementRefs.has(ref)),
      )
      .map((entity) => entity.id));

    const exchangeReferencesScreen = (exchange: Spec["architecture"]["flows"][number]["exchanges"][number]) =>
      [...exchange.inputRefs, ...exchange.outputRefs].some((ref) =>
        ref.specId === spec.id
        && ((ref.kind === "screen" && ref.id === screen.id)
          || (ref.kind === "element" && elementIdSet.has(ref.id))))
      || exchange.stateRefs.some((ref) => ref.screenId === screen.id);
    const matchingArchitectureFlows = spec.architecture.flows.filter((flow) =>
      flow.exchanges.some(exchangeReferencesScreen));
    const matchingExchanges = matchingArchitectureFlows.flatMap((flow) =>
      flow.exchanges.filter(exchangeReferencesScreen));
    const componentRefs = uniqueSorted(matchingExchanges
      .flatMap((exchange) => [exchange.from, exchange.to])
      .filter((ref) => ref.kind === "component")
      .map(qualifiedRefIdentity));
    const contractRefs = uniqueSorted(matchingExchanges.map((exchange) =>
      qualifiedRefIdentity(exchange.contractRef)));
    const referencedContractRefSet = new Set(contractRefs);
    const matchingContracts = spec.architecture.contracts.filter((contract) =>
      referencedContractRefSet.has(qualifiedRefIdentity({
        specId: spec.id,
        kind: "contract",
        id: contract.id,
      })));
    const architectureFlowRefs = uniqueSorted(matchingArchitectureFlows.map((flow) =>
      qualifiedRefIdentity({ specId: spec.id, kind: "flow", id: flow.id })));
    const failurePaths = uniqueSorted([
      ...matchingContracts.flatMap((contract) => contract.failureModes),
      ...matchingExchanges.flatMap((exchange) => exchange.failurePaths),
    ]);
    const securityNotes = uniqueSorted(matchingContracts.flatMap((contract) => contract.securityNotes));
    const stateImpacts = uniqueSorted(screen.states).map((state) => {
      const stateExchanges = spec.architecture.flows.flatMap((flow) =>
        flow.exchanges
          .filter((exchange) => exchange.stateRefs.some((ref) =>
            ref.screenId === screen.id && ref.state === state))
          .map((exchange) => ({ flow, exchange })));
      const stateContractRefs = new Set(stateExchanges.map(({ exchange }) =>
        qualifiedRefIdentity(exchange.contractRef)));
      const stateContracts = spec.architecture.contracts.filter((contract) =>
        stateContractRefs.has(qualifiedRefIdentity({
          specId: spec.id,
          kind: "contract",
          id: contract.id,
        })));
      return {
        state,
        architectureFlowRefs: uniqueSorted(stateExchanges.map(({ flow }) =>
          qualifiedRefIdentity({ specId: spec.id, kind: "flow", id: flow.id }))),
        failurePaths: uniqueSorted([
          ...stateExchanges.flatMap(({ exchange }) => exchange.failurePaths),
          ...stateContracts.flatMap((contract) => contract.failureModes),
        ]),
        testIds: uniqueSorted(spec.tests
          .filter((candidate) => candidate.stateRefs.some((ref) =>
            ref.screenId === screen.id && ref.state === state))
          .map((candidate) => candidate.id)),
      };
    });

    const taskIds = uniqueSorted([
      ...(screenToTasks[screen.id] ?? []),
      ...featureIds.flatMap((id) => featureToTasks[id] ?? []),
      ...componentRefs.flatMap((ref) => componentToTasks[ref] ?? []),
      ...contractRefs.flatMap((ref) => contractToTasks[ref] ?? []),
      ...matchingArchitectureFlows.flatMap((flow) => architectureFlowToTasks[flow.id] ?? []),
    ]);
    const testIds = uniqueSorted([
      ...(screenToTests[screen.id] ?? []),
      ...featureIds.flatMap((id) => featureToTests[id] ?? []),
    ]);

    const remoteBoundary = spec.integrations.some((integration) =>
      intersects(integration.featureIds, featureSet))
      || spec.apiContracts.some((api) => intersects(api.featureIds, featureSet))
      || (screen.data ?? []).some((item) =>
        /(?:^|[-_/ ])(?:api|remote|server|sync|stream|provider)(?:$|[-_/ ])/i.test(item.source ?? ""));
    const unresolved: TraceMatrix["uiImpact"][number]["unresolved"] = [];
    if (!featureIds.length) unresolved.push("feature");
    if (spec.designIntent === "design-app"
      && elements.some((element) => !element.dataIn && !element.dataOut)) {
      unresolved.push("element-data");
    }
    const hasDataNeed = elements.some((element) => element.dataIn || element.dataOut)
      || Boolean(screen.data?.length);
    if (spec.designIntent === "design-app" && hasDataNeed && !dataEntityIds.length) {
      unresolved.push("data-entity");
    }
    if (spec.designIntent === "design-app" && !componentRefs.length) unresolved.push("component");
    if (remoteBoundary && !contractRefs.length) unresolved.push("contract");
    if (remoteBoundary && !architectureFlowRefs.length) unresolved.push("architecture-flow");
    if (!taskIds.length) unresolved.push("task");
    if (!testIds.length) unresolved.push("test");

    uiImpact.push({
      screenId: screen.id,
      needIds,
      featureIds,
      uxFlowIds,
      elementIds,
      stateImpacts,
      dataEntityIds,
      componentRefs,
      contractRefs,
      architectureFlowRefs,
      failurePaths,
      securityNotes,
      taskIds,
      testIds,
      unresolved,
    });
  }

  return {
    generatedBy: "groundwork-cli/v3",
    needToFeatures,
    needToTests,
    needToTasks,
    featureToApis,
    featureToTests,
    featureToScreens,
    featureToIntegrations,
    featureToTasks,
    screenToTasks,
    screenToTests,
    integrationToTasks,
    integrationToTests,
    taskToTests,
    adrToTargets,
    entityToFeatures,
    flowToScreens,
    pillarToNeeds,
    pillarToFeatures,
    pillarToInvariants,
    pillarToTasks,
    pillarToAcceptance,
    platformSurfaceToTests,
    componentToFeatures,
    componentToTasks,
    contractToComponents,
    contractToTasks,
    relationshipToTasks,
    architectureFlowToTasks,
    specDependencyToRefs,
    taskDependencies,
    ...(tasks.some((task) => task.ownershipSource === "explicit" || task.plannedNewFiles.length) ? {
      taskToOwnedFiles,
      taskOwnershipSource,
      taskToPlannedNewFiles,
    } : {}),
    uiImpact,
    coverageGaps,
    behaviorToScopeRefs,
    behaviorToScreens,
    behaviorToElements,
    behaviorToComponents,
    behaviorToTasks,
    behaviorToStates,
    behaviorToActions,
    behaviorToVerifications,
    behaviorToTests,
    decisionToConstraints,
    decisionToScopeRefs,
    decisionToScreens,
    decisionToElements,
    decisionToComponents,
    decisionToTasks,
    decisionToTests,
    decisionSupersession,
    ...(spec.designContract?.intent?.type === "conformance" ? { designContractIntent: "conformance" as const } : {}),
    baselineToDeltas,
    constraintToVerifications,
    deltaToTargets,
    deltaToVerifications,
  };
}

export function architectureTaskIds(spec: Spec, task: Task): string[] {
  return relationshipsForTask(spec, task).map((relationship) => relationship.id).sort();
}
