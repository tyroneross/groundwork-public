import { createHash } from "node:crypto";
import * as v from "./validation.js";
import { ArchitectureSchema, QualifiedRefSchema, qualifiedRefIdentity } from "./architecture.js";
import { PlatformSurfaceSchema } from "./platform-topology.js";
import { externalManualActionSecretReason } from "./spec.js";
import { OwnedFilesSchema } from "./owned-files.js";

export const BUILD_REQUEST_CONTRACT = "groundwork.build-request/v1" as const;
export const IMPLEMENTATION_MAP_CONTRACT = "build-loop.implementation-map/v1" as const;
export const CONVERGENCE_CONTRACT = "groundwork.convergence/v1" as const;
export const SUPPORTED_IMPLEMENTATION_MAP_VERSIONS = [IMPLEMENTATION_MAP_CONTRACT] as const;
export const SUPPORTED_CONVERGENCE_VERSIONS = [CONVERGENCE_CONTRACT] as const;

const IdSchema = v.string().min(1);
const NonEmptyStringSchema = v.string().min(1);
const DigestSchema = v.string().regex(/^sha256:[a-f0-9]{64}$/);
const DateTimeSchema = v.string().datetime({ offset: true });
const EMPTY_DIGEST = `sha256:${"0".repeat(64)}`;

export const BuildTaskSchema = v.object({
  id: IdSchema,
  title: NonEmptyStringSchema,
  componentRefs: v.array(QualifiedRefSchema),
  contractRefs: v.array(QualifiedRefSchema),
  requirementIds: v.array(IdSchema),
  dependsOn: v.array(IdSchema),
  acceptanceCriterionIds: v.array(IdSchema),
  ownedFiles: OwnedFilesSchema.optional(),
}).strict();

export const BuildAcceptanceCriterionSchema = v.object({
  id: IdSchema,
  statement: NonEmptyStringSchema,
  testHint: v.string().optional(),
}).strict();

export const BuildManualActionSchema = v.object({
  id: IdSchema,
  location: NonEmptyStringSchema,
  action: NonEmptyStringSchema,
  requiredValueName: NonEmptyStringSchema,
  destination: NonEmptyStringSchema,
  verification: NonEmptyStringSchema,
}).strict().superRefine((action, ctx) => {
  for (const field of ["id", "location", "action", "requiredValueName", "destination", "verification"] as const) {
    const reason = externalManualActionSecretReason(action[field]);
    if (reason) {
      ctx.addIssue({
        code: "custom",
        path: [field],
        message: `Build manual actions may name required values or permissions, but must not contain actual secrets (${reason}).`,
      });
    }
  }
});

export const ReturnVersionsSchema = v.object({
  implementationMap: v.array(v.literal(IMPLEMENTATION_MAP_CONTRACT)).min(1),
  convergence: v.array(v.literal(CONVERGENCE_CONTRACT)).min(1),
}).strict();

export const BuildRequestSchema = v.object({
  contract: v.literal(BUILD_REQUEST_CONTRACT),
  runId: IdSchema,
  specId: IdSchema,
  specDigest: DigestSchema,
  taskDigest: DigestSchema,
  platformSurfaces: v.array(PlatformSurfaceSchema).min(1),
  architecture: ArchitectureSchema,
  tasks: v.array(BuildTaskSchema).min(1),
  acceptanceCriteria: v.array(BuildAcceptanceCriterionSchema),
  manualActions: v.array(BuildManualActionSchema),
  returnVersions: ReturnVersionsSchema,
  requestDigest: DigestSchema,
  createdAt: DateTimeSchema,
}).strict();

export const ImplementationProducerSchema = v.object({
  name: v.literal("build-loop"),
  version: NonEmptyStringSchema,
  commit: v.string().min(7).optional(),
}).strict();

export const ImplementationMappingKindSchema = v.enum([
  "task",
  "component",
  "contract",
  "requirement",
]);

export const ImplementationMappingStatusSchema = v.enum([
  "not-started",
  "implemented",
  "verified",
  "blocked",
  "manual",
  "diverged",
]);

export const ImplementationMappingSchema = v.object({
  id: IdSchema,
  kind: ImplementationMappingKindSchema,
  targetId: IdSchema,
  status: ImplementationMappingStatusSchema,
  fileRefs: v.array(NonEmptyStringSchema),
  symbolRefs: v.array(NonEmptyStringSchema),
  commitRefs: v.array(v.string().min(7)),
  testEvidenceIds: v.array(IdSchema),
  runtimeEvidenceIds: v.array(IdSchema),
  deviationIds: v.array(IdSchema).optional(),
}).strict();

export const ImplementationEvidenceKindSchema = v.enum(["test", "runtime", "inspection"]);
export const ImplementationEvidenceOutcomeSchema = v.enum(["passed", "failed", "blocked", "manual"]);

