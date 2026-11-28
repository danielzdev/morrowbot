import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface AppFiles {
  readonly rendererUrl: string;
  readonly preload: string;
  readonly hostMain: string;
  /** The plugins that ship with the app, or `null` when it ships none. */
  readonly builtinPluginsDir: string | null;
}

/**
 * Where the window page, the preload script and the host are. A dev run uses the repo's own files;
 * MorrowBot.app ships the bundles `scripts/build-app.ts` lays out as `main/`, `renderer/` and `host/`,
 * and no plugin folders yet; a dev run discovers the repo's `plugins/`.
 */
export function appFilesOf(build: { readonly kind: 'dev' } | { readonly kind: 'packaged'; readonly appPath: string }): AppFiles {
  switch (build.kind) {
    case 'dev':
      return {
        rendererUrl: pathToFileURL(fileURLToPath(new URL('../../dist/renderer/index.html', import.meta.url))).href,
        preload: fileURLToPath(new URL('../preload/preload.cjs', import.meta.url)),
        hostMain: fileURLToPath(new URL('../../../host/src/main.ts', import.meta.url)),
        builtinPluginsDir: fileURLToPath(new URL('../../../../plugins', import.meta.url)),
      };
    case 'packaged':
      return {
        rendererUrl: pathToFileURL(path.join(build.appPath, 'renderer', 'index.html')).href,
        preload: path.join(build.appPath, 'main', 'preload.cjs'),
        hostMain: path.join(build.appPath, 'host', 'main.js'),
        builtinPluginsDir: null,
      };
  }
}
