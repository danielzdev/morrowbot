import type { ThreadView } from './thread-model.ts';

/** The view follows new output only within this distance of the bottom (spec §4.1). */
export const FOLLOW_PX = 80;
/** How many messages render at first, and how many more each "Show earlier" adds. */
export const PAGE = 200;

export interface ScrollBox {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

export const nearBottom = (box: ScrollBox): boolean => box.scrollHeight - box.scrollTop - box.clientHeight <= FOLLOW_PX;

/** The first message rendered when a chat opens: the latest `PAGE` only. */
export const firstShown = (total: number): number => Math.max(0, total - PAGE);

/** The first message rendered after "Show earlier", or after jumping to an older match. */
export const earlierStart = (start: number, needed: number = start - PAGE): number => Math.max(0, Math.min(start, needed));


/** Changes whenever the chat shows more output: a message, streamed text, a step or an ending. */
export function growthOf(view: ThreadView): string {
  const turn = view.activeTurn;
  const steps = turn?.steps.map((step) => (step.kind === 'tool' ? step.outcome : (step.ending?.kind ?? 'pending'))).join(',') ?? '';
  return `${String(view.messages.length)}:${view.messages.at(-1)?.id ?? ''}:${String(view.agentMessages.length)}:${turn?.generationId ?? ''}:${String(turn?.text.length ?? 0)}:${steps}`;
}

/**
 * What new output does to the view: it follows while the reader is near the bottom, or when they
 * just sent a message; otherwise the "New messages" pill appears.
 */
export function onGrowth(following: boolean, sentByUser: boolean): 'follow' | 'pill' {
  return following || sentByUser ? 'follow' : 'pill';
}
