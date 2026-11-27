import { PluginEntry, type PluginStatus } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { pluginAlert } from './plugin-summary.ts';

const entry = (id: string, status: PluginStatus): PluginEntry =>
  PluginEntry.parse({
    manifest: { protocolVersion: 1, id, name: id, version: '1.0.0', kind: 'tool', main: 'main.js', permissions: [], settingsSchema: {} },
    status,
    enabled: true,
    config: {},
    blockedGroups: [],
  });

it('shows a dot only for crashed, quarantined, unhealthy or invalid plugins, or safe mode, with words', () => {
  const running = entry('a', { kind: 'running' });
  expect({
    fine: pluginAlert([running, entry('b', { kind: 'disabled' }), entry('c', { kind: 'stopped' })]),
    warn: pluginAlert([running, entry('b', { kind: 'unhealthy', detail: 'slow' }), entry('c', { kind: 'invalid-config', problems: ['x'] })]),
    danger: pluginAlert([entry('b', { kind: 'unhealthy', detail: 'slow' }), entry('c', { kind: 'crashed', reason: { kind: 'exit', code: 1, signal: null } }), entry('d', { kind: 'quarantined', detail: 'pgid' })]),
    safeMode: pluginAlert([entry('b', { kind: 'safe-mode' })]),
  }).toMatchInlineSnapshot(`
    {
      "danger": {
        "label": "Extensions: 1 not responding, 1 crashed, 1 quarantined",
        "tone": "danger",
      },
      "fine": null,
      "safeMode": {
        "label": "Extensions: Safe mode: extensions are off.",
        "tone": "warn",
      },
      "warn": {
        "label": "Extensions: 1 not responding, 1 with settings to fix",
        "tone": "warn",
      },
    }
  `);
});
