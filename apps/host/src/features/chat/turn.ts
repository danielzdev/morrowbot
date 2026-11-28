import type {
  AgentMessage,
  AssistantMessage,
  GenerationOutcome,
  Message,
  PendingApproval,
  ProviderBinding,
  QueuedMessageState,
  TurnMode,
  TurnOutcome,
  TurnUsage,
  UsageWindow,
  UserMessage,
} from '@morrowbot/contracts';
import { answersSender, splitAnswer } from './background.ts';
import type { EventLog } from './event-log.ts';
import type { OutputLimitKind } from './output-budget.ts';
import type { ChatServiceOptions, SessionState } from './ports.ts';
import type { ReactionNote } from './reactions.ts';

export type BoundProvider = Extract<ProviderBinding, { kind: 'bound' }>;

export interface LiveUsage {
  readonly worker: number;
  /** Each window with the time it was observed: a window is replaced only by a newer observation. */
  readonly windows: Map<string, { readonly observedAt: string; readonly window: UsageWindow }>;
}

/** Which vendor session a turn uses, decided at admission. */
export type SessionPlan =
  | { readonly kind: 'stateless' }
  | { readonly kind: 'fresh'; readonly seeded: boolean }
  | { readonly kind: 'resume'; readonly rowId: number; readonly ref: string; readonly priorState: SessionState };

/**
 * What a turn answers. `chat`: the user's message, answered in the chat. `agent-message`: another agent's
 * message, read in the background with `prompt`; the chat shows nothing unless the agent tells the user.
 * `reaction`: the user's reaction to one of the agent's replies.
 */
export type TurnSource =
  /** `prompt` is what the provider reads: the message's text, or it with a steer note (see steer-prompt.ts). */
  | { readonly kind: 'chat'; readonly message: UserMessage; readonly prompt: string }
  | { readonly kind: 'agent-message'; readonly message: AgentMessage; readonly prompt: string }
  /** The user reacted `emoji` to the agent's reply `message`; what the agent writes is shown as a reply. */
  | { readonly kind: 'reaction'; readonly message: AssistantMessage; readonly emoji: string; readonly prompt: string };

/** One admitted turn, from the admission transaction until its outcome is stored and its processes are gone. */
export interface Turn {
  readonly generationId: string;
  readonly threadId: string;
  readonly agentId: string;
  readonly pluginId: string;
  readonly accountKey: string;
  readonly routeKey: string;
  /** The canonical (realpath) workspace the turn runs in. */
  readonly cwd: string;
  /** `background` (a routine run) never asks for approval. */
  readonly mode: TurnMode;
  readonly binding: BoundProvider;
  readonly bindingJson: string;
  readonly workspaceDir: string;
  readonly configRevision: number;
  readonly worker: number;
  /** The plugin's daemon revision at admission: a daemon retired or exited since refuses the turn at dispatch. */
  readonly daemonRevision: number;
  readonly maxSeedBytes: number | undefined;
  readonly plan: SessionPlan;
  /** What the turn answers now: a delivered steer makes it answer the steered message. */
  source: TurnSource;
  /** For a sub-agent's turn, the turn that started it: it never outlives that turn. */
  readonly parent: { readonly threadId: string; readonly generationId: string } | null;
  /** The thread's messages before a chat input (all of them for a background turn): what a seed is made from. */
  readonly history: readonly Message[];
  state: 'queued' | 'dispatching' | 'running' | 'settled';
  dispatched: boolean;
  text: string;
  textBytes: number;
  chunkCount: number;
  outputExceeded: OutputLimitKind | null;
  flushTimer: NodeJS.Timeout | undefined;
  seedTruncated: boolean;
  /** The AGENTS.md hash read at dispatch, saved with a new session. */
  systemHash: string | null;
  /** The session row this turn bound (`session-bound`). */
  boundRow: number | null;
  /** Set when the account changed under the turn: its later output is dropped. */
  fenced: boolean;
  stopRequested: boolean;
  /** Set by the `stay_quiet` tool: a completed turn adds no message to the chat. */
  silent: boolean;
  /** The queued message being steered into this turn, and how: sent to the plugin, or by stopping the turn. */
  steer: { readonly id: string; readonly via: 'native' | 'interrupt' } | null;
  readonly approvals: Map<string, PendingApproval>;
  readonly settled: PromiseWithResolvers<StoredReply>;
  /** Resolves once the turn's process groups are all gone: the thread and its slot are free. */
  readonly released: PromiseWithResolvers<void>;
  /** Resolves once cleanup is over: groups gone, or the rest blocked (the thread stays busy until they go). */
  readonly quiet: PromiseWithResolvers<void>;
}

