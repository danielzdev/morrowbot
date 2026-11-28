import { z, type ApprovalAnswer, type ApprovalAsk } from '@morrowbot/plugin-sdk';
import { tilde } from './tool-input.ts';

/** A stream-json `control_request` from Claude Code: a tool waiting for permission, or something Ori Bot does not answer. */
export type ControlRequest =
  | {
      readonly kind: 'can-use-tool';
      readonly requestId: string;
      readonly input: ToolInput;
      readonly summary: string;
    }
  | { readonly kind: 'unsupported'; readonly requestId: string; readonly subtype: string | null };

const Text = z.string().min(1);

const ToolInput = z.record(z.string(), z.json());
type ToolInput = z.infer<typeof ToolInput>;

const ControlLine = z.looseObject({ request_id: Text, request: z.unknown() });

const Subtyped = z.looseObject({ subtype: Text });

/** Shown on the card only: an empty or missing one is left out, never a reason to drop the card. */
const Shown = z
  .string()
  .nullish()
  .transform((text) => (text?.trim() ? text : null));

const CanUseTool = z.looseObject({
  tool_name: Text,
  display_name: Shown,
  input: ToolInput,
  description: Shown,
  decision_reason: Shown,
});

/** The summary is shown on a card; a path or reason longer than this is cut. */
const MAX_SUMMARY_CHARS = 500;

export const APPROVAL_CHOICES: ApprovalAsk['choices'] = [
  { id: 'allow', label: 'Allow' },
  { id: 'deny', label: 'Deny' },
];

/**
 * Reads a `control_request` line; `null` without a request id to answer. A `can_use_tool` request
 * of a shape Claude Code 2.1.332 does not send is answered as unsupported, which denies the tool.
 */
export function parseControlRequest(json: unknown, home: string | null): ControlRequest | null {
  const line = ControlLine.safeParse(json);
  if (!line.success) return null;
  const { request_id: requestId, request } = line.data;
  const subtyped = Subtyped.safeParse(request);
  if (!subtyped.success) return { kind: 'unsupported', requestId, subtype: null };
  const { subtype } = subtyped.data;
  if (subtype !== 'can_use_tool') return { kind: 'unsupported', requestId, subtype };
  const tool = CanUseTool.safeParse(request);
  if (!tool.success) return { kind: 'unsupported', requestId, subtype };
  const { input } = tool.data;
  return { kind: 'can-use-tool', requestId, input, summary: summaryOf(tool.data, home) };
}

/** "Write .git/x: Claude requested permissions to edit ~/work/.git/x which is a sensitive file." Never the tool's content. */
function summaryOf(tool: z.infer<typeof CanUseTool>, home: string | null): string {
  const name = tool.display_name ?? tool.tool_name;
  const path = tool.input.file_path;
  const target = tool.description ?? (typeof path === 'string' ? path : null);
  const reason = tool.decision_reason;
  const text = [target === null ? name : `${name} ${target}`, reason].filter((part) => part !== null).join(': ');
  const shown = tilde(text, home);
  return shown.length <= MAX_SUMMARY_CHARS ? shown : `${shown.slice(0, MAX_SUMMARY_CHARS - 1)}…`;
}

/**
 * The stdin line that answers `request`. A tool is allowed only when the user chose Allow; every
 * other answer (Deny, expiry, a background turn) denies it with the reason. A turn that ended gets
 * no answer (`null`): its CLI is being stopped, and a denial would only let it reply after Stop.
 */
export function controlResponse(request: ControlRequest, answer: ApprovalAnswer | null): string | null {
  switch (request.kind) {
    case 'unsupported':
      return line({
        subtype: 'error',
        request_id: request.requestId,
        error: request.subtype === null ? 'Ori Bot does not answer control requests without a subtype' : `Ori Bot does not answer "${request.subtype}" control requests`,
      });
    case 'can-use-tool': {
      if (answer?.kind === 'chosen' && answer.choiceId === 'allow') {
        return line({ subtype: 'success', request_id: request.requestId, response: { behavior: 'allow', updatedInput: request.input } });
      }
      const message = denial(answer);
      return message === null ? null : line({ subtype: 'success', request_id: request.requestId, response: { behavior: 'deny', message } });
    }
  }
}

function denial(answer: ApprovalAnswer | null): string | null {
  if (answer === null) return 'Ori Bot does not ask for approval in this access level, so this was denied.';
  switch (answer.kind) {
    case 'chosen':
      return 'The user denied this.';
    case 'refused':
      switch (answer.reason) {
        case 'background':
          return 'Background turns cannot ask for approval, so this was denied.';
        case 'expired':
          return 'Nobody answered within 30 minutes, so this was denied.';
        case 'turn-ended':
          return null;
      }
  }
}

function line(response: Readonly<Record<string, unknown>>): string {
  return `${JSON.stringify({ type: 'control_response', response })}\n`;
}
