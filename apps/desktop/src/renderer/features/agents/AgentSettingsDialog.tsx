import type { Agent, SkillScope } from '@morrowbot/contracts';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { ProviderChoice } from '../../shared/binding-ui/selection.ts';
import type { ChatSettingsModel } from '../../shared/chat-settings.ts';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';
import type { IconName } from '../../shared/ui/Icon.tsx';
import { SettingsShell, type SettingsNavGroup } from '../../shared/ui/SettingsShell.tsx';
import { AgentBrain } from './AgentBrain.tsx';
import { AgentGeneral } from './AgentGeneral.tsx';
import type { AgentNotifyModel } from './agent-notify.ts';
import { AgentNotifications } from './AgentNotifications.tsx';
import { AgentReplies } from './AgentReplies.tsx';
import type { AgentsModel } from './agents-model.ts';
import { DangerZone, WorkspaceSection } from './DangerZone.tsx';
import { InstructionsEditor } from './InstructionsEditor.tsx';
import { MemoriesSection } from './MemoriesSection.tsx';
import { SkillsSection } from './SkillsSection.tsx';
import type { AvatarEditor } from './NewAgentDialog.tsx';

export type AgentSection = 'general' | 'brain' | 'instructions' | 'skills' | 'memories' | 'routines' | 'replies' | 'notifications' | 'workspace' | 'danger';

const TITLES: Readonly<Record<AgentSection, string>> = {
  general: 'General',
  brain: 'Brain',
  instructions: 'Instructions',
  skills: 'Skills',
  memories: 'Memories',
  routines: 'Routines',
  replies: 'Replies',
  notifications: 'Notifications',
  workspace: 'Workspace',
  danger: 'Danger zone',
};

const ICONS: Readonly<Record<AgentSection, IconName>> = {
  general: 'settings',
  brain: 'chat',
  instructions: 'pencil',
  skills: 'book',
  memories: 'bookmark',
  routines: 'clock',
  replies: 'smile',
  notifications: 'bell',
  workspace: 'folder',
  danger: 'trash',
};

const NAV: readonly AgentSection[] = ['general', 'brain', 'instructions', 'skills', 'memories', 'routines', 'replies', 'notifications', 'workspace'];

const isSection = (id: string): id is AgentSection => id in TITLES;

/**
 * Agent Settings in the shared Settings shell (spec §5.2). Each section is staged with its own Save
 * and keeps its draft while another section is open; closing with unsaved changes asks first.
 */
export function AgentSettingsDialog(props: {
  readonly model: AgentsModel;
  readonly notify: AgentNotifyModel;
  /** The chat settings the host owns, which can set Replies for every agent. */
  readonly chatSettings: ChatSettingsModel;
  readonly agent: Agent;
  readonly section: AgentSection;
  readonly onSection: (section: AgentSection) => void;
  readonly choices: readonly ProviderChoice[];
  readonly avatarEditor: AvatarEditor;
  /** The Routines section, which the routines feature draws. */
  readonly routines: ComponentChildren;
  readonly workspaceLabel: string;
  readonly redact: (text: string) => string;
  readonly onOpenProviders: () => void;
  readonly onCopyPath: () => void;
  readonly onRevealWorkspace: () => void;
  readonly onRevealCopy: (revealId: string) => void;
  readonly onRevealSkills: (scope: SkillScope) => void;
  readonly onDeleted: () => void;
  readonly onClose: () => void;
}) {
  const { agent, model } = props;
  const [dirty, setDirty] = useState<Readonly<Partial<Record<AgentSection, boolean>>>>({});
  const [discarding, setDiscarding] = useState<(() => void) | null>(null);
  const mark = (section: AgentSection) => (value: boolean): void => {
    setDirty((current) => (current[section] === value ? current : { ...current, [section]: value }));
  };
  const groups: readonly SettingsNavGroup[] = [
    {
      label: agent.name,
      items: NAV.map((id) => ({ id, label: TITLES[id], icon: ICONS[id], dirty: dirty[id] === true })),
    },
    { label: null, items: [{ id: 'danger', label: TITLES.danger, icon: ICONS.danger }] },
  ];
  const leave = (then: () => void) => (): void => {
    if (Object.values(dirty).some(Boolean)) setDiscarding(() => then);
    else then();
  };
  const bound = agent.provider.kind === 'bound' ? agent.provider : null;
  const choice = bound === null ? undefined : props.choices.find(({ id }) => id === bound.pluginId);
  return (
    <>
      <SettingsShell
        label={`${agent.name} settings`}
        groups={groups}
        selected={props.section}
        onSelect={(id) => {
          if (isSection(id)) props.onSection(id);
        }}
        breadcrumb={[agent.name, TITLES[props.section]]}
        onClose={leave(props.onClose)}
      >
        <div hidden={props.section !== 'general'}>
          <AgentGeneral model={model} agent={agent} avatarEditor={props.avatarEditor} redact={props.redact} onDirty={mark('general')} />
        </div>
        <div hidden={props.section !== 'brain'}>
          <AgentBrain model={model} agent={agent} choices={props.choices} redact={props.redact} onOpenProviders={leave(props.onOpenProviders)} onDirty={mark('brain')} />
        </div>
        <div hidden={props.section !== 'instructions'}>
          <InstructionsEditor
            model={model}
            agentId={agent.id}
            provider={agent.provider}
            providerName={choice?.name ?? null}
            redact={props.redact}
            onReveal={props.onRevealCopy}
            onDirty={mark('instructions')}
          />
        </div>
        {props.section === 'skills' && <SkillsSection load={() => model.skills(agent.id)} redact={props.redact} onReveal={props.onRevealSkills} />}
        {props.section === 'memories' && <MemoriesSection editor={() => model.memoriesEditor(agent.id)} redact={props.redact} />}
        {props.section === 'routines' && props.routines}
        {props.section === 'replies' && <AgentReplies model={model} chatSettings={props.chatSettings} agent={agent} redact={props.redact} />}
        {props.section === 'notifications' && <AgentNotifications notify={props.notify} agentId={agent.id} />}
        {props.section === 'workspace' && <WorkspaceSection agent={agent} pathLabel={props.workspaceLabel} onCopy={props.onCopyPath} onReveal={props.onRevealWorkspace} />}
        {props.section === 'danger' && <DangerZone agent={agent} onDelete={() => void model.deleteAgent(agent.id).then(props.onDeleted)} />}
      </SettingsShell>
      {discarding !== null && (
        <ConfirmDialog
          title="Discard changes?"
          body={<p>Your unsaved changes in these settings will be lost.</p>}
          confirmLabel="Discard"
          tone="danger"
          onCancel={() => { setDiscarding(null); }}
          onConfirm={() => {
            setDiscarding(null);
            discarding();
          }}
        />
      )}
    </>
  );
}
