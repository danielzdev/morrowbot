import { afterEach, beforeEach, expect, it } from 'vitest';
import { startChatFixture, type ChatFixture } from '../../../host/src/testing/chat-fixture.ts';
import type { IpcSender } from '../main/ipc-proxy.ts';
import {
  capabilitiesOf,
  createProviderInstaller,
  parseCancelInstallRequest,
  parseInstallRequest,
  planProviderInstall,
  type CommandRunOutcome,
  type InstallTools,
  type RunInstallCommand,
} from '../main/provider-installer.ts';
import type { ProviderInstallProgress } from '../renderer/bridge.ts';
import { createProvidersModel } from '../renderer/features/providers/index.ts';
import { createApi } from '../renderer/shared/api.ts';
import { openTestWindow } from './test-window.ts';

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

it('builds strictly allowlisted install and update plans for built-in providers only', () => {
  const macBoth: InstallTools = { npm: '/opt/homebrew/bin/npm', brew: '/opt/homebrew/bin/brew' };
  const macNpmOnly: InstallTools = { npm: '/usr/local/bin/npm', brew: null };
  const linuxNpmOnly: InstallTools = { npm: '/usr/bin/npm', brew: null };
  const none: InstallTools = { npm: null, brew: null };
  const summarize = (providerId: string, mode: 'install' | 'update', platform: NodeJS.Platform, tools: InstallTools) => {
    const plan = planProviderInstall(providerId, mode, platform, tools);
    return plan.kind === 'run' ? `${plan.tool}: ${plan.command} ${plan.args.join(' ')}` : `${plan.kind}: ${plan.kind === 'download' ? `${plan.label} (${plan.url})` : plan.reason}`;
  };
  expect({
    macInstall: {
      claude: summarize('provider-claude', 'install', 'darwin', macBoth),
      openai: summarize('provider-openai', 'install', 'darwin', macBoth),
      opencode: summarize('provider-opencode', 'install', 'darwin', macBoth),
      antigravity: summarize('provider-antigravity', 'install', 'darwin', macBoth),
      community: summarize('echo', 'install', 'darwin', macBoth),
    },
    macUpdate: {
      claude: summarize('provider-claude', 'update', 'darwin', macBoth),
      opencode: summarize('provider-opencode', 'update', 'darwin', macBoth),
      antigravity: summarize('provider-antigravity', 'update', 'darwin', macBoth),
    },
    macWithoutBrew: {
      opencode: summarize('provider-opencode', 'install', 'darwin', macNpmOnly),
      antigravity: summarize('provider-antigravity', 'install', 'darwin', macNpmOnly),
    },
    linuxNpm: {
      claude: summarize('provider-claude', 'install', 'linux', linuxNpmOnly),
      opencode: summarize('provider-opencode', 'install', 'linux', linuxNpmOnly),
      antigravity: summarize('provider-antigravity', 'install', 'linux', linuxNpmOnly),
    },
    noToolsCapabilities: capabilitiesOf('darwin', none),
  }).toMatchInlineSnapshot(`
    {
      "linuxNpm": {
        "antigravity": "download: Download (https://antigravity.google/product/antigravity-cli)",
        "claude": "npm: /usr/bin/npm install -g @anthropic-ai/claude-code@latest",
        "opencode": "npm: /usr/bin/npm install -g @opencode/cli@latest",
      },
      "macInstall": {
        "antigravity": "brew: /opt/homebrew/bin/brew install --cask antigravity-cli",
        "claude": "npm: /opt/homebrew/bin/npm install -g @anthropic-ai/claude-code@latest",
        "community": "unsupported: Only built-in providers support 1-click install.",
        "openai": "npm: /opt/homebrew/bin/npm install -g @openai/codex@latest",
        "opencode": "brew: /opt/homebrew/bin/brew install opencode",
      },
      "macUpdate": {
        "antigravity": "brew: /opt/homebrew/bin/brew upgrade --cask antigravity-cli",
        "claude": "npm: /opt/homebrew/bin/npm install -g @anthropic-ai/claude-code@latest",
        "opencode": "brew: /opt/homebrew/bin/brew upgrade opencode",
      },
      "macWithoutBrew": {
        "antigravity": "download: Download (https://antigravity.google/product/antigravity-cli)",
        "opencode": "npm: /usr/local/bin/npm install -g @opencode/cli@latest",
      },
      "noToolsCapabilities": {
        "provider-antigravity": {
          "kind": "download",
          "label": "Download",
          "url": "https://antigravity.google/product/antigravity-cli",
        },
        "provider-claude": {
          "kind": "download",
          "label": "Download",
          "url": "https://docs.claude.com/claude-code",
        },
        "provider-openai": {
          "kind": "download",
          "label": "Download",
          "url": "https://developers.openai.com/codex/cli",
        },
        "provider-opencode": {
          "kind": "download",
          "label": "Download",
          "url": "https://opencode.ai",
        },
      },
    }
  `);
});

