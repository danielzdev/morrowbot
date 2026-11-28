import type { BrowserCommand, BrowserResult, BrowserTab, BrowserValue } from '@morrowbot/contracts';
import { z } from '@morrowbot/plugin-sdk';
import type { Bridge } from './bridge.ts';
import type { BrowserLink } from './browser-link.ts';

/** What a tool call gives back to the agent. */
export type ToolOutput =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'image'; readonly mimeType: 'image/png'; readonly base64: string }
  | { readonly kind: 'error'; readonly text: string };

export interface ToolContext {
  /** Aborted when the agent's turn stops. */
  readonly signal: AbortSignal;
}

/** One agent tool: its input is checked against `inputSchema` before it runs. */
export interface BrowserTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  call(input: unknown, context: ToolContext): Promise<ToolOutput>;
}

export function defineTool<S extends z.ZodType>(spec: {
  readonly name: string;
  readonly description: string;
  readonly input: S;
  readonly run: (input: z.output<S>, context: ToolContext) => Promise<ToolOutput>;
}): BrowserTool {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: z.toJSONSchema(spec.input),
    call: async (raw, context) => {
      const parsed = spec.input.safeParse(raw);
      if (!parsed.success) return { kind: 'error', text: `Invalid input: ${z.prettifyError(parsed.error)}` };
      return spec.run(parsed.data, context);
    },
  };
}

export const BrowserChoice = z.string().optional().describe('Which connected browser (from browser_tabs). Needed only when several are connected.');

export const COMMAND_TIMEOUT_MS = 30_000;

/** The connected browser the agent means, or why there is none. */
export function pickBrowser(bridge: Bridge, browserId: string | undefined): BrowserLink | ToolOutput {
  const all = bridge.browsers();
  if (browserId !== undefined) {
    return all.find((link) => link.browserId === browserId) ?? { kind: 'error', text: `No browser "${browserId}" is connected. Connected: ${names(all)}.` };
  }
  const [only, ...rest] = all;
  if (only === undefined) return { kind: 'error', text: noBrowserText };
  if (rest.length > 0) return { kind: 'error', text: `Several browsers are connected (${names(all)}); say which with "browser".` };
  return only;
}

export const noBrowserText =
  'No browser is connected. Ask the person to install the MorrowBot browser extension and paste its pairing token into the Browser plugin settings.';

function names(links: readonly BrowserLink[]): string {
  return links.length === 0 ? 'none' : links.map((link) => link.browserId).join(', ');
}

export function isLink(value: BrowserLink | ToolOutput): value is BrowserLink {
  return 'browserId' in value;
}

/** Runs one command on the chosen browser and words the result for the agent. */
export async function runOn(bridge: Bridge, browserId: string | undefined, command: BrowserCommand, done: string): Promise<ToolOutput> {
  const link = pickBrowser(bridge, browserId);
  if (!isLink(link)) return link;
  return present(await link.run(command, COMMAND_TIMEOUT_MS), done);
}

export function present(result: BrowserResult, done: string): ToolOutput {
  switch (result.kind) {
    case 'error':
      return { kind: 'error', text: `${result.message} (${result.code})` };
    case 'ok':
      return presentValue(result.value, done);
  }
}

function presentValue(value: BrowserValue, done: string): ToolOutput {
  switch (value.kind) {
    case 'tabs':
      return { kind: 'text', text: value.tabs.length === 0 ? 'No tabs.' : value.tabs.map(tabLine).join('\n') };
    case 'tab':
      return { kind: 'text', text: `${done}\n${tabLine(value.tab)}` };
    case 'snapshot': {
      const dialog = value.dialog === null ? '' : `\nA ${value.dialog.type} dialog is open: "${value.dialog.message}". Answer it with browser_handle_dialog.`;
      return { kind: 'text', text: `${tabLine(value.tab)}${dialog}\n${value.tree}` };
    }
    case 'image':
      return { kind: 'image', mimeType: value.mimeType, base64: value.base64 };
    case 'done':
      return { kind: 'text', text: done };
  }
}

export function tabLine(tab: BrowserTab): string {
  const flags = [tab.active ? 'active' : null, tab.status === 'loading' ? 'loading' : null].filter((flag) => flag !== null);
  return `Tab ${String(tab.tabId)}${flags.length > 0 ? ` (${flags.join(', ')})` : ''}: ${tab.title || '(untitled)'} — ${tab.url}`;
}
