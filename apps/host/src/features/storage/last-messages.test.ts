import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openStorage, type Storage } from './index.ts';

const AT = '2026-01-01T00:00:00.000Z';

let dir: string;
let storage: Storage;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'morrowbot-last-messages-'));
  storage = openStorage(path.join(dir, 'morrowbot.sqlite'), () => AT);
  for (const id of ['gardener', 'owl', 'fox']) {
    storage.agents.insert({
      id,
      name: id,
      description: '',
      workspace: { kind: 'shared', dir: '/work' },
      avatar: { kind: 'bot', shape: 'sprout', color: '#22aa55', finish: 'matte' },
      provider: { kind: 'unbound' },
      folderId: null,
      emojiReplies: 'allowed',
      disabledExtensions: [],
      revision: 0,
      createdAt: AT,
      updatedAt: AT,
    });
  }
  for (const [id, agentId] of Object.entries({ g1: 'gardener', g2: 'gardener', o1: 'owl', f1: 'fox' })) {
    storage.threads.insert({ id, agentId, title: id, createdAt: AT, updatedAt: AT });
  }
});
afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

let seq = 0;
function say(threadId: string, kind: 'user' | 'assistant', text: string): void {
  seq += 1;
  const base = { id: `m${String(seq)}`, threadId, text, createdAt: `2026-01-01T00:00:${String(seq).padStart(2, '0')}.000Z` };
  storage.messages.insert(
    kind === 'user' ? { kind, ...base, attachments: [] } : { kind, ...base, outcome: { kind: 'completed', finishReason: 'stop' }, attachments: [] },
  );
}

it("previews each agent's newest message with text across its threads, cut to 400 characters", () => {
  say('g1', 'user', 'first thread');
  say('g2', 'user', 'second thread');
  say('g1', 'assistant', `${'leaf '.repeat(100)}end`);
  say('o1', 'user', 'hoot');
  say('o1', 'assistant', '');
  expect(storage.messages.lastByAgent()).toMatchInlineSnapshot(`
    [
      {
        "agentId": "owl",
        "at": "2026-01-01T00:00:04.000Z",
        "kind": "user",
        "preview": "hoot",
        "threadId": "o1",
      },
      {
        "agentId": "gardener",
        "at": "2026-01-01T00:00:03.000Z",
        "kind": "assistant",
        "preview": "leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf leaf…",
        "threadId": "g1",
      },
    ]
  `);
});

it('sends the text as written, never cuts a word in half, and skips messages blank in any script or holding a NUL', () => {
  say('g1', 'assistant', `${'a'.repeat(390)} reach   me at someone@example.com today`);
  say('g1', 'assistant', ' \n\t ');
  say('g1', 'assistant', '\u00a0\u2003');
  say('g1', 'assistant', '\u2003'.repeat(1001));
  say('o1', 'user', `${' '.repeat(500)}hoot  hoot${'\n'.repeat(400)}`);
  say('f1', 'user', 'x'.repeat(410));
  say('f1', 'assistant', ' \0hidden');
  say('f1', 'assistant', 'seen\0 hidden');
  expect(storage.messages.lastByAgent().map(({ agentId, preview }) => ({ agentId, preview }))).toMatchInlineSnapshot(`
    [
      {
        "agentId": "fox",
        "preview": "…",
      },
      {
        "agentId": "owl",
        "preview": "hoot  hoot",
      },
      {
        "agentId": "gardener",
        "preview": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa reach…",
      },
    ]
  `);
});
