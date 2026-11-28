import type { Agent } from '@morrowbot/contracts';
import type { MorrowbotBridge } from '../bridge.ts';
import { AgentSettingsDialog, NewAgentDialog, type AgentSection, type AvatarEditor } from '../features/agents/index.ts';
import { AvatarPicker, freshAvatar } from '../features/avatar/index.ts';
import { AgentExtensionsSection, type ConnectorTarget } from '../features/connectors/index.ts';
import { RoutinesSection } from '../features/routines/index.ts';
import { displayPath, redact, type AppInfo } from '../shared/privacy.ts';
import { useStore } from '../shared/use-store.ts';
import { providerChoicesOf } from './derive.ts';
import type { Models } from './models.ts';

/** How New Agent's Brain starts: on the first eligible provider (§5.1), or unbound ("Skip for now", §7). */
export type NewAgentBrain = 'prefill' | 'unbound';

export type AgentDialog =
  | { readonly kind: 'new-agent'; readonly brain: NewAgentBrain }
  | { readonly kind: 'agent-settings'; readonly agentId: string; readonly section: AgentSection };

const NO_INFO: AppInfo = { appVersion: '', homeDir: '', userName: '', dataDir: '' };

/** New Agent (⇧⌘N) and Agent Settings, as modals over the window. */
export function AgentDialogs(props: {
  readonly dialog: AgentDialog | null;
  readonly onDialog: (dialog: AgentDialog | null) => void;
  readonly models: Models;
  readonly bridge: MorrowbotBridge;
  readonly info: AppInfo | null;
  readonly reducedMotion: boolean;
  /** True only for the server's owner, who may grant full access (shell commands). */
  readonly allowFull: boolean;
  readonly onOpenProviders: () => void;
  /** Opens Extensions › Connectors; null for a member who may not manage them. */
  readonly onOpenConnectors: ((target: ConnectorTarget) => void) | null;
  readonly onCreated: (agent: Agent) => void;
}) {
  const { dialog, models, bridge } = props;
  const state = useStore(models.agents.state);
  const cards = useStore(models.providers.cards);
  if (dialog === null) return null;
  const choices = providerChoicesOf(cards);
  const info = props.info ?? NO_INFO;
  const safe = (text: string): string => redact(text, info);
  const avatarEditor: AvatarEditor = (value, onChange, previewSize) => (
    <AvatarPicker value={value} onChange={onChange} previewSize={previewSize} reducedMotion={props.reducedMotion} />
  );
  const close = (): void => {
    props.onDialog(null);
  };
  const providers = (): void => {
    close();
    props.onOpenProviders();
  };
  switch (dialog.kind) {
    case 'new-agent':
      return (
        <NewAgentDialog
          model={models.agents}
          bridge={bridge}
          choices={choices}
          prefill={dialog.brain === 'prefill'}
          allowFull={props.allowFull}
          avatarEditor={avatarEditor}
          newAvatar={freshAvatar}
          pathLabel={(path) => displayPath(path, info)}
          redact={safe}
          onOpenProviders={providers}
          onCreated={(agent) => {
            close();
            props.onCreated(agent);
          }}
          onClose={close}
        />
      );
    case 'agent-settings': {
      const agent = state.agents.kind === 'loaded' ? state.agents.value.find(({ id }) => id === dialog.agentId) : undefined;
      if (agent === undefined) return null;
      const workspaceLabel = displayPath(agent.workspace.dir, info, agent.workspace.dir);
      const { onOpenConnectors } = props;
      const personal = agent.provider.kind === 'bound' && agent.provider.vendorSettings === 'personal' ? agent.provider.pluginId : null;
      return (
        <AgentSettingsDialog
          key={agent.id}
          model={models.agents}
          notify={models.agentNotify}
          appearance={models.appearance}
          chatSettings={models.chatSettings}
          agent={agent}
          section={dialog.section}
          onSection={(section) => { props.onDialog({ ...dialog, section }); }}
          choices={choices}
          allowFull={props.allowFull}
          avatarEditor={avatarEditor}
          routines={<RoutinesSection model={models.routines} agentId={agent.id} redact={safe} />}
          extensions={
            onOpenConnectors === null
              ? null
              : ({ onDirty, leave }) => {
                  const go = (target: ConnectorTarget): void => {
                    leave(() => {
                      close();
                      onOpenConnectors(target);
                    });
                  };
                  return (
                    <AgentExtensionsSection
                      model={models.connectors}
                      agent={agent}
                      agents={state.agents.kind === 'loaded' ? state.agents.value : []}
                      personalProvider={personal === null ? null : (choices.find(({ id }) => id === personal)?.name ?? null)}
                      redact={safe}
                      onDirty={onDirty}
                      onManage={(id) => { go({ kind: 'connector', id }); }}
                      onAddExtensions={() => { go({ kind: 'list', installFor: agent.id }); }}
                    />
                  );
                }
          }
          workspaceLabel={workspaceLabel}
          redact={safe}
          onOpenProviders={providers}
          onCopyPath={() => void bridge.copyText(workspaceLabel)}
          onRevealWorkspace={() => void bridge.revealPath({ kind: 'agent-workspace', agentId: agent.id })}
          onRevealCopy={(revealId) => void bridge.revealPath({ kind: 'instructions-copy', agentId: agent.id, revealId })}
          onRevealSkills={(scope) => void bridge.revealPath(scope === 'global' ? { kind: 'global-skills' } : { kind: 'agent-skills', agentId: agent.id })}
          onDeleted={close}
          onClose={close}
        />
      );
    }
  }
}
