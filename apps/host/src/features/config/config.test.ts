import { expect, it } from 'vitest';
import { parseHostConfig, type HostConfigResult } from './index.ts';

const parse = (env: NodeJS.ProcessEnv, args: readonly string[] = []): HostConfigResult =>
  parseHostConfig({ env, args, homeDir: '/home/user' });

function port(result: HostConfigResult): number | readonly string[] {
  return result.kind === 'ok' ? result.config.port : result.problems;
}

it('defaults the port and rejects a bad one', () => {
  expect([
    port(parse({})),
    port(parse({ MORROWBOT_HOST_PORT: '0' })),
    port(parse({ MORROWBOT_HOST_PORT: '' })),
    port(parse({ MORROWBOT_HOST_PORT: '   ' })),
    port(parse({ MORROWBOT_HOST_PORT: 'eighty' })),
    port(parse({ MORROWBOT_HOST_PORT: '70000' })),
  ]).toMatchInlineSnapshot(`
    [
      0,
      0,
      [
        "MORROWBOT_HOST_PORT: Expected an integer port",
      ],
      [
        "MORROWBOT_HOST_PORT: Expected an integer port",
      ],
      [
        "MORROWBOT_HOST_PORT: Expected an integer port",
      ],
      [
        "MORROWBOT_HOST_PORT: Too big: expected number to be <=65535",
      ],
    ]
  `);
});

it('turns on safe mode from the flag or the env, and places data in the dev folder under home unless told where', () => {
  expect([
    parse({}),
    parse({}, ['--safe-mode']),
    parse({ MORROWBOT_SAFE_MODE: '1', MORROWBOT_DATA_DIR: '/data' }),
    parse({ MORROWBOT_SAFE_MODE: 'yes', MORROWBOT_PLUGINS_DIR: 'relative' }, ['--verbose']),
  ]).toMatchInlineSnapshot(`
    [
      {
        "config": {
          "builtinPluginsDir": null,
          "dataDir": "/home/user/.morrowbot-dev",
          "hostname": "127.0.0.1",
          "pluginsDir": "/home/user/.morrowbot-dev/plugins",
          "port": 0,
          "safeMode": false,
          "t3Watch": {
            "bin": "/home/user/.t3/bin/t3",
            "dir": "/home/user/.morrowbot-dev/t3-watch",
            "projects": [],
            "routineId": null,
          },
        },
        "kind": "ok",
      },
      {
        "config": {
          "builtinPluginsDir": null,
          "dataDir": "/home/user/.morrowbot-dev",
          "hostname": "127.0.0.1",
          "pluginsDir": "/home/user/.morrowbot-dev/plugins",
          "port": 0,
          "safeMode": true,
          "t3Watch": {
            "bin": "/home/user/.t3/bin/t3",
            "dir": "/home/user/.morrowbot-dev/t3-watch",
            "projects": [],
            "routineId": null,
          },
        },
        "kind": "ok",
      },
      {
        "config": {
          "builtinPluginsDir": null,
          "dataDir": "/data",
          "hostname": "127.0.0.1",
          "pluginsDir": "/data/plugins",
          "port": 0,
          "safeMode": true,
          "t3Watch": {
            "bin": "/home/user/.t3/bin/t3",
            "dir": "/data/t3-watch",
            "projects": [],
            "routineId": null,
          },
        },
        "kind": "ok",
      },
      {
        "kind": "invalid",
        "problems": [
          "MORROWBOT_SAFE_MODE: Invalid option: expected one of "0"|"1"|"true"|"false"",
          "MORROWBOT_PLUGINS_DIR: Expected an absolute path",
          "--verbose: Unknown option",
        ],
      },
    ]
  `);
});

it('binds to loopback unless MORROWBOT_HOST_BIND names an IP address, kept in one spelling', () => {
  const bind = (value: string | undefined) => {
    const result = parse(value === undefined ? {} : { MORROWBOT_HOST_BIND: value });
    return result.kind === 'ok' ? result.config.hostname : result.problems;
  };
  const values = [undefined, '100.64.0.1', '0.0.0.0', '::', '0:0:0:0:0:0:0:0', '0:0:0:0:0:0:0:1', 'FD7A:115C:A1E0:0:0:0:0:1', '::ffff:127.0.0.1', 'studio-host.local', 'fe80::1%en0', ''];
  expect(Object.fromEntries(values.map((value) => [value ?? '(unset)', bind(value)]))).toMatchInlineSnapshot(`
    {
      "": [
        "MORROWBOT_HOST_BIND: Expected an IPv4 or IPv6 address, such as 100.64.0.1 or 0.0.0.0",
      ],
      "(unset)": "127.0.0.1",
      "0.0.0.0": "0.0.0.0",
      "0:0:0:0:0:0:0:0": "::",
      "0:0:0:0:0:0:0:1": "::1",
      "100.64.0.1": "100.64.0.1",
      "::": "::",
      "::ffff:127.0.0.1": [
        "MORROWBOT_HOST_BIND: Use the IPv4 form of an IPv4-mapped address",
      ],
      "FD7A:115C:A1E0:0:0:0:0:1": "fd7a:115c:a1e0::1",
      "fe80::1%en0": [
        "MORROWBOT_HOST_BIND: Expected an IPv4 or IPv6 address, such as 100.64.0.1 or 0.0.0.0",
      ],
      "studio-host.local": [
        "MORROWBOT_HOST_BIND: Expected an IPv4 or IPv6 address, such as 100.64.0.1 or 0.0.0.0",
      ],
    }
  `);
});

it('reads the T3 watcher settings, splitting the project list, trimming the routine id and refusing a relative watch folder', () => {
  const watch = (env: NodeJS.ProcessEnv) => {
    const result = parse(env);
    return result.kind === 'ok' ? result.config.t3Watch : result.problems;
  };
  expect([
    watch({ MORROWBOT_T3_WATCH_DIR: '/shared/t3-watch', MORROWBOT_T3_BIN: '/opt/t3', MORROWBOT_T3_PROJECTS: ' proj-a, /work/repo ,,', MORROWBOT_T3_ROUTINE_ID: ' routine-1 ' }),
    watch({ MORROWBOT_T3_WATCH_DIR: 'relative' }),
  ]).toMatchInlineSnapshot(`
    [
      {
        "bin": "/opt/t3",
        "dir": "/shared/t3-watch",
        "projects": [
          "proj-a",
          "/work/repo",
        ],
        "routineId": "routine-1",
      },
      [
        "MORROWBOT_T3_WATCH_DIR: Expected an absolute path",
      ],
    ]
  `);
});
