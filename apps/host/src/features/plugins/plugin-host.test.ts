import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { discoverPlugins } from './discovery.ts';
import type { PluginRecord } from './plugin-store.ts';
import { bootHost, collect, startTurn, statuses, stopHosts, turnRequest } from './plugin-test-kit.ts';

afterEach(stopHosts);

const failing = (failure: string): PluginRecord => ({ enabled: true, config: { failure } });

it('boots in safe mode with 0 plugin processes', async () => {
  const h = await bootHost({ safeMode: true });
  expect({ statuses: statuses(h.host), turn: startTurn(h, 'echo', 'g1', 'hi').started, info: await h.host.info('echo', false) })
    .toMatchInlineSnapshot(`
      {
        "info": {
          "kind": "unavailable",
          "reason": "Plugin "echo" is not running (safe-mode)",
        },
        "statuses": {
          "echo": {
            "kind": "safe-mode",
          },
          "faulty": {
            "kind": "safe-mode",
          },
        },
        "turn": "no worker",
      }
    `);
});

it('lists a built-in provider first and skips a plugin folder that reuses its id', async () => {
  const { plugins } = await discoverPlugins(fileURLToPath(new URL('./fixtures', import.meta.url)));
  const echo = plugins.find(({ manifest }) => manifest.id === 'echo');
  if (echo === undefined) throw new Error('the echo fixture is missing');
  const h = await bootHost({ builtins: [{ manifest: { ...echo.manifest, name: 'Built-in Echo' }, launch: echo.launch }] });
  expect({
    plugins: h.host.list().map(({ manifest, status }) => `${manifest.id} (${manifest.name}): ${status.kind}`),
    problems: h.host.problems,
  }).toMatchInlineSnapshot(`
    {
      "plugins": [
        "echo (Built-in Echo): running",
        "faulty (Faulty): invalid-config",
      ],
      "problems": [
        "echo: a plugin folder uses the id of a provider built into MorrowBot, so it was skipped",
      ],
    }
  `);
});

it('runs a provider turn in its own process and refuses turns for a tool plugin', async () => {
  const h = await bootHost({ records: { faulty: failing('none') } });
  const turn = startTurn(h, 'echo', 'g1', 'ping');
  const info = await h.host.info('echo', false);
  expect({
    statuses: statuses(h.host),
    info: info.kind === 'ok' ? { accountKey: info.info.kind === 'ready' ? info.info.accountKey : info.info.kind } : info,
    started: turn.started,
    result: await turn.result,
    tool: startTurn(h, 'faulty', 'g2', 'x').started,
    toolInfo: await h.host.info('faulty', false),
  }).toMatchInlineSnapshot(`
    {
      "info": {
        "accountKey": "acct-a",
      },
      "result": {
        "end": {
          "accountKey": "acct-a",
          "actualModel": "tiny",
          "finalText": null,
          "outcome": {
            "finishReason": "stop",
            "kind": "completed",
          },
          "sessionTouched": true,
          "usage": {
            "cacheWriteTokens": null,
            "cachedInputTokens": null,
            "inputTokens": 3,
            "kind": "reported",
            "outputTokens": 2,
            "reasoningTokens": null,
          },
        },
        "kind": "end",
        "text": "hello from pid CHILD: ping",
      },
      "started": "started",
      "statuses": {
        "echo": {
          "kind": "running",
        },
        "faulty": {
          "kind": "running",
        },
      },
      "tool": "binding-changed",
      "toolInfo": {
        "kind": "unavailable",
        "reason": "Plugin "faulty" is not a provider",
      },
    }
  `);
});

it('contains a crashing plugin: the host and its sibling keep running', async () => {
  const h = await bootHost({ records: { faulty: failing('crash-on-health') } });
  await h.host.checkHealth('faulty');
  const crashed = await h.untilStatus('faulty', 'crashed');
  expect({ crashed, echo: (await startTurn(h, 'echo', 'g1', 'still here').result).kind, echoHealth: await h.host.checkHealth('echo') })
    .toMatchInlineSnapshot(`
      {
        "crashed": {
          "kind": "crashed",
          "reason": {
            "code": 7,
            "kind": "exit",
            "signal": null,
          },
        },
        "echo": "end",
        "echoHealth": {
          "kind": "running",
        },
      }
    `);
});

it('marks a plugin that misses a health check unhealthy without wedging its slot', async () => {
  const h = await bootHost({ records: { faulty: failing('hang-on-health') }, timeouts: { healthMs: 200 } });
  const missed = await h.host.checkHealth('faulty');
  const changed = await h.host.setConfig('faulty', { failure: 'none' });
  expect({ missed, changed: changed.kind, after: await h.host.checkHealth('faulty') }).toMatchInlineSnapshot(`
    {
      "after": {
        "kind": "running",
      },
      "changed": "ok",
      "missed": {
        "detail": "The plugin did not answer "health" in time",
        "kind": "unhealthy",
      },
    }
  `);
});

