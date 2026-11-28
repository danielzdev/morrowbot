import type { VaultItem } from '@morrowbot/contracts';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';
import { Icon } from '../../shared/ui/Icon.tsx';
import { ROWS } from './settings-index.ts';
import { SettingRow } from './SettingRow.tsx';
import { createVaultRequest, draftOf, EMPTY_VAULT_DRAFT, KIND_LABELS, searchVault, updateVaultRequest, vaultDetail, type VaultDraft, type VaultPort } from './vault.ts';
import { VaultForm } from './VaultForm.tsx';

type Loaded = { readonly kind: 'loading' } | { readonly kind: 'loaded'; readonly items: readonly VaultItem[] } | { readonly kind: 'failed'; readonly message: string };

type Editing =
  | { readonly kind: 'idle' }
  | { readonly kind: 'open'; readonly item: VaultItem | null; readonly busy: boolean; readonly error: string | null };

/** Settings › Vault: add, find, change and delete the logins, API keys and header secrets tools use for agents. */
export function VaultSection(props: { readonly port: VaultPort }) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [editing, setEditing] = useState<Editing>({ kind: 'idle' });
  const [draft, setDraft] = useState<VaultDraft>(EMPTY_VAULT_DRAFT);
  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState<VaultItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const live = useRef(true);

  const load = async (): Promise<void> => {
    const result = await props.port.listVault();
    if (!live.current) return;
    setLoaded(result.kind === 'ok' ? { kind: 'loaded', items: result.value.items } : { kind: 'failed', message: result.error.message });
  };
  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
    };
  }, []);

  const open = (item: VaultItem | null): void => {
    setNotice(null);
    setDraft(item === null ? EMPTY_VAULT_DRAFT : draftOf(item));
    setEditing({ kind: 'open', item, busy: false, error: null });
  };
  const close = (): void => {
    setDraft(EMPTY_VAULT_DRAFT);
    setEditing({ kind: 'idle' });
  };

  const submit = async (item: VaultItem | null): Promise<void> => {
    setEditing({ kind: 'open', item, busy: true, error: null });
    const result = item === null ? await props.port.createVaultItem(createVaultRequest(draft)) : await props.port.updateVaultItem(item.id, updateVaultRequest(item, draft));
    if (!live.current) return;
    if (result.kind === 'failed') {
      setEditing({ kind: 'open', item, busy: false, error: result.error.message });
      return;
    }
    close();
    setNotice(item === null ? `Added ${result.value.label}.` : `Saved ${result.value.label}.`);
    await load();
  };

  const remove = async (item: VaultItem): Promise<void> => {
    setDeleting(null);
    const result = await props.port.deleteVaultItem(item.id);
    if (!live.current) return;
    setNotice(result.kind === 'ok' ? `Deleted ${item.label} and its secret.` : `Couldn't delete ${item.label}: ${result.error.message}`);
    await load();
  };

  const items = loaded.kind === 'loaded' ? loaded.items : [];
  const shown = searchVault(items, query);
  return (
    <>
      <SettingRow entry={ROWS.vault}>
        <button
          type="button"
          class="btn primary"
          disabled={editing.kind === 'open' || loaded.kind !== 'loaded'}
          onClick={() => {
            open(null);
          }}
        >
          Add item
        </button>
      </SettingRow>
      {editing.kind === 'open' && (
        <VaultForm draft={draft} editing={editing.item} busy={editing.busy} error={editing.error} onDraft={setDraft} onSubmit={() => void submit(editing.item)} onCancel={close} />
      )}
      <SettingRow entry={ROWS.vaultItems}>
        {loaded.kind === 'loaded' && <span class="setting-note">{items.length === 1 ? '1 item' : `${String(items.length)} items`}</span>}
      </SettingRow>
      {notice !== null && (
        <p class="setting-note devices-notice" role="status">
          {notice}
        </p>
      )}
      {loaded.kind === 'loaded' && items.length > 0 && (
        <div class="vault-search">
          <Icon name="search" />
          <input
            type="search"
            aria-label="Search the vault"
            placeholder="Search by name, site or username"
            value={query}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
            }}
          />
        </div>
      )}
      {loaded.kind === 'loading' && <p class="muted devices-empty">Loading the vault…</p>}
      {loaded.kind === 'failed' && (
        <div class="banner error devices-banner" role="alert">
          <span>{loaded.message}</span>
          <button type="button" class="btn secondary" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}
      {loaded.kind === 'loaded' && items.length === 0 && <p class="muted devices-empty">Nothing saved yet. Add a login or key, then tell an agent its name.</p>}
      {loaded.kind === 'loaded' && items.length > 0 && shown.length === 0 && <p class="muted devices-empty">No items match “{query.trim()}”.</p>}
      {shown.length > 0 && (
        <ul class="device-list" aria-label="Vault items">
          {shown.map((item) => (
            <li key={item.id} class="device-row">
              <span class="device-icon" title={KIND_LABELS[item.kind]}>
                <Icon name="lock" />
              </span>
              <div class="device-text">
                <div class="device-name">{item.label}</div>
                <div class="device-detail">{vaultDetail(item)}</div>
              </div>
              <div class="vault-actions">
                <button
                  type="button"
                  class="btn secondary"
                  aria-label={`Edit ${item.label}`}
                  disabled={editing.kind === 'open'}
                  onClick={() => {
                    open(item);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  class="btn secondary"
                  aria-label={`Delete ${item.label}`}
                  onClick={() => {
                    setDeleting(item);
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {deleting !== null && (
        <ConfirmDialog
          title={`Delete ${deleting.label}?`}
          body={<p>Its secret is erased from this computer. Tools that use it stop working until you add it again.</p>}
          confirmLabel="Delete"
          tone="danger"
          onConfirm={() => void remove(deleting)}
          onCancel={() => {
            setDeleting(null);
          }}
        />
      )}
    </>
  );
}
