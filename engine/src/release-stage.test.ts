import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
// @ts-expect-error The release builder is a runtime JavaScript module.
import { assertRegularReleaseInput, stageRelease } from "../../scripts/stage-release.mjs";

test("engine bundle contains only owned source and Node built-ins", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const result = buildSync({
    absWorkingDir: root, entryPoints: ["engine/src/cli.ts"], outfile: "engine/dist/cli.js",
    bundle: true, platform: "node", format: "esm", write: false, metafile: true,
  });
  const inputs = Object.keys(result.metafile!.inputs);
  assert.ok(inputs.includes("engine/src/validation.ts"));
  assert.ok(inputs.every((input) => input.startsWith("engine/src/")), "runtime library entered the bundle");
  for (const output of Object.values(result.metafile!.outputs)) {
    assert.ok(output.imports.every((item) => item.external && item.path.startsWith("node:")));
  }
  assert.equal(result.outputFiles![0].text, fs.readFileSync(path.join(root, "engine/dist/cli.js"), "utf8"), "committed bundle must match current source");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.deepEqual(pkg.dependencies ?? {}, {});
});

test("release excludes local preference journals and captured dashboards", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const journal = path.join(root, "designer/color/combos.jsonl");
  const capture = path.join(root, "designer/references/dashboards/publication-private-test.html");
  const previousJournal = fs.existsSync(journal) ? fs.readFileSync(journal) : null;
  assert.equal(fs.existsSync(capture), false);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "groundwork-private-release-test-"));
  try {
    fs.writeFileSync(journal, '{"choice":"PRIVATE_SENTINEL"}\n');
    fs.writeFileSync(capture, '<html>PRIVATE_SENTINEL</html>');
    const staged = stageRelease({ releaseRoot: temp });
    const manifest = JSON.parse(fs.readFileSync(staged.manifestPath, "utf8"));
    const names = manifest.files.map((file: {path: string}) => file.path);
    assert.equal(names.includes("designer/color/combos.jsonl"), false);
    assert.equal(names.includes("designer/references/dashboards/publication-private-test.html"), false);
    for (const name of ["LICENSE", "NOTICE", "THIRD-PARTY-NOTICES.md", "PUBLICATION-ATTESTATION.md"]) {
      assert.ok(names.includes(name));
    }
  } finally {
    if (previousJournal !== null) fs.writeFileSync(journal, previousJournal);
    else fs.rmSync(journal, { force: true });
    fs.rmSync(capture, { force: true });
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("release staging is reproducible, explicit, and free of development state", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "groundwork-release-stage-test-"));
  try {
    const first = stageRelease({ releaseRoot: temp });
    const second = stageRelease({ releaseRoot: temp });
    assert.equal(second.artifactDigest, first.artifactDigest);
    assert.equal(second.artifactRoot, first.artifactRoot);
    const manifest = JSON.parse(fs.readFileSync(first.manifestPath, "utf8"));
    assert.equal(manifest.artifactDigest, first.artifactDigest);
    assert.equal(manifest.fileCount, manifest.files.length);
    const names = manifest.files.map((item: { path: string }) => item.path);
    assert.ok(names.includes("commands/run.md"));
    assert.ok(names.includes("skills/groundwork/SKILL.md"));
    assert.ok(names.includes("engine/dist/cli.js"));
    assert.ok(names.includes(".groundwork-release-policy.json"));
    assert.ok(names.includes("docs/contracts/exchange.md"));
    assert.equal(names.some((name: string) => /(^|\/)(?:tests|plans|node_modules|\.build-loop|\.designer|__pycache__)(\/|$)/.test(name)), false);
    assert.equal(names.some((name: string) => /(?:\.pem|\.key|\.p12|\.pfx|\.env)$/i.test(name)), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("release staging carries the canonical Build Loop host-parity pin", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "groundwork-release-policy-test-"));
  try {
    const staged = stageRelease({ releaseRoot: temp });
    const manifest = JSON.parse(fs.readFileSync(staged.manifestPath, "utf8"));
    const stagedPolicy = JSON.parse(fs.readFileSync(path.join(staged.artifactRoot, ".groundwork-release-policy.json"), "utf8"));
    const expected = {
      version: "0.39.0",
      commit: "a62a3571ad971df49e483dbbd7d00f158ec40deb",
      adapterDigest: "f020ee8ee787c1ced7e4961cdcffba6831a06c852bd4cdeabe0d495227c15732",
      distributionTestDigest: "95d4d1748c0ba1f2c4a6f701c78543c56ecb32dc7fa64ace46634eb838e8f85c",
    };
    assert.deepEqual(stagedPolicy.compatibility.buildLoop, expected);
    assert.deepEqual(manifest.compatibility.buildLoop, expected);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("release staging rejects explicit symlink inputs", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "groundwork-release-symlink-test-"));
  try {
    const target = path.join(temp, "target.json");
    const link = path.join(temp, "package.json");
    fs.writeFileSync(target, "{}\n");
    fs.symlinkSync(target, link);
    assert.throws(() => assertRegularReleaseInput(link), /regular non-symlink file/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("release staging rejects a contaminated existing candidate with a nested release manifest", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "groundwork-release-reuse-test-"));
  try {
    const staged = stageRelease({ releaseRoot: temp });
    const nested = path.join(staged.artifactRoot, "unexpected", "release-manifest.json");
    fs.mkdirSync(path.dirname(nested), { recursive: true });
    fs.writeFileSync(nested, '{"artifactDigest":"not-owned"}\n');

    assert.throws(
      () => stageRelease({ releaseRoot: temp }),
      /Existing staged directory disagrees/,
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
