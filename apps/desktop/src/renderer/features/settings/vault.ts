import type { CreateVaultItemRequest, UpdateVaultItemRequest, VaultItem, VaultItemKind } from '@morrowbot/contracts';
import type { z } from 'zod';
import type { Api } from '../../shared/api.ts';

/** The host calls Settings › Vault makes. */
export type VaultPort = Pick<Api, 'listVault' | 'createVaultItem' | 'updateVaultItem' | 'deleteVaultItem'>;

/**
 * What the item form holds. `secret` is the password, API key or header value; when editing, it starts empty
 * and an empty one keeps the saved secret. The host never sends a saved secret back, so the form cannot show it.
 */
export interface VaultDraft {
  readonly kind: VaultItemKind;
  readonly label: string;
  readonly site: string;
  readonly username: string;
  readonly headerName: string;
  readonly secret: string;
  /** A new authenticator setup key; empty keeps the saved one (or none). */
  readonly twoStepKey: string;
  readonly removeTwoStepKey: boolean;
}

export const EMPTY_VAULT_DRAFT: VaultDraft = { kind: 'login', label: '', site: '', username: '', headerName: '', secret: '', twoStepKey: '', removeTwoStepKey: false };

export const KIND_LABELS: Readonly<Record<VaultItemKind, string>> = { login: 'Login', api_key: 'API key', header_secret: 'Header secret' };

export const SECRET_LABELS: Readonly<Record<VaultItemKind, string>> = { login: 'Password', api_key: 'Key', header_secret: 'Header value' };

/** The form for changing `item`: its names filled in, every secret left blank. */
export function draftOf(item: VaultItem): VaultDraft {
  const base = { ...EMPTY_VAULT_DRAFT, kind: item.kind, label: item.label, site: item.site ?? '' };
  switch (item.kind) {
    case 'login':
      return { ...base, username: item.username };
    case 'api_key':
      return base;
    case 'header_secret':
      return { ...base, headerName: item.headerName };
  }
}

/** Why the draft cannot be saved yet, or null. `editing` is the item being changed, null for a new one. */
export function vaultDraftProblem(draft: VaultDraft, editing: VaultItem | null): string | null {
  if (draft.label.trim() === '') return 'Give it a name agents will see.';
  if (draft.kind === 'login' && draft.username.trim() === '') return 'Enter the username or email.';
  if (draft.kind === 'header_secret' && draft.headerName.trim() === '') return 'Enter the header name, such as Authorization.';
  if (editing === null && draft.secret === '') return `Enter the ${SECRET_LABELS[draft.kind].toLowerCase()}.`;
  return null;
}

const siteOf = (draft: VaultDraft): string | null => (draft.site.trim() === '' ? null : draft.site.trim());

export function createVaultRequest(draft: VaultDraft): z.input<typeof CreateVaultItemRequest> {
  const common = { label: draft.label.trim(), site: siteOf(draft) };
  switch (draft.kind) {
    case 'login':
      return { kind: 'login', ...common, username: draft.username.trim(), password: draft.secret, twoStepKey: draft.twoStepKey.trim() === '' ? null : draft.twoStepKey };
    case 'api_key':
      return { kind: 'api_key', ...common, key: draft.secret };
    case 'header_secret':
      return { kind: 'header_secret', ...common, headerName: draft.headerName.trim(), value: draft.secret };
  }
}

/** Only what changed: a blank secret or setup key keeps the saved one. */
export function updateVaultRequest(item: VaultItem, draft: VaultDraft): z.input<typeof UpdateVaultItemRequest> {
  const label = draft.label.trim();
  const site = siteOf(draft);
  const common = { ...(label === item.label ? {} : { label }), ...(site === item.site ? {} : { site }) };
  const secret = draft.secret === '' ? null : draft.secret;
  switch (item.kind) {
    case 'login': {
      const username = draft.username.trim();
      const twoStepKey = draft.removeTwoStepKey ? null : draft.twoStepKey.trim() === '' ? undefined : draft.twoStepKey;
      return {
        kind: 'login',
        ...common,
        ...(username === item.username ? {} : { username }),
        ...(secret === null ? {} : { password: secret }),
        ...(twoStepKey === undefined ? {} : { twoStepKey }),
      };
    }
    case 'api_key':
      return { kind: 'api_key', ...common, ...(secret === null ? {} : { key: secret }) };
    case 'header_secret': {
      const headerName = draft.headerName.trim();
      return { kind: 'header_secret', ...common, ...(headerName === item.headerName ? {} : { headerName }), ...(secret === null ? {} : { value: secret }) };
    }
  }
}

/** Items whose name, site, username or header name hold every word of `query` (any case). */
export function searchVault(items: readonly VaultItem[], query: string): readonly VaultItem[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter((word) => word !== '');
  return items.filter((item) => {
    const text = [item.label, item.site ?? '', item.kind === 'login' ? item.username : '', item.kind === 'header_secret' ? item.headerName : ''].join(' ').toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** The line under an item's name. */
export function vaultDetail(item: VaultItem): string {
  const site = item.site === null ? [] : [item.site];
  switch (item.kind) {
    case 'login':
      return [KIND_LABELS.login, ...site, item.username, ...(item.hasTotp ? ['Two-step codes'] : [])].join(' · ');
    case 'api_key':
      return [KIND_LABELS.api_key, ...site].join(' · ');
    case 'header_secret':
      return [KIND_LABELS.header_secret, item.headerName, ...site].join(' · ');
  }
}
