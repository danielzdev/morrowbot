import type { ChildGroupScope, PluginMessage } from '@morrowbot/contracts';

type Notify = (message: PluginMessage) => void;

interface Group {
  readonly acked: PromiseWithResolvers<undefined>;
  readonly kill: () => void;
}

/**
 * The plugin's side of child-group registration. `runPlugin` connects it to the host; without a
 * host (an SDK test calling `openCommand` directly) registration is acknowledged at once.
 */
let notify: Notify | undefined;
const groups = new Map<number, Group>();

export function connectHost(send: Notify): void {
  notify = send;
}

/** Tells the host a guard leads group `pgid` and resolves once the host has recorded it. */
export function registerGroup(pgid: number, leaderStart: string, scope: ChildGroupScope, kill: () => void): Promise<void> {
  const group: Group = { acked: Promise.withResolvers<undefined>(), kill };
  groups.set(pgid, group);
  if (notify === undefined) group.acked.resolve(undefined);
  else notify({ kind: 'child-group-started', pgid, leaderStart, scope });
  return group.acked.promise;
}

/** Tells the host the guard of `pgid` has exited. The host still checks the group is gone itself. */
export function groupExited(pgid: number): void {
  if (!groups.delete(pgid)) return;
  notify?.({ kind: 'child-group-exited', pgid });
}

export function ackGroup(pgid: number): void {
  groups.get(pgid)?.acked.resolve(undefined);
}

/** Forwards the host's `kill-child-group` to that group's guard as a `kill` frame. */
export function killGroup(pgid: number): void {
  groups.get(pgid)?.kill();
}
