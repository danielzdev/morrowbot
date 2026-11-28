import { rm } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { fakeHome, fakeKeychain, INFO_PLIST, type FakeHome } from './reset-fixture.ts';
import { resetFlow, type ResetDeps, type ResetFlow } from './reset-flow.ts';

let fake: FakeHome;
beforeEach(async () => {
  fake = await fakeHome();
  await fake.file('.morrowbot/morrowbot.sqlite');
  await fake.file('Applications/MorrowBot.app/Contents/Info.plist', INFO_PLIST('com.legendarykoi.morrowbot'));
});
afterEach(async () => {
  await fake.remove();
});

/** The flow with Electron's part recorded as calls; `failTrash` makes moving to the Trash fail. */
function flow(options: { readonly failTrash?: boolean } = {}): { readonly reset: ResetFlow; readonly calls: unknown[] } {
  const calls: unknown[] = [];
  const deps: ResetDeps = {
    context: () => Promise.resolve(fake.context('installed', '.morrowbot')),
    bundle: () => ({ packaged: true, execPath: `${fake.home}/Applications/MorrowBot.app/Contents/MacOS/MorrowBot`, updatePending: false }),
    keychain: fakeKeychain([]),
    running: () => true,
    stopHost: () => {
      calls.push('stop host');
      return Promise.resolve();
    },
    startHelper: (job) => {
      calls.push({ helper: fake.short({ approved: job.approved, waitPids: job.waitPids, relaunch: job.relaunch }) });
      return Promise.resolve({ release: () => calls.push('release helper'), cancel: () => calls.push('cancel helper') });
    },
    trash: (target) => {
      calls.push(fake.short({ trash: target }));
      return options.failTrash === true ? Promise.reject(new Error('The Finder refused')) : Promise.resolve();
    },
    relaunch: { command: '/Applications/MorrowBot.app/Contents/MacOS/MorrowBot', args: [], cwd: '/' },
    mainPid: 100,
    quit: () => calls.push('quit'),
    recover: (message) => calls.push({ recover: message }),
  };
  return { reset: resetFlow(deps), calls };
}

it('runs each choice in order: stop the host, start the helper for deletions, move the app to the Trash, quit', async () => {
  const run = async (choice: 'reset' | 'uninstall-app' | 'full-uninstall') => {
    const { reset, calls } = flow();
    const outcome = await reset.run(choice, (await reset.plan()).token);
    return { outcome, calls };
  };
  expect({ reset: await run('reset'), uninstallApp: await run('uninstall-app'), fullUninstall: await run('full-uninstall') }).toMatchInlineSnapshot(`
    {
      "fullUninstall": {
        "calls": [
          "stop host",
          {
            "helper": {
              "approved": [
                {
                  "kind": "delete",
                  "path": "~/.morrowbot/morrowbot.sqlite",
                },
              ],
              "relaunch": null,
              "waitPids": [
                100,
              ],
            },
          },
          {
            "trash": "~/Applications/MorrowBot.app",
          },
          "release helper",
          "quit",
        ],
        "outcome": {
          "kind": "quitting",
        },
      },
      "reset": {
        "calls": [
          "stop host",
          {
            "helper": {
              "approved": [
                {
                  "kind": "delete",
                  "path": "~/.morrowbot/morrowbot.sqlite",
                },
              ],
              "relaunch": {
                "args": [],
                "command": "/Applications/MorrowBot.app/Contents/MacOS/MorrowBot",
                "cwd": "/",
              },
              "waitPids": [
                100,
              ],
            },
          },
          "release helper",
          "quit",
        ],
        "outcome": {
          "kind": "quitting",
        },
      },
      "uninstallApp": {
        "calls": [
          "stop host",
          {
            "trash": "~/Applications/MorrowBot.app",
          },
          "quit",
        ],
        "outcome": {
          "kind": "quitting",
        },
      },
    }
  `);
});

it('refuses a stale token or a list that changed since it was shown, before stopping anything; a failed Trash cancels the helper and restarts', async () => {
  const stale = flow();
  await stale.reset.plan();
  const staleOutcome = await stale.reset.run('reset', 'not-the-token');

  const changed = flow();
  const { token } = await changed.reset.plan();
  await fake.file('.morrowbot/attachments/new.png');
  const changedOutcome = await changed.reset.run('full-uninstall', token);

  const failing = flow({ failTrash: true });
  const failedOutcome = await failing.reset.run('full-uninstall', (await failing.reset.plan()).token);

  const gone = flow();
  const goneToken = (await gone.reset.plan()).token;
  await rm(`${fake.home}/Applications/MorrowBot.app`, { recursive: true });
  const goneOutcome = await gone.reset.run('uninstall-app', goneToken);

  expect({
    stale: { outcome: staleOutcome, calls: stale.calls },
    changed: { outcome: changedOutcome, calls: changed.calls },
    failedTrash: { outcome: failedOutcome, calls: failing.calls.filter((call) => typeof call === 'string' || 'recover' in Object(call)) },
    appGone: { outcome: goneOutcome, calls: gone.calls },
  }).toMatchInlineSnapshot(`
    {
      "appGone": {
        "calls": [],
        "outcome": {
          "kind": "refused",
          "reason": "Something changed since this list was made. Review it again.",
        },
      },
      "changed": {
        "calls": [],
        "outcome": {
          "kind": "refused",
          "reason": "Something changed since this list was made. Review it again.",
        },
      },
      "failedTrash": {
        "calls": [
          "stop host",
          "cancel helper",
          {
            "recover": "The Finder refused",
          },
        ],
        "outcome": {
          "kind": "refused",
          "reason": "MorrowBot could not finish, so it is restarting with everything as it was.",
        },
      },
      "stale": {
        "calls": [],
        "outcome": {
          "kind": "refused",
          "reason": "This list is out of date. Review it again.",
        },
      },
    }
  `);
});
