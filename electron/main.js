import { app, BrowserWindow, dialog, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { autoUpdater } from 'electron-updater';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPDATE_CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

// A second launch just brings the existing window forward instead of opening
// a second copy of the whole arcade.
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#10131c',
    autoHideMenuBar: true,
    title: '100 Mimi Games',
    webPreferences: { contextIsolation: true, sandbox: true },
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
  createWindow();
  setUpAutoUpdate();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
