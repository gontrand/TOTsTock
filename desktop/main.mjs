import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  protocol,
  session,
  shell,
  Tray,
} from 'electron';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_PROTOCOL_ORIGIN,
  APP_PROTOCOL_SCHEME,
  buildDesktopCsp,
  createNotificationRateLimiter,
  isAllowedExternalUrl,
  isAllowedIpcSender,
  isAllowedNavigationUrl,
  isAllowedPermissionRequest,
  MAX_OPEN_WINDOWS,
  PRINT_TIMEOUT_MS,
  resolveSafeProtocolPath,
  sanitizeDesktopSystemSettings,
  sanitizeLogMessage,
  sanitizeNotificationPayload,
  sanitizePrintSettings,
  sanitizeWindowBounds,
  sanitizeZplSettings,
  validatePrintLabelPayload,
  validateZplPrintPayload,
  ZPL_TCP_TIMEOUT_MS,
} from './security.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDevMode = process.env.TOT_DESKTOP_DEV === '1';

// Déclaration du schéma privilégié `app://tot` avant `app.whenReady()`
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_PROTOCOL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// Verrou d'instance unique : une seule instance principale à la fois
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

let mainWindow = null;
const secondaryWindows = new Set();
let appTray = null;
let isQuitting = false;
let currentMenuLocale = 'fr';
let currentTrayStatus = {
  pendingCount: 0,
  paused: false,
  stationName: '',
};

const pendingPrintJobs = new Map();
const activeZplPrinterLocks = new Set();
const notificationRateLimiter = createNotificationRateLimiter();

let currentUpdateStatus = {
  enabled: false,
  state: 'idle',
  version: null,
  error: null,
};
let autoUpdaterInstance = null;

function logInfo(message) {
  console.info(`[TOT Desktop] ${sanitizeLogMessage(String(message))}`);
}

function logError(message, err) {
  const errMsg = err instanceof Error ? err.message : String(err || '');
  console.error(
    `[TOT Desktop Error] ${sanitizeLogMessage(String(message))} ${sanitizeLogMessage(errMsg)}`
  );
}

function getDistDirectory() {
  const packagedDist = path.join(process.resourcesPath || '', 'app-dist');
  if (fs.existsSync(packagedDist)) {
    return packagedDist;
  }
  return path.resolve(__dirname, '..', 'dist');
}

function getWindowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function getPrintSettingsPath() {
  return path.join(app.getPath('userData'), 'print-settings.json');
}

function getZplSettingsPath() {
  return path.join(app.getPath('userData'), 'zpl-settings.json');
}

function getSystemSettingsPath() {
  return path.join(app.getPath('userData'), 'system-settings.json');
}

function readJsonFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJsonFileSafe(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch (err) {
    logError('Impossible de sauvegarder le fichier de configuration locale', err);
    return false;
  }
}

function getCurrentSystemSettings() {
  return sanitizeDesktopSystemSettings(readJsonFileSafe(getSystemSettingsPath()));
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function registerAppProtocol() {
  const distRoot = getDistDirectory();
  const cspHeader = buildDesktopCsp(process.env.VITE_ALLOWED_SUPABASE_HOSTS || '');

  protocol.handle(APP_PROTOCOL_SCHEME, async (request) => {
    const commonHeaders = {
      'Content-Security-Policy': cspHeader,
      'X-Content-Type-Options': 'nosniff',
    };

    if (!isAllowedNavigationUrl(request.url)) {
      return new Response('Forbidden Origin', {
        status: 403,
        headers: commonHeaders,
      });
    }

    try {
      const parsedUrl = new URL(request.url);
      const printJobMatch = parsedUrl.pathname.match(/^\/__print_job__\/([a-f0-9-]+)\.html$/i);
      if (printJobMatch) {
        const jobId = printJobMatch[1];
        const htmlContent = pendingPrintJobs.get(jobId);
        if (!htmlContent) {
          return new Response('Not Found', { status: 404, headers: commonHeaders });
        }
        return new Response(htmlContent, {
          status: 200,
          headers: {
            ...commonHeaders,
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        });
      }
    } catch {
      return new Response('Bad Request', { status: 400, headers: commonHeaders });
    }

    const resolved = resolveSafeProtocolPath(distRoot, request.url);
    if (!resolved.ok) {
      return new Response('Forbidden', {
        status: 403,
        headers: commonHeaders,
      });
    }

    let targetFile = resolved.filePath;
    if (!fs.existsSync(targetFile) || fs.statSync(targetFile).isDirectory()) {
      const ext = path.extname(targetFile);
      if (!ext) {
        targetFile = path.join(distRoot, 'index.html');
      }
    }

    if (!fs.existsSync(targetFile)) {
      return new Response('Not Found', {
        status: 404,
        headers: commonHeaders,
      });
    }

    try {
      const content = await fs.promises.readFile(targetFile);
      return new Response(content, {
        status: 200,
        headers: {
          ...commonHeaders,
          'Content-Type': getMimeType(targetFile),
        },
      });
    } catch {
      return new Response('Internal Error', {
        status: 500,
        headers: commonHeaders,
      });
    }
  });
}

function configurePermissions() {
  const defaultSession = session.defaultSession;

  defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details?.requestingUrl || webContents?.getURL?.() || '';
    const allowed = isAllowedPermissionRequest(permission, requestingUrl);
    callback(allowed);
  });

  defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const originUrl = requestingOrigin || webContents?.getURL?.() || '';
    return isAllowedPermissionRequest(permission, originUrl);
  });
}

