/** Hold calls that have NOT reached Telegram while the receiver reconnects.
 * Already-dispatched requests are never replayed: their result may be unknown.
 * This gate survives network reconnects, but intentionally ends on plugin stop.
 */
export class TelegramReconnectDeliveryGate {
  #ready = true;
  #waiters = new Set();
  #timeoutMs;

  constructor({ timeoutMs = 300_000 } = {}) {
    this.#timeoutMs = timeoutMs;
  }

  suspend() { this.#ready = false; }

  resume() {
    this.#ready = true;
    for (const wake of [...this.#waiters]) wake();
  }

  async #wait(signal) {
    signal?.throwIfAborted();
    if (this.#ready) return;
    await new Promise((resolve, reject) => {
      const finish = (error) => {
        clearTimeout(timer);
        this.#waiters.delete(wake);
        signal?.removeEventListener('abort', onAbort);
        if (error) reject(error); else resolve();
      };
      const wake = () => finish();
      const onAbort = () => finish(signal.reason);
      const timer = setTimeout(() => finish(Object.assign(
        new Error('Telegram reconnect wait expired before dispatch'),
        { code: 'telegram-reconnect-timeout' },
      )), this.#timeoutMs);
      this.#waiters.add(wake);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      else if (this.#ready) wake();
    });
    // A second outage can start before a released waiter gets its microtask.
    if (!this.#ready) return this.#wait(signal);
    signal?.throwIfAborted();
  }

  wrap(api, lifetimeSignal) {
    return new Proxy(api, {
      get: (target, key) => {
        const value = Reflect.get(target, key, target);
        if (typeof value !== 'function') return value;
        return async (...args) => {
          const requestSignal = args[0]?.signal;
          const signal = requestSignal && lifetimeSignal
            ? AbortSignal.any([requestSignal, lifetimeSignal])
            : requestSignal ?? lifetimeSignal;
          await this.#wait(signal);
          return value.apply(target, args);
        };
      },
    });
  }
}
