import { createServer } from 'node:http';
import { appendFile, readFile, stat } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const stateDir = dirname(fileURLToPath(import.meta.url));
const ledgerPath = process.env.DASHBOARD_REVIEW_LEDGER || resolve(stateDir, 'decisions.jsonl');
const inboxDir = resolve(stateDir, '../references/dashboards/review-inbox');
const boardDir = process.env.DASHBOARD_REVIEW_DIR || resolve(
  homedir(),
  '.codex/visualizations/2026/08/20/01a0216e-c3df-7233-82fd-556a413816a8/dashboard-review',
);
const port = Number(process.env.DASHBOARD_REVIEW_PORT || 3847);
const validDecision = new Set(['yay', 'nay', 'open']);
const validId = /^[a-z0-9][a-z0-9-]*$/;
const mimeTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
let appendQueue = Promise.resolve();

// The server binds loopback only, so a wildcard origin buys nothing and lets any
// site the operator visits read this ledger from their browser. Echo back only
// loopback origins, and omit the header entirely for anything else.
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

function corsHeaders(request) {
  const origin = request?.headers?.origin;
  if (!origin || !LOOPBACK_ORIGIN.test(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    vary: 'Origin',
  };
}

function send(response, status, body, contentType = 'application/json; charset=utf-8', request = null) {
  response.writeHead(status, {
    ...corsHeaders(request),
    'content-type': contentType,
    'cache-control': 'no-store',
  });
  response.end(body);
}

function sendJson(response, status, body, request = null) {
  send(response, status, JSON.stringify(body), 'application/json; charset=utf-8', request);
}

function isWithin(root, candidate) {
  const path = relative(root, candidate);
  return path && !path.startsWith('..') && !path.includes('/..');
}

async function readDecisions() {
  let raw = '';
  try { raw = await readFile(ledgerPath, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const decisions = {};
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      const event = JSON.parse(line);
      if (!validId.test(event.id) || !validDecision.has(event.decision)) continue;
      if (event.decision === 'open') delete decisions[event.id];
      else decisions[event.id] = event.decision;
    } catch { /* Preserve malformed historical lines without making the ledger unreadable. */ }
  }
  return decisions;
}

async function appendDecision(event) {
  appendQueue = appendQueue.then(() => appendFile(ledgerPath, `${JSON.stringify(event)}\n`, 'utf8'));
  return appendQueue;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw new Error('request body is too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function sendFile(response, root, requestPath, request = null) {
  const filePath = resolve(root, requestPath);
  if (!isWithin(root, filePath)) return sendJson(response, 403, { error: 'forbidden' }, request);
  try {
    const file = await readFile(filePath);
    const metadata = await stat(filePath);
    if (!metadata.isFile()) return sendJson(response, 404, { error: 'not found' }, request);
    send(response, 200, file, mimeTypes[extname(filePath)] || 'application/octet-stream', request);
  } catch (error) {
    if (error.code === 'ENOENT') return sendJson(response, 404, { error: 'not found' }, request);
    sendJson(response, 500, { error: 'unable to read file' }, request);
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
  if (request.method === 'OPTIONS') return send(response, 204, '', 'text/plain; charset=utf-8', request);

  if (request.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(response, 200, { ok: true, ledger: ledgerPath }, request);
  }
  if (request.method === 'GET' && url.pathname === '/api/decisions') {
    return sendJson(response, 200, { decisions: await readDecisions() }, request);
  }
  if (request.method === 'POST' && url.pathname === '/api/decisions') {
    try {
      const body = await readJson(request);
      if (!validId.test(body.id) || !validDecision.has(body.decision)) {
        return sendJson(response, 400, { error: 'id and decision are required' }, request);
      }
      const event = {
        schema_version: 'groundwork.dashboard-review-decision/v1',
        saved_at: new Date().toISOString(),
        id: body.id,
        decision: body.decision,
      };
      await appendDecision(event);
      return sendJson(response, 201, event, request);
    } catch (error) {
      return sendJson(response, 400, { error: error.message || 'invalid JSON' }, request);
    }
  }
  if (request.method === 'GET' && url.pathname === '/') return sendFile(response, boardDir, 'index.html', request);
  if (request.method === 'GET' && url.pathname.startsWith('/html/')) {
    return sendFile(response, inboxDir, decodeURIComponent(url.pathname.slice('/html/'.length)), request);
  }
  sendJson(response, 404, { error: 'not found' }, request);
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Dashboard review ledger listening on http://127.0.0.1:${port}\n`);
});
