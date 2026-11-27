import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HealthResponse } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { healthListener } from './index.ts';

let server: Server;
let url: string;
beforeEach(async () => {
  server = createServer(healthListener('1.2.3'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === 'string') throw new Error('not listening');
  url = `http://127.0.0.1:${String(address.port)}`;
});
afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

it('serves a health response that matches the contract', async () => {
  const response = await fetch(`${url}/health`);
  const health = HealthResponse.parse(await response.json());
  expect({
    status: response.status,
    contentType: response.headers.get('content-type'),
    health: { ...health, uptimeMs: typeof health.uptimeMs },
  }).toMatchInlineSnapshot(`
    {
      "contentType": "application/json",
      "health": {
        "status": "ok",
        "uptimeMs": "number",
        "version": "1.2.3",
      },
      "status": 200,
    }
  `);
});

it('answers 404 for any other path', async () => {
  const response = await fetch(`${url}/nope`);
  expect(response.status).toMatchInlineSnapshot(`404`);
});
