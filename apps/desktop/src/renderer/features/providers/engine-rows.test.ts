import { PluginEntry, type PluginStatus, type ProviderInfo } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
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

const table = (oneClick: boolean) => engineRows(CARDS, INFO, oneClick).map(({ id, status, ready: isReady, action }) => `${id}: ${status}${isReady ? ' (ready)' : ''} → ${action.kind === 'copy' ? `copy "${action.text}"` : action.kind === 'guide' ? `${action.label} ${action.url.replace(/^.*#/, '#')}` : action.kind}`);

it('gives each built-in engine its status and exactly one action, with Terminal sign-in only where one-click works (spec §7)', () => {
  expect({ oneClick: table(true), terminalHandoff: table(false) }).toMatchInlineSnapshot(`
    {
      "oneClick": [
        "provider-claude: Ready · Claude Max 5x (ready) → none",
        "provider-openai: Sign-in needed → sign-in-terminal",
        "provider-antigravity: Not installed → How to install #google-antigravity",
        "provider-opencode: Needs update · found 2.0.1, needs 2.4 → How to update #opencode",
        "signed-out-private: Sign-in needed → sign-in-terminal",
        "turned-off: Turned off → turn-on",
        "crashed: Crashed → recheck",
        "checking: Checking… → none",
      ],
      "terminalHandoff": [
        "provider-claude: Ready · Claude Max 5x (ready) → none",
        "provider-openai: Sign-in needed → copy "codex login"",
        "provider-antigravity: Not installed → How to install #google-antigravity",
        "provider-opencode: Needs update · found 2.0.1, needs 2.4 → How to update #opencode",
        "signed-out-private: Sign-in needed → recheck",
        "turned-off: Turned off → turn-on",
        "crashed: Crashed → recheck",
        "checking: Checking… → none",
      ],
    }
  `);
});
