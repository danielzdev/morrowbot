import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { WorkspaceNavigation } from '../../lib/workspace.ts';
import type { ChatHost } from './chat-host.ts';
import { createChatHub, type ChatHub } from './chat-hub.ts';

const HubContext = createContext<ChatHub | null>(null);

/** Gives every chat screen below it the host to talk to. */
export function ChatHostProvider(props: { readonly host: ChatHost; readonly children: ReactNode }) {
  const hub = useMemo(() => createChatHub(props.host), [props.host]);
  return <HubContext value={hub}>{props.children}</HubContext>;
}

export function useChatHub(): ChatHub {
  const hub = useContext(HubContext);
  if (hub === null) throw new Error('Chat screens need a ChatHostProvider above them.');
  return hub;
}

/** What a floating chat action asks the open chat screen to do. */
export type ChatRequest =
  | { readonly kind: 'new-thread'; readonly agentId: string; readonly navigation: WorkspaceNavigation }
  | { readonly kind: 'agent-settings'; readonly agentId: string };

const listeners = new Set<(request: ChatRequest) => void>();

/**
 * Floating actions are plain values in the registry, so they cannot reach React context; they post
 * here and the chat screen on show handles them.
 */
export const chatRequests = {
  post(request: ChatRequest): void {
    for (const listener of [...listeners]) listener(request);
  },
  listen(listener: (request: ChatRequest) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
