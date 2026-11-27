import { z } from 'zod';
import { PluginSettingsSchema } from './plugin-settings.ts';

export const PluginKind = z.enum(['provider', 'tool']);
export type PluginKind = z.infer<typeof PluginKind>;

export const PluginPermission = z.enum(['network', 'filesystem', 'shell', 'secrets']);
export type PluginPermission = z.infer<typeof PluginPermission>;

const RelativeEntry = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith('/') && !value.split(/[\\/]/).includes('..'), {
    error: 'Use a path inside the plugin folder',
  });

export const PluginManifest = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'Use lowercase letters, digits, and dashes'),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Use a MAJOR.MINOR.PATCH version'),
  kind: PluginKind,
  main: RelativeEntry,
  permissions: z.array(PluginPermission).refine((list) => new Set(list).size === list.length, {
    error: 'List each permission once',
  }),
  settingsSchema: PluginSettingsSchema,
});

export type PluginManifest = z.infer<typeof PluginManifest>;
