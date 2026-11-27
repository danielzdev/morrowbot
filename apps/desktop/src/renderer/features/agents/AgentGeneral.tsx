import type { Agent, UpdateAgentRequest } from '@morrowbot/contracts';
import { useEffect, useState } from 'preact/hooks';
import type { AgentsModel } from './agents-model.ts';
import type { AvatarEditor } from './NewAgentDialog.tsx';

/** Save / Cancel for a staged section, with the reason the last save was refused. */
export function SectionActions(props: {
  readonly dirty: boolean;
  /** False when the staged values can't be saved as they are; Cancel still works. */
  readonly valid?: boolean;
  readonly saving: boolean;
  readonly problem: string | null;
  readonly saveLabel?: string;
  readonly onSave: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <div class="section-actions">
      {props.problem !== null && <p class="note error" role="alert">{props.problem}</p>}
      <div class="row">
        <button type="button" class="btn secondary" disabled={!props.dirty || props.saving} onClick={props.onCancel}>Cancel</button>
        <button type="button" class="btn primary" disabled={!props.dirty || props.valid === false || props.saving} onClick={props.onSave}>
          {props.saving ? 'Saving…' : (props.saveLabel ?? 'Save')}
        </button>
      </div>
    </div>
  );
}

/** Agent Settings › General: the full avatar picker, name and description, saved together. */
export function AgentGeneral(props: {
  readonly model: AgentsModel;
  readonly agent: Agent;
  readonly avatarEditor: AvatarEditor;
  readonly redact: (text: string) => string;
  readonly onDirty: (dirty: boolean) => void;
}) {
  const { agent } = props;
  const [avatar, setAvatar] = useState(agent.avatar);
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const changes: UpdateAgentRequest = {
    ...(JSON.stringify(avatar) === JSON.stringify(agent.avatar) ? {} : { avatar }),
    ...(name.trim() === agent.name ? {} : { name }),
    ...(description === agent.description ? {} : { description }),
  };
  const dirty = Object.keys(changes).length > 0;
  useEffect(() => {
    props.onDirty(dirty);
  }, [dirty]);
  return (
    <div class="settings-section">
      {props.avatarEditor(avatar, setAvatar, 96)}
      <label class="field">
        <span>Name</span>
        <input required value={name} onInput={(event) => { setName(event.currentTarget.value); }} />
      </label>
      <label class="field">
        <span>Description</span>
        <input value={description} onInput={(event) => { setDescription(event.currentTarget.value); }} />
      </label>
      <SectionActions
        dirty={dirty}
        valid={name.trim() !== ''}
        saving={saving}
        problem={problem}
        onCancel={() => {
          setAvatar(agent.avatar);
          setName(agent.name);
          setDescription(agent.description);
          setProblem(null);
        }}
        onSave={() => {
          setSaving(true);
          void props.model.updateAgent(agent.id, changes).then((result) => {
            setSaving(false);
            setProblem(result.kind === 'refused' ? props.redact(result.message) : null);
          });
        }}
      />
    </div>
  );
}
