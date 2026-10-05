#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const EVIDENCE_PATH = process.env.GROUNDWORK_RELEASE_EVIDENCE
  ? path.resolve(process.env.GROUNDWORK_RELEASE_EVIDENCE)
  : path.join(ROOT, ".build-loop", "release", "release-evidence.v2.json");
const LOCK_PATH = `${EVIDENCE_PATH}.lock`;
const STAGE_ROOT = process.env.GROUNDWORK_RELEASE_STAGE_ROOT
  ? path.resolve(process.env.GROUNDWORK_RELEASE_STAGE_ROOT)
  : path.join(ROOT, ".build-loop", "release", "staged");
const ACTIVATION_ROOT = process.env.GROUNDWORK_LIVE_ACTIVATION_ROOT
  ? path.resolve(process.env.GROUNDWORK_LIVE_ACTIVATION_ROOT)
  : path.join(ROOT, ".build-loop", "release", "live-activation");
const EVIDENCE_SCHEMA = "groundwork.release-evidence/v2";
const GATES = new Set(["deterministic", "host", "activation"]);
const STATUSES = new Set(["passed", "failed"]);

function sleep(milliseconds) {
  const view = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(view, 0, 0, milliseconds);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function safeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed = [
    "nodeVersion", "pythonVersion", "claudeVersion", "codexVersion",
    "buildLoopVersion", "buildLoopCommit", "buildLoopAdapterDigest", "platform",
  ];
  return Object.fromEntries(allowed.filter((key) => typeof value[key] === "string").map((key) => [key, value[key]]));
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function readOwnedRegularFile(file, ownedRoot, label = "Activation evidence") {
  const absolute = path.resolve(file);
  const lexicalRoot = path.resolve(ownedRoot);
  const lexicalRelative = path.relative(lexicalRoot, absolute);
  if (!lexicalRelative || lexicalRelative.startsWith("..") || path.isAbsolute(lexicalRelative)) {
    throw new Error(`${label} escapes its owned root: ${absolute}`);
  }
  let cursor = lexicalRoot;
  for (const component of lexicalRelative.split(path.sep)) {
    cursor = path.join(cursor, component);
    if (fs.lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`${label} must not traverse a symlink: ${cursor}`);
    }
  }
  const realOwnedRoot = fs.realpathSync(path.resolve(ownedRoot));
  const realFile = fs.realpathSync(absolute);
  const relative = path.relative(realOwnedRoot, realFile);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes its owned root: ${absolute}`);
  }
  if (fs.lstatSync(absolute).isSymbolicLink()) {
    throw new Error(`${label} must not be a symlink: ${absolute}`);
  }
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(realFile, flags);
  try {
    const metadata = fs.fstatSync(descriptor);
    if (!metadata.isFile()) throw new Error(`${label} is not a regular file: ${absolute}`);
    return fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

export function validateActivationReport(reportPath, manifest, { requireFresh = false } = {}) {
  if (!reportPath || typeof reportPath !== "string") {
    throw new Error("A passed activation gate requires --activation-report.");
  }
  const absoluteReport = path.resolve(reportPath);
  const reportBytes = readOwnedRegularFile(absoluteReport, ACTIVATION_ROOT);
  const report = JSON.parse(reportBytes.toString("utf8"));
  if (report.schema !== "groundwork.live-activation/v1") throw new Error("Activation report schema is invalid.");
  if (report.version !== manifest.version || report.artifactDigest !== manifest.artifactDigest) {
    throw new Error("Activation report is bound to different staged bytes.");
  }
  if (!/^[a-f0-9]{32,128}$/.test(report.challenge || "")) throw new Error("Activation report challenge is invalid.");
  const issuedAt = Date.parse(report.issuedAt || "");
  const expiresAt = Date.parse(report.expiresAt || "");
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)
    || expiresAt <= issuedAt || expiresAt - issuedAt > 15 * 60_000) {
    throw new Error("Activation report freshness window is invalid.");
  }
  if (requireFresh && (issuedAt > Date.now() + 30_000 || Date.now() > expiresAt)) {
    throw new Error("Activation report is expired or not yet valid.");
  }
  const expectedEntrypoints = { claude: "/groundwork:run", codex: "groundwork:groundwork" };
  const expectedSurfaceIds = {
    claude: "groundwork-claude-run-v1-7e4a9c2f",
    codex: "groundwork-codex-skill-v1-b91d6e30",
  };
  for (const hostName of ["claude", "codex"]) {
    const host = report.hosts?.[hostName];
    if (!host || host.authenticated !== true) throw new Error(`Activation report is missing authenticated ${hostName} proof.`);
    if (host.entrypoint !== expectedEntrypoints[hostName]) throw new Error(`Activation report has the wrong ${hostName} entrypoint.`);
    if (host.installedArtifactDigest !== manifest.artifactDigest) throw new Error(`${hostName} activation used different installed bytes.`);
    if (!Array.isArray(host.probeArgv) || host.probeExitCode !== 0
      || !/^[a-f0-9]{64}$/.test(host.probeOutputSha256 || "")) {
      throw new Error(`${hostName} activation lacks an orchestrator-owned host probe.`);
    }
    if (host.activationSurfaceId !== expectedSurfaceIds[hostName]) {
      throw new Error(`${hostName} activation lacks an installed entrypoint surface id.`);
    }
    const probeInvocation = host.probeArgv.join(" ");
    if (!probeInvocation.includes(host.entrypoint) || !probeInvocation.includes(report.challenge)) {
      throw new Error(`${hostName} host probe does not bind the public entrypoint and challenge.`);
    }
    if (probeInvocation.includes(host.activationSurfaceId)) {
      throw new Error(`${hostName} host probe request disclosed its expected surface id.`);
    }
    if (!/^[a-f0-9]{64}$/.test(host.transcriptSha256 || "")) throw new Error(`${hostName} transcript digest is invalid.`);
    const transcript = readOwnedRegularFile(host.transcriptPath, ACTIVATION_ROOT);
    if (sha256(transcript) !== host.transcriptSha256) throw new Error(`${hostName} transcript digest does not match.`);
    const transcriptText = transcript.toString("utf8");
    if (!transcriptText.includes(host.entrypoint) || !transcriptText.includes(report.challenge)) {
      throw new Error(`${hostName} transcript does not bind the public entrypoint and challenge.`);
    }
    if (!transcriptText.includes(`GROUNDWORK_SURFACE_ID ${host.activationSurfaceId}`)) {
      throw new Error(`${hostName} transcript does not prove the installed entrypoint surface.`);
    }
    if (!transcriptText.includes("GROUNDWORK_LAUNCH_CONTRACT ")
      || !transcriptText.includes('"--bootstrap"') || !transcriptText.includes(host.bootstrapPath)) {
      throw new Error(`${hostName} transcript does not contain the host-generated bootstrap launch contract.`);
    }
    if (!Array.isArray(host.launchArgv)) throw new Error(`${hostName} launchArgv must be an array.`);
    const bootstrapFlags = host.launchArgv.reduce((items, item, index) => item === "--bootstrap" ? [...items, index] : items, []);
    if (bootstrapFlags.length !== 1 || host.launchArgv[bootstrapFlags[0] + 1] !== host.bootstrapPath) {
      throw new Error(`${hostName} launch arguments do not bind exactly one bootstrap path.`);
    }
    const bootstrapBytes = readOwnedRegularFile(host.bootstrapPath, ACTIVATION_ROOT);
    if (sha256(bootstrapBytes) !== host.bootstrapSha256) throw new Error(`${hostName} bootstrap digest does not match.`);
    const bootstrap = JSON.parse(bootstrapBytes.toString("utf8"));
    if (!String(bootstrap.context?.requestedDelta || "").includes(report.challenge)) {
      throw new Error(`${hostName} bootstrap does not contain the activation challenge.`);
    }
    const outputPath = path.resolve(String(bootstrap.product?.outputPath || ""));
    const repoPath = path.resolve(String(bootstrap.product?.repoPath || ""));
    const realActivationRoot = fs.realpathSync(path.resolve(ACTIVATION_ROOT));
    for (const ownedPath of [outputPath, repoPath]) {
      let realOwnedPath;
      try { realOwnedPath = fs.realpathSync(ownedPath); } catch { realOwnedPath = null; }
      const relative = realOwnedPath ? path.relative(realActivationRoot, realOwnedPath) : "..";
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`${hostName} bootstrap retains a missing or unowned product path.`);
      }
    }
    const outFlags = host.launchArgv.reduce((items, item, index) => item === "--out" ? [...items, index] : items, []);
    if (outFlags.length !== 1 || path.resolve(host.launchArgv[outFlags[0] + 1]) !== outputPath) {
      throw new Error(`${hostName} launch arguments do not bind the bootstrap output path.`);
    }
    const baseline = host.baseline;
    if (baseline?.route !== "baseline" || baseline.productName !== "Spectra"
      || baseline.primaryPlatform !== "macos" || !Array.isArray(baseline.companionPlatforms)
      || !baseline.companionPlatforms.includes("web")) {
      throw new Error(`${hostName} activation did not preserve the Spectra macOS-primary/web-companion baseline.`);
    }
    const continuation = host.continuation;
    if (continuation?.route !== "next-unresolved" || !continuation.nextDecisionId
      || ["platform-target", "nav-structure"].includes(continuation.nextDecisionId)) {
      throw new Error(`${hostName} activation did not reach the next unresolved decision.`);
    }
  }
  return { report, reportSha256: sha256(reportBytes), reportPath: absoluteReport };
}

function validateManifest(manifest, manifestPath) {
  if (manifest?.schema !== "groundwork.release-manifest/v1") throw new Error("Unsupported or missing staged release manifest schema.");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version || "")) throw new Error("Staged manifest version is invalid.");
  if (!/^[a-f0-9]{64}$/.test(manifest.artifactDigest || "")) throw new Error("Staged manifest digest is invalid.");
  if (!Array.isArray(manifest.files) || manifest.files.length !== manifest.fileCount) throw new Error("Staged manifest file inventory is invalid.");
  const buildLoop = manifest.compatibility?.buildLoop;
  if (!buildLoop || !/^\d+\.\d+\.\d+$/.test(buildLoop.version || "")
    || !/^[a-f0-9]{40}$/.test(buildLoop.commit || "")
    || !/^[a-f0-9]{64}$/.test(buildLoop.adapterDigest || "")
    || !/^[a-f0-9]{64}$/.test(buildLoop.distributionTestDigest || "")) {
    throw new Error("Staged manifest has no valid pinned Build Loop compatibility record.");
  }
  const realStageRoot = fs.realpathSync(path.resolve(STAGE_ROOT));
  const absoluteManifest = fs.realpathSync(path.resolve(manifestPath));
  const artifactRoot = path.dirname(absoluteManifest);
  const relativeArtifact = path.relative(realStageRoot, artifactRoot);
  if (!relativeArtifact || relativeArtifact.startsWith("..") || path.isAbsolute(relativeArtifact)) {
    throw new Error("Staged manifest must be inside the owned release stage root.");
  }
  const declaredPaths = new Set();
  const actual = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(dir, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`Staged release contains a symlink: ${absolute}`);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && absolute !== absoluteManifest) {
        const data = readOwnedRegularFile(absolute, realStageRoot, "Staged release file");
        actual.push({ path: path.relative(artifactRoot, absolute).split(path.sep).join("/"), sha256: sha256(data), bytes: data.byteLength });
      }
    }
  };
  walk(artifactRoot);
  actual.sort((a, b) => a.path.localeCompare(b.path));
  const declared = manifest.files.map((item) => {
    if (!item || typeof item.path !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256 || "") || !Number.isSafeInteger(item.bytes) || item.bytes < 0) {
      throw new Error("Staged manifest contains an invalid file record.");
    }
    if (item.path.startsWith("/") || item.path.includes("..") || item.path.includes("\\") || declaredPaths.has(item.path)) {
      throw new Error(`Staged manifest contains an unsafe or duplicate path: ${item.path}`);
    }
    declaredPaths.add(item.path);
    return { path: item.path, sha256: item.sha256, bytes: item.bytes };
  }).sort((a, b) => a.path.localeCompare(b.path));
  if (JSON.stringify(actual) !== JSON.stringify(declared)) throw new Error("Staged release bytes no longer match the manifest inventory.");
  const computed = sha256(actual.map((item) => `${item.path}\0${item.sha256}\0${item.bytes}\n`).join(""));
  if (computed !== manifest.artifactDigest) throw new Error("Staged release bytes no longer match the manifest digest.");
  return manifest;
}

function acquireLock() {
  fs.mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
  const deadline = Date.now() + 5000;
  while (true) {
    try {
      fs.mkdirSync(LOCK_PATH, { mode: 0o700 });
      fs.writeFileSync(path.join(LOCK_PATH, "owner"), `${process.pid}\n`, { mode: 0o600 });
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const owner = Number.parseInt(fs.readFileSync(path.join(LOCK_PATH, "owner"), "utf8").trim(), 10);
        if (!Number.isSafeInteger(owner) || owner <= 0) throw new Error("invalid lock owner");
        try {
          process.kill(owner, 0);
        } catch (ownerError) {
          if (ownerError?.code === "ESRCH") {
            fs.rmSync(LOCK_PATH, { recursive: true, force: true });
            continue;
          }
          throw ownerError;
        }
      } catch (ownerReadError) {
        const age = Date.now() - fs.statSync(LOCK_PATH).mtimeMs;
        if (age > 30_000) {
          fs.rmSync(LOCK_PATH, { recursive: true, force: true });
          continue;
        }
      }
      if (Date.now() >= deadline) throw new Error("Timed out waiting for the release-evidence lock.");
      sleep(25);
    }
  }
}

function releaseLock() {
  fs.rmSync(LOCK_PATH, { recursive: true, force: true });
}

function writeAtomic(value) {
  const temporary = `${EVIDENCE_PATH}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, EVIDENCE_PATH);
}

