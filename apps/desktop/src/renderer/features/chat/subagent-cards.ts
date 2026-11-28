import type { SubagentRun, SubagentStatus } from '@morrowbot/contracts';

/** How a sub-agent's status reads: `active` while it is queued or running (it pulses); `tone` colors the word. */
export interface RunStatus {
  readonly text: string;
  readonly tone: 'quiet' | 'warn' | 'danger';
  readonly active: boolean;
}

export function runStatus(status: SubagentStatus): RunStatus {
  switch (status.kind) {
    case 'queued':
      return { text: 'Queued', tone: 'quiet', active: true };
    case 'running':
      return { text: 'Working', tone: 'quiet', active: true };
    case 'finished':
      switch (status.outcome.kind) {
        case 'completed':
        case 'steered':
          return { text: 'Done', tone: 'quiet', active: false };
        case 'cancelled':
          return { text: 'Stopped', tone: 'warn', active: false };
        case 'interrupted':
          return { text: 'Interrupted', tone: 'warn', active: false };
        case 'failed':
          return { text: 'Failed', tone: 'danger', active: false };
      }
  }
}

/** What a collapsed group of sub-agents says: one by its role, several by count and how many are in each state. */
export type GroupSummary =
  | { readonly kind: 'single'; readonly run: SubagentRun; readonly status: RunStatus }
  | { readonly kind: 'several'; readonly count: number; readonly states: string; readonly active: boolean };

export function summarizeRuns(runs: readonly SubagentRun[]): GroupSummary | null {
  const [first] = runs;
  if (first === undefined) return null;
  if (runs.length === 1) return { kind: 'single', run: first, status: runStatus(first.status) };
  const statuses = runs.map(({ status }) => runStatus(status));
  const counts = new Map<string, number>();
  for (const { text } of statuses) counts.set(text, (counts.get(text) ?? 0) + 1);
  const states = [...counts].map(([text, count]) => `${String(count)} ${text.toLowerCase()}`).join(' · ');
  return { kind: 'several', count: runs.length, states, active: statuses.some(({ active }) => active) };
}

/** The reply area of an expanded card: the reply, or why there is none yet. */
export function replyNote(status: SubagentStatus): string | null {
  switch (status.kind) {
    case 'queued':
      return status.queueNote ?? 'Waiting for a free slot';
    case 'running':
      return 'Working…';
    case 'finished':
      return status.reply === '' ? 'No reply.' : null;
  }
}
