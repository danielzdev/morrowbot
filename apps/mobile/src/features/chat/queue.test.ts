import type { ThreadState } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { openChatSession } from './chat-session.ts';
import { composerButtons, queuedControls } from './composer-controls.ts';
import { AT, queued, scripted, state } from './session.test-support.ts';

const running = (queue = [queued('q1', 'Also check flights')]): ThreadState => state(1, true, false, queue);

it('queues a send while a turn runs: Stop and Queue both show, and the draft clears once the host has it', async () => {
  const item = queued('q1', 'Also check flights');
  const { host, sent, push } = scripted([state(1, true, false)], {
    send: (_threadId, text) => {
      sent.push(text);
      return Promise.resolve({ kind: 'ok', value: { kind: 'queued', queued: item } });
    },
  });
  const session = openChatSession(host, 't');
  session.load();
  const seen = [composerButtons(session.screen.get())];
  session.setDraft('Also check flights');
  seen.push(composerButtons(session.screen.get()));
  await session.send();
  push({ kind: 'queue.changed', threadId: 't', cursor: { hostEpoch: 'e1', seq: 2 }, queue: [item] });
  seen.push(composerButtons(session.screen.get()));
  const { draft, view } = session.screen.get();
  expect({ seen, sent, draft, queue: view.kind === 'loaded' ? view.value.queue.map(({ text }) => text) : view }).toEqual({
    seen: [
      { send: null, stop: { enabled: true } },
      { send: { kind: 'queue', enabled: true }, stop: { enabled: true } },
      { send: null, stop: { enabled: true } },
    ],
    sent: ['Also check flights'],
    draft: '',
    queue: ['Also check flights'],
  });
});

it('offers Steer now in a running chat turn, Send now once nothing runs, and nothing for a message on its way', () => {
  const steering = queued('q2', 'Skip Porto', { kind: 'steering', via: 'native' });
  const held = queued('q3', 'Book the hotel', { kind: 'held', reason: 'Not sent: you stopped the reply.' });
  const base = running();
  const agentTurn: ThreadState = base.activeTurn === null ? base : { ...base, activeTurn: { ...base.activeTurn, trigger: { kind: 'agent-message', agentMessageId: 'm1' } } };
  const { host, fresh } = scripted([running(), running([queued('q1', 'Also check flights'), steering]), state(3, false, false, [held]), agentTurn]);
  const session = openChatSession(host, 't');
  session.load();
  const controls = () => {
    const { view } = session.screen.get();
    return view.kind === 'loaded' ? view.value.queue.map((item) => ({ [item.id]: queuedControls(session.screen.get(), item) })) : [];
  };
  const seen = [controls()];
  for (let step = 0; step < 3; step += 1) {
    fresh();
    seen.push(controls());
  }
  const yes = { kind: 'actions', editable: true };
  expect(seen).toEqual([
    [{ q1: { ...yes, now: { label: 'Steer now', enabled: true } } }],
    [{ q1: { ...yes, now: { label: 'Steer now', enabled: false } } }, { q2: { kind: 'none' } }],
    [{ q3: { ...yes, now: { label: 'Send now', enabled: true } } }],
    [{ q1: { ...yes, now: { label: 'Steer now', enabled: false } } }],
  ]);
});

it('sends Steer now once on a double tap, and waits while the chat is catching up', async () => {
  const { host, sent, stale, fresh } = scripted([running()]);
  const session = openChatSession(host, 't');
  session.load();
  stale();
  await session.steer('q1');
  await session.cancelQueued('q1');
  fresh();
  await Promise.all([session.steer('q1'), session.steer('q1'), session.editQueued('q1')]);
  expect({ sent, acting: session.screen.get().queueActing }).toEqual({ sent: ['<steer q1>'], acting: [] });
});

it('Edit takes the message out of the queue and puts it back above what is typed', async () => {
  const { host, sent } = scripted([running()]);
  const session = openChatSession(host, 't');
  session.load();
  session.setDraft('  and hotels ');
  await session.editQueued('q1');
  expect({ sent, draft: session.screen.get().draft }).toEqual({ sent: ['<cancel q1>'], draft: 'Also check flights\n\nand hotels' });
});

it('a refused Edit keeps the draft, says why, and fetches the chat again', async () => {
  const { host, loads } = scripted([running(), { ...running([]), messages: [{ kind: 'user', id: 'q1', threadId: 't', text: 'Also check flights', createdAt: AT, attachments: [] }] }], {
    cancelQueued: () =>
      Promise.resolve({ kind: 'failed', status: 409, error: { kind: 'conflict', message: 'This message is already on its way to the agent.' } }),
  });
  const session = openChatSession(host, 't');
  session.load();
  session.setDraft('and hotels');
  await session.editQueued('q1');
  const { draft, problem, view } = session.screen.get();
  expect({ draft, problem, loads: loads(), queue: view.kind === 'loaded' ? view.value.queue : view }).toEqual({
    draft: 'and hotels',
    problem: { kind: 'error', message: 'This message is already on its way to the agent.' },
    loads: 2,
    queue: [],
  });
});

it('Cancel takes the bubble away once the host agrees, so a second tap sends nothing', async () => {
  const { host, sent } = scripted([running()]);
  const session = openChatSession(host, 't');
  session.load();
  await session.cancelQueued('q1');
  await session.cancelQueued('q1');
  const { view, problem } = session.screen.get();
  expect({ sent, problem, queue: view.kind === 'loaded' ? view.value.queue : view }).toEqual({ sent: ['<cancel q1>'], problem: null, queue: [] });
});

it('Edit still puts the text back when the reply is lost, since the host may have taken it out', async () => {
  const { host } = scripted([running(), running([])], {
    cancelQueued: () => Promise.resolve({ kind: 'failed', status: 0, error: { kind: 'internal', message: 'Could not reach the host.' } }),
  });
  const session = openChatSession(host, 't');
  session.load();
  await session.editQueued('q1');
  const { draft, problem } = session.screen.get();
  expect({ draft, problem }).toEqual({ draft: 'Also check flights', problem: { kind: 'error', message: 'Could not reach the host.' } });
});

it('waits with Edit and Cancel while a send is on its way, so the draft cannot take the queued text twice', async () => {
  let accept: () => void = () => undefined;
  const { host, sent } = scripted([running()], {
    send: (_threadId, text) =>
      new Promise((resolve) => {
        accept = () => {
          resolve({ kind: 'ok', value: { kind: 'queued', queued: queued('q2', text) } });
        };
      }),
  });
  const session = openChatSession(host, 't');
  session.load();
  session.setDraft('and hotels');
  const sending = session.send();
  await session.editQueued('q1');
  accept();
  await sending;
  expect({ sent, draft: session.screen.get().draft }).toEqual({ sent: [], draft: '' });
});
