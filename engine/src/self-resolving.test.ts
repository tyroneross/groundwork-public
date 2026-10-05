// ───────────────────────────────────────────────────────────────────────
// Groundwork — self-resolving-output tests.
//
// Covers the eight additions that turn the generated artifact set from an
// ENUMERATION of what was captured into a set of documents that resolve their
// own gaps:
//
//   1. pillars[{rank,statement}] + governingSentence, at the top of requirements.md
//   2. prime-directive acceptanceTest — requirements.md + tasks.md terminal gate
//   3. per-phase runnable acceptance (Phase | Scope | Acceptance) in tasks.md
//   4. hardConstraints + performanceBudget in design.md
//   5. architecturalInvariants[{rule,check}] as executable checks
//   6. NFR forcing-field template (test/edge/error/validation/security/a11y)
//   7. voiceProfile example copy strings
//   8. spec ↔ code sync rule
//   9. pillar → requirement → design → task → acceptance in traceability.json
//  10. the two-clause conflict rule + the reading contract (config header)
//
// Two properties are asserted throughout:
//   - ADDITIVE: a Spec that predates every field above still validates and
//     still emits, with no field required.
//   - FORCING: an absent field that represents an UNANSWERED QUESTION renders
//     a TAG:UNRESOLVED prompt naming what to supply, rather than being omitted.
//     An absent field that represents a legitimate DECISION does not.
//
// Run: npx tsx --test engine/src/self-resolving.test.ts
// (also wired into `npm test` via scripts/check.sh)
// ───────────────────────────────────────────────────────────────────────

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SpecSchema, type Spec } from "./spec.js";
import { renderDocs } from "./render.js";
import { deriveTasks, renderTasks, renderBuilderHandoff } from "./handoff.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(HERE, "..", "fixtures", "sample-spec.json");
const CLI_PATH = path.join(HERE, "..", "dist", "cli.js");

function specOf(overrides: Record<string, unknown> = {}): Spec {
  return SpecSchema.parse({
    schemaVersion: 2,
    id: "spec-self-resolving",
    productName: "SelfResolvingApp",
    productDescription: "A spec used to test self-resolving generated output.",
    ...overrides,
  });
}

function tasksOf(spec: Spec): string {
  return renderTasks(spec, deriveTasks(spec));
}

/** A spec exercising every new field, with a full pillar→acceptance chain. */
function fullSpec(): Spec {
  return specOf({
    platformTarget: "web",
    governingSentence: "SelfResolvingApp is a spec emitter, not a code generator.",
    pillars: [
      { id: "pillar-determinism", rank: 1, statement: "Same Spec in, same bytes out." },
      { id: "pillar-traceability", rank: 2, statement: "Every requirement reaches a test." },
    ],
    acceptanceTest: {
      id: "acceptance-prime",
      statement: "A new user emits a complete artifact set from a bare idea.",
      observable: "Eight files appear in the output directory and requirements.md names the pillars.",
      timeBox: "within 5 minutes of first invocation, no documentation read",
      steps: ["Describe the idea", "Answer the material gaps", "Run the emitter"],
      pillarIds: ["pillar-determinism"],
    },
    hardConstraints: [
      { id: "hc-no-network", constraint: "The emitter makes no network call.", because: "It must run offline in CI." },
    ],
    performanceBudget: [
      { id: "perf-emit", metric: "full artifact-set emission", budget: "< 2s p95", measuredBy: "time node engine/dist/cli.js" },
    ],
    architecturalInvariants: [
      {
        id: "inv-pure-render",
        rule: "render.ts performs no I/O.",
        check: "! grep -rn 'node:fs' engine/src/render.ts",
        pillarIds: ["pillar-determinism"],
      },
    ],
    nfr: {
      testStrategy: "Unit for pure renderers; one end-to-end CLI test per artifact.",
      edgeCases: ["empty Spec", "Spec with no features"],
      errorHandling: ["invalid Spec prints failing fields and exits 1"],
      validation: ["SpecSchema validates before any file is written"],
      security: ["secret-shaped strings are scrubbed from every emitted doc"],
      accessibility: ["emitted markdown uses real heading levels, not bold text"],
    },
    voiceProfile: {
      principles: ["State the constraint, then the reason."],
      doWords: ["emit", "verify"],
      dontWords: ["simply", "just"],
      examples: [
        { context: "empty state — no designs yet", copy: "No designs yet. Describe an idea to start one." },
      ],
    },
    specCodeSync: {
      policy: "spec-first",
      specPath: "spec.json",
      regenerateCommand: "node engine/dist/cli.js spec.json --out .",
      triggers: ["any change to an emitted section"],
    },
    needs: [
      { id: "need-emit", title: "Emit a complete artifact set", pillarIds: ["pillar-determinism"] },
      { id: "need-orphan", title: "A need serving no pillar", pillarIds: [] },
    ],
    features: [
      { id: "feat-emit", title: "Artifact emitter", surface: "command", needIds: ["need-emit"] },
    ],
    tests: [
      { id: "test-emit", description: "Emitting twice produces identical bytes.", featureIds: ["feat-emit"], testFramework: "vitest" },
    ],
  });
}

