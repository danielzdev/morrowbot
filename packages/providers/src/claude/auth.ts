import { z, type PluginRuntime } from '@morrowbot/plugin-sdk';
import { describeExit } from './exit.ts';

/** What `claude auth status --json` says about the sign-in, judged against Ori Bot's personal-subscription rule. */
export type Auth =
  | { readonly kind: 'personal'; readonly accountKey: string; readonly accountLabel: string }
  | { readonly kind: 'withheld'; readonly accountKey: string; readonly reason: string }
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'not-installed' }
  | { readonly kind: 'failed'; readonly message: string };

const AUTH_TIMEOUT_MS = 15_000;

const Name = z.string().min(1);

const AuthStatus = z.looseObject({
  loggedIn: z.boolean(),
  authMethod: Name.optional(),
  apiProvider: Name.optional(),
  apiKeySource: Name.optional(),
  organizationSignInOrgId: Name.optional(),
  email: Name.nullish(),
  orgId: Name.nullish(),
  subscriptionType: Name.nullish(),
  planTier: Name.nullish(),
});

/** The personal plans: `subscriptionType` and the `planTier` Claude Code 2.1.332 derives from it. */
const PERSONAL_PLANS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  pro: { pro: 'Claude Pro' },
  max: { max_5x: 'Claude Max 5x', max_20x: 'Claude Max 20x' },
};

/** Runs `claude auth status --json` (a probe, never cached) and judges the sign-in. */
export async function readAuth(runtime: PluginRuntime, cliPath: string, cwd: string, cancel?: AbortSignal): Promise<Auth> {
  let output = '';
  const timeout = AbortSignal.timeout(AUTH_TIMEOUT_MS);
  const signal = cancel === undefined ? timeout : AbortSignal.any([timeout, cancel]);
  const exit = await runtime.runCommand(cliPath, {
    args: ['auth', 'status', '--json'],
    cwd,
    input: '',
    files: [],
    scope: { kind: 'probe' },
    signal,
    onLine: (line) => {
      output += `${line}\n`;
    },
  });
  if (timeout.aborted) return { kind: 'failed', message: `"${cliPath} auth status" did not answer within 15 seconds` };
  if (signal.aborted) return { kind: 'failed', message: 'Stopped' };
  switch (exit.kind) {
    case 'not-found':
      return { kind: 'not-installed' };
    case 'failed':
      return { kind: 'failed', message: describeExit(cliPath, exit) };
    case 'exited':
      break;
  }
  const judged = await judgeAuth(parseJson(output));
  if (judged.kind !== 'failed') return judged;
  return { kind: 'failed', message: `${judged.message} (${describeExit(cliPath, exit)})` };
}

/** Judges parsed `auth status --json` output. Only a positively recognised personal plan is `personal`. */
export async function judgeAuth(json: unknown): Promise<Auth> {
  const parsed = AuthStatus.safeParse(json);
  if (!parsed.success) {
    return { kind: 'failed', message: 'Claude Code did not report whether you are signed in. Update Claude Code and try again.' };
  }
  const status = parsed.data;
  if (!status.loggedIn) return { kind: 'signed-out' };
  const accountKey = await accountKeyOf(status.email ?? null, status.orgId ?? null);
  const withheld = (reason: string): Auth => ({ kind: 'withheld', accountKey, reason });
  if (status.authMethod !== 'claude.ai') {
    return withheld(
      `Claude Code is signed in with ${status.authMethod ?? 'an unknown method'}. Ori Bot supports only a personal Claude Pro or Max login (run "claude auth login").`,
    );
  }
  if (status.apiProvider !== 'firstParty') {
    return withheld(`Claude Code sends requests through ${status.apiProvider ?? 'an unknown provider'}. Ori Bot supports only Anthropic's own service with a personal Claude Pro or Max login.`);
  }
  if (status.apiKeySource !== undefined) {
    return withheld(`Claude Code would use an API key from ${status.apiKeySource}. Ori Bot supports only a personal Claude Pro or Max login.`);
  }
  if (status.organizationSignInOrgId !== undefined) {
    return withheld('Claude Code sign-in is pinned to an organisation. Ori Bot supports only a personal Claude Pro or Max login.');
  }
  const label = planLabel(status.subscriptionType ?? null, status.planTier ?? null);
  if (label === undefined) {
    return withheld(
      `Claude Code reports the plan "${status.subscriptionType ?? 'unknown'}" (${status.planTier ?? 'no tier'}). Ori Bot supports only a personal Claude Pro or Max plan; Team and Enterprise accounts are not supported yet.`,
    );
  }
  if (accountKey === '') return withheld('Claude Code did not report which account is signed in.');
  return { kind: 'personal', accountKey, accountLabel: label };
}

function planLabel(subscriptionType: string | null, planTier: string | null): string | undefined {
  if (subscriptionType === null || planTier === null) return undefined;
  return Object.hasOwn(PERSONAL_PLANS, subscriptionType) ? PERSONAL_PLANS[subscriptionType]?.[planTier] : undefined;
}

/**
 * A SHA-256 of the account, never the raw email. `auth status` 2.1.332 shows no account id, so the
 * email is the identity, scoped by the organisation id when there is one. '' without an email.
 */
export async function accountKeyOf(email: string | null, orgId: string | null): Promise<string> {
  if (email === null) return '';
  const identity = orgId === null ? email : `${orgId}\n${email}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
