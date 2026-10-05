import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  qualifiedRefIdentity,
  type QualifiedRef,
  type Relationship,
  type SpecDependency,
} from "./architecture.js";
import { SpecSchema, type Spec } from "./spec.js";
import type { Task } from "./handoff.js";
import { calculateSpecDigest } from "./build-exchange.js";

const MAX_SPEC_BYTES = 2 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;

export interface ResolvedSpecDependency {
  dependencyId: string;
  declaredBySpecId: string;
  declaredPath: string;
  revision: string;
  digest: `sha256:${string}`;
  spec: Spec;
  canonicalPacket: unknown;
}

export interface ResolvedSpecGraph {
  root: Spec;
  dependencies: ResolvedSpecDependency[];
}

export interface ResolveSpecGraphOptions {
  sourcePath?: string;
  allowedRoots?: readonly string[];
  maxSpecBytes?: number;
}

function safeRelativeSpecPath(value: string): boolean {
  return Boolean(value)
    && !path.isAbsolute(value)
    && !value.includes("\\")
    && value.split("/").every((part) => Boolean(part) && part !== "." && part !== "..");
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function readSafeRegularFile(file: string, maxBytes: number, label: string): string {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular, non-symlink file.`);
  if (stat.size > maxBytes) throw new Error(`${label} exceeds the ${maxBytes}-byte limit.`);
  return fs.readFileSync(file, "utf8");
}

function verifyDependencyManifest(file: string, dependency: SpecDependency, rawText: string): void {
  if (path.basename(file) !== "spec.json") {
    throw new Error(`Local Spec dependency ${dependency.id} must point to an atomic Groundwork spec.json artifact.`);
  }
  const manifestPath = path.join(path.dirname(file), "artifact-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Local Spec dependency ${dependency.id} is missing artifact-manifest.json.`);
  }
  const manifest = JSON.parse(readSafeRegularFile(
    manifestPath,
    MAX_MANIFEST_BYTES,
    `Manifest for dependency ${dependency.id}`,
  )) as Record<string, unknown>;
  if (manifest.schema !== "groundwork.artifacts/v1" || manifest.generationId !== dependency.revision) {
    throw new Error(`Local Spec dependency ${dependency.id} revision does not match its artifact manifest.`);
  }
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const entry = files.find((item) => item && typeof item === "object"
    && (item as Record<string, unknown>).name === "spec.json") as Record<string, unknown> | undefined;
  const contentHash = crypto.createHash("sha256").update(rawText, "utf8").digest("hex");
  if (!entry || entry.sha256 !== contentHash) {
    throw new Error(`Local Spec dependency ${dependency.id} does not match its manifest content hash.`);
  }
}

/** Complete architecture-reference traversal shared by resolution, traceability, and handoff projection. */
export function architectureRefsForSpec(spec: Spec): QualifiedRef[] {
  return [
    ...spec.architecture.contracts.flatMap((contract) => [
      contract.provider,
      ...contract.consumers,
    ]),
    ...spec.architecture.relationships.flatMap((relationship) => [
      relationship.from,
      relationship.to,
      ...(relationship.contractRef ? [relationship.contractRef] : []),
    ]),
    ...spec.architecture.flows.flatMap((flow) => flow.exchanges.flatMap((exchange) => [
      exchange.from,
      exchange.to,
      exchange.contractRef,
      ...exchange.inputRefs,
      ...exchange.outputRefs,
    ])),
    ...(["current", "proposed", "verified"] as const).flatMap((bucket) =>
      spec.changeSet[bucket].map((change) => change.target)),
  ];
}

function declaredIdentities(spec: Spec): QualifiedRef[] {
  return [
    ...spec.needs.map((item) => ({ specId: spec.id, kind: "requirement" as const, id: item.id })),
    ...spec.features.map((item) => ({ specId: spec.id, kind: "feature" as const, id: item.id })),
    ...spec.screens.flatMap((screen) => [
      { specId: spec.id, kind: "screen" as const, id: screen.id },
      ...(screen.elements ?? []).map((element) => ({ specId: spec.id, kind: "element" as const, id: element.id })),
    ]),
    ...spec.architecture.components.map((item) => ({ specId: spec.id, kind: "component" as const, id: item.id })),
    ...spec.architecture.contracts.map((item) => ({ specId: spec.id, kind: "contract" as const, id: item.id })),
    ...spec.architecture.flows.map((item) => ({ specId: spec.id, kind: "flow" as const, id: item.id })),
  ];
}

