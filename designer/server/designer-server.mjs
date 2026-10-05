#!/usr/bin/env node
// designer-server.mjs — zero-dependency Node stdlib server for the UI Guidance
// designer (revealed-preference design-system builder).
//
// Mirrors mockup-gallery's gallery-server.mjs pattern: http + fs only, no deps.
// The interface is DUMB — every engine operation shells out to the Python CLI
// (designer/engine/cli.py); the Python engine is the single source of truth
// (FORK-1 Path A: server-side rendering). The server just relays JSON and serves
// the static picker.
//
// Usage:
//   node designer/server/designer-server.mjs --context "<what you're building>" \
//        --out <target-repo-path> [--name <product>] [--port 8900]
//
// Generated output note: .designer-output/ (the default generic scratch dir)
// should be added to .gitignore.

import http from 'http';
import { workspaceStore } from './workspace-store.mjs';
import { createDecisionReporter } from './oc-decisions.mjs';
import { startEventLoopWatchdog } from './event-loop-watchdog.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');   // the UI Guidance repo
const STATIC_DIR = __dirname;

const argv = process.argv.slice(2);
function flag(name, dflt = null) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : dflt;
}

const CONTEXT = flag('--context', '');
const OUT = flag('--out', process.cwd());          // target product repo
const NAME = flag('--name', '');
const PORT = parseInt(flag('--port', '8900'), 10);
const DRIVE_FLAG = flag('--drive', 'standard');
const BOOTSTRAP_PATH = flag('--bootstrap', '');

// Track whether --out was explicitly passed at launch. If explicit, generic mode
// keeps OUT as TARGET; otherwise generic mode uses the scratch default.
const OUT_EXPLICIT = argv.indexOf('--out') !== -1;

// Default scratch output directory for generic mode (no product context).
const SCRATCH_OUT = path.join(PLUGIN_ROOT, '.designer-output');

// ── Restart-safe / hang-safe config ────────────────────────────────────────
// A flag value wins over its env twin; a non-finite or negative value (from
// either source) falls back to the default rather than producing a broken
// timer.
function numericSetting(flagName, envName, dflt) {
  const rawFlag = flag(flagName, null);
  if (rawFlag !== null) {
    const n = Number(rawFlag);
    return (Number.isFinite(n) && n >= 0) ? n : dflt;
  }
  const rawEnv = process.env[envName];
  if (rawEnv !== undefined && rawEnv !== '') {
    const n = Number(rawEnv);
    return (Number.isFinite(n) && n >= 0) ? n : dflt;
  }
  return dflt;
}

// How long since the host's last /api/agent/contract or /api/agent/answer
// before /api/step stops assuming a host is attached. Gates the "no agent"
// notice only — a decision the host already posted is never hidden by it.
const AGENT_WINDOW_SECONDS = numericSetting('--agent-window-seconds', 'GROUNDWORK_DESIGNER_AGENT_WINDOW_SECONDS', 120);
const AGENT_WINDOW_MS = AGENT_WINDOW_SECONDS * 1000;

// How long the event loop may stall before the watchdog kills this process
// so a supervisor can restart it. 0 disables the watchdog entirely.
const WATCHDOG_SECONDS = numericSetting('--watchdog-seconds', 'GROUNDWORK_DESIGNER_WATCHDOG_SECONDS', 300);

// ── Session state ─────────────────────────────────────────────────────────────
// Per-session mode + target + context. CLI flags are initial values; the
// /api/mode endpoint can override them mid-session.
let MODE = 'general';                              // 'general' | 'product'
let TARGET = OUT_EXPLICIT ? OUT : SCRATCH_OUT;     // emit destination
const STATE_FILE = process.env.GROUNDWORK_DESIGNER_STATE_FILE || path.join(TARGET, '.designer-state.json');
let PRODUCT_ROOT = null;                           // existing repo inspected in product mode
let SESSION_CONTEXT = CONTEXT;                     // product context string
let SESSION_NAME = NAME || 'design-system';        // design system name
let BOOTSTRAP = null;
let BOOTSTRAP_ERROR = null;
let BASELINE_REVIEWED = false;
let SETUP_UNLOCKED = false;

function designTokensPath() {
  return path.join(TARGET, 'design-tokens.md');
}

// In-memory walk state (single-session local tool). Persisted to a temp file so
// the Python CLI can read it; this is the live taste-state.
let STATE = null;

// Holds the last extraction result for the current product session.
// Shape: { available, signals, warnings, summary? } — reset on /api/mode.
let EXTRACTION = null;

// IMPORTED: true after a successful /api/import-design; used to tag draft source.
// Reset on /api/mode alongside STATE/EXTRACTION.
let IMPORTED = false;

// Workspace records survive browser and agent restarts.
const workspace = () => workspaceStore(TARGET);

// ── Adaptive drive-mode state ─────────────────────────────────────────────────
// DRIVE_MODE: 'standard' (default, browser-only) | 'adaptive' (host-agent drives
// decision selection; browser still shows and picks options the agent chose).
let DRIVE_MODE = (DRIVE_FLAG === 'adaptive') ? 'adaptive' : 'standard';

// TURN: active turn token when adaptive.
// phase: 'await_agent'  — agent must POST /api/agent/answer to choose next decision
//        'await_user'   — agent chose a decision; browser must POST /api/pick
//        'done'         — walk is complete
// seq: monotonically increasing counter so browser/agent can detect stale polls.
let TURN = null;

// ── Operations Center decision reporter ─────────────────────────────────────
// Fire-and-forget: tells a local OC instance when a turn is waiting on the
// user, and when it resolves. OC may not be running; failures are swallowed
// inside the reporter itself (see oc-decisions.mjs) — this call site never
// needs to know whether the POST succeeded.
const ocDecisions = createDecisionReporter({ port: PORT, productName: () => SESSION_NAME });

// Timestamp (ms) of the last /api/agent/contract request. Used to detect whether
// an agent is actually attached so /api/step can surface a "no agent" notice.
let AGENT_SEEN_AT = 0;

// Reset TURN to a fresh await_agent state for a new adaptive walk.
function resetTurn() {
  TURN = { phase: 'await_agent', contract: null, decision: null, seq: 0, agentReason: '', generated: null };
}

// True while a host has polled /api/agent/contract or /api/agent/answer
// within the last AGENT_WINDOW_MS. Gates only the "no agent attached" notice
// on /api/step — a decision the host already posted (TURN.phase ===
// 'await_user') is returned regardless of this window.
function agentAttached() {
  return AGENT_SEEN_AT !== 0 && (Date.now() - AGENT_SEEN_AT) <= AGENT_WINDOW_MS;
}

// The payload for GET /api/step while TURN.phase === 'await_user': either the
// pending generated mockup (CB2) or the pending decision to ask about. Shared
// by the immediate-return and long-poll paths so both apply identically.
function awaitUserStepPayload() {
  if (TURN.generated) {
    return {
      action: 'generated',
      mockup: TURN.generated.mockup,
      token_deltas: TURN.generated.mockup.token_deltas || null,
      agent_reason: TURN.generated.agent_reason,
      seq: TURN.seq,
      drive: DRIVE_MODE,
      agentAttached: agentAttached(),
    };
  }
  return {
    action: 'ask',
    decision: TURN.decision,
    agent_reason: TURN.agentReason,
    tier: (TURN.decision && TURN.decision.ordering_tier_label) || '',
    adaptive: true,
    // Surface the live turn seq so the browser echoes it on POST /api/pick
    // and the server can reject a pick made against a superseded decision
    // (f1 stale-seq guard applies to the browser path, not only agents).
    seq: TURN.seq,
    drive: DRIVE_MODE,
    agentAttached: agentAttached(),
  };
}

// Arm adaptive mode (idempotent). Called whenever the agent polls /api/agent/contract.
function armAdaptive() {
  DRIVE_MODE = 'adaptive';
  if (!TURN) resetTurn();
}

