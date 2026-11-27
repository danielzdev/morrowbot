import type { RequestListener } from 'node:http';
import type { HealthResponse } from '@morrowbot/contracts';

/** Answers `GET /health` and 404s everything else. */
export function healthListener(version: string): RequestListener {
  const startedAt = performance.now();
  return (request, response) => {
    if (request.method !== 'GET' || request.url !== '/health') {
      response.writeHead(404).end();
      return;
    }
    const body: HealthResponse = {
      status: 'ok',
      version,
      uptimeMs: Math.round(performance.now() - startedAt),
    };
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  };
}
