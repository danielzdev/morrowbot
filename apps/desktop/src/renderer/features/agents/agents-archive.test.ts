import type { Agent, Thread } from '@morrowbot/contracts';
import { describe, expect, it } from 'vitest';
import type { ApiMethod, ApiReply, MorrowbotBridge } from '../../bridge.ts';
import { createApi } from '../../shared/api.ts';
import { createAgentsModel } from './agents-model.ts';

const AT = '2026-01-01T00:00:00.000Z';
const AGENT: Agent = {
  id: 'a1',
  name: 'Atlas',
  description: '',
  workspace: { kind: 'dedicated', dir: '/work/atlas' },
  avatar: { kind: 'bot', shape: 'chat', color: '#0ea5e9', finish: 'flat' },
  provider: { kind: 'unbound' },
  folderId: null,
  emojiReplies: 'allowed',
  createdAt: AT,
  updatedAt: AT,
};

function bridgeFor(request: (method: ApiMethod, path: string, body?: unknown) => Promise<ApiReply>): MorrowbotBridge {
  const noop = () => () => undefined;
  return {
    request,
    onEvent: noop,
    subscribe: () => undefined,
    unsubscribe: () => undefined,
    onHostReady: noop,
    onHostLost: noop,
    pickFolder: () => Promise.resolve(null),
    copyText: () => Promise.resolve(),
    openExternal: () => Promise.resolve({ kind: 'opened' }),
    revealPath: () => Promise.resolve(),
    appInfo: () => Promise.resolve({}),
    loginItem: () => Promise.resolve({ kind: 'unsupported' }),
    setOpenAtLogin: () => Promise.resolve({ kind: 'unsupported' }),
    relaunch: () => Promise.resolve(),
    updateStatus: () => Promise.resolve({ kind: 'unsupported' }),
    onUpdateStatus: noop,
    checkForUpdates: () => Promise.resolve({ kind: 'unsupported' }),
    restartToUpdate: () => Promise.resolve(),
    signInTerminal: () => Promise.resolve({ kind: 'unavailable', reason: 'test' }),
    providerInstallCapabilities: () => Promise.resolve({}),
    installProvider: () => Promise.resolve({ kind: 'cancelled' }),
    cancelProviderInstall: () => Promise.resolve(),
    onProviderInstallProgress: noop,
    resetPlan: () => Promise.resolve({ token: 't', options: [] }),
    runReset: () => Promise.resolve({ kind: 'refused', reason: 'test' }),
    serverMode: () => Promise.resolve({ kind: 'local' }),
    chooseServer: () => Promise.resolve({ kind: 'ready' }),
    fileAction: () => Promise.resolve({ kind: 'cancelled' }),
  };
}

describe('agents-model archive and restore', () => {
  it('hides archived threads from active list, falls back to main thread, and restores them into active list and open tab', async () => {
    const main: Thread = { id: 't1', agentId: 'a1', title: 'Main', createdAt: AT, updatedAt: AT, archivedAt: null, createdSeq: 1 };
    const side: Thread = { id: 't2', agentId: 'a1', title: 'Side', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', archivedAt: null, createdSeq: 2 };
    const old: Thread = { id: 't0', agentId: 'a1', title: 'Old', createdAt: '2025-12-01T00:00:00.000Z', updatedAt: '2025-12-01T00:00:00.000Z', archivedAt: '2025-12-10T00:00:00.000Z', createdSeq: 3 };
    let activeList = [main, side];
    let archivedList = [old];
    const bridge = bridgeFor((method, reqPath) => {
      if (method === 'GET' && reqPath === '/api/agents') {
        return Promise.resolve({ status: 200, body: { agents: [AGENT], folders: [], lastMessages: [] } });
      }
      if (method === 'GET' && reqPath === '/api/agents/a1/threads') return Promise.resolve({ status: 200, body: { threads: activeList } });
      if (method === 'GET' && reqPath === '/api/agents/a1/threads?archived=only') return Promise.resolve({ status: 200, body: { threads: archivedList } });
      if (method === 'POST' && reqPath.endsWith('/archive')) {
        const id = reqPath.split('/')[3] ?? '';
        const target = activeList.find((thread) => thread.id === id);
        if (target === undefined) return Promise.resolve({ status: 404, body: { error: { kind: 'not_found', message: 'Not found' } } });
        const next: Thread = { ...target, archivedAt: '2026-01-05T00:00:00.000Z' };
        activeList = activeList.filter((thread) => thread.id !== id);
        archivedList = [next, ...archivedList];
        return Promise.resolve({ status: 200, body: next });
      }
      if (method === 'POST' && reqPath.endsWith('/restore')) {
        const id = reqPath.split('/')[3] ?? '';
        const target = archivedList.find((thread) => thread.id === id);
        if (target === undefined) return Promise.resolve({ status: 404, body: { error: { kind: 'not_found', message: 'Not found' } } });
        const next: Thread = { ...target, archivedAt: null };
        archivedList = archivedList.filter((thread) => thread.id !== id);
        activeList = [next, ...activeList];
        return Promise.resolve({ status: 200, body: next });
      }
      return Promise.resolve({ status: 404, body: { error: { kind: 'not_found', message: 'Not found' } } });
    });

    const archivedCallbacks: string[][] = [];
    const model = createAgentsModel({
      api: createApi(bridge),
      bridge,
      onThreadsArchived: (ids) => {
        archivedCallbacks.push([...ids]);
      },
    });
    await model.load();
    await new Promise((resolve) => setTimeout(resolve, 0));
    model.openThread('a1', 't2');
    model.markFinished('a1', 't1');

    await model.archiveThread('a1', 't2');
    const afterArchiveBeforeLoad = {
      active: model.state.get().threads['a1'],
      archivedLoaded: model.state.get().archivedThreads['a1'],
      open: model.state.get().openThread['a1'],
    };

    await model.loadArchivedThreads('a1');
    const archivedAfterLoad = model.state.get().archivedThreads['a1'];

    await model.restoreThread('a1', 't2');
    const afterRestore = model.state.get();

    expect({
      archivedCallbacks,
      activeAfterArchive: afterArchiveBeforeLoad.active?.kind === 'loaded' ? afterArchiveBeforeLoad.active.value.map(({ id }) => id) : [],
      archivedStateBeforeLoad: afterArchiveBeforeLoad.archivedLoaded,
      openAfterArchive: afterArchiveBeforeLoad.open,
      archivedIdsAfterLoad: archivedAfterLoad?.kind === 'loaded' ? archivedAfterLoad.value.map(({ id }) => id) : [],
      activeIdsAfterRestore: afterRestore.threads['a1']?.kind === 'loaded' ? afterRestore.threads['a1'].value.map(({ id }) => id) : [],
      archivedIdsAfterRestore: afterRestore.archivedThreads['a1']?.kind === 'loaded' ? afterRestore.archivedThreads['a1'].value.map(({ id }) => id) : [],
      openAfterRestore: afterRestore.openThread['a1'],
    }).toMatchInlineSnapshot(`
      {
        "activeAfterArchive": [
          "t1",
        ],
        "activeIdsAfterRestore": [
          "t2",
          "t1",
        ],
        "archivedCallbacks": [
          [
            "t2",
          ],
        ],
        "archivedIdsAfterLoad": [
          "t2",
          "t0",
        ],
        "archivedIdsAfterRestore": [
          "t0",
        ],
        "archivedStateBeforeLoad": undefined,
        "openAfterArchive": "t1",
        "openAfterRestore": "t2",
      }
    `);
    model.close();
  });
});
