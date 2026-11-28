import type { ProviderBinding } from '@morrowbot/contracts';
import { useEffect, useRef, useState } from 'preact/hooks';
import { turnsOnFull } from '../../shared/binding-ui/binding-state.ts';
import { FullAccessNotice } from '../../shared/binding-ui/FullAccessNotice.tsx';
import { ProviderGlyph } from '../../shared/binding-ui/ProviderGlyph.tsx';
import type { ProviderChoice } from '../../shared/binding-ui/selection.ts';
import { ariaShortcut, PLATFORM } from '../../shared/keys.ts';
import type { ModelFavoritesModel } from '../../shared/model-favorites.ts';
import { Icon } from '../../shared/ui/Icon.tsx';
import { useStore } from '../../shared/use-store.ts';
import { bindingPill, type BoundProvider } from './binding-display.ts';
import { BindingPopover } from './BindingPopover.tsx';

const NOTE_MS = 4000;

/**
 * The composer's model pill beside Send, which opens the model picker. `openRequest` changes on ⇧⌘M.
 * Access is not shown here: it lives in Agent Settings › Permissions.
 */
export function BindingControl(props: {
  readonly agentName: string;
  readonly choices: readonly ProviderChoice[];
  /** The bound provider's entry; undefined when it is not installed. */
  readonly choice: ProviderChoice | undefined;
  readonly binding: ProviderBinding;
  /** Changes on ⇧⌘M: open the binding popover. */
  readonly openRequest: number;
  /** False for server members (including co-owners), who may not grant full access. */
  readonly allowFull: boolean;
  readonly favorites: ModelFavoritesModel;
  readonly onCommit: (next: BoundProvider) => Promise<string | null>;
  readonly redact: (text: string) => string;
  readonly onOpenProviders: () => void;
  readonly onOpenBrain: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(false);
  const [notice, setNotice] = useState(false);
  const favorites = useStore(props.favorites.state);
  const button = useRef<HTMLButtonElement>(null);
  const seen = useRef(props.openRequest);
  useEffect(() => {
    void props.favorites.load();
  }, [props.favorites]);
  useEffect(() => {
    if (props.openRequest === seen.current) return;
    seen.current = props.openRequest;
    if (props.binding.kind === 'bound') setOpen(true);
    else props.onOpenBrain();
  }, [props.openRequest]);
  useEffect(() => {
    if (open) void props.favorites.load();
  }, [open]);
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => {
      setNote(false);
    }, NOTE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [note]);
  const { binding } = props;
  if (binding.kind === 'unbound') {
    return (
      <button type="button" class="pill warn" onClick={props.onOpenBrain}>
        {`Choose a provider for ${props.agentName}`}
      </button>
    );
  }
  const { choice } = props;
  const model = bindingPill(choice, binding);
  return (
    <div class="binding-pills">
      {note && <span class="binding-applies" role="status">{`Applies to all of ${props.agentName}'s chats`}</span>}
      <button
        ref={button}
        type="button"
        class={`pill ${model.warn ? 'warn' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts={ariaShortcut('binding', PLATFORM)}
        onClick={() => { setOpen(!open); }}
      >
        <ProviderGlyph id={binding.pluginId} name={choice?.name ?? '?'} size="sm" />
        <span>{model.label}</span>
        <Icon name="chevron-down" />
      </button>
      {open && (
        <BindingPopover
          agentName={props.agentName}
          choices={props.choices}
          binding={binding}
          anchor={button}
          allowFull={props.allowFull}
          favorites={favorites}
          onToggleFavorite={(pluginId, modelId) => void props.favorites.toggle(pluginId, modelId)}
          redact={props.redact}
          onOpenProviders={() => {
            setOpen(false);
            props.onOpenProviders();
          }}
          onCommit={async (next) => {
            const refused = await props.onCommit(next);
            if (refused === null) {
              setNote(true);
              if (turnsOnFull(binding, next)) setNotice(true);
            }
            return refused;
          }}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
      {notice && <FullAccessNotice agentName={props.agentName} onClose={() => { setNotice(false); }} />}
    </div>
  );
}
