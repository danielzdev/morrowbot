import type { PluginMessage, SecretFillRequest, SecretResolution } from '@morrowbot/contracts';

/** A tool call's side of `secret-request`: each request waits for its `secret-result`, or is refused when the call ends. */
export interface SecretLink {
  /** Asks the host for one secret on behalf of the tool call with request id `callId`. */
  resolve(callId: number, request: SecretFillRequest, signal: AbortSignal): Promise<SecretResolution>;
  /** The host's `secret-result`. */
  answer(secretId: number, resolution: SecretResolution): void;
  /** Refuses every request still waiting (the plugin is shutting down or was abandoned). */
  close(): void;
}

const ENDED: SecretResolution = { kind: 'refused', reason: 'The tool call ended before the secret arrived.' };

export function createSecretLink(send: (message: PluginMessage) => void): SecretLink {
  const waiting = new Map<number, (resolution: SecretResolution) => void>();
  let nextId = 0;
  return {
    resolve: (callId, request, signal) => {
      if (signal.aborted) return Promise.resolve(ENDED);
      const secretId = nextId++;
      const { promise, resolve } = Promise.withResolvers<SecretResolution>();
      const onAbort = (): void => {
        settle(ENDED);
      };
      const settle = (resolution: SecretResolution): void => {
        waiting.delete(secretId);
        signal.removeEventListener('abort', onAbort);
        resolve(resolution);
      };
      waiting.set(secretId, settle);
      signal.addEventListener('abort', onAbort, { once: true });
      send({ kind: 'secret-request', secretId, callId, request });
      return promise;
    },
    answer: (secretId, resolution) => {
      waiting.get(secretId)?.(resolution);
    },
    close: () => {
      for (const settle of [...waiting.values()]) settle(ENDED);
    },
  };
}
