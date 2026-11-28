import type { AssistantMessage, SubagentRun } from '@morrowbot/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { EventLog } from './event-log.ts';

const message: AssistantMessage = { kind: 'assistant', attachments: [], id: 'm', threadId: 't', text: 'hi', outcome: { kind: 'completed', finishReason: 'stop' }, createdAt: '2026-01-01T00:00:00.000Z' };

const SUBAGENT: SubagentRun = {
  id: 'child',
  parentThreadId: 't',
  parentGenerationId: 'g',
  role: 'Reviewer',
  binding: { kind: 'bound', pluginId: 'echo', selection: { kind: 'default' }, access: 'read-only', vendorSettings: 'isolated' },
  prompt: 'Review',
  status: { kind: 'finished', outcome: { kind: 'cancelled' }, reply: '', finishedAt: '2026-01-01T00:00:30.000Z' },
  createdAt: '2026-01-01T00:00:00.000Z',
};

afterEach(() => {
  vi.useRealTimers();
});

it('drops a finished thread’s events once it is idle, keeping its seq so old cursors resync', () => {
  vi.useFakeTimers();
  const log = new EventLog('epoch', 60_000);
  log.publish({ kind: 'generation.delta', threadId: 't', generationId: 'g', text: 'hi' });
  log.publish({ kind: 'generation.finished', threadId: 't', generationId: 'g', message });
  const fresh = log.replay('t', { hostEpoch: 'epoch', seq: 0 }).kind;
  vi.advanceTimersByTime(60_000);
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

it('keeps trimming an idle thread when a sub-agent it started reports in after its turn finished', () => {
  vi.useFakeTimers();
  const log = new EventLog('epoch', 60_000);
  log.publish({ kind: 'generation.finished', threadId: 't', generationId: 'g', message });
  vi.advanceTimersByTime(30_000);
  log.publish({ kind: 'subagent.changed', threadId: 't', generationId: 'g', run: SUBAGENT });
  vi.advanceTimersByTime(59_999);
  const beforeIdle = log.replay('t', { hostEpoch: 'epoch', seq: 0 }).kind;
  vi.advanceTimersByTime(1);
  expect({ beforeIdle, afterIdle: log.replay('t', { hostEpoch: 'epoch', seq: 0 }).kind }).toMatchInlineSnapshot(`
    {
      "afterIdle": "resync",
      "beforeIdle": "events",
    }
  `);
});
