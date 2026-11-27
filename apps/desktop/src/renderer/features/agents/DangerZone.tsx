import type { Agent } from '@morrowbot/contracts';
import { useState } from 'preact/hooks';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';

/** Agent Settings › Workspace: the privacy-safe path, read-only in v1. */
export function WorkspaceSection(props: { readonly agent: Agent; readonly pathLabel: string; readonly onCopy: () => void; readonly onReveal: () => void }) {
  return (
    <div class="settings-section">
      <p class="path">{props.pathLabel}</p>
      <p class="binding-note">{props.agent.workspace.kind === 'dedicated' ? 'Dedicated: only this agent uses this folder.' : 'Shared: other agents using this folder can see its files.'}</p>
      <div class="row">
        <button type="button" class="btn secondary" onClick={props.onCopy}>Copy</button>
        <button type="button" class="btn secondary" onClick={props.onReveal}>Reveal in Finder</button>
      </div>
    </div>
  );
}

/** Agent Settings › Danger zone: delete the agent after typing its name. */
export function DangerZone(props: { readonly agent: Agent; readonly onDelete: () => void }) {
  const [deleting, setDeleting] = useState(false);
  return (
    <div class="settings-section">
      <p class="binding-note">Deleting an agent deletes its chats. Its workspace folder stays on disk.</p>
      <div class="row">
        <button type="button" class="btn danger" onClick={() => { setDeleting(true); }}>Delete agent…</button>
      </div>
      {deleting && (
        <ConfirmDialog
          title={`Delete ${props.agent.name}?`}
          body={<p>Its chats are deleted. The workspace folder stays on disk.</p>}
          confirmLabel="Delete agent"
          tone="danger"
          typeToConfirm={props.agent.name}
          onCancel={() => { setDeleting(false); }}
          onConfirm={() => {
            setDeleting(false);
            props.onDelete();
          }}
        />
      )}
    </div>
  );
}
