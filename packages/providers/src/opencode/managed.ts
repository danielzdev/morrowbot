import { listDirectory } from '@morrowbot/plugin-sdk';

/** Whether admin-managed opencode config could apply. Managed config outranks MorrowBot's own, so any at all withholds. */
export type Managed = { readonly kind: 'clear' } | { readonly kind: 'withheld'; readonly reason: string };

const PREFERENCES = '/Library/Managed Preferences';
const PREFERENCES_FILE = 'ai.opencode.managed.plist';

/**
 * Checks where opencode 2.4.1 finds admin-managed config: the system folder (any entry in it
 * withholds), and on macOS a managed preferences file for `ai.opencode.managed`, system-wide or in
 * any user's folder, since opencode picks the folder from its own idea of the user name. `root`
 * prefixes every path: '/' in the app, a temporary folder in tests. A folder that exists but cannot
 * be read withholds too.
 */
export async function checkManagedConfig(root: string, platform: string): Promise<Managed> {
  const base = root.replace(/\/+$/, '');
  const folder = platform === 'darwin' ? '/Library/Application Support/opencode' : '/etc/opencode';
  try {
    if (((await listDirectory(`${base}${folder}`)) ?? []).length > 0) return withheld(folder);
    if (platform !== 'darwin') return { kind: 'clear' };
    const entries = (await listDirectory(`${base}${PREFERENCES}`)) ?? [];
    if (entries.includes(PREFERENCES_FILE)) return withheld(`${PREFERENCES}/${PREFERENCES_FILE}`);
    for (const user of entries.filter((entry) => !entry.endsWith('.plist'))) {
      const dir = `${PREFERENCES}/${user}`;
      if (((await listDirectory(`${base}${dir}`)) ?? []).includes(PREFERENCES_FILE)) return withheld(`${dir}/${PREFERENCES_FILE}`);
    }
    return { kind: 'clear' };
  } catch {
    return { kind: 'withheld', reason: "MorrowBot could not check this computer's managed opencode config, which outranks the read-only config MorrowBot gives OpenCode." };
  }
}

function withheld(source: string): Managed {
  return {
    kind: 'withheld',
    reason: `This computer has managed opencode config (${source}), which outranks the read-only config MorrowBot gives OpenCode. Ask your admin, or chat with another provider.`,
  };
}
