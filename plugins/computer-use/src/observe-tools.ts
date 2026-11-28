import { z } from '@morrowbot/plugin-sdk';
import type { Helper } from './helper.ts';
import { AppInfo, DesktopState, DisplayInfo, Permissions, WindowInfo, WindowState } from './protocol.ts';
import { appLine, desktopStateText, displayLine, windowLine, windowStateText } from './render.ts';
import type { Snapshots } from './snapshots.ts';
import { defineTool, present, text, type ComputerUseTool } from './tool.ts';

const Id = z.number().int().positive();
const MaxDimension = z.number().int().min(200).max(4096).default(1280).describe('Longest edge of the screenshot in pixels; it is scaled down to fit, never up');

export function observeTools(helper: Helper, snapshots: Snapshots): readonly ComputerUseTool[] {
  return [
    defineTool({
      name: 'check_permissions',
      description: 'Reports whether macOS has granted Accessibility (needed to read and control apps) and Screen Recording (needed for screenshots and window titles). With prompt, shows the macOS request for any missing one; it never grants anything itself.',
      input: z.strictObject({ prompt: z.boolean().default(false) }),
      run: async ({ prompt }, { signal }) =>
        present(await helper.run({ kind: 'check_permissions', prompt }, Permissions, signal), (granted) =>
          text(`Accessibility: ${granted.accessibility ? 'granted' : 'not granted'}\nScreen Recording: ${granted.screenRecording ? 'granted' : 'not granted'}`),
        ),
    }),
    defineTool({
      name: 'list_apps',
      description: 'Lists the running apps that have a Dock icon, with their pids and bundle ids.',
      input: z.strictObject({}),
      run: async (_, { signal }) => present(await helper.run({ kind: 'list_apps' }, z.array(AppInfo), signal), (apps) => text(apps.map(appLine).join('\n') || 'No apps are running.')),
    }),
    defineTool({
      name: 'list_windows',
      description: 'Lists on-screen app windows, front to back, with their ids and frames in screen points. Titles need Screen Recording.',
      input: z.strictObject({ pid: Id.optional().describe('Only the windows of this app') }),
      run: async ({ pid }, { signal }) =>
        present(await helper.run({ kind: 'list_windows', pid: pid ?? null }, z.array(WindowInfo), signal), (windows) => text(windows.map(windowLine).join('\n') || 'No windows are on screen.')),
    }),
    defineTool({
      name: 'get_screen_size',
      description: 'Lists the displays with their frames in screen points and their pixel sizes.',
      input: z.strictObject({}),
      run: async (_, { signal }) => present(await helper.run({ kind: 'get_screen_size' }, z.array(DisplayInfo), signal), (displays) => text(displays.map(displayLine).join('\n') || 'No displays.')),
    }),
    defineTool({
      name: 'get_window_state',
      description: "Reads a window's Accessibility tree, and by default a screenshot of it. Each element gets a ref like s3/e12 for click and the other actions; coordinates are in the screenshot's pixels. A new snapshot of the same window makes the old refs stale.",
      input: z.strictObject({
        windowId: Id.describe('From list_windows'),
        screenshot: z.boolean().default(true).describe('Also take a PNG of the window (needs Screen Recording)'),
        maxDimension: MaxDimension,
        maxDepth: z.number().int().min(1).max(64).default(25),
        maxElements: z.number().int().min(1).max(3000).default(400),
      }),
      run: async ({ windowId, screenshot, maxDimension, maxDepth, maxElements }, { signal }) =>
        present(await helper.run({ kind: 'get_window_state', windowId, screenshot, maxDimension, maxDepth, maxElements }, WindowState, signal), (state) => {
          const snapshot = snapshots.addWindow(state);
          return { kind: 'ok', text: windowStateText(snapshot, state.image !== null, state.truncated), image: state.image };
        }),
    }),
    defineTool({
      name: 'get_desktop_state',
      description: "Takes a screenshot of a whole display (the main one by default). Click and the other actions take its snapshot id and coordinates in the screenshot's pixels.",
      input: z.strictObject({ displayId: Id.optional().describe('From get_screen_size'), maxDimension: MaxDimension }),
      run: async ({ displayId, maxDimension }, { signal }) =>
        present(await helper.run({ kind: 'get_desktop_state', displayId: displayId ?? null, maxDimension }, DesktopState, signal), (state) => {
          const snapshot = snapshots.addDesktop(state);
          return { kind: 'ok', text: desktopStateText(snapshot), image: state.image };
        }),
    }),
  ];
}
