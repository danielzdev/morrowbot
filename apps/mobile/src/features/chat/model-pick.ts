import type { ModelOption, ModelSelection, ProviderInfo, ProviderModel } from '@morrowbot/contracts';

/** What the composer pill shows: the model, and its effort level when the model has one. */
export interface ModelPick {
  readonly model: ProviderModel;
  readonly effort: { readonly option: ModelOption; readonly choiceId: string } | null;
}

/** The models a provider offers right now; none while it is signed out, missing or still loading them. */
export function modelsOf(info: ProviderInfo | null): readonly ProviderModel[] {
  return info?.kind === 'ready' ? info.models : [];
}

/** The option that sets how hard the model thinks, by its id; otherwise its first option. */
export function effortOption(model: ProviderModel): ModelOption | null {
  return model.options.find(({ id }) => /effort|reasoning|thinking/i.test(id)) ?? model.options[0] ?? null;
}

/** The model and effort a selection means, resolving `default` to the provider's default model. */
export function pickOf(selection: ModelSelection, models: readonly ProviderModel[]): ModelPick | null {
  const model =
    selection.kind === 'model'
      ? models.find(({ id }) => id === selection.id)
      : (models.find(({ isDefault }) => isDefault) ?? models[0]);
  if (model === undefined) return null;
  const option = effortOption(model);
  if (option === null) return { model, effort: null };
  const chosen = selection.kind === 'model' ? selection.choices[option.id] : undefined;
  const choiceId = option.choices.some(({ id }) => id === chosen) && chosen !== undefined ? chosen : option.defaultChoiceId;
  return { model, effort: { option, choiceId } };
}

/** A selection of `model` that keeps each of its options at the current choice where it still exists. */
export function selectModel(current: ModelSelection, model: ProviderModel): ModelSelection {
  const before = current.kind === 'model' ? current.choices : {};
  const choices = Object.fromEntries(
    model.options.map((option) => {
      const kept = before[option.id];
      return [option.id, kept !== undefined && option.choices.some(({ id }) => id === kept) ? kept : option.defaultChoiceId];
    }),
  );
  return { kind: 'model', id: model.id, choices };
}

/** The selection with the effort option of `pick` set to `choiceId`. */
export function selectEffort(current: ModelSelection, pick: ModelPick, choiceId: string): ModelSelection {
  const base = selectModel(current, pick.model);
  if (base.kind !== 'model' || pick.effort === null) return base;
  return { ...base, choices: { ...base.choices, [pick.effort.option.id]: choiceId } };
}

/** "Opus · Medium", or just the model when it has no effort option. */
export function pickLabel(pick: ModelPick): string {
  const { effort } = pick;
  const choice = effort?.option.choices.find(({ id }) => id === effort.choiceId);
  return choice === undefined ? pick.model.label : `${pick.model.label} · ${choice.label}`;
}
