// gallery-archive.mjs — the archive engine for mockup annotations.
//
// WHY THIS IS ITS OWN MODULE (plan D9): decide() is the whole detection
// policy for "did the content this annotation was made against change", and
// it is the target of the falsifying mutations in the verification table.
// Keeping it pure and separate from canvas-server.mjs (2000+ lines) means the
// policy is unit-testable without booting an HTTP server or a headless
// browser. Pure Node stdlib only — no dependencies to keep in sync with the
// server's own zero-dependency posture.
//
// WHAT THIS OWNS on disk, under <ctrlDir> (== <mockups-dir>/.canvas):
//   slot-versions.json              {schema, slots:{<slot>:{hash, seenAt}}}
//   current/<slot>                  byte snapshot of the recorded version
//   archive/<slot>/<version>/<slot>            prior HTML (absent on mtime-bootstrap,
//                                               and on any content-hash archive with
//                                               nothing open to retire)
//   archive/<slot>/<version>/annotations.json  the archived annotation records
//
// <slot> is used VERBATIM as a directory/file name. It is validated against
// SLOT_RE by every function that takes one as an argument, so there is no
// separate "sanitize the slot" step to forget.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ARCHIVE_SCHEMA = 'groundwork.gallery-archive/v1';
export const VERSIONS_SCHEMA = 'groundwork.gallery-slot-versions/v1';

// Slot names come straight from manifest.json and are used as path segments
// (directory names under archive/, file names under current/). This is the
// ONE gate that keeps a hostile or malformed manifest entry from escaping
// .canvas/ via `..` or an absolute path — see D6/V8 in the plan.
export const SLOT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// '20260722T051056Z-3f9a1c2b' — UTC compact time + first 8 hex of A hash.
// Which hash depends on the path: on content-hash it is the ARCHIVED
// content's sha256; on mtime-bootstrap (no prior bytes to hash) it is the
// SUPERSEDING content's hash instead, since that is the only one available.
// Lexicographically sortable, but NOT collision-free within the same
// second — nextFreeVersion walks the timestamp forward when two archives
// want the same name — and NOT self-identifying: the `-<hash8>` suffix is
// only a prefilter over directory names, so idempotency (findVersionForHash)
// still keys off the payload's own `hash` field, never the name.
export const VERSION_RE = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;

