// ───────────────────────────────────────────────────────────────────────
// Groundwork — Spec → Markdown doc-chain renderer.
//
// Pure functions. No LLM calls, no DB calls, no I/O. Ported from
// ProductPilot's server/services/spec-renderer.ts (renderBrief / renderPRD /
// renderUxSpec / renderFunctionalSpec / renderHandoff) and adapted to emit the
// research-validated three-doc chain that the coding-agent handoff consumes:
//
//   requirements.md — problem, goals, non-goals, personas, needs + features
//                     WITH their EARS acceptance criteria, success metrics.
//   design.md       — architecture summary, data models, API contracts, ADRs,
//                     observability (SLIs/SLOs), risks.
//   DESIGN.md       — per-screen cards, UX flows, and voice & tone.
//
// tasks.md is intentionally NOT emitted here — a peer module owns it.
//
// Design notes:
//   - Every section degrades gracefully on undefined/empty input: it either
//     omits the section or writes a short "_None specified._" line. The
//     renderer never dereferences an optional field without guarding it.
//   - EARS criteria (Need.ears / Feature.ears) render as
//     "WHEN … THE SYSTEM SHALL …" bullets carrying their stable ids so the
//     linter and handoff can trace acceptance criteria to tests.
//   - Each doc ends with a single trailing newline.
// ───────────────────────────────────────────────────────────────────────

import type {
  Spec,
  Persona,
  Scenario,
  Need,
  Feature,
  NonGoal,
  EarsCriterion,
  DataPoint,
  APIContract,
  ADR,
  Risk,
  Screen,
  UXFlow,
  Observability,
  ServiceLevel,
  VoiceProfile,
  Goal,
  SuccessMetric,
  Pillar,
  AcceptanceTest,
  HardConstraint,
  PerformanceBudgetEntry,
  ArchitecturalInvariant,
  Nfr,
  BehaviorContract,
} from "./spec.js";

// ── shared helpers ───────────────────────────────────────────────────────

function heading(level: 1 | 2 | 3 | 4, text: string): string {
  return `${"#".repeat(level)} ${text}`;
}

function bullet(line: string | undefined | null): string {
  if (!line) return "";
  return `- ${line}`;
}

/** Filter out falsy/blank parts and join. Keeps composition surprise-free. */
function joinNonEmpty(parts: Array<string | undefined | null>, sep = "\n"): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join(sep);
}

/**
 * Join, dropping only null/undefined and PRESERVING an intentional `""` as a
 * blank line. `joinNonEmpty` strips blanks, which silently collapses a block
 * of `**Label:**` lines into a single rendered Markdown paragraph — fine for a
 * prose section, wrong for a block whose lines must read as separate fields.
 */
function joinLines(parts: Array<string | undefined | null>): string {
  return parts.filter((p): p is string => p != null).join("\n");
}

/** Render EARS acceptance criteria as id-tagged "WHEN … SHALL …" bullets. */
function renderEars(ears: EarsCriterion[] | undefined, indent = "  "): string {
  if (!ears || !ears.length) return "";
  return ears.map((e) => `${indent}- **${e.id}**: ${e.ears}`).join("\n");
}

/**
 * The absence convention that makes these docs self-resolving rather than
 * merely enumerated:
 *
 *   - A field whose absence is a legitimate DECISION ("there are no external
 *     integrations") renders `_None declared._` and the reader moves on.
 *   - A field whose absence is an UNANSWERED QUESTION renders this marker plus
 *     the exact prompt needed to close it. The doc asks for what it is missing
 *     instead of quietly shipping a hole.
 *
 * `TAG:UNRESOLVED` is the marker Groundwork already uses for unowned setup and
 * missing PII handling notes, so downstream greps keep working unchanged.
 */
export function unresolved(prompt: string): string {
  return `**TAG:UNRESOLVED** — ${prompt}`;
}

// ── requirements.md: pillars, governing sentence, prime directive ─────────

/**
 * The governing sentence sits above everything else: it is the line that
 * settles a scope argument without a meeting. Absent, the doc says so at the
 * top rather than letting the reader discover the gap ten sections later.
 */
function renderGoverningSentence(sentence: string | undefined): string {
  if (sentence && sentence.trim()) return `> ${sentence.trim()}`;
  return `> ${unresolved(
    'no governing sentence declared. Write the one sentence that decides every scope ' +
      'question — "<product> is <this>, not <that>." Every pillar and requirement below ' +
      "must be checkable against it.",
  )}`;
}

/** Ranked pillars, rank 1 first. Ranks are unique (SpecSchema enforces it). */
function renderPillars(pillars: Pillar[] | undefined): string {
  if (!pillars || !pillars.length) {
    // The rank clause is NOT restated here: the conflict rule prints directly
    // below this line and says it. Saying it twice, two lines apart, reads as
    // a generation defect.
    return unresolved(
      "no pillars declared. Rank 3–5 non-negotiable statements, most important first — " +
        "the ranking is what settles the conflicts below.",
    );
  }
  return [...pillars]
    .sort((a, b) => a.rank - b.rank)
    .map((p) => `${p.rank}. **${p.id}** ${p.statement}`)
    .join("\n");
}

/**
 * The two-clause conflict rule, printed directly UNDER the pillar list so a
 * reader resolves a conflict with the ranked list still in view.
 *
 * The first clause is what ranking buys. The second closes the case ranking
 * cannot reach: a system that honours every pillar and still fails the one
 * outcome the build is judged by. Stating only the first leaves that argument
 * to whoever is in the room — which is the judgment this layer exists to make
 * in advance.
 */
function renderConflictRule(): string {
  return joinLines([
    "**Resolving a conflict:**",
    "",
    "- When two pillars conflict, the lower-ranked one yields.",
    "- When a system honours every pillar and still fails the prime-directive acceptance test, the test wins. Passing all the pillars and failing the acceptance test is not a tradeoff — it is a failed build.",
  ]);
}

