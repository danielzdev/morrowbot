import type { Agent } from '@morrowbot/contracts';
import type { MorrowbotBridge } from '../bridge.ts';
import type { AgentSection } from '../features/agents/index.ts';
import type { SettingsLink } from '../features/settings/index.ts';
import type { AppInfo } from '../shared/privacy.ts';
import { useStore } from '../shared/use-store.ts';
import type { NewAgentBrain } from './AgentDialogs.tsx';
import { ChatPane, type Chrome } from './ChatPane.tsx';
import { ExtensionsPage, type ExtensionsJump } from './ExtensionsPage.tsx';
import { FirstRun } from './FirstRun.tsx';
import type { Models } from './models.ts';
import { PageFrame } from './PageFrame.tsx';

export type Page = { readonly kind: 'chat' } | { readonly kind: 'extensions'; readonly jump: ExtensionsJump | null };

/** The main pane's page: the selected agent's chat, or Extensions. New Agent and Agent Settings are dialogs. */
export function Pages(props: {
  readonly page: Page;
  readonly onPage: (page: Page) => void;
  /** Extensions hands up its "Discard changes?" check while open, and null when it closes. */
  readonly onLeaveCheck: (check: ((action: () => void) => void) | null) => void;
  readonly models: Models;
  readonly bridge: MorrowbotBridge;
  readonly agent: Agent | undefined;
  readonly chrome: Chrome;
  readonly info: AppInfo | null;
  readonly reducedMotion: boolean;
  readonly findRequest: number;
  readonly bindingRequest: number;
  /** The chat whose pending approval the sidebar asked to show. */
  readonly approvalFocus: string | null;
  readonly onApprovalFocused: () => void;
  readonly onAgentSettings: (agentId: string, section: AgentSection) => void;
  /** Null for a member who may not create agents. */
  readonly onNewAgent: (() => void) | null;
  /** True only for the server's owner, who may grant full access (shell commands). */
  readonly allowFull: boolean;
  readonly onCopy: (threadId: string) => void;
  readonly onNewChat: (agentId: string) => void;
  readonly onOpenSettings: (link: SettingsLink) => void;
  readonly inspectorOpen: boolean;
  readonly onToggleInspector: () => void;
  /** First run: New Agent, prefilled or as an unbound draft. */
  readonly onFirstAgent: (brain: NewAgentBrain) => void;
}) {
  const { models, bridge, agent, chrome, info, page } = props;
  const state = useStore(models.agents.state);
  switch (page.kind) {
    case 'extensions':
      return (
        <PageFrame title="Extensions" chrome={chrome}>
          <ExtensionsPage
            models={models}
            bridge={bridge}
            info={info}
            reducedMotion={props.reducedMotion}
            jump={page.jump}
            onLeaveCheck={props.onLeaveCheck}
            onOpenProvider={(id) => { props.onOpenSettings(`providers/${id}`); }}
            onExit={() => { props.onPage({ kind: 'chat' }); }}
          />
        </PageFrame>
      );
    case 'chat':
      if (agent !== undefined) {
        return (
          <ChatPane
            key={agent.id}
            models={models}
            bridge={bridge}
            agent={agent}
            chrome={chrome}
            reducedMotion={props.reducedMotion}
            info={info}
            findRequest={props.findRequest}
            bindingRequest={props.bindingRequest}
            approvalFocus={props.approvalFocus}
            onApprovalFocused={props.onApprovalFocused}
            onAgentSettings={(section) => { props.onAgentSettings(agent.id, section); }}
            onOpenProviders={() => { props.onOpenSettings(agent.provider.kind === 'bound' ? `providers/${agent.provider.pluginId}` : 'providers'); }}
            onCopy={props.onCopy}
            onNewChat={() => { props.onNewChat(agent.id); }}
            inspectorOpen={props.inspectorOpen}
            onToggleInspector={props.onToggleInspector}
            ownerEngines={props.onNewAgent !== null}
            allowFull={props.allowFull}
          />
        );
      }
      return (
        <PageFrame title="MorrowBot" chrome={chrome}>
          {state.agents.kind === 'loaded' && state.agents.value.length === 0 && props.onNewAgent === null ? (
            <div class="chat empty">
              <p>No agents are shared with you on this server right now. Ask its owner to share one.</p>
            </div>
          ) : state.agents.kind === 'loaded' && state.agents.value.length === 0 ? (
            <FirstRun models={models} bridge={bridge} info={info} onFirstAgent={props.onFirstAgent} />
          ) : (
            <div class="chat empty">
              <p>{state.agents.kind === 'loading' ? 'Loading…' : state.agents.kind === 'failed' ? "MorrowBot couldn't load your agents." : 'Choose an agent to start chatting.'}</p>
              {state.agents.kind === 'loaded' && props.onNewAgent !== null && <button class="btn primary" onClick={props.onNewAgent}>New agent</button>}
            </div>
          )}
        </PageFrame>
      );
  }
}
