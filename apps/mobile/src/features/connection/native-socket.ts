import type { OpenSocket } from './event-stream.ts';

/** React Native's WebSocket, which (unlike a browser's) can send the Bearer token as a header. */
export const openNativeSocket: OpenSocket = (url, token, handlers) => {
  const ws = new WebSocket(url, null, { headers: { authorization: `Bearer ${token}` } });
  ws.onopen = handlers.onOpen;
  ws.onmessage = (event) => {
    if (typeof event.data === 'string') handlers.onMessage(event.data);
  };
  ws.onclose = (event) => {
    handlers.onClose(event.code ?? 1006);
  };
  ws.onerror = () => undefined;
  return {
    send: (text) => {
      ws.send(text);
    },
    close: () => {
      ws.close();
    },
  };
};