function lockWebContentsNavigation(contents) {
  contents.on('will-navigate', (event, navigationUrl) => {
    if (isAllowedNavigationUrl(navigationUrl)) {
      return;
    }
    event.preventDefault();
    if (isAllowedExternalUrl(navigationUrl)) {
      shell.openExternal(navigationUrl).catch((err) => {
        logError('Ouverture du lien externe refusée', err);
      });
    }
  });

  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url).catch((err) => {
        logError('Ouverture de la fenêtre externe refusée', err);
      });
    }
    return { action: 'deny' };
  });
}

function sendAppCommandToMain(command) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
    mainWindow.webContents.send('tot:app-command', command);
  }
}

const MENU_TRANSLATIONS = {
  fr: {
    file: 'Fichier',
    newArticle: 'Nouvel article',
    newMovement: 'Nouveau mouvement',
    newOrder: 'Nouvelle commande',
    exportInventory: "Exporter l'inventaire (CSV)",
    printLabels: 'Imprimer des étiquettes…',
    quit: 'Quitter TOT Stock',
    edit: 'Édition',
    undo: 'Annuler',
    redo: 'Rétablir',
    cut: 'Couper',
    copy: 'Copier',
    paste: 'Coller',
    selectAll: 'Tout sélectionner',
    find: 'Rechercher',
    view: 'Affichage',
    reload: 'Actualiser les données',
    zoomIn: 'Zoom avant',
    zoomOut: 'Zoom arrière',
    zoomReset: 'Taille réelle (100 %)',
    fullscreen: 'Plein écran',
    toggleSidebar: 'Réduire / étendre la barre latérale',
    window: 'Fenêtre',
    newWindow: 'Nouvelle fenêtre',
    openPrintStation: "Ouvrir le Poste d'impression",
    minimize: 'Réduire',
    help: 'Aide',
    shortcuts: 'Raccourcis clavier',
    docs: 'Documentation',
    about: 'À propos de TOT Stock',
    trayOpen: 'Ouvrir TOT Stock',
    trayPending: (count) => `Poste d'impression : ${count} en attente`,
    trayPause: "Mettre en pause l'impression automatique",
    trayResume: "Reprendre l'impression automatique",
  },
  en: {
    file: 'File',
    newArticle: 'New item',
    newMovement: 'New movement',
    newOrder: 'New order',
    exportInventory: 'Export inventory (CSV)',
    printLabels: 'Print labels…',
    quit: 'Quit TOT Stock',
    edit: 'Edit',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
    find: 'Find',
    view: 'View',
    reload: 'Refresh data',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    zoomReset: 'Actual Size (100%)',
    fullscreen: 'Full Screen',
    toggleSidebar: 'Toggle sidebar',
    window: 'Window',
    newWindow: 'New Window',
    openPrintStation: 'Open Print Station',
    minimize: 'Minimize',
    help: 'Help',
    shortcuts: 'Keyboard Shortcuts',
    docs: 'Documentation',
    about: 'About TOT Stock',
    trayOpen: 'Open TOT Stock',
    trayPending: (count) => `Print Station: ${count} pending`,
    trayPause: 'Pause auto-print',
    trayResume: 'Resume auto-print',
  },
  nl: {
    file: 'Bestand',
    newArticle: 'Nieuw artikel',
    newMovement: 'Nieuwe mutatie',
    newOrder: 'Nieuwe bestelling',
    exportInventory: 'Voorraad exporteren (CSV)',
    printLabels: 'Etiketten afdrukken…',
    quit: 'TOT Stock afsluiten',
    edit: 'Bewerken',
    undo: 'Ongedaan maken',
    redo: 'Opnieuw',
    cut: 'Knippen',
    copy: 'Kopiëren',
    paste: 'Plakken',
    selectAll: 'Alles selecteren',
    find: 'Zoeken',
    view: 'Weergave',
    reload: 'Gegevens vernieuwen',
    zoomIn: 'Inzoomen',
    zoomOut: 'Uitzoomen',
    zoomReset: 'Werkelijke grootte (100%)',
    fullscreen: 'Volledig scherm',
    toggleSidebar: 'Zijbalk in-/uitklappen',
    window: 'Venster',
    newWindow: 'Nieuw venster',
    openPrintStation: 'Afdrukstation openen',
    minimize: 'Minimaliseren',
    help: 'Help',
    shortcuts: 'Sneltoetsen',
    docs: 'Documentatie',
    about: 'Over TOT Stock',
    trayOpen: 'TOT Stock openen',
    trayPending: (count) => `Afdrukstation: ${count} in wachtrij`,
    trayPause: 'Automatisch afdrukken pauzeren',
    trayResume: 'Automatisch afdrukken hervatten',
  },
};

