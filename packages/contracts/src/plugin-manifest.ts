import { z } from 'zod';

export const PluginManifest = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'Use lowercase letters, digits, and dashes'),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Use a MAJOR.MINOR.PATCH version'),
});

export type PluginManifest = z.infer<typeof PluginManifest>;
