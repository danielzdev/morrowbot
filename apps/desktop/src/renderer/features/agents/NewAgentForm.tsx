import type { Agent, AgentAvatar, AgentWorkspaceRequest, ProviderBinding } from '@morrowbot/contracts';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { MorrowbotBridge } from '../../bridge.ts';
import { FullAccessNotice } from '../../shared/binding-ui/FullAccessNotice.tsx';
import { newBinding, prefill, type ProviderChoice } from '../../shared/binding-ui/selection.ts';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';
import { Modal } from '../../shared/ui/Modal.tsx';
import type { AgentsModel } from './agents-model.ts';
import { BrainFields } from './BrainFields.tsx';

/** Shows an avatar picker with a preview of `previewSize` px. */
export type AvatarEditor = (value: AgentAvatar, onChange: (next: AgentAvatar) => void, previewSize: number) => ComponentChildren;

/** Where New Agent shows: a dialog over the window, or a page with its own heading, such as first-run setup's last step. */
export type NewAgentLayout =
  | { readonly kind: 'dialog'; readonly onClose: () => void }
  | { readonly kind: 'page'; readonly head: ComponentChildren; readonly onBack: () => void; readonly createLabel: string };

/**
 * New Agent (spec §5.1): one scroll, nothing saved until Create; an agent created with full access
 * says once what that allows before it opens. The Brain starts on the first
 * provider eligible for automatic selection, once one reports in, unless the user picked already.
 * Leaving with something typed asks before discarding it.
 */
export function NewAgentForm(props: {
  readonly layout: NewAgentLayout;
  readonly model: AgentsModel;
  readonly bridge: Pick<MorrowbotBridge, 'pickFolder'>;
  readonly choices: readonly ProviderChoice[];
  /** False for server members (including co-owners), who may not grant full access. */
  readonly allowFull: boolean;
  readonly avatarEditor: AvatarEditor;
  readonly newAvatar: () => AgentAvatar;
  /** A folder path as the UI may show it (spec §9.1). */
  readonly pathLabel: (path: string) => string;
  readonly redact: (text: string) => string;
  readonly onOpenProviders: () => void;
  readonly onCreated: (agent: Agent) => void;
}) {
  const { layout } = props;
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
  const [created, setCreated] = useState<Agent | null>(null);
  const typed = touched || avatar !== initialAvatar || name !== '' || description !== '' || instructions !== '' || workspace.kind === 'shared';
  const leave = (then: () => void) => (): void => {
    if (typed) setLeaving(() => then);
    else then();
  };
  const first = prefill(props.choices);
  useEffect(() => {
    if (!touched && binding.kind === 'unbound' && first !== null) setBinding(newBinding(first, { allowFull: props.allowFull }));
  }, [first?.id, first?.info, props.allowFull]);
  const create = (): void => {
    if (saving || name.trim() === '') return;
    setSaving(true);
    setProblem(null);
    void props.model
      .createAgent({ name, description, workspace, avatar, provider: binding, initialInstructions: workspace.kind === 'dedicated' && instructions !== '' ? instructions : null })
      .then((result) => {
        setSaving(false);
        if (result.kind !== 'saved') setProblem(props.redact(result.message));
        else if (result.value.provider.kind === 'bound' && result.value.provider.access === 'full') setCreated(result.value);
        else props.onCreated(result.value);
      });
  };
  const fields = (
    <>
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
          keepAccess={false}
          allowFull={props.allowFull}
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
              <small>Created automatically in your Ori Bot workspaces folder.</small>
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
        <summary>Add instructions (SOUL.md)</summary>
        {workspace.kind === 'shared' && (
          <p class="binding-note">If this folder already has a SOUL.md, Ori Bot uses it as it is and writes nothing; edit that file in the folder to change it.</p>
        )}
        <textarea
          class="instructions small"
          aria-label="Instructions (SOUL.md)"
          spellcheck={false}
          disabled={workspace.kind === 'shared'}
          value={instructions}
          onInput={(event) => { setInstructions(event.currentTarget.value); }}
        />
      </details>
      {problem !== null && <div class="note error" role="alert">{problem}</div>}
    </>
  );
  const submit = (event: SubmitEvent): void => {
    event.preventDefault();
    create();
  };
  const createButton = (label: string) => (
    <button type="submit" class="btn primary" disabled={saving || name.trim() === ''}>
      {saving ? 'Creating…' : label}
    </button>
  );
  const notice = created === null ? null : <FullAccessNotice agentName={created.name} onClose={() => { props.onCreated(created); }} />;
  const confirm = leaving === null ? null : (
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
  );
  switch (layout.kind) {
    case 'dialog':
      if (notice !== null) return notice;
      return (
        <Modal label="New agent" class="new-agent" onClose={leave(layout.onClose)}>
          <form class="new-agent-form" onSubmit={submit}>
            <h2 class="dialog-title">New agent</h2>
            {fields}
            <div class="dialog-actions">
              <button type="button" class="btn secondary" onClick={leave(layout.onClose)}>Cancel</button>
              {createButton('Create')}
            </div>
          </form>
          {confirm}
        </Modal>
      );
    case 'page':
      return (
        <>
          <form class="new-agent-form inline" onSubmit={submit}>
            {layout.head}
            {fields}
            <div class="page-actions">
              <button type="button" class="btn ghost" onClick={leave(layout.onBack)}>Back</button>
              {createButton(layout.createLabel)}
            </div>
          </form>
          {confirm}
          {notice}
        </>
      );
  }
}
