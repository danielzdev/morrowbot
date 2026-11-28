import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Agent } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { startChatFixture, type ChatFixture } from '../../../host/src/testing/chat-fixture.ts';
import { createAgentsModel, isDirty, saveModeOf, type AgentsModel, type InstructionsEditor } from '../renderer/features/agents/index.ts';
import { createApi } from '../renderer/shared/api.ts';
import { openTestWindow, type TestWindow } from './test-window.ts';

let chat: ChatFixture;
let window: TestWindow;
let agent: Agent;
let agents: AgentsModel;
let editor: InstructionsEditor;

beforeEach(async () => {
  chat = await startChatFixture();
  window = openTestWindow({ url: chat.host.url, token: chat.host.host.token });
  agent = await chat.agent();
  agents = createAgentsModel({ api: createApi(window.bridge), bridge: window.bridge });
  editor = agents.instructionsEditor(agent.id);
  await editor.load();
});

afterEach(async () => {
  agents.close();
  window.close();
  await chat.close();
  expect(chat.host.errors).toEqual([]);
});

const onDisk = (text: string): Promise<void> => writeFile(path.join(agent.workspace.dir, 'SOUL.md'), text);

function shown(): unknown {
  const state = editor.state.get();
  if (state.kind !== 'ready') return state;
  const { outcome } = state;
  return {
    mode: saveModeOf(state.loaded),
    draft: state.draft,
    dirty: isDirty(state),
    outcome:
      outcome?.kind === 'copied'
        ? { kind: 'copied', revealId: outcome.revealId.replace(/^[\dT:.Z-]+-(?=\d+\.md$)/, '<time>-') }
        : outcome?.kind === 'conflict'
          ? { kind: 'conflict', disk: outcome.current.content }
          : outcome?.kind === 'failed'
            ? { kind: 'failed', message: outcome.message, resolving: outcome.conflict?.content ?? null }
            : outcome,
  };
}

async function disk(): Promise<unknown> {
  const { body } = await chat.host.call('GET', `/api/agents/${agent.id}/instructions`);
  return { ...Object(body), revision: '<revision>' };
}

it('creates a missing SOUL.md, then keeps the file and saves the next edit as a copy', async () => {
  const missing = shown();
  editor.setDraft('Be brief.');
  await editor.save();
  const created = shown();
  editor.setDraft('Be very brief.');
  await editor.save();
  expect({ missing, created, copied: shown(), disk: await disk() }).toMatchInlineSnapshot(`
    {
      "copied": {
        "dirty": false,
        "draft": "Be very brief.",
        "mode": "copy",
        "outcome": {
          "kind": "copied",
          "revealId": "<time>-1.md",
        },
      },
      "created": {
        "dirty": false,
        "draft": "Be brief.",
        "mode": "copy",
        "outcome": {
          "kind": "created",
        },
      },
      "disk": {
        "canReplace": false,
        "content": "Be brief.",
        "revision": "<revision>",
      },
      "missing": {
        "dirty": false,
        "draft": "",
        "mode": "create",
        "outcome": null,
      },
    }
  `);
});

it('keeps the draft beside the disk version when SOUL.md changed after it was loaded', async () => {
  await onDisk('Old.');
  await editor.load();
  editor.setDraft('Mine.');
  await onDisk('Theirs.');
  await editor.save();
  const conflict = shown();
  editor.useDisk();
  expect({ conflict, usedDisk: shown(), disk: await disk() }).toMatchInlineSnapshot(`
    {
      "conflict": {
        "dirty": true,
        "draft": "Mine.",
        "mode": "copy",
        "outcome": {
          "disk": "Theirs.",
          "kind": "conflict",
        },
      },
      "disk": {
        "canReplace": false,
        "content": "Theirs.",
        "revision": "<revision>",
      },
      "usedDisk": {
        "dirty": false,
        "draft": "Theirs.",
        "mode": "copy",
        "outcome": null,
      },
    }
  `);
});

it('refuses to create over a SOUL.md that appeared after the editor loaded, and writes nothing', async () => {
  editor.setDraft('Mine.');
  await onDisk('Theirs.');
  await editor.save();
  const conflict = shown();
  await editor.saveCopy();
  expect({ conflict, copied: shown(), disk: await disk() }).toMatchInlineSnapshot(`
    {
      "conflict": {
        "dirty": true,
        "draft": "Mine.",
        "mode": "create",
        "outcome": {
          "disk": "Theirs.",
          "kind": "conflict",
        },
      },
      "copied": {
        "dirty": false,
        "draft": "Mine.",
        "mode": "copy",
        "outcome": {
          "kind": "copied",
          "revealId": "<time>-1.md",
        },
      },
      "disk": {
        "canReplace": false,
        "content": "Theirs.",
        "revision": "<revision>",
      },
    }
  `);
});

it.skipIf(process.getuid?.() === 0)('retries the copy, not the create, when "Save mine as a copy" fails', async () => {
  editor.setDraft('Mine.');
  await onDisk('Theirs.');
  await editor.save();
  const drafts = path.join(chat.dataDir, 'instructions-drafts');
  await mkdir(drafts, { recursive: true });
  await chmod(drafts, 0o500);
  await editor.saveCopy();
  const refused = shown();
  await chmod(drafts, 0o700);
  await editor.saveCopy();
  expect({ refused, retried: shown() }).toMatchInlineSnapshot(`
    {
      "refused": {
        "dirty": true,
        "draft": "Mine.",
        "mode": "create",
        "outcome": {
          "kind": "failed",
          "message": "Ori Bot isn't allowed to write in this folder.",
          "resolving": "Theirs.",
        },
      },
      "retried": {
        "dirty": false,
        "draft": "Mine.",
        "mode": "copy",
        "outcome": {
          "kind": "copied",
          "revealId": "<time>-1.md",
        },
      },
    }
  `);
});
