import type { ChatEvent, Cursor } from '@morrowbot/contracts';

type ThreadEvent = Exclude<ChatEvent, { kind: 'usage.updated' }>;
/** A thread event before the log gives it its cursor. */
export type NewThreadEvent = ThreadEvent extends infer E ? (E extends ThreadEvent ? Omit<E, 'cursor'> : never) : never;

export type Replay = { readonly kind: 'events'; readonly events: readonly ChatEvent[] } | { readonly kind: 'resync' };

const KEEP_PER_THREAD = 1_000;
const IDLE_TRIM_MS = 60_000;

interface ThreadLog {
  seq: number;
  events: ChatEvent[];
  trim: NodeJS.Timeout | undefined;
}

/**
 * Numbers each thread's events (`{hostEpoch, seq}`) and keeps the latest ones, so a client that
 * reconnects with its cursor gets exactly the events it missed, or `resync` when they are gone
 * (another host epoch, or older than what is kept). A thread idle for `idleMs` after a turn
 * finished keeps only its seq. Everything here is synchronous, so a replay and the switch to live
 * events can never miss or repeat an event.
 */
export class EventLog {
  private readonly threads = new Map<string, ThreadLog>();
  private readonly listeners = new Set<(event: ChatEvent) => void>();
  readonly hostEpoch: string;
  private readonly idleMs: number;

  constructor(hostEpoch: string, idleMs = IDLE_TRIM_MS) {
    this.hostEpoch = hostEpoch;
    this.idleMs = idleMs;
  }

  cursor(threadId: string): Cursor {
    return { hostEpoch: this.hostEpoch, seq: this.threads.get(threadId)?.seq ?? 0 };
  }

  publish(event: NewThreadEvent): ChatEvent {
    const log = this.threads.get(event.threadId) ?? { seq: 0, events: [], trim: undefined };
    this.threads.set(event.threadId, log);
    clearTimeout(log.trim);
    log.trim = undefined;
    log.seq += 1;
    const stamped = withCursor(event, { hostEpoch: this.hostEpoch, seq: log.seq });
    log.events.push(stamped);
    if (log.events.length > KEEP_PER_THREAD) log.events.shift();
    if (event.kind === 'generation.finished' || event.kind === 'generation.background-finished') {
      log.trim = setTimeout(() => {
        log.events = [];
        log.trim = undefined;
      }, this.idleMs).unref();
    }
    this.emit(stamped);
    return stamped;
  }

  /** Events that are not part of any thread's cursor. */
  publishGlobal(event: Extract<ChatEvent, { kind: 'usage.updated' }>): void {
    this.emit(event);
  }

  replay(threadId: string, since: Cursor): Replay {
    const log = this.threads.get(threadId);
    const seq = log?.seq ?? 0;
    if (since.hostEpoch !== this.hostEpoch || since.seq > seq) return { kind: 'resync' };
    const events = log?.events ?? [];
    const first = events[0]?.kind === 'usage.updated' ? undefined : events[0]?.cursor.seq;
    if (since.seq < seq && (first === undefined || first > since.seq + 1)) return { kind: 'resync' };
    return { kind: 'events', events: events.filter((event) => event.kind !== 'usage.updated' && event.cursor.seq > since.seq) };
  }

  forget(threadId: string): void {
    clearTimeout(this.threads.get(threadId)?.trim);
    this.threads.delete(threadId);
  }

  subscribe(listener: (event: ChatEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: ChatEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function withCursor(event: NewThreadEvent, cursor: Cursor): ChatEvent {
  switch (event.kind) {
    case 'generation.started':
      return { ...event, cursor };
    case 'generation.status':
      return { ...event, cursor };
    case 'generation.delta':
      return { ...event, cursor };
    case 'generation.tool-start':
      return { ...event, cursor };
    case 'generation.tool-end':
      return { ...event, cursor };
    case 'generation.approval-requested':
      return { ...event, cursor };
    case 'generation.approval-resolved':
      return { ...event, cursor };
    case 'generation.steered':
      return { ...event, cursor };
    case 'generation.finished':
      return { ...event, cursor };
    case 'queue.changed':
      return { ...event, cursor };
    case 'generation.background-started':
      return { ...event, cursor };
    case 'generation.background-finished':
      return { ...event, cursor };
    case 'reactions.changed':
      return { ...event, cursor };
  }
}