function validateResolvedReferences(specs: readonly Spec[]): void {
  const known = new Set(specs.flatMap(declaredIdentities).map(qualifiedRefIdentity));
  for (const spec of specs) {
    for (const ref of architectureRefsForSpec(spec)) {
      if (!known.has(qualifiedRefIdentity(ref))) {
        throw new Error(`Resolved architecture contains unknown reference: ${qualifiedRefIdentity(ref)}`);
      }
    }
  }
}

function hardRelationshipEdges(specs: readonly Spec[]): Array<{ from: QualifiedRef; to: QualifiedRef; id: string }> {
  const edges: Array<{ from: QualifiedRef; to: QualifiedRef; id: string }> = [];
  for (const spec of specs) {
    for (const relationship of spec.architecture.relationships) {
      if (relationship.criticality !== "hard") continue;
      edges.push({ from: relationship.from, to: relationship.to, id: relationship.id });
      if (relationship.direction === "bidirectional") {
        edges.push({ from: relationship.to, to: relationship.from, id: relationship.id });
      }
    }
  }
  return edges;
}

function validateCombinedHardCycles(specs: readonly Spec[]): void {
  const edges = hardRelationshipEdges(specs);
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const from = qualifiedRefIdentity(edge.from);
    const to = qualifiedRefIdentity(edge.to);
    adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
  }
  adjacency.forEach((values, key) => adjacency.set(key, [...new Set(values)].sort()));
  const state = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];
  const visit = (id: string): string[] | undefined => {
    state.set(id, "visiting");
    stack.push(id);
    for (const next of adjacency.get(id) ?? []) {
      if (state.get(next) === "visiting") {
        return [...stack.slice(stack.indexOf(next)), next];
      }
      if (!state.has(next)) {
        const cycle = visit(next);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    state.set(id, "visited");
    return undefined;
  };
  for (const id of [...adjacency.keys()].sort()) {
    if (state.has(id)) continue;
    const cycle = visit(id);
    if (cycle) throw new Error(`Cross-Spec hard dependency cycle: ${cycle.join(" -> ")}`);
  }
}

/** Resolve local Spec dependencies without network access and validate the combined identity graph. */
export function resolveSpecGraph(root: Spec, options: ResolveSpecGraphOptions = {}): ResolvedSpecGraph {
  const dependencies = root.architecture.specDependencies;
  if (!dependencies.length) return { root, dependencies: [] };
  if (!options.sourcePath) throw new Error("Local Spec dependencies require a file source; stdin cannot establish their base path.");
  const allowedRoots = (options.allowedRoots ?? []).map((entry) => {
    const absolute = path.resolve(entry);
    const stat = fs.lstatSync(absolute);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Allowed Spec root is not a regular directory: ${absolute}`);
    return fs.realpathSync(absolute);
  });
  if (!allowedRoots.length) throw new Error("Local Spec dependencies require at least one explicit --allow-spec-root.");

  const maxSpecBytes = options.maxSpecBytes ?? MAX_SPEC_BYTES;
  const bySpecId = new Map<string, { digest: string; spec: Spec; packet: unknown }>([
    [root.id, { digest: "<root>", spec: root, packet: root }],
  ]);
  const resolved: ResolvedSpecDependency[] = [];
  const visiting = new Set<string>();

  const loadFrom = (owner: Spec, ownerFile: string) => {
    for (const dependency of [...owner.architecture.specDependencies].sort((a, b) => a.id.localeCompare(b.id))) {
      if (dependency.specId === root.id) {
        throw new Error(`Spec dependency ${dependency.id} cyclically targets the root Spec ${root.id}.`);
      }
      if (dependency.location.kind === "uri") {
        throw new Error(`Spec dependency ${dependency.id} uses a URI; Groundwork is offline and no resolver was approved.`);
      }
      const declaredPath = dependency.location.path;
      if (!safeRelativeSpecPath(declaredPath)) {
        throw new Error(`Spec dependency ${dependency.id} path must be a traversal-free relative POSIX path.`);
      }
      const candidate = path.resolve(path.dirname(ownerFile), declaredPath);
      if (!fs.existsSync(candidate)) throw new Error(`Spec dependency ${dependency.id} is missing: ${declaredPath}`);
      const candidateStat = fs.lstatSync(candidate);
      if (!candidateStat.isFile() || candidateStat.isSymbolicLink()) {
        throw new Error(`Spec dependency ${dependency.id} must be a regular, non-symlink file.`);
      }
      const realCandidate = fs.realpathSync(candidate);
      if (!allowedRoots.some((allowedRoot) => inside(allowedRoot, realCandidate))) {
        throw new Error(`Spec dependency ${dependency.id} escapes the explicit allowed roots.`);
      }
      const rawText = readSafeRegularFile(realCandidate, maxSpecBytes, `Spec dependency ${dependency.id}`);
      verifyDependencyManifest(realCandidate, dependency, rawText);
      let packet: unknown;
      try {
        packet = JSON.parse(rawText);
      } catch (error) {
        throw new Error(`Spec dependency ${dependency.id} is not valid JSON: ${(error as Error).message}`);
      }
      const rawVersion = packet && typeof packet === "object" && !Array.isArray(packet)
        ? (packet as Record<string, unknown>).schemaVersion
        : undefined;
      if (dependency.schemaVersion !== 3 || rawVersion !== 3) {
        throw new Error(`Spec dependency ${dependency.id} must pin an unmigrated Spec v3 packet.`);
      }
      const spec = SpecSchema.parse(packet);
      if (spec.id !== dependency.specId) {
        throw new Error(`Spec dependency ${dependency.id} expected ${dependency.specId}, received ${spec.id}.`);
      }
      const digest = calculateSpecDigest(packet);
      if (digest !== dependency.digest) {
        throw new Error(`Spec dependency ${dependency.id} digest mismatch.`);
      }
      const prior = bySpecId.get(spec.id);
      if (prior && prior.digest !== "<root>" && prior.digest !== digest) {
        throw new Error(`Spec ${spec.id} resolves to conflicting digests.`);
      }
      if (!prior) {
        bySpecId.set(spec.id, { digest, spec, packet });
        resolved.push({
          dependencyId: dependency.id,
          declaredBySpecId: owner.id,
          declaredPath,
          revision: dependency.revision,
          digest,
          spec,
          canonicalPacket: packet,
        });
      }
      const visitKey = `${owner.id}:${dependency.id}`;
      if (visiting.has(visitKey)) throw new Error(`Spec dependency declaration cycle at ${visitKey}.`);
      if (!prior) {
        visiting.add(visitKey);
        loadFrom(spec, realCandidate);
        visiting.delete(visitKey);
      }
    }
  };

  loadFrom(root, path.resolve(options.sourcePath));
  const specs = [root, ...resolved.map((entry) => entry.spec)];
  validateResolvedReferences(specs);
  validateCombinedHardCycles(specs);
  return { root, dependencies: resolved.sort((a, b) => a.spec.id.localeCompare(b.spec.id)) };
}

function taskIdsForComponent(spec: Spec, tasks: readonly Task[], ref: QualifiedRef): string[] {
  if (ref.kind !== "component") return [];
  if (ref.specId !== spec.id) {
    return tasks.filter((task) => task.layer === "dependency" && task.satisfies.includes(ref.specId)).map((task) => task.id);
  }
  const component = spec.architecture.components.find((item) => item.id === ref.id);
  if (!component) return [];
  const componentTasks = tasks.filter((task) => task.layer === "component" && task.satisfies.includes(component.id));
  if (componentTasks.length) return componentTasks.map((task) => task.id);
  return tasks.filter((task) => task.layer === "feature"
    && component.featureIds.some((featureId) => task.satisfies.includes(featureId)))
    .map((task) => task.id);
}

function compareTaskFallback(left: Task, right: Task): number {
  return left.n - right.n || left.id.localeCompare(right.id);
}

/** Add hard architecture edges and return a stable topological task order with renumbered dependencies. */
export function compileTaskGraph(spec: Spec, inputTasks: readonly Task[]): Task[] {
  const tasks = inputTasks.map((task) => ({ ...task, deps: [...task.deps] }));
  const byOldNumber = new Map(tasks.map((task) => [task.n, task.id]));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const dependencies = new Map<string, Set<string>>(
    tasks.map((task) => [task.id, new Set(task.deps.map((number) => byOldNumber.get(number)).filter((id): id is string => Boolean(id)))]),
  );
  for (const relationship of spec.architecture.relationships) {
    if (relationship.criticality !== "hard") continue;
    const contract = relationship.contractRef?.specId === spec.id
      ? spec.architecture.contracts.find((candidate) => candidate.id === relationship.contractRef?.id)
      : undefined;
    // A relationship describes payload direction. Build dependency direction
    // follows the declared contract provider so an upload client can point to
    // a service without incorrectly requiring the service to be built last.
    const providerRefs = contract ? [contract.provider] : [relationship.from];
    const consumerRefs = contract ? contract.consumers : [relationship.to];
    const providers = [...new Set(providerRefs.flatMap((ref) => taskIdsForComponent(spec, tasks, ref)))];
    const consumers = [...new Set(consumerRefs.flatMap((ref) => taskIdsForComponent(spec, tasks, ref)))];
    for (const consumer of consumers) {
      for (const provider of providers) {
        if (provider !== consumer) dependencies.get(consumer)?.add(provider);
      }
    }
  }

  const outgoing = new Map(tasks.map((task) => [task.id, new Set<string>()]));
  const indegree = new Map(tasks.map((task) => [task.id, dependencies.get(task.id)?.size ?? 0]));
  dependencies.forEach((providers, consumer) => providers.forEach((provider) => {
    if (!byId.has(provider)) throw new Error(`Task ${consumer} depends on unknown task ${provider}.`);
    outgoing.get(provider)?.add(consumer);
  }));
  const ready = tasks.filter((task) => indegree.get(task.id) === 0).sort(compareTaskFallback);
  const ordered: Task[] = [];
  while (ready.length) {
    const task = ready.shift()!;
    ordered.push(task);
    for (const consumer of [...(outgoing.get(task.id) ?? [])].sort()) {
      indegree.set(consumer, (indegree.get(consumer) ?? 0) - 1);
      if (indegree.get(consumer) === 0) {
        ready.push(byId.get(consumer)!);
        ready.sort(compareTaskFallback);
      }
    }
  }
  if (ordered.length !== tasks.length) {
    const blocked = tasks.filter((task) => !ordered.some((item) => item.id === task.id)).map((task) => task.id).sort();
    throw new Error(`Task dependency cycle: ${blocked.join(" -> ")}`);
  }
  const newNumber = new Map(ordered.map((task, index) => [task.id, index + 1]));
  return ordered.map((task, index) => ({
    ...task,
    n: index + 1,
    deps: [...(dependencies.get(task.id) ?? [])]
      .map((id) => newNumber.get(id)!)
      .sort((a, b) => a - b),
  }));
}

export function refsForTask(spec: Spec, task: Task): { componentRefs: QualifiedRef[]; contractRefs: QualifiedRef[] } {
  const refs = new Map<string, QualifiedRef>();
  const directContractRefs = new Map<string, QualifiedRef>();
  for (const component of spec.architecture.components) {
    const ownsComponent = task.layer === "component"
      ? task.satisfies.includes(component.id)
      : component.featureIds.some((featureId) => task.satisfies.includes(featureId));
    if (ownsComponent) {
      const ref = { specId: spec.id, kind: "component" as const, id: component.id };
      refs.set(qualifiedRefIdentity(ref), ref);
    }
  }
  if (task.layer === "dependency") {
    for (const ref of architectureRefsForSpec(spec)) {
      if (ref.specId === spec.id || !task.satisfies.includes(ref.specId)) continue;
      if (ref.kind === "component") refs.set(qualifiedRefIdentity(ref), ref);
      if (ref.kind === "contract") directContractRefs.set(qualifiedRefIdentity(ref), ref);
    }
  }
  for (const contract of spec.architecture.contracts) {
    if (!task.satisfies.includes(contract.id)) continue;
    for (const ref of [contract.provider, ...contract.consumers]) {
      if (ref.kind === "component") refs.set(qualifiedRefIdentity(ref), ref);
    }
  }
  const componentRefs = [...refs.values()].filter((ref) => ref.kind === "component")
    .sort((a, b) => qualifiedRefIdentity(a).localeCompare(qualifiedRefIdentity(b)));
  const componentIds = new Set(componentRefs.map(qualifiedRefIdentity));
  const contractRefs: QualifiedRef[] = spec.architecture.contracts.filter((contract) => task.satisfies.includes(contract.id) || [
    contract.provider,
    ...contract.consumers,
  ].some((ref) => componentIds.has(qualifiedRefIdentity(ref))))
    .map((contract) => ({ specId: spec.id, kind: "contract" as const, id: contract.id }));
  contractRefs.push(...directContractRefs.values());
  for (const relationship of spec.architecture.relationships) {
    if (relationship.contractRef && componentRefs.some((ref) =>
      qualifiedRefIdentity(ref) === qualifiedRefIdentity(relationship.from)
      || qualifiedRefIdentity(ref) === qualifiedRefIdentity(relationship.to))) {
      contractRefs.push(relationship.contractRef);
    }
  }
  return {
    componentRefs,
    contractRefs: [...new Map(contractRefs.map((ref) => [qualifiedRefIdentity(ref), ref])).values()]
      .sort((a, b) => qualifiedRefIdentity(a).localeCompare(qualifiedRefIdentity(b))),
  };
}

export function relationshipsForTask(spec: Spec, task: Task): Relationship[] {
  const ids = new Set(refsForTask(spec, task).componentRefs.map(qualifiedRefIdentity));
  return spec.architecture.relationships.filter((relationship) =>
    ids.has(qualifiedRefIdentity(relationship.from)) || ids.has(qualifiedRefIdentity(relationship.to)));
}
