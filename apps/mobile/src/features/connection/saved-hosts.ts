import { EntityId, HostUrl } from '@morrowbot/contracts';
import { z } from 'zod';

/** A paired host as the Keychain keeps it. Only this feature ever reads `token`. */
export const HostProfile = z.strictObject({
  deviceId: EntityId,
  hostName: z.string().min(1),
  url: HostUrl,
  token: z.string().min(32),
});
export type HostProfile = z.infer<typeof HostProfile>;

export const SavedHosts = z.strictObject({
  version: z.literal(1),
  hosts: z.array(HostProfile),
  activeDeviceId: EntityId.nullable(),
});
export type SavedHosts = z.infer<typeof SavedHosts>;

export const NO_HOSTS: SavedHosts = { version: 1, hosts: [], activeDeviceId: null };

/** A small secret key-value store: the iOS Keychain in the app, memory in tests. */
export interface SecretStore {
  readonly read: (key: string) => Promise<string | null>;
  readonly write: (key: string, value: string) => Promise<void>;
  readonly remove: (key: string) => Promise<void>;
}

const KEY = 'morrowbot.hosts';

/** The saved hosts; none when nothing is saved, or (after `report`) when the saved item cannot be read. */
export async function loadHosts(store: SecretStore, report: (problem: string) => void): Promise<SavedHosts> {
  const text = await store.read(KEY);
  if (text === null) return NO_HOSTS;
  const parsed = SavedHosts.safeParse(parseJson(text));
  if (parsed.success) return parsed.data;
  report(`Ignored unreadable saved hosts: ${parsed.error.message}`);
  return NO_HOSTS;
}

export async function saveHosts(store: SecretStore, saved: SavedHosts): Promise<void> {
  if (saved.hosts.length === 0) await store.remove(KEY);
  else await store.write(KEY, JSON.stringify(SavedHosts.parse(saved)));
}

/** Adds or replaces the host (a host paired again gets a new device id) and makes it active. */
export function withHost(saved: SavedHosts, profile: HostProfile): SavedHosts {
  const others = saved.hosts.filter((host) => host.deviceId !== profile.deviceId && host.url !== profile.url);
  return { version: 1, hosts: [...others, profile], activeDeviceId: profile.deviceId };
}

/** Removes the host; when it was active, the first remaining host becomes active. */
export function withoutHost(saved: SavedHosts, deviceId: EntityId): SavedHosts {
  const hosts = saved.hosts.filter((host) => host.deviceId !== deviceId);
  const activeDeviceId = saved.activeDeviceId === deviceId ? (hosts[0]?.deviceId ?? null) : saved.activeDeviceId;
  return { version: 1, hosts, activeDeviceId };
}

export function withActive(saved: SavedHosts, deviceId: EntityId): SavedHosts {
  return saved.hosts.some((host) => host.deviceId === deviceId) ? { ...saved, activeDeviceId: deviceId } : saved;
}

function parseJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}
