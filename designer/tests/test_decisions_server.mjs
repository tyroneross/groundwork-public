// test_decisions_server.mjs — Groundwork: guided-decisions server HTTP contract.
//
// Pattern: import makeServer (no spawn), server.listen(0) for an ephemeral
// loopback port, drive it via fetch. Every scratch write lands in an
// os.tmpdir() directory, never the repo — cleaned up in t.after().
//
// Run: node --test designer/tests/test_decisions_server.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { makeServer, SCHEMA_ID } from '../decisions/decisions-server.mjs';

function scratchDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gw-decisions-t-'));
}

function validRecord(extra = {}) {
  return { schema: SCHEMA_ID, axes: [], openItems: [], ...extra };
}

/**
 * Boots a decisions-server against a fresh scratch directory. By default the
 * record and the static app share the scratch dir (no static route is
 * exercised unless a test passes `app`); pass `app` to point at a separate
 * stub app directory for the static-serving tests.
 */
async function withServer(t, { app, proxy } = {}) {
  const dir = scratchDir();
  const recordPath = path.join(dir, 'decisions.json');
  fs.writeFileSync(recordPath, JSON.stringify(validRecord()));
  const appDir = app || dir;
  const server = makeServer({ record: recordPath, app: appDir, port: 0, proxy: proxy || null });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { base, dir, recordPath, server };
}

test('GET /record.json returns the record JSON', async (t) => {
  const { base, recordPath } = await withServer(t);
  const res = await fetch(`${base}/record.json`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, JSON.parse(fs.readFileSync(recordPath, 'utf8')));
});

test('PUT /record.json with a valid record saves and round-trips', async (t) => {
  const { base } = await withServer(t);
  const newRecord = validRecord({ axes: [{ id: 'a1', title: 'Pick one', options: [] }] });
  const bodyStr = JSON.stringify(newRecord);

  const putRes = await fetch(`${base}/record.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: bodyStr,
  });
  assert.equal(putRes.status, 200);
  const putBody = await putRes.json();
  assert.equal(putBody.ok, true);
  assert.match(putBody.savedAt, /^\d{8}T\d{6}Z$/);
  assert.equal(putBody.bytes, Buffer.byteLength(bodyStr, 'utf8'));

  const getRes = await fetch(`${base}/record.json`);
  assert.equal(getRes.status, 200);
  const getBody = await getRes.json();
  assert.deepEqual(getBody, newRecord);
});

test('PUT to any path other than /record.json is 405', async (t) => {
  const { base } = await withServer(t);
  for (const p of ['/other.json', '/index.html']) {
    const res = await fetch(`${base}${p}`, { method: 'PUT', body: JSON.stringify(validRecord()) });
    assert.equal(res.status, 405, `PUT ${p} should be 405`);
    const body = await res.json();
    assert.ok(body.error);
  }
});

test('PUT with a non-JSON body is rejected and leaves the file unchanged', async (t) => {
  const { base, recordPath } = await withServer(t);
  const before = fs.readFileSync(recordPath, 'utf8');

  const res = await fetch(`${base}/record.json`, { method: 'PUT', body: 'not-json{' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error);
  assert.equal(fs.readFileSync(recordPath, 'utf8'), before);
});

test('PUT with valid JSON but the wrong (or missing) schema is rejected and leaves the file unchanged', async (t) => {
  const { base, recordPath } = await withServer(t);
  const before = fs.readFileSync(recordPath, 'utf8');

  const wrongSchema = await fetch(`${base}/record.json`, {
    method: 'PUT',
    body: JSON.stringify({ schema: 'something-else/v1', axes: [] }),
  });
  assert.equal(wrongSchema.status, 400);
  assert.equal(fs.readFileSync(recordPath, 'utf8'), before);

  const missingSchema = await fetch(`${base}/record.json`, {
    method: 'PUT',
    body: JSON.stringify({ axes: [] }),
  });
  assert.equal(missingSchema.status, 400);
  assert.equal(fs.readFileSync(recordPath, 'utf8'), before);

  const notAnObject = await fetch(`${base}/record.json`, {
    method: 'PUT',
    body: JSON.stringify(['not', 'an', 'object']),
  });
  assert.equal(notAnObject.status, 400);
  assert.equal(fs.readFileSync(recordPath, 'utf8'), before);
});

test('a successful PUT is atomic: no leftover temp files in the record directory', async (t) => {
  const { base, dir } = await withServer(t);
  const res = await fetch(`${base}/record.json`, { method: 'PUT', body: JSON.stringify(validRecord()) });
  assert.equal(res.status, 200);
  const entries = fs.readdirSync(dir).sort();
  assert.deepEqual(entries, ['decisions.json']);
});

test('GET /live-status.json returns all four keys and never throws; origin is null without --proxy', async (t) => {
  const { base } = await withServer(t);
  const res = await fetch(`${base}/live-status.json`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['branch', 'committedAt', 'origin', 'sha']);
  assert.equal(body.origin, null);
});

test('an unknown path 404s when no --proxy is configured (no accidental egress)', async (t) => {
  const { base } = await withServer(t);
  const res = await fetch(`${base}/some/unknown/path`);
  assert.equal(res.status, 404);
});

test('GET / serves the app index.html', async (t) => {
  const appDir = scratchDir();
  fs.writeFileSync(path.join(appDir, 'index.html'), '<!doctype html><html><body>guided decisions</body></html>');
  t.after(() => fs.rmSync(appDir, { recursive: true, force: true }));

  const { base } = await withServer(t, { app: appDir });
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /<!doctype html/i);
});

test('path traversal attempts never serve arbitrary files', async (t) => {
  const { base } = await withServer(t);
  const targets = ['/../../etc/passwd', '/%2e%2e%2f%2e%2e%2fetc%2fpasswd'];
  for (const p of targets) {
    const res = await fetch(`${base}${p}`);
    assert.ok(res.status === 404 || res.status === 403, `${p} -> expected 404/403, got ${res.status}`);
    const text = await res.text();
    assert.ok(!text.includes('root:'), `${p} appears to have leaked file contents`);
  }
});

/* ─────────────────────────────────────────────────────────────────────────
 * visuals/ and the reserved live root.
 *
 * Both were found missing by an independent audit before this reached main:
 * the scaffold created visuals/, the page fetched it, and nothing served it —
 * so the card's picture, the surface's stated first job, could never appear.
 * ───────────────────────────────────────────────────────────────────────── */

test('a captured screenshot beside the record is served', async (t) => {
  const { base, dir } = await withServer(t);
  fs.mkdirSync(path.join(dir, 'visuals'), { recursive: true });
  // A one-pixel PNG: enough to prove bytes and content-type round trip.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');
  fs.writeFileSync(path.join(dir, 'visuals', 'item-one.png'), png);

  const res = await fetch(`${base}/visuals/item-one.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await res.arrayBuffer()).length, png.length);
});

