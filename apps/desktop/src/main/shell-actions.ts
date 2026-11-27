import { homedir, userInfo } from 'node:os';
import path from 'node:path';
import { AgentList } from '@morrowbot/contracts';
import { z } from 'zod';
import type { RevealTarget } from '../renderer/bridge.ts';
import { checkSender, IpcRefusedError, proxyRequest, type HostTarget, type IpcSender } from './ipc-proxy.ts';

interface FromRenderer {
  readonly sender: IpcSender;
  readonly rendererUrl: string;
  readonly input: unknown;
}

/** Checks an IPC `open-external` message: only http and https links leave the app. */
export function parseExternalUrl(options: FromRenderer): string {
  checkSender(options.sender, options.rendererUrl);
  const text = z.string().max(8_000).safeParse(options.input);
  const url = text.success ? URL.parse(text.data) : null;
  if (url === null || (url.protocol !== 'http:' && url.protocol !== 'https:')) throw new IpcRefusedError('Only http and https links open externally');
  return url.href;
}

const RevealInput = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('data-dir') }),
  z.strictObject({ kind: z.literal('agent-workspace'), agentId: z.string().min(1).max(200) }),
]);

/** Checks an IPC `reveal-path` message: an opaque id, never a path. */
export function parseRevealTarget(options: FromRenderer): RevealTarget {
  checkSender(options.sender, options.rendererUrl);
  const parsed = RevealInput.safeParse(options.input);
  if (!parsed.success) throw new IpcRefusedError('Malformed reveal request');
  return parsed.data;
}

/** The data folder the host uses: the same rule as the host's own config. */
export function dataDirOf(env: NodeJS.ProcessEnv): string {
  const configured = env.MORROWBOT_DATA_DIR;
  return configured !== undefined && path.isAbsolute(configured) ? configured : path.join(homedir(), '.morrowbot');
}

/** The folder a reveal id names, resolved in main; the agent's workspace comes from the host's own agent list. */
export async function resolveReveal(target: RevealTarget, context: { readonly dataDir: string; readonly host: HostTarget | undefined; readonly rendererUrl: string }): Promise<string> {
  switch (target.kind) {
    case 'data-dir':
      return context.dataDir;
    case 'agent-workspace': {
      const reply = await proxyRequest({
        sender: { kind: 'frame', url: context.rendererUrl, isMainFrame: true },
        rendererUrl: context.rendererUrl,
        input: { method: 'GET', path: '/api/agents' },
        host: context.host,
      });
      const agents = AgentList.safeParse(reply.body);
      const agent = agents.success ? agents.data.agents.find(({ id }) => id === target.agentId) : undefined;
      if (agent === undefined) throw new IpcRefusedError('No such agent to reveal');
      return agent.workspace.dir;
    }
  }
}

/** H6 `appInfo()`: read by the renderer's privacy rules and About, never shown raw. */
export function appInfoOf(appVersion: string, dataDir: string): { appVersion: string; homeDir: string; userName: string; dataDir: string } {
  return { appVersion, homeDir: homedir(), userName: userInfo().username, dataDir };
}
