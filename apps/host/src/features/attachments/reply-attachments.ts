import { createHash } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import { mkdir, open, readdir, realpath, rename, stat, unlink, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MAX_REPLY_ATTACHMENTS, MAX_REPLY_ATTACHMENTS_BYTES, MAX_REPLY_ATTACHMENT_BYTES, type ReplyAttachment } from '@morrowbot/contracts';
import { kindOf, SNIFF_BYTES } from './file-kind.ts';

/** A saved reply attachment and what is kept beside it (the storage feature provides these). */
export interface StoredReplyFile {
  readonly attachment: ReplyAttachment;
  readonly threadId: string;
  readonly sha256: string;
}

export interface ReplyFileRecords {
  /** False (nothing saved) when the turn has settled. */
  insert(row: { readonly attachment: ReplyAttachment; readonly threadId: string; readonly generationId: string; readonly sha256: string; readonly createdAt: string }): boolean;
  listOpen(generationId: string): StoredReplyFile[];
  get(id: string): StoredReplyFile | undefined;
  ids(): Set<string>;
}

export interface ReplyAttachmentOptions {
  /** The data folder's `reply-attachments/`: each file is named by its id and is readable only by this user. */
  readonly dir: string;
  readonly records: ReplyFileRecords;
  /** The folder an agent may attach files from: its workspace, dedicated or shared. */
  readonly workspaceOf: (agentId: string) => string | undefined;
  readonly newId: () => string;
  readonly now: () => string;
}

/** The running turn a call attaches for. */
export interface AttachingTurn {
  readonly generationId: string;
  readonly agentId: string;
  readonly threadId: string;
  /** Aborts when the turn ends; nothing is saved after that. */
  readonly signal: AbortSignal;
}

export interface AttachResult {
  readonly attached: readonly ReplyAttachment[];
  readonly refused: readonly { readonly path: string; readonly reason: string }[];
}

