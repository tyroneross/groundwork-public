// test_gallery_archive_unit.mjs — unit coverage for the archive engine
// (designer/canvas/gallery-archive.mjs). No server boot, no browser: decide()
// is pure and every effectful function here operates on real temp
// directories under os.tmpdir(), which is the entire point of splitting the
// engine out of canvas-server.mjs (plan D9) — the falsifying mutations in the
// verification table are exercised directly, without HTTP or CDP overhead.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ARCHIVE_SCHEMA, VERSIONS_SCHEMA, SLOT_RE, VERSION_RE,
  sha256Hex, versionId, decide,
  readVersions, writeVersions, findVersionForHash, commitArchive,
  listArchive, readArchivedHtml, syncSlot, syncAllSlots,
} from '../canvas/gallery-archive.mjs';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gw-archive-'));
}

function makeAnnotation(overrides) {
  return {
    id: 'ann-1', marker: 'dot', x: 0.1, y: 0.1,
    bounds: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
    target: { selector: '.foo', component: '', tag: 'div', role: '', label: '', text: 'hi' },
    viewport: { width: 1280, height: 800 },
    document: { width: 1280, height: 2000 },
    comment: 'fix this', status: 'open',
    createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  };
}

function defaultSelections() {
  return {
    schema: 'groundwork.gallery-selections/v2',
    ratings: {}, picks: {}, notes: {}, annotations: {}, reviewArchive: {}, reviewReopen: {},
  };
}

// ---------------------------------------------------------------------------
// decide() — every row of the plan's B1 truth table.
// ---------------------------------------------------------------------------

test('decide: fileMissing always yields none regardless of other inputs', () => {
  const r = decide({ hasRecord: true, priorHash: 'a', currentHash: 'b', hasSnapshot: true, openCount: 5, staleOpenCount: 5, fileMissing: true });
  assert.equal(r.action, 'none');
  assert.equal(r.provenance, null);
});

test('decide: no record, no open annotations -> seed', () => {
  const r = decide({ hasRecord: false, priorHash: null, currentHash: 'x', hasSnapshot: false, openCount: 0, staleOpenCount: 0, fileMissing: false });
  assert.equal(r.action, 'seed');
  assert.equal(r.provenance, null);
});

test('decide: no record, open annotations but none stale -> seed', () => {
  const r = decide({ hasRecord: false, priorHash: null, currentHash: 'x', hasSnapshot: false, openCount: 3, staleOpenCount: 0, fileMissing: false });
  assert.equal(r.action, 'seed');
});

test('decide: no record, open annotations with stale ones -> archive/mtime-bootstrap', () => {
  const r = decide({ hasRecord: false, priorHash: null, currentHash: 'x', hasSnapshot: false, openCount: 3, staleOpenCount: 2, fileMissing: false });
  assert.equal(r.action, 'archive');
  assert.equal(r.provenance, 'mtime-bootstrap');
});

test('decide: record present, hash matches -> none', () => {
  const r = decide({ hasRecord: true, priorHash: 'same', currentHash: 'same', hasSnapshot: true, openCount: 3, staleOpenCount: 0, fileMissing: false });
  assert.equal(r.action, 'none');
});

test('decide: record present, hash differs, snapshot present -> archive/content-hash (ignores openCount)', () => {
  const r0 = decide({ hasRecord: true, priorHash: 'old', currentHash: 'new', hasSnapshot: true, openCount: 0, staleOpenCount: 0, fileMissing: false });
  assert.equal(r0.action, 'archive');
  assert.equal(r0.provenance, 'content-hash');
  const r1 = decide({ hasRecord: true, priorHash: 'old', currentHash: 'new', hasSnapshot: true, openCount: 4, staleOpenCount: 0, fileMissing: false });
  assert.equal(r1.action, 'archive');
  assert.equal(r1.provenance, 'content-hash');
});

test('decide: record present, hash differs, no snapshot, stale open annotations -> archive/mtime-bootstrap', () => {
  const r = decide({ hasRecord: true, priorHash: 'old', currentHash: 'new', hasSnapshot: false, openCount: 2, staleOpenCount: 1, fileMissing: false });
  assert.equal(r.action, 'archive');
  assert.equal(r.provenance, 'mtime-bootstrap');
});

test('decide: record present, hash differs, no snapshot, open but none stale -> seed', () => {
  const r = decide({ hasRecord: true, priorHash: 'old', currentHash: 'new', hasSnapshot: false, openCount: 2, staleOpenCount: 0, fileMissing: false });
  assert.equal(r.action, 'seed');
});

test('decide: record present, hash differs, no snapshot, zero open annotations -> seed', () => {
  const r = decide({ hasRecord: true, priorHash: 'old', currentHash: 'new', hasSnapshot: false, openCount: 0, staleOpenCount: 0, fileMissing: false });
  assert.equal(r.action, 'seed');
});

// ---------------------------------------------------------------------------
// versionId — lexical sort order, including across a UTC second boundary.
// ---------------------------------------------------------------------------

test('versionId: sorts lexically in chronological order across a second boundary', () => {
  const a = versionId('2026-07-22T05:10:56.000Z', 'aaaaaaaa11111111');
  const b = versionId('2026-07-22T05:10:57.000Z', 'bbbbbbbb22222222');
  assert.equal(a, '20260722T051056Z-aaaaaaaa');
  assert.equal(b, '20260722T051057Z-bbbbbbbb');
  assert.ok(a < b, `expected "${a}" < "${b}" lexically`);
  assert.match(a, VERSION_RE);
  assert.match(b, VERSION_RE);
});

test('sha256Hex: produces 64 lowercase hex chars, stable for identical bytes', () => {
  const h = sha256Hex(Buffer.from('hello world'));
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, sha256Hex(Buffer.from('hello world')));
  assert.notEqual(h, sha256Hex(Buffer.from('hello worlds')));
});

