#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
const packetDir = value("--packet-dir");
const candidatePath = value("--candidate");
if (!packetDir || !candidatePath) throw new Error("Usage: validate-reconstruction.mjs --packet-dir <dir> --candidate <candidate.json> [--json]");

const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const row = (kind, status, detail = {}) => ({ kind, status, ...detail });
const isObject = (item) => item !== null && typeof item === "object" && !Array.isArray(item);

function schemaErrors(input, schema, rootSchema, locator = "$") {
  if (schema.$ref) {
    const resolved = schema.$ref.replace(/^#\//, "").split("/").reduce((current, segment) => current?.[segment], rootSchema);
    return resolved ? schemaErrors(input, resolved, rootSchema, locator) : [`${locator}: unresolved schema reference ${schema.$ref}`];
  }
  const errors = [];
  if (schema.const !== undefined && input !== schema.const) errors.push(`${locator}: expected constant ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(input)) errors.push(`${locator}: expected one of ${schema.enum.join(", ")}`);
  if (schema.type === "object" && !isObject(input)) return [...errors, `${locator}: expected object`];
  if (schema.type === "array" && !Array.isArray(input)) return [...errors, `${locator}: expected array`];
  if (schema.type === "string" && typeof input !== "string") return [...errors, `${locator}: expected string`];
  if (typeof input === "string") {
    if (schema.minLength !== undefined && input.length < schema.minLength) errors.push(`${locator}: shorter than ${schema.minLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(input)) errors.push(`${locator}: does not match ${schema.pattern}`);
  }
  if (Array.isArray(input)) {
    if (schema.minItems !== undefined && input.length < schema.minItems) errors.push(`${locator}: fewer than ${schema.minItems} items`);
    if (schema.items) input.forEach((item, index) => errors.push(...schemaErrors(item, schema.items, rootSchema, `${locator}[${index}]`)));
  }
  if (isObject(input)) {
    for (const required of schema.required ?? []) if (!Object.hasOwn(input, required)) errors.push(`${locator}.${required}: required property missing`);
    for (const [key, item] of Object.entries(input)) {
      if (schema.properties?.[key]) errors.push(...schemaErrors(item, schema.properties[key], rootSchema, `${locator}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${locator}.${key}: additional property not allowed`);
    }
  }
  return errors;
}

function safeRegularFile(root, relative, label) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative)) return { error: `${label} path must be relative` };
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) return { error: `${label} path escapes root` };
  if (!existsSync(resolved)) return { error: `${label} is missing` };
  if (!lstatSync(resolved).isFile()) return { error: `${label} is not a regular file` };
  const realRoot = realpathSync(resolvedRoot);
  const real = realpathSync(resolved);
  if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) return { error: `${label} resolves outside root` };
  return { path: resolved };
}

function compare(actual, constraint) {
  const tolerance = constraint.tolerance ?? 0;
  const expected = constraint.value;
  switch (constraint.operator) {
    case "eq": return typeof actual === "number" && typeof expected === "number" ? Math.abs(actual - expected) <= tolerance : JSON.stringify(actual) === JSON.stringify(expected);
    case "neq": return JSON.stringify(actual) !== JSON.stringify(expected);
    case "in": return Array.isArray(expected) && expected.includes(actual);
    case "not-in": return Array.isArray(expected) && !expected.includes(actual);
    case "gte": return typeof actual === "number" && typeof expected === "number" && actual + tolerance >= expected;
    case "lte": return typeof actual === "number" && typeof expected === "number" && actual - tolerance <= expected;
    case "contains": return (typeof actual === "string" && actual.includes(String(expected))) || (Array.isArray(actual) && actual.includes(expected));
    case "excludes": return (typeof actual === "string" && !actual.includes(String(expected))) || (Array.isArray(actual) && !actual.includes(expected));
    case "exists": return actual !== null && actual !== undefined;
    case "not-exists": return actual === null || actual === undefined;
    default: return false;
  }
}

function chromeExecutable() {
  return [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean).find((candidate) => existsSync(candidate));
}

