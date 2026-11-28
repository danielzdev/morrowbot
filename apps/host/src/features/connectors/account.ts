import type { ConnectorSetup, ConnectorSetupEdit } from '@morrowbot/contracts';

type Merge = { readonly kind: 'merged'; readonly setup: ConnectorSetup } | { readonly kind: 'invalid'; readonly reason: string };

interface Secret {
  readonly name: string;
  readonly value: string;
}

/** Resolves each `keep` to the saved value of the same name; a name with no saved value cannot be kept. */
function mergeSecrets(saved: readonly Secret[], edits: readonly ({ readonly kind: 'keep'; readonly name: string } | { readonly kind: 'set'; readonly name: string; readonly value: string })[]): Secret[] | string {
  const merged: Secret[] = [];
  for (const edit of edits) {
    switch (edit.kind) {
      case 'set':
        merged.push({ name: edit.name, value: edit.value });
        break;
      case 'keep': {
        const found = saved.find(({ name }) => name.toLowerCase() === edit.name.toLowerCase());
        if (found === undefined) return `${edit.name}: there is no saved value to keep; enter one`;
        merged.push({ name: edit.name, value: found.value });
        break;
      }
    }
  }
  return merged;
}

/** Applies an Account edit to the saved setup. Kept secrets come from the same kind of setup only. */
export function mergeSetup(saved: ConnectorSetup, edit: ConnectorSetupEdit): Merge {
  switch (edit.kind) {
    case 'stdio': {
      const env = mergeSecrets(saved.kind === 'stdio' ? saved.env : [], edit.env);
      return typeof env === 'string' ? { kind: 'invalid', reason: env } : { kind: 'merged', setup: { kind: 'stdio', command: edit.command, args: edit.args, env } };
    }
    case 'http': {
      const headers = mergeSecrets(saved.kind === 'http' ? saved.headers : [], edit.headers);
      return typeof headers === 'string' ? { kind: 'invalid', reason: headers } : { kind: 'merged', setup: { kind: 'http', url: edit.url, headers } };
    }
    case 'composio': {
      const apiKey = edit.apiKey.kind === 'set' ? edit.apiKey.value : saved.kind === 'composio' ? saved.apiKey : undefined;
      if (apiKey === undefined) return { kind: 'invalid', reason: 'apiKey: there is no saved key to keep; enter one' };
      return { kind: 'merged', setup: { kind: 'composio', toolkit: edit.toolkit, serverUrl: edit.serverUrl, apiKey, account: edit.account } };
    }
  }
}

/** What the connector reaches, without its secrets: a change here points its tools at another server or account. */
export function targetOf(setup: ConnectorSetup): string {
  switch (setup.kind) {
    case 'stdio':
      return JSON.stringify(['stdio', setup.command, setup.args]);
    case 'http':
      return JSON.stringify(['http', setup.url]);
    case 'composio':
      return JSON.stringify(['composio', setup.serverUrl, setup.toolkit, setup.account]);
  }
}
