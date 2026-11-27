import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { PluginManifest } from '@morrowbot/contracts';
import { describeIssues } from './issues.ts';

export interface DiscoveredPlugin {
  readonly manifest: PluginManifest;
  readonly dir: string;
  readonly entryPath: string;
}

export interface Discovery {
  readonly plugins: readonly DiscoveredPlugin[];
  readonly problems: readonly string[];
}

const MANIFEST_FILE = 'manifest.json';

/** Reads every `<pluginsDir>/<folder>/manifest.json`. Never runs plugin code. */
export async function discoverPlugins(pluginsDir: string): Promise<Discovery> {
  const folders = await listFolders(pluginsDir);
  const plugins = new Map<string, DiscoveredPlugin>();
  const problems: string[] = [];
  for (const folder of folders) {
    const dir = path.join(pluginsDir, folder);
    const result = await readManifest(dir);
    if (result.kind === 'invalid') {
      problems.push(`${folder}: ${result.problem}`);
    } else if (plugins.has(result.manifest.id)) {
      problems.push(`${folder}: another plugin already uses the id "${result.manifest.id}"`);
    } else {
      plugins.set(result.manifest.id, {
        manifest: result.manifest,
        dir,
        entryPath: path.join(dir, result.manifest.main),
      });
    }
  }
  return { plugins: [...plugins.values()], problems };
}

async function listFolders(pluginsDir: string): Promise<string[]> {
  try {
    const entries = await readdir(pluginsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

type ManifestResult =
  | { readonly kind: 'ok'; readonly manifest: PluginManifest }
  | { readonly kind: 'invalid'; readonly problem: string };

async function readManifest(dir: string): Promise<ManifestResult> {
  let text: string;
  try {
    text = await readFile(path.join(dir, MANIFEST_FILE), 'utf8');
  } catch (error) {
    if (isMissing(error)) return { kind: 'invalid', problem: `no ${MANIFEST_FILE}` };
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { kind: 'invalid', problem: `${MANIFEST_FILE} is not valid JSON` };
  }
  const parsed = PluginManifest.safeParse(json);
  if (parsed.success) return { kind: 'ok', manifest: parsed.data };
  return { kind: 'invalid', problem: describeIssues(parsed.error).join('; ') };
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
