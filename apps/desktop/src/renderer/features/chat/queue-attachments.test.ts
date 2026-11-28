import { MAX_ATTACHMENTS, type Attachment, type QueuedMessage, type ThreadState } from '@morrowbot/contracts';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it, vi } from 'vitest';
import type { ApiMethod, ApiReply, MorrowbotBridge } from '../../bridge.ts';
import { createApi } from '../../shared/api.ts';
import { Store } from '../../shared/store.ts';
import { Composer } from './Composer.tsx';
import { composerAttachments } from './composer-attachments.ts';
import { QueueList } from './QueueList.tsx';
import { openThreadSession, type ThreadScreen, type ThreadSession } from './thread-session.ts';
import { viewOf } from './thread-model.ts';

const AT = '2026-01-01T00:00:00.000Z';
const TXT: Attachment = { kind: 'text', id: 'att-1', name: 'notes.md', size: 120 };
const IMG: Attachment = { kind: 'image', id: 'att-2', name: 'board.png', mimeType: 'image/png', size: 2048 };

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

function baseState(queue: readonly QueuedMessage[]): ThreadState {
  return {
    thread: { id: 't1', agentId: 'a1', title: 'Main', createdAt: AT, updatedAt: AT, archivedAt: null },
    messages: [],
    reactions: [],
    toolSteps: [],
    activeTurn: {
      generationId: 'g1',
      trigger: { kind: 'chat' },
      state: 'running',
      queueNote: null,
      text: 'Working…',
      pendingApprovals: [],
      toolSteps: [],
    },
    queue: [...queue],
    blockedGroups: [],
    subagents: [],
    cursor: { hostEpoch: 'e1', seq: 1 },
  };
}

