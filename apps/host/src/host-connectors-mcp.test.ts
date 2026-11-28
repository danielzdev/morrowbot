import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ConnectorSetup, CreateConnectorRequest } from '@morrowbot/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { connectorToolNames, startConnectorKit, stdioSetup, type ConnectorKit } from './testing/connector-kit.ts';
import { startHttpFixture, type HttpFixture } from './testing/mcp-http-server.ts';

let kit: ConnectorKit | undefined;
let server: HttpFixture | undefined;
afterEach(async () => {
  expect(kit?.errors).toEqual([]);
  await kit?.close();
  await server?.close();
  kit = undefined;
  server = undefined;
  delete process.env.ORIKAMI_HOST_ONLY;
});

const ALL: CreateConnectorRequest['scope'] = { mode: 'all', agentIds: [] };

/** The `result` of a JSON-RPC answer. */
function resultOf(answer: unknown): unknown {
  return typeof answer === 'object' && answer !== null && 'result' in answer ? answer.result : answer;
}

const readLog = async (file: string): Promise<string[]> => (await readFile(file, 'utf8').catch(() => '')).split('\n').filter((line) => line !== '');

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

it('discovers a local stdio server’s well-formed tools and calls them with only the variables it was given', async () => {
  process.env.ORIKAMI_HOST_ONLY = 'host secret';
  kit = await startConnectorKit({ agentIds: ['agent-a'] });
  const id = await kit.add({ label: 'Notes', setup: stdioSetup('work', path.join(kit.dir, 'log')), scope: ALL });
  const turn = kit.turn('agent-a');
  expect({
    tools: kit.view(id).tools,
    echo: resultOf(await turn.call('notes__echo', { text: 'hello' })),
    env: resultOf(await turn.call('notes__env')),
    unknown: resultOf(await turn.call('notes__nope')),
  }).toMatchInlineSnapshot(`
    {
      "echo": {
        "content": [
          {
            "text": "work ran echo with {"text":"hello"}",
            "type": "text",
          },
        ],
        "isError": false,
        "structuredContent": {
          "account": "work",
          "tool": "echo",
        },
      },
      "env": {
        "content": [
          {
            "text": "FIXTURE_ACCOUNT=set PATH=set ORIKAMI_HOST_ONLY=absent",
            "type": "text",
          },
        ],
        "isError": false,
      },
      "tools": [
        {
          "boundName": "notes__echo",
          "description": "From Notes: Says the text back, with the account.",
          "name": "echo",
        },
        {
          "boundName": "notes__wait",
          "description": "From Notes: Answers only when cancelled.",
          "name": "wait",
        },
        {
          "boundName": "notes__spawn_sleeper",
          "description": "From Notes: Starts a long sleep in this server’s process group.",
          "name": "spawn_sleeper",
        },
        {
          "boundName": "notes__env",
          "description": "From Notes: Which variables reached the server.",
          "name": "env",
        },
      ],
      "unknown": {
        "content": [
          {
            "text": "Unknown tool: notes__nope",
            "type": "text",
          },
        ],
        "isError": true,
      },
    }
  `);
});

