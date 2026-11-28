import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { startChatFixture, type ChatFixture } from '../../../host/src/testing/chat-fixture.ts';
import type { IpcSender } from '../main/ipc-proxy.ts';
import { loginItemOf, openExternalUrl, parseExternalUrl, parseOpenAtLogin, parseRelaunch, parseRevealTarget, resolveReveal } from '../main/shell-actions.ts';

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
  expect(outcome(() => parseExternalUrl({ ...page('https://example.com'), sender: { kind: 'frame', url: `${RENDERER_URL}#section`, isMainFrame: true } }))).toBe(
    'https://example.com/',
  );
  expect(outcome(() => parseExternalUrl({ ...page('https://example.com'), sender: { kind: 'frame', url: `${RENDERER_URL}?evil=1`, isMainFrame: true } }))).toBe(
    `refused: IPC sender is not the app page: ${RENDERER_URL}?evil=1`,
  );
});

it('falls back to macOS open when Electron openExternal fails, and reports structured errors otherwise', async () => {
  const macFallbackUrls: string[] = [];
  expect({
    electronOk: await openExternalUrl('https://opencode.ai', {
      platform: 'darwin',
      openWithElectron: () => Promise.resolve(),
    }),
    macFallbackOk: await openExternalUrl('https://opencode.ai', {
      platform: 'darwin',
      openWithElectron: () => Promise.reject(new Error('LSOpenURLsWithRole failed')),
      openWithMacFallback: (url) => {
        macFallbackUrls.push(url);
        return Promise.resolve();
      },
    }),
    macBothFailed: await openExternalUrl('https://opencode.ai', {
      platform: 'darwin',
      openWithElectron: () => Promise.reject(new Error('LSOpenURLsWithRole failed')),
      openWithMacFallback: () => Promise.reject(new Error('No browser installed')),
    }),
    linuxFailed: await openExternalUrl('https://opencode.ai', {
      platform: 'linux',
      openWithElectron: () => Promise.reject(new Error('xdg-open missing')),
    }),
    macFallbackUrls,
  }).toEqual({
    electronOk: { kind: 'opened' },
    macFallbackOk: { kind: 'opened' },
    macBothFailed: { kind: 'failed', reason: "MorrowBot couldn't open your browser (No browser installed)." },
    linuxFailed: { kind: 'failed', reason: "MorrowBot couldn't open your browser (xdg-open missing)." },
    macFallbackUrls: ['https://opencode.ai'],
  });
});

it('reveals folders by opaque id only, resolving an agent workspace from the host', async () => {
  const agent = await chat.agent();
  const host = { url: chat.host.url, token: chat.host.host.token };
  const pluginsDir = path.join(await mkdtemp(path.join(tmpdir(), 'morrowbot-reveal-')), 'plugins');
  const context = { dataDir: '/data/morrowbot', pluginsDir, host, rendererUrl: RENDERER_URL };
  const pathRefused = outcome(() => parseRevealTarget(page({ kind: 'path', path: '/etc' })));
  const resolved = await resolveReveal(parseRevealTarget(page({ kind: 'agent-workspace', agentId: agent.id })), context);
  const missing = await resolveReveal({ kind: 'agent-workspace', agentId: 'no-such-agent' }, context).catch((error: unknown) => (error instanceof Error ? error.message : ''));
  const copy = { kind: 'instructions-copy', agentId: agent.id, revealId: '2026-01-01T00-00-01.000Z-1.md' };
  expect({
    pathRefused,
    dataDir: await resolveReveal(parseRevealTarget(page({ kind: 'data-dir' })), context),
    pluginsDirCreated: (await resolveReveal(parseRevealTarget(page({ kind: 'plugins-dir' })), context)) === pluginsDir && (await stat(pluginsDir)).isDirectory(),
    workspaceMatches: resolved === agent.workspace.dir,
    missing,
    copy: await resolveReveal(parseRevealTarget(page(copy)), context),
    copyEscape: outcome(() => parseRevealTarget(page({ ...copy, revealId: '../../../etc/passwd' }))),
  }).toEqual({
    pathRefused: 'refused: Malformed reveal request',
    dataDir: '/data/morrowbot',
    pluginsDirCreated: true,
    workspaceMatches: true,
    missing: 'No such agent to reveal',
    copy: `/data/morrowbot/instructions-drafts/${agent.id}/2026-01-01T00-00-01.000Z-1.md`,
    copyEscape: 'refused: Malformed reveal request',
  });
});

it('takes only a safe-mode boolean to relaunch', () => {
  expect([{ safeMode: true }, { safeMode: false }, { safeMode: 'yes' }, true, { safeMode: true, extra: 1 }].map((input) => outcome(() => parseRelaunch(page(input))))).toEqual([
    true,
    false,
    'refused: Malformed relaunch request',
    'refused: Malformed relaunch request',
    'refused: Malformed relaunch request',
  ]);
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
