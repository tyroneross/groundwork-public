#!/usr/bin/env node
// ───────────────────────────────────────────────────────────────────────
// Groundwork — deterministic doc emitter (CLI).
//
// Reads a structured Spec JSON (file path or stdin), validates it against the
// frozen SpecSchema, and emits the research-validated doc chain plus a machine
// traceability index into an output directory. Pure I/O + rendering: no LLM
// calls, no network. The host agent (see commands/design.md) assembles the Spec;
// this tool turns a valid Spec into files, every time, the same way.
//
// Usage:
//   npx tsx engine/src/cli.ts <spec.json> [--out <dir>]
//     [--allow-spec-root <dir>] [--run-id <id>] [--created-at <ISO timestamp>]
//   npx tsx engine/src/cli.ts -            [--out <dir>]   # read Spec from stdin
//   cat spec.json | npx tsx engine/src/cli.ts             # arg absent → stdin
//   npx tsx engine/src/cli.ts --reconcile <implementation-map.json> --out <dir>
//   npx tsx engine/src/cli.ts <spec.json> --out <dir>
//     --export <spec-kit|openspec> --export-out <exact-owned-derived-tree>
//   npx tsx engine/src/cli.ts <spec.json> --check-owned-files --repo-root <repo>
//
// Output directory resolution (first match wins):
//   1. --out <dir>
//   2. $GROUNDWORK_OUT
//   3. ${os.homedir()}/dev/designs/<slug>   (slug = kebab-case productName)
//
// Emits into <outDir>: spec.json, steering.md, requirements.md, design.md,
// design-system.md, tasks.md, builder-handoff.md, traceability.json,
// architecture.json, build-request.json, and an artifact-manifest.json commit
// marker. Reconciliation adds Groundwork-owned convergence.json without
// adopting the Build Loop-owned implementation map. Prints each written path.
// ───────────────────────────────────────────────────────────────────────

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { SpecSchema, TraceMatrixSchema, type Spec } from "./spec.js";
import { renderDocs } from "./render.js";
import { deriveTasks, renderBuilderHandoff, renderTasks } from "./handoff.js";
import { recoverArtifactTransactions, writeArtifactSetAtomically } from "./atomic-write.js";
import { compileTaskGraph, resolveSpecGraph } from "./graph.js";
import { buildTraceability as buildTraceabilityV3 } from "./traceability.js";
import {
  architectureArtifact,
  canonicalSpecPacket,
  createBuildRequest,
} from "./build-artifacts.js";
import {
  calculateConvergence,
  validateBuildRequest,
  validateImplementationMap,
} from "./build-exchange.js";
import { exportSpecKit } from "./exporters/spec-kit.js";
import { exportOpenSpec } from "./exporters/openspec.js";
import type { DerivedExport, DerivedExportFormat } from "./exporters/types.js";
import {
  assertDisjointArtifactRoots,
  validateDerivedExportDestination,
  withDerivedExportReservation,
} from "./derived-export.js";

const PACKAGE_JSON = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..", "package.json");

// ── arg parsing ──────────────────────────────────────────────────────────

