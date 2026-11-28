import { expect, it } from 'vitest';
import { redact, type AppInfo } from '../../shared/privacy.ts';
import { shortPreview } from './AgentRow.tsx';

const INFO: AppInfo = { appVersion: '0.0.0', homeDir: '/Volumes/Private  Files/sam', userName: 'sam', dataDir: '/Volumes/Private  Files/sam/.orikami' };

it('redacts the preview as written before collapsing it to one short line', () => {
  expect(
    ['saved to /Volumes/Private  Files/sam/notes.md\n\nmail sam@example.com', `${'word '.repeat(40)}end`, `${'x'.repeat(159)}👩‍🌾 more`].map((text) => shortPreview(redact(text, INFO))),
  ).toMatchInlineSnapshot(`
    [
      "saved to ~/notes.md mail <email>",
      "word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word…",
      "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx👩‍🌾…",
    ]
  `);
});