function setZoomClamped(delta) {
  const focused = BrowserWindow.getFocusedWindow() || mainWindow;
  if (!focused || focused.isDestroyed()) return;
  const current = focused.webContents.getZoomFactor();
  const next = delta === 0 ? 1.0 : Math.min(1.5, Math.max(0.8, Math.round((current + delta) * 10) / 10));
  focused.webContents.setZoomFactor(next);
}

function buildLocalizedAppMenu(locale = 'fr') {
  const L = MENU_TRANSLATIONS[locale] || MENU_TRANSLATIONS.fr;
  const template = [
    {
      label: L.file,
      submenu: [
        {
          label: L.newArticle,
          accelerator: 'CmdOrCtrl+N',
          click: () => sendAppCommandToMain('new-product'),
        },
        {
          label: L.newMovement,
          accelerator: 'CmdOrCtrl+M',
          click: () => sendAppCommandToMain('new-movement'),
        },
        {
          label: L.newOrder,
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => sendAppCommandToMain('new-order'),
        },
        { type: 'separator' },
        {
          label: L.exportInventory,
          accelerator: 'CmdOrCtrl+E',
          click: () => sendAppCommandToMain('export-inventory-csv'),
        },
        {
          label: L.printLabels,
          accelerator: 'CmdOrCtrl+P',
          click: () => sendAppCommandToMain('print-labels'),
        },
        { type: 'separator' },
        {
          label: L.quit,
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ],
    },
    {
      label: L.edit,
      submenu: [
        { label: L.undo, role: 'undo' },
        { label: L.redo, role: 'redo' },
        { type: 'separator' },
        { label: L.cut, role: 'cut' },
        { label: L.copy, role: 'copy' },
        { label: L.paste, role: 'paste' },
        { label: L.selectAll, role: 'selectAll' },
        { type: 'separator' },
        {
          label: L.find,
          accelerator: 'CmdOrCtrl+F',
          click: () => sendAppCommandToMain('focus-search'),
        },
      ],
    },
    {
      label: L.view,
      submenu: [
        {
          label: L.reload,
          accelerator: 'CmdOrCtrl+R',
          click: () => sendAppCommandToMain('refresh-data'),
        },
        { type: 'separator' },
        {
          label: L.zoomIn,
          accelerator: 'CmdOrCtrl+Plus',
          click: () => setZoomClamped(0.1),
        },
        {
          label: L.zoomOut,
          accelerator: 'CmdOrCtrl+-',
          click: () => setZoomClamped(-0.1),
        },
        {
          label: L.zoomReset,
          accelerator: 'CmdOrCtrl+0',
          click: () => setZoomClamped(0),
        },
        { type: 'separator' },
        { label: L.fullscreen, role: 'togglefullscreen' },
        {
          label: L.toggleSidebar,
          accelerator: 'CmdOrCtrl+B',
          click: () => sendAppCommandToMain('toggle-sidebar'),
        },
      ],
    },
    {
      label: L.window,
      submenu: [
        {
          label: L.newWindow,
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => openSecondaryWindow('inventory'),
        },
        {
          label: L.openPrintStation,
          click: () => sendAppCommandToMain('navigate:print-station'),
        },
        { type: 'separator' },
        { label: L.minimize, role: 'minimize' },
      ],
    },
    {
      label: L.help,
      submenu: [
        {
          label: L.shortcuts,
          accelerator: 'CmdOrCtrl+/',
          click: () => sendAppCommandToMain('open-shortcuts'),
        },
        {
          label: L.docs,
          click: () => sendAppCommandToMain('navigate:settings-docs'),
        },
        { type: 'separator' },
        {
          label: L.about,
          click: () => sendAppCommandToMain('navigate:settings-about'),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createTrayIconImage() {
  const candidates = [
    path.join(getDistDirectory(), 'pwa-192x192.png'),
    path.join(getDistDirectory(), 'favicon.ico'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const img = nativeImage.createFromPath(candidate);
      if (!img.isEmpty()) {
        return img.resize({ width: 16, height: 16 });
      }
    }
  }
  return nativeImage.createEmpty();
}

function updateTrayContextMenu() {
  if (!appTray) return;
  const L = MENU_TRANSLATIONS[currentMenuLocale] || MENU_TRANSLATIONS.fr;
  const pendingCount = Math.max(0, Number(currentTrayStatus.pendingCount) || 0);
  const paused = Boolean(currentTrayStatus.paused);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: L.trayOpen,
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          createMainWindow();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: L.trayPending(pendingCount),
      enabled: false,
    },
    {
      label: paused ? L.trayResume : L.trayPause,
      click: () => {
        sendAppCommandToMain('toggle-print-station-pause');
      },
    },
    { type: 'separator' },
    {
      label: L.quit,
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  appTray.setToolTip(
    pendingCount > 0
      ? `TOT Stock — ${L.trayPending(pendingCount)}`
      : 'TOT Stock'
  );
  appTray.setContextMenu(contextMenu);
}

function setupSystemTray() {
  try {
    if (appTray) return;
    appTray = new Tray(createTrayIconImage());
    updateTrayContextMenu();
    appTray.on('click', () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        createMainWindow();
      } else if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (err) {
    logError("Impossible d'initialiser l'icône de barre des tâches", err);
  }
}

function applyAutoLaunchSetting(launchAtLogin) {
  try {
    if (process.platform === 'win32' || process.platform === 'darwin') {
      app.setLoginItemSettings({
        openAtLogin: Boolean(launchAtLogin),
      });
    } else if (process.platform === 'linux') {
      const autostartDir = path.join(app.getPath('home'), '.config', 'autostart');
      const desktopFile = path.join(autostartDir, 'tot-stock-desktop.desktop');
      if (launchAtLogin) {
        fs.mkdirSync(autostartDir, { recursive: true });
        const content = [
          '[Desktop Entry]',
          'Type=Application',
          'Name=TOT Stock',
          `Exec="${process.execPath}"`,
          'Terminal=false',
          'X-GNOME-Autostart-enabled=true',
        ].join('\n');
        fs.writeFileSync(desktopFile, content, 'utf8');
      } else if (fs.existsSync(desktopFile)) {
        fs.unlinkSync(desktopFile);
      }
    }
  } catch (err) {
    logError('Impossible de modifier le lancement automatique au démarrage', err);
  }
}

function openSecondaryWindow(route = 'inventory') {
  const totalOpen = (mainWindow && !mainWindow.isDestroyed() ? 1 : 0) + secondaryWindows.size;
  if (totalOpen >= MAX_OPEN_WINDOWS) {
    return {
      ok: false,
      errorMessage: `Nombre maximal de fenêtres atteint (${MAX_OPEN_WINDOWS}).`,
    };
  }

  const safeRoute = ['dashboard', 'inventory', 'movements', 'orders', 'preparation', 'print-station', 'settings'].includes(route)
    ? route
    : 'inventory';

  const childWin = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'TOT Stock',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: isDevMode,
      spellcheck: false,
    },
  });

  secondaryWindows.add(childWin);
  lockWebContentsNavigation(childWin.webContents);

  childWin.once('ready-to-show', () => {
    if (!childWin.isDestroyed()) {
      childWin.show();
    }
  });

  childWin.on('closed', () => {
    secondaryWindows.delete(childWin);
  });

  childWin.loadURL(`${APP_PROTOCOL_ORIGIN}/index.html?desktopRoute=${encodeURIComponent(safeRoute)}&secondary=1`);
  return { ok: true };
}

function createMainWindow() {
  const savedBounds = sanitizeWindowBounds(readJsonFileSafe(getWindowStatePath()));

  mainWindow = new BrowserWindow({
    width: savedBounds.width,
    height: savedBounds.height,
    x: savedBounds.x,
    y: savedBounds.y,
    minWidth: 900,
    minHeight: 600,
    title: 'TOT Stock',
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: isDevMode,
      spellcheck: false,
    },
  });

  buildLocalizedAppMenu(currentMenuLocale);

  if (savedBounds.isMaximized) {
    mainWindow.maximize();
  }

  lockWebContentsNavigation(mainWindow.webContents);

  const saveWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const isMaximized = mainWindow.isMaximized();
    const bounds = isMaximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    writeJsonFileSafe(
      getWindowStatePath(),
      sanitizeWindowBounds({ ...bounds, isMaximized })
    );
  };

  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);
  mainWindow.on('close', (event) => {
    saveWindowState();
    const sys = getCurrentSystemSettings();
    if (!isQuitting && sys.keepInTrayOnClose) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(`${APP_PROTOCOL_ORIGIN}/index.html`);
}

function broadcastUpdateStatus(nextStatus) {
  currentUpdateStatus = { ...currentUpdateStatus, ...nextStatus };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tot:update-status', currentUpdateStatus);
  }
}

async function setupOptionalAutoUpdater() {
  const rawUpdateUrl = (process.env.TOT_DESKTOP_UPDATE_URL || '').trim();
  if (!rawUpdateUrl) {
    return;
  }

  if (!isAllowedExternalUrl(rawUpdateUrl)) {
    logError('TOT_DESKTOP_UPDATE_URL ignorée : seule une URL https:// valide est autorisée.');
    return;
  }

  try {
    const updaterModule = await import('electron-updater');
    const autoUpdater = updaterModule.autoUpdater || updaterModule.default?.autoUpdater;
    if (!autoUpdater) return;

    autoUpdaterInstance = autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: rawUpdateUrl,
    });

    broadcastUpdateStatus({ enabled: true, state: 'idle' });

    autoUpdater.on('checking-for-update', () => {
      broadcastUpdateStatus({ state: 'checking', error: null });
    });

    autoUpdater.on('update-available', (info) => {
      broadcastUpdateStatus({
        state: 'downloading',
        version: info?.version || null,
        error: null,
      });
    });

    autoUpdater.on('update-not-available', () => {
      broadcastUpdateStatus({ state: 'not-available', error: null });
    });

    autoUpdater.on('update-downloaded', (info) => {
      broadcastUpdateStatus({
        state: 'downloaded',
        version: info?.version || null,
        error: null,
      });
    });

    autoUpdater.on('error', (err) => {
      logError('Erreur lors de la vérification de mise à jour', err);
      broadcastUpdateStatus({
        state: 'error',
        error: 'La vérification de mise à jour a échoué.',
      });
    });

    const triggerCheck = () => {
      autoUpdater.checkForUpdates().catch((err) => {
        logError('Échec checkForUpdates', err);
      });
    };

    triggerCheck();
    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
    setInterval(triggerCheck, SIX_HOURS_MS).unref();
  } catch (err) {
    logError('Module electron-updater non initialisé', err);
  }
}

