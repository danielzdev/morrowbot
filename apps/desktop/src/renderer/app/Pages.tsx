import type { Agent, ProviderBinding } from '@morrowbot/contracts';
import type { MorrowbotBridge } from '../bridge.ts';
import { AgentSettings, NewAgent, type AvatarEditor, type ProviderOption } from '../features/agents/index.ts';
import { AvatarPicker, freshAvatar } from '../features/avatar/index.ts';
import { bindTo } from '../features/binding/index.ts';
import { ExtensionsView } from '../features/plugins/index.ts';
import type { SettingsLink } from '../features/settings/index.ts';
import { displayPath, redact, type AppInfo } from '../shared/privacy.ts';
import { useStore } from '../shared/use-store.ts';
import { ChatPane, type Chrome } from './ChatPane.tsx';
import { cardOf, infoOf, type Models } from './models.ts';
import { PageFrame } from './PageFrame.tsx';

export type Page = { readonly kind: 'chat' } | { readonly kind: 'agent-settings' } | { readonly kind: 'new-agent' } | { readonly kind: 'extensions' };

const NO_INFO: AppInfo = { appVersion: '', homeDir: '', userName: '', dataDir: '' };
const avatarEditor: AvatarEditor = (value, onChange) => <AvatarPicker value={value} onChange={onChange} />;

/** The main pane's page: the selected agent's chat, or New agent, Agent settings or Extensions. */
export function Pages(props: {
  readonly page: Page;
  readonly onPage: (page: Page) => void;
  readonly models: Models;
  readonly bridge: MorrowbotBridge;
  readonly agent: Agent | undefined;
  readonly chrome: Chrome;
  readonly info: AppInfo | null;
  readonly reducedMotion: boolean;
  readonly onCopy: (threadId: string) => void;
  readonly onNewChat: (agentId: string) => void;
  readonly onOpenSettings: (link: SettingsLink) => void;
}) {
  const { models, bridge, agent, chrome, info, page } = props;
  const state = useStore(models.agents.state);
  const cards = useStore(models.providers.cards);
  const setPage = props.onPage;
  const providers: readonly ProviderOption[] =
    cards.kind === 'loaded' ? cards.value.filter(({ entry }) => entry.manifest.kind === 'provider').map(({ entry }) => ({ id: entry.manifest.id, name: entry.manifest.name })) : [];
  const bindingFor = (pluginId: string): ProviderBinding => bindTo(pluginId, infoOf(cardOf(models.providers, pluginId)));
  switch (page.kind) {
    case 'extensions':
      return (
        <PageFrame title="Extensions" chrome={chrome}>
          <ExtensionsView model={models.plugins} info={info} bridge={bridge} onOpenProvider={(id) => { props.onOpenSettings(`providers/${id}`); }} onExit={() => { setPage({ kind: 'chat' }); }} />
        </PageFrame>
      );
    case 'new-agent':
      return (
        <PageFrame title="New agent" chrome={chrome}>
          <NewAgent model={models.agents} bridge={bridge} providers={providers} bindingFor={bindingFor} avatarEditor={avatarEditor} newAvatar={freshAvatar} onCreated={() => { setPage({ kind: 'chat' }); }} />
        </PageFrame>
      );
    case 'agent-settings':
      return agent === undefined ? null : (
        <PageFrame title={`${agent.name} settings`} chrome={chrome}>
          <AgentSettings
            key={agent.id}
            model={models.agents}
            agent={agent}
            providers={providers}
            bindingFor={bindingFor}
            avatarEditor={avatarEditor}
            workspaceLabel={displayPath(agent.workspace.dir, info ?? NO_INFO, agent.workspace.dir)}
            onReveal={() => void bridge.revealPath({ kind: 'agent-workspace', agentId: agent.id })}
            onDeleted={() => { setPage({ kind: 'chat' }); }}
          />
        </PageFrame>
      );
    case 'chat':
      if (agent !== undefined) {
        return (
          <ChatPane key={agent.id} models={models} agent={agent} chrome={chrome} reducedMotion={props.reducedMotion} redact={(text) => redact(text, info ?? NO_INFO)} onAgentSettings={() => { setPage({ kind: 'agent-settings' }); }} onProvider={(id) => { props.onOpenSettings(`providers/${id}`); }} onCopy={props.onCopy} onNewChat={() => { props.onNewChat(agent.id); }} />
        );
      }
      return (
        <PageFrame title="MorrowBot" chrome={chrome}>
          <div class="chat empty">
            <p>{state.agents.kind === 'loading' ? 'Loading…' : 'Create an agent to start chatting.'}</p>
            {state.agents.kind === 'loaded' && <button class="btn primary" onClick={() => { setPage({ kind: 'new-agent' }); }}>New agent</button>}
          </div>
        </PageFrame>
      );
  }
}
