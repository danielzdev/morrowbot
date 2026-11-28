import { useEffect, useRef } from 'preact/hooks';
import type { Notify } from '../shared/chat-prefs.ts';
import { useStore } from '../shared/use-store.ts';
import { attentionCopy, attentionFrom, windowTitle } from './attention.ts';
import type { Models } from './models.ts';

/**
 * Keeps the window title on what needs the user, and, while the window is in the background and
 * Settings › Chat › Notifications is on, raises a system notification that opens the chat.
 */
export function useAttention(options: {
  readonly models: Models;
  readonly agentName: string | null;
  readonly notify: Notify;
  /** Privacy-safe text for notifications (spec §9.1). */
  readonly safe: (text: string) => string;
  readonly onOpen: (agentId: string, threadId: string) => void;
}): void {
  const { models } = options;
  const activity = useStore(models.chats.activity);
  const before = useRef(activity);
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    document.title = windowTitle(activity, options.agentName);
  }, [activity, options.agentName]);
  useEffect(() => {
    const events = attentionFrom(before.current, activity);
    before.current = activity;
    const { notify, safe, onOpen } = latest.current;
    if (events.length === 0 || notify === 'off' || document.hasFocus() || typeof Notification === 'undefined') return;
    const state = models.agents.state.get();
    const agents = state.agents.kind === 'loaded' ? state.agents.value : [];
    for (const event of events) {
      const agent = agents.find(({ id }) => id === event.agentId);
      if (agent === undefined) continue;
      const threads = state.threads[event.agentId];
      const title = threads?.kind === 'loaded' ? (threads.value.find(({ id }) => id === event.threadId)?.title ?? null) : null;
      const copy = attentionCopy(event, safe(agent.name), title === null ? null : safe(title));
      const note = new Notification(copy.title, { body: copy.body });
      note.onclick = () => {
        window.focus();
        onOpen(event.agentId, event.threadId);
      };
    }
  }, [activity]);
}
