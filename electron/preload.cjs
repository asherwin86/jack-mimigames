// Runs in the page's sandbox before the page does. The only thing it offers is
// the "switch to the other Windows app" controls; the file path itself never
// crosses this bridge (see otherApp.cjs).
const { contextBridge, ipcRenderer } = require('electron');

const info = ipcRenderer.sendSync('other-app:info') || { supported: false, name: '' };

contextBridge.exposeInMainWorld('mimiDesktop', {
  otherApp: {
    supported: !!info.supported,
    name: String(info.name || ''),
    status: () => ipcRenderer.invoke('other-app:status'),
    choose: () => ipcRenderer.invoke('other-app:choose'),
    launch: () => ipcRenderer.invoke('other-app:launch'),
  },
});
