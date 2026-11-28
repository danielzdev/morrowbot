import { standaloneRuntime, type z } from '@morrowbot/plugin-sdk';
import { describe, expect, it } from 'vitest';
import type { Helper } from './helper.ts';
import { parseReply, Permissions, type HelperRequest } from './protocol.ts';
import { callTool, computerUseTools, toolsFor } from './tools.ts';

const signal = new AbortController().signal;

/** A helper that answers each request kind with a line the Swift helper printed (or would print). */
function replay(lines: Partial<Record<HelperRequest['kind'], string>>): { readonly helper: Helper; readonly sent: HelperRequest[] } {
  const sent: HelperRequest[] = [];
  const helper: Helper = {
    run: <S extends z.ZodType>(request: HelperRequest, value: S) => {
      sent.push(request);
      const line = lines[request.kind];
      return Promise.resolve(parseReply(line === undefined ? [] : [line], value));
    },
  };
  return { helper, sent };
}

const windowStateLine = JSON.stringify({
  kind: 'ok',
  value: {
    window: { windowId: 7, pid: 42, app: 'Notes', title: 'Groceries', frame: { x: 680, y: 256, width: 1200, height: 800 } },
    elements: [
      { path: [], depth: 0, role: 'AXWindow', subrole: 'AXStandardWindow', title: 'Groceries', value: null, description: null, frame: { x: 680, y: 256, width: 1200, height: 800 }, enabled: true, focused: true, actions: ['AXRaise'] },
      { path: [0], depth: 1, role: 'AXButton', subrole: null, title: 'Save', value: null, description: null, frame: { x: 1780, y: 1000, width: 80, height: 30 }, enabled: true, focused: false, actions: ['AXPress'] },
      { path: [1], depth: 1, role: 'AXTextField', subrole: null, title: null, value: 'eggs', description: 'Item', frame: { x: 700, y: 300, width: 400, height: 24 }, enabled: true, focused: false, actions: [] },
    ],
    truncated: true,
    image: { base64: 'iVBORw0KGgo=', width: 960, height: 640 },
  },
});

describe('tool definitions', () => {
  it('lists every tool with the inputs it takes', () => {
    const tools = computerUseTools(replay({}).helper);
    expect(Object.fromEntries(tools.map((tool) => [tool.name, Object.keys(tool.inputSchema.properties ?? {}).join(', ') || JSON.stringify(tool.inputSchema.anyOf ?? 'none')]))).toMatchInlineSnapshot(`
      {
        "bring_to_front": "pid, windowId",
        "check_permissions": "prompt",
        "click": "target",
        "clipboard_read": ""none"",
        "clipboard_write": "text",
        "double_click": "target",
        "drag": "from, to",
        "get_desktop_state": "displayId, maxDimension",
        "get_screen_size": ""none"",
        "get_window_state": "windowId, screenshot, maxDimension, maxDepth, maxElements",
        "hotkey": "keys",
        "launch_app": "[{"type":"object","properties":{"bundleId":{"type":"string","minLength":1},"activate":{"default":true,"type":"boolean"}},"required":["bundleId","activate"],"additionalProperties":false},{"type":"object","properties":{"name":{"type":"string","minLength":1,"pattern":"^[^/]+$"},"activate":{"default":true,"type":"boolean"}},"required":["name","activate"],"additionalProperties":false}]",
        "list_apps": ""none"",
        "list_windows": "pid",
        "move_cursor": "target",
        "right_click": "target",
        "scroll": "target, dx, dy",
        "set_window_frame": "windowId, frame",
        "type_text": "text",
      }
    `);
  });

  it('gives click a JSON Schema that takes a ref or a snapshot point', () => {
    const click = computerUseTools(replay({}).helper).find((tool) => tool.name === 'click');
    expect(click?.inputSchema).toMatchInlineSnapshot(`
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "additionalProperties": false,
        "properties": {
          "target": {
            "anyOf": [
              {
                "additionalProperties": false,
                "properties": {
                  "ref": {
                    "description": "An element ref like s3/e12 from the latest get_window_state",
                    "type": "string",
                  },
                },
                "required": [
                  "ref",
                ],
                "type": "object",
              },
              {
                "additionalProperties": false,
                "properties": {
                  "snapshot": {
                    "description": "A snapshot id like s3 from get_window_state or get_desktop_state",
                    "type": "string",
                  },
                  "x": {
                    "description": "In that snapshot's coordinates",
                    "type": "number",
                  },
                  "y": {
                    "description": "In that snapshot's coordinates",
                    "type": "number",
                  },
                },
                "required": [
                  "snapshot",
                  "x",
                  "y",
                ],
                "type": "object",
              },
            ],
            "description": "Where to act: an element ref, or a point in a snapshot",
          },
        },
        "required": [
          "target",
        ],
        "type": "object",
      }
    `);
  });

  it('rejects input that does not match the schema without calling the helper', async () => {
    const { helper, sent } = replay({});
    const tools = computerUseTools(helper);
    expect([
      await callTool(tools, 'click', { target: { x: 1, y: 2 } }, signal),
      await callTool(tools, 'hotkey', { keys: ['command', 'c', 'v'] }, signal),
      await callTool(tools, 'nope', {}, signal),
      sent,
    ]).toMatchInlineSnapshot(`
      [
        {
          "kind": "invalid_input",
          "text": "Invalid input: ✖ Invalid input
        → at target",
        },
        {
          "kind": "invalid_input",
          "text": "Give modifiers plus exactly one other key; got c, v.",
        },
        {
          "kind": "invalid_input",
          "text": "No tool named nope.",
        },
        [],
      ]
    `);
  });
});

