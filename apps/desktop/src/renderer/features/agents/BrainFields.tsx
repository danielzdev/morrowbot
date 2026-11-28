import type { ProviderBinding } from '@morrowbot/contracts';
import { AccessSegment } from '../../shared/binding-ui/AccessSegment.tsx';
import { accessState, modelState, unrunnableReason } from '../../shared/binding-ui/binding-state.ts';
import { ModelList } from '../../shared/binding-ui/ModelList.tsx';
import { OptionColumn } from '../../shared/binding-ui/OptionColumn.tsx';
import { ProviderRail } from '../../shared/binding-ui/ProviderRail.tsx';
import { isRunnable, newBinding, pinModel, switchBinding, withChoice, type ProviderChoice } from '../../shared/binding-ui/selection.ts';

/**
 * Provider cards, then the chosen provider's models, options and (when `showAccess` is true) access,
 * inline (spec §5.1, §5.2). Every pick only changes the staged `value`; the form around it decides
 * when to save.
 */
export function BrainFields(props: {
  readonly choices: readonly ProviderChoice[];
  readonly value: ProviderBinding;
  readonly showAccess: boolean;
  /** False for server members (including co-owners), who may not grant full access. */
  readonly allowFull: boolean;
  readonly onChange: (next: ProviderBinding) => void;
  readonly redact: (text: string) => string;
  readonly onOpenProviders: () => void;
}) {
  const { value } = props;
  const choice = value.kind === 'bound' ? props.choices.find(({ id }) => id === value.pluginId) : undefined;
  const runnable = choice !== undefined && isRunnable(choice);
  const models = value.kind === 'bound' && runnable ? modelState(choice.info, value.selection) : null;
  return (
    <div class="brain-fields">
      {props.choices.length === 0 ? (
        <p class="binding-note">No providers are installed.</p>
      ) : (
        <ProviderRail
          label="Provider"
          layout="cards"
          choices={props.choices}
          selected={value.kind === 'bound' ? value.pluginId : null}
          onPick={(id) => {
            const picked = props.choices.find((each) => each.id === id);
            if (picked !== undefined && (value.kind !== 'bound' || value.pluginId !== id)) {
              const options = { allowFull: props.allowFull };
              props.onChange(props.showAccess ? switchBinding(picked, value, options) : newBinding(picked, options));
            }
          }}
        />
      )}
      {value.kind === 'unbound' && !props.choices.some(isRunnable) && props.choices.length > 0 && (
        <div class="row">
          <span class="binding-note">No provider is ready yet.</span>
          <button type="button" class="btn secondary" onClick={props.onOpenProviders}>
            Set up a provider
          </button>
        </div>
      )}
      {value.kind === 'bound' && !runnable && (
        <div class="row">
          <span class="binding-note warn">{unrunnableReason(choice, value, props.redact)}</span>
          <button type="button" class="btn secondary" onClick={props.onOpenProviders}>
            Open Providers
          </button>
        </div>
      )}
      {value.kind === 'bound' && models !== null && (
        <>
          <div class="brain-models">
            <ModelList
              key={value.pluginId}
              state={models}
              runtime={choice?.runtime ?? ''}
              disabled={false}
              onPick={(model) => {
                props.onChange({ ...value, selection: pinModel(model) });
              }}
            />
            <OptionColumn
              state={models}
              disabled={false}
              onChoose={(optionId, choiceId) => {
                props.onChange({ ...value, selection: withChoice(value.selection, optionId, choiceId) });
              }}
            />
          </div>
          {props.showAccess && (
            <AccessSegment
              state={accessState(choice?.info, value)}
              value={value}
              disabled={false}
              redact={props.redact}
              onPick={(profile) => {
                props.onChange({ ...value, access: profile.access, vendorSettings: profile.vendorSettings });
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
