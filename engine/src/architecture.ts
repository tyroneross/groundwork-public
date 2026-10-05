import { z } from "zod";
import { OwnedFilesSchema } from "./owned-files.js";

const IdSchema = z.string().min(1).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const NonEmptyStringSchema = z.string().min(1);

function uniqueStringArraySchema() {
  return z.array(NonEmptyStringSchema).superRefine((values, ctx) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: `Duplicate value: ${value}`,
        });
      }
      seen.add(value);
    });
  });
}

export const ProvenanceSchema = z.enum(["observed", "decided", "assumed", "derived"]);

export const QualifiedRefKindSchema = z.enum([
  "component",
  "contract",
  "feature",
  "screen",
  "element",
  "requirement",
  "flow",
  "task",
]);

export const QualifiedRefSchema = z.object({
  specId: IdSchema,
  kind: QualifiedRefKindSchema,
  id: IdSchema,
}).strict();

/** Explicit pointer from an architecture exchange to one authored UI state. */
export const ScreenStateRefSchema = z.object({
  screenId: IdSchema,
  state: NonEmptyStringSchema,
}).strict();

const UniqueQualifiedRefsSchema = z.array(QualifiedRefSchema).min(1).superRefine((refs, ctx) => {
  const seen = new Set<string>();
  refs.forEach((ref, index) => {
    const identity = qualifiedRefIdentity(ref);
    if (seen.has(identity)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: `Duplicate qualified reference: ${identity}`,
      });
    }
    seen.add(identity);
  });
});

export const PortDirectionSchema = z.enum(["input", "output", "bidirectional"]);

export const PortSchema = z.object({
  id: IdSchema,
  name: NonEmptyStringSchema,
  type: NonEmptyStringSchema,
  direction: PortDirectionSchema,
  required: z.boolean().default(true),
}).strict();

export const ComponentKindSchema = z.enum([
  "ui",
  "service",
  "data",
  "integration",
  "agent",
  "library",
  "platform",
]);

export const ComponentSchema = z.object({
  id: IdSchema,
  name: NonEmptyStringSchema,
  kind: ComponentKindSchema,
  featureIds: uniqueStringArraySchema(),
  owner: NonEmptyStringSchema,
  /** Optional runtime/data ownership boundary; `owner` remains the accountable team. */
  ownership: z.array(NonEmptyStringSchema).optional(),
  description: z.string().optional(),
  provenance: ProvenanceSchema.optional(),
  ownedFiles: OwnedFilesSchema.optional(),
}).strict();

export const ContractSchema = z.object({
  id: IdSchema,
  name: NonEmptyStringSchema,
  provider: QualifiedRefSchema,
  consumers: UniqueQualifiedRefsSchema,
  ports: z.array(PortSchema).min(1),
  transport: NonEmptyStringSchema,
  failureModes: z.array(NonEmptyStringSchema).min(1),
  securityNotes: z.array(NonEmptyStringSchema).min(1),
  /** Named writes this boundary may perform; prose stays available for legacy contracts. */
  writeBoundaryNotes: z.array(NonEmptyStringSchema).optional(),
  provenance: ProvenanceSchema.optional(),
  ownedFiles: OwnedFilesSchema.optional(),
}).strict();

export const RelationshipDirectionSchema = z.enum([
  "unidirectional",
  "bidirectional",
  "event",
]);

export const RelationshipCriticalitySchema = z.enum(["hard", "soft", "informational"]);

export const RelationshipSchema = z.object({
  id: IdSchema,
  from: QualifiedRefSchema,
  to: QualifiedRefSchema,
  direction: RelationshipDirectionSchema,
  contractRef: QualifiedRefSchema.optional(),
  criticality: RelationshipCriticalitySchema,
  optional: z.boolean(),
  rationale: NonEmptyStringSchema,
  provenance: ProvenanceSchema.optional(),
}).strict();