// ───────────────────────────────────────────────────────────────────────
// Additive: nothing new is required
// ───────────────────────────────────────────────────────────────────────

test("the pre-existing fixture carries none of the new fields and still validates", () => {
  const raw = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  for (const field of [
    "pillars",
    "governingSentence",
    "acceptanceTest",
    "phaseAcceptance",
    "hardConstraints",
    "performanceBudget",
    "architecturalInvariants",
    "nfr",
    "specCodeSync",
    "readingContract",
  ]) {
    assert.equal(field in raw, false, `fixture predates ${field} — sanity check on the fixture itself`);
  }

  const parsed = SpecSchema.parse(raw);
  assert.equal(parsed.pillars, undefined);
  assert.equal(parsed.acceptanceTest, undefined);
  assert.equal(parsed.nfr, undefined);
  const docs = renderDocs(parsed);
  assert.doesNotMatch(docs["design.md"], /Reproducible design contract/);
  assert.doesNotMatch(docs["design-system.md"], /Behavior contract/);
  assert.doesNotMatch(renderBuilderHandoff(parsed, { docs, tasks: "", traceability: {} }), /Behavior, baseline, and decision contract/);
  // Field-level additions default rather than fail.
  assert.deepEqual(parsed.needs[0].pillarIds, []);
  assert.deepEqual(parsed.voiceProfile?.examples, []);
});

test("a spec declaring every new field validates and round-trips", () => {
  const spec = fullSpec();
  assert.equal(spec.pillars?.[0].rank, 1);
  assert.equal(spec.acceptanceTest?.timeBox, "within 5 minutes of first invocation, no documentation read");
  assert.equal(spec.architecturalInvariants?.[0].check, "! grep -rn 'node:fs' engine/src/render.ts");
  assert.equal(spec.nfr?.edgeCases.length, 2);
  assert.equal(spec.voiceProfile?.examples[0].copy, "No designs yet. Describe an idea to start one.");
  assert.equal(spec.specCodeSync?.policy, "spec-first");
});

// ───────────────────────────────────────────────────────────────────────
// Schema guards
// ───────────────────────────────────────────────────────────────────────

test("duplicate pillar ranks are rejected — a tie defeats the ranking", () => {
  assert.throws(
    () =>
      specOf({
        pillars: [
          { id: "pillar-a", rank: 1, statement: "A" },
          { id: "pillar-b", rank: 1, statement: "B" },
        ],
      }),
    /Duplicate pillar rank 1/,
  );
});

test("a need citing an unknown pillar is rejected — it would break the trace chain", () => {
  assert.throws(
    () =>
      specOf({
        pillars: [{ id: "pillar-a", rank: 1, statement: "A" }],
        needs: [{ id: "need-x", title: "X", pillarIds: ["pillar-does-not-exist"] }],
      }),
    /Unknown pillar reference/,
  );
});

test("an acceptance test without an observable or a time box is rejected", () => {
  assert.throws(() =>
    specOf({ acceptanceTest: { statement: "It works.", observable: "", timeBox: "soon" } }),
  );
  assert.throws(() =>
    specOf({ acceptanceTest: { statement: "It works.", observable: "the app opens", timeBox: "" } }),
  );
});

test("an architectural invariant without a check is rejected — a rule with no check is a wish", () => {
  assert.throws(() => specOf({ architecturalInvariants: [{ id: "inv-a", rule: "No cycles.", check: "" }] }));
});

// ───────────────────────────────────────────────────────────────────────
// 1 + 2. Pillars, governing sentence, prime directive lead requirements.md
// ───────────────────────────────────────────────────────────────────────

