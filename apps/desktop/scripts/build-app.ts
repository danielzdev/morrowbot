import { existsSync } from 'node:fs';
import { copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build, type Plugin, type RolldownOutput } from 'rolldown';
import { z } from 'zod';
import { DEFAULT_RELEASES_REPO, RepoName } from '../src/main/release-feed.ts';
import { bundleRenderer } from './renderer-bundle.ts';

/**
 * Lays out the app electron-builder packs into Ori Bot.app, at `dist/app/`: `main/` (Electron main and
 * the preload), `renderer/` (the window page) and `host/` (the host, the command guard it forks and the host-tools bridge agents run),
 * each bundled with its dependencies, beside a package.json with no dependencies to install. That
 * package.json also names the releases repo (`ORIBOT_RELEASES_REPO`, else the default) the app updates from.
 * Ori Bot's licence, and the licence of every npm package a bundle contains, ship beside them.
 */
const desktop = fileURLToPath(new URL('../', import.meta.url));
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const out = `${desktop}dist/app/`;

const Manifest = z.object({ productName: z.string(), version: z.string(), description: z.string(), author: z.string(), license: z.string() });
const manifest = Manifest.parse(JSON.parse(await readFile(`${desktop}package.json`, 'utf8')));
const releasesRepo = RepoName.parse(process.env.ORIBOT_RELEASES_REPO ?? DEFAULT_RELEASES_REPO);

const Package = z.object({ name: z.string(), version: z.string(), license: z.string().optional() });
type Bundled = z.infer<typeof Package> & { readonly dir: string };

/** Every npm package whose code a bundle contains, found from the modules it bundled. */
async function packagesIn(bundles: readonly RolldownOutput[]): Promise<Bundled[]> {
  const dirs = new Set(
    bundles.flatMap(({ output }) => output.flatMap((item) => (item.type === 'chunk' ? item.moduleIds : []))).flatMap((id) => {
      const dir = /^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(id)?.[1];
      return dir === undefined ? [] : [dir];
    }),
  );
  const found = await Promise.all([...dirs].map(async (dir) => ({ ...Package.parse(JSON.parse(await readFile(`${dir}/package.json`, 'utf8'))), dir })));
  return found.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** The package's licence file, or the licence its package.json declares when it ships no file. */
async function licenceText({ name, license, dir }: Bundled): Promise<string> {
  const file = (await readdir(dir)).find((entry) => /^licen[cs]e(\.(md|txt))?$/i.test(entry));
  if (file !== undefined) return readFile(`${dir}/${file}`, 'utf8');
  if (license === undefined) throw new Error(`${name} is bundled but declares no licence; check it before packaging`);
  return `Licensed under ${license} (declared in its package.json; it ships no licence file).`;
}

/** Programs the host bundle runs by file name: the plugin SDK forks its command guard and hands agents its host-tools bridge. */
const HELPERS = [
  { module: '/packages/plugin-sdk/src/command.ts', source: "new URL('./command-guard.ts', import.meta.url)", bundled: "new URL('./command-guard.js', import.meta.url)" },
  { module: '/packages/plugin-sdk/src/acp/bridge.ts', source: "new URL('./bridge-process.ts', import.meta.url)", bundled: "new URL('./bridge-process.js', import.meta.url)" },
];
/** Points each helper's URL at the file the bundle ships it as, next to the host: `host/command-guard.js`, `host/bridge-process.js`. */
const helperBundle: Plugin = {
  name: 'oribot-helper-bundle',
  transform(code, id) {
    const helper = HELPERS.find(({ module }) => id.endsWith(module));
    if (helper === undefined) return null;
    if (!code.includes(helper.source)) this.error(`${helper.module} no longer runs ${helper.source}; update scripts/build-app.ts to match`);
    return code.replace(helper.source, helper.bundled);
  },
};

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const mainBundle = await build({
  input: { main: `${desktop}src/main/main.ts`, 'cleanup-helper': `${desktop}src/main/reset/cleanup-helper.ts` },
  platform: 'node',
  external: ['electron'],
  tsconfig: `${desktop}tsconfig.json`,
  output: { dir: `${out}main`, format: 'esm', entryFileNames: '[name].js', chunkFileNames: '[name]-[hash].js' },
});
await copyFile(`${desktop}src/preload/preload.cjs`, `${out}main/preload.cjs`);
const hostBundle = await build({
  input: {
    main: `${repo}apps/host/src/main.ts`,
    'command-guard': `${repo}packages/plugin-sdk/src/command-guard.ts`,
    'bridge-process': `${repo}packages/plugin-sdk/src/acp/bridge-process.ts`,
  },
  platform: 'node',
  tsconfig: `${repo}apps/host/tsconfig.json`,
  plugins: [helperBundle],
  output: { dir: `${out}host`, format: 'esm', entryFileNames: '[name].js', chunkFileNames: '[name]-[hash].js' },
});
const rendererBundle = await bundleRenderer(`${out}renderer/`);
await copyFile(`${repo}LICENSE`, `${out}LICENSE`);
if (existsSync(`${repo}THIRD_PARTY_LICENSES`)) await cp(`${repo}THIRD_PARTY_LICENSES`, `${out}THIRD_PARTY_LICENSES`, { recursive: true });
const notices = await Promise.all((await packagesIn([mainBundle, hostBundle, rendererBundle])).map(async (found) => `${found.name} ${found.version}\n\n${(await licenceText(found)).trim()}\n`));
await writeFile(`${out}THIRD_PARTY_NOTICES.txt`, notices.join(`\n${'-'.repeat(72)}\n\n`));
const { productName, version, description, author, license } = manifest;
await writeFile(
  `${out}package.json`,
  `${JSON.stringify({ name: 'oribot', productName, version, description, author, license, type: 'module', main: 'main/main.js', oribot: { releasesRepo } }, null, 2)}\n`,
);
