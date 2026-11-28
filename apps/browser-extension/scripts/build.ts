import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';
import { z } from 'zod';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = `${root}dist/`;

/** Builds the unpacked extension into `dist/`: load that folder with "Load unpacked". */
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await build({ input: `${root}src/chromium/background.ts`, platform: 'browser', output: { file: `${out}background.js`, format: 'esm', minify: true } });
await build({ input: `${root}src/options/options.ts`, platform: 'browser', output: { file: `${out}options.js`, format: 'iife', minify: true } });
const { version } = z.object({ version: z.string() }).parse(JSON.parse(await readFile(`${root}package.json`, 'utf8')));
const manifest = z.record(z.string(), z.unknown()).parse(JSON.parse(await readFile(`${root}manifest.json`, 'utf8')));
await writeFile(`${out}manifest.json`, `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
await copyFile(`${root}src/options/options.html`, `${out}options.html`);
await copyFile(`${root}src/options/options.css`, `${out}options.css`);
await cp(`${root}icons`, `${out}icons`, { recursive: true });
console.log(`Built the Ori Kami extension ${version} into ${out}`);
