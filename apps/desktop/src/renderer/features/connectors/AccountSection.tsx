import { MAX_CONNECTOR_LABEL, type Agent, type Connector } from '@morrowbot/contracts';
import { useEffect, useState } from 'preact/hooks';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';
import { DetailSection } from '../../shared/ui/ListDetail.tsx';
import { connectionActions, labelProblemOf, usedBy } from './connector-copy.ts';
import type { ConnectorsModel, ConnectorWork, Refusal } from './connectors-model.ts';
import { draftOf, setupEditOf, type SetupDraft } from './setup-draft.ts';
import { SetupFields } from './SetupFields.tsx';

interface Draft {
  readonly label: string;
  readonly setup: SetupDraft;
}

/**
 * Detail › Account (spec IA §4): the label and what the connector reaches, saved together with their
 * own Save and Cancel, then Connect, Reconnect and Disconnect.
 */
export function AccountSection(props: {
  readonly model: ConnectorsModel;
  readonly connector: Connector;
  readonly agents: readonly Agent[];
  readonly work: ConnectorWork | undefined;
  readonly redact: (text: string) => string;
  readonly onDirty: (dirty: boolean) => void;
}) {
  const { model, connector } = props;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [refused, setRefused] = useState<Refusal | null>(null);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const saved: Draft = { label: connector.label, setup: draftOf(connector.setup) };
  const shown = draft ?? saved;
  const dirty = draft !== null;
  const { onDirty } = props;
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => () => {
    onDirty(false);
  }, [onDirty]);

  const setup = setupEditOf(shown.setup);
  const labelProblem = labelProblemOf(shown.label) ?? (refused?.field === 'label' ? refused.message : null);
  const ready = shown.label.trim() !== '' && labelProblemOf(shown.label) === null && setup.kind === 'ready';
  const edit = (change: Partial<Draft>): void => {
    const next = { ...shown, ...change };
    setDraft(JSON.stringify(next) === JSON.stringify(saved) ? null : next);
    setRefused(null);
  };
  const cancel = (): void => {
    setDraft(null);
    setRefused(null);
  };
  const actions = connectionActions(connector);
  const busy = props.work !== undefined || saving;

  return (
    <DetailSection title="Account">
      <form
        class="connector-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!dirty || !ready || busy) return;
          setSaving(true);
          setRefused(null);
          void model.updateAccount(connector.id, { label: shown.label, setup: setup.value }).then((result) => {
            setSaving(false);
            if (result.kind === 'saved') setDraft(null);
            else setRefused(result);
          });
        }}
      >
        <label class="field">
          <span>Label</span>
          <input
            type="text"
            maxLength={MAX_CONNECTOR_LABEL}
            autocomplete="off"
            aria-invalid={labelProblem !== null}
            value={shown.label}
            onInput={(event) => { edit({ label: event.currentTarget.value }); }}
          />
          {labelProblem !== null && <small class="note error" role="alert">{props.redact(labelProblem)}</small>}
        </label>
        <SetupFields draft={shown.setup} onChange={(next) => { edit({ setup: next }); }} />
        {dirty && setup.kind === 'invalid' && setup.reason !== null && <p class="note warn">{setup.reason}</p>}
        {refused?.field === 'form' && <p class="note error" role="alert">{props.redact(refused.message)}</p>}
        {dirty && (
          <div class="form-actions">
            <button type="button" class="btn secondary" disabled={saving} onClick={cancel}>Cancel</button>
            <button type="submit" class="btn primary" disabled={!ready || busy}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        )}
      </form>
      {(actions.connect !== null || actions.disconnect) && (
        <div class="row connection-actions">
          {actions.connect !== null && (
            <button type="button" class="btn secondary" disabled={busy || dirty} onClick={() => void model.connect(connector.id)}>
              {props.work === 'connecting' ? 'Connecting…' : actions.connect}
            </button>
          )}
          {actions.disconnect && (
            <button type="button" class="btn ghost" disabled={busy} onClick={() => { setDisconnecting(true); }}>
              {props.work === 'disconnecting' ? 'Disconnecting…' : 'Disconnect'}
            </button>
          )}
        </div>
      )}
      {disconnecting && (
        <ConfirmDialog
          title={`Disconnect ${connector.label}?`}
          body={
            <>
              <p>{usedBy(connector.scope, props.agents)}</p>
              <p>Its tools stop working until you reconnect. Its setup and scope are kept.</p>
            </>
          }
          confirmLabel="Disconnect"
          tone="danger"
          onCancel={() => { setDisconnecting(false); }}
          onConfirm={() => {
            setDisconnecting(false);
            void model.disconnect(connector.id);
          }}
        />
      )}
    </DetailSection>
  );
}