/**
 * The prime directive: one observable, time-boxed outcome that decides whether
 * the whole build succeeded. SpecSchema requires `observable` and `timeBox`
 * once the object exists, so a rendered acceptance test is always runnable.
 */
function renderAcceptanceTest(test: AcceptanceTest | undefined): string {
  if (!test) {
    return unresolved(
      "no prime-directive acceptance test declared. Name one outcome an observer can " +
        "watch happen, inside a stated time box (e.g. \"a first-time user completes X " +
        "within 3 minutes, without reading docs\"). Implementation is not done until it passes.",
    );
  }
  // Bulleted rather than bare `**Label:**` lines: adjacent lines fold into one
  // rendered paragraph, and these two must stay readable as separate fields.
  const lines = [
    `**${test.id}** — ${test.statement}`,
    "",
    `- **Observable:** ${test.observable}`,
    `- **Time box:** ${test.timeBox}`,
  ];
  if (test.steps.length) {
    lines.push("", "**Steps:**");
    test.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  }
  if (test.pillarIds.length) {
    lines.push("", `**Serves pillars:** ${test.pillarIds.join(", ")}`);
  }
  return joinLines(lines);
}

// ── requirements.md: NFR forcing-field template ───────────────────────────

/**
 * Six fields an implementer would otherwise invent. Unlike every other section
 * here, this one renders ALL its fields whether or not they are populated: an
 * empty field is the point — it emits the prompt that closes it. Skipping empty
 * fields would restore exactly the silent gap this template exists to remove.
 */
function renderNfr(nfr: Nfr | undefined, label = "Non-functional requirements"): string {
  const list = (items: string[]) => items.map((i) => `  - ${i}`).join("\n");
  const field = (
    title: string,
    items: string[],
    prompt: string,
  ): string =>
    items.length ? `- **${title}:**\n${list(items)}` : `- **${title}:** ${unresolved(prompt)}`;

  const lines = [`_${label}: every field below is answered or explicitly marked unresolved._`, ""];
  lines.push(
    nfr?.testStrategy?.trim()
      ? `- **Test strategy:** ${nfr.testStrategy.trim()}`
      : `- **Test strategy:** ${unresolved(
          "name the test levels and what each one proves (unit / integration / e2e / manual), " +
            "and which level gates the release.",
        )}`,
  );
  lines.push(
    field(
      "Edge cases",
      nfr?.edgeCases ?? [],
      "list the inputs and states that break the happy path: empty, maximum, concurrent, " +
        "offline, partial, duplicate, and stale.",
    ),
  );
  lines.push(
    field(
      "Error handling",
      nfr?.errorHandling ?? [],
      "state what the user sees and what the system does for each failure class — and " +
        "whether the operation is retryable.",
    ),
  );
  lines.push(
    field(
      "Validation",
      nfr?.validation ?? [],
      "name every input's rule and the layer that enforces it (client, server, database). " +
        "Client-only validation is not validation.",
    ),
  );
  lines.push(
    field(
      "Security",
      nfr?.security ?? [],
      "state the authentication boundary, the authorization rule, secret handling, and the " +
        "data that must never leave the device or the account.",
    ),
  );
  lines.push(
    field(
      "Accessibility",
      nfr?.accessibility ?? [],
      "state the contrast floor, keyboard path, screen-reader labels, focus management, and " +
        "minimum touch target.",
    ),
  );
  return lines.join("\n");
}

// ── requirements.md sections ─────────────────────────────────────────────

function renderPersonas(personas: Persona[]): string {
  if (!personas.length) return "_No personas specified._";
  return personas
    .map((p) => {
      const lines = [heading(3, p.name)];
      if (p.trigger) lines.push(`**Trigger:** ${p.trigger}`);
      if (p.exclusions.length) {
        lines.push("", "**Who they are NOT:**");
        for (const e of p.exclusions) lines.push(bullet(e));
      }
      if (p.jobs.length) {
        lines.push("", "**Jobs to be done:**");
        for (const j of p.jobs) lines.push(bullet(j));
      }
      return joinNonEmpty(lines);
    })
    .join("\n\n");
}

/**
 * Goals. Prefers the explicit `goals` field when present (each carries its own
 * statement + optional paired metric); falls back to deriving goals from outcome
 * scenarios (context → goal) so specs authored before `goals` existed still render.
 */
function renderGoals(goals: Goal[] | undefined, scenarios: Scenario[]): string {
  if (goals && goals.length) {
    return goals
      .map((g) => {
        const metric = g.metric ? ` _Success metric:_ ${g.metric}` : "";
        return `- **${g.id}** ${g.statement}${metric}`;
      })
      .join("\n");
  }
  if (!scenarios.length) return "_No goals specified._";
  return scenarios
    .map((s) => {
      const ctx = s.context ? `_${s.context}_ — ` : "";
      return `- ${ctx}**${s.goal}**`;
    })
    .join("\n");
}

function renderNonGoals(nonGoals: NonGoal[]): string {
  if (!nonGoals.length) return "_None specified._";
  return nonGoals
    .map((n) => {
      const because = n.because ? ` _Because:_ ${n.because}` : "";
      return `- ${n.text}${because}`;
    })
    .join("\n");
}

function renderNeedsWithEars(needs: Need[]): string {
  if (!needs.length) return "_None specified._";
  return needs
    .map((n) => {
      const pri = n.priority ? `[${n.priority}] ` : "";
      const desc = n.description ? ` — ${n.description}` : "";
      const head = `- **${n.id}** ${pri}${n.title}${desc}`;
      const ears = renderEars(n.ears);
      const acceptance = ears
        ? `\n  - Acceptance criteria (EARS):\n${ears.replace(/^ {2}/gm, "    ")}`
        : "";
      return `${head}${acceptance}`;
    })
    .join("\n");
}

