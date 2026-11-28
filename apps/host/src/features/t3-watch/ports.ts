import type { T3Watch, T3WatchEvent } from '@morrowbot/contracts';
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
    cursor(name: string): FileCursor | undefined;
    setCursor(name: string, cursor: FileCursor): void;
  };
  transaction<T>(work: () => T): T;
}
