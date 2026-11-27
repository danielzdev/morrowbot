import { PluginConfig, type PluginSettingsSchema, type SettingField, type SettingValue } from '@morrowbot/contracts';
import { z } from 'zod';
import { describeIssues } from './issues.ts';

export type ConfigResult =
  | {
      readonly kind: 'ok';
      /** The settings as given, to save. */
      readonly saved: PluginConfig;
      /** The saved settings with defaults filled in, to hand to the plugin. */
      readonly config: PluginConfig;
    }
  | { readonly kind: 'invalid'; readonly problems: readonly string[] };

/** Checks saved settings against a plugin's schema and fills in defaults. */
export function resolvePluginConfig(schema: PluginSettingsSchema, input: unknown): ConfigResult {
  const saved = PluginConfig.safeParse(input);
  if (!saved.success) return { kind: 'invalid', problems: describeIssues(saved.error) };
  const shape: Record<string, z.ZodType<SettingValue>> = {};
  for (const [key, field] of Object.entries(schema)) shape[key] = fieldSchema(field);
  const parsed = z.strictObject(shape).safeParse(saved.data);
  if (parsed.success) return { kind: 'ok', saved: saved.data, config: parsed.data };
  return { kind: 'invalid', problems: describeIssues(parsed.error) };
}

function fieldSchema(field: SettingField): z.ZodType<SettingValue> {
  switch (field.kind) {
    case 'string':
      return withDefault(z.string(), field.default);
    case 'number': {
      let schema = z.number();
      if (field.min !== undefined) schema = schema.min(field.min);
      if (field.max !== undefined) schema = schema.max(field.max);
      return withDefault(schema, field.default);
    }
    case 'boolean':
      return withDefault(z.boolean(), field.default);
    case 'select': {
      const [first, ...rest] = field.options;
      if (first === undefined) return z.never();
      return withDefault(z.enum([first, ...rest]), field.default);
    }
  }
}

function withDefault<T extends SettingValue>(schema: z.ZodType<T>, value: T | undefined): z.ZodType<T> {
  return value === undefined ? schema : schema.default(value);
}
