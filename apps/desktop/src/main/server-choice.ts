import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { HostUrl } from '@morrowbot/contracts';
import { z } from 'zod';
import type { HostTarget } from './ipc-proxy.ts';

/**
 * Which server this app uses, as the user chose on first launch or in Settings: its own (`local`, a host this app
 * starts) or one it joined (`remote`, kept with the token the server gave this app).
 */
export const ServerChoice = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('local') }),
  z.strictObject({ kind: z.literal('remote'), url: HostUrl, token: z.string().min(32), hostName: z.string().min(1) }),
]);
export type ServerChoice = z.infer<typeof ServerChoice>;
export type RemoteChoice = Extract<ServerChoice, { kind: 'remote' }>;

/** What this launch does: start its own host, connect to a joined server and start none, or ask first. */
export type ServerPlan =
  | { readonly kind: 'local' }
  | { readonly kind: 'remote'; readonly choice: RemoteChoice }
  | { readonly kind: 'ask' };

const fileOf = (dataDir: string): string => path.join(dataDir, 'server.json');

/** The saved choice; undefined when none was saved or the file is unreadable. */
export function readServerChoice(dataDir: string): ServerChoice | undefined {
  try {
    const parsed = ServerChoice.safeParse(JSON.parse(readFileSync(fileOf(dataDir), 'utf8')));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Saves the choice for every later launch, readable only by this user (it may hold a server token), replacing the file atomically. */
export function writeServerChoice(dataDir: string, choice: ServerChoice): void {
  mkdirSync(dataDir, { recursive: true });
  const file = fileOf(dataDir);
  writeFileSync(`${file}.tmp`, JSON.stringify(choice), { mode: 0o600 });
  chmodSync(`${file}.tmp`, 0o600);
  renameSync(`${file}.tmp`, file);
}

/**
 * No saved choice asks on a fresh install, but a data folder that already holds a server's database (from before this
 * choice existed) keeps running it, so an update never strands someone's agents.
 */
export function serverPlanOf(choice: ServerChoice | undefined, dataDir: string): ServerPlan {
  if (choice === undefined) return existsSync(path.join(dataDir, 'orikami.sqlite')) ? { kind: 'local' } : { kind: 'ask' };
  switch (choice.kind) {
    case 'local':
      return { kind: 'local' };
    case 'remote':
      return { kind: 'remote', choice };
  }
}

export function targetOf(choice: RemoteChoice): HostTarget {
  return { url: choice.url, token: choice.token };
}
