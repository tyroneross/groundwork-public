// ───────────────────────────────────────────────────────────────────────
// Groundwork — handoff generator (tasks.md + builder-handoff.md).
//
// Ported from ProductPilot's server/services/agent-handoff.ts. That module
// emitted a single prose `agent-handoff.md` brief. Groundwork's locked
// decision (SPEC.md §"Decisions locked", "Handoff → build-loop native plan")
// REPLACES that prose shape with a build-loop-consumable PLAN: an ordered,
// dependency-sorted, numbered task list. The build-loop orchestrator reads
// tasks.md directly as its Phase 2 plan.
//
// `renderTasks(spec)` and `renderBuilderHandoff(spec)` are PURE: no LLM calls,
// no DB calls, no I/O. Deterministic given the same Spec.
//
// Task shape (per task):
//   - title              imperative, e.g. "Implement <feature>"
//   - owned files        best-effort inferred from features / screens /
//                        apiContracts; a placeholder path when unknown
//   - definition-of-done acceptance criteria — EARS strings from the relevant
//                        Need.ears / Feature.ears where present
//   - dependencies       earlier task numbers this task builds on
//   - satisfies          requirement / feature / api IDs it implements (trace)
//
// Ordering is dependency-first: scaffold/data layer → API → features → UI
// screens → tests. Because tasks are numbered in that layer order, every
// `dependencies` reference points at a lower (earlier) task number.
//
// Security (ported): DataPoints with pii=true are surfaced by NAME +
// handlingNote only — their contents are never echoed. Section text is
// regex-scrubbed for secret-shaped strings as defense in depth.
// ───────────────────────────────────────────────────────────────────────

import type {
  Spec,
  Need,
  Feature,
  APIContract,
  Screen,
  ScreenElement,
  Test,
  Integration,
  PlatformTarget,
  RepoLayout,
  Nfr,
} from "./spec.js";
import { renderReadingContract, renderSpecCodeSync, unresolved } from "./render.js";
import type { Contract } from "./architecture.js";
import type { Component } from "./architecture.js";
import { compileTaskGraph } from "./graph.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render the full `tasks.md` content for a finalized Spec, in build-loop
 * native plan format. Pure and deterministic.
 *
 * @param spec — the structured Spec (single source of truth).
 * @returns Markdown string ready to drop in as a build-loop Phase 2 plan.
 */
export function renderTasks(spec: Spec, tasks = compileTaskGraph(spec, deriveTasks(spec))): string {

  const sections: string[] = [];
  sections.push(renderHeader(spec, tasks.length));
  sections.push(renderReadingContractSection(spec));
  sections.push(renderPrimeDirective(spec));
  sections.push(renderApproachLenses(spec));
  sections.push(renderReadsFromBoundary(spec));
  sections.push(renderThreatModel(spec));
  sections.push(renderActivationMap(spec));
  sections.push(renderPhaseAcceptance(spec, tasks));
  sections.push(renderInvariantChecks(spec));
  if (tasks.length === 0) {
    sections.push(
      "_No buildable units derived from this Spec (no data points, features, " +
        "screens, API contracts, or tests). Capture at least one before handoff._",
    );
  } else {
    for (const t of tasks) sections.push(renderTask(t, spec.platformTarget));
  }
  sections.push(renderTerminalGate(spec));
  sections.push(renderSpecCodeSyncSection(spec));
  sections.push(renderTraceabilityNote(tasks));

  const joined = sections.filter((s) => s && s.trim().length > 0).join("\n\n");
  return scrubSecretShapedStrings(joined) + "\n";
}

/**
 * Render a self-contained prompt a user can paste into an AI coding tool.
 */
export interface BuilderHandoffInputs {
  docs: Record<string, string>;
  tasks: string;
  traceability: Record<string, unknown>;
  resolvedArchitecture?: unknown;
  visualEvidence?: Record<string, string>;
}

export function renderBuilderHandoff(spec: Spec, inputs: BuilderHandoffInputs): string {
  const lines: string[] = [
    `# Builder handoff — ${spec.productName}`,
    "",
    "> Paste this single file into the AI coding tool working in the target repository.",
    "> The complete written Groundwork contract is embedded below; optional mockups",
    "> and design tokens may be attached when the visual flow produced them.",
    "> The embedded Canonical Spec and Traceability sections are authoritative copies;",
    "> no `spec.json`, `traceability.json`, or other unstated sidecar is required.",
    "",
    renderReadingContractSection(spec),
    "",
    "## Implementation directive",
    "",
    `Build **${spec.productName}** into a high-fidelity, near-production-ready ${PLATFORM_DISPLAY[spec.platformTarget]} result. Do not stop at scaffolding, static screens, or a partial happy path.`,
    "",
    renderPrimeDirective(spec),
    "",
    "## Read before editing",
    "",
    "Treat the embedded sections in this file as one contract, in this order:",
    "",
    "1. Canonical Spec — machine-readable source of truth.",
    "2. Steering — durable product, UI, voice, and operating boundaries.",
    "3. Requirements — users, jobs, scope, metrics, and acceptance criteria.",
    "4. Technical design — architecture, data, APIs, integrations, observability, and ADRs.",
    "5. UI design — screens, states, interactions, voice, and confirmed preferences.",
    "6. Implementation plan — dependency-ordered implementation and verification work.",
    "7. Traceability — requirement-to-screen-to-task-to-test coverage.",
    "8. Optional `design-tokens.md` and `mockups/` attachments — these can add visual evidence but are not required to understand this embedded contract. Preserve them when supplied. Read `mockups/.canvas/gallery-selections.json` first when present; every open element annotation is required UI feedback and must be implemented or explicitly dispositioned.",
    "",
    ...((spec.behaviorContracts?.length ?? 0) || spec.designContract ? [renderBehaviorAndBaselineContract(spec), ""] : []),
    "If code or current runtime behavior conflicts with these artifacts, verify the live state, preserve confirmed user decisions, and record the resolved delta instead of silently choosing one source.",
    "",
    renderDefinitionCompleteness(spec, inputs),
    "",
    "## Delivery contract",
    "",
    "- Implement every declared user flow, screen state, data path, API contract, validation branch, error state, loading state, empty state, and accessibility requirement.",
    "- Match the confirmed UI direction with production-quality responsive behavior; do not replace it with generic framework defaults.",
    "- Wire persistence, security boundaries, observability, and tests. Do not ship mock data, dead controls, placeholder copy, or fake integrations in user-facing paths.",
    "- Implement each external integration adapter, configuration reader, validation path, failure behavior, and testable boundary even when provider credentials are unavailable.",
    "- Leave manual only the external account, dashboard, credential, approval, callback-registration, or provider-console actions that an agent cannot perform locally.",
    "- Run the repo-native typecheck, test, build, and relevant live-flow verification after the final mutation.",
    "",
    renderManualIntegrations(spec),
    "",
    renderDataWireMap(spec),
    "",
    renderSpecCodeSyncSection(spec),
    "",
    "## Completion report",
    "",
    "Return the implemented flows, verification evidence, remaining assumptions, and an exact checklist for every manual integration action. For each manual action include where to perform it, the value or permission needed, where that value belongs in the app, and how to verify success.",
    "",
    renderEmbeddedContract(spec, inputs),
  ];

  return scrubSecretShapedStrings(lines.join("\n")) + "\n";
}

function renderBehaviorAndBaselineContract(spec: Spec): string {
  const lines = ["## Behavior, baseline, and decision contract"];
  if (!(spec.behaviorContracts?.length ?? 0) && !spec.designContract) {
    lines.push("", "_No additive behavior or reproducibility contract declared; preserve the existing Spec v3 behavior._");
    return lines.join("\n");
  }
  for (const behavior of spec.behaviorContracts ?? []) {
    lines.push("", `### Behavior: ${behavior.name} (\`${behavior.id}\`)`, `- Trigger: ${behavior.trigger}`);
    for (const action of behavior.actions) lines.push(`- **${action.name}**: effects ${action.effects.map((effect) => effect.kind).join(", ") || "none"}; writes ${action.writes.map((write) => `${write.storeRef}/${write.entity}`).join(", ") || "none"}; prohibited ${action.prohibitedWrites.map((write) => `${write.storeRef}/${write.entity}`).join(", ") || "none"}.`);
  }
  if (spec.designContract) {
    const { baseline, direction, deltas, verification } = spec.designContract;
    lines.push("", `### Baseline: ${baseline.disposition}${baseline.id ? ` (\`${baseline.id}\`)` : ""}`, `- Contract intent: ${spec.designContract.intent?.type ?? "change"}`, `- Direction: ${direction.summary}`, `- Precedence: ${baseline.precedence.map((item) => `${item.rank}:${item.artifactId}`).join(", ") || "none"}`, `- Deltas: ${deltas.map((item) => item.id).join(", ") || "none"}`, `- Verification: ${verification.map((item) => item.id).join(", ") || "none"}`, "- Authoritative artifacts:", ...baseline.artifacts.map((artifact) => `  - \`${artifact.path}\` — ${artifact.type}; \`${artifact.digest}\``), "- Constraint checklist:", ...spec.designContract.constraints.map((constraint) => `  - [ ] \`${constraint.id}\`: ${constraint.targetRef}.${constraint.propertyPath} ${constraint.operator}${constraint.value === undefined ? "" : ` ${JSON.stringify(constraint.value)}`}; source ${constraint.sourceArtifactId ?? "none"}; verify ${constraint.verificationRefs.join(", ") || "none"}`));
  }
  const decisions = spec.adrs.filter((adr) => adr.rigidity);
  if (decisions.length) lines.push("", "### Decision rigidity", ...decisions.map((adr) => `- **${adr.id}** — ${adr.rigidity}; preserve its declared scope and constraints.`));
  return lines.join("\n");
}

