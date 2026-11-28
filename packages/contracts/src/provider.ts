import { z } from 'zod';
import { ImageType, MAX_ATTACHMENTS } from './attachments.ts';
import { HostTools } from './host-tools.ts';
import { EntityId, Timestamp } from './ids.ts';

/** How much a turn may change: `full` (unsandboxed shell) is not offered by any v1 provider. */
export const AccessLevel = z.enum(['read-only', 'workspace-write', 'full']);
export type AccessLevel = z.infer<typeof AccessLevel>;

/** Who owns the CLI's instructions: MorrowBot (`isolated`) or the user's own CLI setup (`personal`). */
export const VendorSettings = z.enum(['isolated', 'personal']);
export type VendorSettings = z.infer<typeof VendorSettings>;

/** `background` turns never ask for approval and deny instead. */
export const TurnMode = z.enum(['interactive', 'background']);
export type TurnMode = z.infer<typeof TurnMode>;

/** One access combination a fixture has proven the provider enforces on this OS and CLI version. */
export const AccessProfile = z.strictObject({
  access: AccessLevel,
  vendorSettings: VendorSettings,
  modes: z.array(TurnMode).min(1),
  readsOutsideCwd: z.boolean(),
});
export type AccessProfile = z.infer<typeof AccessProfile>;

/** A combination the provider could offer but holds back, and why. */
export const WithheldProfile = z.strictObject({
  access: AccessLevel,
  vendorSettings: VendorSettings,
  reason: z.string().min(1),
});
export type WithheldProfile = z.infer<typeof WithheldProfile>;

/** The largest stateless seed the host sends: 256 KB of UTF-8. */
export const MAX_SEED_BYTES = 262_144;

export const ProviderCapabilities = z.strictObject({
  profiles: z.array(AccessProfile),
  approvals: z.boolean(),
  /** `false`: stateless, every turn gets the thread's history as its seed. */
  sessions: z.boolean(),
  usage: z.enum(['live', 'none']),
  maxSeedBytes: z.number().int().positive().max(MAX_SEED_BYTES).optional(),
  withheld: z.array(WithheldProfile),
});
export type ProviderCapabilities = z.infer<typeof ProviderCapabilities>;

const Label = z.string().min(1);

export const ModelChoice = z.strictObject({ id: z.string().min(1), label: Label });
export type ModelChoice = z.infer<typeof ModelChoice>;

export const ModelOption = z.strictObject({
  id: z.string().min(1),
  label: Label,
  defaultChoiceId: z.string().min(1),
  choices: z.array(ModelChoice).min(1),
});
export type ModelOption = z.infer<typeof ModelOption>;

export const ProviderModel = z.strictObject({
  id: z.string().min(1),
  label: Label,
  isDefault: z.boolean(),
  options: z.array(ModelOption),
});
export type ProviderModel = z.infer<typeof ProviderModel>;

/** How the user signs in. v1 only shows a terminal command, a Copy button, then Recheck. */
export const SignIn = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('run-in-terminal'), argv: z.array(z.string().min(1)).min(1) }),
]);
export type SignIn = z.infer<typeof SignIn>;

/** An opaque SHA-256 of the vendor's account identity, or '' when the identity is unknown. Never a raw email. */
export const AccountKey = z.string().max(256);
export type AccountKey = z.infer<typeof AccountKey>;

/** An opaque, nonsecret key for the effective inference route ('' for a provider with one fixed route). */
export const RouteKey = z.string().max(256);
export type RouteKey = z.infer<typeof RouteKey>;

const ReadyFields = {
  version: z.string().min(1),
  accountKey: AccountKey,
  accountLabel: z.string().min(1).nullable(),
  capabilities: ProviderCapabilities,
  /** A note such as "untested CLI version". */
  warning: z.string().min(1).nullable(),
};

/** What a provider plugin reports about its CLI, sign-in, models and access. */
export const ProviderInfo = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('missing-runtime'), install: z.string().min(1) }),
  z.strictObject({ kind: z.literal('outdated'), found: z.string().min(1), supported: z.string().min(1) }),
  z.strictObject({ kind: z.literal('signed-out'), signIn: SignIn }),
  z.strictObject({ kind: z.literal('ready'), ...ReadyFields, models: z.array(ProviderModel) }),
  z.strictObject({ kind: z.literal('ready-models-later'), ...ReadyFields }),
  z.strictObject({ kind: z.literal('error'), message: z.string().min(1) }),
]);
export type ProviderInfo = z.infer<typeof ProviderInfo>;