function renderFeaturesWithEars(features: Feature[]): string {
  if (!features.length) return "_None specified._";
  return features
    .map((f) => {
      const pri = f.priority ? `[${f.priority}] ` : "";
      const refs = f.needIds.length ? ` (serves ${f.needIds.join(", ")})` : "";
      const surface = f.surface === "unspecified" ? "" : ` _Surface: ${f.surface}._`;
      const head = `- **${f.id}** ${pri}${f.title}${refs}${surface}`;
      const plainAc = f.acceptanceCriteria.length
        ? `\n  - Acceptance:\n${f.acceptanceCriteria.map((c) => `    - ${c}`).join("\n")}`
        : "";
      const ears = renderEars(f.ears);
      const earsAc = ears
        ? `\n  - Acceptance criteria (EARS):\n${ears.replace(/^ {2}/gm, "    ")}`
        : "";
      return `${head}${plainAc}${earsAc}`;
    })
    .join("\n");
}

/**
 * Success metrics. Prefers the explicit `successMetrics` field (metric → target)
 * when present; falls back to scenario success signals for pre-`successMetrics` specs.
 */
function renderSuccessMetrics(
  metrics: SuccessMetric[] | undefined,
  scenarios: Scenario[],
): string {
  if (metrics && metrics.length) {
    return metrics
      .map((m) => `- **${m.id}** ${m.metric} → **${m.target}**`)
      .join("\n");
  }
  const signals = scenarios
    .filter((s) => s.successSignal && s.successSignal.trim())
    .map((s) => `- ${s.successSignal}`);
  if (!signals.length) return "_No success metrics specified._";
  return signals.join("\n");
}

// ── design.md sections ───────────────────────────────────────────────────

function renderArchitectureSummary(spec: Spec): string {
  const lines: string[] = [];
  lines.push(spec.productDescription || "_No product description._");
  lines.push("");
  lines.push(`**Compatibility platform target:** ${spec.platformTarget}`);
  lines.push("", "**Product topology:**");
  for (const surface of spec.platformSurfaces) {
    const provenance = surface.provenance ? `; ${surface.provenance}` : "";
    const features = surface.featureIds.length ? `; features: ${surface.featureIds.join(", ")}` : "";
    const platform = surface.platform === "macos" ? "macOS" : surface.platform === "ios" ? "iOS" : surface.platform;
    lines.push(`- **${surface.id}** ${surface.name} — ${platform} (${surface.role}${provenance})${features}`);
  }
  if (spec.architecture.components.length) {
    lines.push("", "**Logical components:**");
    for (const component of spec.architecture.components) {
      const features = component.featureIds.length ? `; features: ${component.featureIds.join(", ")}` : "";
      lines.push(`- **${component.id}** ${component.name} — ${component.kind}; owner: ${component.owner}${features}`);
      if (component.ownedFiles?.length) lines.push(`  - Explicit owned files: ${component.ownedFiles.map((file) => `\`${file}\``).join(", ")}`);
    }
  }
  if (spec.architecture.contracts.length) {
    lines.push("", "**Component contracts:**");
    for (const contract of spec.architecture.contracts) {
      lines.push(`- **${contract.id}** ${contract.name}`);
      lines.push(`  - Provider: ${contract.provider.specId}:${contract.provider.id}`);
      lines.push(`  - Consumers: ${contract.consumers.map((ref) => `${ref.specId}:${ref.id}`).join(", ")}`);
      lines.push(`  - Transport: ${contract.transport}`);
      lines.push(`  - Ports: ${contract.ports.map((port) => `${port.id} ${port.direction} ${port.type}`).join("; ")}`);
      lines.push(`  - Failure modes: ${contract.failureModes.join("; ")}`);
      lines.push(`  - Security: ${contract.securityNotes.join("; ")}`);
      if (contract.ownedFiles?.length) lines.push(`  - Explicit owned files: ${contract.ownedFiles.map((file) => `\`${file}\``).join(", ")}`);
    }
  }
  if (spec.architecture.relationships.length) {
    lines.push("", "**Dependency relationships:**");
    for (const relationship of spec.architecture.relationships) {
      const contract = relationship.contractRef ? ` via ${relationship.contractRef.specId}:${relationship.contractRef.id}` : "";
      lines.push(`- **${relationship.id}** ${relationship.from.specId}:${relationship.from.id} → ${relationship.to.specId}:${relationship.to.id}${contract} — ${relationship.criticality}; ${relationship.rationale}`);
    }
  }
  if (spec.architecture.flows.length) {
    lines.push("", "**Architecture flows:**");
    for (const flow of spec.architecture.flows) {
      lines.push(`- **${flow.id}** ${flow.name} — trigger: ${flow.trigger}`);
      for (const exchange of [...flow.exchanges].sort((a, b) => a.order - b.order)) {
        lines.push(`  - ${exchange.order}. ${exchange.from.specId}:${exchange.from.id} → ${exchange.to.specId}:${exchange.to.id}; contract ${exchange.contractRef.specId}:${exchange.contractRef.id}`);
        lines.push(`    - Failure paths: ${exchange.failurePaths.join("; ")}`);
      }
    }
  }
  if (spec.architecture.specDependencies.length) {
    lines.push("", "**Pinned Spec dependencies:**");
    for (const dependency of spec.architecture.specDependencies) {
      const location = dependency.location.kind === "local" ? dependency.location.path : dependency.location.uri;
      lines.push(`- **${dependency.id}** ${dependency.relationship} ${dependency.specId} — schema v${dependency.schemaVersion}; revision ${dependency.revision}; digest ${dependency.digest}; ${dependency.location.kind}: ${location}`);
    }
  }
  lines.push("", "**Change lifecycle:**");
  for (const bucket of ["current", "proposed", "verified"] as const) {
    const changes = spec.changeSet[bucket];
    if (!changes.length) {
      lines.push(`- **${bucket}:** none recorded.`);
      continue;
    }
    for (const change of changes) {
      lines.push(`- **${bucket} · ${change.id}:** ${change.summary} — target ${change.target.specId}:${change.target.kind}:${change.target.id}; ${change.provenance}`);
    }
  }
  if (spec.integrations.length) {
    lines.push("", "**External integrations:**");
    for (const i of spec.integrations) {
      const auth = i.authMode ? ` (auth: ${i.authMode})` : "";
      lines.push(`- **${i.id}** ${i.name} — ${i.purpose}${auth}`);
      if (i.requiredEnv.length) {
        lines.push(`  - Required configuration: ${i.requiredEnv.map((v) => `\`${v}\``).join(", ")}`);
      }
      if (i.featureIds.length) lines.push(`  - Serves features: ${i.featureIds.join(", ")}`);
      for (const step of i.codeSetup) lines.push(`  - AI-owned setup: ${step}`);
      for (const step of i.unclassifiedSetup) {
        lines.push(`  - TAG:UNRESOLVED setup ownership: ${step}`);
      }
      for (const action of i.externalManualActions) {
        lines.push(`  - External manual action (${action.surface}): ${action.action}`);
        if (action.requiredValue) lines.push(`    - Required value or permission: ${action.requiredValue}`);
        if (action.appDestination) lines.push(`    - App destination: ${action.appDestination}`);
        lines.push(`    - Verify: ${action.verification}`);
      }
      for (const check of i.verification) lines.push(`  - Verify: ${check}`);
      if (i.docsUrl) lines.push(`  - Provider docs: ${i.docsUrl}`);
    }
  }
  if (spec.agentSystem?.mission) {
    lines.push("", `**Agent mission:** ${spec.agentSystem.mission}`);
  }
  return joinNonEmpty(lines);
}

function renderDataModels(points: DataPoint[]): string {
  if (!points.length) return "_None specified._";
  return points
    .map((d) => {
      const piiTag = d.pii ? " **(PII)**" : "";
      const desc = d.description ? ` — ${d.description}` : "";
      const note = d.handlingNote
        ? `\n  - Handling: ${d.handlingNote}`
        : d.pii
          ? "\n  - Handling: TAG:UNRESOLVED — handlingNote required for pii=true"
          : "";
      return `- **${d.id}** ${d.name} \`${d.type}\`${piiTag}${desc}${note}`;
    })
    .join("\n");
}

