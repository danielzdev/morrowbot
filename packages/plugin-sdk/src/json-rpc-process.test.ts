import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { jsonRpcProcess, type JsonRpcProcess } from './json-rpc-process.ts';
import { liveness } from './testing/processes.ts';

const SERVER = fileURLToPath(new URL('./testing/json-rpc-server.ts', import.meta.url));
const started: JsonRpcProcess[] = [];

interface Heard {
  readonly notifications: unknown[];
  readonly requests: unknown[];
}

function start(
  onRequest: (method: string, params: unknown) => Promise<unknown> = (method, params) => Promise.resolve({ method, params }),
  signal: AbortSignal = new AbortController().signal,
): { readonly rpc: JsonRpcProcess; readonly heard: Heard } {
  const heard: Heard = { notifications: [], requests: [] };
  const rpc = jsonRpcProcess(process.execPath, {
    args: [SERVER],
    cwd: process.cwd(),
    files: [],
    signal,
    onNotification: (method, params) => {
      heard.notifications.push({ method, params });
    },
    onRequest: (method, params) => {
      heard.requests.push({ method, params });
      return onRequest(method, params);
    },
  });
  started.push(rpc);
  return { rpc, heard };
}

afterEach(async () => {
  await Promise.all(started.splice(0).map((rpc) => rpc.close()));
});

it('matches replies to requests, results and errors alike', async () => {
  const { rpc } = start();
  const replies = await Promise.all([
    rpc.request('echo', { a: 1 }, { timeoutMs: 5_000 }),
    rpc.request('fail', null, { timeoutMs: 5_000 }),
    rpc.request('echo', ['b'], { timeoutMs: 5_000 }),
  ]);
  expect(replies).toMatchInlineSnapshot(`
    [
      {
        "kind": "result",
        "value": {
          "a": 1,
        },
      },
      {
        "code": -32000,
        "data": {
          "why": "asked to",
        },
        "kind": "error",
        "message": "nope",
      },
      {
        "kind": "result",
        "value": [
          "b",
        ],
      },
    ]
  `);
});

it('times a request out and drops its late reply, while later requests still work', async () => {
  const { rpc } = start();
  expect(await rpc.request('slow', { ms: 300 }, { timeoutMs: 50 })).toEqual({ kind: 'timeout' });
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(await rpc.request('echo', 'after', { timeoutMs: 5_000 })).toEqual({ kind: 'result', value: 'after' });
});

it('hears notifications and ignores lines that are not JSON-RPC', async () => {
  const { rpc, heard } = start();
  rpc.notify('ping', { n: 0 });
  expect(await rpc.request('tell', null, { timeoutMs: 5_000 })).toEqual({ kind: 'result', value: 'told' });
  expect(heard.notifications).toEqual([
    { method: 'heard', params: { method: 'ping', params: { n: 0 } } },
    { method: 'news', params: { n: 1 } },
  ]);
});

it('answers a request from the daemon with the handler result, or an error when the handler fails', async () => {
  let calls = 0;
  const { rpc, heard } = start((_method, params) => (calls++ === 0 ? Promise.resolve({ yes: params }) : Promise.reject(new Error('no thanks'))));
  expect(await rpc.request('ask', 'first?', { timeoutMs: 5_000 })).toEqual({ kind: 'result', value: { result: { yes: 'first?' } } });
  expect(await rpc.request('ask', 'second?', { timeoutMs: 5_000 })).toEqual({
    kind: 'result',
    value: { error: { code: -32603, message: 'no thanks' } },
  });
  expect(heard.requests).toEqual([
    { method: 'question', params: 'first?' },
    { method: 'question', params: 'second?' },
  ]);
});

it('keeps the daemon running when a notification handler throws', async () => {
  const rpc = jsonRpcProcess(process.execPath, {
    args: [SERVER],
    cwd: process.cwd(),
    files: [],
    signal: new AbortController().signal,
    onNotification: () => {
      throw new Error('handler bug');
    },
    onRequest: () => Promise.resolve(null),
  });
  started.push(rpc);
  expect(await rpc.request('tell', null, { timeoutMs: 5_000 })).toEqual({ kind: 'result', value: 'told' });
  expect(await rpc.request('echo', 'still here', { timeoutMs: 5_000 })).toEqual({ kind: 'result', value: 'still here' });
});

it('fails waiting and later requests with exited when the daemon exits', async () => {
  const { rpc } = start();
  const waiting = rpc.request('slow', { ms: 10_000 }, { timeoutMs: 20_000 });
  await rpc.request('echo', 'up', { timeoutMs: 5_000 });
  void rpc.request('exit', null, { timeoutMs: 5_000 });
  expect(await waiting).toEqual({ kind: 'exited' });
  expect(await rpc.exited).toMatchObject({ kind: 'exited', code: 3 });
  expect(await rpc.request('echo', 'gone', { timeoutMs: 5_000 })).toEqual({ kind: 'exited' });
});

it('stops the daemon on close and on abort, and resolves once it is gone', async () => {
  const { rpc } = start();
  const pid = await rpc.request('pid', null, { timeoutMs: 5_000 });
  if (pid.kind !== 'result' || typeof pid.value !== 'number') throw new Error('no pid');
  await rpc.close();
  expect(liveness(pid.value)).toBe('gone');

  const controller = new AbortController();
  const aborted = start(undefined, controller.signal).rpc;
  const second = await aborted.request('pid', null, { timeoutMs: 5_000 });
  if (second.kind !== 'result' || typeof second.value !== 'number') throw new Error('no pid');
  controller.abort();
  await aborted.exited;
  expect(liveness(second.value)).toBe('gone');
});
