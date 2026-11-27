import type { Agent } from '@morrowbot/contracts';
import { useRef, useState } from 'preact/hooks';
import { BotAvatar, combineActivity, motionOf } from '../features/avatar/index.ts';
import { AccessNotes, AccessPicker, ModelPicker, type BoundProvider } from '../features/binding/index.ts';
import { ChatView, Composer } from '../features/chat/index.ts';
import { providerStatus, type ProviderCard } from '../features/providers/index.ts';
import { ThreadHeader } from '../features/thread/index.ts';
import { useStore } from '../shared/use-store.ts';
import { threadStatusOf } from './derive.ts';
import { infoOf, type Models } from './models.ts';

export interface Chrome {
  readonly sidebarButton: boolean;
  readonly showSidebar: () => void;
}

function ProviderChip(props: { readonly card: ProviderCard | undefined; readonly redact: (text: string) => string; readonly onProvider: () => void }) {
  if (props.card === undefined) return <span class="chip warning">Provider not installed</span>;
  const summary = providerStatus(props.card.entry, props.card.info);
  if (summary.runnable && summary.tone === 'ok') return null;
  return (
    <button class={`chip ${summary.tone}`} onClick={props.onProvider} title={props.redact(summary.detail ?? '')}>
      {props.card.entry.manifest.name}: {summary.title}
    </button>
  );
}

/** The agent's open chat: header, messages and composer. */
export function ChatPane(props: {
  readonly models: Models;
  readonly agent: Agent;
  readonly chrome: Chrome;
  readonly reducedMotion: boolean;
  /** Makes host error text safe to show (spec §9.1). */
  readonly redact: (text: string) => string;
  readonly onAgentSettings: () => void;
  /** Opens Settings › Providers at the agent's provider. */
  readonly onProvider: (providerId: string) => void;
  readonly onCopy: (threadId: string) => void;
  readonly onNewChat: () => void;
}) {
  const { models, agent } = props;
  const state = useStore(models.agents.state);
  const cards = useStore(models.providers.cards);
  const activity = useStore(models.chats.activity);
  const { sendWith } = useStore(models.chatPrefs.state);
  const threadId = state.openThread[agent.id] ?? null;
  const threads = state.threads[agent.id];
  const binding = agent.provider.kind === 'bound' ? agent.provider : null;
  const card = binding === null || cards.kind !== 'loaded' ? undefined : cards.value.find(({ entry }) => entry.manifest.id === binding.pluginId);
  const info = infoOf(card);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const [bindingProblem, setBindingProblem] = useState<string | null>(null);
  const rebind = (next: BoundProvider): void => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setBindingProblem(null);
    void models.agents.updateAgent(agent.id, { provider: next }).then((result) => {
      inFlight.current = false;
      setSaving(false);
      if (result.kind === 'refused') setBindingProblem(`The change was not saved: ${result.message}`);
    });
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
        onAgentSettings={props.onAgentSettings}
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
            sendWith={sendWith}
            disabledReason={binding === null ? "Choose a provider in this agent's settings." : saving ? 'Saving the new settings…' : null}
            toolbar={
              binding === null ? (
                <button class="chip warning" onClick={props.onAgentSettings}>
                  No provider
                </button>
              ) : (
                <>
                  <ModelPicker info={info} binding={binding} disabled={saving} onChange={(selection) => { rebind({ ...binding, selection }); }} />
                  <AccessPicker info={info} binding={binding} disabled={saving} onChange={(access, vendorSettings) => { rebind({ ...binding, access, vendorSettings }); }} />
                  <ProviderChip card={card} redact={props.redact} onProvider={() => { props.onProvider(binding.pluginId); }} />
                </>
              )
            }
          />
          {bindingProblem !== null && <div class="access-notes note danger">{props.redact(bindingProblem)}</div>}
          {binding !== null && <AccessNotes info={info} binding={binding} />}
        </>
      )}
    </div>
  );
}
