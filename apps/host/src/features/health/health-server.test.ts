import { HealthResponse } from '@morrowbot/contracts';
import { afterEach, expect, it } from 'vitest';
import { startHealthServer, type HealthServer } from './index.ts';

let server: HealthServer | undefined;
afterEach(async () => {
  const running = server;
  server = undefined;
  await running?.close();
});

it('serves a health response that matches the contract', async () => {
  server = await startHealthServer({ hostname: '127.0.0.1', port: 0 }, '1.2.3');
  const response = await fetch(`${server.url}/health`);
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
  server = await startHealthServer({ hostname: '127.0.0.1', port: 0 }, '1.2.3');
  const response = await fetch(`${server.url}/nope`);
  expect(response.status).toMatchInlineSnapshot(`404`);
});
