import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { calculateSpecDigest } from "./build-exchange.js";
import type { Spec } from "./spec.js";
import type { DerivedExport, DerivedExportFile } from "./exporters/types.js";

const MANIFEST_NAME = ".groundwork-export-manifest.json";
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TREE_BYTES = 64 * 1024 * 1024;

interface ExportManifest {
  schema: "groundwork.derived-export/v1";
  derivedFrom: "Groundwork";
  format: DerivedExport["format"];
  exporterVersion: "1";
  spec: { id: string; schemaVersion: 3; digest: `sha256:${string}` };
  upstreamSourceStamp: string;
  files: Array<{ path: string; sha256: string; bytes: number }>;
}

interface VerifiedManagedTree {
  manifest: ExportManifest | undefined;
  fingerprint: string | null;
}

interface ExportJournal {
  schema: "groundwork.derived-export-transaction/v2";
  targetName: string;
  phase: "staged" | "backed-up" | "installed" | "committed";
  expectedNewManifestSha256: string;
  priorExisted: boolean;
  priorManifestSha256: string | null;
  canonicalProof: CanonicalCommitProof | null;
}

interface CanonicalCommitProof {
  root: string;
  fileName: string;
  sha256: string;
}

interface DerivedExportTransactionOptions {
  canonicalRoot?: string;
  canonicalProof?: { fileName: string; sha256: string };
}

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} contains unsupported fields.`);
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function safeRelative(value: string): string {
  if (!value || value.includes("\0") || value.includes("\\") || value.startsWith("/")
      || /^[A-Za-z]:/.test(value) || value.startsWith("//") || value === MANIFEST_NAME) {
    throw new Error(`Unsafe derived export path: ${JSON.stringify(value)}`);
  }
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..") || path.posix.normalize(value) !== value) {
    throw new Error(`Unsafe derived export path: ${JSON.stringify(value)}`);
  }
  return value;
}

function validateFiles(files: readonly DerivedExportFile[]): DerivedExportFile[] {
  const sorted = [...files].sort((left, right) => left.path.localeCompare(right.path));
  const exact = new Set<string>();
  const folded = new Set<string>();
  let total = 0;
  for (const file of sorted) {
    const relative = safeRelative(file.path);
    if (relative !== file.path) throw new Error(`Derived export path is not canonical: ${file.path}`);
    if (exact.has(relative) || folded.has(relative.toLocaleLowerCase("en-US"))) {
      throw new Error(`Duplicate derived export path: ${relative}`);
    }
    exact.add(relative);
    folded.add(relative.toLocaleLowerCase("en-US"));
    const bytes = Buffer.byteLength(file.content, "utf8");
    if (bytes > MAX_FILE_BYTES) throw new Error(`Derived export file exceeds 16 MiB: ${relative}`);
    total += bytes;
    if (total > MAX_TREE_BYTES) throw new Error("Derived export tree exceeds 64 MiB.");
  }
  const paths = sorted.map((file) => file.path);
  for (const file of paths) {
    const parts = file.split("/");
    for (let index = 1; index < parts.length; index++) {
      if (exact.has(parts.slice(0, index).join("/"))) {
        throw new Error(`Derived export file/directory prefix collision at ${file}.`);
      }
    }
  }
  return sorted;
}

function validateSourceStampBinding(sourceStamp: DerivedExportFile, spec: Spec, exported: DerivedExport): void {
  let raw: Record<string, unknown>;
  try {
    raw = asRecord(JSON.parse(sourceStamp.content), "Derived export source stamp");
  } catch (error) {
    throw new Error("Derived export source stamp must be valid JSON.", { cause: error });
  }
  const derivedFrom = asRecord(raw.derivedFrom, "Derived export source stamp derivedFrom");
  const expectedDigest = calculateSpecDigest(spec);
  if (raw.schema !== "groundwork.export-source/v1"
      || raw.format !== exported.format
      || raw.exporterVersion !== exported.exporterVersion
      || derivedFrom.schema !== "groundwork.spec/v3"
      || derivedFrom.specId !== spec.id
      || derivedFrom.digest !== expectedDigest) {
    throw new Error("Derived export source stamp does not match the supplied canonical Spec and exporter.");
  }
}

function readNoFollow(file: string, label: string, maxBytes: number): Buffer {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > maxBytes) throw new Error("not a bounded regular file");
    return fs.readFileSync(descriptor);
  } catch (error) {
    throw new Error(`${label} must be a bounded regular non-symlink file.`, { cause: error });
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function parseManifest(value: unknown): ExportManifest {
  const raw = asRecord(value, "Derived export manifest");
  exactKeys(raw, ["schema", "derivedFrom", "format", "exporterVersion", "spec", "upstreamSourceStamp", "files"], "Derived export manifest");
  if (raw.schema !== "groundwork.derived-export/v1" || raw.derivedFrom !== "Groundwork"
      || (raw.format !== "spec-kit" && raw.format !== "openspec") || raw.exporterVersion !== "1"
      || typeof raw.upstreamSourceStamp !== "string" || !Array.isArray(raw.files)) {
    throw new Error("Derived export manifest has an invalid contract.");
  }
  safeRelative(raw.upstreamSourceStamp);
  const spec = asRecord(raw.spec, "Derived export manifest spec");
  exactKeys(spec, ["id", "schemaVersion", "digest"], "Derived export manifest spec");
  if (typeof spec.id !== "string" || !spec.id || spec.schemaVersion !== 3
      || typeof spec.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(spec.digest)) {
    throw new Error("Derived export manifest spec is invalid.");
  }
  const files = raw.files.map((value, index) => {
    const entry = asRecord(value, `Derived export manifest files[${index}]`);
    exactKeys(entry, ["path", "sha256", "bytes"], `Derived export manifest files[${index}]`);
    if (typeof entry.path !== "string" || typeof entry.sha256 !== "string"
        || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes)
        || (entry.bytes as number) < 0 || (entry.bytes as number) > MAX_FILE_BYTES) {
      throw new Error(`Derived export manifest files[${index}] is invalid.`);
    }
    return { path: safeRelative(entry.path), sha256: entry.sha256, bytes: entry.bytes as number };
  });
  if (files.reduce((total, entry) => total + entry.bytes, 0) > MAX_TREE_BYTES) {
    throw new Error("Derived export manifest exceeds the 64 MiB tree limit.");
  }
  validateFiles(files.map((entry) => ({ path: entry.path, content: "" })));
  if (!files.some((entry) => entry.path === raw.upstreamSourceStamp)) {
    throw new Error("Derived export manifest source stamp is not a managed file.");
  }
  return {
    schema: "groundwork.derived-export/v1",
    derivedFrom: "Groundwork",
    format: raw.format,
    exporterVersion: "1",
    spec: { id: spec.id, schemaVersion: 3, digest: spec.digest as `sha256:${string}` },
    upstreamSourceStamp: raw.upstreamSourceStamp,
    files,
  };
}

function walkTree(root: string, relative = ""): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    const absolute = path.join(root, ...child.split("/"));
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Derived export tree contains a symlink: ${child}`);
    if (stat.isDirectory()) files.push(...walkTree(root, child));
    else if (stat.isFile()) files.push(child);
    else throw new Error(`Derived export tree contains a special entry: ${child}`);
  }
  return files;
}