export const ExchangeSchema = z.object({
  id: IdSchema,
  order: z.number().int().min(1),
  from: QualifiedRefSchema,
  to: QualifiedRefSchema,
  contractRef: QualifiedRefSchema,
  inputRefs: z.array(QualifiedRefSchema),
  outputRefs: z.array(QualifiedRefSchema),
  stateRefs: z.array(ScreenStateRefSchema).default([]),
  failurePaths: z.array(NonEmptyStringSchema).min(1),
  effects: z.array(NonEmptyStringSchema).optional(),
  writes: z.array(NonEmptyStringSchema).optional(),
}).strict();

export const FlowSchema = z.object({
  id: IdSchema,
  name: NonEmptyStringSchema,
  trigger: NonEmptyStringSchema,
  exchanges: z.array(ExchangeSchema).min(1),
  provenance: ProvenanceSchema.optional(),
}).strict();

export const SpecDependencyLocationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("local"),
    path: NonEmptyStringSchema,
  }).strict(),
  z.object({
    kind: z.literal("uri"),
    uri: z.string().url(),
  }).strict(),
]);

export const SpecDependencyRelationshipSchema = z.enum([
  "uses",
  "extends",
  "implements",
  "companion",
]);

export const SpecDependencySchema = z.object({
  id: IdSchema,
  specId: IdSchema,
  location: SpecDependencyLocationSchema,
  schemaVersion: z.number().int().min(1),
  revision: NonEmptyStringSchema,
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  relationship: SpecDependencyRelationshipSchema,
  optional: z.boolean().default(false),
}).strict();

/**
 * Structural Spec v3 architecture schema. Spec-aware reference validation lives
 * in `validateArchitecture`, because an Architecture object does not itself
 * contain the current Spec ID or the Spec's feature/screen/element identities.
 */
export const ArchitectureSchema = z.object({
  components: z.array(ComponentSchema),
  contracts: z.array(ContractSchema),
  relationships: z.array(RelationshipSchema),
  flows: z.array(FlowSchema),
  specDependencies: z.array(SpecDependencySchema),
}).strict();

export type Provenance = z.infer<typeof ProvenanceSchema>;
export type QualifiedRefKind = z.infer<typeof QualifiedRefKindSchema>;
export type QualifiedRef = z.infer<typeof QualifiedRefSchema>;
export type ScreenStateRef = z.infer<typeof ScreenStateRefSchema>;
export type PortDirection = z.infer<typeof PortDirectionSchema>;
export type Port = z.infer<typeof PortSchema>;
export type ComponentKind = z.infer<typeof ComponentKindSchema>;
export type Component = z.infer<typeof ComponentSchema>;
export type Contract = z.infer<typeof ContractSchema>;
export type RelationshipDirection = z.infer<typeof RelationshipDirectionSchema>;
export type RelationshipCriticality = z.infer<typeof RelationshipCriticalitySchema>;
export type Relationship = z.infer<typeof RelationshipSchema>;
export type Exchange = z.infer<typeof ExchangeSchema>;
export type Flow = z.infer<typeof FlowSchema>;
export type SpecDependencyLocation = z.infer<typeof SpecDependencyLocationSchema>;
export type SpecDependencyRelationship = z.infer<typeof SpecDependencyRelationshipSchema>;
export type SpecDependency = z.infer<typeof SpecDependencySchema>;
export type Architecture = z.infer<typeof ArchitectureSchema>;

export type ArchitectureValidationIssueCode =
  | "duplicate_id"
  | "duplicate_qualified_identity"
  | "duplicate_order"
  | "invalid_reference_kind"
  | "dangling_local_reference"
  | "undeclared_spec_dependency"
  | "hard_dependency_cycle";

export interface ArchitectureValidationIssue {
  code: ArchitectureValidationIssueCode;
  path: Array<string | number>;
  message: string;
  referencePath?: QualifiedRef[];
}

export interface ArchitectureValidationContext {
  /** ID of the Spec that owns this Architecture object. */
  specId: string;
  /**
   * Complete local identities not declared by Architecture itself, such as
   * features, screens, elements, requirements, and tasks.
   */
  localRefs: readonly QualifiedRef[];
  /** Already-resolved remote identities, used only for duplicate detection. */
  resolvedRefs?: readonly QualifiedRef[];
}