it('speaks Streamable HTTP with its headers, session and protocol version, and asks for Reconnect when the credentials are refused', async () => {
  server = await startHttpFixture({ tools: 'plain', header: 'authorization', value: 'Bearer remote-token', account: 'remote' });
  kit = await startConnectorKit({ agentIds: ['agent-a'] });
  const good = await kit.add({ label: 'Remote', setup: { kind: 'http', url: server.url, headers: [{ kind: 'inline', name: 'Authorization', value: 'Bearer remote-token' }] }, scope: ALL });
  const turn = kit.turn('agent-a');
  const echo = resultOf(await turn.call('remote__echo', { text: 'over http' }));
  const bad = await kit.add({ label: 'Remote · Old key', setup: { kind: 'http', url: server.url, headers: [{ kind: 'inline', name: 'Authorization', value: 'Bearer expired' }] }, scope: ALL });
  const views = JSON.stringify(kit.connectors.list());
  kit.connectors.disconnect(good);
  await kit.connectors.settled(good);

  const port = new URL(server.url).port;
  expect(JSON.parse(JSON.stringify({
    goodStatus: kit.view(good).status.kind,
    toolNames: connectorToolNames(await turn.list()),
    echo,
    badStatus: kit.view(bad).status,
    secretsInViews: ['remote-token', 'expired'].filter((secret) => views.includes(secret)),
    headerNamesInView: kit.view(bad).setup,
    seen: server.log.requests,
  }).replaceAll(port, '<port>'))).toMatchInlineSnapshot(`
    {
      "badStatus": {
        "kind": "reconnect_needed",
        "message": "127.0.0.1:<port> refused the credentials (HTTP 401)",
      },
      "echo": {
        "content": [
          {
            "text": "remote ran echo with {"text":"over http"}",
            "type": "text",
          },
        ],
        "isError": false,
        "structuredContent": {
          "account": "remote",
          "tool": "echo",
        },
      },
      "goodStatus": "not_connected",
      "headerNamesInView": {
        "headers": [
          {
            "kind": "inline",
            "name": "Authorization",
          },
        ],
        "kind": "http",
        "url": "http://127.0.0.1:<port>/mcp/server-1",
      },
      "secretsInViews": [],
      "seen": [
        "POST initialize account=remote auth=true session=undefined version=undefined",
        "POST notifications/initialized account=remote auth=true session=session-1 version=2025-11-25",
        "POST tools/list account=remote auth=true session=session-1 version=2025-11-25",
        "POST tools/call account=remote auth=true session=session-1 version=2025-11-25",
        "POST answer account=remote auth=true session=session-1 version=2025-11-25",
        "POST initialize account=remote auth=false session=undefined version=undefined",
        "DELETE answer account=remote auth=true session=session-1 version=2025-11-25",
      ],
      "toolNames": [],
    }
  `);
});

it('gives two accounts of one Composio toolkit separate tool names, each routed to its own account and toolkit', async () => {
  server = await startHttpFixture({ tools: 'composio', header: 'x-api-key', value: 'composio-key' });
  kit = await startConnectorKit({ agentIds: ['agent-a', 'agent-b'] });
  const composio = (userId: string): ConnectorSetup => ({ kind: 'composio', toolkit: 'gmail', serverUrl: server?.url ?? '', apiKey: { kind: 'inline', value: 'composio-key' }, account: { kind: 'user', userId } });
  await kit.add({ label: 'Gmail · Work', setup: composio('work-user'), scope: { mode: 'selected', agentIds: ['agent-a'] } });
  await kit.add({ label: 'Gmail · Personal', setup: composio('personal-user'), scope: ALL });
  const a = kit.turn('agent-a');
  const b = kit.turn('agent-b');

  expect({
    agentA: connectorToolNames(await a.list()),
    agentB: connectorToolNames(await b.list()),
    work: resultOf(await a.call('gmail_work__GMAIL_SEND_EMAIL', { to: 'team' })),
    personal: resultOf(await a.call('gmail_personal__GMAIL_SEND_EMAIL', { to: 'family' })),
    otherToolkit: resultOf(await a.call('gmail_work__GITHUB_STAR_REPO')),
    workFromB: resultOf(await b.call('gmail_work__GMAIL_FETCH_EMAILS')),
  }).toMatchInlineSnapshot(`
    {
      "agentA": [
        "gmail_work__GMAIL_SEND_EMAIL",
        "gmail_work__GMAIL_FETCH_EMAILS",
        "gmail_personal__GMAIL_SEND_EMAIL",
        "gmail_personal__GMAIL_FETCH_EMAILS",
      ],
      "agentB": [
        "gmail_personal__GMAIL_SEND_EMAIL",
        "gmail_personal__GMAIL_FETCH_EMAILS",
      ],
      "otherToolkit": {
        "content": [
          {
            "text": "Unknown tool: gmail_work__GITHUB_STAR_REPO",
            "type": "text",
          },
        ],
        "isError": true,
      },
      "personal": {
        "content": [
          {
            "text": "personal-user ran GMAIL_SEND_EMAIL with {"to":"family"}",
            "type": "text",
          },
        ],
        "isError": false,
        "structuredContent": {
          "account": "personal-user",
          "tool": "GMAIL_SEND_EMAIL",
        },
      },
      "work": {
        "content": [
          {
            "text": "work-user ran GMAIL_SEND_EMAIL with {"to":"team"}",
            "type": "text",
          },
        ],
        "isError": false,
        "structuredContent": {
          "account": "work-user",
          "tool": "GMAIL_SEND_EMAIL",
        },
      },
      "workFromB": {
        "content": [
          {
            "text": "Gmail · Work isn't available to this agent.",
            "type": "text",
          },
        ],
        "isError": true,
      },
    }
  `);
});

