import path from 'node:path';

export const MAX_PRINT_HTML_BYTES = 1024 * 1024; // 1 Mo
export const MIN_PAGE_SIZE_MM = 20;
export const MAX_PAGE_SIZE_MM = 300;
export const MIN_PRINT_COPIES = 1;
export const MAX_PRINT_COPIES = 100;
export const PRINT_TIMEOUT_MS = 30_000; // 30 secondes
export const APP_PROTOCOL_SCHEME = 'app';
export const APP_PROTOCOL_HOST = 'tot';
export const APP_PROTOCOL_ORIGIN = 'app://tot';

/**
 * Vérifie si une URL de navigation interne est autorisée dans la fenêtre principale.
 * Seule l'origine locale `app://tot` est autorisée.
 */
export function isAllowedNavigationUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return false;
  }
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'app:') {
      return false;
    }
    if (parsed.hostname.toLowerCase() !== APP_PROTOCOL_HOST) {
      return false;
    }
    if (parsed.username || parsed.password || parsed.port) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Vérifie si une URL externe peut être ouverte dans le navigateur du système via `shell.openExternal`.
 * Règle impérative : uniquement `https:`, sans identifiants (`user:pass@`), avec un nom d'hôte valide.
 * Refuse `http:`, `file:`, `javascript:`, `data:`, `vbscript:`, `app:`, etc.
 */
