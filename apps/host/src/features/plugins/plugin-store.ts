import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PluginConfig } from '@morrowbot/contracts';
import { z } from 'zod';

/** What the host remembers about one plugin between runs. */
export interface PluginRecord {
  readonly enabled: boolean;
  /** Settings as the user saved them, before defaults are filled in. */
  readonly config: PluginConfig;
}

/** Where plugin records live. The JSON file store is the default; a database can implement the same interface. */
export interface PluginStore {
  read(pluginId: string): Promise<PluginRecord | undefined>;
  write(pluginId: string, record: PluginRecord): Promise<void>;
}

const StoreFile = z.strictObject({
  version: z.literal(1),
  plugins: z.record(z.string(), z.strictObject({ enabled: z.boolean(), config: PluginConfig })),
});
type StoreFile = z.infer<typeof StoreFile>;

/** Keeps every plugin record in one JSON file, replaced atomically on each write. */
export function createJsonPluginStore(file: string): PluginStore {
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  };
  return {
    read: (pluginId) => serial(async () => (await load(file)).plugins[pluginId]),
    write: (pluginId, record) =>
      serial(async () => {
        const current = await load(file);
        await save(file, { ...current, plugins: { ...current.plugins, [pluginId]: record } });
      }),
  };
}

async function load(file: string): Promise<StoreFile> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { version: 1, plugins: {} };
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Plugin state file ${file} is not valid JSON. Fix or delete it, or start with --safe-mode.`);
  }
  const parsed = StoreFile.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Plugin state file ${file} is malformed: ${parsed.error.message}`);
  }
  return parsed.data;
}

async function save(file: string, contents: StoreFile): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${String(process.pid)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(contents, null, 2)}\n`);
  await rename(temporary, file);
}
