import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import { AGY, type AgyFixture, startAgyFixture } from '../../testing/agy-fixture.ts';

let agy: AgyFixture;

beforeEach(async () => {
  agy = await startAgyFixture();
});

afterEach(async () => {
  await agy.close();
  expect(agy.host.errors).toEqual([]);
});

/** The reply text of a finished turn. */
function replyOf(generationId: string): string {
  return agy
    .turnEvents(generationId)
    .flatMap((event) => (event.kind === 'generation.delta' ? [event.text] : []))
    .join('');
}

it("a read-only turn runs Ori Bot's own tool without a card, and another MCP server's tool is still denied", async () => {
  const thread = await agy.thread(await agy.agent());
  const host = await agy.start(thread, 'host-tool');
  await agy.events.finished(host);
  const other = await agy.start(thread, 'other-tool');
  await agy.events.finished(other);
  expect({ host: { steps: agy.steps(host), listedAgents: /^host tool: \{"you":\{"id":"[^"]+"/.test(replyOf(host)) }, other: { steps: agy.steps(other), reply: replyOf(other) } }).toEqual({
    host: { steps: ['tool-start Tool: {"title":"Run mcp_oribot_list_agents"}', 'tool-end: ok'], listedAgents: true },
    other: {
      steps: ['tool-start Tool: {"title":"Run mcp_elsewhere_list"}', 'status: Denied other Run mcp_elsewhere_list: Ori Bot runs Antigravity read-only.', 'tool-end: error'],
      reply: '',
    },
  });
});

const Opened = z.looseObject({ mcpServers: z.array(z.looseObject({ name: z.string(), command: z.string(), args: z.array(z.string()), env: z.array(z.looseObject({ name: z.string(), value: z.string() })) })) });

it("opens each turn's session with Ori Bot's tools as one stdio server named oribot on this Node, holding a one-time key and no token; the provider-info probe opens none", async () => {
  const thread = await agy.thread(await agy.agent());
  await agy.events.finished(await agy.start(thread, 'hello'));
  await agy.events.finished(await agy.start(thread, 'again'));
  const opened = (await agy.log()).flatMap((entry) => (entry.method === 'session/new' ? [Opened.parse(entry.params)] : []));
  const keys = new Set(opened.flatMap(({ mcpServers }) => mcpServers.flatMap(({ env }) => env.filter(({ name }) => name === 'ORIBOT_BRIDGE_KEY').map(({ value }) => value))));
  const shown = opened.map(({ mcpServers }) =>
    mcpServers.map((server) => ({
      name: server.name,
      command: server.command === process.execPath ? '<this node>' : server.command,
      args: server.args.map((arg) => arg.replace(/^.*\/packages\/plugin-sdk\/src\//, '<sdk>/')),
      env: server.env.map(({ name, value }) => `${name}=${name === 'ORIBOT_BRIDGE_KEY' ? '<key>' : value.replace(/^.*\/oribot-mcp-[^/]+\//, '<private dir>/')}`),
    })),
  );
  expect({ distinctKeys: keys.size, shown }).toEqual({
    distinctKeys: 2,
    shown: [
      [],
      [{ name: 'oribot', command: '<this node>', args: ['--disable-sigusr1', '<sdk>/acp/bridge-process.ts'], env: ['ORIBOT_BRIDGE_SOCKET=<private dir>/bridge.sock', 'ORIBOT_BRIDGE_KEY=<key>'] }],
      [{ name: 'oribot', command: '<this node>', args: ['--disable-sigusr1', '<sdk>/acp/bridge-process.ts'], env: ['ORIBOT_BRIDGE_SOCKET=<private dir>/bridge.sock', 'ORIBOT_BRIDGE_KEY=<key>'] }],
    ],
  });
});

it("a full-access turn runs Ori Bot's own tool without a card too", async () => {
  const thread = await agy.thread(await agy.agent({ ...AGY, access: 'full' }));
  const turn = await agy.start(thread, 'host-tool');
  await agy.events.finished(turn);
  expect({ steps: agy.steps(turn), listedAgents: /^host tool: \{"you":\{"id":"[^"]+"/.test(replyOf(turn)) }).toEqual({
    steps: ['tool-start Tool: {"title":"Run mcp_oribot_list_agents"}', 'tool-end: ok'],
    listedAgents: true,
  });
});
