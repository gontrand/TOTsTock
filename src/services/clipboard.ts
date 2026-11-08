import { getDesktopBridge } from './desktopBridge';

export const CLIPBOARD_COPY_SUCCESS_LABEL = 'Copié ✓';
export const CLIPBOARD_COPY_FAILURE_LABEL =
  'Copie impossible — sélectionnez le texte et faites Ctrl+C';

/**
 * Copie un texte dans le presse-papiers de manière fiable sur Web/PWA, APK (Capacitor) et Desktop (Electron app://tot).
 * Ordre de tentative :
 *   1. Pont natif Electron `window.totDesktop.copyText(text)` (IPC `tot:copy-text` -> `clipboard.writeText`)
 *   2. API standard `navigator.clipboard.writeText(text)`
 *   3. Repli DOM `document.execCommand('copy')` via un `<textarea>` hors écran
 *
 * Ne lève jamais d'exception et retourne `true` si la copie a réussi, `false` sinon.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof text !== 'string' || text.length === 0) {
    return false;
  }

  // 1. Pont Electron Desktop (app://tot)
  try {
    const winDesktop =
      typeof window !== 'undefined'
        ? (window as any).totDesktop
        : (globalThis as any)?.window?.totDesktop || (globalThis as any)?.totDesktop;
    const bridge = getDesktopBridge() || winDesktop;
    if (bridge && typeof bridge.copyText === 'function') {
      const res = await bridge.copyText(text);
      if (res && res.ok === true) {
        return true;
      }
    }
  } catch {
    // Poursuivre vers l'étape 2
  }

  // 2. API Web Clipboard standard
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Poursuivre vers l'étape 3
  }

  // 3. Repli DOM execCommand('copy') via textarea temporaire
  try {
    if (typeof document !== 'undefined' && document.body && typeof document.createElement === 'function') {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '-9999px';
      textarea.style.left = '-9999px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, text.length);
      const ok = typeof document.execCommand === 'function' ? document.execCommand('copy') : false;
      document.body.removeChild(textarea);
      if (ok) {
        return true;
      }
    }
  } catch {
    // Échec complet
  }

  return false;
}
