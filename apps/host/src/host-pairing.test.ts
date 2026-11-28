import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ClaimPairingResponse, PairedDeviceList, PairingCodeResponse } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startTestHost, type Sequence, type TestHost } from './testing/test-host.ts';

const URL_FOR_DEVICES = 'http://100.64.0.1:47800';

let dataDir: string;
let host: TestHost;
let nowMs: number;
let clock: Sequence;
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'orikami-pairing-'));
  nowMs = Date.UTC(2026, 0, 1);
  let id = 0;
  clock = { newId: () => `id-${String(++id)}`, now: () => new Date(nowMs).toISOString() };
  host = await startTestHost({ dataDir, sequence: clock });
});
afterEach(async () => {
  await host.close();
  await rm(dataDir, { recursive: true, force: true });
});

/** A request as a paired device (or anyone) sends it: its own token, or none. */
async function as(token: string | undefined, method: string, route: string, body?: unknown) {
  const headers: Record<string, string> = token === undefined ? {} : { authorization: `Bearer ${token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${host.url}${route}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  const parsed: unknown = text === '' ? null : JSON.parse(text);
  return { status: response.status, body: parsed };
}

async function newCode(): Promise<string> {
  return PairingCodeResponse.parse((await host.call('POST', '/api/pairing/codes', { url: URL_FOR_DEVICES })).body).code;
}

async function pair(deviceName: string): Promise<ClaimPairingResponse> {
  const code = await newCode();
  return ClaimPairingResponse.parse((await as(undefined, 'POST', '/api/pairing/claim', { code, deviceName, platform: 'ios' })).body);
}

function openSocket(token: string): Promise<WebSocket> {
  const ws = new WebSocket(`${host.url.replace('http:', 'ws:')}/api/events`, { headers: { authorization: `Bearer ${token}` } });
  return new Promise((resolve, reject) => {
    ws.once('open', () => {
      resolve(ws);
    });
    ws.once('unexpected-response', (_request, response) => {
      reject(new Error(`refused ${String(response.statusCode)}`));
    });
  });
}

it('pairs a device whose token works over HTTP and /api/events, survives a restart, and stops at once when revoked', async () => {
  const minted = await host.call('POST', '/api/pairing/codes', { url: URL_FOR_DEVICES });
  const mintedBody = PairingCodeResponse.parse(minted.body);
  const { code } = mintedBody;
  const claimed = await as(undefined, 'POST', '/api/pairing/claim', { code, deviceName: '  Pocket Phone ', platform: 'ios' });
  const device = ClaimPairingResponse.parse(claimed.body);
  const other = await pair('Spare Tablet');
  nowMs += 60_000;
  const agentsByDevice = (await as(device.token, 'GET', '/api/agents')).status;
  await host.close();
  host = await startTestHost({ dataDir, sequence: clock });
  const afterRestart = (await as(device.token, 'GET', '/api/agents')).status;
  const devicesAfterRestart = (await host.call('GET', '/api/pairing/devices')).body;

  const reconnected = await openSocket(device.token);
  const closed = new Promise<string>((resolve) => {
    reconnected.once('close', (closeCode, reason) => {
      resolve(`${String(closeCode)} ${reason.toString('utf8')}`);
    });
  });
  const otherReconnected = await openSocket(other.token);
  nowMs += 60_000;
  const revoked = (await host.call('DELETE', `/api/pairing/devices/${device.deviceId}`)).status;
  expect({
    minted: { status: minted.status, body: { ...mintedBody, code: '<code>', pairingUri: mintedBody.pairingUri.replace(code, '<code>') } },
    claimed: { status: claimed.status, body: { ...device, token: `<${String(device.token.length)} chars>` } },
    agentsByDevice,
    afterRestart,
    devicesAfterRestart,
    socketClosedOnRevoke: await closed,
    otherSocketStillOpen: otherReconnected.readyState === WebSocket.OPEN,
    revoked,
    revokedAgain: (await host.call('DELETE', `/api/pairing/devices/${device.deviceId}`)).status,
    revokeUnknown: (await host.call('DELETE', '/api/pairing/devices/no-such-device')).status,
    revokedHttp: await as(device.token, 'GET', '/api/agents'),
    revokedSocket: await openSocket(device.token).then(
      () => 'open',
      (error: unknown) => String(error),
    ),
    otherStillWorks: (await as(other.token, 'GET', '/api/agents')).status,
    devicesAfterRevoke: (await host.call('GET', '/api/pairing/devices')).body,
  }).toMatchInlineSnapshot(`
    {
      "afterRestart": 200,
      "agentsByDevice": 200,
      "claimed": {
        "body": {
          "deviceId": "id-1",
          "hostName": "Studio Host",
          "hostVersion": "0.0.0-test",
          "token": "<43 chars>",
        },
        "status": 201,
      },
      "devicesAfterRestart": {
        "devices": [
          {
            "createdAt": "2026-01-01T00:00:00.000Z",
            "deviceId": "id-1",
            "deviceName": "Pocket Phone",
            "lastSeenAt": "2026-01-01T00:01:00.000Z",
            "platform": "ios",
            "revokedAt": null,
          },
          {
            "createdAt": "2026-01-01T00:00:00.000Z",
            "deviceId": "id-2",
            "deviceName": "Spare Tablet",
            "lastSeenAt": "2026-01-01T00:00:00.000Z",
            "platform": "ios",
            "revokedAt": null,
          },
        ],
      },
      "devicesAfterRevoke": {
        "devices": [
          {
            "createdAt": "2026-01-01T00:00:00.000Z",
            "deviceId": "id-1",
            "deviceName": "Pocket Phone",
            "lastSeenAt": "2026-01-01T00:01:00.000Z",
            "platform": "ios",
            "revokedAt": "2026-01-01T00:02:00.000Z",
          },
          {
            "createdAt": "2026-01-01T00:00:00.000Z",
            "deviceId": "id-2",
            "deviceName": "Spare Tablet",
            "lastSeenAt": "2026-01-01T00:02:00.000Z",
            "platform": "ios",
            "revokedAt": null,
          },
        ],
      },
      "minted": {
        "body": {
          "code": "<code>",
          "expiresAt": "2026-01-01T00:05:00.000Z",
          "pairingUri": "orikami://pair?url=http%3A%2F%2F100.64.0.1%3A47800&code=<code>",
          "url": "http://100.64.0.1:47800",
        },
        "status": 201,
      },
      "otherSocketStillOpen": true,
      "otherStillWorks": 200,
      "revokeUnknown": 404,
      "revoked": 204,
      "revokedAgain": 204,
      "revokedHttp": {
        "body": {
          "error": {
            "kind": "unauthorized",
            "message": "Missing or wrong token",
          },
        },
        "status": 401,
      },
      "revokedSocket": "Error: refused 401",
      "socketClosedOnRevoke": "1008 This device was unpaired",
    }
  `);
  otherReconnected.close();
});

it('keeps codes short-lived and single-use, pauses a source after five wrong codes, and cancels a code after twenty', async () => {
  const claim = async (code: string) => (await as(undefined, 'POST', '/api/pairing/claim', { code, deviceName: 'Pocket Phone', platform: 'ios' })).status;
  const wrong = (code: string) => (code === '000000' ? '000001' : '000000');
  const burst = async (code: string, count: number) => {
    const statuses = [];
    for (let attempt = 0; attempt < count; attempt++) statuses.push(await claim(code));
    return statuses;
  };

  const used = await newCode();
  const first = await claim(used);
  const reused = await claim(used);
  const raced = await newCode();
  const together = (await Promise.all([claim(raced), claim(raced)])).sort();
  const devicesAfterRace = PairedDeviceList.parse((await host.call('GET', '/api/pairing/devices')).body).devices.length;
  const whileNoCodeIsOpen = await burst('000000', 6);

  const expiring = await newCode();
  nowMs += 5 * 60_000;
  const expired = await claim(expiring);

  const replaced = await newCode();
  await newCode();
  const replacedByNewer = await claim(replaced);
  nowMs += 60_000;

  const guessed = await newCode();
  const guesses = await burst(wrong(guessed), 5);
  const rightCodeWhilePaused = await claim(guessed);
  nowMs += 60_000;
  const rightCodeAfterPause = await claim(guessed);

  const capped = await newCode();
  const rounds = [];
  for (let round = 0; round < 4; round++) {
    rounds.push(await burst(wrong(capped), 5));
    nowMs += 60_000;
  }
  const rightCodeAfterTwentyGuesses = await claim(capped);

  expect({
    first,
    reused,
    together,
    devicesAfterRace,
    whileNoCodeIsOpen,
    expired,
    replacedByNewer,
    guesses,
    rightCodeWhilePaused,
    rightCodeAfterPause,
    rounds,
    rightCodeAfterTwentyGuesses,
  }).toMatchInlineSnapshot(`
    {
      "devicesAfterRace": 2,
      "expired": 401,
      "first": 201,
      "guesses": [
        401,
        401,
        401,
        401,
        401,
      ],
      "replacedByNewer": 401,
      "reused": 401,
      "rightCodeAfterPause": 201,
      "rightCodeAfterTwentyGuesses": 401,
      "rightCodeWhilePaused": 429,
      "rounds": [
        [
          401,
          401,
          401,
          401,
          401,
        ],
        [
          401,
          401,
          401,
          401,
          401,
        ],
        [
          401,
          401,
          401,
          401,
          401,
        ],
        [
          401,
          401,
          401,
          401,
          401,
        ],
      ],
      "together": [
        201,
        401,
      ],
      "whileNoCodeIsOpen": [
        401,
        401,
        401,
        401,
        401,
        401,
      ],
    }
  `);
});

it('lets only the desktop token mint codes and manage devices, and needs a url to reach on a loopback host', async () => {
  const device = await pair('Pocket Phone');
  expect({
    mintByDevice: (await as(device.token, 'POST', '/api/pairing/codes', {})).status,
    listByDevice: (await as(device.token, 'GET', '/api/pairing/devices')).status,
    revokeByDevice: (await as(device.token, 'DELETE', `/api/pairing/devices/${device.deviceId}`)).status,
    mintByNobody: (await as(undefined, 'POST', '/api/pairing/codes', {})).status,
    listByNobody: (await as(undefined, 'GET', '/api/pairing/devices')).status,
    claimFromBrowserPage: (
      await fetch(`${host.url}/api/pairing/claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: host.url },
        body: JSON.stringify({ code: await newCode(), deviceName: 'Pocket Phone', platform: 'ios' }),
      })
    ).status,
    claimTooLarge: (await as(undefined, 'POST', '/api/pairing/claim', { code: '000000', deviceName: 'x'.repeat(5000), platform: 'ios' })).status,
    claimWithBadBody: await as(undefined, 'POST', '/api/pairing/claim', { code: '12345', deviceName: '', platform: 'toaster' }),
    mintWithoutUrl: await host.call('POST', '/api/pairing/codes', {}),
    mintWithPathUrl: await host.call('POST', '/api/pairing/codes', { url: `${URL_FOR_DEVICES}/api` }),
  }).toMatchInlineSnapshot(`
    {
      "claimFromBrowserPage": 403,
      "claimTooLarge": 413,
      "claimWithBadBody": {
        "body": {
          "error": {
            "kind": "invalid_request",
            "message": "code: Expected a 6-digit code; deviceName: Too small: expected string to have >=1 characters; platform: Invalid option: expected one of "ios"|"android"|"macos"|"windows"|"linux"",
          },
        },
        "status": 400,
      },
      "listByDevice": 403,
      "listByNobody": 401,
      "mintByDevice": 403,
      "mintByNobody": 401,
      "mintWithPathUrl": {
        "body": {
          "error": {
            "kind": "invalid_request",
            "message": "url: Use only the scheme, host and port",
          },
        },
        "status": 400,
      },
      "mintWithoutUrl": {
        "body": {
          "error": {
            "kind": "conflict",
            "message": "Set ORIKAMI_HOST_BIND to a LAN or Tailscale address, or send the url devices should use",
          },
        },
        "status": 409,
      },
      "revokeByDevice": 403,
    }
  `);
});
