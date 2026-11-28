import { PluginEntry, type PluginStatus, type ProviderInfo } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import type { ProviderInstallCapabilities } from '../../bridge.ts';
import type { Loadable } from '../../shared/store.ts';
import { engineRows } from './engine-rows.ts';
import type { ProviderCard } from './providers-model.ts';

const INFO = { appVersion: '1.0.0', homeDir: '/Users/sam', userName: 'sam', dataDir: '/Users/sam/.morrowbot' };

const card = (id: string, info: Loadable<ProviderInfo>, status: PluginStatus = { kind: 'running' }, source: 'built-in' | 'user' = 'built-in'): ProviderCard => ({
  entry: PluginEntry.parse({
    manifest: { protocolVersion: 1, id, name: id, version: '1.0.0', kind: 'provider', main: 'x', permissions: [], settingsSchema: {} },
    source,
    status,
    enabled: status.kind !== 'disabled',
    config: {},
    blockedGroups: [],
  }),
  info,
  usage: null,
  busy: null,
  problem: null,
  age: null,
});

const ready: ProviderInfo = {
  kind: 'ready-models-later',
  version: '2.1.332',
  accountKey: 'k',
  accountLabel: 'Claude Max 5x',
  capabilities: { profiles: [{ access: 'read-only', vendorSettings: 'isolated', modes: ['interactive'], readsOutsideCwd: false }], approvals: true, sessions: true, usage: 'live', withheld: [] },
  warning: null,
};
const signedOut = (argv: readonly string[]): Loadable<ProviderInfo> => ({ kind: 'loaded', value: { kind: 'signed-out', signIn: { kind: 'run-in-terminal', argv: [...argv] } } });

const CARDS: readonly ProviderCard[] = [
  card('provider-claude', { kind: 'loaded', value: ready }),
  card('provider-openai', signedOut(['codex', 'login'])),
  card('provider-antigravity', { kind: 'loaded', value: { kind: 'missing-runtime', install: 'Install Antigravity.' } }),
  card('provider-opencode', { kind: 'loaded', value: { kind: 'outdated', found: '2.0.1', supported: '2.4' } }),
  card('signed-out-private', signedOut(['codex', 'login', '--profile', 'sam'])),
  card('turned-off', { kind: 'loading' }, { kind: 'disabled' }),
  card('crashed', { kind: 'loading' }, { kind: 'crashed', reason: { kind: 'exit', code: 1, signal: null } }),
  card('checking', { kind: 'loading' }),
  card('community', signedOut(['tool', 'login']), { kind: 'running' }, 'user'),
];

const table = (oneClick: boolean, capabilities: ProviderInstallCapabilities = {}) =>
  engineRows(CARDS, INFO, oneClick, capabilities).map(
    ({ id, tone, status, ready: isReady, action }) =>
      `${id} [${tone}]: ${status}${isReady ? ' (ready)' : ''} → ${
        action.kind === 'copy'
          ? `copy "${action.text}"`
          : action.kind === 'guide'
            ? `${action.label} ${action.url.includes('#') ? action.url.replace(/^.*#/, '#') : action.url}`
            : action.kind
      }`,
  );

it('gives each built-in engine its onboarding action: Install or Download when missing, Sign in when signed out, and never Update or How to install (spec §7)', () => {
  const autoCaps: ProviderInstallCapabilities = {
    'provider-antigravity': { kind: 'download', label: 'Download', url: 'https://antigravity.google/product/antigravity-cli' },
    'provider-opencode': { kind: 'auto', tool: 'brew' },
  };
  const allAuto: ProviderInstallCapabilities = {
    'provider-antigravity': { kind: 'auto', tool: 'brew' },
    'provider-opencode': { kind: 'auto', tool: 'brew' },
  };
  expect({ oneClick: table(true), terminalHandoff: table(false), withDownloadFallback: table(true, autoCaps), withAutoInstall: table(true, allAuto) }).toMatchInlineSnapshot(`
    {
      "oneClick": [
        "provider-claude [ok]: Ready · Claude Max 5x (ready) → none",
        "provider-openai [warning]: Sign-in needed → sign-in-terminal",
        "provider-antigravity [muted]: Not installed → none",
        "provider-opencode [warning]: Needs update · found 2.0.1, needs 2.4 → none",
        "signed-out-private [warning]: Sign-in needed → sign-in-terminal",
        "turned-off [muted]: Turned off → turn-on",
        "crashed [error]: Crashed → recheck",
        "checking [muted]: Checking… → none",
      ],
      "terminalHandoff": [
        "provider-claude [ok]: Ready · Claude Max 5x (ready) → none",
        "provider-openai [warning]: Sign-in needed → copy "codex login"",
        "provider-antigravity [muted]: Not installed → none",
        "provider-opencode [warning]: Needs update · found 2.0.1, needs 2.4 → none",
        "signed-out-private [warning]: Sign-in needed → recheck",
        "turned-off [muted]: Turned off → turn-on",
        "crashed [error]: Crashed → recheck",
        "checking [muted]: Checking… → none",
      ],
      "withAutoInstall": [
        "provider-claude [ok]: Ready · Claude Max 5x (ready) → none",
        "provider-openai [warning]: Sign-in needed → sign-in-terminal",
        "provider-antigravity [muted]: Not installed → install",
        "provider-opencode [warning]: Needs update · found 2.0.1, needs 2.4 → none",
        "signed-out-private [warning]: Sign-in needed → sign-in-terminal",
        "turned-off [muted]: Turned off → turn-on",
        "crashed [error]: Crashed → recheck",
        "checking [muted]: Checking… → none",
      ],
      "withDownloadFallback": [
        "provider-claude [ok]: Ready · Claude Max 5x (ready) → none",
        "provider-openai [warning]: Sign-in needed → sign-in-terminal",
        "provider-antigravity [muted]: Not installed → Download https://antigravity.google/product/antigravity-cli",
        "provider-opencode [warning]: Needs update · found 2.0.1, needs 2.4 → none",
        "signed-out-private [warning]: Sign-in needed → sign-in-terminal",
        "turned-off [muted]: Turned off → turn-on",
        "crashed [error]: Crashed → recheck",
        "checking [muted]: Checking… → none",
      ],
    }
  `);
});