function renderAPIContracts(apis: APIContract[]): string {
  if (!apis.length) return "_None specified._";
  return apis
    .map((a) => {
      const lines = [`#### \`${a.method} ${a.path}\` _(${a.id})_`];
      if (a.description) lines.push(a.description);
      if (a.requestSchema) lines.push(`**Request:**\n\`\`\`\n${a.requestSchema}\n\`\`\``);
      if (a.responseSchema) lines.push(`**Response:**\n\`\`\`\n${a.responseSchema}\n\`\`\``);
      if (a.featureIds.length) lines.push(`_Serves features: ${a.featureIds.join(", ")}_`);
      return joinNonEmpty(lines);
    })
    .join("\n\n");
}

function renderADRs(adrs: ADR[]): string {
  if (!adrs.length) return "_None specified._";
  return adrs
    .map((a) => {
      const lines = [
        heading(3, `${a.id} — ${a.title}`),
        `**Reversibility:** ${a.reversibility}`,
        `**Context:** ${a.context}`,
        `**Decision:** ${a.decision}`,
        // Consequences carry the tradeoff / alternatives rationale.
        a.consequences ? `**Consequences & alternatives:** ${a.consequences}` : null,
        a.cites.length ? `**Cites:** ${a.cites.join(", ")}` : null,
      ];
      return joinNonEmpty(lines);
    })
    .join("\n\n");
}

function renderServiceLevels(levels: ServiceLevel[]): string {
  if (!levels.length) return "_None specified._";
  return levels.map((l) => `- **${l.metric}** → ${l.target}`).join("\n");
}

function renderObservability(obs: Observability | undefined): string {
  if (!obs || (!obs.slis.length && !obs.slos.length)) return "_None specified._";
  const lines: string[] = [];
  lines.push(heading(3, "SLIs"), "", renderServiceLevels(obs.slis));
  lines.push("", heading(3, "SLOs"), "", renderServiceLevels(obs.slos));
  return joinNonEmpty(lines);
}

/**
 * Hard constraints bound the solution space before any design choice is made.
 * Absence is a legitimate decision ("nothing is off the table"), so this
 * degrades to `_None declared._` rather than a forcing prompt.
 */
function renderHardConstraints(constraints: HardConstraint[] | undefined): string {
  if (!constraints || !constraints.length) {
    return "_None declared — no technology, hosting, dependency, or data-residency choice is foreclosed._";
  }
  return constraints
    .map((c) => {
      const because = c.because ? ` _Because:_ ${c.because}` : "";
      return `- **${c.id}** ${c.constraint}${because}`;
    })
    .join("\n");
}

/**
 * A performance target with no number is a preference. Absence here IS an
 * unanswered question — "fast enough" gets decided by whoever writes the code
 * unless the spec decides it first — so it forces.
 */
