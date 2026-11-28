import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { HostTools } from '@morrowbot/contracts';

/** The host tools the echo fixture's latest turn got (it saves them in its data folder). */
export async function savedTools(dataDir: string): Promise<HostTools> {
  const saved: unknown = JSON.parse(await readFile(path.join(dataDir, 'plugin-data', 'echo', 'host-tools.json'), 'utf8'));
  return HostTools.parse(saved);
}

/** POSTs one JSON-RPC message to the host's MCP endpoint as an MCP client would. */
export async function postMcp(url: string, token: string, body: object, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const parsed: unknown = text === '' ? null : JSON.parse(text);
  return { status: response.status, body: parsed };
}
