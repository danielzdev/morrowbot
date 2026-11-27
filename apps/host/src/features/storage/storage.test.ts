import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Agent } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openStorage, type Storage } from './index.ts';

const AT = '2026-01-01T00:00:00.000Z';
const agent: Agent = {
  id: 'agent-1',
  name: 'Researcher',
  description: 'Finds things',
  workspace: { kind: 'shared', dir: '/work/shared' },
  avatar: { kind: 'initials', color: '#112233' },
  provider: { kind: 'bound', pluginId: 'local-llm', model: 'small' },
  createdAt: AT,
  updatedAt: AT,
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'morrowbot-storage-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function seed(storage: Storage): void {
  storage.agents.insert(agent);
  storage.threads.insert({ id: 'thread-1', agentId: agent.id, title: 'Plans', createdAt: AT, updatedAt: AT });
  storage.messages.insert({ kind: 'user', id: 'm1', threadId: 'thread-1', text: 'hi', createdAt: AT });
  storage.messages.insert({
    kind: 'assistant',
    id: 'm2',
    threadId: 'thread-1',
    text: 'hel',
    outcome: { kind: 'stopped' },
    createdAt: AT,
  });
  storage.plugins.setEnabled('local-llm', false, AT);
  storage.plugins.setConfig('local-llm', { temperature: 0.2, tags: ['a'] }, AT);
}

function snapshot(storage: Storage) {
  return {
    agents: storage.agents.list(),
    threads: storage.threads.listByAgent(agent.id),
    messages: storage.messages.listByThread('thread-1'),
    enabled: Object.fromEntries(storage.plugins.enabledStates()),
    configs: Object.fromEntries(storage.plugins.configs()),
  };
}

it('keeps every table across a restart', () => {
  const file = path.join(dir, 'nested', 'morrowbot.sqlite');
  const first = openStorage(file);
  seed(first);
  first.close();

  const second = openStorage(file);
  expect(snapshot(second)).toMatchInlineSnapshot(`
    {
      "agents": [
        {
          "avatar": {
            "color": "#112233",
            "kind": "initials",
          },
          "createdAt": "2026-01-01T00:00:00.000Z",
          "description": "Finds things",
          "id": "agent-1",
          "name": "Researcher",
          "provider": {
            "kind": "bound",
            "model": "small",
            "pluginId": "local-llm",
          },
          "updatedAt": "2026-01-01T00:00:00.000Z",
          "workspace": {
            "dir": "/work/shared",
            "kind": "shared",
          },
        },
      ],
      "configs": {
        "local-llm": {
          "tags": [
            "a",
          ],
          "temperature": 0.2,
        },
      },
      "enabled": {
        "local-llm": false,
      },
      "messages": [
        {
          "createdAt": "2026-01-01T00:00:00.000Z",
          "id": "m1",
          "kind": "user",
          "text": "hi",
          "threadId": "thread-1",
        },
        {
          "createdAt": "2026-01-01T00:00:00.000Z",
          "id": "m2",
          "kind": "assistant",
          "outcome": {
            "kind": "stopped",
          },
          "text": "hel",
          "threadId": "thread-1",
        },
      ],
      "threads": [
        {
          "agentId": "agent-1",
          "createdAt": "2026-01-01T00:00:00.000Z",
          "id": "thread-1",
          "title": "Plans",
          "updatedAt": "2026-01-01T00:00:00.000Z",
        },
      ],
    }
  `);
  second.close();
});

it('deletes an agent together with its threads and messages', () => {
  const storage = openStorage(path.join(dir, 'morrowbot.sqlite'));
  seed(storage);
  expect(storage.agents.delete(agent.id)).toBe(true);
  expect(snapshot(storage)).toMatchInlineSnapshot(`
    {
      "agents": [],
      "configs": {
        "local-llm": {
          "tags": [
            "a",
          ],
          "temperature": 0.2,
        },
      },
      "enabled": {
        "local-llm": false,
      },
      "messages": [],
      "threads": [],
    }
  `);
  storage.close();
});
