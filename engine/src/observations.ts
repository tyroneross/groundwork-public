import { z } from "zod";
import {
  ComponentSchema,
  ContractSchema,
  FlowSchema,
  RelationshipSchema,
  SpecDependencySchema,
} from "./architecture.js";
import {
  ChangeRecordSchema,
  PlatformTargetSchema,
  SpecSchema,
  type Spec,
} from "./spec.js";
import {
  PlatformSurfaceSchema,
  PlatformSurfacesSchema,
  deriveLegacyPlatformTarget,
  replacePrimarySurface,
  type PlatformSurface,
} from "./platform-topology.js";

const IdSchema = z.string().min(1).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const RelativePathSchema = z.string().min(1).max(500).superRefine((value, ctx) => {
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Source paths must be relative POSIX paths." });
  }
  if (value.split("/").some((part) => part === ".." || part === "")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Source paths may not traverse or contain empty segments." });
  }
});

export const ObservationProvenanceSchema = z.enum(["observed", "decided", "assumed"]);

export const ObservationFieldSchema = z.enum([
  "platformSurfaces",
  "architecture.components",
  "architecture.contracts",
  "architecture.relationships",
  "architecture.flows",
  "architecture.specDependencies",
  "governance.constraints",
  "governance.decisions",
  "governance.owners",
  "changeSet.current",
  "changeSet.proposed",
  "changeSet.verified",
]);

export const ObservationSourceRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("survey"), nodeId: IdSchema }).strict(),
  z.object({ kind: z.literal("repo"), path: RelativePathSchema }).strict(),
  z.object({ kind: z.literal("artifact"), path: RelativePathSchema }).strict(),
  z.object({ kind: z.literal("agent"), id: IdSchema }).strict(),
]);

export const ObservationTargetSchema = z.object({
  field: ObservationFieldSchema,
  entityId: IdSchema,
}).strict();

export const ObservationSchema = z.object({
  id: IdSchema,
  target: ObservationTargetSchema,
  value: z.unknown(),
  provenance: ObservationProvenanceSchema,
  sourceRefs: z.array(ObservationSourceRefSchema).min(1),
  confidence: z.number().min(0).max(1).optional(),
}).strict().superRefine((observation, ctx) => {
  if (!("value" in observation)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "Observation value is required." });
  }
});

export const UnresolvedObservationSchema = z.object({
  field: ObservationFieldSchema,
  reason: z.string().min(1),
}).strict();

export const ObservationBatchSchema = z.object({
  contract: z.literal("groundwork.observation-batch/v1"),
  specId: IdSchema,
  observations: z.array(ObservationSchema),
  unresolved: z.array(UnresolvedObservationSchema),
}).strict().superRefine((batch, ctx) => {
  const observationIds = new Set<string>();
  const targets = new Set<string>();
  batch.observations.forEach((observation, index) => {
    if (observationIds.has(observation.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["observations", index, "id"],
        message: `Duplicate observation ID: ${observation.id}`,
      });
    }
    observationIds.add(observation.id);

    const target = `${observation.target.field}:${observation.target.entityId}`;
    if (targets.has(target)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["observations", index, "target"],
        message: `Duplicate observation target: ${target}`,
      });
    }
    targets.add(target);
  });

  const unresolvedFields = new Set<string>();
  batch.unresolved.forEach((entry, index) => {
    if (unresolvedFields.has(entry.field)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unresolved", index, "field"],
        message: `Duplicate unresolved field: ${entry.field}`,
      });
    }
    if (batch.observations.some((observation) => observation.target.field === entry.field)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unresolved", index, "field"],
        message: `Field ${entry.field} cannot be both observed and unresolved.`,
      });
    }
    unresolvedFields.add(entry.field);
  });
});

export type ObservationProvenance = z.infer<typeof ObservationProvenanceSchema>;
export type ObservationField = z.infer<typeof ObservationFieldSchema>;
export type ObservationSourceRef = z.infer<typeof ObservationSourceRefSchema>;
export type ObservationTarget = z.infer<typeof ObservationTargetSchema>;
export type Observation = z.infer<typeof ObservationSchema>;
export type UnresolvedObservation = z.infer<typeof UnresolvedObservationSchema>;
export type ObservationBatch = z.infer<typeof ObservationBatchSchema>;

const FIELD_ORDER = new Map(
  ObservationFieldSchema.options.map((field, index) => [field, index]),
);

