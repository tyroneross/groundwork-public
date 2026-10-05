#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE_ROOT = path.join(ROOT, ".build-loop", "release", "staged");
const RELEASE_POLICY = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "release-policy.json"), "utf8"));
const INCLUDE_FILES = [
  "LICENSE",
  "NOTICE",
  "THIRD-PARTY-NOTICES.md",
  "PUBLICATION-ATTESTATION.md",
  "package.json",
  "README.md",
  "AGENTS.md",
  "SPEC.md",
  "engine/fixtures/export-ready-spec.json",
  "engine/fixtures/sample-spec.json",
];
const INCLUDE_DIRS = [
  ".claude-plugin",
  ".codex-plugin",
  "commands",
  "designer",
  "docs/contracts",
  "references",
  "skills",
];
const EXCLUDED_PARTS = new Set([
  "__pycache__",
  ".pytest_cache",
  ".designer",
  ".build-loop",
  ".rally",
  ".designdoc",
  ".ibr",
  ".bookmark",
  ".procedural",
  ".claude-code-debugger",
  ".groundwork-workspace",
  "review-inbox",
  "node_modules",
  "tests",
  "plans",
]);
const PRIVATE_SUFFIXES = new Set([".pem", ".key", ".p12", ".pfx", ".env"]);
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:sk_live|rk_live)_[A-Za-z0-9]{16,}\b/,
];

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function stableDigest(files) {
  return sha256(files.map((item) => `${item.path}\0${item.sha256}\0${item.bytes}\n`).join(""));
}

function assertSafeRelative(relative) {
  const normalized = relative.split(path.sep).join("/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("../") || normalized.includes("\\")) {
    throw new Error(`Unsafe release path: ${relative}`);
  }
  const parts = normalized.split("/");
  if (parts.some((part) => EXCLUDED_PARTS.has(part))) {
    throw new Error(`Excluded release state reached staging: ${normalized}`);
  }
  const lower = normalized.toLowerCase();
  if (PRIVATE_SUFFIXES.has(path.extname(lower)) || lower.endsWith(".env.local") || lower.includes("credential")) {
    throw new Error(`Private or credential-shaped release path: ${normalized}`);
  }
  return normalized;
}

