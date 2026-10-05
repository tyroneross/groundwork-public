// ───────────────────────────────────────────────────────────────────────
// Groundwork — typed Spec domain schema (pure zod)
//
// Ported from ProductPilot's shared/schema.ts zod block (the "Adaptive intake /
// structured spec" section). Drizzle tables, drizzle-zod, and createInsertSchema
// were intentionally left behind — this module imports ONLY from `zod` and is the
// single source of truth for the structured Spec object that flows through
// intake, doc generation, the spec linter, and the coding-agent handoff.
//
// Conventions:
//   - Every entity carries a stable string `id`. Cross-references use these ids
//     so the trace matrix is computable without LLM help.
//   - "because" clauses on stance entries and non-goals are required by the
//     PRD-Builder methodology and become linter rules downstream.
//
// Groundwork extensions (SPEC.md §"Zod Spec additions needed"):
//   - EARS-shaped acceptance criteria on requirements (needs) and features.
//   - observability section (SLIs/SLOs).
//   - boundaries block (always / askFirst / never).
//   - voiceProfile (voice principles + do/don't word lists).
// All four are OPTIONAL so specs authored before they landed still validate.
// ───────────────────────────────────────────────────────────────────────

import { z } from "zod";
import {
  ArchitectureSchema,
  ProvenanceSchema,
  QualifiedRefSchema,
  ScreenStateRefSchema,
  validateArchitecture,
  type QualifiedRef,
} from "./architecture.js";
import {
  PlatformSchema,
  PlatformSurfacesSchema,
  PlatformTopologySchema,
  type Platform,
  type PlatformSurface,
} from "./platform-topology.js";
import { DeclaredNewFileSchema, OwnedFileSchema, OwnedFilesSchema } from "./owned-files.js";

const IdSchema = z.string().min(1);
const Priority = z.enum(["P0", "P1", "P2", "P3"]).optional();
const Severity = z.enum(["block", "warn", "info"]);
const Reversibility = z.enum(["high", "medium", "low"]);

// ── Groundwork extension: EARS acceptance criterion ──────────────────────
// `ears` is a "WHEN … THE SYSTEM SHALL …" statement. Attached (optionally) to
// requirements and features so acceptance criteria carry a stable id + an
// EARS-shaped assertion the linter and handoff can trace to tests.
export const EarsCriterionSchema = z.object({
  id: IdSchema,
  ears: z.string(), // "WHEN <trigger>, THE SYSTEM SHALL <response>."
});

// ── Groundwork extension: NFR forcing-field template ─────────────────────
// The six fields a spec must answer for a requirement to be buildable without
// the implementer inventing them. Every field is optional HERE — the renderer
// is the forcing surface: an empty field emits a TAG:UNRESOLVED prompt naming
// what is missing, rather than silently omitting the section. Attachable at the
// spec level (global posture) and per-feature (local override).
export const NfrSchema = z.object({
  /** Test levels + what each proves, e.g. "unit for reducers, e2e for checkout". */
  testStrategy: z.string().optional(),
  edgeCases: z.array(z.string()).default([]),
  errorHandling: z.array(z.string()).default([]),
  validation: z.array(z.string()).default([]),
  security: z.array(z.string()).default([]),
  accessibility: z.array(z.string()).default([]),
});

export const NeedSchema = z.object({
  id: IdSchema,
  title: z.string(),
  description: z.string().optional(),
  priority: Priority,
  source: z.string().optional(), // intake question id or "inferred"
  // Groundwork: EARS-shaped acceptance criteria for this requirement.
  ears: z.array(EarsCriterionSchema).optional(),
  // Groundwork: the pillar(s) this requirement serves. Empty means "not yet
  // traced to a pillar" — the trace builder reports that as a coverage gap
  // only when the Spec actually declares pillars.
  pillarIds: z.array(IdSchema).default([]),
});

export const FeatureSchema = z.object({
  id: IdSchema,
  title: z.string(),
  description: z.string().optional(),
  surface: z.enum(["unspecified", "ui", "api", "tool", "command", "event", "headless"]).default("unspecified"),
  priority: Priority,
  needIds: z.array(IdSchema).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  // Groundwork: EARS-shaped acceptance criteria for this feature.
  ears: z.array(EarsCriterionSchema).optional(),
  // Groundwork: per-feature NFR override. When present its non-empty fields
  // land in this feature's task definition-of-done; when absent the feature
  // inherits the spec-level `nfr` posture.
  nfr: NfrSchema.optional(),
  ownedFiles: OwnedFilesSchema.optional(),
});

export const PersonaSchema = z.object({
  id: IdSchema,
  name: z.string(),
  trigger: z.string().optional(),
  exclusions: z.array(z.string()).default([]), // "Who they are NOT"
  jobs: z.array(z.string()).default([]),
});

export const ScenarioSchema = z.object({
  id: IdSchema,
  personaId: IdSchema.optional(),
  context: z.string(),
  goal: z.string(),
  successSignal: z.string().optional(),
});

// ── Groundwork extension: element-level data I/O (pointer-grade) ────────────
// Attached to a screen element so a mockup can declare what data it needs and
// what it shows without Groundwork owning the full persistence spec. Optional
// so screens/elements authored before this landed still validate.
export const ElementDataInSchema = z.object({
  source: z.enum(["user-entry", "search", "computed", "fetched", "none"]),
  expectedType: z.string().optional(),
  note: z.string().optional(),
});
export const ElementDataOutSchema = z.object({
  shows: z.string().optional(),
  expectedType: z.string().optional(),
  note: z.string().optional(),
});
export const ScreenElementSchema = z.object({
  id: IdSchema,
  name: z.string(),
  role: z.string().optional(),
  // Pointer-grade: what data this element needs / displays, not an
  // authoritative persistence or data-flow spec.
  dataIn: ElementDataInSchema.optional(),
  dataOut: ElementDataOutSchema.optional(),
});

export const ScreenSchema = z.object({
  id: IdSchema,
  name: z.string(),
  purpose: z.string(),
  featureIds: z.array(IdSchema).default([]),
  primaryAction: z.string().optional(),
  states: z.array(z.string()).default([]),
  // Groundwork: per-screen design-card fields the DESIGN.md 6-field card needs
  // (purpose/elements/data/states/interactions/rationale). Both optional so
  // screens authored before they landed still validate.
  // UI elements on the screen; `role` is a free-form affordance hint.
  elements: z.array(ScreenElementSchema).optional(),
  // Data the screen reads/writes; `source` is a free-form origin hint
  // (e.g. a dataPoint id, an API path, "local", …).
  data: z.array(z.object({
    field: z.string(),
    source: z.string().optional(),
  })).optional(),
  ownedFiles: OwnedFilesSchema.optional(),
});

export const UXFlowSchema = z.object({
  id: IdSchema,
  name: z.string(),
  steps: z.array(z.string()).default([]),
  screenIds: z.array(IdSchema).default([]),
});

export const DataPointSchema = z.object({
  id: IdSchema,
  name: z.string(),
  type: z.string(), // free-form: "string", "uuid", "decimal(12,2)", etc.
  description: z.string().optional(),
  pii: z.boolean().default(false),
  // Required when pii=true. Linter treats missing handlingNote as a non-waivable
  // block. Schema does NOT enforce here; the linter is the surface that explains
  // the policy.
  handlingNote: z.string().optional(),
});

// ── Groundwork extension: pointer-grade entity/data-model layer ────────────
// A first-class but pointer-scoped data entity linked to the features and
// elements that read or write it. Identifies what kind of data is needed
// where — NOT an authoritative migration or data-flow specification; that
// detail lives downstream in build-loop. Optional/additive so existing specs
// (which carry no dataModel) still validate.
export const DataModelFieldSchema = z.object({
  name: z.string(),
  type: z.string().optional(),
  note: z.string().optional(),
});
export const DataModelEntitySchema = z.object({
  id: IdSchema,
  name: z.string(),
  description: z.string().optional(),
  fields: z.array(DataModelFieldSchema).default([]),
  readByFeatureIds: z.array(IdSchema).optional(),
  writtenByFeatureIds: z.array(IdSchema).optional(),
  // Free-form pointers into screen elements (e.g. "screen-today:Current streak
  // counter") rather than a strict IdSchema, since screen elements don't carry
  // their own stable id.
  elementRefs: z.array(z.string()).optional(),
  ownedFiles: z.array(OwnedFileSchema).default([]),
});

const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{12,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
];

const SECRET_ASSIGNMENT_PATTERN = new RegExp(
  String.raw`\b(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password|passwd|private[-_ ]?key|secret|credential|authorization)\b\s*(?:=|:|\bis\b)`,
  "i",
);

function containsCredentialBearingUrl(value: string): boolean {
  const candidates = value.match(/[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>]+/g) ?? [];
  return candidates.some((candidate) => {
    const cleaned = candidate.replace(/[),.;!?]+$/, "");
    try {
      const url = new URL(cleaned);
      if (url.username || url.password) return true;
      return [...url.searchParams.keys()].some((key) =>
        /(?:token|secret|password|passwd|api[-_]?key|credential|signature|access[-_]?key)/i.test(key));
    } catch {
      return false;
    }
  });
}

/** Return why manual-action text is unsafe to persist, if it contains a secret value. */
export function externalManualActionSecretReason(value: string): string | undefined {
  if (containsCredentialBearingUrl(value)) return "credential-bearing URL";
  if (SECRET_ASSIGNMENT_PATTERN.test(value)) return "credential assignment";
  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) return "secret-shaped value";
  return undefined;
}

export const ExternalManualActionSchema = z.object({
  id: IdSchema,
  surface: z.string().min(1),
  action: z.string().min(1),
  // A name such as STRIPE_SECRET_KEY or "HealthKit read permission" — never
  // the credential/permission value itself.
  requiredValue: z.string().min(1),
  appDestination: z.string().min(1),
  verification: z.string().min(1),
}).strict().superRefine((action, ctx) => {
  for (const field of ["id", "surface", "action", "requiredValue", "appDestination", "verification"] as const) {
    const reason = externalManualActionSecretReason(action[field]);
    if (reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: `External manual actions may name required values or permissions, but must not contain actual secrets (${reason}).`,
      });
    }
  }
});

/** Defensive publication boundary for callers that constructed a typed Spec without parsing it. */
export function validateExternalManualActionForPublication(value: unknown) {
  return ExternalManualActionSchema.parse(value);
}

export const IntegrationSchema = z.object({
  id: IdSchema,
  name: z.string(),
  purpose: z.string(),
  authMode: z.string().optional(),
  docsUrl: z.string().url().optional(),
  featureIds: z.array(IdSchema).default([]),
  ownedFiles: z.array(OwnedFileSchema).default([]),
  requiredEnv: z.array(z.string()).default([]),
  codeSetup: z.array(z.string().min(1)).default([]),
  unclassifiedSetup: z.array(z.string().min(1)).default([]),
  externalManualActions: z.array(ExternalManualActionSchema).default([]),
  verification: z
    .array(z.string().min(1))
    .min(1, "Every integration must declare at least one provider verification step."),
}).strict();