it('validates install and cancel IPC requests strictly and refuses arbitrary commands or wrong senders', () => {
  const req = (input: unknown) => outcome(() => parseInstallRequest({ sender: PAGE, rendererUrl: RENDERER_URL, input }));
  const cancel = (input: unknown) => outcome(() => parseCancelInstallRequest({ sender: PAGE, rendererUrl: RENDERER_URL, input }));
  expect({
    valid: req({ providerId: 'provider-opencode', mode: 'install' }),
    extraArgv: req({ providerId: 'provider-opencode', mode: 'install', argv: ['sh', '-c', 'id'] }),
    badMode: req({ providerId: 'provider-opencode', mode: 'remove' }),
    badId: req({ providerId: '../bin/sh', mode: 'install' }),
    wrongSender: outcome(() =>
      parseInstallRequest({
        sender: { kind: 'frame', url: 'https://evil.test/', isMainFrame: true },
        rendererUrl: RENDERER_URL,
        input: { providerId: 'provider-opencode', mode: 'install' },
      }),
    ),
    validCancel: cancel({ providerId: 'provider-opencode' }),
    badCancel: cancel({ providerId: 'provider-opencode', extra: true }),
  }).toEqual({
    valid: { providerId: 'provider-opencode', mode: 'install' },
    extraArgv: 'refused: Malformed provider install request',
    badMode: 'refused: Malformed provider install request',
    badId: 'refused: Malformed provider install request',
    wrongSender: 'refused: IPC sender is not the app page: https://evil.test/',
    validCancel: 'provider-opencode',
    badCancel: 'refused: Malformed cancel install request',
  });
});

