import { z } from 'zod';
import { EntityId, Timestamp } from './ids.ts';

/** The most characters a connector label has. */
export const MAX_CONNECTOR_LABEL = 40;

const EMAIL_LIKE = /[^\s@]+@[^\s@]+/;

/**
 * A connector's tool-name namespace: its label in lower case, every run of other characters one `_`.
 * Labels are unique by this key, so two connectors never give an agent tools with the same name.
 */
export function connectorLabelKey(label: string): string {
  return label
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24)
    .replace(/_+$/, '');
}

/** The user's privacy-safe name for a connector ("Gmail · Work"). Never an email address: it reaches the provider in tool names. */
export const ConnectorLabel = z
  .string()
  .trim()
  .min(1)
  .max(MAX_CONNECTOR_LABEL)
  .refine((label) => !EMAIL_LIKE.test(label), { error: 'Use a short name, like Work or Personal.' })
  .refine((label) => connectorLabelKey(label) !== '', { error: 'Use a short name, like Work or Personal.' });

const EnvName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/, 'Use letters, digits and _ for a variable name');
const HeaderName = z.string().regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/, 'Use a valid header name');
const SecretValue = z
  .string()
  .max(8192)
  .refine((value) => !/[\p{Cc}]/u.test(value.replaceAll('\t', '')), { error: 'Remove line breaks and other control characters' });

/** A Vault item (an API key or header secret) the host reads only when it connects. Its value never reaches a window. */
const VaultChoice = { kind: z.literal('vault'), vaultId: EntityId };

/** One named value: typed in (`inline`, kept write-only by the host), or taken from a Vault item. */
const NamedSecret = <N extends z.ZodType<string>>(name: N) =>
  z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('inline'), name, value: SecretValue }), z.strictObject({ name, ...VaultChoice })]);

/** On an edit, keep the saved value of a name, type a new one, or take it from a Vault item. */
const SecretEdit = <N extends z.ZodType<string>>(name: N) =>
  z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('keep'), name }),
    z.strictObject({ kind: z.literal('set'), name, value: SecretValue }),
    z.strictObject({ name, ...VaultChoice }),
  ]);

/** A secret as a window sees it: its name, and the Vault item it comes from (never a value). */
const SecretView = z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('inline'), name: z.string() }), z.strictObject({ name: z.string(), ...VaultChoice })]);
export type ConnectorSecretView = z.infer<typeof SecretView>;

const ApiKeyValue = z.string().trim().min(1).max(512);

const uniqueNames = (entries: readonly { readonly name: string }[]): boolean => new Set(entries.map(({ name }) => name.toLowerCase())).size === entries.length;

const RemoteUrl = z.url({ protocol: /^https?$/ }).max(2048);
const Command = z.string().trim().min(1).max(1024);
const Args = z.array(z.string().max(4096)).max(64);
const ToolkitSlug = z.string().regex(/^[a-z0-9_-]{1,64}$/, 'Use the toolkit slug, like gmail');
const ComposioAccount = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('user'), userId: z.string().trim().min(1).max(256) }),
  z.strictObject({ kind: z.literal('connected-account'), connectedAccountId: z.string().trim().min(1).max(256) }),
]);
export type ComposioAccount = z.infer<typeof ComposioAccount>;

/** What a connector reaches: a local command speaking MCP on stdio, a remote MCP URL, or one Composio account's toolkit. */
export const ConnectorSetup = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('stdio'),
    command: Command,
    args: Args,
    env: z.array(NamedSecret(EnvName)).max(64).refine(uniqueNames, { error: 'Name each variable once' }),
  }),
  z.strictObject({
    kind: z.literal('http'),
    url: RemoteUrl,
    headers: z.array(NamedSecret(HeaderName)).max(32).refine(uniqueNames, { error: 'Name each header once' }),
  }),
  z.strictObject({
    kind: z.literal('composio'),
    toolkit: ToolkitSlug,
    /** The Composio MCP server URL (`https://backend.composio.dev/v3/mcp/<server id>`). */
    serverUrl: RemoteUrl,
    apiKey: z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('inline'), value: ApiKeyValue }), z.strictObject(VaultChoice)]),
    account: ComposioAccount,
  }),
]);
export type ConnectorSetup = z.infer<typeof ConnectorSetup>;

/** A setup edit: secrets left as `keep` keep their saved value or Vault item; a name left out is removed. */
export const ConnectorSetupEdit = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('stdio'), command: Command, args: Args, env: z.array(SecretEdit(EnvName)).max(64).refine(uniqueNames, { error: 'Name each variable once' }) }),
  z.strictObject({ kind: z.literal('http'), url: RemoteUrl, headers: z.array(SecretEdit(HeaderName)).max(32).refine(uniqueNames, { error: 'Name each header once' }) }),
  z.strictObject({
    kind: z.literal('composio'),
    toolkit: ToolkitSlug,
    serverUrl: RemoteUrl,
    apiKey: z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('keep') }), z.strictObject({ kind: z.literal('set'), value: ApiKeyValue }), z.strictObject(VaultChoice)]),
    account: ComposioAccount,
  }),
]);
export type ConnectorSetupEdit = z.infer<typeof ConnectorSetupEdit>;

