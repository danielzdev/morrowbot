import type { Agent, ProviderBinding } from '@morrowbot/contracts';
import { useEffect, useState } from 'preact/hooks';
import { turnsOnFull } from '../../shared/binding-ui/binding-state.ts';
import { FullAccessNotice } from '../../shared/binding-ui/FullAccessNotice.tsx';
import { readyInfo, switchBinding, type ProviderChoice } from '../../shared/binding-ui/selection.ts';
import { SectionActions } from './AgentGeneral.tsx';
import type { AgentsModel } from './agents-model.ts';
import { BrainFields } from './BrainFields.tsx';

/** What the provider can do, in one line each, from its capabilities. Full access never asks. */
function Capabilities(props: { readonly choice: ProviderChoice | undefined; readonly binding: ProviderBinding }) {
  const info = readyInfo(props.choice?.info);
  if (info === null) return null;
  const { sessions } = info.capabilities;
  const approvals = info.capabilities.approvals && !(props.binding.kind === 'bound' && props.binding.access === 'full');
  return (
    <ul class="capability-summary">
      <li>{approvals ? 'Asks you before protected changes.' : 'Never asks for approval: it only does what its access allows.'}</li>
      <li>{sessions ? 'Keeps a session with the provider between messages.' : 'Sends the chat history with every message.'}</li>
    </ul>
  );
}

/**
 * The staged provider and model with the agent's saved access (Permissions owns it): kept on the same
 * provider, carried over without raising it on another one.
 */
export function withSavedAccess(staged: ProviderBinding, saved: ProviderBinding, choices: readonly ProviderChoice[], allowFull: boolean): ProviderBinding {
  if (staged.kind !== 'bound' || saved.kind !== 'bound') return staged;
  if (staged.pluginId === saved.pluginId) return { ...staged, access: saved.access, vendorSettings: saved.vendorSettings };
  const choice = choices.find(({ id }) => id === staged.pluginId);
  const carried = choice === undefined ? staged : switchBinding(choice, saved, { allowFull });
  return carried.kind === 'bound' ? { ...staged, access: carried.access, vendorSettings: carried.vendorSettings } : staged;
}

/**
 * Agent Settings › Brain (spec §5.2): provider, model and effort, staged until Save. Refresh never
 * changes the saved binding; when it is no longer available, the fields say why. Access is in Permissions.
 */
export function AgentBrain(props: {
  readonly model: AgentsModel;
  readonly agent: Agent;
  readonly choices: readonly ProviderChoice[];
  /** False for server members (including co-owners), who may not grant full access. */
  readonly allowFull: boolean;
  readonly redact: (text: string) => string;
  readonly onOpenProviders: () => void;
  readonly onDirty: (dirty: boolean) => void;
}) {
  const { agent } = props;
  const [staged, setStaged] = useState<ProviderBinding>(agent.provider);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState(false);
  const binding = withSavedAccess(staged, agent.provider, props.choices, props.allowFull);
  const dirty = JSON.stringify(binding) !== JSON.stringify(agent.provider);
  useEffect(() => {
    props.onDirty(dirty);
  }, [dirty]);
  const save = (): void => {
    const before = agent.provider;
    setSaving(true);
    void props.model.updateAgent(agent.id, { provider: binding }).then((result) => {
      setSaving(false);
      setProblem(result.kind === 'refused' ? props.redact(result.message) : null);
      if (result.kind !== 'refused' && turnsOnFull(before, binding)) setNotice(true);
    });
  };
  const choice = binding.kind === 'bound' ? props.choices.find(({ id }) => id === binding.pluginId) : undefined;
  return (
    <div class="settings-section">
      <BrainFields
        choices={props.choices}
        value={binding}
        keepAccess={true}
        allowFull={props.allowFull}
        redact={props.redact}
        onOpenProviders={props.onOpenProviders}
        onChange={setStaged}
      />
      {binding.kind === 'unbound' && <p class="binding-note">{`Choose a provider for ${agent.name}.`}</p>}
      <Capabilities choice={choice} binding={binding} />
      <SectionActions
        dirty={dirty}
        saving={saving}
        problem={problem}
        onCancel={() => {
          setStaged(agent.provider);
          setProblem(null);
        }}
        onSave={save}
      />
      {notice && <FullAccessNotice agentName={agent.name} onClose={() => { setNotice(false); }} />}
    </div>
  );
}
