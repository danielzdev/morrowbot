import { z } from 'zod';
import { PluginSettingsSchema } from './plugin-settings.ts';

export const PluginKind = z.enum(['provider', 'tool']);
export type PluginKind = z.infer<typeof PluginKind>;

export const PluginPermission = z.enum(['network', 'filesystem', 'shell', 'secrets']);
export type PluginPermission = z.infer<typeof PluginPermission>;

const RelativeEntry = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.includes('\0') &&
      !/^([\\/]|[a-zA-Z]:)/.test(value) &&
      !value.split(/[\\/]/).includes('..'),
    { error: 'Use a path inside the plugin folder' },
  );

/**
 * The host environment a plugin process gets. `none`: only `PATH`. `cli-runtime`: what a vendor CLI
 * needs to find its login and config (HOME, USER, SHELL, TMPDIR, LANG, TZ, XDG_*, proxy variables,
 * DBUS_SESSION_BUS_ADDRESS, CLAUDE_CONFIG_DIR, CODEX_HOME, and the Windows equivalents).
 * It is not a sandbox: plugins are trusted code.
 */
export const EnvPreset = z.enum(['none', 'cli-runtime']);
export type EnvPreset = z.infer<typeof EnvPreset>;

export const PluginManifest = z.strictObject({
  /** The plugin wire protocol the plugin speaks. */
  protocolVersion: z.literal(1),
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'Use lowercase letters, digits, and dashes'),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Use a MAJOR.MINOR.PATCH version'),
  kind: PluginKind,
  main: RelativeEntry,
  permissions: z.array(PluginPermission).refine((list) => new Set(list).size === list.length, {
    error: 'List each permission once',
  }),
  envPreset: EnvPreset.default('none'),
  settingsSchema: PluginSettingsSchema,
});

export type PluginManifest = z.infer<typeof PluginManifest>;
