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
  const valid = {
    id: 'web-search',
    name: 'Web Search',
    version: '1.2.3',
    kind: 'tool',
    main: 'src/index.ts',
    permissions: ['network'],
    settingsSchema: {
      apiKey: { kind: 'string', label: 'API key' },
      engine: { kind: 'select', label: 'Engine', options: ['a', 'b'], default: 'a' },
    },
  };

  it('accepts a full manifest and rejects bad fields', () => {
    expect([
      issues(PluginManifest.safeParse(valid)),
      issues(
        PluginManifest.safeParse({
          ...valid,
          id: 'Web Search',
          name: '',
          version: 'v1',
          kind: 'theme',
          main: '../outside.ts',
          permissions: ['network', 'network'],
          settingsSchema: {
            'bad key': { kind: 'boolean', label: 'x' },
            engine: { kind: 'select', label: 'Engine', options: ['a'], default: 'z' },
          },
        }),
      ),
    ]).toMatchInlineSnapshot(`
      [
        "valid",
        [
          "id: Use lowercase letters, digits, and dashes",
          "name: Too small: expected string to have >=1 characters",
          "version: Use a MAJOR.MINOR.PATCH version",
          "kind: Invalid option: expected one of "provider"|"tool"",
          "main: Use a path inside the plugin folder",
          "permissions: List each permission once",
          "settingsSchema.bad key: Invalid key in record",
          "settingsSchema.engine.default: The default must be one of the options",
        ],
      ]
    `);
  });
});