test("pillars, governing sentence, and prime directive render ABOVE the first requirement", () => {
  const docs = renderDocs(fullSpec());
  const req = docs["requirements.md"];

  assert.match(req, /^# Requirements — SelfResolvingApp\n\n> SelfResolvingApp is a spec emitter, not a code generator\./);
  assert.match(req, /## Pillars\n\n_Ranked non-negotiables\./);
  assert.match(req, /1\. \*\*pillar-determinism\*\* Same Spec in, same bytes out\./);
  assert.match(req, /2\. \*\*pillar-traceability\*\* Every requirement reaches a test\./);
  assert.match(req, /## Prime directive — acceptance test/);
  assert.match(req, /- \*\*Observable:\*\* Eight files appear/);
  assert.match(req, /- \*\*Time box:\*\* within 5 minutes/);
  assert.match(req, /\*\*Serves pillars:\*\* pillar-determinism/);

  // Ordering is the point: a reader resolves priority before reading needs.
  assert.ok(req.indexOf("## Pillars") < req.indexOf("## Needs"));
  assert.ok(req.indexOf("## Prime directive") < req.indexOf("## Needs"));
});

test("pillars sort by rank regardless of declaration order", () => {
  const spec = specOf({
    pillars: [
      { id: "pillar-third", rank: 3, statement: "Third." },
      { id: "pillar-first", rank: 1, statement: "First." },
    ],
  });
  const req = renderDocs(spec)["requirements.md"];
  assert.ok(req.indexOf("pillar-first") < req.indexOf("pillar-third"));
});

test("absent pillars, governing sentence, and acceptance test each force a TAG:UNRESOLVED prompt", () => {
  const req = renderDocs(specOf())["requirements.md"];
  assert.match(req, /> \*\*TAG:UNRESOLVED\*\* — no governing sentence declared/);
  assert.match(req, /\*\*TAG:UNRESOLVED\*\* — no pillars declared/);
  assert.match(req, /\*\*TAG:UNRESOLVED\*\* — no prime-directive acceptance test declared/);
});

// ───────────────────────────────────────────────────────────────────────
// 2. Prime directive in tasks.md + terminal gate
// ───────────────────────────────────────────────────────────────────────

test("tasks.md opens with the prime directive and closes with the terminal gate", () => {
  const md = tasksOf(fullSpec());
  assert.match(md, /## Prime directive\n\n\*\*acceptance-prime:\*\* A new user emits/);
  assert.match(md, /## Terminal gate — do not report done until every line passes/);
  assert.match(md, /- \[ \] \*\*Prime directive passes\.\*\* A new user emits .* observed as: .* inside: within 5 minutes/);
  // The gate follows the work; the directive precedes it.
  assert.ok(md.indexOf("## Prime directive") < md.indexOf("## Task 1"));
  assert.ok(md.indexOf("## Terminal gate") > md.indexOf("## Task 1"));
});

test("terminal gate marks an absent acceptance test, budget, and NFR as unresolved", () => {
  const md = tasksOf(specOf({ features: [{ id: "feat-a", title: "A", surface: "ui", needIds: [] }] }));
  const gate = md.split("## Terminal gate")[1] ?? "";
  assert.match(gate, /no prime-directive acceptance test to run/);
  assert.match(gate, /no performance budget declared/);
  assert.match(gate, /non-functional requirements are unanswered for: test strategy, edge cases, error handling, validation, security, accessibility/);
});

test("a fully answered spec produces a terminal gate carrying no forcing prompt", () => {
  const gate = (tasksOf(fullSpec()).split("## Terminal gate")[1] ?? "").split("## Spec ↔ code sync")[0]!;
  assert.match(gate, /\*\*Every non-functional requirement is satisfied\*\*/);
  assert.match(gate, /\*\*Performance budget met:\*\* full artifact-set emission < 2s p95/);
  assert.match(gate, /\*\*Every architectural invariant check exits 0\*\* \(1 check\(s\)/);
  // `**TAG:UNRESOLVED** —` is the forcing marker. The standing "no marker
  // remains" checklist line names the token in backticks and is expected.
  assert.doesNotMatch(gate, /\*\*TAG:UNRESOLVED\*\*/);
  assert.match(gate, /No `TAG:UNRESOLVED` or `TAG:ASSUMED` marker remains/);
});

test("the repo-native verification line dedupes identical commands", () => {
  // On Apple platforms typecheck and build are the same xcodebuild invocation.
  const gate = tasksOf(specOf({ platformTarget: "ios", features: [{ id: "f", title: "F", needIds: [] }] }))
    .split("## Terminal gate")[1] ?? "";
  const line = gate.split("\n").find((l) => l.includes("Repo-native verification")) ?? "";
  const occurrences = line.split("xcodebuild -scheme <Scheme> build").length - 1;
  assert.equal(occurrences, 1, `command listed more than once: ${line}`);
});

// ───────────────────────────────────────────────────────────────────────
// 3. Per-phase runnable acceptance
// ───────────────────────────────────────────────────────────────────────

test("phase acceptance derives a Phase | Scope | Acceptance table from the task layers", () => {
  const spec = specOf({
    platformTarget: "web",
    features: [{ id: "feat-a", title: "Alpha", surface: "ui", needIds: [] }],
    screens: [{ id: "screen-a", name: "Alpha", purpose: "Show alpha.", featureIds: ["feat-a"] }],
    tests: [{ id: "test-a", description: "Alpha renders.", featureIds: ["feat-a"], testFramework: "vitest" }],
  });
  const md = tasksOf(spec);

  assert.match(md, /## Phase acceptance/);
  assert.match(md, /\| Phase \| Scope \| Acceptance \(runnable\) \|/);
  // Walking skeleton first: end-to-end before breadth.
  assert.match(md, /\| 0 — Walking skeleton \|.*\| `npm run build` exits 0 and the slice runs end to end/);
  assert.match(md, /\| 1 — Scaffold & data layer \| Task 1 \| `npm run typecheck` exits 0/);
  assert.match(md, /\| \d+ — Features \|.*`npm run test` passes/);
  assert.match(md, /\| \d+ — UI screens \|.*`npm run build` exits 0 and every declared screen state/);
  assert.match(md, /\| \d+ — Test suite \|.*no skipped, pending, or `\.only` tests/);
  // Phase gates precede the work they gate.
  assert.ok(md.indexOf("## Phase acceptance") < md.indexOf("## Task 1"));
});

test("phase acceptance uses the platform's native commands", () => {
  const md = tasksOf(specOf({ platformTarget: "ios", features: [{ id: "f", title: "F", needIds: [] }] }));
  assert.match(md, /xcodebuild test -scheme <Scheme>/);
  assert.doesNotMatch(md.split("## Phase acceptance")[1]!.split("## Task 1")[0]!, /npm run/);
});

test("an authored phaseAcceptance list overrides the derived table verbatim", () => {
  const spec = specOf({
    features: [{ id: "feat-a", title: "Alpha", needIds: [] }],
    phaseAcceptance: [
      { phase: "Alpha", scope: "The first slice | with a pipe", acceptance: "make verify" },
    ],
  });
  const md = tasksOf(spec);
  // Pipes inside a cell are escaped, not column-splitting.
  assert.match(md, /\| Alpha \| The first slice \\\| with a pipe \| make verify \|/);
  assert.doesNotMatch(md, /Walking skeleton/);
});

// ───────────────────────────────────────────────────────────────────────
// 4 + 5. design.md — hard constraints, performance budget, invariants
// ───────────────────────────────────────────────────────────────────────

test("design.md renders hard constraints, the performance budget, and invariants with checks", () => {
  const design = renderDocs(fullSpec())["design.md"];
  assert.match(design, /## Hard constraints/);
  assert.match(design, /\*\*hc-no-network\*\* The emitter makes no network call\. _Because:_ It must run offline in CI\./);
  assert.match(design, /## Performance budget/);
  assert.match(design, /\*\*perf-emit\*\* full artifact-set emission → \*\*< 2s p95\*\* _Measured by:_ time node/);
  assert.match(design, /## Architectural invariants/);
  assert.match(design, /- Check: `! grep -rn 'node:fs' engine\/src\/render\.ts`/);
  // Rendered once more as a runnable block, not only as prose.
  assert.match(design, /```bash\n! grep -rn 'node:fs' engine\/src\/render\.ts\n```/);
});

test("absence discriminates: a missing budget forces, missing constraints and invariants do not", () => {
  const design = renderDocs(specOf())["design.md"];
  assert.match(design, /\*\*TAG:UNRESOLVED\*\* — no performance budget declared/);
  assert.match(design, /_None declared — no technology, hosting, dependency, or data-residency choice is foreclosed\._/);
  assert.match(design, /_None declared — no structural rule is being asserted beyond the ADRs above\._/);
});

test("invariant checks render as a runnable block in tasks.md, and are omitted when none exist", () => {
  const withInvariants = tasksOf(fullSpec());
  assert.match(withInvariants, /## Architectural invariants \(executable checks\)/);
  assert.match(withInvariants, /```bash\n! grep -rn 'node:fs' engine\/src\/render\.ts\n```/);
  assert.match(withInvariants, /A non-zero exit is a violated invariant — fix the code, do not relax the check\./);

  const without = tasksOf(specOf({ features: [{ id: "f", title: "F", needIds: [] }] }));
  assert.doesNotMatch(without, /Architectural invariants \(executable checks\)/);
});

// ───────────────────────────────────────────────────────────────────────
// 6. NFR forcing-field template
// ───────────────────────────────────────────────────────────────────────

test("the NFR template renders all six fields, forcing each empty one", () => {
  const req = renderDocs(specOf())["requirements.md"];
  const block = req.split("## Non-functional requirements")[1]!.split("## Success metrics")[0]!;
  for (const field of ["Test strategy", "Edge cases", "Error handling", "Validation", "Security", "Accessibility"]) {
    assert.match(
      block,
      new RegExp(`\\*\\*${field}:\\*\\* \\*\\*TAG:UNRESOLVED\\*\\*`),
      `${field} must render a forcing prompt when empty`,
    );
  }
});

test("an answered NFR field renders its content and drops the prompt", () => {
  const req = renderDocs(fullSpec())["requirements.md"];
  const block = req.split("## Non-functional requirements")[1]!.split("## Success metrics")[0]!;
  assert.match(block, /\*\*Test strategy:\*\* Unit for pure renderers/);
  assert.match(block, /- empty Spec/);
  assert.match(block, /- secret-shaped strings are scrubbed/);
  assert.doesNotMatch(block, /TAG:UNRESOLVED/);
});

test("a per-feature NFR override renders its own block and lands in that feature's definition of done", () => {
  const spec = specOf({
    features: [
      {
        id: "feat-upload",
        title: "Upload",
        surface: "ui",
        needIds: [],
        nfr: { edgeCases: ["zero-byte file"], security: ["reject executables"] },
      },
      { id: "feat-plain", title: "Plain", surface: "ui", needIds: [] },
    ],
  });

  const req = renderDocs(spec)["requirements.md"];
  assert.match(req, /### Feature overrides — Upload _\(feat-upload\)_/);
  assert.doesNotMatch(req, /Feature overrides — Plain/);

  const md = tasksOf(spec);
  const uploadTask = md.split("Implement feature: Upload")[1]!.split("## Task")[0]!;
  assert.match(uploadTask, /Edge case handled: zero-byte file/);
  assert.match(uploadTask, /Security: reject executables/);
  // The spec-level posture is NOT copied into every feature task.
  const plainTask = md.split("Implement feature: Plain")[1]!.split("## Task")[0]!;
  assert.doesNotMatch(plainTask, /Edge case handled/);
});

// ───────────────────────────────────────────────────────────────────────
// 7. voiceProfile example copy
// ───────────────────────────────────────────────────────────────────────

test("voice example copy renders verbatim in design-system.md", () => {
  const ui = renderDocs(fullSpec())["design-system.md"];
  assert.match(ui, /\*\*Example copy:\*\*/);
  assert.match(ui, /- _empty state — no designs yet:_ "No designs yet\. Describe an idea to start one\."/);
});

test("a voice profile with principles but no examples forces example copy", () => {
  const spec = specOf({ voiceProfile: { principles: ["Be direct."], doWords: [], dontWords: [] } });
  const ui = renderDocs(spec)["design-system.md"];
  assert.match(ui, /\*\*TAG:UNRESOLVED\*\* — no example copy strings declared/);
});

test("a spec with no voice profile at all stays quiet — nothing to force yet", () => {
  const ui = renderDocs(specOf())["design-system.md"];
  const voice = ui.split("## Voice & tone")[1]!.split("## Confirmed UI preferences")[0]!;
  assert.match(voice, /_None specified\._/);
  assert.doesNotMatch(voice, /TAG:UNRESOLVED/);
});

// ───────────────────────────────────────────────────────────────────────
// 8. spec ↔ code sync
// ───────────────────────────────────────────────────────────────────────

test("the sync rule is emitted in steering.md, tasks.md, and builder-handoff.md even when unauthored", () => {
  const spec = specOf();
  const docs = renderDocs(spec);
  const handoff = renderBuilderHandoff(spec, { docs, tasks: "", traceability: {} });

  for (const [label, body] of [
    ["steering.md", docs["steering.md"]],
    ["tasks.md", tasksOf(spec)],
    ["builder-handoff.md", handoff],
  ] as const) {
    assert.match(body, /## Spec ↔ code sync/, `${label} is missing the sync rule`);
    assert.match(body, /\*\*Policy:\*\* `spec-first`/, `${label} is missing the default policy`);
    assert.match(body, /A change is not done until the Spec reflects it\./, `${label} is missing the obligation`);
  }
});

test("an authored sync policy and regenerate command replace the defaults", () => {
  const md = tasksOf(fullSpec());
  assert.match(md, /```bash\nnode engine\/dist\/cli\.js spec\.json --out \.\n```/);
  assert.match(md, /- any change to an emitted section/);
});

test("a code-first policy inverts which artifact wins", () => {
  const spec = specOf({ specCodeSync: { policy: "code-first" } });
  const steering = renderDocs(spec)["steering.md"];
  assert.match(steering, /the running code wins: update `spec\.json` to match observed behavior/);
});

// ───────────────────────────────────────────────────────────────────────
// 10. conflict rule + reading contract (the config header)
// ───────────────────────────────────────────────────────────────────────

test("the conflict rule states both clauses and sits directly under the pillar list", () => {
  const docs = renderDocs(fullSpec());

  for (const [label, body] of [
    ["requirements.md", docs["requirements.md"]],
    ["steering.md", docs["steering.md"]],
  ] as const) {
    assert.match(body, /\*\*Resolving a conflict:\*\*/, `${label} is missing the conflict rule`);
    assert.match(
      body,
      /- When two pillars conflict, the lower-ranked one yields\./,
      `${label} is missing the rank clause`,
    );
    assert.match(
      body,
      /- When a system honours every pillar and still fails the prime-directive acceptance test, the test wins\./,
      `${label} is missing the acceptance-test clause — ranking alone cannot settle that case`,
    );
    // Placement: the rule is read WITH the ranked list in view, not from memory
    // of a line above it.
    assert.ok(
      body.indexOf("pillar-traceability") < body.indexOf("**Resolving a conflict:**"),
      `${label} prints the conflict rule above the pillars it resolves`,
    );
  }
});

test("the conflict rule renders even with no pillars declared — it governs the forcing prompt too", () => {
  const req = renderDocs(specOf())["requirements.md"];
  assert.match(req, /\*\*TAG:UNRESOLVED\*\* — no pillars declared/);
  assert.match(req, /\*\*Resolving a conflict:\*\*/);
});

test("the reading contract leads steering.md and repeats on both build-facing docs", () => {
  const spec = specOf();
  const docs = renderDocs(spec);
  const handoff = renderBuilderHandoff(spec, { docs, tasks: "", traceability: {} });

  // steering.md is the packet's front door: the header that governs how every
  // other file is read cannot sit below the files it governs.
  assert.match(
    docs["steering.md"],
    /^# Steering — SelfResolvingApp\n\n\*\*Read at:\*\* tier `frontier` · context `codegen`/,
  );

  for (const [label, body] of [
    ["steering.md", docs["steering.md"]],
    ["tasks.md", tasksOf(spec)],
    ["builder-handoff.md", handoff],
  ] as const) {
    assert.match(body, /\*\*Read at:\*\* tier `frontier` · context `codegen`/, `${label} is missing the config header`);
    assert.match(body, /\*\*No compression\.\*\*/, `${label} is missing the no-compression rule`);
    assert.match(
      body,
      /Every section in this set carries a testable constraint\./,
      `${label} is missing the reason compression is banned`,
    );
  }
});

test("an authored reading contract replaces the defaults and appends its standing instructions", () => {
  const spec = specOf({
    readingContract: {
      tier: "mid",
      context: "review",
      notes: ["Cite the section id when you disagree with a constraint."],
    },
  });
  const steering = renderDocs(spec)["steering.md"];
  assert.match(steering, /\*\*Read at:\*\* tier `mid` · context `review`/);
  assert.match(steering, /\*\*Standing instructions:\*\*\n- Cite the section id when you disagree with a constraint\./);
  // The no-compression rule is not authored away — it holds at every tier.
  assert.match(steering, /\*\*No compression\.\*\*/);
});

test("a spec with no reading contract still emits one — an unstated reading rule is an unfollowed one", () => {
  const spec = specOf();
  assert.equal(spec.readingContract, undefined);
  assert.match(renderDocs(spec)["steering.md"], /\*\*Read at:\*\* tier `frontier`/);
});

// ───────────────────────────────────────────────────────────────────────
// 9. traceability — pillar → requirement → design → task → acceptance
// ───────────────────────────────────────────────────────────────────────

function emit(spec: Spec): { dir: string; trace: Record<string, any> } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-self-resolving-"));
  const specPath = path.join(dir, "input-spec.json");
  fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));
  const result = spawnSync(process.execPath, [CLI_PATH, specPath, "--out", dir], { encoding: "utf8" });
  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
  const trace = JSON.parse(fs.readFileSync(path.join(dir, "traceability.json"), "utf8"));
  return { dir, trace };
}

test("traceability.json carries the full pillar → need → feature → task → acceptance chain", (t) => {
  if (!fs.existsSync(CLI_PATH)) return t.skip("engine bundle not built (npm run build:engine)");
  const { dir, trace } = emit(fullSpec());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  assert.deepEqual(trace.pillarToNeeds["pillar-determinism"], ["need-emit"]);
  assert.deepEqual(trace.pillarToFeatures["pillar-determinism"], ["feat-emit"]);
  assert.deepEqual(trace.pillarToInvariants["pillar-determinism"], ["inv-pure-render"]);
  assert.ok(
    trace.pillarToTasks["pillar-determinism"].includes("task-feature-feat-emit"),
    "pillar must reach the task that implements its feature",
  );
  // Acceptance = the tests reached through the chain, plus the prime directive
  // when it cites this pillar.
  assert.deepEqual(trace.pillarToAcceptance["pillar-determinism"].sort(), ["acceptance-prime", "test-emit"]);
});

test("a pillar that reaches no requirement, and a need serving no pillar, are reported as coverage gaps", (t) => {
  if (!fs.existsSync(CLI_PATH)) return t.skip("engine bundle not built (npm run build:engine)");
  const { dir, trace } = emit(fullSpec());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const gaps = trace.coverageGaps as Array<{ kind: string; id: string; missing: string }>;
  assert.ok(
    gaps.some((g) => g.kind === "pillar" && g.id === "pillar-traceability" && g.missing === "need"),
    "a pillar no requirement serves is an unverified priority",
  );
  assert.ok(
    gaps.some((g) => g.kind === "need" && g.id === "need-orphan" && g.missing === "pillar"),
    "a need serving no pillar is work nothing prioritizes",
  );
});

test("a spec without pillars reports no pillar gaps — the chain is opt-in", (t) => {
  if (!fs.existsSync(CLI_PATH)) return t.skip("engine bundle not built (npm run build:engine)");
  const spec = specOf({
    needs: [{ id: "need-a", title: "A" }],
    features: [{ id: "feat-a", title: "A", needIds: ["need-a"] }],
  });
  const { dir, trace } = emit(spec);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const gaps = trace.coverageGaps as Array<{ kind: string; missing: string }>;
  assert.equal(gaps.filter((g) => g.kind === "pillar" || g.missing === "pillar").length, 0);
  assert.deepEqual(trace.pillarToNeeds, {});
});

test("the legacy fixture still emits every artifact with the new sections present", (t) => {
  if (!fs.existsSync(CLI_PATH)) return t.skip("engine bundle not built (npm run build:engine)");
  const raw = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  const { dir } = emit(SpecSchema.parse(raw));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  for (const file of [
    "spec.json",
    "steering.md",
    "requirements.md",
    "design.md",
    "design-system.md",
    "tasks.md",
    "builder-handoff.md",
    "traceability.json",
  ]) {
    assert.ok(fs.existsSync(path.join(dir, file)), `${file} was not emitted`);
  }
  const tasks = fs.readFileSync(path.join(dir, "tasks.md"), "utf8");
  assert.match(tasks, /## Phase acceptance/);
  assert.match(tasks, /## Terminal gate/);
  assert.match(tasks, /## Spec ↔ code sync/);
});
