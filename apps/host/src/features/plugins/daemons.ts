import { setTimeout as delay } from 'node:timers/promises';
import type { ProviderInfo } from '@morrowbot/contracts';
import type { ChildGroupRegistry, ChildGroupRow } from './child-groups.ts';
import { ask, settledEntry } from './info-cache.ts';
import { PluginTimeoutError, type PluginProcess } from './plugin-process.ts';
import type { OpenTurn, Slot } from './slot.ts';

/** How long a daemon gets to go after `kill-child-group` before the host kills its worker. */
const DAEMON_STOP_MS = 2_000;

export type RecheckAnswer =
  | { readonly kind: 'ok'; readonly info: ProviderInfo }
  | { readonly kind: 'busy' }
  | { readonly kind: 'blocked'; readonly detail: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

export interface DaemonDeps {
  readonly groups: ChildGroupRegistry;
  readonly log: (message: string) => void;
  readonly stopping: () => boolean;
  readonly isServing: (slot: Slot) => boolean;
  readonly quarantine: (slot: Slot, pgids: readonly number[]) => void;
  /** Kills the worker through its handle; resolves once its groups were checked and any restart ran. */
  readonly killWorker: (slot: Slot, child: PluginProcess) => Promise<void>;
}

export interface Daemons {
  /** The plugin reported a group's guard gone. */
  groupExited(slot: Slot, child: PluginProcess, worker: number, pgid: number): void;
  /**
   * Stops one daemon group: `kill-child-group`, then the worker through its handle if the group is
   * not gone 2 s later. Its open turns are settled once, as interrupted. True once it is confirmed gone.
   */
  retire(slot: Slot, row: ChildGroupRow): Promise<boolean>;
  /** Recheck with no turns: retire every daemon, then start a fresh one through `provider-info {refresh:true}`. */
  recheck(slot: Slot): Promise<RecheckAnswer>;
}

export function daemons(deps: DaemonDeps): Daemons {
  const { groups, log } = deps;

  /** Stops routing a turn of `worker` and returns it, or undefined if it already ended. */
  function take(slot: Slot, child: PluginProcess, worker: number, turnId: string): OpenTurn | undefined {
    const turn = slot.turns.get(turnId);
    if (turn?.worker !== worker || !child.forgetTurn(turnId)) return undefined;
    slot.turns.delete(turnId);
    clearTimeout(turn.stopTimer);
    return turn;
  }

  function groupExited(slot: Slot, child: PluginProcess, worker: number, pgid: number): void {
    const retiring = slot.retiring.get(pgid);
    if (retiring !== undefined) {
      retiring.resolve(undefined);
      return;
    }
    const row = groups.row(pgid);
    if (row?.kind === 'daemon' && slot.process === child && !deps.stopping()) {
      // An unexpected daemon exit: nothing more is dispatched to it, its turns end now, and their
      // links hold their threads until the group is confirmed gone. The next provider-info starts a new one.
      log(`daemon group ${String(pgid)} exited`);
      slot.daemonRevision += 1;
      slot.info = undefined;
      slot.daemonLost = true;
      groups.markEnding(pgid);
      const lost = row.generationIds.flatMap((id) => take(slot, child, worker, id) ?? []);
      for (const turn of lost) turn.sink.onLost();
      slot.daemonExit = groups.verify(pgid).then((released) => {
        slot.daemonExit = undefined;
        if (!released && !deps.stopping()) deps.quarantine(slot, [pgid]);
      });
      return;
    }
    void groups.verify(pgid).then((released) => {
      if (released || row === undefined || deps.stopping()) return;
      for (const turnId of row.generationIds) take(slot, child, worker, turnId)?.sink.onLost();
      if (row.kind !== 'probe' && groups.isBlocked(pgid)) deps.quarantine(slot, [pgid]);
    });
  }

  async function retire(slot: Slot, row: ChildGroupRow): Promise<boolean> {
    const child = slot.process;
    const worker = slot.worker;
    slot.daemonRevision += 1;
    slot.info = undefined;
    slot.daemonLost = true;
    const reported = Promise.withResolvers<undefined>();
    slot.retiring.set(row.pgid, reported);
    groups.markEnding(row.pgid);
    const lost = child === undefined || worker === null ? [] : row.generationIds.flatMap((id) => take(slot, child, worker, id) ?? []);
    try {
      log(`stopping daemon group ${String(row.pgid)}`);
      child?.killChildGroup(row.pgid);
      const deadline = performance.now() + DAEMON_STOP_MS;
      const exited = await Promise.race([reported.promise.then(() => true), delay(DAEMON_STOP_MS, false, { ref: false })]);
      if (exited && (await groups.awaitGone(row.pgid, Math.max(0, deadline - performance.now())))) return true;
      if (child !== undefined && slot.process === child) {
        log(`daemon group ${String(row.pgid)} did not stop; killing the worker`);
        await deps.killWorker(slot, child);
      } else {
        await slot.retired;
      }
      return groups.row(row.pgid)?.regId !== row.regId;
    } finally {
      slot.retiring.delete(row.pgid);
      for (const turn of lost) turn.sink.onLost();
    }
  }

  function blockedDetail(slot: Slot): string | undefined {
    const blocked = groups.blockedRows(slot.plugin.manifest.id).filter((row) => row.kind === 'daemon');
    if (blocked.length === 0) return undefined;
    return slot.quarantine ?? `A provider process from before (process group ${blocked.map((row) => String(row.pgid)).join(', ')}) is still running`;
  }

  async function recheck(slot: Slot): Promise<RecheckAnswer> {
    const blocked = blockedDetail(slot);
    if (blocked !== undefined) return { kind: 'blocked', detail: blocked };
    if (slot.rechecking) return { kind: 'busy' };
    slot.rechecking = true;
    slot.daemonRevision += 1;
    try {
      // An older start is drained (its answer is discarded); one that never answers is cancelled with its worker.
      const older = slot.info;
      slot.info = undefined;
      if (older !== undefined && !older.done) {
        const timedOut = await older.value.then(
          () => false,
          (error: unknown) => error instanceof PluginTimeoutError,
        );
        if (timedOut && slot.process !== undefined) await deps.killWorker(slot, slot.process);
      }
      for (const row of groups.daemons(slot.plugin.manifest.id)) await retire(slot, row);
      const stillBlocked = blockedDetail(slot);
      if (stillBlocked !== undefined) return { kind: 'blocked', detail: stillBlocked };
      return await freshStart(slot);
    } finally {
      slot.rechecking = false;
    }
  }

  async function freshStart(slot: Slot): Promise<RecheckAnswer> {
    const child = slot.process;
    const worker = slot.worker;
    if (child === undefined || worker === null || !deps.isServing(slot)) {
      return { kind: 'unavailable', reason: `Plugin "${slot.plugin.manifest.id}" is not running (${slot.status.kind})` };
    }
    try {
      return { kind: 'ok', info: await ask(slot, child, worker, true, undefined).value };
    } catch (error) {
      if (!(error instanceof PluginTimeoutError)) return { kind: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
      // The attempt cannot be called back: invalidate it and cancel it with its worker, whose groups are then checked.
      slot.daemonRevision += 1;
      await deps.killWorker(slot, child);
      const blocked = blockedDetail(slot);
      if (blocked !== undefined) return { kind: 'blocked', detail: blocked };
      const info: ProviderInfo = { kind: 'error', message: 'The provider did not finish starting in time. Recheck to try again.' };
      // Turns now gate on this answer until it expires or is refreshed; the restarted worker has no daemon to replace.
      if (slot.worker !== null) slot.info = settledEntry(slot.worker, slot.daemonRevision, info);
      slot.daemonLost = false;
      return { kind: 'ok', info };
    }
  }

  return { groupExited, retire, recheck };
}
