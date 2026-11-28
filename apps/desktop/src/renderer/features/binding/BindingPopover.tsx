import type { AccessProfile, ProviderModel } from '@morrowbot/contracts';
import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { AccessSegment } from '../../shared/binding-ui/AccessSegment.tsx';
import { profileName } from '../../shared/binding-ui/access-copy.ts';
import { accessState, changeCheck, confirmLabel, modelState, needsConfirm, unrunnableReason, type ChangeCheck, type ModelState } from '../../shared/binding-ui/binding-state.ts';
import { ModelList } from '../../shared/binding-ui/ModelList.tsx';
import { OptionColumn } from '../../shared/binding-ui/OptionColumn.tsx';
import { ProviderRail } from '../../shared/binding-ui/ProviderRail.tsx';
import { isRunnable, pinModel, switchBinding, withChoice, type ProviderChoice } from '../../shared/binding-ui/selection.ts';
import { Icon } from '../../shared/ui/Icon.tsx';
import { Popover } from '../../shared/ui/Popover.tsx';
import type { BoundProvider } from './binding-display.ts';

/** A change that needs an inline yes first (spec §4.6): a provider switch, or access that adds a warning. */
interface Confirm {
  readonly next: BoundProvider;
  readonly check: ChangeCheck;
  /** The switch target's name, or the new access profile's. */
  readonly name: string;
}

const NOT_READY: ModelState = { kind: 'not-ready' };

/**
 * The one Model · Effort · Access popover of the composer. A model or effort of the current provider
 * is sent at once; browsing another provider changes nothing until its switch is confirmed.
 */
export function BindingPopover(props: {
  readonly agentName: string;
  readonly choices: readonly ProviderChoice[];
  readonly binding: BoundProvider;
  readonly anchor: RefObject<HTMLElement | null>;
  readonly focus: 'model' | 'access';
  /** False for server members (including co-owners), who may not grant full access. */
  readonly allowFull: boolean;
  /** Saves the binding; resolves with why it was refused, or null once the host has it. */
  readonly onCommit: (next: BoundProvider) => Promise<string | null>;
  readonly redact: (text: string) => string;
  readonly onOpenProviders: () => void;
  readonly onClose: () => void;
}) {
  const { binding, choices } = props;
  const [browse, setBrowse] = useState(binding.pluginId);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (props.focus === 'access') root.current?.querySelector<HTMLElement>('.access-row [tabindex="0"]')?.focus();
  }, [props.focus]);
  useEffect(() => {
    setConfirm(null);
  }, [JSON.stringify(binding)]);
  const asked = useRef(false);
  useEffect(() => {
    const at = (selector: string): HTMLElement | null => root.current?.querySelector<HTMLElement>(selector) ?? null;
    if (confirm !== null) at('.confirm-strip [data-autofocus]')?.focus();
    else if (asked.current) (at('.access-row [tabindex="0"]') ?? at('.switch-button'))?.focus();
    asked.current = confirm !== null;
  }, [confirm]);
  const own = browse === binding.pluginId;
  const browsed = choices.find(({ id }) => id === browse);
  const runnable = browsed !== undefined && isRunnable(browsed);
  const models = browsed === undefined || !runnable ? NOT_READY : modelState(browsed.info, own ? binding.selection : { kind: 'default' });
  const saving = useRef(false);
  const commit = async (next: BoundProvider): Promise<void> => {
    if (saving.current) return;
    saving.current = true;
    setConfirm(null);
    setPending(true);
    setProblem(null);
    const refused = await props.onCommit(next);
    saving.current = false;
    setPending(false);
    if (refused !== null) setProblem(props.redact(refused));
  };
  const switchTo = (choice: ProviderChoice, model: ProviderModel | null): void => {
    const fresh = switchBinding(choice, binding, { allowFull: props.allowFull });
    if (fresh.kind !== 'bound') return;
    const next = model === null ? fresh : { ...fresh, selection: pinModel(model) };
    setConfirm({ next, check: changeCheck(choices, binding, next), name: choice.name });
  };
  const pickModel = (model: ProviderModel): void => {
    if (!own) {
      if (browsed !== undefined && runnable) switchTo(browsed, model);
      return;
    }
    if (binding.selection.kind !== 'model' || binding.selection.id !== model.id) void commit({ ...binding, selection: pinModel(model) });
  };
  const pickAccess = (profile: AccessProfile): void => {
    const next = { ...binding, access: profile.access, vendorSettings: profile.vendorSettings };
    const check = changeCheck(choices, binding, next);
    if (needsConfirm(check)) setConfirm({ next, check, name: profileName(profile) });
    else void commit(next);
  };
  return (
    <Popover anchor={props.anchor} label={`${props.agentName}: model, effort and access`} width={540} side="top" class="binding-popover" onClose={props.onClose}>
      <div ref={root}>
        <header class="binding-header">
          <span>{`${props.agentName} · applies to all its chats`}</span>
          {pending && <span class="muted">Saving…</span>}
        </header>
        <div class="binding-columns">
          <ProviderRail label="Providers" layout="rail" choices={choices} selected={browse} onPick={(id) => { setBrowse(id); setConfirm(null); }} />
          <div class="binding-models">
            {browsed === undefined || !runnable ? (
              <div class="binding-unrunnable">
                <p class="binding-note">{unrunnableReason(browsed, own ? binding : null, props.redact)}</p>
                <button type="button" class="btn secondary" onClick={props.onOpenProviders}>Open Providers</button>
              </div>
            ) : (
              <>
                {!own && (
                  <button type="button" class="btn secondary switch-button" onClick={() => { switchTo(browsed, null); }}>
                    {`Switch to ${browsed.name}`}
                  </button>
                )}
                <ModelList key={browse} state={models} runtime={browsed.runtime} disabled={pending} showCurrent={own} onPick={pickModel} />
              </>
            )}
          </div>
          <OptionColumn
            state={own && runnable ? models : NOT_READY}
            disabled={pending}
            arrowsSelect={false}
            onChoose={(optionId, choiceId) => void commit({ ...binding, selection: withChoice(binding.selection, optionId, choiceId) })}
          />
        </div>
        <footer class="binding-footer">
          {confirm === null ? (
            !runnable ? null : own ? (
              <AccessSegment state={accessState(browsed.info, binding)} value={binding} disabled={pending} arrowsSelect={false} redact={props.redact} onPick={pickAccess} />
            ) : (
              <p class="binding-note">Access is set when you switch.</p>
            )
          ) : (
            <div class="confirm-strip" role="alert">
              <p>
                {confirm.check.switched
                  ? `Switch ${props.agentName} to ${confirm.name}? This applies to all this agent's chats. A chat may ask to start a new session on its next send.`
                  : `Use ${confirm.name}?`}
              </p>
              {confirm.check.added.map((warning) => (
                <p key={warning} class="binding-note warn"><Icon name="warning" /> {warning}</p>
              ))}
              <div class="row">
                <button type="button" class="btn primary" data-autofocus onClick={() => void commit(confirm.next)}>
                  {confirmLabel(confirm.check, binding, confirm.next)}
                </button>
                <button type="button" class="btn secondary" onClick={() => { setConfirm(null); }}>Cancel</button>
              </div>
            </div>
          )}
          {problem !== null && <p class="binding-note danger" role="alert">{`The change was not saved: ${problem}`}</p>}
        </footer>
      </div>
    </Popover>
  );
}
