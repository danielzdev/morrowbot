import { mkdir } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';
import { AgentList, INSTRUCTIONS_COPY_NAME } from '@morrowbot/contracts';
import { z } from 'zod';
import type { LoginItem, RevealTarget } from '../renderer/bridge.ts';
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
  z.strictObject({ kind: z.literal('instructions-copy'), agentId: z.string().min(1).max(200), revealId: z.string().regex(INSTRUCTIONS_COPY_NAME) }),
  z.strictObject({ kind: z.literal('global-skills') }),
  z.strictObject({ kind: z.literal('agent-skills'), agentId: z.string().min(1).max(200) }),
]);

/** Checks an IPC `reveal-path` message: an opaque id, never a path. */
export function parseRevealTarget(options: FromRenderer): RevealTarget {
  checkSender(options.sender, options.rendererUrl);
  const parsed = RevealInput.safeParse(options.input);
  if (!parsed.success) throw new IpcRefusedError('Malformed reveal request');
  return parsed.data;
}

interface RevealContext {
  readonly dataDir: string;
  readonly host: HostTarget | undefined;
  readonly rendererUrl: string;
}

/** The agent as the host's own agent list has it, so an id from the renderer never becomes a path by itself. */
async function hostAgent(agentId: string, context: RevealContext) {
  const reply = await proxyRequest({
    sender: { kind: 'frame', url: context.rendererUrl, isMainFrame: true },
    rendererUrl: context.rendererUrl,
    input: { method: 'GET', path: '/api/agents' },
    host: context.host,
  });
  const agents = AgentList.safeParse(reply.body);
  const agent = agents.success ? agents.data.agents.find(({ id }) => id === agentId) : undefined;
  if (agent === undefined) throw new IpcRefusedError('No such agent to reveal');
  return agent;
}

/** The folder or file a reveal id names, resolved in main. */
export async function resolveReveal(target: RevealTarget, context: RevealContext): Promise<string> {
  switch (target.kind) {
    case 'data-dir':
      return context.dataDir;
    case 'agent-workspace':
      return (await hostAgent(target.agentId, context)).workspace.dir;
    case 'instructions-copy': {
      const agent = await hostAgent(target.agentId, context);
      return path.join(context.dataDir, 'instructions-drafts', agent.id, target.revealId);
    }
    case 'global-skills':
      return skillsFolder(path.join(context.dataDir, 'skills'));
    case 'agent-skills':
      return skillsFolder(path.join((await hostAgent(target.agentId, context)).workspace.dir, '.morrowbot', 'skills'));
  }
}

/** A skills folder to reveal, made first so Finder has something to show. */
async function skillsFolder(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  return dir;
}

/** H6 `appInfo()`: read by the renderer's privacy rules and About, never shown raw. */
export function appInfoOf(appVersion: string, dataDir: string): { appVersion: string; homeDir: string; userName: string; dataDir: string } {
  return { appVersion, homeDir: homedir(), userName: userInfo().username, dataDir };
}

/** Checks an IPC `set-open-at-login` message: a boolean. */
export function parseOpenAtLogin(options: FromRenderer): boolean {
  checkSender(options.sender, options.rendererUrl);
  const open = z.boolean().safeParse(options.input);
  if (!open.success) throw new IpcRefusedError('Malformed login item request');
  return open.data;
}

/** The login item state for the renderer; `null` where this build cannot register one. */
export function loginItemOf(openAtLogin: boolean | null): LoginItem {
  return openAtLogin === null ? { kind: 'unsupported' } : { kind: 'supported', openAtLogin };
}
