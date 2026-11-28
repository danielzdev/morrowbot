import { ConnectorSetup, ConnectorSetupEdit, type ComposioAccount, type ConnectorSetupView } from '@morrowbot/contracts';
import type { z } from 'zod';

/** One environment variable or header being typed. */
export interface SecretRow {
  readonly key: string;
  readonly name: string;
  readonly value: string;
  /** The host already holds a value under this name: left blank, it is kept. */
  readonly saved: boolean;
}

export interface StdioDraft {
  readonly kind: 'stdio';
  readonly command: string;
  /** One argument per line. */
  readonly args: string;
  readonly env: readonly SecretRow[];
}

export interface HttpDraft {
  readonly kind: 'http';
  readonly url: string;
  readonly headers: readonly SecretRow[];
}

export interface ComposioDraft {
  readonly kind: 'composio';
  readonly toolkit: string;
  readonly serverUrl: string;
  readonly apiKey: string;
  /** The host already holds an API key: left blank, it is kept. */
  readonly keySaved: boolean;
  readonly accountKind: ComposioAccount['kind'];
  readonly accountId: string;
}

/** What a connector reaches, as the form holds it. */
export type SetupDraft = StdioDraft | HttpDraft | ComposioDraft;

export const EMPTY_STDIO: StdioDraft = { kind: 'stdio', command: '', args: '', env: [] };
export const EMPTY_HTTP: HttpDraft = { kind: 'http', url: '', headers: [] };
export const EMPTY_COMPOSIO: ComposioDraft = { kind: 'composio', toolkit: '', serverUrl: '', apiKey: '', keySaved: false, accountKind: 'user', accountId: '' };

const savedRows = (names: readonly string[]): SecretRow[] => names.map((name) => ({ key: `saved:${name}`, name, value: '', saved: true }));

/** The saved setup as an edit starts: secret values are never sent to a window, so their rows are blank. */
export function draftOf(view: ConnectorSetupView): SetupDraft {
  switch (view.kind) {
    case 'stdio':
      return { kind: 'stdio', command: view.command, args: view.args.join('\n'), env: savedRows(view.envNames) };
    case 'http':
      return { kind: 'http', url: view.url, headers: savedRows(view.headerNames) };
    case 'composio':
      return {
        kind: 'composio',
        toolkit: view.toolkit,
        serverUrl: view.serverUrl,
        apiKey: '',
        keySaved: true,
        accountKind: view.account.kind,
        accountId: view.account.kind === 'user' ? view.account.userId : view.account.connectedAccountId,
      };
  }
}

/** A draft as the host takes it, or why it can't yet: `reason` is null while a required field is simply empty. */
export type Checked<T> = { readonly kind: 'ready'; readonly value: T } | { readonly kind: 'invalid'; readonly reason: string | null };

const MISSING = { kind: 'invalid', reason: null } as const;

function checked<T>(schema: z.ZodType<T>, candidate: unknown): Checked<T> {
  const parsed = schema.safeParse(candidate);
  if (parsed.success) return { kind: 'ready', value: parsed.data };
  const issue = parsed.error.issues[0];
  const field = issue?.path[0];
  return { kind: 'invalid', reason: field === 'url' || field === 'serverUrl' ? 'Enter an http or https URL.' : (issue?.message ?? null) };
}

/** Arguments, one per line; blank lines at the end are not arguments. */
function linesOf(text: string): string[] {
  const lines = text.split(/\r?\n/);
  while (lines.at(-1) === '') lines.pop();
  return lines;
}

const filled = (rows: readonly SecretRow[]): SecretRow[] => rows.filter((row) => row.saved || row.name.trim() !== '' || row.value !== '');
const unnamed = (rows: readonly SecretRow[]): boolean => rows.some((row) => row.name.trim() === '');
const set = (row: SecretRow) => ({ name: row.name.trim(), value: row.value });
const edit = (row: SecretRow) => (row.saved && row.value === '' ? { kind: 'keep', name: row.name } : { kind: 'set', ...set(row) });

const accountOf = (draft: ComposioDraft): ComposioAccount =>
  draft.accountKind === 'user' ? { kind: 'user', userId: draft.accountId } : { kind: 'connected-account', connectedAccountId: draft.accountId };

