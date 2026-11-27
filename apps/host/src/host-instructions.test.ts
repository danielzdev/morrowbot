import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Agent, AgentInstructionsView } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { sequence, startTestHost, type Reply, type TestHost } from './testing/test-host.ts';

let dataDir: string;
let host: TestHost;
beforeEach(async () => {
  dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'morrowbot-h8-')));
  host = await startTestHost({ dataDir });
});
afterEach(async () => {
  await host.close();
  expect(host.errors).toEqual([]);
  await rm(dataDir, { recursive: true, force: true });
});

async function sharedAgent(name: string): Promise<{ readonly agent: Agent; readonly file: string }> {
  const dir = path.join(dataDir, name);
  await mkdir(dir, { recursive: true });
  const agent = Agent.parse((await host.call('POST', '/api/agents', { name, workspace: { kind: 'shared', dir } })).body);
  return { agent, file: path.join(dir, 'AGENTS.md') };
}

/** A reply with every revision swapped for a placeholder once it is checked to be a non-empty string. */
function stable(reply: Reply): unknown {
  return JSON.parse(
    JSON.stringify(reply, (key, value: unknown) => {
      if (key !== 'revision' || value === null) return value;
      expect(value).toMatch(/^[0-9a-f]{64}$/);
      return '<revision>';
    }),
  );
}

const view = async (agent: Agent): Promise<AgentInstructionsView> =>
  AgentInstructionsView.parse((await host.call('GET', `/api/agents/${agent.id}/instructions`)).body);

it('leaves an existing file and a dangling symlink byte-identical when a PUT tries to create over them', async () => {
  const file = await sharedAgent('file');
  await writeFile(file.file, 'theirs\n');
  const link = await sharedAgent('link');
  await symlink('gone.md', link.file);
  const replies = {
    overFile: stable(await host.call('PUT', `/api/agents/${file.agent.id}/instructions`, { content: 'mine', expectedRevision: null })),
    overDanglingLink: stable(await host.call('PUT', `/api/agents/${link.agent.id}/instructions`, { content: 'mine', expectedRevision: null })),
  };
  expect({
    replies,
    file: await readFile(file.file, 'utf8'),
    linkTarget: await readlink(link.file),
    linkTargetCreated: (await readdir(path.dirname(link.file))).includes('gone.md'),
  }).toMatchInlineSnapshot(`
    {
      "file": "theirs
    ",
      "linkTarget": "gone.md",
      "linkTargetCreated": false,
      "replies": {
        "overDanglingLink": {
          "body": {
            "error": {
              "current": {
                "canReplace": false,
                "content": null,
                "readError": "AGENTS.md is a link to a file that is not there.",
                "revision": "<revision>",
              },
              "kind": "instructions-conflict",
              "message": "This folder already has an AGENTS.md, so MorrowBot kept it and wrote nothing.",
              "reason": "occupied",
            },
          },
          "status": 409,
        },
        "overFile": {
          "body": {
            "error": {
              "current": {
                "canReplace": false,
                "content": "theirs
    ",
                "revision": "<revision>",
              },
              "kind": "instructions-conflict",
              "message": "This folder already has an AGENTS.md, so MorrowBot kept it and wrote nothing.",
              "reason": "occupied",
            },
          },
          "status": 409,
        },
      },
    }
  `);
});