export const ImplementationEvidenceSchema = v.object({
  id: IdSchema,
  kind: ImplementationEvidenceKindSchema,
  command: NonEmptyStringSchema,
  outcome: ImplementationEvidenceOutcomeSchema,
  summary: v.string().optional(),
  artifactDigest: DigestSchema.optional(),
  recordedAt: DateTimeSchema,
}).strict();

export const ImplementationDeviationSchema = v.object({
  id: IdSchema,
  targetId: IdSchema,
  summary: NonEmptyStringSchema,
  impact: v.enum(["none", "low", "medium", "high", "blocking"]),
}).strict();

export const ImplementationMapSchema = v.object({
  contract: v.literal(IMPLEMENTATION_MAP_CONTRACT),
  runId: IdSchema,
  buildRequestDigest: DigestSchema,
  specDigest: DigestSchema,
  taskDigest: DigestSchema,
  producer: ImplementationProducerSchema,
  mappings: v.array(ImplementationMappingSchema),
  evidence: v.array(ImplementationEvidenceSchema),
  deviations: v.array(ImplementationDeviationSchema),
  implementationMapDigest: DigestSchema,
  createdAt: DateTimeSchema,
}).strict();

export const ConvergenceStatusSchema = v.enum([
  "unverified",
  "implemented",
  "verified",
  "diverged",
  "blocked",
  "manual",
]);

export const ConvergenceSummarySchema = v.object({
  unverified: v.number().int().min(0),
  implemented: v.number().int().min(0),
  verified: v.number().int().min(0),
  diverged: v.number().int().min(0),
  blocked: v.number().int().min(0),
  manual: v.number().int().min(0),
}).strict();

export const ConvergenceItemSchema = v.object({
  kind: ImplementationMappingKindSchema,
  targetId: IdSchema,
  status: ConvergenceStatusSchema,
  mappingIds: v.array(IdSchema),
  evidenceIds: v.array(IdSchema),
  reason: NonEmptyStringSchema,
}).strict();

export const ConvergenceSchema = v.object({
  contract: v.literal(CONVERGENCE_CONTRACT),
  runId: IdSchema,
  specDigest: DigestSchema,
  taskDigest: DigestSchema,
  buildRequestDigest: DigestSchema,
  implementationMapDigest: DigestSchema,
  calculatedBy: v.object({
    name: v.literal("groundwork"),
    version: NonEmptyStringSchema,
  }).strict(),
  summary: ConvergenceSummarySchema,
  items: v.array(ConvergenceItemSchema),
  calculatedAt: DateTimeSchema,
}).strict();

export type BuildTask = v.Infer<typeof BuildTaskSchema>;
export type BuildAcceptanceCriterion = v.Infer<typeof BuildAcceptanceCriterionSchema>;
export type BuildManualAction = v.Infer<typeof BuildManualActionSchema>;
export type ReturnVersions = v.Infer<typeof ReturnVersionsSchema>;
export type BuildRequest = v.Infer<typeof BuildRequestSchema>;
export type BuildRequestDraft = Omit<BuildRequest, "specDigest" | "taskDigest" | "requestDigest">;
export type ImplementationProducer = v.Infer<typeof ImplementationProducerSchema>;
export type ImplementationMappingKind = v.Infer<typeof ImplementationMappingKindSchema>;
export type ImplementationMappingStatus = v.Infer<typeof ImplementationMappingStatusSchema>;
export type ImplementationMapping = v.Infer<typeof ImplementationMappingSchema>;
export type ImplementationEvidenceKind = v.Infer<typeof ImplementationEvidenceKindSchema>;
export type ImplementationEvidenceOutcome = v.Infer<typeof ImplementationEvidenceOutcomeSchema>;
export type ImplementationEvidence = v.Infer<typeof ImplementationEvidenceSchema>;
export type ImplementationDeviation = v.Infer<typeof ImplementationDeviationSchema>;
export type ImplementationMap = v.Infer<typeof ImplementationMapSchema>;
export type ImplementationMapDraft = Omit<
  ImplementationMap,
  "runId" | "buildRequestDigest" | "specDigest" | "taskDigest" | "implementationMapDigest"
>;
export type ConvergenceStatus = v.Infer<typeof ConvergenceStatusSchema>;
export type ConvergenceSummary = v.Infer<typeof ConvergenceSummarySchema>;
export type ConvergenceItem = v.Infer<typeof ConvergenceItemSchema>;
export type Convergence = v.Infer<typeof ConvergenceSchema>;

export interface ExchangeValidationIssue {
  path: Array<string | number>;
  message: string;
}

export class ExchangeValidationError extends Error {
  readonly issues: ExchangeValidationIssue[];

