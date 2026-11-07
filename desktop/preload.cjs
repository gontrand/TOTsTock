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
  // Lot 3 & Lot 4 additions
  printZplRaw: (params) => ipcRenderer.invoke('tot:print-zpl-raw', params),
  testZplPrinter: (params) => ipcRenderer.invoke('tot:test-zpl-printer', params),
  getZplSettings: () => ipcRenderer.invoke('tot:get-zpl-settings'),
  setZplSettings: (settings) => ipcRenderer.invoke('tot:set-zpl-settings', settings),
  getSystemSettings: () => ipcRenderer.invoke('tot:get-system-settings'),
  setSystemSettings: (settings) => ipcRenderer.invoke('tot:set-system-settings', settings),
  showNotification: (payload) => ipcRenderer.invoke('tot:show-notification', payload),
  openSecondaryWindow: (route) =>
    ipcRenderer.invoke(
      'tot:open-secondary-window',
      typeof route === 'string' ? { route } : route
    ),
  updateTrayStatus: (status) => ipcRenderer.invoke('tot:update-tray-status', status),
  setMenuLocale: (locale) => ipcRenderer.invoke('tot:set-menu-locale', locale),
  onMenuCommand: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const listener = (_event, commandId) => {
      try {
        callback(commandId);
      } catch {
        // Ignorer
      }
    };
    ipcRenderer.on('tot:menu-command', listener);
    return () => {
      ipcRenderer.removeListener('tot:menu-command', listener);
    };
  },
  getOrCreateSafeStorageKey: () => ipcRenderer.invoke('tot:safe-storage-get-or-create-key'),
  clearSafeStorageKey: () => ipcRenderer.invoke('tot:safe-storage-clear-key'),
});

contextBridge.exposeInMainWorld('totDesktop', desktopApi);
