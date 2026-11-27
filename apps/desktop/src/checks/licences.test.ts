import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { LICENCES } from '../renderer/features/settings/index.ts';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const Manifest = z.object({ dependencies: z.record(z.string(), z.string()).optional(), license: z.string().optional() });
const manifest = (path: string) => Manifest.parse(JSON.parse(readFileSync(`${repo}${path}`, 'utf8')));
const workspaces = ['apps/desktop', 'apps/host', ...readdirSync(`${repo}packages`).map((name) => `packages/${name}`)];

it('lists every third-party runtime dependency in Settings › About, with the licence its package declares', () => {
  const shipped = new Set(['electron', ...workspaces.flatMap((dir) => Object.keys(manifest(`${dir}/package.json`).dependencies ?? {}))]);
  const wanted = [...shipped].filter((name) => !name.startsWith('@morrowbot/')).sort().map((name) => `${name}: ${manifest(`node_modules/${name}/package.json`).license ?? 'none'}`);
  const listed = LICENCES.flatMap(({ npm, licence }) => (npm === null ? [] : [`${npm}: ${licence}`])).sort();
  expect(listed).toEqual(wanted);
});
