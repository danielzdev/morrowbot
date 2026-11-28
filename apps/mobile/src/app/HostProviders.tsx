import { useEffect, useMemo, type ReactNode } from 'react';
import { ChatHostProvider, createSampleChatHost } from '../features/chat/index.ts';
import { createLiveChatHost } from '../features/connection/index.ts';
import { ExtensionsHostProvider } from '../features/extensions/index.ts';
import type { HostDirectory } from '../features/threads/index.ts';
import { useHostConnection } from '../lib/host-connection.ts';

/** While no host is paired, chat, Extensions and the lists show the in-memory sample host. */
const sample = createSampleChatHost();

/** Gives each feature the host it talks to: the active paired host, or the sample when none is paired. */
export function HostProviders(props: { readonly directory: HostDirectory; readonly children: ReactNode }) {
  const { state } = useHostConnection();
  const active = state.kind === 'ready' ? state.active : null;
  const transport = active?.transport ?? null;
  const online = active === null || active.status.kind === 'online';
  const host = useMemo(() => (transport === null ? sample : createLiveChatHost(transport)), [transport]);
  const { directory } = props;
  useEffect(() => {
    directory.attach(transport);
  }, [directory, transport]);
  useEffect(() => {
    if (online) directory.refresh();
  }, [directory, transport, online]);

  if (state.kind === 'loading') return null;
  return (
    <ChatHostProvider host={host} online={online}>
      <ExtensionsHostProvider host={host} online={online}>
        {props.children}
      </ExtensionsHostProvider>
    </ChatHostProvider>
  );
}
