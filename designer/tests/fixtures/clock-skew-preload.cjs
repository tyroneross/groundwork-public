// clock-skew-preload.cjs — `node --require` preload that lets a test jump the
// server process's clock forward without touching wall-clock time (no `date`
// commands, no sleeping for real minutes). Loaded into the SAME process as the
// designer server via `--require`, so it patches the process-wide Date.now
// that the server's own agent-window check reads.
//
// Guarded by isMainThread: the server also spins up a worker thread (the
// event-loop watchdog) that must keep touching the REAL clock — hrtime is
// unaffected here regardless, but this file must never patch anything inside
// that worker even if some future change requires the preload there too.
//
// Must be `.cjs`: scripts/check.sh runs every `*.mjs` under designer/tests
// via `node --test`, so a `.mjs` preload here would be picked up and executed
// as its own (empty) test file.
'use strict';

const { isMainThread } = require('worker_threads');

if (isMainThread) {
  const realNow = Date.now.bind(Date);
  let offsetMs = 0;

  Date.now = () => realNow() + offsetMs;

  // Each SIGUSR2 jumps the process's clock forward by 10 minutes. Used to
  // simulate host idle time without a real 10-minute sleep.
  process.on('SIGUSR2', () => {
    offsetMs += 10 * 60 * 1000;
  });
}
