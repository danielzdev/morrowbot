import { IncomingMessage, type IncomingHttpHeaders } from 'node:http';
import { Socket } from 'node:net';
import { expect, it } from 'vitest';
import { screen, type Listener } from './guard.ts';

function verdict(listener: Listener, headers: IncomingHttpHeaders): number | 'ok' {
  const request = new IncomingMessage(new Socket());
  request.headers = headers;
  return screen(request, listener)?.status ?? 'ok';
}

it('takes any Host on a LAN or Tailscale listener but still refuses foreign browser origins', () => {
  const tailnet: Listener = { hostname: '100.64.0.1', port: 47800 };
  const loopback: Listener = { hostname: '127.0.0.1', port: 47800 };
  expect({
    tailnetIp: verdict(tailnet, { host: '100.64.0.1:47800' }),
    tailnetName: verdict(tailnet, { host: 'studio-host.tailnet.example:47800' }),
    noHost: verdict(tailnet, {}),
    foreignOrigin: verdict(tailnet, { host: '100.64.0.1:47800', origin: 'https://evil.example' }),
    sameOrigin: verdict(tailnet, { host: '100.64.0.1:47800', origin: 'http://100.64.0.1:47800' }),
    loopbackTailnetName: verdict(loopback, { host: 'studio-host.tailnet.example:47800' }),
    loopbackSameOrigin: verdict(loopback, { host: '127.0.0.1:47800', origin: 'http://127.0.0.1:47800' }),
    loopbackOtherPort: verdict(loopback, { host: '127.0.0.1:47800', origin: 'http://127.0.0.1:3000' }),
    ipv6Loopback: verdict({ hostname: '::1', port: 47800 }, { host: '[::1]:47800' }),
    loopbackDefaultPort: verdict({ hostname: '127.0.0.1', port: 80 }, { host: '127.0.0.1' }),
    tailnetHttpsDefaultPort: verdict(tailnet, { host: 'studio-host.tailnet.example:443', origin: 'https://studio-host.tailnet.example' }),
    nullOrigin: verdict(tailnet, { host: '100.64.0.1:47800', origin: 'null' }),
    hostWithCredentials: verdict(tailnet, { host: 'user@100.64.0.1:47800' }),
    hostWithPath: verdict(tailnet, { host: '100.64.0.1:47800/api' }),
  }).toMatchInlineSnapshot(`
    {
      "foreignOrigin": 403,
      "hostWithCredentials": 403,
      "hostWithPath": 403,
      "ipv6Loopback": "ok",
      "loopbackDefaultPort": "ok",
      "loopbackOtherPort": 403,
      "loopbackSameOrigin": "ok",
      "loopbackTailnetName": 403,
      "noHost": 403,
      "nullOrigin": 403,
      "sameOrigin": "ok",
      "tailnetHttpsDefaultPort": "ok",
      "tailnetIp": "ok",
      "tailnetName": "ok",
    }
  `);
});
