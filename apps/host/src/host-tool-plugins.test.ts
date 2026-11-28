import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StartedSend, type HostTools, type Thread } from '@morrowbot/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';
import { postMcp, savedTools } from './testing/host-tools-client.ts';
import { sequence } from './testing/test-host.ts';
import { connectFakeBrowser, freePort } from './testing/tool-plugin-fixture.ts';

const REPO_PLUGINS_DIR = fileURLToPath(new URL('../../../plugins', import.meta.url));
const PAIRING_TOKEN = 'p'.repeat(43);
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ZkAAAAASUVORK5CYII=';

const ListBody = z.looseObject({
  result: z.looseObject({ tools: z.array(z.looseObject({ name: z.string(), inputSchema: z.record(z.string(), z.unknown()) })) }),
});

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  cleanups.push(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}

async function openTurn(chat: ChatFixture, dataDir: string, thread: Thread): Promise<{ readonly generationId: string; readonly tools: Extract<HostTools, { kind: 'mcp' }> }> {
  const sent = StartedSend.parse((await chat.host.call('POST', `/api/threads/${thread.id}/messages`, { text: 'stall-polite', sessionChoice: { kind: 'auto' } })).body);
  const tools = await vi.waitFor(async () => {
    const saved = await savedTools(dataDir);
    if (saved.kind !== 'mcp') throw new Error('waiting for mcp host tools');
    return saved;
  });
  return { generationId: sent.generationId, tools };
}

async function stopTurn(chat: ChatFixture, thread: Thread, generationId: string): Promise<void> {
  await chat.host.call('POST', `/api/threads/${thread.id}/stop`);
  await chat.events.finished(generationId);
}

it('exposes built-in browser and computer-use tools on loopback MCP, preserves image blocks, and cancels takeover on turn stop', async () => {
  const dataDir = await makeTempDir('orikami-builtin-tools-');
  const chat = await startChatFixture({ dataDir, builtinPluginsDir: REPO_PLUGINS_DIR, sequence: sequence() });
  cleanups.push(async () => {
    await chat.close();
    expect(chat.host.errors).toEqual([]);
  });

  const port = await freePort();
  const configured = await chat.host.call('PUT', '/api/plugins/browser/config', { config: { pairingToken: PAIRING_TOKEN, port, uploadFolder: '' } });
  expect(configured.status).toBe(200);

  const extension = await connectFakeBrowser(port, PAIRING_TOKEN, ['list-tabs', 'screenshot', 'start-takeover', 'end-takeover']);
  cleanups.push(() => {
    extension.close();
    return Promise.resolve();
  });

  const thread = await chat.thread(await chat.agent());
  const turn = await openTurn(chat, dataDir, thread);

  const listResponse = await postMcp(turn.tools.url, turn.tools.token, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  expect(listResponse.status).toBe(200);
  const names = ListBody.parse(listResponse.body).result.tools.map((item) => item.name);
  expect({
    hasBuiltins: ['list_agents', 'send_message', 'search_memories', 'remember', 'forget_memory'].every((name) => names.includes(name)),
    browserTools: names.filter((name) => name.startsWith('browser_')).sort(),
    computerUseTools: names.filter((name) => name.startsWith('computer_use_')).sort(),
  }).toMatchInlineSnapshot(`
    {
      "browserTools": [
        "browser_click",
        "browser_close_tab",
        "browser_drag",
        "browser_fill_form",
        "browser_fill_secret",
        "browser_handle_dialog",
        "browser_hover",
        "browser_navigate",
        "browser_open_tab",
        "browser_press_key",
        "browser_request_takeover",
        "browser_screenshot",
        "browser_scroll",
        "browser_select_option",
        "browser_snapshot",
        "browser_switch_tab",
        "browser_tabs",
        "browser_type",
        "browser_upload_files",
      ],
      "computerUseTools": [
        "computer_use_bring_to_front",
        "computer_use_check_permissions",
        "computer_use_click",
        "computer_use_clipboard_read",
        "computer_use_clipboard_write",
        "computer_use_double_click",
        "computer_use_drag",
        "computer_use_get_desktop_state",
        "computer_use_get_screen_size",
        "computer_use_get_window_state",
        "computer_use_hotkey",
        "computer_use_launch_app",
        "computer_use_list_apps",
        "computer_use_list_windows",
        "computer_use_move_cursor",
        "computer_use_right_click",
        "computer_use_scroll",
        "computer_use_set_window_frame",
        "computer_use_type_text",
      ],
      "hasBuiltins": true,
    }
  `);

  const tabsPending = postMcp(turn.tools.url, turn.tools.token, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'browser_tabs', arguments: {} },
  });
  const tabsCmd = await extension.nextCommand();
  extension.reply(tabsCmd.id, {
    kind: 'ok',
    value: { kind: 'tabs', tabs: [{ tabId: 7, windowId: 1, url: 'https://example.com/', title: 'Example', active: true, status: 'complete' }] },
  });
  const tabsAnswer = await tabsPending;

  const shotPending = postMcp(turn.tools.url, turn.tools.token, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'browser_screenshot', arguments: { tabId: 7 } },
  });
  const shotCmd = await extension.nextCommand();
  extension.reply(shotCmd.id, { kind: 'ok', value: { kind: 'image', mimeType: 'image/png', base64: TINY_PNG_B64 } });
  const shotAnswer = await shotPending;

  const computerUseAnswer = await postMcp(turn.tools.url, turn.tools.token, {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'computer_use_click', arguments: { target: { ref: 's99/e1' } } },
  });

  const takeoverPending = postMcp(turn.tools.url, turn.tools.token, {
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'browser_request_takeover', arguments: { tabId: 7, reason: 'captcha', message: 'Complete check' } },
  });
  const startTakeover = await extension.nextCommand();
  extension.reply(startTakeover.id, { kind: 'ok', value: { kind: 'done' } });

  const stopPromise = stopTurn(chat, thread, turn.generationId);
  const endTakeover = await extension.nextCommand();
  extension.reply(endTakeover.id, { kind: 'ok', value: { kind: 'done' } });
  await stopPromise;
  const takeoverAnswer = await takeoverPending;

  expect({
    tabs: tabsAnswer.body,
    screenshot: shotAnswer.body,
    computerUse: computerUseAnswer.body,
    endTakeoverKind: endTakeover.command.kind,
    takeover: takeoverAnswer.body,
  }).toMatchInlineSnapshot(`
    {
      "computerUse": {
        "id": 4,
        "jsonrpc": "2.0",
        "result": {
          "content": [
            {
              "text": "Refused: There is no snapshot s99. Call get_window_state or get_desktop_state first.",
              "type": "text",
            },
          ],
          "isError": true,
        },
      },
      "endTakeoverKind": "end-takeover",
      "screenshot": {
        "id": 3,
        "jsonrpc": "2.0",
        "result": {
          "content": [
            {
              "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ZkAAAAASUVORK5CYII=",
              "mimeType": "image/png",
              "type": "image",
            },
          ],
          "isError": false,
        },
      },
      "tabs": {
        "id": 2,
        "jsonrpc": "2.0",
        "result": {
          "content": [
            {
              "text": "Browser chrome-1 (Chrome 140):
    Tab 7 (active): Example — https://example.com/",
              "type": "text",
            },
          ],
          "isError": false,
        },
      },
      "takeover": {
        "id": 5,
        "jsonrpc": "2.0",
        "result": {
          "content": [
            {
              "text": "Tool "browser_request_takeover" was cancelled.",
              "type": "text",
            },
          ],
          "isError": true,
        },
      },
    }
  `);
});
