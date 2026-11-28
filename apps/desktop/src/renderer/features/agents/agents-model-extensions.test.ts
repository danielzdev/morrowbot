import { UpdateAgentRequest, type Agent, type ApiError } from '@morrowbot/contracts';
import { describe, expect, it } from 'vitest';
import type { MorrowbotBridge } from '../../bridge.ts';
import { createApi } from '../../shared/api.ts';
import { createAgentsModel } from './agents-model.ts';

function makeAgent(change: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    name: 'Errand Bot',
    description: '',
    workspace: { kind: 'dedicated', dir: '/srv/agents/errands' },
    avatar: { kind: 'bot', shape: 'lightbulb', color: '#3b82f6', finish: 'matte' },
    provider: { kind: 'unbound' },
    folderId: null,
    emojiReplies: 'allowed',
    disabledExtensions: ['gadget'],
    revision: 1,
    createdAt: '2026-11-28T00:00:00.000Z',
    updatedAt: '2026-11-28T00:00:00.000Z',
    ...change,
  };
}

function fakeBridge(request: MorrowbotBridge['request']): MorrowbotBridge {
  const unused = (): never => {
    throw new Error('Unexpected bridge call');
  };
  return {
    request,
    onEvent: () => () => undefined,
    subscribe: () => undefined,
    unsubscribe: () => undefined,
    onHostReady: () => () => undefined,
    onHostLost: () => () => undefined,
    pickFolder: unused,
    copyText: unused,
    openExternal: unused,
    revealPath: unused,
    appInfo: unused,
    loginItem: unused,
    setOpenAtLogin: unused,
    relaunch: unused,
    updateStatus: unused,
    onUpdateStatus: () => () => undefined,
    checkForUpdates: unused,
    restartToUpdate: unused,
    signInTerminal: unused,
    providerInstallCapabilities: unused,
    installProvider: unused,
    cancelProviderInstall: unused,
    onProviderInstallProgress: () => () => undefined,
    resetPlan: unused,
    runReset: unused,
    serverMode: unused,
    chooseServer: unused,
    fileAction: unused,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('AgentsModel per-agent extension revision safety', () => {
  it('syncs disabledExtensions from an unrelated update reply so a later toggle cannot overwrite external changes', async () => {
    const sent: unknown[] = [];
    const serverInitial = makeAgent({ disabledExtensions: ['gadget'], revision: 1 });
    const afterRename = makeAgent({ name: 'Renamed Bot', disabledExtensions: [], revision: 3 });
    const afterToggle = makeAgent({ name: 'Renamed Bot', disabledExtensions: ['notes'], revision: 4 });

    let patches = 0;
    const bridge = fakeBridge((method, path, body) => {
      if (method === 'GET' && path === '/api/agents') {
        return Promise.resolve({ status: 200, body: { agents: [serverInitial], folders: [], lastMessages: [] } });
      }
      if (method === 'GET' && path === '/api/agents/agent-1/threads') {
        return Promise.resolve({ status: 200, body: { threads: [] } });
      }
      if (method === 'PATCH' && path === '/api/agents/agent-1') {
        sent.push(body);
        patches += 1;
        return Promise.resolve({ status: 200, body: patches === 1 ? afterRename : afterToggle });
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });
    const model = createAgentsModel({ api: createApi(bridge), bridge });

    await model.load();
    await model.updateAgent('agent-1', { name: 'Renamed Bot' });

    const loaded = model.state.get().agents;
    expect(loaded.kind).toBe('loaded');
    if (loaded.kind !== 'loaded') return;
    const current = loaded.value[0];
    expect(current?.disabledExtensions).toEqual([]);
    expect(current?.revision).toBe(3);

    const saved = await model.setExtensions('agent-1', [...(current?.disabledExtensions ?? []), 'notes'], current?.revision ?? 0);
    expect(saved.kind).toBe('saved');
    expect(sent[1]).toEqual({ disabledExtensions: ['notes'], revision: 3 });
    model.close();
  });

  it('does not regress revision when an earlier setExtensions reply lands after a newer updateAgent reply, and handles 409 conflict', async () => {
    const initial = makeAgent({ disabledExtensions: [], revision: 0 });
    const extReply = deferred<{ status: number; body: unknown }>();
    const renameReply = deferred<{ status: number; body: unknown }>();
    const serverLatest = makeAgent({ name: 'Renamed', disabledExtensions: ['gadget'], revision: 2 });
    const conflictBody: ApiError = {
      error: { kind: 'agent-conflict', current: makeAgent({ name: 'Renamed', disabledExtensions: ['gadget', 'notes'], revision: 3 }), message: 'Changed elsewhere.' },
    };

    let listed = 0;
    const bridge = fakeBridge((method, path, body) => {
      if (method === 'GET' && path === '/api/agents') {
        listed += 1;
        return Promise.resolve({ status: 200, body: { agents: [listed === 1 ? initial : serverLatest], folders: [], lastMessages: [] } });
      }
      if (method === 'GET' && path === '/api/agents/agent-1/threads') {
        return Promise.resolve({ status: 200, body: { threads: [] } });
      }
      if (method === 'PATCH' && path === '/api/agents/agent-1') {
        const req = UpdateAgentRequest.parse(body);
        if (req.revision === 2) return Promise.resolve({ status: 409, body: conflictBody });
        return req.disabledExtensions !== undefined ? extReply.promise : renameReply.promise;
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });
    const model = createAgentsModel({ api: createApi(bridge), bridge });

    await model.load();
    const pExt = model.setExtensions('agent-1', ['gadget'], 0);
    const pRename = model.updateAgent('agent-1', { name: 'Renamed' });

    renameReply.resolve({ status: 200, body: serverLatest });
    await pRename;
    extReply.resolve({ status: 200, body: makeAgent({ name: 'Errand Bot', disabledExtensions: ['gadget'], revision: 1 }) });
    await pExt;

    const loaded = model.state.get().agents;
    expect(loaded.kind).toBe('loaded');
    if (loaded.kind === 'loaded') {
      expect(loaded.value[0]?.revision).toBe(2);
      expect(loaded.value[0]?.name).toBe('Renamed');
      expect(loaded.value[0]?.disabledExtensions).toEqual(['gadget']);
    }

    const conflicted = await model.setExtensions('agent-1', [], 2);
    expect(conflicted.kind).toBe('conflict');
    if (conflicted.kind === 'conflict') {
      model.adoptAgent(conflicted.current);
      const adopted = model.state.get().agents;
      if (adopted.kind === 'loaded') {
        expect(adopted.value[0]?.revision).toBe(3);
        expect(adopted.value[0]?.disabledExtensions).toEqual(['gadget', 'notes']);
      }
    }
    model.close();
  });
});
