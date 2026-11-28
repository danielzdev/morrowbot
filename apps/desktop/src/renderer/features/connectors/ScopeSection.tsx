import type { Agent, Connector, ConnectorScope } from '@morrowbot/contracts';
import { useEffect, useState } from 'preact/hooks';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';
import { DetailSection } from '../../shared/ui/ListDetail.tsx';
import { CONFLICT_LINE, NO_ROUTE_LINE, REVIEW_LINE } from './connector-copy.ts';
import type { ConnectorsModel } from './connectors-model.ts';
import { choiceOf, requestOf, sameChoice, type ScopeChoice } from './scope-choice.ts';
import { SavedScope, ScopePicker, type AgentAvatarSlot } from './ScopePicker.tsx';

interface Draft {
  /** The revision the edit started from, which Save writes with. */
  readonly revision: number;
  readonly choice: ScopeChoice;
}

type Outcome = { readonly kind: 'conflict'; readonly current: ConnectorScope } | { readonly kind: 'refused'; readonly message: string } | null;

/**
 * Detail › Available to (spec IA §4): the scope editor with its own Save and Cancel, or the paused
 * view while the saved scope needs review, or the no-route view when calls can't reach the connector.
 */
export function ScopeSection(props: {
  readonly model: ConnectorsModel;
  readonly connector: Connector;
  readonly agents: readonly Agent[];
  readonly avatar: AgentAvatarSlot;
  readonly busy: boolean;
  readonly redact: (text: string) => string;
  readonly onRemove: () => void;
  readonly onDirty: (dirty: boolean) => void;
}) {
  const { model, connector } = props;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [saving, setSaving] = useState(false);
  const [allowing, setAllowing] = useState(false);
  const saved = choiceOf(connector.scope);
  const choice = draft?.choice ?? saved;
  const reviewing = connector.status.kind === 'unsupported' || connector.scope.scopeReviewRequired;
  const conflict = outcome?.kind === 'conflict' ? outcome.current : null;
  const dirty = !reviewing && draft !== null && (conflict !== null || !sameChoice(draft.choice, saved));
  const { onDirty } = props;
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => () => {
    onDirty(false);
  }, [onDirty]);

  const save = (next: ScopeChoice, revision: number): void => {
    setSaving(true);
    setOutcome(null);
    void model.setScope(connector.id, { ...requestOf(next), revision }).then((result) => {
      setSaving(false);
      if (result.kind === 'saved') setDraft(null);
      else setOutcome(result);
    });
  };
  /** Drops the draft; after a conflict, shows the newer scope the host reported. */
  const reset = (): void => {
    if (conflict !== null) model.adoptScope(connector.id, conflict);
    setDraft(null);
    setOutcome(null);
  };

  const problems = (
    <>
      {conflict !== null && (
        <div class="row" role="alert">
          <span class="note warn">{CONFLICT_LINE}</span>
          <button type="button" class="btn secondary" onClick={reset}>Reload</button>
        </div>
      )}
      {outcome?.kind === 'refused' && <p class="note error" role="alert">{props.redact(outcome.message)}</p>}
    </>
  );
  const turnOff = connector.enabled && (
    <button type="button" class="btn secondary" disabled={props.busy} onClick={() => void model.setEnabled(connector.id, false)}>
      Turn off
    </button>
  );

  if (connector.status.kind === 'unsupported') {
    return (
      <DetailSection title="Available to">
        <p>{NO_ROUTE_LINE}</p>
        <SavedScope choice={saved} agents={props.agents} avatar={props.avatar} />
        <div class="row">
          {turnOff}
          <button type="button" class="btn ghost" disabled={props.busy} onClick={props.onRemove}>Remove</button>
        </div>
      </DetailSection>
    );
  }
  if (connector.scope.scopeReviewRequired) {
    const { revision } = connector.scope;
    return (
      <DetailSection title="Available to">
        <p class="note warn">{REVIEW_LINE}</p>
        <SavedScope choice={saved} agents={props.agents} avatar={props.avatar} />
        {problems}
        <div class="row">
          <button type="button" class="btn secondary" disabled={saving || conflict !== null} onClick={() => { setAllowing(true); }}>Allow all agents…</button>
          {saved.mode === 'selected' && (
            <button type="button" class="btn secondary" disabled={saving || conflict !== null} onClick={() => { save(saved, revision); }}>Restore selected agents</button>
          )}
          {turnOff}
        </div>
        {allowing && (
          <ConfirmDialog
            title="Allow all agents?"
            body={<p>{connector.label} will be available to all agents, including ones you create later.</p>}
            confirmLabel="Allow all agents"
            tone="primary"
            onCancel={() => { setAllowing(false); }}
            onConfirm={() => {
              setAllowing(false);
              save({ mode: 'all', agentIds: [] }, revision);
            }}
          />
        )}
      </DetailSection>
    );
  }
  const savedSelected = saved.mode === 'selected' ? saved.agentIds.length : 0;
  return (
    <DetailSection title="Available to">
      <ScopePicker
        choice={choice}
        agents={props.agents}
        avatar={props.avatar}
        disabled={saving || conflict !== null}
        onChange={(next) => {
          const revision = draft?.revision ?? connector.scope.revision;
          setDraft(sameChoice(next, saved) ? null : { revision, choice: next });
        }}
      />
      {connector.enabled && choice.mode === 'selected' && choice.agentIds.length === 0 && <p class="binding-note">On, but no agents can use it yet.</p>}
      {!dirty && savedSelected >= 2 && <p class="binding-note">Used by {savedSelected} agents</p>}
      {problems}
      {dirty && (
        <div class="form-actions">
          <button type="button" class="btn secondary" disabled={saving} onClick={reset}>Cancel</button>
          <button type="button" class="btn primary" disabled={saving || conflict !== null} onClick={() => { save(draft.choice, draft.revision); }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </DetailSection>
  );
}
