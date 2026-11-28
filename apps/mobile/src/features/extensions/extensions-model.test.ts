import type { PluginEntry } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { badgeOf, segmentRows } from './extensions-model.ts';

const entry = (id: string, name: string, kind: 'provider' | 'tool', source: 'built-in' | 'user', status: PluginEntry['status']): PluginEntry => ({
  manifest: { protocolVersion: 1, id, name, version: '1.0.0', kind, main: 'index.js', permissions: [], envPreset: 'none', settingsSchema: {} },
  source,
  status,
  enabled: status.kind !== 'disabled',
  config: {},
  blockedGroups: [],
});

const PLUGINS = [
  entry('claude', 'Claude', 'provider', 'built-in', { kind: 'running' }),
  entry('local-llm', 'Local LLM', 'provider', 'user', { kind: 'crashed', reason: { kind: 'exit', code: 1, signal: null } }),
  entry('web-search', 'Web Search', 'tool', 'user', { kind: 'running' }),
  entry('weather', 'Weather', 'tool', 'user', { kind: 'disabled' }),
];

it('lists every plugin but the built-in providers, filtered by name, with a status badge', () => {
  const rows = (segment: 'plugins' | 'connectors' | 'marketplace', query: string) =>
    segmentRows(PLUGINS, segment, query).map(({ manifest, status }) => `${manifest.name}: ${badgeOf(status).label}`);
  expect({
    plugins: rows('plugins', ''),
    searched: rows('plugins', 'WEA'),
    connectors: rows('connectors', ''),
    marketplace: rows('marketplace', 'llm'),
  }).toEqual({
    plugins: ['Local LLM: Crashed', 'Web Search: Running', 'Weather: Off'],
    searched: ['Weather: Off'],
    connectors: [],
    marketplace: ['Local LLM: Crashed'],
  });
});
