import { z } from 'zod';
import { Agent, AgentInstructionsView, Folder, LastMessage } from './agents.ts';
import { EntityId, PluginId, Timestamp } from './ids.ts';
import { AssistantMessage, Message, UserMessage } from './messages.ts';
import { PluginManifest } from './plugin-manifest.ts';
import { PluginStatus } from './plugin-runtime.ts';
import { PluginConfig } from './plugin-settings.ts';
import { QueuedMessage, QueuedText } from './queue.ts';
import { AccountKey, ApprovalChoice, ProviderInfo, UsageResult } from './provider.ts';
import { Thread } from './threads.ts';

export const ProviderUnavailableReason = z.enum(['route-info-timeout', 'route-info-failed', 'daemon-blocked', 'rechecking']);
export type ProviderUnavailableReason = z.infer<typeof ProviderUnavailableReason>;

export const SessionChoiceReason = z.enum(['diverged', 'instructions-changed', 'unseeded-history']);
export type SessionChoiceReason = z.infer<typeof SessionChoiceReason>;

export const ApiError = z.strictObject({
  error: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.enum(['invalid_request', 'not_found', 'conflict', 'forbidden', 'unauthorized', 'internal']),
      message: z.string(),
    }),
    /** Nothing was written; keep the draft and offer Retry. */
    z.strictObject({ kind: z.literal('provider-unavailable'), reason: ProviderUnavailableReason, message: z.string() }),
    /** The agent's binding, plugin config or worker changed while the send was being admitted. Nothing was written. */
    z.strictObject({ kind: z.literal('binding-changed'), message: z.string() }),
    /** The provider session needs the user's choice before this send. Nothing was written. */
    z.strictObject({ kind: z.literal('session-choice-required'), reason: SessionChoiceReason, message: z.string() }),
    /** `AGENTS.md` was not written: it is there already, or replacing it is not available. `current` is what is on disk. */
    z.strictObject({
      kind: z.literal('instructions-conflict'),
      reason: z.enum(['occupied', 'replace-unavailable']),
      current: AgentInstructionsView,
      message: z.string(),
    }),
  ]),
});
export type ApiError = z.infer<typeof ApiError>;

export const AgentList = z.strictObject({ agents: z.array(Agent), folders: z.array(Folder), lastMessages: z.array(LastMessage) });
export type AgentList = z.infer<typeof AgentList>;

export const ThreadList = z.strictObject({ threads: z.array(Thread) });
export type ThreadList = z.infer<typeof ThreadList>;

export const MessageList = z.strictObject({ messages: z.array(Message) });
export type MessageList = z.infer<typeof MessageList>;

/** How to treat the provider's saved session for this send. `auto` never resumes a diverged session silently. */
export const SessionChoice = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('auto') }),
  z.strictObject({ kind: z.literal('continue-existing') }),
  z.strictObject({ kind: z.literal('new-seeded') }),
]);
export type SessionChoice = z.infer<typeof SessionChoice>;

export const SendMessageRequest = z.strictObject({
  text: QueuedText,
  sessionChoice: SessionChoice.default({ kind: 'auto' }),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequest>;

export const StartedSend = z.strictObject({ kind: z.literal('started'), generationId: EntityId, userMessage: UserMessage });
export type StartedSend = z.infer<typeof StartedSend>;

/** A send while the thread is busy is queued: the agent sees it later, or now with Steer now. */
export const QueuedSend = z.strictObject({ kind: z.literal('queued'), queued: QueuedMessage });
export type QueuedSend = z.infer<typeof QueuedSend>;

export const SendMessageResponse = z.discriminatedUnion('kind', [StartedSend, QueuedSend]);
export type SendMessageResponse = z.infer<typeof SendMessageResponse>;

/** Runs the failed or interrupted latest turn again with its saved input. */
export const ContinueRequest = z.strictObject({
  failedMessageId: EntityId,
  sessionChoice: SessionChoice.default({ kind: 'auto' }),
});
export type ContinueRequest = z.infer<typeof ContinueRequest>;

export const ContinueResponse = z.strictObject({ generationId: EntityId });
export type ContinueResponse = z.infer<typeof ContinueResponse>;

export const ApprovalReplyRequest = z.strictObject({ generationId: EntityId, choiceId: z.string().min(1) });
export type ApprovalReplyRequest = z.infer<typeof ApprovalReplyRequest>;

export const StopGenerationResponse = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('stopped'), message: AssistantMessage }),
  z.strictObject({ kind: z.literal('idle') }),
]);
export type StopGenerationResponse = z.infer<typeof StopGenerationResponse>;

/** Where a thread's event stream is: `seq` counts that thread's events since the host started (`hostEpoch`). */
export const Cursor = z.strictObject({ hostEpoch: z.string().min(1), seq: z.number().int().nonnegative() });
export type Cursor = z.infer<typeof Cursor>;

export const TurnState = z.enum(['queued', 'running']);
export type TurnState = z.infer<typeof TurnState>;

export const PendingApproval = z.strictObject({
  approvalId: z.string().min(1),
  summary: z.string().min(1),
  choices: z.array(ApprovalChoice).min(1),
});
export type PendingApproval = z.infer<typeof PendingApproval>;

/** A process group from an earlier turn or daemon that is not confirmed gone, so it blocks new work. */
export const BlockedGroup = z.strictObject({
  regId: z.string().min(1),
  pgid: z.number().int().positive(),
  pluginId: PluginId,
  kind: z.enum(['turn', 'daemon', 'probe']),
  startedAt: Timestamp,
  /** True after 60 s of blocked time: the user may then choose Release anyway. */
  releasable: z.boolean(),
});
export type BlockedGroup = z.infer<typeof BlockedGroup>;

