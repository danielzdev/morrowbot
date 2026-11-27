import { ToolCall } from './protocol.ts';
import { describeTool } from './tool-input.ts';

/** Tool kinds that change something. MorrowBot never allows one, so a finished one ran without asking. */
const CHANGING = new Set(['edit', 'delete', 'move', 'execute', 'switch_mode']);
/** Tool calls remembered across sessions until they end; the oldest is forgotten past this. */
const MAX_OPEN_TOOLS = 1_000;

/** Why no more turns may run: agy did something a read-only turn never allows. */
export type Breach =
  | { readonly kind: 'unasked-change'; readonly tool: string }
  | { readonly kind: 'mode-changed'; readonly mode: string };

export interface Tripwire {
  /** Hears one `session/update` of any session, whether or not a turn holds it. */
  hear(sessionId: string, update: { readonly sessionUpdate: string }): void;
}

/**
 * Watches every session on the daemon for a change agy finished without asking: an edit, delete,
 * move, command or mode switch reported `completed`. Updates often leave out the kind an earlier
 * message gave, so each open tool call's kind is remembered until it ends.
 */
export function createTripwire(home: string | null, onBreach: (breach: Breach) => void): Tripwire {
  const open = new Map<string, { kind: string | null; title: string | null }>();
  return {
    hear: (sessionId, update) => {
      if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update') return;
      const parsed = ToolCall.safeParse(update);
      if (!parsed.success) return;
      const key = `${sessionId}\n${parsed.data.toolCallId}`;
      const known = open.get(key) ?? { kind: null, title: null };
      const tool = { kind: parsed.data.kind ?? known.kind, title: parsed.data.title ?? known.title };
      const { status } = parsed.data;
      if (status === 'completed' || status === 'failed') {
        open.delete(key);
        if (status === 'completed' && CHANGING.has(tool.kind ?? '')) onBreach({ kind: 'unasked-change', tool: describeTool(tool.kind, tool.title, home).label });
        return;
      }
      open.delete(key);
      open.set(key, tool);
      const oldest = open.keys().next();
      if (open.size > MAX_OPEN_TOOLS && oldest.done !== true) open.delete(oldest.value);
    },
  };
}

/** What the user is told, and the profile is withheld with, after `breach`. */
export function breachReason(breach: Breach, version: string | null): string {
  const agy = version === null ? 'agy' : `agy ${version}`;
  const what = breach.kind === 'unasked-change' ? `ran "${breach.tool}" without asking` : `left its Default mode for "${breach.mode}"`;
  return `Antigravity (${agy}) ${what}. MorrowBot ended it and offers no Antigravity turns until the provider restarts.`;
}