export const APIContractSchema = z.object({
  id: IdSchema,
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string(),
  description: z.string().optional(),
  requestSchema: z.string().optional(),
  responseSchema: z.string().optional(),
  featureIds: z.array(IdSchema).default([]),
  ownedFiles: z.array(OwnedFileSchema).default([]),
});

export const TestSchema = z.object({
  id: IdSchema,
  description: z.string(),
  dependsOnTestIds: z.array(IdSchema).default([]),
  needIds: z.array(IdSchema).default([]),
  featureIds: z.array(IdSchema).default([]),
  screenIds: z.array(IdSchema).default([]),
  // Optional pointer-grade coverage for an authored state on a screen.
  stateRefs: z.array(ScreenStateRefSchema).default([]),
  integrationIds: z.array(IdSchema).default([]),
  platformSurfaceIds: z.array(IdSchema).default([]),
  ownedFiles: z.array(OwnedFileSchema).default([]),
  kind: z.enum(["acceptance", "smoke", "unit", "manual"]).default("acceptance"),
  // Free-form framework name. Linter pattern-matches per platformTarget:
  //   web|vite-spa  → /vitest|jest|playwright/i
  //   ios|macos     → /xctest|swift testing/i
  //   claude-plugin → /plugin-builder|manifest-validator|skill-validator|hook-validator|command-validator/i
  // Empty string → linter blocker (waivable).
  testFramework: z.string().default(""),
  // Exact repository command when known. A production-ready handoff must not
  // substitute an unresolved scheme, destination, package, or script name.
  command: z.string().min(1).optional(),
  // Optional validator references — used primarily by claude-plugin platform target where each
  // command/skill/hook artifact must point at a validator (manifest-validator, skill-validator, etc.).
  validatorRefs: z.array(z.string()).default([]),
});