async function reservePort() {
  const { createServer } = await import("node:net");
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function terminate(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(750)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const diagnostics = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) {
      if (["Runtime.exceptionThrown", "Runtime.consoleAPICalled", "Log.entryAdded"].includes(message.method)) diagnostics.push(message.params);
      return;
    }
    const callbacks = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) callbacks.reject(new Error(message.error.message));
    else callbacks.resolve(message.result);
  });
  return {
    send(method, params = {}) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    diagnostics,
    close() { socket.close(); },
  };
}

function runtimeExceptionDetail(response, expressionLabel, diagnostics) {
  const details = response.exceptionDetails;
  if (!details) return null;
  const description = details.exception?.description ?? details.exception?.value ?? details.text ?? "unknown browser exception";
  const frames = details.stackTrace?.callFrames?.map((frame) => `${frame.functionName || "<anonymous>"}@${frame.url || expressionLabel}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`).join(" <- ");
  const browserEvents = diagnostics.slice(-5).map((event) => event.exceptionDetails?.exception?.description ?? event.entry?.text ?? event.args?.map((arg) => arg.value ?? arg.description).filter(Boolean).join(" ")).filter(Boolean);
  return [`${expressionLabel}: ${description}`, frames ? `stack=${frames}` : null, browserEvents.length ? `browser=${browserEvents.join(" | ")}` : null].filter(Boolean).join("; ");
}

async function measureHtml(htmlPath) {
  const chrome = chromeExecutable();
  if (!chrome) throw new Error("Chrome or Chromium is required for validator-owned HTML measurement");
  const profile = mkdtempSync(path.join(os.tmpdir(), "groundwork-reconstruction-validator-"));
  const debugPort = await reservePort();
  const browser = spawn(chrome, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore" });
  let cdp;
  try {
    let target;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
        target = targets.find((item) => item.type === "page");
        if (target?.webSocketDebuggerUrl) break;
      } catch { /* browser is starting */ }
      await delay(50);
    }
    if (!target?.webSocketDebuggerUrl) throw new Error("validator browser did not expose a CDP page");
    cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 430, height: 932, deviceScaleFactor: 1, mobile: true });
    const targetUrl = pathToFileURL(htmlPath).href;
    await cdp.send("Page.navigate", { url: targetUrl });
    let navigationReady = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const ready = await cdp.send("Runtime.evaluate", {
        expression: "({ href: window.location.href, readyState: document.readyState })",
        returnByValue: true,
      });
      const value = ready.result.value;
      if (value?.href === targetUrl && value?.readyState === "complete") {
        navigationReady = true;
        break;
      }
      await delay(25);
    }
    if (!navigationReady) throw new Error(`validator browser did not finish navigating to ${targetUrl}`);
    const expressionLabel = "groundwork-validator-measure-v1";
    const measured = await cdp.send("Runtime.evaluate", { expression: `(() => {
      const save = document.querySelector('#save-plan');
      const calendar = document.querySelector('#add-calendar');
      const actions = document.querySelector('.actions') || (save && calendar && save.parentElement === calendar.parentElement ? save.parentElement : null);
      if (!save || !calendar || !actions) throw new Error('required #save-plan/#add-calendar shared action container is missing');
      const saveStyle = getComputedStyle(save);
      const actionStyle = getComputedStyle(actions);
      const bodyStyle = getComputedStyle(document.body);
      const rgbToHex = (text) => {
        const parts = text.match(/rgba?\\(\\s*(\\d+)[,\\s]+(\\d+)[,\\s]+(\\d+)/);
        return parts ? '#' + parts.slice(1).map((part) => Number(part).toString(16).padStart(2, '0')).join('').toUpperCase() : null;
      };
      const gradient = saveStyle.backgroundImage;
      const colors = [...gradient.matchAll(/rgb\\([^)]*\\)/g)].map((match) => rgbToHex(match[0]));
      const angle = Number(gradient.match(/linear-gradient\\(([-\\d.]+)deg/)?.[1]);
      const actionName = (id) => id === 'add-calendar' ? 'action.calendar.beginExport' : id === 'save-plan' ? 'action.plan.save' : id;
      return {
        'element-save.minimumTouchTarget': save.getBoundingClientRect().height,
        'element-save.borderRadius': Number.parseFloat(saveStyle.borderRadius),
        'element-save.background.gradient.start': colors[0],
        'element-save.background.gradient.end': colors[1],
        'element-save.background.gradient.angle': angle,
        'screen-planner.actionBar.order': [...actions.querySelectorAll('button')].map((button) => actionName(button.id)),
        'screen-planner.schedule.defaultExpanded': document.body.dataset.scheduleExpanded !== undefined
          ? document.body.dataset.scheduleExpanded === 'true'
          : document.querySelector('#schedule-toggle')?.getAttribute('aria-expanded') === 'true',
        'screen-planner.viewport.width': window.innerWidth,
        'screen-planner.viewport.height': window.innerHeight,
        'screen-planner.actionBar.gap': Number.parseFloat(actionStyle.columnGap),
        'screen-planner.typography.body.fontSize': Number.parseFloat(bodyStyle.fontSize),
        'element-save.accessibility.label': save.getAttribute('aria-label'),
        'screen-planner.save.prohibitedWrites': document.body.dataset.saveProhibited
          ? [document.body.dataset.saveProhibited]
          : (document.querySelector('#export-dialog') && document.querySelector('#export-confirm') ? ['calendar/Event/create'] : []),
        'screen-planner.calendar.write.requiresConfirmation': document.body.dataset.calendarConfirmation !== undefined
          ? document.body.dataset.calendarConfirmation === 'true'
          : Boolean(document.querySelector('#export-dialog') && document.querySelector('#export-confirm')),
      };
    })()`, returnByValue: true, awaitPromise: true });
    const exception = runtimeExceptionDetail(measured, expressionLabel, cdp.diagnostics);
    if (exception) throw new Error(exception);
    return measured.result.value;
  } finally {
    if (cdp) {
      try { await cdp.send("Browser.close"); } catch { /* terminate below */ }
      cdp.close();
    }
    await terminate(browser);
    rmSync(profile, { recursive: true, force: true });
  }
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const candidateSchema = JSON.parse(readFileSync(path.resolve(scriptDir, "../fixtures/reconstruction-candidate.schema.json"), "utf8"));
const candidate = JSON.parse(readFileSync(candidatePath, "utf8"));
const schemaIssues = schemaErrors(candidate, candidateSchema, candidateSchema);
const sourceIntegrity = [];
const reconstructionChecks = [row("candidate-schema", schemaIssues.length ? "fail" : "pass", { errors: schemaIssues })];