it('runs allowlisted installs with progress, cancellation, timeout, failure reporting, and refuses community/remote installs', async () => {
  const host = { url: chat.host.url, token: chat.host.host.token };
  const progress: ProviderInstallProgress[] = [];
  const ran: string[] = [];
  let nextOutcome: CommandRunOutcome = { kind: 'ok', exitCode: 0, output: '' };
  let clientOnly = false;
  let hold: PromiseWithResolvers<CommandRunOutcome> | null = null;

  const runCommand: RunInstallCommand = async (command, args, options) => {
    ran.push(`${command} ${args.join(' ')}`);
    options.onLine('Downloading package…');
    if (hold !== null) {
      const current = hold;
      hold = null;
      options.signal.addEventListener('abort', () => {
        current.resolve({ kind: 'cancelled', exitCode: null, output: '' });
      });
      return current.promise;
    }
    return nextOutcome;
  };

  const installer = createProviderInstaller({
    platform: 'darwin',
    host: () => host,
    rendererUrl: RENDERER_URL,
    clientOnly: () => clientOnly,
    detectTools: () => Promise.resolve({ npm: '/opt/homebrew/bin/npm', brew: '/opt/homebrew/bin/brew' }),
    runCommand,
    onProgress: (event) => {
      progress.push(event);
    },
  });

  const community = await installer.install({ providerId: 'echo', mode: 'install' });
  const ok = await installer.install({ providerId: 'provider-opencode', mode: 'install' });

  nextOutcome = { kind: 'failed', exitCode: 1, output: 'fetching...\nnpm ERR! EACCES permission denied\n' };
  const failed = await installer.install({ providerId: 'provider-claude', mode: 'install' });

  nextOutcome = { kind: 'timeout', exitCode: null, output: '' };
  const timedOut = await installer.install({ providerId: 'provider-openai', mode: 'update' });

  hold = Promise.withResolvers<CommandRunOutcome>();
  const pending = installer.install({ providerId: 'provider-antigravity', mode: 'install' });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const duplicate = await installer.install({ providerId: 'provider-antigravity', mode: 'install' });
  installer.cancel('provider-antigravity');
  const cancelled = await pending;

  clientOnly = true;
  const remoteCaps = await installer.capabilities();
  const remoteInstall = await installer.install({ providerId: 'provider-opencode', mode: 'install' });

  expect({
    community,
    ok,
    failed,
    timedOut,
    duplicate,
    cancelled,
    remoteCaps,
    remoteInstall,
    ran,
    progressPhases: progress.map((item) => `${item.providerId}:${item.phase}:${item.detail}`),
  }).toEqual({
    community: { kind: 'failed', reason: 'Only built-in providers support 1-click install.', downloadUrl: null },
    ok: { kind: 'installed' },
    failed: { kind: 'failed', reason: 'Installing failed (exit 1): npm ERR! EACCES permission denied', downloadUrl: 'https://docs.claude.com/claude-code' },
    timedOut: { kind: 'failed', reason: 'Updating timed out. Try downloading the CLI directly instead.', downloadUrl: 'https://developers.openai.com/codex/cli' },
    duplicate: { kind: 'failed', reason: 'An install is already running for this provider.', downloadUrl: null },
    cancelled: { kind: 'cancelled' },
    remoteCaps: {},
    remoteInstall: { kind: 'failed', reason: 'Engines run on the server you joined; its owner installs them there.', downloadUrl: null },
    ran: [
      '/opt/homebrew/bin/brew install opencode',
      '/opt/homebrew/bin/npm install -g @anthropic-ai/claude-code@latest',
      '/opt/homebrew/bin/npm install -g @openai/codex@latest',
      '/opt/homebrew/bin/brew install --cask antigravity-cli',
    ],
    progressPhases: [
      'provider-opencode:running:Installing with Homebrew (opencode)…',
      'provider-opencode:running:Downloading package…',
      'provider-opencode:done:Checking installed CLI…',
      'provider-claude:running:Installing with npm (@anthropic-ai/claude-code)…',
      'provider-claude:running:Downloading package…',
      'provider-claude:failed:Installing failed (exit 1): npm ERR! EACCES permission denied',
      'provider-openai:running:Updating with npm (@openai/codex)…',
      'provider-openai:running:Downloading package…',
      'provider-openai:failed:Updating timed out. Try downloading the CLI directly instead.',
      'provider-antigravity:running:Installing with Homebrew (antigravity-cli)…',
      'provider-antigravity:running:Downloading package…',
      'provider-antigravity:cancelled:Cancelled.',
    ],
  });
});

it('automatically rechecks a provider in ProvidersModel after 1-click install succeeds', async () => {
  const win = openTestWindow({ url: chat.host.url, token: chat.host.host.token });
  let recheckCount = 0;
  let progressListener: ((event: unknown) => void) | undefined;
  const api = createApi(win.bridge);
  const trackedApi = {
    ...api,
    recheck: async (id: string) => {
      recheckCount += 1;
      return api.recheck(id);
    },
  };
  const observedDetails: (string | null | undefined)[] = [];
  const model = createProvidersModel({
    api: trackedApi,
    bridge: {
      ...win.bridge,
      providerInstallCapabilities: () => Promise.resolve({ 'provider-opencode': { kind: 'auto', tool: 'brew' } }),
      onProviderInstallProgress: (listener) => {
        progressListener = listener;
        return () => {
          progressListener = undefined;
        };
      },
      installProvider: () => {
        progressListener?.({ providerId: 'provider-opencode', mode: 'install', phase: 'running', detail: 'Pouring opencode…' });
        const loaded = model.cards.get();
        if (loaded.kind === 'loaded') observedDetails.push(loaded.value.find((c) => c.entry.manifest.id === 'provider-opencode')?.installDetail);
        return Promise.resolve({ kind: 'installed' });
      },
    },
  });
  try {
    await model.load();
    const caps = model.installCapabilities.get();
    const installed = await model.install('provider-opencode', 'install');
    const loaded = model.cards.get();
    const card = loaded.kind === 'loaded' ? loaded.value.find((c) => c.entry.manifest.id === 'provider-opencode') : undefined;
    expect({
      caps,
      installed,
      observedDetails,
      recheckCount,
      busyAfter: card?.busy ?? null,
      ageVia: card?.age?.via ?? null,
    }).toEqual({
      caps: { 'provider-opencode': { kind: 'auto', tool: 'brew' } },
      installed: { kind: 'installed' },
      observedDetails: ['Pouring opencode…'],
      recheckCount: 1,
      busyAfter: null,
      ageVia: 'recheck',
    });
  } finally {
    model.close();
    win.close();
  }
});