// ── Reproducible product/design contract (optional Spec v3 extension) ──────
// These records capture intended behavior and the evidence needed to rebuild a
// visual direction. They deliberately reference the existing Spec graph rather
// than creating a second document authority.
export const DecisionRigiditySchema = z.enum(["locked", "leaning", "open", "experimental", "superseded"]);
export const ContractScopeSchema = z.object({
  kind: z.enum(["product", "screen", "element", "component", "behavior", "architecture"]),
  refs: z.array(IdSchema).min(1),
}).strict();
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema),
]));
export const PredicateSchema = z.object({
  subjectRef: IdSchema,
  propertyPath: z.string().min(1),
  operator: z.enum(["eq", "neq", "in", "not-in", "exists", "not-exists", "gte", "lte", "contains", "excludes"]),
  value: JsonValueSchema.optional(),
}).strict();
export const EffectSchema = z.object({
  kind: z.enum(["state-change", "create", "update", "delete", "schedule", "notify", "navigate", "none"]),
  targetRef: IdSchema,
  propertyPath: z.string().min(1).optional(),
  value: JsonValueSchema.optional(),
}).strict();
export const WriteSchema = z.object({
  storeRef: IdSchema,
  entity: z.string().min(1),
  fields: z.array(z.string().min(1)).default([]),
  mode: z.enum(["create", "update", "delete"]),
}).strict();
export const UserFeedbackSchema = z.object({
  channel: z.enum(["inline", "toast", "modal", "notification", "none"]),
  timing: z.enum(["immediate", "deferred"]),
  message: z.string().min(1).optional(),
}).strict();
export const FailureRecoverySchema = z.object({
  failureCondition: PredicateSchema,
  strategy: z.enum(["retry", "rollback", "resume", "manual", "none"]),
  toStateId: IdSchema.optional(),
  guidance: z.string().min(1),
}).strict();
export const ConfirmationSchema = z.object({
  required: z.boolean(),
  when: PredicateSchema.optional(),
  message: z.string().min(1).optional(),
}).strict();
export const BehaviorActionSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  fromStateIds: z.array(IdSchema).default([]),
  toStateId: IdSchema.optional(),
  effects: z.array(EffectSchema).default([]),
  writes: z.array(WriteSchema).default([]),
  prohibitedWrites: z.array(WriteSchema).default([]),
  feedback: UserFeedbackSchema.optional(),
  failure: FailureRecoverySchema.optional(),
  recovery: FailureRecoverySchema.optional(),
  confirmation: ConfirmationSchema.optional(),
}).strict();
export const BehaviorStateSchema = z.object({ id: IdSchema, name: z.string().min(1), visibleRefs: z.array(IdSchema).default([]) }).strict();
export const BehaviorTransitionSchema = z.object({ fromStateId: IdSchema, actionId: IdSchema, toStateId: IdSchema }).strict();
export const InformationFlowSchema = z.object({
  sourceRef: IdSchema, targetRef: IdSchema, data: z.string().min(1), transform: z.string().min(1).optional(),
  classification: z.enum(["public", "local-private", "sensitive"]), persistence: z.enum(["none", "session", "durable"]),
}).strict();
export const VerificationSchema = z.object({
  id: IdSchema, kind: z.enum(["schema", "assertion", "hash", "snapshot", "ibr", "manual"]),
  targetRefs: z.array(IdSchema).default([]), method: z.string().min(1), passCriteria: z.array(PredicateSchema).default([]),
}).strict();
export const BehaviorContractSchema = z.object({
  id: IdSchema, name: z.string().min(1), scope: ContractScopeSchema, trigger: z.string().min(1),
  preconditions: z.array(PredicateSchema).default([]), states: z.array(BehaviorStateSchema).default([]),
  actions: z.array(BehaviorActionSchema).default([]), transitions: z.array(BehaviorTransitionSchema).default([]),
  invariants: z.array(z.string().min(1)).default([]), informationFlow: z.array(InformationFlowSchema).default([]),
  verificationRefs: z.array(IdSchema).default([]),
}).strict();
export const BaselineArtifactSchema = z.object({
  id: IdSchema, path: z.string().min(1), type: z.string().min(1), digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();
export const BaselinePrecedenceSchema = z.object({ rank: z.number().int().min(1), artifactId: IdSchema }).strict();
export const DesignConstraintSchema = z.object({
  id: IdSchema, kind: z.enum(["exact", "relational", "behavioral", "architectural"]), scope: ContractScopeSchema,
  targetRef: IdSchema, propertyPath: z.string().min(1), operator: PredicateSchema.shape.operator,
  value: JsonValueSchema.optional(), unit: z.string().min(1).optional(), tolerance: z.number().min(0).optional(),
  sourceArtifactId: IdSchema.optional(), verificationRefs: z.array(IdSchema).default([]),
}).strict();
export const DesignDeltaSchema = z.object({
  id: IdSchema, baselineId: IdSchema.optional(), targetRefs: z.array(IdSchema).min(1),
  operation: z.enum(["add", "remove", "replace", "reorder", "preserve"]), before: JsonValueSchema.optional(), after: JsonValueSchema.optional(),
  direction: z.string().min(1), verificationRefs: z.array(IdSchema).default([]),
}).strict();
export const DesignContractSchema = z.object({
  intent: z.object({
    type: z.literal("conformance"),
    evidenceRefs: z.array(IdSchema).min(1),
    acceptanceTestRef: IdSchema,
    verificationRefs: z.array(IdSchema).min(1),
  }).strict().optional(),
  baseline: z.object({
    disposition: z.enum(["observed", "declared", "not-applicable"]), id: IdSchema.optional(), version: z.string().min(1).optional(),
    status: DecisionRigiditySchema.optional(), scope: ContractScopeSchema.optional(), supersedes: IdSchema.optional(), environment: z.record(z.string(), JsonValueSchema).default({}),
    artifacts: z.array(BaselineArtifactSchema).default([]), precedence: z.array(BaselinePrecedenceSchema).default([]),
  }).strict(),
  constraints: z.array(DesignConstraintSchema).default([]),
  direction: z.object({ summary: z.string().min(1), intentRefs: z.array(IdSchema).default([]), mustPreserve: z.array(z.string().min(1)).default([]), mayVary: z.array(z.string().min(1)).default([]) }).strict(),
  deltas: z.array(DesignDeltaSchema).default([]), verification: z.array(VerificationSchema).default([]),
}).strict();

export const ADRSchema = z.object({
  id: IdSchema,
  title: z.string(),
  context: z.string(),
  decision: z.string(),
  consequences: z.string().optional(),
  reversibility: Reversibility,
  // Cites tradeoff weights and stance "because" clauses.
  cites: z.array(z.string()).default([]),
  rigidity: DecisionRigiditySchema.optional(),
  scope: ContractScopeSchema.optional(),
  constraintRefs: z.array(IdSchema).optional(),
  mustPreserve: z.array(z.string().min(1)).optional(),
  mayVary: z.array(z.string().min(1)).optional(),
  changePolicy: z.string().min(1).optional(),
  supersededBy: IdSchema.optional(),
});

export const AssumptionSchema = z.object({
  id: IdSchema,
  text: z.string(),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
});

export const RiskSchema = z.object({
  id: IdSchema,
  text: z.string(),
  likelihood: z.enum(["high", "medium", "low"]).default("medium"),
  impact: z.enum(["high", "medium", "low"]).default("medium"),
  mitigation: z.string().optional(),
});

// Agent systems need a harness spec, not only app requirements. These schemas
// capture the Agent Builder / Prompt Builder primitives: autonomy, topology,
// tool permissions, memory, guardrails, research evidence, UI archetype, and
// eval coverage.
export const AgentArchitecturePatternSchema = z.enum([
  "single-agent",
  "sequential",
  "router",
  "orchestrator-worker",
  "evaluator-optimizer",
  "interactive",
  "multi-agent",
  "hybrid",
]);

export const AgentAutonomyLevelSchema = z.enum([
  "draft-only",
  "human-in-loop",
  "supervised",
  "autonomous",
]);

export const AgentBuilderScaleSchema = z.enum(["skill", "plugin", "agent", "human"]);

export const AgentToolPermissionTierSchema = z.enum(["T0", "T1", "T2", "T3", "T4", "T5"]);

export const AgentToolContractSchema = z.object({
  id: IdSchema,
  name: z.string(),
  purpose: z.string(),
  permissionTier: AgentToolPermissionTierSchema.default("T1"),
  allowedActions: z.array(z.string()).default([]),
  forbiddenActions: z.array(z.string()).default([]),
  dataAccess: z.string().optional(),
  sideEffects: z.array(z.string()).default([]),
  requiresHumanApproval: z.boolean().default(false),
  auditLog: z.string().optional(),
  rollbackPlan: z.string().optional(),
  failureMode: z.string().optional(),
});

export const AgentModelRouteSchema = z.object({
  id: IdSchema,
  purpose: z.string(),
  provider: z.string().optional(),
  modelTier: z.string().optional(),
  promptContract: z.string().optional(),
});

export const AgentGuardrailSchema = z.object({
  id: IdSchema,
  appliesTo: z.array(z.string()).default([]),
  trigger: z.string(),
  check: z.string(),
  action: z.string(),
  severity: Severity.default("warn"),
  escalation: z.string().optional(),
});

export const AgentEvaluationSchema = z.object({
  id: IdSchema,
  name: z.string(),
  metric: z.string(),
  coverageRefs: z.array(IdSchema).default([]),
  blocking: z.boolean().default(false),
});

export const AgentResearchProtocolSchema = z.object({
  sourcePolicy: z.string().optional(),
  evidenceStandard: z.string().optional(),
  confidencePolicy: z.string().optional(),
  citationRequired: z.boolean().default(false),
  evidenceRefs: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
});

export const AgentUiProtocolSchema = z.object({
  archetype: z.enum([
    "ai-agent-chat",
    "editor-workbench",
    "data-research-tool",
    "saas-dashboard",
    "internal-admin",
    "content-publication",
    "commerce-checkout",
  ]).optional(),
  designMode: z.string().optional(),
  userResearchQuestions: z.array(z.string()).default([]),
  highRiskFailures: z.array(z.string()).default([]),
});

export const AgentSystemSchema = z.object({
  mission: z.string().optional(),
  systemBoundary: z.object({
    inScope: z.array(z.string()).default([]),
    outOfScope: z.array(z.string()).default([]),
  }).default({ inScope: [], outOfScope: [] }),
  builderScale: AgentBuilderScaleSchema.optional(),
  architecturePattern: AgentArchitecturePatternSchema.optional(),
  autonomyLevel: AgentAutonomyLevelSchema.optional(),
  stateOwner: z.string().optional(),
  stopCondition: z.string().optional(),
  modelRoutes: z.array(AgentModelRouteSchema).default([]),
  toolContracts: z.array(AgentToolContractSchema).default([]),
  memoryPolicy: z.string().optional(),
  researchProtocol: AgentResearchProtocolSchema.optional(),
  uiProtocol: AgentUiProtocolSchema.optional(),
  guardrails: z.array(AgentGuardrailSchema).default([]),
  evaluations: z.array(AgentEvaluationSchema).default([]),
  humanCheckpoints: z.array(z.string()).default([]),
  traceabilityRefs: z.array(z.string()).default([]),
});

// Stance "because" clause from PRD-Builder Q3. Captures the qualitative judgment
// that complements numeric tradeoffWeights.
export const StanceBecauseClauseSchema = z.object({
  id: IdSchema,
  category: z.enum(["privacy_data", "complexity", "cost", "category"]),
  stance: z.string(), // "we will not store any user audio on our servers"
  because: z.string(), // "because this is healthcare-adjacent and trust is the moat"
});

// pivotLog — strategic-decision history that survives message-version regenerations.
export const PivotLogEntrySchema = z.object({
  id: IdSchema,
  at: z.string(), // ISO date
  summary: z.string(),
  reason: z.string().optional(),
  affects: z.array(z.string()).default([]), // ids of needs/features the pivot touches
});

// The six tradeoff axes a Phase 4 allocation distributes 100 points across.
export const TRADEOFF_AXES = [
  "speed_to_alpha",
  "scalability",
  "ux_polish",
  "maintainability",
  "cost",
  "security",
] as const;
export type TradeoffAxis = typeof TRADEOFF_AXES[number];

// Phase 4 — 100-point allocation across the six axes plus one "unacceptable
// tradeoff" choice. The sum===100 invariant is enforced via the .refine block.
export const TradeoffWeightsSchema = z
  .object({
    speed_to_alpha: z.number().int().min(0).max(100),
    scalability: z.number().int().min(0).max(100),
    ux_polish: z.number().int().min(0).max(100),
    maintainability: z.number().int().min(0).max(100),
    cost: z.number().int().min(0).max(100),
    security: z.number().int().min(0).max(100),
    unacceptable_tradeoff: z.enum(TRADEOFF_AXES),
  })
  .refine(
    (w) =>
      w.speed_to_alpha +
        w.scalability +
        w.ux_polish +
        w.maintainability +
        w.cost +
        w.security ===
      100,
    {
      message: "Tradeoff weights must sum to exactly 100 across the six axes.",
      path: ["__sum"],
    },
  );

// ProductState — per-project working memory used by the intake controller and
// every doc-generation prompt.
export const ProductStateSchema = z.object({
  version: z.number().int().default(1),
  stanceBecauseClauses: z.array(StanceBecauseClauseSchema).default([]),
  pivotLog: z.array(PivotLogEntrySchema).default([]),
  tradeoffWeights: TradeoffWeightsSchema.optional(),
  workingMemory: z.record(z.string(), z.any()).default({}),
  agentProfile: AgentSystemSchema.optional(),
});

export const NonGoalSchema = z.object({
  id: IdSchema,
  text: z.string(),
  // Required by PRD-Builder: every non-goal carries a "because" clause.
  // Linter blocks empty `because` (waivable with reason).
  because: z.string().default(""),
});

// OpenQuestion — typed contract for inline-answer affordances on generated docs.
export const OpenQuestionKind = z.enum(["text", "choice"]);
export const OpenQuestionSchema = z.object({
  topicId: z.string().min(1),
  prompt: z.string().min(1).max(500),
  stageId: z.string().optional(),
  stageNumber: z.number().int().optional(),
  answerKind: OpenQuestionKind.default("text"),
  answerChips: z.array(z.string().min(1).max(120)).max(8).optional(),
  feedsField: z.string().optional(),
  answeredValue: z.string().max(500).optional(),
  answeredAt: z.string().optional(),
});
export type OpenQuestion = z.infer<typeof OpenQuestionSchema>;

// PlatformTarget — declared per-spec so the linter can apply platform-appropriate
// test-framework rules. Default 'web' for backward compatibility.
// Compatibility projection used by existing render/lint consumers. The full
// topology can describe additional companion/service surfaces, while an
// unsupported primary remains unresolved until those consumers gain support.
export const PlatformTargetSchema = z.enum([
  "web",
  "vite-spa",
  "ios",
  "macos",
  "claude-plugin",
  "agent-system",
]);

// ── Groundwork extension: design-intent depth switch ──────────────────────
// Resolved design intent controlling data-I/O depth: "iterate-ui" keeps
// element dataIn/dataOut to notes only (fast UI-iteration path, no stall
// collecting types), "design-app" scales up to typed, entity-linked data I/O.
// "unspecified" is the default so existing specs still validate.
export const DesignIntentSchema = z.enum(["iterate-ui", "design-app", "unspecified"]);

// ── Groundwork extension: observability (SLIs/SLOs) ──────────────────────
export const ServiceLevelSchema = z.object({
  metric: z.string(),
  target: z.string(),
});
export const ObservabilitySchema = z.object({
  slis: z.array(ServiceLevelSchema).default([]),
  slos: z.array(ServiceLevelSchema).default([]),
});

// ── Groundwork extension: agent boundaries (Always / Ask-first / Never) ──
export const BoundariesSchema = z.object({
  always: z.array(z.string()).default([]),
  askFirst: z.array(z.string()).default([]),
  never: z.array(z.string()).default([]),
});

// ── Groundwork extension: goals & success metrics ───────────────────────
// Dedicated fields for requirements.md "Goals" / "Success metrics". Previously
// the renderer DERIVED both from scenarios; these give the spec author explicit
// control. Both optional — when absent the renderer falls back to scenarios.
export const GoalSchema = z.object({
  id: IdSchema,
  statement: z.string(),
  // Optional success metric paired with this goal.
  metric: z.string().optional(),
});
export const SuccessMetricSchema = z.object({
  id: IdSchema,
  metric: z.string(),
  target: z.string(),
});

// ── Groundwork extension: voice profile (principles + do/don't + examples) ─
// `examples` carries literal copy strings an implementer can paste. Principles
// and word lists describe a register; only an example shows it. Optional so
// voice profiles authored before it landed still validate — but a profile with
// principles and no examples renders a TAG:UNRESOLVED prompt.
export const VoiceExampleSchema = z.object({
  /** Where this copy appears, e.g. "empty state — no saved runs yet". */
  context: z.string().min(1),
  /** The literal string to ship. */
  copy: z.string().min(1),
});
export const VoiceProfileSchema = z.object({
  principles: z.array(z.string()).default([]),
  doWords: z.array(z.string()).default([]),
  dontWords: z.array(z.string()).default([]),
  examples: z.array(VoiceExampleSchema).default([]),
});

// ── Groundwork extension: pillars + governing sentence ────────────────────
// The ranked non-negotiables the whole product is judged against, and the one
// sentence that settles a scope argument without a meeting. Rendered at the TOP
// of requirements.md: a reader (human or agent) resolves priority conflicts
// from these before reading a single requirement. Ranks must be unique — a tie
// defeats the purpose of ranking.
export const PillarSchema = z.object({
  id: IdSchema,
  /** 1 = highest. Unique across the pillar list (enforced in superRefine). */
  rank: z.number().int().min(1),
  statement: z.string().min(1),
});

// ── Groundwork extension: prime-directive acceptance test ─────────────────
// One observable, time-boxed outcome that decides whether the build succeeded.
// Not a test id in `tests[]` — that layer proves individual requirements; this
// proves the product. Every field below is required ONCE the object is present:
// an acceptance test that is not observable or not time-boxed cannot be run.
export const AcceptanceTestSchema = z.object({
  id: IdSchema.default("acceptance-prime"),
  /** "A first-time user records a run and sees their streak update." */
  statement: z.string().min(1),
  /** What an observer literally watches happen — no inference, no logs-only. */
  observable: z.string().min(1),
  /** The clock bound, e.g. "within 3 minutes of first launch, no docs read". */
  timeBox: z.string().min(1),
  steps: z.array(z.string()).default([]),
  pillarIds: z.array(IdSchema).default([]),
});

// ── Groundwork extension: per-phase runnable acceptance ───────────────────
// One row per delivery phase: what is in scope and the command that proves the
// phase closed. Optional — when absent the handoff emitter DERIVES a table from
// the task layers plus the platform's native verification commands, so a spec
// authored before this field existed still gets runnable phase gates.
export const PhaseAcceptanceSchema = z.object({
  phase: z.string().min(1),
  scope: z.string().min(1),
  /** Runnable: a command, not a wish. */
  acceptance: z.string().min(1),
});

// ── Groundwork extension: hard constraints + performance budget ───────────
export const HardConstraintSchema = z.object({
  id: IdSchema,
  /** Non-negotiable technical or product bound, e.g. "no server-side audio". */
  constraint: z.string().min(1),
  because: z.string().optional(),
});
export const PerformanceBudgetEntrySchema = z.object({
  id: IdSchema,
  metric: z.string().min(1),
  /** The number and its percentile, e.g. "< 1.5s p95". */
  budget: z.string().min(1),
  /** How the budget is measured — ideally a command. */
  measuredBy: z.string().optional(),
});

// ── Groundwork extension: architectural invariants (as executable checks) ──
// `rule` is the prose an implementer reads; `check` is the command CI runs. A
// rule without a check is a wish, so `check` is required once the invariant
// exists — the emitter renders every check into a runnable block.
export const ArchitecturalInvariantSchema = z.object({
  id: IdSchema,
  rule: z.string().min(1),
  /** Executable: shell command, grep, or test id that fails when violated. */
  check: z.string().min(1),
  pillarIds: z.array(IdSchema).default([]),
});

// ── Groundwork extension: spec ↔ code sync rule ───────────────────────────
// Names which artifact wins when implementation and spec disagree, and the
// command that re-syncs. Optional; the emitter falls back to the spec-first
// default so the rule is stated in every handoff whether or not it is authored.
export const SpecCodeSyncSchema = z.object({
  policy: z.enum(["spec-first", "code-first", "bidirectional"]).default("spec-first"),
  specPath: z.string().default("spec.json"),
  /** Command that regenerates the projections after a Spec edit. */
  regenerateCommand: z.string().optional(),
  /** Changes that oblige a Spec update before the work is considered done. */
  triggers: z.array(z.string()).default([]),
});

// ── Groundwork extension: reading contract (the generated set's config header) ─
// How this artifact set expects to be CONSUMED, declared before its first
// section. Two things a reader otherwise settles silently: the model tier the
// set was written for, and whether it may be summarized. A set written for a
// frontier tier and then compressed by a smaller one loses exactly the clauses
// that make it buildable — the constraints — while keeping the prose that reads
// like completeness. Rendered on EVERY generation with the defaults below,
// authored or not: a reading rule nobody states is a reading rule nobody
// follows. Optional/additive, so specs authored before it existed are
// unaffected.
export const ReadingContractSchema = z.object({
  /** Model tier the set is written for, e.g. "frontier". */
  tier: z.string().min(1).default("frontier"),
  /** What the reader is doing with it, e.g. "codegen", "review", "estimation". */
  context: z.string().min(1).default("codegen"),
  /** Extra standing instructions rendered under the no-compression rule. */
  notes: z.array(z.string().min(1)).default([]),
});

export const EvidenceStatusSchema = z.enum(["observed", "decided", "assumed"]);
export const EvidenceRecordSchema = z.object({
  id: IdSchema,
  status: EvidenceStatusSchema,
  statement: z.string().min(1),
  sourceRefs: z.array(z.string().min(1)).default([]),
});

// ── Groundwork extension: observed repo layout (owned-file path steering) ──
// Captures the INSPECTED repository's real directory conventions so the
// handoff emitter's owned-file inference can preserve observed facts instead
// of always falling back to the generic 'src/…' scaffold shape. Every field
// is optional — absent means "unknown", and the emitter falls back to its
// existing generic-per-platform default for that one field only. Additive:
// specs authored before this field existed carry no `repoLayout` and are
// unaffected.
export const RepoLayoutSchema = z.object({
  /** Where the data model lives, e.g. "prisma/schema.prisma" or "src/db/schema.ts". */
  dataModel: z.string().optional(),
  /**
   * Template for API route files. Must contain the literal token `{path}`,
   * e.g. "app/api/{path}/route.ts". When present without `{path}`, the
   * emitter appends the path segment rather than dropping it.
   */
  apiFilePattern: z.string().optional(),
  integrationsDir: z.string().optional(),
  featuresDir: z.string().optional(),
  screensDir: z.string().optional(),
  testsDir: z.string().optional(),
  /** File suffix for generated test files, e.g. ".test.ts" or ".test.tsx". */
  testFileSuffix: z.string().optional(),
});

export const BootstrapCommandsSchema = z.object({
  install: z.string().min(1),
  typecheck: z.string().min(1),
  test: z.string().min(1),
  build: z.string().min(1),
}).strict();

export const ProjectBootstrapSchema = z.object({
  ownedFiles: z.array(OwnedFileSchema).min(1),
  commands: BootstrapCommandsSchema,
}).strict();

export const ProjectContextSchema = z.object({
  startingPoint: z.enum([
    "unspecified",
    "initial-idea",
    "existing-definition",
    "existing-app",
  ]).default("unspecified"),
  sourceRepo: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  sourceArtifacts: z.array(z.string().min(1)).default([]),
  inspectedAt: z.string().optional(),
  evidence: z.array(EvidenceRecordSchema).default([]),
  // Groundwork: observed repo layout (see RepoLayoutSchema doc comment).
  // Optional/additive so existing specs keep validating unchanged.
  repoLayout: RepoLayoutSchema.optional(),
  declaredNewFiles: z.array(DeclaredNewFileSchema).min(1).optional(),
  bootstrap: ProjectBootstrapSchema.optional(),
});

export const ResponsiveTargetsSchema = z.object({
  minimum: z.string().optional(),
  maximum: z.string().optional(),
  deviceClasses: z.array(z.string().min(1)).default([]),
});

export const UiPreferencesSchema = z.object({
  informationDensity: z.string().optional(),
  brandAdjectives: z.array(z.string().min(1)).default([]),
  accessibilityFloor: z.array(z.string().min(1)).default([]),
  responsiveTargets: ResponsiveTargetsSchema.optional(),
  mustKeep: z.array(z.string().min(1)).default([]),
  mustAvoid: z.array(z.string().min(1)).default([]),
  mayEvolve: z.array(z.string().min(1)).default([]),
  visualReferences: z.array(z.string().min(1)).default([]),
});

// Spec v3 makes project constraints and current/proposed/verified change
// semantics explicit. Implementation evidence remains outside the intended
// Spec and can only be referenced after independent reconciliation.
export const GovernanceSchema = z.object({
  constraints: z.array(z.string().min(1)).default([]),
  decisions: z.array(IdSchema).default([]),
  owners: z.array(z.string().min(1)).default([]),
}).strict();

export const ChangeRecordSchema = z.object({
  id: IdSchema,
  target: QualifiedRefSchema,
  summary: z.string().min(1),
  provenance: ProvenanceSchema,
  evidenceRefs: z.array(IdSchema).default([]),
}).strict();

export const ChangeSetSchema = z.object({
  id: IdSchema,
  current: z.array(ChangeRecordSchema).default([]),
  proposed: z.array(ChangeRecordSchema).default([]),
  verified: z.array(ChangeRecordSchema).default([]),
}).strict();

// Spec — the source-of-truth structured document. Doc generation emits this
// first; the renderer produces stage-specific Markdown second.
const SpecObjectSchema = z.object({
  schemaVersion: z.literal(3),
  id: IdSchema,
  productName: z.string(),
  productDescription: z.string(),
  // Drives platform-specific lint rules. Defaults to 'web' so specs created
  // before the field existed continue to validate.
  platformTarget: PlatformTargetSchema.default("web"),
  platformSurfaces: PlatformSurfacesSchema,
  // Groundwork: design-intent depth switch (see DesignIntentSchema doc
  // comment). Placed at top level (not nested under projectContext) because
  // downstream flow docs read it as a cross-cutting mode switch, not
  // project-inspection metadata.
  designIntent: DesignIntentSchema.default("unspecified"),
  personas: z.array(PersonaSchema).default([]),
  scenarios: z.array(ScenarioSchema).default([]),
  needs: z.array(NeedSchema).default([]),
  features: z.array(FeatureSchema).default([]),
  uxFlows: z.array(UXFlowSchema).default([]),
  screens: z.array(ScreenSchema).default([]),
  dataPoints: z.array(DataPointSchema).default([]),
  // Groundwork: pointer-grade entity layer (see DataModelEntitySchema doc
  // comment). Optional/additive.
  dataModel: z.array(DataModelEntitySchema).default([]),
  integrations: z.array(IntegrationSchema).default([]),
  apiContracts: z.array(APIContractSchema).default([]),
  /** Optional behavior-first contract. Empty preserves every existing Spec v3 input. */
  behaviorContracts: z.array(BehaviorContractSchema).optional(),
  tests: z.array(TestSchema).default([]),
  adrs: z.array(ADRSchema).default([]),
  assumptions: z.array(AssumptionSchema).default([]),
  risks: z.array(RiskSchema).default([]),
  nonGoals: z.array(NonGoalSchema).default([]),
  agentSystem: AgentSystemSchema.optional(),
  // ── Groundwork extensions (all optional; existing specs stay valid) ──
  goals: z.array(GoalSchema).optional(),
  successMetrics: z.array(SuccessMetricSchema).optional(),
  observability: ObservabilitySchema.optional(),
  boundaries: BoundariesSchema.optional(),
  voiceProfile: VoiceProfileSchema.optional(),
  // ── Self-resolving-output extensions (all optional; see each schema's
  // doc comment for why the field exists and how absence renders) ──
  pillars: z.array(PillarSchema).optional(),
  governingSentence: z.string().optional(),
  acceptanceTest: AcceptanceTestSchema.optional(),
  phaseAcceptance: z.array(PhaseAcceptanceSchema).optional(),
  hardConstraints: z.array(HardConstraintSchema).optional(),
  performanceBudget: z.array(PerformanceBudgetEntrySchema).optional(),
  architecturalInvariants: z.array(ArchitecturalInvariantSchema).optional(),
  nfr: NfrSchema.optional(),
  specCodeSync: SpecCodeSyncSchema.optional(),
  readingContract: ReadingContractSchema.optional(),
  projectContext: ProjectContextSchema.default({ startingPoint: "unspecified" }),
  uiPreferences: UiPreferencesSchema.default({}),
  designContract: DesignContractSchema.optional(),
  architecture: ArchitectureSchema,
  governance: GovernanceSchema,
  changeSet: ChangeSetSchema,
});

const ValidatedSpecObjectSchema = SpecObjectSchema.superRefine((spec, ctx) => {
  const declaredNew = spec.projectContext.declaredNewFiles ?? [];
  const declaredPaths = new Set<string>();
  declaredNew.forEach((entry, index) => {
    if (declaredPaths.has(entry.path)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["projectContext", "declaredNewFiles", index, "path"], message: `Duplicate declared-new file: ${entry.path}` });
    declaredPaths.add(entry.path);
  });
  const ownedPaths = new Set<string>([
    ...(spec.projectContext.bootstrap?.ownedFiles ?? []),
    ...spec.features.flatMap((item) => item.ownedFiles ?? []),
    ...spec.screens.flatMap((item) => item.ownedFiles ?? []),
    ...spec.integrations.flatMap((item) => item.ownedFiles),
    ...spec.apiContracts.flatMap((item) => item.ownedFiles),
    ...spec.tests.flatMap((item) => item.ownedFiles),
    ...spec.dataModel.flatMap((item) => item.ownedFiles),
    ...spec.architecture.components.flatMap((item) => item.ownedFiles ?? []),
    ...spec.architecture.contracts.flatMap((item) => item.ownedFiles ?? []),
  ]);
  declaredNew.forEach((entry, index) => {
    if (!ownedPaths.has(entry.path)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["projectContext", "declaredNewFiles", index, "path"], message: `Declared-new file is not owned by any entity: ${entry.path}` });
  });
  const ids = {
    persona: new Set(spec.personas.map((item) => item.id)),
    need: new Set(spec.needs.map((item) => item.id)),
    feature: new Set(spec.features.map((item) => item.id)),
    screen: new Set(spec.screens.map((item) => item.id)),
    integration: new Set(spec.integrations.map((item) => item.id)),
    pillar: new Set((spec.pillars ?? []).map((item) => item.id)),
    test: new Set(spec.tests.map((item) => item.id)),
    platformSurface: new Set(spec.platformSurfaces.map((item) => item.id)),
    adr: new Set(spec.adrs.map((item) => item.id)),
    behavior: new Set((spec.behaviorContracts ?? []).map((item) => item.id)),
  };
  const check = (values: string[], valid: Set<string>, path: Array<string | number>, kind: string) => {
    values.forEach((value, index) => {
      if (!valid.has(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...path, index],
          message: `Unknown ${kind} reference: ${value}`,
        });
      }
    });
  };
  const screenStates = new Map(spec.screens.map((screen) => [screen.id, new Set(screen.states)]));
  const checkStateRefs = (
    refs: Array<{ screenId: string; state: string }>,
    path: Array<string | number>,
  ) => {
    refs.forEach((ref, index) => {
      const states = screenStates.get(ref.screenId);
      if (!states) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...path, index, "screenId"],
          message: `Unknown screen reference: ${ref.screenId}`,
        });
      } else if (!states.has(ref.state)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...path, index, "state"],
          message: `Unknown state ${ref.state} on screen ${ref.screenId}`,
        });
      }
    });
  };
  spec.scenarios.forEach((item, index) => {
    if (item.personaId) check([item.personaId], ids.persona, ["scenarios", index, "personaId"], "persona");
  });
  spec.features.forEach((item, index) => check(item.needIds, ids.need, ["features", index, "needIds"], "need"));
  spec.screens.forEach((item, index) => check(item.featureIds, ids.feature, ["screens", index, "featureIds"], "feature"));
  spec.uxFlows.forEach((item, index) => check(item.screenIds, ids.screen, ["uxFlows", index, "screenIds"], "screen"));
  spec.integrations.forEach((item, index) => check(item.featureIds, ids.feature, ["integrations", index, "featureIds"], "feature"));
  spec.apiContracts.forEach((item, index) => check(item.featureIds, ids.feature, ["apiContracts", index, "featureIds"], "feature"));
  spec.tests.forEach((item, index) => {
    check(item.dependsOnTestIds, ids.test, ["tests", index, "dependsOnTestIds"], "test");
    item.dependsOnTestIds.forEach((testId, dependencyIndex) => {
      if (testId === item.id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tests", index, "dependsOnTestIds", dependencyIndex],
          message: `Test ${item.id} cannot depend on itself.`,
        });
      }
    });
    check(item.needIds, ids.need, ["tests", index, "needIds"], "need");
    check(item.featureIds, ids.feature, ["tests", index, "featureIds"], "feature");
    check(item.screenIds, ids.screen, ["tests", index, "screenIds"], "screen");
    checkStateRefs(item.stateRefs, ["tests", index, "stateRefs"]);
    check(item.integrationIds, ids.integration, ["tests", index, "integrationIds"], "integration");
    check(item.platformSurfaceIds, ids.platformSurface, ["tests", index, "platformSurfaceIds"], "platform surface");
  });
  spec.dataModel.forEach((item, index) => {
    if (item.readByFeatureIds) check(item.readByFeatureIds, ids.feature, ["dataModel", index, "readByFeatureIds"], "feature");
    if (item.writtenByFeatureIds) check(item.writtenByFeatureIds, ids.feature, ["dataModel", index, "writtenByFeatureIds"], "feature");
  });
  // Pillar references. A dangling pillarId breaks the pillar→requirement→
  // design→task→acceptance chain in traceability.json, so it is rejected the
  // same way every other dangling cross-reference is.
  spec.needs.forEach((item, index) => check(item.pillarIds, ids.pillar, ["needs", index, "pillarIds"], "pillar"));
  (spec.architecturalInvariants ?? []).forEach((item, index) =>
    check(item.pillarIds, ids.pillar, ["architecturalInvariants", index, "pillarIds"], "pillar"),
  );
  if (spec.acceptanceTest) {
    check(spec.acceptanceTest.pillarIds, ids.pillar, ["acceptanceTest", "pillarIds"], "pillar");
  }
  // Ranks order the pillars; a duplicate rank leaves two pillars with equal
  // claim on a conflict, which is the exact judgment the ranking exists to make.
  const seenRanks = new Map<number, string>();
  (spec.pillars ?? []).forEach((pillar, index) => {
    const prior = seenRanks.get(pillar.rank);
    if (prior) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pillars", index, "rank"],
        message: `Duplicate pillar rank ${pillar.rank} (already used by ${prior}). Ranks must be unique.`,
      });
    } else {
      seenRanks.set(pillar.rank, pillar.id);
    }
  });

  spec.platformSurfaces.forEach((surface, surfaceIndex) => {
    check(surface.featureIds, ids.feature, ["platformSurfaces", surfaceIndex, "featureIds"], "feature");
  });
  check(spec.governance.decisions, ids.adr, ["governance", "decisions"], "ADR");

  const elementIds = new Set(spec.screens.flatMap((screen) => (screen.elements ?? []).map((element) => element.id)));
  const componentIds = new Set(spec.architecture.components.map((item) => item.id));
  const behaviorStateIds = new Set((spec.behaviorContracts ?? []).flatMap((contract) => contract.states.map((state) => state.id)));
  const behaviorActionIds = new Set((spec.behaviorContracts ?? []).flatMap((contract) => contract.actions.map((action) => action.id)));
  const referenceIds = new Set([
    spec.id,
    ...ids.persona, ...ids.need, ...ids.feature, ...ids.screen, ...ids.integration,
    ...ids.test, ...ids.adr, ...ids.behavior, ...elementIds, ...componentIds,
    ...behaviorStateIds, ...behaviorActionIds,
    ...spec.dataModel.map((item) => item.id),
    ...spec.architecture.contracts.map((item) => item.id),
    ...spec.architecture.flows.map((item) => item.id),
  ]);
  const idsByScopeKind: Record<z.infer<typeof ContractScopeSchema>["kind"], Set<string>> = {
    product: new Set([spec.id]),
    screen: ids.screen,
    element: elementIds,
    component: componentIds,
    behavior: ids.behavior,
    architecture: componentIds,
  };
  const validateScope = (scope: z.infer<typeof ContractScopeSchema>, path: Array<string | number>, label: string) => {
    check(scope.refs, idsByScopeKind[scope.kind], [...path, "refs"], `${label} ${scope.kind}`);
  };
  const scopesIntersect = (left: z.infer<typeof ContractScopeSchema>, right: z.infer<typeof ContractScopeSchema>) =>
    left.kind === "product" || right.kind === "product"
      ? left.kind === right.kind && left.refs.some((ref) => right.refs.includes(ref))
      : left.kind === right.kind && left.refs.some((ref) => right.refs.includes(ref));

  // Decision lifecycle remains authoritative before a visual baseline exists.
  const decisionByIdAlways = new Map(spec.adrs.map((adr) => [adr.id, adr]));
  spec.adrs.forEach((adr, index) => {
    if (adr.rigidity === "superseded") {
      if (!adr.supersededBy || adr.supersededBy === adr.id || !decisionByIdAlways.has(adr.supersededBy)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["adrs", index, "supersededBy"], message: "A superseded ADR requires an existing non-self supersededBy ADR." });
    } else if (adr.supersededBy) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["adrs", index, "supersededBy"], message: "Only a superseded ADR may declare supersededBy." });
    if (adr.scope) validateScope(adr.scope, ["adrs", index, "scope"], "ADR scope");
    if (adr.rigidity === "locked" && !spec.designContract) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["adrs", index, "constraintRefs"], message: "A locked ADR requires a designContract with an enforceable scoped constraint." });
    const seen = new Set([adr.id]);
    let next = adr.supersededBy;
    while (next) {
      if (seen.has(next)) { ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["adrs", index, "supersededBy"], message: "ADR supersession graph contains a cycle." }); break; }
      seen.add(next);
      next = decisionByIdAlways.get(next)?.supersededBy;
    }
  });

  const design = spec.designContract;
  if (design) {
    const rejectDuplicateIds = (items: Array<{ id: string }>, path: Array<string | number>, label: string) => {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        if (seen.has(item.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, index, "id"], message: `Duplicate ${label} id: ${item.id}` });
        seen.add(item.id);
      });
    };
    rejectDuplicateIds(design.baseline.artifacts, ["designContract", "baseline", "artifacts"], "baseline artifact");
    rejectDuplicateIds(spec.projectContext.evidence, ["projectContext", "evidence"], "evidence");
    rejectDuplicateIds(design.verification, ["designContract", "verification"], "verification");
    rejectDuplicateIds(design.constraints, ["designContract", "constraints"], "constraint");
    const verificationIds = new Set(design.verification.map((item) => item.id));
    const constraintIds = new Set(design.constraints.map((item) => item.id));
    const artifactIds = new Set(design.baseline.artifacts.map((item) => item.id));
    const checkKnown = (values: string[], valid: Set<string>, path: Array<string | number>, label: string) => check(values, valid, path, label);
    design.verification.forEach((item, index) => {
      checkKnown(item.targetRefs, referenceIds, ["designContract", "verification", index, "targetRefs"], "verification target");
      item.passCriteria.forEach((predicate, predicateIndex) => checkKnown([predicate.subjectRef], referenceIds, ["designContract", "verification", index, "passCriteria", predicateIndex, "subjectRef"], "predicate subject"));
    });
    design.constraints.forEach((item, index) => {
      validateScope(item.scope, ["designContract", "constraints", index, "scope"], "constraint scope");
      checkKnown([item.targetRef], referenceIds, ["designContract", "constraints", index, "targetRef"], "constraint target");
      checkKnown(item.verificationRefs, verificationIds, ["designContract", "constraints", index, "verificationRefs"], "verification");
      if (item.kind === "exact" && (!item.sourceArtifactId || !item.verificationRefs.length)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["designContract", "constraints", index], message: "Exact constraints require sourceArtifactId and verificationRefs." });
      }
      if (item.sourceArtifactId) checkKnown([item.sourceArtifactId], artifactIds, ["designContract", "constraints", index, "sourceArtifactId"], "baseline artifact");
      const compatible = item.kind === "architectural"
        ? ["architecture", "component", "product"].includes(item.scope.kind)
        : item.kind === "behavioral"
          ? ["behavior", "screen", "element", "product"].includes(item.scope.kind)
          : true;
      if (!compatible) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["designContract", "constraints", index, "kind"], message: `${item.kind} constraint is incompatible with ${item.scope.kind} scope.` });
    });
    const baseline = design.baseline;
    const conformance = design.intent?.type === "conformance";
    const requiresBaseline = baseline.disposition === "observed" || baseline.disposition === "declared";
    if (requiresBaseline && (!baseline.id || !baseline.artifacts.length || !baseline.precedence.length)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["designContract", "baseline"], message: "Observed or declared baselines require id, artifacts, and precedence." });
    }
    if (requiresBaseline && !conformance && !design.deltas.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["designContract", "deltas"], message: "A change design contract requires at least one linked delta." });
    }
    if (conformance) {
      if (!requiresBaseline) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["designContract", "baseline", "disposition"], message: "A conformance design contract requires an observed or declared baseline." });
      if (design.deltas.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["designContract", "deltas"], message: "A conformance design contract forbids proposed deltas." });
      if (spec.changeSet.proposed.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["changeSet", "proposed"], message: "A conformance design contract requires an empty proposed change set." });
      if (!design.constraints.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["designContract", "constraints"], message: "A conformance design contract requires evidence-backed constraints." });
      if (!design.verification.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["designContract", "verification"], message: "A conformance design contract requires verification with acceptance predicates." });
      const evidenceById = new Map(spec.projectContext.evidence.map((item) => [item.id, item]));
      const evidenceRefs = design.intent!.evidenceRefs;
      if (new Set(evidenceRefs).size !== evidenceRefs.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["designContract", "intent", "evidenceRefs"], message: "Conformance evidenceRefs must be unique." });
      evidenceRefs.forEach((ref, index) => {
        const evidence = evidenceById.get(ref);
        const allowedStatuses = baseline.disposition === "observed" ? ["observed"] : ["observed", "decided"];
        if (!evidence) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["designContract", "intent", "evidenceRefs", index], message: `Unknown conformance evidence reference: ${ref}` });
        else if (!evidence.sourceRefs.length || !allowedStatuses.includes(evidence.status)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["designContract", "intent", "evidenceRefs", index], message: `Conformance evidence ${ref} must be source-backed with status ${allowedStatuses.join(" or ")}.` });
      });
      if (!spec.acceptanceTest || design.intent!.acceptanceTestRef !== spec.acceptanceTest.id || !spec.acceptanceTest.steps.some((step) => step.trim().length > 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["designContract", "intent", "acceptanceTestRef"], message: "Conformance requires the canonical acceptanceTest with at least one executable step." });
      }
      const verificationRefs = design.intent!.verificationRefs;
      if (new Set(verificationRefs).size !== verificationRefs.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["designContract", "intent", "verificationRefs"], message: "Conformance verificationRefs must be unique." });
      const verificationById = new Map(design.verification.map((item) => [item.id, item]));
      verificationRefs.forEach((ref, index) => {
        const verification = verificationById.get(ref);
        if (!verification) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["designContract", "intent", "verificationRefs", index], message: `Unknown conformance verification reference: ${ref}` });
        else if (!verification.targetRefs.length || !verification.passCriteria.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["designContract", "intent", "verificationRefs", index], message: `Conformance verification ${ref} requires targetRefs and acceptance predicates.` });
      });
      design.constraints.forEach((item, index) => {
        if (!item.sourceArtifactId || !item.verificationRefs.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["designContract", "constraints", index], message: "Conformance constraints require sourceArtifactId and verificationRefs." });
        if (!item.verificationRefs.some((ref) => verificationRefs.includes(ref))) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["designContract", "constraints", index, "verificationRefs"], message: "Conformance constraints must cite a substantive intent verification." });
      });
    }
    if (baseline.disposition === "not-applicable" && (baseline.id || baseline.artifacts.length || baseline.precedence.length)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["designContract", "baseline"], message: "A not-applicable baseline cannot declare identity, artifacts, or precedence." });
    }
    if (baseline.scope) validateScope(baseline.scope, ["designContract", "baseline", "scope"], "baseline scope");
    const artifactPaths = new Map<string, number>();
    baseline.artifacts.forEach((artifact, index) => {
      const segments = artifact.path.split(/[\\/]+/);
      if (/[*?[\]{}]/.test(artifact.path) || artifact.path.startsWith("/") || segments.includes("..")) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["designContract", "baseline", "artifacts", index, "path"], message: "Baseline artifact paths must be exact relative paths without globs or parent traversal." });
      }
      const normalized = segments.filter((segment) => segment && segment !== ".").join("/");
      for (const [prior, priorIndex] of artifactPaths) {
        if (normalized === prior || normalized.startsWith(`${prior}/`) || prior.startsWith(`${normalized}/`)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["designContract", "baseline", "artifacts", index, "path"], message: `Baseline artifact path overlaps artifact at index ${priorIndex}; precedence would be ambiguous.` });
        }
      }
      artifactPaths.set(normalized, index);
    });
    const ranks = new Set<number>();
    baseline.precedence.forEach((item, index) => {
      if (ranks.has(item.rank)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["designContract", "baseline", "precedence", index, "rank"], message: `Duplicate precedence rank ${item.rank}.` });
      ranks.add(item.rank);
      checkKnown([item.artifactId], artifactIds, ["designContract", "baseline", "precedence", index, "artifactId"], "baseline artifact");
    });
    design.deltas.forEach((item, index) => {
      if (requiresBaseline && item.baselineId !== baseline.id) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["designContract", "deltas", index, "baselineId"], message: "A delta for an observed or declared baseline must identify that baseline." });
      if (!requiresBaseline && item.baselineId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["designContract", "deltas", index, "baselineId"], message: "A not-applicable baseline forbids a baseline-linked delta." });
      checkKnown(item.targetRefs, referenceIds, ["designContract", "deltas", index, "targetRefs"], "delta target");
      checkKnown(item.verificationRefs, verificationIds, ["designContract", "deltas", index, "verificationRefs"], "verification");
    });
    const decisionById = new Map(spec.adrs.map((adr) => [adr.id, adr]));
    spec.adrs.forEach((adr, index) => {
      if (adr.rigidity === "superseded") {
        if (!adr.supersededBy || adr.supersededBy === adr.id || !decisionById.has(adr.supersededBy)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["adrs", index, "supersededBy"], message: "A superseded ADR requires an existing non-self supersededBy ADR." });
      } else if (adr.supersededBy) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["adrs", index, "supersededBy"], message: "Only a superseded ADR may declare supersededBy." });
      const constraintRefs = adr.constraintRefs ?? [];
      if (adr.rigidity === "locked") {
        const enforceable = Boolean(adr.scope) && constraintRefs.some((id) => design.constraints.some((constraint) => constraint.id === id && scopesIntersect(adr.scope!, constraint.scope)));
        if (!enforceable) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["adrs", index, "constraintRefs"], message: "A locked ADR requires an enforceable scoped constraint, including a relational constraint when its scope matches." });
      }
      checkKnown(constraintRefs, constraintIds, ["adrs", index, "constraintRefs"], "constraint");
      if (adr.scope) {
        validateScope(adr.scope, ["adrs", index, "scope"], "ADR scope");
        constraintRefs.forEach((id, constraintIndex) => {
          const constraint = design.constraints.find((candidate) => candidate.id === id);
          if (constraint && !scopesIntersect(adr.scope!, constraint.scope)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["adrs", index, "constraintRefs", constraintIndex], message: `ADR scope does not intersect constraint ${id} scope.` });
        });
      }
    });
    const decisionIndex = new Map(spec.adrs.map((adr, index) => [adr.id, index]));
    spec.adrs.forEach((adr, index) => {
      const seen = new Set([adr.id]);
      let next = adr.supersededBy;
      while (next) {
        if (seen.has(next)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["adrs", index, "supersededBy"], message: "ADR supersession graph contains a cycle." });
          break;
        }
        seen.add(next);
        const nextIndex = decisionIndex.get(next);
        next = nextIndex === undefined ? undefined : spec.adrs[nextIndex]?.supersededBy;
      }
    });
    const lockedConstraints = spec.adrs
      .filter((adr) => adr.rigidity === "locked")
      .flatMap((adr) => (adr.constraintRefs ?? []).map((id) => ({ adr, constraint: design.constraints.find((item) => item.id === id) })).filter((item): item is { adr: typeof adr; constraint: z.infer<typeof DesignConstraintSchema> } => Boolean(item.constraint)));
    const pathsOverlap = (left: string, right: string) => left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);
    const conflicts = (left: z.infer<typeof DesignConstraintSchema>, right: z.infer<typeof DesignConstraintSchema>) => {
      if (left.operator === "eq" && right.operator === "eq") return JSON.stringify(left.value) !== JSON.stringify(right.value);
      if (left.operator === "exists" && right.operator === "not-exists" || left.operator === "not-exists" && right.operator === "exists") return true;
      if ((left.operator === "contains" && right.operator === "excludes" || left.operator === "excludes" && right.operator === "contains") && JSON.stringify(left.value) === JSON.stringify(right.value)) return true;
      if (typeof left.value === "number" && typeof right.value === "number") {
        if (left.operator === "gte" && right.operator === "lte") return left.value > right.value;
        if (left.operator === "lte" && right.operator === "gte") return right.value > left.value;
        if (left.operator === "eq" && right.operator === "gte") return left.value < right.value;
        if (left.operator === "eq" && right.operator === "lte") return left.value > right.value;
        if (right.operator === "eq" && left.operator === "gte") return right.value < left.value;
        if (right.operator === "eq" && left.operator === "lte") return right.value > left.value;
      }
      return false;
    };
    lockedConstraints.forEach((left, leftIndex) => lockedConstraints.slice(leftIndex + 1).forEach((right) => {
      if (left.constraint.id === right.constraint.id || left.constraint.targetRef !== right.constraint.targetRef) return;
      if (!scopesIntersect(left.constraint.scope, right.constraint.scope) || !pathsOverlap(left.constraint.propertyPath, right.constraint.propertyPath)) return;
      if (conflicts(left.constraint, right.constraint)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["adrs", decisionIndex.get(right.adr.id) ?? 0, "constraintRefs"], message: `Locked constraints ${left.constraint.id} and ${right.constraint.id} conflict.` });
    }));
  }
  const behaviorVerificationIds = new Set(design?.verification.map((item) => item.id) ?? []);
  (spec.behaviorContracts ?? []).forEach((contract, contractIndex) => {
    validateScope(contract.scope, ["behaviorContracts", contractIndex, "scope"], "behavior scope");
    check(contract.verificationRefs, behaviorVerificationIds, ["behaviorContracts", contractIndex, "verificationRefs"], "verification");
    const stateIds = new Set(contract.states.map((state) => state.id));
    const actionIds = new Set(contract.actions.map((action) => action.id));
    const checkPredicate = (predicate: z.infer<typeof PredicateSchema>, path: Array<string | number>) => check([predicate.subjectRef], referenceIds, [...path, "subjectRef"], "predicate subject");
    contract.preconditions.forEach((predicate, index) => checkPredicate(predicate, ["behaviorContracts", contractIndex, "preconditions", index]));
    contract.states.forEach((state, stateIndex) => check(state.visibleRefs, referenceIds, ["behaviorContracts", contractIndex, "states", stateIndex, "visibleRefs"], "visible"));
    const writeIdentity = (write: z.infer<typeof WriteSchema>) => `${write.storeRef}:${write.entity}:${write.mode}:${write.fields.slice().sort().join(",")}`;
    contract.actions.forEach((action, actionIndex) => {
      check(action.fromStateIds, stateIds, ["behaviorContracts", contractIndex, "actions", actionIndex, "fromStateIds"], "behavior state");
      if (action.toStateId) check([action.toStateId], stateIds, ["behaviorContracts", contractIndex, "actions", actionIndex, "toStateId"], "behavior state");
      const prohibited = new Set(action.prohibitedWrites.map(writeIdentity));
      action.writes.forEach((write, writeIndex) => { if (prohibited.has(writeIdentity(write))) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["behaviorContracts", contractIndex, "actions", actionIndex, "writes", writeIndex], message: "An action cannot both write and prohibit the same normalized write." }); });
      action.effects.forEach((effect, effectIndex) => check([effect.targetRef], referenceIds, ["behaviorContracts", contractIndex, "actions", actionIndex, "effects", effectIndex, "targetRef"], "effect target"));
      for (const [field, recovery] of [["failure", action.failure], ["recovery", action.recovery]] as const) {
        if (!recovery) continue;
        checkPredicate(recovery.failureCondition, ["behaviorContracts", contractIndex, "actions", actionIndex, field, "failureCondition"]);
        if (recovery.toStateId) check([recovery.toStateId], stateIds, ["behaviorContracts", contractIndex, "actions", actionIndex, field, "toStateId"], "behavior state");
      }
      if (action.confirmation?.when) checkPredicate(action.confirmation.when, ["behaviorContracts", contractIndex, "actions", actionIndex, "confirmation", "when"]);
    });
    contract.transitions.forEach((transition, transitionIndex) => {
      check([transition.fromStateId, transition.toStateId], stateIds, ["behaviorContracts", contractIndex, "transitions", transitionIndex], "behavior state");
      check([transition.actionId], actionIds, ["behaviorContracts", contractIndex, "transitions", transitionIndex, "actionId"], "behavior action");
    });
    contract.informationFlow.forEach((flow, flowIndex) => {
      check([flow.sourceRef], referenceIds, ["behaviorContracts", contractIndex, "informationFlow", flowIndex, "sourceRef"], "information-flow source");
      check([flow.targetRef], referenceIds, ["behaviorContracts", contractIndex, "informationFlow", flowIndex, "targetRef"], "information-flow target");
    });
  });

  const topologyResult = PlatformTopologySchema.safeParse({
    platformTarget: spec.platformTarget,
    platformSurfaces: spec.platformSurfaces,
  });
  if (!topologyResult.success) {
    topologyResult.error.issues.forEach((issue) => {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: issue.path,
        message: issue.message,
      });
    });
  }

  const localRefs: QualifiedRef[] = [
    ...spec.needs.map((item) => ({ specId: spec.id, kind: "requirement" as const, id: item.id })),
    ...spec.features.map((item) => ({ specId: spec.id, kind: "feature" as const, id: item.id })),
    ...spec.screens.flatMap((screen) => [
      { specId: spec.id, kind: "screen" as const, id: screen.id },
      ...(screen.elements ?? []).map((element) => ({
        specId: spec.id,
        kind: "element" as const,
        id: element.id,
      })),
    ]),
  ];
  validateArchitecture(spec.architecture, { specId: spec.id, localRefs }).forEach((issue) => {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["architecture", ...issue.path],
      message: issue.message,
    });
  });
  spec.architecture.flows.forEach((flow, flowIndex) => {
    flow.exchanges.forEach((exchange, exchangeIndex) => {
      checkStateRefs(
        exchange.stateRefs,
        ["architecture", "flows", flowIndex, "exchanges", exchangeIndex, "stateRefs"],
      );
    });
  });

  const localIdentity = new Set(localRefs.map((ref) => `${ref.specId}:${ref.kind}:${ref.id}`));
  spec.architecture.components.forEach((item) => localIdentity.add(`${spec.id}:component:${item.id}`));
  spec.architecture.contracts.forEach((item) => localIdentity.add(`${spec.id}:contract:${item.id}`));
  spec.architecture.flows.forEach((item) => localIdentity.add(`${spec.id}:flow:${item.id}`));
  const dependencySpecIds = new Set(spec.architecture.specDependencies.map((item) => item.specId));
  (["current", "proposed", "verified"] as const).forEach((bucket) => {
    spec.changeSet[bucket].forEach((record, index) => {
      const identity = `${record.target.specId}:${record.target.kind}:${record.target.id}`;
      const targetIsKnown = record.target.specId === spec.id
        ? localIdentity.has(identity)
        : dependencySpecIds.has(record.target.specId);
      if (!targetIsKnown) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["changeSet", bucket, index, "target"],
          message: `Unknown change target: ${identity}`,
        });
      }
    });
  });
  const seenChangeRecordIds = new Map<string, string>();
  (["current", "proposed", "verified"] as const).forEach((bucket) => {
    spec.changeSet[bucket].forEach((record, index) => {
      const firstPath = seenChangeRecordIds.get(record.id);
      if (firstPath) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["changeSet", bucket, index, "id"],
          message: `Duplicate change record ID ${record.id}; first declared at ${firstPath}`,
        });
      } else {
        seenChangeRecordIds.set(record.id, `changeSet.${bucket}.${index}.id`);
      }
    });
  });
});

