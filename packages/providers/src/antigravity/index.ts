import type { PluginManifest } from '@morrowbot/plugin-sdk';

export { createAntigravityProvider } from './provider.ts';

/** What the Plugins page shows for the built-in Google Antigravity provider, and its settings. */
export const manifest = {
  protocolVersion: 1,
  id: 'provider-antigravity',
  name: 'Google Antigravity (subscription)',
  description: 'Runs Google Antigravity on your own Google account.',
  version: '0.1.0',
  kind: 'provider',
  main: 'src/antigravity/index.ts',
  permissions: ['shell', 'network'],
  envPreset: 'cli-runtime',
  settingsSchema: {
    cliPath: { kind: 'string', label: 'Antigravity CLI path', default: 'agy' },
  },
} satisfies PluginManifest;
