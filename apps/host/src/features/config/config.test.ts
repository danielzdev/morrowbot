import { expect, it } from 'vitest';
import { parseHostConfig } from './index.ts';

it('defaults the port and rejects a bad one', () => {
  expect([
    parseHostConfig({}),
    parseHostConfig({ MORROWBOT_HOST_PORT: '0' }),
    parseHostConfig({ MORROWBOT_HOST_PORT: '' }),
    parseHostConfig({ MORROWBOT_HOST_PORT: '   ' }),
    parseHostConfig({ MORROWBOT_HOST_PORT: 'eighty' }),
    parseHostConfig({ MORROWBOT_HOST_PORT: '70000' }),
  ]).toMatchInlineSnapshot(`
    [
      {
        "config": {
          "hostname": "127.0.0.1",
          "port": 47800,
        },
        "kind": "ok",
      },
      {
        "config": {
          "hostname": "127.0.0.1",
          "port": 0,
        },
        "kind": "ok",
      },
      {
        "kind": "invalid",
        "problems": [
          "MORROWBOT_HOST_PORT: Expected an integer port",
        ],
      },
      {
        "kind": "invalid",
        "problems": [
          "MORROWBOT_HOST_PORT: Expected an integer port",
        ],
      },
      {
        "kind": "invalid",
        "problems": [
          "MORROWBOT_HOST_PORT: Expected an integer port",
        ],
      },
      {
        "kind": "invalid",
        "problems": [
          "MORROWBOT_HOST_PORT: Too big: expected number to be <=65535",
        ],
      },
    ]
  `);
});
