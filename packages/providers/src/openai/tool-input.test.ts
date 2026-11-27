import { TurnChunk } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { ThreadItem } from './protocol.ts';
import { describeTool } from './tool-input.ts';

const chunk = (item: Readonly<Record<string, unknown>>): unknown => {
  const tool = describeTool(ThreadItem.parse({ id: 'i', ...item }), '/Users/user');
  return tool === null ? null : TurnChunk.safeParse({ kind: 'tool-start', toolUseId: 'i', ...tool }).success;
};

it('keeps every tool input inside the contract, however long or escaped it is', () => {
  expect({
    quotes: chunk({ type: 'commandExecution', command: '"\\\n'.repeat(5000) }),
    manyFiles: chunk({ type: 'fileChange', changes: Array.from({ length: 50 }, () => ({ path: `/Users/user/${'"'.repeat(3000)}` })) }),
    emptyTool: chunk({ type: 'dynamicToolCall', tool: '' }),
    emptyId: describeTool(ThreadItem.parse({ type: 'commandExecution', id: '', command: 'ls' }), null),
  }).toMatchInlineSnapshot(`
    {
      "emptyId": null,
      "emptyTool": true,
      "manyFiles": true,
      "quotes": true,
    }
  `);
});
