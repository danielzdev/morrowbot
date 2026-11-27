import { existsSync } from 'node:fs';
import { copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'rolldown';
import { z } from 'zod';
import { DEFAULT_RELEASES_REPO, RepoName } from '../src/main/release-feed.ts';

/**
 * Lays out the app electron-builder packs into MorrowBot.app, at `dist/app/`: `main/` (Electron main and
 * the preload), `renderer/` (from `npm run build`) and `host/` (the host and the command guard it forks),
 * each bundled with its dependencies, beside a package.json with no dependencies to install. That
 * package.json also names the releases repo (`MORROWBOT_RELEASES_REPO`, else the default) the app updates from.
 * MorrowBot's licence and every bundled package's licence text ship beside them.
 */
const desktop = fileURLToPath(new URL('../', import.meta.url));
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const out = `${desktop}dist/app/`;

const Manifest = z.object({ productName: z.string(), version: z.string(), description: z.string(), author: z.string(), license: z.string() });
const manifest = Manifest.parse(JSON.parse(await readFile(`${desktop}package.json`, 'utf8')));
const releasesRepo = RepoName.parse(process.env.MORROWBOT_RELEASES_REPO ?? DEFAULT_RELEASES_REPO);

const Package = z.object({ name: z.string(), version: z.string(), license: z.string().optional(), dependencies: z.record(z.string(), z.string()).optional() });

/** Every third-party package the bundles can contain: the runtime dependencies of the workspaces they come from, and theirs. */
async function bundledPackages(): Promise<z.infer<typeof Package>[]> {
  const workspaces = ['apps/desktop', 'apps/host', ...(await readdir(`${repo}packages`)).map((name) => `packages/${name}`)];
  const roots = await Promise.all(workspaces.map(async (dir) => Package.parse(JSON.parse(await readFile(`${repo}${dir}/package.json`, 'utf8')))));
  const seen = new Map<string, z.infer<typeof Package>>();
  const visit = async (name: string): Promise<void> => {
    if (name.startsWith('@morrowbot/') || name === 'electron' || seen.has(name)) return;
    const found = Package.parse(JSON.parse(await readFile(`${repo}node_modules/${name}/package.json`, 'utf8')));
    seen.set(name, found);
    for (const child of Object.keys(found.dependencies ?? {})) await visit(child);
  };
  for (const root of roots) for (const name of Object.keys(root.dependencies ?? {})) await visit(name);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The package's licence file, or the licence its package.json declares when it ships no file. */
async function licenceText({ name, license }: z.infer<typeof Package>): Promise<string> {
  const dir = `${repo}node_modules/${name}/`;
  const file = (await readdir(dir)).find((entry) => /^licen[cs]e(\.(md|txt))?$/i.test(entry));
  if (file !== undefined) return readFile(`${dir}${file}`, 'utf8');
  if (license === undefined) throw new Error(`${name} declares no licence; check it before packaging`);
  return `Licensed under ${license} (declared in its package.json; it ships no licence file).`;
}

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
await copyFile(`${repo}LICENSE`, `${out}LICENSE`);
if (existsSync(`${repo}THIRD_PARTY_LICENSES`)) await cp(`${repo}THIRD_PARTY_LICENSES`, `${out}THIRD_PARTY_LICENSES`, { recursive: true });
const notices = await Promise.all((await bundledPackages()).map(async (found) => `${found.name} ${found.version}\n\n${(await licenceText(found)).trim()}\n`));
await writeFile(`${out}THIRD_PARTY_NOTICES.txt`, notices.join(`\n${'-'.repeat(72)}\n\n`));
const { productName, version, description, author, license } = manifest;
await writeFile(
  `${out}package.json`,
  `${JSON.stringify({ name: 'morrowbot', productName, version, description, author, license, type: 'module', main: 'main/main.js', morrowbot: { releasesRepo } }, null, 2)}\n`,
);
