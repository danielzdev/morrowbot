import type { Agent } from '@morrowbot/contracts';
import { useRef, useState } from 'preact/hooks';
import { BotAvatar, combineActivity, motionOf } from '../features/avatar/index.ts';
import type { AgentSection } from '../features/agents/index.ts';
import { BindingControl, BindingWarnings, sendBlock, type BoundProvider } from '../features/binding/index.ts';
import { ChatView, Composer } from '../features/chat/index.ts';
import { ThreadHeader } from '../features/thread/index.ts';
import { useStore } from '../shared/use-store.ts';
import { choiceFor, providerChoicesOf, threadStatusOf } from './derive.ts';
import type { Models } from './models.ts';

export interface Chrome {
  readonly sidebarButton: boolean;
  readonly showSidebar: () => void;
}

/** The agent's open chat: header, messages and composer. */
export function ChatPane(props: {
  readonly models: Models;
  readonly agent: Agent;
  readonly chrome: Chrome;
  readonly reducedMotion: boolean;
  /** Makes host error text safe to show (spec §9.1). */
  readonly redact: (text: string) => string;
  readonly onAgentSettings: (section: AgentSection) => void;
  readonly onPlugins: () => void;
  /** Changes on ⇧⌘M: open the binding popover. */
  readonly bindingRequest: number;
  readonly onCopy: (threadId: string) => void;
  readonly onNewChat: () => void;
}) {
  const { models, agent } = props;
  const state = useStore(models.agents.state);
  const cards = useStore(models.plugins.cards);
  const activity = useStore(models.chats.activity);
  const { sendWith } = useStore(models.chatPrefs.state);
  const threadId = state.openThread[agent.id] ?? null;
  const threads = state.threads[agent.id];
  const choices = providerChoicesOf(cards);
  const bound = agent.provider.kind === 'bound' ? agent.provider : null;
  const choice = bound === null ? undefined : choiceFor(cards, choices, bound.pluginId);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const commit = async (next: BoundProvider): Promise<string | null> => {
    if (inFlight.current) return 'Another change is still saving.';
    inFlight.current = true;
    setSaving(true);
    const result = await models.agents.updateAgent(agent.id, { provider: next });
    inFlight.current = false;
    setSaving(false);
    return result.kind === 'refused' ? result.message : null;
  };
  const session = threadId === null ? undefined : models.chats.session(threadId);
  const motion = motionOf(combineActivity(Object.values(activity).filter((each) => each.agentId === agent.id).map((each) => each.activity)));
  return (
    <div class="main">
      <ThreadHeader
        agent={agent}
        avatar={<BotAvatar avatar={agent.avatar} motion={motion} size={20} reducedMotion={props.reducedMotion} />}
        threads={threads?.kind === 'loaded' ? threads.value : []}
        threadsLoaded={threads?.kind === 'loaded'}
        openThreadId={threadId}
        statusOf={(id) => threadStatusOf(activity, id)}
        unread={(id) => id in state.unread}
        sidebarButton={props.chrome.sidebarButton}
        onShowSidebar={props.chrome.showSidebar}
        onAgentSettings={() => { props.onAgentSettings('general'); }}
        onNewChat={props.onNewChat}
        onOpen={(id) => {
          models.agents.openThread(agent.id, id);
        }}
        onRename={(id, title) => void models.agents.renameThread(agent.id, id, title)}
        onDelete={(id) => void models.agents.deleteThread(agent.id, id)}
        onCopy={props.onCopy}
      />
      {threads?.kind === 'failed' && <div class="banner danger">{props.redact(threads.message)}</div>}
      {session === undefined ? (
        <div class="chat empty">
          <p>No chats yet.</p>
          <button class="btn primary" onClick={props.onNewChat}>
            New chat
          </button>
        </div>
      ) : (
        <>
          <ChatView key={session.threadId} session={session} locked={saving} />
          <Composer
            key={`composer-${session.threadId}`}
            session={session}
            agentName={agent.name}
            disabledReason={saving ? 'Saving the new settings…' : sendBlock(agent.name, choice, agent.provider)}
            sendWith={sendWith}
            toolbar={
              <BindingControl
                agentName={agent.name}
                choices={choices}
                choice={choice}
                binding={agent.provider}
                openRequest={props.bindingRequest}
                onCommit={commit}
                redact={props.redact}
                onOpenProviders={props.onPlugins}
                onOpenBrain={() => { props.onAgentSettings('brain'); }}
              />
            }
            notes={<BindingWarnings choice={choice} binding={agent.provider} onOpenProviders={props.onPlugins} />}
          />
        </>
      )}
    </div>
  );
}