/**
 * A settled turn's reply; `quiet` for a turn that added no message (a background turn that told the user
 * nothing, or a turn the agent ended with `stay_quiet`); `not-stored` when the
 * database refused it (the next boot settles it as interrupted).
 */
export type StoredReply =
  | { readonly kind: 'stored'; readonly message: AssistantMessage }
  | { readonly kind: 'quiet' }
  | { readonly kind: 'not-stored' };

/** Turns that share a concurrency slot pool: one plugin and account. */
export interface Lane {
  readonly running: Set<Turn>;
  readonly queue: Turn[];
}

export const MAX_RUNNING_PER_ACCOUNT = 2;

/** State shared by the chat service's parts. */
export interface ChatCore {
  readonly options: ChatServiceOptions;
  readonly events: EventLog;
  /** The turn of each busy thread. */
  readonly active: Map<string, Turn>;
  readonly lanes: Map<string, Lane>;
  /** Plugin + account pairs whose output is dropped after an account change. */
  readonly fenced: Set<string>;
  /** Plugins in Recheck: no new sends are admitted. */
  readonly rechecking: Set<string>;
  /** Live-only usage windows per plugin worker for turns whose account is unknown (''): shown, never saved. */
  readonly liveUsage: Map<string, LiveUsage>;
  readonly deletingThreads: Set<string>;
  readonly deletingAgents: Set<string>;
  /** Each queued message's state this host run (see queue.ts); the messages themselves are stored. */
  readonly queueStates: Map<string, QueuedMessageState>;
  /** Threads whose next queued message is being admitted, with that message's id. */
  readonly draining: Map<string, string>;
  /** Each thread's reactions of the user's that the agent has not read yet, oldest first (kept this host run only). */
  readonly reactionNotes: Map<string, ReactionNote[]>;
  /** Sends a turn that got a slot (see dispatch.ts). */
  readonly dispatch: (turn: Turn) => Promise<void>;
  /**
   * A settled turn freed its thread: the user's queue goes first (see queue.ts), then the next message
   * waiting from another agent, then the user's next reaction.
   */
  readonly afterTurn: (turn: Turn, outcome: GenerationOutcome) => void;
  /** Starts a turn on the next message waiting from another agent, or the next reaction, if the thread is free. */
  readonly readNext: (threadId: string) => void;
  /** A turn settled: its sub-agents still queued or running are stopped. */
  readonly endChildren: (turn: Turn) => void;
  /** A sub-agent's turn started, began running or settled: its parent chat hears `subagent.changed`. */
  readonly subagentChanged: (turn: Turn) => void;
  closed: boolean;
}

export function laneKey(pluginId: string, accountKey: string): string {
  return `${pluginId}\0${accountKey}`;
}

export function laneOf(core: ChatCore, turn: Turn): Lane {
  const key = laneKey(turn.pluginId, turn.accountKey);
  let lane = core.lanes.get(key);
  if (lane === undefined) {
    lane = { running: new Set(), queue: [] };
    core.lanes.set(key, lane);
  }
  return lane;
}

export interface Settlement {
  readonly outcome: TurnOutcome;
  readonly usage: TurnUsage;
  readonly actualModel: string | null;
  readonly finalText: string | null;
  /** False when the plugin reported nothing reached the vendor session. */
  readonly sessionTouched: boolean;
}

export function localSettlement(outcome: TurnOutcome): Settlement {
  return { outcome, usage: { kind: 'unavailable' }, actualModel: null, finalText: null, sessionTouched: false };
}

/**
 * Stores a turn's outcome in one transaction: the reply (if the chat shows one), its usage, the settled
 * generation and the session row's new state. Then frees the thread once the turn's process groups are gone.
 */