const packetRoot = path.resolve(packetDir);
const specFile = safeRegularFile(packetRoot, "spec.json", "spec.json");
const manifestFile = safeRegularFile(packetRoot, "artifact-manifest.json", "artifact-manifest.json");
let spec;
if (specFile.path) {
  const bytes = readFileSync(specFile.path);
  const expected = digest(bytes);
  spec = JSON.parse(bytes.toString("utf8"));
  sourceIntegrity.push(row("contract-digest", candidate.contractDigest === expected ? "pass" : "fail", { expected, actual: candidate.contractDigest ?? null }));
} else sourceIntegrity.push(row("contract-digest", "fail", { reason: specFile.error }));

if (manifestFile.path) {
  const manifest = JSON.parse(readFileSync(manifestFile.path, "utf8"));
  const validManifest = manifest.schema === "groundwork.artifacts/v1" && Array.isArray(manifest.files) && manifest.files.length > 0;
  sourceIntegrity.push(row("packet-manifest-schema", validManifest ? "pass" : "fail"));
  const names = new Set();
  for (const item of manifest.files ?? []) {
    const source = safeRegularFile(packetRoot, item.name, `manifest artifact ${item.name ?? "<missing>"}`);
    const unique = typeof item.name === "string" && !names.has(item.name);
    if (typeof item.name === "string") names.add(item.name);
    const actual = source.path ? createHash("sha256").update(readFileSync(source.path)).digest("hex") : null;
    const pass = unique && /^[a-f0-9]{64}$/.test(item.sha256 ?? "") && actual === item.sha256;
    sourceIntegrity.push(row("packet-artifact", pass ? "pass" : "fail", { id: item.name ?? null, expected: item.sha256 ?? null, actual, reason: source.error ?? (!unique ? "duplicate manifest name" : undefined) }));
  }
} else sourceIntegrity.push(row("packet-manifest-schema", "fail", { reason: manifestFile.error }));

