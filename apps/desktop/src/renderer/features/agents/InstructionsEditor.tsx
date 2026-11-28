import type { ProviderBinding } from '@morrowbot/contracts';
import { useEffect, useMemo } from 'preact/hooks';
import { useStore } from '../../shared/use-store.ts';
import type { AgentsModel } from './agents-model.ts';
import { isDirty, saveModeOf, type SaveOutcome } from './instructions-editor.ts';

function Outcome(props: { readonly outcome: SaveOutcome; readonly disk: boolean; readonly redact: (text: string) => string; readonly onUseDisk: () => void; readonly onCopy: () => void; readonly onRetry: () => void; readonly onReveal: (revealId: string) => void }) {
  const { outcome } = props;
  switch (outcome.kind) {
    case 'created':
      return <p class="note ok" role="status">SOUL.md saved.</p>;
    case 'copied':
      return (
        <div class="note row" role="status">
          <span>SOUL.md wasn't changed. Your version is saved as a copy.</span>
          <button type="button" class="btn secondary" onClick={() => { props.onReveal(outcome.revealId); }}>Reveal</button>
        </div>
      );
    case 'conflict':
      return (
        <div class="conflict" role="alert">
          <p class="binding-note warn">This file changed on disk.</p>
          <div class="conflict-panes">
            <pre class="instructions disk" aria-label="Disk version">
              {outcome.current.content ?? (outcome.current.revision === null ? 'SOUL.md was removed from disk.' : props.redact(outcome.current.readError ?? 'SOUL.md could not be read.'))}
            </pre>
          </div>
          <div class="row">
            {props.disk && <button type="button" class="btn secondary" onClick={props.onUseDisk}>Use disk version</button>}
            <button type="button" class="btn primary" onClick={props.onCopy}>Save mine as a copy</button>
          </div>
        </div>
      );
    case 'failed':
      return (
        <div class="note error row" role="alert">
          <span>{`Couldn't save SOUL.md: ${props.redact(outcome.message)}`}</span>
          <button type="button" class="btn secondary" onClick={props.onRetry}>Try again</button>
        </div>
      );
  }
}

/**
 * Agent Settings › Instructions (spec §5.2, H8 v1): a missing SOUL.md is created; an existing one is
 * never replaced, so Save becomes Save a copy. A conflict keeps the draft beside the disk version.
 */
export function InstructionsEditor(props: {
  readonly model: AgentsModel;
  readonly agentId: string;
  readonly provider: ProviderBinding;
  readonly providerName: string | null;
  readonly redact: (text: string) => string;
  readonly onReveal: (revealId: string) => void;
  readonly onDirty: (dirty: boolean) => void;
}) {
  const editor = useMemo(() => props.model.instructionsEditor(props.agentId), [props.agentId]);
  const state = useStore(editor.state);
  useEffect(() => {
    void editor.load();
  }, [editor]);
  const dirty = isDirty(state);
  useEffect(() => {
    props.onDirty(dirty);
  }, [dirty]);
  if (state.kind === 'loading') return <p class="muted">Loading SOUL.md…</p>;
  if (state.kind === 'load-failed') return <p class="note error">{props.redact(state.message)}</p>;
  const mode = saveModeOf(state.loaded);
  const unreadable = state.loaded.revision !== null && state.loaded.content === null;
  const save = (): void => void editor.save();
  return (
    <div class="settings-section instructions-section">
      {unreadable && (
        <p class="note warn" role="alert">{`SOUL.md could not be read. ${props.redact(state.loaded.readError ?? '')}`.trim()}</p>
      )}
      <label class="field grow">
        <span>
          SOUL.md {dirty && <span class="dot accent" aria-label="Unsaved changes" />}
        </span>
        <textarea
          class="instructions"
          aria-label="SOUL.md"
          spellcheck={false}
          value={state.draft}
          onInput={(event) => { editor.setDraft(event.currentTarget.value); }}
          onKeyDown={(event) => {
            if (event.key === 's' && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
              event.preventDefault();
              if (dirty) save();
            }
          }}
        />
      </label>
      {state.outcome !== null && (
        <Outcome
          outcome={state.outcome}
          disk={state.outcome.kind === 'conflict' && state.outcome.current.content !== null}
          redact={props.redact}
          onUseDisk={() => { editor.useDisk(); }}
          onCopy={() => void editor.saveCopy()}
          onRetry={state.outcome.kind === 'failed' && state.outcome.conflict !== null ? () => void editor.saveCopy() : save}
          onReveal={props.onReveal}
        />
      )}
      {state.outcome?.kind !== 'conflict' && (
        <div class="row section-actions">
          {mode === 'copy' && <span class="binding-note">Editing this file in place isn't available yet.</span>}
          <button type="button" class="btn primary" disabled={!dirty || state.saving} onClick={save}>
            {state.saving ? 'Saving…' : mode === 'create' ? 'Save' : 'Save a copy'}
          </button>
        </div>
      )}
      {props.provider.kind === 'bound' && (
        <p class="binding-note">
          {props.provider.vendorSettings === 'isolated'
            ? "Ori Kami sends this file as the agent's instructions."
            : `${props.providerName ?? 'This provider'} also loads your personal CLI instructions.`}
        </p>
      )}
      <p class="binding-note">This applies to all this agent's chats. A chat may ask to start a new session on its next send.</p>
    </div>
  );
}
