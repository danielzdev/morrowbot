import { z } from 'zod';
import { runOrdinal, type Observation } from './observation.ts';

/** How long before `launchedAt` a run may start and still be the launched one (clock skew between processes). */
export const LAUNCH_SKEW_MS = 2000;

/**
 * Which run a watch follows.
 * - `run`: an exact run id (printed by `start`/`send --json`, found by discovery, or adopted).
 * - `first`: a `start` without a run id: the new thread's first run, if the thread was created at or after launch.
 * - `after`: a `send` to a thread only the orchestrator types in: the run right after `priorRunId`.
 * - `unbound`: a `send` to a shared thread without a run id. Nothing can prove which run is ours.
 */
export const Binding = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('run'), runId: z.string() }),
  z.strictObject({ kind: z.literal('first'), launchedAt: z.number() }),
  z.strictObject({ kind: z.literal('after'), priorRunId: z.string() }),
  z.strictObject({ kind: z.literal('unbound') }),
]);
export type Binding = z.infer<typeof Binding>;

/** What one read says about the watched run. */
export type Identity =
  /** The thread's latest run is ours, so the thread's status is our run's status. */
  | { readonly kind: 'ours'; readonly runId: string }
  /** Our run has not shown up yet: the latest run is older (or there is none). */
  | { readonly kind: 'pending' }
  /** A run after ours is the latest; ours can no longer be read. */
  | { readonly kind: 'newer' }
  | { readonly kind: 'ambiguous'; readonly reason: string };

/** Compares run ordinals; undefined when either id has none. */
function compare(a: string, b: string): number | undefined {
  const left = runOrdinal(a);
  const right = runOrdinal(b);
  return left === undefined || right === undefined ? undefined : left - right;
}

export function resolveIdentity(binding: Binding, observation: Observation): Identity {
  const latest = observation.latestRunId;
  switch (binding.kind) {
    case 'run': {
      if (latest === null) return { kind: 'pending' };
      if (latest === binding.runId) return { kind: 'ours', runId: latest };
      const order = compare(latest, binding.runId);
      if (order === undefined || order === 0) return { kind: 'ambiguous', reason: 'run ids without ordinals' };
      return order < 0 ? { kind: 'pending' } : { kind: 'newer' };
    }
    case 'first': {
      if (observation.createdAt.kind === 'missing') return { kind: 'ambiguous', reason: 'thread start time unknown' };
      if (observation.createdAt.value < binding.launchedAt - LAUNCH_SKEW_MS) return { kind: 'ambiguous', reason: 'thread existed before launch' };
      if (latest === null) return { kind: 'pending' };
      const ordinal = runOrdinal(latest);
      if (ordinal === undefined) return { kind: 'ambiguous', reason: 'run ids without ordinals' };
      return ordinal === 1 ? { kind: 'ours', runId: latest } : { kind: 'ambiguous', reason: 'more than one run since launch' };
    }
    case 'after': {
      if (latest === null) return { kind: 'pending' };
      const order = compare(latest, binding.priorRunId);
      if (order === undefined) return { kind: 'ambiguous', reason: 'run ids without ordinals' };
      if (order <= 0) return { kind: 'pending' };
      return order === 1 ? { kind: 'ours', runId: latest } : { kind: 'ambiguous', reason: 'more than one run since launch' };
    }
    case 'unbound':
      return { kind: 'ambiguous', reason: 'send to a shared thread without a run id' };
  }
}
