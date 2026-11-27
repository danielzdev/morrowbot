import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint, Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import { importBoundariesConfig } from './import-boundaries.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const eslint = new ESLint({ cwd: root });
const linter = new Linter({ cwd: root });

function format(messages: readonly Linter.LintMessage[]): string[] {
  return messages.map((message) => {
    if (message.fatal) throw new Error(message.message);
    return `${String(message.line)}: ${message.ruleId ?? ''}: ${message.message}`;
  });
}

/** Lints `code` with the real repo config as if it were the contents of `filePath` (an existing file). */
async function lintWithRepoConfig(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return format(result?.messages ?? []);
}

function lintBoundaries(filePath: string, code: string): string[] {
  return format(linter.verify(code, [importBoundariesConfig], path.join(root, filePath)));
}

describe('type guardrails', () => {
  it('rejects any, as casts, and non-exhaustive switches', async () => {
    expect(
      await lintWithRepoConfig(
        'apps/host/src/main.ts',
        [
          'export const a: any = 1;',
          'export const b = JSON.stringify({}) as string;',
          "export const c = ['x'] as const;",
          "export type Kind = { kind: 'a' } | { kind: 'b' };",
          'export function f(k: Kind): number {',
          '  switch (k.kind) {',
          "    case 'a':",
          '      return 1;',
          '  }',
          '  return 0;',
          '}',
        ].join('\n'),
      ),
    ).toMatchInlineSnapshot(`
      [
        "1: @typescript-eslint/no-explicit-any: Unexpected any. Specify a different type.",
        "2: @typescript-eslint/consistent-type-assertions: Do not use any type assertions.",
        "2: @typescript-eslint/no-unnecessary-type-assertion: This assertion is unnecessary since it does not change the type of the expression.",
        "6: @typescript-eslint/switch-exhaustiveness-check: Switch is not exhaustive. Cases not matched: "b"",
      ]
    `);
  });

  it('caps files at 400 lines', async () => {
    expect(await lintWithRepoConfig('apps/host/src/main.ts', 'export {};\n'.repeat(401))).toMatchInlineSnapshot(`
      [
        "401: max-lines: File has too many lines (401). Maximum allowed is 400.",
      ]
    `);
  });
});

describe('import boundaries', () => {
  it('allows features only through index.ts, and never from another feature', async () => {
    expect({
      viaIndex: await lintWithRepoConfig('apps/host/src/main.ts', "export * from './features/health/index.ts';"),
      deep: await lintWithRepoConfig('apps/host/src/main.ts', "export * from './features/health/health-server.ts';"),
      crossFeature: await lintWithRepoConfig(
        'apps/host/src/features/health/index.ts',
        "export * from '../config/index.ts';",
      ),
    }).toMatchInlineSnapshot(`
      {
        "crossFeature": [
          "1: morrowbot/import-boundaries: Features do not import each other. Move shared types into @morrowbot/contracts.",
        ],
        "deep": [
          "1: morrowbot/import-boundaries: Import a feature only through its index.ts ("apps/host/src/features/health/index.ts").",
        ],
        "viaIndex": [],
      }
    `);
  });

  it('keeps the renderer away from host, plugins, and desktop main', () => {
    const renderer = 'apps/desktop/src/renderer/app.tsx';
    expect({
      contracts: lintBoundaries(renderer, "export * from '@morrowbot/contracts';"),
      ownFile: lintBoundaries(renderer, "export * from './view.ts';"),
      hostPackage: lintBoundaries(renderer, "export * from '@morrowbot/host';"),
      hostPath: lintBoundaries(renderer, "export * from '../../../host/src/main.ts';"),
      pluginPath: lintBoundaries(renderer, "export * from '../../../../plugins/demo/src/index.ts';"),
      desktopMain: lintBoundaries(renderer, "export * from '../main/app-identity.ts';"),
    }).toMatchInlineSnapshot(`
      {
        "contracts": [],
        "desktopMain": [
          "1: morrowbot/import-boundaries: Renderer code may not import host, plugin, or desktop main code. Talk to the host through @morrowbot/contracts.",
        ],
        "hostPackage": [
          "1: morrowbot/import-boundaries: Renderer code may not import host, plugin, or desktop main code. Talk to the host through @morrowbot/contracts.",
        ],
        "hostPath": [
          "1: morrowbot/import-boundaries: Renderer code may not import host, plugin, or desktop main code. Talk to the host through @morrowbot/contracts.",
        ],
        "ownFile": [],
        "pluginPath": [
          "1: morrowbot/import-boundaries: Renderer code may not import host, plugin, or desktop main code. Talk to the host through @morrowbot/contracts.",
        ],
      }
    `);
  });

  it('lets plugins import only the SDK, contracts, and their own files', () => {
    const plugin = 'plugins/demo/src/index.ts';
    expect({
      sdk: lintBoundaries(plugin, "export * from '@morrowbot/plugin-sdk';"),
      contracts: lintBoundaries(plugin, "export * from '@morrowbot/contracts';"),
      ownFile: lintBoundaries(plugin, "export * from './tools.ts';"),
      nodeBuiltin: lintBoundaries(plugin, "export * from 'node:fs';"),
      host: lintBoundaries(plugin, "export * from '@morrowbot/host';"),
      otherPlugin: lintBoundaries(plugin, "export * from '../../other/src/index.ts';"),
      dynamicImport: lintBoundaries(plugin, "export const m = import('@morrowbot/host');"),
      templateImport: lintBoundaries(plugin, 'export const t = import(`@morrowbot/host`);'),
    }).toMatchInlineSnapshot(`
      {
        "contracts": [],
        "dynamicImport": [
          "1: morrowbot/import-boundaries: Plugins may import only @morrowbot/plugin-sdk, @morrowbot/contracts, and files inside their own folder.",
        ],
        "host": [
          "1: morrowbot/import-boundaries: Plugins may import only @morrowbot/plugin-sdk, @morrowbot/contracts, and files inside their own folder.",
        ],
        "nodeBuiltin": [
          "1: morrowbot/import-boundaries: Plugins may import only @morrowbot/plugin-sdk, @morrowbot/contracts, and files inside their own folder.",
        ],
        "otherPlugin": [
          "1: morrowbot/import-boundaries: Plugins may import only @morrowbot/plugin-sdk, @morrowbot/contracts, and files inside their own folder.",
        ],
        "ownFile": [],
        "sdk": [],
        "templateImport": [
          "1: morrowbot/import-boundaries: Plugins may import only @morrowbot/plugin-sdk, @morrowbot/contracts, and files inside their own folder.",
        ],
      }
    `);
  });
});
