import { EventServerFrame, type EventClientFrame } from '@morrowbot/contracts';
import WebSocket from 'ws';
import type { HostTarget } from './ipc-proxy.ts';

export interface EventStream {
  /** Sends a subscribe or unsubscribe frame, once the socket is open. */
  send(frame: EventClientFrame): void;
  close(): void;
}

export interface EventStreamHandlers {
  readonly onEvent: (frame: EventServerFrame) => void;
  readonly report: (error: unknown) => void;
  readonly onOpen?: () => void;
  /** The socket closed without `close()`, e.g. the host dropped it. */
  readonly onLost?: () => void;
}

/** One WebSocket to the host's `/api/events`, authenticated with the Bearer token and sent without an Origin. */
export function openEventStream(target: HostTarget, handlers: EventStreamHandlers): EventStream {
  const { onEvent, report } = handlers;
  const url = new URL('/api/events', target.url);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url, { headers: { authorization: `Bearer ${target.token}` } });
  const pending: EventClientFrame[] = [];
  let closing = false;
  socket.on('open', () => {
    for (const frame of pending.splice(0)) socket.send(JSON.stringify(frame));
    handlers.onOpen?.();
  });
  socket.on('close', () => {
    if (!closing) handlers.onLost?.();
  });
  socket.on('message', (data: WebSocket.RawData) => {
    const parsed = EventServerFrame.safeParse(parseJson(textOf(data)));
    if (parsed.success) onEvent(parsed.data);
    else report(new Error(`Ignored a malformed host event: ${parsed.error.message}`));
  });
  socket.on('error', report);
  return {
    send: (frame) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
      else if (socket.readyState === WebSocket.CONNECTING) pending.push(frame);
    },
    close: () => {
      closing = true;
      socket.terminate();
    },
  };
}

function textOf(data: WebSocket.RawData): string {
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