function compareObservations(left: Observation, right: Observation): number {
  return (FIELD_ORDER.get(left.target.field)! - FIELD_ORDER.get(right.target.field)!)
    || left.target.entityId.localeCompare(right.target.entityId)
    || left.id.localeCompare(right.id);
}

function upsertById<T extends { id: string }>(items: readonly T[], value: T): T[] {
  return [...items.filter((item) => item.id !== value.id), value]
    .sort((left, right) => left.id.localeCompare(right.id));
}

function requireEntityId(value: { id: string }, observation: Observation): void {
  if (value.id !== observation.target.entityId) {
    throw new Error(
      `Observation ${observation.id} targets ${observation.target.entityId} but its value has ID ${value.id}.`,
    );
  }
}

function parseWithProvenance<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown,
  provenance: ObservationProvenance,
): z.output<TSchema> {
  return schema.parse({ ...(value as object), provenance }) as z.output<TSchema>;
}

function addUniqueString(values: readonly string[], value: string): string[] {
  return [...new Set([...values, value])].sort((left, right) => left.localeCompare(right));
}

/**
 * Apply explicit v3 observations to a candidate and validate the complete result.
 * Unresolved fields remain unchanged; the mapper never synthesizes architecture.
 */
export function applyObservationBatch(candidate: unknown, inputBatch: unknown): Spec {
  const batch = ObservationBatchSchema.parse(inputBatch);
  const draft = structuredClone(SpecSchema.parse(candidate));
  if (draft.id !== batch.specId) {
    throw new Error(`Observation batch targets ${batch.specId}, but candidate Spec is ${draft.id}.`);
  }

  for (const observation of [...batch.observations].sort(compareObservations)) {
    switch (observation.target.field) {
      case "platformSurfaces": {
        const parsed = parseWithProvenance(PlatformSurfaceSchema, observation.value, observation.provenance);
        requireEntityId(parsed, observation);
        const current = draft.platformSurfaces as PlatformSurface[];
        draft.platformSurfaces = parsed.role === "primary"
          ? replacePrimarySurface(current, parsed)
          : PlatformSurfacesSchema.parse(upsertById(current, parsed));
        break;
      }
      case "architecture.components": {
        const parsed = parseWithProvenance(ComponentSchema, observation.value, observation.provenance);
        requireEntityId(parsed, observation);
        draft.architecture.components = upsertById(draft.architecture.components, parsed);
        break;
      }
      case "architecture.contracts": {
        const parsed = parseWithProvenance(ContractSchema, observation.value, observation.provenance);
        requireEntityId(parsed, observation);
        draft.architecture.contracts = upsertById(draft.architecture.contracts, parsed);
        break;
      }
      case "architecture.relationships": {
        const parsed = parseWithProvenance(RelationshipSchema, observation.value, observation.provenance);
        requireEntityId(parsed, observation);
        draft.architecture.relationships = upsertById(draft.architecture.relationships, parsed);
        break;
      }
      case "architecture.flows": {
        const parsed = parseWithProvenance(FlowSchema, observation.value, observation.provenance);
        requireEntityId(parsed, observation);
        draft.architecture.flows = upsertById(draft.architecture.flows, parsed);
        break;
      }
      case "architecture.specDependencies": {
        const parsed = SpecDependencySchema.parse(observation.value);
        requireEntityId(parsed, observation);
        draft.architecture.specDependencies = upsertById(draft.architecture.specDependencies, parsed);
        break;
      }
      case "governance.constraints": {
        const value = z.string().min(1).parse(observation.value);
        draft.governance.constraints = addUniqueString(draft.governance.constraints, value);
        break;
      }
      case "governance.decisions": {
        const value = IdSchema.parse(observation.value);
        draft.governance.decisions = addUniqueString(draft.governance.decisions, value);
        break;
      }
      case "governance.owners": {
        const value = z.string().min(1).parse(observation.value);
        draft.governance.owners = addUniqueString(draft.governance.owners, value);
        break;
      }
      case "changeSet.current":
      case "changeSet.proposed":
      case "changeSet.verified": {
        const bucket = observation.target.field.split(".")[1] as "current" | "proposed" | "verified";
        const parsed = parseWithProvenance(ChangeRecordSchema, observation.value, observation.provenance);
        requireEntityId(parsed, observation);
        draft.changeSet[bucket] = upsertById(draft.changeSet[bucket], parsed);
        break;
      }
    }
  }

  draft.platformTarget = PlatformTargetSchema.parse(
    deriveLegacyPlatformTarget(draft.platformSurfaces),
  );
  return SpecSchema.parse(draft);
}
