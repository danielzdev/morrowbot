import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { dataFolderFence, type Fence } from '@morrowbot/plugin-sdk';
import { BUILTIN_PROVIDERS } from '@morrowbot/providers';

export const DATABASE = 'morrowbot.sqlite';
/** What no built-in provider's program may read: every vault file, the database, and a joined server's token. */
const HIDDEN = ['vault', DATABASE, 'server.json'];

/**
 * The fence every program a built-in provider starts (an agent's shell among them) runs behind. It writes only in
 * the agents' workspaces and the built-in providers' own data folders: never the vault, the database, the plugins
 * MorrowBot runs, or the app itself (`execPath`'s bundle, when the host runs from one).
 */
export async function providerFence(dataDir: string, pluginsDir: string, execPath: string): Promise<Fence> {
  await mkdir(pluginsDir, { recursive: true });
  const app = appBundleOf(execPath);
  return dataFolderFence(process.platform, {
    data: dataDir,
    hidden: HIDDEN,
    writable: [path.join(dataDir, 'workspaces'), ...BUILTIN_PROVIDERS.map(({ manifest }) => path.join(dataDir, 'plugin-data', manifest.id))],
    readOnly: [await realpath(pluginsDir), ...(app === null ? [] : [app])],
  });
}

function appBundleOf(execPath: string): string | null {
  const at = execPath.indexOf('.app/Contents/');
  return at === -1 ? null : execPath.slice(0, at + '.app'.length);
}
