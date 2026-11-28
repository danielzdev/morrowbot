import { z } from 'zod';
import { EntityId } from './ids.ts';
import { PluginKind } from './plugin-manifest.ts';
import { PluginConfig } from './plugin-settings.ts';
import {
  AccountKey,
  ChildGroupScope,
  ProviderInfo,
  RouteKey,
  TurnChunk,
  TurnEnd,
  TurnRequest,
  UsageResult,
} from './provider.ts';

/**
 * The messages the host and a plugin process exchange over the Node IPC channel (wire protocol v1).
 * A request with an `id` gets exactly one matching result or `error`. Turns are not requests:
 * `turn`, `cancel`, `approval-reply`, `steer`, `turn-chunk` and `turn-end` carry the host's `turnId` instead.
 * `child-group-*` messages are unsolicited notifications.
 */
export const PROTOCOL_VERSION = 1;
const ProtocolVersion = z.literal(PROTOCOL_VERSION);

export const RequestId = z.number().int().nonnegative();
export type RequestId = z.infer<typeof RequestId>;

/** A process id that leads a process group (the SDK command guard). */
export const Pgid = z.number().int().positive();

export const PluginHealth = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ok') }),
  z.strictObject({ kind: z.literal('degraded'), detail: z.string().min(1) }),
]);
export type PluginHealth = z.infer<typeof PluginHealth>;

export const HostMessage = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('init'),
    id: RequestId,
    protocolVersion: ProtocolVersion,
    config: PluginConfig,
    dataDir: z.string().min(1),
  }),
  z.strictObject({ kind: z.literal('health'), id: RequestId }),
  z.strictObject({ kind: z.literal('shutdown'), id: RequestId }),
  z.strictObject({ kind: z.literal('provider-info'), id: RequestId, refresh: z.boolean() }),
  z.strictObject({ kind: z.literal('usage'), id: RequestId, refresh: z.boolean() }),
  z.strictObject({ kind: z.literal('route-info'), id: RequestId, cwd: z.string().min(1) }),
  z.strictObject({ kind: z.literal('turn'), ...TurnRequest.shape }),
  z.strictObject({ kind: z.literal('cancel'), turnId: EntityId }),
  z.strictObject({
    kind: z.literal('approval-reply'),
    turnId: EntityId,
    approvalId: z.string().min(1),
    choiceId: z.string().min(1),
  }),
  /** The user's message for the running turn. The plugin answers with a `steer-delivered` or `steer-refused` chunk. */
  z.strictObject({ kind: z.literal('steer'), turnId: EntityId, steerId: z.string().min(1), text: z.string().min(1) }),
  z.strictObject({ kind: z.literal('child-group-ack'), pgid: Pgid }),
  z.strictObject({ kind: z.literal('kill-child-group'), pgid: Pgid }),
]);
export type HostMessage = z.infer<typeof HostMessage>;

export const PluginErrorCode = z.enum(['unsupported', 'failed']);
export type PluginErrorCode = z.infer<typeof PluginErrorCode>;

export const PluginMessage = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('init-result'), id: RequestId, protocolVersion: ProtocolVersion, pluginKind: PluginKind }),
  z.strictObject({ kind: z.literal('health-result'), id: RequestId, health: PluginHealth }),
  z.strictObject({ kind: z.literal('shutdown-result'), id: RequestId }),
  z.strictObject({ kind: z.literal('provider-info-result'), id: RequestId, info: ProviderInfo }),
  z.strictObject({ kind: z.literal('usage-result'), id: RequestId, usage: UsageResult }),
  z.strictObject({ kind: z.literal('route-info-result'), id: RequestId, accountKey: AccountKey, routeKey: RouteKey }),
  z.strictObject({ kind: z.literal('route-info-failed'), id: RequestId, reason: z.string().min(1) }),
  z.strictObject({ kind: z.literal('error'), id: RequestId, code: PluginErrorCode, message: z.string() }),
  z.strictObject({ kind: z.literal('turn-chunk'), turnId: EntityId, chunk: TurnChunk }),
  z.strictObject({ kind: z.literal('turn-end'), turnId: EntityId, ...TurnEnd.shape }),
  z.strictObject({
    kind: z.literal('child-group-started'),
    pgid: Pgid,
    /** The guard's OS start time, read by the guard itself (`ps -o lstart=` on macOS, `/proc/<pid>/stat` field 22 on Linux). */
    leaderStart: z.string().min(1),
    scope: ChildGroupScope,
  }),
  z.strictObject({ kind: z.literal('child-group-exited'), pgid: Pgid }),
]);
export type PluginMessage = z.infer<typeof PluginMessage>;
