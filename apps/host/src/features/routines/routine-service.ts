import type {
  CreateRoutineRequest,
  OpenWaitRequest,
  Routine,
  RoutineRun,
  RunRoutineRequest,
  UpdateRoutineRequest,
  Wait,
} from '@morrowbot/contracts';
import type { RoutineChat, RoutineClock, RoutineRecord, RoutineStore } from './ports.ts';
import { startRun, type RunInput, type RunSettled } from './run.ts';
import { GRACE_MS, nextAfter, normalized, scheduleProblem, TICK_MS } from './schedule.ts';

export interface RoutineServiceOptions {
  readonly store: RoutineStore;
  readonly chat: RoutineChat;
  readonly clock: RoutineClock;
  readonly newId: () => string;
  /** Stamps records; the schedule itself follows `clock`. */
  readonly now: () => string;
  readonly report: (error: unknown) => void;
}

export type SaveResult =
  | { readonly kind: 'saved'; readonly routine: Routine }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'invalid'; readonly reason: string };

export type RunResult =
  | { readonly kind: 'started'; readonly run: RoutineRun }
  | { readonly kind: 'not-found' }
  /** The routine's previous run is still going. Nothing was started and the wait stays open. */
  | { readonly kind: 'busy' }
  | { readonly kind: 'invalid'; readonly reason: string }
  /** The wait was woken or closed already, so a retried call does not run the routine twice. */
  | { readonly kind: 'wait-closed' };

export type OpenWaitResult = { readonly kind: 'opened'; readonly wait: Wait } | { readonly kind: 'invalid'; readonly reason: string };

export type NoUpdateResult =
  | { readonly kind: 'marked'; readonly routineId: string; readonly runId: string }
  | { readonly kind: 'not-a-routine-run' };

export interface RunDeliveryOptions {
  /** Optional target chat thread to inherit if the run registers follow-up T3 watches. */
  readonly replyThreadId?: string | null;
  /** Called right before the run is marked finished in storage. */
  readonly onSettled?: (outcome: RunSettled, runThreadId: string) => void;
}

export type RoutineChatOrigin =
  | { readonly isRoutineThread: false }
  | { readonly isRoutineThread: true; readonly replyThreadId: string | null };

export interface RoutineService {
  list(agentId?: string): Routine[];
  get(id: string): Routine | undefined;
  create(request: CreateRoutineRequest): SaveResult;
  update(id: string, request: UpdateRoutineRequest): SaveResult;
  delete(id: string): boolean;
  /** Runs a routine now, paused or not; resolves once the provider admitted (or refused) the run. */
  run(id: string, request: RunRoutineRequest, delivery?: RunDeliveryOptions): Promise<RunResult>;
  /** Marks an active routine run in `threadId` owned by `agentId` as silent (nothing to report). */
  markNoUpdate(agentId: string, threadId: string): NoUpdateResult;
  /** Whether `threadId` is an active routine run's temporary chat, and which chat it reports back to. */
  originChatOf(threadId: string): RoutineChatOrigin;
  listWaits(): Wait[];
  openWait(request: OpenWaitRequest): OpenWaitResult;
  /** Closes a wait without waking anything. False when no such wait exists. */
  closeWait(waitId: string): boolean;
  /** Starts due runs and records the ones missed while the host was asleep or off. */
  tick(): void;
  /** Stops the timer; runs still going are recorded as failed. */
  close(): void;
}

const STOPPED = 'The host stopped during this run.';

/**
 * Routines: scheduled, one-time and manual agent runs, each in a chat of its own. A run due while the
 * host was asleep or off is recorded once as missed, and the schedule moves on from now (no backlog).
 */
