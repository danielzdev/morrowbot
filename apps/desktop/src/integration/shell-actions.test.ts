import { afterEach, beforeEach, expect, it } from 'vitest';
import { startChatFixture, type ChatFixture } from '../../../host/src/testing/chat-fixture.ts';
import type { IpcSender } from '../main/ipc-proxy.ts';
import { loginItemOf, parseExternalUrl, parseOpenAtLogin, parseRevealTarget, resolveReveal } from '../main/shell-actions.ts';

const RENDERER_URL = 'file:///Applications/MorrowBot.app/Contents/Resources/app/dist/renderer/index.html';
const PAGE: IpcSender = { kind: 'frame', url: RENDERER_URL, isMainFrame: true };
const page = (input: unknown) => ({ sender: PAGE, rendererUrl: RENDERER_URL, input });
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

it('opens only http and https links externally', () => {
  const inputs = ['https://example.com/docs?x=1', 'http://localhost:3000', 'file:///etc/passwd', 'javascript:alert(1)', 'mailto:a@b.c', '/relative', 42];
  expect(inputs.map((input) => outcome(() => parseExternalUrl(page(input))))).toEqual([
    'https://example.com/docs?x=1',
    'http://localhost:3000/',
    'refused: Only http and https links open externally',
    'refused: Only http and https links open externally',
    'refused: Only http and https links open externally',
    'refused: Only http and https links open externally',
    'refused: Only http and https links open externally',
  ]);
  expect(outcome(() => parseExternalUrl({ ...page('https://example.com'), sender: { kind: 'frame', url: 'https://evil.test/', isMainFrame: true } }))).toBe(
    'refused: IPC sender is not the app page: https://evil.test/',
  );
});

it('reveals folders by opaque id only, resolving an agent workspace from the host', async () => {
  const agent = await chat.agent();
  const host = { url: chat.host.url, token: chat.host.host.token };
  const context = { dataDir: '/data/morrowbot', host, rendererUrl: RENDERER_URL };
  const pathRefused = outcome(() => parseRevealTarget(page({ kind: 'path', path: '/etc' })));
  const resolved = await resolveReveal(parseRevealTarget(page({ kind: 'agent-workspace', agentId: agent.id })), context);
  const missing = await resolveReveal({ kind: 'agent-workspace', agentId: 'no-such-agent' }, context).catch((error: unknown) => (error instanceof Error ? error.message : ''));
  expect({
    pathRefused,
    dataDir: await resolveReveal(parseRevealTarget(page({ kind: 'data-dir' })), context),
    workspaceMatches: resolved === agent.workspace.dir,
    missing,
  }).toEqual({ pathRefused: 'refused: Malformed reveal request', dataDir: '/data/morrowbot', workspaceMatches: true, missing: 'No such agent to reveal' });
});

it('takes only a boolean to set open at login, and reports it unsupported where the build cannot register one', () => {
  expect({
    inputs: [true, false, 'true', 1, null, { open: true }].map((input) => outcome(() => parseOpenAtLogin(page(input)))),
    foreign: outcome(() => parseOpenAtLogin({ ...page(true), sender: { kind: 'frame', url: 'https://evil.test/', isMainFrame: true } })),
    states: [loginItemOf(null), loginItemOf(true), loginItemOf(false)],
  }).toEqual({
    inputs: [true, false, 'refused: Malformed login item request', 'refused: Malformed login item request', 'refused: Malformed login item request', 'refused: Malformed login item request'],
    foreign: 'refused: IPC sender is not the app page: https://evil.test/',
    states: [{ kind: 'unsupported' }, { kind: 'supported', openAtLogin: true }, { kind: 'supported', openAtLogin: false }],
  });
});
