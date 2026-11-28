import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function resolveReal(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}

export interface AppFiles {
  readonly rendererUrl: string;
  readonly preload: string;
  readonly hostMain: string;
  /** The post-exit cleanup helper that Reset or Uninstall starts. */
  readonly cleanupHelper: string;
  /** The plugins that ship with the app, or `null` when it ships none. */
  readonly builtinPluginsDir: string | null;
}

/**
 * Where the window page, the preload script and the host are. A dev run uses the repo's own files;
 * Ori Bot.app ships the bundles `scripts/build-app.ts` lays out as `main/`, `renderer/` and `host/`,
 * and no plugin folders yet; a dev run discovers the repo's `plugins/`.
 */
export function appFilesOf(build: { readonly kind: 'dev' } | { readonly kind: 'packaged'; readonly appPath: string }): AppFiles {
  switch (build.kind) {
    case 'dev':
      return {
        rendererUrl: pathToFileURL(fileURLToPath(new URL('../../dist/renderer/index.html', import.meta.url))).href,
        preload: fileURLToPath(new URL('../preload/preload.cjs', import.meta.url)),
        hostMain: fileURLToPath(new URL('../../../host/src/main.ts', import.meta.url)),
        cleanupHelper: fileURLToPath(new URL('./reset/cleanup-helper.ts', import.meta.url)),
        builtinPluginsDir: fileURLToPath(new URL('../../../../plugins', import.meta.url)),
      };
    case 'packaged': {
      const appPath = resolveReal(build.appPath);
      return {
        rendererUrl: pathToFileURL(path.join(appPath, 'renderer', 'index.html')).href,
        preload: path.join(appPath, 'main', 'preload.cjs'),
        hostMain: path.join(appPath, 'host', 'main.js'),
        cleanupHelper: path.join(appPath, 'main', 'cleanup-helper.js'),
        builtinPluginsDir: null,
      };
    }
  }
}
