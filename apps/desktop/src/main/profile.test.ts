import { expect, it } from 'vitest';
import { hostEnvOf, profileOf, type Profile } from './profile.ts';

const HOME = '/Users/tester';
const run = (packaged: boolean, env: NodeJS.ProcessEnv = {}): { profile: Profile; host: NodeJS.ProcessEnv | null } => {
  const profile = profileOf({ packaged, env, homeDir: HOME });
  return { profile, host: profile.kind === 'invalid' ? null : hostEnvOf(profile, env) };
};

it('opens ~/.orikami only for the installed app; every other run gets its own data, Electron profile and port; the host never gets the feed token', () => {
  expect({
    installed: run(true),
    dev: run(false),
    devWithFolder: run(false, { ORIKAMI_DATA_DIR: '/tmp/screens', ORIKAMI_HOST_PORT: '4900' }),
    installedWithFolder: run(true, { ORIKAMI_DATA_DIR: '/tmp/try', ORIKAMI_RELEASES_TOKEN: 'feed-token' }),
    relative: run(false, { ORIKAMI_DATA_DIR: 'data' }),
  }).toMatchInlineSnapshot(`
    {
      "dev": {
        "host": {
          "ORIKAMI_DATA_DIR": "/Users/tester/.orikami-dev",
          "ORIKAMI_HOST_PORT": "0",
        },
        "profile": {
          "dataDir": "/Users/tester/.orikami-dev",
          "kind": "isolated",
          "userDataDir": "/Users/tester/.orikami-dev/desktop",
        },
      },
      "devWithFolder": {
        "host": {
          "ORIKAMI_DATA_DIR": "/tmp/screens",
          "ORIKAMI_HOST_PORT": "4900",
        },
        "profile": {
          "dataDir": "/tmp/screens",
          "kind": "isolated",
          "userDataDir": "/tmp/screens/desktop",
        },
      },
      "installed": {
        "host": {
          "ORIKAMI_DATA_DIR": "/Users/tester/.orikami",
          "ORIKAMI_HOST_PORT": "47800",
        },
        "profile": {
          "dataDir": "/Users/tester/.orikami",
          "kind": "installed",
        },
      },
      "installedWithFolder": {
        "host": {
          "ORIKAMI_DATA_DIR": "/tmp/try",
          "ORIKAMI_HOST_PORT": "0",
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
          "problem": "ORIKAMI_DATA_DIR must be an absolute path, not "data".",
        },
      },
    }
  `);
});