// ── Per-process scratch files ───────────────────────────────────────────────
// Engine-input scratch files (the CLI's --state/--answer/--signals/--deltas
// args) must not share a path across concurrently running servers — two
// processes writing the same PLUGIN_ROOT-relative file race, and the loser's
// engine invocation reads the winner's data (reproduced: designer/tests/
// test_workspace.mjs's live-server test loses its `generate` answer when
// another server's process interleaves a write). Each process gets its own
// tmpdir instead; STATE_FILE (the durable session record) is unaffected.
let _scratchDir = null;
function scratchFile(name) {
  if (!_scratchDir) {
    _scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-designer-'));
    process.on('exit', () => {
      try { fs.rmSync(_scratchDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    });
  }
  return path.join(_scratchDir, name);
}

// ── Python CLI bridge ───────────────────────────────────────────────────────
function engine(args, stateObj = null) {
  const fullArgs = ['-m', 'designer.engine.cli', ...args];
  if (stateObj !== null) {
    const tmp = scratchFile('engine-state.json');
    fs.writeFileSync(tmp, JSON.stringify(stateObj));
    fullArgs.push('--state', tmp);
  }
  const res = spawnSync('python3', fullArgs, {
    cwd: PLUGIN_ROOT,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error('engine error: ' + (res.stderr || res.stdout || 'unknown').slice(-800));
  }
  return JSON.parse(res.stdout);
}

function visualBootstrap(args) {
  const res = spawnSync('python3', ['-m', 'designer.bridge.visual_bootstrap', ...args], {
    cwd: PLUGIN_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error('visual bootstrap error');
  }
  return JSON.parse(res.stdout);
}

function initializeBootstrap() {
  if (!BOOTSTRAP_PATH) return;
  try {
    const initialized = visualBootstrap(['state', BOOTSTRAP_PATH]);
    BOOTSTRAP = initialized.bootstrap;
    STATE = initialized.state;
    MODE = 'product';
    PRODUCT_ROOT = BOOTSTRAP.product.repoPath;
    TARGET = BOOTSTRAP.product.outputPath;
    SESSION_NAME = BOOTSTRAP.product.name;
    SESSION_CONTEXT = STATE.context?.description || BOOTSTRAP.context?.requestedDelta || '';
    DRIVE_MODE = BOOTSTRAP.drive === 'adaptive' ? 'adaptive' : 'standard';
    if (DRIVE_MODE === 'adaptive') resetTurn();
  } catch (_error) {
    BOOTSTRAP_ERROR = {
      message: 'The visual bootstrap is invalid or unavailable.',
      detail: 'Groundwork did not load product paths, source contents, or design state.',
      recovery: 'Regenerate the visual bootstrap from the app and relaunch Groundwork.',
    };
    STATE = null;
  }
}

// ── Durable session persistence (restart-safe turns) ───────────────────────
// The walk, the posted decision, and its seq survive a host that stops
// polling and a server that gets killed and relaunched. STATE_FILE is the
// durable session record: bare engine state at top level (existing readers
// keep reading `.history`), plus one `groundwork_server` key the engine
// ignores (TasteState.from_dict drops unknown keys) — shaped so the engine
// CLI could read it directly if a future caller wants that.

function bootstrapSha256() {
  if (!BOOTSTRAP_PATH) return '';
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(BOOTSTRAP_PATH)).digest('hex');
  } catch {
    return '';
  }
}

// Computed once from CLI args — identifies "the same launch" for resume.
const LAUNCH = {
  context: CONTEXT,
  out: OUT_EXPLICIT ? path.resolve(OUT) : '',
  name: NAME,
  drive: DRIVE_FLAG,
  bootstrap: BOOTSTRAP_PATH ? path.resolve(BOOTSTRAP_PATH) : '',
  bootstrapSha256: bootstrapSha256(),
};

// Minutes since epoch that THIS machine booted, computed once. A saved
// owner.pid is only trustworthy against the boot it was recorded on — after
// a reboot, the OS can (and does) recycle low PIDs, so an owner.pid that
// happens to match a live process on a LATER boot is a false positive, not
// the same process. Comparing bootTime (with slack for clock/measurement
// drift between processes, not an exact match) tells a stale record from a
// currently-alive one.
const BOOT_TIME_MIN = Math.round((Date.now() - os.uptime() * 1000) / 60000);

// The state file does not exist until a walk starts, so checking its saved
// owner alone cannot exclude a second server launched before the first turn.
// Hold an advisory OS lock on an open descriptor for this process's lifetime.
// Python is already required by the Designer engine; its stdlib fcntl module
// acquires the lock on the descriptor inherited from this Node process.
function acquireSessionLock() {
  const lockDir = path.join(os.tmpdir(), 'groundwork-designer-locks');
  fs.mkdirSync(lockDir, { recursive: true });
  const key = crypto.createHash('sha256').update(path.resolve(STATE_FILE)).digest('hex');
  const fd = fs.openSync(path.join(lockDir, `${key}.lock`), 'a', 0o600);
  const result = spawnSync('python3', ['-c',
    'import fcntl, sys\ntry: fcntl.flock(3, fcntl.LOCK_EX | fcntl.LOCK_NB)\nexcept BlockingIOError: sys.exit(3)',
  ], { stdio: ['ignore', 'pipe', 'pipe', fd], encoding: 'utf8' });
  if (result.status !== 0) {
    fs.closeSync(fd);
    if (result.status === 3) console.error(`Not starting: another server owns ${STATE_FILE}`);
    else console.error(`Not starting: could not lock ${STATE_FILE}: ${result.error?.message || result.stderr || 'unknown error'}`);
    process.exit(2);
  }
  process.once('exit', () => fs.closeSync(fd));
}

let _lastPersistedKey = null;
let _lastWrittenMtimeMs = null;
const _persistErrorsLogged = new Set();
let _sessionWriteBlocked = false;

function logPersistError(err) {
  const message = String((err && err.message) || err);
  if (_persistErrorsLogged.has(message)) return;
  _persistErrorsLogged.add(message);
  console.error(`persistSession: ${message}`);
}

// True when `owner` (a persisted { pid, bootTime }) names a DIFFERENT,
// currently-alive process on the SAME boot as this one. Shared by
// restoreSession (should this process resume?) and persistSession (is it
// safe to overwrite STATE_FILE right now?).
function ownerIsAlive(owner) {
  if (!owner || typeof owner.pid !== 'number' || owner.pid === process.pid) return false;
  if (typeof owner.bootTime === 'number' && Math.abs(owner.bootTime - BOOT_TIME_MIN) > 2) return false;
  return isPidAlive(owner.pid);
}

// Returns the pid of another still-live process that currently owns
// STATE_FILE, or null when it's safe for THIS process to write. Reads the
// file only when its mtime has moved since our own last write — if nothing
// has touched it since then, we already know we're the owner.
function otherLiveOwner() {
  let stat;
  try {
    stat = fs.statSync(STATE_FILE);
  } catch {
    return null; // no file yet
  }
  if (_lastWrittenMtimeMs !== null && stat.mtimeMs === _lastWrittenMtimeMs) {
    return null; // unchanged since our own last write
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
  const owner = parsed && parsed.groundwork_server && parsed.groundwork_server.owner;
  return ownerIsAlive(owner) ? owner.pid : null;
}

// Write the live walk to STATE_FILE before acknowledging an API response.
// A process that observes another owner must never become the writer later,
// even if that owner exits while this process remains open.
function persistSession() {
  if (_sessionWriteBlocked) return false;
  let tmpPath = null;
  try {
    // Nothing loaded yet (no walk started, no resume) and this process has
    // never written a record — don't touch the file. Otherwise startup would
    // immediately overwrite a saved walk with an empty record on the very
    // first response, e.g. a relaunch with a mistyped --context destroys the
    // prior walk before any interaction. Once this process writes once (or
    // resumes and re-writes on /api/mode reset), _lastPersistedKey is
    // non-null and every subsequent call writes normally.
    if (STATE === null && TURN === null && _lastPersistedKey === null) return true;

    // Another still-running process owns this file right now (e.g. a second
    // launch with the same args/state file, started while the first is
    // still up) — writing here would silently steal or corrupt its
    // in-progress walk. Skip the write; log once.
    const otherPid = otherLiveOwner();
    if (otherPid !== null) {
      logPersistError(new Error(`another live process (pid ${otherPid}) owns ${STATE_FILE} — not overwriting its walk`));
      _sessionWriteBlocked = true;
      return false;
    }

    const record = {
      version: 1,
      savedAt: new Date().toISOString(),
      launch: LAUNCH,
      owner: { pid: process.pid, bootTime: BOOT_TIME_MIN },
      session: {
        mode: MODE,
        target: TARGET,
        productRoot: PRODUCT_ROOT,
        context: SESSION_CONTEXT,
        name: SESSION_NAME,
        drive: DRIVE_MODE,
        bootstrapActive: !!BOOTSTRAP,
        baselineReviewed: BASELINE_REVIEWED,
        imported: IMPORTED,
      },
      hasState: STATE !== null,
      turn: TURN,
    };
    const payload = { ...(STATE || {}), groundwork_server: record };
    const compareKey = JSON.stringify({ ...payload, groundwork_server: { ...record, savedAt: undefined } });
    if (compareKey === _lastPersistedKey) return true;
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    tmpPath = `${STATE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(payload), { mode: 0o600 });
    fs.renameSync(tmpPath, STATE_FILE);
    tmpPath = null;
    _lastPersistedKey = compareKey;
    try { _lastWrittenMtimeMs = fs.statSync(STATE_FILE).mtimeMs; } catch { _lastWrittenMtimeMs = null; }
    return true;
  } catch (err) {
    if (tmpPath !== null) {
      try { fs.rmSync(tmpPath, { force: true }); } catch { /* keep original write error */ }
    }
    logPersistError(err);
    _sessionWriteBlocked = true;
    return false;
  }
}

// True when `pid` names a live process. `process.kill(pid, 0)` sends no
// signal — it only probes existence/permission. EPERM means the process
// exists but is owned by someone else, which still counts as alive here.
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return !!(err && err.code === 'EPERM');
  }
}

// Resume a prior walk from STATE_FILE if — and only if — it was left by the
// same launch arguments and passes shape validation. Any failure is a silent
// fresh start, logged once for the operator, never a thrown error.
function restoreSession() {
  let raw;
  try {
    raw = fs.readFileSync(STATE_FILE, 'utf8');
  } catch {
    return; // no file yet — fresh session
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`Not resuming: ${STATE_FILE} has no Groundwork session record`);
    return;
  }
  const record = parsed && parsed.groundwork_server;
  if (!record || typeof record !== 'object' || record.version !== 1) {
    console.error(`Not resuming: ${STATE_FILE} has no Groundwork session record`);
    return;
  }
  if (BOOTSTRAP_ERROR) return; // a broken bootstrap never resumes

  if (JSON.stringify(record.launch) !== JSON.stringify(LAUNCH)) {
    console.error('Not resuming: launch arguments differ from the saved walk');
    return;
  }

  // Another still-running process owns this walk (e.g. a second `explore-ui`
  // launched with the same args/state file while the first is still up) —
  // resuming here would race it for STATE_FILE writes and silently steal its
  // in-progress turn. Only a dead owner's record is safe to take over.
  // ownerIsAlive() also rejects a saved bootTime that no longer matches this
  // boot — a recycled pid across a reboot must not look like a live owner.
  if (ownerIsAlive(record.owner)) {
    console.error(`Not resuming: the saved walk belongs to running process ${record.owner.pid}`);
    return;
  }

  const turn = record.turn;
  const validTurn = turn === null || (
    turn && typeof turn === 'object' &&
    ['await_agent', 'await_user', 'done'].includes(turn.phase) &&
    Number.isInteger(turn.seq) && turn.seq >= 0 &&
    (turn.decision == null || typeof turn.decision === 'object') &&
    (turn.generated == null || (
      typeof turn.generated === 'object' &&
      turn.generated.mockup && typeof turn.generated.mockup === 'object'
    ))
  );
  const session = (record.session && typeof record.session === 'object') ? record.session : {};
  const validSession =
    ['general', 'product'].includes(session.mode) &&
    ['standard', 'adaptive'].includes(session.drive) &&
    typeof session.target === 'string' && path.isAbsolute(session.target) &&
    (session.mode !== 'product' || session.target === path.join(session.productRoot || '', '.designdoc'));

  if (!validTurn || !validSession) {
    console.error('Not resuming: saved walk failed validation');
    return;
  }

  if (record.hasState) {
    const { groundwork_server: _drop, ...rest } = parsed;
    STATE = rest;
  } else {
    STATE = null;
  }
  TURN = turn;
  MODE = session.mode;
  TARGET = session.target;
  PRODUCT_ROOT = session.productRoot ?? null;
  SESSION_CONTEXT = session.context ?? '';
  SESSION_NAME = session.name ?? SESSION_NAME;
  DRIVE_MODE = session.drive;
  BASELINE_REVIEWED = !!session.baselineReviewed;
  IMPORTED = !!session.imported;
  if (!session.bootstrapActive) BOOTSTRAP = null;

  const historyLen = Array.isArray(STATE?.history) ? STATE.history.length : 0;
  const seq = TURN ? TURN.seq : 0;
  const phase = TURN ? TURN.phase : 'none';
  console.log(`Resumed walk from ${STATE_FILE}: seq ${seq}, phase ${phase}, ${historyLen} history entries`);

  // A decision the agent already posted must still be answerable, and OC's
  // board must still show it, even though nothing polled between the crash
  // and this restart. awaitingUser() is idempotent on seq.
  if (DRIVE_MODE === 'adaptive' && TURN && TURN.phase === 'await_user') {
    ocDecisions.awaitingUser(TURN);
  }
}

function safeText(value, maxLength = 320) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/(?:[A-Za-z]:\\|\/)(?:[^\s/]+\/)+[^\s]*/g, '[redacted path]')
    .replace(/\bhttps?:\/\/[^\s]+/g, '[redacted URL]')
    .slice(0, maxLength);
}

function safeSourceRef(value) {
  if (typeof value !== 'string' || path.isAbsolute(value)) return null;
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
  if (normalized === '..' || normalized.startsWith('../')) return null;
  return normalized.slice(0, 240);
}

function effectiveHistory(categoryId) {
  const history = Array.isArray(STATE?.history) ? STATE.history : [];
  const entries = history.filter((entry) => entry.category_id === categoryId);
  const decided = [...entries].reverse().find((entry) => entry.provenance === 'DECIDED');
  const observed = entries.find((entry) => entry.provenance === 'OBSERVED');
  return { effective: decided || observed || entries.at(-1), decided, observed };
}

function projectedSurfaces() {
  const surfaces = (BOOTSTRAP?.context?.platformSurfaces || []).map((surface) => ({
    id: safeText(surface.id, 80),
    platform: safeText(surface.platform, 40),
    role: safeText(surface.role, 40),
    name: safeText(surface.name, 120),
    interactionModes: (surface.interactionModes || []).map((mode) => safeText(mode, 40)),
    featureIds: (surface.featureIds || []).map((id) => safeText(id, 80)),
    provenance: String(surface.provenance || '').toUpperCase(),
  }));
  const platformDecision = effectiveHistory('platform-target').decided;
  const platform = {
    'platform-web': 'web',
    'platform-ios': 'ios',
    'platform-macos': 'macos',
  }[platformDecision?.option_id];
  if (platform) {
    const primary = surfaces.find((surface) => surface.role === 'primary');
    if (primary) {
      primary.platform = platform;
      primary.provenance = 'DECIDED';
    }
  }
  return surfaces;
}

// The decision the host has already posted and the browser has not yet
// answered. Surfacing it on the baseline screen lets a user who accepts the
// baseline pick in one click instead of two. Same payload GET /api/step
// already returns for this turn — no new data crosses the boundary.
function pendingDecisionModel() {
  if (DRIVE_MODE !== 'adaptive') return null;
  if (!TURN || TURN.phase !== 'await_user' || !TURN.decision) return null;
  if (TURN.generated) return null;   // a generated mockup owns the turn instead
  return {
    categoryId: safeText(TURN.decision.category_id, 100),
    title: safeText(TURN.decision.title, 160),
    description: safeText(TURN.decision.description, 320),
    agentReason: safeText(TURN.agentReason, 320),
    seq: TURN.seq,
    decision: TURN.decision,
  };
}

function sessionModel() {
  if (BOOTSTRAP_ERROR) {
    return { status: 'invalid', bootstrapped: true, route: 'error', error: BOOTSTRAP_ERROR };
  }
  if (!BOOTSTRAP) {
    // A manual (non-bootstrap) walk in progress — from a live session or a
    // resumed one — must not send a reload back through the intro screen:
    // Start there POSTs /api/mode, which wipes the walk (requirement 1 is
    // "every page load", not just the first one). A bare GET /api/init on a
    // fresh adaptive launch already creates TURN + STATE (resetTurn() arms
    // TURN at seq 0, phase 'await_agent') — that must still count as "no
    // walk yet", or every fresh adaptive session skips straight past intro
    // the moment anything polls /api/init. Only a turn the agent has since
    // moved off its initial armed state (posted a decision, or a live
    // history via a completed pick) counts as in progress.
    const walkInProgress = DRIVE_MODE === 'adaptive'
      ? (TURN !== null && (TURN.seq > 0 || TURN.phase !== 'await_agent'))
      : (Array.isArray(STATE?.history) && STATE.history.length > 0);
    // Product paths never cross GET /api/session (see the comment above that
    // route) — the manual 'next-unresolved' shape is the 'intro' shape with
    // only `route` differing; the client re-fetches target/context via
    // GET /api/init when it resumes.
    return { status: 'manual', bootstrapped: false, route: walkInProgress ? 'next-unresolved' : 'intro', mode: MODE, drive: DRIVE_MODE };
  }

  const facts = (BOOTSTRAP.knownFacts || []).map((fact) => {
    const { effective, decided, observed } = effectiveHistory(fact.categoryId);
    return {
      categoryId: safeText(fact.categoryId, 100),
      observedOptionId: safeText(observed?.option_id || fact.optionId, 100),
      currentOptionId: safeText(effective?.option_id || fact.optionId, 100),
      provenance: decided ? 'DECIDED' : String(fact.provenance || '').toUpperCase(),
      status: decided ? 'changed' : 'observed',
      sourceRef: safeSourceRef(fact.sourcePath),
      confidence: typeof fact.confidence === 'number' ? fact.confidence : null,
    };
  });
  const categoryIds = [...new Set((STATE?.history || []).map((entry) => entry.category_id).filter(Boolean))];
  const decisions = categoryIds.map((categoryId) => {
    const { effective, decided } = effectiveHistory(categoryId);
    return {
      categoryId: safeText(categoryId, 100),
      optionId: safeText(effective?.option_id, 100),
      provenance: safeText(effective?.provenance || '', 20),
      status: decided ? 'changed' : (effective?.provenance === 'OBSERVED' ? 'observed' : 'needs-confirmation'),
    };
  });
  let nextDecision = null;
  try {
    const presented = engine(['present'], STATE);
    if (presented?.decision) {
      nextDecision = {
        categoryId: safeText(presented.decision.category_id, 100),
        title: safeText(presented.decision.title, 160),
      };
    }
  } catch (_error) {
    nextDecision = null;
  }
  const baseline = BOOTSTRAP.context?.designBaseline || {};
  return {
    status: BASELINE_REVIEWED ? 'resume' : ((BOOTSTRAP.warnings || []).length ? 'warning' : 'loaded'),
    bootstrapped: true,
    route: BASELINE_REVIEWED ? 'next-unresolved' : 'baseline',
    mode: MODE,
    drive: DRIVE_MODE,
    product: { name: safeText(BOOTSTRAP.product.name, 120) },
    surfaces: projectedSurfaces(),
    designBaseline: {
      seed: safeText(baseline.seed, 240),
      tokenSetId: safeText(baseline.tokenSetId, 120),
      selectedMockupId: safeText(baseline.selectedMockupId, 120),
      rationale: safeText(baseline.rationale, 320),
    },
    requestedDelta: safeText(BOOTSTRAP.context?.requestedDelta, 320),
    facts,
    decisions,
    warnings: (BOOTSTRAP.warnings || []).map((warning) => safeText(warning, 320)),
    nextDecision,
    pendingDecision: pendingDecisionModel(),
  };
}

acquireSessionLock();
initializeBootstrap();
const startupOwner = otherLiveOwner();
if (startupOwner !== null) {
  console.error(`Not starting: the saved walk belongs to running process ${startupOwner}`);
  process.exit(2);
}
restoreSession();
if (!persistSession()) process.exit(2);

// ── HTTP helpers ─────────────────────────────────────────────────────────────
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'self'; frame-ancestors 'none'; object-src 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};
function sendJSON(res, status, obj) {
  if (!persistSession()) {
    res.writeHead(503, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', Connection: 'close' });
    res.end(JSON.stringify({ ok: false, error: 'Designer could not save this walk. Relaunch the server and try again.' }), () => process.exit(2));
    return;
  }
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}
function sendFile(res, file, mime) {
  try {
    const data = fs.readFileSync(file);
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': mime });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0; let failed = false;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        failed = true; chunks.length = 0;
        reject(Object.assign(new Error('Request exceeds 2 MiB'), { status: 413 }));
      } else if (!failed) chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      if (failed) return;
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('Request must contain valid JSON'), { status: 400 })); }
    });
  });
}

// ── Helper: normalize a path (expand leading ~/) ──────────────────────────────
function normalizePath(p) {
  if (!p) return p;
  if (p.startsWith('~/')) {
    const home = process.env.HOME || '';
    p = home + p.slice(1);
  }
  // Resolve relative inputs to an absolute path (Resilience: accept relative
  // paths, echo back an unambiguous normalized form — auditor f2). Relative
  // paths resolve against PLUGIN_ROOT (the server cwd) deterministically.
  if (!path.isAbsolute(p)) {
    p = path.resolve(PLUGIN_ROOT, p);
  }
  // Remove trailing slashes (keep root '/' intact)
  return p.replace(/\/+$/, '') || '/';
}

const BASELINE_SELECTION_MAX_BYTES = 256 * 1024;
const BASELINE_SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024;

function isChildPath(root, candidate) {
  return candidate === root || candidate.startsWith(root + path.sep);
}

function relativeSnapshotPath(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) return null;
  const normalized = value.trim().replaceAll('\\', '/');
  if (path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) return null;
  const safe = path.posix.normalize(normalized);
  if (safe === '..' || safe.startsWith('../') || safe === '.') return null;
  return safe;
}

function selectionEntries(selection) {
  const perScreen = Array.isArray(selection?.perScreen) ? selection.perScreen : [];
  if (perScreen.length) return perScreen;
  const rawSelections = selection?.selections;
  if (Array.isArray(rawSelections)) return rawSelections;
  if (rawSelections && typeof rawSelections === 'object') {
    return Object.keys(rawSelections).sort().map((key) => {
      const value = rawSelections[key];
      return typeof value === 'string' ? { screen_id: key, html_path: value } : { screen_id: key, ...value };
    });
  }
  return [];
}

function selectedBaselineSnapshot() {
  if (!BOOTSTRAP || BOOTSTRAP_ERROR) return { available: false };
  const mockupsRoot = path.join(TARGET, 'mockups');
  const selectionPath = path.join(mockupsRoot, 'selection.json');
  try {
    const mockupsStat = fs.lstatSync(mockupsRoot);
    if (!mockupsStat.isDirectory() || mockupsStat.isSymbolicLink()) return { available: false };
    const selectionStat = fs.lstatSync(selectionPath);
    if (!selectionStat.isFile() || selectionStat.isSymbolicLink() || selectionStat.size > BASELINE_SELECTION_MAX_BYTES) {
      return { available: false };
    }
    const selection = JSON.parse(fs.readFileSync(selectionPath, 'utf8'));
    const selected = selectionEntries(selection).find((item) => relativeSnapshotPath(item?.html_path));
    const relativePath = relativeSnapshotPath(selected?.html_path);
    if (!selected || !relativePath) return { available: false };

    const rootReal = fs.realpathSync(mockupsRoot);
    const candidate = path.resolve(rootReal, relativePath);
    if (!isChildPath(rootReal, candidate)) return { available: false };
    const candidateStat = fs.lstatSync(candidate);
    if (!candidateStat.isFile() || candidateStat.isSymbolicLink() || candidateStat.size > BASELINE_SNAPSHOT_MAX_BYTES) {
      return { available: false };
    }
    const candidateReal = fs.realpathSync(candidate);
    if (!isChildPath(rootReal, candidateReal)) {
      return { available: false };
    }
    return {
      available: true,
      label: safeText(selected.note || selected.mode || selected.screen_id || 'Selected design direction', 160),
      html: fs.readFileSync(candidateReal, 'utf8'),
    };
  } catch (_error) {
    return { available: false };
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  try {
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      return sendFile(res, path.join(STATIC_DIR, 'picker.html'), 'text/html');
    }
    if (req.method === 'GET' && p === '/picker.css') {
      return sendFile(res, path.join(STATIC_DIR, 'picker.css'), 'text/css');
    }
    if (req.method === 'GET' && p === '/picker.js') {
      return sendFile(res, path.join(STATIC_DIR, 'picker.js'), 'application/javascript');
    }
    if (req.method === 'GET' && p === '/picker-bootstrap-view.mjs') {
      return sendFile(res, path.join(STATIC_DIR, 'picker-bootstrap-view.mjs'), 'application/javascript');
    }

    if (p.startsWith('/api/workspace')) {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return sendJSON(res, 403, { ok: false, error: 'Origin not allowed' });
      if (req.method === 'GET' && p === '/api/workspace') return sendJSON(res, 200, { ok: true, ...workspace().read() });
      if (req.method === 'GET' && p === '/api/workspace/export') {
        res.setHeader('Content-Disposition', 'attachment; filename="groundwork-visual-handoff.json"');
        return sendJSON(res, 200, workspace().exportPacket());
      }
      if (req.method === 'POST') {
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) return sendJSON(res, 415, { ok: false, error: 'JSON required' });
        const body = await readBody(req);
        if (p === '/api/workspace/select') { workspace().select(body.id); return sendJSON(res, 200, { ok: true }); }
        if (p === '/api/workspace/source') { const source = workspace().source(body.label, body.kind); return sendJSON(res, 200, { ok: true, source }); }
        if (p === '/api/workspace/review') { const review = workspace().configureReview(body); return sendJSON(res, 200, { ok: true, review }); }
      }
    }

    // ── GET /api/session ─────────────────────────────────────────────────────
    // Safe startup model for the picker. Product paths, running URLs, and raw
    // source contents never cross this boundary.
    if (req.method === 'GET' && p === '/api/session') {
      return sendJSON(res, 200, sessionModel());
    }

    // Return the selected local mockup only when it resolves inside this
    // product's owned mockups directory. The browser renders it in a sandboxed
    // frame after applying the same sanitizer used for generated previews.
    if (req.method === 'GET' && p === '/api/baseline/snapshot') {
      return sendJSON(res, 200, selectedBaselineSnapshot());
    }

    // Baseline review is non-mutating. Continuing only changes the route; the
    // loaded state and adaptive turn remain intact across refreshes.
    if (req.method === 'POST' && p === '/api/baseline/continue') {
      if (!BOOTSTRAP || BOOTSTRAP_ERROR) {
        return sendJSON(res, 409, { ok: false, error: 'No valid app baseline is loaded.' });
      }
      BASELINE_REVIEWED = true;
      return sendJSON(res, 200, { ok: true, route: 'next-unresolved', drive: DRIVE_MODE });
    }

    // Setup changes require two explicit user actions. The first response only
    // describes the impact; confirm unlocks the existing setup form without
    // resetting or rewriting any state.
    if (req.method === 'POST' && p === '/api/baseline/change-setup') {
      if (!BOOTSTRAP || BOOTSTRAP_ERROR) {
        return sendJSON(res, 409, { ok: false, error: 'No valid app baseline is loaded.' });
      }
      const body = await readBody(req);
      if (body.confirm !== true) {
        return sendJSON(res, 200, {
          ok: true,
          confirmationRequired: true,
          message: 'Opening setup keeps this baseline until you confirm a new product or general configuration.',
        });
      }
      SETUP_UNLOCKED = true;
      return sendJSON(res, 200, { ok: true, route: 'setup', reset: false });
    }

    // ── POST /api/mode ────────────────────────────────────────────────────────
    // Set the session mode (general | product). Resets the walk state.
    // Body: { mode, repoPath?, context?, name?, outDir? }
    // Response: { ok, mode, target, context, name }
    if (req.method === 'POST' && p === '/api/mode') {
      const body = await readBody(req);
      if (BOOTSTRAP && (!SETUP_UNLOCKED || body.confirmReset !== true)) {
        return sendJSON(res, 409, {
          ok: false,
          confirmationRequired: true,
          error: 'Confirm Change setup before replacing the loaded app baseline.',
        });
      }
      const requestedMode = (body.mode === 'product') ? 'product' : 'general';

      if (requestedMode === 'product') {
        // Require a valid repoPath
        const raw = body.repoPath || '';
        if (!raw) {
          return sendJSON(res, 400, { ok: false, error: 'repoPath is required for product mode', valid: false });
        }
        const normalized = normalizePath(raw);
        let stat;
        try {
          stat = fs.statSync(normalized);
        } catch {
          return sendJSON(res, 400, { ok: false, error: 'path not found', valid: false });
        }
        if (!stat.isDirectory()) {
          return sendJSON(res, 400, { ok: false, error: 'not a directory', valid: false });
        }
        const ownedOutput = path.join(normalized, '.designdoc');
        if (body.outDir && normalizePath(body.outDir) !== ownedOutput) {
          return sendJSON(res, 400, {
            ok: false,
            error: 'product output must use the repository .designdoc directory',
            valid: false,
          });
        }
        // Valid — update session state
        MODE = 'product';
        PRODUCT_ROOT = normalized;
        TARGET = ownedOutput;
        SESSION_CONTEXT = body.context || '';
        SESSION_NAME = body.name || path.basename(normalized);
      } else {
        // general mode — no product context
        MODE = 'general';
        PRODUCT_ROOT = null;
        SESSION_CONTEXT = '';
        // Honor explicit --out flag; otherwise use scratch default
        if (body.outDir) {
          TARGET = normalizePath(body.outDir);
        } else if (OUT_EXPLICIT) {
          TARGET = OUT;
        } else {
          TARGET = SCRATCH_OUT;
        }
        SESSION_NAME = body.name || 'design-system';
      }

      // A mode change resets the walk so the next /api/init boots fresh.
      // Also reset adaptive turn state so a fresh walk re-arms correctly.
      STATE = null;
      EXTRACTION = null;
      TURN = null;
      IMPORTED = false;

      BASELINE_REVIEWED = true;
      BOOTSTRAP = null;
      SETUP_UNLOCKED = false;

      // Optional drive override in the same request.
      if (body.drive === 'adaptive') {
        DRIVE_MODE = 'adaptive';
        resetTurn();
      } else if (body.drive === 'standard') {
        DRIVE_MODE = 'standard';
        TURN = null;
      }

      return sendJSON(res, 200, {
        ok: true,
        mode: MODE,
        target: TARGET,
        repoPath: PRODUCT_ROOT,
        context: SESSION_CONTEXT,
        name: SESSION_NAME,
        drive: DRIVE_MODE,
      });
    }

    // ── POST /api/validate-path ───────────────────────────────────────────────
    // Body: { path }
    // Response: { valid, normalized, isDir?, error? } — always 200; never 500.
    if (req.method === 'POST' && p === '/api/validate-path') {
      const body = await readBody(req);
      const raw = body.path || '';
      const normalized = normalizePath(raw);
      try {
        const stat = fs.statSync(normalized);
        if (stat.isDirectory()) {
          return sendJSON(res, 200, { valid: true, normalized, isDir: true });
        } else {
          return sendJSON(res, 200, { valid: false, normalized, isDir: false, error: 'not a directory' });
        }
      } catch {
        return sendJSON(res, 200, { valid: false, normalized, error: 'path not found' });
      }
    }

    // ── GET /api/init ─────────────────────────────────────────────────────────
    // Boot or resume the walk from the current SESSION_CONTEXT.
    // Uses `present` (NON-mutating) so no pick is recorded before the user picks.
    // Response includes mode and target so the picker can populate the header.
    if (req.method === 'GET' && p === '/api/init') {
      if (BOOTSTRAP_ERROR) {
        return sendJSON(res, 409, { error: BOOTSTRAP_ERROR.message, session: sessionModel() });
      }
      // STATE only, never `!BOOTSTRAP || !STATE`: a manual (non-bootstrap)
      // session already has a live STATE on a page reload or a resumed
      // server, and re-initializing here would silently wipe its history —
      // every OTHER caller of this branch either follows POST /api/mode
      // (which sets STATE = null itself) or runs after
      // /api/confirm-extraction has already set STATE.
      if (!STATE) STATE = engine(['init', '--context', SESSION_CONTEXT]).state;
      const step = engine(['present'], STATE);
      STATE = step.state;
      // Arm adaptive TURN only when absent; refresh must preserve its seq/phase.
      if (DRIVE_MODE === 'adaptive' && !TURN) resetTurn();
      // Optionally surface tier at top level for picker convenience
      const tier = (step.decision && step.decision.ordering_tier_label) || '';
      return sendJSON(res, 200, {
        context: SESSION_CONTEXT,
        out: TARGET,
        name: SESSION_NAME,
        mode: MODE,
        target: TARGET,
        repoPath: PRODUCT_ROOT,
        drive: DRIVE_MODE,
        session: sessionModel(),
        step: { ...step, tier },
      });
    }

    // ── GET /api/step ─────────────────────────────────────────────────────────
    // Surface the next decision + previews WITHOUT recording a pick (`present`).
    // In adaptive mode: long-polls until the agent has chosen a decision for the
    // user to see (TURN.phase === 'await_user'), then returns that decision.
    if (req.method === 'GET' && p === '/api/step') {
      if (!STATE) STATE = engine(['init', '--context', SESSION_CONTEXT]).state;

      if (DRIVE_MODE === 'adaptive') {
        // 1. Walk done already.
        if (TURN && TURN.phase === 'done') {
          return sendJSON(res, 200, { action: 'done', reason: 'Walk complete.', drive: DRIVE_MODE });
        }

        // 2. A decision (or generated mockup) is already posted and waiting on
        // the user — return it immediately. No sleep, no heartbeat check: a
        // decision the host posted before a restart, or without ever polling
        // /api/agent/contract again, must still be visible and answerable.
        if (TURN && TURN.phase === 'await_user') {
          return sendJSON(res, 200, awaitUserStepPayload());
        }

        // 3. Otherwise (await_agent, or no TURN yet). If no host has attached
        // within the agent window, surface a notice — this gates the notice
        // only, never a decision already posted (handled in step 2 above).
        if (!agentAttached()) {
          return sendJSON(res, 200, {
            action: 'await_agent',
            noAgent: true,
            message: 'No agent attached — launch via /designer --adaptive',
            drive: DRIVE_MODE,
            agentWindowSeconds: AGENT_WINDOW_SECONDS,
          });
        }

        // 4. Long-poll up to ~25 s (100 × 250 ms), re-checking done/await_user
        // on every tick via the same helpers used above.
        for (let i = 0; i < 100; i++) {
          await new Promise((r) => setTimeout(r, 250));
          if (TURN && TURN.phase === 'done') {
            return sendJSON(res, 200, { action: 'done', reason: 'Walk complete.', drive: DRIVE_MODE });
          }
          if (TURN && TURN.phase === 'await_user') {
            return sendJSON(res, 200, awaitUserStepPayload());
          }
        }

        // 5. Timed out still waiting for agent — let browser re-poll.
        return sendJSON(res, 200, {
          action: 'await_agent',
          waiting: true,
          message: 'Agent is choosing the next decision…',
          drive: DRIVE_MODE,
        });
      }

      // ── Standard mode (unchanged) ──────────────────────────────────────────
      const step = engine(['present'], STATE);
      STATE = step.state;
      const tier = (step.decision && step.decision.ordering_tier_label) || '';
      return sendJSON(res, 200, { ...step, tier, drive: DRIVE_MODE });
    }

    // ── POST /api/pick ────────────────────────────────────────────────────────
    // Record the user's real pick.
    // Standard: also surfaces the next decision via `present`.
    // Adaptive: records the pick, flips TURN back to await_agent so the agent
    //           picks the next decision (agent re-polls /api/agent/contract).
    if (req.method === 'POST' && p === '/api/pick') {
      const body = await readBody(req);

      // Stale-turn guard: a client that picked against an outdated contract
      // would otherwise re-merge a delta over an already-determined dimension
      // (state.apply_pick re-merges + appends duplicate history). If the client
      // sent a seq and it no longer matches the live turn, reject so it
      // re-reads the current contract before mutating.
      if (DRIVE_MODE === 'adaptive' && body.seq !== undefined && TURN && body.seq !== TURN.seq) {
        return sendJSON(res, 200, { ok: false, stale: true, seq: TURN.seq });
      }

      // Answering the pending decision from the baseline screen IS continuing
      // past the baseline; a reload must not send the user back to it. Only that
      // exact pick may set the flag — it is named for what the user saw, so a
      // pick for any other category, from another tab or process, must leave the
      // review standing.
      const pendingBaselineDecision = pendingDecisionModel();
      const answeringBaseline = !BASELINE_REVIEWED
        && pendingBaselineDecision !== null
        && body.category === pendingBaselineDecision.categoryId;

      const picked = engine(['pick', '--category', body.category, '--option', body.option], STATE);
      if (picked.error) return sendJSON(res, 400, { error: picked.error });
      STATE = picked.state;
      if (answeringBaseline) BASELINE_REVIEWED = true;

      if (DRIVE_MODE === 'adaptive') {
        // Null-guard TURN before mutating — consistent with armAdaptive()'s
        // guard. An adaptive pick can arrive on a fresh process whose TURN was
        // never armed (or was nulled by a mode flip); resetTurn() restores a
        // live await_agent token rather than dereferencing null.
        if (!TURN) resetTurn();
        // Hand turn back to the agent to choose the next decision.
        TURN.phase = 'await_agent';
        TURN.decision = null;
        TURN.generated = null;  // CB2: clear any pending generated mockup on pick
        TURN.seq += 1;
        ocDecisions.resolved();
        return sendJSON(res, 200, { picked: picked.picked, phase: 'await_agent', adaptive: true });
      }

      // ── Standard mode (unchanged) ──────────────────────────────────────────
      const step = engine(['present'], STATE);
      STATE = step.state;
      const tier = (step.decision && step.decision.ordering_tier_label) || '';
      return sendJSON(res, 200, { picked: picked.picked, step: { ...step, tier } });
    }

    // ── GET /api/agent/contract ───────────────────────────────────────────────
    // The host agent's READ side. Long-polls until it's the agent's turn
    // (TURN.phase === 'await_agent'), then returns the contract for the current
    // state. Calling this auto-arms adaptive mode.
    // Response: { phase, seq?, contract?, done?, waiting?, adaptive? }
    if (req.method === 'GET' && p === '/api/agent/contract') {
      // Mark agent as present and arm adaptive mode.
      AGENT_SEEN_AT = Date.now();
      armAdaptive();

      // Ensure we have a live state to build a contract from.
      if (!STATE) {
        STATE = engine(['init', '--context', SESSION_CONTEXT]).state;
      }

      // Walk already done.
      if (TURN.phase === 'done') {
        return sendJSON(res, 200, { phase: 'done', done: true });
      }

      // Long-poll up to ~25 s (100 × 250 ms) waiting for TURN.phase to become
      // 'await_agent'. While 'await_user', the user is picking — agent waits.
      for (let i = 0; i < 100; i++) {
        if (TURN.phase === 'await_agent') break;
        if (TURN.phase === 'done') {
          return sendJSON(res, 200, { phase: 'done', done: true });
        }
        await new Promise((r) => setTimeout(r, 250));
      }

      // Timed out still waiting on user pick — agent re-polls later.
      if (TURN.phase !== 'await_agent') {
        return sendJSON(res, 200, { phase: TURN.phase, seq: TURN.seq, waiting: true });
      }

      // It's the agent's turn. Ask the CLI for the contract for this state.
      // `next-step` with no --answer returns {action:'PENDING_HOST', contract, state}.
      const out = engine(['next-step'], STATE);
      TURN.contract = out.contract || null;
      if (out.state) STATE = out.state;

      const saved = workspace().read();
      TURN.contract = TURN.contract || {};
      TURN.contract.workspace = { sources: saved.sources, selected: saved.alternatives.find(a => a.id === saved.selectedId) || null };
      const pending = saved.notes.filter(note => note.status === 'received');
      TURN.deliveredIds = pending.map(note => note.id);
      if (pending.length) {
        TURN.contract = TURN.contract || {};
        TURN.contract.pending_chats = pending;
        // Existing hosts consume pending_chat.text; deliver the full batch there too.
        TURN.contract.pending_chat = {
          text: pending.map(note => note.text).join('\n\n'),
          ids: TURN.deliveredIds,
          seq: TURN.seq,
          review: pending.at(-1)?.review || saved.review,
        };
      }

      return sendJSON(res, 200, {
        phase: 'await_agent',
        seq: TURN.seq,
        contract: TURN.contract,
      });
    }

    // ── POST /api/agent/answer ────────────────────────────────────────────────
    // The host agent's WRITE side. Body = filled contract dict with an `answer`
    // block: { action: 'ask'|'infer'|'done', chosen_category_id, rationale,
    //          option_hints? }
    // The server writes the answer to a temp file and invokes the CLI.
    if (req.method === 'POST' && p === '/api/agent/answer') {
      // Answering counts as host activity, same as the contract GET — an
      // agent that only ever posts answers (never re-polls the contract)
      // must not fall outside the attachment window.
      AGENT_SEEN_AT = Date.now();
      const body = await readBody(req);

      // Stale-turn guard: if the agent answers against a contract whose seq has
      // since advanced (e.g. a duplicate/late delivery), reject before invoking
      // the engine — otherwise an "infer" re-merges a delta over an
      // already-determined dimension and "ask" appends duplicate history. The
      // agent then re-reads the live contract via GET /api/agent/contract.
      if (body.seq !== undefined && TURN && body.seq !== TURN.seq) {
        return sendJSON(res, 200, { ok: false, stale: true, seq: TURN.seq });
      }

      // Write answer to a per-process scratch file; engine() writes STATE there
      // and appends --state <tmp> automatically when stateObj is given. STATE
      // itself reaches STATE_FILE via persistSession(), not this scratch file.
      const ansFile = scratchFile('answer.json');
      fs.writeFileSync(ansFile, JSON.stringify(body));

      const r = engine(['next-step', '--answer', ansFile], STATE);

      if (r.error) {
        // Invalid answer — agent re-reads contract and tries again.
        return sendJSON(res, 200, { ok: false, error: r.error });
      }

      if (['rehighlight', 'generate', 'ask', 'infer', 'done'].includes(r.action)) {
        if (r.action === 'generate') workspace().addAlternative(r.mockup, body.answer?.rationale || '');
        if (body.seq === TURN.seq && TURN.deliveredIds?.length) workspace().acknowledge(TURN.deliveredIds);
        TURN.deliveredIds = [];
      }

      // CB2: rehighlight — agent wants to highlight options without requiring a pick.
      // Engine returns r.action==='rehighlight' and optionally r.category (or null).
      // We apply option_hints from the answer in JS (mirrors _apply_option_hints).
      if (r.action === 'rehighlight') {
        if (r.state) STATE = r.state;
        // Apply option_hints from the answer onto the current TURN.decision.
        // If TURN.decision is null (shouldn't normally happen), keep it null.
        const optionHints = (body.answer && body.answer.option_hints) || [];
        if (TURN.decision && optionHints.length > 0) {
          const hintMap = {};
          for (const hint of optionHints) {
            if (hint.option_id) hintMap[hint.option_id] = hint;
          }
          for (const opt of (TURN.decision.options || [])) {
            const hint = hintMap[opt.id];
            if (hint) {
              if (hint.highlight !== undefined) opt.highlight = hint.highlight;
              if (hint.annotate !== undefined) opt.annotate = hint.annotate;
            }
          }
        }
        TURN.phase = 'await_user';
        TURN.seq += 1;
        ocDecisions.awaitingUser(TURN);
        return sendJSON(res, 200, { ok: true, action: 'rehighlight', phase: 'await_user', seq: TURN.seq });
      }

      // CB2: generate — agent produced an HTML mockup.
      if (r.action === 'generate') {
        // If the engine flagged a structural error in the mockup, reject for agent retry.
        if (r.error) {
          return sendJSON(res, 200, { ok: false, error: r.error });
        }
        if (r.state) STATE = r.state;
        TURN.generated = {
          mockup: r.mockup,
          agent_reason: (body.answer && body.answer.rationale) || '',
        };
        TURN.phase = 'await_user';
        TURN.seq += 1;
        ocDecisions.awaitingUser(TURN);
        return sendJSON(res, 200, { ok: true, action: 'generate', phase: 'await_user', seq: TURN.seq });
      }

      if (r.action === 'ask') {
        // Agent picked a decision to present to the user.
        TURN.decision = r.decision;
        TURN.agentReason = r.agent_reason || '';
        TURN.phase = 'await_user';
        TURN.seq += 1;
        ocDecisions.awaitingUser(TURN);
        if (r.state) STATE = r.state;
        return sendJSON(res, 200, { ok: true, action: 'ask', phase: 'await_user', seq: TURN.seq });
      }

      if (r.action === 'infer') {
        // Engine auto-applied the inferred pick; loop straight back to agent.
        // Bump seq: infer MUTATES state (records an inferred pick), so a
        // duplicate/late re-delivery of this same answer must be caught by the
        // stale guard — otherwise it re-merges the inferred delta at the same
        // seq. Every state-mutating answer advances seq monotonically.
        if (r.state) STATE = r.state;
        TURN.phase = 'await_agent';
        TURN.seq += 1;
        return sendJSON(res, 200, { ok: true, action: 'infer', phase: 'await_agent', seq: TURN.seq, inferred: r.inferred });
      }

      if (r.action === 'done') {
        // Walk complete. Bump seq so a replayed answer can't re-enter a
        // finalized turn.
        if (r.state) STATE = r.state;
        TURN.phase = 'done';
        TURN.decision = null;
        TURN.seq += 1;
        ocDecisions.resolved();
        return sendJSON(res, 200, { ok: true, action: 'done', phase: 'done', seq: TURN.seq });
      }

      // Unexpected action — surface raw for debugging.
      return sendJSON(res, 200, { ok: false, error: 'unexpected action: ' + r.action, raw: r });
    }

    // ── GET /api/current ──────────────────────────────────────────────────────
    // Live preview of the current design across platforms.
    if (req.method === 'GET' && p === '/api/current') {
      if (!STATE) STATE = engine(['init', '--context', SESSION_CONTEXT]).state;
      return sendJSON(res, 200, engine(['current'], STATE));
    }

    // ── GET /api/design-md ────────────────────────────────────────────────────
    // The live DESIGN.md text (no write).
    if (req.method === 'GET' && p === '/api/design-md') {
      if (!STATE) STATE = engine(['init', '--context', SESSION_CONTEXT]).state;
      const args = ['preview-md'];
      if (SESSION_NAME) args.push('--name', SESSION_NAME);
      return sendJSON(res, 200, engine(args, STATE));
    }

    // ── POST /api/emit ────────────────────────────────────────────────────────
    // Finalize: write design-tokens.md inside the owned Groundwork directory.
    // Lazily create the scratch dir if using generic mode.
    if (req.method === 'POST' && p === '/api/emit') {
      if (!OUT_EXPLICIT && MODE === 'general') {
        fs.mkdirSync(TARGET, { recursive: true });
      }
      const args = ['emit', '--out', designTokensPath()];
      if (SESSION_NAME) args.push('--name', SESSION_NAME);
      const out = engine(args, STATE);
      return sendJSON(res, 200, out);
    }

    // ── POST /api/extract ─────────────────────────────────────────────────────
    // Extract design signals from a served app URL. Stores result in EXTRACTION.
    // Body: { url?: string }
    // Response: always 200 — { available, summary, warnings, reason } or
    //           { available:false, degraded:true, warning } on error.
    if (req.method === 'POST' && p === '/api/extract') {
      try {
        const body = await readBody(req);
        const url = body.url || null;

        // Run extraction: url takes precedence; fall back to repo (degrades gracefully).
        let result;
        if (url) {
          result = engine(['extract', '--url', url]);
        } else {
          result = engine(['extract', '--repo', PRODUCT_ROOT || TARGET]);
        }

        const extraction = result.extraction || { available: false, reason: 'no extraction result', signals: null, warnings: [] };
        EXTRACTION = extraction;

        // If signals are present, run auto-seed-preview WITHOUT mutating STATE.
        let summary = null;
        if (extraction.available && extraction.signals) {
          const tmpSignals = scratchFile('extraction.json');
          fs.writeFileSync(tmpSignals, JSON.stringify(extraction.signals));
          try {
            // Pass an empty state object so STATE is not mutated (preview only).
            const preview = engine(['seed-apply', '--auto', '--signals', tmpSignals], {});
            summary = preview.summary || null;
          } catch (_e) {
            // Summary preview failure is non-fatal; walk still starts.
            summary = null;
          }
          if (summary) EXTRACTION.summary = summary;
        }

        return sendJSON(res, 200, {
          available: extraction.available || false,
          summary: summary,
          warnings: extraction.warnings || [],
          reason: extraction.reason || null,
        });
      } catch (err) {
        // Graceful degradation — NEVER 500 the walk.
        EXTRACTION = null;
        return sendJSON(res, 200, {
          available: false,
          degraded: true,
          warning: 'extraction failed: ' + String(err && err.message || err),
        });
      }
    }

    // ── POST /api/confirm-extraction ──────────────────────────────────────────
    // Seeds the REAL walk state from stored EXTRACTION, then starts the walk.
    // No body required.
    // Response: { seeded, summary?, step, target?, tier?, degraded?, warning? }
    if (req.method === 'POST' && p === '/api/confirm-extraction') {
      try {
        if (!EXTRACTION || !EXTRACTION.available || !EXTRACTION.signals) {
          // Degraded / skip path — behave like /api/init (fresh description-only walk).
          STATE = engine(['init', '--context', SESSION_CONTEXT]).state;
          const step = engine(['present'], STATE);
          STATE = step.state;
          const tier = (step.decision && step.decision.ordering_tier_label) || '';
          return sendJSON(res, 200, { seeded: false, step: { ...step, tier }, degraded: true });
        }

        // Seeded path: boot a fresh state, then auto-seed from signals.
        STATE = engine(['init', '--context', SESSION_CONTEXT]).state;
        const tmpSignals = scratchFile('extraction.json');
        fs.writeFileSync(tmpSignals, JSON.stringify(EXTRACTION.signals));
        const seeded = engine(['seed-apply', '--auto', '--signals', tmpSignals], STATE);
        STATE = seeded.state;
        // Collect extracted picks for the review surface BEFORE advancing to the walk.
        let extractedList = [];
        try {
          const extractedResult = engine(['extracted'], STATE);
          extractedList = extractedResult.extracted || [];
        } catch (_e) {
          // Non-fatal: review surface degrades to empty — walk still starts.
          extractedList = [];
        }
        const step = engine(['present'], STATE);
        STATE = step.state;
        const tier = (step.decision && step.decision.ordering_tier_label) || '';

        return sendJSON(res, 200, {
          seeded: true,
          summary: seeded.summary || null,
          extracted: extractedList,
          step: { ...step, tier },
          target: TARGET,
        });
      } catch (err) {
        // Graceful degradation — walk ALWAYS starts.
        try {
          STATE = engine(['init', '--context', SESSION_CONTEXT]).state;
          const step = engine(['present'], STATE);
          STATE = step.state;
          const tier = (step.decision && step.decision.ordering_tier_label) || '';
          return sendJSON(res, 200, {
            seeded: false,
            degraded: true,
            warning: 'seed failed: ' + String(err && err.message || err),
            step: { ...step, tier },
          });
        } catch (fallbackErr) {
          // Even init failed — return a safe shell so the caller can show an error.
          STATE = null;
          return sendJSON(res, 200, {
            seeded: false,
            degraded: true,
            warning: 'init failed: ' + String(fallbackErr && fallbackErr.message || fallbackErr),
          });
        }
      }
    }

    // ── GET /api/extracted ────────────────────────────────────────────────────
    // Returns the current extracted (source=="extract") picks with full decision
    // payloads. The picker calls this after an override to refresh the review list.
    if (req.method === 'GET' && p === '/api/extracted') {
      if (!STATE) return sendJSON(res, 200, { extracted: [] });
      try {
        return sendJSON(res, 200, engine(['extracted'], STATE));
      } catch (err) {
        return sendJSON(res, 200, { extracted: [], error: String(err && err.message || err) });
      }
    }

    // ── POST /api/chat ────────────────────────────────────────────────────────
    // CB2: adaptive-only chat entry point. Queues a pending_chat for delivery
    // on the agent's next /api/agent/contract poll.
    // Body: { text }
    // Response: { ok, phase?, seq?, reason? }
    if (req.method === 'POST' && p === '/api/chat') {
      const body = await readBody(req);
      if (DRIVE_MODE !== 'adaptive') {
        return sendJSON(res, 200, { ok: false, reason: 'enable-adaptive' });
      }
      if (typeof body.text !== 'string') {
        return sendJSON(res, 400, { ok: false, reason: 'invalid-text' });
      }
      const text = body.text.trim();
      if (!text) {
        return sendJSON(res, 400, { ok: false, reason: 'empty-text' });
      }
      if (text.length > 4000) {
        return sendJSON(res, 400, { ok: false, reason: 'text-too-long' });
      }
      if (!TURN) resetTurn();
      const receipt = workspace().enqueue(text, body.id, body.review);
      if (receipt.duplicate) return sendJSON(res, 200, { ok: true, receipt, phase: TURN.phase, seq: TURN.seq });
      TURN.phase = 'await_agent';
      TURN.decision = null;
      TURN.generated = null;
      TURN.seq += 1;
      return sendJSON(res, 200, { ok: true, receipt, phase: 'await_agent', seq: TURN.seq });
    }

    // ── POST /api/chat/accept ─────────────────────────────────────────────────
    // CB2: accept the pending generated mockup by applying its token_deltas.
    // Body: { label? }
    if (req.method === 'POST' && p === '/api/chat/accept') {
      const body = await readBody(req);
      if (DRIVE_MODE !== 'adaptive') {
        return sendJSON(res, 200, { ok: false, reason: 'enable-adaptive' });
      }
      if (!TURN || !TURN.generated) {
        return sendJSON(res, 200, { ok: false, reason: 'no generated mockup to accept' });
      }
      const gen = TURN.generated;
      const tokenDeltas = gen.mockup && gen.mockup.token_deltas;
      if (!tokenDeltas || Object.keys(tokenDeltas).length === 0) {
        // Mockup had no token deltas — reference only; flip back to await_agent.
        TURN.generated = null;
        TURN.phase = 'await_agent';
        TURN.decision = null;
        TURN.seq += 1;
        return sendJSON(res, 200, {
          ok: true,
          applied: {},
          note: 'mockup had no token deltas (reference only)',
          phase: 'await_agent',
          seq: TURN.seq,
        });
      }
      // Write deltas to temp file and apply via engine.
      const tmpDeltas = scratchFile('deltas.json');
      fs.writeFileSync(tmpDeltas, JSON.stringify(tokenDeltas));
      const label = body.label || gen.mockup.label || 'mockup';
      const result = engine(['accept-deltas', '--deltas', tmpDeltas, '--label', label], STATE);
      STATE = result.state || STATE;
      TURN.generated = null;
      TURN.phase = 'await_agent';
      TURN.decision = null;
      TURN.seq += 1;
      return sendJSON(res, 200, {
        ok: true,
        applied: result.applied || {},
        dropped: result.dropped || {},
        warning: result.warning || null,
        phase: 'await_agent',
        seq: TURN.seq,
      });
    }

    // ── POST /api/draft/save ──────────────────────────────────────────────────
    // P2C: Save the current walk state as a named draft.
    // Body: { productOverride? }
    // Response: { ok, draft_id, has_delta, saved:{path,bytes,...} }
    if (req.method === 'POST' && p === '/api/draft/save') {
      const body = await readBody(req);
      const product = body.productOverride || SESSION_NAME || 'design-system';
      const source = EXTRACTION ? 'extract' : (IMPORTED ? 'import' : 'draft');
      const result = engine(['draft-save', '--product', product, '--source', source], STATE);
      return sendJSON(res, 200, { ok: true, ...result });
    }

    // ── GET /api/draft/list ───────────────────────────────────────────────────
    // P2C: List saved drafts. Optional ?product= query param.
    // Response: { drafts: [...] }
    if (req.method === 'GET' && p === '/api/draft/list') {
      const product = url.searchParams.get('product') || null;
      const args = ['draft-list', ...(product ? ['--product', product] : [])];
      const result = engine(args, null);
      return sendJSON(res, 200, { drafts: result.drafts || [] });
    }

    // ── POST /api/draft/resume ────────────────────────────────────────────────
    // P2C: Resume a previously saved draft.
    // Body: { product, draftId }
    // Response: { ok, draft, extracted? } or { ok:false, error }
    if (req.method === 'POST' && p === '/api/draft/resume') {
      const body = await readBody(req);
      const result = engine(['draft-resume', '--product', body.product, '--draft-id', body.draftId], null);
      if (result.error) {
        return sendJSON(res, 200, { ok: false, error: result.error });
      }
      STATE = result.state || STATE;
      if (DRIVE_MODE === 'adaptive' && TURN) resetTurn();
      // Fetch the review surface (CVA extracted list) for the resumed state.
      let extracted = [];
      try {
        const extractedResult = engine(['extracted'], STATE);
        extracted = extractedResult.extracted || [];
      } catch (_e) {
        // Non-fatal: review surface degrades to empty.
        extracted = [];
      }
      return sendJSON(res, 200, { ok: true, draft: result.draft, extracted });
    }

    // ── POST /api/draft/promote ───────────────────────────────────────────────
    // P2C: Promote the current walk state to design-tokens.md in the owned output.
    // Body: { name?, version? }
    // Response: { ok, path, bytes, version, prior_version, is_git, backed_up, warning? }
    if (req.method === 'POST' && p === '/api/draft/promote') {
      const body = await readBody(req);
      const name = body.name || SESSION_NAME;
      const args = [
        'draft-promote',
        '--out', designTokensPath(),
        '--name', name,
        '--product', SESSION_NAME,
        ...(body.version ? ['--version', body.version] : []),
      ];
      const result = engine(args, STATE);
      return sendJSON(res, 200, { ok: true, ...(result.promoted || result) });
    }

    // ── GET /api/version/history ──────────────────────────────────────────────
    // Read-only: surface the current DESIGN.md frontmatter version + whether a
    // .bak exists. NO git commands — server never runs git.
    // Response: { ok, current, hasBak, isGit, note }
    if (req.method === 'GET' && p === '/api/version/history') {
      const designMdPath = designTokensPath();
      const bakPath = designMdPath + '.bak';
      let current = null;
      let hasBak = false;
      let isGit = false;

      // Read current version from DESIGN.md frontmatter if present.
      try {
        const text = fs.readFileSync(designMdPath, 'utf8');
        const match = text.match(/^version:\s*(.+)$/m);
        if (match) current = match[1].trim();
      } catch (_e) {
        // DESIGN.md not yet emitted — current stays null.
      }

      // Check for .bak (prior version backup from promote).
      try {
        fs.statSync(bakPath);
        hasBak = true;
      } catch (_e) {
        hasBak = false;
      }

      // Pure filesystem check for git: walk up from TARGET looking for a .git dir.
      // NO git command is executed.
      {
        let dir = TARGET;
        for (let depth = 0; depth < 12; depth++) {
          try {
            fs.statSync(path.join(dir, '.git'));
            isGit = true;
            break;
          } catch (_e) {
            // not here
          }
          const parent = path.dirname(dir);
          if (parent === dir) break;  // reached filesystem root
          dir = parent;
        }
      }

      const note = isGit
        ? 'full version history is in the product repo git log'
        : 'repo is not git-tracked; only the current version and a .bak are available';

      return sendJSON(res, 200, { ok: true, current, hasBak, isGit, note });
    }

    // ── POST /api/import-design ───────────────────────────────────────────────
    // P3B: Import an existing DESIGN.md into the current session (product mode).
    // Body: { path }
    // Response: { ok, summary, skipped, seeded, doc_name, doc_version, extracted, target }
    //           or { ok:false, error }
    if (req.method === 'POST' && p === '/api/import-design') {
      try {
        const body = await readBody(req);
        const rawPath = body.path || '';
        if (!rawPath) {
          return sendJSON(res, 200, { ok: false, error: 'path is required' });
        }
        const normalizedPath = normalizePath(rawPath);
        // Verify the file exists before calling the engine.
        try {
          fs.statSync(normalizedPath);
        } catch (_e) {
          return sendJSON(res, 200, { ok: false, error: 'file not found' });
        }
        // Boot a fresh state, then import the DESIGN.md.
        STATE = engine(['init', '--context', SESSION_CONTEXT]).state;
        const importResult = engine(['import-design', '--file', normalizedPath], STATE);
        STATE = importResult.state || STATE;
        IMPORTED = true;
        // Fetch the review surface (extracted/CVA list) for the imported state.
        let extracted = [];
        try {
          const extractedResult = engine(['extracted'], STATE);
          extracted = extractedResult.extracted || [];
        } catch (_e) {
          extracted = [];
        }
        return sendJSON(res, 200, {
          ok: true,
          summary: importResult.summary || null,
          skipped: importResult.skipped || [],
          seeded: importResult.seeded || {},
          // NO-SILENT-EMPTY: a 0-map import must be loud, not a silent seed.
          // The client uses `available` + `mapped` + `warning` to tell the
          // user their file's format wasn't recognized.
          mapped: typeof importResult.mapped === 'number' ? importResult.mapped : 0,
          available: importResult.available !== false,
          warning: importResult.warning || null,
          doc_name: importResult.doc_name || null,
          doc_version: importResult.doc_version || null,
          extracted,
          target: TARGET,
        });
      } catch (err) {
        // Graceful — never 500.
        return sendJSON(res, 200, { ok: false, error: String(err && err.message || err) });
      }
    }

    res.writeHead(404); res.end('not found');
  } catch (err) {
    sendJSON(res, err.status || 500, { error: String(err && err.message || err) });
  }
});

// Bind loopback only (auditor f1): this is a single-user local tool. The
// /api/validate-path filesystem-existence oracle and the /api/mode emit-target
// redirect must not be reachable from the LAN. 127.0.0.1 removes the entire
// remote surface at the root (attack-over-defense) with no functional loss.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`UI Guidance designer running at http://localhost:${server.address().port}`);
  console.log(`  mode: ${MODE}`);
  console.log(`  context: ${SESSION_CONTEXT || '(none — generic mode)'}`);
  console.log(`  emit target: ${TARGET}`);
  // A hung event loop must exit non-zero so a supervisor can restart it,
  // rather than hang silently forever (see event-loop-watchdog.mjs).
  const watchdog = startEventLoopWatchdog({ thresholdSeconds: WATCHDOG_SECONDS });
  console.log(watchdog.enabled ? `  watchdog: ${watchdog.thresholdSeconds}s` : '  watchdog: off');
});
