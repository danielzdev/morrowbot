import type { Message } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { chatMarkdown } from './chat-markdown.ts';

it('keeps the user’s words and redacts the agent’s replies', () => {
  const base = { threadId: 't1', createdAt: '2026-01-01T00:00:00.000Z' };
  const messages: Message[] = [
    { ...base, id: 'm1', kind: 'user', text: 'My notes are in /Users/sam/notes, ask sam@example.com' },
    { ...base, id: 'm2', kind: 'assistant', text: 'Read /Users/sam/notes/plan.md', outcome: { kind: 'completed', finishReason: 'stop' } },
  ];
  const redact = (text: string) => text.replaceAll('/Users/sam', '~');
  expect(chatMarkdown('Grocery plan', 'Errand Bot', messages, redact)).toMatchInlineSnapshot(`
    "# Grocery plan

    **You:**

    My notes are in /Users/sam/notes, ask sam@example.com

    **Errand Bot:**

    Read ~/notes/plan.md
    "
  `);
});
