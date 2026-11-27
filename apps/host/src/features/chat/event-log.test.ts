import type { AssistantMessage } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { EventLog } from './event-log.ts';

const message: AssistantMessage = { kind: 'assistant', id: 'm', threadId: 't', text: 'hi', outcome: { kind: 'completed', finishReason: 'stop' }, createdAt: '2026-01-01T00:00:00.000Z' };

it('drops a finished thread’s events once it is idle, keeping its seq so old cursors resync', async () => {
  const log = new EventLog('epoch', 20);
  log.publish({ kind: 'generation.delta', threadId: 't', generationId: 'g', text: 'hi' });
  log.publish({ kind: 'generation.finished', threadId: 't', generationId: 'g', message });
  const fresh = log.replay('t', { hostEpoch: 'epoch', seq: 0 }).kind;
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect({
    fresh,
    stale: log.replay('t', { hostEpoch: 'epoch', seq: 0 }).kind,
    current: log.replay('t', log.cursor('t')),
    cursor: log.cursor('t'),
  }).toMatchInlineSnapshot(`
    {
      "current": {
        "events": [],
        "kind": "events",
      },
      "cursor": {
        "hostEpoch": "epoch",
        "seq": 2,
      },
      "fresh": "events",
      "stale": "resync",
    }
  `);
});
