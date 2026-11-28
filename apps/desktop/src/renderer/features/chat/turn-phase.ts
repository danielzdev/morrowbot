import { runningTool, turnPhase, type TurnPhase } from './activity.ts';
import type { ActiveTurnView, ToolStep } from './thread-model.ts';
import { describeTool, elapsed, type ToolDisplay } from './tool-rows.ts';

/** How long "Failed, retrying" shows after a tool fails while nothing else runs. */
export const FAILED_BEAT_MS = 2_500;
/** The shortest time a label stays beside the avatar, so quick tools coming and going don't flicker it. */
export const LABEL_HOLD_MS = 700;

const lastTool = (turn: ActiveTurnView): ToolStep | undefined => turn.steps.findLast((step): step is ToolStep => step.kind === 'tool');

/**
 * The running turn's phase and the words beside its avatar: what it is doing and to what, where that is safe and
 * short ("Reading SOUL.md", "Running tests"), or a brief "Failed, retrying" right after a tool fails.
 */
export function phaseOf(turn: ActiveTurnView, display: ToolDisplay, now: number): { readonly phase: TurnPhase; readonly label: string } {
  const phase = turnPhase(turn);
  switch (phase) {
    case 'queued':
      return { phase, label: 'Queued' };
    case 'thinking': {
      const last = lastTool(turn);
      const failed = last?.outcome === 'error' && last.endedAt !== null && now - last.endedAt < FAILED_BEAT_MS;
      return { phase, label: failed ? 'Failed, retrying' : 'Thinking' };
    }
    case 'running-tool': {
      const tool = runningTool(turn);
      return { phase, label: tool === undefined ? 'Using a tool' : describeTool(tool.name, tool.input, display).doing };
    }
    case 'streaming':
      return { phase, label: 'Writing' };
    case 'needs-approval':
      return { phase, label: 'Waiting for your approval' };
  }
}

/** When `phaseOf` may change with no new event: the end of a "Failed, retrying" beat. Null when only events change it. */
export function labelExpiresAt(turn: ActiveTurnView): number | null {
  const last = lastTool(turn);
  return last?.outcome === 'error' && last.endedAt !== null && turnPhase(turn) === 'thinking' ? last.endedAt + FAILED_BEAT_MS : null;
}

/** A light progress hint for when tool rows are hidden: "6 steps so far", once there are two. */
export function progressOf(turn: ActiveTurnView): string | null {
  const count = turn.steps.filter((step) => step.kind === 'tool').length;
  return count < 2 ? null : `${String(count)} steps so far`;
}

/** The label shown and when it first showed. */
export interface HeldLabel {
  readonly label: string;
  readonly since: number;
}

/** How long until `wanted` may replace the shown label: 0 at once, null when it already shows. */
export const switchIn = (held: HeldLabel, wanted: string, now: number): number | null =>
  wanted === held.label ? null : Math.max(0, held.since + LABEL_HOLD_MS - now);

/**
 * A finished turn's line: "Worked for 2m", "Done" during the completion beat of a turn loaded mid-way, and the
 * summary of its tool calls when tool rows are hidden ("Worked for 2m · read 4 files, edited 2"). Null shows no line.
 */
export function finishedLine(durationMs: number | null, beat: boolean, summary: string | null): string | null {
  const head = durationMs !== null ? `Worked for ${elapsed(durationMs)}` : beat ? 'Done' : null;
  if (summary === null) return head;
  return head === null ? `${summary.charAt(0).toUpperCase()}${summary.slice(1)}` : `${head} · ${summary}`;
}

const bare = (text: string): string => text.toLowerCase().replace(/[.…\s]+$/u, '');

/**
 * The provider's status line, left out when it says no more than the avatar and its label: the phase itself,
 * or a "Thinking" that would otherwise stay beside every later tool.
 */
export const extraDetail = (detail: string | null, label: string): string | null =>
  detail === null || bare(detail) === bare(label) || bare(detail) === 'thinking' ? null : detail;
