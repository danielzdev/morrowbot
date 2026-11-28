import { expect, it } from 'vitest';
import { bindTools } from './bindings.ts';
import { readEvents } from './sse.ts';

const streamOf = (chunks: readonly string[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start: (controller) => {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });

it('reads one event whose CRLF line endings are split across chunks', async () => {
  const events = [];
  for await (const event of readEvents(streamOf(['data: {"a":\r', '\ndata: 1}\r', '\n\r', '\n']), 1024)) events.push(event);
  expect(events).toMatchInlineSnapshot(`
    [
      {
        "data": "{"a":
    1}",
        "event": "message",
      },
    ]
  `);
});

it('gives every tool its own bound name, even when a shortened name meets one the server chose', () => {
  const tool = (name: string) => ({ name, description: '', inputSchema: { type: 'object' } });
  const long = 'x'.repeat(100);
  const first = bindTools({ id: 'c1', label: 'Notes', labelKey: 'notes' }, [tool(long)])[0]?.boundName ?? '';
  const lookalike = first.slice('notes__'.length);
  const names = bindTools({ id: 'c1', label: 'Notes', labelKey: 'notes' }, [tool(lookalike), tool(long), tool('a.b'), tool('a_b')]).map(({ boundName }) => boundName);
  expect({ unique: new Set(names).size === names.length, longest: Math.max(...names.map((name) => name.length)), dotted: names.slice(2) }).toMatchInlineSnapshot(`
    {
      "dotted": [
        "notes__a_b",
        "notes__a_b_f7e648",
      ],
      "longest": 64,
      "unique": true,
    }
  `);
});
