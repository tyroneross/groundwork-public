import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { completeSpec } from "./handoff-acceptance.test.js";
import {
  assertDisjointArtifactRoots,
  publishDerivedExport,
  withDerivedExportReservation,
} from "./derived-export.js";
import { exportSpecKit } from "./exporters/spec-kit.js";
import { exportOpenSpec } from "./exporters/openspec.js";
import type { DerivedExport } from "./exporters/types.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function temp(prefix: string): string {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
}

function tree(root: string, relative = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, tree(root, child));
    else result[child] = fs.readFileSync(path.join(root, ...child.split("/")), "utf8");
  }
  return result;
}

function manifestFingerprintAt(root: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, ".groundwork-export-manifest.json"))).digest("hex");
}

test("publisher deterministically creates and replaces complete managed trees", () => {
  const root = temp("groundwork-derived-repeat-");
  try {
    const spec = completeSpec();
    const destination = path.join(root, "derived");
    publishDerivedExport(destination, spec, exportSpecKit(spec));
    const first = tree(destination);
    publishDerivedExport(destination, spec, exportSpecKit(spec));
    assert.deepEqual(tree(destination), first);
    const manifest = JSON.parse(first[".groundwork-export-manifest.json"]);
    assert.equal(manifest.schema, "groundwork.derived-export/v1");
    assert.equal(manifest.derivedFrom, "Groundwork");
    assert.equal(manifest.files.length, 4);
    assert.equal(Object.hasOwn(manifest, "generatedAt"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("publisher treats raw manifest bytes as part of the exact managed generation", () => {
  const root = temp("groundwork-derived-manifest-bytes-");
  try {
    const spec = completeSpec();
    const destination = path.join(root, "derived");
    publishDerivedExport(destination, spec, exportSpecKit(spec));
    const manifestPath = path.join(destination, ".groundwork-export-manifest.json");
    fs.appendFileSync(manifestPath, "\n");
    assert.throws(() => publishDerivedExport(destination, spec, exportSpecKit(spec)), /modified derived export manifest bytes/);
    assert.match(fs.readFileSync(manifestPath, "utf8"), /\n\n$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("publisher rejects projections stamped for a different canonical Spec generation", () => {
  const root = temp("groundwork-derived-source-binding-");
  try {
    const specA = completeSpec();
    const specB = JSON.parse(JSON.stringify(specA));
    specB.productName = `${specA.productName} Next`;
    assert.throws(
      () => publishDerivedExport(path.join(root, "derived"), specB, exportSpecKit(specA)),
      /source stamp does not match/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("publisher rejects unsafe, duplicate, case-folded, and prefix-colliding paths", () => {
  const root = temp("groundwork-derived-paths-");
  try {
    const spec = completeSpec();
    const base = exportSpecKit(spec);
    const cases: Array<Array<{ path: string; content: string }>> = [
      [{ path: "../outside", content: "x" }],
      [{ path: "/absolute", content: "x" }],
      [{ path: "C:\\outside", content: "x" }],
      [{ path: "a\\b", content: "x" }],
      [{ path: "a//b", content: "x" }],
      [{ path: "same", content: "x" }, { path: "same", content: "y" }],
      [{ path: "Case", content: "x" }, { path: "case", content: "y" }],
      [{ path: "parent", content: "x" }, { path: "parent/child", content: "y" }],
    ];
    const sentinel = path.join(root, "outside");
    fs.writeFileSync(sentinel, "survive");
    for (const files of cases) {
      const candidate: DerivedExport = { ...base, files };
      assert.throws(() => publishDerivedExport(path.join(root, "derived"), spec, candidate));
      assert.equal(fs.readFileSync(sentinel, "utf8"), "survive");
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("publisher refuses symlink, unmanaged, modified, and tampered destinations", () => {
  const root = temp("groundwork-derived-owned-");
  try {
    const spec = completeSpec();
    const exported = exportSpecKit(spec);
    const outside = path.join(root, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "sentinel"), "survive");
    const linked = path.join(root, "linked");
    fs.symlinkSync(outside, linked, "dir");
    assert.throws(() => publishDerivedExport(linked, spec, exported), /non-symlink directory/);
    assert.equal(fs.readFileSync(path.join(outside, "sentinel"), "utf8"), "survive");

    const unmanaged = path.join(root, "unmanaged");
    fs.mkdirSync(unmanaged);
    fs.writeFileSync(path.join(unmanaged, "README.md"), "user");
    assert.throws(() => publishDerivedExport(unmanaged, spec, exported), /without a Groundwork/);
    assert.equal(fs.readFileSync(path.join(unmanaged, "README.md"), "utf8"), "user");

    const managed = path.join(root, "managed");
    publishDerivedExport(managed, spec, exported);
    const tracked = path.join(managed, ...exported.files[0].path.split("/"));
    fs.writeFileSync(tracked, "modified");
    assert.throws(() => publishDerivedExport(managed, spec, exported), /modified derived export file/);
    assert.equal(fs.readFileSync(tracked, "utf8"), "modified");

    const nestedLink = path.join(root, "nested-link");
    publishDerivedExport(nestedLink, spec, exported);
    const nestedTracked = path.join(nestedLink, ...exported.files[0].path.split("/"));
    fs.rmSync(nestedTracked);
    fs.symlinkSync(path.join(outside, "sentinel"), nestedTracked);
    assert.throws(() => publishDerivedExport(nestedLink, spec, exported), /symlink/);
    assert.equal(fs.readFileSync(path.join(outside, "sentinel"), "utf8"), "survive");

    const tamperedManifest = path.join(root, "tampered-manifest");
    publishDerivedExport(tamperedManifest, spec, exported);
    const manifestPath = path.join(tamperedManifest, ".groundwork-export-manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.untrusted = true;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(() => publishDerivedExport(tamperedManifest, spec, exported), /unsupported fields/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("publisher recovers an interrupted old-tree backup before the next generation", () => {
  const root = temp("groundwork-derived-recover-");
  try {
    const spec = completeSpec();
    const exported = exportSpecKit(spec);
    const destination = path.join(root, "managed");
    publishDerivedExport(destination, spec, exported);
    const before = tree(destination);
    const realDestination = path.join(fs.realpathSync(root), "managed");
    const key = crypto.createHash("sha256").update(realDestination).digest("hex").slice(0, 16);
    const tx = path.join(root, `.groundwork-export-tx-${key}-crash`);
    fs.mkdirSync(tx);
    fs.mkdirSync(path.join(tx, "stage"));
    fs.renameSync(destination, path.join(tx, "backup"));
    fs.writeFileSync(path.join(tx, "journal.json"), `${JSON.stringify({
      schema: "groundwork.derived-export-transaction/v2",
      targetName: "managed",
      phase: "backed-up",
      expectedNewManifestSha256: manifestFingerprintAt(path.join(tx, "backup")),
      priorExisted: true,
      priorManifestSha256: manifestFingerprintAt(path.join(tx, "backup")),
      canonicalProof: null,
    }, null, 2)}\n`);

    publishDerivedExport(destination, spec, exported);
    assert.deepEqual(tree(destination), before);
    assert.equal(fs.existsSync(tx), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("publisher safely removes a journal-free pre-commit transaction", () => {
  const root = temp("groundwork-derived-journal-free-");
  try {
    const spec = completeSpec();
    const exported = exportSpecKit(spec);
    const destination = path.join(root, "managed");
    const realDestination = path.join(fs.realpathSync(root), "managed");
    const key = crypto.createHash("sha256").update(realDestination).digest("hex").slice(0, 16);
    const tx = path.join(root, `.groundwork-export-tx-${key}-crash`);
    fs.mkdirSync(path.join(tx, "stage", "partial"), { recursive: true });
    fs.writeFileSync(path.join(tx, "stage", "partial", "file.md"), "incomplete");

    publishDerivedExport(destination, spec, exported);
    assert.ok(fs.existsSync(path.join(destination, ".groundwork-export-manifest.json")));
    assert.equal(fs.existsSync(tx), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("reservation excludes a competing publisher through the final derived commit", () => {
  const root = temp("groundwork-derived-reservation-");
  try {
    const spec = completeSpec();
    const exported = exportSpecKit(spec);
    const destination = path.join(root, "managed");
    withDerivedExportReservation(destination, exported, (publish) => {
      assert.throws(() => publishDerivedExport(destination, spec, exported), /Another derived export publisher/);
      publish(spec);
    });
    assert.ok(fs.existsSync(path.join(destination, ".groundwork-export-manifest.json")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("concurrent unmanaged insertion is restored and never deleted", () => {
  const root = temp("groundwork-derived-capture-");
  const prior = process.env.GROUNDWORK_TEST_MUTATE_DERIVED_EXPORT;
  try {
    const spec = completeSpec();
    const exported = exportSpecKit(spec);
    const destination = path.join(root, "managed");
    publishDerivedExport(destination, spec, exported);
    process.env.GROUNDWORK_TEST_MUTATE_DERIVED_EXPORT = "add-unmanaged";
    assert.throws(() => publishDerivedExport(destination, spec, exported), /unmanaged or missing entries/);
    assert.equal(fs.readFileSync(path.join(destination, "user.txt"), "utf8"), "preserve");
  } finally {
    if (prior === undefined) delete process.env.GROUNDWORK_TEST_MUTATE_DERIVED_EXPORT;
    else process.env.GROUNDWORK_TEST_MUTATE_DERIVED_EXPORT = prior;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("concurrent bytes inserted after install are quarantined instead of deleted", () => {
  const root = temp("groundwork-derived-after-install-mutation-");
  const prior = process.env.GROUNDWORK_TEST_MUTATE_DERIVED_EXPORT;
  try {
    const spec = completeSpec();
    const exported = exportSpecKit(spec);
    const destination = path.join(root, "managed");
    publishDerivedExport(destination, spec, exported);
    const before = tree(destination);
    process.env.GROUNDWORK_TEST_MUTATE_DERIVED_EXPORT = "add-unmanaged-after-install";
    assert.throws(() => publishDerivedExport(destination, spec, exportOpenSpec(spec)), /preserved in a sibling conflict directory/);
    assert.deepEqual(tree(destination), before, "the prior managed generation is restored");
    const conflict = fs.readdirSync(root).find((name) => name.startsWith(".groundwork-export-conflict-"));
    assert.ok(conflict, "concurrent bytes must be retained in a quarantine tree");
    assert.equal(fs.readFileSync(path.join(root, conflict, "user.txt"), "utf8"), "preserve");
  } finally {
    if (prior === undefined) delete process.env.GROUNDWORK_TEST_MUTATE_DERIVED_EXPORT;
    else process.env.GROUNDWORK_TEST_MUTATE_DERIVED_EXPORT = prior;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a different valid managed generation cannot substitute for the intended install", () => {
  const root = temp("groundwork-derived-generation-swap-");
  const prior = process.env.GROUNDWORK_TEST_REPLACE_DERIVED_EXPORT_AFTER_INSTALL;
  try {
    const spec = completeSpec();
    const destination = path.join(root, "managed");
    const replacement = path.join(root, "replacement");
    publishDerivedExport(destination, spec, exportSpecKit(spec));
    const before = tree(destination);
    publishDerivedExport(replacement, spec, exportSpecKit(spec));
    process.env.GROUNDWORK_TEST_REPLACE_DERIVED_EXPORT_AFTER_INSTALL = replacement;
    assert.throws(
      () => publishDerivedExport(destination, spec, exportOpenSpec(spec)),
      /does not match the transaction generation.*preserved/s,
    );
    assert.deepEqual(tree(destination), before);
    const conflict = fs.readdirSync(root).find((name) => name.startsWith(".groundwork-export-conflict-"));
    assert.ok(conflict);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, conflict, ".groundwork-export-manifest.json"), "utf8"));
    assert.equal(manifest.format, "spec-kit");
  } finally {
    if (prior === undefined) delete process.env.GROUNDWORK_TEST_REPLACE_DERIVED_EXPORT_AFTER_INSTALL;
    else process.env.GROUNDWORK_TEST_REPLACE_DERIVED_EXPORT_AFTER_INSTALL = prior;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("recovery preserves a substituted valid generation and restores the bound prior generation", () => {
  const root = temp("groundwork-derived-recovery-generation-");
  try {
    const spec = completeSpec();
    const destination = path.join(root, "managed");
    const expectedNew = path.join(root, "expected-new");
    const substituted = path.join(root, "substituted");
    publishDerivedExport(destination, spec, exportSpecKit(spec));
    const priorTree = tree(destination);
    const priorManifestSha256 = manifestFingerprintAt(destination);
    publishDerivedExport(expectedNew, spec, exportOpenSpec(spec));
    const expectedNewManifestSha256 = manifestFingerprintAt(expectedNew);
    const specC = JSON.parse(JSON.stringify(spec));
    specC.productName = `${spec.productName} Concurrent`;
    publishDerivedExport(substituted, specC, exportSpecKit(specC));

    const realDestination = path.join(fs.realpathSync(root), "managed");
    const key = crypto.createHash("sha256").update(realDestination).digest("hex").slice(0, 16);
    const tx = path.join(root, `.groundwork-export-tx-${key}-crash`);
    fs.mkdirSync(tx);
    fs.renameSync(expectedNew, path.join(tx, "stage"));
    fs.renameSync(destination, path.join(tx, "backup"));
    fs.renameSync(substituted, destination);
    fs.writeFileSync(path.join(tx, "journal.json"), `${JSON.stringify({
      schema: "groundwork.derived-export-transaction/v2",
      targetName: "managed",
      phase: "installed",
      expectedNewManifestSha256,
      priorExisted: true,
      priorManifestSha256,
      canonicalProof: null,
    }, null, 2)}\n`);

    assert.throws(() => publishDerivedExport(destination, spec, exportOpenSpec(spec)), /conflicting derived export generation was preserved/);
    assert.deepEqual(tree(destination), priorTree);
    const conflict = fs.readdirSync(root).find((name) => name.startsWith(".groundwork-export-conflict-"));
    assert.ok(conflict);
    assert.equal(fs.existsSync(tx), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("prior manifests cannot exceed the aggregate 64 MiB tree limit", () => {
  const root = temp("groundwork-derived-tree-cap-");
  try {
    const destination = path.join(root, "managed");
    fs.mkdirSync(destination);
    const entries = Array.from({ length: 5 }, (_, index) => ({
      path: index === 0 ? "groundwork-source.json" : `file-${index}.md`,
      sha256: crypto.createHash("sha256").update("").digest("hex"),
      bytes: 14 * 1024 * 1024,
    }));
    for (const entry of entries) fs.writeFileSync(path.join(destination, entry.path), "");
    fs.writeFileSync(path.join(destination, ".groundwork-export-manifest.json"), `${JSON.stringify({
      schema: "groundwork.derived-export/v1",
      derivedFrom: "Groundwork",
      format: "spec-kit",
      exporterVersion: "1",
      spec: { id: "spec-large", schemaVersion: 3, digest: `sha256:${"0".repeat(64)}` },
      upstreamSourceStamp: "groundwork-source.json",
      files: entries,
    }, null, 2)}\n`);
    assert.throws(() => publishDerivedExport(destination, completeSpec(), exportSpecKit(completeSpec())), /64 MiB tree limit/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const failure of ["after-staging", "after-backup", "after-install"] as const) {
  test(`publisher restores the exact prior tree after ${failure} failure`, () => {
    const root = temp(`groundwork-derived-${failure}-`);
    const prior = process.env.GROUNDWORK_TEST_FAIL_DERIVED_EXPORT;
    try {
      const spec = completeSpec();
      const destination = path.join(root, "managed");
      publishDerivedExport(destination, spec, exportSpecKit(spec));
      const before = tree(destination);
      process.env.GROUNDWORK_TEST_FAIL_DERIVED_EXPORT = failure;
      assert.throws(() => publishDerivedExport(destination, spec, exportOpenSpec(spec)), /Injected derived export failure/);
      assert.deepEqual(tree(destination), before);
      assert.equal(fs.readdirSync(root).some((name) => name.includes("groundwork-export-tx")), false);
    } finally {
      if (prior === undefined) delete process.env.GROUNDWORK_TEST_FAIL_DERIVED_EXPORT;
      else process.env.GROUNDWORK_TEST_FAIL_DERIVED_EXPORT = prior;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test("canonical and derived roots must be fully disjoint", () => {
  assert.throws(() => assertDisjointArtifactRoots("/tmp/a", "/tmp/a"), /disjoint/);
  assert.throws(() => assertDisjointArtifactRoots("/tmp/a", "/tmp/a/export"), /disjoint/);
  assert.throws(() => assertDisjointArtifactRoots("/tmp/a/canonical", "/tmp/a"), /disjoint/);
  assert.doesNotThrow(() => assertDisjointArtifactRoots("/tmp/a", "/tmp/b"));
});

test("disjointness follows an existing symlinked ancestor", () => {
  const root = temp("groundwork-derived-disjoint-link-");
  try {
    const core = path.join(root, "core");
    const alias = path.join(root, "alias");
    fs.mkdirSync(core);
    fs.symlinkSync(core, alias, "dir");
    assert.throws(() => assertDisjointArtifactRoots(core, path.join(alias, "derived")), /disjoint/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("reservation rechecks disjointness after an ancestor symlink swap", () => {
  const root = temp("groundwork-derived-disjoint-swap-");
  try {
    const spec = completeSpec();
    const core = path.join(root, "core");
    const disjoint = path.join(root, "disjoint");
    const alias = path.join(root, "alias");
    fs.mkdirSync(core);
    fs.mkdirSync(disjoint);
    fs.symlinkSync(disjoint, alias, "dir");
    const destination = path.join(alias, "derived");
    assert.doesNotThrow(() => assertDisjointArtifactRoots(core, destination));
    fs.rmSync(alias);
    fs.symlinkSync(core, alias, "dir");
    assert.throws(
      () => withDerivedExportReservation(destination, exportSpecKit(spec), () => undefined, { canonicalRoot: core }),
      /disjoint/,
    );
    assert.equal(fs.existsSync(path.join(core, "derived")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CLI keeps canonical and derived roots on the prior generation for every derived failure phase", () => {
  const root = temp("groundwork-derived-cross-root-rollback-");
  try {
    const specAPath = path.join(root, "spec-a.json");
    const specBPath = path.join(root, "spec-b.json");
    const specA = completeSpec();
    const specB = JSON.parse(JSON.stringify(specA));
    specB.productName = `${specA.productName} Next`;
    fs.writeFileSync(specAPath, `${JSON.stringify(specA, null, 2)}\n`);
    fs.writeFileSync(specBPath, `${JSON.stringify(specB, null, 2)}\n`);
    for (const failure of ["after-staging", "after-backup", "after-install"]) {
      const canonical = path.join(root, `canonical-${failure}`);
      const derived = path.join(root, `derived-${failure}`);
      const first = spawnSync(
        "npx",
        ["tsx", "engine/src/cli.ts", specAPath, "--out", canonical, "--export", "spec-kit", "--export-out", derived],
        { cwd: ROOT, encoding: "utf8" },
      );
      assert.equal(first.status, 0, first.stderr);
      const canonicalBefore = tree(canonical);
      const derivedBefore = tree(derived);
      const second = spawnSync(
        "npx",
        ["tsx", "engine/src/cli.ts", specBPath, "--out", canonical, "--export", "openspec", "--export-out", derived],
        {
          cwd: ROOT,
          encoding: "utf8",
          env: { ...process.env, GROUNDWORK_TEST_FAIL_DERIVED_EXPORT: failure },
        },
      );
      assert.notEqual(second.status, 0, `${failure} must fail`);
      assert.deepEqual(tree(canonical), canonicalBefore, `${failure} must preserve canonical A`);
      assert.deepEqual(tree(derived), derivedBefore, `${failure} must preserve derived A`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CLI rolls derived back when canonical atomic publication fails", () => {
  const root = temp("groundwork-derived-canonical-rollback-");
  try {
    const specA = completeSpec();
    const specB = JSON.parse(JSON.stringify(specA));
    specB.productName = `${specA.productName} Next`;
    const specAPath = path.join(root, "spec-a.json");
    const specBPath = path.join(root, "spec-b.json");
    const canonical = path.join(root, "canonical");
    const derived = path.join(root, "derived");
    fs.writeFileSync(specAPath, `${JSON.stringify(specA, null, 2)}\n`);
    fs.writeFileSync(specBPath, `${JSON.stringify(specB, null, 2)}\n`);
    const first = spawnSync("npx", ["tsx", "engine/src/cli.ts", specAPath, "--out", canonical, "--export", "spec-kit", "--export-out", derived], { cwd: ROOT, encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    const canonicalBefore = tree(canonical);
    const derivedBefore = tree(derived);
    const failed = spawnSync(
      "npx",
      ["tsx", "engine/src/cli.ts", specBPath, "--out", canonical, "--export", "openspec", "--export-out", derived],
      { cwd: ROOT, encoding: "utf8", env: { ...process.env, GROUNDWORK_TEST_FAIL_AFTER_INSTALL: "1" } },
    );
    assert.notEqual(failed.status, 0);
    assert.deepEqual(tree(canonical), canonicalBefore);
    assert.deepEqual(tree(derived), derivedBefore);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("real CLI requires explicit export pairs and publishes both adapters without upstream runtimes", () => {
  const root = temp("groundwork-derived-cli-");
  try {
    const specPath = path.join(root, "spec.json");
    fs.writeFileSync(specPath, `${JSON.stringify(completeSpec(), null, 2)}\n`);
    const invalid = [
      [specPath, "--export", "spec-kit"],
      [specPath, "--export-out", path.join(root, "missing-format")],
      [specPath, "--export", "unknown", "--export-out", path.join(root, "unknown")],
      [specPath, "--bogus"],
      [specPath, "extra.json"],
      [specPath, "--export-out="],
      [specPath, "--out="],
      [specPath, "--export", "spec-kit", "--export", "spec-kit", "--export-out", path.join(root, "duplicate")],
    ];
    for (const args of invalid) {
      const result = spawnSync("npx", ["tsx", "engine/src/cli.ts", ...args], { cwd: ROOT, encoding: "utf8" });
      assert.notEqual(result.status, 0, `${args.join(" ")} must fail`);
    }
    for (const format of ["spec-kit", "openspec"]) {
      const canonical = path.join(root, `canonical-${format}`);
      const derived = path.join(root, `derived-${format}`);
      const result = spawnSync("npx", ["tsx", "engine/src/cli.ts", specPath, "--out", canonical, "--export", format, "--export-out", derived], { cwd: ROOT, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(fs.existsSync(path.join(canonical, "spec.json")));
      assert.ok(fs.existsSync(path.join(derived, ".groundwork-export-manifest.json")));
      assert.match(result.stderr, /"event":"derived_export_written"/);
    }

    const blockedDerived = path.join(root, "blocked-derived");
    const blockedCanonical = path.join(root, "blocked-canonical");
    fs.mkdirSync(blockedDerived);
    fs.writeFileSync(path.join(blockedDerived, "user.txt"), "preserve");
    const blocked = spawnSync("npx", ["tsx", "engine/src/cli.ts", specPath, "--out", blockedCanonical, "--export", "spec-kit", "--export-out", blockedDerived], { cwd: ROOT, encoding: "utf8" });
    assert.notEqual(blocked.status, 0);
    assert.equal(fs.existsSync(blockedCanonical), false, "invalid derived destination must fail before canonical output mutation");
    assert.equal(fs.readFileSync(path.join(blockedDerived, "user.txt"), "utf8"), "preserve");

    const linkedCore = path.join(root, "linked-core");
    const linkedAlias = path.join(root, "linked-alias");
    fs.mkdirSync(linkedCore);
    fs.symlinkSync(linkedCore, linkedAlias, "dir");
    const linked = spawnSync("npx", ["tsx", "engine/src/cli.ts", specPath, "--out", linkedCore, "--export", "spec-kit", "--export-out", path.join(linkedAlias, "derived")], { cwd: ROOT, encoding: "utf8" });
    assert.notEqual(linked.status, 0);
    assert.equal(fs.existsSync(path.join(linkedCore, "derived")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