export function qualifiedRefIdentity(ref: QualifiedRef): string {
  return `${ref.specId}:${ref.kind}:${ref.id}`;
}

function pathIdentity(path: readonly (string | number)[]): string {
  return path.map((part) => typeof part === "number" ? String(part).padStart(10, "0") : part).join(".");
}

function compareIssues(left: ArchitectureValidationIssue, right: ArchitectureValidationIssue): number {
  return pathIdentity(left.path).localeCompare(pathIdentity(right.path))
    || left.code.localeCompare(right.code)
    || left.message.localeCompare(right.message);
}

function copyRef(ref: QualifiedRef): QualifiedRef {
  return { specId: ref.specId, kind: ref.kind, id: ref.id };
}

/**
 * Validate semantics that require the owning Spec's identity graph.
 *
 * The result is deterministic and does not mutate or reorder the architecture.
 * Local references are fail-closed. Remote references must name a declared
 * Spec dependency, but this module never reads the filesystem or resolves URIs.
 */
export function validateArchitecture(
  architecture: Architecture,
  context: ArchitectureValidationContext,
): ArchitectureValidationIssue[] {
  const issues: ArchitectureValidationIssue[] = [];
  const knownIdentities = new Map<string, Array<string | number>>();

  const addIssue = (issue: ArchitectureValidationIssue) => issues.push(issue);

  const registerIdentity = (ref: QualifiedRef, path: Array<string | number>) => {
    const identity = qualifiedRefIdentity(ref);
    const firstPath = knownIdentities.get(identity);
    if (firstPath) {
      addIssue({
        code: "duplicate_qualified_identity",
        path,
        message: `Duplicate qualified identity ${identity}; first declared at ${pathIdentity(firstPath)}`,
      });
      return;
    }
    knownIdentities.set(identity, path);
  };

  const flagDuplicateIds = <T extends { id: string }>(
    values: readonly T[],
    basePath: string,
  ) => {
    const seen = new Map<string, number>();
    values.forEach((value, index) => {
      const firstIndex = seen.get(value.id);
      if (firstIndex !== undefined) {
        addIssue({
          code: "duplicate_id",
          path: [basePath, index, "id"],
          message: `Duplicate ${basePath} ID ${value.id}; first declared at ${basePath}.${firstIndex}.id`,
        });
      } else {
        seen.set(value.id, index);
      }
    });
  };

  flagDuplicateIds(architecture.components, "components");
  flagDuplicateIds(architecture.contracts, "contracts");
  flagDuplicateIds(architecture.relationships, "relationships");
  flagDuplicateIds(architecture.flows, "flows");
  flagDuplicateIds(architecture.specDependencies, "specDependencies");

  const ports = architecture.contracts.flatMap((contract, contractIndex) =>
    contract.ports.map((port, portIndex) => ({ ...port, path: ["contracts", contractIndex, "ports", portIndex, "id"] as Array<string | number> })),
  );
  const seenPortIds = new Map<string, Array<string | number>>();
  ports.forEach((port) => {
    const firstPath = seenPortIds.get(port.id);
    if (firstPath) {
      addIssue({
        code: "duplicate_id",
        path: port.path,
        message: `Duplicate port ID ${port.id}; first declared at ${pathIdentity(firstPath)}`,
      });
    } else {
      seenPortIds.set(port.id, port.path);
    }
  });

  const exchanges = architecture.flows.flatMap((flow, flowIndex) =>
    flow.exchanges.map((exchange, exchangeIndex) => ({
      exchange,
      flowIndex,
      exchangeIndex,
      path: ["flows", flowIndex, "exchanges", exchangeIndex] as Array<string | number>,
    })),
  );
  const seenExchangeIds = new Map<string, Array<string | number>>();
  exchanges.forEach(({ exchange, path }) => {
    const idPath = [...path, "id"];
    const firstPath = seenExchangeIds.get(exchange.id);
    if (firstPath) {
      addIssue({
        code: "duplicate_id",
        path: idPath,
        message: `Duplicate exchange ID ${exchange.id}; first declared at ${pathIdentity(firstPath)}`,
      });
    } else {
      seenExchangeIds.set(exchange.id, idPath);
    }
  });

  architecture.flows.forEach((flow, flowIndex) => {
    const seenOrders = new Map<number, number>();
    flow.exchanges.forEach((exchange, exchangeIndex) => {
      const firstIndex = seenOrders.get(exchange.order);
      if (firstIndex !== undefined) {
        addIssue({
          code: "duplicate_order",
          path: ["flows", flowIndex, "exchanges", exchangeIndex, "order"],
          message: `Duplicate exchange order ${exchange.order}; first declared at flows.${flowIndex}.exchanges.${firstIndex}.order`,
        });
      } else {
        seenOrders.set(exchange.order, exchangeIndex);
      }
    });
  });

  architecture.components.forEach((component, index) => {
    registerIdentity(
      { specId: context.specId, kind: "component", id: component.id },
      ["components", index, "id"],
    );
  });
  architecture.contracts.forEach((contract, index) => {
    registerIdentity(
      { specId: context.specId, kind: "contract", id: contract.id },
      ["contracts", index, "id"],
    );
  });
  architecture.flows.forEach((flow, index) => {
    registerIdentity(
      { specId: context.specId, kind: "flow", id: flow.id },
      ["flows", index, "id"],
    );
  });
  context.localRefs.forEach((ref, index) => registerIdentity(ref, ["$localRefs", index]));
  context.resolvedRefs?.forEach((ref, index) => registerIdentity(ref, ["$resolvedRefs", index]));

  const dependencySpecIds = new Map<string, number>();
  architecture.specDependencies.forEach((dependency, index) => {
    const firstIndex = dependencySpecIds.get(dependency.specId);
    if (firstIndex !== undefined) {
      addIssue({
        code: "duplicate_qualified_identity",
        path: ["specDependencies", index, "specId"],
        message: `Duplicate Spec dependency target ${dependency.specId}; first declared at specDependencies.${firstIndex}.specId`,
      });
    } else {
      dependencySpecIds.set(dependency.specId, index);
    }
  });

  const checkRef = (
    ref: QualifiedRef,
    path: Array<string | number>,
    expectedKind?: QualifiedRefKind,
  ) => {
    if (expectedKind && ref.kind !== expectedKind) {
      addIssue({
        code: "invalid_reference_kind",
        path: [...path, "kind"],
        message: `Expected ${expectedKind} reference at ${pathIdentity(path)}, received ${ref.kind}`,
      });
    }

    const identity = qualifiedRefIdentity(ref);
    if (ref.specId === context.specId) {
      if (!knownIdentities.has(identity)) {
        addIssue({
          code: "dangling_local_reference",
          path,
          message: `Unknown local reference: ${identity}`,
        });
      }
    } else if (!dependencySpecIds.has(ref.specId)) {
      addIssue({
        code: "undeclared_spec_dependency",
        path: [...path, "specId"],
        message: `Remote reference ${identity} has no declared Spec dependency for ${ref.specId}`,
      });
    }
  };

  architecture.components.forEach((component, componentIndex) => {
    component.featureIds.forEach((featureId, featureIndex) => {
      checkRef(
        { specId: context.specId, kind: "feature", id: featureId },
        ["components", componentIndex, "featureIds", featureIndex],
        "feature",
      );
    });
  });

  architecture.contracts.forEach((contract, contractIndex) => {
    checkRef(contract.provider, ["contracts", contractIndex, "provider"], "component");
    contract.consumers.forEach((consumer, consumerIndex) => {
      checkRef(consumer, ["contracts", contractIndex, "consumers", consumerIndex], "component");
    });
  });

  architecture.relationships.forEach((relationship, relationshipIndex) => {
    checkRef(relationship.from, ["relationships", relationshipIndex, "from"], "component");
    checkRef(relationship.to, ["relationships", relationshipIndex, "to"], "component");
    if (relationship.contractRef) {
      checkRef(relationship.contractRef, ["relationships", relationshipIndex, "contractRef"], "contract");
    }
  });

  architecture.flows.forEach((flow, flowIndex) => {
    flow.exchanges.forEach((exchange, exchangeIndex) => {
      const basePath: Array<string | number> = ["flows", flowIndex, "exchanges", exchangeIndex];
      checkRef(exchange.from, [...basePath, "from"], "component");
      checkRef(exchange.to, [...basePath, "to"], "component");
      checkRef(exchange.contractRef, [...basePath, "contractRef"], "contract");
      exchange.inputRefs.forEach((ref, refIndex) => {
        checkRef(ref, [...basePath, "inputRefs", refIndex]);
      });
      exchange.outputRefs.forEach((ref, refIndex) => {
        checkRef(ref, [...basePath, "outputRefs", refIndex]);
      });
    });
  });

  const hardCycle = findHardDependencyCycle(architecture.relationships);
  if (hardCycle) {
    addIssue({
      code: "hard_dependency_cycle",
      path: ["relationships", hardCycle.closingRelationshipIndex],
      message: `Hard dependency cycle: ${hardCycle.refs.map(qualifiedRefIdentity).join(" -> ")}`,
      referencePath: hardCycle.refs.map(copyRef),
    });
  }

  return issues.sort(compareIssues);
}

