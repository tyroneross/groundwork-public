#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function inventory(root, ignored = new Set(["release-manifest.json"])) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Installed host cache contains a symlink: ${absolute}`);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        const relative = path.relative(root, absolute).split(path.sep).join("/");
        if (ignored.has(relative)) continue;
        const data = fs.readFileSync(absolute);
        files.push({ path: relative, sha256: sha256(data), bytes: data.byteLength });
      }
    }
  };
  walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function digestInventory(files) {
  return sha256(files.map((item) => `${item.path}\0${item.sha256}\0${item.bytes}\n`).join(""));
}

function verifyOutputManifest(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "artifact-manifest.json"), "utf8"));
  if (manifest.schema !== "groundwork.artifacts/v1" || !Array.isArray(manifest.files)) {
    throw new Error(`Installed runtime emitted an invalid artifact manifest under ${root}.`);
  }
  for (const item of manifest.files) {
    const relative = String(item.name || "");
    if (!relative || relative.startsWith("/") || relative.includes("..") || relative.includes("\\")) {
      throw new Error(`Installed runtime emitted an unsafe artifact name: ${relative}`);
    }
    const file = path.join(root, relative);
    if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== item.sha256) {
      throw new Error(`Installed runtime artifact hash mismatch: ${relative}`);
    }
  }
}

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

