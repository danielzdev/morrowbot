import type { VaultItem } from '@morrowbot/contracts';
import { z } from 'zod';
import type { ToolPorts } from './ports.ts';
import { done, tool, type Tool } from './tool.ts';

/** What the model sees of an item: names, never a secret, even if a new field is added to `VaultItem`. */
function shown(item: VaultItem): object {
  const { id, kind, label, site } = item;
  switch (item.kind) {
    case 'login':
      return { id, kind, label, site, username: item.username, hasTotp: item.hasTotp };
    case 'api_key':
      return { id, kind, label, site };
    case 'header_secret':
      return { id, kind, label, site, headerName: item.headerName };
  }
}

export function vaultTools({ vault }: ToolPorts): Tool[] {
  return [
    tool({
      name: 'list_vault_items',
      description:
        "Lists the user's vault: saved website logins, API keys and HTTP header secrets, by id, kind, name and site. You never see a password, key, header value or two-step code; a tool that takes a vaultId uses the secret for you.",
      input: z.strictObject({}),
      run: () => done({ items: vault.list().map(shown) }),
    }),
  ];
}
