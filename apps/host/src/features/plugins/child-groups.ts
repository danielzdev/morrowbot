import type { BlockedGroup, ChildGroupScope } from '@morrowbot/contracts';
import { isGroupGone, type ProcessProbe } from './release-probe.ts';

export type ChildGroupKind = ChildGroupScope['kind'];

/** A recorded process group (the storage feature keeps these in `child_groups`). */
export interface ChildGroupRow {
  readonly pgid: number;
  readonly regId: string;
  readonly pluginId: string;
  readonly kind: ChildGroupKind;
  readonly bootId: string | null;
  readonly leaderStart: string;
  readonly startedAt: string;
  readonly generationIds: readonly string[];
}

export interface ChildGroupStore {
  insert(row: ChildGroupRow): void;
  delete(pgid: number): void;
  list(): ChildGroupRow[];
  transaction<T>(work: () => T): T;
}

export interface ChildGroupClock {
  readonly now: () => string;
  /** Milliseconds on a monotonic clock: blocked time is never measured with wall-clock time. */
  readonly monotonic: () => number;
}

interface Tracked {
  readonly row: ChildGroupRow;
  /** The worker that reported the group; null for a group recorded by an earlier host process. */
  readonly worker: number | null;
  /** Monotonic time the host first saw this group blocked, or null while it may still be running normally. */
  blockedSince: number | null;
}

export const RELEASE_AFTER_MS = 60_000;
const RETRY_MS = 100;
const VERIFY_MS = 2_000;
const REPROBE_MS = 2_000;

export interface ChildGroupRegistryOptions {
  readonly store: ChildGroupStore;
  readonly probe: ProcessProbe;
  readonly clock: ChildGroupClock;
  readonly newRegId: () => string;
  readonly log: (message: string) => void;
}

export type ReleaseResult = 'released' | 'not-found' | 'not-blocked' | 'too-early';

/**
 * Tracks every process group plugins start, from registration until its exit is confirmed,
 * using one release predicate. Groups that cannot be confirmed gone stay blocked and are
 * re-probed every 2 s. Asynchronous probe results apply only if the same row (regId, worker) is still tracked.
 */
export class ChildGroupRegistry {
  private readonly groups = new Map<number, Tracked>();
  private readonly listeners = new Set<(row: ChildGroupRow) => void>();
  private readonly blockedListeners = new Set<(row: ChildGroupRow) => void>();
  private closed = false;
  private readonly options: ChildGroupRegistryOptions;
  private bootId: string | null = null;
  private timer: NodeJS.Timeout | undefined;
  private probing = false;

  constructor(options: ChildGroupRegistryOptions) {
    this.options = options;
  }

  /** Reads the boot id, then checks every group a previous host recorded: gone ones are deleted, the rest block. */
  async recover(): Promise<void> {
    this.bootId = await this.options.probe.bootId();
    const rows = this.options.store.list();
    for (const row of rows) this.groups.set(row.pgid, { row, worker: null, blockedSince: this.options.clock.monotonic() });
    await Promise.all(rows.map((row) => this.check(row.pgid, row.regId)));
    this.timer = setInterval(() => {
      void this.reprobe();
    }, REPROBE_MS);
    this.timer.unref();
  }

