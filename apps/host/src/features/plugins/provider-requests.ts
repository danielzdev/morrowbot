import type { PluginStatus, ProviderInfo, TurnRequest, UsageResult } from '@morrowbot/contracts';
import type { ChildGroupRegistry, ChildGroupRow } from './child-groups.ts';
import { ask } from './info-cache.ts';
import { PluginTimeoutError, type PluginTimeouts } from './plugin-process.ts';
import type { PluginProcess } from './plugin-process.ts';
import type { Slot, TurnSink } from './slot.ts';

/** `superseded`: Recheck or a daemon exit moved the daemon revision while it was asked; its answer was discarded. */
export type InfoResult =
  | { readonly kind: 'ok'; readonly info: ProviderInfo; readonly worker: number; readonly daemonRevision: number }
  | { readonly kind: 'superseded' }
  | { readonly kind: 'unavailable'; readonly reason: string };

export type UsageAnswer =
  | { readonly kind: 'ok'; readonly usage: UsageResult; readonly worker: number }
  | { readonly kind: 'unavailable'; readonly reason: string };

export type RouteAnswer =
  | { readonly kind: 'known'; readonly accountKey: string; readonly routeKey: string; readonly worker: number }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'daemon-blocked' }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** The revision a send is admitted under; dispatch re-checks it. */
export interface PluginRevision {
  readonly configRevision: number;
  readonly worker: number | null;
  readonly daemonRevision: number;
}

/** What the chat feature asks of provider plugins. */
export interface ProviderRequests {
  revision(pluginId: string): PluginRevision;
  /** The current worker's provider-info: cached unless `refresh`, fetched once per worker otherwise. Waits for a start in progress. */
  info(pluginId: string, refresh: boolean): Promise<InfoResult>;
  /** The current worker's settled provider-info, if any, without asking. */
  cachedInfo(pluginId: string): { readonly info: ProviderInfo; readonly worker: number } | undefined;
  usage(pluginId: string, refresh: boolean): Promise<UsageAnswer>;
  routeInfo(pluginId: string, cwd: string): Promise<RouteAnswer>;
  /** Links a turn to the daemon serving `worker`, if it has one. Call inside the dispatch transaction. */
  linkDaemon(pluginId: string, worker: number, generationId: string): void;
  /** Drops a settled turn's daemon link while that daemon still serves. Call inside the settlement transaction. */
  unlinkDaemon(generationId: string): void;
  /** Sends a turn to `worker`. Refused when that worker is no longer the plugin's current, serving one. */
  startTurn(pluginId: string, worker: number, request: TurnRequest, sink: TurnSink): 'started' | 'binding-changed';
  /** Whether `startTurn` on `worker` would be accepted right now (checked before any dispatch write). */
  canStart(pluginId: string, worker: number): boolean;
  /**
   * Stop: sends `cancel`. If the turn has not ended after 5 s, a turn on a shared daemon retires
   * that daemon (`kill-child-group`, then the worker if needed); any other kills the worker through
   * its handle. The groups are then checked and the remaining turns settled through `onLost`.
   */
  cancelTurn(pluginId: string, turnId: string): void;
  /** Sends `steer` to a turn that has not ended. A turn that ended first never answers it: its end does. */
  steerTurn(pluginId: string, turnId: string, steerId: string, text: string): void;
  replyApproval(pluginId: string, turnId: string, approvalId: string, choiceId: string): void;
}

export interface RequestDeps {
  readonly slotOf: (pluginId: string) => Slot;
  readonly statusOf: (slot: Slot) => PluginStatus;
  readonly isServing: (slot: Slot) => boolean;
  readonly groups: ChildGroupRegistry;
  readonly timeouts: PluginTimeouts;
  readonly retire: (slot: Slot, row: ChildGroupRow) => Promise<void>;
  readonly killWorker: (slot: Slot, child: PluginProcess) => Promise<void>;
}

/** How long a worker's provider-info is shown before it is asked again (it is never used to pin a turn). */
const INFO_DISPLAY_MS = 60_000;

