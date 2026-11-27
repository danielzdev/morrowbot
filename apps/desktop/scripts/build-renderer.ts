import { copyFile, cp, mkdir, rm } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

const source = fileURLToPath(new URL('../src/renderer/', import.meta.url));
const out = fileURLToPath(new URL('../dist/renderer/', import.meta.url));

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await build({
  input: `${source}main.tsx`,
  platform: 'browser',
  tsconfig: `${source}tsconfig.json`,
  output: { file: `${out}app.js`, format: 'iife', minify: true },
});
await copyFile(`${source}index.html`, `${out}index.html`);
await cp(`${source}styles`, `${out}styles`, { recursive: true, filter: (path) => ['', '.css'].includes(extname(basename(path))) });
