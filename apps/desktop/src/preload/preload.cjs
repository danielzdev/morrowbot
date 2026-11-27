// @ts-check
// Sandboxed preloads are run by Electron as plain CommonJS scripts (no ESM, no type stripping), so this file is JavaScript.
/* global require */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a sandboxed preload can only load electron with require
const { contextBridge, ipcRenderer } = require('electron');

/** @typedef {import('../renderer/bridge.ts').BridgeChannels} BridgeChannels */
/** @typedef {import('../renderer/bridge.ts').MorrowbotBridge} MorrowbotBridge */

/** @type {BridgeChannels} */
const CHANNELS = {
  request: 'morrowbot:request',
  event: 'morrowbot:event',
  subscribe: 'morrowbot:subscribe',
  hostReady: 'morrowbot:host-ready',
  hostLost: 'morrowbot:host-lost',
  pickFolder: 'morrowbot:pick-folder',
  copyText: 'morrowbot:copy-text',
  openExternal: 'morrowbot:open-external',
  revealPath: 'morrowbot:reveal-path',
  appInfo: 'morrowbot:app-info',
  loginItem: 'morrowbot:login-item',
  setOpenAtLogin: 'morrowbot:set-open-at-login',
  updateStatus: 'morrowbot:update-status',
  updateChanged: 'morrowbot:update-changed',
  checkForUpdates: 'morrowbot:check-for-updates',
  restartToUpdate: 'morrowbot:restart-to-update',
};

/**
 * @param {string} channel
 * @param {(event: Electron.IpcRendererEvent, ...args: unknown[]) => void} handler
 * @returns {() => void}
 */
function listen(channel, handler) {
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

/** @type {MorrowbotBridge} */
const bridge = {
  request: (method, path, body) => ipcRenderer.invoke(CHANNELS.request, { method, path, body }),
  // Main parses every frame with EventServerFrame before sending it on this channel.
  onEvent: (listener) => listen(CHANNELS.event, (_event, frame) => { listener(/** @type {import('@morrowbot/contracts').EventServerFrame} */ (frame)); }),
  subscribe: (threadId, since) => { ipcRenderer.send(CHANNELS.subscribe, { kind: 'subscribe', threadId, since }); },
  unsubscribe: (threadId) => { ipcRenderer.send(CHANNELS.subscribe, { kind: 'unsubscribe', threadId }); },
  onHostReady: (listener) => listen(CHANNELS.hostReady, () => { listener(); }),
  onHostLost: (listener) => listen(CHANNELS.hostLost, () => { listener(); }),
  // Main answers with the chosen folder path or null.
  pickFolder: () => ipcRenderer.invoke(CHANNELS.pickFolder),
  copyText: (text) => ipcRenderer.invoke(CHANNELS.copyText, text),
  openExternal: (url) => ipcRenderer.invoke(CHANNELS.openExternal, url),
  revealPath: (target) => ipcRenderer.invoke(CHANNELS.revealPath, target),
  appInfo: () => ipcRenderer.invoke(CHANNELS.appInfo),
  loginItem: () => ipcRenderer.invoke(CHANNELS.loginItem),
  setOpenAtLogin: (open) => ipcRenderer.invoke(CHANNELS.setOpenAtLogin, open),
  updateStatus: () => ipcRenderer.invoke(CHANNELS.updateStatus),
  onUpdateStatus: (listener) => listen(CHANNELS.updateChanged, (_event, status) => { listener(status); }),
  checkForUpdates: () => ipcRenderer.invoke(CHANNELS.checkForUpdates),
  restartToUpdate: () => ipcRenderer.invoke(CHANNELS.restartToUpdate),
};

contextBridge.exposeInMainWorld('morrowbot', bridge);
