import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { StartedSend, type ChatEvent, type ProviderBinding, type Thread } from '@morrowbot/contracts';
import { z } from 'zod';
import { startChatFixture, type ChatFixture } from './chat-fixture.ts';
import { loggedTimes } from './logged.ts';
import type { Reply, TestHostOptions } from './test-host.ts';

const Logged = z.object({ daemon: z.number(), method: z.string(), params: z.unknown() });
export type Logged = z.infer<typeof Logged>;
const Launch = z.object({ pid: z.number(), args: z.array(z.string()), env: z.record(z.string(), z.string()).optional() });
export type Launch = z.infer<typeof Launch>;

/** A host whose built-in ACP provider runs a fake agent CLI, with `$HOME` a temp folder. */
export interface AcpFixture extends ChatFixture {
  readonly home: string;
  /** Every request and reply the fake daemons got, oldest first. */
  log(): Promise<Logged[]>;
  /** The log once it holds `method` `count` times: a provider sends its cleanup without waiting for it. */
  logged(method: string, count: number): Promise<Logged[]>;
  /** What every fake daemon was started with, oldest first. */
  launches(): Promise<Launch[]>;
  /** Merges into the fake's `state.json` at once. */
  setState(patch: Readonly<Record<string, unknown>>): Promise<void>;
  /** The provider's daemon rows the host tracks. */
  daemonPgids(): number[];
  post(thread: { readonly id: string }, text: string, sessionChoice?: { readonly kind: string }): Promise<Reply>;
  /** Posts and returns the turn's generation id without waiting. */
  start(thread: { readonly id: string }, text: string, sessionChoice?: { readonly kind: string }): Promise<string>;
  /** Waits for the turn's approval card and answers it with `choiceId`; returns the HTTP status. */
  answer(thread: Thread, generationId: string, choiceId: string): Promise<number>;
  /** The events of one generation received so far, typed. */
  turnEvents(generationId: string): ChatEvent[];
  /** A turn's status details, approval cards and tool events, one line each, with `$HOME` hidden. */
  steps(generationId: string): string[];
}

export interface AcpFixtureSetup {
  readonly binding: Extract<ProviderBinding, { kind: 'bound' }>;
  /** The fake CLI. */
  readonly fake: string;
  /**
   * How it is set as the provider's `cliPath`: `direct`, or `wrapped` in a script that runs it with
   * `MORROWBOT_FAKE_HOME` set to `$HOME`, for a provider that starts its CLI with a `HOME` of its own.
   */
  readonly cli: 'direct' | 'wrapped';
  /** The fake's own folder under `$HOME` (its `state.json`, `log.jsonl` and `launches.jsonl`). */
  readonly stateDir: string;
}

/** Starts the host with `setup.fake` as the provider's CLI. ACP providers offer turns only on macOS, so the host acts as on macOS on every OS. */
export async function startAcpFixture(setup: AcpFixtureSetup, options: Partial<TestHostOptions> = {}): Promise<AcpFixture> {
  const { binding } = setup;
  const home = await realpath(await mkdtemp(path.join(tmpdir(), `morrowbot-${setup.stateDir}-`)));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  const dir = path.join(home, setup.stateDir);
  await mkdir(dir, { recursive: true });
  const stateFile = path.join(dir, 'state.json');
  await writeFile(stateFile, '{}');
  const cli = setup.cli === 'direct' ? setup.fake : await wrap(setup.fake, home);
  const chat = await startChatFixture({ platform: 'darwin', ...options, dataDir: path.join(home, 'data') });
  const configured = await chat.host.call('PUT', `/api/plugins/${binding.pluginId}/config`, { config: { cliPath: cli } });
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
  const log = async (): Promise<Logged[]> => (await lines('log.jsonl')).map((line) => Logged.parse(line));
  return {
    ...chat,
    home,
    agent: (chosen = binding) => chat.agent(chosen),
    log,
    logged: (method, count) => loggedTimes(log, method, count),
    launches: async () => (await lines('launches.jsonl')).map((line) => Launch.parse(line)),
    setState: async (patch) => {
      const now = z.record(z.string(), z.unknown()).parse(JSON.parse(await readFile(stateFile, 'utf8')));
      await writeFile(stateFile, JSON.stringify({ ...now, ...patch }));
    },
    daemonPgids: () => chat.host.host.plugins.groups.daemons(binding.pluginId).map((row) => row.pgid),
    post,
    start: async (thread, text, sessionChoice) => StartedSend.parse((await post(thread, text, sessionChoice)).body).generationId,
    answer: async (thread, generationId, choiceId) => {
      const requested = (event: ChatEvent): boolean => event.kind === 'generation.approval-requested' && event.generationId === generationId;
      await chat.events.until(requested);
      const card = chat.events.received.find(requested);
      const approvalId = card?.kind === 'generation.approval-requested' ? card.approval.approvalId : '';
      return (await chat.host.call('POST', `/api/threads/${thread.id}/approvals/${approvalId}`, { generationId, choiceId })).status;
    },
    turnEvents: (generationId) => chat.events.received.filter((event) => event.kind !== 'usage.updated' && event.kind !== 'queue.changed' && event.generationId === generationId),
    steps: (generationId) =>
      chat.events.received.flatMap((event) => (event.kind !== 'usage.updated' && event.kind !== 'queue.changed' && event.generationId === generationId ? describeStep(event).map((line) => line.replaceAll(home, '$HOME')) : [])),
    close: async () => {
      await chat.close();
      process.env.HOME = previousHome;
      await rm(home, { recursive: true, force: true });
    },
  };
}

function describeStep(event: ChatEvent): string[] {
  switch (event.kind) {
    case 'generation.status':
      return event.detail === null ? [] : [`status: ${event.detail}`];
    case 'generation.tool-start':
      return [`tool-start ${event.name}: ${JSON.stringify(event.input)}`];
    case 'generation.tool-end':
      return [`tool-end: ${event.outcome}`];
    case 'generation.approval-requested':
      return [`card: ${event.approval.summary} [${event.approval.choices.map((choice) => choice.id).join(', ')}]`];
    case 'generation.approval-resolved':
      return [`card resolved: ${JSON.stringify(event.resolution)}`];
    case 'generation.started':
    case 'generation.delta':
    case 'generation.steered':
    case 'generation.finished':
    case 'queue.changed':
    case 'generation.background-started':
    case 'generation.background-finished':
    case 'subagent.changed':
    case 'usage.updated':
      return [];
  }
}

/** The methods the fake got, without the handshake. */
export function turnMethods(log: readonly Logged[]): string[] {
  return log.filter((entry) => entry.method !== 'initialize').map((entry) => entry.method);
}

/** A script in `home` that runs `fake` with `MORROWBOT_FAKE_HOME` set to `home`. */
async function wrap(fake: string, home: string): Promise<string> {
  const script = path.join(home, 'bin', path.basename(fake, '.ts'));
  await mkdir(path.dirname(script));
  await writeFile(script, `#!/bin/sh\nMORROWBOT_FAKE_HOME='${home}' exec '${fake}' "$@"\n`);
  await chmod(script, 0o755);
  return script;
}
