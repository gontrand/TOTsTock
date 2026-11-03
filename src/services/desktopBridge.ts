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

export interface DesktopUpdateStatus {
  enabled: boolean;
  state: 'idle' | 'checking' | 'downloading' | 'not-available' | 'downloaded' | 'error';
  version: string | null;
  error: string | null;
}

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
}

declare global {
  interface Window {
    totDesktop?: TotDesktopBridge;
  }
}

function getBridge(): TotDesktopBridge | null {
  const winObj: { totDesktop?: TotDesktopBridge } | undefined =
    typeof window !== 'undefined'
      ? window
      : (globalThis as unknown as { window?: { totDesktop?: TotDesktopBridge }; totDesktop?: TotDesktopBridge })
          .window || (globalThis as unknown as { totDesktop?: TotDesktopBridge });

  if (!winObj || !winObj.totDesktop) {
    return null;
  }
  if (winObj.totDesktop.isDesktop !== true) {
    return null;
  }
  return winObj.totDesktop;
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
 * - Rouleau thermique (`thermal_50x30` ou `thermal`) : 50 × 30 mm
 * - Planches A4 (`avery_70x37`, `avery_105x42`, `bin_90x50`, `avery_3x8`, `avery_2x7`, `bin_rack`, `catalog`) : 210 × 297 mm
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
