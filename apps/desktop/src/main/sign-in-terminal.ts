import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { lenient, PluginList, ProviderInfoResponse } from '@morrowbot/contracts';
import { z } from 'zod';
import type { SignInLaunch } from '../renderer/bridge.ts';
import { checkSender, IpcRefusedError, proxyRequest, type HostTarget } from './ipc-proxy.ts';
import type { FromRenderer } from './shell-actions.ts';

const ProviderId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const PluginListReply = lenient(PluginList);
const ProviderInfoReply = lenient(ProviderInfoResponse);

/** Checks an IPC `sign-in-terminal` message: a provider id, never a command. */
export function parseSignInRequest(options: FromRenderer): string {
  checkSender(options.sender, options.rendererUrl);
  const parsed = z.strictObject({ providerId: ProviderId }).safeParse(options.input);
  if (!parsed.success) throw new IpcRefusedError('Malformed sign-in request');
  return parsed.data.providerId;
}

interface HostContext {
  readonly host: HostTarget | undefined;
  readonly rendererUrl: string;
}

async function hostGet(path: string, context: HostContext): Promise<unknown> {
  const reply = await proxyRequest({
    sender: { kind: 'frame', url: context.rendererUrl, isMainFrame: true },
    rendererUrl: context.rendererUrl,
    input: { method: 'GET', path },
    host: context.host,
  });
  return reply.body;
}

/** What to run for a sign-in, as the host reports it now. */
export type SignInPlan =
  | { readonly kind: 'run'; readonly name: string; readonly argv: readonly string[] }
  | { readonly kind: 'unavailable'; readonly reason: string };

/**
 * The sign-in command of a built-in provider that is signed out, read from the host in main. A
 * community provider's command is never run, and the renderer never sends a command.
 */
export async function signInPlan(providerId: string, context: HostContext): Promise<SignInPlan> {
  const list = PluginListReply.safeParse(await hostGet('/api/plugins', context));
  const entry = list.success ? list.data.plugins.find(({ manifest }) => manifest.id === providerId) : undefined;
  if (entry?.manifest.kind !== 'provider') return { kind: 'unavailable', reason: 'MorrowBot could not find this provider.' };
  if (entry.source !== 'built-in') return { kind: 'unavailable', reason: 'Only built-in providers can sign in from here. Use the command instead.' };
  const reply = ProviderInfoReply.safeParse(await hostGet(`/api/plugins/${providerId}/info`, context));
  if (!reply.success) return { kind: 'unavailable', reason: "MorrowBot couldn't check this provider. Press Recheck and try again." };
  const { info } = reply.data;
  if (info.kind !== 'signed-out') return { kind: 'unavailable', reason: `${entry.manifest.name} doesn't need a sign-in now.` };
  return { kind: 'run', name: entry.manifest.name, argv: info.signIn.argv };
}

const quote = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`;

/** The `.command` file Terminal runs: every word POSIX-quoted, so it runs exactly the provider's argv. */
export function terminalScript(name: string, argv: readonly string[]): string {
  return [
    '#!/bin/sh',
    '# Written by MorrowBot for a one-click sign-in. Safe to delete.',
    `printf '%s\\n\\n' ${quote(`MorrowBot: signing in to ${name}. When it finishes, go back to MorrowBot; it rechecks by itself.`)}`,
    argv.map(quote).join(' '),
    `printf '\\n%s\\n' ${quote('Done. You can close this window.')}`,
    '',
  ].join('\n');
}

/** Writes the provider's sign-in script under the data folder and has macOS open it in Terminal. */
export async function openSignInTerminal(
  providerId: string,
  context: HostContext & { readonly dataDir: string; readonly platform: NodeJS.Platform; readonly open: (file: string) => Promise<string> },
): Promise<SignInLaunch> {
  if (context.platform !== 'darwin') return { kind: 'unavailable', reason: 'One-click sign-in works on macOS only. Use the command instead.' };
  const plan = await signInPlan(providerId, context);
  if (plan.kind === 'unavailable') return plan;
  const dir = path.join(context.dataDir, 'sign-in');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${providerId}.command`);
  await writeFile(file, terminalScript(plan.name, plan.argv), { mode: 0o700 });
  await chmod(file, 0o700);
  const problem = await context.open(file);
  return problem === '' ? { kind: 'opened' } : { kind: 'unavailable', reason: "Terminal didn't open. Use the command instead." };
}
