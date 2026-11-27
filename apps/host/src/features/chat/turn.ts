import type {
  AssistantMessage,
  Message,
  PendingApproval,
  ProviderBinding,
  TurnOutcome,
  TurnUsage,
  UsageWindow,
  UserMessage,
} from '@morrowbot/contracts';
import type { EventLog } from './event-log.ts';
import type { ChatServiceOptions, SessionState } from './ports.ts';

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
  readonly binding: BoundProvider;
  readonly bindingJson: string;
  readonly workspaceDir: string;
  readonly configRevision: number;
  readonly worker: number;
  readonly maxSeedBytes: number | undefined;
  readonly plan: SessionPlan;
  readonly sourceInput: UserMessage;
  /** The thread's messages before the source input: what a seed is made from. */
  readonly history: readonly Message[];
  state: 'queued' | 'dispatching' | 'running' | 'settled';
  dispatched: boolean;
  text: string;
  flushTimer: NodeJS.Timeout | undefined;
  seedTruncated: boolean;
  /** The AGENTS.md hash read at dispatch, saved with a new session. */
  systemHash: string | null;
  /** The session row this turn bound (`session-bound`). */
  boundRow: number | null;
  /** Set when the account changed under the turn: its later output is dropped. */
  fenced: boolean;
  stopRequested: boolean;
  readonly approvals: Map<string, PendingApproval>;
  readonly settled: PromiseWithResolvers<AssistantMessage>;
  /** Resolves once the turn's process groups are all gone: the thread and its slot are free. */
  readonly released: PromiseWithResolvers<void>;
  /** Resolves once cleanup is over: groups gone, or the rest blocked (the thread stays busy until they go). */
  readonly quiet: PromiseWithResolvers<void>;
}

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
  /** Sends a turn that got a slot (see dispatch.ts). */
  readonly dispatch: (turn: Turn) => Promise<void>;
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
 * Stores a turn's outcome in one transaction: the reply, its usage, the settled generation and
 * the session row's new state. Then frees the thread once the turn's process groups are gone.
 */
export function settle(core: ChatCore, turn: Turn, result: Settlement): AssistantMessage | undefined {
  if (turn.state === 'settled') return undefined;
  turn.state = 'settled';
  clearTimeout(turn.flushTimer);
  const { newId, now } = core.options;
  const createdAt = now();
  const text = turn.text !== '' ? turn.text : (result.finalText ?? '');
  const base: AssistantMessage = { kind: 'assistant', id: newId(), threadId: turn.threadId, text, outcome: result.outcome, createdAt };
  const message: AssistantMessage = turn.seedTruncated ? { ...base, seedTruncated: true } : base;
  if (!persistSettlement(core, turn, message, result, createdAt)) {
    // Nothing was stored: the thread stays busy and the next boot settles the turn as interrupted.
    turn.settled.resolve(message);
    turn.quiet.resolve();
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
  turn.settled.resolve(message);
  core.events.publish({ kind: 'generation.finished', threadId: turn.threadId, generationId: turn.generationId, message });
  releaseWhenGone(core, turn);
  return message;
}

/**
 * Writes the reply, usage, settled generation and session effect in one transaction. If that fails,
 * at least the reply and the settled generation; false when even that fails.
 */
function persistSettlement(core: ChatCore, turn: Turn, message: AssistantMessage, result: Settlement, createdAt: string): boolean {
  const { store } = core.options;
  const reply = (): void => {
    store.messages.insert(message);
    store.threads.touch(turn.threadId, createdAt);
    store.generations.settle(turn.generationId, message.id);
  };
  try {
    store.transaction(() => {
      reply();
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
    });
    return true;
  } catch (error) {
    core.options.report(error);
  }
  try {
    store.transaction(reply);
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
 * A thread stays busy until its turn is settled and every process group of the turn is confirmed gone.
 * Stop returns earlier, once the remaining groups are blocked (shown in `/state`) rather than still being checked.
 */
function releaseWhenGone(core: ChatCore, turn: Turn): void {
  const { plugins } = core.options;
  const release = (): void => {
    if (core.active.get(turn.threadId) === turn) core.active.delete(turn.threadId);
    const lane = laneOf(core, turn);
    lane.running.delete(turn);
    turn.quiet.resolve();
    turn.released.resolve();
    pump(core, lane);
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
