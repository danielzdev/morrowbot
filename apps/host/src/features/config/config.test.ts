import { expect, it } from 'vitest';
import { parseHostConfig } from './index.ts';

it('defaults the port and data folder and rejects bad values', () => {
  expect([
    parseHostConfig({}, '/home/me'),
    parseHostConfig({ MORROWBOT_HOST_PORT: '0' }, '/home/me'),
    parseHostConfig({ MORROWBOT_HOST_PORT: '' }, '/home/me'),
    parseHostConfig({ MORROWBOT_HOST_PORT: '   ' }, '/home/me'),
    parseHostConfig({ MORROWBOT_HOST_PORT: 'eighty' }, '/home/me'),
    parseHostConfig({ MORROWBOT_HOST_PORT: '70000' }, '/home/me'),
    parseHostConfig({ MORROWBOT_DATA_DIR: '/data/morrowbot' }, '/home/me'),
    parseHostConfig({ MORROWBOT_DATA_DIR: 'relative/dir' }, '/home/me'),
  ]).toMatchInlineSnapshot(`
    [
      {
        "config": {
          "dataDir": "/home/me/.morrowbot",
          "hostname": "127.0.0.1",
          "port": 47800,
        },
        "kind": "ok",
      },
      {
        "config": {
          "dataDir": "/home/me/.morrowbot",
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
      {
        "config": {
          "dataDir": "/data/morrowbot",
          "hostname": "127.0.0.1",
          "port": 47800,
        },
        "kind": "ok",
      },
      {
        "kind": "invalid",
        "problems": [
          "MORROWBOT_DATA_DIR: Expected an absolute path",
        ],
      },
    ]
  `);
});
