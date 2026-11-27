import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'rolldown';
import { z } from 'zod';
import { DEFAULT_RELEASES_REPO, RepoName } from '../src/main/release-feed.ts';

/**
 * Lays out the app electron-builder packs into MorrowBot.app, at `dist/app/`: `main/` (Electron main and
 * the preload), `renderer/` (from `npm run build`) and `host/` (the host and the command guard it forks),
 * each bundled with its dependencies, beside a package.json with no dependencies to install. That
 * package.json also names the releases repo (`MORROWBOT_RELEASES_REPO`, else the default) the app updates from.
 */
const desktop = fileURLToPath(new URL('../', import.meta.url));
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const out = `${desktop}dist/app/`;

const Manifest = z.object({ productName: z.string(), version: z.string(), description: z.string(), author: z.string(), license: z.string() });
const manifest = Manifest.parse(JSON.parse(await readFile(`${desktop}package.json`, 'utf8')));
const releasesRepo = RepoName.parse(process.env.MORROWBOT_RELEASES_REPO ?? DEFAULT_RELEASES_REPO);

const GUARD_SOURCE = "new URL('./command-guard.ts', import.meta.url)";
/** The plugin SDK forks its guard by file name, and the bundle ships the guard as `host/command-guard.js`. */
const guardBundle: Plugin = {
  name: 'morrowbot-guard-bundle',
  transform(code, id) {
    if (!id.endsWith('/packages/plugin-sdk/src/command.ts')) return null;
    if (!code.includes(GUARD_SOURCE)) this.error(`command.ts no longer forks ${GUARD_SOURCE}; update scripts/build-app.ts to match`);
    return code.replace(GUARD_SOURCE, "new URL('./command-guard.js', import.meta.url)");
  },
};

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await build({
  input: { main: `${desktop}src/main/main.ts` },
  platform: 'node',
  external: ['electron'],
  tsconfig: `${desktop}tsconfig.json`,
  output: { dir: `${out}main`, format: 'esm', entryFileNames: '[name].js', chunkFileNames: '[name]-[hash].js' },
});
await copyFile(`${desktop}src/preload/preload.cjs`, `${out}main/preload.cjs`);
await build({
  input: { main: `${repo}apps/host/src/main.ts`, 'command-guard': `${repo}packages/plugin-sdk/src/command-guard.ts` },
  platform: 'node',
  tsconfig: `${repo}apps/host/tsconfig.json`,
  plugins: [guardBundle],
  output: { dir: `${out}host`, format: 'esm', entryFileNames: '[name].js', chunkFileNames: '[name]-[hash].js' },
});
await cp(`${desktop}dist/renderer`, `${out}renderer`, { recursive: true });
const { productName, version, description, author, license } = manifest;
await writeFile(
  `${out}package.json`,
  `${JSON.stringify({ name: 'morrowbot', productName, version, description, author, license, type: 'module', main: 'main/main.js', morrowbot: { releasesRepo } }, null, 2)}\n`,
);
