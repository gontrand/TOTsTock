import { ZplDpi, ZplFormatMm } from './zplLabel';

export type DesktopPlatform = 'win32' | 'darwin' | 'linux';

export interface DesktopPrinterInfo {
  name: string;
  displayName: string;
  description: string;
  status: number;
  isDefault: boolean;
}

export interface DesktopPrintLabelParams {
  html: string;
  pageWidthMm: number;
  pageHeightMm: number;
  printerName: string;
  copies: number;
  silent: boolean;
}

export interface DesktopPrintResult {
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface DesktopPrintSettings {
  printerName: string;
  silent: boolean;
}

export type ZplTransportMode = 'tcp' | 'raw_queue';

export interface DesktopZplSettings {
  enabled: boolean;
  transport: ZplTransportMode;
  host: string;
  port: number;
  rawPrinterName: string;
  format: ZplFormatMm;
  dpi: ZplDpi;
  offsetXMm: number;
  offsetYMm: number;
  speed: number;
  darkness: number;
}

export interface DesktopSystemSettings {
  keepInTrayOnClose: boolean;
  launchAtLogin: boolean;
  notificationsEnabled: boolean;
  notifyOrdersWaitingApproval: boolean;
  notifyOrdersPendingPrep: boolean;
  notifyPrintJobFailed: boolean;
  notifyStockAlerts: boolean;
  printQueuePaused: boolean;
}

export interface DesktopUpdateStatus {
  enabled: boolean;
  state: 'idle' | 'checking' | 'downloading' | 'not-available' | 'downloaded' | 'error';
  version: string | null;
  error: string | null;
}

export interface DesktopNotificationPayload {
  title: string;
  body: string;
  route?: string;
  dedupeKey?: string;
}

export const DESKTOP_INTERNAL_ROUTES = [
  'dashboard',
  'inventory',
  'movements',
  'orders',
  'preparation',
  'print_station',
  'settings',
] as const;

export type DesktopInternalRouteId = (typeof DESKTOP_INTERNAL_ROUTES)[number];

export const DESKTOP_MENU_COMMANDS = [
  'new-product',
  'new-movement',
  'new-order',
  'import-csv',
  'export-csv',
  'print-labels',
  'focus-search',
  'command-palette',
  'refresh-data',
  'toggle-sidebar',
  'toggle-print-pause',
  'open-shortcuts',
  'open-docs',
  'open-about',
  'nav-dashboard',
  'nav-inventory',
  'nav-movements',
  'nav-orders',
  'nav-preparation',
  'nav-print-station',
  'nav-settings',
] as const;

export type DesktopMenuCommandId = (typeof DESKTOP_MENU_COMMANDS)[number];

export interface TotDesktopBridge {
  readonly isDesktop: true;
  readonly platform: DesktopPlatform;
  listPrinters: () => Promise<DesktopPrinterInfo[]>;
  printLabel: (params: DesktopPrintLabelParams) => Promise<DesktopPrintResult>;
  getPrintSettings: () => Promise<DesktopPrintSettings>;
  setPrintSettings: (
    settings: DesktopPrintSettings
  ) => Promise<{ ok: boolean; settings?: DesktopPrintSettings }>;
  openExternal: (url: string) => Promise<{ ok: boolean; errorMessage?: string }>;
  getUpdateStatus?: () => Promise<DesktopUpdateStatus>;
  quitAndInstallUpdate?: () => Promise<{ ok: boolean; errorMessage?: string }>;
  onUpdateStatus?: (callback: (status: DesktopUpdateStatus) => void) => () => void;
  // Lot 3 & Lot 4 additions
  printZplRaw?: (params: {
    zpl: string;
    transport?: ZplTransportMode;
    host?: string;
    port?: number;
    rawPrinterName?: string;
  }) => Promise<DesktopPrintResult>;
  testZplPrinter?: (params: {
    host: string;
    port: number;
  }) => Promise<{ ok: boolean; latencyMs?: number; errorMessage?: string }>;
  getZplSettings?: () => Promise<DesktopZplSettings>;
  setZplSettings?: (
    settings: Partial<DesktopZplSettings>
  ) => Promise<{ ok: boolean; settings?: DesktopZplSettings }>;
  getSystemSettings?: () => Promise<DesktopSystemSettings>;
  setSystemSettings?: (
    settings: Partial<DesktopSystemSettings>
  ) => Promise<{ ok: boolean; settings?: DesktopSystemSettings }>;
  showNotification?: (
    payload: DesktopNotificationPayload
  ) => Promise<{ ok: boolean; errorMessage?: string }>;
  openSecondaryWindow?: (route?: DesktopInternalRouteId | string) => Promise<{ ok: boolean; errorMessage?: string }>;
  updateTrayStatus?: (status: {
    pendingJobsCount: number;
    paused: boolean;
  }) => Promise<{ ok: boolean }>;
  setMenuLocale?: (locale: 'fr' | 'en' | 'nl') => Promise<{ ok: boolean }>;
  setWindowTheme?: (mode: 'light' | 'dark') => Promise<{ ok: boolean }>;
  showAppMenu?: () => Promise<{ ok: boolean }>;
  onMenuCommand?: (callback: (command: DesktopMenuCommandId) => void) => () => void;
  getOrCreateSafeStorageKey?: () => Promise<{
    ok: boolean;
    keyBase64?: string;
    errorMessage?: string;
  }>;
  clearSafeStorageKey?: () => Promise<{ ok: boolean }>;
  copyText?: (text: string) => Promise<{ ok: boolean; errorMessage?: string }>;
  onPowerResume?: (
    callback: (payload: { reason: 'resume' | 'unlock-screen'; ts: number }) => void
  ) => () => void;
}

declare global {
  interface Window {
    totDesktop?: TotDesktopBridge;
  }
}

export const DEFAULT_DESKTOP_ZPL_SETTINGS: DesktopZplSettings = {
  enabled: false,
  transport: 'tcp',
  host: '192.168.1.50',
  port: 9100,
  rawPrinterName: '',
  format: '50x30',
  dpi: 203,
  offsetXMm: 0,
  offsetYMm: 0,
  speed: 4,
  darkness: 15,
};

export const DEFAULT_DESKTOP_SYSTEM_SETTINGS: DesktopSystemSettings = {
  keepInTrayOnClose: false,
  launchAtLogin: false,
  notificationsEnabled: false,
  notifyOrdersWaitingApproval: true,
  notifyOrdersPendingPrep: true,
  notifyPrintJobFailed: true,
  notifyStockAlerts: true,
  printQueuePaused: false,
};

function getBridge(): TotDesktopBridge | null {
  const winObj: { totDesktop?: TotDesktopBridge } | undefined =
    typeof window !== 'undefined'
      ? window
      : (
          globalThis as unknown as {
            window?: { totDesktop?: TotDesktopBridge };
            totDesktop?: TotDesktopBridge;
          }
        ).window || (globalThis as unknown as { totDesktop?: TotDesktopBridge });

  if (!winObj || !winObj.totDesktop) {
    return null;
  }
  if (winObj.totDesktop.isDesktop !== true) {
    return null;
  }
  return winObj.totDesktop;
}

export function getDesktopBridge(): TotDesktopBridge | null {
  return getBridge();
}

/**
 * Indique si l'application tourne dans le conteneur bureau Electron (`window.totDesktop`).
 */
export function isDesktopApp(): boolean {
  return getBridge() !== null;
}

/**
 * Indique si le Service Worker PWA (`sw.js`) doit être enregistré.
 * Désactivé sur la version bureau (`isDesktop === true`) où l'application est déjà locale via `app://tot`.
 */
export function shouldRegisterServiceWorker(): boolean {
  return !isDesktopApp();
}

/**
 * Retourne la plateforme bureau (`win32`, `darwin`, `linux`) ou `null` sur le web / Android.
 */
export function getDesktopPlatform(): DesktopPlatform | null {
  const bridge = getBridge();
  return bridge ? bridge.platform : null;
}

/**
 * Retourne la liste des imprimantes système détectées par Electron (ou `[]` sur le web).
 */
export async function listDesktopPrinters(): Promise<DesktopPrinterInfo[]> {
  const bridge = getBridge();
  if (!bridge || typeof bridge.listPrinters !== 'function') {
    return [];
  }
  try {
    const list = await bridge.listPrinters();
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * Lit les préférences d'impression du poste (`printerName` et `silent`).
 */
export async function getDesktopPrintSettings(): Promise<DesktopPrintSettings> {
  const bridge = getBridge();
  if (!bridge || typeof bridge.getPrintSettings !== 'function') {
    return { printerName: '', silent: true };
  }
  try {
    const res = await bridge.getPrintSettings();
    return {
      printerName: typeof res?.printerName === 'string' ? res.printerName : '',
      silent: typeof res?.silent === 'boolean' ? res.silent : true,
    };
  } catch {
    return { printerName: '', silent: true };
  }
}

/**
 * Enregistre les préférences d'impression du poste (`printerName` et `silent`).
 */
export async function setDesktopPrintSettings(
  settings: DesktopPrintSettings
): Promise<boolean> {
  const bridge = getBridge();
  if (!bridge || typeof bridge.setPrintSettings !== 'function') {
    return false;
  }
  try {
    const res = await bridge.setPrintSettings({
      printerName: String(settings.printerName || '').trim(),
      silent: Boolean(settings.silent),
    });
    return Boolean(res?.ok);
  } catch {
    return false;
  }
}

/**
 * Lance l'impression d'une étiquette ou d'une planche via le pont bureau Electron.
 */
export async function printDesktopLabel(
  params: DesktopPrintLabelParams
): Promise<DesktopPrintResult> {
  const bridge = getBridge();
  if (!bridge || typeof bridge.printLabel !== 'function') {
    return {
      ok: false,
      errorCode: 'NOT_DESKTOP',
      errorMessage: 'Fonctionnalité réservée à la version bureau.',
    };
  }
  try {
    const res = await bridge.printLabel(params);
    if (!res || typeof res !== 'object') {
      return {
        ok: false,
        errorCode: 'EMPTY_RESPONSE',
        errorMessage: "Réponse invalide du service d'impression bureau.",
      };
    }
    return res;
  } catch (err: any) {
    return {
      ok: false,
      errorCode: 'IPC_ERROR',
      errorMessage: err?.message || "Erreur de communication avec le service d'impression.",
    };
  }
}

/**
 * Envoie du code ZPL II brut à une imprimante Zebra (TCP 9100 ou file système raw).
 */
export async function printDesktopZplRaw(params: {
  zpl: string;
  transport?: ZplTransportMode;
  host?: string;
  port?: number;
  rawPrinterName?: string;
}): Promise<DesktopPrintResult> {
  const bridge = getBridge();
  if (!bridge || typeof bridge.printZplRaw !== 'function') {
    return {
      ok: false,
      errorCode: 'NOT_DESKTOP',
      errorMessage: 'Impression directe ZPL réservée à la version bureau installée.',
    };
  }
  try {
    return await bridge.printZplRaw(params);
  } catch (err: any) {
    return {
      ok: false,
      errorCode: 'ZPL_IPC_ERROR',
      errorMessage: err?.message || "Erreur lors de l'envoi ZPL.",
    };
  }
}

/**
 * Teste la connexion TCP vers une imprimante Zebra (port 9100..9102).
 */
export async function testDesktopZplPrinter(params: {
  host: string;
  port: number;
}): Promise<{ ok: boolean; latencyMs?: number; errorMessage?: string }> {
  const bridge = getBridge();
  if (!bridge || typeof bridge.testZplPrinter !== 'function') {
    return {
      ok: false,
      errorMessage: 'Test réseau TCP réservé à la version bureau installée.',
    };
  }
  try {
    return await bridge.testZplPrinter(params);
  } catch (err: any) {
    return {
      ok: false,
      errorMessage: err?.message || 'Impossible de joindre cette imprimante.',
    };
  }
}

const LOCAL_ZPL_SETTINGS_KEY = 'tot_desktop_zpl_settings';
const LOCAL_SYS_SETTINGS_KEY = 'tot_desktop_system_settings';

export async function getDesktopZplSettings(): Promise<DesktopZplSettings> {
  const bridge = getBridge();
  if (bridge && typeof bridge.getZplSettings === 'function') {
    try {
      const res = await bridge.getZplSettings();
      return { ...DEFAULT_DESKTOP_ZPL_SETTINGS, ...res };
    } catch {
      // Fallback
    }
  }
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LOCAL_ZPL_SETTINGS_KEY) : null;
    if (raw) {
      return { ...DEFAULT_DESKTOP_ZPL_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {
    // Ignore
  }
  return { ...DEFAULT_DESKTOP_ZPL_SETTINGS };
}

export async function setDesktopZplSettings(
  settings: Partial<DesktopZplSettings>
): Promise<DesktopZplSettings> {
  const current = await getDesktopZplSettings();
  const merged: DesktopZplSettings = { ...current, ...settings };
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LOCAL_ZPL_SETTINGS_KEY, JSON.stringify(merged));
    }
  } catch {
    // Ignore
  }
  const bridge = getBridge();
  if (bridge && typeof bridge.setZplSettings === 'function') {
    try {
      const res = await bridge.setZplSettings(merged);
      if (res?.settings) return { ...DEFAULT_DESKTOP_ZPL_SETTINGS, ...res.settings };
    } catch {
      // Ignore
    }
  }
  return merged;
}

export async function getDesktopSystemSettings(): Promise<DesktopSystemSettings> {
  const bridge = getBridge();
  if (bridge && typeof bridge.getSystemSettings === 'function') {
    try {
      const res = await bridge.getSystemSettings();
      return { ...DEFAULT_DESKTOP_SYSTEM_SETTINGS, ...res };
    } catch {
      // Fallback
    }
  }
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LOCAL_SYS_SETTINGS_KEY) : null;
    if (raw) {
      return { ...DEFAULT_DESKTOP_SYSTEM_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {
    // Ignore
  }
  return { ...DEFAULT_DESKTOP_SYSTEM_SETTINGS };
}

export async function setDesktopSystemSettings(
  settings: Partial<DesktopSystemSettings>
): Promise<DesktopSystemSettings> {
  const current = await getDesktopSystemSettings();
  const merged: DesktopSystemSettings = { ...current, ...settings };
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LOCAL_SYS_SETTINGS_KEY, JSON.stringify(merged));
    }
  } catch {
    // Ignore
  }
  const bridge = getBridge();
  if (bridge && typeof bridge.setSystemSettings === 'function') {
    try {
      const res = await bridge.setSystemSettings(merged);
      if (res?.settings) return { ...DEFAULT_DESKTOP_SYSTEM_SETTINGS, ...res.settings };
    } catch {
      // Ignore
    }
  }
  return merged;
}

