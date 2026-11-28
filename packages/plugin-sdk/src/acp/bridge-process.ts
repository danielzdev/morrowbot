import { connect } from 'node:net';
import { createInterface } from 'node:readline';
import { HostTools } from '@morrowbot/contracts';
import { z } from 'zod';
import { BRIDGE_KEY, BRIDGE_SOCKET } from './bridge-protocol.ts';

/**
 * The stdio MCP server an agent starts for Ori Bot's tools (`openHostToolsBridge`). It presents its
 * one-time key on the bridge socket, gets the turn's tools back, then posts each MCP message from
 * stdin to the host's Streamable HTTP endpoint and writes each answer to stdout. It exits when the
 * socket ends (the turn is over, or the key was spent or refused), when stdin closes, or when the
 * host refuses the token.
 */
const JsonRpc = z.looseObject({ jsonrpc: z.literal('2.0') });
const Request = z.looseObject({ id: z.union([z.string(), z.number()]), method: z.string() });

function quit(code: number, why: string): never {
  process.stderr.write(`Ori Bot tools bridge: ${why}\n`);
  process.exit(code);
}

function write(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function fail(id: string | number, message: string): void {
  write({ jsonrpc: '2.0', id, error: { code: -32603, message } });
}

async function forward(tools: Extract<HostTools, { kind: 'mcp' }>, line: string): Promise<void> {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  const request = Request.safeParse(message);
  const id = request.success ? request.data.id : null;
  let response: Response;
  try {
    response = await fetch(tools.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${tools.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: line,
    });
  } catch (error) {
    if (id !== null) fail(id, `Ori Bot's tools did not answer: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (response.status === 401) quit(0, "Ori Bot refused this turn's token: the turn is over");
  const text = await response.text();
  let body: unknown;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = null;
  }
  if (JsonRpc.safeParse(body).success) write(body);
  else if (id !== null) fail(id, `Ori Bot's tools answered HTTP ${String(response.status)}`);
}

function relay(tools: Extract<HostTools, { kind: 'mcp' }>): void {
  const lines = createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    if (line.trim() === '') return;
    forward(tools, line).catch((error: unknown) => {
      quit(1, error instanceof Error ? error.message : String(error));
    });
  });
  lines.on('close', () => {
    process.exit(0);
  });
}

const socketPath = process.env[BRIDGE_SOCKET] ?? '';
const key = process.env[BRIDGE_KEY] ?? '';
if (socketPath === '' || key === '') quit(2, `start it with ${BRIDGE_SOCKET} and ${BRIDGE_KEY} set`);
process.stdout.on('error', () => {
  process.exit(0);
});
const lifeline = connect(socketPath);
lifeline.setEncoding('utf8');
lifeline.on('error', () => {
  quit(1, "this turn's tools are gone");
});
let heard = '';
let started = false;
lifeline.on('close', () => {
  if (started) quit(0, "this turn's tools ended");
  quit(1, 'the bridge socket gave no tools: its key was spent, or the turn is over');
});
lifeline.write(`${key}\n`);
lifeline.on('data', (chunk: string) => {
  if (started) return;
  heard += chunk;
  const end = heard.indexOf('\n');
  if (end === -1) return;
  started = true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(heard.slice(0, end));
  } catch {
    parsed = null;
  }
  const tools = HostTools.safeParse(parsed);
  if (!tools.success || tools.data.kind !== 'mcp') quit(1, 'the bridge socket sent no tools');
  relay(tools.data);
});