describe('off macOS', () => {
  it('answers unsupported, and refuses targets since no snapshot can exist', async () => {
    const tools = toolsFor(standaloneRuntime({ platform: 'linux', env: {} }), '/nonexistent');
    const inputs: Readonly<Record<string, unknown>> = {
      get_window_state: { windowId: 1 },
      type_text: { text: 'hi' },
      hotkey: { keys: ['command', 'a'] },
      bring_to_front: { pid: 1 },
      launch_app: { bundleId: 'com.apple.TextEdit' },
      set_window_frame: { windowId: 1, frame: { x: 0, y: 0, width: 100, height: 100 } },
      clipboard_write: { text: 'x' },
      click: { target: { snapshot: 's1', x: 1, y: 1 } },
      double_click: { target: { ref: 's1/e1' } },
      right_click: { target: { ref: 's1/e1' } },
      move_cursor: { target: { ref: 's1/e1' } },
      scroll: { target: { ref: 's1/e1' }, dy: 100 },
      drag: { from: { ref: 's1/e1' }, to: { ref: 's1/e2' } },
    };
    const kinds = await Promise.all(tools.map(async (tool) => [tool.name, (await tool.call(inputs[tool.name] ?? {}, { signal })).kind]));
    expect(Object.fromEntries(kinds)).toMatchInlineSnapshot(`
      {
        "bring_to_front": "unsupported",
        "check_permissions": "unsupported",
        "click": "refused",
        "clipboard_read": "unsupported",
        "clipboard_write": "unsupported",
        "double_click": "refused",
        "drag": "refused",
        "get_desktop_state": "unsupported",
        "get_screen_size": "unsupported",
        "get_window_state": "unsupported",
        "hotkey": "unsupported",
        "launch_app": "unsupported",
        "list_apps": "unsupported",
        "list_windows": "unsupported",
        "move_cursor": "refused",
        "right_click": "refused",
        "scroll": "refused",
        "set_window_frame": "unsupported",
        "type_text": "unsupported",
      }
    `);
  });
});