// ---------------------------------------------------------------------------
// SLOT_RE / VERSION_RE — traversal rejection (V8's unit-level guard).
// ---------------------------------------------------------------------------

test('SLOT_RE rejects traversal, absolute-ish, and leading-dot slot names', () => {
  assert.equal(SLOT_RE.test('daily-digest-warm-craft.html'), true);
  assert.equal(SLOT_RE.test('..'), false);
  assert.equal(SLOT_RE.test('../etc/passwd'), false);
  assert.equal(SLOT_RE.test('a/b.html'), false);
  assert.equal(SLOT_RE.test('.hidden.html'), false);
});

test('VERSION_RE rejects traversal and malformed ids', () => {
  assert.equal(VERSION_RE.test('20260722T051056Z-3f9a1c2b'), true);
  assert.equal(VERSION_RE.test('..'), false);
  assert.equal(VERSION_RE.test('../x'), false);
  assert.equal(VERSION_RE.test('.20260722T051056Z-3f9a1c2b'), false);
  assert.equal(VERSION_RE.test('20260722T051056Z-3F9A1C2B'), false); // uppercase hex rejected
});

// ---------------------------------------------------------------------------
// readVersions / writeVersions — atomic, tolerant of missing/corrupt file.
// ---------------------------------------------------------------------------

test('readVersions returns empty shape when the file is missing; writeVersions round-trips atomically', (t) => {
  const ctrlDir = tmpDir();
  t.after(() => fs.rmSync(ctrlDir, { recursive: true, force: true }));

  const empty = readVersions(ctrlDir);
  assert.equal(empty.schema, VERSIONS_SCHEMA);
  assert.deepEqual(empty.slots, {});

  writeVersions(ctrlDir, { slots: { 'a.html': { hash: 'abc', seenAt: '2026-07-22T00:00:00.000Z' } } });
  const read = readVersions(ctrlDir);
  assert.equal(read.slots['a.html'].hash, 'abc');

  // No .tmp-* leftover after a normal write.
  const leftovers = fs.readdirSync(ctrlDir).filter((n) => n.includes('.tmp-'));
  assert.deepEqual(leftovers, []);
});

