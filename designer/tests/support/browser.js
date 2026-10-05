import { setTimeout as delay } from 'node:timers/promises';

// Bound elapsed time, including a predicate which never resolves. The former
// 160 x 75ms loop intended a 12s budget but excluded time inside each attempt.
export async function waitUntil(check, message, timeoutMs = 12000) {
  let timer;
  const controller = new AbortController();
  try {
    await Promise.race([
      (async () => {
        while (!controller.signal.aborted) {
          if (await check(controller.signal)) return;
          await delay(75, undefined, { signal: controller.signal });
        }
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message + ' (deadline ' + timeoutMs + 'ms)')), timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); controller.abort(); }
}

export async function connectCdp(url, { Socket = WebSocket, timeoutMs = 15000 } = {}) {
  const socket = new Socket(url);
  let sequence = 0;
  let failure;
  const pending = new Map();
  function fail(error) {
    failure = error;
    for (const callbacks of pending.values()) callbacks.reject(error);
    pending.clear();
  }
  socket.addEventListener('close', () => fail(new Error('CDP transport closed')));
  socket.addEventListener('error', () => fail(new Error('CDP transport error')));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('CDP socket open deadline ' + timeoutMs + 'ms')); }, timeoutMs);
    const finish = (fn, value) => { clearTimeout(timer); fn(value); };
    socket.addEventListener('open', () => finish(resolve), { once: true });
    socket.addEventListener('error', () => finish(reject, new Error('CDP transport error')), { once: true });
    socket.addEventListener('close', () => finish(reject, new Error('CDP transport closed before opening')), { once: true });
  });
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { fail(new Error('Invalid CDP response')); return; }
    const callbacks = pending.get(message.id);
    if (!callbacks) return;
    pending.delete(message.id);
    if (message.error) callbacks.reject(new Error(message.error.message));
    else callbacks.resolve(message.result);
  });
  return {
    send(method, params = {}) {
      if (failure) return Promise.reject(failure);
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id); reject(new Error('CDP ' + method + ' deadline ' + timeoutMs + 'ms'));
        }, timeoutMs);
        const callbacks = {
          resolve: value => { clearTimeout(timer); resolve(value); },
          reject: error => { clearTimeout(timer); reject(error); },
        };
        pending.set(id, callbacks);
        try { socket.send(JSON.stringify({ id, method, params })); }
        catch (error) { pending.delete(id); callbacks.reject(error); }
      });
    },
    close() { fail(new Error('CDP transport closed')); socket.close(); },
  };
}
