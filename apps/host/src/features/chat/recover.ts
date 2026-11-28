import type { AssistantMessage } from '@morrowbot/contracts';
import type { ChatServiceOptions } from './ports.ts';

/**
 * Turns a crash left unsettled end as interrupted, keeping the text saved so far. A background turn (its input
 * is not a chat message) ends quietly: the chat never showed it. A sub-agent the crash caught before its turn
 * was admitted never started, so it is deleted.
 */
export function recover(options: ChatServiceOptions): void {
  const { store } = options;
  store.subagents.deleteUnstarted();
  for (const generation of store.generations.unsettled()) {
    if (store.messages.get(generation.inputMessageId) === undefined) {
      store.transaction(() => {
        store.generations.settle(generation.id, null);
        store.toolSteps.close(generation.id, null);
        store.replyAttachments.close(generation.id, null);
        store.cards.close(generation.id, null);
        store.agentMessages.setReadOutcome(generation.inputMessageId, 'interrupted');
      });
      continue;
    }
    const at = options.now();
    const message: AssistantMessage = {
      kind: 'assistant',
      id: options.newId(),
      threadId: generation.threadId,
      text: generation.partialText,
      outcome: { kind: 'interrupted' },
      attachments: store.replyAttachments.listOpen(generation.id).map(({ attachment }) => attachment),
      createdAt: at,
    };
    store.transaction(() => {
      store.messages.insert(message);
      store.threads.touch(generation.threadId, at);
      store.generations.settle(generation.id, message.id);
      store.toolSteps.close(generation.id, message.id);
      store.replyAttachments.close(generation.id, message.id);
      store.cards.close(generation.id, message.id);
    });
  }
}
