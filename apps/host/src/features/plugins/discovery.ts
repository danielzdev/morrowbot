import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { PluginManifest, type OpenPluginChannel } from '@morrowbot/contracts';
import { forkChannel } from './fork-channel.ts';
import { describeIssues } from './issues.ts';

/** A plugin the host can start: a plugin folder (in its own worker process), or a provider built into MorrowBot. */
export interface PluginSource {
  readonly manifest: PluginManifest;
  /** Starts it with `env` (`PATH` plus the manifest's preset). */
  readonly launch: (env: Readonly<Record<string, string>>) => OpenPluginChannel;
}

export interface Discovery {
  readonly plugins: readonly PluginSource[];
  readonly problems: readonly string[];
}

const MANIFEST_FILE = 'manifest.json';

/** Reads every `<pluginsDir>/<folder>/manifest.json`. Never runs plugin code and never throws: bad folders become problems. */
export async function discoverPlugins(pluginsDir: string): Promise<Discovery> {
  const problems: string[] = [];
  const folders = await listFolders(pluginsDir, problems);
  const plugins = new Map<string, PluginSource>();
  for (const folder of folders) {
    const dir = path.join(pluginsDir, folder);
    const result = await readManifest(dir);
    if (result.kind === 'invalid') {
      problems.push(`${folder}: ${result.problem}`);
    } else if (plugins.has(result.manifest.id)) {
      problems.push(`${folder}: another plugin already uses the id "${result.manifest.id}"`);
    } else {
      const entryPath = path.join(dir, result.manifest.main);
      plugins.set(result.manifest.id, { manifest: result.manifest, launch: (env) => forkChannel(entryPath, dir, env) });
    }
  }
  return { plugins: [...plugins.values()], problems };
}

async function listFolders(pluginsDir: string, problems: string[]): Promise<string[]> {
  try {
    const entries = await readdir(pluginsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (!isMissing(error)) problems.push(`${pluginsDir}: could not read the plugins folder (${describe(error)})`);
    return [];
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
    return { kind: 'invalid', problem: isMissing(error) ? `no ${MANIFEST_FILE}` : `could not read ${MANIFEST_FILE} (${describe(error)})` };
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

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
