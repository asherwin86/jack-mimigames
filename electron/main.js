import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import electronUpdater from 'electron-updater';   // CommonJS package: no named exports under ESM

const { autoUpdater } = electronUpdater;
const { createOtherApp } = createRequire(import.meta.url)('./otherApp.cjs');   // CommonJS, shared with 51 Mimi Games
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPDATE_CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

// A second launch just brings the existing window forward instead of opening
// a second copy of the whole arcade.
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

/** The Windows-only "Switch to 51 Mimi Games" button: pick that app's .exe once, then it starts it and closes this app. */
function setUpOtherApp() {
  // A source run (npm run electron) may pretend to be another platform, for testing. A packaged app never does.
  const platform = (!app.isPackaged && process.env.MIMI_TEST_PLATFORM) || process.platform;
  const otherApp = createOtherApp({
    otherName: '51 Mimi Games', exeName: '51 Mimi Games.exe',
    userDataDir: app.getPath('userData'), selfExe: process.execPath, platform, fs, spawn,
    localAppData: process.env.LOCALAPPDATA,
    showOpenDialog: (o) => dialog.showOpenDialog(win ?? undefined, o),
    quit: () => app.quit(),
  });
  const fromOurWindow = (e) => !!win && e.sender === win.webContents;
  ipcMain.on('other-app:info', (e) => { e.returnValue = fromOurWindow(e) ? otherApp.info() : { supported: false, name: '' }; });
  ipcMain.handle('other-app:status', (e) => (fromOurWindow(e) ? otherApp.status() : null));
  ipcMain.handle('other-app:choose', (e) => (fromOurWindow(e) ? otherApp.choose() : { ok: false }));
  ipcMain.handle('other-app:launch', (e) => (fromOurWindow(e) ? otherApp.launch() : { ok: false }));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#10131c',
    autoHideMenuBar: true,
    title: '100 Mimi Games',
    // Keep running at full speed when minimised or behind another window, so a
    // game hosted from this window keeps serving its players (a browser tab
    // would be throttled to a crawl in the background).
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, preload: path.join(__dirname, 'preload.cjs') },
  });
  // The built app is a static bundle (base: './' in vite.config.js) so it
  // loads straight off disk — no server, no internet required to play.
  win.loadFile(path.join(__dirname, '../dist/index.html'));
  // Links out of the game (README, GitHub…) open in the real browser, not in
  // a second Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => { win = null; });
}

/** Silent background updates: the new version downloads while you play, then
 *  you're asked once whether to restart into it now. Ignoring the prompt is
 *  fine — it installs by itself the next time the app is closed. Skipped
 *  entirely when running from source (`npm run electron`), and any failure
 *  (offline, GitHub down) is logged and ignored so it can never get in the
 *  way of playing. */
function setUpAutoUpdate() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (e) => console.error('[updater]', e?.message || e));
  autoUpdater.on('update-downloaded', async (info) => {
    const { response } = await dialog.showMessageBox(win ?? undefined, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `100 Mimi Games ${info.version} is ready.`,
      detail: 'Restart to play the new version, or carry on — it will install when you next close the game.',
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  const check = () => autoUpdater.checkForUpdates().catch((e) => console.error('[updater]', e?.message || e));
  check();
  setInterval(check, UPDATE_CHECK_EVERY_MS).unref();
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  setUpOtherApp();
  createWindow();
  setUpAutoUpdate();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