/**
 * Déclenche une notification système native (Windows / macOS / Linux) si activée.
 */
export async function triggerDesktopSystemNotification(
  payload: DesktopNotificationPayload
): Promise<boolean> {
  const bridge = getBridge();
  if (!bridge || typeof bridge.showNotification !== 'function') {
    return false;
  }
  try {
    const res = await bridge.showNotification(payload);
    return Boolean(res?.ok);
  } catch {
    return false;
  }
}

/**
 * Ouvre une fenêtre secondaire dans l'application bureau (ou un nouvel onglet sur le web).
 */
export async function openDesktopSecondaryWindow(route = 'print_station'): Promise<boolean> {
  const bridge = getBridge();
  if (bridge && typeof bridge.openSecondaryWindow === 'function') {
    try {
      const res = await bridge.openSecondaryWindow(route);
      return Boolean(res?.ok);
    } catch {
      return false;
    }
  }
  return false;
}

export async function updateDesktopTrayStatus(status: {
  pendingJobsCount: number;
  paused: boolean;
}): Promise<void> {
  const bridge = getBridge();
  if (bridge && typeof bridge.updateTrayStatus === 'function') {
    try {
      await bridge.updateTrayStatus(status);
    } catch {
      // Ignore
    }
  }
}

export async function setDesktopMenuLocale(locale: 'fr' | 'en' | 'nl'): Promise<void> {
  const bridge = getBridge();
  if (bridge && typeof bridge.setMenuLocale === 'function') {
    try {
      await bridge.setMenuLocale(locale);
    } catch {
      // Ignore
    }
  }
}

