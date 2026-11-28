import { createHash, randomUUID } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { AgentInstructionsView } from '@morrowbot/contracts';

export const INSTRUCTIONS_FILE = 'SOUL.md';

/** The longest text the instructions contract carries. */
const MAX_CHARS = 1_000_000;

/** No UTF-8 text of `MAX_CHARS` is longer, so a bigger file is refused before it is read. */
const MAX_BYTES = MAX_CHARS * 4;

const identityOf = (stats: BigIntStats): string => [stats.dev, stats.ino, stats.size, stats.mtimeNs].join(':');

const hashOf = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/**
 * An opaque revision of the `SOUL.md` entry: its own `lstat` identity, plus the identity and
 * content hash of the file as opened when it can be read, or the read error's code.
 */
function revisionOf(entry: string | null, target: string | null, content: string | null, problem: string | null): string {
  return createHash('sha256').update(JSON.stringify([entry, target, content, problem])).digest('hex');
}

const codeOf = (error: unknown): string | null =>
  error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : null;

/** Why the text can't be read, in words that never carry a path. */
function readError(code: string | null): string {
  switch (code) {
    case 'ELOOP':
      return 'SOUL.md is a link. Ori Kami reads only a regular file in the workspace folder.';
    case 'hard-link':
      return 'SOUL.md has more than one hard link, so Ori Kami does not read it. Replace SOUL.md with a copy of its text.';
    case 'EACCES':
    case 'EPERM':
      return "Ori Kami isn't allowed to read SOUL.md.";
    case 'not-a-file':
      return 'SOUL.md is not a regular file.';
    case 'too-large':
      return 'SOUL.md is too large to edit here.';
    case 'changed':
      return 'SOUL.md changed while it was being read.';
    case null:
    default:
      return 'SOUL.md could not be read.';
  }
}

const MISSING: AgentInstructionsView = { content: null, revision: null, canReplace: false };

type Target = { readonly kind: 'read'; readonly identity: string; readonly bytes: Buffer } | { readonly kind: 'too-large'; readonly identity: string };

const refusal = (code: string): Error => Object.assign(new Error(code), { code });

/**
 * Reads `dir/SOUL.md` only when it is a regular file of its own right in `dir`, the same one `lstat` found
 * (`entry`): never through a symlink (`O_NOFOLLOW` fails with ELOOP) or a second hard link. The file must have
 * one link and the same `ctime` at the first `lstat`, when opened, and at an `lstat` after the read; adding or
 * removing a link moves `ctime`, so a link made and removed between the checks is caught too. The host runs
 * outside the Fence, so it must not read a file the agent pointed it at, such as the vault or the database.
 */
async function readTarget(dir: string, entry: BigIntStats): Promise<Target> {
  if (entry.nlink > 1n) throw refusal('hard-link');
  const root = await realpath(dir);
  const handle = await open(path.join(root, INSTRUCTIONS_FILE), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stats = await handle.stat({ bigint: true });
    if (stats.ino !== entry.ino || stats.dev !== entry.dev || stats.ctimeNs !== entry.ctimeNs) throw refusal('changed');
    if (!stats.isFile()) throw refusal('not-a-file');
    if (stats.nlink > 1n) throw refusal('hard-link');
    const identity = identityOf(stats);
    if (stats.size > BigInt(MAX_BYTES)) return { kind: 'too-large', identity };
    const buffer = Buffer.alloc(Number(stats.size) + 1);
    let read = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, read, buffer.length - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
      if (read === buffer.length) throw refusal('changed');
    }
    const after = await lstat(path.join(root, INSTRUCTIONS_FILE), { bigint: true });
    if (after.ino !== stats.ino || after.dev !== stats.dev || after.ctimeNs !== stats.ctimeNs) throw refusal('changed');
    if (after.nlink > 1n) throw refusal('hard-link');
    return { kind: 'read', identity, bytes: buffer.subarray(0, read) };
  } finally {
    await handle.close();
  }
}

/** What `dir/SOUL.md` holds now. Occupancy comes from the entry itself, so a dangling link is present. */
export async function readInstructionsView(dir: string): Promise<AgentInstructionsView> {
  const file = path.join(dir, INSTRUCTIONS_FILE);
  let entry: BigIntStats;
  try {
    entry = await lstat(file, { bigint: true });
  } catch (error) {
    const code = codeOf(error);
    if (code === 'ENOENT') return MISSING;
    return { content: null, revision: revisionOf(null, null, null, code), canReplace: false, readError: readError(code) };
  }
  return readEntry(dir, entry);
}