function sendZplOverTcp(ip, port, zplPayload) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(result);
    };

    socket.setTimeout(ZPL_TCP_TIMEOUT_MS);

    socket.once('timeout', () => {
      finish({
        ok: false,
        errorCode: 'ZPL_TIMEOUT',
        errorMessage: "Délai de connexion dépassé (5 s) vers l'imprimante Zebra TCP.",
      });
    });

    socket.once('error', (err) => {
      finish({
        ok: false,
        errorCode: 'ZPL_SOCKET_ERROR',
        errorMessage: `Erreur réseau Zebra TCP (${sanitizeLogMessage(err?.message || 'connexion refusée')}).`,
      });
    });

    socket.connect(port, ip, () => {
      socket.write(Buffer.from(zplPayload, 'utf8'), (writeErr) => {
        if (writeErr) {
          finish({
            ok: false,
            errorCode: 'ZPL_WRITE_ERROR',
            errorMessage: "Échec de l'envoi du flux ZPL à l'imprimante.",
          });
          return;
        }
        socket.end(() => {
          finish({ ok: true });
        });
      });
    });
  });
}

function sendZplToRawSystemPrinter(printerName, zplPayload) {
  return new Promise((resolve) => {
    if (process.platform === 'linux' || process.platform === 'darwin') {
      const child = execFile(
        'lp',
        ['-d', printerName, '-o', 'raw'],
        { timeout: ZPL_TCP_TIMEOUT_MS },
        (err) => {
          if (err) {
            resolve({
              ok: false,
              errorCode: 'ZPL_RAW_LP_FAILED',
              errorMessage: `Échec d'impression brute CUPS (${sanitizeLogMessage(err.message)}).`,
            });
          } else {
            resolve({ ok: true });
          }
        }
      );
      if (child.stdin) {
        child.stdin.write(Buffer.from(zplPayload, 'utf8'));
        child.stdin.end();
      }
      return;
    }

    resolve({
      ok: false,
      errorCode: 'ZPL_RAW_UNSUPPORTED_ON_OS',
      errorMessage:
        'Sur Windows, utilisez le mode Réseau TCP (port 9100) pour envoyer du ZPL brut sans pilote intermédiaire.',
    });
  });
}

