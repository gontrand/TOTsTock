'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const VALID_PLATFORMS = new Set(['win32', 'darwin', 'linux']);
const platform = VALID_PLATFORMS.has(process.platform) ? process.platform : 'linux';

const desktopApi = Object.freeze({
  isDesktop: true,
  platform,
  listPrinters: () => ipcRenderer.invoke('tot:list-printers'),
  printLabel: (params) => ipcRenderer.invoke('tot:print-label', params),
  getPrintSettings: () => ipcRenderer.invoke('tot:get-print-settings'),
  setPrintSettings: (settings) => ipcRenderer.invoke('tot:set-print-settings', settings),
  openExternal: (url) => ipcRenderer.invoke('tot:open-external', url),
  getUpdateStatus: () => ipcRenderer.invoke('tot:get-update-status'),
  quitAndInstallUpdate: () => ipcRenderer.invoke('tot:quit-and-install'),
  onUpdateStatus: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const listener = (_event, statusPayload) => {
      try {
        callback(statusPayload);
      } catch {
        // Ignorer les erreurs de rappel côté rendu
      }
    };
    ipcRenderer.on('tot:update-status', listener);
    return () => {
      ipcRenderer.removeListener('tot:update-status', listener);
    };
  },
});

contextBridge.exposeInMainWorld('totDesktop', desktopApi);
