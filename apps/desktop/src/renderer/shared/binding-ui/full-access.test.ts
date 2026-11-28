import { ProviderInfo, type AccessProfile, type ProviderBinding } from '@morrowbot/contracts';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import { AccessSegment } from './AccessSegment.tsx';
import { accessState, changeCheck, confirmLabel, needsConfirm } from './binding-state.ts';
import { newBinding, switchBinding, type ProviderChoice } from './selection.ts';

const READ: AccessProfile = { access: 'read-only', vendorSettings: 'isolated', modes: ['interactive', 'background'], readsOutsideCwd: false };
const WRITE: AccessProfile = { ...READ, access: 'workspace-write' };
const FULL: AccessProfile = { ...READ, access: 'full', readsOutsideCwd: true };
const FULL_PERSONAL: AccessProfile = { ...FULL, vendorSettings: 'personal' };

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

it('prefers full access (isolated first) for an owner, skips full for a co-owner, and falls back when full is absent', () => {
  const access = (choice: ProviderChoice, allowFull = true) => {
    const binding = newBinding(choice, { allowFull });
    return binding.kind === 'bound' ? `${binding.access}/${binding.vendorSettings}` : binding.kind;
  };
  expect({
    fullLast: access(claude([READ, WRITE, FULL])),
    onlyFull: access(claude([FULL])),
    isolatedOverPersonal: access(claude([FULL_PERSONAL, FULL])),
    onlyPersonalFull: access(claude([FULL_PERSONAL])),
    noFullFallback: access(claude([READ, WRITE])),
    noInteractive: access(claude([])),
    coOwnerAvoidsFull: access(claude([READ, WRITE, FULL]), false),
    coOwnerOnlyFull: access(claude([FULL]), false),
  }).toEqual({
    fullLast: 'full/isolated',
    onlyFull: 'full/isolated',
    isolatedOverPersonal: 'full/isolated',
    onlyPersonalFull: 'full/personal',
    noFullFallback: 'read-only/isolated',
    noInteractive: 'unbound',
    coOwnerAvoidsFull: 'read-only/isolated',
    coOwnerOnlyFull: 'unbound',
  });
});

it('preserves an existing agent access level when switching providers without silently escalating to full', () => {
  const target = claude([READ, WRITE, FULL]);
  const readOnlyTarget = claude([READ]);
  const result = (choice: ProviderChoice, current: ProviderBinding, allowFull = true) => {
    const next = switchBinding(choice, current, { allowFull });
    return next.kind === 'bound' ? `${next.access}/${next.vendorSettings}` : next.kind;
  };
  const codexRead: ProviderBinding = { kind: 'bound', pluginId: 'codex', selection: { kind: 'default' }, access: 'read-only', vendorSettings: 'personal' };
  expect({
    keepsReadOnly: result(target, codexRead),
    keepsWorkspaceWrite: result(target, bound('workspace-write')),
    keepsFullForOwner: result(target, bound('full')),
    dropsFullForCoOwner: result(target, bound('full'), false),
    fallsBackWhenTargetLacksFull: result(readOnlyTarget, bound('full')),
    unboundStartsFullForOwner: result(target, { kind: 'unbound' }),
    unboundAvoidsFullForCoOwner: result(target, { kind: 'unbound' }, false),
  }).toEqual({
    keepsReadOnly: 'read-only/isolated',
    keepsWorkspaceWrite: 'workspace-write/isolated',
    keepsFullForOwner: 'full/isolated',
    dropsFullForCoOwner: 'read-only/isolated',
    fallsBackWhenTargetLacksFull: 'read-only/isolated',
    unboundStartsFullForOwner: 'full/isolated',
    unboundAvoidsFullForCoOwner: 'read-only/isolated',
  });
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
