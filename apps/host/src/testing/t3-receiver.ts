import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { T3WatchBatch, T3WatchEvent } from '@morrowbot/contracts';
import { z } from 'zod';
import { ACKS_FILE, CURRENT_WATCHES_FILE, HANDLED_FILE, type ProbeResult, type T3Probe } from '../features/t3-watch/index.ts';

/** Where a receiver run stops early, as if its process died there. */
export interface Crash {
  readonly at: 'after_start' | 'after_action' | 'before_ack';
  /** The event to crash on (any event for `before_ack`). */
  readonly eventId?: string;
}

/** Something the orchestrator did in the world: started a follow-up thread, or told the user. */
export interface Action {
  readonly eventId: string;
  readonly kind: string;
  readonly unverified: boolean;
}

const Handled = z.discriminatedUnion('phase', [
  z.object({ eventId: z.string(), phase: z.literal('start') }),
  z.object({ eventId: z.string(), batchId: z.string(), phase: z.literal('done'), disposition: z.enum(['handled', 'stale', 'gone', 'unverified']) }),
]);
export type Handled = z.infer<typeof Handled>;

const CurrentWatches = z.object({ threads: z.record(z.string(), z.string()) });

type Verdict = 'act' | 'stale' | 'gone' | 'defer';

/**
 * The orchestrator's side of the protocol, exactly as the runbook states it: `handled.jsonl` for at-least-once
 * handling, a fresh read before acting on `finished` or `needs_you`, and an ack once every event is settled.
 * `actions` stands for the world outside (T3 threads titled with the event id), so it survives a crash.
 */
export class Receiver {
  readonly actions: Action[] = [];
  /** Makes `current-watches.json` unreadable, as a half-synced or locked file would be. */
  currentWatchesUnreadable = false;
  private readonly dir: string;
  private readonly t3: T3Probe;
  private readonly wait: (ms: number) => void;

  constructor(dir: string, t3: T3Probe, wait: (ms: number) => void) {
    this.dir = dir;
    this.t3 = t3;
    this.wait = wait;
  }

  async handle(batch: T3WatchBatch, crash?: Crash): Promise<'acked' | 'crashed'> {
    const records = this.records();
    const done = new Set(records.flatMap((record) => (record.phase === 'done' ? [record.eventId] : [])));
    const gone = records.flatMap((record) => (record.phase === 'done' && record.batchId === batch.batchId && record.disposition === 'gone' ? [record.eventId] : []));
    const deferred: string[] = [];
    const crashes = (at: Crash['at'], eventId: string): boolean => crash?.at === at && (crash.eventId === undefined || crash.eventId === eventId);
    for (const { event, unverified } of batch.events) {
      if (done.has(event.eventId)) continue;
      if (!unverified && event.scope === 'watch' && (event.kind === 'finished' || event.kind === 'needs_you')) {
        const verdict = await this.verify(event);
        if (verdict === 'defer') {
          deferred.push(event.eventId);
          continue;
        }
        if (verdict === 'stale' || verdict === 'gone') {
          this.append({ eventId: event.eventId, batchId: batch.batchId, phase: 'done', disposition: verdict });
          if (verdict === 'gone') gone.push(event.eventId);
          continue;
        }
      }
      this.append({ eventId: event.eventId, phase: 'start' });
      if (crashes('after_start', event.eventId)) return 'crashed';
      if (unverified || !this.actions.some((action) => action.eventId === event.eventId)) this.actions.push({ eventId: event.eventId, kind: event.kind, unverified });
      if (crashes('after_action', event.eventId)) return 'crashed';
      this.append({ eventId: event.eventId, batchId: batch.batchId, phase: 'done', disposition: unverified ? 'unverified' : 'handled' });
    }
    if (crashes('before_ack', '')) return 'crashed';
    appendFileSync(path.join(this.dir, ACKS_FILE), `${JSON.stringify({ batchId: batch.batchId, deferredEventIds: deferred, goneEventIds: gone })}\n`);
    return 'acked';
  }

  /** How many times the world saw an action for each event. */
  counts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const action of this.actions) counts[action.eventId] = (counts[action.eventId] ?? 0) + 1;
    return counts;
  }

  private async verify(event: Extract<T3WatchEvent, { scope: 'watch' }>): Promise<Verdict> {
    let read: ProbeResult = await this.t3.inspect(event.threadId);
    if (read.kind === 'not_found') {
      this.wait(5000);
      read = await this.t3.inspect(event.threadId);
      if (read.kind === 'not_found') return 'gone';
    }
    if (read.kind !== 'observation') return 'defer';
    const { observation } = read;
    const pending = observation.pendingRequests;
    if (pending.kind === 'missing') return 'defer';
    if (event.kind === 'needs_you') return pending.value > 0 && observation.latestRunId === event.runId ? 'act' : 'stale';
    const background = observation.background;
    if (background.kind === 'missing') return 'defer';
    const clean =
      observation.status === 'completed' &&
      observation.latestRunId === event.runId &&
      pending.value === 0 &&
      background.value.taskIds.length === 0 &&
      !background.value.blockedOnThreadWait;
    if (!clean) return 'stale';
    const current = this.currentWatches();
    if (current === undefined) return 'defer';
    return current.threads[event.threadId] === event.watchId ? 'act' : 'stale';
  }

  private currentWatches(): z.infer<typeof CurrentWatches> | undefined {
    if (this.currentWatchesUnreadable) return undefined;
    try {
      return CurrentWatches.parse(JSON.parse(readFileSync(path.join(this.dir, CURRENT_WATCHES_FILE), 'utf8')));
    } catch {
      return undefined;
    }
  }

  /** What `handled.jsonl` holds. */
  records(): Handled[] {
    const file = path.join(this.dir, HANDLED_FILE);
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => Handled.parse(JSON.parse(line)));
  }

  private append(record: Handled): void {
    appendFileSync(path.join(this.dir, HANDLED_FILE), `${JSON.stringify(record)}\n`);
  }
}
