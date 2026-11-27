import type { PluginStatus, ProviderInfo, TurnRequest, UsageResult } from '@morrowbot/contracts';
import type { ChildGroupRegistry } from './child-groups.ts';
import { PluginTimeoutError, type PluginTimeouts } from './plugin-process.ts';
import type { Slot, TurnSink } from './slot.ts';

export type InfoResult =
  | { readonly kind: 'ok'; readonly info: ProviderInfo; readonly worker: number }
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
  /** Sends a turn to `worker`. Refused when that worker is no longer the plugin's current, serving one. */
  startTurn(pluginId: string, worker: number, request: TurnRequest, sink: TurnSink): 'started' | 'binding-changed';
  /** Whether `startTurn` on `worker` would be accepted right now (checked before any dispatch write). */
  canStart(pluginId: string, worker: number): boolean;
  /**
   * Stop: sends `cancel`, then, if the turn has not ended after 5 s, kills the worker through its
   * handle. The worker's groups are then checked and its turns settled through `onLost`.
   */
  cancelTurn(pluginId: string, turnId: string): void;
  replyApproval(pluginId: string, turnId: string, approvalId: string, choiceId: string): void;
}

export interface RequestDeps {
  readonly slotOf: (pluginId: string) => Slot;
  readonly statusOf: (slot: Slot) => PluginStatus;
  readonly isServing: (slot: Slot) => boolean;
  readonly groups: ChildGroupRegistry;
  readonly timeouts: PluginTimeouts;
}

export function providerRequests({ slotOf, statusOf, isServing, groups, timeouts }: RequestDeps): ProviderRequests {
  function unavailable(slot: Slot): string | undefined {
    if (slot.plugin.manifest.kind !== 'provider') return `Plugin "${slot.plugin.manifest.id}" is not a provider`;
    if (groups.blockedRows(slot.plugin.manifest.id).some((row) => row.kind === 'daemon')) return 'daemon-blocked';
    if (slot.process === undefined || slot.worker === null || !isServing(slot)) {
      return `Plugin "${slot.plugin.manifest.id}" is not running (${statusOf(slot).kind})`;
    }
    return undefined;
  }

  async function info(pluginId: string, refresh: boolean): Promise<InfoResult> {
    const slot = slotOf(pluginId);
    if (statusOf(slot).kind === 'starting') await slot.queue;
    const reason = unavailable(slot);
    const child = slot.process;
    const worker = slot.worker;
    if (reason !== undefined || child === undefined || worker === null) return { kind: 'unavailable', reason: reason ?? 'not running' };
    if (refresh || slot.info?.worker !== worker) {
      const previous = slot.info?.worker === worker ? slot.info.settled : undefined;
      const entry: NonNullable<Slot['info']> = { worker, value: child.providerInfo(refresh), settled: previous };
      slot.info = entry;
      entry.value.then(
        (value) => {
          entry.settled = value;
        },
        () => {
          if (slot.info !== entry) return;
          slot.info = previous === undefined ? undefined : { worker, value: Promise.resolve(previous), settled: previous };
        },
      );
    }
    const entry = slot.info;
    try {
      const value = await entry.value;
      return slot.worker === worker ? { kind: 'ok', info: value, worker } : { kind: 'unavailable', reason: 'The plugin restarted' };
    } catch (error) {
      return { kind: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    revision: (pluginId) => {
      const slot = slotOf(pluginId);
      return { configRevision: slot.configRevision, worker: slot.process === undefined ? null : slot.worker };
    },
    info,
    cachedInfo: (pluginId) => {
      const slot = slotOf(pluginId);
      const settled = slot.info?.settled;
      return settled === undefined || slot.info === undefined || slot.info.worker !== slot.worker
        ? undefined
        : { info: settled, worker: slot.info.worker };
    },
    usage: async (pluginId, refresh) => {
      const ready = await info(pluginId, false);
      if (ready.kind === 'unavailable') return ready;
      const child = slotOf(pluginId).process;
      if (child === undefined) return { kind: 'unavailable', reason: 'The plugin stopped' };
      try {
        return { kind: 'ok', usage: await child.usage(refresh), worker: ready.worker };
      } catch (error) {
        return { kind: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
      }
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
    cancelTurn: (pluginId, turnId) => {
      const slot = slotOf(pluginId);
      const turn = slot.turns.get(turnId);
      const child = slot.process;
      if (turn === undefined || turn.stopTimer !== undefined) return;
      if (child === undefined || slot.worker !== turn.worker) return;
      child.cancelTurn(turnId);
      turn.stopTimer = setTimeout(() => {
        if (slot.process !== child || !child.hasTurn(turnId)) return;
        slot.restartAfterExit = true;
        child.kill();
      }, timeouts.turnStopMs);
    },
  };
}