test('readVersions tolerates a corrupt file without throwing', (t) => {
  const ctrlDir = tmpDir();
  t.after(() => fs.rmSync(ctrlDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(ctrlDir, 'slot-versions.json'), '{not json');
  const r = readVersions(ctrlDir);
  assert.deepEqual(r.slots, {});
});

// ---------------------------------------------------------------------------
// commitArchive — idempotency (findVersionForHash), union-by-id, atomic
// staging, and tolerance of a leftover crashed staging dir.
// ---------------------------------------------------------------------------

test('commitArchive: first commit creates the version dir with both files', (t) => {
  const ctrlDir = tmpDir();
  t.after(() => fs.rmSync(ctrlDir, { recursive: true, force: true }));
  const slot = 'a.html';
  const version = versionId('2026-07-22T05:10:56.000Z', sha256Hex(Buffer.from('body-A')));
  const payload = { schema: ARCHIVE_SCHEMA, slot, version, hash: sha256Hex(Buffer.from('body-A')), html: slot, annotations: [makeAnnotation()] };

  const r = commitArchive({ ctrlDir, slot, version, htmlBuf: Buffer.from('body-A'), payload });
  assert.equal(r.created, true);
  assert.equal(r.version, version, 'commitArchive must report the version the data landed in');

  const dir = path.join(ctrlDir, 'archive', slot, version);
  assert.equal(fs.readFileSync(path.join(dir, slot), 'utf-8'), 'body-A');
  const written = JSON.parse(fs.readFileSync(path.join(dir, 'annotations.json'), 'utf-8'));
  assert.equal(written.annotations.length, 1);
});

test('commitArchive: re-commit of the same hash unions by id instead of duplicating (crash-recovery path, V5)', (t) => {
  const ctrlDir = tmpDir();
  t.after(() => fs.rmSync(ctrlDir, { recursive: true, force: true }));
  const slot = 'a.html';
  const hash = sha256Hex(Buffer.from('body-A'));
  const version = versionId('2026-07-22T05:10:56.000Z', hash);

  const first = commitArchive({
    ctrlDir, slot, version, htmlBuf: Buffer.from('body-A'),
    payload: { schema: ARCHIVE_SCHEMA, slot, version, hash, html: slot, annotations: [makeAnnotation({ id: 'ann-1' })] },
  });
  assert.equal(first.created, true);

  // Second call for the SAME hash, with a partially overlapping and a
  // genuinely new annotation id — simulates a crash after commitArchive but
  // before slot-versions.json was updated, so the next run re-detects the
  // same change and re-archives.
  const second = commitArchive({
    ctrlDir, slot, version, htmlBuf: Buffer.from('body-A'),
    payload: { schema: ARCHIVE_SCHEMA, slot, version, hash, html: slot, annotations: [makeAnnotation({ id: 'ann-1', comment: 'updated' }), makeAnnotation({ id: 'ann-2' })] },
  });
  assert.equal(second.created, false);
  assert.equal(second.version, version, 'a union re-commit must report the version it merged into');

  const list = listArchive(ctrlDir, slot);
  assert.equal(list.length, 1); // still exactly one version dir, not two
  const ids = list[0].annotations.map((a) => a.id).sort();
  assert.deepEqual(ids, ['ann-1', 'ann-2']); // no id dropped, none duplicated
  const ann1 = list[0].annotations.find((a) => a.id === 'ann-1');
  assert.equal(ann1.comment, 'updated'); // incoming wins on collision

  // Exactly one version directory on disk — no duplicate archive created.
  const onDisk = fs.readdirSync(path.join(ctrlDir, 'archive', slot)).filter((n) => VERSION_RE.test(n));
  assert.equal(onDisk.length, 1);
});

test('commitArchive: a leftover .tmp-* staging dir from a crashed prior run does not corrupt or block a new commit', (t) => {
  const ctrlDir = tmpDir();
  t.after(() => fs.rmSync(ctrlDir, { recursive: true, force: true }));
  const slot = 'a.html';
  const slotDir = path.join(ctrlDir, 'archive', slot);
  fs.mkdirSync(slotDir, { recursive: true });
  // Simulate a crash mid-stage from an unrelated (or the same) prior attempt.
  const stale = path.join(slotDir, '.tmp-99999-1234567890');
  fs.mkdirSync(stale, { recursive: true });
  fs.writeFileSync(path.join(stale, slot), 'orphaned-partial-bytes');

  const hash = sha256Hex(Buffer.from('body-fresh'));
  const version = versionId('2026-07-22T05:10:56.000Z', hash);
  const r = commitArchive({
    ctrlDir, slot, version, htmlBuf: Buffer.from('body-fresh'),
    payload: { schema: ARCHIVE_SCHEMA, slot, version, hash, html: slot, annotations: [] },
  });
  assert.equal(r.created, true);

  // The stale staging dir is untouched (findVersionForHash never matches it
  // because it fails VERSION_RE) and the new version committed cleanly.
  assert.ok(fs.existsSync(stale));
  const list = listArchive(ctrlDir, slot);
  assert.equal(list.length, 1);
  assert.equal(fs.readFileSync(path.join(ctrlDir, 'archive', slot, version, slot), 'utf-8'), 'body-fresh');
});

test('findVersionForHash returns null when no version matches the hash', (t) => {
  const ctrlDir = tmpDir();
  t.after(() => fs.rmSync(ctrlDir, { recursive: true, force: true }));
  assert.equal(findVersionForHash(ctrlDir, 'a.html', 'deadbeef'.repeat(8)), null);
});

// A version dir's NAME ends in 8 hex of a hash, but an mtime-bootstrap names
// itself after the SUPERSEDING content — the only hash it has. Matching on the
// name alone therefore hands a real content-hash archive of H2 to the bootstrap
// dir that merely mentions H2. The payload hash is the identity.
test('findVersionForHash ignores a name match whose payload archived different content', (t) => {
  const ctrlDir = tmpDir();
  t.after(() => fs.rmSync(ctrlDir, { recursive: true, force: true }));
  const slot = 'a.html';
  const hashH2 = sha256Hex(Buffer.from('body-H2'));
  const bootstrap = versionId('2026-07-22T05:00:00.000Z', hashH2);   // named for the content it did NOT archive
  fs.mkdirSync(path.join(ctrlDir, 'archive', slot, bootstrap), { recursive: true });
  fs.writeFileSync(path.join(ctrlDir, 'archive', slot, bootstrap, 'annotations.json'), JSON.stringify({
    schema: ARCHIVE_SCHEMA, slot, version: bootstrap, provenance: 'mtime-bootstrap',
    hash: null, html: null, supersededByHash: hashH2, annotations: [makeAnnotation({ id: 'ann-stale' })],
  }));

  assert.equal(findVersionForHash(ctrlDir, slot, hashH2), null,
    'a bootstrap dir (hash:null) was mistaken for the archive of the content it names');

  // A real archive of H2, committed later, must get a directory of its own —
  // and once it exists, THAT is what the same hash resolves to.
  const real = versionId('2026-07-22T05:30:00.000Z', hashH2);
  const committed = commitArchive({
    ctrlDir, slot, version: real, htmlBuf: Buffer.from('body-H2'),
    payload: {
      schema: ARCHIVE_SCHEMA, slot, version: real, provenance: 'content-hash',
      hash: hashH2, html: slot, annotations: [makeAnnotation({ id: 'ann-h2', archivedFrom: real })],
    },
  });
  assert.equal(committed.created, true, 'the content-hash archive was merged into the bootstrap dir');
  assert.notEqual(committed.version, bootstrap);
  assert.equal(findVersionForHash(ctrlDir, slot, hashH2), committed.version);

  // Disjoint: the bootstrap record keeps exactly its own annotation.
  const list = listArchive(ctrlDir, slot);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((v) => v.annotations.map((a) => a.id)), [['ann-stale'], ['ann-h2']]);
  assert.equal(fs.readFileSync(path.join(ctrlDir, 'archive', slot, committed.version, slot), 'utf-8'), 'body-H2');
});

// The id is a name, not an identity: a bootstrap and a real archive of the same
// bytes in the same UTC second want the same name, and renaming onto an
// occupied directory would throw away the archive entirely.
test('commitArchive walks the id forward rather than colliding with an occupied version dir', (t) => {
  const ctrlDir = tmpDir();
  t.after(() => fs.rmSync(ctrlDir, { recursive: true, force: true }));
  const slot = 'a.html';
  const hash = sha256Hex(Buffer.from('body-X'));
  const taken = versionId('2026-07-22T05:00:00.000Z', hash);
  fs.mkdirSync(path.join(ctrlDir, 'archive', slot, taken), { recursive: true });
  fs.writeFileSync(path.join(ctrlDir, 'archive', slot, taken, 'annotations.json'), JSON.stringify({
    schema: ARCHIVE_SCHEMA, slot, version: taken, hash: null, html: null, annotations: [],
  }));

  const r = commitArchive({
    ctrlDir, slot, version: taken, htmlBuf: Buffer.from('body-X'),
    payload: { schema: ARCHIVE_SCHEMA, slot, version: taken, hash, html: slot, annotations: [] },
  });
  assert.equal(r.created, true);
  assert.equal(r.version, versionId('2026-07-22T05:00:01.000Z', hash), 'the id did not walk forward one second');
  assert.match(r.version, VERSION_RE);
  assert.deepEqual(fs.readdirSync(path.join(ctrlDir, 'archive', slot)).sort(), [taken, r.version].sort());
});

