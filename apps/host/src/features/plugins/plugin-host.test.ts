import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PluginStatusEvent, StreamChunk } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  createJsonPluginStore,
  DEFAULT_PLUGIN_TIMEOUTS,
  startPluginHost,
  type PluginHost,
  type PluginRecord,
  type PluginStore,
} from './index.ts';

const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));

let dataDir = '';
let store: PluginStore;
const hosts: PluginHost[] = [];

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'morrowbot-plugins-'));
  store = createJsonPluginStore(path.join(dataDir, 'plugins.json'));
});

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.stop()));
  await rm(dataDir, { recursive: true, force: true });
});

interface BootOptions {
  readonly safeMode?: boolean;
  readonly records?: Readonly<Record<string, PluginRecord>>;
  readonly healthMs?: number;
}

async function boot({ safeMode = false, records = {}, healthMs }: BootOptions = {}): Promise<PluginHost> {
  for (const [id, record] of Object.entries(records)) await store.write(id, record);
  const host = await startPluginHost({
    pluginsDir: FIXTURES,
    store,
    safeMode,
    timeouts: { ...DEFAULT_PLUGIN_TIMEOUTS, healthMs: healthMs ?? DEFAULT_PLUGIN_TIMEOUTS.healthMs },
  });
  hosts.push(host);
  return host;
}

const statuses = (host: PluginHost) =>
  Object.fromEntries(host.list().map(({ manifest, status }) => [manifest.id, status]));

async function ask(host: PluginHost, content: string): Promise<string> {
  const chunks: StreamChunk[] = [];
  const finish = await host.stream('echo', { messages: [{ role: 'user', content }] }, (chunk) => chunks.push(chunk));
  const text = chunks.map((chunk) => chunk.text).join('');
  return `${text.replace(/pid (\d+)/, (_, pid: string) => (Number(pid) === process.pid ? 'pid HOST' : 'pid CHILD'))} [${finish}]`;
}

const failing = (failure: string): PluginRecord => ({ enabled: true, config: { failure } });

it('boots in safe mode with 0 plugin processes', async () => {
  const host = await boot({ safeMode: true });
  const refused = await ask(host, 'hi').catch((error: unknown) => String(error));
  expect({ statuses: statuses(host), refused, problems: host.problems }).toMatchInlineSnapshot(`
    {
      "problems": [],
      "refused": "Error: Plugin "echo" is not running (safe-mode)",
      "statuses": {
        "echo": {
          "kind": "safe-mode",
        },
        "faulty": {
          "kind": "safe-mode",
        },
      },
    }
  `);
});

it('runs a plugin in its own process and exchanges typed messages with it', async () => {
  const host = await boot({ records: { faulty: failing('none') } });
  expect({
    statuses: statuses(host),
    reply: await ask(host, 'ping'),
    health: await host.checkHealth('echo'),
    toolStream: await host
      .stream('faulty', { messages: [{ role: 'user', content: 'x' }] }, () => undefined)
      .catch((error: unknown) => String(error)),
  }).toMatchInlineSnapshot(`
    {
      "health": {
        "kind": "running",
      },
      "reply": "hello from pid CHILD: ping [stop]",
      "statuses": {
        "echo": {
          "kind": "running",
        },
        "faulty": {
          "kind": "running",
        },
      },
      "toolStream": "Error: Plugin "faulty" is not a provider",
    }
  `);
});

it('contains a crashing plugin: the host and its sibling keep running', async () => {
  const host = await boot({ records: { faulty: failing('crash-on-health') } });
  const events: PluginStatusEvent[] = [];
  host.onStatus((event) => events.push(event));
  const faulty = await host.checkHealth('faulty');
  expect({
    faulty,
    events,
    echoReply: await ask(host, 'still here'),
    echoHealth: await host.checkHealth('echo'),
  }).toMatchInlineSnapshot(`
    {
      "echoHealth": {
        "kind": "running",
      },
      "echoReply": "hello from pid CHILD: still here [stop]",
      "events": [
        {
          "pluginId": "faulty",
          "status": {
            "kind": "crashed",
            "reason": {
              "code": 7,
              "kind": "exit",
              "signal": null,
            },
          },
        },
      ],
      "faulty": {
        "kind": "crashed",
        "reason": {
          "code": 7,
          "kind": "exit",
          "signal": null,
        },
      },
    }
  `);
});

it('kills a plugin that stops answering and marks it crashed', async () => {
  const host = await boot({ records: { faulty: failing('hang-on-health') }, healthMs: 200 });
  expect({
    faulty: await host.checkHealth('faulty'),
    echoReply: await ask(host, 'still here'),
  }).toMatchInlineSnapshot(`
    {
      "echoReply": "hello from pid CHILD: still here [stop]",
      "faulty": {
        "kind": "crashed",
        "reason": {
          "kind": "timeout",
          "request": "health",
        },
      },
    }
  `);
});

it('rejects invalid plugin config and keeps the saved config', async () => {
  const host = await boot({ records: { faulty: failing('explode') } });
  const rejected = await host.setConfig('echo', { greeting: 42, repeat: 9, extra: true });
  const savedAfterReject = await store.read('echo');
  const accepted = await host.setConfig('echo', { greeting: 'hey', repeat: 2 });
  expect({
    faultyAtBoot: statuses(host).faulty,
    rejected,
    savedAfterReject,
    accepted,
    replyAfterRestart: await ask(host, 'again'),
    stateFile: await readFile(path.join(dataDir, 'plugins.json'), 'utf8'),
  }).toMatchInlineSnapshot(`
    {
      "accepted": {
        "config": {
          "greeting": "hey",
          "repeat": 2,
        },
        "kind": "ok",
      },
      "faultyAtBoot": {
        "kind": "invalid-config",
        "problems": [
          "failure: Invalid option: expected one of "none"|"crash-on-health"|"hang-on-health"",
        ],
      },
      "rejected": {
        "kind": "invalid",
        "problems": [
          "greeting: Invalid input: expected string, received number",
          "repeat: Too big: expected number to be <=3",
          "(root): Unrecognized key: "extra"",
        ],
      },
      "replyAfterRestart": "hey from pid CHILD: again again [stop]",
      "savedAfterReject": undefined,
      "stateFile": "{
      "version": 1,
      "plugins": {
        "faulty": {
          "enabled": true,
          "config": {
            "failure": "explode"
          }
        },
        "echo": {
          "enabled": true,
          "config": {
            "greeting": "hey",
            "repeat": 2
          }
        }
      }
    }
    ",
    }
  `);
});

it('remembers a disabled plugin across restarts', async () => {
  const first = await boot({ records: { faulty: failing('none') } });
  await first.setEnabled('echo', false);
  const afterDisable = statuses(first).echo;
  await first.stop();
  const second = await boot();
  const afterRestart = statuses(second).echo;
  const refused = await ask(second, 'hi').catch((error: unknown) => String(error));
  await second.setEnabled('echo', true);
  expect({ afterDisable, afterRestart, refused, afterEnable: statuses(second).echo }).toMatchInlineSnapshot(`
    {
      "afterDisable": {
        "kind": "disabled",
      },
      "afterEnable": {
        "kind": "running",
      },
      "afterRestart": {
        "kind": "disabled",
      },
      "refused": "Error: Plugin "echo" is not running (disabled)",
    }
  `);
});
