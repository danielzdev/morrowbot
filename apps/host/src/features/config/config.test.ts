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
      47800,
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

it('turns on safe mode from the flag or the env, and places data under the home folder', () => {
  expect([
    parse({}),
    parse({}, ['--safe-mode']),
    parse({ MORROWBOT_SAFE_MODE: '1', MORROWBOT_DATA_DIR: '/data' }),
    parse({ MORROWBOT_SAFE_MODE: 'yes', MORROWBOT_PLUGINS_DIR: 'relative' }, ['--verbose']),
  ]).toMatchInlineSnapshot(`
    [
      {
        "config": {
          "dataDir": "/home/user/.morrowbot",
          "hostname": "127.0.0.1",
          "pluginsDir": "/home/user/.morrowbot/plugins",
          "port": 47800,
          "safeMode": false,
        },
        "kind": "ok",
      },
      {
        "config": {
          "dataDir": "/home/user/.morrowbot",
          "hostname": "127.0.0.1",
          "pluginsDir": "/home/user/.morrowbot/plugins",
          "port": 47800,
          "safeMode": true,
        },
        "kind": "ok",
      },
      {
        "config": {
          "dataDir": "/data",
          "hostname": "127.0.0.1",
          "pluginsDir": "/data/plugins",
          "port": 47800,
          "safeMode": true,
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

it('binds to loopback unless MORROWBOT_HOST_BIND names an IP address', () => {
  const bind = (value: string | undefined) => {
    const result = parse(value === undefined ? {} : { MORROWBOT_HOST_BIND: value });
    return result.kind === 'ok' ? result.config.hostname : result.problems;
  };
  expect([undefined, '100.64.0.1', '0.0.0.0', '::', 'fd7a:115c:a1e0::1', 'studio-host.local', 'fe80::1%en0', '']
    .map((value) => [value ?? '(unset)', bind(value)])).toMatchInlineSnapshot(`
      [
        [
          "(unset)",
          "127.0.0.1",
        ],
        [
          "100.64.0.1",
          "100.64.0.1",
        ],
        [
          "0.0.0.0",
          "0.0.0.0",
        ],
        [
          "::",
          "::",
        ],
        [
          "fd7a:115c:a1e0::1",
          "fd7a:115c:a1e0::1",
        ],
        [
          "studio-host.local",
          [
            "MORROWBOT_HOST_BIND: Expected an IPv4 or IPv6 address, such as 100.64.0.1 or 0.0.0.0",
          ],
        ],
        [
          "fe80::1%en0",
          [
            "MORROWBOT_HOST_BIND: Expected an IPv4 or IPv6 address, such as 100.64.0.1 or 0.0.0.0",
          ],
        ],
        [
          "",
          [
            "MORROWBOT_HOST_BIND: Expected an IPv4 or IPv6 address, such as 100.64.0.1 or 0.0.0.0",
          ],
        ],
      ]
    `);
});
