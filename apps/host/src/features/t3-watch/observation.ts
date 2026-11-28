import { z } from 'zod';

/**
 * Every thread status T3 Code's CLI prints (`OrchestratorMcpThreadStatus` in T3 Code v0.1.14-nightly.20261127:
 * `idle` plus each run status). Any other string is schema drift.
 */
const ThreadStatus = z.enum([
  'idle',
  'preparing',
  'queued',
  'starting',
  'running',
  'waiting',
  'completed',
  'interrupted',
  'failed',
  'cancelled',
  'rolled_back',
]);
export type ThreadStatus = z.infer<typeof ThreadStatus>;

/** Where the latest run stands. `idle` means the thread has no run in progress or on record. */
export type RunPhase = 'idle' | 'active' | 'completed' | 'unsuccessful';

export function phaseOf(status: ThreadStatus): RunPhase {
  switch (status) {
    case 'idle':
      return 'idle';
    case 'preparing':
    case 'queued':
    case 'starting':
    case 'running':
    case 'waiting':
      return 'active';
    case 'completed':
      return 'completed';
    case 'interrupted':
    case 'failed':
    case 'cancelled':
    case 'rolled_back':
      return 'unsuccessful';
  }
}

/** A signal `show` may leave out (older linked environments omit some); a missing one is never guessed. */
export type Signal<T> = { readonly kind: 'known'; readonly value: T } | { readonly kind: 'missing' };

export interface Background {
  readonly taskIds: readonly string[];
  readonly blockedOnThreadWait: boolean;
}

/** One complete read of a thread, as `t3 thread show --json` reported it. */
export interface Observation {
  readonly threadId: string;
  readonly status: ThreadStatus;
  /** The thread's newest run; its status is `status`. Ordinals in run ids rise by one per run. */
  readonly latestRunId: string | null;
  readonly activeRunId: string | null;
  readonly itemCount: number;
  readonly createdAt: Signal<number>;
  readonly pendingRequests: Signal<number>;
  readonly background: Signal<Background>;
  /** The latest run's last error, set only once it ended without completing. */
  readonly error: string | null;
}

export type ProbeResult =
  | { readonly kind: 'observation'; readonly observation: Observation }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'unreachable'; readonly detail: string }
  | { readonly kind: 'schema_mismatch'; readonly detail: string };

export interface ListedThread {
  readonly threadId: string;
  readonly status: ThreadStatus;
  readonly latestRunId: string | null;
}

export type ListResult =
  | { readonly kind: 'threads'; readonly threads: readonly ListedThread[] }
  | { readonly kind: 'unreachable'; readonly detail: string }
  | { readonly kind: 'schema_mismatch'; readonly detail: string };

const Timestamp = z.string().transform((value, context) => {
  const at = Date.parse(value);
  if (Number.isNaN(at)) {
    context.addIssue({ code: 'custom', message: 'Expected a timestamp' });
    return z.NEVER;
  }
  return at;
});

function signal<T>(value: T | undefined): Signal<T> {
  return value === undefined ? { kind: 'missing' } : { kind: 'known', value };
}

/** Reads only the fields Step 0 confirmed, and ignores the rest, so new T3 fields never break a read. */
const ShowOutput = z
  .looseObject({
    thread: z.looseObject({
      threadId: z.string(),
      status: ThreadStatus,
      latestRunId: z.string().nullable(),
      activeRunId: z.string().nullable(),
      itemCount: z.number().int().nonnegative(),
      createdAt: Timestamp.optional(),
      pendingRequestCount: z.number().int().nonnegative().optional(),
      pendingBackgroundTasks: z.array(z.looseObject({ taskId: z.string() })).optional(),
      blockedOnThreadWait: z.boolean().optional(),
    }),
    error: z.unknown(),
  })
  .transform(({ thread, error }): Observation => {
    const tasks = thread.pendingBackgroundTasks;
    const blocked = thread.blockedOnThreadWait;
    return {
      threadId: thread.threadId,
      status: thread.status,
      latestRunId: thread.latestRunId,
      activeRunId: thread.activeRunId,
      itemCount: thread.itemCount,
      createdAt: signal(thread.createdAt),
      pendingRequests: signal(thread.pendingRequestCount),
      background:
        tasks === undefined || blocked === undefined
          ? { kind: 'missing' }
          : { kind: 'known', value: { taskIds: tasks.map((task) => task.taskId).sort(), blockedOnThreadWait: blocked } },
      error: typeof error === 'string' ? error : error === null || error === undefined ? null : JSON.stringify(error),
    };
  });

const ListOutput = z.array(z.looseObject({ threadId: z.string(), status: ThreadStatus, latestRunId: z.string().nullable() }));

function parseJson(text: string): { readonly kind: 'ok'; readonly value: unknown } | { readonly kind: 'malformed' } {
  try {
    const value: unknown = JSON.parse(text);
    return { kind: 'ok', value };
  } catch {
    return { kind: 'malformed' };
  }
}

function problem(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(output)'}: ${issue.message}`).join('; ');
}

/** Parses what `t3 thread show --messages 2 --json <id>` printed on success. */
export function parseShow(stdout: string): ProbeResult {
  const json = parseJson(stdout);
  if (json.kind === 'malformed') return { kind: 'schema_mismatch', detail: 'show printed something other than JSON' };
  const parsed = ShowOutput.safeParse(json.value);
  return parsed.success ? { kind: 'observation', observation: parsed.data } : { kind: 'schema_mismatch', detail: problem(parsed.error) };
}

/** Parses what `t3 thread list --project <p> --json` printed on success (a top-level array of threads). */
export function parseList(stdout: string): ListResult {
  const json = parseJson(stdout);
  if (json.kind === 'malformed') return { kind: 'schema_mismatch', detail: 'list printed something other than JSON' };
  const parsed = ListOutput.safeParse(json.value);
  return parsed.success
    ? { kind: 'threads', threads: parsed.data.map(({ threadId, status, latestRunId }) => ({ threadId, status, latestRunId })) }
    : { kind: 'schema_mismatch', detail: problem(parsed.error) };
}

/** What a failed `t3 thread …` run means, from the one line the CLI prints on stderr. */
export type Failure = { readonly kind: 'not_found' } | { readonly kind: 'unreachable' | 'schema_mismatch'; readonly detail: string };

export function classifyFailure(stderr: string): Failure {
  const lines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !/codesign/i.test(line));
  if (lines.some((line) => /^Thread .+ is no longer available\.$/.test(line) || line.includes('is a thread link, not a thread id'))) {
    return { kind: 'not_found' };
  }
  const detail = lines.at(-1) ?? 'The t3 command failed without a message.';
  if (lines.some((line) => /sent an unexpected .+ result/.test(line) || /has no \S+ tool/.test(line))) return { kind: 'schema_mismatch', detail };
  return { kind: 'unreachable', detail };
}

/** A run id's ordinal (`…:ordinal:<n>`), which rises by one with each run of a thread. */
export function runOrdinal(runId: string): number | undefined {
  const match = /:ordinal:(\d+)$/.exec(runId);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}
