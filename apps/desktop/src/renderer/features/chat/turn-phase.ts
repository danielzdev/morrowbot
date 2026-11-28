import { runningTool, turnPhase, type TurnPhase } from './activity.ts';
import type { ActiveTurnView } from './thread-model.ts';
import { describeTool, type ToolDisplay, type ToolVerb } from './tool-rows.ts';

const DOING: Readonly<Record<ToolVerb, string>> = {
  read: 'Reading',
  edit: 'Editing',
  write: 'Writing a file',
  delete: 'Deleting',
  move: 'Moving',
  run: 'Running a command',
  search: 'Searching',
  fetch: 'Browsing',
  think: 'Thinking',
  other: 'Using a tool',
};

/** The running turn's phase and the words beside its avatar, such as "Thinking" or "Searching". */
export function phaseOf(turn: ActiveTurnView, display: ToolDisplay): { readonly phase: TurnPhase; readonly label: string } {
  const phase = turnPhase(turn);
  switch (phase) {
    case 'queued':
      return { phase, label: 'Queued' };
    case 'thinking':
      return { phase, label: 'Thinking' };
    case 'running-tool': {
      const tool = runningTool(turn);
      return { phase, label: tool === undefined ? DOING.other : DOING[describeTool(tool.name, tool.input, display).verb] };
    }
    case 'streaming':
      return { phase, label: 'Writing' };
    case 'needs-approval':
      return { phase, label: 'Waiting for your approval' };
  }
}

const bare = (text: string): string => text.toLowerCase().replace(/[.…\s]+$/u, '');

/**
 * The provider's status line, left out when it says no more than the avatar and its label: the phase itself,
 * or a "Thinking" that would otherwise stay beside every later tool.
 */
export const extraDetail = (detail: string | null, label: string): string | null =>
  detail === null || bare(detail) === bare(label) || bare(detail) === 'thinking' ? null : detail;
