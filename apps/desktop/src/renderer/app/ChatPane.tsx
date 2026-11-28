import { DEFAULT_AVATAR, type Agent, type AgentAvatar } from '@morrowbot/contracts';
import { useMemo, useRef, useState } from 'preact/hooks';
import type { MorrowbotBridge } from '../bridge.ts';
import { BotAvatar, combineActivity, motionOf } from '../features/avatar/index.ts';
import type { AgentSection } from '../features/agents/index.ts';
import { bindingPill, BindingControl, BindingWarnings, sendBlock, type BoundProvider } from '../features/binding/index.ts';
import { chatDisplay, ChatView, Composer, type ChatActivity, type EngineLabel, type PeerDirectory } from '../features/chat/index.ts';
import { INSPECTOR_TOGGLE } from '../features/inspector/index.ts';
import { ThreadHeader } from '../features/thread/index.ts';
import { profileName } from '../shared/binding-ui/access-copy.ts';
import { bubbleStyleVars } from '../shared/bubble-color.ts';
import { displayPath, type AppInfo } from '../shared/privacy.ts';
import { useStore } from '../shared/use-store.ts';
import { choiceFor, providerChoicesOf, threadStatusOf } from './derive.ts';
import { InspectorPane } from './InspectorPane.tsx';
import type { Models } from './models.ts';

/** The agent's avatar beside its running turn and brief completion beat, in CSS pixels. */
const CHAT_AVATAR_SIZE = 32;

export interface Chrome {
  readonly sidebarButton: boolean;
  readonly showSidebar: () => void;
}