function verifyManagedTree(root: string): VerifiedManagedTree {
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Derived export root must be a regular non-symlink directory.");
  const entries = walkTree(root);
  if (!entries.length) return { manifest: undefined, fingerprint: null };
  if (!entries.includes(MANIFEST_NAME)) throw new Error("Refusing to adopt a nonempty directory without a Groundwork derived export manifest.");
  const manifestBytes = readNoFollow(path.join(root, MANIFEST_NAME), MANIFEST_NAME, 512 * 1024);
  const manifest = parseManifest(JSON.parse(manifestBytes.toString("utf8")));
  const canonicalManifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  if (!manifestBytes.equals(canonicalManifestBytes)) {
    throw new Error("Refusing to replace modified derived export manifest bytes.");
  }
  const expected = [...manifest.files.map((entry) => entry.path), MANIFEST_NAME].sort();
  if (JSON.stringify(entries.sort()) !== JSON.stringify(expected)) {
    throw new Error("Derived export tree contains unmanaged or missing entries.");
  }
  for (const entry of manifest.files) {
    const data = readNoFollow(path.join(root, ...entry.path.split("/")), entry.path, MAX_FILE_BYTES);
    if (data.byteLength !== entry.bytes || sha256(data) !== entry.sha256) {
      throw new Error(`Refusing to replace modified derived export file: ${entry.path}`);
    }
  }
  return { manifest, fingerprint: sha256(manifestBytes) };
}

