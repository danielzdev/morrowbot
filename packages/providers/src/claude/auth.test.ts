import { expect, it } from 'vitest';
import { accountKeyOf, judgeAuth } from './auth.ts';

/** `claude auth status --json` from Claude Code 2.1.332 on a personal Max 5x login, with the email, ids, names and paths replaced. */
const PERSONAL_MAX = {
  loggedIn: true,
  authMethod: 'claude.ai',
  apiProvider: 'firstParty',
  analyticsDisabled: false,
  projectsDirectory: '/Users/tester/.claude/projects',
  configDirectory: '/Users/tester/.claude',
  loginExpiresAt: '2026-12-01T00:00:00.000Z',
  consoleProfileSignInOffered: true,
  email: 'user@example.com',
  orgId: '00000000-0000-0000-0000-000000000000',
  orgName: "user@example.com's Organization",
  subscriptionType: 'max',
  storedClaudeAiLogin: true,
  planTier: 'max_5x',
};

/** The same CLI with an empty config folder: nobody signed in. */
const SIGNED_OUT = {
  loggedIn: false,
  authMethod: 'none',
  apiProvider: 'firstParty',
  analyticsDisabled: false,
  projectsDirectory: '/Users/tester/.claude/projects',
  configDirectory: '/Users/tester/.claude',
  loginExpiresAt: null,
  consoleProfileSignInOffered: true,
};

/** The same CLI with an empty config folder and ANTHROPIC_API_KEY set. */
const API_KEY = { ...SIGNED_OUT, loggedIn: true, authMethod: 'api_key', apiKeySource: 'ANTHROPIC_API_KEY' };

it('accepts a personal Pro or Max login, keyed by a hash of the org-scoped email', async () => {
  expect({
    max5x: await judgeAuth(PERSONAL_MAX),
    max20x: await judgeAuth({ ...PERSONAL_MAX, planTier: 'max_20x' }),
    pro: await judgeAuth({ ...PERSONAL_MAX, subscriptionType: 'pro', planTier: 'pro' }),
  }).toMatchInlineSnapshot(`
    {
      "max20x": {
        "accountKey": "4d007f8300a5a631afeed3672cc6e0f6060d8fe4c3d901e8d519c4019090c50e",
        "accountLabel": "Claude Max 20x",
        "kind": "personal",
      },
      "max5x": {
        "accountKey": "4d007f8300a5a631afeed3672cc6e0f6060d8fe4c3d901e8d519c4019090c50e",
        "accountLabel": "Claude Max 5x",
        "kind": "personal",
      },
      "pro": {
        "accountKey": "4d007f8300a5a631afeed3672cc6e0f6060d8fe4c3d901e8d519c4019090c50e",
        "accountLabel": "Claude Pro",
        "kind": "personal",
      },
    }
  `);
});

it('scopes the key by org, and has no key without an email', async () => {
  expect({
    otherOrg: await accountKeyOf('user@example.com', '11111111-1111-1111-1111-111111111111'),
    noOrg: await accountKeyOf('user@example.com', null),
    orgOnly: await accountKeyOf(null, '00000000-0000-0000-0000-000000000000'),
  }).toMatchInlineSnapshot(`
    {
      "noOrg": "b4c9a289323b21a01c3e940f150eb9b8c542587f1abfd8f0e1cc1ffc5e475514",
      "orgOnly": "",
      "otherOrg": "7ba9b780c360f47c97b5ea4a529a1d1b33d9f634d821c14ba5b485ea30336af0",
    }
  `);
});

it('reports signed out, and withholds every login that is not positively a personal plan', async () => {
  const reason = async (json: unknown) => {
    const auth = await judgeAuth(json);
    switch (auth.kind) {
      case 'withheld':
        return auth.reason;
      case 'personal':
      case 'signed-out':
      case 'not-installed':
      case 'failed':
        return auth.kind;
    }
  };
  expect({
    signedOut: await reason(SIGNED_OUT),
    apiKey: await reason(API_KEY),
    team: await reason({ ...PERSONAL_MAX, subscriptionType: 'team', planTier: 'other' }),
    enterprise: await reason({ ...PERSONAL_MAX, subscriptionType: 'enterprise', planTier: 'other' }),
    maxUnknownTier: await reason({ ...PERSONAL_MAX, planTier: 'max_other' }),
    noPlan: await reason({ ...PERSONAL_MAX, subscriptionType: undefined, planTier: undefined }),
    cloud: await reason({ ...PERSONAL_MAX, apiProvider: 'bedrock' }),
    envApiKey: await reason({ ...PERSONAL_MAX, apiKeySource: 'ANTHROPIC_API_KEY' }),
    orgPinned: await reason({ ...PERSONAL_MAX, organizationSignInOrgId: '00000000-0000-0000-0000-000000000000' }),
    noEmail: await reason({ ...PERSONAL_MAX, email: null }),
    unparsable: await reason('Not JSON'),
  }).toMatchInlineSnapshot(`
    {
      "apiKey": "Claude Code is signed in with api_key. Ori Bot supports only a personal Claude Pro or Max login (run "claude auth login").",
      "cloud": "Claude Code sends requests through bedrock. Ori Bot supports only Anthropic's own service with a personal Claude Pro or Max login.",
      "enterprise": "Claude Code reports the plan "enterprise" (other). Ori Bot supports only a personal Claude Pro or Max plan; Team and Enterprise accounts are not supported yet.",
      "envApiKey": "Claude Code would use an API key from ANTHROPIC_API_KEY. Ori Bot supports only a personal Claude Pro or Max login.",
      "maxUnknownTier": "Claude Code reports the plan "max" (max_other). Ori Bot supports only a personal Claude Pro or Max plan; Team and Enterprise accounts are not supported yet.",
      "noEmail": "Claude Code did not report which account is signed in.",
      "noPlan": "Claude Code reports the plan "unknown" (no tier). Ori Bot supports only a personal Claude Pro or Max plan; Team and Enterprise accounts are not supported yet.",
      "orgPinned": "Claude Code sign-in is pinned to an organisation. Ori Bot supports only a personal Claude Pro or Max login.",
      "signedOut": "signed-out",
      "team": "Claude Code reports the plan "team" (other). Ori Bot supports only a personal Claude Pro or Max plan; Team and Enterprise accounts are not supported yet.",
      "unparsable": "failed",
    }
  `);
});
