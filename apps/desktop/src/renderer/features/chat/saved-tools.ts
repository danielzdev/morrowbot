import type { ToolStep as SavedToolStep } from '@morrowbot/contracts';
import type { ToolStep, TurnStep } from './thread-model.ts';

/** A tool call as the host saved it, on this window's clock: host times become ms; only their difference matters. */
export function fromSaved(saved: SavedToolStep): ToolStep {
  const base = { kind: 'tool', toolUseId: saved.toolUseId, name: saved.name, input: saved.input, startedAt: Date.parse(saved.startedAt) } as const;
  switch (saved.outcome) {
    case 'ok':
    case 'error':
      return { ...base, outcome: saved.outcome, endedAt: Date.parse(saved.endedAt) };
    case 'running':
    case 'unfinished':
      return { ...base, outcome: saved.outcome, endedAt: null };
  }
}

/**
 * `steps` with what the host saved: a call this window shows running, or with a result it never saw, takes the
 * host's ending (its duration as the host timed it), and a call this window never saw is added, in the host's
 * order, after the ones it did.
 */
export function withSaved(steps: readonly TurnStep[], saved: readonly SavedToolStep[]): TurnStep[] {
  const byId = new Map(saved.map((step) => [step.toolUseId, step]));
  const merged = steps.map((step): TurnStep => {
    const host = step.kind === 'tool' && (step.outcome === 'running' || step.outcome === 'unknown') ? byId.get(step.toolUseId) : undefined;
    if (step.kind !== 'tool' || host === undefined || host.outcome === 'running') return step;
    const ended = fromSaved(host);
    return { ...step, outcome: ended.outcome, endedAt: ended.endedAt === null ? null : step.startedAt + (ended.endedAt - ended.startedAt) };
  });
  const seen = new Set(steps.flatMap((step) => (step.kind === 'tool' ? [step.toolUseId] : [])));
  return [...merged, ...saved.filter(({ toolUseId }) => !seen.has(toolUseId)).map(fromSaved)];
}
