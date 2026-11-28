import type { SecretFillRequest, SecretResolution } from '@morrowbot/contracts';
import type { ResolvedVaultItem, VaultService } from './vault-service.ts';

/** An API key's or header secret's value, for a connector at the moment it connects. Rejects when the Vault cannot be read. */
export async function keyValue(vault: VaultService, vaultId: string): Promise<{ readonly kind: 'value'; readonly value: string } | { readonly kind: 'missing' } | { readonly kind: 'login' }> {
  const resolved = await vault.resolve(vaultId);
  switch (resolved?.kind) {
    case undefined:
      return { kind: 'missing' };
    case 'login':
      return { kind: 'login' };
    case 'api_key':
      return { kind: 'value', value: resolved.key };
    case 'header_secret':
      return { kind: 'value', value: resolved.value };
  }
}

const refused = (reason: string): SecretResolution => ({ kind: 'refused', reason });

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Whether a page on `origin` may take the login saved for `site`. The page's host must be the site's host or one
 * of its subdomains. A site saved with a scheme or port must match it exactly; otherwise the page must be https
 * (or http on this computer).
 */
export function siteMatches(site: string, origin: string): boolean {
  const page = URL.parse(origin);
  const explicit = /^[a-z][a-z0-9+.-]*:\/\//i.test(site);
  const saved = URL.parse(explicit ? site : `https://${site}`);
  if (page === null || saved === null || page.origin !== origin || saved.hostname === '') return false;
  const host = (url: URL): string => url.hostname.toLowerCase().replace(/\.$/, '');
  const pageHost = host(page);
  const savedHost = host(saved);
  if (pageHost !== savedHost && !pageHost.endsWith(`.${savedHost}`)) return false;
  if (saved.port !== '' && page.port !== saved.port) return false;
  if (explicit) return page.protocol === saved.protocol;
  return page.protocol === 'https:' || (page.protocol === 'http:' && LOOPBACK.has(pageHost));
}

/**
 * One part of a login for a browser plugin to type into a page on `origin`: the username, the password, or a
 * sign-in code made now. Refused unless the login's site matches the page, so a page cannot take another site's login.
 * Reasons never hold a secret.
 */
export async function loginFill(vault: VaultService, request: SecretFillRequest): Promise<SecretResolution> {
  let resolved: ResolvedVaultItem | undefined;
  try {
    resolved = await vault.resolve(request.vaultId);
  } catch {
    return refused('The Secrets Vault could not be read. Ask the person to check Settings › Vault.');
  }
  if (resolved === undefined) return refused(`There is no vault item ${request.vaultId}. Call list_vault_items for the current ones.`);
  if (resolved.kind !== 'login') return refused(`Vault item "${resolved.item.label}" is not a login, so it is never typed into a page.`);
  const { item } = resolved;
  if (item.site === null) return refused(`Vault login "${item.label}" has no website saved, so it is filled nowhere. Ask the person to add its site in Settings › Vault.`);
  if (!siteMatches(item.site, request.origin)) {
    return refused(`Vault login "${item.label}" is for ${item.site}, but this tab is on ${request.origin}. Nothing was filled. Check you are on the right site.`);
  }
  switch (request.field) {
    case 'username':
      return { kind: 'value', value: item.username };
    case 'password':
      return { kind: 'value', value: resolved.password };
    case 'one-time-code':
      return resolved.oneTimeCode === null
        ? refused(`Vault login "${item.label}" has no authenticator key. Ask the person for the code (request a takeover).`)
        : { kind: 'value', value: resolved.oneTimeCode() };
  }
}