async function reservePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitFor(check, message) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(message);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 750)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function verifyAdaptiveDriver(installed, temp, host) {
  const productInput = path.join(temp, `${host}-product`);
  fs.mkdirSync(path.join(productInput, "web"), { recursive: true });
  fs.mkdirSync(path.join(productInput, "docs"), { recursive: true });
  const product = fs.realpathSync(productInput);
  fs.writeFileSync(path.join(product, "Package.swift"), '// swift-tools-version: 6.0\nlet package = Package(platforms: [.macOS(.v14)])\n');
  fs.writeFileSync(path.join(product, "web", "package.json"), JSON.stringify({
    name: "spectra-web", description: "Read-mostly web companion",
    dependencies: { next: "15.1.0", react: "19.0.0" },
  }));
  fs.writeFileSync(path.join(product, "README.md"), [
    "# Spectra", "Native macOS primary editor/workbench with toolbar and persistent left sidebar.",
    "Compact menu-bar controller using NSStatusItem. Read-mostly web companion for review.",
  ].join("\n"));
  fs.writeFileSync(path.join(product, "docs", "surfaces.md"), "macOS workbench: primary. Menu bar: compact controller. Web: companion.\n");
  const resolver = path.join(installed, "designer", "bridge", "resolve_visual_session.py");
  const resolved = JSON.parse(run("python3", [
    resolver, "--request", `Host parity ${host}: understand Spectra`,
    "--target", product, "--name", "Spectra",
  ], installed, { ...process.env, PYTHONPATH: installed }));
  if (!resolved.GW_BOOTSTRAP) throw new Error(`${host} installed resolver did not emit a bootstrap: ${resolved.GW_BOOTSTRAP_WARNINGS}`);
  const bootstrapPath = resolved.GW_BOOTSTRAP;
  const bootstrap = JSON.parse(fs.readFileSync(bootstrapPath, "utf8"));
  const topology = bootstrap.context?.platformSurfaces?.map((item) => `${item.platform}:${item.role}`) || [];
  if (!topology.includes("macos:primary") || !topology.includes("web:companion") || !topology.includes("macos:extension")) {
    throw new Error(`${host} installed resolver lost the Spectra topology: ${JSON.stringify(topology)}`);
  }
  const facts = new Set((bootstrap.knownFacts || []).map((item) => `${item.categoryId}:${item.optionId}`));
  if (!facts.has("platform-target:platform-macos") || !facts.has("nav-structure:nav-structure-left")) {
    throw new Error(`${host} installed resolver lost known platform or navigation evidence.`);
  }
  const statePath = path.join(temp, `${host}-designer-state.json`);
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [
    path.join(installed, "designer", "server", "designer-server.mjs"),
    "--bootstrap", bootstrapPath,
    "--port", String(port),
  ], {
    cwd: installed,
    env: { ...process.env, GROUNDWORK_DESIGNER_STATE_FILE: statePath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });
  try {
    await waitFor(async () => {
      if (child.exitCode !== null) throw new Error(`Installed ${host} Designer exited:\n${logs}`);
      try { return (await fetch(`${baseUrl}/api/session`)).ok; } catch { return false; }
    }, `Installed ${host} Designer did not start.`);
    const initial = await (await fetch(`${baseUrl}/api/session`)).json();
    if (initial.route !== "baseline" || initial.product?.name !== "Spectra") {
      throw new Error(`${host} installed entrypoint did not preserve the Spectra baseline: ${JSON.stringify(initial)}`);
    }
    const continued = await (await fetch(`${baseUrl}/api/baseline/continue`, { method: "POST" })).json();
    if (!continued.ok || continued.route !== "next-unresolved") throw new Error(`${host} installed baseline could not continue.`);

    const driver = path.join(installed, "designer", "bridge", "adaptive_host_driver.py");
    const packet = JSON.parse(run("python3", [driver, "--url", baseUrl, "contract"], installed));
    const candidate = packet.contract?.candidates?.[0];
    if (!candidate?.id || candidate.id === "platform-target" || candidate.id === "nav-structure") {
      throw new Error(`${host} adaptive driver did not receive a pre-adapted next decision.`);
    }
    const candidateIds = new Set((packet.contract?.candidates || []).map((item) => item.id));
    for (const mobileOnly of ["nav-tabbar", "sheet-size", "micro-haptics", "pull-refresh"]) {
      if (candidateIds.has(mobileOnly)) throw new Error(`${host} macOS contract exposed mobile-only category ${mobileOnly}.`);
    }
    const answer = {
      ...packet.contract,
      answer: { action: "ask", chosen_category_id: candidate.id, rationale: `${host} installed adaptive driver parity.` },
      seq: packet.seq,
    };
    const answerPath = path.join(temp, `${host}-answer.json`);
    fs.writeFileSync(answerPath, JSON.stringify(answer));
    const response = JSON.parse(run("python3", [driver, "--url", baseUrl, "answer", "--file", answerPath], installed));
    if (!response.ok) throw new Error(`${host} adaptive driver answer was rejected.`);
    return { route: initial.route, nextDecisionId: candidate.id, driverAccepted: true };
  } finally {
    await stopChild(child);
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    options[key.slice(2)] = argv[++index];
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (!options.manifest) throw new Error("--manifest is required");
const manifestPath = path.resolve(options.manifest);
const stagedRoot = path.dirname(manifestPath);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.schema !== "groundwork.release-manifest/v1") throw new Error("Unsupported staged manifest.");

const releasePolicy = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "release-policy.json"), "utf8"));
const PINNED_BUILD_LOOP = releasePolicy.compatibility.buildLoop;

