import { afterEach, beforeEach, expect, it } from 'vitest';
import type { ServerMode } from '../../renderer/bridge.ts';
import { fakeHome, type FakeHome } from './reset-fixture.ts';
import { resetWorkspaces } from './start-helper.ts';

let fake: FakeHome;
beforeEach(async () => {
  fake = await fakeHome();
});
afterEach(async () => {
  await fake.remove();
});

it('knows no workspaces (so resets nothing) without a server to ask, unless a client-only app has no local agents at all', async () => {
  const dataDir = `${fake.home}/.morrowbot`;
  const remote: ServerMode = { kind: 'remote', url: 'http://100.64.0.1:47800', hostName: 'studio' };
  const ask = (mode: ServerMode) => resetWorkspaces(mode, undefined, 'file:///index.html', dataDir);
  const before = { localHostDown: await ask({ kind: 'local' }), choosing: await ask({ kind: 'choosing' }), joinedUnreachable: await ask(remote) };
  await fake.file('.morrowbot/morrowbot.sqlite');
  const after = { choosing: await ask({ kind: 'choosing' }), joined: await ask(remote) };
  expect({ noLocalDatabase: before, localDatabaseLeft: after }).toEqual({
    noLocalDatabase: { localHostDown: null, choosing: [], joinedUnreachable: [] },
    localDatabaseLeft: { choosing: null, joined: null },
  });
});