const bundleFile = safeRegularFile(packetRoot, "baseline-artifacts.json", "baseline-artifacts.json");
const authoritativeDigests = new Set();
if (bundleFile.path) {
  const bundle = JSON.parse(readFileSync(bundleFile.path, "utf8"));
  const bundleById = new Map((bundle.artifacts ?? []).map((item) => [item.id, item]));
  for (const artifact of spec?.designContract?.baseline?.artifacts ?? []) {
    const bundled = bundleById.get(artifact.id);
    let actual = null;
    try { actual = bundled?.encoding === "base64" ? digest(Buffer.from(bundled.bytes, "base64")) : null; } catch { actual = null; }
    authoritativeDigests.add(artifact.digest);
    const pass = bundle.schema === "groundwork.baseline-artifacts/v1" && bundled?.path === artifact.path && bundled?.type === artifact.type && bundled?.digest === artifact.digest && actual === artifact.digest;
    sourceIntegrity.push(row("baseline-artifact", pass ? "pass" : "fail", { id: artifact.id, path: artifact.path, expected: artifact.digest, actual }));
  }
} else sourceIntegrity.push(row("baseline-artifact-bundle", "fail", { reason: bundleFile.error }));

const candidateRoot = typeof candidate.root === "string" ? path.resolve(candidate.root) : "";
const candidateDisjoint = Boolean(candidateRoot) && candidateRoot !== packetRoot && !candidateRoot.startsWith(`${packetRoot}${path.sep}`) && !packetRoot.startsWith(`${candidateRoot}${path.sep}`);
reconstructionChecks.push(row("candidate-root-disjoint", candidateDisjoint ? "pass" : "fail", { candidateRoot, packetRoot }));
const artifactIds = new Set();
const candidateArtifactFiles = new Map();
for (const artifact of Array.isArray(candidate.artifacts) ? candidate.artifacts : []) {
  const source = candidateRoot ? safeRegularFile(candidateRoot, artifact.path, `candidate artifact ${artifact.id ?? "<missing>"}`) : { error: "candidate root is invalid" };
  const unique = typeof artifact.id === "string" && !artifactIds.has(artifact.id);
  if (typeof artifact.id === "string") artifactIds.add(artifact.id);
  const actual = source.path ? digest(readFileSync(source.path)) : null;
  const distinct = actual !== null && !authoritativeDigests.has(actual);
  if (source.path && typeof artifact.id === "string") candidateArtifactFiles.set(artifact.id, source.path);
  reconstructionChecks.push(row("candidate-artifact", unique && actual === artifact.digest && distinct ? "pass" : "fail", { id: artifact.id ?? null, expected: artifact.digest ?? null, actual, reason: source.error ?? (!unique ? "duplicate artifact id" : (!distinct ? "candidate artifact reuses authoritative baseline bytes" : undefined)) }));
}
let observations = { measurements: [], assertions: [] };
const observationsFile = candidateArtifactFiles.get("candidate-observations");
try { if (observationsFile) observations = JSON.parse(readFileSync(observationsFile, "utf8")); } catch { /* reported through bindings */ }
const implementationFile = candidateArtifactFiles.get("candidate-implementation");
let validatorMeasurements = null;
let validatorMeasurementError = null;
try {
  if (!implementationFile || path.extname(implementationFile).toLowerCase() !== ".html") {
    throw new Error("candidate-implementation must be an HTML artifact; claimed verification is not accepted without a deterministic verifier");
  }
  validatorMeasurements = await measureHtml(implementationFile);
} catch (error) { validatorMeasurementError = error instanceof Error ? error.message : String(error); }
reconstructionChecks.push(row("validator-owned-measurement", validatorMeasurements ? "pass" : "fail", { artifactId: "candidate-implementation", reason: validatorMeasurementError }));

const constraints = spec?.designContract?.constraints ?? [];
const exactConstraints = constraints.filter((item) => item.kind === "exact");
const architecturalConstraints = constraints.filter((item) => item.kind === "architectural");
reconstructionChecks.push(row("exact-constraint-coverage", exactConstraints.length ? "pass" : "fail", { count: exactConstraints.length }));
reconstructionChecks.push(row("architectural-constraint-coverage", architecturalConstraints.length ? "pass" : "fail", { count: architecturalConstraints.length }));

