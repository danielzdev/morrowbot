import { expect, it } from 'vitest';
import { openChatSession } from './chat-session.ts';
import { composerButtons } from './composer-controls.ts';
import { scripted, state } from './session.test-support.ts';

it('sends an approval reply with the running generation, once, even when tapped twice', async () => {
  const { host, replies } = scripted([state(1, true)]);
  const session = openChatSession(host, 't');
  session.load();
  await Promise.all([session.answer('a1', 'allow'), session.answer('a1', 'allow')]);
  expect(replies).toEqual([{ generationId: 'g7', choiceId: 'allow' }]);
});

it('marks a stale card as already ended and reloads when the host no longer has the request', async () => {
  const { host } = scripted([state(1, true), state(2, true, false)], {
    answerApproval: () => Promise.resolve({ kind: 'failed', status: 404, error: { kind: 'not_found', message: 'Approval not found' } }),
  });
  const session = openChatSession(host, 't');
  session.load();
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
  const button = () => composerButtons(session.screen.get());
  const seen = [button()];
  session.load();
  seen.push(button());
  session.setDraft('  Plan day two  ');
  seen.push(button());
  await session.send();
  push({ kind: 'generation.started', threadId: 't', generationId: 'g8', cursor: { hostEpoch: 'e1', seq: 2 }, userMessage: null, state: 'running' });
  seen.push(button());
  await session.stop();
  expect({ seen, sent, draft: session.screen.get().draft }).toEqual({
    seen: [
      { send: { kind: 'send', enabled: false }, stop: null },
      { send: { kind: 'send', enabled: false }, stop: null },
      { send: { kind: 'send', enabled: true }, stop: null },
      { send: null, stop: { enabled: true } },
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
  session.load();
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
  session.load();
  session.setDraft('First try');
  await session.send();
  session.setDraft('Edited');
  await session.retry();
  session.setDraft('');
  await session.retry();
  expect({ sent, problem: session.screen.get().problem }).toEqual({ sent: ['First try', 'Edited'], problem: null });
});

it('waits with Stop and approvals while the chat is stale, and offers them again once fresh', async () => {
  const { host, replies, stale, fresh } = scripted([state(1, true), state(2, true)]);
  const session = openChatSession(host, 't');
  session.load();
  const seen = () => ({ button: composerButtons(session.screen.get()), stale: session.screen.get().stale, replies: replies.length });
  stale();
  const whileStale = seen();
  await session.answer('a1', 'allow');
  await session.stop();
  const afterTaps = seen();
  fresh();
  const whenFresh = seen();
  await session.answer('a1', 'allow');
  expect({ whileStale, afterTaps, whenFresh, replies }).toEqual({
    whileStale: { button: { send: null, stop: { enabled: false } }, stale: true, replies: 0 },
    afterTaps: { button: { send: null, stop: { enabled: false } }, stale: true, replies: 0 },
    whenFresh: { button: { send: null, stop: { enabled: true } }, stale: false, replies: 0 },
    replies: [{ generationId: 'g7', choiceId: 'allow' }],
  });
});

it('says the chat is gone when the host no longer has the thread', () => {
  const { host, gone } = scripted([state(1, false)]);
  const session = openChatSession(host, 't');
  session.load();
  gone();
  expect(session.screen.get().view).toEqual({ kind: 'failed', message: 'This chat no longer exists.' });
});
