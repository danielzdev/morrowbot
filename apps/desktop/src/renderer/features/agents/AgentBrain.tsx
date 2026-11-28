import type { Agent, ProviderBinding } from '@morrowbot/contracts';
import { useEffect, useRef, useState } from 'preact/hooks';
import { changeCheck, confirmLabel, needsConfirm } from '../../shared/binding-ui/binding-state.ts';
import { readyInfo, type ProviderChoice } from '../../shared/binding-ui/selection.ts';
import { Icon } from '../../shared/ui/Icon.tsx';
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
 * Agent Settings › Brain (spec §5.2): provider, model, effort and access, staged until Save. Save
 * asks first when the provider changes or the access adds a warning. Refresh never changes the
 * saved binding; when it is no longer available, the fields say why.
 */
export function AgentBrain(props: {
  readonly model: AgentsModel;
  readonly agent: Agent;
  readonly choices: readonly ProviderChoice[];
  readonly redact: (text: string) => string;
  readonly onOpenProviders: () => void;
  readonly onDirty: (dirty: boolean) => void;
}) {
  const { agent } = props;
  const [binding, setBinding] = useState<ProviderBinding>(agent.provider);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const dirty = JSON.stringify(binding) !== JSON.stringify(agent.provider);
  useEffect(() => {
    props.onDirty(dirty);
  }, [dirty]);
  const root = useRef<HTMLDivElement>(null);
  const asked = useRef(false);
  useEffect(() => {
    const at = (selector: string): HTMLElement | null => root.current?.querySelector<HTMLElement>(selector) ?? null;
    if (confirming) at('.confirm-strip [data-autofocus]')?.focus();
    else if (asked.current) (at('.section-actions .btn.primary:not(:disabled)') ?? at('.brain-fields [tabindex="0"]'))?.focus();
    asked.current = confirming;
  }, [confirming]);
  const check = changeCheck(props.choices, agent.provider, binding);
  const { switched, added } = check;
  const save = (): void => {
    setConfirming(false);
    setSaving(true);
    void props.model.updateAgent(agent.id, { provider: binding }).then((result) => {
      setSaving(false);
      setProblem(result.kind === 'refused' ? props.redact(result.message) : null);
    });
  };
  const choice = binding.kind === 'bound' ? props.choices.find(({ id }) => id === binding.pluginId) : undefined;
  return (
    <div ref={root} class="settings-section">
      <BrainFields
        choices={props.choices}
        value={binding}
        showAccess={true}
        redact={props.redact}
        onOpenProviders={props.onOpenProviders}
        onChange={(next) => {
          setConfirming(false);
          setBinding(next);
        }}
      />
      {binding.kind === 'unbound' && <p class="binding-note">{`Choose a provider for ${agent.name}.`}</p>}
      <Capabilities choice={choice} binding={binding} />
      {confirming ? (
        <div class="confirm-strip" role="alert">
          {switched && (
            <p>{`Switch ${agent.name} to ${choice?.name ?? 'this provider'}? This applies to all this agent's chats. A chat may ask to start a new session on its next send.`}</p>
          )}
          {added.map((warning) => (
            <p key={warning} class="binding-note warn"><Icon name="warning" /> {warning}</p>
          ))}
          <div class="row">
            <button type="button" class="btn primary" data-autofocus onClick={save}>{confirmLabel(check, agent.provider, binding)}</button>
            <button type="button" class="btn secondary" onClick={() => { setConfirming(false); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <SectionActions
          dirty={dirty}
          saving={saving}
          problem={problem}
          onCancel={() => {
            setBinding(agent.provider);
            setProblem(null);
          }}
          onSave={() => {
            if (needsConfirm(check)) setConfirming(true);
            else save();
          }}
        />
      )}
    </div>
  );
}
