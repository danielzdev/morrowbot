import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Agent, StartedSend, StopGenerationResponse, ThreadList, ThreadState, type SubagentRun, type Thread } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ECHO, hidePid, startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';
import { PLUGIN_FIXTURES, sequence } from './testing/test-host.ts';

let dataDir: string;
let chat: ChatFixture;

/**
 * Two providers: the `echo` fixture, and `parrot`, the same code under another id with its own greeting, so a
 * sub-agent on another provider shows in its reply.
 */
async function pluginsWithParrot(root: string): Promise<string> {
  const dir = path.join(root, 'plugins');
  const echo = path.join(PLUGIN_FIXTURES, 'echo');
  const manifest: unknown = JSON.parse(await readFile(path.join(echo, 'manifest.json'), 'utf8'));
  for (const id of ['echo', 'parrot']) {
    await mkdir(path.join(dir, id), { recursive: true });
    if (id === 'echo') await copyFile(path.join(echo, 'manifest.json'), path.join(dir, id, 'manifest.json'));
    else await writeFile(path.join(dir, id, 'manifest.json'), JSON.stringify({ ...Object(manifest), id, name: 'Parrot' }));
    await writeFile(path.join(dir, id, 'index.ts'), `import ${JSON.stringify(path.join(echo, 'index.ts'))};\n`);
  }
  return dir;
}

let restarted: ReturnType<typeof sequence>;
beforeEach(async () => {
  dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'morrowbot-subagents-')));
  restarted = sequence();
  chat = await startChatFixture({ dataDir, pluginsDir: await pluginsWithParrot(dataDir), sequence: restarted });
  const parrot = await chat.host.call('PUT', '/api/plugins/parrot/config', { config: { greeting: 'squawk' } });
  expect(parrot.status).toBe(200);
});
afterEach(async () => {
  await chat.close();
  expect(chat.host.errors).toEqual([]);
  await rm(dataDir, { recursive: true, force: true });
});

async function lead(): Promise<{ readonly agent: Agent; readonly thread: Thread }> {
  const agent = Agent.parse((await chat.host.call('POST', '/api/agents', { name: 'Lead', provider: ECHO })).body);
  return { agent, thread: await chat.thread(agent) };
}

/** One echo turn line that calls a MorrowBot tool. */
const call = (name: string, args: object): string => `host-tool ${name} ${JSON.stringify(args)}`;

async function lastReply(thread: Thread): Promise<string[]> {
  const history = await chat.history(thread);
  return hidePid(history.at(-1) ?? '')
    .replace(/^assistant\(\w+\): /, '')
    .split('\n');
}

const state = async (threadId: string): Promise<ThreadState> => ThreadState.parse((await chat.host.call('GET', `/api/threads/${threadId}/state`)).body);

/** A run as the parent chat lists it: role, where it ran, and how it ended. */
function run({ role, binding, prompt, status }: SubagentRun): string {
  const model = binding.selection.kind === 'model' ? binding.selection.id : 'default';
  const ended = status.kind === 'finished' ? `${status.outcome.kind}: ${hidePid(status.reply)}` : status.kind;
  return `${role} on ${binding.pluginId}/${model} (${binding.access}) "${prompt}" -> ${ended}`;
}

/** The statuses each sub-agent of the chat went through, as `subagent.changed` told them. */
function statusesByRole(threadId: string): Record<string, string[]> {
  const seen: Record<string, string[]> = {};
  for (const event of chat.events.received) {
    if (event.kind !== 'subagent.changed' || event.threadId !== threadId) continue;
    const { role, status } = event.run;
    (seen[role] ??= []).push(status.kind === 'finished' ? status.outcome.kind : status.kind);
  }
  return seen;
}

const runsOf = async (threadId: string): Promise<string[]> => (await state(threadId)).subagents.map(run);

