import type { PluginManifest } from '@morrowbot/plugin-sdk';

export { createCodexProvider } from './provider.ts';

/** What the Plugins page shows for the built-in OpenAI Codex provider, and its settings. */
export const manifest = {
  protocolVersion: 1,
  id: 'provider-openai',
  name: 'OpenAI Codex (subscription)',
  description: 'Runs OpenAI Codex on your own ChatGPT subscription.',
  version: '0.1.0',
  kind: 'provider',
  main: 'src/openai/index.ts',
  permissions: ['shell', 'network'],
  envPreset: 'cli-runtime',
  settingsSchema: {
    cliPath: { kind: 'string', label: 'Codex CLI path', default: 'codex' },
  },
} satisfies PluginManifest;
