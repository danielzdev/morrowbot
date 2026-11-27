import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SendMessageResponse, type ChatEvent, type ProviderBinding, type Thread } from '@morrowbot/contracts';
import { z } from 'zod';
import { startChatFixture, type ChatFixture } from './chat-fixture.ts';
import type { Reply, TestHostOptions } from './test-host.ts';

export const FAKE_AGY = fileURLToPath(new URL('../features/providers/fixtures/fake-agy.ts', import.meta.url));

export const AGY: Extract<ProviderBinding, { kind: 'bound' }> = {
  kind: 'bound',
  pluginId: 'provider-antigravity',
  selection: { kind: 'default' },
  access: 'read-only',
  vendorSettings: 'personal',
};

const Logged = z.object({ daemon: z.number(), method: z.string(), params: z.unknown() });
export type Logged = z.infer<typeof Logged>;
const Launch = z.object({ pid: z.number(), args: z.array(z.string()) });

export interface AgyFixture extends ChatFixture {
  readonly home: string;
  /** Every request and reply the fake daemons got, oldest first. */
  log(): Promise<Logged[]>;
  /** The arguments of every fake agy daemon started, oldest first. */
  launches(): Promise<z.infer<typeof Launch>[]>;
  /** Merges into the fake's `state.json` at once. */
  setState(patch: Readonly<Record<string, unknown>>): Promise<void>;
  /** The provider-antigravity daemon rows the host tracks. */
  daemonPgids(): number[];
  post(thread: { readonly id: string }, text: string, sessionChoice?: { readonly kind: string }): Promise<Reply>;
  /** Posts and returns the turn's generation id without waiting. */
  start(thread: { readonly id: string }, text: string, sessionChoice?: { readonly kind: string }): Promise<string>;
  /** Waits for the turn's approval card and answers it with `choiceId`; returns the HTTP status. */
  answer(thread: Thread, generationId: string, choiceId: string): Promise<number>;
  /** The events of one generation received so far, typed. */
  turnEvents(generationId: string): ChatEvent[];
}

/**
 * A host whose built-in Antigravity provider runs the fake agy, with `$HOME` a temp folder.
 * Antigravity offers turns only on macOS (`platformReason`), so the host acts as on macOS on every OS.
 */
export async function startAgyFixture(options: Partial<TestHostOptions> = {}): Promise<AgyFixture> {
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'morrowbot-agy-')));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  const dir = path.join(home, 'fake-agy');
  await mkdir(dir, { recursive: true });
  const stateFile = path.join(dir, 'state.json');
  await writeFile(stateFile, '{}');
  const chat = await startChatFixture({ platform: 'darwin', ...options, dataDir: path.join(home, 'data') });
  const configured = await chat.host.call('PUT', '/api/plugins/provider-antigravity/config', { config: { cliPath: FAKE_AGY } });
  if (configured.status !== 200) throw new Error(`config refused: ${JSON.stringify(configured.body)}`);
  const lines = async (name: string): Promise<unknown[]> => {
    const text = await readFile(path.join(dir, name), 'utf8').catch(() => '');
    return text
      .split('\n')
      .filter((line) => line !== '')
      .map((line): unknown => JSON.parse(line));
  };
  const post = (thread: { readonly id: string }, text: string, sessionChoice: { readonly kind: string } = { kind: 'auto' }): Promise<Reply> =>
    chat.host.call('POST', `/api/threads/${thread.id}/messages`, { text, sessionChoice });
  return {
    ...chat,
    home,
    agent: (binding = AGY) => chat.agent(binding),
    log: async () => (await lines('log.jsonl')).map((line) => Logged.parse(line)),
    launches: async () => (await lines('launches.jsonl')).map((line) => Launch.parse(line)),
    setState: async (patch) => {
      const now = z.record(z.string(), z.unknown()).parse(JSON.parse(await readFile(stateFile, 'utf8')));
      await writeFile(stateFile, JSON.stringify({ ...now, ...patch }));
    },
    daemonPgids: () => chat.host.host.plugins.groups.daemons('provider-antigravity').map((row) => row.pgid),
    post,
    start: async (thread, text, sessionChoice) => SendMessageResponse.parse((await post(thread, text, sessionChoice)).body).generationId,
    answer: async (thread, generationId, choiceId) => {
      const requested = (event: ChatEvent): boolean => event.kind === 'generation.approval-requested' && event.generationId === generationId;
      await chat.events.until(requested);
      const card = chat.events.received.find(requested);
      const approvalId = card?.kind === 'generation.approval-requested' ? card.approval.approvalId : '';
      return (await chat.host.call('POST', `/api/threads/${thread.id}/approvals/${approvalId}`, { generationId, choiceId })).status;
    },
    turnEvents: (generationId) => chat.events.received.filter((event) => event.kind !== 'usage.updated' && event.generationId === generationId),
    close: async () => {
      await chat.close();
      process.env.HOME = previousHome;
      await rm(home, { recursive: true, force: true });
    },
  };
}

/** The methods the fake got, without the handshake. */
export function turnMethods(log: readonly Logged[]): string[] {
  return log.filter((entry) => entry.method !== 'initialize').map((entry) => entry.method);
}