export function createRoutineService(options: RoutineServiceOptions): RoutineService {
  const { store, chat, clock } = options;
  const running = new Map<string, string>();
  const activeRuns = new Map<
    string,
    { readonly runId: string; readonly routineId: string; readonly agentId: string; readonly replyThreadId: string | null; silent: boolean }
  >();
  const listeners = new Set<() => void>();
  const followed: RoutineChat = {
    ...chat,
    subscribe: (listener) => {
      const stop = chat.subscribe(listener);
      listeners.add(stop);
      return () => {
        listeners.delete(stop);
        stop();
      };
    },
  };
  const context = {
    store,
    chat: followed,
    newId: options.newId,
    now: options.now,
    report: options.report,
    onRunOpen: (run: {
      readonly runId: string;
      readonly routineId: string;
      readonly agentId: string;
      readonly threadId: string;
      readonly replyThreadId: string | null;
    }) => {
      activeRuns.set(run.threadId, {
        runId: run.runId,
        routineId: run.routineId,
        agentId: run.agentId,
        replyThreadId: run.replyThreadId,
        silent: false,
      });
    },
    onRunClose: (threadId: string) => {
      const active = activeRuns.get(threadId);
      activeRuns.delete(threadId);
      return active?.silent ?? false;
    },
  };

  for (const run of store.runs.running()) store.runs.finish(run.id, { kind: 'failed', finishedAt: options.now(), reason: STOPPED }, run.threadId);

  const view = (record: RoutineRecord, latest = store.runs.latest()): Routine => ({ ...record, lastRun: latest.get(record.id) ?? null });
  const nextRunAt = (record: Pick<RoutineRecord, 'active' | 'schedule'>): string | null =>
    record.active ? nextAfter(record.schedule, clock.now()) : null;

  const begin = async (record: RoutineRecord, input: RunInput): Promise<RoutineRun> => {
    const runId = options.newId();
    running.set(record.id, runId);
    try {
      const started = await startRun(context, record, input);
      void started.settled
        .catch(options.report)
        .finally(() => {
          if (running.get(record.id) === runId) running.delete(record.id);
        });
      return started.run;
    } catch (error) {
      running.delete(record.id);
      throw error;
    }
  };

  const markRan = (record: RoutineRecord, next: string | null): RoutineRecord => {
    const updated: RoutineRecord = { ...record, lastRunAt: options.now(), nextRunAt: next };
    store.routines.update(updated);
    return updated;
  };

  const tick = (): void => {
    const now = clock.now();
    for (const record of store.routines.due(new Date(now).toISOString())) {
      const dueAt = record.nextRunAt;
      if (dueAt === null) continue;
      let next: string | null;
      try {
        next = nextRunAt(record);
      } catch (error) {
        options.report(error);
        next = null;
      }
      if (now - Date.parse(dueAt) > GRACE_MS) {
        store.transaction(() => {
          store.runs.insert({ id: options.newId(), routineId: record.id, trigger: 'schedule', waitId: null, at: dueAt, threadId: null, result: { kind: 'missed' } });
          store.routines.update({ ...record, nextRunAt: next });
        });
        continue;
      }
      if (running.has(record.id)) {
        store.routines.update({ ...record, nextRunAt: next });
        continue;
      }
      const updated = markRan(record, next);
      begin(updated, { trigger: 'schedule', payload: { kind: 'none' }, wait: null }).catch(options.report);
    }
  };

  const stopTimer = clock.every(TICK_MS, () => {
    try {
      tick();
    } catch (error) {
      options.report(error);
    }
  });

  return {
    list: (agentId) => {
      const latest = store.runs.latest();
      return store.routines.list(agentId).map((record) => view(record, latest));
    },
    get: (id) => {
      const record = store.routines.get(id);
      return record === undefined ? undefined : view(record);
    },
    create: (request) => {
      if (!chat.agentExists(request.agentId)) return { kind: 'invalid', reason: 'No such agent.' };
      const schedule = normalized(request.schedule);
      const problem = scheduleProblem(schedule, clock.now());
      if (problem !== undefined) return { kind: 'invalid', reason: problem };
      const at = options.now();
      const fields = { active: request.active, schedule };
      const record: RoutineRecord = {
        id: options.newId(),
        agentId: request.agentId,
        title: request.title,
        instruction: request.instruction,
        schedule,
        active: request.active,
        stayQuietIfNothingNew: request.stayQuietIfNothingNew,
        lastRunAt: null,
        nextRunAt: nextRunAt(fields),
        createdAt: at,
        updatedAt: at,
      };
      store.routines.insert(record);
      return { kind: 'saved', routine: view(record) };
    },
    update: (id, request) => {
      const current = store.routines.get(id);
      if (current === undefined) return { kind: 'not-found' };
      const schedule = request.schedule === undefined ? current.schedule : normalized(request.schedule);
      if (request.schedule !== undefined) {
        const problem = scheduleProblem(schedule, clock.now());
        if (problem !== undefined) return { kind: 'invalid', reason: problem };
      }
      const active = request.active ?? current.active;
      const timing = request.schedule !== undefined || active !== current.active;
      const record: RoutineRecord = {
        ...current,
        title: request.title ?? current.title,
        instruction: request.instruction ?? current.instruction,
        stayQuietIfNothingNew: request.stayQuietIfNothingNew ?? current.stayQuietIfNothingNew,
        schedule,
        active,
        nextRunAt: timing ? nextRunAt({ active, schedule }) : current.nextRunAt,
        updatedAt: options.now(),
      };
      return store.routines.update(record) ? { kind: 'saved', routine: view(record) } : { kind: 'not-found' };
    },
    delete: (id) => store.routines.delete(id),
    run: async (id, request, delivery) => {
      const record = store.routines.get(id);
      if (record === undefined) return { kind: 'not-found' };
      let wait: Wait | null = null;
      if (request.waitId !== undefined) {
        const found = store.waits.get(request.waitId);
        if (found === undefined) return { kind: 'invalid', reason: 'No such wait.' };
        if (found.agentId !== record.agentId || (found.routineId !== null && found.routineId !== record.id)) {
          return { kind: 'invalid', reason: 'That wait belongs to another routine.' };
        }
        if (found.closedAt !== null) return { kind: 'wait-closed' };
        wait = found;
      }
      if (running.has(id)) return { kind: 'busy' };
      if (wait !== null) store.waits.close(wait.waitId, options.now(), true);
      const woken = wait !== null || request.payload !== undefined;
      const run = await begin(markRan(record, record.nextRunAt), {
        trigger: woken ? 'wake' : 'manual',
        payload: request.payload === undefined ? { kind: 'none' } : { kind: 'json', value: request.payload },
        wait,
        ...(delivery?.replyThreadId === undefined ? {} : { replyThreadId: delivery.replyThreadId }),
        ...(delivery?.onSettled === undefined ? {} : { onSettled: delivery.onSettled }),
      });
      return { kind: 'started', run };
    },
    markNoUpdate: (agentId, threadId) => {
      const active = activeRuns.get(threadId);
      if (active?.agentId !== agentId) return { kind: 'not-a-routine-run' };
      active.silent = true;
      return { kind: 'marked', routineId: active.routineId, runId: active.runId };
    },
    originChatOf: (threadId) => {
      const active = activeRuns.get(threadId);
      return active === undefined ? { isRoutineThread: false } : { isRoutineThread: true, replyThreadId: active.replyThreadId };
    },
    listWaits: () => store.waits.listOpen(),
    openWait: (request) => {
      if (!chat.agentExists(request.agentId)) return { kind: 'invalid', reason: 'No such agent.' };
      if (request.routineId !== null && store.routines.get(request.routineId)?.agentId !== request.agentId) {
        return { kind: 'invalid', reason: "No such routine for this agent." };
      }
      const wait: Wait = { waitId: options.newId(), agentId: request.agentId, routineId: request.routineId, note: request.note, openedAt: options.now(), wokenAt: null, closedAt: null };
      store.waits.insert(wait);
      return { kind: 'opened', wait };
    },
    closeWait: (waitId) => {
      if (store.waits.get(waitId) === undefined) return false;
      store.waits.close(waitId, options.now(), false);
      return true;
    },
    tick,
    close: () => {
      stopTimer();
      for (const stop of listeners) stop();
      listeners.clear();
      for (const run of store.runs.running()) store.runs.finish(run.id, { kind: 'failed', finishedAt: options.now(), reason: STOPPED }, run.threadId);
      running.clear();
      activeRuns.clear();
    },
  };
}
