import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

type JournalOperation = "publish" | "remove";

interface JournalItem {
  name: string;
  existed: boolean;
  operation: JournalOperation;
}

interface Journal {
  schema: "groundwork.transaction/v3";
  generationId: string;
  files: JournalItem[];
  hashes: Record<string, string>;
  manifestSha256: string | null;
}

interface ArtifactManifest {
  schema: "groundwork.artifacts/v1";
  generationId: string;
  generatedAt: string;
  files: Array<{ name: string; sha256: string }>;
}

const SHA256_RE = /^[a-f0-9]{64}$/;
const TRANSACTION_PREFIX = ".groundwork-tx-";

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fsyncFile(file: string): void {
  const fd = fs.openSync(file, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function fsyncDir(dir: string): void {
  const fd = fs.openSync(dir, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function safeManagedName(name: string): boolean {
  return Boolean(name)
    && !path.isAbsolute(name)
    && path.dirname(name) === "."
    && name !== "."
    && name !== ".."
    && !name.includes("\\")
    && !name.includes("/");
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} contains unsupported fields.`);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function safeTopLevelPath(root: string, name: string, label: string): string {
  if (!safeManagedName(name)) throw new Error(`${label} contains an unsafe managed file name.`);
  const absoluteRoot = path.resolve(root);
  const candidate = path.resolve(absoluteRoot, name);
  if (path.dirname(candidate) !== absoluteRoot) throw new Error(`${label} escapes its managed directory.`);
  return candidate;
}

function requireSafeRegularFile(file: string, label: string, maxBytes?: number): fs.Stats {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular, non-symlink file.`);
  if (maxBytes !== undefined && stat.size > maxBytes) throw new Error(`${label} exceeds its size limit.`);
  return stat;
}

function requireSafeDirectory(dir: string, label: string): void {
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular, non-symlink directory.`);
}

function parseManifest(value: unknown, label: string): ArtifactManifest {
  const raw = record(value, label);
  exactKeys(raw, ["schema", "generationId", "generatedAt", "files"], label);
  if (raw.schema !== "groundwork.artifacts/v1"
      || typeof raw.generationId !== "string" || !raw.generationId
      || typeof raw.generatedAt !== "string" || !raw.generatedAt
      || !Array.isArray(raw.files)) {
    throw new Error(`${label} has an invalid contract.`);
  }
  const seen = new Set<string>();
  const files = raw.files.map((value, index) => {
    const entry = record(value, `${label}.files[${index}]`);
    exactKeys(entry, ["name", "sha256"], `${label}.files[${index}]`);
    if (typeof entry.name !== "string" || !safeManagedName(entry.name)) {
      throw new Error(`${label}.files[${index}] contains an unsafe managed file name.`);
    }
    if (seen.has(entry.name)) throw new Error(`${label} contains duplicate file ${entry.name}.`);
    seen.add(entry.name);
    if (typeof entry.sha256 !== "string" || !SHA256_RE.test(entry.sha256)) {
      throw new Error(`${label}.files[${index}].sha256 is invalid.`);
    }
    return { name: entry.name, sha256: entry.sha256 };
  });
  return {
    schema: "groundwork.artifacts/v1",
    generationId: raw.generationId,
    generatedAt: raw.generatedAt,
    files,
  };
}

function parseJournal(value: unknown): Journal {
  const raw = record(value, "Transaction journal");
  const isLegacy = raw.schema === undefined;
  const isV2 = raw.schema === "groundwork.transaction/v2";
  exactKeys(
    raw,
    isLegacy
      ? ["generationId", "files", "hashes"]
      : isV2
        ? ["schema", "generationId", "files", "hashes"]
        : ["schema", "generationId", "files", "hashes", "manifestSha256"],
    "Transaction journal",
  );
  if ((!isLegacy && !isV2 && raw.schema !== "groundwork.transaction/v3")
      || typeof raw.generationId !== "string" || !raw.generationId
      || !Array.isArray(raw.files)) {
    throw new Error("Transaction journal has an invalid contract.");
  }
  const manifestSha256 = raw.schema === "groundwork.transaction/v3" ? raw.manifestSha256 : null;
  if (manifestSha256 !== null && (typeof manifestSha256 !== "string" || !SHA256_RE.test(manifestSha256))) {
    throw new Error("Transaction journal manifestSha256 is invalid.");
  }
  const hashesRaw = record(raw.hashes, "Transaction journal hashes");
  const hashes: Record<string, string> = {};
  for (const [name, hash] of Object.entries(hashesRaw)) {
    if (!safeManagedName(name) || typeof hash !== "string" || !SHA256_RE.test(hash)) {
      throw new Error("Transaction journal contains an unsafe name or invalid hash.");
    }
    hashes[name] = hash;
  }
  const seen = new Set<string>();
  const files = raw.files.map((value, index): JournalItem => {
    const item = record(value, `Transaction journal files[${index}]`);
    exactKeys(
      item,
      isLegacy ? ["name", "existed"] : ["name", "existed", "operation"],
      `Transaction journal files[${index}]`,
    );
    if (typeof item.name !== "string" || !safeManagedName(item.name)) {
      throw new Error(`Transaction journal files[${index}] contains an unsafe managed file name.`);
    }
    if (seen.has(item.name)) throw new Error(`Transaction journal contains duplicate file ${item.name}.`);
    seen.add(item.name);
    if (typeof item.existed !== "boolean") throw new Error(`Transaction journal files[${index}].existed is invalid.`);
    const operation = isLegacy ? "publish" : item.operation;
    if (operation !== "publish" && operation !== "remove") {
      throw new Error(`Transaction journal files[${index}].operation is invalid.`);
    }
    if (operation === "remove" && item.name === "artifact-manifest.json") {
      throw new Error("Transaction journal cannot remove artifact-manifest.json.");
    }
    return { name: item.name, existed: item.existed, operation };
  });
  const manifestItems = files.filter((item) => item.name === "artifact-manifest.json");
  if (manifestItems.length !== 1 || manifestItems[0].operation !== "publish"
      || files.at(-1)?.name !== "artifact-manifest.json") {
    throw new Error("Transaction journal must publish artifact-manifest.json exactly once and last.");
  }
  for (const name of Object.keys(hashes)) {
    if (!files.some((item) => item.name === name && item.operation === "publish")) {
      throw new Error(`Transaction journal hash ${name} has no publish operation.`);
    }
  }
  for (const item of files) {
    if (item.name === "artifact-manifest.json") continue;
    if (item.operation === "publish" && hashes[item.name] === undefined) {
      throw new Error(`Transaction journal publish ${item.name} has no content hash.`);
    }
    if (item.operation === "remove" && hashes[item.name] !== undefined) {
      throw new Error(`Transaction journal removal ${item.name} cannot carry a content hash.`);
    }
  }
  return {
    schema: "groundwork.transaction/v3",
    generationId: raw.generationId,
    files,
    hashes,
    manifestSha256: manifestSha256 as string | null,
  };
}

function readJsonFile(file: string, label: string, maxBytes: number): unknown {
  requireSafeRegularFile(file, label, maxBytes);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function validateTransactionLayout(txDir: string, journal: Journal): void {
  requireSafeDirectory(txDir, "Transaction directory");
  const allowedRootEntries = new Set(["journal.json", "stage", "backup"]);
  for (const name of fs.readdirSync(txDir)) {
    if (!allowedRootEntries.has(name)) throw new Error(`Transaction directory contains unexpected entry ${name}.`);
  }
  const stageDir = path.join(txDir, "stage");
  const backupDir = path.join(txDir, "backup");
  requireSafeDirectory(stageDir, "Transaction stage directory");
  requireSafeDirectory(backupDir, "Transaction backup directory");
  const expected = new Set(journal.files.map((item) => item.name));
  for (const [dir, label] of [[stageDir, "stage"], [backupDir, "backup"]] as const) {
    for (const name of fs.readdirSync(dir)) {
      if (!expected.has(name) || !safeManagedName(name)) {
        throw new Error(`Transaction ${label} contains unexpected entry ${name}.`);
      }
      requireSafeRegularFile(safeTopLevelPath(dir, name, `Transaction ${label}`), `Transaction ${label} file ${name}`);
    }
  }
}

function manifestMatches(outDir: string, journal: Journal): boolean {
  const manifestPath = path.join(outDir, "artifact-manifest.json");
  try {
    const manifestBytes = fs.readFileSync(manifestPath);
    if (journal.manifestSha256 && sha256(manifestBytes.toString("utf8")) !== journal.manifestSha256) return false;
    const manifest = parseManifest(
      JSON.parse(manifestBytes.toString("utf8")),
      "artifact-manifest.json",
    );
    if (manifest.generationId !== journal.generationId) return false;
    const manifestHashes = Object.fromEntries(manifest.files.map((entry) => [entry.name, entry.sha256]));
    const expectedHashNames = Object.keys(journal.hashes).sort();
    if (JSON.stringify(Object.keys(manifestHashes).sort()) !== JSON.stringify(expectedHashNames)) return false;
    for (const [name, hash] of Object.entries(journal.hashes)) {
      const file = safeTopLevelPath(outDir, name, "Transaction manifest check");
      if (!fs.existsSync(file)) return false;
      requireSafeRegularFile(file, `Managed artifact ${name}`);
      if (manifestHashes[name] !== hash || sha256(fs.readFileSync(file, "utf8")) !== hash) return false;
    }
    for (const item of journal.files) {
      if (item.operation !== "remove") continue;
      if (fs.existsSync(safeTopLevelPath(outDir, item.name, "Transaction removal check"))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function priorManagedRemovals(outDir: string, nextNames: Set<string>): string[] {
  const manifestPath = path.join(outDir, "artifact-manifest.json");
  if (!fs.existsSync(manifestPath)) return [];
  const manifest = parseManifest(
    readJsonFile(manifestPath, "Existing artifact-manifest.json", 512 * 1024),
    "Existing artifact-manifest.json",
  );
  const removals: string[] = [];
  for (const entry of manifest.files) {
    if (nextNames.has(entry.name)) continue;
    const file = safeTopLevelPath(outDir, entry.name, "Existing artifact manifest");
    if (!fs.existsSync(file)) continue;
    requireSafeRegularFile(file, `Previously managed artifact ${entry.name}`);
    if (sha256(fs.readFileSync(file, "utf8")) !== entry.sha256) {
      throw new Error(`Refusing to remove modified managed artifact: ${entry.name}`);
    }
    removals.push(entry.name);
  }
  return removals.sort();
}

function installedFileMatches(file: string, item: JournalItem, journal: Journal): boolean {
  if (item.operation === "remove") return !fs.existsSync(file);
  try {
    requireSafeRegularFile(file, `Installed artifact ${item.name}`);
    const expected = item.name === "artifact-manifest.json"
      ? journal.manifestSha256
      : journal.hashes[item.name];
    if (typeof expected === "string") return sha256(fs.readFileSync(file, "utf8")) === expected;
    if (item.name !== "artifact-manifest.json") return false;
    const legacyManifest = parseManifest(JSON.parse(fs.readFileSync(file, "utf8")), "Installed legacy artifact manifest");
    return legacyManifest.generationId === journal.generationId
      && JSON.stringify(Object.fromEntries(legacyManifest.files.map((entry) => [entry.name, entry.sha256])))
        === JSON.stringify(journal.hashes);
  } catch {
    return false;
  }
}

function quarantineConcurrentArtifact(
  outDir: string,
  generationId: string,
  name: string,
  file: string,
  conflictRoot: string | undefined,
): string {
  const root = conflictRoot ?? fs.mkdtempSync(
    path.join(path.dirname(outDir), `.groundwork-artifact-conflict-${path.basename(outDir)}-${generationId}-`),
  );
  const destination = path.join(root, name);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.renameSync(file, destination);
  fsyncDir(root);
  return root;
}

/** Recover an interrupted transaction before any consumer reads the artifact set. */
export function recoverArtifactTransactions(outDir: string): void {
  if (!fs.existsSync(outDir)) return;
  requireSafeDirectory(outDir, "Groundwork output directory");
  for (const entry of fs.readdirSync(outDir).sort()) {
    if (!entry.startsWith(TRANSACTION_PREFIX)) continue;
    if (!safeManagedName(entry)) throw new Error("Groundwork output contains an unsafe transaction name.");
    const txDir = safeTopLevelPath(outDir, entry, "Groundwork transaction");
    requireSafeDirectory(txDir, "Transaction directory");
    const journalPath = path.join(txDir, "journal.json");
    let journal: Journal;
    try {
      journal = parseJournal(readJsonFile(journalPath, "Transaction journal", 512 * 1024));
      if (entry !== `${TRANSACTION_PREFIX}${journal.generationId}`) {
        throw new Error("Transaction directory name does not match its generationId.");
      }
      validateTransactionLayout(txDir, journal);
    } catch (error) {
      throw new Error(`Cannot safely recover incomplete Groundwork transaction ${entry}: ${(error as Error).message}`);
    }
    if (!manifestMatches(outDir, journal)) {
      const stageDir = path.join(txDir, "stage");
      const backupDir = path.join(txDir, "backup");
      let conflictRoot: string | undefined;
      for (const item of [...journal.files].reverse()) {
        const finalPath = safeTopLevelPath(outDir, item.name, "Transaction destination");
        const backupPath = safeTopLevelPath(backupDir, item.name, "Transaction backup");
        const stagedPath = safeTopLevelPath(stageDir, item.name, "Transaction stage");
        if (fs.existsSync(backupPath)) {
          requireSafeRegularFile(backupPath, `Transaction backup ${item.name}`);
          if (fs.existsSync(finalPath)) {
            if (installedFileMatches(finalPath, item, journal)) fs.rmSync(finalPath, { force: true });
            else conflictRoot = quarantineConcurrentArtifact(outDir, journal.generationId, item.name, finalPath, conflictRoot);
          }
          fs.renameSync(backupPath, finalPath);
        } else if (!item.existed && fs.existsSync(finalPath)) {
          if (installedFileMatches(finalPath, item, journal)) fs.rmSync(finalPath, { force: true });
          else conflictRoot = quarantineConcurrentArtifact(outDir, journal.generationId, item.name, finalPath, conflictRoot);
        }
      }
      fs.rmSync(txDir, { recursive: true, force: true });
      if (conflictRoot) {
        throw new Error(`Concurrent artifact bytes were preserved at ${conflictRoot}; the prior generation was restored.`);
      }
      continue;
    }
    fs.rmSync(txDir, { recursive: true, force: true });
  }
}

/** Publish all generated projections as one rollback-safe artifact generation. */
export function writeArtifactSetAtomically(
  outDir: string,
  artifacts: Record<string, string>,
): string[] {
  fs.mkdirSync(outDir, { recursive: true });
  recoverArtifactTransactions(outDir);

  const names = Object.keys(artifacts).sort();
  if (names.some((name) => !safeManagedName(name)) || names.includes("artifact-manifest.json")) {
    throw new Error("Groundwork artifact names must be safe top-level relative filenames and must not replace the managed manifest.");
  }
  const removalNames = priorManagedRemovals(outDir, new Set(names));
  const generationId = crypto.randomUUID();
  const hashes = Object.fromEntries(names.map((name) => [name, sha256(artifacts[name])]));
  const manifest = JSON.stringify({
    schema: "groundwork.artifacts/v1",
    generationId,
    generatedAt: new Date().toISOString(),
    files: names.map((name) => ({ name, sha256: hashes[name] })),
  }, null, 2) + "\n";
  const allArtifacts: Record<string, string> = {
    ...artifacts,
    "artifact-manifest.json": manifest,
  };
  const operations: JournalItem[] = [
    ...names.map((name): JournalItem => ({
      name,
      existed: fs.existsSync(safeTopLevelPath(outDir, name, "Artifact destination")),
      operation: "publish",
    })),
    ...removalNames.map((name): JournalItem => ({ name, existed: true, operation: "remove" })),
    {
      name: "artifact-manifest.json",
      existed: fs.existsSync(path.join(outDir, "artifact-manifest.json")),
      operation: "publish",
    },
  ];
  const txDir = path.join(outDir, `${TRANSACTION_PREFIX}${generationId}`);
  const stageDir = path.join(txDir, "stage");
  const backupDir = path.join(txDir, "backup");
  fs.mkdirSync(stageDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });

  const journal: Journal = {
    schema: "groundwork.transaction/v3",
    generationId,
    files: operations,
    hashes,
    manifestSha256: sha256(manifest),
  };

  try {
    for (const item of operations) {
      const finalPath = safeTopLevelPath(outDir, item.name, "Artifact destination");
      if (fs.existsSync(finalPath)) requireSafeRegularFile(finalPath, `Managed artifact destination ${item.name}`);
      if (item.operation === "remove") continue;
      const staged = safeTopLevelPath(stageDir, item.name, "Artifact stage");
      fs.writeFileSync(staged, allArtifacts[item.name], { encoding: "utf8", flag: "wx" });
      fsyncFile(staged);
      if (item.name.endsWith(".json")) JSON.parse(fs.readFileSync(staged, "utf8"));
    }
    fs.writeFileSync(path.join(txDir, "journal.json"), JSON.stringify(journal, null, 2), { flag: "wx" });
    fsyncFile(path.join(txDir, "journal.json"));
  } catch (error) {
    fs.rmSync(txDir, { recursive: true, force: true });
    throw error;
  }

  let installed = 0;
  const touched: JournalItem[] = [];
  try {
    for (const item of operations) {
      touched.push(item);
      const finalPath = safeTopLevelPath(outDir, item.name, "Artifact destination");
      const backupPath = safeTopLevelPath(backupDir, item.name, "Artifact backup");
      if (fs.existsSync(finalPath)) fs.renameSync(finalPath, backupPath);
      if (item.operation === "publish") {
        if (process.env.GROUNDWORK_TEST_INSERT_ARTIFACT_BEFORE_INSTALL === item.name) {
          fs.writeFileSync(finalPath, "concurrent-before-install\n", { flag: "wx" });
        }
        const stagedPath = safeTopLevelPath(stageDir, item.name, "Artifact stage");
        // Hard-link creation is atomic and refuses an existing destination,
        // unlike rename(2), which would silently replace concurrent bytes.
        fs.linkSync(stagedPath, finalPath);
        fs.unlinkSync(stagedPath);
      }
      installed += 1;
      if (process.env.GROUNDWORK_TEST_MUTATE_ARTIFACT_AFTER_INSTALL === item.name && fs.existsSync(finalPath)) {
        fs.writeFileSync(finalPath, "concurrent-preserve\n");
      }
      if (Number(process.env.GROUNDWORK_TEST_FAIL_AFTER_INSTALL) === installed) {
        throw new Error(`Injected artifact transaction failure after ${installed} install(s).`);
      }
    }
    fsyncDir(outDir);
    if (!manifestMatches(outDir, journal)) {
      throw new Error("Installed artifact generation changed during publication.");
    }
    fs.rmSync(txDir, { recursive: true, force: true });
    return [...names, "artifact-manifest.json"].map((name) => path.join(outDir, name));
  } catch (error) {
    let conflictRoot: string | undefined;
    for (const item of [...touched].reverse()) {
      const finalPath = safeTopLevelPath(outDir, item.name, "Artifact destination");
      const backupPath = safeTopLevelPath(backupDir, item.name, "Artifact backup");
      if (fs.existsSync(backupPath)) {
        requireSafeRegularFile(backupPath, `Artifact backup ${item.name}`);
        if (fs.existsSync(finalPath)) {
          if (installedFileMatches(finalPath, item, journal)) fs.rmSync(finalPath, { force: true });
          else conflictRoot = quarantineConcurrentArtifact(outDir, generationId, item.name, finalPath, conflictRoot);
        }
        fs.renameSync(backupPath, finalPath);
      } else if (!item.existed && fs.existsSync(finalPath)) {
        if (installedFileMatches(finalPath, item, journal)) fs.rmSync(finalPath, { force: true });
        else conflictRoot = quarantineConcurrentArtifact(outDir, generationId, item.name, finalPath, conflictRoot);
      }
    }
    fs.rmSync(txDir, { recursive: true, force: true });
    if (conflictRoot) {
      throw new Error(`${(error as Error).message} Concurrent artifact bytes were preserved at ${conflictRoot}.`, { cause: error });
    }
    throw error;
  }
}
