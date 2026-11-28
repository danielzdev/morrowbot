import type { EventServerFrame } from '@morrowbot/contracts';
import { afterEach, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { openEventStream } from './event-stream.ts';
import { parseSubscription } from './ipc-proxy.ts';

const NOW = '2026-11-27T12:00:00.000Z';
const RENDERER_URL = 'file:///Applications/Ori Kami.app/Contents/Resources/app/src/renderer/index.html';

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

it('strips unknown fields from newer host event frames and skips unknown event kinds without dropping the stream', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => server.once('listening', resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  );

  server.on('connection', (ws) => {
    ws.send(JSON.stringify({ kind: 'surface.updated', threadId: 't1' }));
    ws.send('not json');
    ws.send(
      JSON.stringify({
        kind: 'generation.finished',
        threadId: 't1',
        generationId: 'g1',
        cursor: { hostEpoch: 'e1', seq: 2, shard: 0 },
        message: {
          kind: 'assistant',
          id: 'm2',
          threadId: 't1',
          text: 'ready',
          createdAt: NOW,
          outcome: { kind: 'completed', finishReason: 'stop', latencyMs: 12 },
          attachments: [{ kind: 'image', id: 'att-1', name: 'out.png', mimeType: 'image/png', size: 256, previewWidth: 640 }],
          citations: ['doc-1'],
        },
        toolSteps: [{ toolUseId: 'u1', name: 'Read' }],
      }),
    );
    ws.send(
      JSON.stringify({
        kind: 'thread.changed',
        summary: {
          thread: { id: 't1', agentId: 'a1', title: 'Main', createdAt: NOW, updatedAt: NOW, archivedAt: null, pinned: true },
          activity: { kind: 'idle', since: NOW },
          lastMessage: null,
        },
        addedLater: true,
      }),
    );
  });

  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('event server is not on TCP');
  const frames: EventServerFrame[] = [];
  const errors: string[] = [];
  let onDone: (() => void) | undefined;
  let onFail: ((error: Error) => void) | undefined;
  const delivered = new Promise<void>((resolve, reject) => {
    onDone = resolve;
    onFail = reject;
  });
  const stream = openEventStream(
    { url: `http://127.0.0.1:${String(address.port)}`, token: 't'.repeat(43) },
    {
      onEvent: (frame) => {
        frames.push(frame);
        if (frames.length === 2) onDone?.();
      },
      report: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(message);
        if (errors.length > 2) onFail?.(new Error(`Unexpected event stream error: ${message}`));
      },
    },
  );
  cleanup.push(() => {
    stream.close();
  });

  await delivered;

  expect({
    frames,
    reportedCount: errors.length,
    reportedMalformed: errors.every((message) => message.startsWith('Ignored a malformed host event:')),
  }).toEqual({
    frames: [
      {
        kind: 'generation.finished',
        threadId: 't1',
        generationId: 'g1',
        cursor: { hostEpoch: 'e1', seq: 2 },
        message: {
          kind: 'assistant',
          id: 'm2',
          threadId: 't1',
          text: 'ready',
          createdAt: NOW,
          outcome: { kind: 'completed', finishReason: 'stop' },
          attachments: [{ kind: 'image', id: 'att-1', name: 'out.png', mimeType: 'image/png', size: 256 }],
        },
      },
      {
        kind: 'thread.changed',
        summary: {
          thread: { id: 't1', agentId: 'a1', title: 'Main', createdAt: NOW, updatedAt: NOW, archivedAt: null },
          activity: { kind: 'idle' },
          lastMessage: null,
        },
      },
    ],
    reportedCount: 2,
    reportedMalformed: true,
  });
});

it('keeps outgoing subscription frames strict', () => {
  expect(() =>
    parseSubscription({
      sender: { kind: 'frame', url: RENDERER_URL, isMainFrame: true },
      rendererUrl: RENDERER_URL,
      input: { kind: 'subscribe', threadId: 't1', since: null, extra: true },
    }),
  ).toThrow('Malformed subscription');
});
