import { McpFailure } from './channel.ts';

export interface SseEvent {
  readonly event: string;
  readonly data: string;
}

/** Reads a `text/event-stream` body (https://html.spec.whatwg.org/multipage/server-sent-events.html) into its events, up to `limit` bytes. */
export async function* readEvents(body: ReadableStream<Uint8Array>, limit: number): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buffer = '';
  let size = 0;
  let event = '';
  let data: string[] = [];
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > limit) throw new McpFailure('protocol', 'The server sent more than this host reads');
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r\n|\r|\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line === '') {
        if (data.length > 0) yield { event: event === '' ? 'message' : event, data: data.join('\n') };
        event = '';
        data = [];
        continue;
      }
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
  }
  if (data.length > 0) yield { event: event === '' ? 'message' : event, data: data.join('\n') };
}
