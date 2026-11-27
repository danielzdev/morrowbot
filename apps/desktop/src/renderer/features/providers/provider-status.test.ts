import { PluginEntry, type PluginStatus, type ProviderCapabilities, type ProviderInfo } from '@morrowbot/contracts';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import { redact } from '../../shared/privacy.ts';
import type { Loadable } from '../../shared/store.ts';
import { ProviderDetail } from './ProviderDetail.tsx';
import { providerStatus } from './provider-status.ts';
import type { ProviderCard } from './providers-model.ts';
import { setupCommand } from './setup-command.ts';

const INFO = { appVersion: '1.0.0', homeDir: '/Users/sam', userName: 'sam', dataDir: '/Users/sam/.morrowbot' };

const entry = (status: PluginStatus = { kind: 'running' }, enabled = true): PluginEntry =>
  PluginEntry.parse({
    manifest: { protocolVersion: 1, id: 'provider-openai', name: 'OpenAI Codex', version: '1.0.0', kind: 'provider', main: 'x', permissions: [], settingsSchema: { cliPath: { kind: 'string', label: 'Codex CLI path' } } },
    source: 'built-in',
    status,
    enabled,
    config: {},
    blockedGroups: [],
  });

const capabilities = (interactive: boolean, withheld: readonly string[] = []): ProviderCapabilities => ({
  profiles: [{ access: 'read-only', vendorSettings: 'isolated', modes: interactive ? ['interactive', 'background'] : ['background'], readsOutsideCwd: false }],
  approvals: true,
  sessions: true,
  usage: 'live',
  withheld: withheld.map((reason) => ({ access: 'workspace-write', vendorSettings: 'isolated', reason })),
});

const ready = (accountLabel: string | null, warning: string | null = null, interactive = true, withheld: readonly string[] = []): ProviderInfo => ({
  kind: 'ready',
  version: '0.171.0',
  accountKey: 'k',
  accountLabel,
  capabilities: capabilities(interactive, withheld),
  warning,
  models: [{ id: 'gpt', label: 'GPT', isDefault: true, options: [{ id: 'effort', label: 'Effort', defaultChoiceId: 'medium', choices: [{ id: 'low', label: 'Low' }, { id: 'medium', label: 'Medium' }, { id: 'high', label: 'High' }] }] }],
});

const loaded = (value: ProviderInfo): Loadable<ProviderInfo> => ({ kind: 'loaded', value });

it('writes one status line per provider state (spec §6.2), with plan labels from the allowlist only', () => {
  const cases: Readonly<Record<string, ReturnType<typeof providerStatus>>> = {
    turnedOff: providerStatus(entry({ kind: 'disabled' }, false), { kind: 'loading' }),
    safeMode: providerStatus(entry({ kind: 'safe-mode' }), { kind: 'loading' }),
    crashed: providerStatus(entry({ kind: 'crashed', reason: { kind: 'exit', code: 1, signal: null } }), { kind: 'loading' }),
    checking: providerStatus(entry(), { kind: 'loading' }),
    rechecking: providerStatus(entry(), loaded(ready('ChatGPT Plus')), true),
    notInstalled: providerStatus(entry(), loaded({ kind: 'missing-runtime', install: 'Install Codex.' })),
    outdated: providerStatus(entry(), loaded({ kind: 'outdated', found: '2.0.1', supported: '2.1.332+' })),
    signedOut: providerStatus(entry(), loaded({ kind: 'signed-out', signIn: { kind: 'run-in-terminal', argv: ['codex', 'login'] } })),
    readyPlan: providerStatus(entry(), loaded(ready('ChatGPT Plus'))),
    workspaceName: providerStatus(entry(), loaded(ready('ChatGPT Business (Acme Holdings)'))),
    emailLabel: providerStatus(entry(), loaded(ready('sam@example.com'))),
    warning: providerStatus(entry(), loaded(ready(null, 'untested CLI version'))),
    noInteractive: providerStatus(entry(), loaded(ready(null, null, false))),
    paused: providerStatus(entry(), loaded(ready(null, null, false, ['Needs a newer CLI']))),
    error: providerStatus(entry(), loaded({ kind: 'error', message: 'boom' })),
    failedFetch: providerStatus(entry(), { kind: 'failed', message: 'The host is restarting' }),
  };
  expect(Object.fromEntries(Object.entries(cases).map(([name, status]) => [name, `${status.tone} | ${status.title}${status.detail === null ? '' : ` | ${status.detail}`}${status.runnable ? ' | runnable' : ''}`]))).toMatchInlineSnapshot(`
    {
      "checking": "muted | Checking…",
      "crashed": "error | Crashed | Exited (1)",
      "emailLabel": "ok | Ready | runnable",
      "error": "error | Couldn't check provider | boom",
      "failedFetch": "error | Couldn't check provider | The host is restarting",
      "noInteractive": "warning | No interactive access is available",
      "notInstalled": "warning | Not installed | Install Codex.",
      "outdated": "warning | Needs update · found 2.0.1, needs 2.1.332+",
      "paused": "warning | Chats paused | Needs a newer CLI",
      "readyPlan": "ok | Ready · ChatGPT Plus | runnable",
      "rechecking": "muted | Rechecking…",
      "safeMode": "muted | Off in safe mode",
      "signedOut": "warning | Sign-in needed",
      "turnedOff": "muted | Turned off",
      "warning": "warning | Ready · Review this provider's status | untested CLI version | runnable",
      "workspaceName": "ok | Ready · ChatGPT Business | runnable",
    }
  `);
});