it('cancels a connector call when its turn ends, on stdio and on HTTP', async () => {
  server = await startHttpFixture({ tools: 'plain', header: 'authorization', value: 'Bearer t', account: 'remote' });
  kit = await startConnectorKit({ agentIds: ['agent-a'] });
  const log = path.join(kit.dir, 'log');
  await kit.add({ label: 'Local', setup: stdioSetup('work', log), scope: ALL });
  await kit.add({ label: 'Remote', setup: { kind: 'http', url: server.url, headers: [{ kind: 'inline', name: 'authorization', value: 'Bearer t' }] }, scope: ALL });
  const turn = kit.turn('agent-a');
  const local = turn.call('local__wait');
  const remote = turn.call('remote__wait');
  await vi.waitFor(() => {
    if (!server?.log.requests.some((line) => line.startsWith('POST tools/call'))) throw new Error('remote call not seen yet');
  });
  turn.end();
  const answers = { local: await local, remote: await remote };
  await vi.waitFor(async () => {
    if (!(await readLog(log)).some((line) => line.startsWith('cancelled'))) throw new Error('no cancellation yet');
    if (!server?.log.requests.some((line) => line.startsWith('POST notifications/cancelled'))) throw new Error('no remote cancellation yet');
  });

  expect({
    answers,
    localLog: await readLog(log),
    remoteSeen: server.log.requests.filter((line) => /tools\/call|cancelled|closed/.test(line)).map((line) => line.replace(/ session=.*$/, '')),
  }).toMatchInlineSnapshot(`
    {
      "answers": {
        "local": {
          "id": 1,
          "jsonrpc": "2.0",
          "result": {
            "content": [
              {
                "text": "Local: Stopped: the turn ended",
                "type": "text",
              },
            ],
            "isError": true,
          },
        },
        "remote": {
          "id": 2,
          "jsonrpc": "2.0",
          "result": {
            "content": [
              {
                "text": "Remote: Stopped: the turn ended",
                "type": "text",
              },
            ],
            "isError": true,
          },
        },
      },
      "localLog": [
        "cancelled 3",
      ],
      "remoteSeen": [
        "POST tools/call account=remote auth=true",
        "wait stream closed by client",
        "POST notifications/cancelled account=remote auth=true",
      ],
    }
  `);
});

it('stops a local server’s whole process group on Disconnect', async () => {
  kit = await startConnectorKit({ agentIds: ['agent-a'] });
  const log = path.join(kit.dir, 'log');
  const id = await kit.add({ label: 'Local', setup: stdioSetup('work', log), scope: ALL });
  await kit.turn('agent-a').call('local__spawn_sleeper');
  const sleeper = Number(/^sleeper (\d+)$/m.exec((await readLog(log)).join('\n'))?.[1]);
  const before = alive(sleeper);
  kit.connectors.disconnect(id);
  await kit.connectors.settled(id);
  await vi.waitFor(() => {
    if (alive(sleeper)) throw new Error('sleeper still running');
  });
  expect({ before, after: alive(sleeper), status: kit.view(id).status }).toMatchInlineSnapshot(`
    {
      "after": false,
      "before": true,
      "status": {
        "kind": "not_connected",
      },
    }
  `);
});
