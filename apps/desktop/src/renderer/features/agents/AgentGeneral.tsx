import type { Agent, UpdateAgentRequest } from '@morrowbot/contracts';
import { useEffect, useState } from 'preact/hooks';
import type { AppearanceModel } from '../../shared/appearance.ts';
import {
  DEFAULT_CUSTOM_BUBBLE_COLOR,
  describeGlobalBubbleColor,
  swatchNameOf,
  type BubbleColorOverride,
} from '../../shared/bubble-color.ts';
import { BubbleColorPicker, BubblePreview } from '../../shared/ui/BubbleColorPicker.tsx';
import { Segmented } from '../../shared/ui/Segmented.tsx';
import { useStore } from '../../shared/use-store.ts';
import type { AgentsModel } from './agents-model.ts';
import type { AvatarEditor } from './NewAgentDialog.tsx';

type AgentColorMode = 'global' | BubbleColorOverride['kind'];

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

/** Agent Settings › General: the full avatar picker, name, description and per-agent message bubble color. */
export function AgentGeneral(props: {
  readonly model: Pick<AgentsModel, 'updateAgent'>;
  readonly appearance: AppearanceModel;
  readonly agent: Agent;
  readonly avatarEditor: AvatarEditor;
  readonly redact: (text: string) => string;
  readonly onDirty: (dirty: boolean) => void;
}) {
  const { agent } = props;
  const appearance = useStore(props.appearance.state);
  const override = appearance.agentMessageColors[agent.id];
  const mode: AgentColorMode = override === undefined ? 'global' : override.kind;
  const [lastCustom, setLastCustom] = useState(
    override?.kind === 'custom' ? override.color : DEFAULT_CUSTOM_BUBBLE_COLOR,
  );
  useEffect(() => {
    if (override?.kind === 'custom') setLastCustom(override.color);
  }, [override]);

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

  const previewCaption = (() => {
    if (override === undefined) return `Using global · ${describeGlobalBubbleColor(appearance.messageColor)}`;
    switch (override.kind) {
      case 'off':
        return 'Off for this agent (neutral)';
      case 'custom':
        return `Custom · ${swatchNameOf(override.color)}`;
    }
  })();

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
      <div class="field agent-message-color">
        <div class="agent-message-color-head">
          <div class="agent-message-color-text">
            <span class="agent-message-color-label">Message color</span>
            <span class="setting-description">Applies immediately to your outgoing bubbles in this agent's chats.</span>
          </div>
          <Segmented<AgentColorMode>
            label="Message color"
            value={mode}
            onChange={(next) => {
              switch (next) {
                case 'global':
                  props.appearance.setAgentMessageColor(agent.id, null);
                  break;
                case 'off':
                  props.appearance.setAgentMessageColor(agent.id, { kind: 'off' });
                  break;
                case 'custom':
                  props.appearance.setAgentMessageColor(agent.id, { kind: 'custom', color: lastCustom });
                  break;
              }
            }}
            options={[
              { value: 'global', label: 'Use global' },
              { value: 'off', label: 'Off' },
              { value: 'custom', label: 'Custom' },
            ]}
          />
        </div>
        {override?.kind === 'custom' && (
          <BubbleColorPicker
            label="Agent message color"
            value={override.color}
            onChange={(color) => {
              setLastCustom(color);
              props.appearance.setAgentMessageColor(agent.id, { kind: 'custom', color });
            }}
          />
        )}
        <BubblePreview
          global={appearance.messageColor}
          {...(override === undefined ? {} : { agentOverride: override })}
          agentColor={avatar.color}
          caption={previewCaption}
        />
      </div>
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