interface ParsedArgs {
  /** Positional Spec source: a file path, "-" for stdin, or undefined. */
  source: string | undefined;
  /** --out override, if supplied. */
  out: string | undefined;
  allowSpecRoots: string[];
  implementationMap: string | undefined;
  runId: string | undefined;
  createdAt: string | undefined;
  exportFormat: DerivedExportFormat | undefined;
  exportOut: string | undefined;
  checkOwnedFiles: boolean;
  repoRoot: string | undefined;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const seen = new Set<string>();
  let out: string | undefined;
  const allowSpecRoots: string[] = [];
  let implementationMap: string | undefined;
  let runId: string | undefined;
  let createdAt: string | undefined;
  let exportFormat: DerivedExportFormat | undefined;
  let exportOut: string | undefined;
  let checkOwnedFiles = false;
  let repoRoot: string | undefined;
  const once = (name: string) => {
    if (seen.has(name)) throw new Error(`Duplicate ${name} argument.`);
    seen.add(name);
  };
  const nextValue = (index: number, name: string): string => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") {
      once("--out");
      out = nextValue(i, "--out");
      i += 1;
    } else if (arg.startsWith("--out=")) {
      once("--out");
      out = arg.slice("--out=".length);
    } else if (arg === "--allow-spec-root") {
      allowSpecRoots.push(nextValue(i, "--allow-spec-root"));
      i += 1;
    } else if (arg.startsWith("--allow-spec-root=")) {
      const value = arg.slice("--allow-spec-root=".length);
      if (!value) throw new Error("--allow-spec-root requires a value.");
      allowSpecRoots.push(value);
    } else if (arg === "--reconcile" || arg === "--implementation-map") {
      once("--reconcile");
      implementationMap = nextValue(i, arg);
      i += 1;
    } else if (arg.startsWith("--reconcile=")) {
      once("--reconcile");
      implementationMap = arg.slice("--reconcile=".length);
    } else if (arg.startsWith("--implementation-map=")) {
      once("--reconcile");
      implementationMap = arg.slice("--implementation-map=".length);
    } else if (arg === "--run-id") {
      once("--run-id");
      runId = nextValue(i, "--run-id");
      i += 1;
    } else if (arg.startsWith("--run-id=")) {
      once("--run-id");
      runId = arg.slice("--run-id=".length);
    } else if (arg === "--created-at") {
      once("--created-at");
      createdAt = nextValue(i, "--created-at");
      i += 1;
    } else if (arg.startsWith("--created-at=")) {
      once("--created-at");
      createdAt = arg.slice("--created-at=".length);
    } else if (arg === "--export") {
      once("--export");
      const value = nextValue(i, "--export");
      if (value !== "spec-kit" && value !== "openspec") throw new Error(`Unsupported export format: ${value}`);
      exportFormat = value;
      i += 1;
    } else if (arg.startsWith("--export=")) {
      once("--export");
      const value = arg.slice("--export=".length);
      if (value !== "spec-kit" && value !== "openspec") throw new Error(`Unsupported export format: ${value}`);
      exportFormat = value;
    } else if (arg === "--export-out") {
      once("--export-out");
      exportOut = nextValue(i, "--export-out");
      i += 1;
    } else if (arg.startsWith("--export-out=")) {
      once("--export-out");
      exportOut = arg.slice("--export-out=".length);
    } else if (arg === "--check-owned-files") {
      once("--check-owned-files");
      checkOwnedFiles = true;
    } else if (arg === "--repo-root") {
      once("--repo-root");
      repoRoot = nextValue(i, "--repo-root");
      i += 1;
    } else if (arg.startsWith("--repo-root=")) {
      once("--repo-root");
      repoRoot = arg.slice("--repo-root=".length);
    } else if (arg.startsWith("-") && arg !== "-") {
      throw new Error(`Unknown argument: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }
  if (positionals.length > 1) throw new Error(`Unexpected positional argument: ${positionals[1]}`);
  for (const [name, value] of [
    ["--out", out],
    ["--reconcile", implementationMap],
    ["--run-id", runId],
    ["--created-at", createdAt],
    ["--export", exportFormat],
    ["--export-out", exportOut],
  ] as const) {
    if (seen.has(name) && !value) throw new Error(`${name} requires a value.`);
  }
  if (Boolean(exportFormat) !== Boolean(exportOut)) throw new Error("--export and --export-out must be supplied together.");
  if (implementationMap && (exportFormat || exportOut)) throw new Error("Reconciliation cannot run with a derived export.");
  if (checkOwnedFiles && !repoRoot) throw new Error("--check-owned-files requires --repo-root <root>.");
  return { source: positionals[0], out, allowSpecRoots, implementationMap, runId, createdAt, exportFormat, exportOut, checkOwnedFiles, repoRoot };
}

function allExplicitOwnedFiles(spec: Spec): string[] {
  return [...new Set([
    ...(spec.projectContext.bootstrap?.ownedFiles ?? []),
    ...spec.features.flatMap((item) => item.ownedFiles ?? []),
    ...spec.screens.flatMap((item) => item.ownedFiles ?? []),
    ...spec.integrations.flatMap((item) => item.ownedFiles),
    ...spec.apiContracts.flatMap((item) => item.ownedFiles),
    ...spec.tests.flatMap((item) => item.ownedFiles),
    ...spec.dataModel.flatMap((item) => item.ownedFiles),
    ...spec.architecture.components.flatMap((item) => item.ownedFiles ?? []),
    ...spec.architecture.contracts.flatMap((item) => item.ownedFiles ?? []),
  ])];
}

function checkOwnedFilesAgainstRepo(spec: Spec, rootInput: string): void {
  const root = fs.realpathSync(path.resolve(rootInput));
  if (!fs.statSync(root).isDirectory()) throw new Error(`Repository root is not a directory: ${root}`);
  const planned = new Set((spec.projectContext.declaredNewFiles ?? []).map((item) => item.path));
  for (const relative of allExplicitOwnedFiles(spec)) {
    const candidate = path.resolve(root, relative);
    if (!candidate.startsWith(`${root}${path.sep}`)) throw new Error(`Owned file escapes repository root: ${relative}`);
    if (planned.has(relative)) {
      if (fs.existsSync(candidate)) throw new Error(`Declared-new file already exists: ${relative}`);
      let current = root;
      for (const part of relative.split("/").slice(0, -1)) {
        current = path.join(current, part);
        if (!fs.existsSync(current)) break;
        if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Declared-new file has a symlink ancestor: ${relative}`);
        if (!fs.lstatSync(current).isDirectory()) throw new Error(`Declared-new file has a non-directory ancestor: ${relative}`);
      }
      continue;
    }
    if (!fs.existsSync(candidate)) throw new Error(`Expected-existing owned file is missing: ${relative}`);
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Expected-existing owned path is not a regular file: ${relative}`);
    if (!fs.realpathSync(candidate).startsWith(`${root}${path.sep}`)) throw new Error(`Owned file resolves outside repository root: ${relative}`);
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function readStdinSync(): string {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** kebab-case a product name for use as a directory slug. */
function kebab(name: string): string {
  return (
    name
      .trim()
      .replace(/['"]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .toLowerCase()
      .replace(/^-+|-+$/g, "")
      .replace(/-+/g, "-") || "untitled"
  );
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** Pretty-print zod issues so a human (or agent) can fix the Spec. */
function reportZodError(err: z.ZodError): never {
  const lines = ["Spec validation failed. SpecSchema rejected the input:", ""];
  for (const issue of err.issues) {
    const where = issue.path.length ? issue.path.join(".") : "(root)";
    lines.push(`  • ${where}: ${issue.message}`);
  }
  lines.push("", `${err.issues.length} issue(s). No files were written.`);
  fail(lines.join("\n"));
}

// ── optional visual evidence ─────────────────────────────────────────────
function loadVisualEvidence(outDir: string): {
  embedded: Record<string, string>;
  steeringLines: string[];
} {
  const embedded: Record<string, string> = {};
  const steeringLines: string[] = [];
  const maxFileBytes = 2 * 1024 * 1024;
  const maxTotalBytes = 8 * 1024 * 1024;
  let totalBytes = 0;
  const readBoundedRegularFile = (file: string, label: string, limit = maxFileBytes) => {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`${label} is not a safe regular file.`);
    }
    if (stat.size > limit) throw new Error(`${label} exceeds the ${limit}-byte embedding limit.`);
    totalBytes += stat.size;
    if (totalBytes > maxTotalBytes) {
      throw new Error(`Visual evidence exceeds the ${maxTotalBytes}-byte total embedding limit.`);
    }
    return fs.readFileSync(file, "utf8");
  };
  const tokensPath = path.join(outDir, "design-tokens.md");
  if (fs.existsSync(tokensPath)) {
    embedded["design-tokens.md"] = readBoundedRegularFile(tokensPath, "design-tokens.md");
    steeringLines.push("- Confirmed token source: `design-tokens.md`.");
  }

  const mockupsRoot = path.join(outDir, "mockups");
  const selectionPath = path.join(mockupsRoot, "selection.json");
  const gallerySelectionsPath = path.join(mockupsRoot, ".canvas", "gallery-selections.json");
  if (fs.existsSync(gallerySelectionsPath)) {
    const rootStat = fs.lstatSync(mockupsRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error("mockups is not a safe owned directory.");
    }
    const realMockupsRoot = fs.realpathSync(mockupsRoot);
    const realGallerySelections = fs.realpathSync(gallerySelectionsPath);
    if (!realGallerySelections.startsWith(`${realMockupsRoot}${path.sep}`)) {
      throw new Error("mockups/.canvas/gallery-selections.json escapes the owned mockups directory.");
    }
    const rawGallerySelections = readBoundedRegularFile(
      gallerySelectionsPath,
      "mockups/.canvas/gallery-selections.json",
      512 * 1024,
    );
    const gallerySelections = JSON.parse(rawGallerySelections) as Record<string, unknown>;
    embedded["mockups/.canvas/gallery-selections.json"] = rawGallerySelections;
    const annotations = gallerySelections.annotations;
    let openAnnotations = 0;
    if (annotations && typeof annotations === "object" && !Array.isArray(annotations)) {
      for (const value of Object.values(annotations as Record<string, unknown>)) {
        if (!Array.isArray(value)) continue;
        openAnnotations += value.filter((item) => {
          if (!item || typeof item !== "object") return false;
          return (item as Record<string, unknown>).status === "open";
        }).length;
      }
    }
    if (openAnnotations) {
      steeringLines.push(
        `- Required visual feedback: ${openAnnotations} open element annotation${openAnnotations === 1 ? "" : "s"} in \`mockups/.canvas/gallery-selections.json\`; implement or explicitly disposition each one.`,
      );
    }
  }
  if (fs.existsSync(selectionPath)) {
    const rootStat = fs.lstatSync(mockupsRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error("mockups is not a safe owned directory.");
    }
    const realMockupsRoot = fs.realpathSync(mockupsRoot);
    const rawSelection = readBoundedRegularFile(selectionPath, "mockups/selection.json", 256 * 1024);
    const selection = JSON.parse(rawSelection) as Record<string, unknown>;
    embedded["mockups/selection.json"] = rawSelection;
    const rationale = typeof selection.rationale === "string" ? selection.rationale.trim() : "";
    if (rationale) steeringLines.push(`- Confirmed mockup rationale: ${rationale}`);
    const selections = Array.isArray(selection.selections)
      ? selection.selections
      : Array.isArray(selection.perScreen)
        ? selection.perScreen
        : [];
    for (const item of selections) {
      if (!item || typeof item !== "object") continue;
      const relative = (item as Record<string, unknown>).html_path;
      if (typeof relative !== "string" || !relative.trim()) continue;
      const candidate = path.resolve(mockupsRoot, relative);
      if (!candidate.startsWith(`${path.resolve(mockupsRoot)}${path.sep}`)) {
        throw new Error(`Unsafe selected mockup path: ${relative}`);
      }
      if (!fs.existsSync(candidate)) {
        throw new Error(`Selected mockup is missing: ${relative}`);
      }
      const selectedStat = fs.lstatSync(candidate);
      if (!selectedStat.isFile() || selectedStat.isSymbolicLink()) {
        throw new Error(`Selected mockup is not a safe regular file: ${relative}`);
      }
      const realCandidate = fs.realpathSync(candidate);
      if (!realCandidate.startsWith(`${realMockupsRoot}${path.sep}`)) {
        throw new Error(`Selected mockup escapes the owned mockups directory: ${relative}`);
      }
      embedded[`mockups/${relative}`] = readBoundedRegularFile(candidate, `mockups/${relative}`);
    }
  }
  if (!steeringLines.length) steeringLines.push("- No visual preference artifact has been confirmed yet.");
  return { embedded, steeringLines };
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function bundleBaselineArtifacts(spec: Spec, source: string | undefined): string | undefined {
  const artifacts = spec.designContract?.baseline.artifacts ?? [];
  if (!artifacts.length) return undefined;
  if (!source || source === "-") throw new Error("A Spec with baseline artifacts must be read from a file so artifact paths have an authoritative root.");
  const sourceRoot = fs.realpathSync(path.dirname(path.resolve(source)));
  const managedNames = new Set(["spec.json", "steering.md", "requirements.md", "design.md", "design-system.md", "tasks.md", "builder-handoff.md", "traceability.json", "architecture.json", "build-request.json", "artifact-manifest.json", "baseline-artifacts.json"]);
  const seen = new Set<string>();
  const bundled = [];
  for (const artifact of artifacts) {
    const parts = artifact.path.split(/[\\/]+/).filter((part) => part && part !== ".");
    const relative = parts.join(path.sep);
    if (!relative || path.isAbsolute(artifact.path) || parts.includes("..")) throw new Error(`Baseline artifact path is unsafe: ${artifact.path}`);
    if (managedNames.has(parts.join("/"))) throw new Error(`Baseline artifact collides with managed packet artifact: ${artifact.path}`);
    if (seen.has(parts.join("/"))) throw new Error(`Duplicate baseline artifact destination: ${artifact.path}`);
    seen.add(parts.join("/"));
    const sourcePath = path.resolve(sourceRoot, relative);
    if (!sourcePath.startsWith(`${sourceRoot}${path.sep}`)) throw new Error(`Baseline artifact escapes the Spec root: ${artifact.path}`);
    const stat = fs.lstatSync(sourcePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Baseline artifact is not a safe regular file: ${artifact.path}`);
    const realSource = fs.realpathSync(sourcePath);
    if (!realSource.startsWith(`${sourceRoot}${path.sep}`)) throw new Error(`Baseline artifact resolves outside the Spec root: ${artifact.path}`);
    const actual = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(realSource)).digest("hex")}`;
    if (actual !== artifact.digest) throw new Error(`Baseline artifact digest mismatch for ${artifact.id}: expected ${artifact.digest}, got ${actual}`);
    bundled.push({ id: artifact.id, path: artifact.path, type: artifact.type, digest: artifact.digest, encoding: "base64", bytes: fs.readFileSync(realSource).toString("base64") });
  }
  return `${JSON.stringify({ schema: "groundwork.baseline-artifacts/v1", artifacts: bundled }, null, 2)}\n`;
}

function assertNoBaselineDestinationSymlinks(spec: Spec, outDir: string): void {
  for (const artifact of spec.designContract?.baseline.artifacts ?? []) {
    let current = path.resolve(outDir);
    for (const part of artifact.path.split(/[\\/]+/).slice(0, -1)) {
      current = path.join(current, part);
      if (!fs.existsSync(current)) break;
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error(`Baseline artifact destination ancestor is a symlink: ${artifact.path}`);
      if (!stat.isDirectory()) throw new Error(`Baseline artifact destination ancestor is not a directory: ${artifact.path}`);
    }
  }
}

/** Read only Groundwork-owned files from the committed artifact generation. */
function readManagedArtifactSet(outDir: string): Record<string, string> {
  recoverArtifactTransactions(outDir);
  const manifestPath = path.join(outDir, "artifact-manifest.json");
  const manifestStat = fs.lstatSync(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 512 * 1024) {
    throw new Error("artifact-manifest.json is not a safe Groundwork manifest.");
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  if (manifest.schema !== "groundwork.artifacts/v1" || !Array.isArray(manifest.files)) {
    throw new Error("artifact-manifest.json is not a supported Groundwork artifact manifest.");
  }
  const files: Record<string, string> = {};
  for (const rawEntry of manifest.files) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) throw new Error("Artifact manifest entry is invalid.");
    const entry = rawEntry as Record<string, unknown>;
    const name = entry.name;
    if (typeof name !== "string" || !name || path.isAbsolute(name) || path.dirname(name) !== ".") {
      throw new Error("Artifact manifest contains an unsafe file name.");
    }
    const file = path.join(outDir, name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) {
      throw new Error(`Managed artifact is not a safe bounded file: ${name}`);
    }
    const contents = fs.readFileSync(file, "utf8");
    if (entry.sha256 !== sha256(contents)) throw new Error(`Managed artifact hash mismatch: ${name}`);
    files[name] = contents;
  }
  return files;
}

