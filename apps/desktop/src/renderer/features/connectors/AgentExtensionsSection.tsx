import type { Agent } from '@morrowbot/contracts';
import { useEffect, useState } from 'preact/hooks';
import { ItemMark } from '../../shared/ui/ItemMark.tsx';
import { Pill } from '../../shared/ui/ListDetail.tsx';
import { useStore } from '../../shared/use-store.ts';
import { checklistRows, hasChanges, pendingWrites, reloadRow, settle, stage, switchWarning, type Checklist, type ChecklistRow } from './agent-checklist.ts';
import { CONFLICT_LINE, sourceTag, statusPill } from './connector-copy.ts';
import type { ConnectorsModel } from './connectors-model.ts';

function Row(props: {
  readonly row: ChecklistRow;
  readonly agentName: string;
  readonly agentCount: number;
  readonly asking: boolean;
  readonly saving: boolean;
  readonly redact: (text: string) => string;
  readonly onChange: (given: boolean) => void;
  readonly onStageSwitch: () => void;
  readonly onKeep: () => void;
  readonly onReload: () => void;
  readonly onManage: () => void;
}) {
  const { row } = props;
  const { connector, change } = row;
  const health = statusPill(connector.status);
  const conflicted = change.kind === 'conflict';
  return (
    <li class={`agent-connector${row.editable ? '' : ' dimmed'}`}>
      <div class="agent-connector-line">
        <label class="agent-connector-name">
          <input
            type="checkbox"
            checked={row.checked}
            disabled={!row.editable || conflicted || props.saving}
            onChange={(event) => {
              const given = event.currentTarget.checked;
              // The box stays as it is shown; the change redraws it, and a switch away from All agents asks first.
              event.currentTarget.checked = row.checked;
              props.onChange(given);
            }}
          />
          <ItemMark name={connector.label} />
          <span class="agent-connector-label">{connector.label}</span>
          <span class="tag">{sourceTag(connector.setup)}</span>
        </label>
        {row.allAgents && <Pill tone="muted">All agents</Pill>}
        {connector.status.kind !== 'connected' && <Pill tone={health.tone}>{health.label}</Pill>}
        <button type="button" class="btn ghost" aria-label={`Manage ${connector.label}`} onClick={props.onManage}>Manage →</button>
      </div>
      {!row.checked && <p class="binding-note">Not given to this agent</p>}
      {props.asking && (
        <div class="confirm-strip" role="alert">
          <p>{switchWarning(connector.label, props.agentName, props.agentCount)}</p>
          <div class="row">
            <button type="button" class="btn primary" onClick={props.onStageSwitch}>Stage switch</button>
            <button type="button" class="btn secondary" onClick={props.onKeep}>Cancel</button>
          </div>
        </div>
      )}
      {change.kind === 'conflict' && (
        <div class="row" role="alert">
          <span class="note warn">{CONFLICT_LINE}</span>
          <button type="button" class="btn secondary" onClick={props.onReload}>Reload row</button>
        </div>
      )}
      {change.kind === 'refused' && <p class="note error" role="alert">{props.redact(change.message)}</p>}
    </li>
  );
}

/**
 * Agent Settings › Extensions (spec IA §5): every connector with a box for this agent. Changes are
 * staged until Save, which writes each connector's one scope record with the revision it was read at.
 */
export function AgentExtensionsSection(props: {
  readonly model: ConnectorsModel;
  readonly agent: Agent;
  readonly agents: readonly Agent[];
  /** The provider's name when this agent uses the personal CLI setup, whose own tools Ori Kami can't limit. */
  readonly personalProvider: string | null;
  readonly redact: (text: string) => string;
  readonly onDirty: (dirty: boolean) => void;
  readonly onManage: (connectorId: string) => void;
  readonly onAddExtensions: () => void;
}) {
  const { model, agent } = props;
  const list = useStore(model.list);
  const [checklist, setChecklist] = useState<Checklist>({});
  const [asking, setAsking] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void model.load();
  }, [model]);
  const rows = list.kind === 'loaded' ? checklistRows(list.value.connectors, checklist, agent.id) : [];
  const writes = pendingWrites(rows, checklist, agent.id, props.agents.map(({ id }) => id));
  const dirty = list.kind === 'loaded' && hasChanges(list.value.connectors, checklist);
  useEffect(() => {
    props.onDirty(dirty);
  }, [dirty]);

  const save = async (): Promise<void> => {
    setSaving(true);
    setAsking(null);
    for (const { id, request } of writes) {
      const outcome = await model.setScope(id, request);
      setChecklist((now) => settle(now, id, outcome));
    }
    setSaving(false);
  };
  /** Takes the newer scope a conflicted row reported. */
  const adopt = (id: string): void => {
    const problem = checklist[id]?.problem;
    if (problem?.kind === 'conflict') model.adoptScope(id, problem.current);
  };

  return (
    <div class="settings-section">
      <p class="binding-note">Choose which connectors {agent.name} can use.</p>
      {props.personalProvider !== null && (
        <p class="binding-note">
          This agent's {props.personalProvider} CLI may also use tools from your personal {props.personalProvider} setup. Ori Kami can't see or limit those.
        </p>
      )}
      {list.kind === 'loading' && <p class="muted">Loading connectors…</p>}
      {list.kind === 'failed' && (
        <div class="row" role="alert">
          <span class="note error">{props.redact(list.message)}</span>
          <button type="button" class="btn secondary" onClick={() => void model.load()}>Try again</button>
        </div>
      )}
      {list.kind === 'loaded' && rows.length === 0 && <p class="muted">No connectors are set up yet.</p>}
      {rows.length > 0 && (
        <ul class="agent-connectors" aria-label="Connectors">
          {rows.map((row) => {
            const { id } = row.connector;
            const set = (given: boolean): void => {
              setAsking(null);
              setChecklist((now) => stage(now, row.connector, agent.id, given));
            };
            return (
              <Row
                key={id}
                row={row}
                agentName={agent.name}
                agentCount={props.agents.length}
                asking={asking === id && row.allAgents && row.editable}
                saving={saving}
                redact={props.redact}
                onChange={(given) => {
                  if (!given && row.allAgents) setAsking(id);
                  else set(given);
                }}
                onStageSwitch={() => { set(false); }}
                onKeep={() => { setAsking(null); }}
                onReload={() => {
                  adopt(id);
                  setChecklist((now) => reloadRow(now, id));
                }}
                onManage={() => { props.onManage(id); }}
              />
            );
          })}
        </ul>
      )}
      <div class="row section-actions">
        <button
          type="button"
          class="btn secondary"
          disabled={!dirty || saving}
          onClick={() => {
            for (const id of Object.keys(checklist)) adopt(id);
            setChecklist({});
            setAsking(null);
          }}
        >
          Cancel
        </button>
        <button type="button" class="btn primary" disabled={writes.length === 0 || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <div class="row">
        <button type="button" class="btn ghost" onClick={props.onAddExtensions}>Add extensions…</button>
      </div>
    </div>
  );
}