function slugIdPart(value: unknown, fallback: string): string {
  const slug = String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function migratedScreenElements(rawScreens: unknown): unknown {
  if (!Array.isArray(rawScreens)) return rawScreens;
  const used = new Set<string>();
  rawScreens.forEach((screen) => {
    if (!screen || typeof screen !== "object" || Array.isArray(screen)) return;
    const elements = (screen as Record<string, unknown>).elements;
    if (!Array.isArray(elements)) return;
    elements.forEach((element) => {
      if (!element || typeof element !== "object" || Array.isArray(element)) return;
      const id = (element as Record<string, unknown>).id;
      if (typeof id === "string" && id.trim()) used.add(id);
    });
  });
  return rawScreens.map((screen, screenIndex) => {
    if (!screen || typeof screen !== "object" || Array.isArray(screen)) return screen;
    const rawScreen = screen as Record<string, unknown>;
    if (!Array.isArray(rawScreen.elements)) return screen;
    const screenPart = slugIdPart(rawScreen.id, `screen-${screenIndex + 1}`);
    const elements = rawScreen.elements.map((element, elementIndex) => {
      if (!element || typeof element !== "object" || Array.isArray(element)) return element;
      const rawElement = element as Record<string, unknown>;
      const existingId = typeof rawElement.id === "string" && rawElement.id.trim()
        ? rawElement.id
        : undefined;
      if (existingId) return { ...rawElement, id: existingId };
      const base = `element-${screenPart}-${slugIdPart(rawElement.name, String(elementIndex + 1))}`;
      let id = base;
      let suffix = 2;
      while (used.has(id)) {
        id = `${base}-${suffix}`;
        suffix += 1;
      }
      used.add(id);
      return { ...rawElement, id };
    });
    return { ...rawScreen, elements };
  });
}

function migratedPrimarySurface(platformTarget: Platform): PlatformSurface {
  return {
    id: `surface-${slugIdPart(platformTarget, "web")}`,
    platform: platformTarget,
    role: "primary",
    name: `${platformTarget} primary surface`,
    interactionModes: [],
    featureIds: [],
    provenance: "derived",
  };
}

/** Upgrade pre-v3 Specs without inventing architecture or manual provider work. */
function migrateSpecInput(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const raw = input as Record<string, unknown>;
  if (raw.schemaVersion === 3 || (typeof raw.schemaVersion === "number" && raw.schemaVersion > 3)) {
    return input;
  }

  const integrations = Array.isArray(raw.integrations)
    ? raw.integrations.map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
        const old = entry as Record<string, unknown>;
        const legacySetup = Array.isArray(old.manualSetup) ? old.manualSetup : [];
        const verification = Array.isArray(old.verification) && old.verification.length
          ? old.verification
          : ["TAG:UNRESOLVED — define the provider success and failure verification steps."];
        const { manualSetup: _manualSetup, ...rest } = old;
        return {
          ...rest,
          codeSetup: Array.isArray(old.codeSetup) ? old.codeSetup : [],
          unclassifiedSetup: Array.isArray(old.unclassifiedSetup)
            ? old.unclassifiedSetup
            : legacySetup,
          externalManualActions: Array.isArray(old.externalManualActions)
            ? old.externalManualActions
            : [],
          verification,
        };
      })
    : raw.integrations;

  const platformTargetResult = PlatformSchema.safeParse(raw.platformTarget ?? "web");
  const platformTarget = platformTargetResult.success ? platformTargetResult.data : raw.platformTarget;
  const specId = typeof raw.id === "string" && raw.id ? raw.id : "spec-migrated";

  return {
    ...raw,
    schemaVersion: 3,
    integrations,
    screens: migratedScreenElements(raw.screens),
    platformTarget,
    platformSurfaces: platformTargetResult.success
      ? [migratedPrimarySurface(platformTargetResult.data)]
      : raw.platformSurfaces,
    architecture: raw.architecture ?? {
      components: [],
      contracts: [],
      relationships: [],
      flows: [],
      specDependencies: [],
    },
    governance: raw.governance ?? { constraints: [], decisions: [], owners: [] },
    changeSet: raw.changeSet ?? {
      id: `change-${slugIdPart(specId, "migrated")}-migration`,
      current: [],
      proposed: [],
      verified: [],
    },
  };
}