/** Reads the `SOUL.md` entry `lstat` found; a symlink is refused before opening, also where `O_NOFOLLOW` does nothing (Windows). */
async function readEntry(dir: string, stats: BigIntStats): Promise<AgentInstructionsView> {
  const entry = identityOf(stats);
  try {
    if (stats.isSymbolicLink()) throw refusal('ELOOP');
    const target = await readTarget(dir, stats);
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

/** The text of `dir/SOUL.md` for a turn: '' when there is none; throws, with a path-free message, when it can't be read. */
export async function readInstructionsText(dir: string): Promise<string> {
  const view = await readInstructionsView(dir);
  if (view.content !== null) return view.content;
  if (view.revision === null) return '';
  throw new Error(view.readError ?? readError(null));
}

/** Why a write failed, in words that never carry a path. */
function writeError(code: string): string {
  switch (code) {
    case 'EACCES':
    case 'EPERM':
      return "Ori Kami isn't allowed to write in this folder.";
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
export async function guarded<T>(write: () => Promise<T>): Promise<T | WriteFailure> {
  try {
    return await write();
  } catch (error) {
    const code = codeOf(error);
    if (code === null) throw error;
    return { kind: 'failed', message: writeError(code) };
  }
}

type Published = { readonly kind: 'published'; readonly identity: string } | { readonly kind: 'exists' };

/** `link()` errors from a file system without hard links (FAT, exFAT, some network mounts). */
const NO_HARD_LINKS = new Set(['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV', 'ENOSYS']);

/** Exclusive create straight at `file`, for file systems without hard links; a crash mid-write can leave it partial there. */
async function writeExclusive(file: string, bytes: Buffer): Promise<Published> {
  let handle;
  try {
    handle = await open(file, 'wx');
  } catch (error) {
    if (codeOf(error) === 'EEXIST') return { kind: 'exists' };
    throw error;
  }
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    return { kind: 'published', identity: identityOf(await handle.stat({ bigint: true })) };
  } finally {
    await handle.close();
  }
}

/**
 * Publishes `bytes` as `dir/name` only if no entry has that name, not even a dangling link. The text is
 * written and synced to a file in `stagingDir` first, then hard-linked into place (atomic, fails on any
 * existing entry), so a crash never leaves a partial file and nothing else's file is ever removed.
 * `stagingDir` must be a folder only the host writes: `link()` follows a symlink, so a staging name the
 * agent could replace would let it publish any file the host can reach as `dir/name`.
 */
async function publish(stagingDir: string, dir: string, name: string, bytes: Buffer): Promise<Published> {
  await mkdir(stagingDir, { recursive: true });
  const staging = path.join(stagingDir, `${name}.${randomUUID()}.tmp`);
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
      const code = codeOf(error);
      if (code === 'EEXIST') return { kind: 'exists' };
      if (code !== null && NO_HARD_LINKS.has(code)) return await writeExclusive(path.join(dir, name), bytes);
      throw error;
    }
    return { kind: 'published', identity };
  } finally {
    await unlink(staging).catch(() => undefined);
  }
}

/** Whether an entry has this name, a dangling link included; checked first so a read-only folder still reports it. */
async function present(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return false;
    throw error;
  }
}

export type CreateInstructionsResult = { readonly kind: 'created'; readonly revision: string } | { readonly kind: 'occupied' } | WriteFailure;

/**
 * Creates `dir/SOUL.md` only when no entry has that name, so an existing file or link is never replaced. It is
 * staged in the host-only `stagingDir`; on another volume it is created in place instead, which a crash can
 * leave partial. A crash between linking it into place and unlinking the staging name leaves `SOUL.md` with
 * two links; the reader then refuses it and says how to fix it, rather than guess which link is whose.
 */
export function createInstructions(dir: string, stagingDir: string, content: string): Promise<CreateInstructionsResult> {
  return guarded(async () => {
    await mkdir(dir, { recursive: true });
    if (await present(path.join(dir, INSTRUCTIONS_FILE))) return { kind: 'occupied' };
    const bytes = Buffer.from(content, 'utf8');
    const published = await publish(stagingDir, dir, INSTRUCTIONS_FILE, bytes);
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
      if ((await publish(dir, dir, name, bytes)).kind === 'published') return { kind: 'saved', name };
    }
    throw new Error('Too many copies saved at the same time');
  });
}
