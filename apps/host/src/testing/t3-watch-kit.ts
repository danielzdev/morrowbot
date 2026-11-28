import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RegisterT3WatchRequest, T3Watch, T3WatchBatch } from '@morrowbot/contracts';
import { openStorage, type Storage } from '../features/storage/index.ts';
import {
  classifyFailure,
  createT3WatchService,
  parseList,
  parseShow,
  type ListResult,
  type ProbeResult,
  type SinkAnswer,
  type T3DeliverySink,
  type T3Probe,
  type T3WatchClock,
  type T3WatchService,
} from '../features/t3-watch/index.ts';

export const START = Date.parse('2026-11-28T09:00:00.000Z');

/** A run id as T3 Code prints it. */
export function runOf(threadId: string, ordinal: number): string {
  return `run:thread:${encodeURIComponent(threadId)}:ordinal:${String(ordinal)}`;
}

/** What the fake T3 reports for one thread, in `t3 thread show --json` terms. `omit` drops fields, as older T3s do. */
export interface FakeThread {
  status: string;
  latestRunId: string | null;
  activeRunId: string | null;
  itemCount: number;
  createdAt: string;
  pendingRequestCount: number;
  pendingBackgroundTasks: { taskId: string; kind: string }[];
  blockedOnThreadWait: boolean;
  error: string | null;
  omit: string[];
}

/** The manual clock: `advance` moves wall time; the service's own timer never fires on its own. */
export class FakeClock implements T3WatchClock {
  at = START;
  now(): number {
    return this.at;
  }
  every(): () => void {
    return () => undefined;
  }
}

/** A scripted T3 Code. Each read builds the JSON the real CLI prints and parses it with the real parser. */
export class FakeT3 implements T3Probe {
  readonly threads = new Map<string, FakeThread>();
  readonly projects = new Map<string, string[]>();
  readonly reads: { readonly threadId: string; readonly at: number }[] = [];
  readonly lists: string[] = [];
  /** `down`: every call fails as if the T3 server were gone. */
  down = false;
  /** Threads whose reads fail as a lost connection would, while other threads read fine. */
  readonly unreadable = new Set<string>();
  /** While set, calls wait until `release` (to observe calls in flight). */
  holding = false;
  inFlight = 0;
  maxInFlight = 0;
  private readonly held: (() => void)[] = [];
  private readonly clock: Pick<T3WatchClock, 'now'>;

  constructor(clock: Pick<T3WatchClock, 'now'>) {
    this.clock = clock;
  }

  thread(threadId: string, fields: Partial<FakeThread> = {}): FakeThread {
    const thread: FakeThread = {
      status: 'running',
      latestRunId: runOf(threadId, 1),
      activeRunId: runOf(threadId, 1),
      itemCount: 3,
      createdAt: new Date(this.clock.now()).toISOString(),
      pendingRequestCount: 0,
      pendingBackgroundTasks: [],
      blockedOnThreadWait: false,
      error: null,
      omit: [],
      ...fields,
    };
    this.threads.set(threadId, thread);
    return thread;
  }

  /** The thread's latest run ended with `status` (completed unless told otherwise). */
  finish(threadId: string, status = 'completed', error: string | null = null): void {
    const thread = this.get(threadId);
    Object.assign(thread, { status, activeRunId: null, itemCount: thread.itemCount + 1, error });
  }

  /** A new run starts on the thread. */
  startRun(threadId: string, ordinal: number): void {
    const run = runOf(threadId, ordinal);
    Object.assign(this.get(threadId), { status: 'running', latestRunId: run, activeRunId: run, error: null });
  }

  get(threadId: string): FakeThread {
    const thread = this.threads.get(threadId);
    if (thread === undefined) throw new Error(`No fake thread ${threadId}`);
    return thread;
  }

  release(): void {
    for (const resume of this.held.splice(0)) resume();
  }

  async inspect(threadId: string): Promise<ProbeResult> {
    this.reads.push({ threadId, at: this.clock.now() });
    await this.enter();
    try {
      if (this.down || this.unreadable.has(threadId)) return { kind: 'unreachable', detail: 'Could not reach the T3 Code server at http://127.0.0.1:3773.' };
      const thread = this.threads.get(threadId);
      if (thread === undefined) {
        const failure = classifyFailure(`Thread ${threadId} is no longer available.\n`);
        return failure.kind === 'not_found' ? failure : { kind: 'unreachable', detail: failure.detail };
      }
      const { omit, error, ...fields } = thread;
      const shown: Record<string, unknown> = { threadId, projectId: 'project-1', title: 'Build', runCount: 1, pullRequests: [], updatedAt: new Date(this.clock.now()).toISOString(), ...fields };
      for (const key of omit) Reflect.deleteProperty(shown, key);
      return parseShow(JSON.stringify({ thread: shown, messages: [], error }));
    } finally {
      this.inFlight -= 1;
    }
  }

  async list(project: string): Promise<ListResult> {
    this.lists.push(project);
    await this.enter();
    try {
      if (this.down) return { kind: 'unreachable', detail: 'Could not reach the T3 Code server.' };
      const threads = (this.projects.get(project) ?? []).map((threadId) => {
        const { status, latestRunId } = this.get(threadId);
        return { threadId, projectId: project, title: 'Build', status, latestRunId, itemCount: 1 };
      });
      return parseList(JSON.stringify(threads));
    } finally {
      this.inFlight -= 1;
    }
  }

