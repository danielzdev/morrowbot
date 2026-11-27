import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { z } from 'zod';

/** The Codex CLI the live fixtures run: `MORROWBOT_CODEX_PATH`, else `codex` on PATH. */
export const CODEX_PATH = process.env.MORROWBOT_CODEX_PATH ?? 'codex';

const Reply = z.looseObject({ id: z.number(), result: z.unknown().optional(), error: z.looseObject({ message: z.string() }).optional() });
const Note = z.looseObject({ method: z.string(), params: z.unknown().optional() });

export interface RawCodex {
  /** Sends a request and resolves with its result; a JSON-RPC error rejects. */
  call(method: string, params: unknown): Promise<unknown>;
  /** Every notification so far, oldest first. */
  readonly notes: { readonly method: string; readonly params: unknown }[];
  close(): void;
}

/** A bare `codex app-server` for checks the plugin does not expose; it declines every server request. */
export async function rawCodex(env: Readonly<Record<string, string>> = {}): Promise<RawCodex> {
  const child = spawn(CODEX_PATH, ['app-server', '-c', 'thread_unload_delay_secs=0'], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, ...env } });
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const notes: { method: string; params: unknown }[] = [];
  let next = 0;
  const write = (message: unknown): void => {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message: unknown = JSON.parse(line);
    const note = Note.safeParse(message);
    const reply = Reply.safeParse(message);
    if (note.success && reply.success) {
      write({ jsonrpc: '2.0', id: reply.data.id, error: { code: -32601, message: 'declined by the live fixture' } });
    } else if (note.success) {
      notes.push({ method: note.data.method, params: note.data.params });
    } else if (reply.success) {
      const waiter = pending.get(reply.data.id);
      pending.delete(reply.data.id);
      if (reply.data.error) waiter?.reject(new Error(reply.data.error.message));
      else waiter?.resolve(reply.data.result);
    }
  });
  const call = (method: string, params: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve, reject });
      write({ jsonrpc: '2.0', id, method, params });
    });
  await call('initialize', { clientInfo: { name: 'morrowbot-live', title: null, version: '0.0.0' }, capabilities: { experimentalApi: true } });
  write({ jsonrpc: '2.0', method: 'initialized' });
  return {
    call,
    notes,
    close: () => {
      child.kill();
    },
  };
}
