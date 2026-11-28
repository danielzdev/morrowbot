import { ClaimPairingResponse, HealthResponse, type ClaimPairingRequest } from '@morrowbot/contracts';
import type { HostReachability, PairOutcome } from '../../lib/host-connection.ts';
import type { PairingTarget } from '../../lib/pairing-link.ts';
import { sendRequest, type HttpFetch } from './host-http.ts';
import type { HostProfile } from './saved-hosts.ts';

export type ClaimResult = { readonly kind: 'claimed'; readonly profile: HostProfile } | Exclude<PairOutcome, { readonly kind: 'paired' }>;

/** Trades a pairing code for this device's long-lived token. Nothing is saved here. */
export async function claimPairing(fetch: HttpFetch, target: PairingTarget, deviceName: string): Promise<ClaimResult> {
  const body: ClaimPairingRequest = { code: target.code, deviceName, platform: 'ios' };
  const reply = await sendRequest(
    { url: target.url, token: null, fetch, ui: () => ({ kind: 'unavailable' }) },
    { method: 'POST', path: '/api/pairing/claim', reply: ClaimPairingResponse, body },
  );
  switch (reply.kind) {
    case 'ok': {
      const { deviceId, token, hostName } = reply.value;
      return { kind: 'claimed', profile: { deviceId, token, hostName, url: target.url } };
    }
    case 'unauthorized':
      return { kind: 'wrong-code' };
    case 'unreachable':
      return { kind: 'unreachable', message: reply.message };
    case 'failed':
      return reply.status === 429 ? { kind: 'rate-limited' } : { kind: 'failed', message: reply.error.message };
    case 'malformed':
      return { kind: 'failed', message: 'This host is not an Ori Kami host, or is a version this app cannot read.' };
    case 'unsupported':
      return { kind: 'failed', message: 'This host cannot pair devices.' };
  }
}

/** Whether a saved host answers with this device's token, without opening its event stream. */
export async function probeHost(fetch: HttpFetch, profile: HostProfile): Promise<HostReachability> {
  const reply = await sendRequest(
    { url: profile.url, token: profile.token, fetch, ui: () => ({ kind: 'unknown' }) },
    { method: 'GET', path: '/health', reply: HealthResponse },
  );
  switch (reply.kind) {
    case 'ok':
      return { kind: 'online' };
    case 'unauthorized':
      return { kind: 'revoked' };
    case 'unreachable':
    case 'failed':
    case 'malformed':
    case 'unsupported':
      return { kind: 'offline' };
  }
}
