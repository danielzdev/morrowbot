import { expect, it } from 'vitest';
import { createTripwire, type Breach } from './tripwire.ts';

it('trips on a change finished without asking, remembering its kind from an earlier update of the same session, and not on a failed change or a read', () => {
  const breaches: Breach[] = [];
  const tripwire = createTripwire('/home/me', (breach) => breaches.push(breach));
  const hear = (sessionId: string, update: Readonly<Record<string, unknown>>, sessionUpdate = 'tool_call_update'): void => {
    tripwire.hear(sessionId, { sessionUpdate, ...update });
  };
  hear('a', { toolCallId: 't1', kind: 'edit', title: 'File /home/me/x', status: 'pending' }, 'tool_call');
  hear('b', { toolCallId: 't1', kind: 'read', title: 'File y', status: 'pending' }, 'tool_call');
  hear('b', { toolCallId: 't1', status: 'completed' });
  hear('a', { toolCallId: 't2', kind: 'execute', status: 'failed' });
  hear('a', { toolCallId: 't3', kind: 'think', status: 'completed' });
  hear('a', { toolCallId: 't1', status: 'completed' });
  hear('a', { toolCallId: 't4', kind: 'delete', title: 'old.txt', status: 'completed' });
  hear('a', { toolCallId: 't5', kind: 'edit', status: 'completed' }, 'agent_message_chunk');
  expect(breaches).toMatchInlineSnapshot(`
    [
      {
        "kind": "unasked-change",
        "tool": "Edit File ~/x",
      },
      {
        "kind": "unasked-change",
        "tool": "Delete old.txt",
      },
    ]
  `);
});