export function recordGate({ gate, status, manifestPath, command, metadata = {}, activationReportPath, recordedAt = new Date().toISOString() }) {
  if (!GATES.has(gate)) throw new Error(`Unknown release gate: ${gate}`);
  if (!STATUSES.has(status)) throw new Error(`Unknown release gate status: ${status}`);
  if (!command || typeof command !== "string") throw new Error("Release gate command must be non-empty.");
  if (!Number.isFinite(Date.parse(recordedAt))) throw new Error("recordedAt must be an ISO timestamp.");
  const requestedManifestPath = path.resolve(manifestPath);
  const manifestBytes = readOwnedRegularFile(requestedManifestPath, STAGE_ROOT, "Staged manifest");
  const absoluteManifestPath = fs.realpathSync(requestedManifestPath);
  const manifest = validateManifest(JSON.parse(manifestBytes.toString("utf8")), absoluteManifestPath);
  const activation = gate === "activation" && status === "passed"
    ? validateActivationReport(activationReportPath, manifest, { requireFresh: true })
    : null;

  acquireLock();
  try {
    let evidence = {
      schema: EVIDENCE_SCHEMA,
      name: "groundwork",
      version: manifest.version,
      artifactDigest: manifest.artifactDigest,
      manifestPath: absoluteManifestPath,
      gates: {},
      consumedActivationChallenges: [],
      updatedAt: recordedAt,
    };
    if (fs.existsSync(EVIDENCE_PATH)) {
      const current = readJson(EVIDENCE_PATH);
      if (current.schema !== evidence.schema) throw new Error("Existing release evidence has an unsupported schema.");
      if (current.artifactDigest === manifest.artifactDigest && current.version === manifest.version) {
        evidence = { ...current, manifestPath: absoluteManifestPath, updatedAt: recordedAt };
      }
    }
    const consumedChallenges = Array.isArray(evidence.consumedActivationChallenges)
      ? evidence.consumedActivationChallenges
      : [];
    if (activation && consumedChallenges.includes(activation.report.challenge)) {
      throw new Error("Activation challenge has already been consumed.");
    }
    if (activation) evidence.consumedActivationChallenges = [...consumedChallenges, activation.report.challenge];
    const otherBefore = Object.fromEntries(
      [...GATES].filter((id) => id !== gate).map((id) => [id, JSON.stringify(evidence.gates?.[id] ?? null)])
    );
    evidence.gates = {
      ...(evidence.gates || {}),
      [gate]: {
        id: gate,
        status,
        command,
        recordedAt,
        version: manifest.version,
        artifactDigest: manifest.artifactDigest,
        metadata: safeMetadata(metadata),
        ...(activation ? {
          activationReportPath: activation.reportPath,
          activationReportSha256: activation.reportSha256,
          activationChallenge: activation.report.challenge,
        } : {}),
      },
    };
    for (const [otherGate, before] of Object.entries(otherBefore)) {
      if (JSON.stringify(evidence.gates?.[otherGate] ?? null) !== before) {
        throw new Error(`${gate} gate attempted to mutate ${otherGate} evidence.`);
      }
    }
    writeAtomic(evidence);
    return evidence;
  } finally {
    releaseLock();
  }
}