export const ActiveTurn = z.strictObject({
  generationId: EntityId,
  state: TurnState,
  queueNote: z.string().min(1).nullable(),
  /** Everything streamed so far, including text not yet saved. */
  text: z.string(),
  pendingApprovals: z.array(PendingApproval),
});
export type ActiveTurn = z.infer<typeof ActiveTurn>;

/** A thread as one consistent snapshot, for a cold load or a resync. */
export const ThreadState = z.strictObject({
  thread: Thread,
  messages: z.array(Message),
  activeTurn: ActiveTurn.nullable(),
  /** Messages sent while a turn ran that the agent has not seen yet, oldest first. */
  queue: z.array(QueuedMessage),
  blockedGroups: z.array(BlockedGroup),
  cursor: Cursor,
});
export type ThreadState = z.infer<typeof ThreadState>;

/** A plugin as the settings page shows it: what it is, whether it runs, and its saved settings. */
export const PluginEntry = z.strictObject({
  manifest: PluginManifest,
  status: PluginStatus,
  enabled: z.boolean(),
  config: PluginConfig,
  blockedGroups: z.array(BlockedGroup),
});
export type PluginEntry = z.infer<typeof PluginEntry>;

export const PluginList = z.strictObject({ plugins: z.array(PluginEntry) });
export type PluginList = z.infer<typeof PluginList>;

export const SetPluginEnabledRequest = z.strictObject({ enabled: z.boolean() });
export type SetPluginEnabledRequest = z.infer<typeof SetPluginEnabledRequest>;

export const SetPluginConfigRequest = z.strictObject({ config: PluginConfig });
export type SetPluginConfigRequest = z.infer<typeof SetPluginConfigRequest>;

export const ProviderInfoResponse = z.strictObject({ info: ProviderInfo });
export type ProviderInfoResponse = z.infer<typeof ProviderInfoResponse>;

export const UsageResponse = z.strictObject({
  usage: UsageResult,
  /** The windows come from a saved snapshot older than 15 minutes, or from before this worker started. */
  stale: z.boolean(),
  /** False for live-only windows of an unknown account (''), which are never saved. */
  persisted: z.boolean(),
});
export type UsageResponse = z.infer<typeof UsageResponse>;

export const ReleaseGroupResponse = z.strictObject({ released: z.literal(true) });
export type ReleaseGroupResponse = z.infer<typeof ReleaseGroupResponse>;

const ThreadEvent = { threadId: EntityId, generationId: EntityId, cursor: Cursor };

export const ApprovalResolution = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('chosen'), choiceId: z.string().min(1) }),
  z.strictObject({ kind: z.literal('expired') }),
  z.strictObject({ kind: z.literal('cleared') }),
]);
export type ApprovalResolution = z.infer<typeof ApprovalResolution>;

/** Events the host pushes on the `/api/events` WebSocket. Thread events carry that thread's cursor. */
export const ChatEvent = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('generation.started'),
    ...ThreadEvent,
    /** Null for a Continue, which reuses the saved input. */
    userMessage: UserMessage.nullable(),
    state: TurnState,
  }),
  z.strictObject({
    kind: z.literal('generation.status'),
    ...ThreadEvent,
    state: TurnState,
    queueNote: z.string().min(1).nullable(),
    /** A provider status line such as "Thinking". */
    detail: z.string().min(1).nullable(),
  }),
  z.strictObject({ kind: z.literal('generation.delta'), ...ThreadEvent, text: z.string() }),
  z.strictObject({
    kind: z.literal('generation.tool-start'),
    ...ThreadEvent,
    toolUseId: z.string().min(1),
    name: z.string().min(1),
    input: z.json(),
  }),
  z.strictObject({
    kind: z.literal('generation.tool-end'),
    ...ThreadEvent,
    toolUseId: z.string().min(1),
    outcome: z.enum(['ok', 'error']),
  }),
  z.strictObject({ kind: z.literal('generation.approval-requested'), ...ThreadEvent, approval: PendingApproval }),
  z.strictObject({
    kind: z.literal('generation.approval-resolved'),
    ...ThreadEvent,
    approvalId: z.string().min(1),
    resolution: ApprovalResolution,
  }),
  /**
   * A queued message reached the running turn: the reply so far is saved as `segment` (outcome
   * `steered`), then `userMessage`; the turn goes on with fresh text after them.
   */
  z.strictObject({ kind: z.literal('generation.steered'), ...ThreadEvent, segment: AssistantMessage, userMessage: UserMessage }),
  z.strictObject({ kind: z.literal('generation.finished'), ...ThreadEvent, message: AssistantMessage }),
  /** The thread's whole queue as it is now. */
  z.strictObject({ kind: z.literal('queue.changed'), threadId: EntityId, cursor: Cursor, queue: z.array(QueuedMessage) }),
  /** Global (not part of any thread's cursor): refetch `/api/plugins/:id/usage`. */
  z.strictObject({ kind: z.literal('usage.updated'), pluginId: PluginId, accountKey: AccountKey }),
]);
export type ChatEvent = z.infer<typeof ChatEvent>;

/** What a client sends on `/api/events`. `since: null` subscribes from now on, with no replay. */
export const EventClientFrame = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('subscribe'), threadId: EntityId, since: Cursor.nullable() }),
  z.strictObject({ kind: z.literal('unsubscribe'), threadId: EntityId }),
]);
export type EventClientFrame = z.infer<typeof EventClientFrame>;

/** What the host sends on `/api/events`: events, or `resync` (refetch `/state`, then subscribe at its cursor). */
export const EventServerFrame = z.union([
  ChatEvent,
  z.strictObject({ kind: z.literal('resync'), threadId: EntityId }),
]);
export type EventServerFrame = z.infer<typeof EventServerFrame>;
