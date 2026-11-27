import type { ChildGroupScope, PluginMessage } from '@morrowbot/contracts';

export type Notify = (message: PluginMessage) => void;

/** One plugin's side of child-group registration: guards report their group here before they start anything. */
export interface GroupLink {
  /** Tells the host a guard leads group `pgid` and resolves once the host has recorded it. */
  register(pgid: number, leaderStart: string, scope: ChildGroupScope, kill: () => void): Promise<void>;
  /** Tells the host the guard of `pgid` has exited. The host still checks the group is gone itself. */
  exited(pgid: number): void;
  /** The host's `child-group-ack`. */
  ack(pgid: number): void;
  /** The host's `kill-child-group`: that group's guard gets a `kill` frame. */
  kill(pgid: number): void;
}

interface Group {
  readonly acked: PromiseWithResolvers<undefined>;
  readonly kill: () => void;
}

/**
 * A link that sends `child-group-*` notifications through `notify`. Without `notify` (a script or an
 * SDK test running commands with no host) every registration is acknowledged at once.
 */
export function createGroupLink(notify?: Notify): GroupLink {
  const groups = new Map<number, Group>();
  return {
    register: (pgid, leaderStart, scope, kill) => {
      const group: Group = { acked: Promise.withResolvers<undefined>(), kill };
      groups.set(pgid, group);
      if (notify === undefined) group.acked.resolve(undefined);
      else notify({ kind: 'child-group-started', pgid, leaderStart, scope });
      return group.acked.promise;
    },
    exited: (pgid) => {
      if (groups.delete(pgid)) notify?.({ kind: 'child-group-exited', pgid });
    },
    ack: (pgid) => {
      groups.get(pgid)?.acked.resolve(undefined);
    },
    kill: (pgid) => {
      groups.get(pgid)?.kill();
    },
  };
}
