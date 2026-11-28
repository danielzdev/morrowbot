import type { ModelFavorite, ProviderModel } from '@morrowbot/contracts';
import type { RefObject } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { modelState, unrunnableReason, type ModelState } from '../../shared/binding-ui/binding-state.ts';
import { ModelList } from '../../shared/binding-ui/ModelList.tsx';
import { OptionColumn } from '../../shared/binding-ui/OptionColumn.tsx';
import { ProviderRail } from '../../shared/binding-ui/ProviderRail.tsx';
import { isRunnable, withChoice, type ProviderChoice } from '../../shared/binding-ui/selection.ts';
import { isFavorite } from '../../shared/model-favorites.ts';
import { Icon } from '../../shared/ui/Icon.tsx';
import { Popover } from '../../shared/ui/Popover.tsx';
import type { BoundProvider } from './binding-display.ts';
import { FavoritesList } from './FavoritesList.tsx';
import { favoriteRows, openingTab, pickedBinding, type PickerTab } from './picker.ts';

const NOT_READY: ModelState = { kind: 'not-ready' };

/**
 * The composer's model picker: Favorites, then each provider's models, and the model's options. Every
 * pick is saved at once, another provider's too; access is not changed here (Agent Settings › Permissions).
 */
export function BindingPopover(props: {
  readonly agentName: string;
  readonly choices: readonly ProviderChoice[];
  readonly binding: BoundProvider;
  readonly anchor: RefObject<HTMLElement | null>;
  /** False for server members (including co-owners), who may not grant full access. */
  readonly allowFull: boolean;
  readonly favorites: readonly ModelFavorite[];
  readonly onToggleFavorite: (pluginId: string, modelId: string) => void;
  /** Saves the binding; resolves with why it was refused, or null once the host has it. */
  readonly onCommit: (next: BoundProvider) => Promise<string | null>;
  readonly redact: (text: string) => string;
  readonly onOpenProviders: () => void;
  readonly onClose: () => void;
}) {
  const { binding, choices } = props;
  const rows = favoriteRows(choices, props.favorites);
  const [tab, setTab] = useState<PickerTab>(() => openingTab(rows, binding));
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const saving = useRef(false);
  const commit = async (next: BoundProvider | null): Promise<void> => {
    if (next === null || saving.current) return;
    saving.current = true;
    setPending(true);
    setProblem(null);
    const refused = await props.onCommit(next);
    saving.current = false;
    setPending(false);
    if (refused !== null) setProblem(props.redact(refused));
  };
  const pick = (choice: ProviderChoice, model: ProviderModel | null): void => {
    void commit(pickedBinding(choice, model, binding, props.allowFull));
  };
  const own = choices.find(({ id }) => id === binding.pluginId);
  const ownModels = own !== undefined && isRunnable(own) ? modelState(own.info, binding.selection) : NOT_READY;
  const browsed = tab.kind === 'provider' ? choices.find(({ id }) => id === tab.id) : undefined;
  const browsingOwn = tab.kind === 'provider' && tab.id === binding.pluginId;
  return (
    <Popover anchor={props.anchor} label={`${props.agentName}: model and effort`} width={540} side="top" align="end" class="binding-popover" onClose={props.onClose}>
      <header class="binding-header">
        <span>{`${props.agentName} · applies to all its chats`}</span>
        {pending && <span class="muted">Saving…</span>}
      </header>
      <div class="binding-columns">
        <div class="picker-rail">
          <button
            type="button"
            class={`favorites-tab ${tab.kind === 'favorites' ? 'selected' : ''}`}
            aria-label="Favorites"
            aria-pressed={tab.kind === 'favorites'}
            title="Favorites"
            onClick={() => { setTab({ kind: 'favorites' }); }}
          >
            <Icon name="star" />
          </button>
          <ProviderRail
            label="Providers"
            layout="rail"
            choices={choices}
            selected={tab.kind === 'provider' ? tab.id : null}
            onPick={(id) => { setTab({ kind: 'provider', id }); }}
          />
        </div>
        <div class="binding-models">
          {tab.kind === 'favorites' ? (
            <FavoritesList
              rows={rows}
              binding={binding}
              disabled={pending}
              onPick={({ choice, model }) => { pick(choice, model); }}
              onUnstar={({ choice, model }) => { props.onToggleFavorite(choice.id, model.id); }}
            />
          ) : browsed === undefined || !isRunnable(browsed) ? (
            <div class="binding-unrunnable">
              <p class="binding-note">{unrunnableReason(browsed, browsingOwn ? binding : null, props.redact)}</p>
              <button type="button" class="btn secondary" onClick={props.onOpenProviders}>Open Providers</button>
            </div>
          ) : (
            <>
              {!browsingOwn && (
                <button type="button" class="btn secondary switch-button" disabled={pending} onClick={() => { pick(browsed, null); }}>
                  {`Switch to ${browsed.name}`}
                </button>
              )}
              <ModelList
                key={browsed.id}
                state={modelState(browsed.info, browsingOwn ? binding.selection : { kind: 'default' })}
                runtime={browsed.runtime}
                disabled={pending}
                showCurrent={browsingOwn}
                stars={{
                  starred: (modelId) => isFavorite(props.favorites, browsed.id, modelId),
                  onToggle: (modelId) => { props.onToggleFavorite(browsed.id, modelId); },
                }}
                onPick={(model) => { pick(browsed, model); }}
              />
            </>
          )}
        </div>
        <OptionColumn
          state={browsingOwn || tab.kind === 'favorites' ? ownModels : NOT_READY}
          disabled={pending}
          arrowsSelect={false}
          onChoose={(optionId, choiceId) => void commit({ ...binding, selection: withChoice(binding.selection, optionId, choiceId) })}
        />
      </div>
      {problem !== null && (
        <footer class="binding-footer">
          <p class="binding-note danger" role="alert">{`The change was not saved: ${problem}`}</p>
        </footer>
      )}
    </Popover>
  );
}
