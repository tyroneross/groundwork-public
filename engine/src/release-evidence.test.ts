import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
// @ts-expect-error The release builder is a runtime JavaScript module.
import { stageRelease } from "../../scripts/stage-release.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = path.join(ROOT, "scripts", "release-evidence.mjs");

function run(evidencePath: string, stageRoot: string, activationRoot: string, argv: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...argv], {
    cwd: ROOT,
    env: {
      ...process.env,
      GROUNDWORK_RELEASE_EVIDENCE: evidencePath,
      GROUNDWORK_RELEASE_STAGE_ROOT: stageRoot,
      GROUNDWORK_LIVE_ACTIVATION_ROOT: activationRoot,
    },
    encoding: "utf8",
  });
}

function sha256(data: string | Buffer) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function writeActivationReport(
  activationRoot: string,
  manifest: any,
  mutate?: (report: any) => void,
) {
  fs.mkdirSync(activationRoot, { recursive: true });
  const challenge = crypto.randomBytes(16).toString("hex");
  const reportId = crypto.randomBytes(4).toString("hex");
  const issuedAt = Date.now();
  const hosts: Record<string, any> = {};
  for (const [hostName, entrypoint] of Object.entries({
    claude: "/groundwork:run",
    codex: "groundwork:groundwork",
  })) {
    const surfaceId = hostName === "claude"
      ? "groundwork-claude-run-v1-7e4a9c2f"
      : "groundwork-codex-skill-v1-b91d6e30";
    const hostRoot = path.join(activationRoot, reportId, hostName);
    const repoPath = path.join(hostRoot, "fixture");
    const outputPath = path.join(hostRoot, "fixture", ".groundwork", "designer");
    fs.mkdirSync(outputPath, { recursive: true });
    const bootstrap = {
      contract: "groundwork.visual-bootstrap/v1",
      product: { name: "Spectra", repoPath, outputPath },
      context: {
        requestedDelta: `Release activation challenge ${challenge}`,
        platformSurfaces: [
          { id: "mac", platform: "macos", role: "primary" },
          { id: "web", platform: "web", role: "companion" },
        ],
      },
    };
    const bootstrapBytes = `${JSON.stringify(bootstrap)}\n`;
    const bootstrapPath = path.join(hostRoot, "bootstrap.json");
    fs.writeFileSync(bootstrapPath, bootstrapBytes);
    const transcript = `${hostName} authenticated\n${entrypoint}\nchallenge=${challenge}\nGROUNDWORK_SURFACE_ID ${surfaceId}\nGROUNDWORK_LAUNCH_CONTRACT {"launch":{"args":["--bootstrap","${bootstrapPath}"]}}\nGROUNDWORK_ACTIVATION_READY ${challenge}\n`;
    const transcriptPath = path.join(hostRoot, "transcript.txt");
    fs.writeFileSync(transcriptPath, transcript);
    hosts[hostName] = {
      authenticated: true,
      entrypoint,
      installedArtifactDigest: manifest.artifactDigest,
      probeArgv: [entrypoint, `challenge=${challenge}`],
      probeExitCode: 0,
      probeOutputSha256: sha256(`GROUNDWORK_ACTIVATION_READY ${challenge}`),
      activationSurfaceId: surfaceId,
      transcriptPath,
      transcriptSha256: sha256(transcript),
      launchArgv: ["node", "designer-server.mjs", "--out", outputPath, "--bootstrap", bootstrapPath, "--drive", "adaptive"],
      bootstrapPath,
      bootstrapSha256: sha256(bootstrapBytes),
      baseline: {
        route: "baseline", productName: "Spectra", primaryPlatform: "macos",
        companionPlatforms: ["web"],
      },
      continuation: { route: "next-unresolved", nextDecisionId: "color-accent-system" },
    };
  }
  const report: any = {
    schema: "groundwork.live-activation/v1",
    challenge,
    issuedAt: new Date(issuedAt).toISOString(),
    expiresAt: new Date(issuedAt + 15 * 60_000).toISOString(),
    version: manifest.version,
    artifactDigest: manifest.artifactDigest,
    hosts,
  };
  mutate?.(report);
  const reportPath = path.join(activationRoot, `activation-${crypto.randomBytes(4).toString("hex")}.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report)}\n`);
  return reportPath;
}