export async function setDesktopWindowTheme(mode: 'light' | 'dark'): Promise<void> {
  const bridge = getBridge();
  if (bridge && typeof bridge.setWindowTheme === 'function') {
    try {
      await bridge.setWindowTheme(mode);
    } catch {
      // Ignore
    }
  }
}

export async function showDesktopAppMenu(): Promise<void> {
  const bridge = getBridge();
  if (bridge && typeof bridge.showAppMenu === 'function') {
    try {
      await bridge.showAppMenu();
    } catch {
      // Ignore
    }
  }
}

export function subscribeDesktopMenuCommand(
  callback: (command: DesktopMenuCommandId) => void
): () => void {
  const bridge = getBridge();
  if (!bridge || typeof bridge.onMenuCommand !== 'function') {
    return () => {};
  }
  return bridge.onMenuCommand(callback);
}

/**
 * Ouvre une URL externe (`https:` uniquement) dans le navigateur système.
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  const clean = (url || '').trim();
  if (!clean) return false;

  const bridge = getBridge();
  if (bridge && typeof bridge.openExternal === 'function') {
    try {
      const res = await bridge.openExternal(clean);
      return Boolean(res?.ok);
    } catch {
      return false;
    }
  }

  try {
    const parsed = new URL(clean);
    if (parsed.protocol !== 'https:') {
      return false;
    }
    if (typeof window !== 'undefined') {
      window.location.assign(clean);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Retourne les dimensions de page en millimètres (`pageWidthMm`, `pageHeightMm`)
 * correspondant à un format d'étiquette TOT Stock.
 */