// Every archived record's archivedFrom must name the dir the data landed in.
test('commitArchive stamps the payload and archivedFrom with the version actually used', (t) => {
  const ctrlDir = tmpDir();
  t.after(() => fs.rmSync(ctrlDir, { recursive: true, force: true }));
  const slot = 'a.html';
  const hash = sha256Hex(Buffer.from('body-A'));
  const version = versionId('2026-07-22T05:10:56.000Z', hash);
  commitArchive({
    ctrlDir, slot, version, htmlBuf: Buffer.from('body-A'),
    payload: { schema: ARCHIVE_SCHEMA, slot, version, hash, html: slot, annotations: [makeAnnotation({ id: 'ann-1', status: 'archived', archivedFrom: version })] },
  });

  // A second commit of the same bytes under a DIFFERENT candidate name unions
  // into the existing dir, so both the payload and the record must be restamped.
  const later = versionId('2026-07-22T06:00:00.000Z', hash);
  const second = commitArchive({
    ctrlDir, slot, version: later, htmlBuf: Buffer.from('body-A'),
    payload: { schema: ARCHIVE_SCHEMA, slot, version: later, hash, html: slot, annotations: [makeAnnotation({ id: 'ann-2', status: 'archived', archivedFrom: later })] },
  });
  assert.equal(second.version, version);

  const stored = listArchive(ctrlDir, slot)[0];
  assert.equal(stored.version, version);
  for (const a of stored.annotations) {
    assert.equal(a.archivedFrom, version, 'an archived record points at a version directory that does not exist');
  }
});

// FIX 2's companion: an annotation-free archive stores no HTML, so a later
// union onto that same version must backfill the bytes rather than leave the
// recovered critique pointing at a version whose HTML link 404s.
test('commitArchive backfills missing HTML on the union path and never claims a file it lacks', (t) => {
  const ctrlDir = tmpDir();
  t.after(() => fs.rmSync(ctrlDir, { recursive: true, force: true }));
  const slot = 'a.html';
  const hash = sha256Hex(Buffer.from('body-A'));
  const version = versionId('2026-07-22T05:10:56.000Z', hash);

  commitArchive({
    ctrlDir, slot, version, htmlBuf: null,
    payload: { schema: ARCHIVE_SCHEMA, slot, version, hash, html: null, annotations: [] },
  });
  assert.equal(listArchive(ctrlDir, slot)[0].html, null);
  assert.equal(readArchivedHtml(ctrlDir, slot, version), null);

  commitArchive({
    ctrlDir, slot, version, htmlBuf: Buffer.from('body-A'),
    payload: { schema: ARCHIVE_SCHEMA, slot, version, hash, html: slot, annotations: [makeAnnotation({ id: 'ann-late' })] },
  });
  assert.equal(listArchive(ctrlDir, slot)[0].html, slot);
  assert.equal(readArchivedHtml(ctrlDir, slot, version).toString(), 'body-A');
});

// FIX 3: the temp name is unique per attempt, so a write that throws without
// unlinking litters one orphan per failing tick in the dir the user reads.
test('a failing write leaves no .tmp-* orphan behind (writeVersions, snapshot, staging)', (t) => {
  const galleryDir = tmpDir();
  const ctrlDir = path.join(galleryDir, '.canvas');
  t.after(() => fs.rmSync(galleryDir, { recursive: true, force: true }));

  // slot-versions.json as a DIRECTORY: writeFileSync succeeds, renameSync throws.
  fs.mkdirSync(path.join(ctrlDir, 'slot-versions.json', 'occupied'), { recursive: true });
  assert.throws(() => writeVersions(ctrlDir, { slots: { 'a.html': { hash: 'x', seenAt: 'now' } } }));
  assert.deepEqual(fs.readdirSync(ctrlDir).filter((n) => n.includes('.tmp-')), [],
    'a failed writeVersions stranded a temp file');

  // Same shape for the snapshot, reached through syncSlot's commitSnapshot.
  const slot = 'a.html';
  writeSlotFile(galleryDir, slot, 'body-A');
  fs.mkdirSync(path.join(ctrlDir, 'current', slot, 'occupied'), { recursive: true });
  const r = syncSlot({ galleryDir, ctrlDir, slot, selections: defaultSelections(), versions: { slots: {} }, nowIso: '2026-07-22T05:00:00.000Z' });
  assert.throws(() => r.commitSnapshot());
  assert.deepEqual(fs.readdirSync(path.join(ctrlDir, 'current')).filter((n) => n.includes('.tmp-')), [],
    'a failed snapshot write stranded a temp file');

  // And the staging DIRECTORY, which is the expensive one: an orphan here is a
  // whole directory, and because the caller never advances slot-versions.json
  // after a failure, the next mtime tick strands another. The unserializable
  // payload stands in for the real causes (ENOSPC, EACCES) because it throws at
  // the same point — after the HTML is already staged.
  const hash = sha256Hex(Buffer.from('body-A'));
  const version = versionId('2026-07-22T05:10:56.000Z', hash);
  const circular = { schema: ARCHIVE_SCHEMA, slot, version, hash, html: slot, annotations: [] };
  circular.self = circular;
  assert.throws(() => commitArchive({ ctrlDir, slot, version, htmlBuf: Buffer.from('body-A'), payload: circular }));
  assert.deepEqual(fs.readdirSync(path.join(ctrlDir, 'archive', slot)), [],
    'a failed commitArchive stranded a whole staging directory');
});

