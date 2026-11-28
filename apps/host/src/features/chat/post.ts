import type { AssistantMessage } from '@morrowbot/contracts';
import type { ChatCore } from './turn.ts';

/** Posts an assistant message directly into an active non-subagent chat and publishes it to live subscribers. */
export function postAssistantMessage(core: ChatCore, threadId: string, text: string): AssistantMessage | undefined {
  if (core.closed || core.deletingThreads.has(threadId) || text.trim() === '') return undefined;
  const { store, newId, now } = core.options;
  const thread = store.threads.get(threadId);
  if (thread === undefined || core.deletingAgents.has(thread.agentId) || thread.archivedAt !== null || store.subagents.get(threadId) !== undefined) {
    return undefined;
  }
  const createdAt = now();
  const message: AssistantMessage = {
    kind: 'assistant',
    id: newId(),
    threadId,
    text,
    outcome: { kind: 'completed', finishReason: 'stop' },
    attachments: [],
    createdAt,
  };
  store.transaction(() => {
    store.messages.insert(message);
    store.threads.touch(threadId, createdAt);
  });
  core.events.publish({ kind: 'message.posted', threadId, message });
  return message;
}