interface CycleEdge {
  to: string;
  relationshipIndex: number;
}

interface HardCycle {
  refs: QualifiedRef[];
  closingRelationshipIndex: number;
}

function findHardDependencyCycle(relationships: readonly Relationship[]): HardCycle | undefined {
  const refsByIdentity = new Map<string, QualifiedRef>();
  const adjacency = new Map<string, CycleEdge[]>();

  const addEdge = (from: QualifiedRef, to: QualifiedRef, relationshipIndex: number) => {
    if (from.kind !== "component" || to.kind !== "component") return;
    const fromIdentity = qualifiedRefIdentity(from);
    const toIdentity = qualifiedRefIdentity(to);
    refsByIdentity.set(fromIdentity, from);
    refsByIdentity.set(toIdentity, to);
    const edges = adjacency.get(fromIdentity) ?? [];
    edges.push({ to: toIdentity, relationshipIndex });
    adjacency.set(fromIdentity, edges);
  };

  relationships.forEach((relationship, relationshipIndex) => {
    if (relationship.criticality !== "hard") return;
    addEdge(relationship.from, relationship.to, relationshipIndex);
    if (relationship.direction === "bidirectional") {
      addEdge(relationship.to, relationship.from, relationshipIndex);
    }
  });

  adjacency.forEach((edges) => {
    edges.sort((left, right) => left.to.localeCompare(right.to)
      || left.relationshipIndex - right.relationshipIndex);
  });

  const state = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];

  const visit = (identity: string): HardCycle | undefined => {
    state.set(identity, "visiting");
    stack.push(identity);

    for (const edge of adjacency.get(identity) ?? []) {
      if (state.get(edge.to) === "visiting") {
        const cycleStart = stack.indexOf(edge.to);
        const cycleIdentities = [...stack.slice(cycleStart), edge.to];
        return {
          refs: cycleIdentities.map((entry) => copyRef(refsByIdentity.get(entry)!)),
          closingRelationshipIndex: edge.relationshipIndex,
        };
      }
      if (state.get(edge.to) !== "visited") {
        const cycle = visit(edge.to);
        if (cycle) return cycle;
      }
    }

    stack.pop();
    state.set(identity, "visited");
    return undefined;
  };

  const identities = [...refsByIdentity.keys()].sort();
  for (const identity of identities) {
    if (!state.has(identity)) {
      const cycle = visit(identity);
      if (cycle) return cycle;
    }
  }
  return undefined;
}
