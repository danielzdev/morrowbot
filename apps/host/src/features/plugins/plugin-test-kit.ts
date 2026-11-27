import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PluginStatus, PluginStatusEvent, TurnChunk, TurnEnd, TurnRequest } from '@morrowbot/contracts';
import type { ChildGroupRow, ChildGroupStore } from './child-groups.ts';
import type { PluginSource } from './discovery.ts';
import { DEFAULT_PLUGIN_TIMEOUTS, startPluginHost, type PluginHost } from './plugin-host.ts';
import type { PluginTimeouts } from './plugin-process.ts';
import { createJsonPluginStore, type PluginRecord, type PluginStore } from './plugin-store.ts';
import type { GroupSignal, Leader, ProcessProbe } from './release-probe.ts';
import type { TurnSink } from './slot.ts';

export const AT = '2026-01-01T00:00:00.000Z';
const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));

/** The `child_groups` table, in memory. */
export function memoryGroups(rows: readonly ChildGroupRow[] = []) {
  const table = new Map(rows.map((row) => [row.pgid, row]));
  const inserted: ((row: ChildGroupRow) => void)[] = [];
  const store: ChildGroupStore = {
    insert: (row) => {
      table.set(row.pgid, row);
      for (const listener of inserted.splice(0)) listener(row);
    },
    delete: (pgid) => {
      table.delete(pgid);
    },
    link: (pgid, generationId) => {
      const row = table.get(pgid);
      if (row !== undefined) table.set(pgid, { ...row, generationIds: [...row.generationIds, generationId] });
    },
    unlink: (pgid, generationId) => {
      const row = table.get(pgid);
      if (row !== undefined) table.set(pgid, { ...row, generationIds: row.generationIds.filter((id) => id !== generationId) });
    },
    list: () => [...table.values()],
    transaction: (work) => work(),
  };
  return {
    store,
    pgids: () => [...table.keys()].sort((a, b) => a - b),
    nextInsert: () => new Promise<ChildGroupRow>((resolve) => inserted.push(resolve)),
  };
}

export interface ProbeAnswer {
  readonly signal: GroupSignal;
  readonly leader: Leader | Promise<Leader>;
}

export const GUARD_START = 'Thu Jan  1 00:00:00 2026';
/** A guard leading its group, as `ps` shows it. */
export const GUARD: Leader = { kind: 'process', start: GUARD_START, args: '/usr/bin/node /sdk/command-guard.ts' };

/**
 * Answers probes from a script per pgid: each probe takes the next answer and the last one sticks.
 * Unscripted pgids are gone.
 */
export function fakeProbe(bootId: string | null = 'boot-1') {
  const scripts = new Map<number, ProbeAnswer[]>();
  const current = new Map<number, ProbeAnswer>();
  const next = (pgid: number): ProbeAnswer => {
    const answer = scripts.get(pgid)?.shift() ?? current.get(pgid) ?? { signal: 'gone', leader: { kind: 'none' } };
    current.set(pgid, answer);
    return answer;
  };
  const probe: ProcessProbe = {
    signalGroup: (pgid) => next(pgid).signal,
    leader: (pid) => Promise.resolve(current.get(pid)?.leader ?? { kind: 'none' }),
    bootId: () => Promise.resolve(bootId),
  };
  return {
    probe,
    script: (pgid: number, ...answers: ProbeAnswer[]) => {
      scripts.set(pgid, answers);
      current.delete(pgid);
    },
  };
}

export function groupRow(pgid: number, fields: Partial<ChildGroupRow> = {}): ChildGroupRow {
  return {
    pgid,
    regId: `old-${String(pgid)}`,
    pluginId: 'echo',
    kind: 'turn',
    bootId: 'boot-1',
    leaderStart: GUARD_START,
    startedAt: AT,
    generationIds: [],
    ...fields,
  };
}

export interface BootOptions {
  readonly builtins?: readonly PluginSource[];
  readonly records?: Readonly<Record<string, PluginRecord>>;
  readonly timeouts?: Partial<PluginTimeouts>;
  readonly rows?: readonly ChildGroupRow[];
  readonly probe?: ProcessProbe;
  readonly platform?: NodeJS.Platform;
  readonly safeMode?: boolean;
  /** Added to the monotonic clock, to step past the 60 s Release anyway wait. */
  readonly monotonicOffset?: () => number;
}

