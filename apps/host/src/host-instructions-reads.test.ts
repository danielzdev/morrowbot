import { link, mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Agent, AgentInstructionsView } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { startTestHost, type Reply, type TestHost } from './testing/test-host.ts';

let dataDir: string;
let host: TestHost;
beforeEach(async () => {
  dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'orikami-h8-')));
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
  return { agent, file: path.join(dir, 'SOUL.md') };
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

it('tells an empty file from a missing one, a dangling symlink and a folder', async () => {
  const empty = await sharedAgent('empty');
  await writeFile(empty.file, '');
  const missing = await sharedAgent('none');
  const dangling = await sharedAgent('dangling');
  await symlink('nowhere.md', dangling.file);
  const folder = await sharedAgent('folder');
  await mkdir(folder.file, { recursive: true });
  expect({
    empty: stable(await host.call('GET', `/api/agents/${empty.agent.id}/instructions`)),
    missing: stable(await host.call('GET', `/api/agents/${missing.agent.id}/instructions`)),
    dangling: stable(await host.call('GET', `/api/agents/${dangling.agent.id}/instructions`)),
    folder: stable(await host.call('GET', `/api/agents/${folder.agent.id}/instructions`)),
  }).toMatchInlineSnapshot(`
    {
      "dangling": {
        "body": {
          "canReplace": false,
          "content": null,
          "readError": "SOUL.md is a link. Ori Kami reads only a regular file in the workspace folder.",
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
      "folder": {
        "body": {
          "canReplace": false,
          "content": null,
          "readError": "SOUL.md is not a regular file.",
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

it('never reads SOUL.md through a symlink or a second hard link, even to a file inside the workspace', async () => {
  const symlinked = await sharedAgent('symlinked');
  await writeFile(path.join(path.dirname(symlinked.file), 'real.md'), 'linked text');
  await symlink('real.md', symlinked.file);
  const hardLinked = await sharedAgent('hard-linked');
  await writeFile(path.join(path.dirname(hardLinked.file), 'real.md'), 'linked text');
  await link(path.join(path.dirname(hardLinked.file), 'real.md'), hardLinked.file);
  const views = await Promise.all([view(symlinked.agent), view(hardLinked.agent)]);
  expect(views.map(({ content, readError, revision }) => ({ content, readError, present: revision !== null }))).toMatchInlineSnapshot(`
    [
      {
        "content": null,
        "present": true,
        "readError": "SOUL.md is a link. Ori Kami reads only a regular file in the workspace folder.",
      },
      {
        "content": null,
        "present": true,
        "readError": "SOUL.md has more than one hard link, so Ori Kami does not read it. Replace SOUL.md with a copy of its text.",
      },
    ]
  `);
});

it('refuses a SOUL.md a create cut short left linked to its staging file, says how to fix it, and reads it once that link is gone', async () => {
  const { agent, file } = await sharedAgent('cut-short');
  const staging = path.join(dataDir, 'instructions-drafts', '.staging');
  const leftover = path.join(staging, 'SOUL.md.00000000-0000-4000-8000-000000000000.tmp');
  await mkdir(staging, { recursive: true });
  await writeFile(file, 'kept');
  await link(file, leftover);
  const before = await view(agent);
  const untouched = { workspace: (await readdir(path.dirname(file))).sort(), staging: await readdir(staging) };
  await rm(leftover);
  const after = await view(agent);
  expect({ before: before.readError, untouched, after: after.content }).toMatchInlineSnapshot(`
    {
      "after": "kept",
      "before": "SOUL.md has more than one hard link, so Ori Kami does not read it. Replace SOUL.md with a copy of its text.",
      "untouched": {
        "staging": [
          "SOUL.md.00000000-0000-4000-8000-000000000000.tmp",
        ],
        "workspace": [
          "SOUL.md",
        ],
      },
    }
  `);
});
