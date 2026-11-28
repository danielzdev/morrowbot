import type { T3Watch, T3WatchBatch, T3WatchEvent } from '@morrowbot/contracts';
import type { ListResult, ProbeResult } from './observation.ts';

/** How the service reads T3 Code. v1 is the CLI; tests script the answers. */
export interface T3Probe {
  inspect(threadId: string): Promise<ProbeResult>;
  /** The project's threads (subagents left out), for discovery. */
  list(project: string): Promise<ListResult>;
}

/** Wall time in ms and the loop's timer. A jump in `now` (the computer slept) is never counted as awake time. */
export interface T3WatchClock {
  now(): number;
  every(ms: number, tick: () => void): () => void;
}

/** A watch as stored, with the state machine's memory as JSON. */
export type T3WatchRecord = T3Watch & { readonly memory: string };

export interface FileCursor {
  readonly inode: string;
  readonly offset: number;
}

/** A queued event and when it may go out next. */
export interface T3OutboxEntry {
  readonly event: T3WatchEvent;
  readonly dueAt: string;
  /** Counted deferrals so far; the third sends it once more, `unverified`. */
  readonly deferrals: number;
  readonly countedDeferralAt: string | null;
  readonly unverified: boolean;
}

export type T3OutboxSchedule = Omit<T3OutboxEntry, 'event'>;

/** A batch as stored, with its events in the order they were first sent. */
export interface T3BatchRecord {
  readonly batchId: string;
  readonly createdAt: string;
  /** How many times the sink took it; 0 until the first send went through. */
  readonly attempts: number;
  /** When it is sent again unless acknowledged first: its lease, or a retry after a failed send. */
  readonly resendAt: string;
  readonly ackedAt: string | null;
  readonly entries: readonly { readonly event: T3WatchEvent; readonly unverified: boolean }[];
}

/** What a send to the orchestrator's routine came to. */
export type SinkAnswer = { readonly kind: 'sent' } | { readonly kind: 'busy' } | { readonly kind: 'failed'; readonly reason: string };

/** Where a watch's batch goes: its owning routine, and the Ori Bot chat to deliver its report to (null for the agent's main chat). */
export interface T3DeliveryTarget {
  readonly routineId: string | null;
  readonly chatThreadId: string | null;
}

/** Where batches go: one background routine of the orchestrator, whose posted report is delivered to the creating or main chat. */
export interface T3DeliverySink {
  /** Resolves a watch's bound routine and creating chat to a concrete target, or null to hold in outbox. */
  targetFor?(watch: T3DeliveryTarget): T3DeliveryTarget | null;
  /** True while that routine or any turn of the orchestrator agent runs; batches hold until it has been idle 5 s. */
  busy(target?: T3DeliveryTarget | null): boolean;
  deliver(batch: T3WatchBatch, target?: T3DeliveryTarget | null): Promise<SinkAnswer>;
}

/** Where watches, their events and the outbox are kept (the storage feature provides them). */
export interface T3WatchStore {
  readonly watches: {
    insert(record: T3WatchRecord): void;
    update(record: T3WatchRecord): boolean;
    delete(watchId: string): boolean;
    get(watchId: string): T3WatchRecord | undefined;
    list(): T3WatchRecord[];
    open(): T3WatchRecord[];
    current(threadId: string): T3WatchRecord | undefined;
    currentAll(): T3WatchRecord[];
    unsettled(threadId: string): T3WatchRecord[];
  };
  readonly outbox: {
    queue(event: T3WatchEvent): boolean;
    get(eventId: string): T3WatchEvent | undefined;
    pending(): T3WatchEvent[];
    acknowledge(eventId: string): boolean;
    drop(eventId: string): void;
    undispatched(watchId: string): T3WatchEvent[];
    undelivered(): T3OutboxEntry[];
    entry(eventId: string): T3OutboxEntry | undefined;
    reschedule(eventId: string, schedule: T3OutboxSchedule): void;
    release(eventId: string): void;
    cursor(name: string): FileCursor | undefined;
    setCursor(name: string, cursor: FileCursor): void;
  };
  readonly batches: {
    open(): T3BatchRecord | undefined;
    get(batchId: string): T3BatchRecord | undefined;
    insert(batch: Pick<T3BatchRecord, 'batchId' | 'createdAt' | 'resendAt'>, entries: readonly { readonly eventId: string; readonly unverified: boolean }[]): void;
    reschedule(batchId: string, attempts: number, resendAt: string): void;
    acknowledge(batchId: string, at: string): void;
  };
  transaction<T>(work: () => T): T;
}
