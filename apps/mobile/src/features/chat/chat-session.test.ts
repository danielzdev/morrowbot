import type { ApprovalReplyRequest, EventServerFrame, ThreadState } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import type { ChatHost, HostResult } from './chat-host.ts';
import { composerButton, openChatSession } from './chat-session.ts';

const AT = '2026-01-01T00:00:00.000Z';

function state(seq: number, running: boolean, pending = running): ThreadState {
  return {
    thread: { id: 't', agentId: 'a', title: 'Main', createdAt: AT, updatedAt: AT },
    messages: [],
    activeTurn: running
      ? {
          generationId: 'g7',
          trigger: { kind: 'chat' },
          state: 'running',
          queueNote: null,
          text: '',
          pendingApprovals: pending ? [{ approvalId: 'a1', summary: 'Allow?', choices: [{ id: 'allow', label: 'Allow' }] }] : [],
        }
      : null,
    blockedGroups: [],
    queue: [],
    cursor: { hostEpoch: 'e1', seq },
  };
}

const unused = (): never => {
  throw new Error('not used by this test');
};
const ok = <T>(value: T): Promise<HostResult<T>> => Promise.resolve({ kind: 'ok', value });

/** A host whose `/state` answers come from `states` in turn; it records what the chat sent. */
function scripted(states: ThreadState[], overrides: Partial<ChatHost> = {}) {
  const sent: string[] = [];
  const replies: ApprovalReplyRequest[] = [];
  let frames: ((frame: EventServerFrame) => void) | null = null;
  const host: ChatHost = {
    hostName: 'Test Host',
    agents: unused,
    threads: unused,
    createThread: unused,
    threadState: () => ok(states.length > 1 ? (states.shift() ?? unused()) : (states[0] ?? unused())),
    send: (_threadId, text) => {
      sent.push(text);
      return ok({ kind: 'started', generationId: 'g8', userMessage: { kind: 'user', id: 'u', threadId: 't', text, createdAt: AT, attachments: [] } });
    },
    continueTurn: unused,
    stop: () => {
      sent.push('<stop>');
      return ok({ kind: 'idle' });
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
    follow: (_threadId, _since, onFrame) => {
      frames = onFrame;
      return () => {
        frames = null;
      };
    },
    ...overrides,
  };
  return { host, sent, replies, push: (frame: EventServerFrame) => frames?.(frame) };
}

it('sends an approval reply with the running generation, once, even when tapped twice', async () => {
  const { host, replies } = scripted([state(1, true)]);
  const session = openChatSession(host, 't');
  await session.load();
  await Promise.all([session.answer('a1', 'allow'), session.answer('a1', 'allow')]);
  expect(replies).toEqual([{ generationId: 'g7', choiceId: 'allow' }]);
});

it('marks a stale card as already ended and reloads when the host no longer has the request', async () => {
  const { host } = scripted([state(1, true), state(2, true, false)], {
    answerApproval: () => Promise.resolve({ kind: 'failed', status: 404, error: { kind: 'not_found', message: 'Approval not found' } }),
  });
  const session = openChatSession(host, 't');
  await session.load();
  await session.answer('a1', 'allow');
  const { view, answering, problem } = session.screen.get();
  const steps = view.kind === 'loaded' ? view.value.activeTurn?.steps : undefined;
  expect({ steps: steps?.map((step) => (step.kind === 'approval' ? step.ending : null)), answering, problem }).toEqual({
    steps: [{ kind: 'late' }],
    answering: [],
    problem: null,
  });
});

it('shows Send only with a draft, Stop while a turn runs, and clears the draft once sent', async () => {
  const { host, sent, push } = scripted([state(1, false)]);
  const session = openChatSession(host, 't');
  const button = () => composerButton(session.screen.get());
  const seen = [button()];
  await session.load();
  seen.push(button());
  session.setDraft('  Plan day two  ');
  seen.push(button());
  await session.send();
  push({ kind: 'generation.started', threadId: 't', generationId: 'g8', cursor: { hostEpoch: 'e1', seq: 2 }, userMessage: null, state: 'running' });
  seen.push(button());
  await session.stop();
  expect({ seen, sent, draft: session.screen.get().draft }).toEqual({
    seen: [
      { kind: 'send', enabled: false },
      { kind: 'send', enabled: false },
      { kind: 'send', enabled: true },
      { kind: 'stop', enabled: true },
    ],
    sent: ['Plan day two', '<stop>'],
    draft: '',
  });
});

it('keeps the draft and offers Retry when the provider is unavailable', async () => {
  const { host } = scripted([state(1, false)], {
    send: () =>
      Promise.resolve({
        kind: 'failed',
        status: 503,
        error: { kind: 'provider-unavailable', reason: 'rechecking', message: 'The provider is checking its sign-in.' },
      }),
  });
  const session = openChatSession(host, 't');
  await session.load();
  session.setDraft('Hello');
  await session.send();
  const { draft, problem } = session.screen.get();
  expect({ draft, problem }).toEqual({
    draft: 'Hello',
    problem: { kind: 'retry', message: 'The provider is checking its sign-in.', action: { kind: 'send', text: 'Hello' } },
  });
});

it('retries with the draft as it is now, and sends nothing once the draft was cleared', async () => {
  const sent: string[] = [];
  const { host } = scripted([state(1, false)], {
    send: (_threadId, text) => {
      sent.push(text);
      return Promise.resolve({
        kind: 'failed',
        status: 503,
        error: { kind: 'provider-unavailable', reason: 'rechecking', message: 'Try again soon.' },
      });
    },
  });
  const session = openChatSession(host, 't');
  await session.load();
  session.setDraft('First try');
  await session.send();
  session.setDraft('Edited');
  await session.retry();
  session.setDraft('');
  await session.retry();
  expect({ sent, problem: session.screen.get().problem }).toEqual({ sent: ['First try', 'Edited'], problem: null });
});