export function getLabelPageDimensionsMm(format?: string | null): {
  pageWidthMm: number;
  pageHeightMm: number;
} {
  const normalized = String(format || '').trim().toLowerCase();
  if (normalized === 'thermal_50x30' || normalized === 'thermal') {
    return { pageWidthMm: 50, pageHeightMm: 30 };
  }
  return { pageWidthMm: 210, pageHeightMm: 297 };
}

/**
 * Récupère l'état courant des mises à jour automatiques de la version bureau.
 */
export async function getDesktopUpdateStatus(): Promise<DesktopUpdateStatus> {
  const bridge = getBridge();
  if (!bridge || typeof bridge.getUpdateStatus !== 'function') {
    return { enabled: false, state: 'idle', version: null, error: null };
  }
  try {
    return await bridge.getUpdateStatus();
  } catch {
    return { enabled: false, state: 'idle', version: null, error: null };
  }
}

/**
 * S'abonne aux changements d'état de mise à jour de la version bureau.
 */
export function subscribeDesktopUpdateStatus(
  callback: (status: DesktopUpdateStatus) => void
): () => void {
  const bridge = getBridge();
  if (!bridge || typeof bridge.onUpdateStatus !== 'function') {
    return () => {};
  }
  return bridge.onUpdateStatus(callback);
}

