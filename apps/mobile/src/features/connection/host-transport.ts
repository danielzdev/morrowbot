import { z } from 'zod';
import type { HostRequest, HostResult, HostTransport, LinkStatus, UiCapability } from '../../lib/host-connection.ts';
import { openEventStream, type OpenSocket } from './event-stream.ts';
import { sendRequest, type HttpFetch } from './host-http.ts';
import type { HostProfile } from './saved-hosts.ts';
import { createThreadSync } from './thread-sync.ts';

export interface TransportDeps {
  readonly fetch: HttpFetch;
  readonly openSocket: OpenSocket;
  readonly delayFor: (attempt: number) => number;
  readonly now: () => number;
  readonly report: (problem: string) => void;
}

export interface LiveTransport {
  readonly transport: HostTransport;
  /** Closes the socket while the app is in the background; watched threads turn stale. */
  readonly pause: () => void;
  /** Connects now: after a pause, or instead of waiting out the backoff. */
  readonly wake: () => void;
  readonly close: () => void;
}

export interface TransportState {
  readonly status: LinkStatus;
  readonly ui: UiCapability;
}

const UI_CAPABILITIES_PATH = '/api/ui/v1/capabilities';

/**
 * The direct HTTP + WebSocket transport to one paired host. It connects at once. A 401 on any
 * request, or the host closing the socket as unpaired, stops it for good with status `revoked`.
 */
export function connectHost(profile: HostProfile, deps: TransportDeps, onChange: (state: TransportState) => void): LiveTransport {
  let state: TransportState = { status: { kind: 'connecting', attempt: 0 }, ui: { kind: 'unknown' } };
  let closed = false;
  const update = (next: Partial<TransportState>): void => {
    if (closed) return;
    state = { ...state, ...next };
    onChange(state);
  };
  let probing = false;
  const probeUi = async (): Promise<void> => {
    if (probing || state.ui.kind !== 'unknown') return;
    probing = true;
    const reply = await request({ method: 'GET', path: UI_CAPABILITIES_PATH, reply: z.unknown() });
    probing = false;
    if (reply.kind === 'ok') update({ ui: { kind: 'available' } });
    else if (reply.kind === 'failed' && reply.status === 404) update({ ui: { kind: 'unavailable' } });
  };

  const stream = openEventStream({
    url: profile.url,
    token: profile.token,
    openSocket: deps.openSocket,
    delayFor: deps.delayFor,
    now: deps.now,
    report: deps.report,
    onStatus: (status) => {
      update({ status });
      threads.linkChanged(status);
      if (status.kind === 'online') void probeUi();
    },
  });

  const request = async <T>(input: HostRequest<T>): Promise<HostResult<T>> => {
    const reply = await sendRequest({ url: profile.url, token: profile.token, fetch: deps.fetch, ui: () => state.ui }, input);
    if (reply.kind === 'unauthorized') stream.revoke();
    return reply;
  };
  const threads = createThreadSync({ stream, request, delayFor: deps.delayFor, report: deps.report });
  stream.wake();

  return {
    transport: {
      host: { deviceId: profile.deviceId, hostName: profile.hostName, url: profile.url },
      request,
      listen: (listener) =>
        stream.listen((frame) => {
          if (frame.kind !== 'resync' && !('cursor' in frame)) listener(frame);
        }),
      watchThread: threads.watchThread,
    },
    pause: stream.pause,
    wake: stream.wake,
    close: () => {
      closed = true;
      threads.close();
      stream.close();
    },
  };
}
