import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { z } from 'zod';

/**
 * The stdio MCP servers of the fake agy, as agy 1.5.18 runs them (checked on the real one): each
 * session starts the servers it is opened with, `session/close` leaves them running, `session/load`
 * starts the session's earlier servers again beside the new ones, and a call goes to the session's
 * oldest server that is still running.
 */
const StdioServer = z.looseObject({ name: z.string(), command: z.string(), args: z.array(z.string()), env: z.array(z.looseObject({ name: z.string(), value: z.string() })) });
type StdioServer = z.infer<typeof StdioServer>;
const Reply = z.looseObject({ id: z.number(), result: z.unknown().optional(), error: z.looseObject({ message: z.string() }).optional() });
const CallResult = z.looseObject({ content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })) });

interface Running {
  readonly child: ChildProcess;
  ready: boolean;
  exited: boolean;
  call(method: string, params: unknown): Promise<z.infer<typeof Reply> | null>;
}

const saved = new Map<string, StdioServer[]>();
const running = new Map<string, Running[]>();

function start(server: StdioServer): Running {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const { name, value } of server.env) env[name] = value;
  const child = spawn(server.command, server.args, { env, stdio: ['pipe', 'pipe', 'ignore'] });
  const waiting = new Map<number, (reply: z.infer<typeof Reply> | null) => void>();
  let next = 0;
  const entry: Running = {
    child,
    ready: false,
    exited: false,
    call: (method, params) =>
      new Promise((resolve) => {
        if (entry.exited) {
          resolve(null);
          return;
        }
        const id = ++next;
        waiting.set(id, resolve);
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      }),
  };
  child.on('exit', () => {
    entry.exited = true;
    for (const resolve of waiting.values()) resolve(null);
    waiting.clear();
  });
  child.on('error', () => undefined);
  child.stdin.on('error', () => undefined);
  createInterface({ input: child.stdout }).on('line', (line) => {
    const reply = Reply.safeParse(JSON.parse(line));
    if (!reply.success) return;
    waiting.get(reply.data.id)?.(reply.data);
    waiting.delete(reply.data.id);
  });
  void entry.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake-agy', version: '1.5.18' } }).then((reply) => {
    if (reply?.result === undefined) return;
    entry.ready = true;
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  });
  return entry;
}

/** Starts the stdio servers `session/new` (`loaded` false) or `session/load` named, and the session's saved ones on a load. */
export function openServers(sessionId: string, raw: unknown, loaded: boolean): void {
  const given = z.array(z.unknown()).catch([]).parse(raw).flatMap((each) => {
    const server = StdioServer.safeParse(each);
    return server.success ? [server.data] : [];
  });
  const earlier = loaded ? (saved.get(sessionId) ?? []) : [];
  saved.set(sessionId, [...earlier, ...given]);
  running.set(sessionId, [...(running.get(sessionId) ?? []), ...[...earlier, ...given].map(start)]);
}

/** Calls `tool` on the session's oldest running server: its first text, or why there was none. */
export async function callTool(sessionId: string, tool: string): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  const server = (running.get(sessionId) ?? []).find((each) => each.ready && !each.exited);
  if (server === undefined) return 'no server';
  const reply = await server.call('tools/call', { name: tool, arguments: {} });
  if (reply === null) return 'the server went away';
  if (reply.error !== undefined) return `error: ${reply.error.message}`;
  const result = CallResult.safeParse(reply.result);
  return result.success ? result.data.content.map((part) => part.text ?? '').join('') : 'unreadable';
}

/** How many of every server started so far are still running. */
export function runningCount(): number {
  return [...running.values()].flat().filter((each) => !each.exited).length;
}