const actualDigest = digestInventory(inventory(stagedRoot));
if (actualDigest !== manifest.artifactDigest) throw new Error("Staged bytes no longer match the release manifest.");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "groundwork-host-parity-"));
try {
  const homes = {
    claude: path.join(temp, "claude-home"),
    codex: path.join(temp, "codex-home"),
  };
  fs.mkdirSync(homes.claude, { recursive: true });
  fs.mkdirSync(homes.codex, { recursive: true });
  const claudeEnv = { ...process.env, CLAUDE_CONFIG_DIR: homes.claude };
  run("claude", ["plugin", "marketplace", "add", stagedRoot], stagedRoot, claudeEnv);
  run("claude", ["plugin", "install", "groundwork@groundwork", "--scope", "user"], stagedRoot, claudeEnv);
  const claudeRegistry = JSON.parse(fs.readFileSync(path.join(homes.claude, "plugins", "installed_plugins.json"), "utf8"));
  const claudeInstall = claudeRegistry.plugins?.["groundwork@groundwork"]?.find((item) => item.version === manifest.version);
  if (!claudeInstall?.installPath) throw new Error("Claude did not register the staged Groundwork version.");

  const codexEnv = { ...process.env, CODEX_HOME: homes.codex };
  run("codex", ["plugin", "marketplace", "add", stagedRoot, "--json"], stagedRoot, codexEnv);
  const codexInstall = JSON.parse(run("codex", ["plugin", "add", "groundwork@groundwork", "--json"], stagedRoot, codexEnv));
  if (codexInstall.version !== manifest.version || !codexInstall.installedPath) {
    throw new Error("Codex did not register the staged Groundwork version.");
  }
  const installedRoots = {
    claude: fs.realpathSync(claudeInstall.installPath),
    codex: fs.realpathSync(codexInstall.installedPath),
  };
  const claudeDetails = run("claude", ["plugin", "details", "groundwork@groundwork"], stagedRoot, claudeEnv);
  if (!claudeDetails.toLowerCase().includes("groundwork")) throw new Error("Claude did not discover the installed Groundwork command surface.");
  const codexRegistry = JSON.parse(run("codex", ["plugin", "list", "--json"], stagedRoot, codexEnv));
  if (!codexRegistry.installed?.some((item) => item.pluginId === "groundwork@groundwork" && item.enabled)) {
    throw new Error("Codex did not discover the installed Groundwork skill surface.");
  }

  const outputs = {};
  for (const [host, installed] of Object.entries(installedRoots)) {
    const installedManifest = JSON.parse(fs.readFileSync(path.join(installed, "release-manifest.json"), "utf8"));
    const pluginManifest = JSON.parse(fs.readFileSync(path.join(installed, host === "claude" ? ".claude-plugin/plugin.json" : ".codex-plugin/plugin.json"), "utf8"));
    if (installedManifest.artifactDigest !== manifest.artifactDigest || pluginManifest.version !== manifest.version) {
      throw new Error(`${host} installed version or staged digest differs.`);
    }
    if (digestInventory(inventory(installed)) !== manifest.artifactDigest) throw new Error(`${host} installed bytes differ from the staged artifact.`);
    const entry = fs.readFileSync(path.join(installed, host === "claude" ? "commands/run.md" : "skills/groundwork/SKILL.md"), "utf8");
    if (!entry.includes("references/router.md") || !entry.includes("explore-ui")) throw new Error(`${host} entrypoint does not route existing-app work through explore-ui.`);

    const out = path.join(temp, `${host}-output`);
    run(process.execPath, [
      path.join(installed, "engine/dist/cli.js"),
      path.join(installed, "engine/fixtures/sample-spec.json"),
      "--out", out,
      "--run-id", "run-host-parity",
      "--created-at", "2026-08-05T00:00:00.000Z",
    ], installed);
    verifyOutputManifest(out);
    // generationId/generatedAt are intentionally unique publication markers;
    // compare the committed artifact payload while verifying each marker above.
    outputs[host] = { out, digest: digestInventory(inventory(out, new Set(["artifact-manifest.json"]))) };
    outputs[host].adaptive = await verifyAdaptiveDriver(installed, temp, host);
  }
  if (outputs.claude.digest !== outputs.codex.digest) throw new Error("Claude and Codex installed runtimes emitted different artifact bytes.");
  if (outputs.claude.adaptive.nextDecisionId !== outputs.codex.adaptive.nextDecisionId
    || outputs.claude.adaptive.route !== outputs.codex.adaptive.route
    || outputs.claude.adaptive.driverAccepted !== outputs.codex.adaptive.driverAccepted) {
    throw new Error("Claude and Codex installed adaptive drivers diverged.");
  }

  const buildLoopRoot = process.env.BUILD_LOOP_ROOT ? path.resolve(process.env.BUILD_LOOP_ROOT) : null;
  if (!buildLoopRoot) throw new Error("BUILD_LOOP_ROOT is required for the installed Build Loop exchange parity gate.");
  const buildLoopCommit = run("git", ["rev-parse", "HEAD"], buildLoopRoot);
  if (buildLoopCommit !== PINNED_BUILD_LOOP.commit) throw new Error(`Build Loop commit is not pinned release ${PINNED_BUILD_LOOP.commit}.`);
  if (run("git", ["status", "--porcelain", "--untracked-files=all"], buildLoopRoot)) {
    throw new Error("Build Loop release worktree must be clean before parity verification.");
  }
  const buildLoopPackage = JSON.parse(fs.readFileSync(path.join(buildLoopRoot, "package.json"), "utf8"));
  if (buildLoopPackage.version !== PINNED_BUILD_LOOP.version) throw new Error("Build Loop release version is not supported.");
  const adapterPath = path.join(buildLoopRoot, "scripts", "groundwork_exchange.py");
  const exchangeTest = path.join(buildLoopRoot, "scripts", "test_groundwork_exchange_distribution.py");
  if (sha256(fs.readFileSync(adapterPath)) !== PINNED_BUILD_LOOP.adapterDigest) throw new Error("Build Loop adapter bytes do not match the pinned release.");
  if (sha256(fs.readFileSync(exchangeTest)) !== PINNED_BUILD_LOOP.distributionTestDigest) throw new Error("Build Loop distribution test bytes do not match the pinned release.");
  run("python3", [exchangeTest], buildLoopRoot);

  const roundtrip = path.join(temp, "groundwork-build-loop-roundtrip");
  fs.mkdirSync(roundtrip);
  run("git", ["init", "-q"], roundtrip);
  run("git", ["config", "user.email", "groundwork@example.invalid"], roundtrip);
  run("git", ["config", "user.name", "Groundwork Release"], roundtrip);
  run("git", ["config", "core.hooksPath", "/dev/null"], roundtrip);
  run("git", ["config", "commit.gpgsign", "false"], roundtrip);
  fs.writeFileSync(path.join(roundtrip, "README.md"), "Groundwork Build Loop round trip.\n");
  run("git", ["add", "README.md"], roundtrip);
  run("git", ["commit", "-q", "-m", "roundtrip fixture"], roundtrip);
  const evidencePath = path.join(roundtrip, "evidence.json");
  const mapPath = path.join(roundtrip, "implementation-map.json");
  fs.writeFileSync(evidencePath, JSON.stringify({ mappings: [], evidence: [], deviations: [] }));
  run("python3", [
    adapterPath, "emit-map",
    "--request", path.join(outputs.claude.out, "build-request.json"),
    "--spec", path.join(outputs.claude.out, "spec.json"),
    "--evidence", evidencePath,
    "--workdir", roundtrip,
    "--output", mapPath,
    "--producer-version", PINNED_BUILD_LOOP.version,
    "--created-at", "2026-08-05T00:01:00.000Z",
  ], buildLoopRoot);
  const reconciled = path.join(roundtrip, "reconciled");
  run(process.execPath, [
    path.join(installedRoots.claude, "engine/dist/cli.js"),
    path.join(outputs.claude.out, "spec.json"),
    "--out", reconciled,
    "--run-id", "run-host-parity",
    "--created-at", "2026-08-05T00:00:00.000Z",
  ], installedRoots.claude);
  run(process.execPath, [
    path.join(installedRoots.claude, "engine/dist/cli.js"),
    path.join(outputs.claude.out, "spec.json"),
    "--out", reconciled,
    "--run-id", "run-host-parity",
    "--created-at", "2026-08-05T00:02:00.000Z",
    "--reconcile", mapPath,
  ], installedRoots.claude);
  const convergence = JSON.parse(fs.readFileSync(path.join(reconciled, "convergence.json"), "utf8"));
  if (convergence.buildRequestDigest !== JSON.parse(fs.readFileSync(mapPath, "utf8")).buildRequestDigest) {
    throw new Error("Groundwork did not reconcile the pinned Build Loop map against the same request digest.");
  }

  process.stdout.write(`${JSON.stringify({
    schema: "groundwork.host-parity/v1",
    version: manifest.version,
    artifactDigest: manifest.artifactDigest,
    claudeDigest: manifest.artifactDigest,
    codexDigest: manifest.artifactDigest,
    outputDigest: outputs.claude.digest,
    buildLoopExchange: "passed",
    buildLoopVersion: PINNED_BUILD_LOOP.version,
    buildLoopCommit: PINNED_BUILD_LOOP.commit,
    buildLoopAdapterDigest: PINNED_BUILD_LOOP.adapterDigest,
  })}\n`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
