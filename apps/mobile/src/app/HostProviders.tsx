import type { ReactNode } from 'react';
import { ChatHostProvider, createSampleChatHost } from '../features/chat/index.ts';
import { ExtensionsHostProvider } from '../features/extensions/index.ts';

/** Until the connection slice hands over a paired host, chat and Extensions run on the sample host. */
const host = createSampleChatHost();

/** Gives each feature the host it talks to. */
export function HostProviders(props: { readonly children: ReactNode }) {
  return (
    <ChatHostProvider host={host}>
      <ExtensionsHostProvider host={host}>{props.children}</ExtensionsHostProvider>
    </ChatHostProvider>
  );
}
