#!/usr/bin/env node
// Groundwork version writer — the ONLY way the version moves.
//
// `.claude-plugin/plugin.json` is the source of truth because it is the file
// the Claude/Codex plugin host actually reads. Every other file mirrors it, and
// this script writes them together so they cannot drift. See
// scripts/version_gate.py for the failure this prevents.
//
// Run it AS PART OF PUSHING, never during development: a version that is not on
// origin is not a version. Commit the result, then push.
//
//   node scripts/set-version.mjs --patch
//   node scripts/set-version.mjs --minor
//   node scripts/set-version.mjs --set 0.4.0
//
// It writes NAMED KEYS, never a regex sweep. An earlier draft anchored the
// rewrite on the source file's current value, which meant it silently skipped
// every mirror that had already drifted — the exact situation it exists to
// repair. It also would have been one bad pattern away from rewriting a
// dependency's version inside package-lock.json.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = ".claude-plugin/plugin.json";

// Every place a Groundwork version legitimately lives, addressed by key path.
// A path that is absent is skipped; a path that exists is set.
const TARGETS = [
  { file: SOURCE, paths: [["version"]] },
  { file: ".codex-plugin/plugin.json", paths: [["version"]] },
  { file: "package.json", paths: [["version"]] },
  { file: "package-lock.json", paths: [["version"], ["packages", "", "version"]] },
  { file: ".claude-plugin/marketplace.json", paths: [["metadata", "version"], ["plugins", 0, "version"]] },
  { file: ".agents/plugins/marketplace.json", paths: [["metadata", "version"], ["plugins", 0, "version"]] },
];

function getIn(obj, keys) {
  let cur = obj;
  for (const k of keys) {
    if (cur === undefined || cur === null) return undefined;
    cur = cur[k];
  }
  return cur;
}


/**
 * Replace the first `count` occurrences of `"version": "<old>"` in the RAW text.
 *
 * Editing text rather than round-tripping JSON.stringify keeps each file's own
 * formatting: .claude-plugin/marketplace.json writes `"owner": { "name": ... }`
 * on one line, and a re-stringify reflowed it into four, putting unrelated noise
 * in the release diff.
 *
 * `count` is the number of key paths this file legitimately carries, so a
 * dependency in package-lock.json that happens to share the old version string
 * is out of reach: the real sites (`.version`, `.packages[""].version`) are the
 * first two in an npm lockfile. The caller re-parses and verifies afterwards, so
 * a miscount fails loudly rather than silently writing the wrong file.
 */
function replaceVersions(raw, oldValue, newValue, count) {
  const needle = `"version": "${oldValue}"`;
  const replacement = `"version": "${newValue}"`;
  let out = raw;
  let from = 0;
  let done = 0;
  while (done < count) {
    const at = out.indexOf(needle, from);
    if (at === -1) break;
    out = out.slice(0, at) + replacement + out.slice(at + needle.length);
    from = at + replacement.length;
    done += 1;
  }
  return { text: out, replaced: done };
}

const args = process.argv.slice(2);
const setIdx = args.indexOf("--set");

const sourceAbs = path.join(ROOT, SOURCE);
const current = JSON.parse(fs.readFileSync(sourceAbs, "utf8")).version;
if (typeof current !== "string" || !/^\d+\.\d+\.\d+$/.test(current)) {
  console.error(`${SOURCE} has no valid semver version (found ${JSON.stringify(current)})`);
  process.exit(2);
}
const [maj, min, pat] = current.split(".").map(Number);

let next;
if (setIdx !== -1) next = args[setIdx + 1];
else if (args.includes("--minor")) next = `${maj}.${min + 1}.0`;
else if (args.includes("--patch")) next = `${maj}.${min}.${pat + 1}`;
else if (args.includes("--major")) next = `${maj + 1}.0.0`;
else {
  console.error("usage: set-version.mjs --patch | --minor | --major | --set <x.y.z>");
  process.exit(2);
}
if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error(`not semver: ${next}`);
  process.exit(2);
}

console.log(`${current} -> ${next}`);
for (const { file, paths } of TARGETS) {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) {
    console.log(`  absent   ${file}`);
    continue;
  }
  const raw = fs.readFileSync(abs, "utf8");
  const blob = JSON.parse(raw);

  // Group the live sites by the value they currently hold: a drifted file may
  // carry a different old version than the source, which is exactly the case
  // this script has to repair.
  const live = paths.filter((keys) => getIn(blob, keys) !== undefined);
  if (live.length === 0) {
    console.log(`  no site  ${file}`);
    continue;
  }
  const byOld = new Map();
  for (const keys of live) {
    const old = String(getIn(blob, keys));
    byOld.set(old, (byOld.get(old) || 0) + 1);
  }

  let text = raw;
  const written = [];
  for (const [old, count] of byOld) {
    if (old === next) continue;
    const { text: updated, replaced } = replaceVersions(text, old, next, count);
    text = updated;
    written.push(`${replaced}x ${old}`);
  }
  if (written.length === 0) {
    console.log(`  current  ${file}`);
    continue;
  }

  // Verify against the parsed result, so a missed or mis-scoped replacement
  // fails loudly instead of leaving a half-written manifest.
  const after = JSON.parse(text);
  const wrong = live.filter((keys) => getIn(after, keys) !== next);
  if (wrong.length > 0) {
    console.error(`  FAILED   ${file} — ${wrong.map((k) => k.join(".")).join(", ")} did not take ${next}`);
    process.exit(1);
  }
  fs.writeFileSync(abs, text);
  console.log(`  updated  ${file}  (${written.join(", ")})`);
}

console.log("\nCommit these, then push. The pre-push gate verifies agreement and the bump.");