  private async enter(): Promise<void> {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    if (this.holding) await new Promise<void>((resume) => this.held.push(resume));
  }
}

/** The orchestrator's routine as the lane sees it: `busy` while a run or a user turn goes on; every send is kept. */
export class FakeSink implements T3DeliverySink {
  running = false;
  answer: SinkAnswer = { kind: 'sent' };
  readonly sent: T3WatchBatch[] = [];
  busy(): boolean {
    return this.running;
  }
  deliver(batch: T3WatchBatch): Promise<SinkAnswer> {
    this.sent.push(batch);
    return Promise.resolve(this.answer);
  }
}

export interface Kit {
  readonly clock: FakeClock;
  readonly t3: FakeT3;
  readonly dir: string;
  readonly warnings: string[];
  readonly errors: unknown[];
  /** Null unless the kit was started with `delivery`. */
  readonly sink: FakeSink | null;
  service: T3WatchService;
  storage: Storage;
  register(request: Partial<RegisterT3WatchRequest> & { threadId: string }): T3Watch;
  /** Moves the clock by `ms`, runs one tick, and waits for what it started. */
  step(ms?: number): Promise<void>;
  /** Steps second by second for `ms`. */
  run(ms: number): Promise<void>;
  /** Steps second by second until `done` holds (at most `ms`); the seconds it took. */
  until(done: () => boolean, ms?: number): Promise<number>;
  /** Every send so far, with times as seconds since the start and events as kind, thread and id. */
  sent(): unknown[];
  /** The queued events, with times as seconds since the start and runs as their ordinal. */
  events(): unknown[];
  watches(): { thread: string; source: string; state: string; reason: string | null; run: string | null; settled: boolean }[];
  /** Closes the service and storage, and opens both again on the same files (a host restart). */
  restart(): void;
  close(): Promise<void>;
}

const since = (iso: string): string => `+${String((Date.parse(iso) - START) / 1000)}s`;
const ordinal = (runId: string | null): string | null => (runId === null ? null : `#${runId.split(':').at(-1) ?? '?'}`);

export async function startKit(options: { readonly projects?: readonly string[]; readonly delivery?: boolean } = {}): Promise<Kit> {
  const root = await mkdtemp(path.join(tmpdir(), 'orikami-t3-watch-'));
  const dir = path.join(root, 't3-watch');
  const clock = new FakeClock();
  const t3 = new FakeT3(clock);
  const warnings: string[] = [];
  const errors: unknown[] = [];
  const sink = options.delivery === true ? new FakeSink() : null;
  let id = 0;
  const open = (): { storage: Storage; service: T3WatchService } => {
    const storage = openStorage(path.join(root, 'orikami.sqlite'), () => new Date(clock.now()).toISOString());
    const service = createT3WatchService({
      store: { watches: storage.t3Watches, outbox: storage.t3Outbox, batches: storage.t3Batches, transaction: (work) => storage.transaction(work) },
      probe: t3,
      clock,
      sink,
      dir,
      projects: options.projects ?? [],
      newId: () => `id-${String(++id)}`,
      report: (error) => errors.push(error),
      warn: (message) => warnings.push(message),
    });
    return { storage, service };
  };
  const step = async (ms = 1000): Promise<void> => {
    clock.at += ms;
    kit.service.tick();
    await kit.service.idle();
  };
  const kit: Kit = {
    clock,
    t3,
    dir,
    warnings,
    errors,
    sink,
    ...open(),
    register: (request) => kit.service.register({ launchedAt: new Date(clock.now()).toISOString(), exclusive: false, ...request }),
    step,
    run: async (ms) => {
      for (let elapsed = 0; elapsed < ms; elapsed += 1000) await step(1000);
    },
    until: async (done, ms = 30 * 60_000) => {
      let elapsed = 0;
      while (!done()) {
        if (elapsed >= ms) throw new Error(`Still waiting after ${String(ms / 1000)} s`);
        await step(1000);
        elapsed += 1000;
      }
      return elapsed / 1000;
    },
    sent: () =>
      (sink?.sent ?? []).map((batch) => ({
        batchId: batch.batchId,
        attempt: batch.attempt,
        asOf: since(batch.asOf),
        events: batch.events.map(({ event, unverified }) => ({
          kind: event.kind,
          ...(event.scope === 'watch' ? { thread: event.threadId } : {}),
          eventId: event.eventId,
          ...(unverified ? { unverified } : {}),
        })),
        status: batch.status.map((row) => `${row.threadId} ${row.state}`),
      })),
    events: () =>
      kit.service.pending().map((event) =>
        event.scope === 'watch'
          ? { kind: event.kind, thread: event.threadId, run: ordinal(event.runId), reason: event.reason, at: since(event.at) }
          : { kind: event.kind, reason: event.reason, at: since(event.at) },
      ),
    watches: () =>
      kit.service
        .list()
        .reverse()
        .map((watch) => ({ thread: watch.threadId, source: watch.source, state: watch.state, reason: watch.reason, run: ordinal(watch.runId), settled: watch.settledAt !== null })),
    restart: () => {
      kit.service.close();
      kit.storage.close();
      Object.assign(kit, open());
    },
    close: async () => {
      kit.service.close();
      await kit.service.idle();
      kit.storage.close();
      await rm(root, { recursive: true, force: true });
    },
  };
  return kit;
}
