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

const EnvName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Use an environment variable name');

export const PluginManifest = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'Use lowercase letters, digits, and dashes'),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Use a MAJOR.MINOR.PATCH version'),
  kind: PluginKind,
  main: RelativeEntry,
  permissions: z.array(PluginPermission).refine((list) => new Set(list).size === list.length, {
    error: 'List each permission once',
  }),
  /**
   * Host environment variables the plugin process receives besides `PATH`; unset ones are left out.
   * This keeps the host's environment out of plugins by default. It is not a sandbox: plugins are trusted code.
   */
  env: z
    .array(EnvName)
    .refine((list) => new Set(list).size === list.length, { error: 'List each variable once' })
    .default([]),
  settingsSchema: PluginSettingsSchema,
});

export type PluginManifest = z.infer<typeof PluginManifest>;
