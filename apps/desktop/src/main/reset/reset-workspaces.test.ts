import { chmod } from 'node:fs/promises';
import { createServer } from 'node:http';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { ServerMode } from '../../renderer/bridge.ts';
import { fakeHome, type FakeHome } from './reset-fixture.ts';
import { hostWorkspaces, resetWorkspaces } from './start-helper.ts';

let fake: FakeHome;
beforeEach(async () => {
  fake = await fakeHome();
});
afterEach(async () => {
  await fake.remove();
});

it('knows no workspaces (so resets nothing) without a server to ask, unless an app still choosing a server has no local agents at all', async () => {
  const dataDir = `${fake.home}/.morrowbot`;
  const remote: ServerMode = { kind: 'remote', url: 'http://100.64.0.1:47800', hostName: 'studio' };
  const ask = (mode: ServerMode) => resetWorkspaces(mode, undefined, 'file:///index.html', dataDir);
  const before = { localHostDown: await ask({ kind: 'local' }), choosing: await ask({ kind: 'choosing' }), joinedUnreachable: await ask(remote) };
  await fake.file('.morrowbot/morrowbot.sqlite');
  const after = { choosing: await ask({ kind: 'choosing' }), joined: await ask(remote) };
  expect({ noLocalDatabase: before, localDatabaseLeft: after }).toEqual({
    noLocalDatabase: { localHostDown: null, choosing: [], joinedUnreachable: null },
    localDatabaseLeft: { choosing: null, joined: null },
  });
});

it('treats a data folder it cannot read as one that may hold local agents', async () => {
  await fake.file('.morrowbot/notes.txt');
  await chmod(`${fake.home}/.morrowbot`, 0o000);
  const unreadable = await resetWorkspaces({ kind: 'choosing' }, undefined, 'file:///index.html', `${fake.home}/.morrowbot`);
  await chmod(`${fake.home}/.morrowbot`, 0o700);
  expect(unreadable).toBeNull();
});

it("trusts a host's agent list only when this app sees every agent there: never as a scoped member", async () => {
  const agents = { agents: [], folders: [], lastMessages: [] };
  let caller: unknown = { kind: 'owner' };
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(request.url === '/api/me' ? caller : agents));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const ask = () => hostWorkspaces({ url: `http://127.0.0.1:${String(port)}`, token: 'test' }, 'file:///index.html');
  const owner = await ask();
  caller = { kind: 'member', memberId: 'member-1', name: 'Sam', access: { kind: 'co-owner' } };
  const coOwner = await ask();
  caller = { kind: 'member', memberId: 'member-1', name: 'Sam', access: { kind: 'scoped', agents: [] } };
  const scoped = await ask();
  server.close();
  expect({ owner, coOwner, scoped }).toEqual({ owner: [], coOwner: [], scoped: null });
});
