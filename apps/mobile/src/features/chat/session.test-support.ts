import type { ApprovalReplyRequest, QueuedMessage, QueuedMessageState, ThreadState } from '@morrowbot/contracts';
import type { ChatHost, ChatResult } from '../../lib/chat-host.ts';
import type { ThreadEvent, ThreadWatcher } from '../../lib/host-connection.ts';

export const AT = '2026-01-01T00:00:00.000Z';

/** A thread's `/state`: idle, or with a running chat turn that (by default) waits on approval `a1`. */
export function state(seq: number, running: boolean, pending = running, queue: QueuedMessage[] = []): ThreadState {
  return {
    thread: { id: 't', agentId: 'a', title: 'Main', createdAt: AT, updatedAt: AT, archivedAt: null },
    messages: [],
    reactions: [],
    toolSteps: [],
    activeTurn: running
      ? {
          generationId: 'g7',
          trigger: { kind: 'chat' },
          state: 'running',
          queueNote: null,
          text: '',
          pendingApprovals: pending ? [{ approvalId: 'a1', summary: 'Allow?', choices: [{ id: 'allow', label: 'Allow' }] }] : [],
          toolSteps: [],
        }
      : null,
    blockedGroups: [],
    subagents: [],
    queue,
    cursor: { hostEpoch: 'e1', seq },
  };
}

export function queued(id: string, text: string, queueState: QueuedMessageState = { kind: 'queued' }): QueuedMessage {
  return { id, threadId: 't', text, attachments: [], createdAt: AT, state: queueState };
}

const unused = (): never => {
  throw new Error('not used by this test');
};
const ok = <T>(value: T): Promise<ChatResult<T>> => Promise.resolve({ kind: 'ok', value });

/** A host whose `/state` answers come from `states` in turn, delivered as soon as a thread is watched; it records what the chat sent. */
export function scripted(states: ThreadState[], overrides: Partial<ChatHost> = {}) {
  const sent: string[] = [];
  const replies: ApprovalReplyRequest[] = [];
  let watching: ThreadWatcher | null = null;
  let loads = 0;
  const next = (): ThreadState => (states.length > 1 ? (states.shift() ?? unused()) : (states[0] ?? unused()));
  const host: ChatHost = {
    hostName: 'Test Host',
    agents: unused,
    threads: unused,
    createThread: unused,
    send: (_threadId, text) => {
      sent.push(text);
      return ok({ kind: 'started', generationId: 'g8', userMessage: { kind: 'user', id: 'u', threadId: 't', text, createdAt: AT, attachments: [] } });
    },
    continueTurn: unused,
    stop: () => {
      sent.push('<stop>');
      return ok({ kind: 'idle' });
    },
    steerQueued: (_threadId, queuedId) => {
      sent.push(`<steer ${queuedId}>`);
      return ok(null);
    },
    cancelQueued: (_threadId, queuedId) => {
      sent.push(`<cancel ${queuedId}>`);
      return ok(null);
    },
    answerApproval: (_threadId, _approvalId, reply) => {
      replies.push(reply);
      return ok(null);
    },
    providerInfo: unused,
    updateAgent: unused,
    deleteAgent: unused,
    instructions: unused,
    plugins: unused,
    setPluginEnabled: unused,
    onPluginChanged: unused,
    watch: (_threadId, watcher) => {
      watching = watcher;
      loads += 1;
      watcher.onFresh(next());
      return () => {
        watching = null;
      };
    },
    ...overrides,
  };
  return {
    host,
    sent,
    replies,
    /** How many times the chat fetched `/state`. */
    loads: () => loads,
    push: (event: ThreadEvent) => watching?.onEvent(event),
    /** What the transport does when the link drops, and then once it has fetched `/state` again. */
    stale: () => watching?.onStale(),
    fresh: () => watching?.onFresh(next()),
    gone: () => watching?.onGone(),
  };
}
