import { z } from 'zod';
import { readPref, writePref } from '../../shared/local-pref.ts';
import { Store } from '../../shared/store.ts';

/**
 * How one agent asks for attention. `all`: system notifications and the unread dot. `quiet`: the unread
 * dot only. `muted`: neither. Approvals and problems show in the sidebar whatever the level.
 */
export const AgentNotify = z.enum(['all', 'quiet', 'muted']);
export type AgentNotify = z.infer<typeof AgentNotify>;

/** Each agent's level; an agent missing here is `all`. */
export type NotifyLevels = Readonly<Record<string, AgentNotify>>;

const Levels = z.record(z.string(), AgentNotify);
const KEY = 'morrowbot.agent-notify';

export interface AgentNotifyModel {
  readonly state: Store<NotifyLevels>;
  readonly set: (agentId: string, level: AgentNotify) => void;
}

/** Each level's words: a short name for a switch, a menu line, and what it does. */
export const NOTIFY_COPY: Readonly<Record<AgentNotify, { readonly label: string; readonly menu: string; readonly detail: string }>> = {
  all: {
    label: 'All',
    menu: 'All notifications',
    detail: 'A system notification when it replies or needs approval while Ori Bot is in the background, and a dot for new replies.',
  },
  quiet: { label: 'Quiet', menu: 'Quiet: dot only', detail: 'No system notifications. New replies still get a dot in the sidebar.' },
  muted: { label: 'Muted', menu: 'Muted', detail: 'No system notifications and no dot for new replies. Approvals and problems still show.' },
};

export const notifyOf = (levels: NotifyLevels, agentId: string): AgentNotify => levels[agentId] ?? 'all';

/** Owns each agent's notification level, kept on this computer beside Settings › Chat › Notifications. */
export function createAgentNotify(): AgentNotifyModel {
  const state = new Store<NotifyLevels>(readPref<NotifyLevels>(KEY, Levels, {}));
  return {
    state,
    set: (agentId, level) => {
      state.update((current) => {
        const others = Object.fromEntries(Object.entries(current).filter(([id]) => id !== agentId));
        return level === 'all' ? others : { ...others, [agentId]: level };
      });
      writePref(KEY, state.get());
    },
  };
}

/** Whether a system notification may speak for an agent at this level. */
export function popsUp(level: AgentNotify): boolean {
  switch (level) {
    case 'all':
      return true;
    case 'quiet':
    case 'muted':
      return false;
  }
}

/** Whether the sidebar marks the agent's new replies with the unread dot. */
export function showsUnread(level: AgentNotify): boolean {
  switch (level) {
    case 'all':
    case 'quiet':
      return true;
    case 'muted':
      return false;
  }
}
