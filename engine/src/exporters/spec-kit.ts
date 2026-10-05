import type { Spec } from "../spec.js";
import { compileTaskGraph } from "../graph.js";
import { deriveTasks } from "../handoff.js";
import { calculateSpecDigest } from "../build-exchange.js";
import {
  exportSlug,
  requireExportPrerequisites,
  sortedExportFiles,
  type DerivedExport,
  type DerivedExportSource,
} from "./types.js";

export const SPEC_KIT_SOURCE: DerivedExportSource = {
  repository: "https://github.com/github/spec-kit",
  retrievedDate: "2026-08-07",
  stableVersion: "v0.16.1",
  stableCommit: "ad4104b56c219b0a27bac06547d1a3c7d6a0dbd6",
  mainCommit: "684b3d8e05263a7c1948d3d0699ab1cb4f77c3d5",
  supportedPaths: [
    "specs/<NNN-slug>/spec.md",
    "specs/<NNN-slug>/plan.md",
    "specs/<NNN-slug>/tasks.md",
  ],
};

export interface SpecKitExportOptions {
  featureNumber?: number;
}

function list(values: readonly string[], empty: string): string {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : `- ${empty}`;
}

function qualifiedRef(value: { specId: string; kind: string; id: string }): string {
  return `${value.specId}:${value.kind}:${value.id}`;
}

function renderSpec(spec: Spec, branch: string): string {
  const scenarios = spec.scenarios.length
    ? spec.scenarios.map((scenario, index) => [
        `### User Story ${index + 1} - ${scenario.goal} (Priority: P${Math.min(index + 1, 3)})`,
        "",
        scenario.context,
        "",
        `**Independent Test**: ${scenario.successSignal || `Verify ${scenario.goal.toLowerCase()} end to end.`}`,
        "",
        "**Acceptance Scenarios**:",
        "",
        `1. **Given** ${scenario.context}, **When** the user completes the flow, **Then** ${scenario.successSignal || scenario.goal}.`,
      ].join("\n")).join("\n\n---\n\n")
    : "_No user scenario was captured; resolve this Groundwork gap before treating the projection as build-ready._";
  const requirements = spec.needs.flatMap((need) => {
    const statements = need.ears?.map((criterion) => criterion.ears) ?? [];
    return statements.length ? statements.map((statement) => `${need.id}: ${statement}`) : [`${need.id}: ${need.title}${need.description ? ` — ${need.description}` : ""}`];
  });
  const criteria = (spec.successMetrics ?? []).map((metric) => `${metric.metric}: ${metric.target}`);
  const assumptions = spec.assumptions.map((item) => `${item.text} (confidence: ${item.confidence})`);
  return [
    `# Feature Specification: ${spec.productName}`,
    "",
    `**Feature Branch**: \`${branch}\``,
    "",
    `**Created**: ${SPEC_KIT_SOURCE.retrievedDate}`,
    "",
    "**Status**: Draft — derived from Groundwork Spec v3",
    "",
    `**Input**: ${spec.productDescription}`,
    "",
    "## User Scenarios & Testing",
    "",
    scenarios,
    "",
    "## Requirements",
    "",
    "### Functional Requirements",
    "",
    list(requirements, "No requirement was captured."),
    "",
    "### Key Entities",
    "",
    list(spec.dataModel.map((entity) => `**${entity.name}** (\`${entity.id}\`): ${entity.description || "Groundwork entity"}`), "No persistent entity is declared."),
    "",
    "## Success Criteria",
    "",
    "### Measurable Outcomes",
    "",
    list(criteria, "Use Groundwork acceptance tests as the measurable completion evidence."),
    "",
    "## Assumptions",
    "",
    list(assumptions, "No unresolved assumption is declared."),
    "",
  ].join("\n");
}