describe('queued message attachments UI', () => {
  it('renders compact file chips on queued items, including attachment-only items without an empty text span', () => {
    const queue: QueuedMessage[] = [
      { id: 'q1', threadId: 't1', text: 'Check these', attachments: [IMG, TXT], createdAt: AT, state: { kind: 'queued' } },
      { id: 'q2', threadId: 't1', text: '', attachments: [TXT], createdAt: AT, state: { kind: 'queued' } },
    ];
    const view = viewOf(baseState(queue));
    const screen: ThreadScreen = { view: { kind: 'loaded', value: view }, draft: '', busy: null, problem: null, answering: [], queueActing: [], connection: 'live' };
    const session: ThreadSession = {
      threadId: 't1',
      screen: new Store(screen),
      attachments: composerAttachments({ uploadAttachment: vi.fn() }, 't1'),
      image: () => Promise.resolve(null),
      load: () => Promise.resolve(),
      handle: () => undefined,
      setStream: () => undefined,
      setDraft: () => undefined,
      send: () => Promise.resolve(),
      choose: () => Promise.resolve(),
      retry: () => Promise.resolve(),
      dismissProblem: () => undefined,
      continueTurn: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      answer: () => Promise.resolve(),
      react: () => Promise.resolve(),
      steer: () => Promise.resolve(),
      editQueued: () => Promise.resolve(),
      cancelQueued: () => Promise.resolve(),
      release: () => Promise.resolve(),
      close: () => undefined,
    };
    const html = renderToString(h(QueueList, { session, view, screen, agentName: 'Atlas' }));
    expect({
      chips: [...html.matchAll(/<span class="queued-chip-name">([^<]+)<\/span>/g)].map(([, name]) => name),
      textSpans: [...html.matchAll(/<span class="queued-text">([^<]*)<\/span>/g)].map(([, text]) => text),
    }).toMatchInlineSnapshot(`
      {
        "chips": [
          "board.png",
          "notes.md",
          "notes.md",
        ],
        "textSpans": [
          "Check these",
        ],
      }
    `);
  });

  it('enables Queue in Composer when files are attached during a running reply', () => {
    const view = viewOf(baseState([]));
    const screen: ThreadScreen = { view: { kind: 'loaded', value: view }, draft: '', busy: null, problem: null, answering: [], queueActing: [], connection: 'live' };
    const attachments = composerAttachments({ uploadAttachment: vi.fn() }, 't1');
    attachments.restore([TXT], () => Promise.resolve(null));
    const session: ThreadSession = {
      threadId: 't1',
      screen: new Store(screen),
      attachments,
      image: () => Promise.resolve(null),
      load: () => Promise.resolve(),
      handle: () => undefined,
      setStream: () => undefined,
      setDraft: () => undefined,
      send: () => Promise.resolve(),
      choose: () => Promise.resolve(),
      retry: () => Promise.resolve(),
      dismissProblem: () => undefined,
      continueTurn: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      answer: () => Promise.resolve(),
      react: () => Promise.resolve(),
      steer: () => Promise.resolve(),
      editQueued: () => Promise.resolve(),
      cancelQueued: () => Promise.resolve(),
      release: () => Promise.resolve(),
      close: () => undefined,
    };
    const html = renderToString(
      h(Composer, { session, agentName: 'Atlas', toolbar: null, disabledReason: null, sendWith: 'enter', safe: (t) => t, onOpenProviders: () => undefined }),
    );
    const sendButton = /<button[^>]*class="round-btn send"[^>]*>/.exec(html)?.[0] ?? '';
    expect({
      label: /aria-label="([^"]+)"/.exec(sendButton)?.[1],
      disabled: /\bdisabled\b/.test(sendButton),
    }).toMatchInlineSnapshot(`
      {
        "disabled": false,
        "label": "Queue: sent after this reply",
      }
    `);
  });

  it('editQueued restores both text and attachments back into the composer', async () => {
    const state = baseState([
      { id: 'q1', threadId: 't1', text: 'Inspect this', attachments: [IMG, TXT], createdAt: AT, state: { kind: 'queued' } },
    ]);
    const bridge = bridgeFor((method, reqPath) => {
      if (method === 'GET' && reqPath === '/api/threads/t1/state') return Promise.resolve({ status: 200, body: state });
      if (method === 'GET' && reqPath.startsWith('/api/agents/a1/messages')) return Promise.resolve({ status: 200, body: { messages: [] } });
      if (method === 'DELETE' && reqPath === '/api/threads/t1/queue/q1') return Promise.resolve({ status: 204, body: null });
      if (method === 'GET' && reqPath === '/api/attachments/att-2') {
        return Promise.resolve({ status: 200, body: { kind: 'image', mimeType: 'image/png', data: 'AAAA' } });
      }
      return Promise.resolve({ status: 404, body: { error: { kind: 'not_found', message: 'Not found' } } });
    });
    const session = openThreadSession({ api: createApi(bridge), bridge, threadId: 't1' });
    await session.load();
    await session.editQueued('q1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const ready = session.attachments.items.get();
    expect({
      draft: session.screen.get().draft,
      readyIds: session.attachments.readyIds(),
      previewLoaded: ready.some((item) => item.kind === 'ready' && item.attachment.id === 'att-2' && item.preview === 'data:image/png;base64,AAAA'),
    }).toMatchInlineSnapshot(`
      {
        "draft": "Inspect this",
        "previewLoaded": true,
        "readyIds": [
          "att-2",
          "att-1",
        ],
      }
    `);
    session.close();
  });

  it('editQueued refuses before cancelling when restoring attachments would exceed MAX_ATTACHMENTS', async () => {
    const cancelSpy = vi.fn();
    const state = baseState([
      { id: 'q1', threadId: 't1', text: 'Overflow', attachments: [TXT], createdAt: AT, state: { kind: 'queued' } },
    ]);
    const bridge = bridgeFor((method, reqPath) => {
      if (method === 'GET' && reqPath === '/api/threads/t1/state') return Promise.resolve({ status: 200, body: state });
      if (method === 'GET' && reqPath.startsWith('/api/agents/a1/messages')) return Promise.resolve({ status: 200, body: { messages: [] } });
      if (method === 'DELETE' && reqPath === '/api/threads/t1/queue/q1') {
        cancelSpy();
        return Promise.resolve({ status: 204, body: null });
      }
      return Promise.resolve({ status: 404, body: { error: { kind: 'not_found', message: 'Not found' } } });
    });
    const session = openThreadSession({ api: createApi(bridge), bridge, threadId: 't1' });
    await session.load();
    const full: Attachment[] = Array.from({ length: MAX_ATTACHMENTS }, (_, index) => ({
      kind: 'text',
      id: `other-${String(index)}`,
      name: `f${String(index)}.txt`,
      size: 10,
    }));
    session.attachments.restore(full, () => Promise.resolve(null));
    await session.editQueued('q1');
    const afterView = session.screen.get().view;
    expect({
      cancelled: cancelSpy.mock.calls.length,
      problem: session.screen.get().problem,
      stillQueued: afterView.kind === 'loaded' ? afterView.value.queue.length : 0,
    }).toMatchInlineSnapshot(`
      {
        "cancelled": 0,
        "problem": {
          "kind": "error",
          "message": "Remove a file from the message box before editing (up to 8 files).",
        },
        "stillQueued": 1,
      }
    `);
    session.close();
  });
});
