import { acp, type TurnChunk, type TurnContext, type TurnRequest } from '@morrowbot/plugin-sdk';
import { expect, it } from 'vitest';
import { createModelCatalog } from './models.ts';
import { ASKING_MODE } from './session.ts';
import { runTurn, type Live } from './turn.ts';

interface TrackedFence extends acp.Fence {
  readonly activeListeners: () => number;
  readonly peakListeners: () => number;
}

function createTrackedFence(): TrackedFence {
  const inner = acp.createFence();
  let active = 0;
  let peak = 0;
  return {
    reason: () => inner.reason(),
    trip: (reason) => {
      active = 0;
      inner.trip(reason);
    },
    subscribe: (listener) => {
      if (inner.reason() !== null) return inner.subscribe(listener);
      active += 1;
      peak = Math.max(peak, active);
      let removed = false;
      const stop = inner.subscribe(listener);
      return () => {
        if (removed) return;
        removed = true;
        if (inner.reason() === null) active -= 1;
        stop();
      };
    },
    activeListeners: () => active,
    peakListeners: () => peak,
  };
}

function makeRequest(turnId: string): TurnRequest {
  return {
    turnId,
    cwd: '/work/ws',
    mode: 'interactive',
    access: 'read-only',
    vendorSettings: 'personal',
    expectedAccountKey: '',
    expectedRouteKey: '',
    selection: { kind: 'default' },
    session: { kind: 'new', seed: null },
    system: null,
    prompt: 'hello',
    images: [],
    hostTools: { kind: 'none' },
  };
}

function makeDaemon(options: {
  readonly onPrompt?: (sessionId: string, handlers: acp.SessionHandlers) => Promise<acp.Call<acp.PromptResponse>>;
} = {}): acp.AcpClient {
  let nextSession = 0;
  const attached = new Map<string, acp.SessionHandlers>();
  return {
    version: '1.5.18',
    canLoad: true,
    canClose: true,
    mcpHttp: false,
    alive: () => true,
    call: async (method, params, schema) => {
      if (method === 'session/new') {
        const sessionId = `session-${String(++nextSession)}`;
        const raw = {
          sessionId,
          configOptions: [{ id: 'mode', name: 'Mode', type: 'select', currentValue: ASKING_MODE, options: [{ value: ASKING_MODE, name: 'Default' }] }],
        };
        return { kind: 'ok', value: schema.parse(raw) };
      }
      if (method === 'session/prompt') {
        const sessionId = typeof params === 'object' && params !== null && 'sessionId' in params && typeof params.sessionId === 'string' ? params.sessionId : '';
        const handlers = attached.get(sessionId);
        if (options.onPrompt !== undefined && handlers !== undefined) {
          const result = await options.onPrompt(sessionId, handlers);
          return result.kind === 'ok' ? { kind: 'ok', value: schema.parse(result.value) } : result;
        }
        return { kind: 'ok', value: schema.parse({ stopReason: 'end_turn' }) };
      }
      return { kind: 'ok', value: schema.parse({}) };
    },
    notify: () => undefined,
    attach: (sessionId, handlers) => {
      attached.set(sessionId, handlers);
      return () => {
        if (attached.get(sessionId) === handlers) attached.delete(sessionId);
      };
    },
    trust: () => undefined,
    exited: new Promise(() => undefined),
    close: () => Promise.resolve(),
    breach: () => undefined,
  };
}

it('keeps fence listeners O(1) across many turns (including approvals) and notifies only the active turn on breach', async () => {
  const fence = createTrackedFence();
  const pastEmits: TurnChunk[][] = [];
  let askNext = false;
  const daemon = makeDaemon({
    onPrompt: async (sessionId, handlers) => {
      if (askNext) {
        askNext = false;
        await handlers.onPermission({
          sessionId,
          toolCall: { toolCallId: 'call-1', title: 'Read /etc/hosts', kind: 'read' },
          options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, { optionId: 'deny', name: 'Deny', kind: 'reject_once' }],
        });
      }
      return { kind: 'ok', value: { stopReason: 'end_turn' } };
    },
  });
  const live: Live = { daemon, catalog: createModelCatalog(), tier: null, signedOut: false };
  const deps = {
    live: () => live,
    checkCli: () => Promise.resolve(null),
    checkWorkspace: () => Promise.resolve({ kind: 'clear' as const }),
    platformReason: null,
    fence,
    home: '/work',
  };

  for (let i = 0; i < 100; i += 1) {
    askNext = i % 10 === 0;
    const chunks: TurnChunk[] = [];
    pastEmits.push(chunks);
    const context: TurnContext = {
      request: makeRequest(`turn-${String(i)}`),
      signal: new AbortController().signal,
      emit: (chunk) => chunks.push(chunk),
      ask: () => Promise.resolve({ kind: 'chosen', choiceId: 'deny' }),
      onSteer: () => () => undefined,
    };
    const end = await runTurn(context, deps);
    expect(end.outcome).toEqual({ kind: 'completed', finishReason: 'stop' });
    expect(fence.activeListeners()).toBe(0);
  }
  expect(fence.peakListeners()).toBe(1);

  const promptStarted = Promise.withResolvers<undefined>();
  const stalled = Promise.withResolvers<acp.Call<acp.PromptResponse>>();
  const breachDaemon = makeDaemon({
    onPrompt: () => {
      promptStarted.resolve(undefined);
      return stalled.promise;
    },
  });
  const breachChunks: TurnChunk[] = [];
  const activeTurn = runTurn(
    {
      request: makeRequest('turn-breach'),
      signal: new AbortController().signal,
      emit: (chunk) => breachChunks.push(chunk),
      ask: () => Promise.resolve({ kind: 'refused', reason: 'expired' }),
      onSteer: () => () => undefined,
    },
    { ...deps, live: () => ({ daemon: breachDaemon, catalog: createModelCatalog(), tier: null, signedOut: false }) },
  );
  await promptStarted.promise;
  expect(fence.activeListeners()).toBe(1);

  fence.trip('Antigravity broke read-only rules.');
  const breached = await activeTurn;

  expect({
    peakListeners: fence.peakListeners(),
    activeAfter: fence.activeListeners(),
    pastTurnStatusEvents: pastEmits.flat().filter((chunk) => chunk.kind === 'status').length,
    activeChunks: breachChunks,
    outcome: breached.outcome,
  }).toEqual({
    peakListeners: 1,
    activeAfter: 0,
    pastTurnStatusEvents: 0,
    activeChunks: [{ kind: 'status', text: 'Antigravity broke read-only rules.' }],
    outcome: { kind: 'failed', error: { kind: 'access-not-supported', reason: 'Antigravity broke read-only rules.' } },
  });
});