function verifyExactManagedTree(root: string, expected: string | null, label: string): ExportManifest | undefined {
  const verified = verifyManagedTree(root);
  if (verified.fingerprint !== expected) {
    throw new Error(`${label} does not match the transaction generation.`);
  }
  return verified.manifest;
}

function canonicalProofMatches(proof: CanonicalCommitProof | null): boolean {
  if (!proof) return false;
  try {
    const rootStat = fs.lstatSync(proof.root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return false;
    const manifest = asRecord(
      JSON.parse(readNoFollow(path.join(proof.root, "artifact-manifest.json"), "Canonical artifact manifest", 512 * 1024).toString("utf8")),
      "Canonical artifact manifest",
    );
    if (manifest.schema !== "groundwork.artifacts/v1" || !Array.isArray(manifest.files)) return false;
    const entry = manifest.files.find((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      return (value as Record<string, unknown>).name === proof.fileName;
    });
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const record = entry as Record<string, unknown>;
    if (record.sha256 !== proof.sha256) return false;
    const data = readNoFollow(path.join(proof.root, proof.fileName), `Canonical proof ${proof.fileName}`, MAX_FILE_BYTES);
    return sha256(data) === proof.sha256;
  } catch {
    return false;
  }
}

function fsyncFile(file: string): void {
  const descriptor = fs.openSync(file, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function fsyncDir(dir: string): void {
  const descriptor = fs.openSync(dir, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function writeJournal(txDir: string, journal: ExportJournal): void {
  const next = path.join(txDir, "journal.next.json");
  fs.writeFileSync(next, `${JSON.stringify(journal, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  fsyncFile(next);
  fs.renameSync(next, path.join(txDir, "journal.json"));
  fsyncDir(txDir);
}

function parseJournal(file: string): ExportJournal {
  const raw = asRecord(JSON.parse(readNoFollow(file, "Derived export journal", 64 * 1024).toString("utf8")), "Derived export journal");
  exactKeys(raw, ["schema", "targetName", "phase", "expectedNewManifestSha256", "priorExisted", "priorManifestSha256", "canonicalProof"], "Derived export journal");
  if (raw.schema !== "groundwork.derived-export-transaction/v2" || typeof raw.targetName !== "string"
      || !raw.targetName || raw.targetName.includes("/") || raw.targetName.includes("\\")
      || (raw.phase !== "staged" && raw.phase !== "backed-up" && raw.phase !== "installed" && raw.phase !== "committed")
      || typeof raw.expectedNewManifestSha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.expectedNewManifestSha256)
      || typeof raw.priorExisted !== "boolean"
      || (raw.priorManifestSha256 !== null && (typeof raw.priorManifestSha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.priorManifestSha256)))) {
    throw new Error("Derived export journal has an invalid contract.");
  }
  let canonicalProof: CanonicalCommitProof | null = null;
  if (raw.canonicalProof !== null) {
    const proof = asRecord(raw.canonicalProof, "Derived export journal canonicalProof");
    exactKeys(proof, ["root", "fileName", "sha256"], "Derived export journal canonicalProof");
    if (typeof proof.root !== "string" || !path.isAbsolute(proof.root)
        || typeof proof.fileName !== "string" || path.basename(proof.fileName) !== proof.fileName || !proof.fileName
        || typeof proof.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(proof.sha256)) {
      throw new Error("Derived export journal canonicalProof is invalid.");
    }
    canonicalProof = { root: proof.root, fileName: proof.fileName, sha256: proof.sha256 };
  }
  return {
    schema: "groundwork.derived-export-transaction/v2",
    targetName: raw.targetName,
    phase: raw.phase,
    expectedNewManifestSha256: raw.expectedNewManifestSha256,
    priorExisted: raw.priorExisted,
    priorManifestSha256: raw.priorManifestSha256 as string | null,
    canonicalProof,
  };
}

function recoverTransactions(parent: string, targetName: string, key: string): void {
  const prefix = `.groundwork-export-tx-${key}-`;
  for (const entry of fs.readdirSync(parent).filter((name) => name.startsWith(prefix)).sort()) {
    const txDir = path.join(parent, entry);
    const stat = fs.lstatSync(txDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe derived export transaction: ${entry}`);
    const journalPath = path.join(txDir, "journal.json");
    if (!fs.existsSync(journalPath)) {
      const incompleteEntries = fs.readdirSync(txDir).sort();
      if (incompleteEntries.some((name) => name !== "stage" && name !== "journal.next.json")) {
        throw new Error(`Journal-free derived export transaction contains unexpected state: ${entry}`);
      }
      const incompleteStage = path.join(txDir, "stage");
      if (fs.existsSync(incompleteStage)) {
        const stageStat = fs.lstatSync(incompleteStage);
        if (!stageStat.isDirectory() || stageStat.isSymbolicLink()) {
          throw new Error(`Journal-free derived export transaction has an unsafe stage: ${entry}`);
        }
        walkTree(incompleteStage);
      }
      const nextJournal = path.join(txDir, "journal.next.json");
      if (fs.existsSync(nextJournal)) parseJournal(nextJournal);
      fs.rmSync(txDir, { recursive: true, force: true });
      fsyncDir(parent);
      continue;
    }
    const journal = parseJournal(journalPath);
    if (journal.targetName !== targetName) throw new Error(`Derived export transaction target mismatch: ${entry}`);
    const target = path.join(parent, targetName);
    const backup = path.join(txDir, "backup");
    const stage = path.join(txDir, "stage");
    const hasTarget = fs.existsSync(target);
    const hasBackup = fs.existsSync(backup);
    if (hasBackup) {
      verifyExactManagedTree(backup, journal.priorManifestSha256, "Derived export backup");
    }
    let targetFingerprint: string | null | undefined;
    if (hasTarget) targetFingerprint = verifyManagedTree(target).fingerprint;
    const committed = journal.phase === "committed"
      || (journal.phase === "installed" && canonicalProofMatches(journal.canonicalProof));
    if (committed && hasTarget && targetFingerprint === journal.expectedNewManifestSha256) {
      if (hasBackup) fs.rmSync(backup, { recursive: true, force: true });
      if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
      fs.rmSync(txDir, { recursive: true, force: true });
      fsyncDir(parent);
      continue;
    }

    const targetIsPrior = hasTarget && journal.priorExisted && targetFingerprint === journal.priorManifestSha256;
    let conflict: string | undefined;
    if (!targetIsPrior && hasTarget) {
      if (targetFingerprint === journal.expectedNewManifestSha256) {
        fs.rmSync(target, { recursive: true, force: true });
      } else {
        conflict = path.join(parent, `.groundwork-export-conflict-${key}-${crypto.randomUUID()}`);
        fs.renameSync(target, conflict);
      }
    }
    if (!targetIsPrior && journal.priorExisted) {
      if (!hasBackup) {
        throw new Error(`Cannot recover prior derived export generation for ${entry}.`);
      }
      fs.renameSync(backup, target);
    } else if (hasBackup) {
      fs.rmSync(backup, { recursive: true, force: true });
    }
    if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
    fs.rmSync(txDir, { recursive: true, force: true });
    fsyncDir(parent);
    if (conflict) {
      throw new Error(`A conflicting derived export generation was preserved at ${conflict}; the prior generation was restored.`);
    }
  }
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function acquireLock(lock: string, targetName: string): void {
  try {
    fs.writeFileSync(lock, `${JSON.stringify({ pid: process.pid, targetName })}\n`, { flag: "wx", mode: 0o600 });
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const stat = fs.lstatSync(lock);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Derived export lock is not a regular file.");
  const value = asRecord(JSON.parse(readNoFollow(lock, "Derived export lock", 16 * 1024).toString("utf8")), "Derived export lock");
  if (typeof value.pid !== "number" || value.targetName !== targetName || processAlive(value.pid)) {
    throw new Error("Another derived export publisher owns this output root.");
  }
  fs.rmSync(lock);
  fs.writeFileSync(lock, `${JSON.stringify({ pid: process.pid, targetName })}\n`, { flag: "wx", mode: 0o600 });
}

function isContained(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function canonicalCandidate(value: string): string {
  let cursor = path.resolve(value);
  const suffix: string[] = [];
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  const resolved = fs.existsSync(cursor) ? fs.realpathSync(cursor) : cursor;
  return path.join(resolved, ...suffix);
}

export function assertDisjointArtifactRoots(coreRoot: string, exportRoot: string): void {
  const core = canonicalCandidate(coreRoot);
  const derived = canonicalCandidate(exportRoot);
  if (isContained(core, derived) || isContained(derived, core)) {
    throw new Error("Canonical artifact and derived export roots must be disjoint.");
  }
}

export function validateDerivedExportDestination(outputRoot: string, exported: DerivedExport): void {
  const files = validateFiles(exported.files);
  if (files.filter((file) => file.path.endsWith("groundwork-source.json")).length !== 1) {
    throw new Error("Derived export must contain exactly one groundwork-source.json stamp.");
  }
  const requested = path.resolve(outputRoot);
  const parent = path.dirname(requested);
  if (!fs.existsSync(parent)) return;
  const realParent = fs.realpathSync(parent);
  const target = path.join(realParent, path.basename(requested));
  if (fs.existsSync(target)) verifyManagedTree(target);
}

interface DerivedExportReservation {
  files: DerivedExportFile[];
  sourceStamp: DerivedExportFile;
  parent: string;
  targetName: string;
  target: string;
  key: string;
  lock: string;
  targetExisted: boolean;
  priorManifestSha256: string | null;
  canonicalProof: CanonicalCommitProof | null;
}

function reserveDerivedExportDestination(
  outputRoot: string,
  exported: DerivedExport,
  options: DerivedExportTransactionOptions = {},
): DerivedExportReservation {
  const files = validateFiles(exported.files);
  const sourceStamps = files.filter((file) => file.path.endsWith("groundwork-source.json"));
  if (sourceStamps.length !== 1) throw new Error("Derived export must contain exactly one groundwork-source.json stamp.");
  const requested = path.resolve(outputRoot);
  fs.mkdirSync(path.dirname(requested), { recursive: true });
  const parent = fs.realpathSync(path.dirname(requested));
  const targetName = path.basename(requested);
  const target = path.join(parent, targetName);
  const key = sha256(target).slice(0, 16);
  const lock = path.join(parent, `.groundwork-export-lock-${key}`);
  acquireLock(lock, targetName);
  try {
    recoverTransactions(parent, targetName, key);
    const targetExisted = fs.existsSync(target);
    const priorTree = targetExisted ? verifyManagedTree(target) : { manifest: undefined, fingerprint: null };
    let canonicalProof: CanonicalCommitProof | null = null;
    if (options.canonicalRoot) {
      const canonicalRoot = canonicalCandidate(options.canonicalRoot);
      assertDisjointArtifactRoots(canonicalRoot, target);
      if (options.canonicalProof) {
        if (path.basename(options.canonicalProof.fileName) !== options.canonicalProof.fileName
            || !options.canonicalProof.fileName || !/^[a-f0-9]{64}$/.test(options.canonicalProof.sha256)) {
          throw new Error("Canonical commit proof is invalid.");
        }
        canonicalProof = { root: canonicalRoot, ...options.canonicalProof };
      }
    } else if (options.canonicalProof) {
      throw new Error("Canonical commit proof requires a canonical root.");
    }
    return {
      files,
      sourceStamp: sourceStamps[0],
      parent,
      targetName,
      target,
      key,
      lock,
      targetExisted,
      priorManifestSha256: priorTree.fingerprint,
      canonicalProof,
    };
  } catch (error) {
    if (fs.existsSync(lock)) fs.rmSync(lock);
    throw error;
  }
}

function publishReservedDerivedExport(
  reservation: DerivedExportReservation,
  spec: Spec,
  exported: DerivedExport,
  commitCanonical?: () => void,
): string[] {
    const {
      files, sourceStamp, parent, targetName, target, key, targetExisted,
      priorManifestSha256, canonicalProof,
    } = reservation;
    validateSourceStampBinding(sourceStamp, spec, exported);
    const manifest: ExportManifest = {
      schema: "groundwork.derived-export/v1",
      derivedFrom: "Groundwork",
      format: exported.format,
      exporterVersion: exported.exporterVersion,
      spec: { id: spec.id, schemaVersion: 3, digest: calculateSpecDigest(spec) },
      upstreamSourceStamp: sourceStamp.path,
      files: files.map((file) => ({
        path: file.path,
        sha256: sha256(file.content),
        bytes: Buffer.byteLength(file.content, "utf8"),
      })),
    };
    parseManifest(manifest);
    const expectedNewManifestSha256 = sha256(`${JSON.stringify(manifest, null, 2)}\n`);
    const txDir = fs.mkdtempSync(path.join(parent, `.groundwork-export-tx-${key}-`));
    const stage = path.join(txDir, "stage");
    const backup = path.join(txDir, "backup");
    fs.mkdirSync(stage, { mode: 0o700 });
    let journal: ExportJournal = {
      schema: "groundwork.derived-export-transaction/v2",
      targetName,
      phase: "staged",
      expectedNewManifestSha256,
      priorExisted: targetExisted,
      priorManifestSha256,
      canonicalProof,
    };
    writeJournal(txDir, journal);
    for (const file of files) {
      const destination = path.join(stage, ...file.path.split("/"));
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
      fs.writeFileSync(destination, file.content, { flag: "wx", mode: 0o644 });
      if (file.path.endsWith(".json")) JSON.parse(file.content);
      fsyncFile(destination);
    }
    const manifestPath = path.join(stage, MANIFEST_NAME);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o644 });
    fsyncFile(manifestPath);
    fsyncDir(stage);
    if (process.env.GROUNDWORK_TEST_FAIL_DERIVED_EXPORT === "after-staging") {
      fs.rmSync(txDir, { recursive: true, force: true });
      throw new Error("Injected derived export failure after staging.");
    }
    let movedOld = false;
    let installedNew = false;
    let crossRootCommitted = false;
    try {
      if (process.env.GROUNDWORK_TEST_MUTATE_DERIVED_EXPORT === "add-unmanaged" && fs.existsSync(target)) {
        fs.writeFileSync(path.join(target, "user.txt"), "preserve", { flag: "wx" });
      }
      const existsAtCapture = fs.existsSync(target);
      if (existsAtCapture !== targetExisted) {
        throw new Error("Derived export root changed after reservation; refusing a partial commit.");
      }
      if (existsAtCapture) {
        fs.renameSync(target, backup);
        movedOld = true;
        // The rename captures one exact tree. Revalidate the captured bytes
        // before installing anything so concurrent unmanaged/modified data is
        // restored rather than silently deleted.
        verifyExactManagedTree(backup, priorManifestSha256, "Reserved prior derived export");
      }
      journal = { ...journal, phase: "backed-up" };
      writeJournal(txDir, journal);
      if (process.env.GROUNDWORK_TEST_FAIL_DERIVED_EXPORT === "after-backup") {
        throw new Error("Injected derived export failure after backup.");
      }
      if (fs.existsSync(target)) {
        throw new Error("Derived export root reappeared during publication; refusing to overwrite it.");
      }
      fs.renameSync(stage, target);
      installedNew = true;
      if (process.env.GROUNDWORK_TEST_MUTATE_DERIVED_EXPORT === "add-unmanaged-after-install") {
        fs.writeFileSync(path.join(target, "user.txt"), "preserve", { flag: "wx" });
      }
      const replacement = process.env.GROUNDWORK_TEST_REPLACE_DERIVED_EXPORT_AFTER_INSTALL;
      if (replacement) {
        fs.rmSync(target, { recursive: true, force: true });
        fs.renameSync(replacement, target);
      }
      journal = { ...journal, phase: "installed" };
      writeJournal(txDir, journal);
      if (process.env.GROUNDWORK_TEST_FAIL_DERIVED_EXPORT === "after-install") {
        throw new Error("Injected derived export failure after install.");
      }
      verifyExactManagedTree(target, expectedNewManifestSha256, "Installed derived export");
      commitCanonical?.();
      crossRootCommitted = true;
      journal = { ...journal, phase: "committed" };
      writeJournal(txDir, journal);
      fsyncDir(parent);
      if (movedOld) fs.rmSync(backup, { recursive: true, force: true });
      fs.rmSync(txDir, { recursive: true, force: true });
    } catch (error) {
      let failure = error as Error;
      if (crossRootCommitted) {
        // Canonical publication has returned successfully. Never roll derived
        // back after that boundary; leave generation-bound journal state for
        // deterministic recovery if final cleanup itself failed.
        verifyExactManagedTree(target, expectedNewManifestSha256, "Committed derived export");
        fsyncDir(parent);
        throw failure;
      }
      if (installedNew && fs.existsSync(target)) {
        try {
          verifyExactManagedTree(target, expectedNewManifestSha256, "Installed derived export rollback candidate");
          fs.rmSync(target, { recursive: true, force: true });
        } catch {
          const conflict = path.join(parent, `.groundwork-export-conflict-${key}-${crypto.randomUUID()}`);
          fs.renameSync(target, conflict);
          failure = new Error(`${failure.message} Concurrent output bytes were preserved in a sibling conflict directory.`);
        }
      } else if (movedOld && fs.existsSync(target)) {
        const conflict = path.join(parent, `.groundwork-export-conflict-${key}-${crypto.randomUUID()}`);
        fs.renameSync(target, conflict);
        failure = new Error(`${failure.message} Concurrent output bytes were preserved in a sibling conflict directory.`);
      }
      if (movedOld && fs.existsSync(backup)) fs.renameSync(backup, target);
      fs.rmSync(txDir, { recursive: true, force: true });
      fsyncDir(parent);
      throw failure;
    }
    return [...files.map((file) => path.join(target, ...file.path.split("/"))), path.join(target, MANIFEST_NAME)];
}

export function withDerivedExportReservation<T>(
  outputRoot: string,
  exported: DerivedExport,
  operation: (publish: (spec: Spec, commitCanonical?: () => void) => string[]) => T,
  options: DerivedExportTransactionOptions = {},
): T {
  const reservation = reserveDerivedExportDestination(outputRoot, exported, options);
  let published = false;
  try {
    return operation((spec, commitCanonical) => {
      if (published) throw new Error("A derived export reservation can publish only once.");
      published = true;
      return publishReservedDerivedExport(reservation, spec, exported, commitCanonical);
    });
  } finally {
    if (fs.existsSync(reservation.lock)) fs.rmSync(reservation.lock);
  }
}

export function publishDerivedExport(outputRoot: string, spec: Spec, exported: DerivedExport): string[] {
  return withDerivedExportReservation(outputRoot, exported, (publish) => publish(spec));
}
