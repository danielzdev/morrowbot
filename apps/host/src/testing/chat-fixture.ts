import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Agent, MessageList, StartedSend, Thread, type GenerationOutcome, type PluginConfig, type ProviderBinding } from '@morrowbot/contracts';
import { PLUGIN_FIXTURES, startTestHost, type EventClient, type Reply, type TestHost, type TestHostOptions } from './test-host.ts';

export const ECHO: Extract<ProviderBinding, { kind: 'bound' }> = {
  kind: 'bound',
  pluginId: 'echo',
  selection: { kind: 'default' },
  access: 'read-only',
  vendorSettings: 'isolated',
};

/** A host running the fixture plugins (chat goes through `echo` unless agents bind another), with an events socket. */
export interface ChatFixture {
  readonly dataDir: string;
  readonly host: TestHost;
  readonly events: EventClient;
  agent(binding?: ProviderBinding): Promise<Agent>;
  thread(agent: Agent, title?: string): Promise<Thread>;
  /** Sends and, when started, waits for the turn to finish. */
  send(thread: Thread, text: string, sessionChoice?: { kind: 'auto' | 'continue-existing' | 'new-seeded' }): Promise<Reply>;
  configure(config: PluginConfig): Promise<void>;
  /** Overrides the account the echo plugin reports (read on each call). */
  signIn(accountKey: string): Promise<void>;
  /** `user: …` / `assistant(outcome): …` lines, with the echo pid hidden. */
  history(thread: Thread): Promise<string[]>;
  close(): Promise<void>;
}

export async function startChatFixture(options: Partial<TestHostOptions> = {}): Promise<ChatFixture> {
  const dataDir = options.dataDir ?? (await mkdtemp(path.join(tmpdir(), 'oribot-chat-')));
  const host = await startTestHost({ ...options, dataDir, pluginsDir: options.pluginsDir ?? PLUGIN_FIXTURES });
  const events = await host.events();
  const fixture: ChatFixture = {
    dataDir,
    host,
    events,
    agent: async (binding = ECHO) => Agent.parse((await host.call('POST', '/api/agents', { name: 'Helper', provider: binding })).body),
    thread: async (agent, title = 'Chat') => {
      const thread = Thread.parse((await host.call('POST', `/api/agents/${agent.id}/threads`, { title })).body);
      await events.watch(thread.id);
      return thread;
    },
    send: async (thread, text, sessionChoice = { kind: 'auto' }) => {
      const reply = await host.call('POST', `/api/threads/${thread.id}/messages`, { text, sessionChoice });
      const sent = StartedSend.safeParse(reply.body);
      if (sent.success) await events.finished(sent.data.generationId);
      return reply;
    },
    configure: async (config) => {
      const reply = await host.call('PUT', '/api/plugins/echo/config', { config });
      if (reply.status !== 200) throw new Error(`config refused: ${JSON.stringify(reply.body)}`);
    },
    signIn: async (accountKey) => {
      await mkdir(path.join(dataDir, 'plugin-data', 'echo'), { recursive: true });
      await writeFile(path.join(dataDir, 'plugin-data', 'echo', 'account'), accountKey);
    },
    history: async (thread) => {
      const reply = await host.call('GET', `/api/threads/${thread.id}/messages`);
      const body = MessageList.parse(reply.body);
      return body.messages.map((message) => {
        const text = hidePid(message.text);
        return message.kind === 'user' ? `user: ${text}` : `assistant(${outcomeLabel(message.outcome)}): ${text}`;
      });
    },
    close: async () => {
      await host.close();
      if (options.dataDir === undefined) await rm(dataDir, { recursive: true, force: true });
    },
  };
  return fixture;
}

export function hidePid(text: string): string {
  return text.replaceAll(/from pid \d+/g, 'from pid <pid>');
}

function outcomeLabel(outcome: GenerationOutcome): string {
  return outcome.kind === 'failed' ? `failed ${outcome.error.kind}` : outcome.kind;
}
