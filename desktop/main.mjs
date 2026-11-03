import { app, BrowserWindow, ipcMain, Menu, protocol, session, shell } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_PROTOCOL_ORIGIN,
  APP_PROTOCOL_SCHEME,
  buildDesktopCsp,
  isAllowedExternalUrl,
  isAllowedNavigationUrl,
  isAllowedPermissionRequest,
  PRINT_TIMEOUT_MS,
  resolveSafeProtocolPath,
  sanitizeLogMessage,
  sanitizePrintSettings,
  sanitizeWindowBounds,
  validatePrintLabelPayload,
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

// Verrou d'instance unique : une seule fenêtre principale à la fois
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

let mainWindow = null;
const pendingPrintJobs = new Map();

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
  // En mode packagé, `dist` est copié dans `resources/app-dist` (via extraResources) ou `../dist`
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

    // Route éphémère en mémoire pour les travaux d'impression (aucune écriture disque ni journalisation du HTML)
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
      // Repli SPA vers index.html uniquement si le chemin ne cible pas une ressource statique absente
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
    autoHideMenuBar: !isDevMode,
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

  if (!isDevMode) {
    Menu.setApplicationMenu(null);
  }

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
  mainWindow.on('close', saveWindowState);

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
    // Aucune requête sortante si l'URL de mise à jour n'est pas configurée
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

function registerIpcHandlers() {
  ipcMain.handle('tot:list-printers', async () => {
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

  ipcMain.handle('tot:get-print-settings', async () => {
    const raw = readJsonFileSafe(getPrintSettingsPath());
    const settings = sanitizePrintSettings(raw);

    // Si aucune imprimante n'est encore enregistrée, pré-sélectionner l'imprimante système par défaut
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

  ipcMain.handle('tot:set-print-settings', async (_event, rawSettings) => {
    const clean = sanitizePrintSettings(rawSettings);
    const saved = writeJsonFileSafe(getPrintSettingsPath(), clean);
    return { ok: saved, settings: clean };
  });

  ipcMain.handle('tot:print-label', async (_event, rawPayload) => {
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

  ipcMain.handle('tot:open-external', async (_event, rawUrl) => {
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

  ipcMain.handle('tot:get-update-status', async () => {
    return currentUpdateStatus;
  });

  ipcMain.handle('tot:quit-and-install', async () => {
    if (autoUpdaterInstance && currentUpdateStatus.state === 'downloaded') {
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

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
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
  setupOptionalAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