export function settle(core: ChatCore, turn: Turn, result: Settlement): AssistantMessage | undefined {
  if (turn.state === 'settled') return undefined;
  turn.state = 'settled';
  core.options.tools.close(turn.generationId);
  core.endChildren(turn);
  clearTimeout(turn.flushTimer);
  const { newId, now } = core.options;
  const createdAt = now();
  const outcome = replyOutcome(turn, result.outcome);
  const text = shownText(core, turn, turn.text !== '' ? turn.text : (result.finalText ?? ''), result.outcome);
  const base: AssistantMessage | null = text === null ? null : { kind: 'assistant', id: newId(), threadId: turn.threadId, text, outcome, createdAt };
  const message: AssistantMessage | null = base !== null && turn.seedTruncated ? { ...base, seedTruncated: true } : base;
  if (!persistSettlement(core, turn, message, result, createdAt)) {
    turn.settled.resolve({ kind: 'not-stored' });
    releaseWhenGone(core, turn, { keepThreadBusy: true, outcome: null });
    return undefined;
  }
  for (const approval of turn.approvals.values()) {
    core.events.publish({
      kind: 'generation.approval-resolved',
      threadId: turn.threadId,
      generationId: turn.generationId,
      approvalId: approval.approvalId,
      resolution: { kind: 'cleared' },
    });
  }
  turn.approvals.clear();
  const ref = { threadId: turn.threadId, generationId: turn.generationId };
  if (message === null) {
    turn.settled.resolve({ kind: 'quiet' });
    core.events.publish({ kind: 'generation.background-finished', ...ref, outcome: result.outcome });
  } else {
    turn.settled.resolve({ kind: 'stored', message });
    core.events.publish({ kind: 'generation.finished', ...ref, message });
  }
  core.subagentChanged(turn);
  releaseWhenGone(core, turn, { keepThreadBusy: false, outcome });
  return message ?? undefined;
}

/**
 * What the chat shows for a settled turn: a chat turn's reply, or a background turn's notice to the user
 * (null for none). A completed background turn's answer is sent to the agent that asked; an answer that
 * cannot be sent is shown to the user instead, so it is never lost. A completed turn the agent ended with
 * `stay_quiet`, or a reaction's turn that wrote nothing, shows nothing; a failed or stopped one still does.
 */
function shownText(core: ChatCore, turn: Turn, text: string, outcome: TurnOutcome): string | null {
  const { source } = turn;
  const completed = outcome.kind === 'completed';
  switch (source.kind) {
    case 'chat':
      return completed && turn.silent ? null : text;
    case 'reaction':
      return completed && (turn.silent || text.trim() === '') ? null : text;
    case 'agent-message': {
      if (outcome.kind !== 'completed') return null;
      const { reply, notice } = splitAnswer(text);
      const sent = reply === '' || !answersSender(source.message) ? null : core.options.inbox.reply(source.message, reply);
      const parts = sent?.kind === 'refused' ? [notice, `My reply could not be sent: ${sent.reason}`, reply] : [notice];
      const shown = parts.filter((part) => part !== '').join('\n\n');
      return shown === '' ? null : shown;
    }
  }
}

/** A turn stopped for a steer, not by the user, ends as `steered`: its message runs next. */
function replyOutcome(turn: Turn, outcome: TurnOutcome): GenerationOutcome {
  const stoppedForSteer = turn.steer?.via === 'interrupt' && !turn.stopRequested;
  return stoppedForSteer && (outcome.kind === 'cancelled' || outcome.kind === 'interrupted') ? { kind: 'steered' } : outcome;
}