it('never writes for a non-null expectedRevision, on a missing or an occupied entry, and rejects a body without one', async () => {
  const missing = await sharedAgent('missing');
  const occupied = await sharedAgent('occupied');
  await writeFile(occupied.file, 'theirs');
  const revision = (await view(occupied.agent)).revision;
  const statuses = {
    missing: await host.call('PUT', `/api/agents/${missing.agent.id}/instructions`, { content: 'mine', expectedRevision: 'made-up' }),
    occupied: await host.call('PUT', `/api/agents/${occupied.agent.id}/instructions`, { content: 'mine', expectedRevision: revision }),
    noRevision: await host.call('PUT', `/api/agents/${missing.agent.id}/instructions`, { content: 'mine' }),
  };
  expect({
    replies: Object.fromEntries(Object.entries(statuses).map(([name, reply]) => [name, stable(reply)])),
    missingStillMissing: (await readdir(path.dirname(missing.file))).includes('AGENTS.md'),
    occupied: await readFile(occupied.file, 'utf8'),
  }).toMatchInlineSnapshot(`
    {
      "missingStillMissing": false,
      "occupied": "theirs",
      "replies": {
        "missing": {
          "body": {
            "error": {
              "current": {
                "canReplace": false,
                "content": null,
                "revision": null,
              },
              "kind": "instructions-conflict",
              "message": "Editing AGENTS.md in place isn't available yet. Nothing was changed.",
              "reason": "replace-unavailable",
            },
          },
          "status": 409,
        },
        "noRevision": {
          "body": {
            "error": {
              "kind": "invalid_request",
              "message": "expectedRevision: Invalid input: expected string, received undefined",
            },
          },
          "status": 400,
        },
        "occupied": {
          "body": {
            "error": {
              "current": {
                "canReplace": false,
                "content": "theirs",
                "revision": "<revision>",
              },
              "kind": "instructions-conflict",
              "message": "Editing AGENTS.md in place isn't available yet. Nothing was changed.",
              "reason": "replace-unavailable",
            },
          },
          "status": 409,
        },
      },
    }
  `);
});

it('tells an empty file from a missing one and from a dangling symlink', async () => {
  const empty = await sharedAgent('empty');
  await writeFile(empty.file, '');
  const missing = await sharedAgent('none');
  const dangling = await sharedAgent('dangling');
  await symlink('nowhere.md', dangling.file);
  expect({
    empty: stable(await host.call('GET', `/api/agents/${empty.agent.id}/instructions`)),
    missing: stable(await host.call('GET', `/api/agents/${missing.agent.id}/instructions`)),
    dangling: stable(await host.call('GET', `/api/agents/${dangling.agent.id}/instructions`)),
  }).toMatchInlineSnapshot(`
    {
      "dangling": {
        "body": {
          "canReplace": false,
          "content": null,
          "readError": "AGENTS.md is a link to a file that is not there.",
          "revision": "<revision>",
        },
        "status": 200,
      },
      "empty": {
        "body": {
          "canReplace": false,
          "content": "",
          "revision": "<revision>",
        },
        "status": 200,
      },
      "missing": {
        "body": {
          "canReplace": false,
          "content": null,
          "revision": null,
        },
        "status": 200,
      },
    }
  `);
});

it('creates a missing AGENTS.md once, with the revision a read reports, and changes the revision when a link target is edited', async () => {
  const { agent, file } = await sharedAgent('create');
  const created = await host.call('PUT', `/api/agents/${agent.id}/instructions`, { content: '# Hi', expectedRevision: null });
  const read = await view(agent);
  const again = await host.call('PUT', `/api/agents/${agent.id}/instructions`, { content: '# Again', expectedRevision: null });
  const linked = await sharedAgent('linked');
  await writeFile(path.join(path.dirname(linked.file), 'real.md'), 'one');
  await symlink('real.md', linked.file);
  const before = await view(linked.agent);
  await writeFile(path.join(path.dirname(linked.file), 'real.md'), 'two');
  const after = await view(linked.agent);
  expect({
    created: created.body,
    sameRevision: created.body !== null && typeof created.body === 'object' && 'revision' in created.body && created.body.revision === read.revision,
    again: again.status,
    onDisk: await readFile(file, 'utf8'),
    linkRevisionMoved: before.revision !== after.revision,
    linkContent: [before.content, after.content],
    stillLink: (await lstat(linked.file)).isSymbolicLink(),
  }).toMatchObject({ sameRevision: true, again: 409, onDisk: '# Hi', linkRevisionMoved: true, linkContent: ['one', 'two'], stillLink: true });
});

