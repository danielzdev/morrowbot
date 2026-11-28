import { acp, type TurnChunk, type TurnContext, type TurnRequest } from '@morrowbot/plugin-sdk';
import { expect, it } from 'vitest';
import { BUILD_MODE, FULL_MODE } from './config.ts';
import { createModelCatalog } from './models.ts';
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

function makeRequest(turnId: string, overrides: Partial<TurnRequest> = {}): TurnRequest {
  return {
    turnId,
    cwd: '/work/ws',
    mode: 'interactive',
    access: 'read-only',
    vendorSettings: 'isolated',
    expectedAccountKey: '',
    expectedRouteKey: '',
    selection: { kind: 'default' },
    session: { kind: 'new', seed: null },
    system: null,
    prompt: 'hello',
    images: [],
    hostTools: { kind: 'none' },
    ...overrides,
  };
}

function makeClient(options: {
  readonly onPrompt?: (sessionId: string, handlers: acp.SessionHandlers) => Promise<acp.Call<acp.PromptResponse>>;
} = {}): acp.AcpClient {
  let nextSession = 0;
  const attached = new Map<string, acp.SessionHandlers>();
  return {
    version: '2.4.1',
    canLoad: false,
    canClose: true,
    mcpHttp: true,
    alive: () => true,
    call: async (method, params, schema) => {
      if (method === 'session/new') {
        const sessionId = `session-${String(++nextSession)}`;
        const raw = {
          sessionId,
          configOptions: [{ id: 'mode', name: 'Mode', type: 'select', currentValue: BUILD_MODE, options: [{ value: BUILD_MODE, name: 'Build' }] }],
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
    exited: new Promise(() => undefined),
    close: () => Promise.resolve(),
    breach: () => undefined,
  };
}

it('keeps fence listeners O(1) across many turns (including approvals) and notifies only the active turn on breach', async () => {
  const fence = createTrackedFence();
  const pastEmits: TurnChunk[][] = [];
  let askNext = false;
  const client = makeClient({
    onPrompt: async (sessionId, handlers) => {
      if (askNext) {
        askNext = false;
        await handlers.onPermission({
          sessionId,
          toolCall: { toolCallId: 'call-1', title: 'Read /etc/hosts', kind: 'read' },
          options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, { optionId: 'reject', name: 'Deny', kind: 'reject_once' }],
        });
      }
      return { kind: 'ok', value: { stopReason: 'end_turn' } };
    },
  });
  const live: Live = { client, catalog: createModelCatalog() };
  const deps = {
    live: () => live,
    checkCli: () => Promise.resolve(null),
    checkManaged: () => Promise.resolve(null),
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
  const breachClient = makeClient({
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
    { ...deps, live: () => ({ client: breachClient, catalog: createModelCatalog() }) },
  );
  await promptStarted.promise;
  expect(fence.activeListeners()).toBe(1);

  fence.trip('OpenCode broke read-only rules.');
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
    activeChunks: [{ kind: 'status', text: 'OpenCode broke read-only rules.' }],
    outcome: { kind: 'failed', error: { kind: 'access-not-supported', reason: 'OpenCode broke read-only rules.' } },
  });
});

it('switches to full mode for full-access turns (interactive and background), auto-approves permissions, and cancels cleanly on Stop', async () => {
  const fence = createTrackedFence();
  const modeCalls: unknown[] = [];
  const notifications: unknown[] = [];
  let allowChangesFlag: boolean | undefined;
  let permissionReply: unknown;
  let askCount = 0;
  let breached = 0;
  const makeFullClient = (onPrompt?: (sessionId: string, handlers: acp.SessionHandlers) => Promise<acp.Call<acp.PromptResponse>>): acp.AcpClient => {
    let nextSession = 0;
    const attached = new Map<string, acp.SessionHandlers>();
    return {
      version: '2.4.1',
      canLoad: false,
      canClose: true,
      mcpHttp: true,
      alive: () => true,
      call: async (method, params, schema) => {
        if (method === 'session/new') {
          const sessionId = `session-${String(++nextSession)}`;
          return {
            kind: 'ok',
            value: schema.parse({
              sessionId,
              configOptions: [{ id: 'mode', name: 'Mode', type: 'select', currentValue: BUILD_MODE, options: [{ value: BUILD_MODE, name: 'Build' }, { value: FULL_MODE, name: 'Full' }] }],
            }),
          };
        }
        if (method === 'session/set_config_option') {
          modeCalls.push(params);
          return {
            kind: 'ok',
            value: schema.parse({
              configOptions: [{ id: 'mode', name: 'Mode', type: 'select', currentValue: FULL_MODE, options: [{ value: BUILD_MODE, name: 'Build' }, { value: FULL_MODE, name: 'Full' }] }],
            }),
          };
        }
        if (method === 'session/prompt') {
          const sessionId = typeof params === 'object' && params !== null && 'sessionId' in params && typeof params.sessionId === 'string' ? params.sessionId : '';
          const handlers = attached.get(sessionId);
          if (onPrompt !== undefined && handlers !== undefined) {
            const result = await onPrompt(sessionId, handlers);
            return result.kind === 'ok' ? { kind: 'ok', value: schema.parse(result.value) } : result;
          }
          return { kind: 'ok', value: schema.parse({ stopReason: 'end_turn' }) };
        }
        return { kind: 'ok', value: schema.parse({}) };
      },
      notify: (method, params) => {
        notifications.push({ method, params });
      },
      attach: (sessionId, handlers) => {
        allowChangesFlag = handlers.allowChanges;
        attached.set(sessionId, handlers);
        return () => {
          if (attached.get(sessionId) === handlers) attached.delete(sessionId);
        };
      },
      exited: new Promise(() => undefined),
      close: () => Promise.resolve(),
      breach: () => {
        breached += 1;
      },
    };
  };

  const client = makeFullClient(async (sessionId, handlers) => {
    permissionReply = await handlers.onPermission({
      sessionId,
      toolCall: { toolCallId: 'call-bash', title: 'bash', kind: 'execute' },
      options: [{ optionId: 'once', kind: 'allow_once' }, { optionId: 'reject', kind: 'reject_once' }],
    });
    return { kind: 'ok', value: { stopReason: 'end_turn' } };
  });
  const deps = {
    live: () => ({ client, catalog: createModelCatalog() }),
    checkCli: () => Promise.resolve(null),
    checkManaged: () => Promise.resolve(null),
    platformReason: null,
    fence,
    home: '/work',
  };

  const bgFull = await runTurn(
    {
      request: makeRequest('turn-bg-full', { access: 'full', mode: 'background' }),
      signal: new AbortController().signal,
      emit: () => undefined,
      ask: () => {
        askCount += 1;
        return Promise.resolve({ kind: 'refused', reason: 'background' });
      },
      onSteer: () => () => undefined,
    },
    deps,
  );
  const bgReadOnly = await runTurn(
    {
      request: makeRequest('turn-bg-ro', { access: 'read-only', mode: 'background' }),
      signal: new AbortController().signal,
      emit: () => undefined,
      ask: () => Promise.resolve({ kind: 'refused', reason: 'background' }),
      onSteer: () => () => undefined,
    },
    deps,
  );

  const stop = new AbortController();
  const stalled = Promise.withResolvers<acp.Call<acp.PromptResponse>>();
  const promptStarted = Promise.withResolvers<undefined>();
  const stopClient = makeFullClient(() => {
    promptStarted.resolve(undefined);
    return stalled.promise;
  });
  const cancelling = runTurn(
    {
      request: makeRequest('turn-stop-full', { access: 'full' }),
      signal: stop.signal,
      emit: () => undefined,
      ask: () => Promise.resolve({ kind: 'refused', reason: 'turn-ended' }),
      onSteer: () => () => undefined,
    },
    { ...deps, live: () => ({ client: stopClient, catalog: createModelCatalog() }) },
  );
  await promptStarted.promise;
  stop.abort();
  stalled.resolve({ kind: 'ok', value: { stopReason: 'cancelled' } });
  const stopped = await cancelling;

  expect({
    bgFull: bgFull.outcome,
    bgReadOnly: bgReadOnly.outcome,
    allowChangesFlag,
    permissionReply,
    askCount,
    breached,
    modeCalls,
    stopped: stopped.outcome,
    notifications,
  }).toEqual({
    bgFull: { kind: 'completed', finishReason: 'stop' },
    bgReadOnly: { kind: 'failed', error: { kind: 'background-not-allowed' } },
    allowChangesFlag: true,
    permissionReply: { outcome: { outcome: 'selected', optionId: 'once' } },
    askCount: 0,
    breached: 0,
    modeCalls: [
      { sessionId: 'session-1', configId: 'mode', value: FULL_MODE },
      { sessionId: 'session-1', configId: 'mode', value: FULL_MODE },
    ],
    stopped: { kind: 'cancelled' },
    notifications: [{ method: 'session/cancel', params: { sessionId: 'session-1' } }],
  });
});