function collectDirectory(root, relative, target) {
  const source = path.join(root, relative);
  if (!fs.existsSync(source)) throw new Error(`Required release directory is missing: ${relative}`);
  for (const entry of fs.readdirSync(source, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.join(relative, entry.name);
    const parts = child.split(path.sep);
    if (parts.some((part) => EXCLUDED_PARTS.has(part))) continue;
    if (child.split(path.sep).join("/") === "designer/color/combos.jsonl") continue;
    if (child.split(path.sep).join("/").startsWith("designer/references/dashboards/") && path.extname(child) === ".html") continue;
    const absolute = path.join(root, child);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Symlinks are not allowed in release bytes: ${child}`);
    if (entry.isDirectory()) collectDirectory(root, child, target);
    else if (entry.isFile()) target.push(child);
    else throw new Error(`Unsupported release entry type: ${child}`);
  }
}

function runEngineBuild(outfile) {
  const result = spawnSync("npm", ["exec", "--", "esbuild",
    "engine/src/cli.ts",
    "--bundle",
    "--platform=node",
    "--format=esm",
    `--outfile=${outfile}`,
  ], { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Engine build failed:\n${result.stderr || result.stdout}`);
}

function readRegularReleaseInput(source) {
  let descriptor;
  try {
    descriptor = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) throw new Error("not a regular file");
    return fs.readFileSync(descriptor);
  } catch (error) {
    throw new Error(`Release input must be a regular non-symlink file: ${path.relative(ROOT, source)}`, { cause: error });
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function assertRegularReleaseInput(source) {
  readRegularReleaseInput(source);
}

function copyNormalized(source, destination) {
  const data = readRegularReleaseInput(source);
  const text = data.toString("utf8");
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) throw new Error(`Secret-shaped content rejected from release: ${path.relative(ROOT, source)}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
  fs.writeFileSync(destination, data, { mode: 0o644 });
  fs.chmodSync(destination, 0o644);
}

function filesWithDigests(root) {
  const paths = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && relative !== "release-manifest.json") paths.push(absolute);
      else if (entry.isSymbolicLink()) throw new Error(`Staged symlink rejected: ${absolute}`);
    }
  };
  walk(root);
  return paths.map((absolute) => {
    const data = fs.readFileSync(absolute);
    return {
      path: path.relative(root, absolute).split(path.sep).join("/"),
      sha256: sha256(data),
      bytes: data.byteLength,
    };
  }).sort((a, b) => a.path.localeCompare(b.path));
}

function prepareReleaseRoot(releaseRoot) {
  fs.mkdirSync(releaseRoot, { recursive: true, mode: 0o755 });
  const stat = fs.lstatSync(releaseRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Release stage root must be a regular directory: ${releaseRoot}`);
  const parent = fs.realpathSync(path.dirname(releaseRoot));
  const expected = path.join(parent, path.basename(releaseRoot));
  if (fs.realpathSync(releaseRoot) !== expected) throw new Error(`Release stage root resolves through an unsafe final link: ${releaseRoot}`);
  if (path.resolve(releaseRoot) === path.resolve(RELEASE_ROOT)) {
    const realRoot = fs.realpathSync(ROOT);
    const realRelease = fs.realpathSync(releaseRoot);
    if (!realRelease.startsWith(`${realRoot}${path.sep}`)) throw new Error("Owned release stage root escaped the Groundwork worktree.");
  }
}

export function stageRelease({ releaseRoot = RELEASE_ROOT } = {}) {
  // .claude-plugin/plugin.json is the source of truth (scripts/version_gate.py);
  // reading package.json here is what let a release stage 0.3.0 while the plugin
  // host installed 0.3.1 from the same tree.
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin/plugin.json"), "utf8"));
  const version = String(manifest.version || "").trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error("package.json has no valid release version.");

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "groundwork-release-build-"));
  const firstBundle = path.join(scratch, "engine-a.js");
  const secondBundle = path.join(scratch, "engine-b.js");
  runEngineBuild(firstBundle);
  runEngineBuild(secondBundle);
  const firstBytes = fs.readFileSync(firstBundle);
  const secondBytes = fs.readFileSync(secondBundle);
  if (!firstBytes.equals(secondBytes)) throw new Error("Engine bundle is not reproducible across two clean builds.");

  prepareReleaseRoot(releaseRoot);
  const temporary = fs.mkdtempSync(path.join(releaseRoot, ".groundwork-stage-"));
  try {
    const relativeFiles = [...INCLUDE_FILES];
    for (const directory of INCLUDE_DIRS) collectDirectory(ROOT, directory, relativeFiles);
    for (const relative of [...new Set(relativeFiles)].sort()) {
      const normalized = assertSafeRelative(relative);
      copyNormalized(path.join(ROOT, relative), path.join(temporary, normalized));
    }
    copyNormalized(secondBundle, path.join(temporary, "engine", "dist", "cli.js"));
    fs.writeFileSync(
      path.join(temporary, ".groundwork-release-policy.json"),
      `${JSON.stringify(RELEASE_POLICY, null, 2)}\n`,
      { mode: 0o644 },
    );

    const files = filesWithDigests(temporary);
    const artifactDigest = stableDigest(files);
    const manifest = {
      schema: "groundwork.release-manifest/v1",
      name: "groundwork",
      version,
      artifactDigest,
      compatibility: RELEASE_POLICY.compatibility,
      fileCount: files.length,
      files,
    };
    fs.writeFileSync(path.join(temporary, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
    const destination = path.join(releaseRoot, `groundwork-${version}-${artifactDigest.slice(0, 12)}`);
    if (fs.existsSync(destination)) {
      const current = JSON.parse(fs.readFileSync(path.join(destination, "release-manifest.json"), "utf8"));
      const existingFiles = filesWithDigests(destination);
      if (current.artifactDigest !== artifactDigest
        || stableDigest(existingFiles) !== artifactDigest
        || JSON.stringify(existingFiles) !== JSON.stringify(files)) {
        throw new Error(`Existing staged directory disagrees: ${destination}`);
      }
      fs.rmSync(temporary, { recursive: true, force: true });
    } else {
      fs.renameSync(temporary, destination);
    }
    return {
      schema: manifest.schema,
      version,
      artifactDigest,
      artifactRoot: destination,
      manifestPath: path.join(destination, "release-manifest.json"),
      fileCount: files.length,
    };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = stageRelease();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`stage-release: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