function renderPerformanceBudget(budget: PerformanceBudgetEntry[] | undefined): string {
  if (!budget || !budget.length) {
    return unresolved(
      "no performance budget declared. Give each user-visible operation a number and a " +
        "percentile (e.g. \"search results < 300ms p95\") and say how it is measured. " +
        "Without one, \"fast enough\" is decided by whoever writes the code.",
    );
  }
  return budget
    .map((b) => {
      const how = b.measuredBy ? ` _Measured by:_ ${b.measuredBy}` : "";
      return `- **${b.id}** ${b.metric} → **${b.budget}**${how}`;
    })
    .join("\n");
}

/**
 * Invariants render twice on purpose: once as prose an implementer reads, then
 * as a single runnable block CI can execute. A rule stated only in prose gets
 * violated in the third month; a rule with a check fails the build that day.
 */
function renderArchitecturalInvariants(invariants: ArchitecturalInvariant[] | undefined): string {
  if (!invariants || !invariants.length) {
    return "_None declared — no structural rule is being asserted beyond the ADRs above._";
  }
  const lines = invariants.map((i) => {
    const pillars = i.pillarIds.length ? ` _(serves ${i.pillarIds.join(", ")})_` : "";
    return `- **${i.id}** ${i.rule}${pillars}\n  - Check: \`${i.check}\``;
  });
  lines.push(
    "",
    "**Run every invariant check.** Each command must exit 0; a non-zero exit is a violated invariant, not a warning.",
    "",
    "```bash",
    ...invariants.map((i) => i.check),
    "```",
  );
  return lines.join("\n");
}

function renderRisks(risks: Risk[]): string {
  if (!risks.length) return "_None specified._";
  return risks
    .map((r) => {
      const mit = r.mitigation ? ` Mitigation: ${r.mitigation}` : "";
      return `- _(L:${r.likelihood} I:${r.impact})_ ${r.text}.${mit}`;
    })
    .join("\n");
}

// ── DESIGN.md sections ───────────────────────────────────────────────────

/**
 * Per-screen cards. The Screen schema now carries the design-card fields
 * {purpose, elements, data, states, interactions}; primaryAction stands in for
 * interactions. `elements` and `data` are optional and degrade to
 * "_None specified._" when absent.
 */
function renderScreenElements(elements: Screen["elements"]): string {
  if (!elements || !elements.length) return "_None specified._";
  return elements
    .map((e) => (e.role ? `${e.name} (${e.role})` : e.name))
    .join(", ");
}

function renderScreenData(data: Screen["data"]): string {
  if (!data || !data.length) return "_None specified._";
  return data
    .map((d) => (d.source ? `${d.field} ← ${d.source}` : d.field))
    .join(", ");
}

function renderScreenCards(screens: Screen[]): string {
  if (!screens.length) return "_No screens specified._";
  return screens
    .map((s) => {
      const lines = [
        heading(3, `${s.name} _(${s.id})_`),
        `**Purpose:** ${s.purpose}`,
        `**Elements:** ${renderScreenElements(s.elements)}`,
        `**Data:** ${renderScreenData(s.data)}`,
        `**Interactions:** ${s.primaryAction ?? "_None specified._"}`,
        `**States:** ${s.states.length ? s.states.join(", ") : "_None specified._"}`,
      ];
      return joinNonEmpty(lines);
    })
    .join("\n\n");
}

function renderBehaviorContracts(contracts: BehaviorContract[]): string {
  if (!contracts.length) return "_No behavior contract declared. Existing screen and flow sections remain authoritative._";
  return contracts.map((contract) => joinLines([
    heading(3, `${contract.name} _(${contract.id})_`),
    `**Trigger:** ${contract.trigger}`,
    `**Scope:** ${contract.scope.kind} — ${contract.scope.refs.join(", ")}`,
    `**States:** ${contract.states.length ? contract.states.map((state) => state.id).join(", ") : "_None declared_"}`,
    "**Actions:**",
    ...(contract.actions.length ? contract.actions.map((action) => `- **${action.name}** _(${action.id})_ → ${action.toStateId ?? "state unchanged"}; effects: ${action.effects.map((effect) => effect.kind).join(", ") || "none"}; writes: ${action.writes.map((write) => `${write.storeRef}/${write.entity}`).join(", ") || "none"}; prohibited: ${action.prohibitedWrites.map((write) => `${write.storeRef}/${write.entity}`).join(", ") || "none"}`) : ["- _None declared_"]),
    `**Information flow:** ${contract.informationFlow.length ? contract.informationFlow.map((flow) => `${flow.sourceRef} → ${flow.targetRef}`).join("; ") : "_None declared_"}`,
  ])).join("\n\n");
}

function renderDesignContract(spec: Spec): string {
  const contract = spec.designContract;
  if (!contract) return "_No reproducible baseline or design delta declared._";
  const baseline = contract.baseline;
  return joinLines([
    `**Contract intent:** ${contract.intent?.type ?? "change"}`,
    `**Baseline:** ${baseline.disposition}${baseline.id ? ` — ${baseline.id}` : ""}`,
    "**Authoritative baseline artifacts:**",
    ...(baseline.artifacts.length ? baseline.artifacts.map((artifact) => `- \`${artifact.path}\` — ${artifact.type}; \`${artifact.digest}\``) : ["- _None declared_"]),
    `**Direction:** ${contract.direction.summary}`,
    "**Decisions:**",
    ...(spec.adrs.filter((adr) => adr.rigidity).map((adr) => `- **${adr.id}** — ${adr.rigidity}; scope: ${adr.scope ? adr.scope.refs.join(", ") : "unspecified"}`) || ["- _None declared_"]),
    "**Deltas:**",
    ...(contract.deltas.length ? contract.deltas.map((delta) => `- **${delta.id}** ${delta.operation} ${delta.targetRefs.join(", ")} (${delta.baselineId ?? "no baseline"})`) : ["- _None declared_"]),
    "**Precedence:**",
    ...(baseline.precedence.length ? baseline.precedence.map((entry) => `- ${entry.rank}. ${entry.artifactId}`) : ["- _None declared_"]),
    `**Verification:** ${contract.verification.length ? contract.verification.map((item) => item.id).join(", ") : "_None declared_"}`,
    "**Exact reconstruction checklist:**",
    ...(contract.constraints.length ? contract.constraints.map((item) => `- [ ] \`${item.id}\`: ${item.targetRef}.${item.propertyPath} ${item.operator}${item.value === undefined ? "" : ` ${JSON.stringify(item.value)}`}${item.unit ? ` ${item.unit}` : ""}; evidence: ${item.sourceArtifactId ?? "none"}; verify: ${item.verificationRefs.join(", ") || "none"}`) : ["- _None declared_"]),
  ]);
}

