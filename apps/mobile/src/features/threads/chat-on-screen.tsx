import { useEffect, type ComponentType } from 'react';
import type { DetailProps } from '../../lib/workspace.ts';
import type { HostDirectory } from './host-directory.ts';

/** The chat screen, telling the directory while it is on screen, so its replies count as read. */
export function trackChatOnScreen(directory: HostDirectory, Body: ComponentType<DetailProps<'chat'>>): ComponentType<DetailProps<'chat'>> {
  return function ChatOnScreen(props: DetailProps<'chat'>) {
    const { agentId, threadId } = props.route;
    useEffect(() => directory.viewing(agentId, threadId), [agentId, threadId]);
    return <Body {...props} />;
  };
}