export function providerRequests({ slotOf, statusOf, isServing, groups, timeouts, retire, killWorker }: RequestDeps): ProviderRequests {
  function unavailable(slot: Slot): string | undefined {
    if (slot.plugin.manifest.kind !== 'provider') return `Plugin "${slot.plugin.manifest.id}" is not a provider`;
    if (groups.blockedRows(slot.plugin.manifest.id).some((row) => row.kind === 'daemon')) return 'daemon-blocked';
    if (slot.rechecking) return 'The provider is being rechecked. Try again in a moment.';
    if (slot.process === undefined || slot.worker === null || !isServing(slot)) {
      return `Plugin "${slot.plugin.manifest.id}" is not running (${statusOf(slot).kind})`;
    }
    return undefined;
  }

  /**
   * The one daemon path: a cold call (no answer for this worker and daemon revision) or a call after
   * the daemon went away asks provider-info, which starts and registers the daemon. Concurrent calls
   * share one request; it waits for a worker start, a daemon retire or an exited daemon's check in progress.
   */
  async function info(pluginId: string, refresh: boolean): Promise<InfoResult> {
    const slot = slotOf(pluginId);
    let waited: Promise<void> | undefined;
    for (;;) {
      if (slot.daemonGone !== undefined) await slot.daemonGone;
      else if (statusOf(slot).kind === 'starting' && slot.queue !== waited) {
        waited = slot.queue;
        await waited;
      } else break;
    }
    const reason = unavailable(slot);
    const child = slot.process;
    const worker = slot.worker;
    if (reason !== undefined || child === undefined || worker === null) return { kind: 'unavailable', reason: reason ?? 'not running' };
    const current = slot.info?.worker === worker && slot.info.revision === slot.daemonRevision ? slot.info : undefined;
    const fresh = refresh || slot.daemonLost;
    const reuse =
      current !== undefined && (!current.done || (!fresh && current.settled !== undefined && performance.now() - current.askedAt <= INFO_DISPLAY_MS));
    const entry = reuse ? current : ask(slot, child, worker, fresh, current?.settled);
    try {
      const value = await entry.value;
      if (slot.daemonRevision !== entry.revision) return { kind: 'superseded' };
      return slot.worker === worker ? { kind: 'ok', info: value, worker, daemonRevision: entry.revision } : { kind: 'unavailable', reason: 'The plugin restarted' };
    } catch (error) {
      if (slot.daemonRevision !== entry.revision) return { kind: 'superseded' };
      return { kind: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    revision: (pluginId) => {
      const slot = slotOf(pluginId);
      return { configRevision: slot.configRevision, worker: slot.process === undefined ? null : slot.worker, daemonRevision: slot.daemonRevision };
    },
    info,
    cachedInfo: (pluginId) => {
      const slot = slotOf(pluginId);
      const entry = slot.info;
      return entry?.settled === undefined || entry.worker !== slot.worker || entry.revision !== slot.daemonRevision
        ? undefined
        : { info: entry.settled, worker: entry.worker };
    },
    usage: async (pluginId, refresh) => {
      const ready = await info(pluginId, false);
      if (ready.kind === 'superseded') return { kind: 'unavailable', reason: 'The provider was rechecked meanwhile. Try again.' };
      if (ready.kind === 'unavailable') return ready;
      const slot = slotOf(pluginId);
      const child = slot.process;
      if (child === undefined || slot.worker !== ready.worker) return { kind: 'unavailable', reason: 'The plugin restarted' };
      if (slot.rechecking || slot.daemonRevision !== ready.daemonRevision) return { kind: 'unavailable', reason: 'The provider was rechecked meanwhile. Try again.' };
      try {
        const usage = await child.usage(refresh);
        if (slot.daemonRevision !== ready.daemonRevision) return { kind: 'unavailable', reason: 'The provider was rechecked meanwhile. Try again.' };
        return { kind: 'ok', usage, worker: ready.worker };
      } catch (error) {
        return { kind: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
      }
    },
    linkDaemon: (pluginId, worker, generationId) => {
      const daemon = groups.servingDaemon(pluginId, worker);
      if (daemon !== undefined) groups.link(daemon.pgid, generationId);
    },
    unlinkDaemon: (generationId) => {
      groups.unlinkIfServing(generationId);
    },
    routeInfo: async (pluginId, cwd) => {
      const slot = slotOf(pluginId);
      const reason = unavailable(slot);
      if (reason === 'daemon-blocked') return { kind: 'daemon-blocked' };
      const child = slot.process;
      const worker = slot.worker;
      if (reason !== undefined || child === undefined || worker === null) return { kind: 'unavailable', reason: reason ?? 'not running' };
      try {
        const route = await child.routeInfo(cwd);
        return route.kind === 'known' ? { ...route, worker } : route;
      } catch (error) {
        if (error instanceof PluginTimeoutError) return { kind: 'timeout' };
        return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
      }
    },
    canStart: (pluginId, worker) => {
      const slot = slotOf(pluginId);
      return unavailable(slot) === undefined && slot.process !== undefined && slot.worker === worker;
    },
    startTurn: (pluginId, worker, request, sink) => {
      const slot = slotOf(pluginId);
      const child = slot.process;
      if (unavailable(slot) !== undefined || child === undefined || slot.worker !== worker) return 'binding-changed';
      slot.turns.set(request.turnId, { worker, sink, stopTimer: undefined });
      child.startTurn(request, {
        onChunk: (chunk) => {
          sink.onChunk(chunk);
        },
        onEnd: (end) => {
          const turn = slot.turns.get(request.turnId);
          slot.turns.delete(request.turnId);
          clearTimeout(turn?.stopTimer);
          sink.onEnd(end);
        },
      });
      return 'started';
    },
    replyApproval: (pluginId, turnId, approvalId, choiceId) => {
      const slot = slotOf(pluginId);
      if (slot.turns.has(turnId)) slot.process?.replyApproval(turnId, approvalId, choiceId);
    },
    steerTurn: (pluginId, turnId, steerId, text) => {
      const slot = slotOf(pluginId);
      if (slot.turns.has(turnId)) slot.process?.steerTurn(turnId, steerId, text);
    },
    cancelTurn: (pluginId, turnId) => {
      const slot = slotOf(pluginId);
      const turn = slot.turns.get(turnId);
      const child = slot.process;
      if (turn === undefined || turn.stopTimer !== undefined) return;
      if (child === undefined || slot.worker !== turn.worker) return;
      child.cancelTurn(turnId);
      turn.stopTimer = setTimeout(() => {
        if (slot.process !== child || !child.hasTurn(turnId)) return;
        const daemon = groups.daemonOf(turnId);
        if (daemon !== undefined) {
          void retire(slot, daemon);
          return;
        }
        void killWorker(slot, child);
      }, timeouts.turnStopMs);
    },
  };
}