export function verifyEvidence({ evidencePath = EVIDENCE_PATH, requireBoth = true } = {}) {
  if (!fs.existsSync(evidencePath)) throw new Error(`Release evidence is missing: ${evidencePath}`);
  const evidence = readJson(evidencePath);
  if (evidence.schema !== EVIDENCE_SCHEMA) throw new Error("Unsupported release evidence schema.");
  const manifest = validateManifest(readJson(evidence.manifestPath), evidence.manifestPath);
  if (manifest.version !== evidence.version || manifest.artifactDigest !== evidence.artifactDigest) {
    throw new Error("Release evidence does not bind the current staged manifest.");
  }
  const required = requireBoth ? ["deterministic", "host", "activation"] : [];
  for (const gate of required) {
    const result = evidence.gates?.[gate];
    if (!result || result.status !== "passed") throw new Error(`Release is blocked: ${gate} gate is not passed.`);
    if (result.version !== evidence.version || result.artifactDigest !== evidence.artifactDigest) {
      throw new Error(`Release is blocked: ${gate} gate is bound to different staged bytes.`);
    }
  }
  const expectedBuildLoop = manifest.compatibility.buildLoop;
  const hostMetadata = evidence.gates?.host?.metadata || {};
  if (requireBoth && (
    hostMetadata.buildLoopVersion !== expectedBuildLoop.version
    || hostMetadata.buildLoopCommit !== expectedBuildLoop.commit
    || hostMetadata.buildLoopAdapterDigest !== expectedBuildLoop.adapterDigest
  )) {
    throw new Error("Release is blocked: host evidence is not bound to the staged Build Loop compatibility record.");
  }
  if (requireBoth) {
    const activation = evidence.gates.activation;
    const validated = validateActivationReport(activation.activationReportPath, manifest);
    if (validated.reportSha256 !== activation.activationReportSha256) {
      throw new Error("Release is blocked: activation report digest does not match recorded evidence.");
    }
  }
  return evidence;
}

function args(argv) {
  const result = { command: argv[0] };
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    result[key.slice(2)] = argv[++index];
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = args(process.argv.slice(2));
    if (options.command === "record") {
      const metadata = options.metadata ? JSON.parse(options.metadata) : {};
      const evidence = recordGate({
        gate: options.gate,
        status: options.status,
        manifestPath: options.manifest,
        command: options["gate-command"],
        metadata,
        activationReportPath: options["activation-report"],
      });
      process.stdout.write(`${JSON.stringify(evidence)}\n`);
    } else if (options.command === "verify") {
      const evidence = verifyEvidence();
      process.stdout.write(`${JSON.stringify({ eligible: true, version: evidence.version, artifactDigest: evidence.artifactDigest })}\n`);
    } else {
      throw new Error("Usage: release-evidence.mjs record --gate <deterministic|host|activation> --status <passed|failed> --manifest <path> --gate-command <command> [--metadata <json>] [--activation-report <path>] | verify");
    }
  } catch (error) {
    process.stderr.write(`release-evidence: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
