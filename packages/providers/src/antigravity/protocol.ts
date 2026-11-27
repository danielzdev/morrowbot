import { z } from '@morrowbot/plugin-sdk';

/**
 * The Agent Client Protocol shapes `agy acp` 1.5.18 sends, checked against its recorded transcripts
 * (`fixtures/1.5.18/`). Every shape is loose: only the fields MorrowBot reads are named.
 */

export const InitializeResponse = z.looseObject({
  protocolVersion: z.number(),
  agentInfo: z.looseObject({ version: z.string().nullish() }).nullish(),
  agentCapabilities: z
    .looseObject({
      loadSession: z.boolean().nullish(),
      sessionCapabilities: z.looseObject({ close: z.unknown().optional() }).nullish(),
    })
    .nullish(),
});

const SelectValue = z.looseObject({ value: z.string(), name: z.string() });
const SelectGroup = z.looseObject({ options: z.array(SelectValue) });

/** One session setting (`model`, `thought_level`, `mode`) and the values it offers. */
export const ConfigOption = z.looseObject({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  currentValue: z.unknown(),
  options: z.array(z.unknown()).nullish(),
});
export type ConfigOption = z.infer<typeof ConfigOption>;

const ConfigOptions = z.array(ConfigOption);

/** A name agy may leave blank (`""`): null then, as the contract allows no empty names. */
const Named = z.string().transform((name) => (name.trim() === '' ? null : name));

const SessionMeta = z
  .looseObject({ antigravity: z.looseObject({ tier: z.looseObject({ name: Named }).nullish() }).nullish() })
  .nullish();

export const SessionNewResponse = z.looseObject({ sessionId: z.string().min(1), configOptions: ConfigOptions.nullish(), _meta: SessionMeta });
export type SessionNewResponse = z.infer<typeof SessionNewResponse>;

export const SessionLoadResponse = z.looseObject({ configOptions: ConfigOptions.nullish(), _meta: SessionMeta });

export const SetConfigResponse = z.looseObject({ configOptions: ConfigOptions });
export type SetConfigResponse = z.infer<typeof SetConfigResponse>;

const Tokens = z.number().int().nonnegative();

export const PromptResponse = z.looseObject({
  stopReason: z.string(),
  usage: z
    .looseObject({
      inputTokens: Tokens,
      outputTokens: Tokens,
      cachedReadTokens: Tokens.nullish(),
      cachedWriteTokens: Tokens.nullish(),
      thoughtTokens: Tokens.nullish(),
    })
    .nullish(),
});
export type PromptResponse = z.infer<typeof PromptResponse>;

export const Ignored = z.unknown();

export const SessionNotification = z.looseObject({ sessionId: z.string(), update: z.looseObject({ sessionUpdate: z.string() }) });

export const ContentChunk = z.looseObject({ content: z.looseObject({ type: z.string(), text: z.string().nullish() }) });

/** A `tool_call` or `tool_call_update`. Updates may leave out what an earlier message said. */
export const ToolCall = z.looseObject({
  toolCallId: z.string().min(1),
  title: z.string().nullish(),
  kind: z.string().nullish(),
  status: z.string().nullish(),
  locations: z.array(z.looseObject({ path: z.string() })).nullish(),
});
export type ToolCall = z.infer<typeof ToolCall>;

export const ConfigOptionUpdate = z.looseObject({ configOptions: ConfigOptions });

export const ModeUpdate = z.looseObject({ currentModeId: z.string() });

export const PermissionOption = z.looseObject({ optionId: z.string().min(1), kind: z.string() });
export type PermissionOption = z.infer<typeof PermissionOption>;

export const PermissionRequest = z.looseObject({
  sessionId: z.string(),
  toolCall: z.looseObject({ title: z.string().nullish(), kind: z.string().nullish(), locations: z.array(z.looseObject({ path: z.string() })).nullish() }),
  options: z.array(PermissionOption),
});
export type PermissionRequest = z.infer<typeof PermissionRequest>;

export const SessionScoped = z.looseObject({ sessionId: z.string() });

/**
 * The current value of a select setting and the values it offers, or null when `id` is not a select
 * or has no current value. Blank and repeated values are left out, as the contract allows neither.
 */
export function selectOf(options: readonly ConfigOption[], id: string): { readonly current: string; readonly values: readonly { readonly value: string; readonly name: string }[] } | null {
  const option = options.find((entry) => entry.id === id);
  if (option?.type !== 'select' || typeof option.currentValue !== 'string' || option.currentValue.trim() === '') return null;
  const seen = new Set<string>();
  const values = (option.options ?? []).flatMap((entry) => {
    const value = SelectValue.safeParse(entry);
    const group = SelectGroup.safeParse(entry);
    const listed = value.success ? [value.data] : group.success ? group.data.options : [];
    return listed.filter(({ value: each }) => {
      if (each.trim() === '' || seen.has(each)) return false;
      seen.add(each);
      return true;
    });
  });
  return { current: option.currentValue, values };
}
