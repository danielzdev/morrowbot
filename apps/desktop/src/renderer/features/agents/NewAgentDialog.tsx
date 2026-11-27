import type { Agent, AgentAvatar, AgentWorkspaceRequest, ProviderBinding } from '@morrowbot/contracts';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { MorrowbotBridge } from '../../bridge.ts';
import { newBinding, prefill, type ProviderChoice } from '../../shared/binding-ui/selection.ts';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';
import { Modal } from '../../shared/ui/Modal.tsx';
import type { AgentsModel } from './agents-model.ts';
import { BrainFields } from './BrainFields.tsx';

/** Shows an avatar picker with a preview of `previewSize` px. */
export type AvatarEditor = (value: AgentAvatar, onChange: (next: AgentAvatar) => void, previewSize: number) => ComponentChildren;

/**
 * New Agent (spec §5.1): one scroll, nothing saved until Create. The Brain starts on the first
 * provider eligible for automatic selection, once one reports in, unless the user picked already.
 */
export function NewAgentDialog(props: {
  readonly model: AgentsModel;
  readonly bridge: Pick<MorrowbotBridge, 'pickFolder'>;
  readonly choices: readonly ProviderChoice[];
  readonly avatarEditor: AvatarEditor;
  readonly newAvatar: () => AgentAvatar;
  /** A folder path as the UI may show it (spec §9.1). */
  readonly pathLabel: (path: string) => string;
  readonly redact: (text: string) => string;
  readonly onOpenProviders: () => void;
  readonly onCreated: (agent: Agent) => void;
  readonly onClose: () => void;
}) {
  const [initialAvatar] = useState(props.newAvatar);
  const [avatar, setAvatar] = useState(initialAvatar);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [binding, setBinding] = useState<ProviderBinding>({ kind: 'unbound' });
  const [touched, setTouched] = useState(false);
  const [workspace, setWorkspace] = useState<AgentWorkspaceRequest>({ kind: 'dedicated' });
  const [instructions, setInstructions] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const typed = touched || avatar !== initialAvatar || name !== '' || description !== '' || instructions !== '' || workspace.kind === 'shared';
  const leave = (then: () => void) => (): void => {
    if (typed) setLeaving(() => then);
    else then();
  };
  const first = prefill(props.choices);
  useEffect(() => {
    if (!touched && binding.kind === 'unbound' && first !== null) setBinding(newBinding(first));
  }, [first?.id, first?.info]);
  const create = (): void => {
    if (saving || name.trim() === '') return;
    setSaving(true);
    setProblem(null);
    void props.model
      .createAgent({ name, description, workspace, avatar, provider: binding, initialInstructions: workspace.kind === 'dedicated' && instructions !== '' ? instructions : null })
      .then((result) => {
        setSaving(false);
        if (result.kind === 'saved') props.onCreated(result.value);
        else setProblem(props.redact(result.message));
      });
  };
  return (
    <Modal label="New agent" class="new-agent" onClose={leave(props.onClose)}>
      <form
        class="new-agent-form"
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <h2 class="dialog-title">New agent</h2>
        <section class="form-section" aria-label="Look">
          {props.avatarEditor(avatar, setAvatar, 84)}
        </section>
        <section class="form-section" aria-label="Name and description">
          <label class="field">
            <span>Name</span>
            <input data-autofocus required placeholder="Errand Bot" value={name} onInput={(event) => { setName(event.currentTarget.value); }} />
          </label>
          <label class="field">
            <span>Description</span>
            <input placeholder="Optional, one line" value={description} onInput={(event) => { setDescription(event.currentTarget.value); }} />
          </label>
        </section>
        <section class="form-section" aria-labelledby="new-agent-brain">
          <h3 id="new-agent-brain" class="section-title">Brain</h3>
          <BrainFields
            choices={props.choices}
            value={binding}
            redact={props.redact}
            onOpenProviders={leave(props.onOpenProviders)}
            onChange={(next) => {
              setTouched(true);
              setBinding(next);
            }}
          />
          {binding.kind === 'unbound' && (
            <div class="note row">
              <span>This agent will start without a provider. Choose one later in Brain.</span>
              <button type="button" class="btn secondary" onClick={leave(props.onOpenProviders)}>Open Providers</button>
            </div>
          )}
        </section>
        <section class="form-section" aria-labelledby="new-agent-workspace">
          <h3 id="new-agent-workspace" class="section-title">Workspace</h3>
          <div role="radiogroup" aria-label="Workspace" class="choice-list">
            <label class="choice">
              <input type="radio" name="workspace" checked={workspace.kind === 'dedicated'} onChange={() => { setWorkspace({ kind: 'dedicated' }); }} />
              <span>
                New folder for this agent
                <small>Created automatically in your MorrowBot workspaces folder.</small>
              </span>
            </label>
            <label class="choice">
              <input
                type="radio"
                name="workspace"
                checked={workspace.kind === 'shared'}
                onChange={() =>
                  void props.bridge.pickFolder().then((dir) => {
                    if (dir !== null) setWorkspace({ kind: 'shared', dir });
                  })
                }
              />
              <span>
                Use an existing folder…
                {workspace.kind === 'shared' && <small class="path">{props.pathLabel(workspace.dir)}</small>}
              </span>
            </label>
          </div>
          {workspace.kind === 'shared' && <p class="binding-note warn">Other agents using this folder can see its files.</p>}
        </section>
        <details class="form-section instructions-disclosure">
          <summary>Add instructions (AGENTS.md)</summary>
          {workspace.kind === 'shared' && (
            <p class="binding-note">If this folder already has an AGENTS.md, MorrowBot keeps it; edit instructions after creating.</p>
          )}
          <textarea
            class="instructions small"
            aria-label="Instructions (AGENTS.md)"
            spellcheck={false}
            disabled={workspace.kind === 'shared'}
            value={instructions}
            onInput={(event) => { setInstructions(event.currentTarget.value); }}
          />
        </details>
        {problem !== null && <div class="note error" role="alert">{problem}</div>}
        <div class="dialog-actions">
          <button type="button" class="btn secondary" onClick={leave(props.onClose)}>Cancel</button>
          <button type="submit" class="btn primary" disabled={saving || name.trim() === ''}>
            {saving ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
      {leaving !== null && (
        <ConfirmDialog
          title="Discard this new agent?"
          body={<p>What you entered will be lost.</p>}
          confirmLabel="Discard"
          tone="danger"
          onCancel={() => { setLeaving(null); }}
          onConfirm={() => {
            setLeaving(null);
            leaving();
          }}
        />
      )}
    </Modal>
  );
}
