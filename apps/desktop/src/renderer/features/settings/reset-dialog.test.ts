import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import type { ResetPlan } from '../../bridge.ts';
import { ResetDialogView, type ResetStage } from './ResetDialog.tsx';

const INFO = { appVersion: '1.2.3', homeDir: '/Users/tester', userName: 'tester', dataDir: '/Users/tester/.morrowbot' };
const PLAN: ResetPlan = {
  token: 't',
  options: [
    { kind: 'unavailable', choice: 'reset', reason: "MorrowBot's host isn't running." },
    { kind: 'available', choice: 'uninstall-app', steps: [{ kind: 'trash', path: '/Applications/MorrowBot.app' }], kept: [{ path: '/Users/tester/.morrowbot', reason: 'Stays.' }] },
    {
      kind: 'available',
      choice: 'full-uninstall',
      steps: [
        { kind: 'trash', path: '/Applications/MorrowBot.app' },
        { kind: 'delete', path: '/Users/tester/.morrowbot/morrowbot.sqlite' },
        { kind: 'delete', path: '/Users/tester/.morrowbot/plugin-data/tester-notes' },
        { kind: 'delete', path: '/Users/tester/Library/Application Support/MorrowBot' },
        { kind: 'keychain', service: 'MorrowBot Safe Storage', account: 'MorrowBot' },
      ],
      kept: [{ path: '/Users/tester/.morrowbot/workspaces', reason: 'Agent workspaces are never touched.' }],
    },
  ],
};
const ignore = (): void => undefined;

/** The stage as the user reads it: text by block, controls with their state. */
function shown(stage: ResetStage): string[] {
  const html = renderToString(h(ResetDialogView, { stage, info: INFO, onStage: ignore, onRun: ignore, onReload: ignore, onClose: ignore }));
  return html
    .replaceAll(/<input type="radio"[^>]*>/g, (input) => (input.includes('disabled') ? '(disabled) ' : '( ) '))
    .replaceAll(/<input type="checkbox"[^>]*>/g, (input) => (input.includes('checked') ? '[x] ' : '[ ] '))
    .replaceAll(/<button([^>]*)>([^<]*)<\/button>/g, (_, attributes: string, label: string) => `\n[${label.trim()}${attributes.includes('disabled') ? ', disabled' : ''}]\n`)
    .replaceAll(/<\/(li|p|h3|legend|label|span class="reset-choice-title")>/g, '\n')
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
    .split('\n')
    .map((line) => line.replaceAll(/\s+/g, ' ').trim())
    .filter((line) => line !== '');
}

it('lists every choice with unavailable ones disabled and explained, then every exact path before an explicit confirmation', () => {
  const full = PLAN.options[2];
  if (full?.kind !== 'available') throw new Error('fixture');
  expect({
    choose: shown({ kind: 'choose', plan: PLAN, choice: null }),
    confirm: shown({ kind: 'confirm', plan: PLAN, option: full, understood: false }),
    confirmed: shown({ kind: 'confirm', plan: PLAN, option: full, understood: true }).slice(-2),
  }).toMatchInlineSnapshot(`
    {
      "choose": [
        "Choose what to do. You see every file before anything happens.",
        "(disabled) Reset & start fresh Deletes MorrowBot's chats, settings, plugins and caches, then reopens it like new. The app stays installed. MorrowBot's host isn't running.",
        "( ) Uninstall app (keep data) Moves MorrowBot.app to the Trash and quits. Your data stays for a future reinstall.",
        "( ) Full uninstall (app + all data) Moves MorrowBot.app to the Trash, quits, then deletes all of MorrowBot's data, caches and Keychain items.",
        "[Cancel]",
        "[Continue…, disabled]",
      ],
      "confirm": [
        "Moves MorrowBot.app to the Trash, quits, then deletes all of MorrowBot's data, caches and Keychain items.",
        "Moved to the Trash",
        "/Applications/MorrowBot.app",
        "Deleted for good",
        "~/.morrowbot/morrowbot.sqlite",
        "~/.morrowbot/plugin-data/tester-notes",
        "~/Library/Application Support/MorrowBot",
        "Removed from the login Keychain",
        "MorrowBot Safe Storage (account MorrowBot)",
        "Kept",
        "~/.morrowbot/workspaces Agent workspaces are never touched.",
        "[ ] I understand the deleted items cannot be recovered.",
        "[Back]",
        "[Uninstall everything, disabled]",
      ],
      "confirmed": [
        "[Back]",
        "[Uninstall everything]",
      ],
    }
  `);
});
