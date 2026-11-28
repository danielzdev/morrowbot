import { expect, it } from 'vitest';
import type { JsonRpcProcessOptions, StartJsonRpcProcess } from '../json-rpc-process.ts';
import { startAcpClient, type SessionHandlers } from './client.ts';
import type { Breach } from './tripwire.ts';

function fakeRpc(): {
  readonly start: StartJsonRpcProcess;
  readonly notify: (method: string, params: unknown) => void;
  readonly request: (method: string, params: unknown) => Promise<unknown>;
} {
  let opts: JsonRpcProcessOptions | undefined;
  const start: StartJsonRpcProcess = (_command, options) => {
    opts = options;
    return {
      exited: new Promise(() => undefined),
      request: (method) => {
        if (method === 'initialize') {
          return Promise.resolve({
            kind: 'result',
            value: { protocolVersion: 1, agentInfo: { version: '2.4.1' }, agentCapabilities: { loadSession: false, sessionCapabilities: { close: {} }, mcpCapabilities: { http: true } } },
          });
        }
        return Promise.resolve({ kind: 'result', value: {} });
      },
      notify: () => undefined,
      close: () => Promise.resolve({ kind: 'exited', code: 0, signal: null, stderr: '' }),
    };
  };
  return {
    start,
    notify: (method, params) => {
      opts?.onNotification(method, params);
    },
    request: (method, params) => {
      if (opts === undefined) return Promise.reject(new Error('not started'));
      return opts.onRequest(method, params);
    },
  };
}

function handlers(allowChanges: boolean): SessionHandlers {
  return {
    onUpdate: () => undefined,
    onPermission: () => Promise.resolve({ outcome: { outcome: 'cancelled' } }),
    onRefused: () => undefined,
    replaying: () => false,
    allowChanges,
  };
}

const completedExec = (sessionId: string) => ({
  sessionId,
  update: { sessionUpdate: 'tool_call_update', toolCallId: `exec-${sessionId}`, title: 'bash', kind: 'execute', status: 'completed' },
});

it('keeps active allowChanges sessions exempt across >1000 detached full sessions, remembers late detach updates, and re-arms on read-only attach', async () => {
  const rpc = fakeRpc();
  const breaches: Breach[] = [];
  const started = await startAcpClient(rpc.start, 'opencode', {
    name: 'OpenCode',
    args: ['acp'],
    cwd: '/tmp',
    home: '/tmp',
    onBreach: (breach) => breaches.push(breach),
  });
  if (started.kind !== 'started') throw new Error(started.reason);
  const { client } = started;

  const detachActive = client.attach('full-long', handlers(true));
  for (let i = 0; i < 1_005; i += 1) {
    const detach = client.attach(`full-short-${String(i)}`, handlers(true));
    detach();
  }
  rpc.notify('session/update', completedExec('full-long'));
  expect(breaches).toEqual([]);

  const fullWriteError = await rpc.request('fs/write_text_file', { sessionId: 'full-long' }).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
  detachActive();
  rpc.notify('session/update', completedExec('full-long'));
  expect(breaches).toEqual([]);

  const detachReadOnly = client.attach('full-long', handlers(false));
  const readOnlyWriteError = await rpc.request('fs/write_text_file', { sessionId: 'full-long' }).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
  rpc.notify('session/update', completedExec('full-long'));
  detachReadOnly();

  expect({ fullWriteError, readOnlyWriteError, breaches }).toEqual({
    fullWriteError: 'Ori Bot does not answer fs/write_text_file.',
    readOnlyWriteError: 'Ori Bot runs OpenCode read-only: it writes no files.',
    breaches: [{ kind: 'unasked-change', tool: 'Shell bash' }],
  });
});