test('the visuals manifest is served so the page can find its pictures', async (t) => {
  const { base, dir } = await withServer(t);
  fs.mkdirSync(path.join(dir, 'visuals'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'visuals', 'manifest.json'),
    JSON.stringify({ items: { 'item-one': { file: 'item-one.png' } } }));
  const res = await fetch(`${base}/visuals/manifest.json`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).items['item-one'].file, 'item-one.png');
});

test('a missing screenshot is a 404, not a crash', async (t) => {
  const { base } = await withServer(t);
  assert.equal((await fetch(`${base}/visuals/absent.png`)).status, 404);
});

test('the visuals route cannot be walked out of its directory', async (t) => {
  const { base, dir } = await withServer(t);
  const secret = path.join(dir, 'decisions.json');
  assert.ok(fs.existsSync(secret));
  for (const p of [
    '/visuals/../decisions.json',
    '/visuals/..%2Fdecisions.json',
    '/visuals/%2e%2e/decisions.json',
    '/visuals/../../etc/passwd',
    '/visuals/subdir/../../decisions.json',
  ]) {
    const res = await fetch(`${base}${p}`);
    assert.notEqual(res.status, 200, `traversal succeeded for ${p}`);
  }
});

test('the live root is reserved and refuses when no proxy is configured', async (t) => {
  const { base } = await withServer(t);
  const res = await fetch(`${base}/__live/`);
  assert.equal(res.status, 404, 'no --proxy means no outbound request, ever');
});

test('the live root reaches the proxied origin, not the decisions app', async (t) => {
  // The defect this guards: "/" is the decisions app's own index and is matched
  // ahead of the proxy, so pointing the preview at it rendered this surface
  // inside itself and every overlay then edited a nested copy of the page.
  const upstream = await new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!doctype html><title>THE REAL BUILD</title><p>${req.url}</p>`);
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => new Promise((r) => upstream.close(() => r())));
  const origin = `http://127.0.0.1:${upstream.address().port}`;

  const appDir = scratchDir();
  fs.writeFileSync(path.join(appDir, 'index.html'), '<!doctype html><title>THE DECISIONS APP</title>');
  t.after(() => fs.rmSync(appDir, { recursive: true, force: true }));

  const { base } = await withServer(t, { app: appDir, proxy: origin });
  const root = await fetch(`${base}/`);
  assert.match(await root.text(), /THE DECISIONS APP/, 'the app itself still owns /');

  const live = await fetch(`${base}/__live/`);
  assert.equal(live.status, 200);
  const body = await live.text();
  assert.match(body, /THE REAL BUILD/, 'the preview must reach the build being reviewed');
  assert.doesNotMatch(body, /THE DECISIONS APP/, 'the preview must not nest the surface in itself');
});

test('a rejected write leaves no temp file in the project directory', async (t) => {
  const { base, dir } = await withServer(t);
  await fetch(`${base}/record.json`, { method: 'PUT', body: 'not-json{' });
  await fetch(`${base}/record.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema: 'wrong/v1' }),
  });
  const leftovers = fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'));
  assert.deepEqual(leftovers, [], `temp files left in the user's .designdoc/: ${leftovers}`);
});

/* A compare's option B may be an HTML wireframe. It is served, but as an inert
 * document: a sandbox CSP gives it an opaque origin with no script, so even
 * opened directly it cannot reach PUT /record.json. */
test('an HTML wireframe is served with a sandbox CSP and nosniff', async (t) => {
  const { base, dir } = await withServer(t);
  fs.mkdirSync(path.join(dir, 'visuals'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'visuals', 'b.html'),
    '<!doctype html><p>wire</p><script>fetch("/record.json",{method:"PUT"})</script>');
  const res = await fetch(`${base}/visuals/b.html`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/html');
  const csp = res.headers.get('content-security-policy') || '';
  assert.match(csp, /(^|;\s*)sandbox(;|$)/, 'must sandbox the document');
  assert.ok(!/allow-scripts|allow-same-origin/.test(csp), `CSP re-opens the sandbox: ${csp}`);
  assert.match(csp, /script-src 'none'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('a PNG visual carries no sandbox CSP (only HTML needs one)', async (t) => {
  const { base, dir } = await withServer(t);
  fs.mkdirSync(path.join(dir, 'visuals'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'visuals', 'a.png'), Buffer.from([0x89, 0x50]));
  const res = await fetch(`${base}/visuals/a.png`);
  assert.equal(res.headers.get('content-security-policy'), null);
});
