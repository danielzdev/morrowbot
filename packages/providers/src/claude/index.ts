import type { PluginManifest } from '@morrowbot/plugin-sdk';

export { createClaudeProvider } from './provider.ts';

/** What the Plugins page shows for the built-in Claude provider, and its settings. */
export const manifest = {
  protocolVersion: 1,
  id: 'provider-claude',
  name: 'Claude (subscription)',
  description: 'Runs Claude Code on your own Claude subscription.',
  version: '0.1.0',
  kind: 'provider',
  main: 'src/claude/index.ts',
  permissions: ['shell', 'network'],
  envPreset: 'cli-runtime',
  settingsSchema: {
    cliPath: { kind: 'string', label: 'Claude Code CLI path', default: 'claude' },
  },
} satisfies PluginManifest;
