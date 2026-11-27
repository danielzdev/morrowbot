import type { ApprovalAnswer, ApprovalAsk } from '../approvals.ts';
import type { PermissionOption, PermissionRequest } from './protocol.ts';
import { mask, tilde } from './tools.ts';

/** Tool kinds that only look. agy 1.5.18 and opencode 2.4.1 ask for them when they reach outside the workspace. */
const LOOKING = new Set(['read', 'search', 'fetch']);
const MAX_SUMMARY_CHARS = 500;

export const APPROVAL_CHOICES: ApprovalAsk['choices'] = [
  { id: 'allow', label: 'Allow once' },
  { id: 'deny', label: 'Deny' },
];

/** What MorrowBot does with one permission request in a read-only turn. */
export type Decision = { readonly kind: 'ask'; readonly summary: string } | { readonly kind: 'deny'; readonly status: string };

/**
 * Read-only policy: a read, search or fetch goes to an approval card; a write, a command, a mode
 * switch and every other kind (including one an agent names in a later version) is denied without
 * one. `name` is the agent as the user knows it ("Antigravity").
 */
export function decide(request: PermissionRequest, home: string | null, name: string): Decision {
  const kind = request.toolCall.kind ?? 'other';
  const what = describe(request, home);
  if (LOOKING.has(kind)) return { kind: 'ask', summary: what };
  return { kind: 'deny', status: `Denied ${what}: MorrowBot runs ${name} read-only.` };
}

/**
 * The ACP result for a request: the one-time allow option only when the user chose Allow, otherwise
 * a reject option. A turn that was stopped answers `cancelled`, as ACP asks of a cancelled prompt.
 */
export function permissionResult(options: readonly PermissionOption[], answer: ApprovalAnswer | null, stopped: boolean): unknown {
  if (stopped) return { outcome: { outcome: 'cancelled' } };
  if (answer?.kind === 'chosen' && answer.choiceId === 'allow') {
    const allow = options.find((option) => option.kind === 'allow_once');
    if (allow !== undefined) return selected(allow);
  }
  return refusal(options);
}

/** A reject option, or `cancelled` when the agent offered none. */
export function refusal(options: readonly PermissionOption[]): unknown {
  const reject = options.find((option) => option.kind === 'reject_once') ?? options.find((option) => option.kind === 'reject_always');
  return reject === undefined ? { outcome: { outcome: 'cancelled' } } : selected(reject);
}

function selected(option: PermissionOption): unknown {
  return { outcome: { outcome: 'selected', optionId: option.optionId } };
}

/** "read ~/notes/a.txt": the tool's kind and what it names, secrets masked, never its content. */
function describe(request: PermissionRequest, home: string | null): string {
  const { kind, title, locations } = request.toolCall;
  const paths = (locations ?? []).map((location) => location.path);
  const target = paths.length > 0 ? paths.join(', ') : (title ?? '');
  const text = mask(tilde(`${kind ?? 'a tool'}${target === '' ? '' : ` ${target}`}`, home));
  return text.length <= MAX_SUMMARY_CHARS ? text : `${text.slice(0, MAX_SUMMARY_CHARS - 1)}…`;
}
