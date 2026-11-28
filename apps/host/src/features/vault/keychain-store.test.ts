import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { keychainStore } from './keychain-store.ts';

/** Writes to the real login Keychain, so it runs only on macOS with `MORROWBOT_LIVE_KEYCHAIN=1`. */
const LIVE = process.platform === 'darwin' && process.env.MORROWBOT_LIVE_KEYCHAIN === '1';

describe.runIf(LIVE)('the Keychain store on this Mac', () => {
  it('saves, replaces, reads and removes a secret under a throwaway service', async () => {
    const store = keychainStore(`com.legendarykoi.morrowbot.vault.test-${randomUUID()}`);
    const secret = 'p@ss "word" with spaces, ünïcode, +/= and a\nnewline';
    try {
      await store.write('item-1', 'first');
      const saved = await store.write('item-1', secret);
      expect({ saved, read: await store.read('item-1'), missing: await store.read('item-2') }).toEqual({ saved: { kind: 'saved' }, read: secret, missing: undefined });
    } finally {
      await store.remove('item-1');
    }
    expect(await store.read('item-1')).toBeUndefined();
    await store.remove('item-1');
  });
});
