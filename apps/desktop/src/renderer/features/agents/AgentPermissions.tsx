import type { Agent } from '@morrowbot/contracts';
import { useEffect, useState } from 'preact/hooks';
import { AccessSegment } from '../../shared/binding-ui/AccessSegment.tsx';
import { accessState, sameAccess, turnsOnFull, unrunnableReason, type AccessKey, type AccessState } from '../../shared/binding-ui/binding-state.ts';
import { FullAccessNotice } from '../../shared/binding-ui/FullAccessNotice.tsx';
import { isRunnable, type ProviderChoice } from '../../shared/binding-ui/selection.ts';
import { SectionActions } from './AgentGeneral.tsx';
import type { AgentsModel } from './agents-model.ts';

/** Full access is the owner's to give: a member sees it only while it is already this agent's. */
function offeredTo(state: AccessState | null, saved: AccessKey, allowFull: boolean): AccessState | null {
  if (state === null || allowFull) return state;
  return { ...state, offered: state.offered.filter((profile) => profile.access !== 'full' || sameAccess(profile, saved)) };
}

/**
 * Agent Settings › Permissions: what the agent may do with its provider (read only, edit the
 * workspace, full access), staged until Save. Turning full access on says once what it allows.
 */
export function AgentPermissions(props: {
  readonly model: Pick<AgentsModel, 'updateAgent'>;
  readonly agent: Agent;
  readonly choices: readonly ProviderChoice[];
  /** False for server members (including co-owners), who may not grant full access. */
  readonly allowFull: boolean;
  readonly redact: (text: string) => string;
  readonly onOpenProviders: () => void;
  readonly onDirty: (dirty: boolean) => void;
}) {
  const { agent } = props;
  const saved = agent.provider;
  const [staged, setStaged] = useState<AccessKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState(false);
  const pluginId = saved.kind === 'bound' ? saved.pluginId : null;
  useEffect(() => {
    setStaged(null);
  }, [pluginId]);
  const dirty = saved.kind === 'bound' && staged !== null && !sameAccess(staged, saved);
  useEffect(() => {
    props.onDirty(dirty);
  }, [dirty]);
  if (saved.kind === 'unbound') {
    return (
      <div class="settings-section">
        <p class="binding-note">{`Choose a provider for ${agent.name} in Brain first: what it may do depends on the provider.`}</p>
      </div>
    );
  }
  const choice = props.choices.find(({ id }) => id === saved.pluginId);
  const value = staged ?? saved;
  const save = (): void => {
    if (staged === null) return;
    const next = { ...saved, access: staged.access, vendorSettings: staged.vendorSettings };
    setSaving(true);
    void props.model.updateAgent(agent.id, { provider: next }).then((result) => {
      setSaving(false);
      if (result.kind === 'refused') {
        setProblem(props.redact(result.message));
        return;
      }
      setProblem(null);
      setStaged(null);
      if (turnsOnFull(saved, next)) setNotice(true);
    });
  };
  return (
    <div class="settings-section">
      {choice === undefined || !isRunnable(choice) ? (
        <div class="row">
          <span class="binding-note warn">{unrunnableReason(choice, saved, props.redact)}</span>
          <button type="button" class="btn secondary" onClick={props.onOpenProviders}>Open Providers</button>
        </div>
      ) : (
        <AccessSegment
          state={offeredTo(accessState(choice.info, value), saved, props.allowFull)}
          value={value}
          disabled={saving}
          redact={props.redact}
          onPick={(profile) => {
            setStaged({ access: profile.access, vendorSettings: profile.vendorSettings });
          }}
        />
      )}
      {!props.allowFull && <p class="binding-note">Only the server's owner can give an agent full access (shell commands).</p>}
      <SectionActions
        dirty={dirty}
        saving={saving}
        problem={problem}
        onCancel={() => {
          setStaged(null);
          setProblem(null);
        }}
        onSave={save}
      />
      {notice && <FullAccessNotice agentName={agent.name} onClose={() => { setNotice(false); }} />}
    </div>
  );
}