test('listArchive tolerates a corrupt annotations.json in one version without losing the others', (t) => {
  const ctrlDir = tmpDir();
  t.after(() => fs.rmSync(ctrlDir, { recursive: true, force: true }));
  const slot = 'a.html';
  const v1 = '20260722T050000Z-11111111';
  const v2 = '20260722T060000Z-22222222';
  fs.mkdirSync(path.join(ctrlDir, 'archive', slot, v1), { recursive: true });
  fs.mkdirSync(path.join(ctrlDir, 'archive', slot, v2), { recursive: true });
  fs.writeFileSync(path.join(ctrlDir, 'archive', slot, v1, 'annotations.json'), 'not-json{{');
  fs.writeFileSync(path.join(ctrlDir, 'archive', slot, v2, 'annotations.json'), JSON.stringify({ schema: ARCHIVE_SCHEMA, slot, version: v2, annotations: [] }));

  const list = listArchive(ctrlDir, slot);
  assert.equal(list.length, 1);
  assert.equal(list[0].version, v2);
});

test('listArchive sorts by version ascending', (t) => {
  const ctrlDir = tmpDir();
  t.after(() => fs.rmSync(ctrlDir, { recursive: true, force: true }));
  const slot = 'a.html';
  const versions = ['20260722T060000Z-22222222', '20260722T050000Z-11111111', '20260722T070000Z-33333333'];
  for (const v of versions) {
    fs.mkdirSync(path.join(ctrlDir, 'archive', slot, v), { recursive: true });
    fs.writeFileSync(path.join(ctrlDir, 'archive', slot, v, 'annotations.json'), JSON.stringify({ schema: ARCHIVE_SCHEMA, slot, version: v, annotations: [] }));
  }
  const list = listArchive(ctrlDir, slot);
  assert.deepEqual(list.map((x) => x.version), [
    '20260722T050000Z-11111111', '20260722T060000Z-22222222', '20260722T070000Z-33333333',
  ]);
});

// ---------------------------------------------------------------------------
// syncSlot / syncAllSlots — end-to-end orchestration on real temp dirs.
// ---------------------------------------------------------------------------

function writeSlotFile(galleryDir, slot, body) {
  fs.writeFileSync(path.join(galleryDir, slot), body);
}

test('syncSlot: seed on first sight leaves selectionsChanged false (invariant I1) and writes no annotations', (t) => {
  const galleryDir = tmpDir();
  const ctrlDir = path.join(galleryDir, '.canvas');
  t.after(() => fs.rmSync(galleryDir, { recursive: true, force: true }));
  const slot = 'a.html';
  writeSlotFile(galleryDir, slot, 'body-A');

  const selections = defaultSelections();
  const versions = readVersions(ctrlDir);
  const r = syncSlot({ galleryDir, ctrlDir, slot, selections, versions, nowIso: '2026-07-22T05:10:56.000Z' });

  assert.equal(r.action, 'seed');
  assert.equal(r.selectionsChanged, false);
  assert.equal(r.versionsChanged, true);
  assert.deepEqual(selections.annotations, {}); // untouched
  // The snapshot is the CALLER's last write (see the FIX 4 ordering test), so
  // syncSlot hands it back rather than performing it.
  assert.equal(fs.existsSync(path.join(ctrlDir, 'current', slot)), false);
  r.commitSnapshot();
  assert.equal(fs.readFileSync(path.join(ctrlDir, 'current', slot), 'utf-8'), 'body-A');
});

// FIX 4 (crash safety, criterion 6). syncSlot must leave the durable snapshot
// alone until the caller has persisted selections AND slot-versions.json. A
// crash with the snapshot already advanced but the version record still old
// makes the next start read the OLD hash beside the NEW bytes — and archive
// those new bytes as the "prior" version the annotations were written against.
test('syncSlot: the durable snapshot still holds the OLD bytes until the caller commits it', (t) => {
  const galleryDir = tmpDir();
  const ctrlDir = path.join(galleryDir, '.canvas');
  t.after(() => fs.rmSync(galleryDir, { recursive: true, force: true }));
  const slot = 'a.html';
  writeSlotFile(galleryDir, slot, 'body-A');

  const selections = defaultSelections();
  let versions = readVersions(ctrlDir);
  syncSlot({ galleryDir, ctrlDir, slot, selections, versions, nowIso: '2026-07-22T05:00:00.000Z' }).commitSnapshot();
  writeVersions(ctrlDir, versions);
  const snapshotPath = path.join(ctrlDir, 'current', slot);

  selections.annotations[slot] = [makeAnnotation({ id: 'ann-1' })];
  writeSlotFile(galleryDir, slot, 'body-B');
  versions = readVersions(ctrlDir);
  const r = syncSlot({ galleryDir, ctrlDir, slot, selections, versions, nowIso: '2026-07-22T05:30:00.000Z' });

  assert.equal(r.action, 'archive');
  assert.equal(fs.readFileSync(snapshotPath, 'utf-8'), 'body-A',
    'the snapshot advanced before the caller persisted the version record');
  assert.equal(readVersions(ctrlDir).slots[slot].hash, sha256Hex(Buffer.from('body-A')),
    'the durable record must still name the old bytes at this point');

  // The caller's order: selections, then versions, then the snapshot.
  writeVersions(ctrlDir, versions);
  assert.equal(fs.readFileSync(snapshotPath, 'utf-8'), 'body-A');
  r.commitSnapshot();
  assert.equal(fs.readFileSync(snapshotPath, 'utf-8'), 'body-B');
  assert.equal(readVersions(ctrlDir).slots[slot].hash, sha256Hex(Buffer.from('body-B')));
});

