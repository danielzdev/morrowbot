import { z } from 'zod';

export const SettingKey = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/, 'Use letters and digits, starting with a letter');

const label = z.string().min(1);

export const SettingField = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('string'), label, default: z.string().optional() }),
  z.strictObject({
    kind: z.literal('number'),
    label,
    default: z.number().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  z.strictObject({ kind: z.literal('boolean'), label, default: z.boolean().optional() }),
  z
    .strictObject({
      kind: z.literal('select'),
      label,
      options: z.array(z.string().min(1)).min(1),
      default: z.string().optional(),
    })
    .refine((field) => field.default === undefined || field.options.includes(field.default), {
      error: 'The default must be one of the options',
      path: ['default'],
    }),
]);

export type SettingField = z.infer<typeof SettingField>;

/** The settings a plugin declares. A field without a `default` must be set by the user. */
export const PluginSettingsSchema = z.record(SettingKey, SettingField);
export type PluginSettingsSchema = z.infer<typeof PluginSettingsSchema>;

export const SettingValue = z.union([z.string(), z.number(), z.boolean()]);
export type SettingValue = z.infer<typeof SettingValue>;

/** A plugin's saved settings, keyed by setting name. */
export const PluginConfig = z.record(SettingKey, SettingValue);
export type PluginConfig = z.infer<typeof PluginConfig>;