/**
 * Redémarre l'application bureau pour appliquer une mise à jour téléchargée.
 */
export async function quitAndInstallDesktopUpdate(): Promise<boolean> {
  const bridge = getBridge();
  if (!bridge || typeof bridge.quitAndInstallUpdate !== 'function') {
    return false;
  }
  try {
    const res = await bridge.quitAndInstallUpdate();
    return Boolean(res?.ok);
  } catch {
    return false;
  }
}

export async function getOrCreateDesktopSafeStorageKey(): Promise<string | null> {
  const bridge = getBridge();
  if (!bridge || typeof bridge.getOrCreateSafeStorageKey !== 'function') {
    return null;
  }
  try {
    const res = await bridge.getOrCreateSafeStorageKey();
    if (res?.ok && typeof res.keyBase64 === 'string' && res.keyBase64.length > 0) {
      return res.keyBase64;
    }
    return null;
  } catch {
    return null;
  }
}

export async function clearDesktopSafeStorageKey(): Promise<boolean> {
  const bridge = getBridge();
  if (!bridge || typeof bridge.clearSafeStorageKey !== 'function') {
    return false;
  }
  try {
    const res = await bridge.clearSafeStorageKey();
    return Boolean(res?.ok);
  } catch {
    return false;
  }
}

export async function copyDesktopText(text: string): Promise<boolean> {
  const bridge = getBridge();
  if (!bridge || typeof bridge.copyText !== 'function') {
    return false;
  }
  try {
    const res = await bridge.copyText(text);
    return Boolean(res?.ok);
  } catch {
    return false;
  }
}

export function subscribeDesktopPowerResume(
  callback: (payload: { reason: 'resume' | 'unlock-screen'; ts: number }) => void
): () => void {
  const bridge = getBridge();
  if (!bridge || typeof bridge.onPowerResume !== 'function') {
    return () => {};
  }
  return bridge.onPowerResume(callback);
}


