import type { VaultItem, VaultItemList } from '@morrowbot/contracts';
import type { Loadable } from '../../shared/store.ts';
import type { SecretSource } from './setup-draft.ts';

/** Only keys and header secrets can fill a connector's secret; a login cannot. */
export const usable = (item: VaultItem): boolean => item.kind !== 'login';

const KIND_WORD: Record<VaultItem['kind'], string> = { login: 'Login', api_key: 'API key', header_secret: 'Header secret' };

/** The usable Vault items; none while the list has not loaded. */
export function usableItems(vault: Loadable<VaultItemList>): readonly VaultItem[] {
  return vault.kind === 'loaded' ? vault.value.items.filter(usable) : [];
}

/** What the saved choice reads as when its item is not among the usable ones. */
function missingLabel(vault: Loadable<VaultItemList>, vaultId: string): string {
  if (vault.kind !== 'loaded') return 'Vault item';
  const found = vault.value.items.find((item) => item.id === vaultId);
  return found === undefined ? 'Deleted Vault item' : `${found.label} · ${KIND_WORD[found.kind]}, can't be used`;
}

/** A short "type a value, or take it from the Vault" choice for one secret. */
export function VaultSelect(props: {
  readonly label: string;
  readonly source: SecretSource;
  readonly vault: Loadable<VaultItemList>;
  readonly onChange: (source: SecretSource, item: VaultItem | null) => void;
}) {
  const items = usableItems(props.vault);
  const { source } = props;
  const chosen = source.kind === 'vault' ? source.vaultId : '';
  const missing = source.kind === 'vault' && !items.some((item) => item.id === source.vaultId);
  return (
    <select
      class="vault-select"
      aria-label={props.label}
      value={chosen}
      onChange={(event) => {
        const id = event.currentTarget.value;
        props.onChange(id === '' ? { kind: 'typed' } : { kind: 'vault', vaultId: id }, items.find((item) => item.id === id) ?? null);
      }}
    >
      <option value="">Type a value</option>
      {source.kind === 'vault' && missing && <option value={source.vaultId}>{missingLabel(props.vault, source.vaultId)}</option>}
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {item.label} · {KIND_WORD[item.kind]}
        </option>
      ))}
    </select>
  );
}

/** Whether a secret has anything to choose from: usable items, or a Vault item already chosen. */
export const hasChoice = (vault: Loadable<VaultItemList>, sources: readonly SecretSource[]): boolean => usableItems(vault).length > 0 || sources.some(({ kind }) => kind === 'vault');

/** The line shown while the Vault loaded with nothing to pick. */
export const vaultHint = (vault: Loadable<VaultItemList>): string | null =>
  vault.kind === 'loaded' && usableItems(vault).length === 0 ? 'API keys and header secrets added in Settings › Vault can be picked here.' : null;