export const SpecSchema = z.preprocess(migrateSpecInput, ValidatedSpecObjectSchema);

// LintIssue — the linter emits a list of these. Severity ladder: `block` halts
// export, `warn` is a soft nudge, `info` is observational.
export const LintIssueSchema = z.object({
  id: IdSchema,
  rule: z.string(),
  severity: Severity,
  // Non-waivable blockers (PII without handlingNote) set this to false.
  waivable: z.boolean().default(true),
  message: z.string(),
  // Pointers back into the Spec graph.
  refs: z.array(z.object({
    kind: z.enum([
      "need", "feature", "persona", "scenario", "uxflow", "screen",
      "datapoint", "integration", "api", "test", "adr", "assumption",
      "risk", "non_goal", "stance", "agent",
    ]),
    id: IdSchema,
  })).default([]),
});

// TraceMatrix — derived index, computed & materialized so the linter and handoff
// export don't recompute on every read.
export const TraceMatrixSchema = z.object({
  generatedBy: z.string(),
  // need_id → feature_ids
  needToFeatures: z.record(z.string(), z.array(IdSchema)).default({}),
  // need_id → test_ids
  needToTests: z.record(z.string(), z.array(IdSchema)).default({}),
  // feature_id → api_ids
  featureToApis: z.record(z.string(), z.array(IdSchema)).default({}),
  featureToTests: z.record(z.string(), z.array(IdSchema)).default({}),
  // feature_id → screen_ids / integration_ids / task_ids
  featureToScreens: z.record(z.string(), z.array(IdSchema)).default({}),
  featureToIntegrations: z.record(z.string(), z.array(IdSchema)).default({}),
  featureToTasks: z.record(z.string(), z.array(IdSchema)).default({}),
  // screen / integration / need → implementation task ids
  screenToTasks: z.record(z.string(), z.array(IdSchema)).default({}),
  integrationToTasks: z.record(z.string(), z.array(IdSchema)).default({}),
  needToTasks: z.record(z.string(), z.array(IdSchema)).default({}),
  // implementation task id → tests that verify its satisfied entities
  taskToTests: z.record(z.string(), z.array(IdSchema)).default({}),
  integrationToTests: z.record(z.string(), z.array(IdSchema)).default({}),
  screenToTests: z.record(z.string(), z.array(IdSchema)).default({}),
  flowToScreens: z.record(z.string(), z.array(IdSchema)).default({}),
  platformSurfaceToTests: z.record(z.string(), z.array(IdSchema)).default({}),
  behaviorToScopeRefs: z.record(z.string(), z.array(IdSchema)).default({}),
  behaviorToScreens: z.record(z.string(), z.array(IdSchema)).default({}),
  behaviorToElements: z.record(z.string(), z.array(IdSchema)).default({}),
  behaviorToComponents: z.record(z.string(), z.array(IdSchema)).default({}),
  behaviorToTasks: z.record(z.string(), z.array(IdSchema)).default({}),
  behaviorToStates: z.record(z.string(), z.array(IdSchema)).default({}),
  behaviorToActions: z.record(z.string(), z.array(IdSchema)).default({}),
  behaviorToVerifications: z.record(z.string(), z.array(IdSchema)).default({}),
  behaviorToTests: z.record(z.string(), z.array(IdSchema)).default({}),
  decisionToConstraints: z.record(z.string(), z.array(IdSchema)).default({}),
  decisionToScopeRefs: z.record(z.string(), z.array(IdSchema)).default({}),
  decisionToScreens: z.record(z.string(), z.array(IdSchema)).default({}),
  decisionToElements: z.record(z.string(), z.array(IdSchema)).default({}),
  decisionToComponents: z.record(z.string(), z.array(IdSchema)).default({}),
  decisionToTasks: z.record(z.string(), z.array(IdSchema)).default({}),
  decisionToTests: z.record(z.string(), z.array(IdSchema)).default({}),
  decisionSupersession: z.record(z.string(), IdSchema).default({}),
  designContractIntent: z.enum(["change", "conformance"]).optional(),
  baselineToDeltas: z.record(z.string(), z.array(IdSchema)).default({}),
  constraintToVerifications: z.record(z.string(), z.array(IdSchema)).default({}),
  deltaToTargets: z.record(z.string(), z.array(IdSchema)).default({}),
  deltaToVerifications: z.record(z.string(), z.array(IdSchema)).default({}),
  // adr_id → need_ids/feature_ids it justifies
  adrToTargets: z.record(z.string(), z.array(IdSchema)).default({}),
  // Groundwork: pointer-grade entity layer wiring (additive; existing keys
  // above are untouched). entity_id → feature_ids that read or write it.
  entityToFeatures: z.record(z.string(), z.array(IdSchema)).default({}),
  // Groundwork: the pillar → requirement → design → task → acceptance chain.
  // This is the edge ANNALS-style prompt output cannot produce: a pillar that
  // reaches no acceptance evidence is a stated priority nothing verifies.
  pillarToNeeds: z.record(z.string(), z.array(IdSchema)).default({}),
  pillarToFeatures: z.record(z.string(), z.array(IdSchema)).default({}),
  pillarToInvariants: z.record(z.string(), z.array(IdSchema)).default({}),
  pillarToTasks: z.record(z.string(), z.array(IdSchema)).default({}),
  /** Test ids plus the prime acceptanceTest id when it cites this pillar. */
  pillarToAcceptance: z.record(z.string(), z.array(IdSchema)).default({}),
  // Spec v3 architecture and ordered-task projections. Keys use qualified
  // identities where collisions across Specs are possible.
  componentToFeatures: z.record(z.string(), z.array(IdSchema)).default({}),
  componentToTasks: z.record(z.string(), z.array(IdSchema)).default({}),
  contractToComponents: z.record(z.string(), z.array(IdSchema)).default({}),
  contractToTasks: z.record(z.string(), z.array(IdSchema)).default({}),
  relationshipToTasks: z.record(z.string(), z.array(IdSchema)).default({}),
  architectureFlowToTasks: z.record(z.string(), z.array(IdSchema)).default({}),
  specDependencyToRefs: z.record(z.string(), z.array(IdSchema)).default({}),
  taskDependencies: z.record(z.string(), z.array(IdSchema)).default({}),
  taskToOwnedFiles: z.record(z.string(), z.array(OwnedFileSchema)).optional(),
  taskOwnershipSource: z.record(z.string(), z.enum(["explicit", "inferred"])).optional(),
  taskToPlannedNewFiles: z.record(z.string(), z.array(OwnedFileSchema)).optional(),
  // Per-screen end-to-end impact record. Qualified architecture identities are
  // strings so this remains additive to the compatibility maps above.
  uiImpact: z.array(z.object({
    screenId: IdSchema,
    needIds: z.array(IdSchema).default([]),
    featureIds: z.array(IdSchema).default([]),
    uxFlowIds: z.array(IdSchema).default([]),
    elementIds: z.array(IdSchema).default([]),
    stateImpacts: z.array(z.object({
      state: z.string(),
      architectureFlowRefs: z.array(IdSchema).default([]),
      failurePaths: z.array(z.string()).default([]),
      testIds: z.array(IdSchema).default([]),
    })).default([]),
    dataEntityIds: z.array(IdSchema).default([]),
    componentRefs: z.array(IdSchema).default([]),
    contractRefs: z.array(IdSchema).default([]),
    architectureFlowRefs: z.array(IdSchema).default([]),
    failurePaths: z.array(z.string()).default([]),
    securityNotes: z.array(z.string()).default([]),
    taskIds: z.array(IdSchema).default([]),
    testIds: z.array(IdSchema).default([]),
    unresolved: z.array(z.enum([
      "feature",
      "element-data",
      "data-entity",
      "component",
      "contract",
      "architecture-flow",
      "task",
      "test",
    ])).default([]),
  })).default([]),
  coverageGaps: z.array(z.object({
    kind: z.enum(["need", "feature", "screen", "integration", "task", "pillar"]),
    id: IdSchema,
    missing: z.enum(["feature", "screen", "api", "task", "test", "need", "pillar", "acceptance"]),
  })).default([]),
});

