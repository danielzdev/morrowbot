import { createHash, randomUUID } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { link, lstat, mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { AgentInstructionsView } from '@morrowbot/contracts';

export const INSTRUCTIONS_FILE = 'AGENTS.md';

/** The longest text the instructions contract carries. */
const MAX_CHARS = 1_000_000;

/** No UTF-8 text of `MAX_CHARS` is longer, so a bigger file is refused before it is read. */
const MAX_BYTES = MAX_CHARS * 4;

const identityOf = (stats: BigIntStats): string => [stats.dev, stats.ino, stats.size, stats.mtimeNs].join(':');

const hashOf = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/**
 * An opaque revision of the `AGENTS.md` entry: its own `lstat` identity, plus the identity and
 * content hash of what it resolves to when that can be read, or the read error's code.
 */
function revisionOf(entry: string | null, target: string | null, content: string | null, problem: string | null): string {
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

type Target = { readonly kind: 'read'; readonly identity: string; readonly bytes: Buffer } | { readonly kind: 'too-large'; readonly identity: string };

async function readTarget(file: string): Promise<Target> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stats = await handle.stat({ bigint: true });
    if (!stats.isFile()) throw Object.assign(new Error('not a file'), { code: 'not-a-file' });
    const identity = identityOf(stats);
    if (stats.size > BigInt(MAX_BYTES)) return { kind: 'too-large', identity };
    return { kind: 'read', identity, bytes: await handle.readFile() };
  } finally {
    await handle.close();
  }
}

/** What `dir/AGENTS.md` holds now. Occupancy comes from the entry itself, so a dangling link is present. */
export async function readInstructionsView(dir: string): Promise<AgentInstructionsView> {
  const file = path.join(dir, INSTRUCTIONS_FILE);
  let entry: string;
  try {
    entry = identityOf(await lstat(file, { bigint: true }));
  } catch (error) {
    const code = codeOf(error);
    if (code === 'ENOENT') return MISSING;
    return { content: null, revision: revisionOf(null, null, null, code), canReplace: false, readError: readError(code) };
  }
  try {
    const target = await readTarget(file);
    const tooLarge = { content: null, revision: revisionOf(entry, target.identity, null, 'too-large'), canReplace: false, readError: readError('too-large') };
    if (target.kind === 'too-large') return tooLarge;
    const content = target.bytes.toString('utf8');
    if (content.length > MAX_CHARS) return tooLarge;
    return { content, revision: revisionOf(entry, target.identity, hashOf(target.bytes), null), canReplace: false };
  } catch (error) {
    const code = codeOf(error);
    return { content: null, revision: revisionOf(entry, null, null, code), canReplace: false, readError: readError(code) };
  }
}

/** Why a write failed, in words that never carry a path. */
function writeError(code: string): string {
  switch (code) {
    case 'EACCES':
    case 'EPERM':
      return "MorrowBot isn't allowed to write in this folder.";
    case 'EROFS':
      return 'This folder is read-only.';
    case 'ENOSPC':
    case 'EDQUOT':
      return 'The disk is full.';
    case 'ENOENT':
    case 'ENOTDIR':
      return 'The folder is missing.';
    default:
      return 'The file could not be written.';
  }
}

export type WriteFailure = { readonly kind: 'failed'; readonly message: string };

/** Runs a write; a filesystem error becomes a path-free failure instead of an error that names the file. */
async function guarded<T>(write: () => Promise<T>): Promise<T | WriteFailure> {
  try {
    return await write();
  } catch (error) {
    const code = codeOf(error);
    if (code === null) throw error;
    return { kind: 'failed', message: writeError(code) };
  }
}

type Published = { readonly kind: 'published'; readonly identity: string } | { readonly kind: 'exists' };

/**
 * Publishes `bytes` as `dir/name` only if no entry has that name, not even a dangling link. The text is
 * written and synced to a staging file first, then hard-linked into place (atomic, fails on any
 * existing entry), so a crash never leaves a partial file and nothing else's file is ever removed.
 */
async function publish(dir: string, name: string, bytes: Buffer): Promise<Published> {
  const staging = path.join(dir, `.${name}.${randomUUID()}.tmp`);
  const handle = await open(staging, 'wx');
  try {
    let identity: string;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
      identity = identityOf(await handle.stat({ bigint: true }));
    } finally {
      await handle.close();
    }
    try {
      await link(staging, path.join(dir, name));
    } catch (error) {
      if (codeOf(error) === 'EEXIST') return { kind: 'exists' };
      throw error;
    }
    return { kind: 'published', identity };
  } finally {
    await unlink(staging).catch(() => undefined);
  }
}

export type CreateInstructionsResult = { readonly kind: 'created'; readonly revision: string } | { readonly kind: 'occupied' } | WriteFailure;

/** Creates `dir/AGENTS.md` only when no entry has that name, so an existing file or link is never replaced. */
export function createInstructions(dir: string, content: string): Promise<CreateInstructionsResult> {
  return guarded(async () => {
    await mkdir(dir, { recursive: true });
    const bytes = Buffer.from(content, 'utf8');
    const published = await publish(dir, INSTRUCTIONS_FILE, bytes);
    if (published.kind === 'exists') return { kind: 'occupied' };
    return { kind: 'created', revision: revisionOf(published.identity, published.identity, hashOf(bytes), null) };
  });
}

export type SaveCopyResult = { readonly kind: 'saved'; readonly name: string } | WriteFailure;

/** Writes `content` as a new file in `dir`, named after `at` with a counter. */
export function saveInstructionsCopy(dir: string, at: string, content: string): Promise<SaveCopyResult> {
  return guarded(async () => {
    await mkdir(dir, { recursive: true });
    const stamp = at.replaceAll(':', '-');
    const bytes = Buffer.from(content, 'utf8');
    for (let n = 1; n < 1_000_000; n++) {
      const name = `${stamp}-${String(n)}.md`;
      if ((await publish(dir, name, bytes)).kind === 'published') return { kind: 'saved', name };
    }
    throw new Error('Too many copies saved at the same time');
  });
}