describe('helper replies', () => {
  it('reports missing macOS permissions and keeps no snapshot', async () => {
    const { helper } = replay({ get_window_state: '{"missing":["accessibility","screen-recording"],"kind":"permission_denied"}' });
    const tools = computerUseTools(helper);
    expect([await callTool(tools, 'get_window_state', { windowId: 7 }, signal), (await callTool(tools, 'click', { target: { ref: 's1/e2' } }, signal)).kind]).toMatchInlineSnapshot(`
      [
        {
          "kind": "permission_denied",
          "missing": [
            "accessibility",
            "screen-recording",
          ],
          "text": "Computer Use needs the Accessibility and Screen Recording permissions, which macOS has not granted. Ask the person to turn on Ori Kami under System Settings › Privacy & Security › Accessibility and Screen Recording, or call check_permissions with prompt: true to show the macOS request. Nothing was done.",
        },
        "refused",
      ]
    `);
  });

  it('renders a window state with refs in screenshot coordinates', async () => {
    const tools = computerUseTools(replay({ get_window_state: windowStateLine }).helper);
    const output = await callTool(tools, 'get_window_state', { windowId: 7 }, signal);
    expect(output.kind === 'ok' ? output.text : output).toMatchInlineSnapshot(`
      "Snapshot s1 of window 7  Notes (pid 42) "Groceries"  at 680,256 1200×800.
      Coordinates for click, drag, scroll and move_cursor: x 0–959, y 0–639 in the screenshot (1 unit = 1.250 points).
      Act on elements by ref (e.g. click with ref), which re-checks the element first. A newer snapshot of this window makes these refs stale.
      [s1/e1] AXWindow/AXStandardWindow "Groceries" at 0,0 960×640 (focused)
        [s1/e2] AXButton "Save" at 880,595 64×24
        [s1/e3] AXTextField "Item" value="eggs" at 16,35 320×19
      (The tree was cut short: raise maxDepth or maxElements to see more.)"
    `);
  });

  it('refuses a stale ref before the helper is asked, and sends a live one with its check', async () => {
    const { helper, sent } = replay({ get_window_state: windowStateLine, click: '{"kind":"unverifiable","detail":"Posted the input."}' });
    const tools = computerUseTools(helper);
    await callTool(tools, 'get_window_state', { windowId: 7 }, signal);
    await callTool(tools, 'get_window_state', { windowId: 7 }, signal);
    expect([
      await callTool(tools, 'click', { target: { ref: 's1/e2' } }, signal),
      await callTool(tools, 'double_click', { target: { ref: 's2/e2' } }, signal),
      sent.slice(2),
    ]).toMatchInlineSnapshot(`
      [
        {
          "kind": "refused",
          "text": "Refused: Snapshot s1 is stale: a newer snapshot replaced it. Use the refs and coordinates from the latest get_window_state or get_desktop_state.",
        },
        {
          "kind": "unverifiable",
          "text": "Posted the input.",
        },
        [
          {
            "button": "left",
            "count": 2,
            "kind": "click",
            "target": {
              "check": {
                "frame": {
                  "height": 30,
                  "width": 80,
                  "x": 1780,
                  "y": 1000,
                },
                "kind": "element",
                "path": [
                  0,
                ],
                "role": "AXButton",
                "windowFrame": {
                  "height": 800,
                  "width": 1200,
                  "x": 680,
                  "y": 256,
                },
                "windowId": 7,
              },
              "point": {
                "x": 1820,
                "y": 1015,
              },
            },
          },
        ],
      ]
    `);
  });

  it('turns malformed helper output into a failure', () => {
    expect([
      parseReply(['{"kind":"ok","value":{"accessibility":false,"screenRecording":false}}'], Permissions),
      parseReply([], Permissions),
      parseReply(['Segmentation fault'], Permissions),
      parseReply(['{"kind":"ok","value":{"accessibility":"yes"}}'], Permissions),
      parseReply(['{"kind":"maybe"}'], Permissions),
    ]).toMatchInlineSnapshot(`
      [
        {
          "kind": "ok",
          "value": {
            "accessibility": false,
            "screenRecording": false,
          },
        },
        {
          "kind": "failed",
          "message": "The helper printed nothing.",
        },
        {
          "kind": "failed",
          "message": "The helper printed something that is not JSON.",
        },
        {
          "kind": "failed",
          "message": "The helper sent an unexpected value: ✖ Invalid input: expected boolean, received string
        → at accessibility
      ✖ Invalid input: expected boolean, received undefined
        → at screenRecording",
        },
        {
          "kind": "failed",
          "message": "The helper sent an unexpected reply: ✖ Invalid discriminator value. Expected 'ok' | 'unverifiable' | 'refused' | 'permission_denied' | 'failed'
        → at kind",
        },
      ]
    `);
  });
});

describe.runIf(process.platform === 'darwin')('the Swift helper on this Mac', () => {
  it('builds and answers the calls that need no permission', { timeout: 300_000 }, async () => {
    const runtime = standaloneRuntime();
    const shell = async (command: string, args: readonly string[]): Promise<string[]> => {
      const lines: string[] = [];
      await runtime.runCommand(command, { args, cwd: '/', files: [], scope: { kind: 'probe' }, signal, input: '', onLine: (line) => lines.push(line) });
      return lines;
    };
    const [dataDir = ''] = await shell('/usr/bin/mktemp', ['-d']);
    try {
      const tools = toolsFor(runtime, dataDir);
      const kinds = [];
      for (const name of ['check_permissions', 'get_screen_size', 'list_apps', 'list_windows']) {
        const output = await callTool(tools, name, {}, signal);
        kinds.push(`${name}: ${output.kind === 'ok' ? 'ok' : output.text}`);
      }
      expect(kinds).toMatchInlineSnapshot(`
        [
          "check_permissions: ok",
          "get_screen_size: ok",
          "list_apps: ok",
          "list_windows: ok",
        ]
      `);
    } finally {
      await shell('/bin/rm', ['-rf', dataDir]);
    }
  });
});
