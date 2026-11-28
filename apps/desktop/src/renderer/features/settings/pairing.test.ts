import type { PairedDevice, PairingCodeResponse } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import type { ApiResult } from '../../shared/api.ts';
import { activeDevices, afterMint, countdown, deviceDetail, newlyPaired } from './pairing.ts';

const NOW = Date.parse('2026-11-27T12:00:00.000Z');
const CODE: PairingCodeResponse = {
  code: '042137',
  expiresAt: '2026-11-27T12:05:00.000Z',
  url: 'http://100.64.0.1:47800',
  pairingUri: 'morrowbot://pair?url=http%3A%2F%2F100.64.0.1%3A47800&code=042137',
};
const refused = (status: number, kind: 'conflict' | 'invalid_request' | 'internal', message: string): ApiResult<PairingCodeResponse> => ({ kind: 'failed', status, error: { kind, message } });

const device = (id: string, name: string, platform: PairedDevice['platform'], lastSeenAt: string, revokedAt: string | null = null): PairedDevice => ({
  deviceId: id,
  deviceName: name,
  platform,
  createdAt: '2026-11-01T09:00:00.000Z',
  lastSeenAt,
  revokedAt,
});

it('shows a minted code, asks for the address when the host has none, and reports other failures', () => {
  const known = new Set(['a']);
  expect({
    minted: afterMint({ kind: 'ok', value: CODE }, false, known).kind,
    noAddress: afterMint(refused(409, 'conflict', 'Set MORROWBOT_HOST_BIND…'), false, known),
    badTypedAddress: afterMint(refused(400, 'invalid_request', 'Invalid url'), true, known),
    hostDown: afterMint(refused(0, 'internal', 'The request did not reach the host'), false, known),
  }).toMatchInlineSnapshot(`
    {
      "badTypedAddress": {
        "error": "Use an address such as http://100.64.0.1:47800: the scheme, host and port only.",
        "kind": "needs-url",
      },
      "hostDown": {
        "kind": "failed",
        "message": "The request did not reach the host",
      },
      "minted": "showing",
      "noAddress": {
        "error": null,
        "kind": "needs-url",
      },
    }
  `);
});

it('counts a code down to its expiry', () => {
  expect([0, 1_000, 59_500, 240_001, 299_000, 300_000, 400_000].map((ms) => countdown(CODE.expiresAt, NOW + ms))).toEqual(['5:00', '4:59', '4:01', '1:00', '0:01', null, null]);
});

it('lists active devices newest first, notices one paired after the code, and says when each was last seen', () => {
  const list = {
    devices: [
      device('a', 'Work iPhone', 'ios', '2026-11-27T11:59:30.000Z'),
      device('b', 'Old Pixel', 'android', '2026-10-01T08:00:00.000Z', '2026-10-02T08:00:00.000Z'),
      device('c', 'Studio Mac', 'macos', '2026-11-24T10:00:00.000Z'),
    ],
  };
  const active = activeDevices(list);
  expect({
    shown: active.map((each) => `${each.deviceName}: ${deviceDetail(each, NOW)}`),
    added: newlyPaired(active, new Set(['a']))?.deviceName,
    noneAdded: newlyPaired(active, new Set(['a', 'c'])),
  }).toMatchInlineSnapshot(`
    {
      "added": "Studio Mac",
      "noneAdded": undefined,
      "shown": [
        "Studio Mac: macOS · Last seen 3d ago",
        "Work iPhone: iOS · Last seen just now",
      ],
    }
  `);
});
