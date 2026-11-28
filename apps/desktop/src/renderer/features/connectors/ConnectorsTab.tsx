import type { Agent, Connector } from '@morrowbot/contracts';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { ItemMark } from '../../shared/ui/ItemMark.tsx';
import { ListDetail, ListRow, Pill } from '../../shared/ui/ListDetail.tsx';
import { Segmented } from '../../shared/ui/Segmented.tsx';
import { useStore } from '../../shared/use-store.ts';
import { AddConnectorForm } from './AddConnectorForm.tsx';
import { EMPTY_LINE, FILTERS_FROM, matching, scopeChip, sourceTag, statusPill, type ConnectorFilter } from './connector-copy.ts';
import { ConnectorDetail } from './ConnectorDetail.tsx';
import type { ConnectorsModel } from './connectors-model.ts';
import type { AgentAvatarSlot } from './ScopePicker.tsx';

const FILTERS: readonly { readonly value: ConnectorFilter; readonly label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'composio', label: 'Composio' },
  { value: 'mcp', label: 'MCP' },
];

function ConnectorRow(props: { readonly connector: Connector; readonly selected: boolean; readonly tabStop: boolean; readonly onSelect: () => void }) {
  const { connector } = props;
  const health = statusPill(connector.status);
  return (
    <ListRow label={connector.label} selected={props.selected} tabStop={props.tabStop} onSelect={props.onSelect}>
      <ItemMark name={connector.label} />
      <span class="item-text">
        <span class="item-name">
          {connector.label}
          <span class="tag">{sourceTag(connector.setup)}</span>
        </span>
        <span class="connector-facts">
          <Pill tone={health.tone}>{health.label}</Pill>
          <span class="scope-chip">{scopeChip(connector.scope)}</span>
        </span>
      </span>
    </ListRow>
  );
}

export interface ConnectorsTabProps {
  readonly model: ConnectorsModel;
  readonly agents: readonly Agent[];
  readonly avatar: AgentAvatarSlot;
  readonly redact: (text: string) => string;
  /** The Extensions search. */
  readonly query: string;
  readonly onDirty: (dirty: boolean) => void;
  /** Runs an action after the "Discard changes?" check. */
  readonly guard: (action: () => void) => void;
  readonly onBrowse: () => void;
}

/** Extensions › Connectors (spec IA §3, §4, §8): the list with its filters and add actions, and the detail or add form. */
export function ConnectorsTab(props: ConnectorsTabProps) {
  const { model, guard } = props;
  const list = useStore(model.list);
  const activity = useStore(model.activity);
  const place = useStore(model.place);
  const [filter, setFilter] = useState<ConnectorFilter>('all');
  const [dirty, setDirty] = useState(false);
  const { onDirty } = props;
  const report = useCallback((next: boolean) => {
    setDirty(next);
    onDirty(next);
  }, [onDirty]);
  useEffect(() => () => {
    model.leave();
  }, [model]);

  const connectors = list.kind === 'loaded' ? list.value.connectors : [];
  const filterable = connectors.length >= FILTERS_FROM;
  const shown = matching(connectors, props.query, filterable ? filter : 'all');
  const { pane } = place;
  const chosen = pane.kind === 'connector' ? connectors.find(({ id }) => id === pane.id) : undefined;
  const selected = pane.kind === 'adding' ? undefined : (chosen ?? shown[0]);
  const selectedId = selected?.id;
  useEffect(() => {
    if (dirty && selectedId !== undefined) model.pin(selectedId);
  }, [dirty, selectedId, model]);

  if (list.kind === 'loading') return <p class="muted tab-empty">Loading connectors…</p>;
  if (list.kind === 'failed') {
    return (
      <div class="banner error" role="alert">
        <span>Ori Kami couldn't load your connectors. {props.redact(list.message)}</span>
        <button type="button" class="btn secondary" onClick={() => void model.load()}>Try again</button>
      </div>
    );
  }

  const add = (form: 'mcp' | 'composio'): void => {
    if (pane.kind === 'adding' && pane.form === form) return;
    guard(() => { model.open({ kind: 'adding', form }); });
  };
  const connect = (
    <button type="button" class="btn ghost add-provider" onClick={() => { add('composio'); }}>+ Connect an account</button>
  );

  if (connectors.length === 0 && pane.kind !== 'adding') {
    return (
      <div class="tab-empty">
        <p>{EMPTY_LINE}</p>
        <div class="row">
          <button type="button" class="btn secondary" onClick={props.onBrowse}>Browse connectors</button>
          <button type="button" class="btn secondary" onClick={() => { add('mcp'); }}>Add MCP server</button>
        </div>
        <div>{connect}</div>
      </div>
    );
  }

  return (
    <ListDetail
      label="Connectors"
      header={
        filterable ? (
          <div class="connector-filters">
            <Segmented label="Show" value={filter} options={FILTERS} onChange={setFilter} />
          </div>
        ) : undefined
      }
      list={
        <>
          {shown.map((connector, index) => (
            <ConnectorRow
              key={connector.id}
              connector={connector}
              selected={connector.id === selectedId}
              tabStop={connector.id === selectedId || (index === 0 && !shown.some(({ id }) => id === selectedId))}
              onSelect={() => {
                if (connector.id === selectedId) return;
                guard(() => { model.open({ kind: 'connector', id: connector.id }); });
              }}
            />
          ))}
          {shown.length === 0 && connectors.length > 0 && <p class="list-empty muted">No matches.</p>}
        </>
      }
      footer={
        <div class="connector-add">
          {connect}
          <button type="button" class="btn ghost add-provider" onClick={() => { add('mcp'); }}>+ Add MCP server</button>
        </div>
      }
      detail={
        pane.kind === 'adding' ? (
          <AddConnectorForm
            key={`${pane.form}:${String(place.visit)}`}
            form={pane.form}
            model={model}
            connectors={connectors}
            agents={props.agents}
            avatar={props.avatar}
            installFor={place.installFor}
            redact={props.redact}
            onCreated={(created) => { model.open({ kind: 'connector', id: created.id }); }}
            onCancel={() => { model.open({ kind: 'default' }); }}
            onDirty={report}
          />
        ) : selected === undefined ? (
          <p class="muted detail-empty">Choose a connector to see its details.</p>
        ) : (
          <ConnectorDetail
            key={`${selected.id}:${String(place.visit)}`}
            model={model}
            connector={selected}
            agents={props.agents}
            avatar={props.avatar}
            work={activity.busy[selected.id]}
            problem={activity.problems[selected.id]}
            redact={props.redact}
            onDirty={report}
          />
        )
      }
    />
  );
}
