import { useEffect, useState } from 'preact/hooks';
import type { ResetChoice, ResetOption, ResetPlan } from '../../bridge.ts';
import { redact, type AppInfo } from '../../shared/privacy.ts';
import { Modal } from '../../shared/ui/Modal.tsx';
import { CHOICE_COPY, CHOICE_ORDER, groupSteps, loadResetPlan, runReset, type ResetBridge } from './reset.ts';

type Available = Extract<ResetOption, { readonly kind: 'available' }>;

/** Where the dialog is: loading the plan, picking a choice, confirming its exact paths, or handing over to main. */
export type ResetStage =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'choose'; readonly plan: ResetPlan; readonly choice: ResetChoice | null }
  | { readonly kind: 'confirm'; readonly plan: ResetPlan; readonly option: Available; readonly understood: boolean }
  | { readonly kind: 'running'; readonly option: Available };

const TITLE = 'Reset or Uninstall MorrowBot';

/** A path as this dialog shows it: exact, with the home folder written `~`. */
const shownPath = (path: string, info: AppInfo | null): string => (info === null ? path : redact(path, info));

function PathList(props: { readonly heading: string; readonly items: readonly string[]; readonly info: AppInfo | null; readonly tone?: 'danger' }) {
  if (props.items.length === 0) return null;
  return (
    <section class={`reset-group ${props.tone ?? ''}`}>
      <h3 class="reset-heading">{props.heading}</h3>
      <ul class="reset-paths">
        {props.items.map((item) => (
          <li key={item} class="mono">{shownPath(item, props.info)}</li>
        ))}
      </ul>
    </section>
  );
}