it('starts sub-agents on its own provider and on another one, in parallel, and collects their replies', async () => {
  const { agent, thread } = await lead();
  await chat.send(
    thread,
    [
      call('spawn_subagent', { role: 'Same model', prompt: 'describe' }),
      call('spawn_subagent', { role: 'Second opinion', prompt: 'describe', provider: 'parrot', model: 'tiny' }),
      call('wait_subagents', {}),
    ].join('\n'),
  );
  const after = await state(thread.id);
  const runs = after.subagents.map(run);
  const listed = ThreadList.parse((await chat.host.call('GET', `/api/agents/${agent.id}/threads`)).body).threads.map(({ title }) => title);

  expect({
    reply: await lastReply(thread),
    runs,
    statuses: statusesByRole(thread.id),
    agentChats: listed,
    childTranscript: await chat.history({ ...thread, id: after.subagents[1]?.id ?? '' }),
  }).toMatchInlineSnapshot(`
    {
      "agentChats": [
        "Chat",
      ],
      "childTranscript": [
        "user: describe",
        "assistant(completed): squawk from pid <pid>: {"session":{"kind":"new","seed":null},"system":"","selection":{"kind":"model","id":"tiny","choices":{}},"expectedAccountKey":"acct-a"}",
      ],
      "reply": [
        "spawn_subagent: {"subagent":{"runId":"id-5","role":"Same model","provider":"echo","model":"default","access":"read-only","status":"running"}}",
        "spawn_subagent: {"subagent":{"runId":"id-9","role":"Second opinion","provider":"parrot","model":"tiny","access":"read-only","status":"running"}}",
        "wait_subagents: {"timedOut":false,"subagents":[{"runId":"id-5","role":"Same model","provider":"echo","model":"default","access":"read-only","status":"completed","reply":"hello from pid <pid>: {\\"session\\":{\\"kind\\":\\"new\\",\\"seed\\":null},\\"system\\":\\"\\",\\"selection\\":{\\"kind\\":\\"default\\"},\\"expectedAccountKey\\":\\"acct-a\\"}"},{"runId":"id-9","role":"Second opinion","provider":"parrot","model":"tiny","access":"read-only","status":"completed","reply":"squawk from pid <pid>: {\\"session\\":{\\"kind\\":\\"new\\",\\"seed\\":null},\\"system\\":\\"\\",\\"selection\\":{\\"kind\\":\\"model\\",\\"id\\":\\"tiny\\",\\"choices\\":{}},\\"expectedAccountKey\\":\\"acct-a\\"}"}]}",
      ],
      "runs": [
        "Same model on echo/default (read-only) "describe" -> completed: hello from pid <pid>: {"session":{"kind":"new","seed":null},"system":"","selection":{"kind":"default"},"expectedAccountKey":"acct-a"}",
        "Second opinion on parrot/tiny (read-only) "describe" -> completed: squawk from pid <pid>: {"session":{"kind":"new","seed":null},"system":"","selection":{"kind":"model","id":"tiny","choices":{}},"expectedAccountKey":"acct-a"}",
      ],
      "statuses": {
        "Same model": [
          "queued",
          "running",
          "completed",
        ],
        "Second opinion": [
          "queued",
          "running",
          "completed",
        ],
      },
    }
  `);
});

it('never gives a sub-agent more access than its parent, starts none from a sub-agent, and names what it refuses', async () => {
  const { thread } = await lead();
  const grandchild = [call('spawn_subagent', { role: 'Grandchild', prompt: 'describe' }), call('list_subagents', {}), call('search_memories', { query: 'notes' })].join('\n');
  await chat.send(
    thread,
    [
      call('spawn_subagent', { role: 'Writer', prompt: 'describe', access: 'workspace-write' }),
      call('spawn_subagent', { role: 'Nobody', prompt: 'describe', provider: 'nobody' }),
      call('spawn_subagent', { role: 'Thinker', prompt: 'describe', effort: 'high' }),
      call('spawn_subagent', { role: 'Nested', prompt: grandchild }),
      call('wait_subagents', {}),
    ].join('\n'),
  );

  expect({ reply: await lastReply(thread), runs: await runsOf(thread.id) }).toMatchInlineSnapshot(`
    {
      "reply": [
        "spawn_subagent: error A sub-agent cannot have more access than you: you have read-only, it asked for workspace-write.",
        "spawn_subagent: error There is no provider nobody. See list_subagents.",
        "spawn_subagent: error Model tiny of echo has no effort setting: leave out effort.",
        "spawn_subagent: {"subagent":{"runId":"id-5","role":"Nested","provider":"echo","model":"default","access":"read-only","status":"running"}}",
        "wait_subagents: {"timedOut":false,"subagents":[{"runId":"id-5","role":"Nested","provider":"echo","model":"default","access":"read-only","status":"completed","reply":"spawn_subagent: rpc error Unknown tool: spawn_subagent\\nlist_subagents: rpc error Unknown tool: list_subagents\\nsearch_memories: {\\"memories\\":[]}"}]}",
      ],
      "runs": [
        "Nested on echo/default (read-only) "host-tool spawn_subagent {"role":"Grandchild","prompt":"describe"}
    host-tool list_subagents {}
    host-tool search_memories {"query":"notes"}" -> completed: spawn_subagent: rpc error Unknown tool: spawn_subagent
    list_subagents: rpc error Unknown tool: list_subagents
    search_memories: {"memories":[]}",
      ],
    }
  `);
});