it('offers Copy only for a command it can show exactly and privately; otherwise the guide', () => {
  expect({
    plain: setupCommand(['codex', 'login'], INFO),
    homePath: setupCommand(['/Users/sam/.local/bin/claude', 'auth', 'login'], INFO),
    homeWithSpace: setupCommand(['/Users/sam/My Tools/claude', 'login'], INFO),
    quoted: setupCommand(['agy', '--profile', "it's mine"], INFO),
    optionWithHome: setupCommand(['claude', '--config=/Users/sam/x'], INFO),
    email: setupCommand(['codex', 'login', '--user', 'sam@example.com'], INFO),
    userName: setupCommand(['codex', 'login', '--profile', 'sam'], INFO),
  }).toMatchInlineSnapshot(`
    {
      "email": {
        "kind": "guide",
      },
      "homePath": {
        "kind": "copy",
        "text": "~/.local/bin/claude auth login",
      },
      "homeWithSpace": {
        "kind": "copy",
        "text": "~/'My Tools/claude' login",
      },
      "optionWithHome": {
        "kind": "guide",
      },
      "plain": {
        "kind": "copy",
        "text": "codex login",
      },
      "quoted": {
        "kind": "copy",
        "text": "agy --profile 'it'\\''s mine'",
      },
      "userName": {
        "kind": "guide",
      },
    }
  `);
});

it('never shows a home path, user name, email or workspace name in a provider detail', () => {
  const card: ProviderCard = {
    entry: entry(),
    info: loaded(ready('ChatGPT Business (Acme Holdings)', 'Config at /Users/sam/.codex is shared with sam@example.com', true, ['Blocked by /Users/sam/policy.json for sam'])),
    usage: null,
    busy: null,
    problem: 'Stop /Users/sam/bin/codex first (owner sam)',
    age: null,
  };
  const ignore = (): void => undefined;
  const html = renderToString(
    h(ProviderDetail, {
      card,
      info: INFO,
      redact: (text: string) => redact(text, INFO),
      actions: { onEnabled: ignore, onRecheck: ignore, onSaveConfig: ignore, onRelease: ignore, onCopy: () => Promise.resolve(), onOpenLink: ignore, onDirty: ignore },
    }),
  );
  expect({ leaks: ['/Users/sam', 'sam@', 'Acme', '>sam<', ' sam '].filter((secret) => html.includes(secret)), shown: ['~/.codex', '&lt;email>', '&lt;user>', 'Effort: Low, Medium, High'].filter((safe) => !html.includes(safe)) }).toEqual({
    leaks: [],
    shown: [],
  });
});
