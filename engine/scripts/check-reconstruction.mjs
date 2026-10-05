#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temp = mkdtempSync(path.join(os.tmpdir(), "groundwork-reconstruction-check-"));
const packet = path.join(temp, "packet");
const implementation = path.join(temp, "independent-implementation");
const candidatePath = path.join(temp, "candidate.json");
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fixture = path.join(root, "engine/fixtures/sample-planner-reproducible-design-spec.json");
const validator = path.join(root, "engine/scripts/validate-reconstruction.mjs");

const independentlyAuthoredHtml = `<!doctype html><html><head><meta name="viewport" content="width=430,height=932"><style>
body{font-size:16px}.actions{display:grid;grid-template-columns:1fr 1.15fr;gap:12px}.save{min-height:48px;border-radius:14px;background:linear-gradient(135deg,#3F96F2,#2563EB)}
</style></head><body data-viewport-width="430" data-viewport-height="932" data-schedule-expanded="false" data-calendar-confirmation="true" data-save-prohibited="calendar/Event/create"><footer class="actions"><button id="add-calendar">Add to Calendar</button><button id="save-plan" class="save" aria-label="Save plan">Save plan</button></footer></body></html>`;

function extract(html) {
  const value = (pattern) => html.match(pattern)?.[1];
  const number = (pattern) => Number(value(pattern));
  return {
    "element-save.minimumTouchTarget": number(/\.save\{min-height:(\d+)px/),
    "element-save.borderRadius": number(/border-radius:(\d+)px/),
    "element-save.background.gradient.start": value(/linear-gradient\(135deg,(#[A-Fa-f0-9]{6})/),
    "element-save.background.gradient.end": value(/linear-gradient\(135deg,#[A-Fa-f0-9]{6},(#[A-Fa-f0-9]{6})/),
    "element-save.background.gradient.angle": number(/linear-gradient\((\d+)deg/),
    "screen-planner.actionBar.order": [...html.matchAll(/<button id="([^"]+)"/g)].map((match) => match[1] === "add-calendar" ? "action.calendar.beginExport" : "action.plan.save"),
    "screen-planner.schedule.defaultExpanded": value(/data-schedule-expanded="([^"]+)"/) === "true",
    "screen-planner.viewport.width": number(/data-viewport-width="(\d+)"/),
    "screen-planner.viewport.height": number(/data-viewport-height="(\d+)"/),
    "screen-planner.actionBar.gap": number(/\.actions\{[^}]*gap:(\d+)px/),
    "screen-planner.typography.body.fontSize": number(/body\{font-size:(\d+)px/),
    "element-save.accessibility.label": value(/id="save-plan"[^>]*aria-label="([^"]+)"/),
    "screen-planner.save.prohibitedWrites": [value(/data-save-prohibited="([^"]+)"/)],
    "screen-planner.calendar.write.requiresConfirmation": value(/data-calendar-confirmation="([^"]+)"/) === "true",
  };
}

try {
  execFileSync(process.execPath, [path.join(root, "engine/dist/cli.js"), fixture, "--out", packet], { stdio: "pipe" });
  const specBytes = readFileSync(path.join(packet, "spec.json"));
  const spec = JSON.parse(specBytes);
  mkdirSync(implementation);
  writeFileSync(path.join(implementation, "implementation.html"), independentlyAuthoredHtml);
  const extracted = extract(independentlyAuthoredHtml);
  const measurements = spec.designContract.constraints.filter((item) => item.kind === "exact").map((constraint) => ({
    constraintId: constraint.id, targetRef: constraint.targetRef, propertyPath: constraint.propertyPath,
    actualValue: extracted[`${constraint.targetRef}.${constraint.propertyPath}`], ...(constraint.unit ? { unit: constraint.unit } : {}),
    artifactId: "candidate-observations", evidenceLocator: `#/measurements/${constraint.id}`,
  }));
  const assertions = spec.designContract.verification.flatMap((verification) => verification.passCriteria.map((criterion) => ({
    verificationId: verification.id, targetRef: criterion.subjectRef, propertyPath: criterion.propertyPath,
    actualValue: extracted[`${criterion.subjectRef}.${criterion.propertyPath}`], artifactId: "candidate-observations",
    evidenceLocator: `#/assertions/${verification.id}/${criterion.propertyPath}`,
  }))).filter((item) => item.actualValue !== undefined);
  const observations = { measurements: measurements.map(({ constraintId, targetRef, propertyPath, actualValue }) => ({ constraintId, targetRef, propertyPath, actualValue })), assertions: assertions.map(({ verificationId, targetRef, propertyPath, actualValue }) => ({ verificationId, targetRef, propertyPath, actualValue })) };
  writeFileSync(path.join(implementation, "observations.json"), `${JSON.stringify(observations, null, 2)}\n`);
  const candidate = {
    schema: "groundwork.reconstruction-candidate/v1", contractDigest: digest(specBytes), root: implementation,
    artifacts: [
      { id: "candidate-implementation", path: "implementation.html", digest: digest(readFileSync(path.join(implementation, "implementation.html"))) },
      { id: "candidate-observations", path: "observations.json", digest: digest(readFileSync(path.join(implementation, "observations.json"))) },
    ], measurements, assertions,
    verificationResults: spec.designContract.verification.map((verification) => ({ verificationId: verification.id, status: "pass", evidence: [{ artifactId: "candidate-implementation", locator: `#${verification.id}` }] })),
  };
  writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`);
  const positive = spawnSync(process.execPath, [validator, "--packet-dir", packet, "--candidate", candidatePath, "--json"], { encoding: "utf8" });
  if (positive.status !== 0) throw new Error(`independent reconstruction failed:\n${positive.stdout}${positive.stderr}`);

  const alternateRoot = path.join(temp, "independent-dock-implementation");
  mkdirSync(alternateRoot);
  const alternateHtml = `<!doctype html><html><head><meta name="viewport" content="width=430,initial-scale=1"><style>
  :root{--start:#3F96F2;--end:#2563EB}body{font-size:16px}.dock-actions{display:grid;grid-template-columns:1fr 1.15fr;gap:12px}.primary{height:48px;border-radius:14px;background:linear-gradient(135deg,var(--start),var(--end))}
  </style></head><body><button id="schedule-toggle" aria-expanded="false">Schedule</button><footer><div class="dock-actions"><button id="add-calendar">Add to Calendar</button><button id="save-plan" class="primary" aria-label="Save plan">Save plan</button></div></footer><section id="export-dialog"><button id="export-confirm">Confirm export</button></section></body></html>`;
  writeFileSync(path.join(alternateRoot, "alternate.html"), alternateHtml);
  const alternate = structuredClone(candidate);
  alternate.root = alternateRoot;
  alternate.artifacts = [{ id: "candidate-implementation", path: "alternate.html", digest: digest(Buffer.from(alternateHtml)) }];
  alternate.measurements = alternate.measurements.map((measurement) => ({ ...measurement, artifactId: "candidate-implementation" }));
  alternate.assertions = alternate.assertions.map((assertion) => ({ ...assertion, artifactId: "candidate-implementation" }));
  writeFileSync(candidatePath, `${JSON.stringify(alternate)}\n`);
  const alternateResult = spawnSync(process.execPath, [validator, "--packet-dir", packet, "--candidate", candidatePath, "--json"], { encoding: "utf8" });
  if (alternateResult.status !== 0) throw new Error(`independent dock DOM reconstruction failed:\n${alternateResult.stdout}${alternateResult.stderr}`);

  const packetReuse = structuredClone(candidate);
  packetReuse.root = packet;
  packetReuse.artifacts = [{ id: "candidate-implementation", path: "baseline-artifacts.json", digest: digest(readFileSync(path.join(packet, "baseline-artifacts.json"))) }];
  writeFileSync(candidatePath, `${JSON.stringify(packetReuse)}\n`);
  const reuse = spawnSync(process.execPath, [validator, "--packet-dir", packet, "--candidate", candidatePath], { encoding: "utf8" });
  if (reuse.status === 0 || !reuse.stdout.includes("candidate-root-disjoint")) throw new Error("packet-root candidate reuse was accepted");

  const copiedRoot = path.join(temp, "copied-baseline-candidate");
  mkdirSync(copiedRoot);
  const baselineBundle = JSON.parse(readFileSync(path.join(packet, "baseline-artifacts.json"), "utf8"));
  const baselineHtml = baselineBundle.artifacts.find((item) => item.id === "artifact-html");
  writeFileSync(path.join(copiedRoot, "copied.html"), Buffer.from(baselineHtml.bytes, "base64"));
  const copiedCandidate = structuredClone(candidate);
  copiedCandidate.root = copiedRoot;
  copiedCandidate.artifacts = [{ id: "candidate-implementation", path: "copied.html", digest: baselineHtml.digest }];
  writeFileSync(candidatePath, `${JSON.stringify(copiedCandidate)}\n`);
  const copiedResult = spawnSync(process.execPath, [validator, "--packet-dir", packet, "--candidate", candidatePath], { encoding: "utf8" });
  if (copiedResult.status === 0 || !copiedResult.stdout.includes("reuses authoritative baseline bytes")) throw new Error("byte-identical baseline copy was accepted as a reconstruction");

  const coordinatedRoot = path.join(temp, "coordinated-echo-candidate");
  mkdirSync(coordinatedRoot);
  writeFileSync(path.join(coordinatedRoot, "implementation.html"), "<!doctype html><html><body>not a reconstruction</body></html>");
  const coordinated = structuredClone(candidate);
  coordinated.root = coordinatedRoot;
  coordinated.artifacts = [{ id: "candidate-implementation", path: "implementation.html", digest: digest(readFileSync(path.join(coordinatedRoot, "implementation.html"))) }];
  coordinated.measurements = spec.designContract.constraints.filter((item) => item.kind === "exact").map((constraint) => ({
    constraintId: constraint.id, targetRef: constraint.targetRef, propertyPath: constraint.propertyPath,
    actualValue: constraint.value, ...(constraint.unit ? { unit: constraint.unit } : {}),
    artifactId: "candidate-implementation", evidenceLocator: `claimed://${constraint.id}`,
  }));
  coordinated.assertions = spec.designContract.verification.flatMap((verification) => verification.passCriteria.map((criterion) => ({
    verificationId: verification.id, targetRef: criterion.subjectRef, propertyPath: criterion.propertyPath,
    actualValue: criterion.value, artifactId: "candidate-implementation", evidenceLocator: `claimed://${verification.id}`,
  })));
  writeFileSync(candidatePath, `${JSON.stringify(coordinated)}\n`);
  const coordinatedResult = spawnSync(process.execPath, [validator, "--packet-dir", packet, "--candidate", candidatePath], { encoding: "utf8" });
  if (coordinatedResult.status === 0 || !coordinatedResult.stdout.includes("required #save-plan/#add-calendar shared action container is missing")) throw new Error("coordinated candidate/observation echo bypass was accepted or lacked actionable browser diagnostics");

  const badSourceRoot = path.join(temp, "bad-source");
  cpSync(path.dirname(fixture), badSourceRoot, { recursive: true });
  const badLayout = path.join(badSourceRoot, spec.designContract.baseline.artifacts[0].path);
  writeFileSync(badLayout, Buffer.concat([readFileSync(badLayout), Buffer.from("tampered")]));
  const badOut = path.join(temp, "bad-packet");
  const priorSpec = readFileSync(path.join(packet, "spec.json"));
  const priorManifest = readFileSync(path.join(packet, "artifact-manifest.json"));
  const publication = spawnSync(process.execPath, [path.join(root, "engine/dist/cli.js"), path.join(badSourceRoot, path.basename(fixture)), "--out", badOut], { encoding: "utf8" });
  if (publication.status === 0 || existsSync(badOut) || !publication.stderr.includes("digest mismatch")) throw new Error("pre-publication hash failure left partial output");
  const preserve = spawnSync(process.execPath, [path.join(root, "engine/dist/cli.js"), path.join(badSourceRoot, path.basename(fixture)), "--out", packet], { encoding: "utf8" });
  if (preserve.status === 0 || !priorSpec.equals(readFileSync(path.join(packet, "spec.json"))) || !priorManifest.equals(readFileSync(path.join(packet, "artifact-manifest.json")))) throw new Error("failed publication changed an existing complete packet");
  rmSync(badLayout);
  const missingOut = path.join(temp, "missing-packet");
  const missingResult = spawnSync(process.execPath, [path.join(root, "engine/dist/cli.js"), path.join(badSourceRoot, path.basename(fixture)), "--out", missingOut], { encoding: "utf8" });
  if (missingResult.status === 0 || existsSync(missingOut) || !missingResult.stderr.includes("ENOENT")) throw new Error("missing baseline source left partial output");
  mkdirSync(badLayout);
  const nonRegularOut = path.join(temp, "non-regular-packet");
  const nonRegularResult = spawnSync(process.execPath, [path.join(root, "engine/dist/cli.js"), path.join(badSourceRoot, path.basename(fixture)), "--out", nonRegularOut], { encoding: "utf8" });
  if (nonRegularResult.status === 0 || existsSync(nonRegularOut) || !nonRegularResult.stderr.includes("not a safe regular file")) throw new Error("non-regular baseline source was accepted");

  const collision = JSON.parse(readFileSync(fixture, "utf8"));
  collision.designContract.baseline.artifacts[0].path = "spec.json";
  const collisionSpec = path.join(badSourceRoot, "collision.json");
  writeFileSync(collisionSpec, `${JSON.stringify(collision)}\n`);
  const collisionOut = path.join(temp, "collision-packet");
  const collisionResult = spawnSync(process.execPath, [path.join(root, "engine/dist/cli.js"), collisionSpec, "--out", collisionOut], { encoding: "utf8" });
  if (collisionResult.status === 0 || existsSync(collisionOut) || !collisionResult.stderr.includes("collides with managed packet artifact")) throw new Error("managed-name collision was accepted");

  const symlinkOut = path.join(temp, "symlink-packet");
  const outside = path.join(temp, "outside");
  mkdirSync(symlinkOut); mkdirSync(outside);
  writeFileSync(path.join(outside, "marker"), "unchanged");
  symlinkSync(outside, path.join(symlinkOut, "sample-planner-baseline-v4"), "dir");
  const symlinkResult = spawnSync(process.execPath, [path.join(root, "engine/dist/cli.js"), fixture, "--out", symlinkOut], { encoding: "utf8" });
  if (symlinkResult.status === 0 || readFileSync(path.join(outside, "marker"), "utf8") !== "unchanged" || !symlinkResult.stderr.includes("ancestor is a symlink")) throw new Error("ancestor symlink escape was not rejected");
  process.stdout.write(`independent reconstruction passed: 2 independent DOM shapes, ${measurements.length} validator-measured constraints, 9 adversarial cases\n`);
} finally { rmSync(temp, { recursive: true, force: true }); }
