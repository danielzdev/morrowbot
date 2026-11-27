import { copyFile, cp, mkdir, rm } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type RolldownOutput } from 'rolldown';

const source = fileURLToPath(new URL('../src/renderer/', import.meta.url));

/** Builds the window page into `out` (its script, page and stylesheets) and returns the bundle. */
export async function bundleRenderer(out: string): Promise<RolldownOutput> {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const bundle = await build({
    input: `${source}main.tsx`,
    platform: 'browser',
    tsconfig: `${source}tsconfig.json`,
    output: { file: `${out}app.js`, format: 'iife', minify: true },
  });
  await copyFile(`${source}index.html`, `${out}index.html`);
  await cp(`${source}styles`, `${out}styles`, { recursive: true, filter: (path) => ['', '.css'].includes(extname(basename(path))) });
  return bundle;
}
