import type { Message } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { renderSeed, SEEDED_SESSION_BUDGET } from './seed.ts';

const AT = '2026-01-01T00:00:00.000Z';

it('a seeded reply lists the tools it called and how each ended before its text, and the files it attached after', () => {
  const history: Message[] = [
    { kind: 'user', id: 'u1', threadId: 't', text: 'Run the tests', createdAt: AT, attachments: [] },
    { kind: 'assistant', attachments: [], id: 'a1', threadId: 't', text: 'Two tests fail.', outcome: { kind: 'completed', finishReason: 'stop' }, createdAt: AT },
    { kind: 'assistant', attachments: [{ kind: 'file', id: 'f1', name: 'report.pdf', mimeType: 'application/pdf', size: 9 }], id: 'a2', threadId: 't', text: 'No tools here.', outcome: { kind: 'completed', finishReason: 'stop' }, createdAt: AT },
  ];
  const tools = new Map([
    ['a1', [
      { toolUseId: 'r', name: 'Read', input: { file_path: 'a.md' }, startedAt: AT, outcome: 'ok', endedAt: AT },
      { toolUseId: 'b', name: 'Bash', input: { command: 'make' }, startedAt: AT, outcome: 'unfinished' },
    ] as const],
  ]);
  expect(renderSeed(history, SEEDED_SESSION_BUDGET, tools).text).toMatchInlineSnapshot(`
    "<user>
    Run the tests
    </user>
    <assistant>
    [Tools: Read (ok), Bash (unfinished)]
    Two tests fail.
    </assistant>
    <assistant>
    No tools here.
    [Attached: report.pdf]
    </assistant>"
  `);
});