function renderUXFlows(flows: UXFlow[]): string {
  if (!flows.length) return "_None specified._";
  return flows
    .map((f) => {
      const steps = f.steps.length
        ? f.steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n")
        : "  _No steps specified._";
      const screens = f.screenIds.length ? `  - Screens: ${f.screenIds.join(", ")}` : "";
      return joinNonEmpty([heading(3, `${f.name} _(${f.id})_`), steps, screens]);
    })
    .join("\n\n");
}

/**
 * Voice principles and word lists describe a register; only an example copy
 * string shows it. Once a profile exists, missing examples force — an
 * implementer handed "warm but not chatty" and no sample writes their own
 * register and calls it compliant.
 */
function renderVoiceProfile(voice: VoiceProfile | undefined): string {
  if (
    !voice ||
    (!voice.principles.length &&
      !voice.doWords.length &&
      !voice.dontWords.length &&
      !voice.examples.length)
  ) {
    return "_None specified._";
  }
  // Built as blocks joined by a blank line: each block must render as its own
  // Markdown paragraph or list, not fold into the one above it.
  const blocks: string[] = [];
  if (voice.principles.length) {
    blocks.push(joinLines(["**Principles:**", ...voice.principles.map(bullet)]));
  }
  if (voice.doWords.length) blocks.push(`**Do:** ${voice.doWords.join(", ")}`);
  if (voice.dontWords.length) blocks.push(`**Don't:** ${voice.dontWords.join(", ")}`);
  blocks.push(
    joinLines([
      "**Example copy:**",
      ...(voice.examples.length
        ? voice.examples.map((e) => `- _${e.context}:_ "${e.copy}"`)
        : [
            bullet(
              unresolved(
                "no example copy strings declared. Write the literal text for at least the " +
                  "primary action, one empty state, and one error — the register is not " +
                  "transferable without them.",
              ),
            ),
          ]),
    ]),
  );
  return blocks.join("\n\n");
}

/**
 * The config header: how this artifact set expects to be READ, stated before
 * the first thing it says.
 *
 * It closes two silent decisions. A set written for a frontier tier and then
 * worked by a smaller one loses the clauses that make it buildable while
 * keeping the prose that reads like completeness. And a reader who summarizes
 * a section drops the constraint that section carried — the constraint, not the
 * prose, is the deliverable.
 *
 * Rendered on every generation whether or not `readingContract` is authored,
 * for the same reason `renderSpecCodeSync` is: an unstated reading rule is an
 * unfollowed one. Exported so the handoff emitter states it on the two
 * build-facing docs (`tasks.md`, `builder-handoff.md`) without re-deriving it.
 */
export function renderReadingContract(spec: Spec): string {
  const contract = spec.readingContract;
  const tier = contract?.tier?.trim() || "frontier";
  const context = contract?.context?.trim() || "codegen";
  const lines = [
    `**Read at:** tier \`${tier}\` · context \`${context}\``,
    "",
    "**No compression.** Every section in this set carries a testable constraint. " +
      "Summarizing a section, merging two, or skipping one marked `TAG:UNRESOLVED` drops " +
      "the constraint it carried and leaves the prose that hid it. Read every section at " +
      "full length before writing code.",
  ];
  const notes = contract?.notes ?? [];
  if (notes.length) {
    lines.push("", "**Standing instructions:**", ...notes.map(bullet));
  }
  return joinLines(lines);
}

/**
 * The rule that keeps `spec.json` and the implementation from silently
 * diverging. Rendered on EVERY generation, authored or not: a sync rule nobody
 * stated is a sync rule nobody follows, and the spec-first default is the one
 * Groundwork's own architecture already assumes (docs are projections of the
 * Spec, so editing a doc directly loses the edit on the next generation).
 */
export function renderSpecCodeSync(spec: Spec): string {
  const sync = spec.specCodeSync;
  const policy = sync?.policy ?? "spec-first";
  const specPath = sync?.specPath ?? "spec.json";
  const regenerate = sync?.regenerateCommand;
  const lines: string[] = [
    `**Policy:** \`${policy}\` · **Source of truth:** \`${specPath}\``,
    "",
  ];
  if (policy === "spec-first") {
    lines.push(
      `When implementation and \`${specPath}\` disagree, \`${specPath}\` wins: change it first, regenerate, then code.`,
    );
  } else if (policy === "code-first") {
    lines.push(
      `When implementation and \`${specPath}\` disagree, the running code wins: update \`${specPath}\` to match observed behavior, then regenerate.`,
    );
  } else {
    lines.push(
      `When implementation and \`${specPath}\` disagree, resolve the delta explicitly and record which side changed — neither silently wins.`,
    );
  }
  lines.push(
    "",
    `Every markdown file in this directory is a rendered projection of \`${specPath}\`. Editing one by hand loses the edit on the next generation — edit the Spec instead.`,
    "",
    "**A change is not done until the Spec reflects it.** Update the Spec and regenerate when the work:",
  );
  const triggers = sync?.triggers.length
    ? sync.triggers
    : [
        "adds, removes, or renames a requirement, feature, screen, or API contract",
        "changes a data field, its type, or its PII classification",
        "adds or drops an external integration, environment variable, or manual setup action",
        "changes an acceptance criterion, invariant, performance budget, or hard constraint",
        "resolves a TAG:UNRESOLVED or TAG:ASSUMED item anywhere in this artifact set",
      ];
  for (const t of triggers) lines.push(bullet(t));
  if (regenerate) {
    lines.push("", "**Regenerate with:**", "", "```bash", regenerate, "```");
  } else {
    lines.push(
      "",
      `**Regenerate with:** the Groundwork emitter against \`${specPath}\` (\`node <plugin>/engine/dist/cli.js ${specPath} --out .\`).`,
    );
  }
  return lines.join("\n");
}

