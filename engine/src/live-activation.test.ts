import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
// @ts-expect-error The release builder is a runtime JavaScript module.
import { stageRelease } from "../../scripts/stage-release.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// The version lives in exactly one place. Hardcoding it in this test is what
// let the 0.3.1 bump break it silently — see scripts/version_gate.py.
const REPO_VERSION = JSON.parse(
  fs.readFileSync(path.join(ROOT, ".claude-plugin/plugin.json"), "utf8"),
).version;
const SCRIPT = path.join(ROOT, "scripts", "create-live-activation-report.mjs");

function writeFakeHost(file: string, host: "claude" | "codex") {
  const source = `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const host = ${JSON.stringify(host)};
const argv = process.argv.slice(2);
const sourceRoot = process.env.FAKE_GROUNDWORK_ROOT;
const root = host === "codex" ? process.env.FAKE_CODEX_INSTALL_ROOT : sourceRoot;
if (host === "claude" && argv[0] === "auth") {
  process.stdout.write('{"loggedIn":true}\\n');
} else if (host === "codex" && argv[0] === "login") {
  process.stdout.write('Logged in using ChatGPT\\n');
} else if (argv[0] === "plugin" && argv[1] === "list") {
  if (host === "claude") {
    process.stdout.write(JSON.stringify([{id:"groundwork@groundwork",enabled:true,installPath:root}]) + "\\n");
  } else {
    process.stdout.write(JSON.stringify({installed:[{pluginId:"groundwork@groundwork",version:process.env.FAKE_CODEX_VERSION,installed:true,enabled:process.env.FAKE_CODEX_DISABLED !== "1",source:{source:"local",path:sourceRoot}}],available:[]}) + "\\n");
  }
} else {
  const joined = argv.join(" ");
  const challenge = joined.match(/[a-f0-9]{32}/)?.[0];
  if (!challenge) process.exit(3);
  const entry = path.join(root, host === "claude" ? "commands/run.md" : "skills/groundwork/SKILL.md");
  const surface = fs.readFileSync(entry, "utf8").match(/activation_surface_id:\\s*([a-z0-9-]+)/)?.[1];
  if (process.env.FAKE_BROKEN_ENTRYPOINTS !== "1") {
    const fixture = joined.match(/TARGET ([^;]+);/)?.[1];
    const contractPath = joined.match(/CONTRACT ([^;]+);/)?.[1];
    const request = 'GROUNDWORK_ACTIVATION_PROBE ' + challenge + '; TARGET ' + fixture + '; PRODUCT Spectra; CONTRACT ' + contractPath + '; understand the existing Spectra app and continue its adaptive visual design.';
    const resolved = spawnSync('python3', [path.join(root, 'designer/bridge/resolve_visual_session.py'), '--request', request, '--target', fixture, '--name', 'Spectra', '--format', 'json'], {encoding:'utf8',cwd:fixture,env:{...process.env,PYTHONPATH:root,PYTHONDONTWRITEBYTECODE:'1'}});
    if (resolved.status !== 0) { process.stderr.write(resolved.stderr); process.exit(resolved.status || 4); }
    const session = JSON.parse(resolved.stdout);
    const contract = {challenge,activationSurfaceId:surface,session,launch:{serverPath:path.join(root,'designer/server/designer-server.mjs'),args:['--context',request,'--name','Spectra','--out',session.GW_OUT,'--bootstrap',session.GW_BOOTSTRAP,'--drive','adaptive']}};
    fs.writeFileSync(contractPath + '.tmp', JSON.stringify(contract));
    fs.renameSync(contractPath + '.tmp', contractPath);
    process.stdout.write('GROUNDWORK_LAUNCH_CONTRACT ' + JSON.stringify(contract) + '\\n');
  }
  process.stdout.write('GROUNDWORK_SURFACE_ID ' + surface + '\\nGROUNDWORK_ACTIVATION_READY ' + challenge + '\\n');
}
`;
  fs.writeFileSync(file, source, { mode: 0o755 });
}

function runActivation(temp: string, { disabledCodex = false, brokenEntrypoints = false } = {}) {
  const staged = stageRelease({ releaseRoot: path.join(temp, "staged") });
  const codexHome = path.join(temp, "codex-home");
  const codexInstall = path.join(codexHome, "plugins", "cache", "groundwork", "groundwork", REPO_VERSION);
  fs.mkdirSync(path.dirname(codexInstall), { recursive: true });
  fs.cpSync(staged.artifactRoot, codexInstall, { recursive: true });
  const claude = path.join(temp, "fake-claude.mjs");
  const codex = path.join(temp, "fake-codex.mjs");
  writeFakeHost(claude, "claude");
  writeFakeHost(codex, "codex");
  const activationRoot = path.join(temp, "activation");
  const result = spawnSync(process.execPath, [SCRIPT, "--manifest", staged.manifestPath], {
    cwd: ROOT,
    env: {
      ...process.env,
      GROUNDWORK_CLAUDE_BIN: claude,
      GROUNDWORK_CODEX_BIN: codex,
      GROUNDWORK_LIVE_ACTIVATION_ROOT: activationRoot,
      CODEX_HOME: codexHome,
      FAKE_GROUNDWORK_ROOT: staged.artifactRoot,
      FAKE_CODEX_INSTALL_ROOT: codexInstall,
      // The fake Codex registry must report the version the repo actually
      // declares. Hardcoding it here is what let the 0.3.1 bump break this
      // test silently — see scripts/version_gate.py.
      FAKE_CODEX_VERSION: REPO_VERSION,
      FAKE_CODEX_DISABLED: disabledCodex ? "1" : "0",
      FAKE_BROKEN_ENTRYPOINTS: brokenEntrypoints ? "1" : "0",
      PYTHONDONTWRITEBYTECODE: "1",
    },
    encoding: "utf8",
    timeout: 120_000,
  });
  return { result, staged, activationRoot };
}

test("activation orchestrator resolves both registries and publishes only stable paths", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "groundwork-live-activation-test-"));
  try {
    const { result, staged, activationRoot } = runActivation(temp);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.artifactDigest, staged.artifactDigest);
    assert.equal(path.dirname(output.reportPath), path.join(activationRoot, staged.artifactDigest));
    const reportText = fs.readFileSync(output.reportPath, "utf8");
    assert.doesNotMatch(reportText, /\.activation-/);
    const report = JSON.parse(reportText);
    for (const host of ["claude", "codex"]) {
      assert.equal(report.hosts[host].installedArtifactDigest, staged.artifactDigest);
      assert.ok(fs.existsSync(report.hosts[host].transcriptPath));
      assert.ok(fs.existsSync(report.hosts[host].bootstrapPath));
      assert.doesNotMatch(fs.readFileSync(report.hosts[host].transcriptPath, "utf8"), /\.activation-/);
      assert.ok(fs.existsSync(JSON.parse(fs.readFileSync(report.hosts[host].bootstrapPath, "utf8")).product.outputPath));
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("activation orchestrator rejects a disabled Codex registry entry", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "groundwork-live-activation-disabled-"));
  try {
    const { result } = runActivation(temp, { disabledCodex: true });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Codex registry has no enabled Groundwork/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("activation orchestrator rejects canary-only hosts that bypass the entrypoint workflow", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "groundwork-live-activation-bypass-"));
  try {
    const { result } = runActivation(temp, { brokenEntrypoints: true });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /public entrypoint probe failed/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
