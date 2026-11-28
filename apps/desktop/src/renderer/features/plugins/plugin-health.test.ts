import { PluginEntry, type PluginOrigin, type PluginProblem, type PluginStatus } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { healthOf, extensionsAlert, problemHealth } from './plugin-health.ts';

const entry = (id: string, status: PluginStatus, source: PluginOrigin = 'user', kind: 'tool' | 'provider' = 'tool'): PluginEntry =>
  PluginEntry.parse({
    manifest: { protocolVersion: 1, id, name: id, version: '1.0.0', kind, main: 'main.js', permissions: [], settingsSchema: {} },
    source,
    status,
    enabled: true,
    config: {},
    blockedGroups: [],
  });

const list = (plugins: readonly PluginEntry[], problems: readonly PluginProblem[] = [], safeMode = false) => ({ plugins: [...plugins], problems: [...problems], safeMode });

it('gives every plugin status its own pill, and a folder that could not load its own row', () => {
  const statuses: readonly PluginStatus[] = [
    { kind: 'running' },
    { kind: 'starting' },
    { kind: 'stopped' },
    { kind: 'disabled' },
    { kind: 'safe-mode' },
    { kind: 'unhealthy', detail: 'no answer in 5 s' },
    { kind: 'crashed', reason: { kind: 'exit', code: 1, signal: null } },
    { kind: 'quarantined', detail: 'process group 42 is still running' },
    { kind: 'unsupported', reason: 'needs macOS' },
    { kind: 'invalid-config', problems: ['greeting: expected string'] },
  ];
  const problems: readonly PluginProblem[] = [
    { kind: 'invalid-manifest', source: 'user', folder: 'broken', problem: 'no manifest.json' },
    { kind: 'duplicate', source: 'user', folder: 'echo', id: 'echo', takenBy: 'built-in' },
    { kind: 'unreadable', source: 'user', problem: 'permission denied' },
  ];
  expect({
    pills: statuses.map((status) => `${status.kind} → ${Object.values(healthOf(status)).join(' | ')}`),
    problems: problems.map((problem) => `${problem.kind} → ${Object.values(problemHealth(problem)).join(' | ')}`),
  }).toMatchInlineSnapshot(`
    {
      "pills": [
        "running → ok | Running | ",
        "starting → muted | Starting | ",
        "stopped → muted | Stopped | ",
        "disabled → muted | Turned off | ",
        "safe-mode → muted | Off in safe mode | ",
        "unhealthy → warning | Not responding | no answer in 5 s",
        "crashed → error | Crashed | Exited (1)",
        "quarantined → error | Quarantined | process group 42 is still running",
        "unsupported → muted | Unsupported | needs macOS",
        "invalid-config → error | Settings invalid | greeting: expected string",
      ],
      "problems": [
        "invalid-manifest → error | Invalid manifest | no manifest.json | broken",
        "duplicate → warning | Duplicate | Another built-in plugin already uses the id “echo”, so this one was skipped. | echo",
        "unreadable → error | Couldn't read folder | permission denied | MorrowBot couldn't read its plugin folders.",
      ],
    }
  `);
});

it('shows the Extensions dot for plugins or connectors that need attention, or safe mode, never for built-in providers', () => {
  const running = entry('a', { kind: 'running' });
  const crashedProvider = entry('provider-claude', { kind: 'crashed', reason: { kind: 'exit', code: 1, signal: null } }, 'built-in', 'provider');
  expect({
    fine: extensionsAlert(list([running, entry('b', { kind: 'disabled' }), entry('c', { kind: 'stopped' }), crashedProvider])),
    warn: extensionsAlert(list([running, entry('b', { kind: 'unhealthy', detail: 'slow' })], [{ kind: 'invalid-manifest', source: 'user', folder: 'x', problem: 'bad' }])),
    danger: extensionsAlert(list([entry('b', { kind: 'unhealthy', detail: 'slow' }), entry('c', { kind: 'crashed', reason: { kind: 'exit', code: 1, signal: null } }), entry('d', { kind: 'quarantined', detail: 'pgid' })])),
    duplicateOnly: extensionsAlert(list([running], [{ kind: 'duplicate', source: 'user', folder: 'a', id: 'a', takenBy: 'built-in' }])),
    safeMode: extensionsAlert(list([entry('b', { kind: 'safe-mode' })], [], true)),
    safeModeNoPlugins: extensionsAlert(list([], [], true)),
    connectorsOnly: extensionsAlert(list([running]), [{ tone: 'warn', text: '2 connectors need attention' }]),
    connectorCrashed: extensionsAlert(list([entry('b', { kind: 'unhealthy', detail: 'slow' })]), [{ tone: 'danger', text: '1 connector needs attention' }]),
    connectorsInSafeMode: extensionsAlert(list([], [], true), [{ tone: 'warn', text: '1 connector needs attention' }]),
  }).toMatchInlineSnapshot(`
    {
      "connectorCrashed": {
        "label": "Extensions: 1 not responding, 1 connector needs attention",
        "tone": "danger",
      },
      "connectorsInSafeMode": {
        "label": "Extensions: off in safe mode",
        "tone": "warn",
      },
      "connectorsOnly": {
        "label": "Extensions: 2 connectors need attention",
        "tone": "warn",
      },
      "danger": {
        "label": "Extensions: 1 not responding, 1 crashed, 1 quarantined",
        "tone": "danger",
      },
      "duplicateOnly": null,
      "fine": null,
      "safeMode": {
        "label": "Extensions: off in safe mode",
        "tone": "warn",
      },
      "safeModeNoPlugins": {
        "label": "Extensions: off in safe mode",
        "tone": "warn",
      },
      "warn": {
        "label": "Extensions: 1 not responding, 1 with an invalid manifest",
        "tone": "warn",
      },
    }
  `);
});
