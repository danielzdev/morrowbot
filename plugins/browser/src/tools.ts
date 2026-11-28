import { BrowserTabId, DialogAction, ElementRef, FormFieldValue, KeyName, NavigateTarget, ScreenshotArea, ScrollTarget, WebUrl } from '@morrowbot/contracts';
import { confinePath, z, type Confined } from '@morrowbot/plugin-sdk';
import type { Bridge } from './bridge.ts';
import type { SecretSource } from './secrets.ts';
import type { Uploads } from './settings.ts';
import { secretTools } from './secret-tools.ts';
import { BrowserChoice, COMMAND_TIMEOUT_MS, defineTool, noBrowserText, present, runOn, type BrowserTool, type ToolOutput } from './tool.ts';

const tab = { browser: BrowserChoice, tabId: BrowserTabId };
const ref = ElementRef.describe('An element ref from the latest browser_snapshot of this tab');

export interface ToolDeps {
  readonly bridge: Bridge;
  readonly secrets: SecretSource;
  readonly uploads: Uploads;
}

/** Every tool the browser plugin offers an agent. Agent tools never see secret values. */
export function browserTools({ bridge, secrets, uploads }: ToolDeps): readonly BrowserTool[] {
  return [
    defineTool({
      name: 'browser_tabs',
      description: 'Lists the tabs of every connected browser.',
      input: z.strictObject({}),
      run: async () => {
        const links = bridge.browsers();
        if (links.length === 0) return { kind: 'error', text: noBrowserText };
        const sections = await Promise.all(
          links.map(async (link) => {
            const listed = present(await link.run({ kind: 'list-tabs' }, COMMAND_TIMEOUT_MS), '');
            const body = listed.kind === 'image' ? '' : listed.text;
            return `Browser ${link.browserId} (${link.browser.name} ${link.browser.version}):\n${body}`;
          }),
        );
        return { kind: 'text', text: sections.join('\n\n') };
      },
    }),
    defineTool({
      name: 'browser_open_tab',
      description: 'Opens a URL in a new background tab. The person keeps their current tab and window.',
      input: z.strictObject({ browser: BrowserChoice, url: WebUrl }),
      run: ({ browser, url }) => runOn(bridge, browser, { kind: 'open-tab', url }, 'Opened.'),
    }),
    defineTool({
      name: 'browser_switch_tab',
      description: 'Makes a tab the active one in its window. Raises the window only with focusWindow, which takes focus from the person.',
      input: z.strictObject({ ...tab, focusWindow: z.boolean().default(false) }),
      run: ({ browser, ...command }) => runOn(bridge, browser, { kind: 'switch-tab', ...command }, 'Switched.'),
    }),
    defineTool({
      name: 'browser_close_tab',
      description: 'Closes a tab.',
      input: z.strictObject(tab),
      run: ({ browser, tabId }) => runOn(bridge, browser, { kind: 'close-tab', tabId }, 'Closed.'),
    }),
    defineTool({
      name: 'browser_navigate',
      description: 'Goes to a URL, or back, forward or reload, and waits for the page to load.',
      input: z.strictObject({ ...tab, to: NavigateTarget }),
      run: ({ browser, ...command }) => runOn(bridge, browser, { kind: 'navigate', ...command }, 'Navigated.'),
    }),
    defineTool({
      name: 'browser_snapshot',
      description: 'Reads the page as an accessibility tree. Elements you can act on carry [ref=eN]; each snapshot replaces the refs before it.',
      input: z.strictObject(tab),
      run: ({ browser, tabId }) => runOn(bridge, browser, { kind: 'snapshot', tabId }, ''),
    }),
    defineTool({
      name: 'browser_click',
      description: 'Clicks an element.',
      input: z.strictObject({ ...tab, ref, button: z.enum(['left', 'right', 'middle']).default('left'), doubleClick: z.boolean().default(false) }),
      run: ({ browser, doubleClick, ...rest }) => runOn(bridge, browser, { kind: 'click', ...rest, clickCount: doubleClick ? 2 : 1 }, `Clicked ${rest.ref}.`),
    }),
    defineTool({
      name: 'browser_hover',
      description: 'Moves the mouse over an element.',
      input: z.strictObject({ ...tab, ref }),
      run: ({ browser, ...command }) => runOn(bridge, browser, { kind: 'hover', ...command }, `Hovering ${command.ref}.`),
    }),
    defineTool({
      name: 'browser_type',
      description: 'Replaces the text of a field. Never type passwords or one-time codes: use browser_fill_secret or a takeover.',
      input: z.strictObject({ ...tab, ref, text: z.string(), submit: z.boolean().default(false).describe('Press Enter after typing') }),
      run: ({ browser, ...command }) => runOn(bridge, browser, { kind: 'type', ...command }, `Typed into ${command.ref}.`),
    }),
    defineTool({
      name: 'browser_press_key',
      description: 'Presses one key in the focused element.',
      input: z.strictObject({ ...tab, key: KeyName }),
      run: ({ browser, ...command }) => runOn(bridge, browser, { kind: 'press-key', ...command }, `Pressed ${command.key}.`),
    }),
    defineTool({
      name: 'browser_fill_form',
      description: 'Fills several fields at once: text fields, checkboxes and radio buttons, and selects.',
      input: z.strictObject({ ...tab, fields: z.array(z.strictObject({ ref, value: FormFieldValue })).min(1) }),
      run: ({ browser, ...command }) => runOn(bridge, browser, { kind: 'fill-form', ...command }, `Filled ${String(command.fields.length)} fields.`),
    }),
    defineTool({
      name: 'browser_select_option',
      description: 'Picks options in a <select>, by value or by visible label.',
      input: z.strictObject({ ...tab, ref, values: z.array(z.string()).min(1) }),
      run: ({ browser, ...command }) => runOn(bridge, browser, { kind: 'select-option', ...command }, `Selected in ${command.ref}.`),
    }),
    defineTool({
      name: 'browser_scroll',
      description: 'Scrolls the page by some pixels, or until an element is in view.',
      input: z.strictObject({ ...tab, to: ScrollTarget }),
      run: ({ browser, ...command }) => runOn(bridge, browser, { kind: 'scroll', ...command }, 'Scrolled.'),
    }),
    defineTool({
      name: 'browser_drag',
      description: 'Drags one element onto another.',
      input: z.strictObject({ ...tab, from: ref, to: ref }),
      run: ({ browser, ...command }) => runOn(bridge, browser, { kind: 'drag', ...command }, `Dragged ${command.from} to ${command.to}.`),
    }),
    defineTool({
      name: 'browser_screenshot',
      description: 'Takes a PNG of the visible part of the page, the whole page, or one element.',
      input: z.strictObject({ ...tab, area: ScreenshotArea.default({ kind: 'viewport' }) }),
      run: ({ browser, ...command }) => runOn(bridge, browser, { kind: 'screenshot', ...command }, ''),
    }),
    defineTool({
      name: 'browser_upload_files',
      description: 'Puts files from the upload folder the person chose into a file input.',
      input: z.strictObject({ ...tab, ref, paths: z.array(z.string().min(1)).min(1).describe('Files inside the upload folder, as absolute paths or relative to it') }),
      run: async ({ browser, paths, ...command }) => {
        const allowed = await insideUploads(uploads, paths);
        if (allowed.kind === 'error') return allowed;
        return runOn(bridge, browser, { kind: 'upload-files', ...command, paths: allowed.paths }, `Attached ${String(paths.length)} file(s).`);
      },
    }),
    defineTool({
      name: 'browser_handle_dialog',
      description: 'Accepts or dismisses the alert, confirm, prompt or leave-page dialog open on a tab.',
      input: z.strictObject({ ...tab, action: DialogAction }),
      run: ({ browser, ...command }) => runOn(bridge, browser, { kind: 'handle-dialog', ...command }, 'Answered the dialog.'),
    }),
    ...secretTools({ bridge, secrets }),
  ];
}

/** Resolves each path inside the upload folder, refusing any outside it (symlinks included). */
async function insideUploads(uploads: Uploads, paths: readonly string[]): Promise<{ readonly kind: 'ok'; readonly paths: string[] } | { readonly kind: 'error'; readonly text: string }> {
  switch (uploads.kind) {
    case 'off':
      return { kind: 'error', text: 'Uploads are off. Ask the person to choose an upload folder in the Browser plugin settings.' };
    case 'folder': {
      const resolved: string[] = [];
      for (const requested of paths) {
        const confined = await confinePath(uploads.path, requested).catch((): Confined => ({ kind: 'outside' }));
        if (confined.kind === 'outside') return { kind: 'error', text: `${requested} is not inside the upload folder ${uploads.path}.` };
        resolved.push(confined.path);
      }
      return { kind: 'ok', paths: resolved };
    }
  }
}

/** Calls a tool by name; for the host's tool route and for tests. */
export async function callTool(tools: readonly BrowserTool[], name: string, input: unknown, signal: AbortSignal): Promise<ToolOutput> {
  const tool = tools.find((candidate) => candidate.name === name);
  if (tool === undefined) return { kind: 'error', text: `No tool named ${name}.` };
  return tool.call(input, { signal });
}
