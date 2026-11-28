import path from 'node:path';
import type { T3StatusRow, T3WatchBatch } from '@morrowbot/contracts';
import type { T3BatchRecord } from './ports.ts';
import { ACKS_FILE, CURRENT_WATCHES_FILE, HANDLED_FILE } from './watch-files.ts';

/** The receiver rules every batch repeats (the runbook explains each). */
export function receiverRules(dir: string): string[] {
  return [
    'Handle needs_you events first. The status table is context only: act only on entries in events.',
    'Skip any eventId that already has a done record in handled.jsonl. First rebuild goneEventIds from this batch’s done records with disposition gone.',
    'Before acting on a finished or needs_you event, run one fresh `t3 thread show --json <threadId>`.',
    `Act on finished only if that read shows the event's run completed, no newer run, no pending request and no background work, and ${path.join(dir, CURRENT_WATCHES_FILE)} still maps the thread to the event's watchId. A different watchId: record stale, take no action. File unreadable: defer.`,
    'Act on needs_you only if the same request is still pending; otherwise record stale.',
    'Two NotFound reads at least 5 s apart: record gone and list the eventId in goneEventIds. Any other failed or incomplete read: defer it (no done record) and list it in deferredEventIds.',
    'An event marked unverified: show it to the user as unconfirmed, take no action, record done (disposition unverified). Never revalidate or defer it.',
    'For idle_unverified events, report clearly that tracking stopped without confirming the thread finished (include the thread and reason); never close silently or call routine_no_update.',
    `Append {"eventId","phase":"start"} to ${path.join(dir, HANDLED_FILE)} before acting, and {"eventId","batchId","phase":"done","disposition":"handled|stale|gone|unverified"} once the outcome is durable. A start without a done means a crash: check whether the action already happened before doing it again.`,
    'Make every action retry-safe by eventId: a thread you start carries it in its title (`t3 thread start --title "<label> [<eventId>]"`, never --generate-title).',
    'Keep handling under 5 min: start long work as new T3 threads and register them.',
    'Ack only after every event is handled, suppressed or deferred, with one of the forms below.',
  ];
}

/** What one send of a batch carries: its frozen events, a fresh status table, the rules and both ack forms. */
export function batchPayload(batch: T3BatchRecord, attempt: number, asOf: number, status: readonly T3StatusRow[], dir: string): T3WatchBatch {
  const line = JSON.stringify({ batchId: batch.batchId, deferredEventIds: [], goneEventIds: [] });
  return {
    batchId: batch.batchId,
    attempt,
    asOf: new Date(asOf).toISOString(),
    events: batch.entries.map(({ event, unverified }) => ({ event, unverified })),
    status: [...status],
    rules: receiverRules(dir),
    ack: { file: path.join(dir, ACKS_FILE), line, api: `POST /api/t3-watches/acks ${line}` },
  };
}
