import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  recoverArtifactTransactions,
  writeArtifactSetAtomically,
} from "./atomic-write.js";

function tempRoot(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("recovery rejects a traversal journal without reading, renaming, or deleting outside output", () => {
  const root = tempRoot("groundwork-atomic-traversal-");
  try {
    const out = path.join(root, "out");
    const victim = path.join(root, "victim.txt");
    const tx = path.join(out, ".groundwork-tx-malicious");
    fs.mkdirSync(path.join(tx, "stage"), { recursive: true });
    fs.mkdirSync(path.join(tx, "backup"), { recursive: true });
    fs.writeFileSync(victim, "must survive");
    fs.writeFileSync(path.join(tx, "journal.json"), JSON.stringify({
      schema: "groundwork.transaction/v2",
      generationId: "malicious",
      files: [{ name: "../victim.txt", existed: false, operation: "publish" }],
      hashes: {},
    }));

    assert.throws(
      () => recoverArtifactTransactions(out),
      /unsafe managed file name/,
    );
    assert.equal(fs.readFileSync(victim, "utf8"), "must survive");
    assert.ok(fs.existsSync(tx), "unsafe transaction is retained for inspection instead of being recursively removed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("recovery rejects symlink transaction directories and does not touch their targets", () => {
  const root = tempRoot("groundwork-atomic-symlink-");
  try {
    const out = path.join(root, "out");
    const outside = path.join(root, "outside");
    fs.mkdirSync(out);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "marker.txt"), "must survive");
    fs.symlinkSync(outside, path.join(out, ".groundwork-tx-symlink"), "dir");

    assert.throws(
      () => recoverArtifactTransactions(out),
      /non-symlink directory/,
    );
    assert.equal(fs.readFileSync(path.join(outside, "marker.txt"), "utf8"), "must survive");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("recovery rejects symlink files inside an otherwise well-formed transaction", () => {
  const root = tempRoot("groundwork-atomic-file-symlink-");
  try {
    const out = path.join(root, "out");
    const outside = path.join(root, "outside.txt");
    const generationId = "file-symlink";
    const tx = path.join(out, `.groundwork-tx-${generationId}`);
    const stage = path.join(tx, "stage");
    fs.mkdirSync(stage, { recursive: true });
    fs.mkdirSync(path.join(tx, "backup"));
    fs.writeFileSync(outside, "must survive");
    fs.symlinkSync(outside, path.join(stage, "spec.json"));
    fs.writeFileSync(path.join(stage, "artifact-manifest.json"), "{}\n");
    fs.writeFileSync(path.join(tx, "journal.json"), JSON.stringify({
      schema: "groundwork.transaction/v2",
      generationId,
      files: [
        { name: "spec.json", existed: false, operation: "publish" },
        { name: "artifact-manifest.json", existed: false, operation: "publish" },
      ],
      hashes: { "spec.json": "0".repeat(64) },
    }));

    assert.throws(
      () => recoverArtifactTransactions(out),
      /non-symlink file/,
    );
    assert.equal(fs.readFileSync(outside, "utf8"), "must survive");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a new generation transactionally removes stale artifacts tracked by the prior manifest", () => {
  const out = tempRoot("groundwork-atomic-stale-");
  try {
    writeArtifactSetAtomically(out, {
      "spec.json": "{\"generation\":1}\n",
      "convergence.json": "{\"status\":\"verified\"}\n",
    });
    assert.ok(fs.existsSync(path.join(out, "convergence.json")));

    writeArtifactSetAtomically(out, {
      "spec.json": "{\"generation\":2}\n",
    });

    assert.equal(fs.existsSync(path.join(out, "convergence.json")), false);
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "artifact-manifest.json"), "utf8"));
    assert.deepEqual(manifest.files.map((entry: { name: string }) => entry.name), ["spec.json"]);
    assert.equal(fs.readFileSync(path.join(out, "spec.json"), "utf8"), "{\"generation\":2}\n");
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("a failed generation restores both overwritten and transactionally removed artifacts", () => {
  const out = tempRoot("groundwork-atomic-removal-rollback-");
  const priorFailurePoint = process.env.GROUNDWORK_TEST_FAIL_AFTER_INSTALL;
  try {
    writeArtifactSetAtomically(out, {
      "spec.json": "{\"generation\":1}\n",
      "convergence.json": "{\"status\":\"verified\"}\n",
    });
    const before = Object.fromEntries(
      ["spec.json", "convergence.json", "artifact-manifest.json"]
        .map((name) => [name, fs.readFileSync(path.join(out, name), "utf8")]),
    );

    // Sorted operations are spec publish, convergence removal, manifest publish.
    // Fail after the removal to prove rollback restores both operation types.
    process.env.GROUNDWORK_TEST_FAIL_AFTER_INSTALL = "2";
    assert.throws(
      () => writeArtifactSetAtomically(out, { "spec.json": "{\"generation\":2}\n" }),
      /Injected artifact transaction failure/,
    );

    for (const [name, contents] of Object.entries(before)) {
      assert.equal(fs.readFileSync(path.join(out, name), "utf8"), contents, `${name} restored byte-for-byte`);
    }
    assert.equal(fs.readdirSync(out).some((name) => name.startsWith(".groundwork-tx-")), false);
  } finally {
    if (priorFailurePoint === undefined) delete process.env.GROUNDWORK_TEST_FAIL_AFTER_INSTALL;
    else process.env.GROUNDWORK_TEST_FAIL_AFTER_INSTALL = priorFailurePoint;
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("stale managed artifacts modified after publication are not silently deleted", () => {
  const out = tempRoot("groundwork-atomic-modified-");
  try {
    writeArtifactSetAtomically(out, {
      "spec.json": "{\"generation\":1}\n",
      "convergence.json": "{\"status\":\"verified\"}\n",
    });
    fs.writeFileSync(path.join(out, "convergence.json"), "user-modified\n");

    assert.throws(
      () => writeArtifactSetAtomically(out, { "spec.json": "{\"generation\":2}\n" }),
      /Refusing to remove modified managed artifact/,
    );
    assert.equal(fs.readFileSync(path.join(out, "convergence.json"), "utf8"), "user-modified\n");
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("canonical publisher rejects a concurrent replacement and preserves its bytes", () => {
  const out = tempRoot("groundwork-atomic-concurrent-success-");
  const priorMutation = process.env.GROUNDWORK_TEST_MUTATE_ARTIFACT_AFTER_INSTALL;
  try {
    writeArtifactSetAtomically(out, { "spec.json": "{\"generation\":1}\n" });
    process.env.GROUNDWORK_TEST_MUTATE_ARTIFACT_AFTER_INSTALL = "spec.json";
    assert.throws(
      () => writeArtifactSetAtomically(out, { "spec.json": "{\"generation\":2}\n" }),
      /changed during publication.*preserved/s,
    );
    assert.equal(fs.readFileSync(path.join(out, "spec.json"), "utf8"), "{\"generation\":1}\n");
    const conflict = fs.readdirSync(path.dirname(out)).find((name) => name.startsWith(`.groundwork-artifact-conflict-${path.basename(out)}-`));
    assert.ok(conflict);
    assert.equal(fs.readFileSync(path.join(path.dirname(out), conflict, "spec.json"), "utf8"), "concurrent-preserve\n");
  } finally {
    if (priorMutation === undefined) delete process.env.GROUNDWORK_TEST_MUTATE_ARTIFACT_AFTER_INSTALL;
    else process.env.GROUNDWORK_TEST_MUTATE_ARTIFACT_AFTER_INSTALL = priorMutation;
    fs.rmSync(out, { recursive: true, force: true });
    for (const name of fs.readdirSync(path.dirname(out))) {
      if (name.startsWith(`.groundwork-artifact-conflict-${path.basename(out)}-`)) fs.rmSync(path.join(path.dirname(out), name), { recursive: true, force: true });
    }
  }
});

test("canonical rollback quarantines concurrent bytes instead of deleting them", () => {
  const out = tempRoot("groundwork-atomic-concurrent-failure-");
  const priorMutation = process.env.GROUNDWORK_TEST_MUTATE_ARTIFACT_AFTER_INSTALL;
  const priorFailure = process.env.GROUNDWORK_TEST_FAIL_AFTER_INSTALL;
  try {
    writeArtifactSetAtomically(out, { "spec.json": "{\"generation\":1}\n" });
    process.env.GROUNDWORK_TEST_MUTATE_ARTIFACT_AFTER_INSTALL = "spec.json";
    process.env.GROUNDWORK_TEST_FAIL_AFTER_INSTALL = "1";
    assert.throws(
      () => writeArtifactSetAtomically(out, { "spec.json": "{\"generation\":2}\n" }),
      /Injected artifact transaction failure.*preserved/s,
    );
    assert.equal(fs.readFileSync(path.join(out, "spec.json"), "utf8"), "{\"generation\":1}\n");
    const conflict = fs.readdirSync(path.dirname(out)).find((name) => name.startsWith(`.groundwork-artifact-conflict-${path.basename(out)}-`));
    assert.ok(conflict);
    assert.equal(fs.readFileSync(path.join(path.dirname(out), conflict, "spec.json"), "utf8"), "concurrent-preserve\n");
  } finally {
    if (priorMutation === undefined) delete process.env.GROUNDWORK_TEST_MUTATE_ARTIFACT_AFTER_INSTALL;
    else process.env.GROUNDWORK_TEST_MUTATE_ARTIFACT_AFTER_INSTALL = priorMutation;
    if (priorFailure === undefined) delete process.env.GROUNDWORK_TEST_FAIL_AFTER_INSTALL;
    else process.env.GROUNDWORK_TEST_FAIL_AFTER_INSTALL = priorFailure;
    fs.rmSync(out, { recursive: true, force: true });
    for (const name of fs.readdirSync(path.dirname(out))) {
      if (name.startsWith(`.groundwork-artifact-conflict-${path.basename(out)}-`)) fs.rmSync(path.join(path.dirname(out), name), { recursive: true, force: true });
    }
  }
});

for (const priorExists of [false, true]) {
  test(`canonical install never overwrites a concurrent pre-install file when prior exists=${priorExists}`, () => {
    const out = tempRoot(`groundwork-atomic-preinstall-${priorExists}-`);
    const priorInsertion = process.env.GROUNDWORK_TEST_INSERT_ARTIFACT_BEFORE_INSTALL;
    try {
      if (priorExists) writeArtifactSetAtomically(out, { "spec.md": "prior\n" });
      process.env.GROUNDWORK_TEST_INSERT_ARTIFACT_BEFORE_INSTALL = "spec.md";
      assert.throws(
        () => writeArtifactSetAtomically(out, { "spec.md": "intended\n" }),
        /EEXIST.*preserved|file already exists.*preserved/s,
      );
      if (priorExists) assert.equal(fs.readFileSync(path.join(out, "spec.md"), "utf8"), "prior\n");
      else assert.equal(fs.existsSync(path.join(out, "spec.md")), false);
      const conflict = fs.readdirSync(path.dirname(out)).find((name) => name.startsWith(`.groundwork-artifact-conflict-${path.basename(out)}-`));
      assert.ok(conflict);
      assert.equal(fs.readFileSync(path.join(path.dirname(out), conflict, "spec.md"), "utf8"), "concurrent-before-install\n");
    } finally {
      if (priorInsertion === undefined) delete process.env.GROUNDWORK_TEST_INSERT_ARTIFACT_BEFORE_INSTALL;
      else process.env.GROUNDWORK_TEST_INSERT_ARTIFACT_BEFORE_INSTALL = priorInsertion;
      fs.rmSync(out, { recursive: true, force: true });
      for (const name of fs.readdirSync(path.dirname(out))) {
        if (name.startsWith(`.groundwork-artifact-conflict-${path.basename(out)}-`)) fs.rmSync(path.join(path.dirname(out), name), { recursive: true, force: true });
      }
    }
  });
}