type SecretShape = 'new' | 'edit';

/** The draft as an unchecked request body, or why it is not complete enough to check. */
function candidateOf(draft: SetupDraft, shape: SecretShape, argsOf: (text: string) => string[]): Checked<unknown> {
  const secret = (row: SecretRow) => (shape === 'new' ? set(row) : edit(row));
  switch (draft.kind) {
    case 'stdio': {
      const env = filled(draft.env);
      if (draft.command.trim() === '') return MISSING;
      if (unnamed(env)) return { kind: 'invalid', reason: 'Give every variable a name.' };
      return { kind: 'ready', value: { kind: 'stdio', command: draft.command, args: argsOf(draft.args), env: env.map(secret) } };
    }
    case 'http': {
      const headers = filled(draft.headers);
      if (draft.url.trim() === '') return MISSING;
      if (unnamed(headers)) return { kind: 'invalid', reason: 'Give every header a name.' };
      return { kind: 'ready', value: { kind: 'http', url: draft.url.trim(), headers: headers.map(secret) } };
    }
    case 'composio': {
      const keeps = shape === 'edit' && draft.keySaved && draft.apiKey.trim() === '';
      if (draft.toolkit.trim() === '' || draft.serverUrl.trim() === '' || draft.accountId.trim() === '' || (!keeps && draft.apiKey.trim() === '')) return MISSING;
      const apiKey = shape === 'new' ? draft.apiKey : keeps ? { kind: 'keep' } : { kind: 'set', value: draft.apiKey };
      return { kind: 'ready', value: { kind: 'composio', toolkit: draft.toolkit.trim(), serverUrl: draft.serverUrl.trim(), apiKey, account: accountOf(draft) } };
    }
  }
}

/** A new connector's setup. */
export function newSetupOf(draft: SetupDraft): Checked<ConnectorSetup> {
  const candidate = candidateOf(draft, 'new', linesOf);
  return candidate.kind === 'ready' ? checked(ConnectorSetup, candidate.value) : candidate;
}

type Target = Pick<Extract<ConnectorSetupView, { kind: 'stdio' }>, 'kind' | 'command' | 'args'> | Pick<Extract<ConnectorSetupView, { kind: 'http' }>, 'kind' | 'url'> | Pick<Extract<ConnectorSetupView, { kind: 'composio' }>, 'kind' | 'serverUrl' | 'toolkit' | 'account'>;

/** What a setup reaches, without its secrets, as the host compares it: a change points the connector somewhere new. */
function targetOf(setup: Target): string {
  switch (setup.kind) {
    case 'stdio':
      return JSON.stringify(['stdio', setup.command, setup.args]);
    case 'http':
      return JSON.stringify(['http', setup.url]);
    case 'composio':
      return JSON.stringify(['composio', setup.serverUrl, setup.toolkit, setup.account]);
  }
}

function keepsSecrets(edit: ConnectorSetupEdit): boolean {
  switch (edit.kind) {
    case 'stdio':
      return edit.env.some(({ kind }) => kind === 'keep');
    case 'http':
      return edit.headers.some(({ kind }) => kind === 'keep');
    case 'composio':
      return edit.apiKey.kind === 'keep';
  }
}

export const RETARGET_LINE = 'This points the connector somewhere new: enter its keys and secret values again.';

/**
 * An edit of the saved setup `saved`: blank saved secrets are kept, typed ones are set, removed names are dropped.
 * Untouched arguments are sent exactly as saved. Pointing it somewhere new asks for every secret again.
 */
export function setupEditOf(draft: SetupDraft, saved: ConnectorSetupView): Checked<ConnectorSetupEdit> {
  const savedArgs = saved.kind === 'stdio' ? saved.args : null;
  const args = (text: string): string[] => (savedArgs !== null && text === savedArgs.join('\n') ? [...savedArgs] : linesOf(text));
  const candidate = candidateOf(draft, 'edit', args);
  if (candidate.kind === 'invalid') return candidate;
  const edit = checked(ConnectorSetupEdit, candidate.value);
  if (edit.kind === 'ready' && keepsSecrets(edit.value) && targetOf(edit.value) !== targetOf(saved)) return { kind: 'invalid', reason: RETARGET_LINE };
  return edit;
}
