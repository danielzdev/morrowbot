import type { Agent } from '@morrowbot/contracts';
import type { MorrowbotBridge } from '../bridge.ts';
import type { AgentSection } from '../features/agents/index.ts';
import { PluginsPage } from '../features/plugins/index.ts';
import type { AppInfo } from '../shared/privacy.ts';
import { useStore } from '../shared/use-store.ts';
import { ChatPane, type Chrome } from './ChatPane.tsx';
import type { Models } from './models.ts';
import { PageFrame } from './PageFrame.tsx';

export type Page = { readonly kind: 'chat' } | { readonly kind: 'plugins' };

/** The main pane's page: the selected agent's chat, or Plugins. New Agent and Agent Settings are dialogs. */
export function Pages(props: {
  readonly page: Page;
  readonly onPage: (page: Page) => void;
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
  readonly onNewAgent: () => void;
  readonly onCopy: (threadId: string) => void;
  readonly onNewChat: (agentId: string) => void;
}) {
  const { models, bridge, agent, chrome, info, page } = props;
  const state = useStore(models.agents.state);
  switch (page.kind) {
    case 'plugins':
      return <PageFrame title="Plugins" chrome={chrome}><PluginsPage model={models.plugins} bridge={bridge} /></PageFrame>;
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
            onPlugins={() => { props.onPage({ kind: 'plugins' }); }}
            onCopy={props.onCopy}
            onNewChat={() => { props.onNewChat(agent.id); }}
          />
        );
      }
      return (
        <PageFrame title="MorrowBot" chrome={chrome}>
          <div class="chat empty">
            <p>{state.agents.kind === 'loading' ? 'Loading…' : 'Create an agent to start chatting.'}</p>
            {state.agents.kind === 'loaded' && <button class="btn primary" onClick={props.onNewAgent}>New agent</button>}
          </div>
        </PageFrame>
      );
  }
}
