import { ThreadState, type Cursor, type EntityId } from '@morrowbot/contracts';
import type { HostTransport, LinkStatus, ThreadWatcher } from '../../lib/host-connection.ts';
import type { EventStream } from './event-stream.ts';

export interface ThreadSyncDeps {
  readonly stream: EventStream;
  readonly request: HostTransport['request'];
  /** How long to wait before refetching a thread's state after failed attempt `attempt`. */
  readonly delayFor: (attempt: number) => number;
  readonly report: (problem: string) => void;
}

export interface ThreadSync {
  readonly watchThread: HostTransport['watchThread'];
  readonly linkChanged: (status: LinkStatus) => void;
  readonly close: () => void;
}

/**
 * Where a watched thread is. Only `fresh` is subscribed on the socket, and only `fresh` delivers
 * events: anything else is stale until its state has been fetched again.
 */
type Phase =
  | { readonly kind: 'stale' }
  | { readonly kind: 'fetching'; readonly session: number }
  | { readonly kind: 'retrying'; readonly timer: ReturnType<typeof setTimeout> }
  | { readonly kind: 'fresh'; readonly session: number; readonly cursor: Cursor };

interface Entry {
  readonly watchers: Set<ThreadWatcher>;
  readonly phase: Phase;
  readonly failures: number;
}

/** Keeps each watched thread's state current: fetch `/state`, then subscribe from its cursor. */
export function createThreadSync(deps: ThreadSyncDeps): ThreadSync {
  const { stream } = deps;
  const entries = new Map<EntityId, Entry>();

  const setPhase = (threadId: EntityId, entry: Entry, phase: Phase, failures = entry.failures): void => {
    if (entry.phase.kind === 'retrying') clearTimeout(entry.phase.timer);
    entries.set(threadId, { watchers: entry.watchers, phase, failures });
    if (entry.phase.kind === 'fresh' && phase.kind !== 'fresh') for (const watcher of entry.watchers) watcher.onStale();
  };

  const refresh = (threadId: EntityId): void => {
    const entry = entries.get(threadId);
    if (entry === undefined) return;
    const session = stream.session();
    if (session === null) {
      setPhase(threadId, entry, { kind: 'stale' });
      return;
    }
    setPhase(threadId, entry, { kind: 'fetching', session });
    void deps.request({ method: 'GET', path: `/api/threads/${threadId}/state`, reply: ThreadState }).then((reply) => {
      const current = entries.get(threadId);
      if (current?.phase.kind !== 'fetching' || current.phase.session !== session) return;
      if (reply.kind === 'ok') {
        setPhase(threadId, current, { kind: 'fresh', session, cursor: reply.value.cursor }, 0);
        stream.send(session, { kind: 'subscribe', threadId, since: reply.value.cursor });
        for (const watcher of current.watchers) watcher.onFresh(reply.value);
        return;
      }
      deps.report(`Could not load thread ${threadId}: ${reply.kind}`);
      const gone = reply.kind === 'unauthorized' || (reply.kind === 'failed' && reply.status === 404);
      if (gone) {
        setPhase(threadId, current, { kind: 'stale' });
        return;
      }
      const failures = current.failures + 1;
      const timer = setTimeout(() => {
        refresh(threadId);
      }, deps.delayFor(failures));
      setPhase(threadId, current, { kind: 'retrying', timer }, failures);
    });
  };

  const stopListening = stream.listen((frame) => {
    if (frame.kind === 'resync') {
      refresh(frame.threadId);
      return;
    }
    if (!('cursor' in frame)) return;
    const entry = entries.get(frame.threadId);
    if (entry?.phase.kind !== 'fresh') return;
    const seen = entry.phase.cursor;
    if (seen.hostEpoch === frame.cursor.hostEpoch && frame.cursor.seq <= seen.seq) return;
    entries.set(frame.threadId, { ...entry, phase: { ...entry.phase, cursor: frame.cursor } });
    for (const watcher of entry.watchers) watcher.onEvent(frame);
  });

  return {
    watchThread: (threadId, watcher) => {
      const mine: ThreadWatcher = { ...watcher };
      const existing = entries.get(threadId);
      if (existing === undefined) entries.set(threadId, { watchers: new Set([mine]), phase: { kind: 'stale' }, failures: 0 });
      else existing.watchers.add(mine);
      refresh(threadId);
      return () => {
        const entry = entries.get(threadId);
        if (entry === undefined || !entry.watchers.delete(mine) || entry.watchers.size > 0) return;
        if (entry.phase.kind === 'retrying') clearTimeout(entry.phase.timer);
        if (entry.phase.kind === 'fresh') stream.send(entry.phase.session, { kind: 'unsubscribe', threadId });
        entries.delete(threadId);
      };
    },
    linkChanged: (status) => {
      for (const [threadId, entry] of entries) {
        if (status.kind === 'online') refresh(threadId);
        else setPhase(threadId, entry, { kind: 'stale' });
      }
    },
    close: () => {
      stopListening();
      for (const entry of entries.values()) if (entry.phase.kind === 'retrying') clearTimeout(entry.phase.timer);
      entries.clear();
    },
  };
}
