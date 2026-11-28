import type { ConnectorSetup } from '@morrowbot/contracts';
import { composioUrl } from './reach.ts';

/** What the Vault holds under an id, as a connector may use it: an API key's or header secret's value, or why not. */
export type VaultValue = { readonly kind: 'value'; readonly value: string } | { readonly kind: 'missing' } | { readonly kind: 'login' };

/** Reads one Vault item's value (the vault feature provides it). Rejects when the Vault cannot be read. */
export type VaultLookup = (vaultId: string) => Promise<VaultValue>;

interface Named {
  readonly name: string;
  readonly value: string;
}

/** What a connection sends, with every Vault item read. It lives only as long as that connection. */
export type Reach =
  | { readonly kind: 'stdio'; readonly command: string; readonly args: readonly string[]; readonly env: readonly Named[] }
  | { readonly kind: 'http'; readonly url: string; readonly headers: readonly Named[] };

export type Reached = { readonly kind: 'ready'; readonly reach: Reach } | { readonly kind: 'refused'; readonly message: string };

type Secret = { readonly kind: 'inline'; readonly value: string } | { readonly kind: 'vault'; readonly vaultId: string };

class Refused extends Error {}

async function valueOf(secret: Secret, what: string, lookup: VaultLookup): Promise<string> {
  switch (secret.kind) {
    case 'inline':
      return secret.value;
    case 'vault': {
      const found = await lookup(secret.vaultId).catch(() => {
        throw new Refused(`${what}: the Vault could not be read. Check Settings › Vault, then Reconnect.`);
      });
      switch (found.kind) {
        case 'value':
          return found.value;
        case 'missing':
          throw new Refused(`${what}: its Vault item was deleted. Edit the connector and pick another.`);
        case 'login':
          throw new Refused(`${what}: its Vault item is a login. Pick an API key or header secret.`);
      }
    }
  }
}

const named = (entries: readonly (Secret & { readonly name: string })[], noun: string, lookup: VaultLookup): Promise<Named[]> =>
  Promise.all(entries.map(async (entry) => ({ name: entry.name, value: await valueOf(entry, `${noun} ${entry.name}`, lookup) })));

/** The setup with its Vault items read, at the moment it connects; or which item is missing, in words that hold no value. */
export async function reachOf(setup: ConnectorSetup, lookup: VaultLookup): Promise<Reached> {
  try {
    switch (setup.kind) {
      case 'stdio':
        return { kind: 'ready', reach: { kind: 'stdio', command: setup.command, args: setup.args, env: await named(setup.env, 'Variable', lookup) } };
      case 'http':
        return { kind: 'ready', reach: { kind: 'http', url: setup.url, headers: await named(setup.headers, 'Header', lookup) } };
      case 'composio': {
        const key = await valueOf(setup.apiKey, 'API key', lookup);
        return { kind: 'ready', reach: { kind: 'http', url: composioUrl(setup), headers: [{ name: 'x-api-key', value: key }] } };
      }
    }
  } catch (error) {
    if (error instanceof Refused) return { kind: 'refused', message: error.message };
    throw error;
  }
}

/** Replaces each secret value the connection sends in `text`, so a server echoing one back cannot surface it in a status or a refusal. */
export function hideSecrets(reach: Reach, text: string): string {
  const values = reach.kind === 'stdio' ? reach.env : reach.headers;
  return values
    .map(({ value }) => value)
    .filter((value) => value.length >= 4)
    .sort((a, b) => b.length - a.length)
    .reduce((hidden, value) => hidden.replaceAll(value, '[hidden]'), text);
}