export type EarsCriterion = z.infer<typeof EarsCriterionSchema>;
export type Need = z.infer<typeof NeedSchema>;
export type Feature = z.infer<typeof FeatureSchema>;
export type Persona = z.infer<typeof PersonaSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
export type ElementDataIn = z.infer<typeof ElementDataInSchema>;
export type ElementDataOut = z.infer<typeof ElementDataOutSchema>;
export type ScreenElement = z.infer<typeof ScreenElementSchema>;
export type Screen = z.infer<typeof ScreenSchema>;
export type UXFlow = z.infer<typeof UXFlowSchema>;
export type DataPoint = z.infer<typeof DataPointSchema>;
export type DataModelField = z.infer<typeof DataModelFieldSchema>;
export type DataModelEntity = z.infer<typeof DataModelEntitySchema>;
export type Integration = z.infer<typeof IntegrationSchema>;
export type ExternalManualAction = z.infer<typeof ExternalManualActionSchema>;
export type APIContract = z.infer<typeof APIContractSchema>;
export type Test = z.infer<typeof TestSchema>;
export type ADR = z.infer<typeof ADRSchema>;
export type DecisionRigidity = z.infer<typeof DecisionRigiditySchema>;
export type ContractScope = z.infer<typeof ContractScopeSchema>;
export type BehaviorContract = z.infer<typeof BehaviorContractSchema>;
export type BehaviorAction = z.infer<typeof BehaviorActionSchema>;
export type DesignConstraint = z.infer<typeof DesignConstraintSchema>;
export type DesignContract = z.infer<typeof DesignContractSchema>;
export type Verification = z.infer<typeof VerificationSchema>;
export type Assumption = z.infer<typeof AssumptionSchema>;
export type Risk = z.infer<typeof RiskSchema>;
export type AgentArchitecturePattern = z.infer<typeof AgentArchitecturePatternSchema>;
export type AgentAutonomyLevel = z.infer<typeof AgentAutonomyLevelSchema>;
export type AgentBuilderScale = z.infer<typeof AgentBuilderScaleSchema>;
export type AgentToolPermissionTier = z.infer<typeof AgentToolPermissionTierSchema>;
export type AgentToolContract = z.infer<typeof AgentToolContractSchema>;
export type AgentModelRoute = z.infer<typeof AgentModelRouteSchema>;
export type AgentGuardrail = z.infer<typeof AgentGuardrailSchema>;
export type AgentEvaluation = z.infer<typeof AgentEvaluationSchema>;
export type AgentResearchProtocol = z.infer<typeof AgentResearchProtocolSchema>;
export type AgentUiProtocol = z.infer<typeof AgentUiProtocolSchema>;
export type AgentSystem = z.infer<typeof AgentSystemSchema>;
export type StanceBecauseClause = z.infer<typeof StanceBecauseClauseSchema>;
export type PivotLogEntry = z.infer<typeof PivotLogEntrySchema>;
export type TradeoffWeights = z.infer<typeof TradeoffWeightsSchema>;
export type ProductState = z.infer<typeof ProductStateSchema>;
export type NonGoal = z.infer<typeof NonGoalSchema>;
export type PlatformTarget = z.infer<typeof PlatformTargetSchema>;
export type DesignIntent = z.infer<typeof DesignIntentSchema>;
export type ServiceLevel = z.infer<typeof ServiceLevelSchema>;
export type Goal = z.infer<typeof GoalSchema>;
export type SuccessMetric = z.infer<typeof SuccessMetricSchema>;
export type Observability = z.infer<typeof ObservabilitySchema>;
export type Boundaries = z.infer<typeof BoundariesSchema>;
export type VoiceExample = z.infer<typeof VoiceExampleSchema>;
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;
export type Pillar = z.infer<typeof PillarSchema>;
export type AcceptanceTest = z.infer<typeof AcceptanceTestSchema>;
export type PhaseAcceptance = z.infer<typeof PhaseAcceptanceSchema>;
export type HardConstraint = z.infer<typeof HardConstraintSchema>;
export type PerformanceBudgetEntry = z.infer<typeof PerformanceBudgetEntrySchema>;
export type ArchitecturalInvariant = z.infer<typeof ArchitecturalInvariantSchema>;
export type Nfr = z.infer<typeof NfrSchema>;
export type SpecCodeSync = z.infer<typeof SpecCodeSyncSchema>;
export type ReadingContract = z.infer<typeof ReadingContractSchema>;
export type EvidenceStatus = z.infer<typeof EvidenceStatusSchema>;
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;
export type ProjectContext = z.infer<typeof ProjectContextSchema>;
export type RepoLayout = z.infer<typeof RepoLayoutSchema>;
export type ResponsiveTargets = z.infer<typeof ResponsiveTargetsSchema>;
export type UiPreferences = z.infer<typeof UiPreferencesSchema>;
export type Governance = z.infer<typeof GovernanceSchema>;
export type ChangeRecord = z.infer<typeof ChangeRecordSchema>;
export type ChangeSet = z.infer<typeof ChangeSetSchema>;
export type Spec = z.infer<typeof SpecSchema>;
export type LintIssue = z.infer<typeof LintIssueSchema>;
export type TraceMatrix = z.infer<typeof TraceMatrixSchema>;
