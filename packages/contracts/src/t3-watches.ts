import { z } from 'zod';
import { EntityId, Timestamp } from './ids.ts';

/** A T3 Code thread id, such as `mcp:<uuid>`. */
export const T3ThreadId = z.string().trim().min(1).max(512);
export type T3ThreadId = z.infer<typeof T3ThreadId>;

/** A T3 Code run id, such as `run:thread:<thread>:ordinal:<n>`. */
export const T3RunId = z.string().trim().min(1).max(1024);
export type T3RunId = z.infer<typeof T3RunId>;

/**
 * Asks the host to watch a T3 Code thread. Take `launchedAt` just before `t3 thread start` or `t3 thread send`,
 * and before a `send` read the thread's latest run as `priorRunId`. Pass the `runId` that `--json` printed whenever
 * you have it: the watch then follows exactly that run. Without one, a `send` is followed only on a thread marked
 * `exclusive` (nobody else types there); on a shared thread it ends as `idle_unverified`.
 */
export const RegisterT3WatchRequest = z.strictObject({
  threadId: T3ThreadId,
  launchedAt: Timestamp,
  runId: T3RunId.optional(),
  priorRunId: T3RunId.optional(),
  exclusive: z.boolean().default(false),
  label: z.string().trim().max(200).optional(),
  stallAfterMin: z
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .optional(),
});
export type RegisterT3WatchRequest = z.infer<typeof RegisterT3WatchRequest>;

/** What a watch reports. `superseded` means a newer registration for the same thread replaced it. */
export const T3WatchState = z.enum([
  'watching',
  'running',
  'needs_you',
  'stalled',
  'finished',
  'failed',
  'watch_missing',
  'idle_unverified',
  'superseded',
]);
export type T3WatchState = z.infer<typeof T3WatchState>;

export const T3Watch = z.strictObject({
  watchId: EntityId,
  threadId: T3ThreadId,
  source: z.enum(['registered', 'discovered']),
  label: z.string().nullable(),
  state: T3WatchState,
  reason: z.string().nullable(),
  /** The run this watch follows, once it has adopted one. */
  runId: T3RunId.nullable(),
  registeredAt: Timestamp,
  /** When the update that ended this watch was acknowledged; reads stop at its terminal state either way. */
  settledAt: Timestamp.nullable(),
  updatedAt: Timestamp,
});
export type T3Watch = z.infer<typeof T3Watch>;

export const T3WatchList = z.strictObject({ watches: z.array(T3Watch) });
export type T3WatchList = z.infer<typeof T3WatchList>;

/** A transition worth telling the orchestrator about. The last two are about the T3 service, not one thread. */
export const T3EventKind = z.enum([
  'needs_you',
  'failed',
  'stalled',
  'watch_missing',
  'idle_unverified',
  'finished',
  't3_unreachable',
  't3_degraded',
]);
export type T3EventKind = z.infer<typeof T3EventKind>;

const EventFields = {
  eventId: EntityId,
  /** Which transition this is, so the same one is never queued twice. */
  fingerprint: z.string(),
  reason: z.string().nullable(),
  at: Timestamp,
};

export const T3WatchEvent = z.discriminatedUnion('scope', [
  z.strictObject({
    scope: z.literal('watch'),
    kind: T3EventKind.exclude(['t3_unreachable', 't3_degraded']),
    watchId: EntityId,
    threadId: T3ThreadId,
    runId: T3RunId.nullable(),
    ...EventFields,
  }),
  z.strictObject({ scope: z.literal('service'), kind: T3EventKind.extract(['t3_unreachable', 't3_degraded']), ...EventFields }),
]);
export type T3WatchEvent = z.infer<typeof T3WatchEvent>;

/**
 * The orchestrator's answer to one batch: every event in it was handled, suppressed or deferred. Events in
 * `deferredEventIds` come back in a later batch; those in `goneEventIds` (two `NotFound` reads) settle nothing.
 * Post it to `POST /api/t3-watches/acks`, or append it as one line to `acks.jsonl` in the watch folder.
 */
export const T3WatchAck = z.strictObject({
  batchId: EntityId,
  deferredEventIds: z.array(EntityId).max(1000).default([]),
  goneEventIds: z.array(EntityId).max(1000).default([]),
});
export type T3WatchAck = z.infer<typeof T3WatchAck>;

export const T3WatchAckResponse = z.strictObject({ result: z.enum(['acked', 'already_acked']) });
export type T3WatchAckResponse = z.infer<typeof T3WatchAckResponse>;

/** One event in a batch. `unverified`: the host could not confirm it three times; show it, never act on it. */
export const T3BatchEvent = z.strictObject({ event: T3WatchEvent, unverified: z.boolean() });
export type T3BatchEvent = z.infer<typeof T3BatchEvent>;

/** One row of a batch's status table: context only, never something to act on. */
export const T3StatusRow = T3Watch.pick({ watchId: true, threadId: true, label: true, state: true, reason: true, runId: true });
export type T3StatusRow = z.infer<typeof T3StatusRow>;

/**
 * What the orchestrator's routine is sent. A resend keeps `batchId` and every event; only `attempt`, `asOf` and
 * `status` change. The payload ends with both ack forms.
 */
export const T3WatchBatch = z.strictObject({
  batchId: EntityId,
  attempt: z.number().int().positive(),
  asOf: Timestamp,
  events: z.array(T3BatchEvent),
  status: z.array(T3StatusRow),
  rules: z.array(z.string()),
  ack: z.strictObject({ file: z.string(), line: z.string(), api: z.string() }),
});
export type T3WatchBatch = z.infer<typeof T3WatchBatch>;
