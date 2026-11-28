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

/** The flow with Electron's part recorded as calls; `failTrash` makes moving to the Trash fail, `atStop` runs while the host stops. */
function flow(options: { readonly failTrash?: boolean; readonly atStop?: () => Promise<unknown> } = {}): { readonly reset: ResetFlow; readonly calls: unknown[] } {
  const calls: unknown[] = [];
  let openAtLogin = true;
  const deps: ResetDeps = {
    context: () => Promise.resolve(fake.context('installed', '.morrowbot')),
    bundle: () => ({ packaged: true, execPath: `${fake.home}/Applications/MorrowBot.app/Contents/MacOS/MorrowBot`, updatePending: false }),
    keychain: fakeKeychain([]),
    pauseUpdates: () => calls.push('pause updates'),
    loginItem: {
      isOn: () => openAtLogin,
      set: (on) => {
        openAtLogin = on;
        calls.push(`open at login ${on ? 'on' : 'off'}`);
      },
    },
    running: () => true,
    stopHost: async () => {
      calls.push('stop host');
      await options.atStop?.();
    },
    startHelper: (job) => {
      calls.push({ helper: fake.short({ choice: job.choice, approved: job.approved, waitPids: job.waitPids }) });
      return Promise.resolve({
        release: () => {
          calls.push('release helper');
          return Promise.resolve();
        },
        cancel: () => calls.push('cancel helper'),
      });
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
          "pause updates",
          "stop host",
          {
            "helper": {
              "approved": [
                {
                  "kind": "delete",
                  "path": "~/.morrowbot/morrowbot.sqlite",
                },
              ],
              "choice": {
                "kind": "full-uninstall",
              },
              "waitPids": [
                100,
              ],
            },
          },
          "open at login off",
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
          "pause updates",
          "stop host",
          {
            "helper": {
              "approved": [
                {
                  "kind": "delete",
                  "path": "~/.morrowbot/morrowbot.sqlite",
                },
              ],
              "choice": {
                "kind": "reset",
                "relaunch": {
                  "args": [],
                  "command": "/Applications/MorrowBot.app/Contents/MacOS/MorrowBot",
                  "cwd": "/",
                },
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
          "pause updates",
          "stop host",
          "open at login off",
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

it('refuses a stale token or a list that changed since it was shown, before stopping anything; a failed Trash, or a bundle that changed while the host stopped, cancels the helper, turns Open at Login back on and restarts', async () => {
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

  await fake.file('Applications/MorrowBot.app/Contents/Info.plist', INFO_PLIST('com.legendarykoi.morrowbot'));
  const swapped = flow({ atStop: () => fake.file('Applications/MorrowBot.app/Contents/Info.plist', INFO_PLIST('com.other.app')) });
  const swappedOutcome = await swapped.reset.run('uninstall-app', (await swapped.reset.plan()).token);

  expect({
    stale: { outcome: staleOutcome, calls: stale.calls },
    changed: { outcome: changedOutcome, calls: changed.calls },
    failedTrash: { outcome: failedOutcome, calls: failing.calls.filter((call) => typeof call === 'string' || 'recover' in Object(call)) },
    appGone: { outcome: goneOutcome, calls: gone.calls },
    bundleSwappedWhileStopping: { outcome: swappedOutcome, calls: swapped.calls },
  }).toMatchInlineSnapshot(`
    {
      "appGone": {
        "calls": [
          "pause updates",
        ],
        "outcome": {
          "kind": "refused",
          "reason": "Something changed since this list was made. Review it again.",
        },
      },
      "bundleSwappedWhileStopping": {
        "calls": [
          "pause updates",
          "stop host",
          "open at login off",
          "open at login on",
          {
            "recover": "This app bundle is not com.legendarykoi.morrowbot.",
          },
        ],
        "outcome": {
          "kind": "refused",
          "reason": "MorrowBot could not finish, so it is restarting with everything as it was.",
        },
      },
      "changed": {
        "calls": [
          "pause updates",
        ],
        "outcome": {
          "kind": "refused",
          "reason": "Something changed since this list was made. Review it again.",
        },
      },
      "failedTrash": {
        "calls": [
          "pause updates",
          "stop host",
          "open at login off",
          "open at login on",
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
