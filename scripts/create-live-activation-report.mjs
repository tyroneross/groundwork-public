#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { validateActivationReport } from "./release-evidence.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACTIVATION_ROOT = process.env.GROUNDWORK_LIVE_ACTIVATION_ROOT
  ? path.resolve(process.env.GROUNDWORK_LIVE_ACTIVATION_ROOT)
  : path.join(ROOT, ".build-loop", "release", "live-activation");
const CLAUDE_BIN = process.env.GROUNDWORK_CLAUDE_BIN || "claude";
const CODEX_BIN = process.env.GROUNDWORK_CODEX_BIN || "codex";
const NODE_BIN = process.env.GROUNDWORK_NODE_BIN || process.execPath;
const EXCLUDED_CANDIDATES = ["nav-tabbar", "sheet-size", "micro-haptics", "pull-refresh"];

function activationRequest(challenge, fixture, contractPath) {
  return `GROUNDWORK_ACTIVATION_PROBE ${challenge}; TARGET ${fixture}; PRODUCT Spectra; CONTRACT ${contractPath}; understand the existing Spectra app and continue its adaptive visual design.`;
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function sameExistingPath(left, right) {
  try { return fs.realpathSync(path.resolve(left)) === fs.realpathSync(path.resolve(right)); } catch { return false; }
}

function readRegular(file) {
  const absolute = path.resolve(file);
  const descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const metadata = fs.fstatSync(descriptor);
    if (!metadata.isFile()) throw new Error(`Expected a regular file: ${absolute}`);
    return fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function writeAtomic(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, bytes, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function inventory(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(dir, entry.name);
      const metadata = fs.lstatSync(absolute);
      if (metadata.isSymbolicLink()) throw new Error(`Installed plugin contains a symlink: ${absolute}`);
      if (metadata.isDirectory()) walk(absolute);
      else if (metadata.isFile()) {
        const relative = path.relative(root, absolute).split(path.sep).join("/");
        if (relative === "release-manifest.json") continue;
        const bytes = readRegular(absolute);
        files.push({ path: relative, sha256: sha256(bytes), bytes: bytes.byteLength });
      }
    }
  };
  walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function digestInventory(files) {
  return sha256(files.map((item) => `${item.path}\0${item.sha256}\0${item.bytes}\n`).join(""));
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--") || index + 1 >= argv.length) throw new Error(`Unexpected argument: ${key}`);
    options[key.slice(2)] = argv[++index];
  }
  return options;
}

function validateManifestIdentity(manifest) {
  if (manifest?.schema !== "groundwork.release-manifest/v1"
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version || "")
    || !/^[a-f0-9]{64}$/.test(manifest.artifactDigest || "")
    || !Array.isArray(manifest.files) || manifest.files.length !== manifest.fileCount) {
    throw new Error("Release manifest identity is invalid.");
  }
}

