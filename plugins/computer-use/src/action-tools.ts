import { z } from '@morrowbot/plugin-sdk';
import type { Helper } from './helper.ts';
import { parseChord } from './keys.ts';
import { Clipboard, Launched, Nothing, Rect, type HelperRequest } from './protocol.ts';
import type { Snapshots } from './snapshots.ts';
import { defineTool, present, text, type ComputerUseTool, type ToolOutput } from './tool.ts';

const Target = z
  .union([
    z.strictObject({ ref: z.string().describe('An element ref like s3/e12 from the latest get_window_state') }),
    z.strictObject({
      snapshot: z.string().describe('A snapshot id like s3 from get_window_state or get_desktop_state'),
      x: z.number().describe("In that snapshot's coordinates"),
      y: z.number().describe("In that snapshot's coordinates"),
    }),
  ])
  .describe('Where to act: an element ref, or a point in a snapshot');

const Id = z.number().int().positive();
const CLIPBOARD_LIMIT = 100_000;

export function actionTools(helper: Helper, snapshots: Snapshots): readonly ComputerUseTool[] {
  const run = async (request: HelperRequest, signal: AbortSignal): Promise<ToolOutput> => present(await helper.run(request, Nothing, signal), () => text('Done.'));
  const pointer = (name: string, description: string, button: 'left' | 'right', count: 1 | 2) =>
    defineTool({
      name,
      description,
      input: z.strictObject({ target: Target }),
      run: async ({ target }, { signal }) => {
        const at = snapshots.resolve(target);
        return at.kind === 'refused' ? refusal(at.reason) : run({ kind: 'click', target: at.target, button, count }, signal);
      },
    });
  return [
    pointer('click', 'Clicks an element (by ref) or a point in a snapshot. The element, window or display is checked against the snapshot first.', 'left', 1),
    pointer('double_click', 'Double-clicks an element or a point in a snapshot.', 'left', 2),
    pointer('right_click', 'Right-clicks an element or a point in a snapshot, usually to open a context menu.', 'right', 1),
    defineTool({
      name: 'move_cursor',
      description: 'Moves the mouse pointer to an element or a point in a snapshot, for hover effects.',
      input: z.strictObject({ target: Target }),
      run: async ({ target }, { signal }) => {
        const at = snapshots.resolve(target);
        return at.kind === 'refused' ? refusal(at.reason) : run({ kind: 'move_cursor', target: at.target }, signal);
      },
    }),
    defineTool({
      name: 'drag',
      description: 'Presses the left button at one target, moves to another and releases.',
      input: z.strictObject({ from: Target, to: Target }),
      run: async ({ from, to }, { signal }) => {
        const start = snapshots.resolve(from);
        if (start.kind === 'refused') return refusal(start.reason);
        const end = snapshots.resolve(to);
        if (end.kind === 'refused') return refusal(end.reason);
        return run({ kind: 'drag', from: start.target, to: end.target }, signal);
      },
    }),
    defineTool({
      name: 'scroll',
      description: 'Scrolls at a target by some pixels. Positive dy scrolls down, positive dx scrolls right.',
      input: z.strictObject({ target: Target, dx: z.number().int().min(-10_000).max(10_000).default(0), dy: z.number().int().min(-10_000).max(10_000).default(0) }),
      run: async ({ target, dx, dy }, { signal }) => {
        const at = snapshots.resolve(target);
        return at.kind === 'refused' ? refusal(at.reason) : run({ kind: 'scroll', target: at.target, dx, dy }, signal);
      },
    }),
    defineTool({
      name: 'type_text',
      description: 'Types text into whatever has keyboard focus. Refused while a password field has focus (secure input): never type passwords.',
      input: z.strictObject({ text: z.string().min(1).max(10_000) }),
      run: async ({ text: typed }, { signal }) => present(await helper.run({ kind: 'type_text', text: typed }, Nothing, signal), () => text('Typed.')),
    }),
    defineTool({
      name: 'hotkey',
      description: 'Presses a key combination, such as ["command", "shift", "t"] or ["escape"]: any of command, shift, option, control and fn, plus one key.',
      input: z.strictObject({ keys: z.array(z.string().min(1)).min(1).max(6) }),
      run: async ({ keys }, { signal }) => {
        const chord = parseChord(keys);
        switch (chord.kind) {
          case 'invalid':
            return { kind: 'invalid_input', text: chord.reason };
          case 'chord':
            return present(await helper.run({ kind: 'hotkey', keyCode: chord.keyCode, modifiers: chord.modifiers }, Nothing, signal), () => text('Pressed.'));
        }
      },
    }),
    defineTool({
      name: 'bring_to_front',
      description: 'Brings an app to the front, and raises one of its windows when windowId is given.',
      input: z.strictObject({ pid: Id.describe('From list_apps or list_windows'), windowId: Id.optional() }),
      run: async ({ pid, windowId }, { signal }) =>
        present(await helper.run({ kind: 'bring_to_front', pid, windowId: windowId ?? null }, Nothing, signal), () => text('It is in front.')),
    }),
    defineTool({
      name: 'launch_app',
      description: 'Opens an app by bundle id (like com.apple.TextEdit) or by name (an .app in /Applications, /System/Applications or ~/Applications).',
      input: z.union([
        z.strictObject({ bundleId: z.string().min(1), activate: z.boolean().default(true) }),
        z.strictObject({ name: z.string().min(1).regex(/^[^/]+$/, 'Give the app name, not a path'), activate: z.boolean().default(true) }),
      ]),
      run: async (input, { signal }) => {
        const request: HelperRequest = 'bundleId' in input
          ? { kind: 'launch_app', bundleId: input.bundleId, name: null, activate: input.activate }
          : { kind: 'launch_app', bundleId: null, name: input.name, activate: input.activate };
        return present(await helper.run(request, Launched, signal), (app) => text(`Opened ${app.name} (pid ${String(app.pid)}).`));
      },
    }),
    defineTool({
      name: 'set_window_frame',
      description: 'Moves and resizes a window. The frame is in screen points (see get_screen_size); the result says where the window settled.',
      input: z.strictObject({ windowId: Id, frame: Rect.extend({ width: z.number().positive(), height: z.number().positive() }) }),
      run: async ({ windowId, frame }, { signal }) => present(await helper.run({ kind: 'set_window_frame', windowId, frame }, Nothing, signal), () => text('Moved.')),
    }),
    defineTool({
      name: 'clipboard_read',
      description: 'Reads the text on the clipboard.',
      input: z.strictObject({}),
      run: async (_, { signal }) =>
        present(await helper.run({ kind: 'clipboard_read' }, Clipboard, signal), ({ text: board }) => {
          if (board === null) return text('The clipboard has no text.');
          if (board.length <= CLIPBOARD_LIMIT) return text(board);
          return text(`${board.slice(0, CLIPBOARD_LIMIT)}\n(cut at ${String(CLIPBOARD_LIMIT)} of ${String(board.length)} characters)`);
        }),
    }),
    defineTool({
      name: 'clipboard_write',
      description: 'Puts text on the clipboard, replacing what was there.',
      input: z.strictObject({ text: z.string().max(CLIPBOARD_LIMIT) }),
      run: async ({ text: board }, { signal }) => present(await helper.run({ kind: 'clipboard_write', text: board }, Nothing, signal), () => text('Copied.')),
    }),
  ];
}

function refusal(reason: string): ToolOutput {
  return { kind: 'refused', text: `Refused: ${reason}` };
}
