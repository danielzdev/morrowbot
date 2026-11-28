import { ConnectorSetup, ConnectorSetupEdit, type ComposioAccount, type ConnectorSecretView, type ConnectorSetupView } from '@morrowbot/contracts';
import type { z } from 'zod';

/** Where a secret's value comes from: typed into the form, or a Vault item the host reads when it connects. */
export type SecretSource = { readonly kind: 'typed' } | { readonly kind: 'vault'; readonly vaultId: string };

const TYPED: SecretSource = { kind: 'typed' };

/** One environment variable or header being typed, or taken from the Vault. */
export interface SecretRow {
  readonly key: string;
  readonly name: string;
  readonly value: string;
  readonly source: SecretSource;
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
  readonly keySource: SecretSource;
  readonly accountKind: ComposioAccount['kind'];
  readonly accountId: string;
}

/** What a connector reaches, as the form holds it. */
export type SetupDraft = StdioDraft | HttpDraft | ComposioDraft;

export const EMPTY_STDIO: StdioDraft = { kind: 'stdio', command: '', args: '', env: [] };
export const EMPTY_HTTP: HttpDraft = { kind: 'http', url: '', headers: [] };
export const EMPTY_COMPOSIO: ComposioDraft = { kind: 'composio', toolkit: '', serverUrl: '', apiKey: '', keySaved: false, keySource: TYPED, accountKind: 'user', accountId: '' };

const savedRows = (secrets: readonly ConnectorSecretView[]): SecretRow[] =>
  secrets.map((secret) => ({
    key: `saved:${secret.name}`,
    name: secret.name,
    value: '',
    source: secret.kind === 'vault' ? { kind: 'vault', vaultId: secret.vaultId } : TYPED,
    saved: secret.kind === 'inline',
  }));

/** The row with its value taken from `source`. A header still unnamed takes the name of the header secret picked. */
export function withSource(row: SecretRow, source: SecretSource, headerName: string | null): SecretRow {
  return { ...row, source, name: source.kind === 'vault' && row.name === '' && headerName !== null ? headerName : row.name };
}

/** The saved setup as an edit starts: secret values are never sent to a window, so their rows are blank. */
export function draftOf(view: ConnectorSetupView): SetupDraft {
  switch (view.kind) {
    case 'stdio':
      return { kind: 'stdio', command: view.command, args: view.args.join('\n'), env: savedRows(view.env) };
    case 'http':
      return { kind: 'http', url: view.url, headers: savedRows(view.headers) };
    case 'composio':
      return {
        kind: 'composio',
        toolkit: view.toolkit,
        serverUrl: view.serverUrl,
        apiKey: '',
        keySaved: view.apiKey.kind === 'inline',
        keySource: view.apiKey.kind === 'vault' ? { kind: 'vault', vaultId: view.apiKey.vaultId } : TYPED,
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

const filled = (rows: readonly SecretRow[]): SecretRow[] => rows.filter((row) => row.saved || row.source.kind === 'vault' || row.name.trim() !== '' || row.value !== '');
const unnamed = (rows: readonly SecretRow[]): boolean => rows.some((row) => row.name.trim() === '');
const inline = (row: SecretRow) => ({ kind: 'inline', name: row.name.trim(), value: row.value });
const fromVault = (row: SecretRow, vaultId: string) => ({ kind: 'vault', name: row.name.trim(), vaultId });
const create = (row: SecretRow) => (row.source.kind === 'vault' ? fromVault(row, row.source.vaultId) : inline(row));
const edit = (row: SecretRow) => {
  if (row.source.kind === 'vault') return fromVault(row, row.source.vaultId);
  return row.saved && row.value === '' ? { kind: 'keep', name: row.name } : { kind: 'set', name: row.name.trim(), value: row.value };
};

const accountOf = (draft: ComposioDraft): ComposioAccount =>
  draft.accountKind === 'user' ? { kind: 'user', userId: draft.accountId } : { kind: 'connected-account', connectedAccountId: draft.accountId };

type SecretShape = 'new' | 'edit';

/** The draft as an unchecked request body, or why it is not complete enough to check. */
function candidateOf(draft: SetupDraft, shape: SecretShape, argsOf: (text: string) => string[]): Checked<unknown> {
  const secret = (row: SecretRow) => (shape === 'new' ? create(row) : edit(row));
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
      const { keySource } = draft;
      const keeps = shape === 'edit' && keySource.kind === 'typed' && draft.keySaved && draft.apiKey.trim() === '';
      if (draft.toolkit.trim() === '' || draft.serverUrl.trim() === '' || draft.accountId.trim() === '' || (keySource.kind === 'typed' && !keeps && draft.apiKey.trim() === '')) return MISSING;
      const apiKey =
        keySource.kind === 'vault' ? { kind: 'vault', vaultId: keySource.vaultId } : shape === 'new' ? { kind: 'inline', value: draft.apiKey } : keeps ? { kind: 'keep' } : { kind: 'set', value: draft.apiKey };
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
 * An edit of the saved setup `saved`: blank saved secrets are kept, typed ones are set, Vault ones are sent as chosen, removed names are dropped.
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
