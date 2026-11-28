import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Agent, Connector } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { stdioSetup } from './testing/connector-kit.ts';
import { startTestHost, type TestHost } from './testing/test-host.ts';

let dataDir: string;
let host: TestHost;
beforeEach(async () => {
  dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'morrowbot-connectors-api-')));
  host = await startTestHost({ dataDir });
});
afterEach(async () => {
  await host.close();
  expect(host.errors).toEqual([]);
  await rm(dataDir, { recursive: true, force: true });
});

it('serves connectors over the API: labels checked, secrets never sent back, stale scope writes refused with the current scope', async () => {
  const agent = Agent.parse((await host.call('POST', '/api/agents', { name: 'Errand Bot', provider: { kind: 'unbound' } })).body);
  const setup = stdioSetup('work', path.join(dataDir, 'log'));
  const created = await host.call('POST', '/api/connectors', { label: 'Tasks · Work', setup, scope: { mode: 'selected', agentIds: [agent.id] } });
  const connector = Connector.parse(created.body);
  const scopePath = `/api/connectors/${connector.id}/scope`;
  const saved = await host.call('PUT', scopePath, { mode: 'all', agentIds: [], revision: 0 });
  const stale = await host.call('PUT', scopePath, { mode: 'selected', agentIds: [agent.id], revision: 0 });
  const listed = await host.call('GET', '/api/connectors');

  expect({
    created: { status: created.status, connectorStatus: connector.status, envNames: connector.setup.kind === 'stdio' ? connector.setup.envNames : [], scope: connector.scope },
    duplicate: await host.call('POST', '/api/connectors', { label: 'tasks work', setup, scope: { mode: 'all', agentIds: [] } }),
    emailLike: await host.call('POST', '/api/connectors', { label: 'me@example.com', setup, scope: { mode: 'all', agentIds: [] } }),
    unknownAgent: await host.call('POST', '/api/connectors', { label: 'Other', setup, scope: { mode: 'selected', agentIds: ['agent-gone'] } }),
    saved: { status: saved.status, scope: Connector.parse(saved.body).scope },
    stale,
    secretSent: JSON.stringify(listed.body).includes(path.join(dataDir, 'log')),
    disconnect: Connector.parse((await host.call('POST', `/api/connectors/${connector.id}/disconnect`)).body).status,
    remove: (await host.call('DELETE', `/api/connectors/${connector.id}`)).status,
    after: (await host.call('GET', '/api/connectors')).body,
  }).toMatchInlineSnapshot(`
    {
      "after": {
        "connectors": [],
        "safeMode": false,
      },
      "created": {
        "connectorStatus": {
          "kind": "connected",
          "toolCount": 4,
        },
        "envNames": [
          "FIXTURE_ACCOUNT",
          "FIXTURE_LOG",
        ],
        "scope": {
          "agentIds": [
            "id-1",
          ],
          "mode": "selected",
          "revision": 0,
          "scopeReviewRequired": false,
        },
        "status": 201,
      },
      "disconnect": {
        "kind": "not_connected",
      },
      "duplicate": {
        "body": {
          "error": {
            "kind": "conflict",
            "message": "That name is already in use. Enter a different name.",
          },
        },
        "status": 409,
      },
      "emailLike": {
        "body": {
          "error": {
            "kind": "invalid_request",
            "message": "label: Use a short name, like Work or Personal.",
          },
        },
        "status": 400,
      },
      "remove": 204,
      "saved": {
        "scope": {
          "agentIds": [],
          "mode": "all",
          "revision": 1,
          "scopeReviewRequired": false,
        },
        "status": 200,
      },
      "secretSent": false,
      "stale": {
        "body": {
          "error": {
            "current": {
              "agentIds": [],
              "mode": "all",
              "revision": 1,
              "scopeReviewRequired": false,
            },
            "kind": "scope-conflict",
            "message": "Changed elsewhere.",
          },
        },
        "status": 409,
      },
      "unknownAgent": {
        "body": {
          "error": {
            "kind": "invalid_request",
            "message": "scope.agentIds: no agent agent-gone",
          },
        },
        "status": 400,
      },
    }
  `);
});