function readBoundedJson(file: string, label: string): unknown {
  const absolute = path.resolve(file);
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) {
    throw new Error(`${label} must be a regular, non-symlink JSON file under 4 MiB.`);
  }
  return JSON.parse(fs.readFileSync(absolute, "utf8"));
}

function reconcile(outDir: string, implementationMapPath: string, calculatedAt?: string): void {
  const existing = readManagedArtifactSet(outDir);
  if (!existing["build-request.json"] || !existing["spec.json"]) {
    throw new Error("Reconciliation requires the committed build-request.json and spec.json artifacts.");
  }
  const specPacket = JSON.parse(existing["spec.json"]);
  const request = validateBuildRequest(JSON.parse(existing["build-request.json"]), specPacket);
  const implementationMap = validateImplementationMap(
    request,
    readBoundedJson(implementationMapPath, "implementation-map.json"),
  );
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8")) as Record<string, unknown>;
  const convergence = calculateConvergence(request, implementationMap, {
    groundworkVersion: typeof packageJson.version === "string" ? packageJson.version : "unknown",
    calculatedAt: calculatedAt || new Date().toISOString(),
  });
  existing["convergence.json"] = JSON.stringify(convergence, null, 2) + "\n";
  for (const destination of writeArtifactSetAtomically(outDir, existing)) process.stdout.write(`${destination}\n`);
}

