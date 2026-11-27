import type { AccessLevel, ModelSelection, ProviderInfo, VendorSettings } from '@morrowbot/contracts';
import { useState } from 'preact/hooks';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';
import { accessChoices, modelChoices, selectChoice, selectModel, SHELL_NOTE, type BoundProvider } from './binding.ts';

const DEFAULT_MODEL = '';

export function ModelPicker(props: {
  readonly info: ProviderInfo | undefined;
  readonly binding: BoundProvider;
  readonly disabled: boolean;
  readonly onChange: (selection: ModelSelection) => void;
}) {
  const choices = modelChoices(props.info, props.binding.selection);
  switch (choices.kind) {
    case 'unavailable':
      return <span class="chip muted">Model: provider not ready</span>;
    case 'later':
      return <span class="chip muted">Models appear after the first message</span>;
    case 'models':
      break;
  }
  const { selected } = choices;
  const { selection } = props.binding;
  const missing = selection.kind === 'model' && selected === null ? selection.id : null;
  return (
    <>
      <label class="chip">
        <span class="chip-label">Model</span>
        <select
          aria-label="Model"
          disabled={props.disabled}
          value={missing ?? selected?.id ?? DEFAULT_MODEL}
          onChange={(event) => {
            const id = event.currentTarget.value;
            props.onChange(selectModel(choices.models.find((model) => model.id === id) ?? null));
          }}
        >
          {missing !== null && (
            <option value={missing} disabled>
              {`${missing} (not offered)`}
            </option>
          )}
          <option value={DEFAULT_MODEL}>Default</option>
          {choices.models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>
      </label>
      {selected?.options.map((option) => (
        <label key={option.id} class="chip">
          <span class="chip-label">{option.label}</span>
          <select
            aria-label={option.label}
            disabled={props.disabled}
            value={choices.choices[option.id] ?? option.defaultChoiceId}
            onChange={(event) => {
              props.onChange(selectChoice(props.binding.selection, option.id, event.currentTarget.value));
            }}
          >
            {option.choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      ))}
    </>
  );
}

const keyOf = (access: AccessLevel, vendorSettings: VendorSettings): string => `${access}/${vendorSettings}`;

/** Only the access levels the provider has proven for chat turns; held-back ones are listed with their reason. */
export function AccessPicker(props: {
  readonly info: ProviderInfo | undefined;
  readonly binding: BoundProvider;
  readonly disabled: boolean;
  readonly onChange: (access: AccessLevel, vendorSettings: VendorSettings) => void;
}) {
  const choices = accessChoices(props.info, props.binding);
  const [pending, setPending] = useState<(typeof choices.options)[number] | null>(null);
  if (choices.options.length === 0 && choices.withheld.length === 0) return null;
  const current = keyOf(props.binding.access, props.binding.vendorSettings);
  const offered = choices.options.some((option) => keyOf(option.access, option.vendorSettings) === current);
  const warnings = choices.options.find((option) => keyOf(option.access, option.vendorSettings) === current)?.warnings ?? [];
  const reasons = [SHELL_NOTE, ...warnings, ...choices.withheld.map((each) => `${each.label}: ${each.reason}`)];
  return (
    <>
    <label class={`chip ${choices.currentProblem === null ? '' : 'warning'}`} title={reasons.join('\n')}>
      <span class="chip-label">Access</span>
      <select
        aria-label="Access"
        disabled={props.disabled}
        value={current}
        onChange={(event) => {
          const picked = choices.options.find((option) => keyOf(option.access, option.vendorSettings) === event.currentTarget.value);
          if (picked === undefined) return;
          if (picked.warnings.length > 0) {
            event.currentTarget.value = current;
            setPending(picked);
            return;
          }
          props.onChange(picked.access, picked.vendorSettings);
        }}
      >
        {!offered && (
          <option value={current} disabled>
            {`${current}: ${choices.currentProblem ?? 'not offered'}`}
          </option>
        )}
        {choices.options.map((option) => (
          <option key={keyOf(option.access, option.vendorSettings)} value={keyOf(option.access, option.vendorSettings)}>
            {option.warnings.length > 0 ? `${option.label} ⚠` : option.label}
          </option>
        ))}
        {choices.withheld.map((each) => (
          <option key={`withheld-${keyOf(each.access, each.vendorSettings)}`} disabled>
            {`${each.label}: ${each.reason}`}
          </option>
        ))}
        <option disabled>{SHELL_NOTE}</option>
      </select>
    </label>
      {pending !== null && (
        <ConfirmDialog
          title={`Use ${pending.label}?`}
          body={
            <ul class="dialog-list">
              {pending.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          }
          confirmLabel="Use it"
          tone="primary"
          onCancel={() => {
            setPending(null);
          }}
          onConfirm={() => {
            setPending(null);
            props.onChange(pending.access, pending.vendorSettings);
          }}
        />
      )}
    </>
  );
}

/** What the user should know about the agent's current access level, shown under the composer. */
export function AccessNotes(props: { readonly info: ProviderInfo | undefined; readonly binding: BoundProvider }) {
  const choices = accessChoices(props.info, props.binding);
  const current = keyOf(props.binding.access, props.binding.vendorSettings);
  const warnings = choices.options.find((option) => keyOf(option.access, option.vendorSettings) === current)?.warnings ?? [];
  const notes = choices.currentProblem === null ? warnings : [`This agent's access can't run now: ${choices.currentProblem}`, ...warnings];
  if (notes.length === 0) return null;
  return (
    <div class="access-notes">
      {notes.map((note) => (
        <div key={note} class="note warning">
          {note}
        </div>
      ))}
    </div>
  );
}