function renderProjectContext(spec: Spec): string {
  const context = spec.projectContext;
  const lines = [`**Starting point:** ${context.startingPoint}`];
  if (context.sourceRepo) lines.push(`**Source repository:** \`${context.sourceRepo}\``);
  if (context.sourceUrl) lines.push(`**Running product:** ${context.sourceUrl}`);
  if (context.sourceArtifacts.length) {
    lines.push(`**Inspected artifacts:** ${context.sourceArtifacts.map((item) => `\`${item}\``).join(", ")}`);
  }
  if (context.inspectedAt) lines.push(`**Inspected at:** ${context.inspectedAt}`);
  if (context.bootstrap) {
    lines.push("", "**Accepted bootstrap files:**");
    for (const file of context.bootstrap.ownedFiles) lines.push(`- \`${file}\``);
    lines.push(
      "",
      "**Accepted bootstrap commands:**",
      `- Install: \`${context.bootstrap.commands.install}\``,
      `- Typecheck: \`${context.bootstrap.commands.typecheck}\``,
      `- Test: \`${context.bootstrap.commands.test}\``,
      `- Build: \`${context.bootstrap.commands.build}\``,
    );
  }
  if (context.evidence.length) {
    lines.push("", "**Evidence and decisions:**");
    for (const item of context.evidence) {
      const refs = item.sourceRefs.length ? ` _Sources: ${item.sourceRefs.join(", ")}._` : "";
      lines.push(`- **${item.status.toUpperCase()} · ${item.id}:** ${item.statement}${refs}`);
    }
  }
  return joinNonEmpty(lines);
}

function renderUiPreferences(spec: Spec): string {
  const ui = spec.uiPreferences;
  const lines: string[] = [];
  if (ui.informationDensity) lines.push(`**Information density:** ${ui.informationDensity}`);
  if (ui.brandAdjectives.length) lines.push(`**Brand direction:** ${ui.brandAdjectives.join(", ")}`);
  if (ui.accessibilityFloor.length) {
    lines.push("", "**Accessibility floor:**");
    for (const item of ui.accessibilityFloor) lines.push(bullet(item));
  }
  if (ui.responsiveTargets) {
    const range = [ui.responsiveTargets.minimum, ui.responsiveTargets.maximum]
      .filter(Boolean)
      .join(" → ");
    if (range) lines.push("", `**Responsive range:** ${range}`);
    if (ui.responsiveTargets.deviceClasses.length) {
      lines.push(`**Device classes:** ${ui.responsiveTargets.deviceClasses.join(", ")}`);
    }
  }
  if (ui.mustKeep.length) {
    lines.push("", "**Must keep:**");
    for (const item of ui.mustKeep) lines.push(bullet(item));
  }
  if (ui.mustAvoid.length) {
    lines.push("", "**Must avoid:**");
    for (const item of ui.mustAvoid) lines.push(bullet(item));
  }
  if (ui.mayEvolve.length) {
    lines.push("", "**May evolve:**");
    for (const item of ui.mayEvolve) lines.push(bullet(item));
  }
  if (ui.visualReferences.length) {
    lines.push("", "**Visual references:**");
    for (const item of ui.visualReferences) lines.push(bullet(item));
  }
  return joinNonEmpty(lines) || "_No UI preferences captured._";
}

// ── doc assembly ─────────────────────────────────────────────────────────

function renderRequirements(spec: Spec): string {
  const featureNfrOverrides = renderFeatureNfrOverrides(spec.features);
  const parts: string[] = [
    heading(1, `Requirements — ${spec.productName}`),
    "",
    // Pillars and the prime directive lead the document deliberately: a reader
    // must be able to resolve a priority conflict, and know what "done" looks
    // like, before reading a single requirement.
    renderGoverningSentence(spec.governingSentence),
    "",
    heading(2, "Pillars"),
    "",
    "_Ranked non-negotiables. Rank 1 is the one that survives when something has to give._",
    "",
    renderPillars(spec.pillars),
    "",
    renderConflictRule(),
    "",
    heading(2, "Prime directive — acceptance test"),
    "",
    "_The single observable, time-boxed outcome that decides whether this build succeeded._",
    "",
    renderAcceptanceTest(spec.acceptanceTest),
    "",
    heading(2, "Problem & context"),
    "",
    spec.productDescription || "_No description._",
    "",
    heading(2, "Starting point & provenance"),
    "",
    renderProjectContext(spec),
    "",
    heading(2, "Goals"),
    "",
    renderGoals(spec.goals, spec.scenarios),
    "",
    heading(2, "Non-goals"),
    "",
    renderNonGoals(spec.nonGoals),
    "",
    heading(2, "Personas"),
    "",
    renderPersonas(spec.personas),
    "",
    heading(2, "Needs"),
    "",
    renderNeedsWithEars(spec.needs),
    "",
    heading(2, "Features"),
    "",
    renderFeaturesWithEars(spec.features),
    "",
    heading(2, "Non-functional requirements"),
    "",
    renderNfr(spec.nfr),
    "",
    // Only present when at least one feature declares an override — an empty
    // heading would read like a defect.
    ...(featureNfrOverrides ? [featureNfrOverrides, ""] : []),
    heading(2, "Success metrics"),
    "",
    renderSuccessMetrics(spec.successMetrics, spec.scenarios),
    "",
  ];
  return parts.join("\n");
}

