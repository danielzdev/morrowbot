import { describe, expect, it } from 'vitest';
import { loadHosts, NO_HOSTS, saveHosts, withActive, withHost, withoutHost, type HostProfile, type SecretStore } from './saved-hosts.ts';

/** The Keychain stand-in: a Map, with what was written visible to the test. */
function memoryStore(initial: Record<string, string> = {}): SecretStore & { readonly items: Map<string, string> } {
  const items = new Map(Object.entries(initial));
  return {
    items,
    read: (key) => Promise.resolve(items.get(key) ?? null),
    write: (key, value) => {
      items.set(key, value);
      return Promise.resolve();
    },
    remove: (key) => {
      items.delete(key);
      return Promise.resolve();
    },
  };
}

const studio: HostProfile = { deviceId: 'dev-1', hostName: 'Studio Host', url: 'http://100.64.0.1:47800', token: 's'.repeat(43) };
const laptop: HostProfile = { deviceId: 'dev-2', hostName: 'My Mac', url: 'http://192.168.1.20:47800', token: 'm'.repeat(43) };

describe('saved hosts', () => {
  it('round-trips through the store, and forgetting the last host deletes the Keychain item', async () => {
    const store = memoryStore();
    const problems: string[] = [];
    const both = withHost(withHost(NO_HOSTS, studio), laptop);
    await saveHosts(store, withActive(both, 'dev-1'));
    const loaded = await loadHosts(store, (problem) => problems.push(problem));
    const afterForget = withoutHost(loaded, 'dev-1');
    await saveHosts(store, withoutHost(afterForget, 'dev-2'));
    expect({
      loaded: loaded.hosts.map((host) => host.hostName),
      active: loaded.activeDeviceId,
      activeAfterForget: afterForget.activeDeviceId,
      items: [...store.items.keys()],
      problems,
    }).toMatchInlineSnapshot(`
      {
        "active": "dev-1",
        "activeAfterForget": "dev-2",
        "items": [],
        "loaded": [
          "Studio Host",
          "My Mac",
        ],
        "problems": [],
      }
    `);
  });

  it('replaces a host paired again at the same address', () => {
    const repaired = withHost(withHost(NO_HOSTS, studio), { ...studio, deviceId: 'dev-3' });
    expect(repaired.hosts.map((host) => host.deviceId)).toEqual(['dev-3']);
  });

  it('starts empty and reports when the saved item is unreadable', async () => {
    const problems: string[] = [];
    const store = memoryStore({ 'morrowbot.hosts': '{"version":1,"hosts":[{"deviceId":"dev-1"}],"activeDeviceId":null}' });
    expect([await loadHosts(store, (problem) => problems.push(problem)), problems.length]).toEqual([NO_HOSTS, 1]);
  });
});