/** Writes the reply, usage, settled generation and session effect in one transaction; false when it fails. */
function persistSettlement(core: ChatCore, turn: Turn, message: AssistantMessage | null, result: Settlement, createdAt: string): boolean {
  const { store } = core.options;
  try {
    store.transaction(() => {
      if (message !== null) {
        store.messages.insert(message);
        store.threads.touch(turn.threadId, createdAt);
      }
      store.generations.settle(turn.generationId, message?.id ?? null);
      store.toolSteps.close(turn.generationId, message?.id ?? null);
      store.cards.close(turn.generationId, message?.id ?? null);
      if (turn.source.kind === 'agent-message') store.agentMessages.setReadOutcome(turn.source.message.id, result.outcome.kind);
      if (!turn.dispatched) return;
      store.generations.insertUsage({
        generationId: turn.generationId,
        agentId: turn.agentId,
        threadId: turn.threadId,
        pluginId: turn.pluginId,
        accountKey: turn.accountKey,
        actualModel: result.actualModel,
        usage: turn.fenced ? { kind: 'unavailable' } : result.usage,
        outcome: result.outcome,
        createdAt,
      });
      applySessionEffect(core, turn, result);
      core.options.plugins.unlinkDaemon(turn.generationId);
    });
    return true;
  } catch (error) {
    core.options.report(error);
    return false;
  }
}

function applySessionEffect(core: ChatCore, turn: Turn, result: Settlement): void {
  const { sessions } = core.options.store;
  const row = turn.plan.kind === 'resume' ? turn.plan.rowId : turn.boundRow;
  if (row === null || turn.fenced) return;
  const { outcome } = result;
  if (outcome.kind === 'failed' && outcome.error.kind === 'session-lost') {
    sessions.delete(row);
  } else if (outcome.kind === 'failed' && outcome.error.kind === 'route-changed') {
    sessions.setState(row, 'needs-seed');
  } else if (!result.sessionTouched && turn.plan.kind === 'resume') {
    sessions.setState(row, turn.plan.priorState);
  } else if (outcome.kind === 'completed' && cleanAfterCompletion(turn)) {
    sessions.setState(row, 'clean');
  }
}

/** A completed turn cleans a session it freshly bound, or a resumed one that was clean before; a diverged ref stays diverged. */
function cleanAfterCompletion(turn: Turn): boolean {
  switch (turn.plan.kind) {
    case 'fresh':
      return turn.boundRow !== null;
    case 'resume':
      return turn.plan.priorState === 'clean';
    case 'stateless':
      return false;
  }
}

/**
 * A thread stays busy until its turn is settled and every process group of the turn is confirmed gone
 * (for good when its reply could not be stored). Stop returns earlier, once the remaining groups are
 * blocked (shown in `/state`) rather than still being checked.
 */
function releaseWhenGone(
  core: ChatCore,
  turn: Turn,
  { keepThreadBusy, outcome }: { readonly keepThreadBusy: boolean; readonly outcome: GenerationOutcome | null },
): void {
  const { plugins } = core.options;
  const release = (): void => {
    const freed = !keepThreadBusy && core.active.get(turn.threadId) === turn;
    if (freed) core.active.delete(turn.threadId);
    const lane = laneOf(core, turn);
    lane.running.delete(turn);
    turn.quiet.resolve();
    turn.released.resolve();
    pump(core, lane);
    if (freed && outcome !== null) core.afterTurn(turn, outcome);
  };
  const update = (): boolean => {
    if (!plugins.holdsGeneration(turn.generationId)) {
      release();
      return true;
    }
    if (!plugins.cleaningUp(turn.generationId)) turn.quiet.resolve();
    return false;
  };
  if (update()) return;
  const stops = [plugins.onGroupReleased(listen), plugins.onGroupBlocked(listen)];
  function listen(): void {
    if (!update()) return;
    for (const stop of stops) stop();
  }
}

/** Starts queued turns while the lane has a free slot. */
export function pump(core: ChatCore, lane: Lane): void {
  while (lane.running.size < MAX_RUNNING_PER_ACCOUNT && lane.queue.length > 0) {
    const next = lane.queue.shift();
    if (next === undefined) break;
    if (next.state !== 'queued') continue;
    lane.running.add(next);
    void core.dispatch(next);
  }
  for (const queued of lane.queue) {
    core.events.publish({
      kind: 'generation.status',
      threadId: queued.threadId,
      generationId: queued.generationId,
      state: 'queued',
      queueNote: queueNote(lane),
      detail: null,
    });
  }
}

export function queueNote(lane: Lane): string {
  return [...lane.running].some((turn) => turn.approvals.size > 0)
    ? 'Waiting: a pending approval holds a slot'
    : `Waiting for one of ${String(MAX_RUNNING_PER_ACCOUNT)} running turns to finish`;
}