// The other half of that ordering: a crash between the versions write and the
// snapshot write leaves a snapshot one version behind its record. Those bytes
// are NOT what the recorded hash names, so archiving them would attribute the
// wrong HTML. syncSlot must reject the snapshot and fall back to the honest
// mtime-bootstrap payload (html:null) instead.
test('syncSlot: a snapshot that does not hash to the recorded version is not archived as prior bytes', (t) => {
  const galleryDir = tmpDir();
  const ctrlDir = path.join(galleryDir, '.canvas');
  t.after(() => fs.rmSync(galleryDir, { recursive: true, force: true }));
  const slot = 'a.html';
  writeSlotFile(galleryDir, slot, 'body-A');

  const selections = defaultSelections();
  let versions = readVersions(ctrlDir);
  syncSlot({ galleryDir, ctrlDir, slot, selections, versions, nowIso: '2026-07-22T05:00:00.000Z' }).commitSnapshot();
  writeVersions(ctrlDir, versions);

  // The crash window: slot-versions.json says body-B, the snapshot still holds
  // body-A. (Reached here by advancing the record without its snapshot.)
  writeSlotFile(galleryDir, slot, 'body-B');
  versions = readVersions(ctrlDir);
  versions.slots[slot] = { hash: sha256Hex(Buffer.from('body-B')), seenAt: '2026-07-22T05:10:00.000Z' };
  writeVersions(ctrlDir, versions);

  selections.annotations[slot] = [makeAnnotation({ id: 'ann-1' })];
  writeSlotFile(galleryDir, slot, 'body-C');
  versions = readVersions(ctrlDir);
  const r = syncSlot({ galleryDir, ctrlDir, slot, selections, versions, nowIso: '2026-07-22T05:30:00.000Z' });

  assert.equal(r.action, 'archive');
  const payload = listArchive(ctrlDir, slot).find((v) => v.version === r.version);
  assert.equal(payload.provenance, 'mtime-bootstrap',
    'a stale snapshot was archived as though it were the recorded prior version');
  assert.equal(payload.html, null);
  assert.equal(payload.hash, null);
  assert.equal(readArchivedHtml(ctrlDir, slot, r.version), null);
  assert.equal(fs.existsSync(path.join(ctrlDir, 'archive', slot, r.version, slot)), false,
    'the archive holds body-A under a version that never was');
});

test('syncSlot: missing slot file yields action:none and does not throw', (t) => {
  const galleryDir = tmpDir();
  const ctrlDir = path.join(galleryDir, '.canvas');
  t.after(() => fs.rmSync(galleryDir, { recursive: true, force: true }));
  const selections = defaultSelections();
  const versions = readVersions(ctrlDir);
  const r = syncSlot({ galleryDir, ctrlDir, slot: 'gone.html', selections, versions, nowIso: '2026-07-22T05:10:56.000Z' });
  assert.equal(r.action, 'none');
  assert.equal(r.selectionsChanged, false);
});

test('syncSlot: identical-bytes rewrite after seeding does not archive (V2 baseline)', (t) => {
  const galleryDir = tmpDir();
  const ctrlDir = path.join(galleryDir, '.canvas');
  t.after(() => fs.rmSync(galleryDir, { recursive: true, force: true }));
  const slot = 'a.html';
  writeSlotFile(galleryDir, slot, 'body-A');

  let selections = defaultSelections();
  let versions = readVersions(ctrlDir);
  syncSlot({ galleryDir, ctrlDir, slot, selections, versions, nowIso: '2026-07-22T05:10:56.000Z' }).commitSnapshot();
  writeVersions(ctrlDir, versions);
  selections.ratings[slot] = 'nay';
  selections.picks.planner = slot;
  selections.reviewArchive[slot] = { archivedAt: '2026-07-22T05:15:00.000Z' };
  selections.reviewReopen[slot] = { reopenedAt: '2026-07-22T05:16:00.000Z' };

  // Rewrite with the SAME bytes (simulates a re-save with no content change).
  writeSlotFile(galleryDir, slot, 'body-A');
  versions = readVersions(ctrlDir);
  const r = syncSlot({ galleryDir, ctrlDir, slot, selections, versions, nowIso: '2026-07-22T05:20:00.000Z' });
  assert.equal(r.action, 'none');
  assert.equal(r.selectionsChanged, false);
  assert.equal(selections.ratings[slot], 'nay', 'identical bytes cleared the live rating');
  assert.equal(selections.picks.planner, slot, 'identical bytes cleared the winner pick');
  assert.ok(selections.reviewArchive[slot], 'identical bytes reactivated an unchanged reviewed slot');
  assert.ok(selections.reviewReopen[slot], 'identical bytes cleared an unchanged review-again override');
});

test('syncSlot: a proven content-hash change clears only the slot rating and referencing picks', (t) => {
  const galleryDir = tmpDir();
  const ctrlDir = path.join(galleryDir, '.canvas');
  t.after(() => fs.rmSync(galleryDir, { recursive: true, force: true }));
  const slot = 'a.html';
  writeSlotFile(galleryDir, slot, 'body-A');

  const selections = defaultSelections();
  let versions = readVersions(ctrlDir);
  const seeded = syncSlot({ galleryDir, ctrlDir, slot, selections, versions, nowIso: '2026-07-22T05:00:00.000Z' });
  writeVersions(ctrlDir, versions);
  seeded.commitSnapshot();

  selections.ratings[slot] = 'nay';
  selections.ratings['other.html'] = 'yay';
  selections.picks.planner = slot;
  selections.picks.other = 'other.html';
  selections.notes[slot] = 'Keep this review history.';
  selections.reviewArchive[slot] = { archivedAt: '2026-07-22T05:15:00.000Z' };
  selections.reviewArchive['other.html'] = { archivedAt: '2026-07-22T05:16:00.000Z' };
  selections.reviewReopen[slot] = { reopenedAt: '2026-07-22T05:17:00.000Z' };
  selections.reviewReopen['other.html'] = { reopenedAt: '2026-07-22T05:18:00.000Z' };
  writeSlotFile(galleryDir, slot, 'body-B');
  versions = readVersions(ctrlDir);
  const changed = syncSlot({ galleryDir, ctrlDir, slot, selections, versions, nowIso: '2026-07-22T05:30:00.000Z' });

  assert.equal(changed.action, 'archive');
  assert.equal(changed.selectionsChanged, true);
  assert.equal(changed.resetRating, true);
  assert.deepEqual(changed.resetPicks, ['planner']);
  assert.equal(changed.resetReviewArchive, true);
  assert.equal(changed.reactivatedReview, true);
  assert.equal(selections.ratings[slot], undefined);
  assert.equal(selections.ratings['other.html'], 'yay');
  assert.equal(selections.picks.planner, undefined);
  assert.equal(selections.picks.other, 'other.html');
  assert.equal(selections.notes[slot], 'Keep this review history.');
  assert.equal(selections.reviewArchive[slot], undefined);
  assert.ok(selections.reviewArchive['other.html']);
  assert.deepEqual(selections.reviewReopen[slot], { reopenedAt: '2026-07-22T05:30:00.000Z' });
  assert.ok(selections.reviewReopen['other.html']);
});