  constructor(issues: ExchangeValidationIssue[]) {
    super(issues.map((issue) => `${formatPath(issue.path)}: ${issue.message}`).join("\n"));
    this.name = "ExchangeValidationError";
    this.issues = issues.map((issue) => ({ ...issue, path: [...issue.path] }));
  }
}

type JsonPrimitive = null | boolean | number | string;
type NormalizedJson = JsonPrimitive | NormalizedJson[] | { [key: string]: NormalizedJson };

function normalizeJsonValue(value: unknown, path: Array<string | number>, ancestors: Set<object>): NormalizedJson {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${formatPath(path)} must be a finite JSON number.`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError(`${formatPath(path)} contains a circular JSON value.`);
    const nextAncestors = new Set(ancestors).add(value);
    return value.map((entry, index) => normalizeJsonValue(entry, [...path, index], nextAncestors));
  }
  if (typeof value === "object") {
    if (ancestors.has(value)) throw new TypeError(`${formatPath(path)} contains a circular JSON value.`);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${formatPath(path)} must contain only plain JSON objects.`);
    }
    const nextAncestors = new Set(ancestors).add(value);
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record).sort().map((key) => [
        key,
        normalizeJsonValue(record[key], [...path, key], nextAncestors),
      ]),
    );
  }
  throw new TypeError(`${formatPath(path)} contains unsupported JSON value ${typeof value}.`);
}

/** Recursively key-sorted UTF-8 JSON with array order preserved and no whitespace. */
export function normalizeJson(value: unknown): string {
  return JSON.stringify(normalizeJsonValue(value, [], new Set()));
}

