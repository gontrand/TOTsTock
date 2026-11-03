import path from 'node:path';

export const MAX_PRINT_HTML_BYTES = 1024 * 1024; // 1 Mo
export const MIN_PAGE_SIZE_MM = 20;
export const MAX_PAGE_SIZE_MM = 300;
export const MIN_PRINT_COPIES = 1;
export const MAX_PRINT_COPIES = 100;
export const PRINT_TIMEOUT_MS = 30_000; // 30 secondes
export const MAX_ZPL_BYTES = 65_536; // 64 Ko
export const ZPL_TCP_TIMEOUT_MS = 5_000; // 5 secondes
export const ALLOWED_ZPL_PORTS = [9100, 9101, 9102];
export const MAX_OPEN_WINDOWS = 3;
export const ALLOWED_INTERNAL_ROUTES = [
  'dashboard',
  'inventory',
  'movements',
  'orders',
  'preparation',
  'print_station',
  'settings',
];
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
 * Vérifie que l'émetteur d'un appel IPC (`event.senderFrame?.url`) appartient bien à `app://tot`.
 */
export function isAllowedIpcSender(senderUrl) {
  return isAllowedNavigationUrl(senderUrl);
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
 */
export function resolveSafeProtocolPath(distRoot, requestUrl) {
  if (typeof distRoot !== 'string' || !distRoot.trim()) {
    return { ok: false, error: 'INVALID_DIST_ROOT' };
  }
  if (!isAllowedNavigationUrl(requestUrl)) {
    return { ok: false, error: 'FORBIDDEN_ORIGIN' };
  }

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

  if (typeof silent !== 'boolean') {
    return {
      ok: false,
      errorCode: 'INVALID_SILENT_FLAG',
      errorMessage: "L'option d'impression silencieuse doit être un booléen.",
    };
  }

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
 * Valide l'adresse réseau et le port d'une imprimante Zebra ZPL (protection anti-SSRF Lot 4.1).
 * Autorise uniquement RFC 1918 (10.x, 172.16-31.x, 192.168.x), link-local (169.254.x)
 * ou un nom d'hôte local simple (hors localhost), et uniquement les ports [9100, 9101, 9102].
 */
export function isValidZplPrinterTarget(host, port = 9100) {
  if (typeof host !== 'string' || !host.trim()) {
    return { ok: false, error: 'INVALID_HOST' };
  }
  const cleanHost = host.trim();
  const numPort = Number(port);
  if (!Number.isInteger(numPort) || !ALLOWED_ZPL_PORTS.includes(numPort)) {
    return { ok: false, error: 'FORBIDDEN_PORT' };
  }
  if (/^localhost$/i.test(cleanHost)) {
    return { ok: false, error: 'LOCALHOST_FORBIDDEN' };
  }

  const ipv4Match = cleanHost.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = [
      Number(ipv4Match[1]),
      Number(ipv4Match[2]),
      Number(ipv4Match[3]),
      Number(ipv4Match[4]),
    ];
    if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) {
      return { ok: false, error: 'INVALID_IPV4' };
    }
    const [a, b] = octets;
    const isPrivate10 = a === 10;
    const isPrivate172 = a === 172 && b >= 16 && b <= 31;
    const isPrivate192 = a === 192 && b === 168;
    const isLinkLocal = a === 169 && b === 254;
    if (!isPrivate10 && !isPrivate172 && !isPrivate192 && !isLinkLocal) {
      return { ok: false, error: 'PUBLIC_OR_LOOPBACK_IP_FORBIDDEN' };
    }
    return { ok: true, host: cleanHost, port: numPort };
  }

  if (/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.local)?$/i.test(cleanHost)) {
    return { ok: true, host: cleanHost, port: numPort };
  }

  return { ok: false, error: 'INVALID_HOSTNAME_FORMAT' };
}

/**
 * Valide un payload d'impression ZPL brute (`desktop:print-zpl-raw`).
 */
export function validateZplPrintPayload(payload, availablePrinterNames = []) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, errorCode: 'INVALID_ZPL_PAYLOAD', errorMessage: 'Payload ZPL manquant.' };
  }
  const { zpl, transport = 'tcp', host, port = 9100, rawPrinterName } = payload;

  if (typeof zpl !== 'string' || !zpl.trim()) {
    return { ok: false, errorCode: 'EMPTY_ZPL', errorMessage: 'Le code ZPL est vide.' };
  }
  const byteLen = Buffer.byteLength(zpl, 'utf8');
  if (byteLen > MAX_ZPL_BYTES) {
    return {
      ok: false,
      errorCode: 'ZPL_TOO_LARGE',
      errorMessage: 'Le travail ZPL dépasse la taille maximale autorisée (64 Ko).',
    };
  }
  const trimmedZpl = zpl.trim();
  if (!trimmedZpl.startsWith('^XA') || !trimmedZpl.endsWith('^XZ')) {
    return {
      ok: false,
      errorCode: 'INVALID_ZPL_ENVELOPE',
      errorMessage: 'Le code ZPL doit commencer par ^XA et se terminer par ^XZ.',
    };
  }

  if (transport === 'raw_queue') {
    const cleanQueue = typeof rawPrinterName === 'string' ? rawPrinterName.trim() : '';
    if (!cleanQueue || !/^[a-zA-Z0-9._-]+$/.test(cleanQueue)) {
      return {
        ok: false,
        errorCode: 'INVALID_RAW_PRINTER_NAME',
        errorMessage: "Nom de file d'imprimante invalide pour l'envoi brut.",
      };
    }
    if (
      Array.isArray(availablePrinterNames) &&
      availablePrinterNames.length > 0 &&
      !availablePrinterNames.includes(cleanQueue)
    ) {
      return {
        ok: false,
        errorCode: 'RAW_PRINTER_NOT_FOUND',
        errorMessage: `Imprimante "${cleanQueue}" introuvable sur ce système.`,
      };
    }
    return {
      ok: true,
      value: { zpl: trimmedZpl, transport: 'raw_queue', rawPrinterName: cleanQueue },
    };
  }

  const targetCheck = isValidZplPrinterTarget(host, port);
  if (!targetCheck.ok) {
    return {
      ok: false,
      errorCode: targetCheck.error,
      errorMessage: `Cible d'imprimante Zebra refusée (${targetCheck.error}).`,
    };
  }

  return {
    ok: true,
    value: {
      zpl: trimmedZpl,
      transport: 'tcp',
      host: targetCheck.host,
      port: targetCheck.port,
    },
  };
}