test('syncSlot: a proven hash change resets choices even when the prior snapshot is unavailable', (t) => {
  const galleryDir = tmpDir();
  const ctrlDir = path.join(galleryDir, '.canvas');
  t.after(() => fs.rmSync(galleryDir, { recursive: true, force: true }));
  const slot = 'a.html';
  writeSlotFile(galleryDir, slot, 'body-A');

  const selections = defaultSelections();
  let versions = readVersions(ctrlDir);
  const seeded = syncSlot({ galleryDir, ctrlDir, slot, selections, versions, nowIso: '2026-07-22T05:00:00.000Z' });
  writeVersions(ctrlDir, versions);
  seeded.commitSnapshot();
  fs.unlinkSync(path.join(ctrlDir, 'current', slot));

  selections.ratings[slot] = 'ok';
  selections.picks.planner = slot;
  writeSlotFile(galleryDir, slot, 'body-B');
  versions = readVersions(ctrlDir);
  const changed = syncSlot({ galleryDir, ctrlDir, slot, selections, versions, nowIso: '2026-07-22T05:30:00.000Z' });

  assert.equal(changed.action, 'seed');
  assert.equal(changed.selectionsChanged, true);
  assert.equal(changed.resetRating, true);
  assert.deepEqual(changed.resetPicks, ['planner']);
  assert.deepEqual(selections.ratings, {});
  assert.deepEqual(selections.picks, {});
});

test('syncSlot: content-hash archive preserves resolved annotations untouched and archives only open ones', (t) => {
  const galleryDir = tmpDir();
  const ctrlDir = path.join(galleryDir, '.canvas');
  t.after(() => fs.rmSync(galleryDir, { recursive: true, force: true }));
  const slot = 'a.html';
  writeSlotFile(galleryDir, slot, 'body-A-SENTINEL');

  let selections = defaultSelections();
  let versions = readVersions(ctrlDir);
  syncSlot({ galleryDir, ctrlDir, slot, selections, versions, nowIso: '2026-07-22T05:00:00.000Z' }).commitSnapshot();
  writeVersions(ctrlDir, versions);

  selections.annotations[slot] = [
    makeAnnotation({ id: 'ann-open', status: 'open', comment: 'needs work' }),
    makeAnnotation({ id: 'ann-resolved', status: 'resolved', comment: 'dealt with', updatedAt: '2026-07-20T00:00:00.000Z' }),
  ];

  writeSlotFile(galleryDir, slot, 'body-B-SENTINEL');
  versions = readVersions(ctrlDir);
  const r = syncSlot({ galleryDir, ctrlDir, slot, selections, versions, nowIso: '2026-07-22T05:30:00.000Z' });

  assert.equal(r.action, 'archive');
  assert.deepEqual(r.archivedIds, ['ann-open']);
  assert.equal(r.selectionsChanged, true);

  const resolved = selections.annotations[slot].find((a) => a.id === 'ann-resolved');
  assert.deepEqual(resolved, makeAnnotation({ id: 'ann-resolved', status: 'resolved', comment: 'dealt with', updatedAt: '2026-07-20T00:00:00.000Z' })); // byte-for-byte, untouched

  const archived = selections.annotations[slot].find((a) => a.id === 'ann-open');
  assert.equal(archived.status, 'archived');
  assert.equal(archived.archivedAt, '2026-07-22T05:30:00.000Z');
  assert.equal(archived.archivedFrom, r.version);
  assert.equal(archived.comment, 'needs work'); // every other field preserved (V4)
  assert.deepEqual(archived.bounds, makeAnnotation().bounds);
  assert.deepEqual(archived.target, makeAnnotation().target);
});

test('syncSlot: archived HTML bytes equal the TRUE prior bytes (V4b)', (t) => {
  const galleryDir = tmpDir();
  const ctrlDir = path.join(galleryDir, '.canvas');
  t.after(() => fs.rmSync(galleryDir, { recursive: true, force: true }));
  const slot = 'a.html';
  const bodyA = '<html>SENTINEL-BODY-A-el392a</html>';
  writeSlotFile(galleryDir, slot, bodyA);
  const priorHash = sha256Hex(Buffer.from(bodyA));

  const selections = defaultSelections();
  let versions = readVersions(ctrlDir);
  const seedResult = syncSlot({ galleryDir, ctrlDir, slot, selections, versions, nowIso: '2026-07-22T05:00:00.000Z' });
  assert.equal(seedResult.action, 'seed'); // records hash A
  seedResult.commitSnapshot();             // ... and the caller writes current/<slot> = bodyA
  writeVersions(ctrlDir, versions);

  // An annotation written against bodyA is what makes those bytes worth
  // keeping — and what makes the copy happen at all (see the next test).
  selections.annotations[slot] = [makeAnnotation({ id: 'ann-1' })];
  const bodyB = '<html>SENTINEL-BODY-B-zx991</html>';
  writeSlotFile(galleryDir, slot, bodyB);
  versions = readVersions(ctrlDir);
  const r = syncSlot({ galleryDir, ctrlDir, slot, selections, versions, nowIso: '2026-07-22T05:30:00.000Z' });

  assert.equal(r.action, 'archive');
  assert.equal(r.version.endsWith(`-${priorHash.slice(0, 8)}`), true);
  const archivedBytes = readArchivedHtml(ctrlDir, slot, r.version);
  assert.ok(archivedBytes.includes('SENTINEL-BODY-A-el392a'));
  assert.equal(sha256Hex(archivedBytes), priorHash); // the archived file is the TRUE prior bytes, not the current (post-rewrite) ones
});

