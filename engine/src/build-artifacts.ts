import {
  BUILD_REQUEST_CONTRACT,
  CONVERGENCE_CONTRACT,
  IMPLEMENTATION_MAP_CONTRACT,
  bindBuildRequest,
  calculateTaskDigest,
  type BuildAcceptanceCriterion,
  type BuildManualAction,
  type BuildRequest,
  type BuildRequestDraft,
  type BuildTask,
} from "./build-exchange.js";
import { refsForTask, type ResolvedSpecGraph } from "./graph.js";
import {
  validateExternalManualActionForPublication,
  type Spec,
  type TraceMatrix,
} from "./spec.js";
import type { Task } from "./handoff.js";

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

interface CriteriaProjection {
  criteria: BuildAcceptanceCriterion[];
  owners: Map<string, Set<string>>;
}

export function projectAcceptanceCriteria(spec: Spec): CriteriaProjection {
  const criteria: BuildAcceptanceCriterion[] = [];
  const owners = new Map<string, Set<string>>();
  const seen = new Set<string>();
  const add = (criterion: BuildAcceptanceCriterion, ownerIds: string[]) => {
    if (seen.has(criterion.id)) throw new Error(`Duplicate acceptance criterion ID ${criterion.id}.`);
    seen.add(criterion.id);
    criteria.push(criterion);
    owners.set(criterion.id, new Set(ownerIds));
  };
  for (const need of spec.needs) {
    for (const ears of need.ears ?? []) {
      if (!ears.ears.trim()) throw new Error(`Acceptance criterion ${ears.id} must have a statement.`);
      add({ id: ears.id, statement: ears.ears }, [need.id]);
    }
  }
  for (const feature of spec.features) {
    for (const ears of feature.ears ?? []) {
      if (!ears.ears.trim()) throw new Error(`Acceptance criterion ${ears.id} must have a statement.`);
      add({ id: ears.id, statement: ears.ears }, [feature.id, ...feature.needIds]);
    }
    feature.acceptanceCriteria.forEach((statement, index) => {
      if (!statement.trim()) return;
      add({
        id: `acceptance-${slug(feature.id)}-${index + 1}`,
        statement,
        testHint: `Verify feature ${feature.id}`,
      }, [feature.id, ...feature.needIds]);
    });
  }
  return { criteria: criteria.sort((a, b) => a.id.localeCompare(b.id)), owners };
}

export function projectBuildTasks(spec: Spec, tasks: readonly Task[], projection = projectAcceptanceCriteria(spec)): BuildTask[] {
  const numberToId = new Map(tasks.map((task) => [task.n, task.id]));
  const requirementIds = new Set(spec.needs.map((need) => need.id));
  return tasks.map((task) => {
    const refs = refsForTask(spec, task);
    const satisfies = new Set(task.satisfies);
    const acceptanceCriterionIds = projection.criteria
      .filter((criterion) => [...(projection.owners.get(criterion.id) ?? [])].some((owner) => satisfies.has(owner)))
      .map((criterion) => criterion.id);
    const ownership = (task.ownershipSource === "explicit" || task.plannedNewFiles.length) && task.ownedFiles.length
      ? { ownedFiles: task.ownedFiles }
      : {};
    return {
      id: task.id,
      title: task.title,
      componentRefs: refs.componentRefs,
      contractRefs: refs.contractRefs,
      requirementIds: task.satisfies.filter((id) => requirementIds.has(id)),
      dependsOn: task.deps.map((number) => numberToId.get(number)!).filter(Boolean),
      acceptanceCriterionIds,
      ...ownership,
    };
  });
}

export function projectManualActions(spec: Spec): BuildManualAction[] {
  const actions: BuildManualAction[] = [];
  for (const integration of spec.integrations) {
    for (const action of integration.externalManualActions) {
      const safeAction = validateExternalManualActionForPublication(action);
      actions.push({
        id: safeAction.id,
        location: safeAction.surface,
        action: safeAction.action,
        requiredValueName: safeAction.requiredValue,
        destination: safeAction.appDestination,
        verification: safeAction.verification,
      });
    }
  }
  return actions.sort((a, b) => a.id.localeCompare(b.id));
}

export function architectureArtifact(graph: ResolvedSpecGraph, specDigest: string): Record<string, unknown> {
  return {
    contract: "groundwork.architecture/v1",
    rootSpecId: graph.root.id,
    specDigest,
    specs: [
      {
        specId: graph.root.id,
        role: "root",
        platformSurfaces: graph.root.platformSurfaces,
        architecture: graph.root.architecture,
      },
      ...graph.dependencies.map((dependency) => ({
        specId: dependency.spec.id,
        role: "dependency",
        dependencyId: dependency.dependencyId,
        declaredBySpecId: dependency.declaredBySpecId,
        declaredPath: dependency.declaredPath,
        revision: dependency.revision,
        digest: dependency.digest,
        platformSurfaces: dependency.spec.platformSurfaces,
        architecture: dependency.spec.architecture,
      })),
    ],
  };
}

export interface BuildRequestInputs {
  spec: Spec;
  canonicalSpecPacket: unknown;
  tasks: readonly Task[];
  createdAt?: string;
  runId?: string;
}

export function createBuildRequest(inputs: BuildRequestInputs): BuildRequest {
  const projection = projectAcceptanceCriteria(inputs.spec);
  const tasks = projectBuildTasks(inputs.spec, inputs.tasks, projection);
  const taskDigest = calculateTaskDigest(tasks);
  const runId = inputs.runId || `run-${slug(inputs.spec.id)}-${taskDigest.slice("sha256:".length, "sha256:".length + 12)}`;
  const draft: BuildRequestDraft = {
    contract: BUILD_REQUEST_CONTRACT,
    runId,
    specId: inputs.spec.id,
    platformSurfaces: inputs.spec.platformSurfaces,
    architecture: inputs.spec.architecture,
    tasks,
    acceptanceCriteria: projection.criteria,
    manualActions: projectManualActions(inputs.spec),
    returnVersions: {
      implementationMap: [IMPLEMENTATION_MAP_CONTRACT],
      convergence: [CONVERGENCE_CONTRACT],
    },
    createdAt: inputs.createdAt || new Date().toISOString(),
  };
  return bindBuildRequest(draft, inputs.canonicalSpecPacket);
}

export function canonicalSpecPacket(spec: Spec, traceability: TraceMatrix): Record<string, unknown> {
  return { ...spec, traceMatrix: traceability };
}