// ── main ─────────────────────────────────────────────────────────────────

function main(): void {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(`Argument error: ${(error as Error).message}`);
  }
  const { source, out, allowSpecRoots, implementationMap, runId, createdAt, exportFormat, exportOut, checkOwnedFiles, repoRoot } = parsed;

  if (implementationMap) {
    if (!out) fail("Reconciliation requires --out <existing Groundwork artifact directory>.");
    try {
      reconcile(path.resolve(out), implementationMap, createdAt);
    } catch (error) {
      fail(`Convergence reconciliation failed: ${(error as Error).message}`);
    }
    process.exit(0);
  }

  // 1. Load raw JSON text.
  let rawText: string;
  if (!source || source === "-") {
    rawText = readStdinSync();
    if (!rawText.trim()) {
      fail(
        "No Spec provided. Pass a JSON file path, or pipe Spec JSON on stdin " +
          "(use '-' or omit the argument).",
      );
    }
  } else {
    const specPath = path.resolve(source);
    if (!fs.existsSync(specPath)) {
      fail(`Spec file not found: ${specPath}`);
    }
    rawText = fs.readFileSync(specPath, "utf8");
  }

  // 2. Parse JSON.
  let rawObj: unknown;
  try {
    rawObj = JSON.parse(rawText);
  } catch (e) {
    fail(`Spec is not valid JSON: ${(e as Error).message}`);
  }

  // 3. Validate against the frozen schema.
  let spec: Spec;
  try {
    spec = SpecSchema.parse(rawObj);
  } catch (e) {
    if (e instanceof z.ZodError) reportZodError(e);
    throw e;
  }
  if (checkOwnedFiles) {
    try { checkOwnedFilesAgainstRepo(spec, repoRoot!); }
    catch (error) { fail(`Owned-file validation failed: ${(error as Error).message}`); }
    process.stdout.write(`${JSON.stringify({ status: "pass", checked: allExplicitOwnedFiles(spec).length, repoRoot: fs.realpathSync(path.resolve(repoRoot!)) })}\n`);
    return;
  }
  let baselineArtifactBundle: string | undefined;
  try {
    baselineArtifactBundle = bundleBaselineArtifacts(spec, source);
  } catch (error) {
    fail(`Baseline artifact validation failed before publication: ${(error as Error).message}`);
  }

  // Precompute and validate the complete optional projection before any output
  // directory is created. External framework CLIs are never invoked.
  let derivedExport: DerivedExport | undefined;
  if (exportFormat) {
    try {
      derivedExport = exportFormat === "spec-kit" ? exportSpecKit(spec) : exportOpenSpec(spec);
    } catch (error) {
      fail(`Derived export generation failed: ${(error as Error).message}`);
    }
  }

  // 4. Resolve output directory.
  const slug = kebab(spec.productName);
  const outDir = out
    ? path.resolve(out)
    : process.env.GROUNDWORK_OUT
      ? path.resolve(process.env.GROUNDWORK_OUT)
      : path.join(os.homedir(), "dev", "designs", slug);
  if (exportOut) {
    try {
      assertDisjointArtifactRoots(outDir, exportOut);
      if (derivedExport) validateDerivedExportDestination(exportOut, derivedExport);
    } catch (error) {
      fail(`Derived export destination is invalid: ${(error as Error).message}`);
    }
  }
  try {
    assertNoBaselineDestinationSymlinks(spec, outDir);
  } catch (error) {
    fail(`Baseline artifact destination is unsafe before publication: ${(error as Error).message}`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  // Freeze any caller-provided symlinked ancestor to the concrete canonical
  // directory used by the remainder of this publication.
  const canonicalOutDir = fs.realpathSync(outDir);
  recoverArtifactTransactions(canonicalOutDir);

  // 4b. Warn — never fail — when the Spec claims an existing-app starting
  // point but carries no observed repoLayout. Owned-file paths will fall
  // back to generic per-platform scaffolding that may not match the real
  // repository's directory conventions (groundwork/spec.ts RepoLayoutSchema).
  const repoLayout = spec.projectContext.repoLayout;
  const hasRepoLayout = Boolean(
    repoLayout &&
      Object.values(repoLayout).some((v) => typeof v === "string" && v.trim().length > 0),
  );
  if (spec.projectContext.startingPoint === "existing-app" && !hasRepoLayout) {
    process.stderr.write(
      "Warning: projectContext.startingPoint is 'existing-app' but no projectContext.repoLayout " +
        "was supplied. Owned-file paths in tasks.md will be generic per-platform scaffolding " +
        "(e.g. src/db/schema.ts, src/features/…) and may not match this repository's real " +
        "directory conventions. Supply repoLayout to preserve observed facts.\n",
    );
  }

  // 5. Render.
  const docs = renderDocs(spec);
  let visualEvidence: ReturnType<typeof loadVisualEvidence>;
  try {
    visualEvidence = loadVisualEvidence(canonicalOutDir);
  } catch (error) {
    fail(`Visual evidence is invalid: ${(error as Error).message}`);
  }
  docs["steering.md"] += `\n## Confirmed visual direction\n\n${visualEvidence.steeringLines.join("\n")}\n`;
  let resolvedGraph;
  try {
    resolvedGraph = resolveSpecGraph(spec, {
      sourcePath: source && source !== "-" ? path.resolve(source) : undefined,
      allowedRoots: allowSpecRoots,
    });
  } catch (error) {
    fail(`Spec dependency resolution failed: ${(error as Error).message}`);
  }
  const taskGraph = compileTaskGraph(spec, deriveTasks(spec));
  const tasks = renderTasks(spec, taskGraph);
  const traceability = TraceMatrixSchema.parse(buildTraceabilityV3(spec, taskGraph));
  const specPacket = canonicalSpecPacket(spec, traceability);
  let buildRequest;
  try {
    buildRequest = createBuildRequest({
      spec,
      canonicalSpecPacket: specPacket,
      tasks: taskGraph,
      runId,
      createdAt,
    });
  } catch (error) {
    fail(`Build request generation failed: ${(error as Error).message}`);
  }
  const architecture = architectureArtifact(resolvedGraph, buildRequest.specDigest);
  const builderHandoff = renderBuilderHandoff(spec, {
    docs,
    tasks,
    traceability,
    resolvedArchitecture: architecture,
    visualEvidence: visualEvidence.embedded,
  });

  // 6. Write files.
  const files: Record<string, string> = {
    // Persist the validated source object beside its rendered projections so a
    // later mockup or design-token session can resume without relying on the
    // host agent's temporary input file.
    "spec.json": JSON.stringify(specPacket, null, 2) + "\n",
    "steering.md": docs["steering.md"],
    "requirements.md": docs["requirements.md"],
    "design.md": docs["design.md"],
    "design-system.md": docs["design-system.md"],
    "tasks.md": tasks,
    "builder-handoff.md": builderHandoff,
    "traceability.json": JSON.stringify(traceability, null, 2) + "\n",
    "architecture.json": JSON.stringify(architecture, null, 2) + "\n",
    "build-request.json": JSON.stringify(buildRequest, null, 2) + "\n",
    ...(baselineArtifactBundle ? { "baseline-artifacts.json": baselineArtifactBundle } : {}),
  };

  const publishCanonical = () => {
    for (const dest of writeArtifactSetAtomically(canonicalOutDir, files)) process.stdout.write(`${dest}\n`);
  };
  try {
    if (derivedExport && exportOut) {
      withDerivedExportReservation(exportOut, derivedExport, (publish) => {
        // Install and verify the derived generation first, retain its prior
        // backup while canonical commits atomically, then finalize both.
        const destinations = publish(spec, publishCanonical);
      for (const destination of destinations) process.stdout.write(`${destination}\n`);
      process.stderr.write(`${JSON.stringify({
        event: "derived_export_written",
        operation: "publish",
        outcome: "passed",
        schema: "groundwork.derived-export/v1",
        format: derivedExport.format,
        exporterVersion: derivedExport.exporterVersion,
        sourceCommit: derivedExport.source.stableCommit,
        fileCount: derivedExport.files.length,
      })}\n`);
      }, {
        canonicalRoot: canonicalOutDir,
        canonicalProof: { fileName: "spec.json", sha256: sha256(files["spec.json"]) },
      });
    } else {
      publishCanonical();
    }
  } catch (error) {
    fail(`Artifact publication failed; previous managed output restored: ${(error as Error).message}`);
  }

  // Let stdout drain: forced exit can truncate emitted paths on piped hosts.
  process.exitCode = 0;
}

main();
