import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { APP_ID, PRODUCT_NAME } from './app-identity.ts';

app.setName(PRODUCT_NAME);
app.setAppUserModelId(APP_ID);

function openWindow(): void {
  const window = new BrowserWindow({
    width: 960,
    height: 640,
    title: PRODUCT_NAME,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  void window.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)));
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) openWindow();
});

void app.whenReady().then(openWindow);