function Choose(props: { readonly plan: ResetPlan; readonly choice: ResetChoice | null; readonly onChoice: (choice: ResetChoice) => void }) {
  return (
    <fieldset class="reset-choices">
      <legend class="dialog-body">Choose what to do. You see every file before anything happens.</legend>
      {CHOICE_ORDER.map((choice) => {
        const option = props.plan.options.find((each) => each.choice === choice);
        const disabled = option?.kind !== 'available';
        return (
          <label key={choice} class={`reset-choice${disabled ? ' disabled' : ''}`}>
            <input type="radio" name="reset-choice" value={choice} checked={props.choice === choice} disabled={disabled} onChange={() => { props.onChoice(choice); }} />
            <span class="reset-choice-text">
              <span class="reset-choice-title">{CHOICE_COPY[choice].title}</span>
              <span class="reset-choice-summary">{CHOICE_COPY[choice].summary}</span>
              {option?.kind === 'unavailable' && <span class="reset-choice-reason">{option.reason}</span>}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function Confirm(props: { readonly option: Available; readonly info: AppInfo | null; readonly understood: boolean; readonly onUnderstood: (understood: boolean) => void }) {
  const { trash, deleted, keychain } = groupSteps(props.option.steps);
  const copy = CHOICE_COPY[props.option.choice];
  return (
    <>
      <p class="dialog-body">{copy.summary}</p>
      <div class="reset-review">
        <PathList heading="Moved to the Trash" items={trash} info={props.info} />
        <PathList heading="Deleted for good" items={deleted} info={props.info} tone="danger" />
        <PathList heading="Removed from the login Keychain" items={keychain} info={props.info} tone="danger" />
        {props.option.steps.length === 0 && <p class="dialog-body">Nothing to delete. MorrowBot just restarts.</p>}
        {props.option.kept.length > 0 && (
          <section class="reset-group">
            <h3 class="reset-heading">Kept</h3>
            <ul class="reset-paths">
              {props.option.kept.map(({ path, reason }) => (
                <li key={path}>
                  <span class="mono">{shownPath(path, props.info)}</span> <span class="reset-kept-reason">{reason}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <label class="reset-understand">
        <input type="checkbox" checked={props.understood} onChange={(event) => { props.onUnderstood(event.currentTarget.checked); }} />
        <span>{copy.understand}</span>
      </label>
    </>
  );
}

/** The view for a stage, without loading anything: the dialog and its tests both render this. */
export function ResetDialogView(props: {
  readonly stage: ResetStage;
  readonly info: AppInfo | null;
  readonly onStage: (stage: ResetStage) => void;
  readonly onRun: (option: Available, token: string) => void;
  readonly onReload: () => void;
  readonly onClose: () => void;
}) {
  const { stage, onStage } = props;
  const cancel = (
    <button type="button" class="btn secondary" data-autofocus onClick={props.onClose}>
      Cancel
    </button>
  );
  switch (stage.kind) {
    case 'loading':
      return <p class="dialog-body" role="status">Checking what MorrowBot has on this Mac…</p>;
    case 'failed':
      return (
        <>
          <p class="dialog-body" role="alert">{stage.reason}</p>
          <div class="dialog-actions">
            {cancel}
            <button type="button" class="btn primary" onClick={props.onReload}>Review again</button>
          </div>
        </>
      );
    case 'choose': {
      const picked = stage.plan.options.find((option): option is Available => option.kind === 'available' && option.choice === stage.choice);
      return (
        <>
          <Choose plan={stage.plan} choice={stage.choice} onChoice={(choice) => { onStage({ ...stage, choice }); }} />
          <div class="dialog-actions">
            {cancel}
            <button type="button" class="btn primary" disabled={picked === undefined} onClick={() => { if (picked !== undefined) onStage({ kind: 'confirm', plan: stage.plan, option: picked, understood: false }); }}>
              Continue…
            </button>
          </div>
        </>
      );
    }
    case 'confirm':
      return (
        <>
          <Confirm option={stage.option} info={props.info} understood={stage.understood} onUnderstood={(understood) => { onStage({ ...stage, understood }); }} />
          <div class="dialog-actions">
            <button type="button" class="btn secondary" onClick={() => { onStage({ kind: 'choose', plan: stage.plan, choice: stage.option.choice }); }}>
              Back
            </button>
            <button type="button" class="btn danger" disabled={!stage.understood} onClick={() => { props.onRun(stage.option, stage.plan.token); }}>
              {CHOICE_COPY[stage.option.choice].confirm}
            </button>
          </div>
        </>
      );
    case 'running':
      return <p class="dialog-body" role="status">Stopping MorrowBot to {CHOICE_COPY[stage.option.choice].title.toLowerCase()}…</p>;
  }
}

/** Settings › About › Reset or Uninstall: three choices, then every exact path, then an explicit confirmation. */
export function ResetDialog(props: { readonly bridge: ResetBridge; readonly info: AppInfo | null; readonly onClose: () => void }) {
  const [stage, setStage] = useState<ResetStage>({ kind: 'loading' });
  const load = (): void => {
    setStage({ kind: 'loading' });
    void loadResetPlan(props.bridge).then((plan) => {
      setStage(plan === null ? { kind: 'failed', reason: 'MorrowBot could not check its files. Nothing was changed.' } : { kind: 'choose', plan, choice: null });
    });
  };
  useEffect(load, [props.bridge]);
  const title = stage.kind === 'confirm' || stage.kind === 'running' ? `${CHOICE_COPY[stage.option.choice].title}?` : TITLE;
  return (
    <Modal label={TITLE} role="alertdialog" class="confirm reset-dialog" onClose={stage.kind === 'running' ? () => undefined : props.onClose}>
      <h2 class="dialog-title">{title}</h2>
      <ResetDialogView
        stage={stage}
        info={props.info}
        onStage={setStage}
        onReload={load}
        onClose={props.onClose}
        onRun={(option, token) => {
          setStage({ kind: 'running', option });
          void runReset(props.bridge, option.choice, token).then((outcome) => {
            if (outcome.kind === 'refused') setStage({ kind: 'failed', reason: outcome.reason });
          });
        }}
      />
    </Modal>
  );
}
