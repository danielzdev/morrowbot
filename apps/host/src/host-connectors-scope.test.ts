import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ConnectorSetupEdit } from '@morrowbot/contracts';
import { afterEach, expect, it } from 'vitest';
import { connectorToolNames, startConnectorKit, STDIO_SERVER, stdioSetup, type ConnectorKit } from './testing/connector-kit.ts';

let kit: ConnectorKit | undefined;
afterEach(async () => {
  expect(kit?.errors).toEqual([]);
  await kit?.close();
  kit = undefined;
});

const KEEP_ENV: Extract<ConnectorSetupEdit, { kind: 'stdio' }>['env'] = [
  { kind: 'keep', name: 'FIXTURE_ACCOUNT' },
  { kind: 'keep', name: 'FIXTURE_LOG' },
];

/** The text of a `tools/call` answer, or of its refusal. */
function said(answer: unknown): string {
  const text = JSON.stringify(answer);
  return /"text":"((?:[^"\\]|\\.)*)"/.exec(text)?.[1] ?? text;
}

it('gives a connector’s tools only to agents in its scope, and rechecks scope and status on every list and call', async () => {
  kit = await startConnectorKit({ agentIds: ['agent-a', 'agent-b'] });
  const id = await kit.add({ label: 'Notes · Work', setup: stdioSetup('work', path.join(kit.dir, 'log')), scope: { mode: 'selected', agentIds: ['agent-a'] } });
  const a = kit.turn('agent-a');
  const b = kit.turn('agent-b');
  const selected = {
    a: connectorToolNames(await a.list()),
    b: connectorToolNames(await b.list()),
    aCalls: said(await a.call('notes_work__echo', { text: 'hi' })),
    bCalls: said(await b.call('notes_work__echo', { text: 'hi' })),
  };
  kit.connectors.setScope(id, { mode: 'all', agentIds: [], revision: 0 });
  const all = { b: connectorToolNames(await b.list()), bCalls: said(await b.call('notes_work__echo', { text: 'now' })) };
  kit.connectors.setEnabled(id, false);
  await kit.connectors.settled(id);
  const off = { a: connectorToolNames(await a.list()), aCalls: said(await a.call('notes_work__echo', { text: 'hi' })), status: kit.view(id).status };
  kit.connectors.disconnect(id);
  kit.connectors.setEnabled(id, true);
  await kit.connectors.settled(id);
  const disconnected = { aCalls: said(await a.call('notes_work__echo', {})), status: kit.view(id).status };

  expect({ selected, all, off, disconnected }).toMatchInlineSnapshot(`
    {
      "all": {
        "b": [
          "notes_work__echo",
          "notes_work__wait",
          "notes_work__spawn_sleeper",
          "notes_work__env",
        ],
        "bCalls": "work ran echo with {\\"text\\":\\"now\\"}",
      },
      "disconnected": {
        "aCalls": "Notes · Work is disconnected.",
        "status": {
          "kind": "not_connected",
        },
      },
      "off": {
        "a": [],
        "aCalls": "Notes · Work is turned off.",
        "status": {
          "kind": "turned_off",
        },
      },
      "selected": {
        "a": [
          "notes_work__echo",
          "notes_work__wait",
          "notes_work__spawn_sleeper",
          "notes_work__env",
        ],
        "aCalls": "work ran echo with {\\"text\\":\\"hi\\"}",
        "b": [],
        "bCalls": "Notes · Work isn't available to this agent.",
      },
    }
  `);
});

it('writes a scope only at the revision it was read at, and a deleted agent bumps the revision', async () => {
  kit = await startConnectorKit({ agentIds: ['agent-a', 'agent-b'] });
  const id = await kit.add({ label: 'Calendar', setup: stdioSetup('work', path.join(kit.dir, 'log')), scope: { mode: 'selected', agentIds: [] } });
  const first = kit.connectors.setScope(id, { mode: 'selected', agentIds: ['agent-a', 'agent-b'], revision: 0 });
  const stale = kit.connectors.setScope(id, { mode: 'all', agentIds: [], revision: 0 });
  kit.storage.agents.delete('agent-b');
  const afterDelete = kit.view(id).scope;
  const staleAgain = kit.connectors.setScope(id, { mode: 'all', agentIds: [], revision: 1 });
  const unknownAgent = kit.connectors.setScope(id, { mode: 'selected', agentIds: ['agent-gone'], revision: 2 });
  const fresh = kit.connectors.setScope(id, { mode: 'all', agentIds: [], revision: 2 });

  expect({
    first: first.kind === 'saved' ? first.connector.scope : first,
    stale,
    afterDelete,
    staleAgain,
    unknownAgent,
    fresh: fresh.kind === 'saved' ? fresh.connector.scope : fresh,
  }).toMatchInlineSnapshot(`
    {
      "afterDelete": {
        "agentIds": [
          "agent-a",
        ],
        "mode": "selected",
        "revision": 2,
        "scopeReviewRequired": false,
      },
      "first": {
        "agentIds": [
          "agent-a",
          "agent-b",
        ],
        "mode": "selected",
        "revision": 1,
        "scopeReviewRequired": false,
      },
      "fresh": {
        "agentIds": [],
        "mode": "all",
        "revision": 3,
        "scopeReviewRequired": false,
      },
      "stale": {
        "current": {
          "agentIds": [
            "agent-a",
            "agent-b",
          ],
          "mode": "selected",
          "revision": 1,
          "scopeReviewRequired": false,
        },
        "kind": "conflict",
      },
      "staleAgain": {
        "current": {
          "agentIds": [
            "agent-a",
          ],
          "mode": "selected",
          "revision": 2,
          "scopeReviewRequired": false,
        },
        "kind": "conflict",
      },
      "unknownAgent": {
        "kind": "invalid",
        "reason": "agentIds: no agent agent-gone",
      },
    }
  `);
});