export function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function versionId(nowIso, hashHex) {
  // New Date(nowIso).toISOString() round-trips any valid ISO input to the
  // canonical millisecond form, so callers can pass a bare `new Date()...`
  // string or a stored one without this drifting apart from VERSION_RE.
  const compact = new Date(nowIso).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `${compact}-${hashHex.slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// decide() — PURE. No I/O, no clock reads, no filesystem. This is the whole
// detection policy and the target of the falsifying mutations (V2, V4b, and
// the plan's B1 truth table). Every row of that table is exercised by name
// in the unit test.
// ---------------------------------------------------------------------------
export function decide({ hasRecord, priorHash, currentHash, hasSnapshot, openCount, staleOpenCount, fileMissing }) {
  if (fileMissing) {
    // The manifest still lists this slot but its HTML is gone. There is
    // nothing to hash, snapshot, or archive against — and nothing renders
    // for it either, so silently doing nothing is correct, not a cop-out.
    return { action: 'none', provenance: null, reason: 'file-missing' };
  }

  if (!hasRecord) {
    // No prior hash on file: either this is the very first time this slot
    // has been seen, or slot-versions.json was lost. Either way we cannot
    // tell WHAT changed, only that the file predates our bookkeeping.
    if (openCount > 0 && staleOpenCount > 0) {
      // D3: at least one open annotation's own updatedAt predates the file's
      // mtime, so it was made against content that (per the file's own
      // metadata) is no longer on disk. Archive exactly those, honestly
      // labeled mtime-bootstrap since the true prior bytes were never seen.
      return { action: 'archive', provenance: 'mtime-bootstrap', reason: 'first-run-stale-annotations' };
    }
    // No annotations, or every open annotation is newer than the file's
    // mtime (so it was plausibly made against what's on disk right now).
    // Nothing to archive; just start recording from here.
    return { action: 'seed', provenance: null, reason: 'first-run-no-stale-annotations' };
  }

  if (priorHash === currentHash) {
    // Identical bytes rewrite (e.g. re-save with no content change, or a
    // tool that rewrites-but-doesn't-modify). D2: the version is unchanged,
    // so there is nothing to archive and nothing to reseed.
    return { action: 'none', provenance: null, reason: 'hash-unchanged' };
  }

  // Hashes differ: the content really changed since the last recorded
  // version. If we have byte snapshot of what it changed FROM, that is the
  // durable content-hash path and fires regardless of openCount (plan note:
  // a slot with zero open annotations still records a version — history
  // stays continuous and later annotations have something to be
  // attributable to — but syncSlot copies no HTML for it, since there is
  // nothing open to explain the bytes).
  if (hasSnapshot) {
    return { action: 'archive', provenance: 'content-hash', reason: 'hash-changed-with-snapshot' };
  }

  // Hashes differ but there is no byte snapshot to archive (e.g. the
  // snapshot file was deleted out from under us, or migrating from an older
  // install that only ever wrote the hash). Fall back to the same
  // per-annotation mtime comparison used on a true first run.
  if (openCount > 0 && staleOpenCount > 0) {
    return { action: 'archive', provenance: 'mtime-bootstrap', reason: 'hash-changed-no-snapshot-stale-annotations' };
  }
  return { action: 'seed', provenance: null, reason: 'hash-changed-no-snapshot-no-stale-annotations' };
}

// ---------------------------------------------------------------------------
// slot-versions.json — persists the hash across restarts so a change that
// happened while the server was down (D2) is still detected on next boot.
// ---------------------------------------------------------------------------
function versionsPath(ctrlDir) { return path.join(ctrlDir, 'slot-versions.json'); }

// The single-file writes in this module (slot-versions.json, the snapshot)
// go through here. Same-directory temp + rename is what makes a concurrent
// reader see either the old bytes or the new ones, never a half-written
// file. The unlink-on-throw is the half that is easy to forget and expensive
// to omit: the temp name is unique per attempt, so a repeatedly-failing write
// (a full disk, a read-only control dir) leaves one orphaned
// `.tmp-<pid>-<ts>` per failing tick in the directory the user is told to
// read. canvas-server's writeJSONAtomic keeps the same contract. The
// two-file archive commit (commitArchive) gets its atomicity a different
// way — see the comment there — by staging both files with bare
// fs.writeFileSync and renaming the whole staging directory into place.
function writeFileAtomic(p, data) {
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, p);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* never written, or already gone */ }
    throw err;
  }
}

export function readVersions(ctrlDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(versionsPath(ctrlDir), 'utf-8'));
    if (raw && typeof raw === 'object' && raw.slots && typeof raw.slots === 'object') {
      return { schema: VERSIONS_SCHEMA, slots: raw.slots };
    }
  } catch { /* missing or corrupt — start fresh, never throw */ }
  return { schema: VERSIONS_SCHEMA, slots: {} };
}

export function writeVersions(ctrlDir, obj) {
  fs.mkdirSync(ctrlDir, { recursive: true });
  writeFileAtomic(versionsPath(ctrlDir), JSON.stringify({ schema: VERSIONS_SCHEMA, slots: obj.slots || {} }));
}

// ---------------------------------------------------------------------------
// Snapshot store — .canvas/current/<slot> holds the bytes of the recorded
// version. D1: the mtime poller notices a change AFTER the file is already
// rewritten, so this snapshot — not the live file — IS the prior version at
// the moment we detect a change. It is read here, archived, then replaced
// with a fresh copy of the new bytes by the caller (syncSlot).
// ---------------------------------------------------------------------------
function currentSnapshotPath(ctrlDir, slot) { return path.join(ctrlDir, 'current', slot); }

function readSnapshot(ctrlDir, slot) {
  try { return fs.readFileSync(currentSnapshotPath(ctrlDir, slot)); } catch { return null; }
}

function writeSnapshot(ctrlDir, slot, buf) {
  const p = currentSnapshotPath(ctrlDir, slot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  writeFileAtomic(p, buf);
}

// ---------------------------------------------------------------------------
// Archive directory — content-addressed, crash-safe (D4/D5).
// ---------------------------------------------------------------------------
function archiveSlotDir(ctrlDir, slot) { return path.join(ctrlDir, 'archive', slot); }
function archiveVersionDir(ctrlDir, slot, version) { return path.join(archiveSlotDir(ctrlDir, slot), version); }

function readPayload(ctrlDir, slot, version) {
  try {
    return JSON.parse(fs.readFileSync(path.join(archiveVersionDir(ctrlDir, slot, version), 'annotations.json'), 'utf-8'));
  } catch { return null; }
}

// findVersionForHash: the version that ARCHIVED these exact bytes, or null.
// This is the whole idempotency mechanism (D5/V5) — if the version already
// exists we must NOT re-copy the HTML (which may no longer be recoverable)
// and must instead union the annotations into what is already there.
//
// The `-<hash8>` name suffix is a PREFILTER, never the answer. It carries 8
// hex of *a* hash, and on the mtime-bootstrap path that hash belongs to the
// SUPERSEDING content — nothing in that directory was ever hashed to it. Name
// matching alone therefore merges a genuine content-hash archive of H2 into
// the bootstrap dir that merely mentions H2: two versions' annotations in one
// record, the real H2 bytes never written, and every live `archivedFrom`
// pointing at the wrong version. The payload's own `hash` is the identity, and
// a bootstrap payload carries `hash: null`, so it can never be unioned into.
// Every name candidate is examined, not just the first: a slot can legitimately
// hold both a bootstrap dir and a real one ending in the same 8 hex.
export function findVersionForHash(ctrlDir, slot, hashHex) {
  const dir = archiveSlotDir(ctrlDir, slot);
  const hash8 = hashHex.slice(0, 8);
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return null; }
  // Staging dirs (.tmp-<pid>-<ts>) never match VERSION_RE, so a leftover one
  // from a crashed prior run is silently skipped here rather than mistaken
  // for a real version (covered by the "leftover .tmp-*" test).
  const candidates = entries.filter((name) => VERSION_RE.test(name) && name.endsWith(`-${hash8}`)).sort();
  for (const name of candidates) {
    const payload = readPayload(ctrlDir, slot, name);
    if (payload && payload.hash === hashHex) return name;
  }
  return null;
}

// Two archives of DIFFERENT content can want the same id within one UTC
// second — an mtime-bootstrap names itself after the superseding content (the
// only hash it has), so the content-hash archive of those same bytes moments
// later collides. The id is a NAME, not an identity: walk it forward a second
// rather than renaming onto an occupied directory, which throws and costs the
// user the archive entirely.
function nextFreeVersion(ctrlDir, slot, version) {
  let candidate = version;
  for (let guard = 0; guard < 60 && fs.existsSync(archiveVersionDir(ctrlDir, slot, candidate)); guard += 1) {
    const iso = `${candidate.slice(0, 4)}-${candidate.slice(4, 6)}-${candidate.slice(6, 8)}`
      + `T${candidate.slice(9, 11)}:${candidate.slice(11, 13)}:${candidate.slice(13, 15)}Z`;
    candidate = versionId(new Date(Date.parse(iso) + 1000).toISOString(), candidate.slice(17));
  }
  return candidate;
}

// Every version-naming field in the payload must name the version the data
// ACTUALLY landed in, which is commitArchive's decision to make (a re-commit
// lands in the dir that already exists, not in the caller's candidate name).
// Stamping anywhere else is how `archivedFrom` ends up pointing at a directory
// that was never created.
function stampVersion(payload, version) {
  const annotations = (payload.annotations || []).map((a) => (
    a && a.archivedFrom ? { ...a, archivedFrom: version } : a
  ));
  return { ...payload, version, annotations };
}

// commitArchive: stage into archive/<slot>/.tmp-<pid>-<ts>/, write whichever
// of the two files this archive has (annotations.json always; the HTML copy
// only when htmlBuf is non-null), then fs.renameSync the whole staging dir
// into place as one atomic step (D5). A crash before the rename leaves only
// an orphaned .tmp dir (harmless, never matched by findVersionForHash); a
// crash after leaves a complete, final version. What "complete" holds is not
// fixed — a version with an annotations.json and no HTML file is the normal
// steady state for an archive with nothing open to retire, not a half-write.
// The atomicity guarantee is narrower and still real: there is no crash
// window where a version dir holds a PARTIAL file, or the rename half-lands.
//
// Returns the version the data landed in, which is NOT always the requested
// one — the caller must stamp `archivedFrom` from what comes back here.
export function commitArchive({ ctrlDir, slot, version, htmlBuf, payload }) {
  if (!SLOT_RE.test(slot)) throw new Error(`commitArchive: invalid slot "${slot}"`);
  if (!VERSION_RE.test(version)) throw new Error(`commitArchive: invalid version "${version}"`);

  // Hash-identified, not name-identified — see findVersionForHash. A payload
  // with no hash (mtime-bootstrap: the prior bytes were never captured) has no
  // identity to match on and always gets a dir of its own.
  const payloadHash = (payload && payload.hash) || null;
  const existingVersion = payloadHash ? findVersionForHash(ctrlDir, slot, payloadHash) : null;
  const candidatePayload = existingVersion ? readPayload(ctrlDir, slot, existingVersion) : null;

  if (existingVersion) {
    // Crash-recovery union path (D5): a version for these exact bytes already
    // exists — union the annotations by id so a partially-completed prior
    // run's records are never dropped nor duplicated by this one.
    const dir = archiveVersionDir(ctrlDir, slot, existingVersion);
    const htmlPath = path.join(dir, slot);
    const stamped = stampVersion(payload, existingVersion);
    const existingAnnotations = Array.isArray(candidatePayload.annotations) ? candidatePayload.annotations : [];
    const byId = new Map(existingAnnotations.map((a) => [a.id, a]));
    for (const a of stamped.annotations) byId.set(a.id, a); // incoming wins on id collision (same annotation, re-archived)
    // Backfill the bytes when the version was recorded without them (an
    // annotation-free archive copies none — see syncSlot) and we now hold
    // bytes for it. They are the same content by construction: the payload
    // hash is what matched this dir in the first place.
    if (htmlBuf && !fs.existsSync(htmlPath)) writeFileAtomic(htmlPath, htmlBuf);
    const merged = {
      ...candidatePayload, ...stamped,
      // `html` states what is readable HERE. Never inherit the claim from
      // either side: a payload that names a file the dir does not hold turns
      // the client's "open the version this was written against" link into a
      // 404, which reads as data loss.
      html: fs.existsSync(htmlPath) ? slot : null,
      annotations: Array.from(byId.values()),
    };
    writeFileAtomic(path.join(dir, 'annotations.json'), JSON.stringify(merged));
    return { created: false, version: existingVersion };
  }

  const slotDir = archiveSlotDir(ctrlDir, slot);
  fs.mkdirSync(slotDir, { recursive: true });
  const target = nextFreeVersion(ctrlDir, slot, version);
  const staging = path.join(slotDir, `.tmp-${process.pid}-${Date.now()}`);
  fs.mkdirSync(staging, { recursive: true });
  try {
    if (htmlBuf) fs.writeFileSync(path.join(staging, slot), htmlBuf);
    fs.writeFileSync(path.join(staging, 'annotations.json'), JSON.stringify(stampVersion(payload, target)));
    fs.renameSync(staging, archiveVersionDir(ctrlDir, slot, target));
  } catch (err) {
    // Without this, a throw here (ENOSPC, EACCES, a non-empty final dir)
    // strands a whole DIRECTORY — and because the caller then never advances
    // slot-versions.json, the next mtime tick re-detects the same change and
    // strands another one. One orphan per failing tick, forever.
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* best effort */ }
    throw err;
  }
  return { created: true, version: target };
}

export function listArchive(ctrlDir, slot) {
  const dir = archiveSlotDir(ctrlDir, slot);
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return []; }
  const versions = entries.filter((name) => VERSION_RE.test(name)).sort(); // lexical sort == chronological, by construction of the id
  const out = [];
  for (const version of versions) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, version, 'annotations.json'), 'utf-8'));
      out.push({ ...raw, version });
    } catch { /* one corrupt/missing version must not take down the others */ }
  }
  return out;
}

export function readArchivedHtml(ctrlDir, slot, version) {
  if (!SLOT_RE.test(slot) || !VERSION_RE.test(version)) return null;
  try { return fs.readFileSync(path.join(archiveVersionDir(ctrlDir, slot, version), slot)); } catch { return null; }
}

// ---------------------------------------------------------------------------
// syncSlot — orchestrates one slot end to end: read the file, compute
// decide()'s inputs, and if it says archive/seed, do the I/O and mutate
// selections.annotations[slot] in place.
// ---------------------------------------------------------------------------
export function syncSlot({ galleryDir, ctrlDir, slot, selections, versions, nowIso }) {
  if (!SLOT_RE.test(slot)) throw new Error(`syncSlot: invalid slot "${slot}"`);

  const fullPath = path.join(galleryDir, slot);
  let stat;
  try { stat = fs.statSync(fullPath); } catch { stat = null; }
  const fileMissing = !stat || !stat.isFile();

  const record = versions.slots && versions.slots[slot];
  const hasRecord = !!(record && typeof record.hash === 'string');
  const priorHash = hasRecord ? record.hash : null;

  const currentBuf = fileMissing ? null : fs.readFileSync(fullPath);
  const currentHash = currentBuf ? sha256Hex(currentBuf) : null;
  // Ratings and winner picks describe the bytes the user reviewed, not the
  // filename forever. Only two known hashes can prove that those bytes changed;
  // an mtime bump or a first sight cannot. Keep notes and every append-only
  // feedback/archive record — they remain useful history — but clear the live
  // choice state before the caller persists the new version.
  const contentHashChanged = hasRecord && currentHash != null && priorHash !== currentHash;

  const snapshot = fileMissing ? null : readSnapshot(ctrlDir, slot);
  // A snapshot is only usable as "the bytes the recorded hash names", so it
  // has to hash to that. The two land in separate syscalls (versions first,
  // snapshot last — see the ordering note at the foot of this function), so a
  // crash between them leaves a snapshot one version behind its record. Using
  // it anyway would archive the WRONG bytes under a right-looking name;
  // rejecting it falls through to the honest mtime-bootstrap path, which says
  // `html: null` — the prior bytes were not captured — instead of lying.
  const snapshotHash = snapshot ? sha256Hex(snapshot) : null;
  const hasSnapshot = snapshot != null && (!hasRecord || snapshotHash === priorHash);

  const rawList = (selections.annotations && Array.isArray(selections.annotations[slot])) ? selections.annotations[slot] : [];
  const openRecords = rawList.filter((a) => a && a.status === 'open');
  const openCount = openRecords.length;
  const fileMtimeMs = fileMissing ? 0 : stat.mtimeMs;
  // D3: per-annotation, NOT per-slot newest-wins — see the plan's rejected
  // alternative for why a per-slot gate carries a false negative a
  // per-annotation rule does not.
  const staleRecords = openRecords.filter((a) => {
    const t = a && a.updatedAt ? Date.parse(a.updatedAt) : NaN;
    return Number.isFinite(t) && t < fileMtimeMs;
  });
  const staleOpenCount = staleRecords.length;

  const outcome = decide({ hasRecord, priorHash, currentHash, hasSnapshot, openCount, staleOpenCount, fileMissing });

  const result = {
    action: outcome.action, archivedIds: [], selectionsChanged: false,
    versionsChanged: false, commitSnapshot: null,
    resetRating: false, resetPicks: [], resetReviewArchive: false,
  };

  if (outcome.action === 'none') return result;

  if (contentHashChanged) {
    const ratings = selections.ratings && typeof selections.ratings === 'object'
      ? selections.ratings : null;
    if (ratings && Object.prototype.hasOwnProperty.call(ratings, slot)) {
      delete ratings[slot];
      result.resetRating = true;
      result.selectionsChanged = true;
    }
    const picks = selections.picks && typeof selections.picks === 'object'
      ? selections.picks : null;
    if (picks) {
      for (const [screenId, pickedSlot] of Object.entries(picks)) {
        if (pickedSlot !== slot) continue;
        delete picks[screenId];
        result.resetPicks.push(screenId);
        result.selectionsChanged = true;
      }
    }
    const reviewArchive = selections.reviewArchive && typeof selections.reviewArchive === 'object'
      ? selections.reviewArchive : null;
    if (reviewArchive && Object.prototype.hasOwnProperty.call(reviewArchive, slot)) {
      delete reviewArchive[slot];
      result.resetReviewArchive = true;
      result.selectionsChanged = true;
    }
    // Notes remain attached as historical review evidence across a rewrite.
    // Derived review completion therefore needs an explicit current-version
    // override, or the preserved note would hide the revised HTML immediately.
    const reviewReopen = selections.reviewReopen && typeof selections.reviewReopen === 'object'
      ? selections.reviewReopen : (selections.reviewReopen = {});
    const preservedNote = selections.notes && typeof selections.notes[slot] === 'string'
      ? selections.notes[slot].trim() : '';
    if (preservedNote) {
      reviewReopen[slot] = { reopenedAt: nowIso };
      result.reactivatedReview = true;
      result.selectionsChanged = true;
    } else if (Object.prototype.hasOwnProperty.call(reviewReopen, slot)) {
      delete reviewReopen[slot];
      result.resetReviewReopen = true;
      result.selectionsChanged = true;
    }
  }

  // ORDERING, and the reason this is a thunk instead of a write (D5, crash
  // safety): the durable snapshot must advance LAST, after the caller has
  // persisted selections and slot-versions.json. syncSlot cannot see whether
  // those writes succeeded, so it hands back the write instead of performing
  // it. Advancing the snapshot first is what leaves a crash with the OLD hash
  // recorded beside a snapshot of the NEW bytes — and the next start would
  // then archive those new bytes as the "prior" version the annotations were
  // supposedly written against.
  const commitSnapshot = currentBuf ? () => writeSnapshot(ctrlDir, slot, currentBuf) : null;

  if (outcome.action === 'seed') {
    // I1: a FIRST-SIGHT seed does not mutate selections. A seed can also be the
    // honest recovery path when two recorded hashes differ but the prior byte
    // snapshot is unavailable. In that case the proven hash change above may
    // clear stale live rating/pick state even though there is no HTML to archive.
    // test_gallery_archive.mjs V9 still guards the first-sight invariant.
    if (!versions.slots) versions.slots = {};
    versions.slots[slot] = { hash: currentHash, seenAt: nowIso };
    result.versionsChanged = true;
    result.commitSnapshot = commitSnapshot;
    return result;
  }

  // action === 'archive'
  const toArchive = outcome.provenance === 'mtime-bootstrap' ? staleRecords : openRecords;
  const archivedIds = toArchive.map((a) => a.id);
  const archivedHash = outcome.provenance === 'content-hash' ? snapshotHash : null;
  // The version RECORD is written either way — the hash chain is the history,
  // and a later annotation has to be attributable to a version that exists.
  // The full HTML COPY is not: with nothing archived against it there is no
  // critique for those bytes to explain, and the copy is permanent disk cost
  // on a directory nothing ever prunes (an autosaving editor plus the 400ms
  // poller can produce one per distinct-hash save). The pleasing consequence:
  // archiving DRAINS a slot's open annotations, so the save after an archive
  // has none and copies nothing — repeated saves cost the version record only.
  const priorHtmlBuf = (outcome.provenance === 'content-hash' && toArchive.length > 0) ? snapshot : null;
  const version = versionId(nowIso, archivedHash || currentHash);

  const payload = {
    schema: ARCHIVE_SCHEMA,
    slot,
    version,
    archivedAt: nowIso,
    provenance: outcome.provenance,
    hash: archivedHash,
    html: priorHtmlBuf ? slot : null,
    supersededByHash: currentHash,
    annotations: toArchive.map((a) => ({ ...a, status: 'archived', archivedAt: nowIso, archivedFrom: version })),
  };

  // The version the data actually landed in, which is the requested one only
  // when a fresh dir was created. Stamping selections from the candidate name
  // instead would leave every live record pointing at a directory that does
  // not exist.
  const committed = commitArchive({ ctrlDir, slot, version, htmlBuf: priorHtmlBuf, payload });

  // Rewrite the archived records in place, preserving every other field
  // byte-for-byte (comment, bounds, target, viewport, document, x, y,
  // marker, createdAt, updatedAt, id). Nothing is deleted, ever — resolved
  // and already-archived records in the same slot are left untouched.
  const archivedIdSet = new Set(archivedIds);
  selections.annotations[slot] = rawList.map((a) => (
    a && archivedIdSet.has(a.id)
      ? { ...a, status: 'archived', archivedAt: nowIso, archivedFrom: committed.version }
      : a
  ));

  if (!versions.slots) versions.slots = {};
  versions.slots[slot] = { hash: currentHash, seenAt: nowIso };

  result.version = committed.version;
  result.archivedIds = archivedIds;
  result.selectionsChanged = result.selectionsChanged || archivedIds.length > 0;
  result.versionsChanged = true;
  result.commitSnapshot = commitSnapshot;
  return result;
}

// syncAllSlots — sweeps every slot, each in its own try/catch so one
// unreadable slot (e.g. a permissions error, a symlink loop) cannot abort
// the sweep for the others.
export function syncAllSlots({ galleryDir, ctrlDir, slots, selections, versions, nowIso }) {
  let selectionsChanged = false;
  let versionsChanged = false;
  const events = [];
  const pending = [];
  for (const slot of slots) {
    try {
      const r = syncSlot({ galleryDir, ctrlDir, slot, selections, versions, nowIso });
      if (r.selectionsChanged) selectionsChanged = true;
      if (r.versionsChanged) versionsChanged = true;
      if (r.commitSnapshot) pending.push([slot, r.commitSnapshot]);
      if (r.action === 'archive') events.push({ slot, version: r.version, count: r.archivedIds.length });
    } catch (err) {
      console.error(`gallery-archive: sync failed for slot "${slot}": ${err && err.message}`);
    }
  }
  // One thunk for the whole sweep, so the caller keeps the same "snapshot
  // last" ordering it uses for a single slot. Per-slot try/catch here too, for
  // the same reason it wraps syncSlot: one unwritable snapshot must not cost
  // the other slots theirs.
  const commitSnapshots = () => {
    for (const [slot, commit] of pending) {
      try { commit(); } catch (err) {
        console.error(`gallery-archive: snapshot write failed for slot "${slot}": ${err && err.message}`);
      }
    }
  };
  return { selectionsChanged, versionsChanged, events, commitSnapshots };
}
