// block-loop-preload.cjs — `node --require` preload that synchronously blocks
// the main thread's event loop on demand, to exercise the watchdog
// (event-loop-watchdog.mjs) without racing real server startup: the caller
// waits for the server's `watchdog:` startup log line (proof `listen()` and
// the watchdog itself are both up) before sending the signal that wedges the
// loop, instead of racing a fixed timer against server boot.
//
// Signal: SIGUSR2 arms the block. Prints `block-preload-pid:<pid>` to stdout
// on startup so a test can target the right process even when it also spawns
// other node processes.
//
// Env:
//   GROUNDWORK_TEST_BLOCK_FOR_MS  - optional; block for this many ms then
//                                   release (event loop resumes). Omit (or
//                                   non-finite) to block forever, so the
//                                   watchdog is the only way out.
//
// Guarded by isMainThread: the watchdog's own heartbeat worker must keep
// running — it lives on a separate thread specifically so it can notice a
// wedged main thread, so this preload must never block inside a worker.
//
// Must be `.cjs`: scripts/check.sh runs every `*.mjs` under designer/tests
// via `node --test`, so a `.mjs` preload here would be picked up and
// executed as its own (empty) test file.
'use strict';

const { isMainThread } = require('worker_threads');

if (isMainThread) {
  process.stdout.write(`block-preload-pid:${process.pid}\n`);

  process.on('SIGUSR2', () => {
    const forMsRaw = Number(process.env.GROUNDWORK_TEST_BLOCK_FOR_MS);
    const forMs = Number.isFinite(forMsRaw) && forMsRaw >= 0 ? forMsRaw : Infinity;
    const end = Date.now() + forMs;
    // Deliberately synchronous — this IS the event-loop stall under test.
    while (Date.now() < end) { /* busy-wait */ }
  });
}
