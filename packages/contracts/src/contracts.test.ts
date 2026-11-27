import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { HealthResponse, PluginManifest } from './index.ts';

function issues(result: z.ZodSafeParseResult<unknown>) {
  return result.success
    ? 'valid'
    : result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}

describe('HealthResponse', () => {
  it('accepts a healthy host and rejects unknown fields', () => {
    expect([
      issues(HealthResponse.safeParse({ status: 'ok', version: '0.0.0', uptimeMs: 12 })),
      issues(HealthResponse.safeParse({ status: 'ok', version: '0.0.0', uptimeMs: -1, extra: true })),
    ]).toMatchInlineSnapshot(`
      [
        "valid",
        [
          "uptimeMs: Too small: expected number to be >=0",
          "(root): Unrecognized key: "extra"",
        ],
      ]
    `);
  });
});

describe('PluginManifest', () => {
  it('rejects a bad id and version', () => {
    expect([
      issues(PluginManifest.safeParse({ id: 'web-search', name: 'Web Search', version: '1.2.3' })),
      issues(PluginManifest.safeParse({ id: 'Web Search', name: '', version: 'v1' })),
    ]).toMatchInlineSnapshot(`
      [
        "valid",
        [
          "id: Use lowercase letters, digits, and dashes",
          "name: Too small: expected string to have >=1 characters",
          "version: Use a MAJOR.MINOR.PATCH version",
        ],
      ]
    `);
  });
});