/** The agent's open chat: header, messages and composer. */
export function ChatPane(props: {
  readonly models: Models;
  readonly agent: Agent;
  readonly chrome: Chrome;
  readonly bridge: MorrowbotBridge;
  readonly reducedMotion: boolean;
  /** The machine facts that make host text and paths safe to show (spec §9.1); null until main reports them. */
  readonly info: AppInfo | null;
  readonly findRequest: number;
  readonly approvalFocus: string | null;
  readonly onApprovalFocused: () => void;
  readonly onAgentSettings: (section: AgentSection) => void;
  /** Settings › Providers, at this agent's provider. */
  readonly onOpenProviders: () => void;
  /** Changes on ⇧⌘M: open the binding popover. */
  readonly bindingRequest: number;
  readonly onCopy: (threadId: string) => void;
  readonly onNewChat: () => void;
  readonly inspectorOpen: boolean;
  readonly onToggleInspector: () => void;
  /** False for a scoped member: the server's engines are the owner's, so the host alone decides whether a turn may run. */
  readonly ownerEngines: boolean;
  /** True only for the server's owner, who may grant full access (shell commands). */
  readonly allowFull: boolean;
  /** Extensions, at a plugin a chat card offers; null for a member. */
  readonly onOpenPlugin: ((pluginId: string) => void) | null;
}) {
  const { models, agent } = props;
  const display = useMemo(() => chatDisplay(props.info, agent.workspace.dir), [props.info, agent.workspace.dir]);
  const state = useStore(models.agents.state);
  const cards = useStore(models.providers.cards);
  const activity = useStore(models.chats.activity);
  const appearance = useStore(models.appearance.state);
  const { sendWith } = useStore(models.chatPrefs.state);
  const bubbleStyle = useMemo(
    () =>
      bubbleStyleVars({
        global: appearance.messageColor,
        agentOverride: appearance.agentMessageColors[agent.id],
        agentColor: agent.avatar.color,
      }),
    [appearance.messageColor, appearance.agentMessageColors, agent.id, agent.avatar.color],
  );
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
  const everyone = state.agents.kind === 'loaded' ? state.agents.value : null;
  const peers = useMemo<PeerDirectory>(() => {
    const byId = new Map((everyone ?? []).map((each) => [each.id, each]));
    const avatarOf = (id: string) => byId.get(id)?.avatar ?? DEFAULT_AVATAR;
    return {
      name: (id) => byId.get(id)?.name ?? 'Unknown agent',
      color: (id) => avatarOf(id).color,
      avatar: (id, size) => <BotAvatar avatar={avatarOf(id)} size={size} reducedMotion={props.reducedMotion} />,
    };
  }, [everyone, props.reducedMotion]);
  const engine = useMemo<EngineLabel>(() => {
    const known = providerChoicesOf(cards);
    return (binding) => {
      const each = choiceFor(cards, known, binding.pluginId);
      if (each === undefined) return binding.pluginId;
      return binding.selection.kind === 'default' ? each.name : `${each.name} · ${bindingPill(each, binding).label}`;
    };
  }, [cards]);
  const { shape, color, finish } = agent.avatar;
  const chatAvatar = useMemo(() => {
    const avatar: AgentAvatar = { kind: 'bot', shape, color, finish };
    return (each: ChatActivity) => <BotAvatar avatar={avatar} motion={motionOf(each)} size={CHAT_AVATAR_SIZE} reducedMotion={props.reducedMotion} />;
  }, [shape, color, finish, props.reducedMotion]);
  const motion = motionOf(combineActivity(Object.values(activity).filter((each) => each.agentId === agent.id).map((each) => each.activity)));
  return (
    <div class="main-row">
    <div class="main" style={bubbleStyle}>
      <ThreadHeader
        agent={agent}
        avatar={<BotAvatar avatar={agent.avatar} size={20} reducedMotion={props.reducedMotion} />}
        threads={threads?.kind === 'loaded' ? threads.value : []}
        threadsLoaded={threads?.kind === 'loaded'}
        archivedThreads={state.archivedThreads[agent.id]}
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
        onLoadArchived={() => void models.agents.loadArchivedThreads(agent.id)}
        onArchive={(id) => void models.agents.archiveThread(agent.id, id)}
        onRestore={(id) => void models.agents.restoreThread(agent.id, id)}
        onDelete={(id) => void models.agents.deleteThread(agent.id, id)}
        onCopy={props.onCopy}
        inspectorOpen={props.inspectorOpen}
        inspectorToggle={INSPECTOR_TOGGLE}
        onToggleInspector={props.onToggleInspector}
      />
      {threads?.kind === 'failed' && <div class="banner danger">{display.redact(threads.message)}</div>}
      {session === undefined ? (
        <div class="chat empty">
          <p>No chats yet.</p>
          <button class="btn primary" onClick={props.onNewChat}>
            New chat
          </button>
        </div>
      ) : (
        <>
          <ChatView
            key={session.threadId}
            session={session}
            locked={saving}
            agentName={agent.name}
            providerName={choice?.name ?? null}
            display={display}
            bridge={props.bridge}
            findRequest={props.findRequest}
            focusApproval={props.approvalFocus === session.threadId}
            onApprovalFocused={props.onApprovalFocused}
            announce="status"
            onOpenProviders={props.onOpenProviders}
            peers={peers}
            engine={engine}
            avatar={chatAvatar}
            activity={activity[session.threadId]?.activity ?? 'idle'}
            owner={props.ownerEngines}
            onOpenPlugin={props.onOpenPlugin}
            onAgentChanged={(agentId) => void refetchAgent(models, agentId)}
            hero={
              <>
                <BotAvatar avatar={agent.avatar} motion={motion} size={64} reducedMotion={props.reducedMotion} />
                <p class="hero-title">What can {agent.name} help with?</p>
                <p class="hero-note">
                  {props.info === null ? '…' : displayPath(agent.workspace.dir, props.info, agent.workspace.dir)}
                  {bound !== null && ` · ${profileName(bound)}`}
                </p>
              </>
            }
          />
          <Composer
            key={`composer-${session.threadId}`}
            session={session}
            agentName={agent.name}
            disabledReason={saving ? 'Saving the new settings…' : props.ownerEngines ? sendBlock(agent.name, choice, agent.provider) : agent.provider.kind === 'unbound' ? `Ask the server's owner to choose an engine for ${agent.name}` : null}
            safe={display.safe}
            onOpenProviders={props.onOpenProviders}
            sendWith={sendWith}
            toolbar={
              !props.ownerEngines ? (
                <span class="binding-note">Engine and access set by the server's owner</span>
              ) : (
              <BindingControl
                agentName={agent.name}
                choices={choices}
                choice={choice}
                binding={agent.provider}
                openRequest={props.bindingRequest}
                allowFull={props.allowFull}
                onCommit={commit}
                redact={display.redact}
                onOpenProviders={props.onOpenProviders}
                onOpenBrain={() => { props.onAgentSettings('brain'); }}
              />
              )
            }
            notes={props.ownerEngines ? <BindingWarnings choice={choice} binding={agent.provider} onOpenProviders={props.onOpenProviders} /> : null}
          />
        </>
      )}
    </div>
    {props.inspectorOpen && (
      <InspectorPane models={models} bridge={props.bridge} agent={agent} choice={choice} info={props.info} onAgentSettings={props.onAgentSettings} onClose={props.onToggleInspector} />
    )}
    </div>
  );
}

/** Fetches one agent again, such as after a chat card changed one of its settings. */
async function refetchAgent(models: Models, agentId: string): Promise<void> {
  const result = await models.api.listAgents();
  const agent = result.kind === 'ok' ? result.value.agents.find(({ id }) => id === agentId) : undefined;
  if (agent !== undefined) models.agents.adoptAgent(agent);
}
