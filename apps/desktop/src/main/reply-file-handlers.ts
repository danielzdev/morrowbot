import { rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { app, dialog, protocol, shell, type BrowserWindow, type SaveDialogOptions } from 'electron';
import { REPLY_FILE_SCHEME, type FileActionResult } from '../renderer/bridge.ts';
import type { HostTarget } from './ipc-proxy.ts';
import { parseFileAction, runFileAction, serveReplyFile } from './reply-files.ts';
import type { FromRenderer } from './shell-actions.ts';

/** Must run before the app is ready: a standard, secure scheme whose responses stream, so `<video>` can seek. */
export function registerReplyFileScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: REPLY_FILE_SCHEME, privileges: { standard: true, secure: true, stream: true } }]);
}

/** Serves `oribot-file://reply/<id>` from the current host. Call once the app is ready. */
export function serveReplyFiles(host: () => HostTarget | undefined): void {
  protocol.handle(REPLY_FILE_SCHEME, (request) => serveReplyFile(request, host()));
}

let openDir: Promise<string> | undefined;

/** This launch's private folder for opened files (unguessable, readable only by this user), removed when the app quits. */
function openedFiles(): Promise<string> {
  openDir ??= mkdtemp(path.join(app.getPath('temp'), 'oribot-files-')).then((dir) => {
    app.once('will-quit', () => {
      rmSync(dir, { recursive: true, force: true });
    });
    return dir;
  });
  return openDir;
}

/** The `file-action` IPC handler's work: open in a viewer app, or save where the user picks. */
export function fileAction(message: FromRenderer, host: HostTarget | undefined, window: BrowserWindow | undefined): Promise<FileActionResult> {
  return runFileAction(parseFileAction(message), {
    host,
    openDir: openedFiles,
    saveTo: async (name) => {
      const options: SaveDialogOptions = { defaultPath: path.join(app.getPath('downloads'), name) };
      const picked = await (window === undefined ? dialog.showSaveDialog(options) : dialog.showSaveDialog(window, options));
      return picked.canceled || picked.filePath === '' ? null : picked.filePath;
    },
    open: (file) => shell.openPath(file),
    reveal: (file) => {
      shell.showItemInFolder(file);
    },
  });
}