it('logs a late reply and a reply to an unknown request, and keeps serving', async () => {
  const h = await bootHost({ records: { faulty: failing('slow-first-health') }, timeouts: { healthMs: 200 } });
  const missed = await h.host.checkHealth('faulty');
  await h.untilLog('ignored a late or unknown health-result for request 1');
  const answered = await h.host.checkHealth('faulty');
  expect({ missed, answered, logs: h.logs, events: h.events.filter((event) => event.pluginId === 'faulty') }).toMatchInlineSnapshot(`
    {
      "answered": {
        "kind": "running",
      },
      "events": [
        {
          "pluginId": "faulty",
          "status": {
            "kind": "starting",
          },
        },
        {
          "pluginId": "faulty",
          "status": {
            "kind": "running",
          },
        },
        {
          "pluginId": "faulty",
          "status": {
            "detail": "The plugin did not answer "health" in time",
            "kind": "unhealthy",
          },
        },
        {
          "pluginId": "faulty",
          "status": {
            "kind": "running",
          },
        },
      ],
      "logs": [
        "plugin faulty: ignored a late or unknown health-result for request 4242",
        "plugin faulty: ignored a late or unknown health-result for request 1",
        "plugin faulty: ignored a late or unknown health-result for request 4242",
      ],
      "missed": {
        "detail": "The plugin did not answer "health" in time",
        "kind": "unhealthy",
      },
    }
  `);
});

it('rejects invalid plugin config and keeps the saved config', async () => {
  const h = await bootHost({ records: { faulty: failing('explode') } });
  const rejected = await h.host.setConfig('echo', { greeting: 42, repeat: 9, extra: true });
  const undefinedValue = await h.host.setConfig('echo', { greeting: undefined });
  const savedAfterReject = await h.store.read('echo');
  const accepted = await h.host.setConfig('echo', { greeting: 'hey' });
  expect({
    faultyAtBoot: statuses(h.host).faulty,
    rejected,
    undefinedValue,
    savedAfterReject,
    accepted,
    replyAfterRestart: (await startTurn(h, 'echo', 'g1', 'again').result).text,
  }).toMatchInlineSnapshot(`
    {
      "accepted": {
        "config": {
          "accountKey": "acct-a",
          "blankCwd": "",
          "greeting": "hey",
          "repeat": 1,
          "routeInfo": "ok",
          "sessions": false,
        },
        "kind": "ok",
        "saved": {
          "greeting": "hey",
        },
      },
      "faultyAtBoot": {
        "kind": "invalid-config",
        "problems": [
          "failure: Invalid option: expected one of "none"|"crash-on-health"|"hang-on-health"|"slow-first-health"",
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
      "replyAfterRestart": "hey from pid CHILD: again",
      "savedAfterReject": undefined,
      "undefinedValue": {
        "kind": "invalid",
        "problems": [
          "greeting: Invalid input",
        ],
      },
    }
  `);
});

it('remembers a disabled plugin and refuses changes after stop', async () => {
  const h = await bootHost({ records: { faulty: failing('none') } });
  const worker = h.host.revision('echo').worker ?? -1;
  await h.host.setEnabled('echo', false);
  const afterDisable = statuses(h.host).echo;
  const refused = h.host.startTurn('echo', worker, turnRequest('g1', 'hi', h.workDir), collect().sink);
  const saved = await h.store.read('echo');
  await h.host.setEnabled('echo', true);
  const afterEnable = statuses(h.host).echo;
  await h.host.stop();
  const changeAfterStop = await h.host.setEnabled('echo', false).catch((error: unknown) => String(error));
  expect({ afterDisable, refused, saved, afterEnable, afterStop: statuses(h.host).echo, changeAfterStop }).toMatchInlineSnapshot(`
    {
      "afterDisable": {
        "kind": "disabled",
      },
      "afterEnable": {
        "kind": "running",
      },
      "afterStop": {
        "kind": "stopped",
      },
      "changeAfterStop": "Error: The plugin host has stopped",
      "refused": "binding-changed",
      "saved": {
        "config": {},
        "enabled": false,
      },
    }
  `);
});

it('disables provider plugins on Windows with a message, and still runs tool plugins', async () => {
  const h = await bootHost({ records: { faulty: failing('none') }, platform: 'win32' });
  expect({ statuses: statuses(h.host), turn: startTurn(h, 'echo', 'g1', 'hi').started }).toMatchInlineSnapshot(`
    {
      "statuses": {
        "echo": {
          "kind": "unsupported",
          "reason": "Provider plugins need macOS or Linux in this version of MorrowBot.",
        },
        "faulty": {
          "kind": "running",
        },
      },
      "turn": "no worker",
    }
  `);
});
