#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value) throw new Error(`${name} requires a value`);
  return path.resolve(value);
}

const cli = option("--cli", path.join(ROOT, "engine", "dist", "cli.js"));
const fixture = option("--fixture", path.join(ROOT, "engine", "fixtures", "export-ready-spec.json"));

function snapshot(root, relative = "") {
  const entries = [];
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    const absolute = path.join(root, ...child.split("/"));
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`staged CLI emitted a symlink: ${child}`);
    if (stat.isDirectory()) entries.push(...snapshot(root, child));
    else if (stat.isFile()) {
      const data = fs.readFileSync(absolute);
      entries.push({ path: child, sha256: crypto.createHash("sha256").update(data).digest("hex"), bytes: data.byteLength });
    } else throw new Error(`staged CLI emitted a special entry: ${child}`);
  }
  return entries;
}

function run(format, root, pass) {
  const canonical = path.join(root, `canonical-${format}-${pass}`);
  const derived = path.join(root, `derived-${format}`);
  const result = spawnSync(process.execPath, [cli, fixture, "--out", canonical, "--export", format, "--export-out", derived], {
    encoding: "utf8",
    env: { ...process.env, NO_PROXY: "*", no_proxy: "*" },
  });
  if (result.status !== 0) throw new Error(`${format} staged CLI failed: ${result.stderr || result.stdout}`);
  if (!result.stderr.includes('"event":"derived_export_written"')) throw new Error(`${format} staged CLI omitted its completion event`);
  const manifest = JSON.parse(fs.readFileSync(path.join(derived, ".groundwork-export-manifest.json"), "utf8"));
  if (manifest.schema !== "groundwork.derived-export/v1" || manifest.format !== format || manifest.derivedFrom !== "Groundwork") {
    throw new Error(`${format} staged CLI emitted an invalid manifest`);
  }
  return snapshot(derived);
}

if (!fs.existsSync(cli) || !fs.existsSync(fixture)) throw new Error("staged CLI or export fixture is missing");
const scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "groundwork-staged-adapters-"));
try {
  for (const format of ["spec-kit", "openspec"]) {
    const first = run(format, scratch, 1);
    const second = run(format, scratch, 2);
    if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error(`${format} staged CLI rerun changed output bytes`);
  }
  process.stdout.write("STAGED DERIVED EXPORT GATE PASSED\n");
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