/**
 * Assainit et valide une notification système native (Lot 4.3).
 */
export function sanitizeNotificationPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'INVALID_NOTIFICATION' };
  }
  const stripHtml = (s) =>
    String(s || '')
      .replace(/<[^>]*>/g, '')
      .replace(/[\x00-\x1F\x7F]/g, ' ')
      .trim();

  const title = stripHtml(payload.title).slice(0, 80);
  const body = stripHtml(payload.body).slice(0, 200);
  if (!title) {
    return { ok: false, error: 'EMPTY_TITLE' };
  }

  const rawRoute = typeof payload.route === 'string' ? payload.route.replace(/^\/+/, '').trim() : '';
  const route = ALLOWED_INTERNAL_ROUTES.includes(rawRoute) ? rawRoute : 'dashboard';
  const dedupeKey =
    typeof payload.dedupeKey === 'string' ? payload.dedupeKey.trim().slice(0, 120) : '';

  return {
    ok: true,
    value: { title, body, route, dedupeKey },
  };
}

/**
 * Limiteur de débit pour les notifications système natives (max 1 par dedupeKey, max 5 par minute).
 */
export function createNotificationRateLimiter({ maxPerMinute = 5, windowMs = 60_000 } = {}) {
  const seenKeys = new Set();
  const timestamps = [];

  return {
    canSend(dedupeKey, nowMs = Date.now()) {
      while (timestamps.length > 0 && nowMs - timestamps[0] >= windowMs) {
        timestamps.shift();
      }
      if (dedupeKey && seenKeys.has(dedupeKey)) {
        return { allowed: false, reason: 'DUPLICATE_KEY' };
      }
      if (timestamps.length >= maxPerMinute) {
        return { allowed: false, reason: 'RATE_LIMIT_EXCEEDED' };
      }
      if (dedupeKey) {
        seenKeys.add(dedupeKey);
      }
      timestamps.push(nowMs);
      return { allowed: true };
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
 * Valide et normalise les préférences d'impression Zebra ZPL stockées dans `userData/zpl-settings.json`.
 */
export function sanitizeZplSettings(raw) {
  const defaults = {
    enabled: false,
    transport: 'tcp',
    host: '192.168.1.200',
    port: 9100,
    rawPrinterName: '',
    dpi: 203,
    format: '50x30',
  };
  if (!raw || typeof raw !== 'object') {
    return defaults;
  }
  const enabled = Boolean(raw.enabled);
  const transport = raw.transport === 'raw_queue' ? 'raw_queue' : 'tcp';
  const host =
    typeof raw.host === 'string' && raw.host.trim().length <= 128
      ? raw.host.trim()
      : defaults.host;
  const port = ALLOWED_ZPL_PORTS.includes(Number(raw.port)) ? Number(raw.port) : 9100;
  const rawPrinterName =
    typeof raw.rawPrinterName === 'string' && raw.rawPrinterName.trim().length <= 128
      ? raw.rawPrinterName.trim()
      : '';
  const dpi = Number(raw.dpi) === 300 ? 300 : 203;
  const format = ['50x30', '70x37', '90x50'].includes(raw.format) ? raw.format : '50x30';
  return { enabled, transport, host, port, rawPrinterName, dpi, format };
}

/**
 * Valide et normalise les préférences système bureau (tray, démarrage auto, notifications).
 */
export function sanitizeDesktopSystemSettings(raw) {
  const defaults = {
    keepInTrayOnClose: true,
    launchAtLogin: false,
    notificationsEnabled: true,
  };
  if (!raw || typeof raw !== 'object') {
    return defaults;
  }
  return {
    keepInTrayOnClose:
      typeof raw.keepInTrayOnClose === 'boolean' ? raw.keepInTrayOnClose : defaults.keepInTrayOnClose,
    launchAtLogin:
      typeof raw.launchAtLogin === 'boolean' ? raw.launchAtLogin : defaults.launchAtLogin,
    notificationsEnabled:
      typeof raw.notificationsEnabled === 'boolean'
        ? raw.notificationsEnabled
        : defaults.notificationsEnabled,
  };
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

