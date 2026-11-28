import { BROWSER_BRIDGE_DEFAULT_PORT, ExtensionInstanceId, PairingToken } from '@morrowbot/contracts';
import { z } from 'zod';

/** Where the extension finds the Ori Bot plugin, how it proves it was paired, and which installed copy it is. */
export const Pairing = z.object({ port: z.number().int().min(1024).max(65535), token: PairingToken, instanceId: ExtensionInstanceId });
export type Pairing = z.infer<typeof Pairing>;

const KEY = 'pairing';

/** 32 random bytes as base64url: the token the person pastes into the plugin's settings. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** The saved pairing; the first call makes one with a fresh token and the default port. */
export async function loadPairing(storage: chrome.storage.StorageArea): Promise<Pairing> {
  const stored: unknown = (await storage.get(KEY))[KEY];
  const parsed = Pairing.safeParse(stored);
  if (parsed.success) return parsed.data;
  const fresh: Pairing = { port: BROWSER_BRIDGE_DEFAULT_PORT, token: newToken(), instanceId: newToken() };
  await savePairing(storage, fresh);
  return fresh;
}

export async function savePairing(storage: chrome.storage.StorageArea, pairing: Pairing): Promise<void> {
  await storage.set({ [KEY]: pairing });
}

export const PAIRING_KEY = KEY;
