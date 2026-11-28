import { execFile } from 'node:child_process';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { startChatFixture, type ChatFixture } from '../../../host/src/testing/chat-fixture.ts';
import type { IpcSender } from '../main/ipc-proxy.ts';
import { openSignInTerminal, parseSignInRequest, terminalScript } from '../main/sign-in-terminal.ts';

const RENDERER_URL = 'file:///Applications/Ori Kami.app/Contents/Resources/app/dist/renderer/index.html';
const PAGE: IpcSender = { kind: 'frame', url: RENDERER_URL, isMainFrame: true };
const outcome = (run: () => unknown): unknown => {
  try {
    return run();
  } catch (error) {
    return error instanceof Error ? `refused: ${error.message}` : 'refused';
  }
};

let chat: ChatFixture;
beforeEach(async () => {
  chat = await startChatFixture();
});
afterEach(async () => {
  await chat.close();
});

it('runs exactly the provider argv in Terminal, whatever quotes, spaces or $ it holds', async () => {
  const argv = ['printf', '%s|', "it's", 'a b', '$HOME', '`id`'];
  const script = terminalScript("Sam's CLI", argv);
  const file = path.join(await mkdtemp(path.join(tmpdir(), 'orikami-sign-in-')), 'x.command');
  await writeFile(file, script);
  const { stdout } = await promisify(execFile)('/bin/sh', [file]);
  expect(stdout).toBe("Ori Kami: signing in to Sam's CLI. When it finishes, go back to Ori Kami; it rechecks by itself.\n\nit's|a b|$HOME|`id`|\nDone. You can close this window.\n");
});

it('takes only a provider id from the renderer, and opens Terminal only for a signed-out built-in provider', async () => {
  const host = { url: chat.host.url, token: chat.host.host.token };
  const dataDir = await mkdtemp(path.join(tmpdir(), 'orikami-sign-in-'));
  const opened: string[] = [];
  const context = (platform: NodeJS.Platform) => ({
    host,
    rendererUrl: RENDERER_URL,
    dataDir,
    platform,
    open: (file: string) => {
      opened.push(file);
      return Promise.resolve('');
    },
  });
  const request = (input: unknown) => outcome(() => parseSignInRequest({ sender: PAGE, rendererUrl: RENDERER_URL, input }));
  expect({
    id: request({ providerId: 'provider-claude' }),
    command: request({ providerId: 'echo', argv: ['sh', '-c', 'id'] }),
    path: request({ providerId: '../../bin/sh' }),
    otherPage: outcome(() => parseSignInRequest({ sender: { kind: 'frame', url: 'https://evil.test/', isMainFrame: true }, rendererUrl: RENDERER_URL, input: { providerId: 'echo' } })),
    community: await openSignInTerminal('echo', context('darwin')),
    unknown: await openSignInTerminal('no-such-provider', context('darwin')),
    linux: await openSignInTerminal('echo', context('linux')),
    opened,
    written: await readdir(dataDir),
  }).toEqual({
    id: 'provider-claude',
    command: 'refused: Malformed sign-in request',
    path: 'refused: Malformed sign-in request',
    otherPage: 'refused: IPC sender is not the app page: https://evil.test/',
    community: { kind: 'unavailable', reason: 'Only built-in providers can sign in from here. Use the command instead.' },
    unknown: { kind: 'unavailable', reason: 'Ori Kami could not find this provider.' },
    linux: { kind: 'unavailable', reason: 'One-click sign-in works on macOS only. Use the command instead.' },
    opened: [],
    written: [],
  });
});