function renderManualIntegrations(spec: Spec): string {
  const lines = ["## External manual integrations"];
  if (!spec.integrations.length) {
    lines.push(
      "",
      "_No external provider account, dashboard, credential, callback-registration, or provider-console action is declared. Architecture-level HTTPS, authentication, persistence, and security work remains AI-owned repository work unless an external provider is explicitly added. If implementation discovers an unavoidable external action, update the Spec and this handoff before completion._",
    );
    return lines.join("\n");
  }

  for (const integration of spec.integrations) {
    lines.push(
      "",
      `### ${integration.name} (\`${integration.id}\`)`,
      "",
      `**Purpose:** ${integration.purpose}`,
      `**Authentication:** ${integration.authMode || "Confirm the provider authentication model before implementation."}`,
      "",
      "**Code the AI must complete:** integration adapter, typed configuration boundary, input/output validation, unavailable/error states, and repo-native tests.",
      "",
      "**Required configuration:**",
    );
    if (integration.requiredEnv.length) {
      for (const name of integration.requiredEnv) lines.push(`- \`${name}\``);
    } else {
      lines.push("- No environment variable is declared; verify whether the platform uses entitlements, generated config, or another provider-specific mechanism.");
    }

    lines.push("", "**AI-owned repository setup:**");
    if (integration.codeSetup.length) {
      for (const step of integration.codeSetup) lines.push(`- ${step}`);
    } else {
      lines.push("- No additional repository setup is declared beyond the adapter and configuration boundary.");
    }
    for (const item of integration.unclassifiedSetup) {
      lines.push(`- **TAG:UNRESOLVED:** classify before implementation closes: ${item}`);
    }

    lines.push("", "**Unavoidable external manual actions:**");
    if (integration.externalManualActions.length) {
      for (const action of integration.externalManualActions) {
        lines.push(`- **${action.id}** at ${action.surface}: ${action.action}`);
        if (action.requiredValue) lines.push(`  - Required value or permission: ${action.requiredValue}`);
        if (action.appDestination) lines.push(`  - App destination: ${action.appDestination}`);
        lines.push(`  - Verify: ${action.verification}`);
      }
    } else {
      lines.push("- None declared. Do not invent a manual step for work the coding agent can perform in the repository.");
    }

    lines.push("", "**Code-owned local/ephemeral verification:**");
    if (integration.verification.length) {
      for (const check of integration.verification) lines.push(`- ${check}`);
    } else {
      lines.push("- Run a real connection or permission check and record the expected success signal and failure behavior.");
    }
    if (integration.docsUrl) lines.push("", `**Provider documentation:** ${integration.docsUrl}`);
  }

  return lines.join("\n");
}

