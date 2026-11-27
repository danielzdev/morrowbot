import { expect, it } from 'vitest';
import { displayPath, planLabel, redact, type AppInfo } from './privacy.ts';

const INFO: AppInfo = { appVersion: '0.0.0', homeDir: '/Users/sam', userName: 'sam', dataDir: '/Users/sam/.morrowbot' };

it('redacts the home path, emails and the user name as a whole word, keeping other wording', () => {
  expect(
    [
      'spawn /Users/sam/.local/bin/claude ENOENT',
      'Signed in as sam.lee@example.com',
      'sam cannot write /Users/sam',
      'sample and samuel stay, /Users/samantha stays',
      'owner: Sam',
    ].map((text) => redact(text, INFO)),
  ).toEqual([
    'spawn ~/.local/bin/claude ENOENT',
    'Signed in as <email>',
    '<user> cannot write ~',
    'sample and samuel stay, /Users/samantha stays',
    'owner: Sam',
  ]);
});

it('shows MorrowBot folders and the workspace in full under home, and only the last two segments of any other path', () => {
  expect({
    data: displayPath('/Users/sam/.morrowbot/workspaces/agent-1', INFO),
    workspace: displayPath('/Users/sam/Projects/garden/notes', INFO, '/Users/sam/Projects/garden'),
    other: displayPath('/Users/sam/Projects/garden/notes/plan.md', INFO),
    outside: displayPath('/opt/homebrew/bin/claude', INFO),
    short: displayPath('/Users/sam/notes', INFO),
    userInTail: displayPath('/Volumes/backup/sam/plan.md', INFO),
    customData: displayPath('/Volumes/data/mb/plugins', { ...INFO, dataDir: '/Volumes/data/mb' }),
    workspaceOutsideHome: displayPath('/srv/work/garden/notes', INFO, '/srv/work/garden'),
  }).toEqual({
    data: '~/.morrowbot/workspaces/agent-1',
    workspace: '~/Projects/garden/notes',
    other: '…/notes/plan.md',
    outside: '…/bin/claude',
    short: '~/notes',
    userInTail: '…/<user>/plan.md',
    customData: '…/mb/plugins',
    workspaceOutsideHome: '…/garden/notes',
  });
});

it('shows only allowlisted plan labels, never the workspace name Codex appends', () => {
  expect(
    ['Claude Max 20x', 'ChatGPT Pro (Acme Robotics)', 'ChatGPT', 'ChatGPT Plus', 'sam@example.com', 'Claude Max 5x extra', 'OpenAI API key'].map(planLabel),
  ).toEqual(['Claude Max 20x', 'ChatGPT Pro', 'ChatGPT', 'ChatGPT Plus', null, null, 'OpenAI API key']);
});