export const ModelSelection = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('default') }),
  z.strictObject({
    kind: z.literal('model'),
    id: z.string().min(1),
    choices: z.record(z.string().min(1), z.string().min(1)),
  }),
]);
export type ModelSelection = z.infer<typeof ModelSelection>;

/** A fresh vendor session (optionally seeded with history as plain text), or a resumed one. */
export const TurnSession = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('new'), seed: z.string().nullable() }),
  z.strictObject({ kind: z.literal('resume'), ref: z.string().min(1) }),
]);
export type TurnSession = z.infer<typeof TurnSession>;

/** Why a provider turn failed. `binding-changed` and `instructions-changed` are set by the host only. */
export const ProviderError = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('rate-limited'), resetsAt: Timestamp.nullable(), windowId: z.string().min(1).nullable() }),
  z.strictObject({ kind: z.literal('signed-out') }),
  z.strictObject({ kind: z.literal('account-changed') }),
  z.strictObject({ kind: z.literal('not-installed') }),
  z.strictObject({ kind: z.literal('outdated') }),
  z.strictObject({ kind: z.literal('invalid-model') }),
  z.strictObject({ kind: z.literal('transient'), retryAfterMs: z.number().int().nonnegative().nullable() }),
  z.strictObject({ kind: z.literal('session-lost') }),
  z.strictObject({ kind: z.literal('route-changed') }),
  z.strictObject({ kind: z.literal('context-too-long') }),
  z.strictObject({ kind: z.literal('background-not-allowed') }),
  z.strictObject({ kind: z.literal('access-not-supported'), reason: z.string().min(1).nullable() }),
  z.strictObject({ kind: z.literal('binding-changed') }),
  z.strictObject({ kind: z.literal('instructions-changed') }),
  z.strictObject({ kind: z.literal('other'), message: z.string() }),
]);
export type ProviderError = z.infer<typeof ProviderError>;

export const FinishReason = z.enum(['stop', 'length', 'refused', 'turn-limit']);
export type FinishReason = z.infer<typeof FinishReason>;

export const TurnOutcome = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('completed'), finishReason: FinishReason }),
  z.strictObject({ kind: z.literal('cancelled') }),
  z.strictObject({ kind: z.literal('interrupted') }),
  z.strictObject({ kind: z.literal('failed'), error: ProviderError }),
]);
export type TurnOutcome = z.infer<typeof TurnOutcome>;

const Tokens = z.number().int().nonnegative();

/** Token counts for this turn only. `inputTokens` excludes cached input. */
export const TurnUsage = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('reported'),
    inputTokens: Tokens,
    cachedInputTokens: Tokens.nullable(),
    cacheWriteTokens: Tokens.nullable(),
    outputTokens: Tokens,
    reasoningTokens: Tokens.nullable(),
  }),
  z.strictObject({ kind: z.literal('unavailable') }),
]);
export type TurnUsage = z.infer<typeof TurnUsage>;

export const UsageWindow = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(['session', 'weekly', 'monthly', 'other']),
  scope: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('account') }),
    z.strictObject({ kind: z.literal('models'), modelIds: z.array(z.string().min(1)).min(1) }),
  ]),
  label: Label,
  usedPercent: z.number().min(0).max(100),
  resetsAt: Timestamp.nullable(),
  windowMinutes: z.number().int().positive().nullable(),
});
export type UsageWindow = z.infer<typeof UsageWindow>;

export const UsageUnavailableReason = z.enum([
  'unsupported',
  'signed-out',
  'not-yet-observed',
  'api-key-route',
  'probe-failed',
]);
export type UsageUnavailableReason = z.infer<typeof UsageUnavailableReason>;

export const UsageResult = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('available'),
    observedAt: Timestamp,
    accountKey: AccountKey,
    windows: z.array(UsageWindow),
  }),
  z.strictObject({
    kind: z.literal('unavailable'),
    observedAt: Timestamp,
    accountKey: AccountKey,
    reason: UsageUnavailableReason,
  }),
]);
export type UsageResult = z.infer<typeof UsageResult>;