/** A setup as a window sees it: secret values are never included, only their names and Vault items. */
export const ConnectorSetupView = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('stdio'), command: z.string(), args: z.array(z.string()), env: z.array(SecretView) }),
  z.strictObject({ kind: z.literal('http'), url: z.string(), headers: z.array(SecretView) }),
  z.strictObject({
    kind: z.literal('composio'),
    toolkit: z.string(),
    serverUrl: z.string(),
    apiKey: z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('inline') }), z.strictObject(VaultChoice)]),
    account: ComposioAccount,
  }),
]);
export type ConnectorSetupView = z.infer<typeof ConnectorSetupView>;

export const ScopeMode = z.enum(['all', 'selected']);
export type ScopeMode = z.infer<typeof ScopeMode>;

/**
 * Which agents a connector is given to: one record per connector, owned by the host and written only
 * with the revision it was read at. `scopeReviewRequired` pauses access until a scope is saved again.
 */
export const ConnectorScope = z.strictObject({
  mode: ScopeMode,
  agentIds: z.array(EntityId),
  revision: z.int().min(0),
  scopeReviewRequired: z.boolean(),
});
export type ConnectorScope = z.infer<typeof ConnectorScope>;

const ScopeChoice = z
  .strictObject({ mode: ScopeMode, agentIds: z.array(EntityId).max(1000) })
  .refine((scope) => scope.mode === 'selected' || scope.agentIds.length === 0, { error: 'All agents takes no agent list' })
  .refine((scope) => new Set(scope.agentIds).size === scope.agentIds.length, { error: 'Name each agent once' });

/**
 * The status a connector shows: the first that applies, in the IA §3 order (safe mode, turned off,
 * crashed, unsupported, not responding, starting, scope needs review, reconnect needed, not connected, connected).
 */
export const ConnectorStatus = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('off_safe_mode') }),
  z.strictObject({ kind: z.literal('turned_off') }),
  z.strictObject({ kind: z.literal('crashed'), message: z.string() }),
  z.strictObject({ kind: z.literal('unsupported'), message: z.string() }),
  z.strictObject({ kind: z.literal('not_responding'), message: z.string() }),
  z.strictObject({ kind: z.literal('starting') }),
  z.strictObject({ kind: z.literal('scope_needs_review') }),
  z.strictObject({ kind: z.literal('reconnect_needed'), message: z.string() }),
  z.strictObject({ kind: z.literal('not_connected') }),
  z.strictObject({ kind: z.literal('connected'), toolCount: z.int().min(0) }),
]);
export type ConnectorStatus = z.infer<typeof ConnectorStatus>;

/** One tool a connector offers, as its server named it, and the name agents call it by. */
export const ConnectorToolView = z.strictObject({ name: z.string(), boundName: z.string(), description: z.string() });
export type ConnectorToolView = z.infer<typeof ConnectorToolView>;

export const Connector = z.strictObject({
  id: EntityId,
  label: z.string(),
  /** The prefix of this connector's tool names (`<labelKey>__<tool>`). */
  labelKey: z.string(),
  setup: ConnectorSetupView,
  enabled: z.boolean(),
  /** The user's Connect (true) or Disconnect (false). */
  connected: z.boolean(),
  scope: ConnectorScope,
  status: ConnectorStatus,
  tools: z.array(ConnectorToolView),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Connector = z.infer<typeof Connector>;

export const ConnectorList = z.strictObject({ connectors: z.array(Connector), safeMode: z.boolean() });
export type ConnectorList = z.infer<typeof ConnectorList>;

/** Adding a connector commits its scope first, so it never runs with a scope nobody chose. */
export const CreateConnectorRequest = z.strictObject({ label: ConnectorLabel, setup: ConnectorSetup, scope: ScopeChoice });
export type CreateConnectorRequest = z.infer<typeof CreateConnectorRequest>;

/** Account: rename, or change what the connector reaches (which reconnects it). */
export const UpdateConnectorAccountRequest = z.strictObject({ label: ConnectorLabel, setup: ConnectorSetupEdit });
export type UpdateConnectorAccountRequest = z.infer<typeof UpdateConnectorAccountRequest>;

export const SetConnectorEnabledRequest = z.strictObject({ enabled: z.boolean() });
export type SetConnectorEnabledRequest = z.infer<typeof SetConnectorEnabledRequest>;

/** Writes the scope only if it is still at `revision`; otherwise 409 `scope-conflict` with the current one. */
export const SetConnectorScopeRequest = z.strictObject({ mode: ScopeMode, agentIds: z.array(EntityId).max(1000), revision: z.int().min(0) }).superRefine((scope, context) => {
  const choice = ScopeChoice.safeParse({ mode: scope.mode, agentIds: scope.agentIds });
  if (!choice.success) for (const issue of choice.error.issues) context.addIssue({ code: 'custom', message: issue.message, path: ['agentIds'] });
});
export type SetConnectorScopeRequest = z.infer<typeof SetConnectorScopeRequest>;
