import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { ApiPairing } from './ports.ts';
import { failure, type Reply } from './reply.ts';

/** Who sent a request: the desktop app (this launch's token), a paired device, or nobody known. */
export type Caller = { readonly kind: 'host' } | { readonly kind: 'device'; readonly deviceId: string } | { readonly kind: 'anonymous' };

export interface Listener {
  readonly hostname: string;
  readonly port: number;
}

export function isLoopback(hostname: string): boolean {
  return hostname.startsWith('127.') || hostname === '::1';
}

export function isWildcard(hostname: string): boolean {
  return hostname === '0.0.0.0' || hostname === '::';
}

/** `hostname:port` as it appears in a URL or a Host header. */
export function authority({ hostname, port }: Listener): string {
  return `${hostname.includes(':') ? `[${hostname}]` : hostname}:${String(port)}`;
}

/**
 * Blocks DNS rebinding on a loopback listener (wrong Host) and cross-site browser pages (an Origin other than the Host).
 * A native client sends no Origin, or (like a WebSocket library that adds one) exactly the host's own origin.
 * A LAN or Tailscale listener takes any Host, so a rebound page passes here; it still needs a token for every
 * route, and the public claim refuses any Origin.
 */
export function screen(request: IncomingMessage, listener: Listener): Reply | undefined {
  const host = request.headers.host?.toLowerCase() ?? '';
  const loopbackHosts = new Set([authority(listener), `127.0.0.1:${String(listener.port)}`, `localhost:${String(listener.port)}`]);
  if (host === '' || (isLoopback(listener.hostname) && !loopbackHosts.has(host))) return failure('forbidden', 'Unexpected Host header');
  const origin = request.headers.origin?.toLowerCase();
  if (origin !== undefined && origin !== `http://${host}` && origin !== `https://${host}`) {
    return failure('forbidden', 'Browser origins may not use the host API');
  }
  return undefined;
}

export function identify(request: IncomingMessage, token: string, pairing: ApiPairing): Caller {
  const header = request.headers.authorization ?? '';
  if (sameSecret(header, `Bearer ${token}`)) return { kind: 'host' };
  const given = /^Bearer ([\w-]+)$/.exec(header)?.[1];
  const deviceId = given === undefined ? undefined : pairing.authenticate(given);
  return deviceId === undefined ? { kind: 'anonymous' } : { kind: 'device', deviceId };
}

/** Whether `caller` may use a route with this access. */
export function admit(access: 'public' | 'host' | 'token', caller: Caller): Reply | undefined {
  if (access === 'public') return undefined;
  if (caller.kind === 'anonymous') return failure('unauthorized', 'Missing or wrong token');
  if (access === 'host' && caller.kind !== 'host') return failure('forbidden', 'Only the desktop app may manage pairing');
  return undefined;
}

function sameSecret(given: string, expected: string): boolean {
  const digest = (text: string): Buffer => createHash('sha256').update(text, 'utf8').digest();
  return timingSafeEqual(digest(given), digest(expected));
}