it('pauses a Selected scope when the connector is pointed elsewhere, until a scope is saved again', async () => {
  kit = await startConnectorKit({ agentIds: ['agent-a'] });
  const log = path.join(kit.dir, 'log');
  const id = await kit.add({ label: 'Notes', setup: stdioSetup('work', log), scope: { mode: 'selected', agentIds: ['agent-a'] } });
  const renamed = kit.connectors.updateAccount(id, {
    label: 'Notes · Work',
    setup: { kind: 'stdio', command: process.execPath, args: [STDIO_SERVER], env: KEEP_ENV },
  });
  await kit.connectors.settled(id);
  const a = kit.turn('agent-a');
  const afterRename = { status: kit.view(id).status, review: kit.view(id).scope.scopeReviewRequired, tools: connectorToolNames(await a.list()).length };
  kit.connectors.updateAccount(id, {
    label: 'Notes · Work',
    setup: { kind: 'stdio', command: process.execPath, args: [STDIO_SERVER, '--other-account'], env: KEEP_ENV },
  });
  await kit.connectors.settled(id);
  const retargeted = { status: kit.view(id).status, tools: connectorToolNames(await a.list()), call: said(await a.call('notes_work__echo', {})) };
  const missingSecret = kit.connectors.updateAccount(id, { label: 'Notes · Work', setup: { kind: 'stdio', command: 'x', args: [], env: [{ kind: 'keep', name: 'NEVER_SET' }] } });
  const scope = kit.view(id).scope;
  kit.connectors.setScope(id, { mode: 'selected', agentIds: ['agent-a'], revision: scope.revision });
  const reviewed = { status: kit.view(id).status, tools: connectorToolNames(await a.list()) };

  expect({ renamed: renamed.kind, afterRename, retargeted, missingSecret, reviewed }).toMatchInlineSnapshot(`
    {
      "afterRename": {
        "review": false,
        "status": {
          "kind": "connected",
          "toolCount": 4,
        },
        "tools": 4,
      },
      "missingSecret": {
        "kind": "invalid",
        "reason": "NEVER_SET: there is no saved value to keep; enter one",
      },
      "renamed": "saved",
      "retargeted": {
        "call": "Notes · Work is paused until its scope is reviewed in Extensions.",
        "status": {
          "kind": "scope_needs_review",
        },
        "tools": [],
      },
      "reviewed": {
        "status": {
          "kind": "connected",
          "toolCount": 4,
        },
        "tools": [
          "notes_work__echo",
          "notes_work__wait",
          "notes_work__spawn_sleeper",
          "notes_work__env",
        ],
      },
    }
  `);
});

it('starts nothing in safe mode and refuses every connector call', async () => {
  kit = await startConnectorKit({ agentIds: ['agent-a'], safeMode: true });
  const log = path.join(kit.dir, 'log');
  const id = await kit.add({ label: 'Notes', setup: stdioSetup('work', log), scope: { mode: 'all', agentIds: [] } });
  const a = kit.turn('agent-a');
  await kit.connectors.settled(id);

  expect({
    status: kit.view(id).status,
    tools: connectorToolNames(await a.list()),
    call: said(await a.call('notes__echo', {})),
    serverStarted: existsSync(log),
  }).toMatchInlineSnapshot(`
    {
      "call": "MorrowBot is in safe mode, so connectors are off.",
      "serverStarted": false,
      "status": {
        "kind": "off_safe_mode",
      },
      "tools": [],
    }
  `);
});

it('refuses a label already in use by another connector, compared by its tool-name key', async () => {
  kit = await startConnectorKit({ agentIds: [] });
  const log = path.join(kit.dir, 'log');
  await kit.add({ label: 'Gmail · Work', setup: stdioSetup('work', log), scope: { mode: 'all', agentIds: [] } });
  const other = await kit.add({ label: 'Gmail · Personal', setup: stdioSetup('personal', log), scope: { mode: 'all', agentIds: [] } });
  expect({
    sameKey: kit.connectors.create({ label: 'gmail work', setup: stdioSetup('work', log), scope: { mode: 'all', agentIds: [] } }).kind,
    renameOnto: kit.connectors.updateAccount(other, { label: 'GMAIL - work', setup: { kind: 'stdio', command: process.execPath, args: [], env: [] } }).kind,
    keys: kit.connectors.list().map(({ label, labelKey }) => `${label} → ${labelKey}`),
  }).toMatchInlineSnapshot(`
    {
      "keys": [
        "Gmail · Work → gmail_work",
        "Gmail · Personal → gmail_personal",
      ],
      "renameOnto": "label-taken",
      "sameKey": "label-taken",
    }
  `);
});
