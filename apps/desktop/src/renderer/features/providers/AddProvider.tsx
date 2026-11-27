import { useRef, useState } from 'preact/hooks';
import { Popover } from '../../shared/ui/Popover.tsx';
import { Icon } from '../../shared/ui/Icon.tsx';
import { providerStatus } from './provider-status.ts';
import type { ProviderCard } from './providers-model.ts';

/**
 * "+ Add provider" (spec §6.2): the providers not set up yet, each opening its detail at the setup
 * step, and where community providers come from.
 */
export function AddProvider(props: { readonly cards: readonly ProviderCard[]; readonly onPick: (id: string) => void; readonly onOpenExtensions: () => void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const needSetup = props.cards.filter(({ entry, info }) => providerStatus(entry, info).setup !== null);
  return (
    <>
      <button ref={anchor} type="button" class="btn ghost add-provider" aria-expanded={open} onClick={() => { setOpen(!open); }}>
        <Icon name="plus" />
        Add provider
      </button>
      {open && (
        <Popover anchor={anchor} label="Add provider" class="add-provider-pop" side="top" onClose={() => { setOpen(false); }}>
          <div class="kicker">Set up</div>
          {needSetup.length === 0 && <p class="muted">Every built-in provider is installed and signed in.</p>}
          {needSetup.map(({ entry }) => (
            <button
              key={entry.manifest.id}
              type="button"
              class="menu-item"
              onClick={() => {
                setOpen(false);
                props.onPick(entry.manifest.id);
              }}
            >
              {entry.manifest.name}
            </button>
          ))}
          <div class="kicker">Community</div>
          <p class="muted">Plugins can add more providers. They appear here, tagged Community.</p>
          <button
            type="button"
            class="menu-item"
            onClick={() => {
              setOpen(false);
              props.onOpenExtensions();
            }}
          >
            Open Extensions →
          </button>
        </Popover>
      )}
    </>
  );
}
