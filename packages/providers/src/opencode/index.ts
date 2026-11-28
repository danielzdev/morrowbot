import type { PluginManifest } from '@morrowbot/plugin-sdk';

export { createOpenCodeProvider } from './provider.ts';

/** What the Plugins page shows for the built-in OpenCode provider, and its settings. */
export const manifest = {
  protocolVersion: 1,
  id: 'provider-opencode',
  name: 'OpenCode (free models)',
  description: 'Runs OpenCode with its free models.',
  version: '0.1.0',
  kind: 'provider',
  main: 'src/opencode/index.ts',
  permissions: ['shell', 'network'],
  envPreset: 'cli-runtime',
  settingsSchema: {
    cliPath: { kind: 'string', label: 'OpenCode CLI path', default: 'opencode' },
  },
} satisfies PluginManifest;
