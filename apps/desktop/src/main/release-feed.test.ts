import { expect, it } from 'vitest';
import { feedOf } from './release-feed.ts';

it('reads the release feed from ORIBOT_RELEASES_REPO, else the build, else the default, with an env or Keychain token', () => {
  expect([
    feedOf({ env: {}, builtRepo: null, keychainToken: null }),
    feedOf({ env: {}, builtRepo: 'builder/built-releases', keychainToken: 'keychain-token\n' }),
    feedOf({ env: { ORIBOT_RELEASES_REPO: 'someone/fork-releases', ORIBOT_RELEASES_TOKEN: 'env-token' }, builtRepo: 'builder/built-releases', keychainToken: 'keychain-token' }),
    feedOf({ env: { ORIBOT_RELEASES_REPO: 'not a repo' }, builtRepo: null, keychainToken: null }),
  ]).toMatchInlineSnapshot(`
    [
      {
        "kind": "github",
        "owner": "danielzdev",
        "repo": "ori-bot-releases",
        "token": null,
      },
      {
        "kind": "github",
        "owner": "builder",
        "repo": "built-releases",
        "token": "keychain-token",
      },
      {
        "kind": "github",
        "owner": "someone",
        "repo": "fork-releases",
        "token": "env-token",
      },
      {
        "kind": "invalid",
        "problem": "ORIBOT_RELEASES_REPO: Expected owner/repo",
      },
    ]
  `);
});
