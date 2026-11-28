import { EventClientFrame, type EventServerFrame } from '@morrowbot/contracts';
import type { RawData, WebSocket } from 'ws';
import { sees, type Viewer } from './access.ts';
import type { ApiServices } from './ports.ts';

/**
 * One `/api/events` socket. Global events go out to the owner; a scoped member gets only agent messages to or from
 * its agents. A thread's events go out only after `subscribe`, which a scoped member may send only for its agents'
 * threads. A subscribe with a cursor first replays what was missed (or sends `resync`), in the same synchronous step
 * that starts live delivery, so nothing is missed or sent twice.
 */
export function serveEvents(ws: WebSocket, services: ApiServices, viewer: Viewer, report: (error: unknown) => void): void {
  const { chat } = services;
  const threads = new Set<string>();
  const sendFrame = (frame: EventServerFrame): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
  };
  const unsubscribe = chat.subscribe((event) => {
    if (event.kind === 'usage.updated' ? viewer.kind === 'owner' : threads.has(event.threadId)) sendFrame(event);
  });
  const unsubscribeMessages = services.agentMessages.subscribe((message) => {
    if (sees(viewer, message.from.agentId) || sees(viewer, message.to.agentId)) sendFrame({ kind: 'agent-message.posted', message });
  });
  ws.on('message', (data, isBinary) => {
    if (ws.readyState !== ws.OPEN) return;
    const frame = isBinary ? undefined : EventClientFrame.safeParse(parseJson(textOf(data)));
    if (frame?.success !== true) {
      ws.close(1008, 'Expected a subscribe or unsubscribe frame');
      return;
    }
    const { threadId } = frame.data;
    switch (frame.data.kind) {
      case 'unsubscribe':
        threads.delete(threadId);
        return;
      case 'subscribe': {
        const agentId = chat.getThread(threadId)?.agentId;
        if (viewer.kind === 'scoped' && (agentId === undefined || !sees(viewer, agentId))) {
          sendFrame({ kind: 'resync', threadId });
          return;
        }
        if (frame.data.since === null) {
          threads.add(threadId);
          return;
        }
        const replay = chat.replay(threadId, frame.data.since);
        switch (replay.kind) {
          case 'resync':
            threads.delete(threadId);
            sendFrame({ kind: 'resync', threadId });
            return;
          case 'events':
            for (const event of replay.events) sendFrame(event);
            threads.add(threadId);
            return;
        }
      }
    }
  });
  ws.on('close', () => {
    unsubscribe();
    unsubscribeMessages();
  });
  ws.on('error', report);
}

function textOf(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

function parseJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}
