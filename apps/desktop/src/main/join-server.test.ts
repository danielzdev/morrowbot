import { createServer } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { joinServer, parseServerRequest } from './join-server.ts';

const RENDERER_URL = 'file:///Applications/Ori Kami.app/Contents/Resources/app/src/renderer/index.html';
const TOKEN = 'x'.repeat(43);

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

it('accepts newer host fields on invite and pairing claim replies', async () => {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/members/claim') {
      response.end(JSON.stringify({ memberId: 'mem-1', token: TOKEN, hostName: 'Studio', hostVersion: '2.0.0', capabilities: ['cards'] }));
      return;
    }
    response.end(JSON.stringify({ deviceId: 'dev-1', token: TOKEN, hostName: 'Studio', hostVersion: '2.0.0', serverId: 'srv-1' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  );
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('fake host is not on TCP');
  const url = `http://127.0.0.1:${String(address.port)}`;

  const invite = await joinServer({ kind: 'join', link: '', url, code: 'a'.repeat(22) }, { name: 'Desktop', platform: 'macos' });
  const pairing = await joinServer({ kind: 'join', link: '', url, code: '123456' }, { name: 'Desktop', platform: 'macos' });

  expect({ invite, pairing }).toEqual({
    invite: { kind: 'joined', choice: { kind: 'remote', url, token: TOKEN, hostName: 'Studio' } },
    pairing: { kind: 'joined', choice: { kind: 'remote', url, token: TOKEN, hostName: 'Studio' } },
  });
});

it('keeps outgoing server-choice IPC requests strict', () => {
  expect(() =>
    parseServerRequest({
      sender: { kind: 'frame', url: RENDERER_URL, isMainFrame: true },
      rendererUrl: RENDERER_URL,
      input: { kind: 'local', extra: true },
    }),
  ).toThrow('Malformed server choice');
});
