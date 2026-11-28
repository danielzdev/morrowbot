import type { BrowserErrorCode } from '@morrowbot/contracts';
import type { z } from 'zod';

/**
 * One tab's Chrome DevTools Protocol session: `chrome.debugger` in the extension, a DevTools
 * WebSocket in tests. Answers are outside data, parsed with `call`.
 */
export interface CdpSession {
  send(method: string, params?: Readonly<Record<string, unknown>>): Promise<unknown>;
  /** Hears one event; returns the unsubscribe. */
  on(method: string, listener: (params: unknown) => void): () => void;
}

export async function call<S extends z.ZodType>(session: CdpSession, method: string, params: Readonly<Record<string, unknown>>, schema: S): Promise<z.output<S>> {
  return schema.parse(await session.send(method, params));
}

/** A command failed in a way the agent can act on. */
export class BrowserFailure extends Error {
  readonly code: BrowserErrorCode;
  constructor(code: BrowserErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Waits for the first `method` event that `accept` takes, or `null` after `timeoutMs`. */
export function nextEvent<T>(session: CdpSession, methods: readonly string[], accept: (method: string, params: unknown) => T | null, timeoutMs: number): { readonly promise: Promise<T | null>; readonly cancel: () => void } {
  const settled = Promise.withResolvers<T | null>();
  const stops = methods.map((method) =>
    session.on(method, (params) => {
      const value = accept(method, params);
      if (value !== null) settled.resolve(value);
    }),
  );
  const timer = setTimeout(() => {
    settled.resolve(null);
  }, timeoutMs);
  const cancel = (): void => {
    clearTimeout(timer);
    for (const stop of stops) stop();
    settled.resolve(null);
  };
  return { promise: settled.promise.finally(cancel), cancel };
}