export interface Harness {
  readonly host: PluginHost;
  readonly store: PluginStore;
  readonly groups: ReturnType<typeof memoryGroups>;
  readonly events: PluginStatusEvent[];
  readonly logs: string[];
  readonly workDir: string;
  /** Resolves with the first status event of `kind` for the plugin at or after `events[since]`. */
  untilStatus(pluginId: string, kind: PluginStatus['kind'], since?: number): Promise<PluginStatus>;
  /** Resolves once a log line contains `text`. */
  untilLog(text: string): Promise<void>;
}

const cleanups: (() => Promise<void>)[] = [];

export async function stopHosts(): Promise<void> {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
}

export async function bootHost(options: BootOptions = {}): Promise<Harness> {
  const dir = await mkdtemp(path.join(tmpdir(), 'morrowbot-plugins-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const store = createJsonPluginStore(path.join(dir, 'plugins.json'));
  for (const [id, record] of Object.entries(options.records ?? {})) await store.write(id, record);
  const groups = memoryGroups(options.rows);
  const events: PluginStatusEvent[] = [];
  const logs: string[] = [];
  const watchers: (() => void)[] = [];
  const wake = () => {
    for (const watcher of watchers.splice(0)) watcher();
  };
  let ids = 0;
  const host = await startPluginHost({
    pluginsDir: FIXTURES,
    builtins: options.builtins ?? [],
    store,
    dataDir: path.join(dir, 'plugin-data'),
    safeMode: options.safeMode ?? false,
    groups: groups.store,
    pluginPath: process.env.PATH ?? '/usr/bin:/bin',
    onStatus: (event) => {
      events.push(event);
      wake();
    },
    timeouts: { ...DEFAULT_PLUGIN_TIMEOUTS, ...options.timeouts },
    probe: options.probe ?? fakeProbe().probe,
    clock: { now: () => AT, monotonic: () => performance.now() + (options.monotonicOffset?.() ?? 0) },
    newId: () => `reg-${String(++ids)}`,
    platform: options.platform ?? 'darwin',
    log: (message) => {
      logs.push(message);
      wake();
    },
  });
  cleanups.push(() => host.stop());
  const until = <T>(read: () => T | undefined): Promise<T> =>
    new Promise((resolve) => {
      const check = () => {
        const value = read();
        if (value === undefined) watchers.push(check);
        else resolve(value);
      };
      check();
    });
  return {
    host,
    store,
    groups,
    events,
    logs,
    workDir: dir,
    untilStatus: (pluginId, kind, since = 0) =>
      until(() => events.slice(since).find((event) => event.pluginId === pluginId && event.status.kind === kind)?.status),
    untilLog: (text) => until(() => (logs.some((line) => line.includes(text)) ? true : undefined)).then(() => undefined),
  };
}

export const statuses = (host: PluginHost) => Object.fromEntries(host.list().map(({ manifest, status }) => [manifest.id, status]));

export function turnRequest(turnId: string, prompt: string, cwd: string): TurnRequest {
  return {
    turnId,
    cwd,
    mode: 'interactive',
    access: 'read-only',
    vendorSettings: 'isolated',
    expectedAccountKey: 'acct-a',
    expectedRouteKey: '',
    selection: { kind: 'default' },
    session: { kind: 'new', seed: null },
    system: null,
    prompt,
    images: [],
  };
}

export type TurnResult = { readonly kind: 'end'; readonly text: string; readonly end: TurnEnd } | { readonly kind: 'lost'; readonly text: string };

/** A sink that collects a turn's text; `pid N` becomes `pid CHILD`. `pid` resolves with the worker's pid. */
export function collect() {
  const chunks: TurnChunk[] = [];
  const result = Promise.withResolvers<TurnResult>();
  const pid = Promise.withResolvers<number>();
  const text = () =>
    chunks
      .flatMap((chunk) => (chunk.kind === 'text' ? [chunk.text] : []))
      .join('')
      .replace(/pid \d+/, 'pid CHILD');
  const sink: TurnSink = {
    onChunk: (chunk) => {
      chunks.push(chunk);
      const match = chunk.kind === 'text' ? /pid (\d+)/.exec(chunk.text) : null;
      if (match !== null) pid.resolve(Number(match[1]));
    },
    onEnd: (end) => {
      result.resolve({ kind: 'end', text: text(), end });
    },
    onLost: () => {
      result.resolve({ kind: 'lost', text: text() });
    },
  };
  return { sink, result: result.promise, pid: pid.promise };
}

/** Starts a turn on the plugin's current worker. */
export function startTurn(h: Harness, pluginId: string, turnId: string, prompt: string) {
  const turn = collect();
  const worker = h.host.revision(pluginId).worker;
  const started = worker === null ? 'no worker' : h.host.startTurn(pluginId, worker, turnRequest(turnId, prompt, h.workDir), turn.sink);
  return { ...turn, started };
}
