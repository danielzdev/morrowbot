import {
  ClaimPairingRequest,
  type ClaimPairingResponse,
  CreatePairingCodeRequest,
  type PairedDeviceList,
  type PairingCodeResponse,
  pairingUri,
} from '@morrowbot/contracts';
import type { ApiPairing } from './ports.ts';
import { failure, json, noContent, notFound } from './reply.ts';
import { parseBody, type Route } from './route.ts';

export interface PairingRouteOptions {
  readonly pairing: ApiPairing;
  readonly hostName: string;
  readonly hostVersion: string;
  /** The listen URL when the host is bound to one LAN or Tailscale address; undefined for loopback or every interface. */
  readonly remoteUrl: () => string | undefined;
  readonly closeDeviceSockets: (deviceId: string) => void;
}

export function pairingRoutes(options: PairingRouteOptions): Route[] {
  const { pairing } = options;
  return [
    {
      method: 'POST',
      path: '/api/pairing/codes',
      access: 'host',
      handle: async (context) => {
        const request = await parseBody(context, CreatePairingCodeRequest);
        if (request.kind === 'rejected') return request.reply;
        const url = request.value.url ?? options.remoteUrl();
        if (url === undefined) {
          return failure('conflict', 'Set MORROWBOT_HOST_BIND to a LAN or Tailscale address, or send the url devices should use');
        }
        const { code, expiresAt } = pairing.createCode();
        const body: PairingCodeResponse = { code, expiresAt, url, pairingUri: pairingUri(url, code) };
        return json(201, body);
      },
    },
    {
      method: 'POST',
      path: '/api/pairing/claim',
      access: 'public',
      handle: async (context) => {
        const request = await parseBody(context, ClaimPairingRequest);
        if (request.kind === 'rejected') return request.reply;
        const result = pairing.claim(request.value);
        switch (result.kind) {
          case 'rate-limited':
            return failure('forbidden', 'Too many wrong codes. Wait a minute, then pair with a new code.', 429);
          case 'wrong-code':
            return failure('unauthorized', 'Wrong or expired pairing code');
          case 'claimed': {
            const body: ClaimPairingResponse = {
              deviceId: result.deviceId,
              token: result.token,
              hostName: options.hostName,
              hostVersion: options.hostVersion,
            };
            return json(201, body);
          }
        }
      },
    },
    {
      method: 'GET',
      path: '/api/pairing/devices',
      access: 'host',
      handle: () => {
        const body: PairedDeviceList = { devices: pairing.list() };
        return json(200, body);
      },
    },
    {
      method: 'DELETE',
      path: '/api/pairing/devices/:id',
      access: 'host',
      handle: ({ params }) => {
        const deviceId = params.get('id');
        if (!pairing.revoke(deviceId)) return notFound('Device');
        options.closeDeviceSockets(deviceId);
        return noContent();
      },
    },
  ];
}
