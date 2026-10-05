// ───────────────────────────────────────────────────────────────────────
// Groundwork — typed Spec domain schema
//
// The original domain definitions were ported from ProductPilot's
// shared/schema.ts (the "Adaptive intake / structured spec" section).
// Validation now uses Groundwork's source-owned validation.ts. This module
// defines the structured Spec that flows through intake, doc generation,
// the spec linter, and the coding-agent handoff.
//
// Conventions:
//   - Every entity carries a stable string `id`. Cross-references use these ids
//     so the trace matrix is computable without LLM help.
//   - "because" clauses on stance entries and non-goals are required by the
//     PRD-Builder methodology and become linter rules downstream.
//
// Groundwork extensions:
//   - EARS-shaped acceptance criteria on requirements (needs) and features.
//   - observability section (SLIs/SLOs).
//   - boundaries block (always / askFirst / never).
//   - voiceProfile (voice principles + do/don't word lists).
// All four are OPTIONAL so specs authored before they landed still validate.
// ───────────────────────────────────────────────────────────────────────

import * as v from "./validation.js";
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

const IdSchema = v.string().min(1);
const Priority = v.enum(["P0", "P1", "P2", "P3"]).optional();
const Severity = v.enum(["block", "warn", "info"]);
const Reversibility = v.enum(["high", "medium", "low"]);

// ── Groundwork extension: EARS acceptance criterion ──────────────────────
// `ears` is a "WHEN … THE SYSTEM SHALL …" statement. Attached (optionally) to
// requirements and features so acceptance criteria carry a stable id + an
// EARS-shaped assertion the linter and handoff can trace to tests.
export const EarsCriterionSchema = v.object({
  id: IdSchema,
  ears: v.string(), // "WHEN <trigger>, THE SYSTEM SHALL <response>."
});

// ── Groundwork extension: NFR forcing-field template ─────────────────────
// The six fields a spec must answer for a requirement to be buildable without
// the implementer inventing them. Every field is optional HERE — the renderer
// is the forcing surface: an empty field emits a TAG:UNRESOLVED prompt naming
// what is missing, rather than silently omitting the section. Attachable at the
// spec level (global posture) and per-feature (local override).
export const NfrSchema = v.object({
  /** Test levels + what each proves, e.g. "unit for reducers, e2e for checkout". */
  testStrategy: v.string().optional(),
  edgeCases: v.array(v.string()).default([]),
  errorHandling: v.array(v.string()).default([]),
  validation: v.array(v.string()).default([]),
  security: v.array(v.string()).default([]),
  accessibility: v.array(v.string()).default([]),
});

export const NeedSchema = v.object({
  id: IdSchema,
  title: v.string(),
  description: v.string().optional(),
  priority: Priority,
  source: v.string().optional(), // intake question id or "inferred"
  // Groundwork: EARS-shaped acceptance criteria for this requirement.
  ears: v.array(EarsCriterionSchema).optional(),
  // Groundwork: the pillar(s) this requirement serves. Empty means "not yet
  // traced to a pillar" — the trace builder reports that as a coverage gap
  // only when the Spec actually declares pillars.
  pillarIds: v.array(IdSchema).default([]),
});

export const FeatureSchema = v.object({
  id: IdSchema,
  title: v.string(),
  description: v.string().optional(),
  surface: v.enum(["unspecified", "ui", "api", "tool", "command", "event", "headless"]).default("unspecified"),
  priority: Priority,
  needIds: v.array(IdSchema).default([]),
  acceptanceCriteria: v.array(v.string()).default([]),
  // Groundwork: EARS-shaped acceptance criteria for this feature.
  ears: v.array(EarsCriterionSchema).optional(),
  // Groundwork: per-feature NFR override. When present its non-empty fields
  // land in this feature's task definition-of-done; when absent the feature
  // inherits the spec-level `nfr` posture.
  nfr: NfrSchema.optional(),
  ownedFiles: OwnedFilesSchema.optional(),
});

export const PersonaSchema = v.object({
  id: IdSchema,
  name: v.string(),
  trigger: v.string().optional(),
  exclusions: v.array(v.string()).default([]), // "Who they are NOT"
  jobs: v.array(v.string()).default([]),
});

export const ScenarioSchema = v.object({
  id: IdSchema,
  personaId: IdSchema.optional(),
  context: v.string(),
  goal: v.string(),
  successSignal: v.string().optional(),
});

// ── Groundwork extension: element-level data I/O (pointer-grade) ────────────
// Attached to a screen element so a mockup can declare what data it needs and
// what it shows without Groundwork owning the full persistence spec. Optional
// so screens/elements authored before this landed still validate.
export const ElementDataInSchema = v.object({
  source: v.enum(["user-entry", "search", "computed", "fetched", "none"]),
  expectedType: v.string().optional(),
  note: v.string().optional(),
});
export const ElementDataOutSchema = v.object({
  shows: v.string().optional(),
  expectedType: v.string().optional(),
  note: v.string().optional(),
});
export const ScreenElementSchema = v.object({
  id: IdSchema,
  name: v.string(),
  role: v.string().optional(),
  // Pointer-grade: what data this element needs / displays, not an
  // authoritative persistence or data-flow spec.
  dataIn: ElementDataInSchema.optional(),
  dataOut: ElementDataOutSchema.optional(),
});

export const ScreenSchema = v.object({
  id: IdSchema,
  name: v.string(),
  purpose: v.string(),
  featureIds: v.array(IdSchema).default([]),
  primaryAction: v.string().optional(),
  states: v.array(v.string()).default([]),
  // Groundwork: per-screen design-card fields the DESIGN.md 6-field card needs
  // (purpose/elements/data/states/interactions/rationale). Both optional so
  // screens authored before they landed still validate.
  // UI elements on the screen; `role` is a free-form affordance hint.
  elements: v.array(ScreenElementSchema).optional(),
  // Data the screen reads/writes; `source` is a free-form origin hint
  // (e.g. a dataPoint id, an API path, "local", …).
  data: v.array(v.object({
    field: v.string(),
    source: v.string().optional(),
  })).optional(),
  ownedFiles: OwnedFilesSchema.optional(),
});

export const UXFlowSchema = v.object({
  id: IdSchema,
  name: v.string(),
  steps: v.array(v.string()).default([]),
  screenIds: v.array(IdSchema).default([]),
});

export const DataPointSchema = v.object({
  id: IdSchema,
  name: v.string(),
  type: v.string(), // free-form: "string", "uuid", "decimal(12,2)", etc.
  description: v.string().optional(),
  pii: v.boolean().default(false),
  // Required when pii=true. Linter treats missing handlingNote as a non-waivable
  // block. Schema does NOT enforce here; the linter is the surface that explains
  // the policy.
  handlingNote: v.string().optional(),
});