/**
 * Per-feature NFR overrides, rendered only for the features that declare one.
 * Unlike the spec-level template this does NOT force on absence: a feature
 * without an override inherits the spec-level posture above, which is already
 * complete or already forcing.
 */
function renderFeatureNfrOverrides(features: Feature[]): string {
  const withNfr = features.filter((f) => f.nfr);
  if (!withNfr.length) return "";
  return withNfr
    .map((f) =>
      joinLines([
        heading(3, `Feature overrides — ${f.title} _(${f.id})_`),
        "",
        renderNfr(f.nfr, `Overrides for ${f.id}`),
      ]),
    )
    .join("\n\n");
}

function renderDesign(spec: Spec): string {
  const parts: string[] = [
    heading(1, `Design — ${spec.productName}`),
    "",
    heading(2, "Architecture summary"),
    "",
    renderArchitectureSummary(spec),
    "",
    ...(spec.designContract ? [heading(2, "Reproducible design contract"), "", renderDesignContract(spec), ""] : []),
    heading(2, "Hard constraints"),
    "",
    "_Non-negotiable bounds on the solution space. A design that violates one is wrong, not a tradeoff._",
    "",
    renderHardConstraints(spec.hardConstraints),
    "",
    heading(2, "Performance budget"),
    "",
    renderPerformanceBudget(spec.performanceBudget),
    "",
    heading(2, "Architectural invariants"),
    "",
    "_Each rule carries the check that enforces it. Prose without a check is a wish._",
    "",
    renderArchitecturalInvariants(spec.architecturalInvariants),
    "",
    heading(2, "Data models"),
    "",
    renderDataModels(spec.dataPoints),
    "",
    heading(2, "API contracts"),
    "",
    renderAPIContracts(spec.apiContracts),
    "",
    heading(2, "Architecture decisions (ADRs)"),
    "",
    renderADRs(spec.adrs),
    "",
    heading(2, "Observability"),
    "",
    renderObservability(spec.observability),
    "",
    heading(2, "Risks"),
    "",
    renderRisks(spec.risks),
    "",
  ];
  return parts.join("\n");
}

function renderDesignUx(spec: Spec): string {
  const parts: string[] = [
    heading(1, `Design (UX) — ${spec.productName}`),
    "",
    ...(spec.behaviorContracts?.length ? [heading(2, "Behavior contract"), "", renderBehaviorContracts(spec.behaviorContracts), ""] : []),
    heading(2, "Screens"),
    "",
    renderScreenCards(spec.screens),
    "",
    heading(2, "UX flows"),
    "",
    renderUXFlows(spec.uxFlows),
    "",
    heading(2, "Voice & tone"),
    "",
    renderVoiceProfile(spec.voiceProfile),
    "",
    heading(2, "Confirmed UI preferences"),
    "",
    renderUiPreferences(spec),
    "",
    "---",
    "> **Design tokens** (color, type, space, motion), when confirmed, are embedded " +
      "in the Builder Handoff alongside this human-facing screen and voice brief. " +
      "No separate token sidecar is required to understand the accepted direction.",
    "",
  ];
  return parts.join("\n");
}

function renderSteering(spec: Spec): string {
  const boundaries = spec.boundaries;
  const lines = [
    heading(1, `Steering — ${spec.productName}`),
    "",
    // The config header leads the packet's front door: it governs how every
    // other file here is read, so it cannot sit below them.
    renderReadingContract(spec),
    "",
    "---",
    "",
    renderGoverningSentence(spec.governingSentence),
    "",
    heading(2, "Pillars"),
    "",
    renderPillars(spec.pillars),
    "",
    renderConflictRule(),
    "",
    heading(2, "Spec ↔ code sync"),
    "",
    renderSpecCodeSync(spec),
    "",
    heading(2, "Product direction"),
    "",
    spec.productDescription,
    "",
    renderProjectContext(spec),
    "",
    heading(2, "UI direction"),
    "",
    renderUiPreferences(spec),
    "",
    heading(2, "Voice"),
    "",
    renderVoiceProfile(spec.voiceProfile),
    "",
    heading(2, "Operating boundaries"),
    "",
  ];
  if (!boundaries) {
    lines.push("_No explicit boundaries captured._");
  } else {
    for (const [label, items] of [
      ["Always", boundaries.always],
      ["Ask first", boundaries.askFirst],
      ["Never", boundaries.never],
    ] as const) {
      lines.push(heading(3, label), "");
      lines.push(items.length ? items.map(bullet).join("\n") : "_None specified._", "");
    }
  }
  return lines.join("\n");
}

/**
 * Render the full research-validated doc chain from a Spec. Pure: same Spec in,
 * same three Markdown strings out. Keys match the on-disk filenames the handoff
 * writer emits (tasks.md is owned by a peer module and is not produced here).
 */
export function renderDocs(spec: Spec): {
  "steering.md": string;
  "requirements.md": string;
  "design.md": string;
  "design-system.md": string;
} {
  return {
    "steering.md": renderSteering(spec),
    "requirements.md": renderRequirements(spec),
    "design.md": renderDesign(spec),
    // Named `design-system.md` (not `DESIGN.md`) so it never collides with
    // `design.md` on case-insensitive filesystems (default macOS APFS).
    "design-system.md": renderDesignUx(spec),
  };
}
