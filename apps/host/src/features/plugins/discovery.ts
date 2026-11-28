import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { PluginManifest, type OpenPluginChannel, type PluginOrigin, type PluginProblem } from '@morrowbot/contracts';
import { forkChannel } from './fork-channel.ts';
import { describeIssues } from './issues.ts';

/** A plugin the host can start: a plugin folder (in its own worker process), or a provider built into Ori Bot. */
export interface PluginSource {
  readonly manifest: PluginManifest;
  readonly source: PluginOrigin;
  /** Its folder's name inside a plugins folder; null for a built-in provider. */
  readonly folder: string | null;
  /** Starts it with `env` (`PATH` plus the manifest's preset). */
  readonly launch: (env: Readonly<Record<string, string>>) => OpenPluginChannel;
}

export interface Discovery {
  readonly plugins: readonly PluginSource[];
  readonly problems: readonly PluginProblem[];
}

const MANIFEST_FILE = 'manifest.json';

/** Reads every `<pluginsDir>/<folder>/manifest.json`. Never runs plugin code and never throws: bad folders become problems. */
export async function discoverPlugins(pluginsDir: string, source: PluginOrigin): Promise<Discovery> {
  const problems: PluginProblem[] = [];
  const folders = await listFolders(pluginsDir, source, problems);
  const plugins = new Map<string, PluginSource>();
  for (const folder of folders) {
    const dir = path.join(pluginsDir, folder);
    const result = await readManifest(dir);
    if (result.kind === 'invalid') {
      problems.push({ kind: 'invalid-manifest', source, folder, problem: result.problem });
    } else if (plugins.has(result.manifest.id)) {
      problems.push({ kind: 'duplicate', source, folder, id: result.manifest.id, takenBy: source });
    } else {
      const entryPath = path.join(dir, result.manifest.main);
      plugins.set(result.manifest.id, { manifest: result.manifest, source, folder, launch: (env) => forkChannel(entryPath, dir, env) });
    }
  }
  return { plugins: [...plugins.values()], problems };
}

async function listFolders(pluginsDir: string, source: PluginOrigin, problems: PluginProblem[]): Promise<string[]> {
  try {
    const entries = await readdir(pluginsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (!isMissing(error)) problems.push({ kind: 'unreadable', source, problem: `${pluginsDir}: could not read the plugins folder (${describe(error)})` });
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

/**
 * Every plugin the host serves, in list order: the built-in providers, then the app's own plugins
 * folder, then the user's. An id that is already taken is skipped and reported; built-in ids win.
 */
export async function readCatalog(builtins: readonly PluginSource[], builtinPluginsDir: string | null, pluginsDir: string): Promise<Discovery> {
  const found = [{ plugins: builtins, problems: [] }, ...(await Promise.all([...(builtinPluginsDir === null ? [] : [discoverPlugins(builtinPluginsDir, 'built-in')]), discoverPlugins(pluginsDir, 'user')]))];
  const plugins = new Map<string, PluginSource>();
  const problems: PluginProblem[] = [];
  for (const discovery of found) {
    problems.push(...discovery.problems);
    for (const plugin of discovery.plugins) {
      const taken = plugins.get(plugin.manifest.id);
      if (taken === undefined) plugins.set(plugin.manifest.id, plugin);
      else problems.push({ kind: 'duplicate', source: plugin.source, folder: plugin.folder ?? plugin.manifest.id, id: plugin.manifest.id, takenBy: taken.source });
    }
  }
  return { plugins: [...plugins.values()], problems };
}

/** One problem as a log line. */
export function describeProblem(problem: PluginProblem): string {
  switch (problem.kind) {
    case 'invalid-manifest':
      return `${problem.source} ${problem.folder}: ${problem.problem}`;
    case 'duplicate':
      return `${problem.source} ${problem.folder}: the id "${problem.id}" is already used by a ${problem.takenBy} plugin, so it was skipped`;
    case 'unreadable':
      return `${problem.source}: ${problem.problem}`;
  }
}