  onReleased(listener: (row: ChildGroupRow) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Hears each group that could not be confirmed gone and now blocks (it is still re-probed). */
  onBlocked(listener: (row: ChildGroupRow) => void): () => void {
    this.blockedListeners.add(listener);
    return () => this.blockedListeners.delete(listener);
  }

  /** Whether the group is blocked (not confirmed gone after its verify). */
  isBlocked(pgid: number): boolean {
    return (this.groups.get(pgid)?.blockedSince ?? null) !== null;
  }

  /**
   * Records a group a guard reported, in one transaction (releasing a stale row with the same pgid first).
   * Throws once the registry is closed, so the guard is never acknowledged and never starts its program.
   */
  register(pluginId: string, worker: number, pgid: number, leaderStart: string, scope: ChildGroupScope): ChildGroupRow {
    if (this.closed) throw new Error(`refused process group ${String(pgid)}: the plugin host is stopping`);
    const row: ChildGroupRow = {
      pgid,
      regId: this.options.newRegId(),
      pluginId,
      kind: scope.kind,
      bootId: this.bootId,
      leaderStart,
      startedAt: this.options.clock.now(),
      generationIds: scope.kind === 'turn' ? [scope.turnId] : [],
    };
    const stale = this.groups.get(pgid);
    this.options.store.transaction(() => {
      if (stale !== undefined) {
        this.options.log(`released stale group ${String(pgid)} (${stale.row.regId}): its pgid now leads a new group`);
        this.options.store.delete(pgid);
      }
      this.options.store.insert(row);
    });
    this.groups.set(pgid, { row, worker, blockedSince: null });
    if (stale !== undefined) this.notify(stale.row);
    return row;
  }

  /**
   * Confirms a group is gone, retrying every 100 ms for up to 2 s (an unreaped guard can stay visible
   * briefly). Resolves true once that row no longer blocks (released here or elsewhere, or replaced);
   * false leaves it blocked and re-probed every 2 s.
   */
  async verify(pgid: number): Promise<boolean> {
    const tracked = this.groups.get(pgid);
    if (tracked === undefined) return true;
    const deadline = this.options.clock.monotonic() + VERIFY_MS;
    for (;;) {
      if ((await this.check(pgid, tracked.row.regId)) === 'gone') return true;
      if (this.closed) return false;
      if (this.options.clock.monotonic() >= deadline) {
        const current = this.groups.get(pgid);
        if (current?.row.regId !== tracked.row.regId) return true;
        if (current.blockedSince === null) {
          current.blockedSince = this.options.clock.monotonic();
          this.notifyBlocked(current.row);
        }
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }

  /** Verifies every group of one worker; resolves with the ones still blocked. */
  async verifyWorker(pluginId: string, worker: number): Promise<ChildGroupRow[]> {
    const rows = [...this.groups.values()].filter((group) => group.row.pluginId === pluginId && group.worker === worker);
    const results = await Promise.all(rows.map(async ({ row }) => ((await this.verify(row.pgid)) ? [] : [row])));
    return results.flat();
  }

  row(pgid: number): ChildGroupRow | undefined {
    return this.groups.get(pgid)?.row;
  }

  /** The groups of the given generations (turn rows), live or blocked. */
  groupsOf(generationIds: ReadonlySet<string>): ChildGroupRow[] {
    return [...this.groups.values()].map(({ row }) => row).filter((row) => row.generationIds.some((id) => generationIds.has(id)));
  }

  /** Turn and daemon groups that hold their plugin: blocked rows, or rows recorded by an earlier host. A probe blocks nothing. */
  blocked(pluginId?: string): BlockedGroup[] {
    return [...this.groups.values()]
      .filter((group) => holds(group) && (pluginId === undefined || group.row.pluginId === pluginId))
      .map((group) => this.view(group));
  }

  blockedRows(pluginId: string): ChildGroupRow[] {
    return [...this.groups.values()].filter((group) => holds(group) && group.row.pluginId === pluginId).map(({ row }) => row);
  }

  view(group: Tracked): BlockedGroup {
    const blockedMs = group.blockedSince === null ? 0 : this.options.clock.monotonic() - group.blockedSince;
    return {
      regId: group.row.regId,
      pgid: group.row.pgid,
      pluginId: group.row.pluginId,
      kind: group.row.kind,
      startedAt: group.row.startedAt,
      releasable: blockedMs >= RELEASE_AFTER_MS,
    };
  }

  /** Release anyway: the user's explicit override for a row blocked at least 60 s. */
  releaseAnyway(regId: string): ReleaseResult {
    const tracked = [...this.groups.values()].find((group) => group.row.regId === regId);
    if (tracked === undefined) return 'not-found';
    if (tracked.blockedSince === null) return 'not-blocked';
    if (this.options.clock.monotonic() - tracked.blockedSince < RELEASE_AFTER_MS) return 'too-early';
    this.options.log(`the user released group ${String(tracked.row.pgid)} (${regId}) while it was still blocked`);
    this.release(tracked);
    return 'released';
  }

  /** Stops re-probing. Results that arrive later change nothing (the rows stay for the next boot). */
  close(): void {
    this.closed = true;
    clearInterval(this.timer);
  }

  private async reprobe(): Promise<void> {
    if (this.probing) return;
    this.probing = true;
    try {
      const blocked = [...this.groups.values()].filter((group) => group.blockedSince !== null);
      await Promise.all(blocked.map((group) => this.check(group.row.pgid, group.row.regId)));
    } finally {
      this.probing = false;
    }
  }

  /** Probes one row. 'gone' when it was released now, or is no longer tracked (released elsewhere or replaced). */
  private async check(pgid: number, regId: string): Promise<'gone' | 'blocked'> {
    const before = this.groups.get(pgid);
    if (before?.row.regId !== regId) return 'gone';
    let gone: boolean;
    try {
      gone = await isGroupGone(before.row, this.bootId, this.options.probe);
    } catch (error) {
      this.options.log(`could not probe group ${String(pgid)}: ${error instanceof Error ? error.message : String(error)}`);
      gone = false;
    }
    const after = this.groups.get(pgid);
    if (after?.row.regId !== regId) return 'gone';
    if (this.closed) return 'blocked';
    if (gone) {
      this.release(after);
      return 'gone';
    }
    return 'blocked';
  }

  private release(tracked: Tracked): void {
    this.options.store.delete(tracked.row.pgid);
    this.groups.delete(tracked.row.pgid);
    this.notify(tracked.row);
  }

  private notifyBlocked(row: ChildGroupRow): void {
    for (const listener of this.blockedListeners) {
      try {
        listener(row);
      } catch (error) {
        this.options.log(`a group blocked listener threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private notify(row: ChildGroupRow): void {
    for (const listener of this.listeners) {
      try {
        listener(row);
      } catch (error) {
        this.options.log(`a group release listener threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

function holds(group: Tracked): boolean {
  return group.blockedSince !== null && group.row.kind !== 'probe';
}
