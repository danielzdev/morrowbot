import type { AgentStatus } from './sidebar-groups.ts';

/** What an agent row shows beside its last message: working dots, a needs-you badge, the unread dot, or nothing. */
export type RowMark =
  | { readonly kind: 'none' }
  | { readonly kind: 'unread'; readonly label: string }
  /** Animated while running; still while queued behind another turn. */
  | { readonly kind: 'dots'; readonly moving: boolean; readonly label: string }
  | { readonly kind: 'badge'; readonly text: string; readonly label: string; readonly tone: 'warn' | 'danger' };

type NeedsYou = Extract<AgentStatus, { readonly kind: 'needs-you' }>['reason'];

function needsYouMark(reason: NeedsYou): RowMark {
  switch (reason) {
    case 'unbound':
      return { kind: 'badge', text: 'Set up', label: 'Needs you: choose a provider', tone: 'warn' };
    case 'provider':
      return { kind: 'badge', text: 'Provider', label: 'Needs you: provider not ready', tone: 'warn' };
    case 'failed':
      return { kind: 'badge', text: 'Failed', label: 'Needs you: last reply failed', tone: 'danger' };
  }
}

export function markOf(status: AgentStatus): RowMark {
  switch (status.kind) {
    case 'needs-approval':
      return { kind: 'badge', text: 'Approval', label: 'Needs approval', tone: 'warn' };
    case 'needs-you':
      return needsYouMark(status.reason);
    case 'working':
      return { kind: 'dots', moving: true, label: 'Working' };
    case 'queued':
      return { kind: 'dots', moving: false, label: 'Queued' };
    case 'unread':
      return { kind: 'unread', label: 'New reply' };
    case 'idle':
      return { kind: 'none' };
  }
}

/** The mark's words for a screen reader or tooltip; null when there is nothing to say. */
export const markLabel = (mark: RowMark): string | null => (mark.kind === 'none' ? null : mark.label);
