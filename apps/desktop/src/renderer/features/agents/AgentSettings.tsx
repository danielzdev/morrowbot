import type { Agent, AgentAvatar, AgentWorkspaceRequest, ProviderBinding } from '@morrowbot/contracts';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { MorrowbotBridge } from '../../bridge.ts';
import type { AgentsModel } from './agents-model.ts';

/** A provider plugin the user can bind an agent to. */
export interface ProviderOption {
  readonly id: string;
  readonly name: string;
}

/** Shows an avatar and lets the user change it. */
export type AvatarEditor = (value: AgentAvatar, onChange: (next: AgentAvatar) => void) => ComponentChildren;

const NONE = '';

function ProviderSelect(props: { readonly providers: readonly ProviderOption[]; readonly value: string; readonly onChange: (pluginId: string) => void }) {
  return (
    <select aria-label="Provider" value={props.value} onChange={(event) => { props.onChange(event.currentTarget.value); }}>
      <option value={NONE}>No provider</option>
      {props.providers.map((provider) => (
        <option key={provider.id} value={provider.id}>
          {provider.name}
        </option>
      ))}
    </select>
  );
}

/** Creates an agent: a name, its avatar, its workspace folder and its provider. */
export function NewAgent(props: {
  readonly model: AgentsModel;
  readonly bridge: Pick<MorrowbotBridge, 'pickFolder'>;
  readonly providers: readonly ProviderOption[];
  readonly bindingFor: (pluginId: string) => ProviderBinding;
  readonly avatarEditor: AvatarEditor;
  /** The avatar the form starts with. */
  readonly initialAvatar: AgentAvatar;
  readonly onCreated: (agent: Agent) => void;
}) {
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(props.initialAvatar);
  const [description, setDescription] = useState('');
  const [workspace, setWorkspace] = useState<AgentWorkspaceRequest>({ kind: 'dedicated' });
  const [pluginId, setPluginId] = useState(props.providers[0]?.id ?? NONE);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <form
      class="page form"
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        void props.model
          .createAgent({
            name,
            description,
            workspace,
            avatar,
            provider: pluginId === NONE ? { kind: 'unbound' } : props.bindingFor(pluginId),
          })
          .then((result) => {
            setSaving(false);
            if (result.kind === 'saved') props.onCreated(result.value);
            else setProblem(result.message);
          });
      }}
    >
      <h2>New agent</h2>
      <div class="field">
        <span>Avatar</span>
        {props.avatarEditor(avatar, setAvatar)}
      </div>
      <label class="field">
        <span>Name</span>
        <input required value={name} onInput={(event) => { setName(event.currentTarget.value); }} />
      </label>
      <label class="field">
        <span>Description</span>
        <input value={description} onInput={(event) => { setDescription(event.currentTarget.value); }} />
      </label>
      <div class="field">
        <span>Workspace folder</span>
        <div class="row">
          <span class="path">{workspace.kind === 'dedicated' ? 'A new folder for this agent' : workspace.dir}</span>
          <button
            type="button"
            class="secondary"
            onClick={() =>
              void props.bridge.pickFolder().then((dir) => {
                if (dir !== null) setWorkspace({ kind: 'shared', dir });
              })
            }
          >
            Choose folder…
          </button>
          {workspace.kind === 'shared' && (
            <button type="button" class="ghost" onClick={() => { setWorkspace({ kind: 'dedicated' }); }}>
              Use a new folder
            </button>
          )}
        </div>
      </div>
      <label class="field">
        <span>Provider</span>
        <ProviderSelect providers={props.providers} value={pluginId} onChange={setPluginId} />
      </label>
      {problem !== null && <div class="note error">{problem}</div>}
      <div class="row">
        <button class="primary" type="submit" disabled={saving || name.trim() === ''}>
          Create agent
        </button>
      </div>
    </form>
  );
}

