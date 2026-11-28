import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import { openExternalLink, type EngineRow } from '../../shared/engine-setup.ts';
import { SetupChecklist, type EngineActions } from './SetupChecklist.tsx';

const ACTIONS: EngineActions = {
  signIn: () => Promise.resolve(null),
  copy: () => Promise.resolve(),
  openGuide: () => Promise.resolve(null),
  install: () => Promise.resolve({ kind: 'installed' }),
  cancelInstall: () => Promise.resolve(),
  recheck: () => undefined,
  turnOn: () => undefined,
};

const ROWS: readonly EngineRow[] = [
  {
    id: 'provider-claude',
    name: 'Claude (subscription)',
    tone: 'ok',
    status: 'Ready · Claude Max 5x',
    ready: true,
    busy: false,
    installing: null,
    progress: null,
    action: { kind: 'none' },
  },
  {
    id: 'provider-openai',
    name: 'OpenAI Codex (subscription)',
    tone: 'warning',
    status: 'Sign-in needed',
    ready: false,
    busy: false,
    installing: null,
    progress: null,
    action: { kind: 'sign-in-terminal' },
  },
  {
    id: 'provider-opencode',
    name: 'OpenCode (free models)',
    tone: 'muted',
    status: 'Not installed',
    ready: false,
    busy: false,
    installing: null,
    progress: null,
    action: { kind: 'install', mode: 'install', guideUrl: 'https://opencode.ai' },
  },
  {
    id: 'provider-antigravity',
    name: 'Google Antigravity (subscription)',
    tone: 'muted',
    status: 'Installing…',
    ready: false,
    busy: true,
    installing: 'install',
    progress: 'Installing with Homebrew (antigravity-cli)…',
    action: { kind: 'install', mode: 'install', guideUrl: 'https://antigravity.google/product/antigravity-cli' },
  },
];

it('renders one calm signal per row without duplicate warning triangle + yellow status pill', () => {
  const html = renderToString(h(SetupChecklist, { engines: { kind: 'loaded', value: ROWS }, actions: ACTIONS }));
  expect({
    hasStatusPill: html.includes('status-pill'),
    hasWarningTriangle: html.includes('M8 2.5 14 13.5H2z'),
    hasMutedNotInstalled: html.includes('<span class="engine-indicator muted" aria-hidden="true"><span class="status-dot muted"></span></span><span class="engine-name">OpenCode (free models)</span><span class="engine-status muted">Not installed</span>'),
    hasInstallButton: html.includes('aria-label="Install, OpenCode (free models)">Install</button>'),
    hasInstallingCancel: html.includes('>Installing…</button><button type="button" class="btn ghost" aria-label="Cancel install, Google Antigravity (subscription)">Cancel</button>'),
    hasLiveProgress: html.includes('<p class="engine-note" role="status">Installing with Homebrew (antigravity-cli)…</p>'),
  }).toEqual({
    hasStatusPill: false,
    hasWarningTriangle: false,
    hasMutedNotInstalled: true,
    hasInstallButton: true,
    hasInstallingCancel: true,
    hasLiveProgress: true,
  });
});

it('surfaces openExternal failures and rejected IPC calls instead of swallowing them', async () => {
  expect({
    opened: await openExternalLink({ openExternal: () => Promise.resolve({ kind: 'opened' }) }, 'https://opencode.ai'),
    failed: await openExternalLink(
      { openExternal: () => Promise.resolve({ kind: 'failed', reason: 'No default browser is set.' }) },
      'https://opencode.ai',
    ),
    rejected: await openExternalLink(
      { openExternal: () => Promise.reject(new Error("Error invoking remote method 'morrowbot:open-external': Error: Only http and https links open externally")) },
      'file:///etc/passwd',
    ),
  }).toEqual({
    opened: null,
    failed: 'No default browser is set.',
    rejected: 'Only http and https links open externally',
  });
});
