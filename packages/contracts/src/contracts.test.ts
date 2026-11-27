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
    protocolVersion: 1,
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
          protocolVersion: 2,
          envPreset: 'everything',
          settingsSchema: {
            'bad key': { kind: 'boolean', label: 'x' },
            engine: { kind: 'select', label: 'Engine', options: ['a'], default: 'z' },
            limit: { kind: 'number', label: 'Limit', min: 1, max: 3, default: 99 },
          },
        }),
      ),
    ]).toMatchInlineSnapshot(`
      [
        "valid",
        [
          "protocolVersion: Invalid input: expected 1",
          "id: Use lowercase letters, digits, and dashes",
          "name: Too small: expected string to have >=1 characters",
          "version: Use a MAJOR.MINOR.PATCH version",
          "kind: Invalid option: expected one of "provider"|"tool"",
          "main: Use a path inside the plugin folder",
          "permissions: List each permission once",
          "envPreset: Invalid option: expected one of "none"|"cli-runtime"",
          "settingsSchema.bad key: Invalid key in record",
          "settingsSchema.engine.default: The default must be one of the options",
          "settingsSchema.limit.default: The default must be between min and max",
        ],
      ]
    `);
  });
});

describe('PluginManifest env', () => {
  it('rejects the old env list: plugins pick an envPreset instead', () => {
    const manifest = {
      protocolVersion: 1,
      id: 'cli',
      name: 'CLI',
      version: '1.0.0',
      kind: 'provider',
      main: 'index.ts',
      permissions: [],
      settingsSchema: {},
    };
    expect([
      issues(PluginManifest.safeParse({ ...manifest, env: ['HOME'] })),
      PluginManifest.parse(manifest).envPreset,
      PluginManifest.parse({ ...manifest, envPreset: 'cli-runtime' }).envPreset,
    ]).toMatchInlineSnapshot(`
      [
        [
          "(root): Unrecognized key: "env"",
        ],
        "none",
        "cli-runtime",
      ]
    `);
  });
});
