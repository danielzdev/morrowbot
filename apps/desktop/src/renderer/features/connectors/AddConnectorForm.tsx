import { MAX_CONNECTOR_LABEL, type Agent, type Connector } from '@morrowbot/contracts';
import { useEffect, useState } from 'preact/hooks';
import { Segmented } from '../../shared/ui/Segmented.tsx';
import { useStore } from '../../shared/use-store.ts';
import { labelProblemOf, suggestedLabel } from './connector-copy.ts';
import type { ConnectorsModel } from './connectors-model.ts';
import { choiceAtInstall, requestOf, sameChoice } from './scope-choice.ts';
import { ScopePicker, type AgentAvatarSlot } from './ScopePicker.tsx';
import { EMPTY_COMPOSIO, EMPTY_HTTP, EMPTY_STDIO, newSetupOf } from './setup-draft.ts';
import { SetupFields } from './SetupFields.tsx';

const TRANSPORTS = [
  { value: 'stdio', label: 'Local command' },
  { value: 'http', label: 'Remote URL' },
] as const;

/**
 * + Add MCP server and + Connect an account (spec IA §5 "At install"): the label and setup, then who
 * gets it. Nothing is saved before the scope step, so a connector never runs with a scope nobody chose.
 */
export function AddConnectorForm(props: {
  readonly form: 'mcp' | 'composio';
  readonly model: ConnectorsModel;
  readonly connectors: readonly Connector[];
  readonly agents: readonly Agent[];
  readonly avatar: AgentAvatarSlot;
  readonly installFor: string | null;
  readonly redact: (text: string) => string;
  readonly onCreated: (connector: Connector) => void;
  readonly onCancel: () => void;
  readonly onDirty: (dirty: boolean) => void;
}) {
  const { form } = props;
  const [step, setStep] = useState<'setup' | 'scope'>('setup');
  const [typedLabel, setTypedLabel] = useState<string | null>(null);
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio');
  const [stdio, setStdio] = useState(EMPTY_STDIO);
  const [http, setHttp] = useState(EMPTY_HTTP);
  const [composio, setComposio] = useState(EMPTY_COMPOSIO);
  const [scope, setScope] = useState(() => choiceAtInstall(props.installFor));
  const [refused, setRefused] = useState<{ readonly field: 'label' | 'form'; readonly message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const draft = form === 'composio' ? composio : transport === 'stdio' ? stdio : http;
  const label = typedLabel ?? (form === 'composio' ? suggestedLabel(composio.toolkit, props.connectors) : '');
  const setup = newSetupOf(draft);
  const labelProblem = labelProblemOf(label) ?? (refused?.field === 'label' ? refused.message : null);
  const ready = label.trim() !== '' && labelProblemOf(label) === null && setup.kind === 'ready';
  const dirty =
    typedLabel !== null ||
    JSON.stringify([stdio, http, composio]) !== JSON.stringify([EMPTY_STDIO, EMPTY_HTTP, EMPTY_COMPOSIO]) ||
    !sameChoice(scope, choiceAtInstall(props.installFor));
  const { onDirty, model } = props;
  const vault = useStore(model.vault);
  useEffect(() => {
    void model.loadVault();
  }, [model]);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => () => {
    onDirty(false);
  }, [onDirty]);

  const create = (): void => {
    if (setup.kind !== 'ready' || saving) return;
    setSaving(true);
    setRefused(null);
    void props.model.create({ label, setup: setup.value, scope: requestOf(scope) }).then((result) => {
      setSaving(false);
      if (result.kind === 'created') {
        props.onCreated(result.connector);
        return;
      }
      setRefused(result);
      if (result.field === 'label') setStep('setup');
    });
  };
  const title = form === 'mcp' ? 'Add MCP server' : 'Connect an account';

  return (
    <article class="detail" aria-label={title}>
      <form
        class="connector-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready) return;
          if (step === 'setup') setStep('scope');
          else create();
        }}
      >
        <header class="detail-title">
          <h2>{title}</h2>
          {form === 'composio' && step === 'setup' && <p class="muted">Use an MCP server and an account you set up in Composio.</p>}
        </header>
        {step === 'setup' ? (
          <>
            <label class="field">
              <span>Label</span>
              <input
                type="text"
                maxLength={MAX_CONNECTOR_LABEL}
                placeholder="Work"
                autocomplete="off"
                aria-invalid={labelProblem !== null}
                value={label}
                onInput={(event) => {
                  setTypedLabel(event.currentTarget.value);
                  if (refused?.field === 'label') setRefused(null);
                }}
              />
              {labelProblem !== null && <small class="note error" role="alert">{props.redact(labelProblem)}</small>}
            </label>
            {form === 'mcp' && (
              <div class="field">
                <span>Transport</span>
                <Segmented label="Transport" value={transport} options={TRANSPORTS} onChange={setTransport} />
                {transport === 'http' && <small class="binding-note">Streamable HTTP.</small>}
              </div>
            )}
            <SetupFields
              key={draft.kind}
              draft={draft}
              vault={vault}
              onChange={(next) => {
                setRefused((now) => (now?.field === 'form' ? null : now));
                switch (next.kind) {
                  case 'stdio':
                    setStdio(next);
                    return;
                  case 'http':
                    setHttp(next);
                    return;
                  case 'composio':
                    setComposio(next);
                    return;
                }
              }}
            />
            {setup.kind === 'invalid' && setup.reason !== null && <p class="note warn">{setup.reason}</p>}
          </>
        ) : (
          <div class="field">
            <span>Available to</span>
            <ScopePicker choice={scope} agents={props.agents} avatar={props.avatar} disabled={saving} onChange={setScope} />
            {scope.mode === 'selected' && scope.agentIds.length === 0 && <p class="binding-note">On, but no agents can use it yet.</p>}
          </div>
        )}
        {refused?.field === 'form' && <p class="note error" role="alert">{props.redact(refused.message)}</p>}
        <div class="form-actions">
          <button type="button" class="btn ghost" disabled={saving} onClick={props.onCancel}>Cancel</button>
          {step === 'scope' && (
            <button type="button" class="btn secondary" disabled={saving} onClick={() => { setStep('setup'); }}>Back</button>
          )}
          <button key={step} type="submit" class="btn primary" disabled={!ready || saving}>
            {step === 'setup' ? 'Next' : saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </article>
  );
}
