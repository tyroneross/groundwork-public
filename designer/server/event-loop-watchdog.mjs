// event-loop-watchdog.mjs — kills this process with a non-zero exit status if
// the Node event loop stalls for longer than a threshold, so an external
// supervisor (designer/server/run-supervised.sh) can restart it. IBR extract
// and other synchronous engine calls can block spawnSync for a while, so the
// default threshold is generous (300s) — this exists for the case where the
// loop never comes back at all.
//
// Mechanism: the main thread ticks a `beat` counter into a SharedArrayBuffer
// on its own timer; a worker thread reads that counter on ITS OWN timer and
// tracks whether it changed since the worker's last tick. The worker runs on
// its own thread, so it keeps ticking even while the main thread is fully
// blocked. A blocked main thread cannot run process.exit() or its own exit
// handlers; sending a signal is what actually ends the process with a
// non-zero status while the main loop is blocked.
//
// Real guard against a false kill on sleep/resume: `process.hrtime.bigint()`
// keeps advancing across macOS system sleep (it is NOT paused the way the
// wall clock effectively is), so a naive "time since the last recorded
// heartbeat" check sees one huge gap on wake and looks exactly like a
// multi-minute stall — killing a perfectly healthy server. `advanceStall()`
// below avoids that by never trusting a single elapsed-time reading: a
// changed `beat` proves the main thread made progress since the worker's
// last tick and resets the accumulated stall to zero, and an UNCHANGED beat
// accrues at most `2*tickMs` of stall per worker tick regardless of how large
// the raw hrtime delta is. A genuinely blocked main thread still crosses the
// threshold in roughly `thresholdSeconds` (the worker keeps ticking at
// `tickMs` and accrues close to `tickMs` of real stall each tick), but a long
// single gap — sleep, a GC pause, or a missed worker timer — can only ever
// contribute a bounded slice.

import { Worker } from 'worker_threads';

function clamp(n, lo, hi) {
  return Math.min(Math.max(n, lo), hi);
}

// Pure function, exported so unit tests exercise exactly the same math the
// worker runs (embedded into the worker source below via `.toString()`).
// prev: { lastBeat, lastTickNs, stalledMs }
// next input: { nowNs: bigint, beat: number, tickMs: number }
export function advanceStall(prev, { nowNs, beat, tickMs }) {
  let stalledMs = prev.stalledMs;
  if (beat !== prev.lastBeat) {
    // The main thread ticked its beat counter at least once since our last
    // check — it made progress, so any accrued stall no longer applies.
    stalledMs = 0;
  } else {
    const elapsedMs = Number(nowNs - prev.lastTickNs) / 1e6;
    stalledMs += Math.min(elapsedMs, 2 * tickMs);
  }
  return { lastBeat: beat, lastTickNs: nowNs, stalledMs };
}

// Worker source, run via `eval: true` in its own thread. Self-contained
// (only `require`s worker_threads/fs, both stdlib) so `execArgv: []` — no
// flags inherited from the host process — still works. advanceStall is
// embedded verbatim (it's pure — no closures) so worker and tests share code.
const WORKER_SOURCE = [
  "const { workerData } = require('worker_threads');",
  "const fs = require('fs');",
  "const { beatBuffer, thresholdMs, tickMs, label } = workerData;",
  "const beatView = new Int32Array(beatBuffer);",
  `const advanceStall = ${advanceStall.toString()};`,
  "let state = { lastBeat: Atomics.load(beatView, 0), lastTickNs: process.hrtime.bigint(), stalledMs: 0 };",
  "let killed = false;",
  "setInterval(() => {",
  "  if (killed) return;",
  "  const beat = Atomics.load(beatView, 0);",
  "  const nowNs = process.hrtime.bigint();",
  "  state = advanceStall(state, { nowNs, beat, tickMs });",
  "  if (state.stalledMs > thresholdMs) {",
  "    killed = true;",
  "    const seconds = (state.stalledMs / 1000).toFixed(1);",
  "    const limitSeconds = Math.round(thresholdMs / 1000);",
  "    fs.writeSync(2, '[' + label + '] watchdog: event loop blocked for ' + seconds + 's (limit ' + limitSeconds + 's); exiting so a supervisor can restart\\n');",
  "    process.kill(process.pid, 'SIGTERM');",
  "    setTimeout(() => { try { process.kill(process.pid, 'SIGKILL'); } catch (_e) { /* already gone */ } }, 2000);",
  "  }",
  "}, tickMs);",
].join('\n');

/**
 * Start an event-loop watchdog on the current process.
 *
 * @param {object} opts
 * @param {number} opts.thresholdSeconds - stall threshold; `<= 0` (or absent,
 *   non-finite, non-numeric) disables the watchdog entirely.
 * @param {string} [opts.label] - prefix for the stderr line, for multi-server logs.
 * @returns {{ enabled: boolean, thresholdSeconds?: number, stop: () => void }}
 */
export function startEventLoopWatchdog({ thresholdSeconds, label = 'groundwork-designer' } = {}) {
  if (!(thresholdSeconds > 0)) {
    return { enabled: false, stop() {} };
  }

  const thresholdMs = thresholdSeconds * 1000;
  const tickMs = clamp(thresholdMs / 4, 50, 1000);
  // The main thread must tick its beat counter comfortably more often than
  // the worker checks it, or a live main thread could still look stalled.
  const heartbeatMs = Math.max(25, tickMs / 2);

  const beatBuffer = new SharedArrayBuffer(4);
  const beatView = new Int32Array(beatBuffer);

  // Main thread: bump the beat counter on its own timer. unref() so this
  // timer alone never keeps the process alive.
  const ticker = setInterval(() => {
    Atomics.add(beatView, 0, 1);
  }, heartbeatMs);
  ticker.unref();

  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { beatBuffer, thresholdMs, tickMs, label },
    execArgv: [],
  });
  worker.unref();
  worker.on('error', () => {
    // A broken watchdog worker must never be worse than no watchdog — fail
    // open, not closed. The host process keeps running unprotected.
  });

  return {
    enabled: true,
    thresholdSeconds,
    stop() {
      clearInterval(ticker);
      try { worker.terminate(); } catch (_e) { /* already gone */ }
    },
  };
}