// FIX 2. The content-hash path fires with zero open annotations — the version
// record IS the history, and a later annotation must be attributable to a
// version that exists — but a full HTML copy for a slot with nothing archived
// against it is permanent disk cost protecting no critique. With an autosaving
// editor behind the 400ms poller that is ~150 copies a minute, on a directory
// nothing ever prunes.
test('syncSlot: an archive with nothing to archive records the version but copies no HTML', (t) => {
  const galleryDir = tmpDir();
  const ctrlDir = path.join(galleryDir, '.canvas');
  t.after(() => fs.rmSync(galleryDir, { recursive: true, force: true }));
  const slot = 'a.html';
  const body = (n) => `<html>revision ${n} ${'x'.repeat(20000)}</html>`;
  writeSlotFile(galleryDir, slot, body(0));

  const selections = defaultSelections();
  let versions = readVersions(ctrlDir);
  syncSlot({ galleryDir, ctrlDir, slot, selections, versions, nowIso: '2026-07-22T05:00:00.000Z' }).commitSnapshot();
  writeVersions(ctrlDir, versions);

  const N = 8;
  for (let i = 1; i <= N; i += 1) {
    writeSlotFile(galleryDir, slot, body(i));
    versions = readVersions(ctrlDir);
    const r = syncSlot({ galleryDir, ctrlDir, slot, selections, versions, nowIso: new Date(Date.parse('2026-07-22T05:00:00.000Z') + i * 60000).toISOString() });
    assert.equal(r.action, 'archive', 'the version record must still be written — the hash chain is the history');
    assert.equal(r.selectionsChanged, false);
    r.commitSnapshot();
    writeVersions(ctrlDir, versions);
  }

  const history = listArchive(ctrlDir, slot);
  assert.equal(history.length, N, 'the hash chain lost a link');
  for (const entry of history) {
    assert.equal(entry.provenance, 'content-hash');
    assert.equal(entry.html, null, 'a full HTML copy was written for a version with no annotations');
    assert.equal(readArchivedHtml(ctrlDir, slot, entry.version), null);
    assert.deepEqual(fs.readdirSync(path.join(ctrlDir, 'archive', slot, entry.version)), ['annotations.json']);
    assert.match(entry.hash, /^[0-9a-f]{64}$/, 'the archived-content hash is still recorded');
  }

  // Bounded: N archives of a 20KB slot must not cost N × 20KB. The snapshot
  // (one copy) plus N small JSON records is the whole budget.
  const bytes = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => {
    const p = path.join(dir, entry.name);
    return total + (entry.isDirectory() ? bytes(p) : fs.statSync(p).size);
  }, 0);
  const budget = body(0).length * 2;
  assert.ok(bytes(ctrlDir) < budget,
    `.canvas grew to ${bytes(ctrlDir)} bytes for ${N} annotation-free archives (budget ${budget})`);
});

test('syncAllSlots: one unreadable slot does not abort the sweep for the others', (t) => {
  const galleryDir = tmpDir();
  const ctrlDir = path.join(galleryDir, '.canvas');
  t.after(() => fs.rmSync(galleryDir, { recursive: true, force: true }));
  writeSlotFile(galleryDir, 'a.html', 'body-A');
  writeSlotFile(galleryDir, 'b.html', 'body-B');

  const selections = defaultSelections();
  const versions = readVersions(ctrlDir);
  // 'missing.html' is listed but never written — must not throw, must not
  // prevent a.html/b.html from being processed.
  const r = syncAllSlots({ galleryDir, ctrlDir, slots: ['a.html', 'missing.html', 'b.html'], selections, versions, nowIso: '2026-07-22T05:00:00.000Z' });
  r.commitSnapshots();   // the caller's last step, after selections and versions

  assert.equal(r.versionsChanged, true);
  assert.ok(fs.existsSync(path.join(ctrlDir, 'current', 'a.html')));
  assert.ok(fs.existsSync(path.join(ctrlDir, 'current', 'b.html')));
  assert.equal(fs.existsSync(path.join(ctrlDir, 'current', 'missing.html')), false);
});

// ---------------------------------------------------------------------------
// Cross-chunk schema assertion. gallery-selections.schema.json is owned by
// B2 (sibling chunk), which widened the status enum to add "archived". B2
// has landed and this assertion passes — it remains the repo's only guard on
// that contract (per the plan: "nothing else in the repo validates that
// schema file") and is wired into the blocking gate at scripts/check.sh:68,
// so a regression here fails the build, not just this file.
// ---------------------------------------------------------------------------

test('gallery-selections.schema.json covers annotation history and review-queue archival', () => {
  const schemaPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'mockups', 'gallery-selections.schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
  const enumValues = schema.$defs.annotation.properties.status.enum;
  assert.deepEqual(enumValues, ['open', 'resolved', 'archived']);
  assert.equal(schema.properties.reviewArchive.additionalProperties.required[0], 'archivedAt');
  assert.equal(schema.properties.reviewArchive.additionalProperties.properties.archivedAt.format, 'date-time');
  assert.equal(schema.properties.reviewReopen.additionalProperties.required[0], 'reopenedAt');
  assert.equal(schema.properties.reviewReopen.additionalProperties.properties.reopenedAt.format, 'date-time');
});
