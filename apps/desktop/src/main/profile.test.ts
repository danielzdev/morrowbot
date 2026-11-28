import { expect, it } from 'vitest';
import { hostEnvOf, profileOf, type Profile } from './profile.ts';

const HOME = '/Users/tester';
const run = (packaged: boolean, env: NodeJS.ProcessEnv = {}): { profile: Profile; host: NodeJS.ProcessEnv | null } => {
  const profile = profileOf({ packaged, env, homeDir: HOME });
  return { profile, host: profile.kind === 'invalid' ? null : hostEnvOf(profile, env) };
};

it('opens ~/.oribot only for the installed app; every other run gets its own data, Electron profile and port; the host never gets the feed token', () => {
  expect({
    installed: run(true),
    dev: run(false),
    devWithFolder: run(false, { ORIBOT_DATA_DIR: '/tmp/screens', ORIBOT_HOST_PORT: '4900' }),
    installedWithFolder: run(true, { ORIBOT_DATA_DIR: '/tmp/try', ORIBOT_RELEASES_TOKEN: 'feed-token' }),
    relative: run(false, { ORIBOT_DATA_DIR: 'data' }),
  }).toMatchInlineSnapshot(`
    {
      "dev": {
        "host": {
          "ORIBOT_DATA_DIR": "/Users/tester/.oribot-dev",
          "ORIBOT_HOST_PORT": "0",
        },
        "profile": {
          "dataDir": "/Users/tester/.oribot-dev",
          "kind": "isolated",
          "userDataDir": "/Users/tester/.oribot-dev/desktop",
        },
      },
      "devWithFolder": {
        "host": {
          "ORIBOT_DATA_DIR": "/tmp/screens",
          "ORIBOT_HOST_PORT": "4900",
        },
        "profile": {
          "dataDir": "/tmp/screens",
          "kind": "isolated",
          "userDataDir": "/tmp/screens/desktop",
        },
      },
      "installed": {
        "host": {
          "ORIBOT_DATA_DIR": "/Users/tester/.oribot",
          "ORIBOT_HOST_PORT": "47800",
        },
        "profile": {
          "dataDir": "/Users/tester/.oribot",
          "kind": "installed",
        },
      },
      "installedWithFolder": {
        "host": {
          "ORIBOT_DATA_DIR": "/tmp/try",
          "ORIBOT_HOST_PORT": "0",
        },
        "profile": {
          "dataDir": "/tmp/try",
          "kind": "isolated",
          "userDataDir": "/tmp/try/desktop",
        },
      },
      "relative": {
        "host": null,
        "profile": {
          "kind": "invalid",
          "problem": "ORIBOT_DATA_DIR must be an absolute path, not "data".",
        },
      },
    }
  `);
});