/** Tool input as the user sees it: at most 4 KB of JSON, home shown as `~`, secrets masked by the plugin. */
const ToolInput = z.json().refine((value) => JSON.stringify(value).length <= 4096, { error: 'Keep tool input under 4 KB' });

export const ApprovalChoice = z.strictObject({ id: z.string().min(1), label: Label });
export type ApprovalChoice = z.infer<typeof ApprovalChoice>;

/** One piece of a running turn. The text deltas are the whole reply. */
export const TurnChunk = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), text: z.string() }),
  z.strictObject({ kind: z.literal('status'), text: z.string().min(1) }),
  z.strictObject({ kind: z.literal('tool-start'), toolUseId: z.string().min(1), name: z.string().min(1), input: ToolInput }),
  z.strictObject({ kind: z.literal('tool-end'), toolUseId: z.string().min(1), outcome: z.enum(['ok', 'error']) }),
  z.strictObject({ kind: z.literal('session-bound'), ref: z.string().min(1), accountKey: AccountKey, routeKey: RouteKey }),
  z.strictObject({
    kind: z.literal('usage-update'),
    observedAt: Timestamp,
    accountKey: AccountKey,
    windows: z.array(UsageWindow),
  }),
  z.strictObject({
    kind: z.literal('approval-request'),
    approvalId: z.string().min(1),
    summary: z.string().min(1),
    choices: z.array(ApprovalChoice).min(1),
  }),
  z.strictObject({ kind: z.literal('approval-expired'), approvalId: z.string().min(1) }),
  z.strictObject({ kind: z.literal('model-options-changed'), models: z.array(ProviderModel) }),
  /** The vendor now has the user's mid-turn message (`steer`) in the turn's context. */
  z.strictObject({ kind: z.literal('steer-delivered'), steerId: z.string().min(1) }),
  /** The provider cannot take this mid-turn message now; none of it reached the vendor. */
  z.strictObject({ kind: z.literal('steer-refused'), steerId: z.string().min(1) }),
]);
export type TurnChunk = z.infer<typeof TurnChunk>;

/** An image sent with a prompt, as base64. */
export const TurnImage = z.strictObject({ mimeType: ImageType, data: z.string().min(1) });
export type TurnImage = z.infer<typeof TurnImage>;

/** Everything a provider plugin needs to run one turn. `turnId` is the host's generation id. */
export const TurnRequest = z.strictObject({
  turnId: EntityId,
  cwd: z.string().min(1),
  mode: TurnMode,
  access: AccessLevel,
  vendorSettings: VendorSettings,
  expectedAccountKey: AccountKey,
  expectedRouteKey: RouteKey,
  selection: ModelSelection,
  session: TurnSession,
  /** The agent's AGENTS.md when the host owns the instructions; null when the CLI loads them itself. */
  system: z.string().nullable(),
  prompt: z.string().min(1),
  /** Images the user attached to the prompt, for providers whose models can see them. */
  images: z.array(TurnImage).max(MAX_ATTACHMENTS).default([]),
  /** MorrowBot's own tools (agent messages, memories) for this turn only. */
  hostTools: HostTools.default({ kind: 'none' }),
});
export type TurnRequest = z.infer<typeof TurnRequest>;

/** How a turn ended. `finalText` is the provider's own final reply, used only when no text was streamed. */
export const TurnEnd = z.strictObject({
  outcome: TurnOutcome,
  usage: TurnUsage,
  actualModel: z.string().min(1).nullable(),
  accountKey: AccountKey,
  /** False only when the plugin knows nothing reached the vendor session. */
  sessionTouched: z.boolean(),
  finalText: z.string().min(1).nullable(),
});
export type TurnEnd = z.infer<typeof TurnEnd>;

/** What a CLI process group belongs to. */
export const ChildGroupScope = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('turn'), turnId: EntityId }),
  z.strictObject({ kind: z.literal('daemon') }),
  z.strictObject({ kind: z.literal('probe') }),
]);
export type ChildGroupScope = z.infer<typeof ChildGroupScope>;

export const RouteInfo = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('known'), accountKey: AccountKey, routeKey: RouteKey }),
  z.strictObject({ kind: z.literal('failed'), reason: z.string().min(1) }),
]);
export type RouteInfo = z.infer<typeof RouteInfo>;
