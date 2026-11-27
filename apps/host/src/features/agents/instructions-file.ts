import { createHash } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, mkdir, open, unlink, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { AgentInstructionsView } from '@morrowbot/contracts';

export const INSTRUCTIONS_FILE = 'AGENTS.md';

/** The longest text the instructions contract carries. */
const MAX_CHARS = 1_000_000;

const identityOf = (stats: BigIntStats): string => [stats.dev, stats.ino, stats.size, stats.mtimeNs].join(':');

const hashOf = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/**
 * An opaque revision of the `AGENTS.md` entry: its own `lstat` identity, plus the identity and
 * content hash of what it resolves to when that can be read, or the read error's code.
 */
function revisionOf(entry: string, target: string | null, content: string | null, problem: string | null): string {
  return createHash('sha256').update(JSON.stringify([entry, target, content, problem])).digest('hex');
}

const codeOf = (error: unknown): string | null =>
  error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : null;

/** Why the text can't be read, in words that never carry a path. */
function readError(code: string | null): string {
  switch (code) {
    case 'ENOENT':
      return 'AGENTS.md is a link to a file that is not there.';
    case 'ELOOP':
      return 'AGENTS.md is a link that loops back on itself.';
    case 'EACCES':
    case 'EPERM':
      return "MorrowBot isn't allowed to read AGENTS.md.";
    case 'not-a-file':
      return 'AGENTS.md is not a regular file.';
    case 'too-large':
      return 'AGENTS.md is too large to edit here.';
    case null:
    default:
      return 'AGENTS.md could not be read.';
  }
}

const MISSING: AgentInstructionsView = { content: null, revision: null, canReplace: false };

async function readTarget(file: string): Promise<{ readonly identity: string; readonly bytes: Buffer }> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stats = await handle.stat({ bigint: true });
    if (!stats.isFile()) throw Object.assign(new Error('not a file'), { code: 'not-a-file' });
    return { identity: identityOf(stats), bytes: await handle.readFile() };
  } finally {
    await handle.close();
  }
}

/** What `dir/AGENTS.md` holds now. Occupancy comes from the entry itself, so a dangling link is present. */
export async function readInstructionsView(dir: string): Promise<AgentInstructionsView> {
  const file = path.join(dir, INSTRUCTIONS_FILE);
  let entry: BigIntStats;
  try {
    entry = await lstat(file, { bigint: true });
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return MISSING;
    throw error;
  }
  try {
    const { identity, bytes } = await readTarget(file);
    const content = bytes.toString('utf8');
    const revision = revisionOf(identityOf(entry), identity, hashOf(bytes), null);
    if (content.length > MAX_CHARS) return { content: null, revision, canReplace: false, readError: readError('too-large') };
    return { content, revision, canReplace: false };
  } catch (error) {
    const code = codeOf(error);
    return { content: null, revision: revisionOf(identityOf(entry), null, null, code), canReplace: false, readError: readError(code) };
  }
}

export type CreateInstructionsResult = { readonly kind: 'created'; readonly revision: string } | { readonly kind: 'occupied' };

/**
 * Creates `dir/AGENTS.md` with exclusive create (`O_CREAT|O_EXCL`), which also fails on a symlink or
 * a dangling one, so an existing entry is never replaced. The revision matches what a read returns.
 */
export async function createInstructions(dir: string, content: string): Promise<CreateInstructionsResult> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, INSTRUCTIONS_FILE);
  let handle: FileHandle;
  try {
    handle = await open(file, 'wx');
  } catch (error) {
    if (codeOf(error) === 'EEXIST') return { kind: 'occupied' };
    throw error;
  }
  const bytes = Buffer.from(content, 'utf8');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    const identity = identityOf(await handle.stat({ bigint: true }));
    return { kind: 'created', revision: revisionOf(identity, identity, hashOf(bytes), null) };
  } catch (error) {
    await removeOwn(file, handle);
    throw error;
  } finally {
    await handle.close();
  }
}

/** Removes the half-written file this save created, and nothing that has taken its place since. */
async function removeOwn(file: string, handle: FileHandle): Promise<void> {
  const [mine, now] = await Promise.all([handle.stat({ bigint: true }), lstat(file, { bigint: true })]).catch(() => [null, null]);
  if (mine !== null && now !== null && mine.dev === now.dev && mine.ino === now.ino) await unlink(file).catch(() => undefined);
}

/** Writes `content` as a new file in `dir`, named after `at` with a counter; returns the file name. */
export async function saveInstructionsCopy(dir: string, at: string, content: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const stamp = at.replaceAll(':', '-');
  for (let n = 1; n < 1_000_000; n++) {
    const name = `${stamp}-${String(n)}.md`;
    let handle: FileHandle;
    try {
      handle = await open(path.join(dir, name), 'wx');
    } catch (error) {
      if (codeOf(error) === 'EEXIST') continue;
      throw error;
    }
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    return name;
  }
  throw new Error('Too many copies saved at the same time');
}