function renderPlan(spec: Spec, branch: string): string {
  const topology = spec.platformSurfaces.map((surface) => `${surface.platform} ${surface.role}`).join(" · ");
  const components = spec.architecture.components.map((item) => `- \`${item.id}\` ${item.name} (${item.kind}); owner ${item.owner}; features ${item.featureIds.join(", ") || "none"}${item.description ? `; ${item.description}` : ""}.`);
  const contracts = spec.architecture.contracts.map((item) => `- \`${item.id}\` ${item.name}; provider ${qualifiedRef(item.provider)}; consumers ${item.consumers.map(qualifiedRef).join(", ") || "none"}; transport ${item.transport}; ports ${item.ports.map((port) => `${port.id} ${port.direction} ${port.name}:${port.type}${port.required ? " required" : " optional"}`).join(", ")}; failures ${item.failureModes.join("; ")}; security ${item.securityNotes.join("; ")}.`);
  const relationships = spec.architecture.relationships.map((item) => `- \`${item.id}\` ${qualifiedRef(item.from)} -> ${qualifiedRef(item.to)}; ${item.direction}; ${item.criticality}; ${item.optional ? "optional" : "required"}${item.contractRef ? `; contract ${qualifiedRef(item.contractRef)}` : ""}; rationale: ${item.rationale}`);
  const flows = spec.architecture.flows.flatMap((flow) => [
    `- Flow \`${flow.id}\` ${flow.name}; trigger: ${flow.trigger}.`,
    ...flow.exchanges.map((exchange) => `  - ${exchange.order}. ${qualifiedRef(exchange.from)} -> ${qualifiedRef(exchange.to)}; contract ${qualifiedRef(exchange.contractRef)}; inputs ${exchange.inputRefs.map(qualifiedRef).join(", ") || "none"}; outputs ${exchange.outputRefs.map(qualifiedRef).join(", ") || "none"}; failures ${exchange.failurePaths.join("; ")}.`),
  ]);
  const dependencies = spec.architecture.specDependencies.map((item) => `- \`${item.id}\` ${item.relationship} ${item.specId} at ${item.location.kind === "local" ? item.location.path : item.location.uri}; revision ${item.revision}; digest ${item.digest}`);
  return [
    `# Implementation Plan: ${spec.productName}`,
    "",
    `**Branch**: \`${branch}\` | **Date**: ${SPEC_KIT_SOURCE.retrievedDate} | **Spec**: \`spec.md\``,
    "",
    `**Input**: Feature specification from \`specs/${branch}/spec.md\``,
    "",
    "## Summary",
    "",
    spec.productDescription,
    "",
    "## Technical Context",
    "",
    `**Target Platform**: ${topology || spec.platformTarget}`,
    "",
    `**Project Type**: ${spec.projectContext.startingPoint === "existing-app" ? "existing application" : "new application"}`,
    "",
    `**Constraints**: ${spec.governance.constraints.join("; ") || "None recorded"}`,
    "",
    `**Scale/Scope**: ${spec.features.length} features, ${spec.screens.length} screens, ${spec.architecture.components.length} components`,
    "",
    "## Constitution Check",
    "",
    list(spec.governance.constraints, "No explicit constraint."),
    "",
    `Decision references: ${spec.governance.decisions.map((id) => `\`${id}\``).join(", ") || "none"}. Owners: ${spec.governance.owners.join(", ") || "none"}.`,
    "",
    "## Logical Architecture",
    "",
    "### Components",
    "",
    components.join("\n") || "- No component declared.",
    "",
    "### Contracts and information flow",
    "",
    contracts.join("\n") || "- No contract declared.",
    "",
    "### Relationships",
    "",
    relationships.join("\n") || "- No relationship declared.",
    "",
    "### Ordered flows",
    "",
    flows.join("\n") || "- No ordered flow declared.",
    "",
    "### Cross-Spec dependencies",
    "",
    dependencies.join("\n") || "- No cross-Spec dependency declared.",
    "",
    "## Project Structure",
    "",
    "The Groundwork Spec and builder handoff remain authoritative. This directory is a one-way compatibility projection and does not initialize or own application source paths.",
    "",
  ].join("\n");
}

function renderTasksProjection(spec: Spec): string {
  const tasks = compileTaskGraph(spec, deriveTasks(spec));
  const taskNumber = new Map(tasks.map((task, index) => [task.id, `T${String(index + 1).padStart(3, "0")}`]));
  return [
    `# Tasks: ${spec.productName}`,
    "",
    "**Input**: Groundwork's dependency-ordered task graph.",
    "",
    "## Format: `[ID] [P?] Description`",
    "",
    ...tasks.map((task) => {
      const parallel = task.deps.length === 0 ? " [P]" : "";
      const dependencies = task.deps.length ? ` Depends on Groundwork task numbers ${task.deps.join(", ")}.` : "";
      return `- [ ] ${taskNumber.get(task.id)}${parallel} ${task.title}.${dependencies} Files: ${task.ownedFiles.join(", ")}. Satisfies: ${task.satisfies.join(", ") || "baseline"}.`;
    }),
    "",
    "## Dependencies & Execution Order",
    "",
    "Groundwork's compiled graph is authoritative. Do not infer parallel work across a declared hard dependency.",
    "",
  ].join("\n");
}

export function exportSpecKit(spec: Spec, options: SpecKitExportOptions = {}): DerivedExport {
  requireExportPrerequisites(spec.governance, spec.changeSet);
  const featureNumber = options.featureNumber ?? 1;
  if (!Number.isSafeInteger(featureNumber) || featureNumber < 1 || featureNumber > 999) {
    throw new Error("Spec Kit featureNumber must be an integer from 1 through 999.");
  }
  const branch = `${String(featureNumber).padStart(3, "0")}-${exportSlug(spec.productName)}`;
  const root = `specs/${branch}`;
  const sourceStamp = {
    schema: "groundwork.export-source/v1",
    derivedFrom: { schema: "groundwork.spec/v3", specId: spec.id, digest: calculateSpecDigest(spec) },
    format: "spec-kit",
    exporterVersion: "1",
    upstream: SPEC_KIT_SOURCE,
    assumptions: [
      "Groundwork spec.json remains canonical.",
      "The exporter targets the stable/main portable intersection and does not invoke specify init.",
      "Additional Spec Kit research, data-model, quickstart, and contracts artifacts stay optional.",
    ],
  };
  return {
    format: "spec-kit",
    exporterVersion: "1",
    source: SPEC_KIT_SOURCE,
    files: sortedExportFiles([
      { path: `${root}/groundwork-source.json`, content: `${JSON.stringify(sourceStamp, null, 2)}\n` },
      { path: `${root}/plan.md`, content: renderPlan(spec, branch) },
      { path: `${root}/spec.md`, content: renderSpec(spec, branch) },
      { path: `${root}/tasks.md`, content: renderTasksProjection(spec) },
    ]),
  };
}
