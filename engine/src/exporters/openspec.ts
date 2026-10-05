import type { QualifiedRef } from "../architecture.js";
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

export const OPENSPEC_SOURCE: DerivedExportSource = {
  repository: "https://github.com/Fission-AI/OpenSpec",
  retrievedDate: "2026-08-07",
  stableVersion: "v1.8.0",
  stableCommit: "d57889664cab4f2f061d236ec3ff82a5578701bb",
  mainCommit: "e50bd0983dc8dc48250e3181f36e28450542f2ab",
  supportedPaths: [
    "openspec/config.yaml",
    "openspec/specs/<capability-path>/spec.md",
    "openspec/changes/<change-id>/.openspec.yaml",
    "openspec/changes/<change-id>/proposal.md",
    "openspec/changes/<change-id>/design.md",
    "openspec/changes/<change-id>/tasks.md",
    "openspec/changes/<change-id>/specs/<capability-path>/spec.md",
  ],
};

export interface OpenSpecExportOptions {
  capability?: string;
  changeId?: string;
}

function ref(ref: QualifiedRef): string {
  return `${ref.specId}:${ref.kind}:${ref.id}`;
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function requirementBlock(title: string, body: string, scenario: string): string {
  return [
    `### Requirement: ${title}`,
    `The system SHALL satisfy this Groundwork-defined behavior: ${body}`,
    "",
    "#### Scenario: Groundwork acceptance",
    `- **WHEN** ${scenario}`,
    `- **THEN** the system SHALL satisfy this Groundwork-defined behavior: ${body}`,
  ].join("\n");
}

function currentSpec(spec: Spec): string | undefined {
  if (!spec.changeSet.current.length) return undefined;
  return [
    `# ${spec.productName} current behavior`,
    "",
    "## Purpose",
    spec.productDescription,
    "",
    "## Requirements",
    "",
    ...spec.changeSet.current.map((record) => requirementBlock(record.id, record.summary, `the ${ref(record.target)} behavior is exercised`)),
    "",
  ].join("\n");
}

function deltaSpec(spec: Spec): string {
  return [
    "# Groundwork change delta",
    "",
    "## ADDED Requirements",
    "",
    ...spec.changeSet.proposed.map((record) => requirementBlock(record.id, record.summary, `the ${ref(record.target)} change is implemented`)),
    "",
  ].join("\n");
}

function proposal(spec: Spec): string {
  return [
    `# Change: ${spec.productName}`,
    "",
    "## Why",
    spec.productDescription,
    "",
    "## What Changes",
    "",
    ...spec.changeSet.proposed.map((record) => `- ${record.summary} (\`${ref(record.target)}\`; ${record.provenance})`),
    "",
    "## Capabilities",
    "",
    spec.changeSet.current.length ? "### Modified Capabilities" : "### New Capabilities",
    "",
    `- \`${exportSlug(spec.productName)}\`: ${spec.productDescription}`,
    "",
    "## Impact",
    "",
    `- Platforms: ${spec.platformSurfaces.map((surface) => `${surface.platform} ${surface.role}`).join(", ") || spec.platformTarget}`,
    `- Components: ${spec.architecture.components.map((item) => item.id).join(", ") || "none"}`,
    `- Contracts: ${spec.architecture.contracts.map((item) => item.id).join(", ") || "none"}`,
    "",
  ].join("\n");
}

function design(spec: Spec): string {
  return [
    `# Design: ${spec.productName}`,
    "",
    "## Context",
    "",
    `Groundwork Spec \`${spec.id}\` is authoritative. This OpenSpec tree is a one-way compatibility projection.`,
    "",
    "## Goals / Non-Goals",
    "",
    ...spec.governance.constraints.map((value) => `- Goal/constraint: ${value}`),
    ...spec.nonGoals.map((value) => `- Non-goal: ${value.text} because ${value.because}`),
    "",
    "## Decisions",
    "",
    ...spec.adrs.map((adr) => `- \`${adr.id}\` ${adr.decision}${adr.consequences ? `; consequences: ${adr.consequences}` : ""}`),
    "",
    "## Components",
    "",
    ...spec.architecture.components.map((component) => `- \`${component.id}\` ${component.name} (${component.kind}); owner ${component.owner}; features ${component.featureIds.join(", ") || "none"}.`),
    "",
    "## Contracts and Information Flow",
    "",
    ...spec.architecture.contracts.map((contract) => `- \`${contract.id}\` ${contract.name}: ${ref(contract.provider)} -> ${contract.consumers.map(ref).join(", ") || "none"} over ${contract.transport}; ports ${contract.ports.map((port) => `${port.id} ${port.direction} ${port.name}:${port.type} ${port.required ? "required" : "optional"}`).join(", ")}; failures ${contract.failureModes.join("; ") || "none"}; security ${contract.securityNotes.join("; ") || "none"}.`),
    "",
    "## Relationships",
    "",
    ...(spec.architecture.relationships.length ? spec.architecture.relationships.map((relationship) => `- \`${relationship.id}\` ${ref(relationship.from)} -> ${ref(relationship.to)}; ${relationship.direction}; ${relationship.criticality}; ${relationship.optional ? "optional" : "required"}${relationship.contractRef ? `; contract ${ref(relationship.contractRef)}` : ""}; rationale: ${relationship.rationale}.`) : ["- None declared."]),
    "",
    "## Ordered Flows",
    "",
    ...spec.architecture.flows.flatMap((flow) => [
      `- Flow \`${flow.id}\` ${flow.name}; trigger: ${flow.trigger}.`,
      ...flow.exchanges.map((exchange) => `  - ${exchange.order}. ${ref(exchange.from)} -> ${ref(exchange.to)} via ${ref(exchange.contractRef)}; input ${exchange.inputRefs.map(ref).join(", ") || "none"}; output ${exchange.outputRefs.map(ref).join(", ") || "none"}; failures ${exchange.failurePaths.join("; ") || "none"}.`),
    ]),
    "",
    "## Cross-Spec Dependencies",
    "",
    ...(spec.architecture.specDependencies.length ? spec.architecture.specDependencies.map((dependency) => `- \`${dependency.id}\` ${dependency.relationship} \`${dependency.specId}\`; revision ${dependency.revision}; digest ${dependency.digest}; location ${dependency.location.kind === "local" ? dependency.location.path : dependency.location.uri}.`) : ["- None declared."]),
    "",
    "## Risks / Trade-offs",
    "",
    ...spec.risks.map((risk) => `- ${risk.text}; likelihood ${risk.likelihood}; impact ${risk.impact}; mitigation: ${risk.mitigation || "resolve before build completion"}.`),
    "",
  ].join("\n");
}

function tasks(spec: Spec): string {
  const compiled = compileTaskGraph(spec, deriveTasks(spec));
  return [
    `# Tasks: ${spec.productName}`,
    "",
    ...compiled.map((task, index) => `- [ ] ${index + 1}.${task.deps.length ? ` (depends on ${task.deps.join(", ")})` : ""} ${task.title}; satisfies ${task.satisfies.join(", ") || "baseline"}; files ${task.ownedFiles.join(", ")}.`),
    "",
  ].join("\n");
}

export function exportOpenSpec(spec: Spec, options: OpenSpecExportOptions = {}): DerivedExport {
  requireExportPrerequisites(spec.governance, spec.changeSet);
  if (!spec.changeSet.current.length && !spec.changeSet.proposed.length) {
    throw new Error("OpenSpec export requires current behavior or an intended proposed change; verified delivery evidence cannot substitute for intent.");
  }
  const capability = exportSlug(options.capability || spec.productName);
  const changeId = exportSlug(options.changeId || spec.changeSet.id);
  const current = currentSpec(spec);
  const sourceStamp = {
    schema: "groundwork.export-source/v1",
    derivedFrom: { schema: "groundwork.spec/v3", specId: spec.id, digest: calculateSpecDigest(spec) },
    format: "openspec",
    exporterVersion: "1",
    upstream: OPENSPEC_SOURCE,
    assumptions: [
      "Groundwork spec.json remains canonical.",
      "The exporter targets OpenSpec's spec-driven stable/main layout and does not invoke openspec init.",
      "Groundwork current records become the current capability spec; proposed records become ADDED delta requirements.",
      "Verified delivery evidence is intentionally not promoted into current or proposed behavior.",
    ],
  };
  const changeRoot = `openspec/changes/${changeId}`;
  const files = [
    {
      path: "openspec/config.yaml",
      content: [
        "schema: spec-driven",
        "context: |",
        `  Derived from Groundwork Spec ${spec.id}.`,
        "  Groundwork spec.json is authoritative; edit it and regenerate this projection.",
        `  Platforms: ${spec.platformSurfaces.map((surface) => `${surface.platform} ${surface.role}`).join(", ") || spec.platformTarget}.`,
        "rules:",
        "  proposal:",
        "    - Preserve Groundwork trace IDs and scope boundaries.",
        "  specs:",
        "    - Keep Given/When/Then scenarios linked to Groundwork targets.",
        "",
      ].join("\n"),
    },
    { path: "openspec/groundwork-source.json", content: `${JSON.stringify(sourceStamp, null, 2)}\n` },
  ];
  if (current) files.push({ path: `openspec/specs/${capability}/spec.md`, content: current });
  if (spec.changeSet.proposed.length) {
    files.push(
      { path: `${changeRoot}/.openspec.yaml`, content: `schema: spec-driven\n` },
      { path: `${changeRoot}/design.md`, content: design(spec) },
      { path: `${changeRoot}/proposal.md`, content: proposal(spec) },
      { path: `${changeRoot}/specs/${capability}/spec.md`, content: deltaSpec(spec) },
      { path: `${changeRoot}/tasks.md`, content: tasks(spec) },
    );
  }
  return {
    format: "openspec",
    exporterVersion: "1",
    source: OPENSPEC_SOURCE,
    files: sortedExportFiles(files),
  };
}
