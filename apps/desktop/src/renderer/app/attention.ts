import type { ThreadActivity } from '../features/chat/index.ts';

type Activity = Readonly<Record<string, ThreadActivity>>;

const BUSY: ReadonlySet<ThreadActivity['activity']> = new Set(['thinking', 'running-tool', 'streaming', 'queued', 'needs-approval']);

/**
 * The window title (spec §9 "title prefix"): what needs the user first, so the Dock, Mission Control
 * and VoiceOver's window list say it without opening the app. Counts only chats this window has open.
 */
export function windowTitle(activity: Activity, agentName: string | null): string {
  const all = Object.values(activity);
  const waiting = all.filter(({ activity: each }) => each === 'needs-approval').length;
  const working = all.some(({ activity: each }) => BUSY.has(each));
  const status = waiting > 0 ? `Needs you (${String(waiting)})` : working ? 'Working' : null;
  const base = agentName === null ? 'Ori Bot' : `${agentName} — Ori Bot`;
  return status === null ? base : `${status} · ${base}`;
}

/** Something a background notification should say. */
export interface Attention {
  readonly kind: 'approval' | 'finished' | 'failed';
  readonly agentId: string;
  readonly threadId: string;
}

/** What changed between two activity snapshots that is worth a notification: a new approval, or a turn that ended. */
export function attentionFrom(before: Activity, after: Activity): readonly Attention[] {
  return Object.entries(after).flatMap(([threadId, now]): Attention[] => {
    const was = before[threadId];
    if (was === undefined) return [];
    if (now.activity === 'needs-approval' && was.activity !== 'needs-approval') return [{ kind: 'approval', agentId: now.agentId, threadId }];
    if (BUSY.has(was.activity) && !BUSY.has(now.activity)) return [{ kind: now.failed ? 'failed' : 'finished', agentId: now.agentId, threadId }];
    return [];
  });
}

/** The notification's words. The caller passes names and titles through the privacy rules (spec §9.1). */
export function attentionCopy(attention: Attention, agentName: string, chatTitle: string | null): { readonly title: string; readonly body: string } {
  const where = chatTitle === null ? '' : `In “${chatTitle}”. `;
  switch (attention.kind) {
    case 'approval':
      return { title: `${agentName} needs approval`, body: `${where}Open Ori Bot to allow or deny.` };
    case 'finished':
      return { title: `${agentName} replied`, body: chatTitle === null ? 'Open Ori Bot to read it.' : `In “${chatTitle}”.` };
    case 'failed':
      return { title: `${agentName} couldn't finish`, body: `${where}Open the chat to see why.` };
  }
}