test("release evidence merges gates atomically and blocks incomplete or mismatched publication", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "groundwork-release-evidence-test-"));
  try {
    const staged = stageRelease({ releaseRoot: path.join(temp, "staged") });
    const stageRoot = path.join(temp, "staged");
    const activationRoot = path.join(temp, "live-activation");
    const evidencePath = path.join(temp, "release-evidence.v2.json");
    let result = run(evidencePath, stageRoot, activationRoot, ["verify"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /evidence is missing/);

    fs.mkdirSync(`${evidencePath}.lock`, { recursive: true });
    fs.writeFileSync(path.join(`${evidencePath}.lock`, "owner"), "2147483647\n");

    result = run(evidencePath, stageRoot, activationRoot, [
      "record", "--gate", "deterministic", "--status", "passed",
      "--manifest", staged.manifestPath, "--gate-command", "npm run test:release",
      "--metadata", JSON.stringify({ nodeVersion: process.version, secret: "must-not-persist" }),
    ]);
    assert.equal(result.status, 0, result.stderr);
    result = run(evidencePath, stageRoot, activationRoot, ["verify"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /host gate is not passed/);

    result = run(evidencePath, stageRoot, activationRoot, [
      "record", "--gate", "host", "--status", "passed",
      "--manifest", staged.manifestPath, "--gate-command", "npm run test:host-release",
      "--metadata", JSON.stringify({ platform: process.platform }),
    ]);
    assert.equal(result.status, 0, result.stderr);
    result = run(evidencePath, stageRoot, activationRoot, ["verify"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /activation gate is not passed/);

    const manifest = JSON.parse(fs.readFileSync(staged.manifestPath, "utf8"));
    result = run(evidencePath, stageRoot, activationRoot, [
      "record", "--gate", "activation", "--status", "passed",
      "--manifest", staged.manifestPath, "--gate-command", "authenticated Claude and Codex activation",
    ]);
    assert.notEqual(result.status, 0);

    const invalidReport = writeActivationReport(activationRoot, manifest, (report) => {
      delete report.hosts.codex;
    });
    result = run(evidencePath, stageRoot, activationRoot, [
      "record", "--gate", "activation", "--status", "passed",
      "--manifest", staged.manifestPath, "--gate-command", "invalid activation",
      "--activation-report", invalidReport,
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing authenticated codex proof/);

    const activationReport = writeActivationReport(activationRoot, manifest);
    result = run(evidencePath, stageRoot, activationRoot, [
      "record", "--gate", "activation", "--status", "passed",
      "--manifest", staged.manifestPath, "--gate-command", "authenticated Claude and Codex activation",
      "--activation-report", activationReport,
    ]);
    assert.equal(result.status, 0, result.stderr);
    result = run(evidencePath, stageRoot, activationRoot, ["verify"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not bound to the staged Build Loop compatibility record/);

    result = run(evidencePath, stageRoot, activationRoot, [
      "record", "--gate", "activation", "--status", "passed",
      "--manifest", staged.manifestPath, "--gate-command", "replayed activation",
      "--activation-report", activationReport,
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /challenge has already been consumed/);

    result = run(evidencePath, stageRoot, activationRoot, [
      "record", "--gate", "host", "--status", "passed",
      "--manifest", staged.manifestPath, "--gate-command", "npm run test:host-release",
      "--metadata", JSON.stringify({
        platform: process.platform,
        buildLoopVersion: manifest.compatibility.buildLoop.version,
        buildLoopCommit: manifest.compatibility.buildLoop.commit,
        buildLoopAdapterDigest: manifest.compatibility.buildLoop.adapterDigest,
      }),
    ]);
    assert.equal(result.status, 0, result.stderr);
    result = run(evidencePath, stageRoot, activationRoot, ["verify"]);
    assert.equal(result.status, 0, result.stderr);

    const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
    assert.equal(evidence.gates.deterministic.status, "passed");
    assert.equal(evidence.gates.host.status, "passed");
    assert.equal(evidence.gates.activation.status, "passed");
    assert.equal(evidence.gates.deterministic.metadata.secret, undefined);
    assert.equal(evidence.gates.deterministic.artifactDigest, staged.artifactDigest);
    assert.equal(evidence.gates.host.artifactDigest, staged.artifactDigest);
    assert.equal(evidence.gates.activation.artifactDigest, staged.artifactDigest);

    fs.appendFileSync(activationReport, " ");
    result = run(evidencePath, stageRoot, activationRoot, ["verify"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /activation report digest does not match/);
    fs.writeFileSync(activationReport, fs.readFileSync(activationReport, "utf8").trimEnd());

    fs.appendFileSync(path.join(staged.artifactRoot, "package.json"), " ");
    result = run(evidencePath, stageRoot, activationRoot, ["verify"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /bytes no longer match/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("activation evidence fails closed across host-entrypoint trust boundaries", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "groundwork-activation-matrix-"));
  try {
    const staged = stageRelease({ releaseRoot: path.join(temp, "staged") });
    const manifest = JSON.parse(fs.readFileSync(staged.manifestPath, "utf8"));
    const cases: Array<[string, (report: any) => void, RegExp]> = [
      ["missing codex", (report) => { delete report.hosts.codex; }, /missing authenticated codex proof/],
      ["unauthenticated claude", (report) => { report.hosts.claude.authenticated = false; }, /missing authenticated claude proof/],
      ["wrong installed digest", (report) => { report.hosts.codex.installedArtifactDigest = "0".repeat(64); }, /different installed bytes/],
      ["wrong entrypoint", (report) => { report.hosts.claude.entrypoint = "direct-script"; }, /wrong claude entrypoint/],
      ["asserted only", (report) => { delete report.hosts.claude.probeArgv; }, /orchestrator-owned host probe/],
      ["host nonzero", (report) => { report.hosts.codex.probeExitCode = 1; }, /orchestrator-owned host probe/],
      ["wrong surface id", (report) => { report.hosts.codex.activationSurfaceId = "groundwork-codex-skill-v1-deadbeef"; }, /installed entrypoint surface id/],
      ["surface id disclosed", (report) => { report.hosts.claude.probeArgv.push(report.hosts.claude.activationSurfaceId); }, /disclosed its expected surface id/],
      ["missing bootstrap flag", (report) => { report.hosts.codex.launchArgv = ["node", "designer-server.mjs"]; }, /exactly one bootstrap path/],
      ["dead product path", (report) => {
        const bootstrapPath = report.hosts.codex.bootstrapPath;
        const bootstrap = JSON.parse(fs.readFileSync(bootstrapPath, "utf8"));
        bootstrap.product.repoPath = path.join(os.tmpdir(), `missing-groundwork-${crypto.randomBytes(8).toString("hex")}`);
        const bytes = `${JSON.stringify(bootstrap)}\n`;
        fs.writeFileSync(bootstrapPath, bytes);
        report.hosts.codex.bootstrapSha256 = sha256(bytes);
      }, /product path/],
      ["out mismatch", (report) => { const index = report.hosts.codex.launchArgv.indexOf("--out"); report.hosts.codex.launchArgv[index + 1] = report.hosts.claude.launchArgv[index + 1]; }, /bootstrap output path/],
      ["missing companion", (report) => { report.hosts.claude.baseline.companionPlatforms = []; }, /macOS-primary\/web-companion baseline/],
      ["replayed first decision", (report) => { report.hosts.codex.continuation.nextDecisionId = "nav-structure"; }, /next unresolved decision/],
      ["challenge mismatch", (report) => { report.challenge = "f".repeat(32); }, /does not bind the public entrypoint and challenge/],
      ["expired", (report) => {
        report.issuedAt = new Date(Date.now() - 30 * 60_000).toISOString();
        report.expiresAt = new Date(Date.now() - 15 * 60_000).toISOString();
      }, /expired or not yet valid/],
    ];
    for (const [name, mutate, expected] of cases) {
      const caseRoot = path.join(temp, "activation", name.replaceAll(" ", "-"));
      const report = writeActivationReport(caseRoot, manifest, mutate);
      const result = run(
        path.join(temp, `${name.replaceAll(" ", "-")}.json`),
        path.join(temp, "staged"),
        caseRoot,
        [
          "record", "--gate", "activation", "--status", "passed",
          "--manifest", staged.manifestPath, "--gate-command", name,
          "--activation-report", report,
        ],
      );
      assert.notEqual(result.status, 0, `${name} unexpectedly passed`);
      assert.match(result.stderr, expected, name);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("release evidence rejects a staged artifact reached through an escaping symlink", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "groundwork-release-symlink-"));
  try {
    const stageRoot = path.join(temp, "staged");
    const staged = stageRelease({ releaseRoot: stageRoot });
    const outsideRoot = path.join(temp, "outside-artifact");
    fs.cpSync(staged.artifactRoot, outsideRoot, { recursive: true });
    const linkedRoot = path.join(stageRoot, "linked-artifact");
    fs.symlinkSync(outsideRoot, linkedRoot, "dir");
    const result = run(
      path.join(temp, "release-evidence.v2.json"),
      stageRoot,
      path.join(temp, "activation"),
      [
        "record", "--gate", "deterministic", "--status", "passed",
        "--manifest", path.join(linkedRoot, "release-manifest.json"),
        "--gate-command", "symlink containment regression",
      ],
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must not traverse a symlink|escapes its owned root/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("activation challenge consumption survives intervening activation records", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "groundwork-activation-replay-ledger-"));
  try {
    const stageRoot = path.join(temp, "staged");
    const staged = stageRelease({ releaseRoot: stageRoot });
    const manifest = JSON.parse(fs.readFileSync(staged.manifestPath, "utf8"));
    const activationRoot = path.join(temp, "activation");
    const evidencePath = path.join(temp, "evidence.json");
    const first = writeActivationReport(activationRoot, manifest);
    const second = writeActivationReport(activationRoot, manifest);
    for (const report of [first, second]) {
      const result = run(evidencePath, stageRoot, activationRoot, [
        "record", "--gate", "activation", "--status", "passed",
        "--manifest", staged.manifestPath, "--gate-command", "fresh activation",
        "--activation-report", report,
      ]);
      assert.equal(result.status, 0, result.stderr);
    }
    const replay = run(evidencePath, stageRoot, activationRoot, [
      "record", "--gate", "activation", "--status", "passed",
      "--manifest", staged.manifestPath, "--gate-command", "A-B-A replay",
      "--activation-report", first,
    ]);
    assert.notEqual(replay.status, 0);
    assert.match(replay.stderr, /challenge has already been consumed/);
    const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
    assert.equal(evidence.consumedActivationChallenges.length, 2);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
