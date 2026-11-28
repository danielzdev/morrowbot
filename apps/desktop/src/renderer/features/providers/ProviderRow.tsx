import { ListRow, Pill } from '../../shared/ui/ListDetail.tsx';
import { Toggle } from '../../shared/ui/Toggle.tsx';
import { providerStatus, versionOf } from './provider-status.ts';
import type { ProviderCard } from './providers-model.ts';

/** The first letter of a provider's name, as its mark in lists. */
export function ProviderMark({ name }: { readonly name: string }) {
  return (
    <span class="item-mark" aria-hidden="true">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/** One provider in the list (spec §6.2): mark, name, a Community tag, the version, one status line and the switch. */
export function ProviderRow(props: {
  readonly card: ProviderCard;
  readonly selected: boolean;
  readonly tabStop: boolean;
  readonly redact: (text: string) => string;
  readonly onSelect: () => void;
  readonly onEnabled: (enabled: boolean) => void;
}) {
  const { entry } = props.card;
  const installing = props.card.busy === 'installing' ? 'install' : props.card.busy === 'updating' ? 'update' : null;
  const status = providerStatus(entry, props.card.info, props.card.busy === 'rechecking', installing);
  const version = versionOf(props.card.info);
  return (
    <ListRow
      label={entry.manifest.name}
      selected={props.selected}
      tabStop={props.tabStop}
      onSelect={props.onSelect}
      control={<Toggle label={`${entry.manifest.name} on`} checked={entry.enabled} disabled={props.card.busy !== null} onChange={props.onEnabled} />}
    >
      <ProviderMark name={entry.manifest.name} />
      <span class="item-text">
        <span class="item-name">
          {entry.manifest.name}
          {entry.source === 'user' && <span class="tag">Community</span>}
          {version !== null && <span class="mono item-version">{props.redact(version)}</span>}
        </span>
        <Pill tone={status.tone}>{status.title}</Pill>
      </span>
    </ListRow>
  );
}