it('caps how many sub-agents run at once, and stops the ones still running when the parent turn ends', async () => {
  const { thread } = await lead();
  const gated = (role: string) => call('spawn_subagent', { role, prompt: 'gate' });
  await chat.send(thread, [gated('One'), gated('Two'), gated('Three'), gated('Four'), gated('Five')].join('\n'));
  await vi.waitFor(async () => {
    expect((await state(thread.id)).subagents.every(({ status }) => status.kind === 'finished')).toBe(true);
  });

  expect({ reply: (await lastReply(thread)).map((line) => line.replace(/"runId":"[^"]+",/, '')), runs: await runsOf(thread.id), statuses: statusesByRole(thread.id) })
    .toMatchInlineSnapshot(`
      {
        "reply": [
          "spawn_subagent: {"subagent":{"role":"One","provider":"echo","model":"default","access":"read-only","status":"running"}}",
          "spawn_subagent: {"subagent":{"role":"Two","provider":"echo","model":"default","access":"read-only","status":"queued"}}",
          "spawn_subagent: {"subagent":{"role":"Three","provider":"echo","model":"default","access":"read-only","status":"queued"}}",
          "spawn_subagent: {"subagent":{"role":"Four","provider":"echo","model":"default","access":"read-only","status":"queued"}}",
          "spawn_subagent: error At most 4 sub-agents run at once: wait_subagents for one to finish first.",
        ],
        "runs": [
          "One on echo/default (read-only) "gate" -> cancelled: hello from pid <pid>:",
          "Two on echo/default (read-only) "gate" -> cancelled: ",
          "Three on echo/default (read-only) "gate" -> cancelled: ",
          "Four on echo/default (read-only) "gate" -> cancelled: ",
        ],
        "statuses": {
          "Four": [
            "queued",
            "cancelled",
          ],
          "One": [
            "queued",
            "running",
            "cancelled",
          ],
          "Three": [
            "queued",
            "cancelled",
          ],
          "Two": [
            "queued",
            "cancelled",
          ],
        },
      }
    `);
});

it('stops every running sub-agent, and waits for their processes, when the user stops the parent', async () => {
  const { thread } = await lead();
  const sent = StartedSend.parse(
    (
      await chat.host.call('POST', `/api/threads/${thread.id}/messages`, {
        text: [
          call('spawn_subagent', { role: 'Sleeper', prompt: 'sleep' }),
          call('spawn_subagent', { role: 'Napper', prompt: 'sleep', provider: 'parrot' }),
          call('wait_subagents', { timeoutSeconds: 600 }),
        ].join('\n'),
      })
    ).body,
  );
  await vi.waitFor(async () => {
    expect((await state(thread.id)).subagents.map(({ status }) => status.kind)).toEqual(['running', 'running']);
  });
  const stopped = StopGenerationResponse.parse((await chat.host.call('POST', `/api/threads/${thread.id}/stop`)).body);
  await chat.events.finished(sent.generationId);
  const children = await Promise.all((await state(thread.id)).subagents.map(async ({ id }) => state(id)));

  expect({
    stopped: stopped.kind,
    runs: await runsOf(thread.id),
    childrenAfterStop: children.map(({ activeTurn, blockedGroups }) => ({ activeTurn, blockedGroups })),
  }).toMatchInlineSnapshot(`
    {
      "childrenAfterStop": [
        {
          "activeTurn": null,
          "blockedGroups": [],
        },
        {
          "activeTurn": null,
          "blockedGroups": [],
        },
      ],
      "runs": [
        "Sleeper on echo/default (read-only) "sleep" -> cancelled: hello from pid <pid>:",
        "Napper on parrot/default (read-only) "sleep" -> cancelled: squawk from pid <pid>:",
      ],
      "stopped": "stopped",
    }
  `);
});

it('keeps sub-agents across a restart, and deletes their chats with the parent chat', async () => {
  const { thread } = await lead();
  await chat.send(thread, [call('spawn_subagent', { role: 'Reviewer', prompt: 'describe' }), call('wait_subagents', {})].join('\n'));
  const before = await runsOf(thread.id);
  await chat.close();
  expect(chat.host.errors).toEqual([]);
  chat = await startChatFixture({ dataDir, pluginsDir: path.join(dataDir, 'plugins'), sequence: restarted });
  const after = await state(thread.id);
  const childId = after.subagents[0]?.id ?? '';
  const deleted = await chat.host.call('DELETE', `/api/threads/${thread.id}`);

  expect({
    sameAfterRestart: after.subagents.map(run).join() === before.join(),
    deleted: deleted.status,
    childAfterDelete: (await chat.host.call('GET', `/api/threads/${childId}/state`)).status,
  }).toMatchInlineSnapshot(`
    {
      "childAfterDelete": 404,
      "deleted": 204,
      "sameAfterRestart": true,
    }
  `);
});
