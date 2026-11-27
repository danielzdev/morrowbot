import path from 'node:path';
import type { ESLint, Linter, Rule } from 'eslint';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const PLUGIN_PACKAGES = new Set(['@morrowbot/plugin-sdk', '@morrowbot/contracts']);
const PLUGIN_TEST_PACKAGES = new Set([...PLUGIN_PACKAGES, 'vitest']);
const RENDERER_PACKAGES = new Set(['@morrowbot/contracts']);
const RENDERER_ROOT = 'apps/desktop/src/renderer';
const FEATURE_ENTRY = new Set(['', 'index', 'index.ts']);

type Boundary =
  | { readonly kind: 'plugin'; readonly root: string }
  | { readonly kind: 'renderer'; readonly root: string }
  | { readonly kind: 'none' };

function boundaryOf(file: string): Boundary {
  const plugin = /^plugins\/[^/]+/.exec(file);
  if (plugin) return { kind: 'plugin', root: plugin[0] };
  if (isInside(file, RENDERER_ROOT)) return { kind: 'renderer', root: RENDERER_ROOT };
  return { kind: 'none' };
}

function isInside(file: string, root: string): boolean {
  return file === root || file.startsWith(`${root}/`);
}

function featureOf(file: string): { readonly root: string; readonly rest: string } | undefined {
  const match = /^(.*?(?:^|\/)features\/[^/]+)(?:\/(.*))?$/.exec(file);
  if (!match?.[1]) return undefined;
  return { root: match[1], rest: match[2] ?? '' };
}

function toPosix(file: string): string {
  return file.split(path.sep).join('/');
}

export const importBoundaries: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforce the import boundaries in AGENTS.md' },
    schema: [],
    messages: {
      pluginImport:
        'Plugins may import only @morrowbot/plugin-sdk, @morrowbot/contracts, and files inside their own folder.',
      rendererImport:
        'Renderer code may not import host, plugin, or desktop main code. Talk to the host through @morrowbot/contracts.',
      crossFeature: 'Features do not import each other. Move shared types into @morrowbot/contracts.',
      deepFeature: 'Import a feature only through its index.ts ("{{entry}}").',
    },
  },
  create(context) {
    const file = toPosix(path.relative(REPO_ROOT, context.filename));
    const boundary = boundaryOf(file);
    const sourceFeature = featureOf(file);
    const pluginPackages = file.endsWith('.test.ts') ? PLUGIN_TEST_PACKAGES : PLUGIN_PACKAGES;

    function check(node: Rule.Node, specifier: string): void {
      const relative = specifier.startsWith('.');
      const target = relative ? toPosix(path.join(path.dirname(file), specifier)) : undefined;

      switch (boundary.kind) {
        case 'plugin':
          if (target === undefined ? !pluginPackages.has(specifier) : !isInside(target, boundary.root)) {
            context.report({ node, messageId: 'pluginImport' });
          }
          break;
        case 'renderer':
          if (
            target === undefined
              ? specifier.startsWith('@morrowbot/') && !RENDERER_PACKAGES.has(specifier)
              : !isInside(target, boundary.root)
          ) {
            context.report({ node, messageId: 'rendererImport' });
          }
          break;
        case 'none':
          break;
      }

      const targetFeature = target === undefined ? undefined : featureOf(target);
      if (!targetFeature || targetFeature.root === sourceFeature?.root) return;
      if (sourceFeature) {
        context.report({ node, messageId: 'crossFeature' });
      } else if (!FEATURE_ENTRY.has(targetFeature.rest)) {
        context.report({ node, messageId: 'deepFeature', data: { entry: `${targetFeature.root}/index.ts` } });
      }
    }

    function checkSource(node: Rule.Node): void {
      if (!('source' in node)) return;
      const source = node.source;
      if (source?.type === 'Literal' && typeof source.value === 'string') {
        check(node, source.value);
      } else if (
        source?.type === 'TemplateLiteral' &&
        source.expressions.length === 0 &&
        source.quasis.length === 1 &&
        typeof source.quasis[0]?.value.cooked === 'string'
      ) {
        check(node, source.quasis[0].value.cooked);
      } else if (node.type === 'ImportExpression') {
        switch (boundary.kind) {
          case 'plugin':
            context.report({ node, messageId: 'pluginImport' });
            break;
          case 'renderer':
            context.report({ node, messageId: 'rendererImport' });
            break;
          case 'none':
            break;
        }
      }
    }

    return {
      ImportDeclaration: checkSource,
      ExportNamedDeclaration: checkSource,
      ExportAllDeclaration: checkSource,
      ImportExpression: checkSource,
    };
  },
};

const plugin: ESLint.Plugin = { rules: { 'import-boundaries': importBoundaries } };

export const importBoundariesConfig: Linter.Config = {
  files: ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
  plugins: { morrowbot: plugin },
  rules: { 'morrowbot/import-boundaries': 'error' },
};