// ── Groundwork extension: pointer-grade entity/data-model layer ────────────
// A first-class but pointer-scoped data entity linked to the features and
// elements that read or write it. Identifies what kind of data is needed
// where — NOT an authoritative migration or data-flow specification; that
// detail lives downstream in build-loop. Optional/additive so existing specs
// (which carry no dataModel) still validate.
export const DataModelFieldSchema = v.object({
  name: v.string(),
  type: v.string().optional(),
  note: v.string().optional(),
});
export const DataModelEntitySchema = v.object({
  id: IdSchema,
  name: v.string(),
  description: v.string().optional(),
  fields: v.array(DataModelFieldSchema).default([]),
  readByFeatureIds: v.array(IdSchema).optional(),
  writtenByFeatureIds: v.array(IdSchema).optional(),
  // Free-form pointers into screen elements (e.g. "screen-today:Current streak
  // counter") rather than a strict IdSchema, since screen elements don't carry
  // their own stable id.
  elementRefs: v.array(v.string()).optional(),
  ownedFiles: v.array(OwnedFileSchema).default([]),
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

export const ExternalManualActionSchema = v.object({
  id: IdSchema,
  surface: v.string().min(1),
  action: v.string().min(1),
  // A name such as STRIPE_SECRET_KEY or "HealthKit read permission" — never
  // the credential/permission value itself.
  requiredValue: v.string().min(1),
  appDestination: v.string().min(1),
  verification: v.string().min(1),
}).strict().superRefine((action, ctx) => {
  for (const field of ["id", "surface", "action", "requiredValue", "appDestination", "verification"] as const) {
    const reason = externalManualActionSecretReason(action[field]);
    if (reason) {
      ctx.addIssue({
        code: "custom",
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

export const IntegrationSchema = v.object({
  id: IdSchema,
  name: v.string(),
  purpose: v.string(),
  authMode: v.string().optional(),
  docsUrl: v.string().url().optional(),
  featureIds: v.array(IdSchema).default([]),
  ownedFiles: v.array(OwnedFileSchema).default([]),
  requiredEnv: v.array(v.string()).default([]),
  codeSetup: v.array(v.string().min(1)).default([]),
  unclassifiedSetup: v.array(v.string().min(1)).default([]),
  externalManualActions: v.array(ExternalManualActionSchema).default([]),
  verification: v
    .array(v.string().min(1))
    .min(1, "Every integration must declare at least one provider verification step."),
}).strict();

export const APIContractSchema = v.object({
  id: IdSchema,
  method: v.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: v.string(),
  description: v.string().optional(),
  requestSchema: v.string().optional(),
  responseSchema: v.string().optional(),
  featureIds: v.array(IdSchema).default([]),
  ownedFiles: v.array(OwnedFileSchema).default([]),
});

export const TestSchema = v.object({
  id: IdSchema,
  description: v.string(),
  dependsOnTestIds: v.array(IdSchema).default([]),
  needIds: v.array(IdSchema).default([]),
  featureIds: v.array(IdSchema).default([]),
  screenIds: v.array(IdSchema).default([]),
  // Optional pointer-grade coverage for an authored state on a screen.
  stateRefs: v.array(ScreenStateRefSchema).default([]),
  integrationIds: v.array(IdSchema).default([]),
  platformSurfaceIds: v.array(IdSchema).default([]),
  ownedFiles: v.array(OwnedFileSchema).default([]),
  kind: v.enum(["acceptance", "smoke", "unit", "manual"]).default("acceptance"),
  // Free-form framework name. Linter pattern-matches per platformTarget:
  //   web|vite-spa  → /vitest|jest|playwright/i
  //   ios|macos     → /xctest|swift testing/i
  //   claude-plugin → /plugin-builder|manifest-validator|skill-validator|hook-validator|command-validator/i
  // Empty string → linter blocker (waivable).
  testFramework: v.string().default(""),
  // Exact repository command when known. A production-ready handoff must not
  // substitute an unresolved scheme, destination, package, or script name.
  command: v.string().min(1).optional(),
  // Optional validator references — used primarily by claude-plugin platform target where each
  // command/skill/hook artifact must point at a validator (manifest-validator, skill-validator, etc.).
  validatorRefs: v.array(v.string()).default([]),
});

// ── Reproducible product/design contract (optional Spec v3 extension) ──────
// These records capture intended behavior and the evidence needed to rebuild a
// visual direction. They deliberately reference the existing Spec graph rather
// than creating a second document authority.
export const DecisionRigiditySchema = v.enum(["locked", "leaning", "open", "experimental", "superseded"]);
export const ContractScopeSchema = v.object({
  kind: v.enum(["product", "screen", "element", "component", "behavior", "architecture"]),
  refs: v.array(IdSchema).min(1),
}).strict();
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export const JsonValueSchema: v.Schema<JsonValue> = v.lazy(() => v.union([
  v.string(), v.number(), v.boolean(), v.null(), v.array(JsonValueSchema), v.record(v.string(), JsonValueSchema),
]));
export const PredicateSchema = v.object({
  subjectRef: IdSchema,
  propertyPath: v.string().min(1),
  operator: v.enum(["eq", "neq", "in", "not-in", "exists", "not-exists", "gte", "lte", "contains", "excludes"]),
  value: JsonValueSchema.optional(),
}).strict();
export const EffectSchema = v.object({
  kind: v.enum(["state-change", "create", "update", "delete", "schedule", "notify", "navigate", "none"]),
  targetRef: IdSchema,
  propertyPath: v.string().min(1).optional(),
  value: JsonValueSchema.optional(),
}).strict();
export const WriteSchema = v.object({
  storeRef: IdSchema,
  entity: v.string().min(1),
  fields: v.array(v.string().min(1)).default([]),
  mode: v.enum(["create", "update", "delete"]),
}).strict();
export const UserFeedbackSchema = v.object({
  channel: v.enum(["inline", "toast", "modal", "notification", "none"]),
  timing: v.enum(["immediate", "deferred"]),
  message: v.string().min(1).optional(),
}).strict();
export const FailureRecoverySchema = v.object({
  failureCondition: PredicateSchema,
  strategy: v.enum(["retry", "rollback", "resume", "manual", "none"]),
  toStateId: IdSchema.optional(),
  guidance: v.string().min(1),
}).strict();
export const ConfirmationSchema = v.object({
  required: v.boolean(),
  when: PredicateSchema.optional(),
  message: v.string().min(1).optional(),
}).strict();
export const BehaviorActionSchema = v.object({
  id: IdSchema,
  name: v.string().min(1),
  fromStateIds: v.array(IdSchema).default([]),
  toStateId: IdSchema.optional(),
  effects: v.array(EffectSchema).default([]),
  writes: v.array(WriteSchema).default([]),
  prohibitedWrites: v.array(WriteSchema).default([]),
  feedback: UserFeedbackSchema.optional(),
  failure: FailureRecoverySchema.optional(),
  recovery: FailureRecoverySchema.optional(),
  confirmation: ConfirmationSchema.optional(),
}).strict();
export const BehaviorStateSchema = v.object({ id: IdSchema, name: v.string().min(1), visibleRefs: v.array(IdSchema).default([]) }).strict();
export const BehaviorTransitionSchema = v.object({ fromStateId: IdSchema, actionId: IdSchema, toStateId: IdSchema }).strict();
export const InformationFlowSchema = v.object({
  sourceRef: IdSchema, targetRef: IdSchema, data: v.string().min(1), transform: v.string().min(1).optional(),
  classification: v.enum(["public", "local-private", "sensitive"]), persistence: v.enum(["none", "session", "durable"]),
}).strict();
export const VerificationSchema = v.object({
  id: IdSchema, kind: v.enum(["schema", "assertion", "hash", "snapshot", "ibr", "manual"]),
  targetRefs: v.array(IdSchema).default([]), method: v.string().min(1), passCriteria: v.array(PredicateSchema).default([]),
}).strict();
export const BehaviorContractSchema = v.object({
  id: IdSchema, name: v.string().min(1), scope: ContractScopeSchema, trigger: v.string().min(1),
  preconditions: v.array(PredicateSchema).default([]), states: v.array(BehaviorStateSchema).default([]),
  actions: v.array(BehaviorActionSchema).default([]), transitions: v.array(BehaviorTransitionSchema).default([]),
  invariants: v.array(v.string().min(1)).default([]), informationFlow: v.array(InformationFlowSchema).default([]),
  verificationRefs: v.array(IdSchema).default([]),
}).strict();
export const BaselineArtifactSchema = v.object({
  id: IdSchema, path: v.string().min(1), type: v.string().min(1), digest: v.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();
export const BaselinePrecedenceSchema = v.object({ rank: v.number().int().min(1), artifactId: IdSchema }).strict();
export const DesignConstraintSchema = v.object({
  id: IdSchema, kind: v.enum(["exact", "relational", "behavioral", "architectural"]), scope: ContractScopeSchema,
  targetRef: IdSchema, propertyPath: v.string().min(1), operator: PredicateSchema.shape.operator,
  value: JsonValueSchema.optional(), unit: v.string().min(1).optional(), tolerance: v.number().min(0).optional(),
  sourceArtifactId: IdSchema.optional(), verificationRefs: v.array(IdSchema).default([]),
}).strict();
export const DesignDeltaSchema = v.object({
  id: IdSchema, baselineId: IdSchema.optional(), targetRefs: v.array(IdSchema).min(1),
  operation: v.enum(["add", "remove", "replace", "reorder", "preserve"]), before: JsonValueSchema.optional(), after: JsonValueSchema.optional(),
  direction: v.string().min(1), verificationRefs: v.array(IdSchema).default([]),
}).strict();
export const DesignContractSchema = v.object({
  intent: v.object({
    type: v.literal("conformance"),
    evidenceRefs: v.array(IdSchema).min(1),
    acceptanceTestRef: IdSchema,
    verificationRefs: v.array(IdSchema).min(1),
  }).strict().optional(),
  baseline: v.object({
    disposition: v.enum(["observed", "declared", "not-applicable"]), id: IdSchema.optional(), version: v.string().min(1).optional(),
    status: DecisionRigiditySchema.optional(), scope: ContractScopeSchema.optional(), supersedes: IdSchema.optional(), environment: v.record(v.string(), JsonValueSchema).default({}),
    artifacts: v.array(BaselineArtifactSchema).default([]), precedence: v.array(BaselinePrecedenceSchema).default([]),
  }).strict(),
  constraints: v.array(DesignConstraintSchema).default([]),
  direction: v.object({ summary: v.string().min(1), intentRefs: v.array(IdSchema).default([]), mustPreserve: v.array(v.string().min(1)).default([]), mayVary: v.array(v.string().min(1)).default([]) }).strict(),
  deltas: v.array(DesignDeltaSchema).default([]), verification: v.array(VerificationSchema).default([]),
}).strict();

export const ADRSchema = v.object({
  id: IdSchema,
  title: v.string(),
  context: v.string(),
  decision: v.string(),
  consequences: v.string().optional(),
  reversibility: Reversibility,
  // Cites tradeoff weights and stance "because" clauses.
  cites: v.array(v.string()).default([]),
  rigidity: DecisionRigiditySchema.optional(),
  scope: ContractScopeSchema.optional(),
  constraintRefs: v.array(IdSchema).optional(),
  mustPreserve: v.array(v.string().min(1)).optional(),
  mayVary: v.array(v.string().min(1)).optional(),
  changePolicy: v.string().min(1).optional(),
  supersededBy: IdSchema.optional(),
});

export const AssumptionSchema = v.object({
  id: IdSchema,
  text: v.string(),
  confidence: v.enum(["high", "medium", "low"]).default("medium"),
});

export const RiskSchema = v.object({
  id: IdSchema,
  text: v.string(),
  likelihood: v.enum(["high", "medium", "low"]).default("medium"),
  impact: v.enum(["high", "medium", "low"]).default("medium"),
  mitigation: v.string().optional(),
});

// Agent systems need a harness spec, not only app requirements. These schemas
// capture the Agent Builder / Prompt Builder primitives: autonomy, topology,
// tool permissions, memory, guardrails, research evidence, UI archetype, and
// eval coverage.
export const AgentArchitecturePatternSchema = v.enum([
  "single-agent",
  "sequential",
  "router",
  "orchestrator-worker",
  "evaluator-optimizer",
  "interactive",
  "multi-agent",
  "hybrid",
]);

export const AgentAutonomyLevelSchema = v.enum([
  "draft-only",
  "human-in-loop",
  "supervised",
  "autonomous",
]);

export const AgentBuilderScaleSchema = v.enum(["skill", "plugin", "agent", "human"]);

export const AgentToolPermissionTierSchema = v.enum(["T0", "T1", "T2", "T3", "T4", "T5"]);

export const AgentToolContractSchema = v.object({
  id: IdSchema,
  name: v.string(),
  purpose: v.string(),
  permissionTier: AgentToolPermissionTierSchema.default("T1"),
  allowedActions: v.array(v.string()).default([]),
  forbiddenActions: v.array(v.string()).default([]),
  dataAccess: v.string().optional(),
  sideEffects: v.array(v.string()).default([]),
  requiresHumanApproval: v.boolean().default(false),
  auditLog: v.string().optional(),
  rollbackPlan: v.string().optional(),
  failureMode: v.string().optional(),
});

export const AgentModelRouteSchema = v.object({
  id: IdSchema,
  purpose: v.string(),
  provider: v.string().optional(),
  modelTier: v.string().optional(),
  promptContract: v.string().optional(),
});

export const AgentGuardrailSchema = v.object({
  id: IdSchema,
  appliesTo: v.array(v.string()).default([]),
  trigger: v.string(),
  check: v.string(),
  action: v.string(),
  severity: Severity.default("warn"),
  escalation: v.string().optional(),
});

export const AgentEvaluationSchema = v.object({
  id: IdSchema,
  name: v.string(),
  metric: v.string(),
  coverageRefs: v.array(IdSchema).default([]),
  blocking: v.boolean().default(false),
});

export const AgentResearchProtocolSchema = v.object({
  sourcePolicy: v.string().optional(),
  evidenceStandard: v.string().optional(),
  confidencePolicy: v.string().optional(),
  citationRequired: v.boolean().default(false),
  evidenceRefs: v.array(v.string()).default([]),
  openQuestions: v.array(v.string()).default([]),
});

export const AgentUiProtocolSchema = v.object({
  archetype: v.enum([
    "ai-agent-chat",
    "editor-workbench",
    "data-research-tool",
    "saas-dashboard",
    "internal-admin",
    "content-publication",
    "commerce-checkout",
  ]).optional(),
  designMode: v.string().optional(),
  userResearchQuestions: v.array(v.string()).default([]),
  highRiskFailures: v.array(v.string()).default([]),
});

export const AgentSystemSchema = v.object({
  mission: v.string().optional(),
  systemBoundary: v.object({
    inScope: v.array(v.string()).default([]),
    outOfScope: v.array(v.string()).default([]),
  }).default({ inScope: [], outOfScope: [] }),
  builderScale: AgentBuilderScaleSchema.optional(),
  architecturePattern: AgentArchitecturePatternSchema.optional(),
  autonomyLevel: AgentAutonomyLevelSchema.optional(),
  stateOwner: v.string().optional(),
  stopCondition: v.string().optional(),
  modelRoutes: v.array(AgentModelRouteSchema).default([]),
  toolContracts: v.array(AgentToolContractSchema).default([]),
  memoryPolicy: v.string().optional(),
  researchProtocol: AgentResearchProtocolSchema.optional(),
  uiProtocol: AgentUiProtocolSchema.optional(),
  guardrails: v.array(AgentGuardrailSchema).default([]),
  evaluations: v.array(AgentEvaluationSchema).default([]),
  humanCheckpoints: v.array(v.string()).default([]),
  traceabilityRefs: v.array(v.string()).default([]),
});

// Stance "because" clause from PRD-Builder Q3. Captures the qualitative judgment
// that complements numeric tradeoffWeights.
export const StanceBecauseClauseSchema = v.object({
  id: IdSchema,
  category: v.enum(["privacy_data", "complexity", "cost", "category"]),
  stance: v.string(), // "we will not store any user audio on our servers"
  because: v.string(), // "because this is healthcare-adjacent and trust is the moat"
});

// pivotLog — strategic-decision history that survives message-version regenerations.
export const PivotLogEntrySchema = v.object({
  id: IdSchema,
  at: v.string(), // ISO date
  summary: v.string(),
  reason: v.string().optional(),
  affects: v.array(v.string()).default([]), // ids of needs/features the pivot touches
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
export const TradeoffWeightsSchema = v
  .object({
    speed_to_alpha: v.number().int().min(0).max(100),
    scalability: v.number().int().min(0).max(100),
    ux_polish: v.number().int().min(0).max(100),
    maintainability: v.number().int().min(0).max(100),
    cost: v.number().int().min(0).max(100),
    security: v.number().int().min(0).max(100),
    unacceptable_tradeoff: v.enum(TRADEOFF_AXES),
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
export const ProductStateSchema = v.object({
  version: v.number().int().default(1),
  stanceBecauseClauses: v.array(StanceBecauseClauseSchema).default([]),
  pivotLog: v.array(PivotLogEntrySchema).default([]),
  tradeoffWeights: TradeoffWeightsSchema.optional(),
  workingMemory: v.record(v.string(), v.any()).default({}),
  agentProfile: AgentSystemSchema.optional(),
});

export const NonGoalSchema = v.object({
  id: IdSchema,
  text: v.string(),
  // Required by PRD-Builder: every non-goal carries a "because" clause.
  // Linter blocks empty `because` (waivable with reason).
  because: v.string().default(""),
});

// OpenQuestion — typed contract for inline-answer affordances on generated docs.
export const OpenQuestionKind = v.enum(["text", "choice"]);
export const OpenQuestionSchema = v.object({
  topicId: v.string().min(1),
  prompt: v.string().min(1).max(500),
  stageId: v.string().optional(),
  stageNumber: v.number().int().optional(),
  answerKind: OpenQuestionKind.default("text"),
  answerChips: v.array(v.string().min(1).max(120)).max(8).optional(),
  feedsField: v.string().optional(),
  answeredValue: v.string().max(500).optional(),
  answeredAt: v.string().optional(),
});
export type OpenQuestion = v.Infer<typeof OpenQuestionSchema>;

// PlatformTarget — declared per-spec so the linter can apply platform-appropriate
// test-framework rules. Default 'web' for backward compatibility.
// Compatibility projection used by existing render/lint consumers. The full
// topology can describe additional companion/service surfaces, while an
// unsupported primary remains unresolved until those consumers gain support.
export const PlatformTargetSchema = v.enum([
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
export const DesignIntentSchema = v.enum(["iterate-ui", "design-app", "unspecified"]);

// ── Groundwork extension: observability (SLIs/SLOs) ──────────────────────
export const ServiceLevelSchema = v.object({
  metric: v.string(),
  target: v.string(),
});
export const ObservabilitySchema = v.object({
  slis: v.array(ServiceLevelSchema).default([]),
  slos: v.array(ServiceLevelSchema).default([]),
});

// ── Groundwork extension: agent boundaries (Always / Ask-first / Never) ──
export const BoundariesSchema = v.object({
  always: v.array(v.string()).default([]),
  askFirst: v.array(v.string()).default([]),
  never: v.array(v.string()).default([]),
});

// ── Groundwork extension: goals & success metrics ───────────────────────
// Dedicated fields for requirements.md "Goals" / "Success metrics". Previously
// the renderer DERIVED both from scenarios; these give the spec author explicit
// control. Both optional — when absent the renderer falls back to scenarios.
export const GoalSchema = v.object({
  id: IdSchema,
  statement: v.string(),
  // Optional success metric paired with this goal.
  metric: v.string().optional(),
});
export const SuccessMetricSchema = v.object({
  id: IdSchema,
  metric: v.string(),
  target: v.string(),
});

// ── Groundwork extension: voice profile (principles + do/don't + examples) ─
// `examples` carries literal copy strings an implementer can paste. Principles
// and word lists describe a register; only an example shows it. Optional so
// voice profiles authored before it landed still validate — but a profile with
// principles and no examples renders a TAG:UNRESOLVED prompt.
export const VoiceExampleSchema = v.object({
  /** Where this copy appears, e.g. "empty state — no saved runs yet". */
  context: v.string().min(1),
  /** The literal string to ship. */
  copy: v.string().min(1),
});
export const VoiceProfileSchema = v.object({
  principles: v.array(v.string()).default([]),
  doWords: v.array(v.string()).default([]),
  dontWords: v.array(v.string()).default([]),
  examples: v.array(VoiceExampleSchema).default([]),
});

// ── Groundwork extension: pillars + governing sentence ────────────────────
// The ranked non-negotiables the whole product is judged against, and the one
// sentence that settles a scope argument without a meeting. Rendered at the TOP
// of requirements.md: a reader (human or agent) resolves priority conflicts
// from these before reading a single requirement. Ranks must be unique — a tie
// defeats the purpose of ranking.
export const PillarSchema = v.object({
  id: IdSchema,
  /** 1 = highest. Unique across the pillar list (enforced in superRefine). */
  rank: v.number().int().min(1),
  statement: v.string().min(1),
});

// ── Groundwork extension: prime-directive acceptance test ─────────────────
// One observable, time-boxed outcome that decides whether the build succeeded.
// Not a test id in `tests[]` — that layer proves individual requirements; this
// proves the product. Every field below is required ONCE the object is present:
// an acceptance test that is not observable or not time-boxed cannot be run.
export const AcceptanceTestSchema = v.object({
  id: IdSchema.default("acceptance-prime"),
  /** "A first-time user records a run and sees their streak update." */
  statement: v.string().min(1),
  /** What an observer literally watches happen — no inference, no logs-only. */
  observable: v.string().min(1),
  /** The clock bound, e.g. "within 3 minutes of first launch, no docs read". */
  timeBox: v.string().min(1),
  steps: v.array(v.string()).default([]),
  pillarIds: v.array(IdSchema).default([]),
});

// ── Groundwork extension: per-phase runnable acceptance ───────────────────
// One row per delivery phase: what is in scope and the command that proves the
// phase closed. Optional — when absent the handoff emitter DERIVES a table from
// the task layers plus the platform's native verification commands, so a spec
// authored before this field existed still gets runnable phase gates.
export const PhaseAcceptanceSchema = v.object({
  phase: v.string().min(1),
  scope: v.string().min(1),
  /** Runnable: a command, not a wish. */
  acceptance: v.string().min(1),
});

// ── Groundwork extension: hard constraints + performance budget ───────────
export const HardConstraintSchema = v.object({
  id: IdSchema,
  /** Non-negotiable technical or product bound, e.g. "no server-side audio". */
  constraint: v.string().min(1),
  because: v.string().optional(),
});
export const PerformanceBudgetEntrySchema = v.object({
  id: IdSchema,
  metric: v.string().min(1),
  /** The number and its percentile, e.g. "< 1.5s p95". */
  budget: v.string().min(1),
  /** How the budget is measured — ideally a command. */
  measuredBy: v.string().optional(),
});

// ── Groundwork extension: architectural invariants (as executable checks) ──
// `rule` is the prose an implementer reads; `check` is the command CI runs. A
// rule without a check is a wish, so `check` is required once the invariant
// exists — the emitter renders every check into a runnable block.
export const ArchitecturalInvariantSchema = v.object({
  id: IdSchema,
  rule: v.string().min(1),
  /** Executable: shell command, grep, or test id that fails when violated. */
  check: v.string().min(1),
  pillarIds: v.array(IdSchema).default([]),
});

// ── Groundwork extension: spec ↔ code sync rule ───────────────────────────
// Names which artifact wins when implementation and spec disagree, and the
// command that re-syncs. Optional; the emitter falls back to the spec-first
// default so the rule is stated in every handoff whether or not it is authored.
export const SpecCodeSyncSchema = v.object({
  policy: v.enum(["spec-first", "code-first", "bidirectional"]).default("spec-first"),
  specPath: v.string().default("spec.json"),
  /** Command that regenerates the projections after a Spec edit. */
  regenerateCommand: v.string().optional(),
  /** Changes that oblige a Spec update before the work is considered done. */
  triggers: v.array(v.string()).default([]),
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
export const ReadingContractSchema = v.object({
  /** Model tier the set is written for, e.g. "frontier". */
  tier: v.string().min(1).default("frontier"),
  /** What the reader is doing with it, e.g. "codegen", "review", "estimation". */
  context: v.string().min(1).default("codegen"),
  /** Extra standing instructions rendered under the no-compression rule. */
  notes: v.array(v.string().min(1)).default([]),
});

export const EvidenceStatusSchema = v.enum(["observed", "decided", "assumed"]);
export const EvidenceRecordSchema = v.object({
  id: IdSchema,
  status: EvidenceStatusSchema,
  statement: v.string().min(1),
  sourceRefs: v.array(v.string().min(1)).default([]),
});

// ── Groundwork extension: observed repo layout (owned-file path steering) ──
// Captures the INSPECTED repository's real directory conventions so the
// handoff emitter's owned-file inference can preserve observed facts instead
// of always falling back to the generic 'src/…' scaffold shape. Every field
// is optional — absent means "unknown", and the emitter falls back to its
// existing generic-per-platform default for that one field only. Additive:
// specs authored before this field existed carry no `repoLayout` and are
// unaffected.
export const RepoLayoutSchema = v.object({
  /** Where the data model lives, e.g. "prisma/schema.prisma" or "src/db/schema.ts". */
  dataModel: v.string().optional(),
  /**
   * Template for API route files. Must contain the literal token `{path}`,
   * e.g. "app/api/{path}/route.ts". When present without `{path}`, the
   * emitter appends the path segment rather than dropping it.
   */
  apiFilePattern: v.string().optional(),
  integrationsDir: v.string().optional(),
  featuresDir: v.string().optional(),
  screensDir: v.string().optional(),
  testsDir: v.string().optional(),
  /** File suffix for generated test files, e.g. ".test.ts" or ".test.tsx". */
  testFileSuffix: v.string().optional(),
});

export const BootstrapCommandsSchema = v.object({
  install: v.string().min(1),
  typecheck: v.string().min(1),
  test: v.string().min(1),
  build: v.string().min(1),
}).strict();

export const ProjectBootstrapSchema = v.object({
  ownedFiles: v.array(OwnedFileSchema).min(1),
  commands: BootstrapCommandsSchema,
}).strict();

export const ProjectContextSchema = v.object({
  startingPoint: v.enum([
    "unspecified",
    "initial-idea",
    "existing-definition",
    "existing-app",
  ]).default("unspecified"),
  sourceRepo: v.string().optional(),
  sourceUrl: v.string().url().optional(),
  sourceArtifacts: v.array(v.string().min(1)).default([]),
  inspectedAt: v.string().optional(),
  evidence: v.array(EvidenceRecordSchema).default([]),
  // Groundwork: observed repo layout (see RepoLayoutSchema doc comment).
  // Optional/additive so existing specs keep validating unchanged.
  repoLayout: RepoLayoutSchema.optional(),
  declaredNewFiles: v.array(DeclaredNewFileSchema).min(1).optional(),
  bootstrap: ProjectBootstrapSchema.optional(),
});

export const ResponsiveTargetsSchema = v.object({
  minimum: v.string().optional(),
  maximum: v.string().optional(),
  deviceClasses: v.array(v.string().min(1)).default([]),
});

export const UiPreferencesSchema = v.object({
  informationDensity: v.string().optional(),
  brandAdjectives: v.array(v.string().min(1)).default([]),
  accessibilityFloor: v.array(v.string().min(1)).default([]),
  responsiveTargets: ResponsiveTargetsSchema.optional(),
  mustKeep: v.array(v.string().min(1)).default([]),
  mustAvoid: v.array(v.string().min(1)).default([]),
  mayEvolve: v.array(v.string().min(1)).default([]),
  visualReferences: v.array(v.string().min(1)).default([]),
});

// Spec v3 makes project constraints and current/proposed/verified change
// semantics explicit. Implementation evidence remains outside the intended
// Spec and can only be referenced after independent reconciliation.
export const GovernanceSchema = v.object({
  constraints: v.array(v.string().min(1)).default([]),
  decisions: v.array(IdSchema).default([]),
  owners: v.array(v.string().min(1)).default([]),
}).strict();

export const ChangeRecordSchema = v.object({
  id: IdSchema,
  target: QualifiedRefSchema,
  summary: v.string().min(1),
  provenance: ProvenanceSchema,
  evidenceRefs: v.array(IdSchema).default([]),
}).strict();

export const ChangeSetSchema = v.object({
  id: IdSchema,
  current: v.array(ChangeRecordSchema).default([]),
  proposed: v.array(ChangeRecordSchema).default([]),
  verified: v.array(ChangeRecordSchema).default([]),
}).strict();

// Spec — the source-of-truth structured document. Doc generation emits this
// first; the renderer produces stage-specific Markdown second.
const SpecObjectSchema = v.object({
  schemaVersion: v.literal(3),
  id: IdSchema,
  productName: v.string(),
  productDescription: v.string(),
  // Drives platform-specific lint rules. Defaults to 'web' so specs created
  // before the field existed continue to validate.
  platformTarget: PlatformTargetSchema.default("web"),
  platformSurfaces: PlatformSurfacesSchema,
  // Groundwork: design-intent depth switch (see DesignIntentSchema doc
  // comment). Placed at top level (not nested under projectContext) because
  // downstream flow docs read it as a cross-cutting mode switch, not
  // project-inspection metadata.
  designIntent: DesignIntentSchema.default("unspecified"),
  personas: v.array(PersonaSchema).default([]),
  scenarios: v.array(ScenarioSchema).default([]),
  needs: v.array(NeedSchema).default([]),
  features: v.array(FeatureSchema).default([]),
  uxFlows: v.array(UXFlowSchema).default([]),
  screens: v.array(ScreenSchema).default([]),
  dataPoints: v.array(DataPointSchema).default([]),
  // Groundwork: pointer-grade entity layer (see DataModelEntitySchema doc
  // comment). Optional/additive.
  dataModel: v.array(DataModelEntitySchema).default([]),
  integrations: v.array(IntegrationSchema).default([]),
  apiContracts: v.array(APIContractSchema).default([]),
  /** Optional behavior-first contract. Empty preserves every existing Spec v3 input. */
  behaviorContracts: v.array(BehaviorContractSchema).optional(),
  tests: v.array(TestSchema).default([]),
  adrs: v.array(ADRSchema).default([]),
  assumptions: v.array(AssumptionSchema).default([]),
  risks: v.array(RiskSchema).default([]),
  nonGoals: v.array(NonGoalSchema).default([]),
  agentSystem: AgentSystemSchema.optional(),
  // ── Groundwork extensions (all optional; existing specs stay valid) ──
  goals: v.array(GoalSchema).optional(),
  successMetrics: v.array(SuccessMetricSchema).optional(),
  observability: ObservabilitySchema.optional(),
  boundaries: BoundariesSchema.optional(),
  voiceProfile: VoiceProfileSchema.optional(),
  // ── Self-resolving-output extensions (all optional; see each schema's
  // doc comment for why the field exists and how absence renders) ──
  pillars: v.array(PillarSchema).optional(),
  governingSentence: v.string().optional(),
  acceptanceTest: AcceptanceTestSchema.optional(),
  phaseAcceptance: v.array(PhaseAcceptanceSchema).optional(),
  hardConstraints: v.array(HardConstraintSchema).optional(),
  performanceBudget: v.array(PerformanceBudgetEntrySchema).optional(),
  architecturalInvariants: v.array(ArchitecturalInvariantSchema).optional(),
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
    if (declaredPaths.has(entry.path)) ctx.addIssue({ code: "custom", path: ["projectContext", "declaredNewFiles", index, "path"], message: `Duplicate declared-new file: ${entry.path}` });
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
    if (!ownedPaths.has(entry.path)) ctx.addIssue({ code: "custom", path: ["projectContext", "declaredNewFiles", index, "path"], message: `Declared-new file is not owned by any entity: ${entry.path}` });
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
          code: "custom",
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
          code: "custom",
          path: [...path, index, "screenId"],
          message: `Unknown screen reference: ${ref.screenId}`,
        });
      } else if (!states.has(ref.state)) {
        ctx.addIssue({
          code: "custom",
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
          code: "custom",
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
        code: "custom",
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
  const idsByScopeKind: Record<v.Infer<typeof ContractScopeSchema>["kind"], Set<string>> = {
    product: new Set([spec.id]),
    screen: ids.screen,
    element: elementIds,
    component: componentIds,
    behavior: ids.behavior,
    architecture: componentIds,
  };
  const validateScope = (scope: v.Infer<typeof ContractScopeSchema>, path: Array<string | number>, label: string) => {
    check(scope.refs, idsByScopeKind[scope.kind], [...path, "refs"], `${label} ${scope.kind}`);
  };
  const scopesIntersect = (left: v.Infer<typeof ContractScopeSchema>, right: v.Infer<typeof ContractScopeSchema>) =>
    left.kind === "product" || right.kind === "product"
      ? left.kind === right.kind && left.refs.some((ref) => right.refs.includes(ref))
      : left.kind === right.kind && left.refs.some((ref) => right.refs.includes(ref));

  // Decision lifecycle remains authoritative before a visual baseline exists.
  const decisionByIdAlways = new Map(spec.adrs.map((adr) => [adr.id, adr]));
  spec.adrs.forEach((adr, index) => {
    if (adr.rigidity === "superseded") {
      if (!adr.supersededBy || adr.supersededBy === adr.id || !decisionByIdAlways.has(adr.supersededBy)) ctx.addIssue({ code: "custom", path: ["adrs", index, "supersededBy"], message: "A superseded ADR requires an existing non-self supersededBy ADR." });
    } else if (adr.supersededBy) ctx.addIssue({ code: "custom", path: ["adrs", index, "supersededBy"], message: "Only a superseded ADR may declare supersededBy." });
    if (adr.scope) validateScope(adr.scope, ["adrs", index, "scope"], "ADR scope");
    if (adr.rigidity === "locked" && !spec.designContract) ctx.addIssue({ code: "custom", path: ["adrs", index, "constraintRefs"], message: "A locked ADR requires a designContract with an enforceable scoped constraint." });
    const seen = new Set([adr.id]);
    let next = adr.supersededBy;
    while (next) {
      if (seen.has(next)) { ctx.addIssue({ code: "custom", path: ["adrs", index, "supersededBy"], message: "ADR supersession graph contains a cycle." }); break; }
      seen.add(next);
      next = decisionByIdAlways.get(next)?.supersededBy;
    }
  });

  const design = spec.designContract;
  if (design) {
    const rejectDuplicateIds = (items: Array<{ id: string }>, path: Array<string | number>, label: string) => {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        if (seen.has(item.id)) ctx.addIssue({ code: "custom", path: [...path, index, "id"], message: `Duplicate ${label} id: ${item.id}` });
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
        ctx.addIssue({ code: "custom", path: ["designContract", "constraints", index], message: "Exact constraints require sourceArtifactId and verificationRefs." });
      }
      if (item.sourceArtifactId) checkKnown([item.sourceArtifactId], artifactIds, ["designContract", "constraints", index, "sourceArtifactId"], "baseline artifact");
      const compatible = item.kind === "architectural"
        ? ["architecture", "component", "product"].includes(item.scope.kind)
        : item.kind === "behavioral"
          ? ["behavior", "screen", "element", "product"].includes(item.scope.kind)
          : true;
      if (!compatible) ctx.addIssue({ code: "custom", path: ["designContract", "constraints", index, "kind"], message: `${item.kind} constraint is incompatible with ${item.scope.kind} scope.` });
    });
    const baseline = design.baseline;
    const conformance = design.intent?.type === "conformance";
    const requiresBaseline = baseline.disposition === "observed" || baseline.disposition === "declared";
    if (requiresBaseline && (!baseline.id || !baseline.artifacts.length || !baseline.precedence.length)) {
      ctx.addIssue({ code: "custom", path: ["designContract", "baseline"], message: "Observed or declared baselines require id, artifacts, and precedence." });
    }
    if (requiresBaseline && !conformance && !design.deltas.length) {
      ctx.addIssue({ code: "custom", path: ["designContract", "deltas"], message: "A change design contract requires at least one linked delta." });
    }
    if (conformance) {
      if (!requiresBaseline) ctx.addIssue({ code: "custom", path: ["designContract", "baseline", "disposition"], message: "A conformance design contract requires an observed or declared baseline." });
      if (design.deltas.length) ctx.addIssue({ code: "custom", path: ["designContract", "deltas"], message: "A conformance design contract forbids proposed deltas." });
      if (spec.changeSet.proposed.length) ctx.addIssue({ code: "custom", path: ["changeSet", "proposed"], message: "A conformance design contract requires an empty proposed change set." });
      if (!design.constraints.length) ctx.addIssue({ code: "custom", path: ["designContract", "constraints"], message: "A conformance design contract requires evidence-backed constraints." });
      if (!design.verification.length) ctx.addIssue({ code: "custom", path: ["designContract", "verification"], message: "A conformance design contract requires verification with acceptance predicates." });
      const evidenceById = new Map(spec.projectContext.evidence.map((item) => [item.id, item]));
      const evidenceRefs = design.intent!.evidenceRefs;
      if (new Set(evidenceRefs).size !== evidenceRefs.length) ctx.addIssue({ code: "custom", path: ["designContract", "intent", "evidenceRefs"], message: "Conformance evidenceRefs must be unique." });
      evidenceRefs.forEach((ref, index) => {
        const evidence = evidenceById.get(ref);
        const allowedStatuses = baseline.disposition === "observed" ? ["observed"] : ["observed", "decided"];
        if (!evidence) ctx.addIssue({ code: "custom", path: ["designContract", "intent", "evidenceRefs", index], message: `Unknown conformance evidence reference: ${ref}` });
        else if (!evidence.sourceRefs.length || !allowedStatuses.includes(evidence.status)) ctx.addIssue({ code: "custom", path: ["designContract", "intent", "evidenceRefs", index], message: `Conformance evidence ${ref} must be source-backed with status ${allowedStatuses.join(" or ")}.` });
      });
      if (!spec.acceptanceTest || design.intent!.acceptanceTestRef !== spec.acceptanceTest.id || !spec.acceptanceTest.steps.some((step) => step.trim().length > 0)) {
        ctx.addIssue({ code: "custom", path: ["designContract", "intent", "acceptanceTestRef"], message: "Conformance requires the canonical acceptanceTest with at least one executable step." });
      }
      const verificationRefs = design.intent!.verificationRefs;
      if (new Set(verificationRefs).size !== verificationRefs.length) ctx.addIssue({ code: "custom", path: ["designContract", "intent", "verificationRefs"], message: "Conformance verificationRefs must be unique." });
      const verificationById = new Map(design.verification.map((item) => [item.id, item]));
      verificationRefs.forEach((ref, index) => {
        const verification = verificationById.get(ref);
        if (!verification) ctx.addIssue({ code: "custom", path: ["designContract", "intent", "verificationRefs", index], message: `Unknown conformance verification reference: ${ref}` });
        else if (!verification.targetRefs.length || !verification.passCriteria.length) ctx.addIssue({ code: "custom", path: ["designContract", "intent", "verificationRefs", index], message: `Conformance verification ${ref} requires targetRefs and acceptance predicates.` });
      });
      design.constraints.forEach((item, index) => {
        if (!item.sourceArtifactId || !item.verificationRefs.length) ctx.addIssue({ code: "custom", path: ["designContract", "constraints", index], message: "Conformance constraints require sourceArtifactId and verificationRefs." });
        if (!item.verificationRefs.some((ref) => verificationRefs.includes(ref))) ctx.addIssue({ code: "custom", path: ["designContract", "constraints", index, "verificationRefs"], message: "Conformance constraints must cite a substantive intent verification." });
      });
    }
    if (baseline.disposition === "not-applicable" && (baseline.id || baseline.artifacts.length || baseline.precedence.length)) {
      ctx.addIssue({ code: "custom", path: ["designContract", "baseline"], message: "A not-applicable baseline cannot declare identity, artifacts, or precedence." });
    }
    if (baseline.scope) validateScope(baseline.scope, ["designContract", "baseline", "scope"], "baseline scope");
    const artifactPaths = new Map<string, number>();
    baseline.artifacts.forEach((artifact, index) => {
      const segments = artifact.path.split(/[\\/]+/);
      if (/[*?[\]{}]/.test(artifact.path) || artifact.path.startsWith("/") || segments.includes("..")) {
        ctx.addIssue({ code: "custom", path: ["designContract", "baseline", "artifacts", index, "path"], message: "Baseline artifact paths must be exact relative paths without globs or parent traversal." });
      }
      const normalized = segments.filter((segment) => segment && segment !== ".").join("/");
      for (const [prior, priorIndex] of artifactPaths) {
        if (normalized === prior || normalized.startsWith(`${prior}/`) || prior.startsWith(`${normalized}/`)) {
          ctx.addIssue({ code: "custom", path: ["designContract", "baseline", "artifacts", index, "path"], message: `Baseline artifact path overlaps artifact at index ${priorIndex}; precedence would be ambiguous.` });
        }
      }
      artifactPaths.set(normalized, index);
    });
    const ranks = new Set<number>();
    baseline.precedence.forEach((item, index) => {
      if (ranks.has(item.rank)) ctx.addIssue({ code: "custom", path: ["designContract", "baseline", "precedence", index, "rank"], message: `Duplicate precedence rank ${item.rank}.` });
      ranks.add(item.rank);
      checkKnown([item.artifactId], artifactIds, ["designContract", "baseline", "precedence", index, "artifactId"], "baseline artifact");
    });
    design.deltas.forEach((item, index) => {
      if (requiresBaseline && item.baselineId !== baseline.id) ctx.addIssue({ code: "custom", path: ["designContract", "deltas", index, "baselineId"], message: "A delta for an observed or declared baseline must identify that baseline." });
      if (!requiresBaseline && item.baselineId) ctx.addIssue({ code: "custom", path: ["designContract", "deltas", index, "baselineId"], message: "A not-applicable baseline forbids a baseline-linked delta." });
      checkKnown(item.targetRefs, referenceIds, ["designContract", "deltas", index, "targetRefs"], "delta target");
      checkKnown(item.verificationRefs, verificationIds, ["designContract", "deltas", index, "verificationRefs"], "verification");
    });
    const decisionById = new Map(spec.adrs.map((adr) => [adr.id, adr]));
    spec.adrs.forEach((adr, index) => {
      if (adr.rigidity === "superseded") {
        if (!adr.supersededBy || adr.supersededBy === adr.id || !decisionById.has(adr.supersededBy)) ctx.addIssue({ code: "custom", path: ["adrs", index, "supersededBy"], message: "A superseded ADR requires an existing non-self supersededBy ADR." });
      } else if (adr.supersededBy) ctx.addIssue({ code: "custom", path: ["adrs", index, "supersededBy"], message: "Only a superseded ADR may declare supersededBy." });
      const constraintRefs = adr.constraintRefs ?? [];
      if (adr.rigidity === "locked") {
        const enforceable = Boolean(adr.scope) && constraintRefs.some((id) => design.constraints.some((constraint) => constraint.id === id && scopesIntersect(adr.scope!, constraint.scope)));
        if (!enforceable) ctx.addIssue({ code: "custom", path: ["adrs", index, "constraintRefs"], message: "A locked ADR requires an enforceable scoped constraint, including a relational constraint when its scope matches." });
      }
      checkKnown(constraintRefs, constraintIds, ["adrs", index, "constraintRefs"], "constraint");
      if (adr.scope) {
        validateScope(adr.scope, ["adrs", index, "scope"], "ADR scope");
        constraintRefs.forEach((id, constraintIndex) => {
          const constraint = design.constraints.find((candidate) => candidate.id === id);
          if (constraint && !scopesIntersect(adr.scope!, constraint.scope)) ctx.addIssue({ code: "custom", path: ["adrs", index, "constraintRefs", constraintIndex], message: `ADR scope does not intersect constraint ${id} scope.` });
        });
      }
    });
    const decisionIndex = new Map(spec.adrs.map((adr, index) => [adr.id, index]));
    spec.adrs.forEach((adr, index) => {
      const seen = new Set([adr.id]);
      let next = adr.supersededBy;
      while (next) {
        if (seen.has(next)) {
          ctx.addIssue({ code: "custom", path: ["adrs", index, "supersededBy"], message: "ADR supersession graph contains a cycle." });
          break;
        }
        seen.add(next);
        const nextIndex = decisionIndex.get(next);
        next = nextIndex === undefined ? undefined : spec.adrs[nextIndex]?.supersededBy;
      }
    });
    const lockedConstraints = spec.adrs
      .filter((adr) => adr.rigidity === "locked")
      .flatMap((adr) => (adr.constraintRefs ?? []).map((id) => ({ adr, constraint: design.constraints.find((item) => item.id === id) })).filter((item): item is { adr: typeof adr; constraint: v.Infer<typeof DesignConstraintSchema> } => Boolean(item.constraint)));
    const pathsOverlap = (left: string, right: string) => left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);
    const conflicts = (left: v.Infer<typeof DesignConstraintSchema>, right: v.Infer<typeof DesignConstraintSchema>) => {
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
      if (conflicts(left.constraint, right.constraint)) ctx.addIssue({ code: "custom", path: ["adrs", decisionIndex.get(right.adr.id) ?? 0, "constraintRefs"], message: `Locked constraints ${left.constraint.id} and ${right.constraint.id} conflict.` });
    }));
  }
  const behaviorVerificationIds = new Set(design?.verification.map((item) => item.id) ?? []);
  (spec.behaviorContracts ?? []).forEach((contract, contractIndex) => {
    validateScope(contract.scope, ["behaviorContracts", contractIndex, "scope"], "behavior scope");
    check(contract.verificationRefs, behaviorVerificationIds, ["behaviorContracts", contractIndex, "verificationRefs"], "verification");
    const stateIds = new Set(contract.states.map((state) => state.id));
    const actionIds = new Set(contract.actions.map((action) => action.id));
    const checkPredicate = (predicate: v.Infer<typeof PredicateSchema>, path: Array<string | number>) => check([predicate.subjectRef], referenceIds, [...path, "subjectRef"], "predicate subject");
    contract.preconditions.forEach((predicate, index) => checkPredicate(predicate, ["behaviorContracts", contractIndex, "preconditions", index]));
    contract.states.forEach((state, stateIndex) => check(state.visibleRefs, referenceIds, ["behaviorContracts", contractIndex, "states", stateIndex, "visibleRefs"], "visible"));
    const writeIdentity = (write: v.Infer<typeof WriteSchema>) => `${write.storeRef}:${write.entity}:${write.mode}:${write.fields.slice().sort().join(",")}`;
    contract.actions.forEach((action, actionIndex) => {
      check(action.fromStateIds, stateIds, ["behaviorContracts", contractIndex, "actions", actionIndex, "fromStateIds"], "behavior state");
      if (action.toStateId) check([action.toStateId], stateIds, ["behaviorContracts", contractIndex, "actions", actionIndex, "toStateId"], "behavior state");
      const prohibited = new Set(action.prohibitedWrites.map(writeIdentity));
      action.writes.forEach((write, writeIndex) => { if (prohibited.has(writeIdentity(write))) ctx.addIssue({ code: "custom", path: ["behaviorContracts", contractIndex, "actions", actionIndex, "writes", writeIndex], message: "An action cannot both write and prohibit the same normalized write." }); });
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
        code: "custom",
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
      code: "custom",
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
          code: "custom",
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
          code: "custom",
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

export const SpecSchema = v.preprocess(migrateSpecInput, ValidatedSpecObjectSchema);

// LintIssue — the linter emits a list of these. Severity ladder: `block` halts
// export, `warn` is a soft nudge, `info` is observational.
export const LintIssueSchema = v.object({
  id: IdSchema,
  rule: v.string(),
  severity: Severity,
  // Non-waivable blockers (PII without handlingNote) set this to false.
  waivable: v.boolean().default(true),
  message: v.string(),
  // Pointers back into the Spec graph.
  refs: v.array(v.object({
    kind: v.enum([
      "need", "feature", "persona", "scenario", "uxflow", "screen",
      "datapoint", "integration", "api", "test", "adr", "assumption",
      "risk", "non_goal", "stance", "agent",
    ]),
    id: IdSchema,
  })).default([]),
});

// TraceMatrix — derived index, computed & materialized so the linter and handoff
// export don't recompute on every read.
export const TraceMatrixSchema = v.object({
  generatedBy: v.string(),
  // need_id → feature_ids
  needToFeatures: v.record(v.string(), v.array(IdSchema)).default({}),
  // need_id → test_ids
  needToTests: v.record(v.string(), v.array(IdSchema)).default({}),
  // feature_id → api_ids
  featureToApis: v.record(v.string(), v.array(IdSchema)).default({}),
  featureToTests: v.record(v.string(), v.array(IdSchema)).default({}),
  // feature_id → screen_ids / integration_ids / task_ids
  featureToScreens: v.record(v.string(), v.array(IdSchema)).default({}),
  featureToIntegrations: v.record(v.string(), v.array(IdSchema)).default({}),
  featureToTasks: v.record(v.string(), v.array(IdSchema)).default({}),
  // screen / integration / need → implementation task ids
  screenToTasks: v.record(v.string(), v.array(IdSchema)).default({}),
  integrationToTasks: v.record(v.string(), v.array(IdSchema)).default({}),
  needToTasks: v.record(v.string(), v.array(IdSchema)).default({}),
  // implementation task id → tests that verify its satisfied entities
  taskToTests: v.record(v.string(), v.array(IdSchema)).default({}),
  integrationToTests: v.record(v.string(), v.array(IdSchema)).default({}),
  screenToTests: v.record(v.string(), v.array(IdSchema)).default({}),
  flowToScreens: v.record(v.string(), v.array(IdSchema)).default({}),
  platformSurfaceToTests: v.record(v.string(), v.array(IdSchema)).default({}),
  behaviorToScopeRefs: v.record(v.string(), v.array(IdSchema)).default({}),
  behaviorToScreens: v.record(v.string(), v.array(IdSchema)).default({}),
  behaviorToElements: v.record(v.string(), v.array(IdSchema)).default({}),
  behaviorToComponents: v.record(v.string(), v.array(IdSchema)).default({}),
  behaviorToTasks: v.record(v.string(), v.array(IdSchema)).default({}),
  behaviorToStates: v.record(v.string(), v.array(IdSchema)).default({}),
  behaviorToActions: v.record(v.string(), v.array(IdSchema)).default({}),
  behaviorToVerifications: v.record(v.string(), v.array(IdSchema)).default({}),
  behaviorToTests: v.record(v.string(), v.array(IdSchema)).default({}),
  decisionToConstraints: v.record(v.string(), v.array(IdSchema)).default({}),
  decisionToScopeRefs: v.record(v.string(), v.array(IdSchema)).default({}),
  decisionToScreens: v.record(v.string(), v.array(IdSchema)).default({}),
  decisionToElements: v.record(v.string(), v.array(IdSchema)).default({}),
  decisionToComponents: v.record(v.string(), v.array(IdSchema)).default({}),
  decisionToTasks: v.record(v.string(), v.array(IdSchema)).default({}),
  decisionToTests: v.record(v.string(), v.array(IdSchema)).default({}),
  decisionSupersession: v.record(v.string(), IdSchema).default({}),
  designContractIntent: v.enum(["change", "conformance"]).optional(),
  baselineToDeltas: v.record(v.string(), v.array(IdSchema)).default({}),
  constraintToVerifications: v.record(v.string(), v.array(IdSchema)).default({}),
  deltaToTargets: v.record(v.string(), v.array(IdSchema)).default({}),
  deltaToVerifications: v.record(v.string(), v.array(IdSchema)).default({}),
  // adr_id → need_ids/feature_ids it justifies
  adrToTargets: v.record(v.string(), v.array(IdSchema)).default({}),
  // Groundwork: pointer-grade entity layer wiring (additive; existing keys
  // above are untouched). entity_id → feature_ids that read or write it.
  entityToFeatures: v.record(v.string(), v.array(IdSchema)).default({}),
  // Groundwork: the pillar → requirement → design → task → acceptance chain.
  // This is the edge ANNALS-style prompt output cannot produce: a pillar that
  // reaches no acceptance evidence is a stated priority nothing verifies.
  pillarToNeeds: v.record(v.string(), v.array(IdSchema)).default({}),
  pillarToFeatures: v.record(v.string(), v.array(IdSchema)).default({}),
  pillarToInvariants: v.record(v.string(), v.array(IdSchema)).default({}),
  pillarToTasks: v.record(v.string(), v.array(IdSchema)).default({}),
  /** Test ids plus the prime acceptanceTest id when it cites this pillar. */
  pillarToAcceptance: v.record(v.string(), v.array(IdSchema)).default({}),
  // Spec v3 architecture and ordered-task projections. Keys use qualified
  // identities where collisions across Specs are possible.
  componentToFeatures: v.record(v.string(), v.array(IdSchema)).default({}),
  componentToTasks: v.record(v.string(), v.array(IdSchema)).default({}),
  contractToComponents: v.record(v.string(), v.array(IdSchema)).default({}),
  contractToTasks: v.record(v.string(), v.array(IdSchema)).default({}),
  relationshipToTasks: v.record(v.string(), v.array(IdSchema)).default({}),
  architectureFlowToTasks: v.record(v.string(), v.array(IdSchema)).default({}),
  specDependencyToRefs: v.record(v.string(), v.array(IdSchema)).default({}),
  taskDependencies: v.record(v.string(), v.array(IdSchema)).default({}),
  taskToOwnedFiles: v.record(v.string(), v.array(OwnedFileSchema)).optional(),
  taskOwnershipSource: v.record(v.string(), v.enum(["explicit", "inferred"])).optional(),
  taskToPlannedNewFiles: v.record(v.string(), v.array(OwnedFileSchema)).optional(),
  // Per-screen end-to-end impact record. Qualified architecture identities are
  // strings so this remains additive to the compatibility maps above.
  uiImpact: v.array(v.object({
    screenId: IdSchema,
    needIds: v.array(IdSchema).default([]),
    featureIds: v.array(IdSchema).default([]),
    uxFlowIds: v.array(IdSchema).default([]),
    elementIds: v.array(IdSchema).default([]),
    stateImpacts: v.array(v.object({
      state: v.string(),
      architectureFlowRefs: v.array(IdSchema).default([]),
      failurePaths: v.array(v.string()).default([]),
      testIds: v.array(IdSchema).default([]),
    })).default([]),
    dataEntityIds: v.array(IdSchema).default([]),
    componentRefs: v.array(IdSchema).default([]),
    contractRefs: v.array(IdSchema).default([]),
    architectureFlowRefs: v.array(IdSchema).default([]),
    failurePaths: v.array(v.string()).default([]),
    securityNotes: v.array(v.string()).default([]),
    taskIds: v.array(IdSchema).default([]),
    testIds: v.array(IdSchema).default([]),
    unresolved: v.array(v.enum([
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
  coverageGaps: v.array(v.object({
    kind: v.enum(["need", "feature", "screen", "integration", "task", "pillar"]),
    id: IdSchema,
    missing: v.enum(["feature", "screen", "api", "task", "test", "need", "pillar", "acceptance"]),
  })).default([]),
});

export type EarsCriterion = v.Infer<typeof EarsCriterionSchema>;
export type Need = v.Infer<typeof NeedSchema>;
export type Feature = v.Infer<typeof FeatureSchema>;
export type Persona = v.Infer<typeof PersonaSchema>;
export type Scenario = v.Infer<typeof ScenarioSchema>;
export type ElementDataIn = v.Infer<typeof ElementDataInSchema>;
export type ElementDataOut = v.Infer<typeof ElementDataOutSchema>;
export type ScreenElement = v.Infer<typeof ScreenElementSchema>;
export type Screen = v.Infer<typeof ScreenSchema>;
export type UXFlow = v.Infer<typeof UXFlowSchema>;
export type DataPoint = v.Infer<typeof DataPointSchema>;
export type DataModelField = v.Infer<typeof DataModelFieldSchema>;
export type DataModelEntity = v.Infer<typeof DataModelEntitySchema>;
export type Integration = v.Infer<typeof IntegrationSchema>;
export type ExternalManualAction = v.Infer<typeof ExternalManualActionSchema>;
export type APIContract = v.Infer<typeof APIContractSchema>;
export type Test = v.Infer<typeof TestSchema>;
export type ADR = v.Infer<typeof ADRSchema>;
export type DecisionRigidity = v.Infer<typeof DecisionRigiditySchema>;
export type ContractScope = v.Infer<typeof ContractScopeSchema>;
export type BehaviorContract = v.Infer<typeof BehaviorContractSchema>;
export type BehaviorAction = v.Infer<typeof BehaviorActionSchema>;
export type DesignConstraint = v.Infer<typeof DesignConstraintSchema>;
export type DesignContract = v.Infer<typeof DesignContractSchema>;
export type Verification = v.Infer<typeof VerificationSchema>;
export type Assumption = v.Infer<typeof AssumptionSchema>;
export type Risk = v.Infer<typeof RiskSchema>;
export type AgentArchitecturePattern = v.Infer<typeof AgentArchitecturePatternSchema>;
export type AgentAutonomyLevel = v.Infer<typeof AgentAutonomyLevelSchema>;
export type AgentBuilderScale = v.Infer<typeof AgentBuilderScaleSchema>;
export type AgentToolPermissionTier = v.Infer<typeof AgentToolPermissionTierSchema>;
export type AgentToolContract = v.Infer<typeof AgentToolContractSchema>;
export type AgentModelRoute = v.Infer<typeof AgentModelRouteSchema>;
export type AgentGuardrail = v.Infer<typeof AgentGuardrailSchema>;
export type AgentEvaluation = v.Infer<typeof AgentEvaluationSchema>;
export type AgentResearchProtocol = v.Infer<typeof AgentResearchProtocolSchema>;
export type AgentUiProtocol = v.Infer<typeof AgentUiProtocolSchema>;
export type AgentSystem = v.Infer<typeof AgentSystemSchema>;
export type StanceBecauseClause = v.Infer<typeof StanceBecauseClauseSchema>;
export type PivotLogEntry = v.Infer<typeof PivotLogEntrySchema>;
export type TradeoffWeights = v.Infer<typeof TradeoffWeightsSchema>;
export type ProductState = v.Infer<typeof ProductStateSchema>;
export type NonGoal = v.Infer<typeof NonGoalSchema>;
export type PlatformTarget = v.Infer<typeof PlatformTargetSchema>;
export type DesignIntent = v.Infer<typeof DesignIntentSchema>;
export type ServiceLevel = v.Infer<typeof ServiceLevelSchema>;
export type Goal = v.Infer<typeof GoalSchema>;
export type SuccessMetric = v.Infer<typeof SuccessMetricSchema>;
export type Observability = v.Infer<typeof ObservabilitySchema>;
export type Boundaries = v.Infer<typeof BoundariesSchema>;
export type VoiceExample = v.Infer<typeof VoiceExampleSchema>;
export type VoiceProfile = v.Infer<typeof VoiceProfileSchema>;
export type Pillar = v.Infer<typeof PillarSchema>;
export type AcceptanceTest = v.Infer<typeof AcceptanceTestSchema>;
export type PhaseAcceptance = v.Infer<typeof PhaseAcceptanceSchema>;
export type HardConstraint = v.Infer<typeof HardConstraintSchema>;
export type PerformanceBudgetEntry = v.Infer<typeof PerformanceBudgetEntrySchema>;
export type ArchitecturalInvariant = v.Infer<typeof ArchitecturalInvariantSchema>;
export type Nfr = v.Infer<typeof NfrSchema>;
export type SpecCodeSync = v.Infer<typeof SpecCodeSyncSchema>;
export type ReadingContract = v.Infer<typeof ReadingContractSchema>;
export type EvidenceStatus = v.Infer<typeof EvidenceStatusSchema>;
export type EvidenceRecord = v.Infer<typeof EvidenceRecordSchema>;
export type ProjectContext = v.Infer<typeof ProjectContextSchema>;
export type RepoLayout = v.Infer<typeof RepoLayoutSchema>;
export type ResponsiveTargets = v.Infer<typeof ResponsiveTargetsSchema>;
export type UiPreferences = v.Infer<typeof UiPreferencesSchema>;
export type Governance = v.Infer<typeof GovernanceSchema>;
export type ChangeRecord = v.Infer<typeof ChangeRecordSchema>;
export type ChangeSet = v.Infer<typeof ChangeSetSchema>;
export type Spec = v.Infer<typeof SpecSchema>;
export type LintIssue = v.Infer<typeof LintIssueSchema>;
export type TraceMatrix = v.Infer<typeof TraceMatrixSchema>;
