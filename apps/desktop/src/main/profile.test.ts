import { expect, it } from 'vitest';
import { hostEnvOf, profileOf, type Profile } from './profile.ts';

const HOME = '/Users/tester';
const run = (packaged: boolean, env: NodeJS.ProcessEnv = {}): { profile: Profile; host: NodeJS.ProcessEnv | null } => {
  const profile = profileOf({ packaged, env, homeDir: HOME });
  return { profile, host: profile.kind === 'invalid' ? null : hostEnvOf(profile, env) };
};

it('opens ~/.morrowbot only for the installed app; every other run gets its own data, Electron profile and port; the host never gets the feed token', () => {
  expect({
    installed: run(true),
    dev: run(false),
    devWithFolder: run(false, { MORROWBOT_DATA_DIR: '/tmp/screens', MORROWBOT_HOST_PORT: '4900' }),
    installedWithFolder: run(true, { MORROWBOT_DATA_DIR: '/tmp/try', MORROWBOT_RELEASES_TOKEN: 'feed-token' }),
    relative: run(false, { MORROWBOT_DATA_DIR: 'data' }),
  }).toMatchInlineSnapshot(`
    {
      "dev": {
        "host": {
          "MORROWBOT_DATA_DIR": "/Users/tester/.morrowbot-dev",
          "MORROWBOT_HOST_PORT": "0",
        },
        "profile": {
          "dataDir": "/Users/tester/.morrowbot-dev",
          "kind": "isolated",
          "userDataDir": "/Users/tester/.morrowbot-dev/desktop",
        },
      },
      "devWithFolder": {
        "host": {
          "MORROWBOT_DATA_DIR": "/tmp/screens",
          "MORROWBOT_HOST_PORT": "4900",
        },
        "profile": {
          "dataDir": "/tmp/screens",
          "kind": "isolated",
          "userDataDir": "/tmp/screens/desktop",
        },
      },
      "installed": {
        "host": {
          "MORROWBOT_DATA_DIR": "/Users/tester/.morrowbot",
          "MORROWBOT_HOST_PORT": "47800",
        },
        "profile": {
          "dataDir": "/Users/tester/.morrowbot",
          "kind": "installed",
        },
      },
      "installedWithFolder": {
        "host": {
          "MORROWBOT_DATA_DIR": "/tmp/try",
          "MORROWBOT_HOST_PORT": "0",
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
          "problem": "MORROWBOT_DATA_DIR must be an absolute path, not "data".",
        },
      },
    }
  `);
});
