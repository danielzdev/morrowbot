import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent, MessageList, StartedSend, Thread } from '@morrowbot/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTestHost, type EventClient, type TestHost } from './testing/test-host.ts';

const FAKE_CLAUDE = fileURLToPath(new URL('./features/providers/fixtures/fake-claude.ts', import.meta.url));
const SECRET = 'sk-fence-check-7f3a';

/** Each line names a file of the data folder and whether the agent's shell could read or write it. */
const ATTEMPTS = (dataDir: string): string =>
  [
    `for name in vault-secrets.json vault.key vault.json orikami.sqlite; do if cat "${dataDir}/$name" >/dev/null 2>&1; then echo "$name: read"; else echo "$name: denied"; fi; done`,
    `for name in server.json plugins/new.js; do if (echo x > "${dataDir}/$name") 2>/dev/null; then echo "write $name: written"; else echo "write $name: denied"; fi; done`,
    `if mv "${dataDir}" "${dataDir}-moved" 2>/dev/null; then echo "data folder: moved"; else echo "data folder: stays"; fi`,
    'echo "workspace: $(echo hi > note.txt && cat note.txt)"',
  ].join('; ');

describe.runIf(process.platform === 'darwin')('a full-access agent on this Mac', () => {
  let home = '';
  let host: TestHost;
  let events: EventClient;

  beforeEach(async () => {
    home = await realpath(await mkdtemp(path.join(tmpdir(), 'orikami-vault-fence-')));
    vi.stubEnv('HOME', home);
    vi.stubEnv('CLAUDE_CONFIG_DIR', path.join(home, '.claude'));
    vi.stubEnv('USER', 'tester');
    host = await startTestHost({ dataDir: path.join(home, 'data'), platform: 'darwin' });
    events = await host.events();
    expect((await host.call('PUT', '/api/plugins/provider-claude/config', { config: { cliPath: FAKE_CLAUDE } })).status).toBe(200);
  });

  afterEach(async () => {
    await host.close();
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
    expect(host.errors).toEqual([]);
  });

  it('cannot read the vault files or the database from its shell, nor write outside its workspace or move the data folder, while its workspace works', async () => {
    expect((await host.call('POST', '/api/vault', { kind: 'api_key', label: 'Weather API', key: SECRET })).status).toBe(201);
    const provider = { kind: 'bound', pluginId: 'provider-claude', selection: { kind: 'default' }, access: 'full', vendorSettings: 'isolated' };
    const agent = Agent.parse((await host.call('POST', '/api/agents', { name: 'Shell', provider })).body);
    const thread = Thread.parse((await host.call('POST', `/api/agents/${agent.id}/threads`, { title: 'Chat' })).body);
    await events.watch(thread.id);
    const sent = await host.call('POST', `/api/threads/${thread.id}/messages`, { text: `run: ${ATTEMPTS(path.join(home, 'data'))}`, sessionChoice: { kind: 'auto' } });
    await events.finished(StartedSend.parse(sent.body).generationId);
    const { messages } = MessageList.parse((await host.call('GET', `/api/threads/${thread.id}/messages`)).body);
    const reply = messages.flatMap((message) => (message.kind === 'assistant' ? [message.text] : [])).join('\n');
    expect({ reply: reply.split('\n'), leaked: reply.includes(SECRET) }).toEqual({
      reply: [
        'vault-secrets.json: denied',
        'vault.key: denied',
        'vault.json: denied',
        'orikami.sqlite: denied',
        'write server.json: denied',
        'write plugins/new.js: denied',
        'data folder: stays',
        'workspace: hi',
      ],
      leaked: false,
    });
  });
});