export function isAllowedExternalUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return false;
  }
  const trimmed = rawUrl.trim();
  if (trimmed.length > 2048) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') {
      return false;
    }
    if (parsed.username || parsed.password) {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname || !hostname.includes('.') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Vérifie si une demande de permission Chromium est autorisée.
 * Seule la permission `media` (caméra pour le scan de codes-barres / QR) est accordée
 * et uniquement pour l'origine `app://tot`.
 */
export function isAllowedPermissionRequest(permission, requestingUrl) {
  if (permission !== 'media') {
    return false;
  }
  return isAllowedNavigationUrl(requestingUrl);
}

/**
 * Résout de manière sûre un chemin demandé via `app://tot/...` vers un fichier situé
 * strictement à l'intérieur de `distRoot`.
 * Retourne `{ ok: true, filePath, relativePath }` ou `{ ok: false, error }`.
 */
export function resolveSafeProtocolPath(distRoot, requestUrl) {
  if (typeof distRoot !== 'string' || !distRoot.trim()) {
    return { ok: false, error: 'INVALID_DIST_ROOT' };
  }
  if (!isAllowedNavigationUrl(requestUrl)) {
    return { ok: false, error: 'FORBIDDEN_ORIGIN' };
  }

  // Vérifier la présence de séquences de traversée dans l'URL brute AVANT que `new URL()` ne réduise `/../`
  const rawAfterOrigin = String(requestUrl).trim().replace(/^app:\/\/tot/i, '');
  if (
    /(?:^|[\\/])\.\.?(?:[\\/?#]|$)/.test(rawAfterOrigin) ||
    /%2e/i.test(rawAfterOrigin) ||
    /%2f/i.test(rawAfterOrigin) ||
    /%5c/i.test(rawAfterOrigin) ||
    rawAfterOrigin.includes('\\') ||
    rawAfterOrigin.includes('\0') ||
    /%00/i.test(rawAfterOrigin)
  ) {
    return { ok: false, error: 'PATH_TRAVERSAL_BLOCKED' };
  }

  let parsed;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return { ok: false, error: 'INVALID_URL' };
  }

  let rawPathname = parsed.pathname || '/';
  // Interdire les octets nuls ou séquences encodées dangereuses avant et après décodage
  if (rawPathname.includes('\0') || /%00/i.test(rawPathname) || /%2f/i.test(rawPathname) || /%5c/i.test(rawPathname)) {
    return { ok: false, error: 'PATH_TRAVERSAL_BLOCKED' };
  }

  let decodedPathname;
  try {
    decodedPathname = decodeURIComponent(rawPathname);
  } catch {
    return { ok: false, error: 'INVALID_URI_ENCODING' };
  }

  if (decodedPathname.includes('\0') || decodedPathname.includes('\\')) {
    return { ok: false, error: 'PATH_TRAVERSAL_BLOCKED' };
  }

  // Vérifier les segments bruts pour bloquer explicitements `..`
  const segments = decodedPathname.split('/').filter(Boolean);
  if (segments.some((seg) => seg === '..' || seg === '.')) {
    return { ok: false, error: 'PATH_TRAVERSAL_BLOCKED' };
  }

  const normalizedRel = segments.length === 0 ? 'index.html' : segments.join('/');
  const resolvedRoot = path.resolve(distRoot);
  const resolvedTarget = path.resolve(resolvedRoot, normalizedRel);

  const relativeToRoot = path.relative(resolvedRoot, resolvedTarget);
  if (
    !relativeToRoot ||
    relativeToRoot.startsWith('..') ||
    path.isAbsolute(relativeToRoot)
  ) {
    return { ok: false, error: 'PATH_TRAVERSAL_BLOCKED' };
  }

  return {
    ok: true,
    filePath: resolvedTarget,
    relativePath: relativeToRoot.split(path.sep).join('/'),
  };
}

/**
 * Extrait et valide les hôtes supplémentaires définis dans `VITE_ALLOWED_SUPABASE_HOSTS`.
 */
export function parseAllowedSupabaseHosts(allowedHostsEnv = '') {
  if (typeof allowedHostsEnv !== 'string' || !allowedHostsEnv.trim()) {
    return [];
  }
  const EXAMPLE_PLACEHOLDERS = new Set([
    'abcd1234.supabase.co',
    '*.mon-entreprise.fr',
    '*.exemple.com',
    '*.example.com',
  ]);

  const results = [];
  const parts = allowedHostsEnv
    .replace(/^["']+|["']+$/g, '')
    .split(',');

  for (const part of parts) {
    const clean = part.trim().replace(/^["']+|["']+$/g, '').trim().toLowerCase();
    if (
      !clean ||
      clean === 'undefined' ||
      clean === 'null' ||
      clean === 'false' ||
      EXAMPLE_PLACEHOLDERS.has(clean)
    ) {
      continue;
    }
    // Autoriser uniquement les motifs d'hôtes valides : `domaine.tld` ou `*.domaine.tld`
    if (/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(clean)) {
      if (!results.includes(clean)) {
        results.push(clean);
      }
    }
  }
  return results;
}

/**
 * Construit l'en-tête Content-Security-Policy strict pour `app://tot`.
 * Aucun `unsafe-eval` n'est autorisé.
 */
export function buildDesktopCsp(allowedHostsEnv = '') {
  const extraHosts = parseAllowedSupabaseHosts(allowedHostsEnv);
  const connectSources = [
    "'self'",
    'app:',
    'https://*.supabase.co',
    'wss://*.supabase.co',
  ];

  for (const host of extraHosts) {
    const httpsSource = `https://${host}`;
    const wssSource = `wss://${host}`;
    if (!connectSources.includes(httpsSource)) {
      connectSources.push(httpsSource);
    }
    if (!connectSources.includes(wssSource)) {
      connectSources.push(wssSource);
    }
  }

  const directives = [
    "default-src 'self' app:",
    "script-src 'self' app:",
    "style-src 'self' app: 'unsafe-inline'",
    "img-src 'self' app: data: blob: https:",
    "font-src 'self' app: data:",
    `connect-src ${connectSources.join(' ')}`,
    "media-src 'self' app: blob: mediastream:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  return directives.join('; ');
}

/**
 * Valide tous les paramètres d'impression reçus par IPC (`printLabel`) avant appel à `webContents.print`.
 * Retourne `{ ok: true, value: { html, pageWidthMm, pageHeightMm, widthMicrons, heightMicrons, printerName, copies, silent } }`
 * ou `{ ok: false, errorCode, errorMessage }`.
 */
export function validatePrintLabelPayload(payload, availablePrinterNames = []) {
  if (!payload || typeof payload !== 'object') {
    return {
      ok: false,
      errorCode: 'INVALID_PAYLOAD',
      errorMessage: "Paramètres d'impression manquants ou invalides.",
    };
  }

  const { html, pageWidthMm, pageHeightMm, printerName, copies, silent } = payload;

  // 1. Validation du HTML (chaîne non vide <= 1 Mo en UTF-8)
  if (typeof html !== 'string' || !html.trim()) {
    return {
      ok: false,
      errorCode: 'EMPTY_HTML',
      errorMessage: "Le contenu HTML de l'étiquette est vide.",
    };
  }

  const byteLength = Buffer.byteLength(html, 'utf8');
  if (byteLength > MAX_PRINT_HTML_BYTES) {
    return {
      ok: false,
      errorCode: 'HTML_TOO_LARGE',
      errorMessage: `Le document d'impression dépasse la taille maximale autorisée (1 Mo).`,
    };
  }

  // 2. Validation des dimensions de page en millimètres (nombres finis entre 20 et 300 mm)
  if (
    typeof pageWidthMm !== 'number' ||
    !Number.isFinite(pageWidthMm) ||
    pageWidthMm < MIN_PAGE_SIZE_MM ||
    pageWidthMm > MAX_PAGE_SIZE_MM
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PAGE_WIDTH',
      errorMessage: `Largeur de page invalide (${String(pageWidthMm)} mm). Valeur attendue entre ${MIN_PAGE_SIZE_MM} et ${MAX_PAGE_SIZE_MM} mm.`,
    };
  }

  if (
    typeof pageHeightMm !== 'number' ||
    !Number.isFinite(pageHeightMm) ||
    pageHeightMm < MIN_PAGE_SIZE_MM ||
    pageHeightMm > MAX_PAGE_SIZE_MM
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_PAGE_HEIGHT',
      errorMessage: `Hauteur de page invalide (${String(pageHeightMm)} mm). Valeur attendue entre ${MIN_PAGE_SIZE_MM} et ${MAX_PAGE_SIZE_MM} mm.`,
    };
  }

  // 3. Validation du nombre de copies (entier entre 1 et 100)
  if (
    typeof copies !== 'number' ||
    !Number.isInteger(copies) ||
    copies < MIN_PRINT_COPIES ||
    copies > MAX_PRINT_COPIES
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_COPIES',
      errorMessage: `Nombre de copies invalide (${String(copies)}). Entier attendu entre ${MIN_PRINT_COPIES} et ${MAX_PRINT_COPIES}.`,
    };
  }

  // 4. Validation du booléen `silent`
  if (typeof silent !== 'boolean') {
    return {
      ok: false,
      errorCode: 'INVALID_SILENT_FLAG',
      errorMessage: "L'option d'impression silencieuse doit être un booléen.",
    };
  }

  // 5. Validation du nom d'imprimante dans la liste retournée par `getPrintersAsync()`
  if (typeof printerName !== 'string' || !printerName.trim() || printerName.length > 256) {
    return {
      ok: false,
      errorCode: 'MISSING_PRINTER_NAME',
      errorMessage: 'Veuillez sélectionner une imprimante valide.',
    };
  }

  const trimmedPrinter = printerName.trim();
  const printerList = Array.isArray(availablePrinterNames) ? availablePrinterNames : [];
  if (!printerList.includes(trimmedPrinter)) {
    return {
      ok: false,
      errorCode: 'PRINTER_NOT_FOUND',
      errorMessage: `L'imprimante sélectionnée (« ${trimmedPrinter} ») est introuvable sur ce poste.`,
    };
  }

  // Conversion en microns pour Chromium/Electron (1 mm = 1000 microns)
  const widthMicrons = Math.round(pageWidthMm * 1000);
  const heightMicrons = Math.round(pageHeightMm * 1000);

  return {
    ok: true,
    value: {
      html,
      pageWidthMm,
      pageHeightMm,
      widthMicrons,
      heightMicrons,
      printerName: trimmedPrinter,
      copies,
      silent,
    },
  };
}

/**
 * Valide et normalise les préférences d'impression stockées dans `userData/print-settings.json`.
 */
export function sanitizePrintSettings(raw) {
  if (!raw || typeof raw !== 'object') {
    return { printerName: '', silent: true };
  }
  const printerName =
    typeof raw.printerName === 'string' && raw.printerName.trim().length <= 256
      ? raw.printerName.trim()
      : '';
  const silent = typeof raw.silent === 'boolean' ? raw.silent : true;
  return { printerName, silent };
}

/**
 * Valide l'état de la fenêtre sauvegardé dans `userData/window-state.json`.
 */
export function sanitizeWindowBounds(raw) {
  const defaults = { width: 1280, height: 820, isMaximized: false };
  if (!raw || typeof raw !== 'object') {
    return defaults;
  }
  const width =
    typeof raw.width === 'number' && Number.isFinite(raw.width) && raw.width >= 900 && raw.width <= 7680
      ? Math.round(raw.width)
      : defaults.width;
  const height =
    typeof raw.height === 'number' && Number.isFinite(raw.height) && raw.height >= 600 && raw.height <= 4320
      ? Math.round(raw.height)
      : defaults.height;
  const x =
    typeof raw.x === 'number' && Number.isFinite(raw.x) && raw.x >= -10000 && raw.x <= 10000
      ? Math.round(raw.x)
      : undefined;
  const y =
    typeof raw.y === 'number' && Number.isFinite(raw.y) && raw.y >= -10000 && raw.y <= 10000
      ? Math.round(raw.y)
      : undefined;
  const isMaximized = Boolean(raw.isMaximized);

  return { width, height, x, y, isMaximized };
}

/**
 * Masque les jetons, clés API, codes PIN et balises HTML dans les journaux du processus principal.
 */
export function sanitizeLogMessage(input) {
  if (typeof input !== 'string') {
    return '';
  }
  return input
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED_TOKEN]')
    .replace(/(apikey|api_key|token|secret|password|pin)\s*[:=]\s*["']?[^"'\s&]+["']?/gi, '$1=[REDACTED]')
    .replace(/<[^>]+>/g, '[HTML_STRIPPED]')
    .slice(0, 500);
}