it('keeps Save a copy in the data folder with a counter, never touching the live file', async () => {
  await host.close();
  host = await startTestHost({ dataDir, sequence: { ...sequence(), now: () => '2026-01-01T00:00:00.000Z' } });
  const { agent, file } = await sharedAgent('copies');
  await writeFile(file, 'live');
  const first = await host.call('POST', `/api/agents/${agent.id}/instructions/copies`, { content: 'draft one' });
  const second = await host.call('POST', `/api/agents/${agent.id}/instructions/copies`, { content: 'draft two' });
  const unknown = await host.call('POST', '/api/agents/nobody/instructions/copies', { content: 'x' });
  const drafts = path.join(dataDir, 'instructions-drafts', agent.id);
  const names = (await readdir(drafts)).sort();
  expect({
    replies: [first, second, unknown].map((reply) => reply.status),
    revealIds: [first.body, second.body],
    names,
    contents: await Promise.all(names.map((name) => readFile(path.join(drafts, name), 'utf8'))),
    live: await readFile(file, 'utf8'),
  }).toMatchInlineSnapshot(`
    {
      "contents": [
        "draft one",
        "draft two",
      ],
      "live": "live",
      "names": [
        "2026-01-01T00-00-00.000Z-1.md",
        "2026-01-01T00-00-00.000Z-2.md",
      ],
      "replies": [
        201,
        201,
        404,
      ],
      "revealIds": [
        {
          "revealId": "2026-01-01T00-00-00.000Z-1.md",
        },
        {
          "revealId": "2026-01-01T00-00-00.000Z-2.md",
        },
      ],
    }
  `);
});

it('writes initialInstructions to a new folder, and refuses to make the agent when the folder already has one', async () => {
  const fresh = Agent.parse((await host.call('POST', '/api/agents', { name: 'Fresh', initialInstructions: '# Fresh' })).body);
  const dir = path.join(dataDir, 'kept');
  await mkdir(dir);
  await writeFile(path.join(dir, 'AGENTS.md'), 'keep me');
  const refused = await host.call('POST', '/api/agents', { name: 'Late', workspace: { kind: 'shared', dir }, initialInstructions: '# Late' });
  const list = (await host.call('GET', '/api/agents')).body;
  expect({
    fresh: await readFile(path.join(fresh.workspace.dir, 'AGENTS.md'), 'utf8'),
    refused: { status: refused.status, kind: stable(refused) },
    kept: await readFile(path.join(dir, 'AGENTS.md'), 'utf8'),
    agents: list !== null && typeof list === 'object' && 'agents' in list && Array.isArray(list.agents) ? list.agents.length : null,
  }).toMatchObject({ fresh: '# Fresh', refused: { status: 409 }, kept: 'keep me', agents: 1 });
});

it.skipIf(process.getuid?.() === 0)('reports an unreadable file as present with a path-free reason', async () => {
  const { agent, file } = await sharedAgent('locked');
  await writeFile(file, 'secret');
  await chmod(file, 0o000);
  const read = await view(agent);
  await chmod(file, 0o600);
  expect(read).toMatchObject({ content: null, readError: "MorrowBot isn't allowed to read AGENTS.md.", canReplace: false });
  expect(read.revision).not.toBeNull();
});

it('refuses a write it is not allowed to make with a path-free reason, reports nothing, and leaves no staging file', async () => {
  const { agent, file } = await sharedAgent('locked');
  const dir = path.dirname(file);
  await chmod(dir, 0o500);
  try {
    const put = await host.call('PUT', `/api/agents/${agent.id}/instructions`, { content: 'mine', expectedRevision: null });
    expect({ put, entries: await readdir(dir) }).toMatchInlineSnapshot(`
      {
        "entries": [],
        "put": {
          "body": {
            "error": {
              "kind": "internal",
              "message": "MorrowBot isn't allowed to write in this folder.",
            },
          },
          "status": 500,
        },
      }
    `);
  } finally {
    await chmod(dir, 0o700);
  }
});
