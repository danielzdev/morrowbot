import { z } from '@morrowbot/plugin-sdk';
import type { HelperReply, MacPermission, Png } from './protocol.ts';

/**
 * What a tool call gives back to the agent. `ok` and `unverifiable` mean the call ran (an
 * unverifiable action was sent, but nothing could confirm its effect); every other kind is an error.
 */
export type ToolOutput =
  | { readonly kind: 'ok'; readonly text: string; readonly image: Png | null }
  | { readonly kind: 'unverifiable'; readonly text: string }
  | { readonly kind: 'refused'; readonly text: string }
  | { readonly kind: 'permission_denied'; readonly missing: readonly MacPermission[]; readonly text: string }
  | { readonly kind: 'unsupported'; readonly text: string }
  | { readonly kind: 'invalid_input'; readonly text: string }
  | { readonly kind: 'failed'; readonly text: string };

export interface ToolContext {
  /** Aborted when the agent's turn stops. */
  readonly signal: AbortSignal;
}

/** One agent tool: its input is checked against `inputSchema` before it runs. */
export interface ComputerUseTool {
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
}): ComputerUseTool {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: z.toJSONSchema(spec.input),
    call: async (raw, context) => {
      const parsed = spec.input.safeParse(raw);
      if (!parsed.success) return { kind: 'invalid_input', text: `Invalid input: ${z.prettifyError(parsed.error)}` };
      return spec.run(parsed.data, context);
    },
  };
}

const GRANT_NAMES: Readonly<Record<MacPermission, string>> = { accessibility: 'Accessibility', 'screen-recording': 'Screen Recording' };

export function deniedText(missing: readonly MacPermission[]): string {
  const names = missing.map((permission) => GRANT_NAMES[permission]).join(' and ');
  return `Computer Use needs the ${names} ${missing.length > 1 ? 'permissions' : 'permission'}, which macOS has not granted. Ask the person to turn on Ori Bot under System Settings › Privacy & Security › ${names}, or call check_permissions with prompt: true to show the macOS request. Nothing was done.`;
}

/** Words a helper reply for the agent; `onOk` presents the value. */
export function present<T>(reply: HelperReply<T>, onOk: (value: T) => ToolOutput): ToolOutput {
  switch (reply.kind) {
    case 'ok':
      return onOk(reply.value);
    case 'unverifiable':
      return { kind: 'unverifiable', text: reply.detail };
    case 'refused':
      return { kind: 'refused', text: `Refused: ${reply.reason}` };
    case 'permission_denied':
      return { kind: 'permission_denied', missing: reply.missing, text: deniedText(reply.missing) };
    case 'unsupported':
      return { kind: 'unsupported', text: reply.reason };
    case 'failed':
      return { kind: 'failed', text: reply.message };
  }
}

export function text(value: string): ToolOutput {
  return { kind: 'ok', text: value, image: null };
}