export interface ReplyAttachments {
  /** Copies each file into the turn's reply, in order; a file that cannot be attached is refused with why. */
  attach(turn: AttachingTurn, paths: readonly string[]): Promise<AttachResult>;
  /** A saved attachment and the file its bytes are in. */
  find(id: string): { readonly attachment: ReplyAttachment; readonly file: string } | undefined;
  /** Removes files whose reply or chat is gone, and copies a crash left half written. */
  sweep(): Promise<void>;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const PART = '.part';

class Refusal extends Error {
  override readonly name = 'Refusal';
}

/** Read through a call so a check after an `await` sees the signal as it is now. */
const ended = (turn: AttachingTurn): boolean => turn.signal.aborted;

const codeOf = (error: unknown): unknown => (error instanceof Error && 'code' in error ? error.code : undefined);

/** Whether `child` is `root` or inside it; both are real paths. */
function inside(root: string, child: string): boolean {
  const relative = path.relative(root, child);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** A file name the contract accepts and shows as written: no separators, control or text-direction characters, at most 255 characters, extension kept. */
function nameOf(given: string): string {
  const base = path.basename(given).replaceAll(/[\\\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '_');
  if (base.length <= 255) return base;
  const extension = path.extname(base).slice(0, 16);
  return `${base.slice(0, 255 - extension.length)}${extension}`;
}

export function createReplyAttachments(options: ReplyAttachmentOptions): ReplyAttachments {
  const { dir, records } = options;
  /** Ids being copied, which a sweep must leave alone. */
  const writing = new Set<string>();
  /** One turn's attach calls run one after another, so its limits hold across calls. */
  const lanes = new Map<string, Promise<unknown>>();

  async function rootOf(agentId: string): Promise<string> {
    const workspace = options.workspaceOf(agentId);
    if (workspace === undefined) throw new Refusal('This agent has no workspace folder.');
    try {
      return await realpath(workspace);
    } catch {
      throw new Refusal("This agent's workspace folder is missing.");
    }
  }

  /** Opens `given` for reading only when it really is a regular file inside `root`, after every symlink. */
  async function openInside(root: string, given: string): Promise<{ handle: FileHandle; size: number }> {
    if (!path.isAbsolute(given)) throw new Refusal('Give the absolute path of a file in your workspace folder.');
    let real: string;
    try {
      real = await realpath(given);
    } catch (error) {
      throw new Refusal(codeOf(error) === 'ENOENT' ? 'No file is at this path.' : 'This file cannot be read.');
    }
    if (!inside(root, real)) throw new Refusal('Only files inside your workspace folder can be attached (symlinks are followed).');
    let handle: FileHandle;
    try {
      handle = await open(real, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch {
      throw new Refusal('This file cannot be read.');
    }
    try {
      const opened = await handle.stat();
      if (!opened.isFile()) throw new Refusal('Only regular files can be attached.');
      if (opened.nlink > 1) throw new Refusal('Files with more than one hard link cannot be attached; copy the file first.');
      const again = await realpath(real).catch(() => '');
      const now = inside(root, again) ? await stat(again).catch(() => undefined) : undefined;
      if (now?.ino !== opened.ino || now.dev !== opened.dev) throw new Refusal('The file moved while it was being attached.');
      return { handle, size: opened.size };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  /** Copies the open file to `<id>.part` (hashing it and keeping its first bytes), refusing it if its length changes. */
  async function copy(handle: FileHandle, size: number, part: string, signal: AbortSignal): Promise<{ sha256: string; head: Buffer }> {
    const hash = createHash('sha256');
    let head = Buffer.alloc(0);
    let read = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        read += chunk.length;
        if (read > size) {
          done(new Refusal('The file changed while it was being attached.'));
          return;
        }
        hash.update(chunk);
        if (head.length < SNIFF_BYTES) head = Buffer.concat([head, chunk.subarray(0, SNIFF_BYTES - head.length)]);
        done(null, chunk);
      },
    });
    await pipeline(handle.createReadStream({ start: 0, autoClose: false }), meter, createWriteStream(part, { flags: 'wx', mode: 0o600 }), { signal });
    if (read !== size) throw new Refusal('The file changed while it was being attached.');
    return { sha256: hash.digest('hex'), head };
  }

  async function attachOne(turn: AttachingTurn, root: string, given: string): Promise<ReplyAttachment> {
    if (ended(turn)) throw new Refusal('The turn ended before the file was attached.');
    const open = records.listOpen(turn.generationId);
    if (open.length >= MAX_REPLY_ATTACHMENTS) throw new Refusal(`A reply can carry up to ${String(MAX_REPLY_ATTACHMENTS)} files.`);
    const id = options.newId();
    if (!SAFE_ID.test(id)) throw new Error('Unsafe attachment id');
    const { handle, size } = await openInside(root, given);
    const part = path.join(dir, `${id}${PART}`);
    writing.add(id);
    try {
      if (size > MAX_REPLY_ATTACHMENT_BYTES) throw new Refusal('Files can be up to 100 MB.');
      const total = open.reduce((sum, { attachment }) => sum + attachment.size, 0);
      if (total + size > MAX_REPLY_ATTACHMENTS_BYTES) throw new Refusal("A reply's files can add up to 200 MB.");
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const copied = await copy(handle, size, part, turn.signal);
      const same = records.listOpen(turn.generationId).find(({ sha256 }) => sha256 === copied.sha256);
      if (same !== undefined) {
        await unlink(part);
        return same.attachment;
      }
      const name = nameOf(given);
      const attachment: ReplyAttachment = { ...kindOf(name, copied.head), id, name, size };
      await rename(part, path.join(dir, id));
      const saved = !ended(turn) && records.insert({ attachment, threadId: turn.threadId, generationId: turn.generationId, sha256: copied.sha256, createdAt: options.now() });
      if (!saved) {
        await unlink(path.join(dir, id));
        throw new Refusal('The turn ended before the file was attached.');
      }
      return attachment;
    } catch (error) {
      await unlink(part).catch(() => undefined);
      if (ended(turn) && !(error instanceof Refusal)) throw new Refusal('The turn ended before the file was attached.');
      throw error;
    } finally {
      writing.delete(id);
      await handle.close();
    }
  }

  async function attachAll(turn: AttachingTurn, paths: readonly string[]): Promise<AttachResult> {
    const attached: ReplyAttachment[] = [];
    const refused: { path: string; reason: string }[] = [];
    let root: string;
    try {
      root = await rootOf(turn.agentId);
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      return { attached, refused: paths.map((given) => ({ path: given, reason: error.message })) };
    }
    for (const given of paths) {
      try {
        const attachment = await attachOne(turn, root, given);
        if (!attached.some(({ id }) => id === attachment.id)) attached.push(attachment);
      } catch (error) {
        if (!(error instanceof Refusal)) throw error;
        refused.push({ path: given, reason: error.message });
      }
    }
    return { attached, refused };
  }

  return {
    attach: (turn, paths) => {
      const before = lanes.get(turn.generationId) ?? Promise.resolve();
      const run = before.then(() => attachAll(turn, paths));
      const settled = run.catch(() => undefined);
      lanes.set(turn.generationId, settled);
      void settled.then(() => {
        if (lanes.get(turn.generationId) === settled) lanes.delete(turn.generationId);
      });
      return run;
    },
    find: (id) => {
      const stored = SAFE_ID.test(id) ? records.get(id) : undefined;
      return stored === undefined ? undefined : { attachment: stored.attachment, file: path.join(dir, id) };
    },
    sweep: async () => {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (error) {
        if (codeOf(error) === 'ENOENT') return;
        throw error;
      }
      const kept = records.ids();
      const stale = names.filter((name) => {
        const id = name.endsWith(PART) ? name.slice(0, -PART.length) : name;
        return SAFE_ID.test(id) && !writing.has(id) && (name.endsWith(PART) || !kept.has(id));
      });
      await Promise.all(stale.map((name) => unlink(path.join(dir, name)).catch(() => undefined)));
    },
  };
}
