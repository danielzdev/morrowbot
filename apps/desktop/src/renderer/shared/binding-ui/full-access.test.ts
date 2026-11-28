import { ProviderInfo, type AccessProfile, type ProviderBinding } from '@morrowbot/contracts';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import { AccessSegment } from './AccessSegment.tsx';
import { accessState, changeCheck, confirmLabel, needsConfirm } from './binding-state.ts';
import { newBinding, type ProviderChoice } from './selection.ts';

const READ: AccessProfile = { access: 'read-only', vendorSettings: 'isolated', modes: ['interactive', 'background'], readsOutsideCwd: false };
const WRITE: AccessProfile = { ...READ, access: 'workspace-write' };
const FULL: AccessProfile = { ...READ, access: 'full', readsOutsideCwd: true };

const claude = (profiles: readonly AccessProfile[]): ProviderChoice => ({
  id: 'claude',
  name: 'Claude',
  runtime: 'Claude Code',
  enabled: true,
  down: null,
  info: ProviderInfo.parse({
    kind: 'ready',
    version: '2.1.332',
    accountKey: '',
    accountLabel: null,
    warning: null,
    capabilities: { profiles, approvals: true, sessions: false, usage: 'live', withheld: [] },
    models: [],
  }),
});

const bound = (access: AccessProfile['access']): Extract<ProviderBinding, { kind: 'bound' }> => ({ kind: 'bound', pluginId: 'claude', selection: { kind: 'default' }, access, vendorSettings: 'isolated' });

it('never starts a new agent on full access, even when the provider lists it first or offers nothing else', () => {
  const access = (choice: ProviderChoice) => {
    const binding = newBinding(choice);
    return binding.kind === 'bound' ? binding.access : binding.kind;
  };
  expect({ fullFirst: access(claude([FULL, WRITE, READ])), onlyFull: access(claude([FULL])) }).toEqual({ fullFirst: 'workspace-write', onlyFull: 'unbound' });
});

it('asks before turning full access on, with the shell warning, and not when it stays on or turns off', () => {
  const choices = [claude([READ, WRITE, FULL])];
  const check = (before: ProviderBinding, after: ProviderBinding) => {
    const result = changeCheck(choices, before, after);
    return { ...result, confirm: needsConfirm(result), label: confirmLabel(result, before, after) };
  };
  expect({ turnOn: check(bound('read-only'), bound('full')), stayOn: check(bound('full'), bound('full')), turnOff: check(bound('full'), bound('workspace-write')) })
    .toMatchInlineSnapshot(`
      {
        "stayOn": {
          "added": [],
          "confirm": false,
          "label": "Use it",
          "switched": false,
        },
        "turnOff": {
          "added": [],
          "confirm": false,
          "label": "Use it",
          "switched": false,
        },
        "turnOn": {
          "added": [
            "This agent can run terminal commands on your computer and read/write files outside its workspace.",
          ],
          "confirm": true,
          "label": "Turn on full access",
          "switched": false,
        },
      }
    `);
});

it('shows full access as its own segment and, when chosen, says it runs terminal commands and warns about the whole computer', () => {
  const html = renderToString(
    h(AccessSegment, {
      state: accessState(claude([READ, WRITE, FULL]).info, bound('full')),
      value: bound('full'),
      disabled: false,
      redact: (text: string) => text,
      onPick: () => undefined,
    }),
  );
  const text = (fragment: string) => fragment.replace(/<[^>]+>/g, '').trim();
  expect({
    segments: [...html.matchAll(/<button[^>]*aria-checked="(true|false)"[^>]*>(.*?)<\/button>/g)].map(([, checked = '', inner = '']) => `${text(inner)}${checked === 'true' ? ' (chosen)' : ''}`),
    notes: [...html.matchAll(/<p class="binding-note[^"]*">(.*?)<\/p>/g)].map(([, inner = '']) => text(inner)),
  }).toMatchInlineSnapshot(`
    {
      "notes": [
        "Runs terminal commands and edits files without asking, with no sandbox.",
        "This agent can run terminal commands on your computer and read/write files outside its workspace.",
      ],
      "segments": [
        "Read only",
        "Edit workspace",
        "Full access (shell commands) (chosen)",
      ],
    }
  `);
});