function renderDefinitionCompleteness(spec: Spec, inputs: BuilderHandoffInputs): string {
  const blockers: string[] = [];
  const ownershipTasks = deriveTasks(spec);
  const hasAcceptance = spec.needs.some((need) => (need.ears ?? []).length > 0)
    || spec.features.some((feature) => (feature.ears ?? []).length > 0 || feature.acceptanceCriteria.length > 0);
  const interactiveWithoutWire = spec.screens.flatMap((screen) => (screen.elements ?? []).filter((element) =>
    isInteractiveRole(element.role) && !element.dataIn && !element.dataOut,
  ));
  const hasVisualDirection = Object.keys(inputs.visualEvidence ?? {}).length > 0
    || spec.uiPreferences.brandAdjectives.length > 0
    || spec.uiPreferences.mustKeep.length > 0
    || spec.uiPreferences.visualReferences.length > 0;
  if (spec.projectContext.startingPoint === "unspecified") blockers.push("Starting point is unresolved; inspect or classify the target before choosing repository paths.");
  if (spec.projectContext.startingPoint === "initial-idea" && !spec.projectContext.bootstrap) {
    blockers.push("Clean-sheet bootstrap files and exact install, typecheck, test, and build commands are unresolved.");
  }
  const exactOwnershipRequired = spec.projectContext.startingPoint === "existing-app" || spec.designIntent === "iterate-ui";
  if (exactOwnershipRequired) {
    const inferred = ownershipTasks.filter((task) => task.ownershipSource === "inferred" && task.layer !== "dependency");
    if (inferred.length) blockers.push(`Existing-app ownership is inferred for ${inferred.map((task) => task.id).join(", ")}; inspect and declare exact ownedFiles.`);
  }
  const ambiguous = ownershipTasks.filter((task) => task.ownershipSource === "inferred" && task.satisfies.filter((id) => spec.features.some((feature) => feature.id === id)).some((featureId) => platformsForFeatures(spec, [featureId]).length > 1));
  if (ambiguous.length) blockers.push(`Multi-platform ownership is ambiguous for ${ambiguous.map((task) => task.id).join(", ")}; declare exact ownedFiles per build unit.`);
  if (!hasAcceptance) blockers.push("No executable acceptance criteria are captured.");
  if ((spec.features.length > 0 || spec.screens.length > 0) && spec.tests.length === 0) blockers.push("No acceptance, smoke, unit, or manual tests are captured.");
  if (spec.platformSurfaces.length > 1) {
    const uncovered = spec.platformSurfaces.filter((surface) => surface.featureIds.length > 0
      && !spec.tests.some((candidate) => candidate.platformSurfaceIds.includes(surface.id)));
    if (uncovered.length) blockers.push(`No platform-specific test is assigned to: ${uncovered.map((surface) => `${surface.name} (${surface.id})`).join(", ")}.`);
  }
  if (interactiveWithoutWire.length > 0) blockers.push(`${interactiveWithoutWire.length} interactive element(s) have no declared data input or output.`);
  if (!hasVisualDirection && spec.screens.length > 0) blockers.push("No confirmed UI preference or embedded visual evidence is captured.");

  const lines = ["## Definition completeness"];
  if (!blockers.length) {
    lines.push("", "**READY FOR BUILD:** the handoff contains a classified starting point, acceptance criteria, tests, UI direction, and data wires for every declared interactive element.");
  } else {
    lines.push(
      "",
      "**BLOCKED — RETURN TO GROUNDWORK BEFORE CLAIMING NEAR-PRODUCTION READINESS.** The embedded file is self-contained, but the accepted definition is incomplete:",
      "",
      ...blockers.map((blocker) => `- ${blocker}`),
      "",
      "Do not invent these decisions in the coding tool. Resolve them with the user, regenerate this handoff, and continue only when this section reports READY FOR BUILD.",
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Anti-dead-UI handoff wire-map
//
// Groundwork's element-level dataIn/dataOut and top-level dataModel are
// pointer-grade signals (see spec.ts doc comments) — they name the wire a
// control needs, not the persistence or data-flow implementation. This
// section makes that pointer explicit and loud: every interactive element
// that has no resolved dataIn AND no resolved dataOut is a control that will
// render but do nothing until build-loop wires it. The governing message:
// these elements need these data wires — build-loop, focus here; Groundwork
// is not the data-flow source of truth.
// ---------------------------------------------------------------------------

// Free-form ScreenElement.role hint matched against affordance-shaped words.
// Deliberately broad (button/nav/search/link/field/input/toggle/control/
// action/form/submit/select/menu/tab) — a false positive here just means an
// extra line in a Markdown doc; a false negative silently ships a dead
// control, which is the exact failure this section exists to catch.
const INTERACTIVE_ROLE_RE =
  /\b(button|nav(?:igation)?|search|link|field|input|toggle|control|action|form|submit|select|checkbox|radio|menu|tab)\b/i;

function isInteractiveRole(role: string | undefined): boolean {
  return Boolean(role && INTERACTIVE_ROLE_RE.test(role));
}

function describeElementDataIn(el: ScreenElement): string {
  if (!el.dataIn) return "_none declared_";
  const type = el.dataIn.expectedType ? ` (\`${el.dataIn.expectedType}\`)` : "";
  const note = el.dataIn.note ? ` — ${el.dataIn.note}` : "";
  return `${el.dataIn.source}${type}${note}`;
}

function describeElementDataOut(el: ScreenElement): string {
  if (!el.dataOut) return "_none declared_";
  const shows = el.dataOut.shows?.trim() ? el.dataOut.shows : "(unspecified)";
  const type = el.dataOut.expectedType ? ` (\`${el.dataOut.expectedType}\`)` : "";
  const note = el.dataOut.note ? ` — ${el.dataOut.note}` : "";
  return `${shows}${type}${note}`;
}

function featureLabel(spec: Spec, featureId: string): string {
  const feature = spec.features.find((f) => f.id === featureId);
  return feature ? `${feature.title} (\`${featureId}\`)` : `\`${featureId}\``;
}

/**
 * Render the anti-dead-UI wire-map section of builder-handoff.md: every
 * interactive ScreenElement across every screen, its resolved dataIn/dataOut,
 * a DEAD-CONTROL RISK flag when neither resolved, and the dataModel entities
 * with the features that read/write them. Pure; degrades to "none captured"
 * text for specs authored before dataIn/dataOut/dataModel existed (additive,
 * backward compatible — see spec.ts ElementDataInSchema/DataModelEntitySchema
 * doc comments).
 */
function renderDataWireMap(spec: Spec): string {
  const lines: string[] = [
    "## Data wire map",
    "",
    "> These element-level wires map UI controls to the authoritative embedded " +
      "architecture contracts and data model. Implement the full persistence, " +
      "transport, failure, and security semantics declared in those sections; " +
      "do not treat a view-level pointer as a replacement for them.",
  ];

  const screensWithElements = spec.screens.filter((s) => (s.elements ?? []).length > 0);
  if (!screensWithElements.length) {
    lines.push("", "_No screen elements captured — nothing to wire yet._");
  } else {
    let deadControlCount = 0;
    for (const screen of screensWithElements) {
      lines.push("", `### Screen: ${screen.name} (\`${screen.id}\`)`, "");
      for (const el of screen.elements ?? []) {
        const roleLabel = el.role ? ` _(${el.role})_` : "";
        const hasWire = Boolean(el.dataIn) || Boolean(el.dataOut);
        const flag = isInteractiveRole(el.role) && !hasWire
          ? " — **DEAD-CONTROL RISK**: interactive element declares no data wire."
          : "";
        if (flag) deadControlCount++;
        lines.push(
          `- **${el.name}**${roleLabel} — dataIn: ${describeElementDataIn(el)} · ` +
            `dataOut: ${describeElementDataOut(el)}${flag}`,
        );
      }
    }
    lines.push(
      "",
      deadControlCount
        ? `**${deadControlCount} DEAD-CONTROL RISK element(s) above.** Wire dataIn/dataOut ` +
            "(or confirm the control is intentionally static) before implementation closes."
        : "_No dead-control risk detected: every interactive element declares at least one data wire._",
    );
  }

  lines.push("", "### Data model entities");
  if (!spec.dataModel.length) {
    lines.push(
      "",
      "_No dataModel entities declared. Element-level dataIn/dataOut above " +
        "(when present) is the only pointer-grade data signal captured; the " +
        "full entity and persistence design is build-loop's to make._",
    );
  } else {
    for (const entity of spec.dataModel) {
      const reads = entity.readByFeatureIds?.length
        ? entity.readByFeatureIds.map((id) => featureLabel(spec, id)).join(", ")
        : "_none declared_";
      const writes = entity.writtenByFeatureIds?.length
        ? entity.writtenByFeatureIds.map((id) => featureLabel(spec, id)).join(", ")
        : "_none declared_";
      const refs = entity.elementRefs?.length ? entity.elementRefs.join(", ") : "_none declared_";
      const desc = entity.description ? ` — ${entity.description}` : "";
      lines.push(
        "",
        `- **${entity.name}** (\`${entity.id}\`)${desc}`,
        `  - Read by: ${reads}`,
        `  - Written by: ${writes}`,
        `  - Element refs: ${refs}`,
      );
    }
  }

  return lines.join("\n");
}

function renderEmbeddedContract(spec: Spec, inputs: BuilderHandoffInputs): string {
  const sections: string[] = ["## Embedded Groundwork contract"];
  const replacements = portablePathReplacements(spec);
  const portable = (body: string) => {
    let value = body;
    for (const [localPath, label] of replacements) {
      value = value.split(localPath).join(label);
      const jsonEscaped = JSON.stringify(localPath).slice(1, -1);
      if (jsonEscaped !== localPath) value = value.split(jsonEscaped).join(label);
    }
    value = value.replace(
      /\/(?:Users|home|tmp|private|Volumes|var\/folders)\/[^\s`"'<>()[\]{}]+/g,
      "[machine-local path redacted; inspect the current repository]",
    );
    value = value.replace(
      /[A-Za-z]:\\(?:Users|Temp)\\[^\s`"'<>()[\]{}]+/g,
      "[machine-local path redacted; inspect the current repository]",
    );
    value = value.replace(
      /[A-Za-z]:\\\\(?:Users|Temp)\\\\[^`"<>()[\]{}\n]+/g,
      "[machine-local path redacted; inspect the current repository]",
    );
    return value;
  };
  const append = (title: string, language: string, body: string) => {
    const content = portable(body).trimEnd();
    const longest = Math.max(0, ...Array.from(content.matchAll(/~+/g), (match) => match[0].length));
    const fence = "~".repeat(Math.max(4, longest + 1));
    sections.push("", `### ${title}`, "", `${fence}${language}`, content, fence);
  };
  append("Canonical Spec", "json", JSON.stringify(spec, null, 2));
  append("Steering", "markdown", inputs.docs["steering.md"] ?? "");
  append("Requirements", "markdown", inputs.docs["requirements.md"] ?? "");
  append("Technical design", "markdown", inputs.docs["design.md"] ?? "");
  if (inputs.resolvedArchitecture) {
    append("Resolved architecture graph", "json", JSON.stringify(inputs.resolvedArchitecture, null, 2));
  }
  append("UI design", "markdown", inputs.docs["design-system.md"] ?? "");
  for (const [label, body] of Object.entries(inputs.visualEvidence ?? {})) {
    append(label, label.endsWith(".json") ? "json" : label.endsWith(".html") ? "html" : "markdown", body);
  }
  append("Implementation plan", "markdown", inputs.tasks);
  append("Traceability", "json", JSON.stringify(inputs.traceability, null, 2));
  return sections.join("\n");
}

function portablePathReplacements(spec: Spec): Array<[string, string]> {
  const paths: Array<[string | undefined, string]> = [
    ...spec.projectContext.sourceArtifacts.map((value): [string, string] => [value, "[current-state path redacted; inspect the current repository]"]),
    ...spec.projectContext.evidence.flatMap((item) =>
      item.sourceRefs.map((value): [string, string] => [value, "[current-state path redacted; inspect the current repository]"]),
    ),
    ...spec.uiPreferences.visualReferences.map((value): [string, string] => [value, "[visual-source path redacted; use embedded visual evidence]"]),
  ];
  const machineLocal = /^(?:\/(?:Users|home|tmp|private|Volumes|var\/folders)(?:\/|$)|[A-Za-z]:[\\/](?:Users|Temp)(?:[\\/]|$)|\\\\[^\\]+\\[^\\]+)/;
  const replacements = paths
    .filter((entry): entry is [string, string] => Boolean(entry[0]) && machineLocal.test(entry[0]!))
  if (spec.projectContext.sourceRepo) {
    replacements.push([spec.projectContext.sourceRepo, "[repository path redacted; use the repository where this handoff is executed]"]);
  }
  return replacements.sort((left, right) => right[0].length - left[0].length);
}

// ---------------------------------------------------------------------------
// Task model
// ---------------------------------------------------------------------------

export type TaskLayer = "scaffold" | "dependency" | "integration" | "contract" | "component" | "api" | "feature" | "screen" | "test";

export interface Task {
  id: string;
  n: number;
  layer: TaskLayer;
  title: string;
  /** Best-effort inferred owned files (never empty — placeholder if unknown). */
  ownedFiles: string[];
  /** Whether ownership was authored in the Spec or inferred from topology/layout. */
  ownershipSource: "explicit" | "inferred";
  /** Owned files explicitly declared as intentionally absent until this build. */
  plannedNewFiles: string[];
  /** Definition-of-done lines (acceptance criteria; EARS where present). */
  dod: string[];
  /** Earlier task numbers this task depends on. */
  deps: number[];
  /** Requirement / feature / api / screen / test IDs this task satisfies. */
  satisfies: string[];
}

// ---------------------------------------------------------------------------
// Derivation — the port's mapping logic, re-shaped into a dependency graph
// ---------------------------------------------------------------------------

export function deriveTasks(spec: Spec): Task[] {
  const tasks: Array<Omit<Task, "ownershipSource" | "plannedNewFiles"> & { ownershipSource?: Task["ownershipSource"] }> = [];
  let n = 0;
  const next = () => ++n;
  const repoLayout = spec.projectContext.repoLayout;

  const needById = new Map<string, Need>();
  for (const need of spec.needs) needById.set(need.id, need);

  // ── Layer 1: scaffold / data model ────────────────────────────────────
  // Emitted whenever there is anything to build. Owns project scaffold and
  // the data layer; every later layer depends on it.
  const hasWork =
    spec.dataPoints.length > 0 ||
    spec.features.length > 0 ||
    spec.screens.length > 0 ||
    spec.integrations.length > 0 ||
    spec.architecture.components.length > 0 ||
    spec.architecture.contracts.length > 0 ||
    spec.apiContracts.length > 0 ||
    spec.tests.length > 0;

  const scaffoldNum = next();
  tasks.push({
    id: "task-scaffold",
    n: scaffoldNum,
    layer: "scaffold",
    title: hasWork ? scaffoldTitle(spec) : "Confirm project baseline and capture implementation scope",
    ownedFiles: scaffoldOwnedFiles(spec),
    dod: scaffoldDoD(spec),
    deps: [],
    satisfies: spec.dataPoints.map((d) => d.id),
  });

  const scaffoldDeps = scaffoldNum ? [scaffoldNum] : [];

  // ── Layer 2: pinned cross-Spec dependencies ──────────────────────────
  // These tasks do not implement another repository. They make the local
  // integration/compatibility boundary explicit and give remote hard edges a
  // stable task anchor for dependency ordering and evidence mapping.
  for (const dependency of spec.architecture.specDependencies) {
    const num = next();
    tasks.push({
      id: `task-spec-dependency-${slug(dependency.id)}`,
      n: num,
      layer: "dependency",
      title: `Verify pinned Spec dependency: ${dependency.specId}`,
      ownedFiles: [`dependency:${dependency.specId}`],
      dod: [
        `Resolve only the pinned ${dependency.relationship} dependency ${dependency.specId}.`,
        `Verify schema v${dependency.schemaVersion}, revision ${dependency.revision}, and digest ${dependency.digest}.`,
        "Do not fetch a network URI or mutate the dependency's desired Spec.",
      ],
      deps: scaffoldDeps,
      satisfies: [dependency.id, dependency.specId],
    });
  }

  // ── Layer 3: external integration code ──────────────────────────────
  const integrationTaskNum = new Map<string, number>();
  for (const integration of spec.integrations) {
    const num = next();
    integrationTaskNum.set(integration.id, num);
    tasks.push({
      id: `task-integration-${slug(integration.id)}`,
      n: num,
      layer: "integration",
      title: `Implement integration: ${integration.name}`,
      ownedFiles: integration.ownedFiles.length
        ? integration.ownedFiles
        : repoLayout?.integrationsDir
          ? [integrationOwnedFile(integration, spec.platformTarget, repoLayout)]
          : spec.projectContext.bootstrap
            ? ownedFilesForFeatures(spec, integration.featureIds, "integrations", integration.name)
            : [integrationOwnedFile(integration, spec.platformTarget)],
      dod: integrationDoD(integration),
      deps: scaffoldDeps,
      satisfies: [integration.id, ...integration.featureIds],
    });
  }

  // ── Layer 3: logical architecture contracts ─────────────────────────
  const architectureContractTaskNum = new Map<string, number>();
  for (const contract of spec.architecture.contracts) {
    const num = next();
    architectureContractTaskNum.set(contract.id, num);
    tasks.push({
      id: `task-contract-${slug(contract.id)}`,
      n: num,
      layer: "contract",
      title: `Implement architecture contract: ${contract.name}`,
      ownedFiles: contractOwnedFiles(contract, spec),
      dod: architectureContractDoD(contract),
      deps: scaffoldDeps,
      satisfies: [contract.id],
    });
  }

  // ── Layer 4: logical architecture components ────────────────────────
  const componentTaskNum = new Map<string, number>();
  for (const component of spec.architecture.components) {
    const num = next();
    componentTaskNum.set(component.id, num);
    const contractDeps = spec.architecture.contracts
      .filter((contract) => [contract.provider, ...contract.consumers]
        .some((ref) => ref.specId === spec.id && ref.kind === "component" && ref.id === component.id))
      .map((contract) => architectureContractTaskNum.get(contract.id)!)
      .filter((value) => value != null);
    const integrationDeps = spec.integrations
      .filter((integration) => integration.featureIds.some((featureId) => component.featureIds.includes(featureId)))
      .map((integration) => integrationTaskNum.get(integration.id)!)
      .filter((value) => value != null);
    const componentDeps = uniqueSorted([...contractDeps, ...integrationDeps]);
    tasks.push({
      id: `task-component-${slug(component.id)}`,
      n: num,
      layer: "component",
      title: `Implement component: ${component.name}`,
      ownedFiles: componentOwnedFiles(component, spec),
      dod: componentDoD(component),
      deps: componentDeps.length ? componentDeps : scaffoldDeps,
      satisfies: [component.id, ...component.featureIds],
    });
  }

  // ── Layer 3: API contracts ────────────────────────────────────────────
  const apiTaskNum = new Map<string, number>();
  for (const api of spec.apiContracts) {
    const num = next();
    apiTaskNum.set(api.id, num);
    const servedFeatures = api.featureIds
      .map((fid) => spec.features.find((f) => f.id === fid))
      .filter((f): f is Feature => Boolean(f));
    const integrationDeps = spec.integrations
      .filter((integration) => integration.featureIds.some((id) => api.featureIds.includes(id)))
      .map((integration) => integrationTaskNum.get(integration.id)!)
      .filter((x) => x != null);
    const contractDeps = spec.architecture.contracts
      .filter((contract) => [contract.provider, ...contract.consumers].some((ref) => {
        if (ref.specId !== spec.id || ref.kind !== "component") return false;
        return spec.architecture.components.find((component) => component.id === ref.id)
          ?.featureIds.some((id) => api.featureIds.includes(id));
      }))
      .map((contract) => architectureContractTaskNum.get(contract.id)!)
      .filter((x) => x != null);
    const providerComponentIds = new Set(spec.architecture.contracts
      .filter((contract) => contract.provider.specId === spec.id && contract.provider.kind === "component")
      .filter((contract) => spec.architecture.components
        .find((component) => component.id === contract.provider.id)
        ?.featureIds.some((id) => api.featureIds.includes(id)))
      .map((contract) => contract.provider.id));
    const componentDeps = spec.architecture.components
      .filter((component) => providerComponentIds.has(component.id))
      .map((component) => componentTaskNum.get(component.id)!)
      .filter((x) => x != null);
    const apiDeps = uniqueSorted([...integrationDeps, ...contractDeps, ...componentDeps]);
    tasks.push({
      id: `task-api-${slug(api.id)}`,
      n: num,
      layer: "api",
      title: `Implement API \`${api.method} ${api.path}\``,
      ownedFiles: api.ownedFiles.length
        ? api.ownedFiles
        : repoLayout?.apiFilePattern
          ? [apiOwnedFile(api, repoLayout)]
          : spec.projectContext.bootstrap
            ? apiOwnedFiles(api, spec)
            : [apiOwnedFile(api)],
      dod: apiDoD(api, servedFeatures, needById),
      deps: apiDeps.length ? apiDeps : scaffoldDeps,
      satisfies: [api.id, ...api.featureIds],
    });
  }

  // ── Layer 4: features ─────────────────────────────────────────────────
  const featureTaskNum = new Map<string, number>();
  // need id → feature task numbers that serve it (features satisfy needs).
  const needToFeatureTasks = new Map<string, number[]>();
  for (const feature of spec.features) {
    const num = next();
    featureTaskNum.set(feature.id, num);
    // Depend on the API tasks that serve this feature; fall back to scaffold.
    const apiDeps = spec.apiContracts
      .filter((a) => a.featureIds.includes(feature.id))
      .map((a) => apiTaskNum.get(a.id)!)
      .filter((x) => x != null);
    const integrationDeps = spec.integrations
      .filter((integration) => integration.featureIds.includes(feature.id))
      .map((integration) => integrationTaskNum.get(integration.id)!)
      .filter((x) => x != null);
    const architectureDeps = spec.architecture.contracts
      .filter((contract) => [contract.provider, ...contract.consumers].some((ref) => {
        if (ref.specId !== spec.id || ref.kind !== "component") return false;
        return spec.architecture.components.find((component) => component.id === ref.id)?.featureIds.includes(feature.id);
      }))
      .map((contract) => architectureContractTaskNum.get(contract.id)!)
      .filter((x) => x != null);
    const componentDeps = spec.architecture.components
      .filter((component) => component.featureIds.includes(feature.id))
      .map((component) => componentTaskNum.get(component.id)!)
      .filter((x) => x != null);
    const explicitDeps = [...componentDeps, ...architectureDeps, ...apiDeps, ...integrationDeps];
    const deps = explicitDeps.length ? explicitDeps : scaffoldDeps;
    tasks.push({
      id: `task-feature-${slug(feature.id)}`,
      n: num,
      layer: "feature",
      title: `Implement feature: ${feature.title}`,
      ownedFiles: feature.ownedFiles ?? (repoLayout?.featuresDir
        ? [featureOwnedFile(feature, spec.platformTarget, repoLayout)]
        : spec.projectContext.bootstrap
          ? ownedFilesForFeatures(spec, [feature.id], "features", feature.title)
          : [featureOwnedFile(feature, spec.platformTarget)]),
      dod: featureDoD(feature, needById),
      deps: uniqueSorted(deps),
      satisfies: [feature.id, ...feature.needIds],
    });
    for (const needId of feature.needIds) {
      const arr = needToFeatureTasks.get(needId) ?? [];
      arr.push(num);
      needToFeatureTasks.set(needId, arr);
    }
  }

  const allFeatureTaskNums = Array.from(featureTaskNum.values());

  // ── Layer 5: UI screens ───────────────────────────────────────────────
  const screenTaskNum = new Map<string, number>();
  for (const screen of spec.screens) {
    const num = next();
    screenTaskNum.set(screen.id, num);
    const linkedFeatureDeps = screen.featureIds
      .map((featureId) => featureTaskNum.get(featureId))
      .filter((x): x is number => x != null);
    const deps = linkedFeatureDeps.length
      ? linkedFeatureDeps
      : allFeatureTaskNums.length
        ? allFeatureTaskNums
        : scaffoldDeps;
    tasks.push({
      id: `task-screen-${slug(screen.id)}`,
      n: num,
      layer: "screen",
      title: `Build screen: ${screen.name}`,
      ownedFiles: screen.ownedFiles ?? (repoLayout?.screensDir
        ? [screenOwnedFile(screen, spec.platformTarget, repoLayout)]
        : spec.projectContext.bootstrap
          ? ownedFilesForFeatures(spec, screen.featureIds, "screens", screen.name, true)
          : [screenOwnedFile(screen, spec.platformTarget)]),
      dod: screenDoD(screen),
      deps: uniqueSorted(deps),
      satisfies: [screen.id, ...screen.featureIds],
    });
  }

  // ── Layer 6: tests ────────────────────────────────────────────────────
  const firstTestNumber = n + 1;
  const testTaskNum = new Map(spec.tests.map((candidate, index) => [candidate.id, firstTestNumber + index]));
  for (const test of spec.tests) {
    const num = next();
    // Depend on the feature tasks the test covers (directly via featureIds,
    // or via needIds → features that serve those needs). Fall back to all
    // feature tasks, then scaffold.
    const directFeatureDeps = test.featureIds
      .map((fid) => featureTaskNum.get(fid))
      .filter((x): x is number => x != null);
    const needFeatureDeps = test.featureIds.length
      ? []
      : test.needIds.flatMap((nid) => needToFeatureTasks.get(nid) ?? []);
    const integrationDeps = test.integrationIds
      .map((integrationId) => integrationTaskNum.get(integrationId))
      .filter((x): x is number => x != null);
    const screenDeps = test.screenIds
      .map((screenId) => screenTaskNum.get(screenId))
      .filter((x): x is number => x != null);
    const testDeps = test.dependsOnTestIds
      .map((testId) => testTaskNum.get(testId))
      .filter((x): x is number => x != null);
    let deps = uniqueSorted([
      ...directFeatureDeps,
      ...needFeatureDeps,
      ...integrationDeps,
      ...screenDeps,
      ...testDeps,
    ]);
    if (deps.length === 0) {
      deps = allFeatureTaskNums.length ? uniqueSorted(allFeatureTaskNums) : scaffoldDeps;
    }
    tasks.push({
      id: `task-test-${slug(test.id)}`,
      n: num,
      layer: "test",
      title: `Write ${test.kind} test: ${truncate(test.description, 60)}`,
      ownedFiles: test.ownedFiles.length
        ? test.ownedFiles
        : repoLayout?.testsDir
          ? [testOwnedFile(test, spec.platformTarget, repoLayout)]
          : spec.projectContext.bootstrap
            ? testOwnedFiles(test, spec)
            : [testOwnedFile(test, spec.platformTarget)],
      dod: testDoD(test, spec.platformTarget),
      deps,
      satisfies: [test.id, ...test.needIds, ...test.featureIds, ...test.integrationIds],
    });
  }

  const declaredNew = new Set((spec.projectContext.declaredNewFiles ?? []).map((entry) => entry.path));
  const explicitTaskIds = new Set<string>();
  if (spec.projectContext.bootstrap?.ownedFiles.length || spec.dataModel.some((item) => item.ownedFiles.length)) explicitTaskIds.add("task-scaffold");
  spec.integrations.filter((item) => item.ownedFiles.length).forEach((item) => explicitTaskIds.add(`task-integration-${slug(item.id)}`));
  spec.architecture.contracts.filter((item) => item.ownedFiles?.length).forEach((item) => explicitTaskIds.add(`task-contract-${slug(item.id)}`));
  spec.architecture.components.filter((item) => item.ownedFiles?.length).forEach((item) => explicitTaskIds.add(`task-component-${slug(item.id)}`));
  spec.apiContracts.filter((item) => item.ownedFiles.length).forEach((item) => explicitTaskIds.add(`task-api-${slug(item.id)}`));
  spec.features.filter((item) => item.ownedFiles?.length).forEach((item) => explicitTaskIds.add(`task-feature-${slug(item.id)}`));
  spec.screens.filter((item) => item.ownedFiles?.length).forEach((item) => explicitTaskIds.add(`task-screen-${slug(item.id)}`));
  spec.tests.filter((item) => item.ownedFiles.length).forEach((item) => explicitTaskIds.add(`task-test-${slug(item.id)}`));
  return tasks.map((task) => ({
    ...task,
    ownershipSource: task.ownershipSource ?? (explicitTaskIds.has(task.id) ? "explicit" : "inferred"),
    plannedNewFiles: task.ownedFiles.filter((file) => declaredNew.has(file)),
  }));
}

// ---------------------------------------------------------------------------
// Definition-of-done builders (EARS-first)
// ---------------------------------------------------------------------------

function scaffoldTitle(spec: Spec): string {
  if (spec.projectContext.startingPoint === "existing-app") {
    return "Inspect existing project and evolve the data model";
  }
  if (spec.projectContext.startingPoint === "existing-definition") {
    return "Preserve the existing definition and establish the target scaffold";
  }
  if (spec.projectContext.startingPoint === "unspecified") {
    return "Confirm the starting point and establish the project baseline";
  }
  return "Scaffold project and data model";
}

function scaffoldDoD(spec: Spec): string[] {
  const dataPoints = spec.dataPoints;
  const dod: string[] = [
    "Project scaffold builds and typechecks clean.",
  ];
  if (spec.projectContext.startingPoint === "existing-app") {
    dod.unshift("Inspected live paths, tests, and current contracts remain preserved unless the Spec declares a delta.");
  } else if (spec.projectContext.startingPoint === "unspecified") {
    dod.unshift("Starting point is verified before any scaffold or migration decision.");
  }
  if (spec.projectContext.bootstrap) {
    const { commands } = spec.projectContext.bootstrap;
    dod.push(`Install: ${commands.install}`);
    dod.push(`Typecheck: ${commands.typecheck}`);
    dod.push(`Test: ${commands.test}`);
    dod.push(`Build: ${commands.build}`);
  } else if (spec.projectContext.startingPoint === "initial-idea") {
    dod.push("TAG:UNRESOLVED — capture exact bootstrap files and install, typecheck, test, and build commands before implementation.");
  }
  if (dataPoints.length === 0) {
    dod.push("No data model captured — confirm none is required before proceeding.");
    return dod;
  }
  dod.push("Data model persists and round-trips the following data points:");
  for (const d of dataPoints) {
    if (d.pii === true) {
      const note = d.handlingNote?.trim()
        ? d.handlingNote
        : "TAG:UNRESOLVED — handlingNote required (linter blocks export).";
      dod.push(`\`${d.id}\` ${d.name} \`${d.type}\` (PII — handling note only): ${note}`);
    } else {
      const desc = d.description ? ` — ${d.description}` : "";
      dod.push(`\`${d.id}\` ${d.name} \`${d.type}\`${desc}`);
    }
  }
  return dod;
}

function integrationDoD(integration: Integration): string[] {
  const dod = [
    `Implements the ${integration.name} adapter and typed unavailable/error boundary for: ${integration.purpose}`,
  ];
  for (const item of integration.codeSetup) dod.push(`AI-owned setup: ${item}`);
  for (const item of integration.unclassifiedSetup) {
    dod.push(`TAG:UNRESOLVED — classify as AI-owned code setup or an unavoidable external action: ${item}`);
  }
  if (integration.requiredEnv.length) {
    dod.push(`Validates configuration: ${integration.requiredEnv.join(", ")}.`);
  }
  for (const check of integration.verification) dod.push(`Code-owned local/ephemeral verification: ${check}`);
  if (integration.externalManualActions.length) {
    dod.push("Tests the configured and unconfigured paths without embedding provider credentials.");
  }
  return dod;
}

function architectureContractDoD(contract: Contract): string[] {
  return [
    `Provider: ${contract.provider.specId}:${contract.provider.kind}:${contract.provider.id}.`,
    `Consumers: ${contract.consumers.map((ref) => `${ref.specId}:${ref.kind}:${ref.id}`).join(", ")}.`,
    `Transport: ${contract.transport}.`,
    ...contract.ports.map((port) => `${port.direction} port \`${port.id}\` (${port.name}) uses \`${port.type}\`${port.required ? " and is required" : " and is optional"}.`),
    ...contract.failureModes.map((mode) => `Failure behavior: ${mode}`),
    ...contract.securityNotes.map((note) => `Security: ${note}`),
    "Add repo-native contract tests for serialization, version behavior, failure retention, and access controls.",
  ];
}

function componentDoD(component: Component): string[] {
  return [
    `Implements the \`${component.kind}\` component owned by ${component.owner}.`,
    component.description || `Implements component \`${component.id}\` against its declared contracts.`,
    component.featureIds.length
      ? `Provides feature behavior: ${component.featureIds.join(", ")}.`
      : "Provides architecture-only behavior with no product feature assigned.",
    "Map this logical component to verified live repository paths during Assess; do not invent a framework-specific location.",
  ];
}

function apiDoD(
  api: APIContract,
  servedFeatures: Feature[],
  needById: Map<string, Need>,
): string[] {
  const dod: string[] = [];
  if (api.description) dod.push(api.description);
  dod.push(`Endpoint \`${api.method} ${api.path}\` returns the contracted shape.`);
  if (api.requestSchema) dod.push(`Validates request against: ${inline(api.requestSchema)}`);
  if (api.responseSchema) dod.push(`Responds with: ${inline(api.responseSchema)}`);
  // Pull EARS from the features this endpoint serves (and their needs).
  const ears = earsForFeatures(servedFeatures, needById);
  for (const e of ears) dod.push(e);
  if (dod.length === 0) dod.push(`Implements API \`${api.id}\`; verify response shape.`);
  return dod;
}

function featureDoD(feature: Feature, needById: Map<string, Need>): string[] {
  const dod: string[] = [];
  // 1. Feature-level EARS acceptance criteria (Groundwork extension).
  for (const e of feature.ears ?? []) dod.push(earsLine(e.id, e.ears));
  // 2. Free-form acceptance criteria.
  for (const c of feature.acceptanceCriteria) dod.push(c);
  // 3. EARS inherited from the needs this feature serves.
  for (const needId of feature.needIds) {
    const need = needById.get(needId);
    if (!need) continue;
    for (const e of need.ears ?? []) dod.push(earsLine(e.id, e.ears, needId));
  }
  // 4. This feature's own NFR override, if it declares one. The spec-level NFR
  // posture is NOT copied into every feature task — it would bury the
  // feature-specific criteria under six repeated blocks. It lands once, in
  // requirements.md, and again in the terminal gate.
  for (const line of featureNfrDoD(feature.nfr)) dod.push(line);
  if (dod.length === 0) {
    const base = feature.description
      ? feature.description
      : `Implements "${feature.title}".`;
    dod.push(`${base} Verify behavior against the requirement.`);
  }
  return dod;
}

function screenDoD(screen: Screen): string[] {
  const dod: string[] = [`Renders "${screen.name}" — ${screen.purpose}.`];
  if (screen.primaryAction) dod.push(`Primary action works: ${screen.primaryAction}.`);
  if (screen.states.length) {
    dod.push(`Handles all declared states: ${screen.states.join(", ")}.`);
  }
  return dod;
}

function testDoD(test: Test, platform: PlatformTarget): string[] {
  const dod: string[] = [
    `${capitalize(test.kind)} test asserts: ${test.description}`,
    test.command ? `Run \`${test.command}\`.` : (PLATFORM_TEST_RUN[platform] ?? "Run the project's test suite."),
  ];
  if (test.platformSurfaceIds.length) dod.push(`Platform surfaces: ${test.platformSurfaceIds.join(", ")}.`);
  if (platform === "claude-plugin") {
    const refs = test.validatorRefs.length
      ? test.validatorRefs.join(", ")
      : "no validatorRefs declared (linter warning)";
    dod.push(`Validators: ${refs}.`);
  }
  if (test.testFramework.trim()) dod.push(`Framework: \`${test.testFramework}\`.`);
  return dod;
}

// EARS gathered from a set of features (feature-level + their needs' EARS).
function earsForFeatures(features: Feature[], needById: Map<string, Need>): string[] {
  const out = new Set<string>();
  for (const f of features) {
    for (const e of f.ears ?? []) out.add(earsLine(e.id, e.ears, f.id));
    for (const needId of f.needIds) {
      const need = needById.get(needId);
      if (!need) continue;
      for (const e of need.ears ?? []) out.add(earsLine(e.id, e.ears, needId));
    }
  }
  return [...out];
}

function earsLine(id: string, ears: string, source?: string): string {
  const via = source ? ` (via ${source})` : "";
  return `EARS \`${id}\`${via}: ${ears}`;
}

// ---------------------------------------------------------------------------
// Owned-file inference (best-effort; placeholder when unknown)
// ---------------------------------------------------------------------------

/** Trim trailing slashes off a repoLayout directory preference. */
function trimTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

function dataOwnedFile(platform: PlatformTarget, repoLayout?: RepoLayout): string {
  // Preference check ahead of the platform switch: an observed repo fact
  // wins over the generic per-platform guess.
  if (repoLayout?.dataModel) return repoLayout.dataModel;
  switch (platform) {
    case "ios":
    case "macos":
      return "Sources/Models/ (data model)";
    case "claude-plugin":
      return "plugin.json + skills/ (scaffold)";
    case "agent-system":
      return "src/state/ (agent state model)";
    default:
      return "src/db/schema.ts";
  }
}

/**
 * Reduce an API path to the token an `apiFilePattern` template substitutes:
 * a single leading `/api` segment stripped, param-shaped segments dropped
 * (`:id`, `{id}`), leading/trailing slashes trimmed.
 */
function apiPathToken(rawPath: string, fallbackId: string): string {
  const trimmed = (rawPath ?? "").trim().replace(/^\/+|\/+$/g, "");
  let segs = trimmed.split("/").filter((s) => s.length > 0);
  if (segs.length && segs[0].toLowerCase() === "api") segs = segs.slice(1);
  segs = segs.filter((s) => !s.startsWith(":") && !s.startsWith("{"));
  const token = segs.map((s) => slug(s)).join("/");
  return token || slug(fallbackId);
}

/** Substitute the `{path}` token in an `apiFilePattern`; append the token
 * sensibly when the pattern carries no `{path}` token rather than dropping it. */
function substituteApiPattern(pattern: string, token: string): string {
  if (pattern.includes("{path}")) return pattern.split("{path}").join(token);
  const base = trimTrailingSlash(pattern);
  return token ? `${base}/${token}` : base;
}

function apiOwnedFile(api: APIContract, repoLayout?: RepoLayout): string {
  if (repoLayout?.apiFilePattern) {
    return substituteApiPattern(repoLayout.apiFilePattern, apiPathToken(api.path, api.id));
  }
  const segs = api.path
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith(":") && !s.startsWith("{") && s.toLowerCase() !== "api");
  const base = segs.length ? segs[0] : api.id;
  return `src/routes/${slug(base)}.ts`;
}

function extensionForPlatform(platform: string, ui = false): string {
  if (platform === "ios" || platform === "macos") return "swift";
  if (ui && (platform === "web" || platform === "vite-spa")) return "tsx";
  if (platform === "claude-plugin") return "json";
  return "ts";
}

function integrationOwnedFile(integration: Integration, platform: PlatformTarget, repoLayout?: RepoLayout): string {
  if (repoLayout?.integrationsDir) {
    return `${trimTrailingSlash(repoLayout.integrationsDir)}/${slug(integration.id)}.${extensionForPlatform(platform)}`;
  }
  const base = pascal(integration.name || integration.id);
  if (platform === "ios" || platform === "macos") return `Sources/Integrations/${base}.swift`;
  if (platform === "claude-plugin") return `integrations/${slug(integration.id)}/`;
  if (platform === "agent-system") return `src/tools/${slug(integration.id)}.ts`;
  return `src/integrations/${slug(integration.id)}.ts`;
}

function featureOwnedFile(feature: Feature, platform: PlatformTarget, repoLayout?: RepoLayout): string {
  const base = feature.title?.trim() ? feature.title : feature.id;
  if (repoLayout?.featuresDir) {
    return `${trimTrailingSlash(repoLayout.featuresDir)}/${slug(base)}.${extensionForPlatform(platform, feature.surface === "ui")}`;
  }
  return `src/features/${slug(base)}.ts`;
}

function screenOwnedFile(screen: Screen, platform: PlatformTarget, repoLayout?: RepoLayout): string {
  const base = screen.name?.trim() ? screen.name : screen.id;
  const ext = platform === "ios" || platform === "macos" ? "swift" : "tsx";
  const dir = repoLayout?.screensDir
    ? trimTrailingSlash(repoLayout.screensDir)
    : platform === "ios" || platform === "macos"
      ? "Sources/Views"
      : "src/screens";
  return `${dir}/${pascal(base)}.${ext}`;
}

function testOwnedFile(test: Test, platform: PlatformTarget, repoLayout?: RepoLayout): string {
  if (repoLayout?.testsDir) {
    const suffix = repoLayout.testFileSuffix || ((platform === "ios" || platform === "macos") ? "Tests.swift" : ".test.ts");
    return `${trimTrailingSlash(repoLayout.testsDir)}/${slug(test.id)}${suffix}`;
  }
  switch (platform) {
    case "ios":
    case "macos":
      return `Tests/${pascal(test.id)}.swift`;
    case "claude-plugin":
      return test.validatorRefs.length
        ? `validators: ${test.validatorRefs.join(", ")}`
        : "TODO: declare validatorRefs";
    case "agent-system":
      return `evals/${slug(test.id)}.ts`;
    default:
      return `test/${slug(test.id)}.test.ts`;
  }
}

function scaffoldOwnedFiles(spec: Spec): string[] {
  const explicit = [
    ...(spec.projectContext.bootstrap?.ownedFiles ?? []),
    ...spec.dataModel.flatMap((entity) => entity.ownedFiles),
  ];
  if (explicit.length) return [...new Set(explicit)];
  if (spec.projectContext.repoLayout?.dataModel) {
    return [dataOwnedFile(spec.platformTarget, spec.projectContext.repoLayout)];
  }
  const hasBuildableScope = Boolean(
    spec.dataPoints.length ||
      spec.features.length ||
      spec.screens.length ||
      spec.integrations.length ||
      spec.apiContracts.length ||
      spec.tests.length ||
      spec.architecture.components.length ||
      spec.architecture.contracts.length,
  );
  return hasBuildableScope ? [dataOwnedFile(spec.platformTarget)] : ["README.md"];
}

function platformsForFeatures(spec: Spec, featureIds: readonly string[]): string[] {
  const wanted = new Set(featureIds);
  return [...new Set(spec.platformSurfaces
    .filter((surface) => surface.featureIds.some((id) => wanted.has(id)))
    .map((surface) => surface.platform))].sort();
}

function ownedFilesForPlatforms(platforms: readonly string[], dir: string, base: string, webTsx = false): string[] {
  const safeBase = slug(base);
  const nativeBase = pascal(base);
  const values = platforms.flatMap((platform) => {
    if (platform === "ios" || platform === "macos") return [`Sources/${pascal(dir)}/${nativeBase}.swift`];
    if (platform === "web" || platform === "vite-spa") return [`apps/web/src/${dir}/${safeBase}.${webTsx ? "tsx" : "ts"}`];
    if (platform === "service" || platform === "api") return [`services/review/src/${dir}/${safeBase}.ts`];
    if (platform === "claude-plugin") return [`${dir}/${safeBase}.json`];
    if (platform === "agent-system") return [`src/${dir}/${safeBase}.ts`];
    return [`src/${dir}/${safeBase}.ts`];
  });
  return [...new Set(values.length ? values : [`src/${dir}/${safeBase}.ts`])];
}

function ownedFilesForFeatures(spec: Spec, featureIds: readonly string[], dir: string, base: string, webTsx = false): string[] {
  return ownedFilesForPlatforms(platformsForFeatures(spec, featureIds), dir, base, webTsx);
}

function contractOwnedFiles(contract: Contract, spec: Spec): string[] {
  if (contract.ownedFiles?.length) return contract.ownedFiles;
  const componentIds = new Set([contract.provider, ...contract.consumers]
    .filter((ref) => ref.specId === spec.id && ref.kind === "component")
    .map((ref) => ref.id));
  const featureIds = spec.architecture.components
    .filter((component) => componentIds.has(component.id))
    .flatMap((component) => component.featureIds);
  return ownedFilesForFeatures(spec, featureIds, "contracts", contract.name);
}

function apiOwnedFiles(api: APIContract, spec: Spec): string[] {
  const featurePlatforms = platformsForFeatures(spec, api.featureIds);
  const serverPlatforms = featurePlatforms.filter((platform) => platform === "service" || platform === "api");
  return ownedFilesForPlatforms(serverPlatforms.length ? serverPlatforms : featurePlatforms, "routes", api.id);
}

function componentOwnedFiles(component: Component, spec: Spec): string[] {
  if (component.ownedFiles?.length) return component.ownedFiles;
  const dir = component.kind === "ui" ? "components" : component.kind === "data" ? "data" : "components";
  return ownedFilesForFeatures(spec, component.featureIds, dir, component.name, component.kind === "ui");
}

function testOwnedFiles(test: Test, spec: Spec): string[] {
  const surfacePlatforms = spec.platformSurfaces
    .filter((surface) => test.platformSurfaceIds.includes(surface.id))
    .map((surface) => surface.platform);
  const files = surfacePlatforms.flatMap((platform) => {
    if (platform === "ios" || platform === "macos") return [`Tests/${pascal(test.id)}.swift`];
    if (platform === "web" || platform === "vite-spa") return [`apps/web/tests/${slug(test.id)}.${/playwright/i.test(test.testFramework) ? "spec.ts" : "test.ts"}`];
    if (platform === "service" || platform === "api") return [`services/review/test/${slug(test.id)}.test.ts`];
    if (platform === "claude-plugin") return test.validatorRefs.length ? [`validators: ${test.validatorRefs.join(", ")}`] : ["TODO: declare validatorRefs"];
    if (platform === "agent-system") return [`evals/${slug(test.id)}.ts`];
    return [`test/${slug(test.id)}.test.ts`];
  });
  return files.length ? [...new Set(files)] : ownedFilesForPlatforms([spec.platformTarget], "test", test.id);
}

const PLATFORM_TEST_RUN: Record<PlatformTarget, string> = {
  web: "Run `npm run test` (Vitest).",
  "vite-spa": "Run `npm run test` (Vitest).",
  ios: "Run the explicit XCTest command captured for this test; if none is captured, return to Groundwork instead of guessing a scheme or destination.",
  macos: "Run the explicit XCTest command captured for this test; if none is captured, return to Groundwork instead of guessing a scheme or destination.",
  "claude-plugin":
    "Run plugin-builder validators (manifest / skill / hook / command) + `claude plugins lint`.",
  "agent-system": "Run the golden-task suite + safety / permission evals.",
};

const PLATFORM_DISPLAY: Record<PlatformTarget, string> = {
  web: "web",
  "vite-spa": "Vite SPA",
  ios: "iOS",
  macos: "macOS",
  "claude-plugin": "Claude Code/Codex plugin",
  "agent-system": "agent system",
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderHeader(spec: Spec, taskCount: number): string {
  return `# Build plan — ${spec.productName}

> ${spec.productDescription?.trim() || "_No product description captured._"}
>
> Generated by Groundwork in build-loop native plan format. The build-loop
> orchestrator consumes this as its Phase 2 plan. Tasks are ordered by
> dependency: scaffold / data layer → integrations + contracts + components + API → features → UI screens → tests.
> Each task lists its owned files, definition-of-done, dependencies, and the
> requirement IDs it satisfies (traceability).

**Platform target:** \`${spec.platformTarget}\`  ·  **Tasks:** ${taskCount}`;
}

function renderApproachLenses(spec: Spec): string {
  const context = spec.projectContext;
  if (context.startingPoint === "unspecified") {
    return `## Approach Lenses

**Starting point unresolved:** Determine whether the target is a clean-sheet
build, an existing definition, or an existing implementation before editing.

**Preserve:** Treat supplied artifacts and user-confirmed preferences as
constraints until their current status is verified.

**Recommendation:** Build Loop Assess must classify the starting point, inspect
the relevant live surface, and then map this task graph without assuming a
greenfield repository.`;
  }
  if (context.startingPoint === "existing-app" || context.startingPoint === "existing-definition") {
    const inspected = context.sourceArtifacts.length
      ? context.sourceArtifacts.map((item) => machineLocalPath(item) ? "a recorded current-state artifact (local path redacted)" : `\`${item}\``).join(", ")
      : "the recorded source artifacts";
    return `## Approach Lenses

**Current system:** Groundwork started from the existing product in the repository where this handoff is executed and
captured current-state evidence from ${inspected}.

**Preserve:** Keep verified contracts and the user-confirmed must-keep
preferences in the embedded Canonical Spec; do not replace working architecture by default.

**Delta:** Implement the declared requirements, may-evolve preferences, and
unresolved assumptions as changes to the inspected system.

**Recommendation:** During Build Loop Assess, verify each proposed owned file
against the live repository and map this task graph onto the existing paths.`;
  }
  return `## Approach Lenses

**Clean-sheet:** Implement against the validated requirements, contracts, and
ADRs in the embedded Canonical Spec without assuming a target repository structure.

**Current constraints:** Groundwork has not inspected the future target
repository, so concrete paths, existing contracts, and framework conventions
remain repo-specific.

**Bridge:** During Build Loop Assess, map each owned-file suggestion and
contract below to the live repository before implementation.

**Recommendation:** Preserve this dependency and traceability graph; refine only
the repo-specific implementation choices against live code.`;
}

function renderReadsFromBoundary(spec: Spec): string {
  const context = spec.projectContext;
  if (context.startingPoint === "unspecified") {
    return `## Depends-on (reads-from)

- Embedded Canonical Spec section — validated desired state; starting-point classification unresolved
- Embedded Traceability section — generated cross-reference graph — verified

override: reads-from-dependency — Resolve and inspect the target repository or
artifact set before accepting any proposed owned file.`;
  }
  if (context.startingPoint === "existing-app" || context.startingPoint === "existing-definition") {
    return `## Depends-on (reads-from)

- Embedded Canonical Spec section — validated desired state and provenance — verified
- Embedded Traceability section — generated cross-reference graph — verified
- Live current repository state — verify its paths, contracts, and tests; no source artifact or redacted local path is required

override: reads-from-dependency — Existing-product evidence can become stale;
Build Loop must re-verify the named live dependencies before implementation.`;
  }
  return `## Depends-on (reads-from)

- Embedded Canonical Spec section — validated product requirements and contracts — verified
- Embedded Traceability section — generated cross-reference graph — verified

override: reads-from-dependency — Groundwork cannot verify contracts in a
future target repository; Build Loop must resolve those live dependencies
during Assess before implementation.`;
}

function machineLocalPath(value: string): boolean {
  return /^(?:\/(?:Users|home|tmp|private|Volumes|var\/folders)(?:\/|$)|[A-Za-z]:[\\/](?:Users|Temp)(?:[\\/]|$)|\\\\[^\\]+\\[^\\]+)/.test(value);
}

function renderThreatModel(spec: Spec): string {
  const pii = spec.dataPoints.filter((d) => d.pii);
  const authIntegrations = spec.integrations.filter((i) => i.authMode?.trim());
  const hasRiskSurface =
    pii.length > 0 || spec.apiContracts.length > 0 || authIntegrations.length > 0
    || spec.architecture.contracts.length > 0;

  if (!hasRiskSurface) {
    return `## Threat Model

threat-model: not-applicable: the accepted Spec contains no PII, authenticated
integration, or API contract. Reassess if Build Loop adds one.`;
  }

  const lines: string[] = ["## Threat Model", "", "**Protected assets:**"];
  if (pii.length) {
    for (const point of pii) lines.push(`- \`${point.id}\` ${point.name}`);
  } else {
    lines.push("- API and architecture-contract data declared in the Spec.");
  }

  lines.push("", "**Trust boundaries:**");
  for (const api of spec.apiContracts) {
    lines.push(`- \`${api.method} ${api.path}\` request/response boundary.`);
  }
  for (const integration of authIntegrations) {
    lines.push(`- ${integration.name} authentication boundary (${integration.authMode}).`);
  }
  for (const contract of spec.architecture.contracts) {
    lines.push(`- Architecture contract \`${contract.id}\` over ${contract.transport}.`);
    for (const note of contract.securityNotes) lines.push(`  - Required security behavior: ${note}`);
  }

  lines.push("", "**Required controls:**");
  for (const point of pii) {
    lines.push(
      `- \`${point.id}\`: ${
        point.handlingNote?.trim() ||
        "TAG:UNRESOLVED — define storage, access, retention, and deletion controls."
      }`,
    );
  }
  for (const rule of spec.boundaries?.askFirst ?? []) lines.push(`- Ask first: ${rule}`);
  for (const rule of spec.boundaries?.never ?? []) lines.push(`- Never: ${rule}`);
  if (!pii.length && !(spec.boundaries?.askFirst.length || spec.boundaries?.never.length)) {
    lines.push("- Validate access, input handling, failure behavior, and data exposure.");
  }

  lines.push(
    "",
    "**Verification:** Build Loop must convert these controls into repo-native tests and a security review before implementation closes.",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Activation Map — dormant-risk component surfacing (build-loop
// plan_verify.py rule `activation-map-required`, ~scripts/plan_verify.py:1385)
//
// build-loop rejects a plan that proposes new event-driven / call-site-
// dependent machinery (a cron entry, a hook, a webhook, a watcher, …) without
// an `## Activation Map` section naming the trigger and whether it has been
// verified live. Groundwork can't verify anything at emit time — it emits
// the section with `verified-live: pending` so the plan is well-formed on
// arrival; build-loop's own Phase 5 iterate loop closes each entry to `yes`.
//
// Detection mirrors plan_verify.py's STRONG token set only (deliberately —
// the SOFT token set there requires proximity heuristics against arbitrary
// plan prose that this emitter's structured Spec input doesn't need). Bare
// "hook"/"hooks" is excluded on purpose: it is the single highest-volume
// false-positive source (React hooks) per plan_verify.py's own rule comment.
// ---------------------------------------------------------------------------

interface ActivationTokenRule {
  re: RegExp;
  label: (matchedText: string) => string;
}

const ACTIVATION_TOKEN_RULES: ActivationTokenRule[] = [
  { re: /\bstop\s+hook\b/i, label: () => "Stop hook" },
  { re: /\bsessionstart\b/i, label: () => "SessionStart hook" },
  { re: /\bpretooluse\b/i, label: () => "PreToolUse hook" },
  { re: /\bposttooluse\b/i, label: () => "PostToolUse hook" },
  { re: /\bcron\b/i, label: () => "cron schedule" },
  { re: /\blaunchd\b/i, label: () => "launchd job" },
  { re: /\bwatcher\b/i, label: () => "watcher" },
  { re: /\bgit\s+hook\b/i, label: () => "git hook" },
  { re: /\bpre-commit\b/i, label: () => "pre-commit hook" },
  { re: /\bpost-commit\b/i, label: () => "post-commit hook" },
  { re: /\bwebhook\b/i, label: () => "webhook" },
  {
    re: /\b(?:repo-level|lifecycle|codex|claude(?:\s+code)?|session|host)\s+hooks?\b/i,
    label: (m) => capitalize(m.trim().replace(/\s+/g, " ")),
  },
  { re: /\bhooks?\.json\b/i, label: () => "hooks.json registration" },
];

/** The capitalized word immediately preceding `index` in `text`, if any
 * (e.g. "Vercel" before "cron") — used to enrich the generic trigger label
 * with the provider/host name the Spec author already wrote down. */
function capitalizedWordBefore(text: string, index: number): string | null {
  const before = text.slice(0, index);
  const m = /([A-Z][a-z]+)\s*$/.exec(before);
  return m ? m[1] : null;
}

/** First matching activation-token trigger label in `text`, or null when
 * none of the STRONG tokens (and only those) are present. */
function detectActivationTrigger(text: string): string | null {
  if (!text) return null;
  for (const rule of ACTIVATION_TOKEN_RULES) {
    const m = rule.re.exec(text);
    if (!m) continue;
    const base = rule.label(m[0]);
    const prefix = capitalizedWordBefore(text, m.index);
    return prefix ? `${prefix} ${base}` : base;
  }
  return null;
}

interface ActivationMapEntry {
  component: string;
  trigger: string;
}

function scanActivationMapEntries(spec: Spec): ActivationMapEntry[] {
  const entries: ActivationMapEntry[] = [];
  const seen = new Set<string>();
  const add = (component: string, trigger: string) => {
    const key = `${component}::${trigger}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ component, trigger });
  };

  for (const integration of spec.integrations) {
    const component = integration.name?.trim() || integration.id;
    for (const line of integration.codeSetup ?? []) {
      const trigger = detectActivationTrigger(line);
      if (trigger) add(component, trigger);
    }
  }

  for (const feature of spec.features) {
    const component = feature.title?.trim() || feature.id;
    const text = [feature.title, feature.description].filter(Boolean).join(" — ");
    const trigger = detectActivationTrigger(text);
    if (trigger) add(component, trigger);
  }

  return entries;
}

/** `## Activation Map` section, or "" when the Spec proposes no dormant-risk
 * machinery — an empty heading would look like a defect, so it's omitted
 * entirely rather than emitted with zero entries. */
function renderActivationMap(spec: Spec): string {
  const entries = scanActivationMapEntries(spec);
  if (!entries.length) return "";
  const lines = ["## Activation Map"];
  for (const e of entries) {
    lines.push(`- ${e.component} — trigger: ${e.trigger} — verified-live: pending`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Self-resolving plan sections
//
// A plan that only ENUMERATES work leaves the reader to invent the definition
// of "done". These five sections close that gap deterministically:
//
//   Prime directive     — the one outcome that decides success, up top.
//   Phase acceptance    — a runnable command per delivery phase, derived from
//                         the task layers when the Spec doesn't declare them.
//   Invariant checks    — structural rules as commands, not prose.
//   Terminal gate       — the checklist that must pass before "done" is claimed.
//   Spec ↔ code sync    — which artifact wins when they disagree.
//
// Each degrades to a TAG:UNRESOLVED prompt naming exactly what to supply, so an
// under-specified Spec produces a plan that asks for what it is missing rather
// than one that looks complete.
// ---------------------------------------------------------------------------

/** Escape a value for a Markdown table cell: pipes break the column split. */
function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
}

/**
 * The prime-directive acceptance test, restated at the top of the plan (it also
 * heads requirements.md). Repetition is intentional: an implementer reading
 * only tasks.md must still know the one outcome that decides success.
 */
function renderPrimeDirective(spec: Spec): string {
  const test = spec.acceptanceTest;
  const lines = ["## Prime directive"];
  if (!test) {
    lines.push(
      "",
      unresolved(
        "no prime-directive acceptance test declared in the Spec. Define one observable, " +
          "time-boxed outcome before implementation closes — otherwise \"done\" is whatever " +
          "the implementer decides it is.",
      ),
    );
    return lines.join("\n");
  }
  lines.push(
    "",
    `**${test.id}:** ${test.statement}`,
    "",
    `- **Observable:** ${test.observable}`,
    `- **Time box:** ${test.timeBox}`,
  );
  if (test.pillarIds.length) lines.push(`- **Serves pillars:** ${test.pillarIds.join(", ")}`);
  if (test.steps.length) {
    lines.push("", "**Run it:**");
    test.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  }
  lines.push(
    "",
    "This is the terminal gate at the bottom of this plan. Every task below exists to make it pass.",
  );
  return lines.join("\n");
}

/**
 * Per-platform bare commands. `PLATFORM_TEST_RUN` above carries prose for a
 * definition-of-done bullet; a phase gate needs the command alone so it can be
 * pasted and run. `<Scheme>` stays a visible placeholder rather than a guess —
 * Groundwork has not inspected the Xcode project.
 */
interface PlatformCommands {
  typecheck: string;
  build: string;
  test: string;
}

const PLATFORM_COMMANDS: Record<PlatformTarget, PlatformCommands> = {
  web: { typecheck: "npm run typecheck", build: "npm run build", test: "npm run test" },
  "vite-spa": { typecheck: "npm run typecheck", build: "npm run build", test: "npm run test" },
  ios: {
    typecheck: "xcodebuild -scheme <Scheme> build",
    build: "xcodebuild -scheme <Scheme> build",
    test: "xcodebuild test -scheme <Scheme>",
  },
  macos: {
    typecheck: "xcodebuild -scheme <Scheme> build",
    build: "xcodebuild -scheme <Scheme> build",
    test: "xcodebuild test -scheme <Scheme>",
  },
  "claude-plugin": {
    typecheck: "claude plugins lint",
    build: "claude plugins lint",
    test: "run the plugin-builder validators (manifest / skill / hook / command)",
  },
  "agent-system": {
    typecheck: "npm run typecheck",
    build: "npm run build",
    test: "run the golden-task suite + safety / permission evals",
  },
};

const LAYER_PHASE_LABEL: Record<TaskLayer, string> = {
  scaffold: "Scaffold & data layer",
  dependency: "Pinned dependencies",
  integration: "External integrations",
  contract: "Architecture contracts",
  component: "Architecture components",
  api: "API contracts",
  feature: "Features",
  screen: "UI screens",
  test: "Test suite",
};

/** How each layer proves it closed, given the platform's native commands. */
function layerAcceptance(layer: TaskLayer, cmd: PlatformCommands): string {
  switch (layer) {
    case "scaffold":
      return `\`${cmd.typecheck}\` exits 0 and the data model round-trips every declared data point`;
    case "dependency":
      return `\`${cmd.typecheck}\` exits 0 and every pinned Spec dependency matches its declared schema, revision, and digest`;
    case "integration":
      return `\`${cmd.test}\` passes with provider credentials ABSENT — the adapter's unavailable path is covered, not skipped`;
    case "contract":
      return `\`${cmd.test}\` passes and every declared provider/consumer contract validates its typed inputs, outputs, and failure modes`;
    case "component":
      return `\`${cmd.test}\` passes and every architecture component satisfies its linked features and contracts`;
    case "api":
      return `\`${cmd.test}\` passes and every declared endpoint returns its contracted response shape`;
    case "feature":
      return `\`${cmd.test}\` passes and each feature's acceptance criteria are asserted, not assumed`;
    case "screen":
      return `\`${cmd.build}\` exits 0 and every declared screen state (loading, empty, error, success) renders`;
    case "test":
      return `\`${cmd.test}\` passes with no skipped, pending, or \`.only\` tests`;
  }
}

/**
 * `Phase | Scope | Acceptance` — one row per delivery phase, every acceptance
 * cell runnable. Uses the Spec's authored `phaseAcceptance` when present;
 * otherwise DERIVES the table from the task layers so a Spec written before
 * this field existed still gets runnable phase gates.
 *
 * The derived table always opens with a walking-skeleton row: the thinnest
 * end-to-end path proven first, before breadth. A phase list that starts with
 * "build all the data models" defers integration risk to the end, which is
 * where it is most expensive to discover.
 */
function renderPhaseAcceptance(spec: Spec, tasks: Task[]): string {
  const lines = [
    "## Phase acceptance",
    "",
    "> Each phase closes when its acceptance command passes — not when its tasks look finished.",
    "",
    "| Phase | Scope | Acceptance (runnable) |",
    "|---|---|---|",
  ];

  if (spec.phaseAcceptance?.length) {
    for (const p of spec.phaseAcceptance) {
      lines.push(`| ${cell(p.phase)} | ${cell(p.scope)} | ${cell(p.acceptance)} |`);
    }
    return lines.join("\n");
  }

  if (!tasks.length) {
    lines.push(
      `| _(none)_ | _no tasks derived_ | ${cell(
        unresolved("capture at least one feature, screen, API contract, or test in the Spec."),
      )} |`,
    );
    return lines.join("\n");
  }

  const cmd = spec.projectContext.bootstrap?.commands ?? PLATFORM_COMMANDS[spec.platformTarget];
  const byLayer = new Map<TaskLayer, Task[]>();
  for (const t of tasks) {
    const arr = byLayer.get(t.layer) ?? [];
    arr.push(t);
    byLayer.set(t.layer, arr);
  }

  // Phase 0 — walking skeleton: the thinnest path that touches every layer the
  // Spec actually declares, proven end to end before breadth is built.
  const skeletonLayers = Array.from(byLayer.keys()).filter((l) => l !== "test");
  const skeletonScope = skeletonLayers.length
    ? `One thin slice through ${skeletonLayers.map((l) => LAYER_PHASE_LABEL[l].toLowerCase()).join(" → ")}`
    : "One thin end-to-end slice";
  lines.push(
    `| 0 — Walking skeleton | ${cell(skeletonScope)} | ${cell(
      `\`${cmd.build}\` exits 0 and the slice runs end to end against real data — no mocks in the path`,
    )} |`,
  );

  const order: TaskLayer[] = ["scaffold", "integration", "api", "feature", "screen", "test"];
  let phaseNumber = 0;
  for (const layer of order) {
    const layerTasks = byLayer.get(layer);
    if (!layerTasks?.length) continue;
    phaseNumber++;
    const numbers = layerTasks.map((t) => t.n);
    const scope =
      numbers.length === 1
        ? `Task ${numbers[0]}`
        : `Tasks ${numbers[0]}–${numbers[numbers.length - 1]}`;
    lines.push(
      `| ${phaseNumber} — ${LAYER_PHASE_LABEL[layer]} | ${cell(scope)} | ${cell(
        layerAcceptance(layer, cmd),
      )} |`,
    );
  }
  return lines.join("\n");
}

/**
 * Architectural invariants as a runnable block. Omitted entirely when the Spec
 * declares none — an empty checks section reads like a defect, and "no
 * structural rule asserted" is already stated in design.md.
 */
function renderInvariantChecks(spec: Spec): string {
  const invariants = spec.architecturalInvariants ?? [];
  if (!invariants.length) return "";
  const lines = [
    "## Architectural invariants (executable checks)",
    "",
    "> Each check must exit 0 after every task below. A non-zero exit is a violated invariant — fix the code, do not relax the check.",
    "",
  ];
  for (const i of invariants) {
    const pillars = i.pillarIds.length ? ` _(serves ${i.pillarIds.join(", ")})_` : "";
    lines.push(`- **${i.id}** ${i.rule}${pillars}`);
    lines.push(`  - \`${i.check}\``);
  }
  lines.push("", "```bash", ...invariants.map((i) => i.check), "```");
  return lines.join("\n");
}

/** Non-empty NFR lines for a feature's own override, as DoD bullets. */
function featureNfrDoD(nfr: Nfr | undefined): string[] {
  if (!nfr) return [];
  const out: string[] = [];
  if (nfr.testStrategy?.trim()) out.push(`Test strategy: ${nfr.testStrategy.trim()}`);
  for (const item of nfr.edgeCases) out.push(`Edge case handled: ${item}`);
  for (const item of nfr.errorHandling) out.push(`Error handling: ${item}`);
  for (const item of nfr.validation) out.push(`Validation: ${item}`);
  for (const item of nfr.security) out.push(`Security: ${item}`);
  for (const item of nfr.accessibility) out.push(`Accessibility: ${item}`);
  return out;
}

/**
 * The checklist that stands between the last task and a "done" claim. Every
 * line is either checkable by running something or explicitly unresolved —
 * there is no line here that can be satisfied by an opinion.
 */
function renderTerminalGate(spec: Spec): string {
  const cmd = spec.projectContext.bootstrap?.commands ?? PLATFORM_COMMANDS[spec.platformTarget];
  const lines = [
    "## Terminal gate — do not report done until every line passes",
    "",
  ];

  const test = spec.acceptanceTest;
  lines.push(
    test
      ? `- [ ] **Prime directive passes.** ${test.statement} — observed as: ${test.observable}; inside: ${test.timeBox}.`
      : `- [ ] ${unresolved(
          "no prime-directive acceptance test to run. Define one in the Spec, regenerate, then close this gate.",
        )}`,
  );

  const invariants = spec.architecturalInvariants ?? [];
  lines.push(
    invariants.length
      ? `- [ ] **Every architectural invariant check exits 0** (${invariants.length} check(s); see "Architectural invariants" above).`
      : "- [ ] **No architectural invariants declared** — confirm none is needed rather than assuming it.",
  );

  const budget = spec.performanceBudget ?? [];
  lines.push(
    budget.length
      ? `- [ ] **Performance budget met:** ${budget.map((b) => `${b.metric} ${b.budget}`).join("; ")}.`
      : `- [ ] ${unresolved(
          "no performance budget declared. Measure the user-visible operations and record the numbers, or state that no budget applies.",
        )}`,
  );

  const nfr = spec.nfr;
  const nfrGaps: string[] = [];
  if (!nfr?.testStrategy?.trim()) nfrGaps.push("test strategy");
  if (!nfr?.edgeCases.length) nfrGaps.push("edge cases");
  if (!nfr?.errorHandling.length) nfrGaps.push("error handling");
  if (!nfr?.validation.length) nfrGaps.push("validation");
  if (!nfr?.security.length) nfrGaps.push("security");
  if (!nfr?.accessibility.length) nfrGaps.push("accessibility");
  lines.push(
    nfrGaps.length
      ? `- [ ] ${unresolved(
          `non-functional requirements are unanswered for: ${nfrGaps.join(", ")}. ` +
            "Answer each in the Spec's `nfr` block (see requirements.md) or record why it does not apply.",
        )}`
      : "- [ ] **Every non-functional requirement is satisfied** (test strategy, edge cases, error handling, validation, security, accessibility).",
  );

  // Deduped: on platforms where typecheck and build are the same invocation
  // (Xcode), listing it twice reads like a copy-paste defect.
  const verification = Array.from(new Set([cmd.typecheck, cmd.build, cmd.test]));
  lines.push(
    `- [ ] **Repo-native verification passes:** ${verification.map((c) => `\`${c}\``).join(", ")}.`,
    "- [ ] **No `TAG:UNRESOLVED` or `TAG:ASSUMED` marker remains** in this artifact set unresolved or unacknowledged.",
    "- [ ] **No mock data, dead control, placeholder copy, or fake integration** survives in a user-facing path.",
    "- [ ] **The Spec reflects what was built** (see \"Spec ↔ code sync\" below).",
  );
  return lines.join("\n");
}

function renderSpecCodeSyncSection(spec: Spec): string {
  return `## Spec ↔ code sync\n\n${renderSpecCodeSync(spec)}`;
}

/**
 * The reading contract, restated on the two build-facing docs. An implementer
 * who opens only `tasks.md` or only `builder-handoff.md` is exactly the reader
 * the no-compression rule is written for, so stating it once in `steering.md`
 * would state it where they are least likely to be.
 */
function renderReadingContractSection(spec: Spec): string {
  return `## How to read this\n\n${renderReadingContract(spec)}`;
}

function renderTask(t: Task, _platform: PlatformTarget): string {
  const lines: string[] = [`## Task ${t.n} — ${t.title}`];
  lines.push("", `**Task ID:** \`${t.id}\``, `**Layer:** ${t.layer}`);

  lines.push("", "**Owned files:**");
  if (t.ownershipSource === "explicit" || t.plannedNewFiles.length) lines.push(`- Ownership source: **${t.ownershipSource}**`);
  for (const f of t.ownedFiles) lines.push(`- \`${f}\`${t.plannedNewFiles.includes(f) ? " — planned new" : t.ownershipSource === "explicit" ? " — expected existing" : ""}`);

  lines.push("", "**Definition of done:**");
  if (t.dod.length === 0) {
    lines.push("- _No acceptance criteria captured — confirm with the user._");
  } else {
    for (const d of t.dod) lines.push(`- ${d}`);
  }

  lines.push(
    "",
    `**Dependencies:** ${
      t.deps.length ? t.deps.map((d) => `Task ${d}`).join(", ") : "none"
    }`,
  );

  lines.push(
    `**Satisfies:** ${
      t.satisfies.length ? t.satisfies.map((s) => `\`${s}\``).join(", ") : "_(no linked IDs)_"
    }`,
  );

  return lines.join("\n");
}

function renderTraceabilityNote(tasks: Task[]): string {
  if (tasks.length === 0) return "";
  const covered = new Set<string>();
  for (const t of tasks) for (const s of t.satisfies) covered.add(s);
  return `---

_Traceability: ${tasks.length} task(s) covering ${covered.size} requirement/feature/API/screen/test ID(s). Every dependency reference points at an earlier task number._`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slug(s: string): string {
  const out = (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return out || "item";
}

function pascal(s: string): string {
  const parts = (s ?? "")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  return parts.join("") || "Item";
}

function truncate(s: string, n: number): string {
  if (typeof s !== "string") return "";
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function inline(s: string): string {
  // Collapse a (possibly multi-line) schema string into a single inline code span.
  const one = s.replace(/\s+/g, " ").trim();
  return "`" + truncate(one, 200) + "`";
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function uniqueSorted(nums: number[]): number[] {
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

/**
 * Defense-in-depth: scrub anything that looks like a secret. Ported verbatim
 * from ProductPilot's agent-handoff — a stray match here means an upstream
 * scrubber missed something; better to redact than leak.
 */
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bghp_[A-Za-z0-9]{24,}\b/g,
  /\bgho_[A-Za-z0-9]{24,}\b/g,
  /\bAKIA[0-9A-Z]{12,20}\b/g,
  /\baws_secret_access_key\s*[=:]\s*[A-Za-z0-9/+]{30,}\b/gi,
  /\b[A-Za-z0-9_-]{40,}\b\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, // jwt-shaped
];

function scrubSecretShapedStrings(s: string): string {
  let out = s;
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[REDACTED]");
  return out;
}
