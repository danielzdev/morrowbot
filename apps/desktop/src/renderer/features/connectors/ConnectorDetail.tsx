import type { Agent, Connector } from '@morrowbot/contracts';
import { useCallback, useState } from 'preact/hooks';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';
import { ItemMark } from '../../shared/ui/ItemMark.tsx';
import { DetailSection, Pill } from '../../shared/ui/ListDetail.tsx';
import { Toggle } from '../../shared/ui/Toggle.tsx';
import { AccountSection } from './AccountSection.tsx';
import { sourceTag, statusPill, usedBy } from './connector-copy.ts';
import type { ConnectorsModel, ConnectorWork } from './connectors-model.ts';
import type { AgentAvatarSlot } from './ScopePicker.tsx';
import { ScopeSection } from './ScopeSection.tsx';

/** The detail's dirty state: Available to or the Account form, each saved on its own. */
function useSectionsDirty(onDirty: (dirty: boolean) => void) {
  const [parts] = useState(() => ({ scope: false, account: false }));
  const scope = useCallback((dirty: boolean) => {
    parts.scope = dirty;
    onDirty(parts.scope || parts.account);
  }, [parts, onDirty]);
  const account = useCallback((dirty: boolean) => {
    parts.account = dirty;
    onDirty(parts.scope || parts.account);
  }, [parts, onDirty]);
  return { scope, account };
}

/** The one place a connector is managed (spec IA §4): header, status, Available to, Account, Tools, Danger zone. */
export function ConnectorDetail(props: {
  readonly model: ConnectorsModel;
  readonly connector: Connector;
  readonly agents: readonly Agent[];
  readonly avatar: AgentAvatarSlot;
  readonly work: ConnectorWork | undefined;
  readonly problem: string | undefined;
  readonly redact: (text: string) => string;
  readonly onDirty: (dirty: boolean) => void;
}) {
  const { model, connector, redact } = props;
  const [removing, setRemoving] = useState(false);
  const dirty = useSectionsDirty(props.onDirty);
  const health = statusPill(connector.status);
  const busy = props.work !== undefined;
  const askRemove = (): void => {
    setRemoving(true);
  };
  return (
    <article class="detail" aria-label={connector.label}>
      <header class="detail-header">
        <ItemMark name={connector.label} />
        <div class="detail-title">
          <h2>{connector.label}</h2>
          <span class="tag">{sourceTag(connector.setup)}</span>
        </div>
        <Pill tone={health.tone}>{health.label}</Pill>
        <Toggle label={`${connector.label} on`} checked={connector.enabled} disabled={busy} onChange={(enabled) => void model.setEnabled(connector.id, enabled)} />
      </header>

      {(health.detail !== null || props.problem !== undefined) && (
        <section class="status-card" aria-label="Details">
          {health.detail !== null && <p class="status-detail">{redact(health.detail)}</p>}
          {props.problem !== undefined && (
            <p class="status-problem" role="alert">
              {redact(props.problem)}
            </p>
          )}
        </section>
      )}

      <ScopeSection
        model={model}
        connector={connector}
        agents={props.agents}
        avatar={props.avatar}
        busy={busy}
        redact={redact}
        onRemove={askRemove}
        onDirty={dirty.scope}
      />
      <AccountSection model={model} connector={connector} agents={props.agents} work={props.work} redact={redact} onDirty={dirty.account} />

      <DetailSection title="Tools">
        {connector.tools.length === 0 ? (
          <p class="muted">No tools discovered yet.</p>
        ) : (
          <ul class="fact-list connector-tools">
            {connector.tools.map((tool) => (
              <li key={tool.boundName}>
                <code>{tool.boundName}</code>
                {tool.description !== '' && <span class="muted">{redact(tool.description)}</span>}
              </li>
            ))}
          </ul>
        )}
      </DetailSection>

      <DetailSection title="Danger zone">
        <div class="row">
          <button type="button" class="btn danger" disabled={busy} onClick={askRemove}>
            {props.work === 'removing' ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </DetailSection>
      {removing && (
        <ConfirmDialog
          title={`Remove ${connector.label}?`}
          body={
            <>
              <p>{usedBy(connector.scope, props.agents)}</p>
              <p>Its setup, saved secrets and scope are deleted.</p>
            </>
          }
          confirmLabel="Remove"
          tone="danger"
          onCancel={() => { setRemoving(false); }}
          onConfirm={() => {
            setRemoving(false);
            void model.remove(connector.id);
          }}
        />
      )}
    </article>
  );
}