function Instructions(props: { readonly model: AgentsModel; readonly agentId: string }) {
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setSaved(null);
    void props.model.instructions(props.agentId).then((result) => {
      if (result.kind === 'saved') {
        setSaved(result.value);
        setDraft(result.value);
      } else setProblem(result.message);
    });
  }, [props.agentId]);
  if (saved === null) return problem === null ? <p class="muted">Loading AGENTS.md…</p> : <div class="note error">{problem}</div>;
  return (
    <div class="field">
      <span>Instructions (AGENTS.md)</span>
      <textarea class="instructions" aria-label="AGENTS.md" spellcheck={false} value={draft} onInput={(event) => { setDraft(event.currentTarget.value); }} />
      {problem !== null && <div class="note error">{problem}</div>}
      <div class="row">
        <button
          class="secondary"
          disabled={draft === saved}
          onClick={() =>
            void props.model.saveInstructions(props.agentId, draft).then((result) => {
              if (result.kind === 'saved') {
                setSaved(result.value);
                setProblem(null);
              } else setProblem(result.message);
            })
          }
        >
          Save instructions
        </button>
      </div>
    </div>
  );
}

/** Edits an agent: name, description, avatar, provider, and its AGENTS.md. */
export function AgentSettings(props: {
  readonly model: AgentsModel;
  readonly agent: Agent;
  readonly providers: readonly ProviderOption[];
  readonly bindingFor: (pluginId: string) => ProviderBinding;
  readonly avatarEditor: AvatarEditor;
  readonly onDeleted: () => void;
}) {
  const { agent, model } = props;
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description);
  const [avatar, setAvatar] = useState(agent.avatar);
  const [problem, setProblem] = useState<string | null>(null);
  /** Saves go one at a time, in order, so the last choice is the one that stays. */
  const saves = useRef<Promise<void>>(Promise.resolve());
  const update = (request: Parameters<AgentsModel['updateAgent']>[1]): void => {
    const save = (): Promise<void> =>
      model.updateAgent(agent.id, request).then((result) => {
        setProblem(result.kind === 'refused' ? result.message : null);
      });
    saves.current = saves.current.then(save, save);
  };
  return (
    <div class="page form">
      <h2>{agent.name}</h2>
      <div class="field">
        <span>Avatar</span>
        {props.avatarEditor(avatar, (next) => {
          setAvatar(next);
          update({ avatar: next });
        })}
      </div>
      <label class="field">
        <span>Name</span>
        <input
          value={name}
          onInput={(event) => {
            setName(event.currentTarget.value);
          }}
          onBlur={() => {
            if (name.trim() !== agent.name) update({ name });
          }}
        />
      </label>
      <label class="field">
        <span>Description</span>
        <input
          value={description}
          onInput={(event) => { setDescription(event.currentTarget.value); }}
          onBlur={() => {
            if (description !== agent.description) update({ description });
          }}
        />
      </label>
      <div class="field">
        <span>Workspace folder ({agent.workspace.kind === 'dedicated' ? 'this agent only' : 'shared'})</span>
        <span class="path">{agent.workspace.dir}</span>
      </div>
      <label class="field">
        <span>Provider</span>
        <ProviderSelect
          providers={props.providers}
          value={agent.provider.kind === 'bound' ? agent.provider.pluginId : NONE}
          onChange={(pluginId) => { update({ provider: pluginId === NONE ? { kind: 'unbound' } : props.bindingFor(pluginId) }); }}
        />
      </label>
      {problem !== null && <div class="note error">{problem}</div>}
      <Instructions model={model} agentId={agent.id} />
      <div class="danger-zone">
        <button
          class="danger"
          onClick={() => {
            if (!window.confirm(`Delete ${agent.name} and all of its chats? Its workspace folder stays on disk.`)) return;
            void model.deleteAgent(agent.id).then(props.onDeleted);
          }}
        >
          Delete agent
        </button>
      </div>
    </div>
  );
}