function runSync(bin, args, options = {}) {
  const result = spawnSync(bin, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 180_000,
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function requireAuthentication() {
  const claude = runSync(CLAUDE_BIN, ["auth", "status"]);
  let claudeStatus;
  try { claudeStatus = JSON.parse(claude.stdout); } catch { claudeStatus = null; }
  if (claude.status !== 0 || claudeStatus?.loggedIn !== true) throw new Error("Claude is not authenticated.");
  const codex = runSync(CODEX_BIN, ["login", "status"]);
  if (codex.status !== 0 || !/logged in/i.test(`${codex.stdout}\n${codex.stderr}`)) {
    throw new Error("Codex is not authenticated.");
  }
}

function resolveInstalledRoots(version) {
  let claudeRoot = process.env.GROUNDWORK_CLAUDE_PLUGIN_ROOT;
  if (!claudeRoot) {
    const listed = runSync(CLAUDE_BIN, ["plugin", "list", "--json"]);
    if (listed.status !== 0) throw new Error("Could not read the Claude plugin registry.");
    const plugins = JSON.parse(listed.stdout);
    claudeRoot = plugins.find((item) => item.id === "groundwork@groundwork" && item.enabled)?.installPath;
  }
  let codexRoot = process.env.GROUNDWORK_CODEX_PLUGIN_ROOT;
  if (!codexRoot) {
    const listed = runSync(CODEX_BIN, ["plugin", "list", "--json"]);
    if (listed.status !== 0) throw new Error("Could not read the Codex plugin registry.");
    const registry = JSON.parse(listed.stdout);
    const plugin = registry.installed?.find((item) => item.pluginId === "groundwork@groundwork"
      && item.installed === true && item.enabled === true && item.version === version);
    if (!plugin) throw new Error(`Codex registry has no enabled Groundwork ${version} installation.`);
    codexRoot = path.join(
      process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
      "plugins", "cache", "groundwork", "groundwork", version,
    );
  }
  if (!claudeRoot) throw new Error(`Claude registry has no enabled Groundwork ${version} installation.`);
  const roots = { claude: fs.realpathSync(claudeRoot), codex: fs.realpathSync(codexRoot) };
  return roots;
}

function verifyInstalledRoots(roots, manifest) {
  for (const [host, root] of Object.entries(roots)) {
    if (digestInventory(inventory(root)) !== manifest.artifactDigest) {
      throw new Error(`${host} installed bytes differ from the staged artifact.`);
    }
  }
}

function runHostProbe(host, challenge, installedRoot, fixture) {
  const entrypoint = host === "claude" ? "/groundwork:run" : "groundwork:groundwork";
  const entryFile = path.join(installedRoot, host === "claude" ? "commands/run.md" : "skills/groundwork/SKILL.md");
  const surfaceMatch = readRegular(entryFile).toString("utf8").match(/activation_surface_id:\s*([a-z0-9-]+)/);
  if (!surfaceMatch) throw new Error(`${host} installed entrypoint has no activation surface id.`);
  const surfaceId = surfaceMatch[1];
  const marker = `GROUNDWORK_ACTIVATION_READY ${challenge}`;
  const contractPath = path.join(fixture, ".groundwork-activation-contract.json");
  fs.rmSync(contractPath, { force: true });
  const request = activationRequest(challenge, fixture, contractPath);
  const prompt = host === "claude"
    ? `${entrypoint} ${request} Follow the installed command's authenticated activation-probe protocol exactly. ${marker}`
    : `Use the installed skill ${entrypoint} for this request: ${request} Follow its authenticated activation-probe protocol exactly. ${marker}`;
  const argv = host === "claude"
    ? ["-p", "--effort", "low", "--allowedTools", "Bash", "--disallowed-tools", "Write,Edit,NotebookEdit,WebFetch,WebSearch", "--", prompt]
    : ["exec", "--skip-git-repo-check", "--ephemeral", "--ignore-rules", "--sandbox", "workspace-write", "-C", fixture, prompt];
  const result = runSync(host === "claude" ? CLAUDE_BIN : CODEX_BIN, argv, {
    cwd: fixture, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  let contract;
  try { contract = JSON.parse(readRegular(contractPath).toString("utf8")); } catch { contract = null; }
  fs.rmSync(contractPath, { force: true });
  const session = contract?.session;
  const launch = contract?.launch;
  const contractPluginRoot = path.resolve(path.dirname(launch?.serverPath || ""), "..", "..");
  const expectedServer = path.join(contractPluginRoot, "designer", "server", "designer-server.mjs");
  const expectedOutput = path.join(fixture, ".designdoc");
  const expectedBootstrap = path.join(expectedOutput, ".visual-bootstrap.json");
  const bootstrapFlags = Array.isArray(launch?.args)
    ? launch.args.reduce((items, item, index) => item === "--bootstrap" ? [...items, index] : items, [])
    : [];
  const outFlags = Array.isArray(launch?.args)
    ? launch.args.reduce((items, item, index) => item === "--out" ? [...items, index] : items, [])
    : [];
  const driveFlags = Array.isArray(launch?.args)
    ? launch.args.reduce((items, item, index) => item === "--drive" ? [...items, index] : items, [])
    : [];
  const contextFlags = Array.isArray(launch?.args)
    ? launch.args.reduce((items, item, index) => item === "--context" ? [...items, index] : items, [])
    : [];
  const nameFlags = Array.isArray(launch?.args)
    ? launch.args.reduce((items, item, index) => item === "--name" ? [...items, index] : items, [])
    : [];
  const failures = [];
  const require = (condition, label) => { if (!condition) failures.push(label); };
  require(result.status === 0, "nonzero-host-exit");
  require(contract?.challenge === challenge, "challenge");
  require(contract?.activationSurfaceId === surfaceId, "activation-surface");
  require(Boolean(session?.GW_BOOTSTRAP && session?.GW_OUT), "session-paths");
  require(sameExistingPath(session?.GW_REPO || "", fixture), "repo-path");
  require(sameExistingPath(session?.GW_OUT || "", expectedOutput), "output-path");
  require(sameExistingPath(session?.GW_BOOTSTRAP || "", expectedBootstrap), "bootstrap-path");
  require(fs.existsSync(expectedBootstrap), "bootstrap-exists");
  require(sameExistingPath(launch?.serverPath || "", expectedServer), "server-path");
  let contractDigest;
  try { contractDigest = digestInventory(inventory(contractPluginRoot)); } catch { contractDigest = null; }
  require(contractDigest === digestInventory(inventory(installedRoot)), "server-root-digest");
  require(bootstrapFlags.length === 1 && launch.args[bootstrapFlags[0] + 1] === session?.GW_BOOTSTRAP, "bootstrap-arg");
  require(outFlags.length === 1 && launch.args[outFlags[0] + 1] === session?.GW_OUT, "out-arg");
  require(driveFlags.length === 1 && launch.args[driveFlags[0] + 1] === "adaptive", "drive-arg");
  require(contextFlags.length === 1 && launch.args[contextFlags[0] + 1] === session?.GW_DESC, "context-arg");
  require(nameFlags.length === 1 && launch.args[nameFlags[0] + 1] === "Spectra", "name-arg");
  if (failures.length > 0) {
    throw new Error(`${host} public entrypoint probe failed [${failures.join(", ")}] (exit ${result.status}): ${output.slice(-1000)}`);
  }
  if (argv.join(" ").includes(surfaceId)) throw new Error(`${host} surface id leaked into the probe request.`);
  return { entrypoint, surfaceId, argv, exitCode: result.status, output, outputSha256: sha256(output), contract, contractPluginRoot };
}

function writeFixture(root) {
  fs.mkdirSync(path.join(root, "web"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "Package.swift"), "// swift-tools-version: 6.0\nlet package = Package(platforms: [.macOS(.v14)])\n");
  fs.writeFileSync(path.join(root, "web", "package.json"), `${JSON.stringify({
    name: "spectra-web", dependencies: { next: "15.1.0", react: "19.0.0" },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, "README.md"), "# Spectra\nThe native macOS editor/workbench is the primary surface with a toolbar, persistent left sidebar, and keyboard-first workflow. A compact NSStatusItem menu-bar controller is an extension. The web app is a read-mostly companion.\n");
  fs.writeFileSync(path.join(root, "docs", "surfaces.md"), "macOS workbench: primary. Menu bar: compact controller. Web: companion.\n");
}

async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  server.close();
  await once(server, "close");
  return port;
}

async function getJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${options?.method || "GET"} ${url} returned ${response.status}`);
  return response.json();
}

async function waitForSession(url, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Designer exited before activation queries completed.");
    try { return await getJson(`${url}/api/session`); } catch { await delay(100); }
  }
  throw new Error("Designer did not become ready for activation queries.");
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGINT");
  await Promise.race([once(child, "exit"), delay(5_000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function deriveRuntime(host, installedRoot, challenge, hostRoot, probe) {
  const fixture = path.join(hostRoot, "fixture");
  const session = probe.contract.session;
  const sourceBootstrap = path.resolve(session.GW_BOOTSTRAP);
  const bootstrapBytes = readRegular(sourceBootstrap);
  const bootstrap = JSON.parse(bootstrapBytes.toString("utf8"));
  if (!String(bootstrap.context?.requestedDelta || "").includes(challenge)) {
    throw new Error(`${host} bootstrap omitted the orchestrator challenge.`);
  }

  const port = await freePort();
  const launchArgv = [NODE_BIN, probe.contract.launch.serverPath, ...probe.contract.launch.args, "--port", String(port)];
  const child = spawn(launchArgv[0], launchArgv.slice(1), {
    cwd: fixture, env: { ...process.env, PYTHONPATH: probe.contractPluginRoot, PYTHONDONTWRITEBYTECODE: "1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let serverOutput = "";
  child.stdout.on("data", (chunk) => { serverOutput += chunk; });
  child.stderr.on("data", (chunk) => { serverOutput += chunk; });
  let initial;
  let continuation;
  let after;
  let contract;
  try {
    const url = `http://127.0.0.1:${port}`;
    initial = await waitForSession(url, child);
    continuation = await getJson(`${url}/api/baseline/continue`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    after = await getJson(`${url}/api/session`);
    contract = await getJson(`${url}/api/agent/contract`);
  } finally {
    await stopChild(child);
  }

  const primary = initial.surfaces?.filter((item) => item.role === "primary") || [];
  const companions = initial.surfaces?.filter((item) => item.role === "companion").map((item) => item.platform) || [];
  const candidates = contract?.contract?.candidates?.map((item) => item.id) || [];
  if (initial.route !== "baseline" || initial.product?.name !== "Spectra"
    || primary.length !== 1 || primary[0].platform !== "macos" || !companions.includes("web")
    || continuation.route !== "next-unresolved" || after.route !== "next-unresolved"
    || !after.nextDecision?.categoryId || ["platform-target", "nav-structure"].includes(after.nextDecision.categoryId)
    || EXCLUDED_CANDIDATES.some((id) => candidates.includes(id))) {
    throw new Error(`${host} independently derived activation assertions failed.`);
  }

  const bootstrapPath = path.join(hostRoot, "visual-bootstrap.json");
  writeAtomic(bootstrapPath, bootstrapBytes);
  const normalizedArgv = launchArgv.map((item) => item === sourceBootstrap ? bootstrapPath : item);
  const transcript = [
    `entrypoint: ${probe.entrypoint}`,
    `challenge: ${challenge}`,
    `probe argv: ${JSON.stringify(probe.argv)}`,
    `probe exit: ${probe.exitCode}`,
    `probe output sha256: ${probe.outputSha256}`,
    probe.output,
    `GROUNDWORK_SURFACE_ID ${probe.surfaceId}`,
    `GROUNDWORK_LAUNCH_CONTRACT ${JSON.stringify(probe.contract)}`,
    `GROUNDWORK_ACTIVATION_READY ${challenge}`,
    `installed root: ${installedRoot}`,
    `resolver: ${JSON.stringify(session)}`,
    `launch argv: ${JSON.stringify(normalizedArgv)}`,
    `baseline: ${JSON.stringify(initial)}`,
    `continuation: ${JSON.stringify({ response: continuation, session: after })}`,
    `candidate ids: ${JSON.stringify(candidates)}`,
    "PASS",
  ].join("\n");
  const transcriptPath = path.join(hostRoot, "transcript.txt");
  writeAtomic(transcriptPath, transcript);
  return {
    authenticated: true,
    entrypoint: probe.entrypoint,
    installedArtifactDigest: digestInventory(inventory(installedRoot)),
    probeArgv: probe.argv,
    probeExitCode: probe.exitCode,
    probeOutputSha256: probe.outputSha256,
    activationSurfaceId: probe.surfaceId,
    transcriptPath,
    transcriptSha256: sha256(transcript),
    launchArgv: normalizedArgv,
    bootstrapPath,
    bootstrapSha256: sha256(bootstrapBytes),
    baseline: { route: initial.route, productName: initial.product.name, primaryPlatform: primary[0].platform, companionPlatforms: companions },
    continuation: { route: after.route, nextDecisionId: after.nextDecision.categoryId },
  };
}

function remapReportPaths(report, fromRoot, toRoot) {
  const mapped = JSON.parse(JSON.stringify(report));
  for (const host of Object.values(mapped.hosts)) {
    host.probeArgv = host.probeArgv.map((item) => typeof item === "string" ? item.replaceAll(fromRoot, toRoot) : item);
    host.transcriptPath = host.transcriptPath.replaceAll(fromRoot, toRoot);
    host.bootstrapPath = host.bootstrapPath.replaceAll(fromRoot, toRoot);
    host.launchArgv = host.launchArgv.map((item) => typeof item === "string" ? item.replaceAll(fromRoot, toRoot) : item);
  }
  return mapped;
}

function rewritePublishedArtifacts(report, fromRoot, toRoot) {
  for (const host of Object.values(report.hosts)) {
    const transcript = readRegular(host.transcriptPath).toString("utf8").replaceAll(fromRoot, toRoot);
    writeAtomic(host.transcriptPath, transcript);
    host.transcriptSha256 = sha256(transcript);
    const bootstrapText = readRegular(host.bootstrapPath).toString("utf8").replaceAll(fromRoot, toRoot);
    const bootstrap = JSON.parse(bootstrapText);
    const normalizedBootstrap = `${JSON.stringify(bootstrap, null, 2)}\n`;
    writeAtomic(host.bootstrapPath, normalizedBootstrap);
    host.bootstrapSha256 = sha256(normalizedBootstrap);
  }
}

let temporaryRoot;
try {
  const options = parseArgs(process.argv.slice(2));
  if (!options.manifest) throw new Error("Usage: create-live-activation-report.mjs --manifest <release-manifest.json>");
  const manifestPath = path.resolve(options.manifest);
  const manifest = JSON.parse(readRegular(manifestPath).toString("utf8"));
  validateManifestIdentity(manifest);
  requireAuthentication();
  const installedRoots = resolveInstalledRoots(manifest.version);
  verifyInstalledRoots(installedRoots, manifest);
  fs.mkdirSync(ACTIVATION_ROOT, { recursive: true, mode: 0o700 });
  const challenge = crypto.randomBytes(16).toString("hex");
  temporaryRoot = fs.mkdtempSync(path.join(ACTIVATION_ROOT, `.activation-${manifest.artifactDigest.slice(0, 12)}-`));
  const issuedAt = new Date();
  const probes = {
    claude: null,
    codex: null,
  };
  const claudeFixture = path.join(temporaryRoot, "claude", "fixture");
  const codexFixture = path.join(temporaryRoot, "codex", "fixture");
  writeFixture(claudeFixture);
  writeFixture(codexFixture);
  probes.claude = runHostProbe("claude", challenge, installedRoots.claude, claudeFixture);
  probes.codex = runHostProbe("codex", challenge, installedRoots.codex, codexFixture);
  const hosts = {
    claude: await deriveRuntime("claude", installedRoots.claude, challenge, path.join(temporaryRoot, "claude"), probes.claude),
    codex: await deriveRuntime("codex", installedRoots.codex, challenge, path.join(temporaryRoot, "codex"), probes.codex),
  };
  const temporaryReport = {
    schema: "groundwork.live-activation/v1", challenge, issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 15 * 60_000).toISOString(),
    version: manifest.version, artifactDigest: manifest.artifactDigest, hosts,
  };
  const temporaryReportPath = path.join(temporaryRoot, "activation-report.v1.json");
  writeAtomic(temporaryReportPath, `${JSON.stringify(temporaryReport, null, 2)}\n`);
  validateActivationReport(temporaryReportPath, manifest, { requireFresh: true });

  const destinationRoot = path.join(ACTIVATION_ROOT, manifest.artifactDigest);
  const relativeDestination = path.relative(ACTIVATION_ROOT, destinationRoot);
  if (!relativeDestination || relativeDestination.startsWith("..") || path.isAbsolute(relativeDestination)) {
    throw new Error("Activation destination escapes its owned root.");
  }
  const publishedFromRoot = temporaryRoot;
  const finalReport = remapReportPaths(temporaryReport, publishedFromRoot, destinationRoot);
  fs.rmSync(destinationRoot, { recursive: true, force: true });
  fs.renameSync(temporaryRoot, destinationRoot);
  temporaryRoot = undefined;
  rewritePublishedArtifacts(finalReport, publishedFromRoot, destinationRoot);
  const reportPath = path.join(destinationRoot, "activation-report.v1.json");
  writeAtomic(reportPath, `${JSON.stringify(finalReport, null, 2)}\n`);
  validateActivationReport(reportPath, manifest, { requireFresh: true });
  process.stdout.write(`${JSON.stringify({ reportPath, challenge, version: manifest.version, artifactDigest: manifest.artifactDigest })}\n`);
} catch (error) {
  if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
  process.stderr.write(`create-live-activation-report: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