/** Lowercase SHA-256 over the contract-normalized UTF-8 JSON bytes. */
export function digestNormalizedJson(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(normalizeJson(value), "utf8").digest("hex")}`;
}

export function calculateSpecDigest(canonicalSpec: unknown): `sha256:${string}` {
  return digestNormalizedJson(canonicalSpec);
}

export function calculateTaskDigest(tasks: readonly BuildTask[]): `sha256:${string}` {
  return digestNormalizedJson(tasks);
}

export function calculateBuildRequestDigest(
  request: BuildRequest | Omit<BuildRequest, "requestDigest">,
): `sha256:${string}` {
  const projection = { ...(request as BuildRequest) } as Partial<BuildRequest>;
  delete projection.requestDigest;
  return digestNormalizedJson(projection);
}

export function calculateImplementationMapDigest(
  implementationMap: ImplementationMap | Omit<ImplementationMap, "implementationMapDigest">,
): `sha256:${string}` {
  const projection = { ...(implementationMap as ImplementationMap) } as Partial<ImplementationMap>;
  delete projection.implementationMapDigest;
  return digestNormalizedJson(projection);
}

/** Bind the canonical Spec, final ordered tasks, and request self-digest. */
export function bindBuildRequest(draft: BuildRequestDraft, canonicalSpec: unknown): BuildRequest {
  const withBindings = BuildRequestSchema.parse({
    ...draft,
    specDigest: calculateSpecDigest(canonicalSpec),
    taskDigest: calculateTaskDigest(draft.tasks),
    requestDigest: EMPTY_DIGEST,
  });
  const request = BuildRequestSchema.parse({
    ...withBindings,
    requestDigest: calculateBuildRequestDigest(withBindings),
  });
  return validateBuildRequest(request, canonicalSpec);
}

/** Bind a Build Loop-owned return to one immutable request and its self-digest. */
export function bindImplementationMap(
  request: BuildRequest,
  draft: ImplementationMapDraft,
): ImplementationMap {
  throwIfIssues(validateRequestEnvelope(request));
  const withBindings = ImplementationMapSchema.parse({
    ...draft,
    runId: request.runId,
    buildRequestDigest: request.requestDigest,
    specDigest: request.specDigest,
    taskDigest: request.taskDigest,
    implementationMapDigest: EMPTY_DIGEST,
  });
  const implementationMap = ImplementationMapSchema.parse({
    ...withBindings,
    implementationMapDigest: calculateImplementationMapDigest(withBindings),
  });
  return validateImplementationMap(request, implementationMap);
}

/** Validate request structure, supported versions, and all three request bindings. */
export function validateBuildRequest(request: unknown, canonicalSpec: unknown): BuildRequest {
  const parsed = BuildRequestSchema.parse(request);
  const issues = validateRequestEnvelope(parsed);
  if (parsed.specDigest !== calculateSpecDigest(canonicalSpec)) {
    issues.push({ path: ["specDigest"], message: "specDigest does not match the normalized canonical Spec." });
  }
  throwIfIssues(issues);
  return parsed;
}

/** Parse the exact return versions supported by this exchange implementation. */
export function validateReturnVersions(value: unknown): ReturnVersions {
  return ReturnVersionsSchema.parse(value);
}

/**
 * Validate the Build Loop-owned return without resolving paths or reading files.
 * The request itself must already have been validated against its canonical Spec.
 */
export function validateImplementationMap(
  requestInput: unknown,
  implementationMapInput: unknown,
): ImplementationMap {
  const request = BuildRequestSchema.parse(requestInput);
  const implementationMap = ImplementationMapSchema.parse(implementationMapInput);
  const issues = validateRequestEnvelope(request);

  if (implementationMap.runId !== request.runId) {
    issues.push({ path: ["runId"], message: `Expected runId ${request.runId}.` });
  }
  if (implementationMap.buildRequestDigest !== request.requestDigest) {
    issues.push({ path: ["buildRequestDigest"], message: "Return is not bound to this build request digest." });
  }
  if (implementationMap.specDigest !== request.specDigest) {
    issues.push({ path: ["specDigest"], message: "Return specDigest does not match the request." });
  }
  if (implementationMap.taskDigest !== request.taskDigest) {
    issues.push({ path: ["taskDigest"], message: "Return taskDigest does not match the request." });
  }
  if (implementationMap.implementationMapDigest !== calculateImplementationMapDigest(implementationMap)) {
    issues.push({ path: ["implementationMapDigest"], message: "implementationMapDigest does not match its normalized self-digest projection." });
  }

  const requestCreated = Date.parse(request.createdAt);
  const mapCreated = Date.parse(implementationMap.createdAt);
  if (mapCreated < requestCreated) {
    issues.push({ path: ["createdAt"], message: "Implementation map predates its build request." });
  }

  addDuplicateIdIssues(implementationMap.mappings, "mappings", issues);
  addDuplicateIdIssues(implementationMap.evidence, "evidence", issues);
  addDuplicateIdIssues(implementationMap.deviations, "deviations", issues);

  const evidenceById = new Map(implementationMap.evidence.map((evidence) => [evidence.id, evidence]));
  const deviationById = new Map(implementationMap.deviations.map((deviation) => [deviation.id, deviation]));
  const intendedTargets = collectIntendedTargets(request);

  implementationMap.evidence.forEach((evidence, evidenceIndex) => {
    const recordedAt = Date.parse(evidence.recordedAt);
    if (recordedAt < requestCreated || recordedAt > mapCreated) {
      issues.push({
        path: ["evidence", evidenceIndex, "recordedAt"],
        message: "Evidence timestamp must fall between the request and implementation-map timestamps.",
      });
    }
    for (const [field, value] of [["command", evidence.command], ["summary", evidence.summary]] as const) {
      if (value) addSensitiveTextIssues(value, ["evidence", evidenceIndex, field], issues);
    }
  });

  implementationMap.deviations.forEach((deviation, deviationIndex) => {
    if (!targetExists(intendedTargets, deviation.targetId)) {
      issues.push({ path: ["deviations", deviationIndex, "targetId"], message: `Unknown intended target ${deviation.targetId}.` });
    }
    addSensitiveTextIssues(deviation.summary, ["deviations", deviationIndex, "summary"], issues);
  });

  implementationMap.mappings.forEach((mapping, mappingIndex) => {
    const mappingPath: Array<string | number> = ["mappings", mappingIndex];
    if (!intendedTargets[mapping.kind].has(mapping.targetId)) {
      issues.push({
        path: [...mappingPath, "targetId"],
        message: `Unknown ${mapping.kind} target ${mapping.targetId}.`,
      });
    }

    addDuplicateValueIssues(mapping.fileRefs, [...mappingPath, "fileRefs"], issues);
    addDuplicateValueIssues(mapping.symbolRefs, [...mappingPath, "symbolRefs"], issues);
    addDuplicateValueIssues(mapping.commitRefs, [...mappingPath, "commitRefs"], issues);
    addDuplicateValueIssues(mapping.testEvidenceIds, [...mappingPath, "testEvidenceIds"], issues);
    addDuplicateValueIssues(mapping.runtimeEvidenceIds, [...mappingPath, "runtimeEvidenceIds"], issues);
    addDuplicateValueIssues(mapping.deviationIds ?? [], [...mappingPath, "deviationIds"], issues);

    mapping.fileRefs.forEach((fileRef, fileIndex) => {
      const reason = evidencePathRejectionReason(fileRef);
      if (reason) issues.push({ path: [...mappingPath, "fileRefs", fileIndex], message: reason });
    });
    mapping.symbolRefs.forEach((symbol, symbolIndex) => {
      addSensitiveTextIssues(symbol, [...mappingPath, "symbolRefs", symbolIndex], issues);
    });

    const referencedEvidence: ImplementationEvidence[] = [];
    mapping.testEvidenceIds.forEach((evidenceId, evidenceIndex) => {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence) {
        issues.push({ path: [...mappingPath, "testEvidenceIds", evidenceIndex], message: `Unknown evidence ${evidenceId}.` });
      } else if (evidence.kind !== "test") {
        issues.push({ path: [...mappingPath, "testEvidenceIds", evidenceIndex], message: `Evidence ${evidenceId} is ${evidence.kind}, not test evidence.` });
      } else {
        referencedEvidence.push(evidence);
      }
    });
    mapping.runtimeEvidenceIds.forEach((evidenceId, evidenceIndex) => {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence) {
        issues.push({ path: [...mappingPath, "runtimeEvidenceIds", evidenceIndex], message: `Unknown evidence ${evidenceId}.` });
      } else if (evidence.kind !== "runtime") {
        issues.push({ path: [...mappingPath, "runtimeEvidenceIds", evidenceIndex], message: `Evidence ${evidenceId} is ${evidence.kind}, not runtime evidence.` });
      } else {
        referencedEvidence.push(evidence);
      }
    });

    const codeEvidence = hasCodeEvidence(mapping);
    const passingVerification = referencedEvidence.some((evidence) => evidence.outcome === "passed");
    const evidenceRefs = mapping.testEvidenceIds.length > 0 || mapping.runtimeEvidenceIds.length > 0;
    const deviationRefs = (mapping.deviationIds ?? []).length > 0;
    if (mapping.status === "not-started" && (codeEvidence || evidenceRefs || deviationRefs)) {
      issues.push({
        path: [...mappingPath, "status"],
        message: "not-started must not include code, verification evidence, or deviations.",
      });
    }
    if ((mapping.status === "implemented" || mapping.status === "verified") && !codeEvidence) {
      issues.push({ path: [...mappingPath, "status"], message: `${mapping.status} requires mapped code evidence.` });
    }
    if (mapping.status === "implemented" && passingVerification) {
      issues.push({
        path: [...mappingPath, "status"],
        message: "implemented must not include passing test or runtime evidence; use verified.",
      });
    }
    if (mapping.status === "verified" && !passingVerification) {
      issues.push({ path: [...mappingPath, "status"], message: "verified requires passing test or runtime evidence." });
    }

    const deviations = (mapping.deviationIds ?? []).map((deviationId, deviationIndex) => {
      const deviation = deviationById.get(deviationId);
      if (!deviation) {
        issues.push({ path: [...mappingPath, "deviationIds", deviationIndex], message: `Unknown deviation ${deviationId}.` });
      } else if (deviation.targetId !== mapping.targetId) {
        issues.push({ path: [...mappingPath, "deviationIds", deviationIndex], message: `Deviation ${deviationId} targets ${deviation.targetId}, not ${mapping.targetId}.` });
      }
      return deviation;
    }).filter((deviation): deviation is ImplementationDeviation => Boolean(deviation));
    if (mapping.status === "diverged" && deviations.length === 0) {
      issues.push({ path: [...mappingPath, "status"], message: "diverged requires a declared deviation for the mapped target." });
    }
  });

  throwIfIssues(issues);
  return implementationMap;
}

export interface CalculateConvergenceOptions {
  groundworkVersion: string;
  calculatedAt: string;
}

/** Pure Groundwork-owned reduction from intended request plus validated evidence. */
export function calculateConvergence(
  requestInput: unknown,
  implementationMapInput: unknown,
  options: CalculateConvergenceOptions,
): Convergence {
  const request = BuildRequestSchema.parse(requestInput);
  const implementationMap = validateImplementationMap(request, implementationMapInput);
  if (!options.groundworkVersion) throw new TypeError("groundworkVersion must be non-empty.");
  DateTimeSchema.parse(options.calculatedAt);
  if (Date.parse(options.calculatedAt) < Date.parse(implementationMap.createdAt)) {
    throw new ExchangeValidationError([{ path: ["calculatedAt"], message: "Convergence cannot predate the implementation map." }]);
  }

  const evidenceById = new Map(implementationMap.evidence.map((evidence) => [evidence.id, evidence]));
  const mappingsByTarget = new Map<string, ImplementationMapping[]>();
  implementationMap.mappings.forEach((mapping) => {
    const key = targetKey(mapping.kind, mapping.targetId);
    const values = mappingsByTarget.get(key) ?? [];
    values.push(mapping);
    mappingsByTarget.set(key, values);
  });
  const deviationsByTarget = new Map<string, ImplementationDeviation[]>();
  implementationMap.deviations.forEach((deviation) => {
    const values = deviationsByTarget.get(deviation.targetId) ?? [];
    values.push(deviation);
    deviationsByTarget.set(deviation.targetId, values);
  });

  const intendedTargets = collectIntendedTargets(request);
  const kindOrder: ImplementationMappingKind[] = ["task", "component", "contract", "requirement"];
  const items: ConvergenceItem[] = [];
  kindOrder.forEach((kind) => {
    [...intendedTargets[kind]].sort().forEach((targetId) => {
      const mappings = [...(mappingsByTarget.get(targetKey(kind, targetId)) ?? [])]
        .sort((left, right) => left.id.localeCompare(right.id));
      const deviations = deviationsByTarget.get(targetId) ?? [];
      const evidenceIds = [...new Set(mappings.flatMap((mapping) => [
        ...mapping.testEvidenceIds,
        ...mapping.runtimeEvidenceIds,
      ]))].sort();
      const { status, reason } = deriveConvergenceStatus(mappings, deviations, evidenceById);
      items.push({
        kind,
        targetId,
        status,
        mappingIds: mappings.map((mapping) => mapping.id),
        evidenceIds,
        reason,
      });
    });
  });

  const summary: ConvergenceSummary = {
    unverified: 0,
    implemented: 0,
    verified: 0,
    diverged: 0,
    blocked: 0,
    manual: 0,
  };
  items.forEach((item) => { summary[item.status] += 1; });

  return ConvergenceSchema.parse({
    contract: CONVERGENCE_CONTRACT,
    runId: request.runId,
    specDigest: request.specDigest,
    taskDigest: request.taskDigest,
    buildRequestDigest: request.requestDigest,
    implementationMapDigest: implementationMap.implementationMapDigest,
    calculatedBy: { name: "groundwork", version: options.groundworkVersion },
    summary,
    items,
    calculatedAt: options.calculatedAt,
  });
}

/** Throws when a file reference is not a canonical, repository-relative evidence path. */
export function validateEvidencePath(value: string): string {
  const reason = evidencePathRejectionReason(value);
  if (reason) throw new ExchangeValidationError([{ path: ["fileRef"], message: reason }]);
  return value;
}

function validateRequestEnvelope(request: BuildRequest): ExchangeValidationIssue[] {
  const issues: ExchangeValidationIssue[] = [];
  if (!request.returnVersions.implementationMap.includes(IMPLEMENTATION_MAP_CONTRACT)) {
    issues.push({ path: ["returnVersions", "implementationMap"], message: `Unsupported implementation-map versions.` });
  }
  if (!request.returnVersions.convergence.includes(CONVERGENCE_CONTRACT)) {
    issues.push({ path: ["returnVersions", "convergence"], message: `Unsupported convergence versions.` });
  }
  if (request.taskDigest !== calculateTaskDigest(request.tasks)) {
    issues.push({ path: ["taskDigest"], message: "taskDigest does not match the final ordered task list." });
  }
  if (request.requestDigest !== calculateBuildRequestDigest(request)) {
    issues.push({ path: ["requestDigest"], message: "requestDigest does not match its normalized self-digest projection." });
  }

  addDuplicateIdIssues(request.tasks, "tasks", issues);
  addDuplicateIdIssues(request.acceptanceCriteria, "acceptanceCriteria", issues);
  addDuplicateIdIssues(request.manualActions, "manualActions", issues);
  addCrossKindTargetIdIssues(request, issues);
  const taskIds = new Set(request.tasks.map((task) => task.id));
  const taskPositions = new Map<string, number>();
  request.tasks.forEach((task, taskIndex) => {
    if (!taskPositions.has(task.id)) taskPositions.set(task.id, taskIndex);
  });
  const acceptanceIds = new Set(request.acceptanceCriteria.map((criterion) => criterion.id));
  const localComponentIds = new Set(request.architecture.components.map((component) => component.id));
  const localContractIds = new Set(request.architecture.contracts.map((contract) => contract.id));
  const dependencySpecIds = new Set(request.architecture.specDependencies.map((dependency) => dependency.specId));

  request.tasks.forEach((task, taskIndex) => {
    addDuplicateValueIssues(task.dependsOn, ["tasks", taskIndex, "dependsOn"], issues);
    addDuplicateValueIssues(task.requirementIds, ["tasks", taskIndex, "requirementIds"], issues);
    addDuplicateValueIssues(task.acceptanceCriterionIds, ["tasks", taskIndex, "acceptanceCriterionIds"], issues);
    addDuplicateValueIssues(task.componentRefs.map(qualifiedRefIdentity), ["tasks", taskIndex, "componentRefs"], issues);
    addDuplicateValueIssues(task.contractRefs.map(qualifiedRefIdentity), ["tasks", taskIndex, "contractRefs"], issues);

    task.dependsOn.forEach((dependencyId, dependencyIndex) => {
      const dependencyPosition = taskPositions.get(dependencyId);
      if (!taskIds.has(dependencyId) || dependencyPosition === undefined) {
        issues.push({ path: ["tasks", taskIndex, "dependsOn", dependencyIndex], message: `Unknown task dependency ${dependencyId}.` });
      } else if (dependencyPosition >= taskIndex) {
        issues.push({
          path: ["tasks", taskIndex, "dependsOn", dependencyIndex],
          message: `Task dependency ${dependencyId} must precede ${task.id} in the final ordered task list.`,
        });
      }
    });
    task.acceptanceCriterionIds.forEach((criterionId, criterionIndex) => {
      if (!acceptanceIds.has(criterionId)) {
        issues.push({ path: ["tasks", taskIndex, "acceptanceCriterionIds", criterionIndex], message: `Unknown acceptance criterion ${criterionId}.` });
      }
    });
    task.componentRefs.forEach((ref, refIndex) => {
      validateTaskRef(ref, "component", request.specId, localComponentIds, dependencySpecIds, ["tasks", taskIndex, "componentRefs", refIndex], issues);
    });
    task.contractRefs.forEach((ref, refIndex) => {
      validateTaskRef(ref, "contract", request.specId, localContractIds, dependencySpecIds, ["tasks", taskIndex, "contractRefs", refIndex], issues);
    });
  });
  return issues;
}

function addCrossKindTargetIdIssues(
  request: BuildRequest,
  issues: ExchangeValidationIssue[],
): void {
  const seen = new Map<string, ImplementationMappingKind>();
  const targets: Array<{ id: string; kind: ImplementationMappingKind; path: Array<string | number> }> = [
    ...request.tasks.map((task, index) => ({ id: task.id, kind: "task" as const, path: ["tasks", index, "id"] })),
    ...request.architecture.components.map((component, index) => ({
      id: component.id,
      kind: "component" as const,
      path: ["architecture", "components", index, "id"],
    })),
    ...request.architecture.contracts.map((contract, index) => ({
      id: contract.id,
      kind: "contract" as const,
      path: ["architecture", "contracts", index, "id"],
    })),
    ...request.tasks.flatMap((task, taskIndex) => task.requirementIds.map((id, requirementIndex) => ({
      id,
      kind: "requirement" as const,
      path: ["tasks", taskIndex, "requirementIds", requirementIndex],
    }))),
  ];

  targets.forEach((target) => {
    const firstKind = seen.get(target.id);
    if (!firstKind) {
      seen.set(target.id, target.kind);
    } else if (firstKind !== target.kind) {
      issues.push({
        path: target.path,
        message: `Target ID ${target.id} is reused across ${firstKind} and ${target.kind} kinds; intended target IDs must be globally unique across kinds.`,
      });
    }
  });
}

function validateTaskRef(
  ref: v.Infer<typeof QualifiedRefSchema>,
  expectedKind: "component" | "contract",
  specId: string,
  localIds: Set<string>,
  dependencySpecIds: Set<string>,
  path: Array<string | number>,
  issues: ExchangeValidationIssue[],
): void {
  if (ref.kind !== expectedKind) {
    issues.push({ path: [...path, "kind"], message: `Expected ${expectedKind} reference, received ${ref.kind}.` });
  }
  if (ref.specId === specId && !localIds.has(ref.id)) {
    issues.push({ path, message: `Unknown local ${expectedKind} ${ref.id}.` });
  }
  if (ref.specId !== specId && !dependencySpecIds.has(ref.specId)) {
    issues.push({ path: [...path, "specId"], message: `Remote reference has no declared Spec dependency for ${ref.specId}.` });
  }
}

function collectIntendedTargets(request: BuildRequest): Record<ImplementationMappingKind, Set<string>> {
  return {
    task: new Set(request.tasks.map((task) => task.id)),
    component: new Set(request.architecture.components.map((component) => component.id)),
    contract: new Set(request.architecture.contracts.map((contract) => contract.id)),
    requirement: new Set(request.tasks.flatMap((task) => task.requirementIds)),
  };
}

function targetExists(targets: Record<ImplementationMappingKind, Set<string>>, targetId: string): boolean {
  return Object.values(targets).some((values) => values.has(targetId));
}

function targetKey(kind: ImplementationMappingKind, targetId: string): string {
  return `${kind}:${targetId}`;
}

function hasCodeEvidence(mapping: ImplementationMapping): boolean {
  return mapping.fileRefs.length > 0 || mapping.symbolRefs.length > 0 || mapping.commitRefs.length > 0;
}

function deriveConvergenceStatus(
  mappings: readonly ImplementationMapping[],
  deviations: readonly ImplementationDeviation[],
  evidenceById: ReadonlyMap<string, ImplementationEvidence>,
): { status: ConvergenceStatus; reason: string } {
  if (mappings.some((mapping) => mapping.status === "manual")) {
    return { status: "manual", reason: "Build Loop declared the intended entity manual." };
  }
  if (mappings.some((mapping) => mapping.status === "blocked")) {
    return { status: "blocked", reason: "Build Loop declared the intended entity blocked." };
  }
  if (deviations.length > 0 || mappings.some((mapping) => mapping.status === "diverged")) {
    return { status: "diverged", reason: "Build Loop declared a deviation from the intended entity." };
  }
  const codeMappings = mappings.filter(hasCodeEvidence);
  if (codeMappings.length === 0) {
    return { status: "unverified", reason: "No mapped code evidence was returned." };
  }
  const hasPassingVerification = codeMappings.some((mapping) => [
    ...mapping.testEvidenceIds,
    ...mapping.runtimeEvidenceIds,
  ].some((evidenceId) => evidenceById.get(evidenceId)?.outcome === "passed"));
  if (hasPassingVerification) {
    return { status: "verified", reason: "Mapped code includes passing test or runtime evidence." };
  }
  return { status: "implemented", reason: "Mapped code was returned without passing test or runtime evidence." };
}

function addDuplicateIdIssues(
  values: readonly { id: string }[],
  collection: string,
  issues: ExchangeValidationIssue[],
): void {
  const seen = new Map<string, number>();
  values.forEach((value, index) => {
    const firstIndex = seen.get(value.id);
    if (firstIndex !== undefined) {
      issues.push({ path: [collection, index, "id"], message: `Duplicate ID ${value.id}; first declared at ${collection}.${firstIndex}.id.` });
    } else {
      seen.set(value.id, index);
    }
  });
}

function addDuplicateValueIssues(
  values: readonly string[],
  path: Array<string | number>,
  issues: ExchangeValidationIssue[],
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) issues.push({ path: [...path, index], message: `Duplicate value ${value}.` });
    seen.add(value);
  });
}

function evidencePathRejectionReason(value: string): string | undefined {
  if (!value || value.includes("\0")) return "Evidence path must be a non-empty repository-relative path.";
  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("/") || value.startsWith("\\\\") || value.startsWith("~")) {
    return "Evidence path must not be absolute or home-relative.";
  }
  if (value.includes("\\")) return "Evidence paths must use repository-relative forward slashes.";
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return "Evidence path must not be a URL or URI.";

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return "Evidence path contains invalid percent encoding.";
  }
  if (decoded.includes("\\")) return "Evidence paths must use repository-relative forward slashes.";
  const segments = decoded.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return "Evidence path must not contain empty, current-directory, or traversal segments.";
  }
  const privateSegments = new Set([".git", ".ssh", ".aws", ".gnupg", ".env", "secrets", "credentials"]);
  const privateNames = /^(?:credentials(?:\.[^.]+)?|secrets?(?:\.[^.]+)?|id_(?:rsa|dsa|ecdsa|ed25519))$/i;
  if (segments.some((segment) => {
    const lower = segment.toLowerCase();
    const privateEnv = lower.startsWith(".env.") && lower !== ".env.example";
    return privateSegments.has(lower) || privateEnv || privateNames.test(segment);
  })) {
    return "Evidence path points to a private or credential-bearing location.";
  }
  return undefined;
}

function addSensitiveTextIssues(
  value: string,
  path: Array<string | number>,
  issues: ExchangeValidationIssue[],
): void {
  if (containsCredentialBearingUrl(value)) {
    issues.push({ path, message: "Credential-bearing URLs are not valid implementation evidence." });
  }
  if (containsAbsolutePrivatePath(value)) {
    issues.push({ path, message: "Absolute private paths are not valid implementation evidence." });
  }
}

function containsCredentialBearingUrl(value: string): boolean {
  const candidates = value.match(/[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>]+/g) ?? [];
  return candidates.some((candidate) => {
    const cleaned = candidate.replace(/[),.;!?]+$/, "");
    try {
      const url = new URL(cleaned);
      if (url.username || url.password) return true;
      for (const key of url.searchParams.keys()) {
        if (/(?:token|secret|password|passwd|api[-_]?key|credential|signature|access[-_]?key)/i.test(key)) return true;
      }
      return false;
    } catch {
      return true;
    }
  });
}

function containsAbsolutePrivatePath(value: string): boolean {
  return /(?:^|[\s"'(])(?:\/(?:Users|home|root|var\/folders)\/[^\s"')]+|[A-Za-z]:\\Users\\[^\s"')]+)/i.test(value);
}

function throwIfIssues(issues: ExchangeValidationIssue[]): void {
  if (issues.length === 0) return;
  issues.sort((left, right) => formatPath(left.path).localeCompare(formatPath(right.path))
    || left.message.localeCompare(right.message));
  throw new ExchangeValidationError(issues);
}

function formatPath(path: readonly (string | number)[]): string {
  return path.length ? path.join(".") : "$";
}
