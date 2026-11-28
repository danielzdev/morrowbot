import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Memory } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { hidePid, startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';
import { sequence } from './testing/test-host.ts';

let dataDir: string;
let chat: ChatFixture | undefined;
beforeEach(async () => {
  dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'oribot-memories-')));
});
afterEach(async () => {
  await chat?.close();
  chat = undefined;
  await rm(dataDir, { recursive: true, force: true });
});

const texts = (body: unknown): unknown => (body !== null && typeof body === 'object' && 'memories' in body && Array.isArray(body.memories) ? body.memories.map((memory: Memory) => `${memory.inclusion}: ${memory.text}`) : body);

it('keeps, searches, edits and forgets memories across a restart', async () => {
  const ids = sequence();
  chat = await startChatFixture({ dataDir, sequence: ids });
  const agent = await chat.agent();
  const remember = async (text: string, inclusion?: string) =>
    Memory.parse((await chat?.host.call('POST', `/api/agents/${agent.id}/memories`, { text, ...(inclusion === undefined ? {} : { inclusion }) }))?.body);
  const ferns = await remember('The ferns by the window like misting.', 'essential');
  await remember('Tomatoes went in on the first of May.');
  const basil = await remember('Basil does not like the cold.');
  await chat.host.call('PATCH', `/api/agents/${agent.id}/memories/${basil.id}`, { inclusion: 'essential' });
  await chat.close();

  chat = await startChatFixture({ dataDir, sequence: ids });
  const list = async (query = '') => texts((await chat?.host.call('GET', `/api/agents/${agent.id}/memories${query}`))?.body);
  const before = await list();
  const search = { tomato: await list('?q=tomato'), cold: await list('?q=COLD%20basil'), syntax: await list('?q=%22ferns%20OR%20*'), none: await list('?q=orchid') };
  await chat.host.call('PATCH', `/api/agents/${agent.id}/memories/${ferns.id}`, { text: 'The ferns by the door like misting.' });
  const afterEdit = await list('?q=door');
  expect((await chat.host.call('DELETE', `/api/agents/${agent.id}/memories/${ferns.id}`)).status).toBe(204);
  expect({ before, search, afterEdit, afterDelete: await list(), deletedAgain: (await chat.host.call('DELETE', `/api/agents/${agent.id}/memories/${ferns.id}`)).status }).toMatchInlineSnapshot(`
    {
      "afterDelete": [
        "searchable: Tomatoes went in on the first of May.",
        "essential: Basil does not like the cold.",
      ],
      "afterEdit": [
        "essential: The ferns by the door like misting.",
      ],
      "before": [
        "essential: The ferns by the window like misting.",
        "searchable: Tomatoes went in on the first of May.",
        "essential: Basil does not like the cold.",
      ],
      "deletedAgain": 404,
      "search": {
        "cold": [
          "essential: Basil does not like the cold.",
        ],
        "none": [],
        "syntax": [],
        "tomato": [
          "searchable: Tomatoes went in on the first of May.",
        ],
      },
    }
  `);
});

async function skill(dir: string, folder: string, content: string): Promise<void> {
  await mkdir(path.join(dir, folder), { recursive: true });
  await writeFile(path.join(dir, folder, 'SKILL.md'), content);
}

it('lists global and agent skills, and gives each turn the skills index and essential memories', async () => {
  chat = await startChatFixture({ dataDir });
  const agent = await chat.agent();
  const global = path.join(dataDir, 'skills');
  const own = path.join(agent.workspace.dir, '.oribot', 'skills');
  await skill(global, 'repotting', '---\nname: repotting\ndescription: How to move a plant to a bigger pot.\n---\n# Repotting\n');
  await skill(global, 'watering', '---\nname: watering\ndescription: The global watering plan.\n---\n');
  await skill(own, 'watering', '---\nname: watering\ndescription: >\n  This agent\'s own watering plan,\n  kept with its workspace.\n---\n');
  await skill(own, 'broken', '# No frontmatter here\n');
  await mkdir(path.join(own, 'notes'));
  await chat.host.call('POST', `/api/agents/${agent.id}/memories`, { text: 'Water before nine.', inclusion: 'essential' });
  await chat.host.call('POST', `/api/agents/${agent.id}/memories`, { text: 'Only found by a search.' });
  const thread = await chat.thread(agent);
  await chat.send(thread, 'describe-input');
  const reply = (await chat.history(thread))[1] ?? '';
  expect({
    skills: (await chat.host.call('GET', `/api/agents/${agent.id}/skills`)).body,
    prompt: hidePid(reply).replaceAll(dataDir, '<data>'),
  }).toMatchInlineSnapshot(`
    {
      "prompt": "assistant(completed): hello from pid <pid>: {"prompt":"<oribot-context>\\n<skills>\\nSkills you can use. When one fits the task, read its SKILL.md first and follow it.\\n- watering: This agent's own watering plan, kept with its workspace. (<data>/workspaces/id-1/.oribot/skills/watering/SKILL.md)\\n- repotting: How to move a plant to a bigger pot. (<data>/skills/repotting/SKILL.md)\\n</skills>\\n<memories>\\nThings to remember from earlier chats.\\n- Water before nine.\\n</memories>\\n</oribot-context>\\n\\ndescribe-input","images":[]}",
      "skills": {
        "problems": [
          {
            "folder": "broken",
            "reason": "SKILL.md does not start with a --- frontmatter block.",
            "scope": "agent",
          },
        ],
        "skills": [
          {
            "description": "This agent's own watering plan, kept with its workspace.",
            "folder": "watering",
            "name": "watering",
            "scope": "agent",
          },
          {
            "description": "How to move a plant to a bigger pot.",
            "folder": "repotting",
            "name": "repotting",
            "scope": "global",
          },
        ],
      },
    }
  `);
});