const exactIds = new Set(exactConstraints.map((item) => item.id));
const measurements = new Map();
for (const measurement of Array.isArray(candidate.measurements) ? candidate.measurements : []) {
  if (!exactIds.has(measurement.constraintId)) reconstructionChecks.push(row("exact-measurement", "fail", { constraintId: measurement.constraintId ?? null, reason: "unknown exact constraint" }));
  else if (measurements.has(measurement.constraintId)) reconstructionChecks.push(row("exact-measurement", "fail", { constraintId: measurement.constraintId, reason: "duplicate measurement" }));
  else measurements.set(measurement.constraintId, measurement);
}
for (const constraint of exactConstraints) {
  const measurement = measurements.get(constraint.id);
  const metadataMatches = Boolean(measurement)
    && measurement.targetRef === constraint.targetRef
    && measurement.propertyPath === constraint.propertyPath
    && (constraint.unit === undefined ? measurement.unit === undefined : measurement.unit === constraint.unit)
    && artifactIds.has(measurement.artifactId);
  const measurementKey = `${constraint.targetRef}.${constraint.propertyPath}`;
  const actual = validatorMeasurements?.[measurementKey];
  const evidence = `validator://candidate-implementation#${measurementKey}`;
  const pass = metadataMatches && actual !== undefined && compare(actual, constraint);
  reconstructionChecks.push(row("exact-measurement", pass ? "pass" : "fail", { constraintId: constraint.id, operator: constraint.operator, expected: constraint.value, actual: actual ?? null, claimedActual: measurement?.actualValue ?? null, tolerance: constraint.tolerance ?? 0, unit: constraint.unit ?? null, evidence, reason: !measurement ? "missing measurement metadata" : (!metadataMatches ? "measurement metadata mismatch" : (actual === undefined ? "validator could not measure property" : undefined)) }));
}

const verificationContracts = spec?.designContract?.verification ?? [];
const verificationIds = new Set(verificationContracts.map((item) => item.id));
const resultsById = new Map();
const assertions = Array.isArray(candidate.assertions) ? candidate.assertions : [];
for (const assertion of assertions) {
  const valid = verificationIds.has(assertion.verificationId) && artifactIds.has(assertion.artifactId);
  if (!valid) reconstructionChecks.push(row("verification-assertion", "fail", { verificationId: assertion.verificationId ?? null, reason: "assertion has an unknown verification or artifact" }));
}
for (const verification of Array.isArray(candidate.verificationResults) ? candidate.verificationResults : []) {
  if (!verificationIds.has(verification.verificationId)) reconstructionChecks.push(row("verification-result", "fail", { verificationId: verification.verificationId ?? null, reason: "unknown verification id" }));
  else if (resultsById.has(verification.verificationId)) reconstructionChecks.push(row("verification-result", "fail", { verificationId: verification.verificationId, reason: "duplicate verification result" }));
  else resultsById.set(verification.verificationId, verification);
}
for (const verification of verificationContracts) {
  const declared = resultsById.get(verification.id);
  const evidenceValid = declared?.evidence?.length && declared.evidence.every((item) => artifactIds.has(item.artifactId) && typeof item.locator === "string" && item.locator.length > 0);
  const criteriaMeasured = verification.passCriteria.every((criterion) => {
    const measurementKey = `${criterion.subjectRef}.${criterion.propertyPath}`;
    return validatorMeasurements?.[measurementKey] !== undefined && compare(validatorMeasurements[measurementKey], criterion);
  });
  const pass = declared?.status === "pass" && evidenceValid && criteriaMeasured;
  reconstructionChecks.push(row("verification-result", pass ? "pass" : "fail", { verificationId: verification.id, method: verification.method, evidence: verification.passCriteria.map((criterion) => `validator://candidate-implementation#${criterion.subjectRef}.${criterion.propertyPath}`), reason: !declared ? "missing verification result" : (declared.status !== "pass" ? "verification failed" : (!evidenceValid ? "verification evidence does not reference a candidate artifact" : (!criteriaMeasured ? "pass criteria are not satisfied by validator-owned measurements" : undefined))) }));
}

const result = { pass: [...sourceIntegrity, ...reconstructionChecks].every((item) => item.status === "pass"), sourceIntegrity, reconstructionChecks };
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.pass ? 0 : 1;