function assertAuthorizedSender(event) {
  const senderUrl = event?.senderFrame?.url || event?.sender?.getURL?.() || '';
  return isAllowedIpcSender(senderUrl);
}

function registerIpcHandlers() {
  ipcMain.handle('tot:list-printers', async (event) => {
    if (!assertAuthorizedSender(event)) return [];
    try {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return [];
      }
      const printers = await mainWindow.webContents.getPrintersAsync();
      return (Array.isArray(printers) ? printers : []).map((p) => ({
        name: String(p.name || ''),
        displayName: String(p.displayName || p.name || ''),
        description: String(p.description || ''),
        status: Number(p.status || 0),
        isDefault: Boolean(p.isDefault),
      }));
    } catch (err) {
      logError('Impossible de récupérer la liste des imprimantes', err);
      return [];
    }
  });

  ipcMain.handle('tot:get-print-settings', async (event) => {
    if (!assertAuthorizedSender(event)) return sanitizePrintSettings(null);
    const raw = readJsonFileSafe(getPrintSettingsPath());
    const settings = sanitizePrintSettings(raw);

    if (!settings.printerName && mainWindow && !mainWindow.isDestroyed()) {
      try {
        const printers = await mainWindow.webContents.getPrintersAsync();
        const defaultPrinter = (Array.isArray(printers) ? printers : []).find((p) => p.isDefault);
        if (defaultPrinter?.name) {
          settings.printerName = String(defaultPrinter.name);
        } else if (printers?.[0]?.name) {
          settings.printerName = String(printers[0].name);
        }
      } catch {
        // Ignorer si aucune imprimante n'est détectée
      }
    }
    return settings;
  });

  ipcMain.handle('tot:set-print-settings', async (event, rawSettings) => {
    if (!assertAuthorizedSender(event)) {
      return { ok: false, settings: sanitizePrintSettings(null) };
    }
    const clean = sanitizePrintSettings(rawSettings);
    const saved = writeJsonFileSafe(getPrintSettingsPath(), clean);
    return { ok: saved, settings: clean };
  });

  ipcMain.handle('tot:get-zpl-settings', async (event) => {
    if (!assertAuthorizedSender(event)) return sanitizeZplSettings(null);
    return sanitizeZplSettings(readJsonFileSafe(getZplSettingsPath()));
  });

  ipcMain.handle('tot:set-zpl-settings', async (event, rawSettings) => {
    if (!assertAuthorizedSender(event)) {
      return { ok: false, settings: sanitizeZplSettings(null) };
    }
    const clean = sanitizeZplSettings(rawSettings);
    const saved = writeJsonFileSafe(getZplSettingsPath(), clean);
    return { ok: saved, settings: clean };
  });

  ipcMain.handle('tot:print-zpl-raw', async (event, rawPayload) => {
    if (!assertAuthorizedSender(event)) {
      return { ok: false, errorCode: 'UNAUTHORIZED_SENDER', errorMessage: 'Origine IPC non autorisée.' };
    }

    let availablePrinterNames = [];
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        const printers = await mainWindow.webContents.getPrintersAsync();
        availablePrinterNames = (Array.isArray(printers) ? printers : [])
          .map((p) => String(p.name || '').trim())
          .filter(Boolean);
      } catch {
        availablePrinterNames = [];
      }
    }

    const validation = validateZplPrintPayload(rawPayload, availablePrinterNames);
    if (!validation.ok) {
      return {
        ok: false,
        errorCode: validation.errorCode,
        errorMessage: validation.errorMessage,
      };
    }

    const { zpl, transport, host, port, rawPrinterName } = validation.value;
    const lockKey = transport === 'tcp' ? `tcp:${host}:${port}` : `raw:${rawPrinterName}`;

    if (activeZplPrinterLocks.has(lockKey)) {
      return {
        ok: false,
        errorCode: 'ZPL_PRINTER_BUSY',
        errorMessage: "Une impression ZPL est déjà en cours sur cette imprimante.",
      };
    }

    activeZplPrinterLocks.add(lockKey);
    try {
      const result =
        transport === 'tcp'
          ? await sendZplOverTcp(host, port, zpl)
          : await sendZplToRawSystemPrinter(rawPrinterName, zpl);
      if (result.ok) {
        logInfo(`Étiquette ZPL envoyée (${lockKey})`);
      }
      return result;
    } finally {
      activeZplPrinterLocks.delete(lockKey);
    }
  });

  ipcMain.handle('tot:test-zpl-printer', async (event, rawConfig) => {
    if (!assertAuthorizedSender(event)) {
      return { ok: false, errorCode: 'UNAUTHORIZED_SENDER', errorMessage: 'Origine IPC non autorisée.' };
    }
    const testZpl = [
      '^XA',
      '^CI28',
      '^PW400',
      '^LL240',
      '^FO24,24^GB352,192,2^FS',
      '^FO40,48^A0N,28,28^FDTOT STOCK - TEST ZPL^FS',
      '^FO40,92^A0N,20,20^FDImprimante thermique prete^FS',
      '^FO40,130^BQN,2,4^FDLA,TOT-ZPL-OK^FS',
      '^XZ',
    ].join('\n');

    let availablePrinterNames = [];
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        const printers = await mainWindow.webContents.getPrintersAsync();
        availablePrinterNames = (Array.isArray(printers) ? printers : [])
          .map((p) => String(p.name || '').trim())
          .filter(Boolean);
      } catch {
        availablePrinterNames = [];
      }
    }

    const validation = validateZplPrintPayload(
      { ...(rawConfig || {}), zpl: testZpl },
      availablePrinterNames
    );
    if (!validation.ok) {
      return {
        ok: false,
        errorCode: validation.errorCode,
        errorMessage: validation.errorMessage,
      };
    }

    const { zpl, transport, host, port, rawPrinterName } = validation.value;
    return transport === 'tcp'
      ? sendZplOverTcp(host, port, zpl)
      : sendZplToRawSystemPrinter(rawPrinterName, zpl);
  });

  ipcMain.handle('tot:get-system-settings', async (event) => {
    if (!assertAuthorizedSender(event)) return sanitizeDesktopSystemSettings(null);
    return getCurrentSystemSettings();
  });

  ipcMain.handle('tot:set-system-settings', async (event, rawSettings) => {
    if (!assertAuthorizedSender(event)) {
      return { ok: false, settings: sanitizeDesktopSystemSettings(null) };
    }
    const clean = sanitizeDesktopSystemSettings(rawSettings);
    const saved = writeJsonFileSafe(getSystemSettingsPath(), clean);
    applyAutoLaunchSetting(clean.launchAtLogin);
    return { ok: saved, settings: clean };
  });

  ipcMain.handle('tot:show-notification', async (event, rawPayload) => {
    if (!assertAuthorizedSender(event)) {
      return { ok: false, errorCode: 'UNAUTHORIZED_SENDER' };
    }
    const sys = getCurrentSystemSettings();
    if (!sys.notificationsEnabled) {
      return { ok: false, errorCode: 'NOTIFICATIONS_DISABLED' };
    }

    const validation = sanitizeNotificationPayload(rawPayload);
    if (!validation.ok) {
      return {
        ok: false,
        errorCode: validation.error,
      };
    }

    const { title, body, route, dedupeKey } = validation.value;
    const rateCheck = notificationRateLimiter.canSend(dedupeKey);
    if (!rateCheck.allowed) {
      return { ok: false, errorCode: rateCheck.reason };
    }

    try {
      if (Notification.isSupported()) {
        const notif = new Notification({
          title,
          body,
          silent: false,
        });
        notif.on('click', () => {
          sendAppCommandToMain(`navigate:${route}`);
        });
        notif.show();
      }
      return { ok: true };
    } catch (err) {
      logError("Impossible d'afficher la notification système", err);
      return { ok: false, errorCode: 'NOTIFICATION_FAILED' };
    }
  });

  ipcMain.handle('tot:open-secondary-window', async (event, rawPayload) => {
    if (!assertAuthorizedSender(event)) {
      return { ok: false, errorMessage: 'Origine IPC non autorisée.' };
    }
    const route = typeof rawPayload?.route === 'string' ? rawPayload.route : 'inventory';
    return openSecondaryWindow(route);
  });

  ipcMain.handle('tot:update-tray-status', async (event, rawStatus) => {
    if (!assertAuthorizedSender(event)) return { ok: false };
    currentTrayStatus = {
      pendingCount: Math.max(0, Number(rawStatus?.pendingCount) || 0),
      paused: Boolean(rawStatus?.paused),
      stationName: typeof rawStatus?.stationName === 'string' ? rawStatus.stationName.slice(0, 80) : '',
    };
    updateTrayContextMenu();
    return { ok: true };
  });

  ipcMain.handle('tot:set-menu-locale', async (event, rawLocale) => {
    if (!assertAuthorizedSender(event)) return { ok: false };
    const nextLocale = ['fr', 'en', 'nl'].includes(rawLocale) ? rawLocale : 'fr';
    currentMenuLocale = nextLocale;
    buildLocalizedAppMenu(currentMenuLocale);
    updateTrayContextMenu();
    return { ok: true };
  });

  ipcMain.handle('tot:print-label', async (event, rawPayload) => {
    if (!assertAuthorizedSender(event)) {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED_SENDER',
        errorMessage: 'Origine IPC non autorisée.',
      };
    }
    if (!mainWindow || mainWindow.isDestroyed()) {
      return {
        ok: false,
        errorCode: 'NO_MAIN_WINDOW',
        errorMessage: 'Fenêtre principale indisponible.',
      };
    }

    let availablePrinterNames = [];
    try {
      const printers = await mainWindow.webContents.getPrintersAsync();
      availablePrinterNames = (Array.isArray(printers) ? printers : [])
        .map((p) => String(p.name || '').trim())
        .filter(Boolean);
    } catch (err) {
      logError('Erreur lors de la lecture des imprimantes avant impression', err);
      return {
        ok: false,
        errorCode: 'PRINTER_QUERY_FAILED',
        errorMessage: 'Impossible de vérifier les imprimantes du système.',
      };
    }

    const validation = validatePrintLabelPayload(rawPayload, availablePrinterNames);
    if (!validation.ok) {
      return {
        ok: false,
        errorCode: validation.errorCode,
        errorMessage: validation.errorMessage,
      };
    }

    const {
      html,
      widthMicrons,
      heightMicrons,
      printerName,
      copies,
      silent,
    } = validation.value;

    const jobId = crypto.randomUUID();
    pendingPrintJobs.set(jobId, html);

    let printWin = null;
    let timeoutHandle = null;

    try {
      printWin = new BrowserWindow({
        show: false,
        width: 800,
        height: 600,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          javascript: false,
          devTools: false,
        },
      });

      lockWebContentsNavigation(printWin.webContents);

      const printPromise = new Promise((resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error('PRINT_TIMEOUT'));
        }, PRINT_TIMEOUT_MS);

        printWin.webContents.once('did-fail-load', (_ev, errorCode, errorDesc) => {
          reject(new Error(`LOAD_FAILED_${errorCode}_${errorDesc}`));
        });

        printWin.webContents.once('did-finish-load', () => {
          printWin.webContents.print(
            {
              silent,
              printBackground: true,
              deviceName: printerName,
              copies,
              margins: { marginType: 'none' },
              pageSize: {
                width: widthMicrons,
                height: heightMicrons,
              },
            },
            (success, failureReason) => {
              if (success) {
                resolve({ ok: true });
              } else {
                reject(new Error(failureReason || 'PRINT_REJECTED'));
              }
            }
          );
        });

        printWin.loadURL(`${APP_PROTOCOL_ORIGIN}/__print_job__/${jobId}.html`).catch(reject);
      });

      const result = await printPromise;
      logInfo(
        `Étiquette imprimée sur "${printerName}" (copies=${copies}, silent=${silent}, ${widthMicrons}x${heightMicrons} µm)`
      );
      return result;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err || 'UNKNOWN');
      logError(`Échec d'impression sur "${printerName}"`, err);
      const isTimeout = reason === 'PRINT_TIMEOUT';
      return {
        ok: false,
        errorCode: isTimeout ? 'PRINT_TIMEOUT' : 'PRINT_FAILED',
        errorMessage: isTimeout
          ? "Délai d'impression dépassé (30 secondes). Vérifiez que l'imprimante est allumée et connectée."
          : `L'impression a échoué (${sanitizeLogMessage(reason)}).`,
      };
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      pendingPrintJobs.delete(jobId);
      if (printWin && !printWin.isDestroyed()) {
        printWin.destroy();
      }
    }
  });

  ipcMain.handle('tot:open-external', async (event, rawUrl) => {
    if (!assertAuthorizedSender(event)) {
      return { ok: false, errorMessage: 'Origine IPC non autorisée.' };
    }
    if (!isAllowedExternalUrl(rawUrl)) {
      return {
        ok: false,
        errorMessage: 'Seuls les liens externes sécurisés (https://) sont autorisés.',
      };
    }
    try {
      await shell.openExternal(rawUrl.trim());
      return { ok: true };
    } catch (err) {
      logError('Impossible d’ouvrir le lien externe', err);
      return {
        ok: false,
        errorMessage: "Impossible d'ouvrir le navigateur système.",
      };
    }
  });

  ipcMain.handle('tot:get-update-status', async (event) => {
    if (!assertAuthorizedSender(event)) return currentUpdateStatus;
    return currentUpdateStatus;
  });

  ipcMain.handle('tot:quit-and-install', async (event) => {
    if (!assertAuthorizedSender(event)) {
      return { ok: false, errorMessage: 'Origine IPC non autorisée.' };
    }
    if (autoUpdaterInstance && currentUpdateStatus.state === 'downloaded') {
      isQuitting = true;
      setImmediate(() => {
        autoUpdaterInstance.quitAndInstall(false, true);
      });
      return { ok: true };
    }
    return {
      ok: false,
      errorMessage: "Aucune mise à jour prête à être installée.",
    };
  });
}

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  configurePermissions();
  registerAppProtocol();
  registerIpcHandlers();
  createMainWindow();
  setupSystemTray();
  setupOptionalAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on('window-all-closed', () => {
  const sys = getCurrentSystemSettings();
  if (sys.keepInTrayOnClose && !isQuitting) {
    return;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
