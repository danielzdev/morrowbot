import { z } from 'zod';

export const CrashReason = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('exit'), code: z.number().int().nullable(), signal: z.string().nullable() }),
  z.strictObject({ kind: z.literal('timeout'), request: z.string() }),
  z.strictObject({ kind: z.literal('protocol'), problem: z.string() }),
  z.strictObject({ kind: z.literal('init-error'), message: z.string() }),
  z.strictObject({ kind: z.literal('spawn-error'), message: z.string() }),
]);
export type CrashReason = z.infer<typeof CrashReason>;

export const PluginStatus = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('safe-mode') }),
  z.strictObject({ kind: z.literal('disabled') }),
  z.strictObject({ kind: z.literal('invalid-config'), problems: z.array(z.string()) }),
  z.strictObject({ kind: z.literal('starting') }),
  z.strictObject({ kind: z.literal('running') }),
  z.strictObject({ kind: z.literal('unhealthy'), detail: z.string() }),
  z.strictObject({ kind: z.literal('crashed'), reason: CrashReason }),
  z.strictObject({ kind: z.literal('stopped') }),
]);
export type PluginStatus = z.infer<typeof PluginStatus>;

export const PluginStatusEvent = z.strictObject({ pluginId: z.string(), status: PluginStatus });
export type PluginStatusEvent = z.infer<typeof PluginStatusEvent>;
