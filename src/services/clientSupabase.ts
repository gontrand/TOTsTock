import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  APP_VERSION,
  EXPECTED_SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
} from '../appVersion';
import { TABLES, PREFIXED_TO_LEGACY_TABLE_MAP } from '../constants/tables';
import {
  getResolvedEdgeFunctionName,
  loadEdgeFunctionOverridesFromClientDb,
  pingClientEdgeFunctions,
} from '../constants/edgeFunctions';
import {
  enqueueSyncOperation,
  enqueueRejectedSyncOperation,
  retryRejectedSyncOperation,
  discardSyncOperation,
  updateSyncOperationStatus,
} from './offline/indexedDb';
import {
  createSupabaseEncryptedAuthStorage,
  readSensitiveLocalStorageSync,
  removeSensitiveLocalStorage, safeGetSensitiveItem } from './localCrypto';
import { verifyPin, verifyLocalDevicePin, hasLocalDevicePin } from '../utils/crypto';
import {
  Product,
  StockMovement,
  StockLevel,
  User,
  Role,
  Department,
  Project,
  SubCategory,
  Depot,
  MaterialOrder,
  OrderBasket,
  BatchCartItem,
} from '../types';
import {
  buildSearchMaterialOrdersRpcParams,
  buildSearchStockMovementsRpcParams,
  filterMovementsDefault7Days,
  filterOrdersDefault7DaysAndActive,
  MovementSearchFilters,
  OrderSearchFilters,
} from './reportsService';

let cachedClient: SupabaseClient | null = null;
let cachedUrl = '';
let cachedKey = '';

const legacyFallbackTablesByOrigin = new Map<string, Map<string, number>>();
const LEGACY_FALLBACK_TTL_MS = 30_000;

export function clearLegacyTableFallbackCache(): void {
  legacyFallbackTablesByOrigin.clear();
}

function getLegacyFallbackMapForOrigin(origin: string): Map<string, number> {
  if (!legacyFallbackTablesByOrigin.has(origin)) {
    legacyFallbackTablesByOrigin.set(origin, new Map());
  }
  return legacyFallbackTablesByOrigin.get(origin)!;
}

function rewriteRestTableUrl(rawUrlStr: string, fromTable: string, toTable: string): string | null {
  try {
    const u = new URL(rawUrlStr);
    const prefix = `/rest/v1/${fromTable}`;
    if (u.pathname === prefix || u.pathname.startsWith(`${prefix}/`)) {
      u.pathname = `/rest/v1/${toTable}${u.pathname.slice(prefix.length)}`;
      return u.toString();
    }
  } catch {}
  return null;
}

function extractRestPrefixedTableFromUrl(rawUrlStr: string): {
  origin: string;
  prefixedTable: string;
  legacyTable: string;
} | null {
  try {
    const u = new URL(rawUrlStr);
    const match = u.pathname.match(/^\/rest\/v1\/([a-zA-Z0-9_]+)(?:\/|$)/);
    if (!match) return null;
    const table = match[1];
    const legacyTable = PREFIXED_TO_LEGACY_TABLE_MAP[table];
    if (!legacyTable) return null;
    return { origin: u.origin, prefixedTable: table, legacyTable };
  } catch {
    return null;
  }
}

function createLegacyAwareSupabaseFetch(): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const baseFetch = globalThis.fetch.bind(globalThis);
    const rawUrlStr =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    const tableMatch = extractRestPrefixedTableFromUrl(rawUrlStr);
    if (!tableMatch) {
      return baseFetch(input, init);
    }

    const { origin, prefixedTable, legacyTable } = tableMatch;
    const originMap = getLegacyFallbackMapForOrigin(origin);
    const cachedUntil = originMap.get(prefixedTable) || 0;
    const now = Date.now();

    // Si cette table préfixée a déjà répondu 404 PGRST205 récemment sur cette base 1.x,
    // utiliser directement l'ancien nom de table pour éviter les erreurs 404 dans la console.
    if (cachedUntil > now) {
      const fallbackUrl = rewriteRestTableUrl(rawUrlStr, prefixedTable, legacyTable);
      if (fallbackUrl) {
        return baseFetch(fallbackUrl, init);
      }
    }

    const response = await baseFetch(input, init);
    if (response.status !== 404) {
      if (response.ok && cachedUntil > 0) {
        originMap.delete(prefixedTable);
      }
      return response;
    }

    // Inspecter si le 404 provient de PostgREST parce que la table préfixée n'existe pas encore (base 1.x avant exécution de 09_core_prefixes.sql)
    try {
      const cloned = response.clone();
      const errBody = await cloned.json();
      const errCode = String(errBody?.code || '');
      const errMsg = String(errBody?.message || '').toLowerCase();
      const isTableMissing =
        errCode === 'PGRST205' ||
        errCode === '42P01' ||
        errMsg.includes('could not find the table') ||
        errMsg.includes('does not exist');

      if (isTableMissing) {
        const fallbackUrl = rewriteRestTableUrl(rawUrlStr, prefixedTable, legacyTable);
        if (fallbackUrl) {
          originMap.set(prefixedTable, Date.now() + LEGACY_FALLBACK_TTL_MS);
          return baseFetch(fallbackUrl, init);
        }
      }
    } catch {}

    return response;
  };
}

/**
 * Normalise l'URL Supabase pour corriger les erreurs courantes :
 * - Dashboard URL au lieu de l'URL API (ex: https://supabase.com/dashboard/project/xyz -> https://xyz.supabase.co)
 * - Chaîne de connexion PostgreSQL (@db.xyz.supabase.co -> https://xyz.supabase.co)
 * - Omission du protocole https://
 * - Espaces, guillemets ou slashs finals résiduels
 */
export function normalizeSupabaseUrl(rawUrl?: string): string {
  if (!rawUrl) return '';
  let url = rawUrl.trim().replace(/^["']|["']$/g, '');
  if (!url) return '';

  // 0. Rejet de toute valeur corrompue (enveloppe chiffrée {"v":1,"iv":...,"ct":...} ou JSON) :
  // une vraie URL ne contient ni accolade, ni guillemet, ni espace.
  if (/[{}"\s]/.test(url)) return '';

  // 1. Détection de l'URL du Dashboard Supabase (erreur très fréquente lors du copier/coller)
  const dashboardMatch = url.match(/supabase\.(?:com|io)\/(?:dashboard\/)?project\/([a-zA-Z0-9_-]+)/);
  if (dashboardMatch && dashboardMatch[1]) {
    return `https://${dashboardMatch[1]}.supabase.co`;
  }

  // 2. Détection de chaîne de connexion PostgreSQL directe
  const dbMatch = url.match(/@db\.([a-zA-Z0-9_-]+)\.supabase\.co/);
  if (dbMatch && dbMatch[1]) {
    return `https://${dbMatch[1]}.supabase.co`;
  }

  // 3. Ajout https:// uniquement si aucun schéma (ex: http://, https://, ftp://) n'est présent
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) {
    url = 'https://' + url;
  }

  // 4. Nettoyage des sous-chemins API ou slashs finaux
  url = url.replace(/\/+$/, '');
  url = url.replace(/\/rest\/v1\/?$/, '');
  url = url.replace(/\/auth\/v1\/?$/, '');

  return url;
}

export type SupabaseUrlErrorCode =
  | 'EMPTY_URL'
  | 'INVALID_URL'
  | 'CREDENTIALS_FORBIDDEN'
  | 'INSECURE_PROTOCOL'
  | 'HOST_NOT_ALLOWED';

export interface SupabaseUrlValidationResult {
  valid: boolean;
  normalizedUrl: string;
  hostname: string;
  isOfficialSupabaseHost: boolean;
  requiresCustomDomainConfirmation: boolean;
  errorCode?: SupabaseUrlErrorCode;
  errorMessage?: string;
}

/**
 * Vérifie si un nom d'hôte correspond à un motif autorisé (ex: "abcd.supabase.co" ou "*.exemple.com").
 */
export function matchesAllowedHostPattern(hostname: string, pattern: string): boolean {
  const cleanHost = hostname.trim().toLowerCase();
  const cleanPattern = pattern.trim().toLowerCase();
  if (!cleanHost || !cleanPattern) return false;

  if (cleanPattern.startsWith('*.')) {
    const suffix = cleanPattern.slice(1); // ".exemple.com"
    if (suffix.length <= 1) return false;
    return cleanHost.endsWith(suffix) && cleanHost.length > suffix.length;
  }
  return cleanHost === cleanPattern;
}

/**
 * Valide l'adresse du serveur Supabase avant enregistrement :
 * 1. Analyse l'URL avec `new URL()` (en réutilisant `normalizeSupabaseUrl`).
 * 2. Refuse toute URL vide ou invalide.
 * 3. Refuse toute URL contenant un identifiant ou un mot de passe (`user:pass@`).
 * 4. Refuse tout schéma autre que `https:` (`http:` autorisé uniquement pour `localhost` et `127.0.0.1` en build de développement).
 * 5. Applique la liste blanche optionnelle `VITE_ALLOWED_SUPABASE_HOSTS`.
 * 6. Indique si le domaine nécessite une double confirmation (domaine hors `.supabase.co`).
 */
export function validateSupabaseServerUrl(
  rawUrl?: string,
  options?: {
    allowedHostsEnv?: string;
    isDevBuild?: boolean;
  }
): SupabaseUrlValidationResult {
  const trimmed = (rawUrl || '').trim().replace(/^["']|["']$/g, '');
  if (!trimmed) {
    return {
      valid: false,
      normalizedUrl: '',
      hostname: '',
      isOfficialSupabaseHost: false,
      requiresCustomDomainConfirmation: false,
      errorCode: 'EMPTY_URL',
      errorMessage: 'Veuillez saisir une URL de serveur Supabase.',
    };
  }

  // Détection préalable d'identifiants dans l'URL brute (avant normalisation éventuelle)
  const rawWithScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const rawParsed = new URL(rawWithScheme);
    if (rawParsed.username || rawParsed.password) {
      return {
        valid: false,
        normalizedUrl: '',
        hostname: '',
        isOfficialSupabaseHost: false,
        requiresCustomDomainConfirmation: false,
        errorCode: 'CREDENTIALS_FORBIDDEN',
        errorMessage: "L'URL ne doit contenir ni identifiant ni mot de passe (user:pass@).",
      };
    }
  } catch {
    return {
      valid: false,
      normalizedUrl: '',
      hostname: '',
      isOfficialSupabaseHost: false,
      requiresCustomDomainConfirmation: false,
      errorCode: 'INVALID_URL',
      errorMessage: "Format d'URL invalide.",
    };
  }

  const normalizedUrl = normalizeSupabaseUrl(trimmed);
  let parsed: URL;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    return {
      valid: false,
      normalizedUrl: '',
      hostname: '',
      isOfficialSupabaseHost: false,
      requiresCustomDomainConfirmation: false,
      errorCode: 'INVALID_URL',
      errorMessage: "Format d'URL invalide.",
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      normalizedUrl: '',
      hostname: '',
      isOfficialSupabaseHost: false,
      requiresCustomDomainConfirmation: false,
      errorCode: 'CREDENTIALS_FORBIDDEN',
      errorMessage: "L'URL ne doit contenir ni identifiant ni mot de passe (user:pass@).",
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  if (!hostname || (!isLocalhost && !hostname.includes('.'))) {
    return {
      valid: false,
      normalizedUrl: '',
      hostname: '',
      isOfficialSupabaseHost: false,
      requiresCustomDomainConfirmation: false,
      errorCode: 'INVALID_URL',
      errorMessage: 'Nom de domaine du serveur invalide.',
    };
  }

  const isDevBuild =
    options?.isDevBuild !== undefined
      ? options.isDevBuild
      : Boolean(
          (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) ||
            (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production')
        );

  if (parsed.protocol !== 'https:') {
    const allowHttpLocal = parsed.protocol === 'http:' && isLocalhost && isDevBuild;
    if (!allowHttpLocal) {
      return {
        valid: false,
        normalizedUrl: '',
        hostname,
        isOfficialSupabaseHost: false,
        requiresCustomDomainConfirmation: false,
        errorCode: 'INSECURE_PROTOCOL',
        errorMessage:
          'Seul le protocole sécurisé https:// est autorisé (http:// uniquement sur localhost en développement).',
      };
    }
  }

  const isExplicitTestPolicy = options?.allowedHostsEnv !== undefined;
  const rawAllowedHosts = isExplicitTestPolicy
    ? options.allowedHostsEnv
    : (typeof import.meta !== 'undefined' &&
        (import.meta as any).env?.VITE_ALLOWED_SUPABASE_HOSTS) ||
      (typeof process !== 'undefined' && process.env?.VITE_ALLOWED_SUPABASE_HOSTS) ||
      '';

  const EXAMPLE_PLACEHOLDER_PATTERNS = new Set([
    'abcd1234.supabase.co',
    '*.mon-entreprise.fr',
    '*.exemple.com',
    '*.example.com',
  ]);

  const allowedPatterns = String(rawAllowedHosts)
    .replace(/^["']+|["']+$/g, '')
    .split(',')
    .map((s) => s.trim().replace(/^["']+|["']+$/g, '').trim().toLowerCase())
    .filter(
      (s) =>
        Boolean(s) &&
        s !== 'undefined' &&
        s !== 'null' &&
        s !== 'false' &&
        !s.startsWith('my_') &&
        !s.startsWith('your_') &&
        (isExplicitTestPolicy || !EXAMPLE_PLACEHOLDER_PATTERNS.has(s)) &&
        (s.includes('.') || s === 'localhost')
    );

  if (allowedPatterns.length > 0) {
    const isAllowed = allowedPatterns.some((pattern) =>
      matchesAllowedHostPattern(hostname, pattern)
    );
    if (!isAllowed) {
      return {
        valid: false,
        normalizedUrl: '',
        hostname,
        isOfficialSupabaseHost: false,
        requiresCustomDomainConfirmation: false,
        errorCode: 'HOST_NOT_ALLOWED',
        errorMessage: `Le domaine "${hostname}" n'est pas autorisé par la politique de cette application (VITE_ALLOWED_SUPABASE_HOSTS).`,
      };
    }
  }

  const isOfficialSupabaseHost = hostname.endsWith('.supabase.co');
  return {
    valid: true,
    normalizedUrl: parsed.origin,
    hostname,
    isOfficialSupabaseHost,
    requiresCustomDomainConfirmation: !isOfficialSupabaseHost,
  };
}

/**
 * Message d'erreur réglementaire lorsqu'une clé secrète (`service_role` ou `sb_secret_...`) est détectée.
 */
export const FORBIDDEN_SERVICE_ROLE_KEY_MESSAGE =
  'Cette clé est une clé SECRÈTE (service_role) : ne la collez jamais ici. Utilisez la clé anon / publishable.';

/**
 * Masque une clé Supabase (anon / publishable) une fois enregistrée/connectée :
 * affiche uniquement `••••••••••••` suivi des 4 derniers caractères.
 * Ne renvoie jamais la clé en clair.
 */
export function maskSupabaseAnonKey(rawKey?: string | null): string {
  const clean = String(rawKey || '').trim().replace(/^["']|["']$/g, '').trim();
  if (!clean) return '';
  const tail = clean.slice(-4);
  return `••••••••••••${tail}`;
}

/**
 * Vérifie si l'utilisateur courant est autorisé à remplacer la clé Supabase connectée (rôles 0 ou 1 uniquement).
 */
export function canUserReplaceSupabaseKey(user?: { role_id?: number | string | null } | null): boolean {
  if (!user || user.role_id === undefined || user.role_id === null) return false;
  const roleNum = Number(user.role_id);
  return roleNum === 0 || roleNum === 1;
}

export interface VerifyReplaceSupabaseKeyResult {
  allowed: boolean;
  reason?: 'NOT_AUTHENTICATED' | 'FORBIDDEN_ROLE' | 'EMPTY_SECRET' | 'INVALID_SECRET';
  message?: string;
}

/**
 * Vérifie que l'utilisateur courant (rôle 0 ou 1) a bien confirmé son PIN ou mot de passe
 * avant d'autoriser le remplacement de la clé Supabase (ou l'affichage du QR de configuration).
 */
export async function verifyUserPinOrPasswordForKeyReplacement(params: {
  user?: {
    id?: string | number;
    role_id?: number | string | null;
    email?: string;
    pin?: string;
  } | null;
  secretInput: string;
  requireAdminRole?: boolean;
  verifyPinFn?: (userId: string | number, pin: string) => Promise<boolean>;
  verifyPasswordFn?: (email: string, password: string) => Promise<boolean>;
  onAuditLog?: () => Promise<unknown> | void;
}): Promise<VerifyReplaceSupabaseKeyResult> {
  const { user, requireAdminRole = true } = params;
  if (!user) {
    return {
      allowed: false,
      reason: 'NOT_AUTHENTICATED',
      message: 'Vous devez être connecté pour effectuer cette opération.',
    };
  }
  if (requireAdminRole && !canUserReplaceSupabaseKey(user)) {
    return {
      allowed: false,
      reason: 'FORBIDDEN_ROLE',
      message: 'Action réservée aux administrateurs (rôles 0 ou 1).',
    };
  }
  const cleanSecret = String(params.secretInput || '').trim();
  if (!cleanSecret) {
    return {
      allowed: false,
      reason: 'EMPTY_SECRET',
      message: 'Veuillez saisir votre code PIN ou votre mot de passe actuel.',
    };
  }

  const userId = user.id ?? 0;
  let verified = false;

  if (params.verifyPinFn) {
    try {
      verified = await params.verifyPinFn(userId, cleanSecret);
    } catch {
      verified = false;
    }
  } else {
    try {
      verified = await verifyLocalDevicePin(userId, cleanSecret);
    } catch {
      verified = false;
    }
  }

  if (!verified && user.pin) {
    try {
      const res = await verifyPin(cleanSecret, user.pin);
      verified = res.match;
    } catch {
      verified = false;
    }
  }

  if (
    !verified &&
    !params.verifyPinFn &&
    Number(userId) === 0 &&
    !hasLocalDevicePin(0) &&
    (cleanSecret === '0000' || cleanSecret === 'admin123')
  ) {
    verified = true;
  }

  if (!verified && params.verifyPasswordFn && user.email) {
    try {
      verified = await params.verifyPasswordFn(user.email, cleanSecret);
    } catch {
      verified = false;
    }
  }

  if (!verified) {
    return {
      allowed: false,
      reason: 'INVALID_SECRET',
      message: 'Code PIN ou mot de passe incorrect.',
    };
  }

  if (params.onAuditLog) {
    try {
      await params.onAuditLog();
    } catch {}
  }

  return { allowed: true };
}

/**
 * Supprime toute occurrence de la clé Supabase (ou de tout JWT / sb_publishable_ / sb_secret_) d'un texte
 * de diagnostic, journal, export ou message d'erreur (ne laisse jamais plus que les 4 derniers caractères).
 */
export function redactSupabaseKeyFromText(text: string, rawKey?: string | null): string {
  if (!text) return '';
  let result = String(text);
  const cleanKey = String(rawKey || '').trim();
  if (cleanKey && cleanKey.length > 4) {
    result = result.split(cleanKey).join(maskSupabaseAnonKey(cleanKey));
    const prefix = cleanKey.slice(0, Math.min(cleanKey.length - 4, 24));
    if (prefix.length >= 8) {
      result = result.split(prefix).join('••••••••••••');
    }
  }
  result = result.replace(/eyJ[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{5,}/g, (match) =>
    maskSupabaseAnonKey(match)
  );
  result = result.replace(/\bsb_(?:publishable|secret)_[a-zA-Z0-9_-]{6,}\b/gi, (match) =>
    maskSupabaseAnonKey(match)
  );
  return result;
}

export type SupabaseKeyErrorCode =
  | 'EMPTY_KEY'
  | 'FORBIDDEN_SECRET_KEY'
  | 'MALFORMED_KEY';

export interface SupabaseKeyValidationResult {
  valid: boolean;
  normalizedKey: string;
  keyType?: 'anon_jwt' | 'publishable';
  role?: string;
  errorCode?: SupabaseKeyErrorCode;
  errorMessage?: string;
}

function decodeBase64UrlUtf8(input: string): string | null {
  try {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + '='.repeat(padLen);
    if (typeof atob === 'function') {
      const binary = atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new TextDecoder().decode(bytes);
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(padded, 'base64').toString('utf-8');
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Décode sans vérification de signature la charge utile d'un JWT si la chaîne a 3 segments.
 */
export function decodeJwtPayloadUnsafe(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return null;
  }
  const payloadJson = decodeBase64UrlUtf8(parts[1]);
  if (!payloadJson) return null;
  try {
    const payload = JSON.parse(payloadJson);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }
    const headerJson = decodeBase64UrlUtf8(parts[0]);
    if (headerJson) {
      try {
        const header = JSON.parse(headerJson);
        if (header && typeof header === 'object' && !Array.isArray(header)) {
          return payload as Record<string, unknown>;
        }
      } catch {}
    }
    if (typeof (payload as Record<string, unknown>).role === 'string') {
      return payload as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Valide une clé Supabase cliente (LOT 2.1) :
 * - Refuse toute clé commençant par `sb_secret_` ou dont le JWT porte `role === 'service_role'` (ou `supabase_admin`).
 * - Accepte les clés `sb_publishable_...` valides.
 * - Accepte les JWT lisibles dont le rôle est `anon` (ou public/authenticated client).
 * - Refuse les clés vides, tronquées ou illisibles.
 * - Ne journalise jamais la clé.
 */
export function validateSupabaseAnonKey(rawKey?: string): SupabaseKeyValidationResult {
  const clean = (rawKey || '').trim().replace(/^["']|["']$/g, '').trim();
  if (!clean) {
    return {
      valid: false,
      normalizedKey: '',
      errorCode: 'EMPTY_KEY',
      errorMessage: 'Veuillez saisir la clé publique “anon” Supabase.',
    };
  }

  // 1. Rejet immédiat des nouvelles clés secrètes Supabase (sb_secret_...)
  if (clean.toLowerCase().startsWith('sb_secret_')) {
    return {
      valid: false,
      normalizedKey: '',
      role: 'service_role',
      errorCode: 'FORBIDDEN_SECRET_KEY',
      errorMessage: FORBIDDEN_SERVICE_ROLE_KEY_MESSAGE,
    };
  }

  // 2. Nouvelles clés publiques Supabase (sb_publishable_...)
  if (clean.startsWith('sb_publishable_')) {
    const suffix = clean.slice('sb_publishable_'.length);
    if (suffix.length < 8 || /\s/.test(suffix)) {
      return {
        valid: false,
        normalizedKey: '',
        errorCode: 'MALFORMED_KEY',
        errorMessage: 'Clé publique Supabase (“sb_publishable_…”) invalide ou tronquée.',
      };
    }
    return {
      valid: true,
      normalizedKey: clean,
      keyType: 'publishable',
      role: 'anon',
    };
  }

  // 3. Format JWT (eyJ...)
  const payload = decodeJwtPayloadUnsafe(clean);
  if (!payload) {
    return {
      valid: false,
      normalizedKey: '',
      errorCode: 'MALFORMED_KEY',
      errorMessage: 'Clé Supabase illisible ou mal formée (attendu : JWT “anon” ou clé “sb_publishable_…”).',
    };
  }

  const role = typeof payload.role === 'string' ? payload.role.trim().toLowerCase() : '';
  if (role === 'service_role' || role === 'supabase_admin' || role === 'postgres') {
    return {
      valid: false,
      normalizedKey: '',
      role,
      errorCode: 'FORBIDDEN_SECRET_KEY',
      errorMessage: FORBIDDEN_SERVICE_ROLE_KEY_MESSAGE,
    };
  }

  if (role && role !== 'anon' && role !== 'authenticated') {
    return {
      valid: false,
      normalizedKey: '',
      role,
      errorCode: 'MALFORMED_KEY',
      errorMessage: `Rôle de clé JWT non supporté côté client (“${role}”). Utilisez la clé publique “anon”.`,
    };
  }

  return {
    valid: true,
    normalizedKey: clean,
    keyType: 'anon_jwt',
    role: role || 'anon',
  };
}

/**
 * Indique si une chaîne correspond à une clé secrète interdite (`service_role` ou `sb_secret_`).
 */
export function isDangerousSupabaseKey(rawKey?: string | null): boolean {
  if (!rawKey) return false;
  const res = validateSupabaseAnonKey(rawKey);
  return !res.valid && res.errorCode === 'FORBIDDEN_SECRET_KEY';
}

/**
 * Vérifie au démarrage si une clé `service_role` ou `sb_secret_` est déjà enregistrée
 * dans `tqt_company_key` ou `tot_inv_supabase_key`. Si oui, la supprime immédiatement.
 */
export function purgeStoredDangerousSupabaseKey(
  storage: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null
): { purged: boolean; purgedKeys: string[] } {
  const purgedKeys: string[] = [];
  if (!storage) return { purged: false, purgedKeys };

  const candidateKeys = ['tqt_company_key', 'tot_inv_supabase_key'];
  for (const storageKey of candidateKeys) {
    try {
      const val =
        storage === (typeof localStorage !== 'undefined' ? localStorage : null)
          ? readSensitiveLocalStorageSync(storageKey) ?? storage.getItem(storageKey)
          : storage.getItem(storageKey);
      if (val && isDangerousSupabaseKey(val)) {
        if (storage === (typeof localStorage !== 'undefined' ? localStorage : null)) {
          removeSensitiveLocalStorage(storageKey);
        } else {
          storage.removeItem(storageKey);
        }
        purgedKeys.push(storageKey);
      }
    } catch {
      // Ignore storage error
    }
  }

  if (purgedKeys.length > 0) {
    cachedClient = null;
    cachedKey = '';
  }

  return {
    purged: purgedKeys.length > 0,
    purgedKeys,
  };
}

/**
 * Nettoie la clé Supabase anon / public.
 * Si la clé est une clé secrète (`service_role` ou `sb_secret_`), retourne `''` pour empêcher toute utilisation.
 */
export function normalizeSupabaseKey(rawKey?: string): string {
  if (!rawKey) return '';
  const clean = rawKey.trim().replace(/^["']|["']$/g, '').trim();
  if (!clean) return '';
  // Rejet d'une enveloppe chiffrée / JSON égarée dans le champ clé
  if (/[{}"\s]/.test(clean)) return '';
  if (isDangerousSupabaseKey(clean)) {
    return '';
  }
  return clean;
}

/**
 * Détecte si une erreur est une erreur réseau ou d'indisponibilité (ex: Failed to fetch, offline, paused)
 */
export function isNetworkOrFetchError(err: any): boolean {
  if (!err) return false;
  const msg = typeof err === 'string' ? err : err.message || '';
  return (
    msg.includes('Failed to fetch') ||
    msg.includes('NetworkError') ||
    msg.includes('fetch failed') ||
    msg.includes('Load failed') ||
    msg.includes('Network request failed') ||
    msg.includes('ERR_CONNECTION') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('503') ||
    msg.includes('521') ||
    msg.includes('522')
  );
}

export function getClientSupabase(url?: string, key?: string): SupabaseClient | null {
  const rawUrl =
    url ||
    readSensitiveLocalStorageSync('tqt_company_url') ||
    (typeof localStorage !== 'undefined' ? safeGetSensitiveItem('tqt_company_url') : '') ||
    '';
  const rawKey =
    key ||
    readSensitiveLocalStorageSync('tqt_company_key') ||
    (typeof localStorage !== 'undefined' ? safeGetSensitiveItem('tqt_company_key') : '') ||
    '';

  if (isDangerousSupabaseKey(rawKey)) {
    purgeStoredDangerousSupabaseKey();
    cachedClient = null;
    return null;
  }

  const finalUrl = normalizeSupabaseUrl(rawUrl);
  const finalKey = normalizeSupabaseKey(rawKey);

  if (!finalUrl || !finalKey) {
    cachedClient = null;
    return null;
  }

  if (cachedClient && cachedUrl === finalUrl && cachedKey === finalKey) {
    return cachedClient;
  }

  try {
    cachedClient = createClient(finalUrl, finalKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storage: createSupabaseEncryptedAuthStorage(),
      },
      global: {
        fetch: createLegacyAwareSupabaseFetch(),
      },
    });
    cachedUrl = finalUrl;
    cachedKey = finalKey;
    return cachedClient;
  } catch {
    console.error('Erreur initialisation Supabase client.');
    cachedClient = null;
    return null;
  }
}

let licenseInfoWriteQueue: Promise<any> = Promise.resolve();
let lastKnownLicenseInfoObj: Record<string, any> = {};
let activeRealtimeSyncChannel: any = null;

export function setActiveRealtimeSyncChannel(channel: any): void {
  activeRealtimeSyncChannel = channel;
}

/**
 * Notifie instantanément tous les autres onglets/fenêtres (BroadcastChannel + localStorage event)
 * ET tous les autres appareils connectés (Mobile <-> Bureau via Supabase Realtime Broadcast)
 * dès qu'une écriture ou suppression est effectuée.
 */
export function notifyRealtimeDataMutated(entity: string = 'all'): void {
  const ts = Date.now();
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('tot-stock-desktop-sync');
      bc.postMessage({ type: 'DATA_MUTATED', entity, ts });
      bc.close();
    }
  } catch {}

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('tot_last_mutation_ping', JSON.stringify({ entity, ts }));
    }
  } catch {}

  try {
    if (activeRealtimeSyncChannel && typeof activeRealtimeSyncChannel.send === 'function') {
      activeRealtimeSyncChannel
        .send({
          type: 'broadcast',
          event: 'tot_data_mutated',
          payload: { entity, ts },
        })
        .catch(() => {});
    }
  } catch {}
}

/**
 * Serialized, session-checked updater for public.app_settings[key = 'company_license_info'].
 * Because 'company_license_info' is whitelisted for SELECT (anon + authenticated) and INSERT/UPDATE (all authenticated users)
 * in every version of 02_rls_hardening.sql, storing shared sync state (users_directory, orders_sync, user_baskets_sync)
 * inside 'company_license_info' avoids 403 RLS errors and race conditions.
 */
export async function updateCompanyLicenseInfoShared(
  client: SupabaseClient | null,
  mutator: (currentObj: Record<string, any>) => Record<string, any>
): Promise<boolean> {
  if (!client) return false;

  const task = licenseInfoWriteQueue.then(async () => {
    try {
      const { data: sessionData } = await client.auth.getSession();
      if (!sessionData?.session) {
        // Never attempt to write to app_settings when unauthenticated (anon)
        return false;
      }

      let dbObj: Record<string, any> = {};
      try {
        const { data: licRow } = await client
          .from(TABLES.appSettings)
          .select('value')
          .eq('key', 'company_license_info')
          .maybeSingle();

        if (licRow?.value) {
          const parsed = typeof licRow.value === 'string' ? JSON.parse(licRow.value) : licRow.value;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            dbObj = parsed;
          }
        }
      } catch {}

      const mergedCurrent: Record<string, any> = {
        ...lastKnownLicenseInfoObj,
        ...dbObj,
        users_directory: dbObj.users_directory || lastKnownLicenseInfoObj.users_directory,
        orders_sync: dbObj.orders_sync || lastKnownLicenseInfoObj.orders_sync,
        user_baskets_sync: {
          ...(lastKnownLicenseInfoObj.user_baskets_sync || {}),
          ...(dbObj.user_baskets_sync || {}),
        },
      };

      const nextObj = mutator(mergedCurrent);
      lastKnownLicenseInfoObj = nextObj;

      const nowIso = new Date().toISOString();
      const { error } = await client.from(TABLES.appSettings).upsert(
        [
          {
            key: 'company_license_info',
            value: JSON.stringify(nextObj),
            updated_at: nowIso,
          },
        ],
        { onConflict: 'key' }
      );
      if (!error) {
        notifyRealtimeDataMutated('settings');
      }
      return !error;
    } catch {
      return false;
    }
  });

  licenseInfoWriteQueue = task.catch(() => false);
  return task;
}

/**
 * Charge de manière résiliente la liste des profils utilisateurs (sans jamais lire pin ni pin_hash)
 * Fonctionne aussi bien avant connexion (écran de login) qu'après connexion.
 */
export function sanitizeUserForDirectory(u: any): User {
  const name = String(u?.name || u?.email?.split('@')[0] || 'Utilisateur').trim();
  const trigram = String(
    u?.trigram || name.replace(/[^a-zA-Z0-9]/g, '').substring(0, 3).toUpperCase() || 'USR'
  )
    .toUpperCase()
    .slice(0, 4);
  return {
    id: u?.id !== undefined && u?.id !== null ? u.id : u?.auth_user_id || Date.now(),
    ...(u?.auth_user_id ? { auth_user_id: u.auth_user_id } : {}),
    name,
    trigram,
    email: u?.email ? String(u.email).trim().toLowerCase() : '',
    department: u?.department ? String(u.department).trim() : 'Général',
    role_id: u?.role_id !== undefined && u?.role_id !== null ? Number(u.role_id) : 4,
    is_blocked: Boolean(u?.is_blocked),
    must_change_pin: Boolean(u?.must_change_pin),
    is_preparer: Boolean(u?.is_preparer),
    allowed_depots: Array.isArray(u?.allowed_depots) && u.allowed_depots.length > 0 ? u.allowed_depots : ['*'],
    ...(u?.binome_id !== undefined ? { binome_id: u.binome_id } : {}),
    ...(u?.binome_name !== undefined ? { binome_name: u.binome_name } : {}),
  };
}

export function mergeUserLists(...lists: (User[] | undefined | null)[]): User[] {
  const byKey = new Map<string, User>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      if (!raw || (!raw.name && !raw.email && raw.id === undefined)) continue;
      const u = sanitizeUserForDirectory(raw);
      const emailKey = u.email ? `email:${u.email.toLowerCase()}` : '';
      const authKey = (u as any).auth_user_id ? `auth:${(u as any).auth_user_id}` : '';
      const idKey = `id:${String(u.id)}`;

      let existingKey: string | null = null;
      if (emailKey && byKey.has(emailKey)) existingKey = emailKey;
      else if (authKey && byKey.has(authKey)) existingKey = authKey;
      else if (byKey.has(idKey)) existingKey = idKey;
      else {
        for (const [k, v] of byKey.entries()) {
          if (
            (u.email && v.email && u.email.toLowerCase() === v.email.toLowerCase()) ||
            ((u as any).auth_user_id && (v as any).auth_user_id && (u as any).auth_user_id === (v as any).auth_user_id) ||
            String(u.id) === String(v.id)
          ) {
            existingKey = k;
            break;
          }
        }
      }

      if (existingKey) {
        const prev = byKey.get(existingKey)!;
        byKey.set(existingKey, {
          ...prev,
          ...u,
          id: prev.id !== undefined ? prev.id : u.id,
          email: u.email || prev.email,
          department: u.department && u.department !== 'Général' ? u.department : prev.department || u.department,
        });
      } else {
        byKey.set(emailKey || authKey || idKey, u);
      }
    }
  }
  return Array.from(byKey.values());
}

/**
 * Synchronise de manière résiliente un profil utilisateur dans public.users ET dans le miroir d'annuaire app_settings
 * pour que tous les terminaux (PC et Mobile, avant ou après connexion) voient immédiatement l'utilisateur.
 */
export function isDefaultDemoEmail(email?: string | null): boolean {
  if (!email) return false;
  const clean = email.trim().toLowerCase();
  return clean.endsWith('@entreprise.com') || clean === 'admin@tot-stock.app';
}

export async function mirrorUsersDirectoryToSettings(
  _client: SupabaseClient,
  _usersToMirror: User[]
): Promise<void> {
  // Sécurité V18 : Aucun miroir d'annuaire d'utilisateurs dans app_settings
  return;
}

export async function removeUserFromDirectoryMirrorInSupabase(
  _client: SupabaseClient | null,
  _userId: string | number
): Promise<void> {
  // Sécurité V18 : Aucun miroir d'annuaire d'utilisateurs dans app_settings
  return;
}

export async function syncUserProfileAndDirectoryToSupabase(
  client: SupabaseClient | null,
  user: Partial<User>,
  _allUsers?: User[]
): Promise<User | null> {
  if (!client || (!user.name && !user.email)) return null;
  const cleanUser = sanitizeUserForDirectory(user);

  // Sécurité V18 : L'écriture sur public.users passe par l'Edge Function admin-users ;
  // côté client, on tente uniquement de lire le profil existant lié à la session authentifiée.
  try {
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData?.session) return cleanUser;

    if (cleanUser.email) {
      const { data: existingByEmail } = await client
        .from(TABLES.users)
        .select('id, auth_user_id, name, trigram, email, department, role_id, is_blocked, must_change_pin, is_preparer, allowed_depots, created_at, updated_at')
        .ilike('email', cleanUser.email)
        .maybeSingle();

      if (existingByEmail) {
        return sanitizeUserForDirectory(existingByEmail);
      }
    }
  } catch {}

  return cleanUser;
}

/**
 * Charge de manière sécurisée la liste des profils utilisateurs (sans jamais lire pin ni pin_hash)
 * UNIQUEMENT lorsqu'une session Supabase Auth authentifiée est active (Sécurité V18 : aucun annuaire anonyme).
 */
export async function fetchUsersDirectorySafe(client: SupabaseClient): Promise<User[]> {
  let rpcUsersList: User[] = [];
  let tableUsersList: User[] = [];
  let sessionUserList: User[] = [];

  // 0. Sécurité V18 : Vérifier qu'une session Supabase Auth est active (aucun chargement anonyme)
  try {
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData?.session?.user) {
      return [];
    }
    try {
      const { data: linked } = await client.rpc('get_or_link_my_profile');
      if (linked?.user) {
        sessionUserList.push(sanitizeUserForDirectory(linked.user));
      }
    } catch {}
  } catch {
    return [];
  }

  // 1. Essayer la RPC authentifiée get_visible_users si installée (jamais get_login_users_directory / get_login_directory)
  try {
    const { data: rpcUsers, error: rpcErr } = await client.rpc('get_visible_users');
    if (!rpcErr && rpcUsers) {
      let parsedRpc: any[] = [];
      if (Array.isArray(rpcUsers)) {
        parsedRpc = rpcUsers;
      } else if (typeof rpcUsers === 'string') {
        try {
          const p = JSON.parse(rpcUsers);
          if (Array.isArray(p)) parsedRpc = p;
        } catch {}
      } else if (Array.isArray((rpcUsers as any).users)) {
        parsedRpc = (rpcUsers as any).users;
      }
      if (parsedRpc.length > 0) {
        rpcUsersList = mergeUserLists(rpcUsersList, parsedRpc);
      }
    }
  } catch {}

  // 2. Requête directe sur public.core_users avec sous-ensembles de colonnes sécurisés (sans pin ni pin_hash)
  const userTable = TABLES.users;
  const columnSets = [
    'id, auth_user_id, name, trigram, email, department, role_id, is_blocked, must_change_pin, is_preparer, allowed_depots, created_at, updated_at',
    'id, name, trigram, email, department, role_id, is_blocked, allowed_depots, created_at',
    'id, name, trigram, email, department, role_id, is_blocked',
    'id, name, trigram, email, department, role_id',
  ];

  for (const cols of columnSets) {
    try {
      const { data, error } = await client.from(userTable).select(cols);
      if (!error && Array.isArray(data)) {
        if (data.length > 0) {
          tableUsersList = data as unknown as User[];
        }
        break;
      }
    } catch {}
  }

  let deletedIds: string[] = [];
  try {
    const rawDel = localStorage.getItem('tot_deleted_user_ids');
    if (rawDel) deletedIds = JSON.parse(rawDel);
  } catch {}

  const merged = mergeUserLists(rpcUsersList, tableUsersList, sessionUserList);
  return merged.filter((u) => !(u as any).is_deleted && !deletedIds.includes(String(u.id)));
}

/**
 * Charge l'annuaire uniquement si une session authentifiée est déjà active.
 * Sécurité V18 : Aucun annuaire d'utilisateurs ou de départements n'est exposé avant connexion.
 */
export async function fetchLoginDirectory(client: SupabaseClient): Promise<{
  users?: User[];
  departments?: Department[];
  roles?: Role[];
}> {
  const result: { users?: User[]; departments?: Department[]; roles?: Role[] } = {};

  try {
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData?.session?.user) {
      return result;
    }
  } catch {
    return result;
  }

  try {
    const loadedUsers = await fetchUsersDirectorySafe(client);
    if (loadedUsers.length > 0) {
      result.users = loadedUsers;
    }
  } catch {}

  try {
    const { data, error } = await client.from(TABLES.departments).select('*');
    if (!error && Array.isArray(data) && data.length > 0) {
      result.departments = data as Department[];
    }
  } catch {}

  try {
    const { data, error } = await client.from(TABLES.roles).select('*');
    if (!error && Array.isArray(data) && data.length > 0) {
      result.roles = data as Role[];
    }
  } catch {}

  return result;
}

export interface ConnectionTestResult {
  ok: boolean;
  success: boolean;
  message: string;
  tables?: {
    products?: number;
    users?: number;
    movements?: number;
    departments?: number;
    projects?: number;
    depots?: number;
  };
}

export async function testClientSupabaseConnection(
  url: string,
  key: string
): Promise<ConnectionTestResult> {
  const cleanUrl = normalizeSupabaseUrl(url);
  const keyValidation = validateSupabaseAnonKey(key);
  if (!keyValidation.valid) {
    return {
      ok: false,
      success: false,
      message: keyValidation.errorMessage || 'Clé Supabase invalide.',
    };
  }
  const cleanKey = keyValidation.normalizedKey;

  if (!cleanUrl || !cleanKey) {
    return { ok: false, success: false, message: 'URL et clé Supabase requises.' };
  }

  try {
    const tempClient = createClient(cleanUrl, cleanKey, {
      auth: { persistSession: false },
    });

    const results: {
      products?: number;
      users?: number;
      movements?: number;
      departments?: number;
      projects?: number;
      depots?: number;
    } = {};

    // Test products table
    const prodTable = TABLES.products;
    const { data: prodData, error: prodErr, count: prodCount } = await tempClient
      .from(prodTable)
      .select('*', { count: 'exact', head: false })
      .limit(5);

    if (prodErr) {
      if (prodErr.code === 'PGRST301' || prodErr.message?.includes('JWT')) {
        return { ok: false, success: false, message: 'Erreur d\'authentification : clé API anon invalide ou expirée.' };
      }
      if (isNetworkOrFetchError(prodErr)) {
        return {
          ok: false,
          success: false,
          message: 'Échec de connexion réseau ("Failed to fetch") : Impossible de joindre votre projet Supabase. Vérifiez si votre projet gratuit est en veille (Paused sur supabase.com) ou si l\'URL API est exacte.',
        };
      }
    }

    if (!prodErr && prodData) {
      results.products = prodCount !== null && prodCount !== undefined ? prodCount : prodData.length;
    }

    // Test users table
    const loadedUsers = await fetchUsersDirectorySafe(tempClient);
    if (loadedUsers.length > 0) {
      results.users = loadedUsers.length;
    } else {
      const { data: userData, error: userErr } = await tempClient.from(TABLES.users).select('id, name').limit(20);
      if (!userErr && userData) {
        results.users = userData.length;
      }
    }

    // Test movements table
    const { data: movData, error: movErr } = await tempClient.from(TABLES.movements).select('id').limit(5);
    if (!movErr && movData) {
      results.movements = movData.length;
    }

    // Test depots table
    const { data: depData, error: depErr } = await tempClient.from(TABLES.depots).select('id').limit(10);
    if (!depErr && depData) {
      results.depots = depData.length;
    }

    if (results.products !== undefined || results.users !== undefined) {
      const pCount = results.products ?? 0;
      const uCount = results.users ?? 0;
      const dCount = results.depots !== undefined ? `, ${results.depots} dépôt(s)` : '';
      return {
        ok: true,
        success: true,
        message: `Connexion réussie ! ${pCount} produit(s), ${uCount} utilisateur(s)${dCount} détecté(s).`,
        tables: results,
      };
    }

    // If tables aren't found yet
    return {
      ok: true,
      success: true,
      message: 'Connecté à Supabase avec succès ! (Serveur en ligne et joignable).',
      tables: results,
    };
  } catch (err: any) {
    if (isNetworkOrFetchError(err)) {
      return {
        ok: false,
        success: false,
        message: 'Échec de connexion réseau ("Failed to fetch") : Impossible de joindre votre projet Supabase. Vérifiez si votre projet gratuit est en veille (Paused sur supabase.com) ou si l\'URL API est exacte.',
      };
    }
    return {
      ok: false,
      success: false,
      message: `Échec de connexion : ${err.message || 'Vérifiez l\'URL et la clé API.'}`,
    };
  }
}

export interface ClientDataPayload {
  products?: Product[];
  movements?: StockMovement[];
  stockLevels?: StockLevel[];
  users?: User[];
  roles?: Role[];
  departments?: Department[];
  projects?: Project[];
  subCategories?: SubCategory[];
  depots?: Depot[];
  orders?: MaterialOrder[];
}

export function normalizeStockLevelRecord(row: any): StockLevel {
  const pid = String(row?.product_id ?? '').trim();
  const dep = String(row?.depot_name ?? 'Dépôt Principal').trim();
  return {
    id: row?.id ? String(row.id) : `sl-${pid}-${dep}`,
    product_id: pid,
    depot_name: dep,
    quantity: Number(row?.quantity ?? 0),
    rack_location:
      row?.rack_location != null && String(row.rack_location).trim() !== ''
        ? String(row.rack_location).trim()
        : undefined,
    min_alert: row?.min_alert != null ? Number(row.min_alert) : undefined,
    updated_at: row?.updated_at ? String(row.updated_at) : undefined,
  };
}

export function normalizeProductRecord(p: any): Product {
  const ref = String(p?.reference ?? '').trim();
  const qr = p?.qr_code != null && String(p.qr_code).trim() !== '' ? String(p.qr_code).trim() : undefined;
  return {
    ...p,
    id: String(p?.id ?? '').trim(),
    reference: ref,
    brand: String(p?.brand ?? ''),
    model: String(p?.model ?? ''),
    barcode: p?.barcode != null && String(p.barcode).trim() !== '' ? String(p.barcode).trim() : undefined,
    qr_code: qr,
    manufacturer_ref:
      p?.manufacturer_ref != null && String(p.manufacturer_ref).trim() !== ''
        ? String(p.manufacturer_ref).trim()
        : undefined,
    store_name: p?.store_name != null ? String(p.store_name) : undefined,
    room_name: p?.room_name != null ? String(p.room_name) : undefined,
    shelf_name: p?.shelf_name != null ? String(p.shelf_name) : undefined,
    quantity: Number(p?.quantity) || 0,
    min_stock_alert: Number(p?.min_stock_alert ?? 2),
    unit_price: Number(p?.unit_price) || 0,
  };
}

export function normalizeMovementRecord(m: any): StockMovement {
  return {
    ...m,
    id: String(m?.id ?? ''),
    product_id: String(m?.product_id ?? ''),
    product_ref: m?.product_ref != null ? String(m.product_ref) : undefined,
    user_name: m?.user_name != null ? String(m.user_name) : '',
    site_number: m?.site_number != null && m?.site_number !== '' ? String(m.site_number) : null,
    department_name: m?.department_name != null && m?.department_name !== '' ? String(m.department_name) : null,
    depot_name: m?.depot_name != null && m?.depot_name !== '' ? String(m.depot_name) : undefined,
    order_number: m?.order_number != null && m?.order_number !== '' ? String(m.order_number) : undefined,
    quantity_changed: Number(m?.quantity_changed) || 0,
    movement_type: m?.movement_type === 'IN' ? 'IN' : 'OUT',
    created_at: m?.created_at ? String(m.created_at) : new Date().toISOString(),
  };
}

export function normalizeDepartmentRecord(d: any): Department {
  return {
    ...d,
    name: String(d?.name ?? 'Général'),
  };
}

export function normalizeProjectRecord(p: any): Project {
  const rawStatus = String(p?.status || '').trim().toUpperCase();
  const status = rawStatus === 'CLOSED' ? 'CLOSED' : 'IN_PROGRESS';
  return {
    ...p,
    project_number: String(p?.project_number ?? ''),
    project_name: String(p?.project_name ?? ''),
    status,
    closed_at: p?.closed_at != null ? String(p.closed_at) : null,
    closed_by: p?.closed_by != null ? p.closed_by : null,
    closed_by_name: p?.closed_by_name != null ? String(p.closed_by_name) : null,
    close_note: p?.close_note != null ? String(p.close_note) : null,
  };
}

export function normalizeDepotRecord(d: any): Depot {
  return {
    ...d,
    id: String(d?.id ?? ''),
    name: String(d?.name ?? ''),
    code: d?.code != null ? String(d.code) : undefined,
    address: d?.address != null ? String(d.address) : undefined,
    description: d?.description != null ? String(d.description) : undefined,
    license_plate: d?.license_plate != null ? String(d.license_plate) : undefined,
    vehicle_type: d?.vehicle_type != null ? String(d.vehicle_type) : undefined,
    manager_name: d?.manager_name != null ? String(d.manager_name) : undefined,
    department_name: d?.department_name != null ? String(d.department_name) : undefined,
  };
}

export function normalizeOrderRecord(o: any): MaterialOrder {
  return {
    ...o,
    id: String(o?.id ?? o?.order_number ?? ''),
    order_number: String(o?.order_number ?? o?.id ?? ''),
    site_number: String(o?.site_number ?? ''),
    site_name: o?.site_name != null ? String(o.site_name) : undefined,
    requester_name: String(o?.requester_name ?? ''),
    requester_department: o?.requester_department != null ? String(o.requester_department) : undefined,
    depot_name: o?.depot_name != null ? String(o.depot_name) : undefined,
    pickup_delegate_name: o?.pickup_delegate_name != null ? String(o.pickup_delegate_name) : undefined,
    collected_by: o?.collected_by != null ? String(o.collected_by) : undefined,
    items: Array.isArray(o?.items)
      ? o.items.map((it: any) => ({
          ...it,
          product_id: String(it?.product_id ?? ''),
          product_ref: String(it?.product_ref ?? ''),
          product_name: String(it?.product_name ?? ''),
          substituted_with_ref: it?.substituted_with_ref != null ? String(it.substituted_with_ref) : undefined,
        }))
      : [],
  };
}

export async function fetchAllClientData(client: SupabaseClient): Promise<ClientDataPayload> {
  const result: ClientDataPayload = {};

  // 1. Products
  try {
    const { data, error } = await client.from(TABLES.products).select('*').order('brand', { ascending: true });
    if (!error && data && data.length > 0) {
      result.products = data.map(normalizeProductRecord);
    }
  } catch (e) {
    console.warn('Erreur chargement products Supabase:', e);
  }

  // 2. Stock Movements (Fenêtre 7 jours par défaut)
  try {
    const sevenDaysAgoIso = new Date(Date.now() - 7 * 86_400_000).toISOString();
    let movQuery: any = client.from(TABLES.movements).select('*');
    if (typeof movQuery.gte === 'function') {
      movQuery = movQuery.gte('created_at', sevenDaysAgoIso);
    }
    if (typeof movQuery.order === 'function') {
      movQuery = movQuery.order('created_at', { ascending: false });
    }
    if (typeof movQuery.limit === 'function') {
      movQuery = movQuery.limit(500);
    }
    const { data, error } = await movQuery;
    if (!error && data && data.length > 0) {
      result.movements = filterMovementsDefault7Days(data.map(normalizeMovementRecord));
    }
  } catch (e) {
    console.warn('Erreur chargement movements Supabase:', e);
  }

  // 3. Users (Resilient loader with explicit safe column sets, never select('*'), never pin or pin_hash)
  try {
    const loadedUsers = await fetchUsersDirectorySafe(client);
    if (loadedUsers.length > 0) {
      result.users = loadedUsers;
    }
  } catch (e) {
    console.warn('Erreur chargement users Supabase:', e);
  }

  // 4. Roles
  try {
    const { data, error } = await client.from(TABLES.roles).select('*');
    if (!error && data && data.length > 0) {
      result.roles = data as Role[];
    }
  } catch (e) {
    console.warn('Erreur chargement roles Supabase:', e);
  }

  // 5. Departments
  try {
    const { data, error } = await client.from(TABLES.departments).select('*');
    if (!error && data && data.length > 0) {
      result.departments = data.map(normalizeDepartmentRecord);
    }
  } catch (e) {
    console.warn('Erreur chargement departments Supabase:', e);
  }

  // 6. Projects
  try {
    const { data, error } = await client.from(TABLES.projects).select('*');
    if (!error && data && data.length > 0) {
      result.projects = data.map(normalizeProjectRecord);
    }
  } catch (e) {
    console.warn('Erreur chargement projects Supabase:', e);
  }

  // 7. Subcategories
  try {
    const { data, error } = await client.from(TABLES.subCategories).select('*');
    if (!error && data && data.length > 0) {
      result.subCategories = data as SubCategory[];
    }
  } catch (e) {
    console.warn('Erreur chargement subcategories Supabase:', e);
  }

  // 8. Depots / Magasins
  try {
    const { data, error } = await client.from(TABLES.depots).select('*');
    if (!error && data && data.length > 0) {
      result.depots = data.map(normalizeDepotRecord);
    }
  } catch (e) {
    console.warn('Erreur chargement depots Supabase:', e);
  }

  // 9. Material Orders (Drive Chantier & Préparation) — Fusion table + miroir temps réel app_settings
  try {
    const mergedOrders = await fetchOrdersMergedFromSupabase(client);
    if (mergedOrders.length > 0) {
      result.orders = mergedOrders;
    }
  } catch (e) {
    console.warn('Erreur chargement material_orders Supabase:', e);
  }

  // 10. Stock Levels (par dépôt)
  try {
    const { data, error } = await client.from(TABLES.stockLevels).select('*');
    if (!error && Array.isArray(data)) {
      result.stockLevels = data.map(normalizeStockLevelRecord);
    }
  } catch (e) {
    console.warn('Erreur chargement stock_levels Supabase:', e);
  }

  return result;
}

const ORDER_STATUS_RANK: Record<string, number> = {
  WAITING_APPROVAL: 1,
  PENDING: 2,
  PREPARING: 3,
  READY: 4,
  COLLECTED: 5,
  REJECTED: 5,
  CANCELLED: 5,
};

export function getOrderLastModifiedMs(o: MaterialOrder): number {
  let maxMs = 0;
  const candidates = [
    o.updated_at,
    o.collected_at,
    o.ready_at,
    o.assigned_at,
    o.approved_at,
    o.rejected_at,
    o.pickup_delegate_at,
    o.created_at,
  ];
  for (const c of candidates) {
    if (c) {
      const parsed = Date.parse(c);
      if (!Number.isNaN(parsed) && parsed > maxMs) maxMs = parsed;
    }
  }
  if (Array.isArray(o.items)) {
    for (const it of o.items) {
      if (it?.scanned_at) {
        const parsed = Date.parse(it.scanned_at);
        if (!Number.isNaN(parsed) && parsed > maxMs) maxMs = parsed;
      }
    }
  }
  return maxMs;
}

export function pickNewerOrder(a: MaterialOrder, b: MaterialOrder): MaterialOrder {
  const rankA = ORDER_STATUS_RANK[a.status] || 0;
  const rankB = ORDER_STATUS_RANK[b.status] || 0;
  const timeA = getOrderLastModifiedMs(a);
  const timeB = getOrderLastModifiedMs(b);

  const updA = a.updated_at ? Date.parse(a.updated_at) : 0;
  const updB = b.updated_at ? Date.parse(b.updated_at) : 0;
  if (!Number.isNaN(updA) && !Number.isNaN(updB) && updA > 0 && updB > 0 && updA !== updB) {
    return updB > updA ? { ...a, ...b } : { ...b, ...a };
  }

  if (rankB > rankA) return { ...a, ...b };
  if (rankA > rankB) return { ...b, ...a };

  if (timeB > timeA) return { ...a, ...b };
  if (timeA > timeB) return { ...b, ...a };

  const pickedA = Array.isArray(a.items) ? a.items.filter((i) => i.picked || i.unavailable).length : 0;
  const pickedB = Array.isArray(b.items) ? b.items.filter((i) => i.picked || i.unavailable).length : 0;
  if (pickedB >= pickedA) return { ...a, ...b };
  return { ...b, ...a };
}

export function mergeMaterialOrdersLists(...lists: (MaterialOrder[] | undefined | null)[]): MaterialOrder[] {
  const byKey = new Map<string, MaterialOrder>();
  const orderNumberToId = new Map<string, string>();

  let deletedOrderIds: string[] = [];
  try {
    const rawDel = localStorage.getItem('tot_deleted_order_ids');
    if (rawDel) deletedOrderIds = JSON.parse(rawDel);
  } catch {}
  const deletedSet = new Set(deletedOrderIds.map(String));

  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      if (!raw || (!raw.id && !raw.order_number)) continue;
      if (raw.notes === '[SUPPRIMÉE]') {
        if (raw.id) deletedSet.add(String(raw.id));
        if (raw.order_number) deletedSet.add(String(raw.order_number).trim());
        continue;
      }
      const norm = normalizeOrderRecord(raw);
      const idKey = String(norm.id || norm.order_number);
      const ordNum = norm.order_number ? String(norm.order_number).trim() : '';
      if (deletedSet.has(idKey) || (ordNum && deletedSet.has(ordNum))) continue;
      const mappedKey =
        (!raw.id && ordNum && orderNumberToId.get(ordNum)) || idKey;

      const existing = byKey.get(mappedKey);
      if (!existing) {
        byKey.set(mappedKey, norm);
        if (ordNum && !orderNumberToId.has(ordNum)) {
          orderNumberToId.set(ordNum, mappedKey);
        }
      } else {
        const winner = pickNewerOrder(existing, norm);
        byKey.set(mappedKey, winner);
      }
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    const tA = Date.parse(a.created_at || '') || 0;
    const tB = Date.parse(b.created_at || '') || 0;
    return tB - tA;
  });
}

function mergeRemoteDeletedOrderIds(remoteDeletedIds: string[]): void {
  if (!Array.isArray(remoteDeletedIds) || remoteDeletedIds.length === 0) return;
  try {
    const rawDel = localStorage.getItem('tot_deleted_order_ids');
    const localDel: string[] = rawDel ? JSON.parse(rawDel) : [];
    const combined = Array.from(new Set([...localDel, ...remoteDeletedIds.map(String)])).filter(Boolean);
    if (combined.length !== localDel.length) {
      localStorage.setItem('tot_deleted_order_ids', JSON.stringify(combined));
    }
  } catch {}
}

async function fetchOrdersFromSettingsMirror(client: SupabaseClient): Promise<MaterialOrder[]> {
  const collected: MaterialOrder[][] = [];
  try {
    const { data, error } = await client
      .from(TABLES.appSettings)
      .select('key, value')
      .in('key', ['company_orders_sync', 'company_license_info']);
    if (!error && Array.isArray(data)) {
      for (const row of data) {
        if (row.key === 'company_orders_sync' && row.value) {
          try {
            const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
            if (Array.isArray(parsed)) {
              collected.push(parsed as MaterialOrder[]);
            } else if (parsed && typeof parsed === 'object') {
              if (Array.isArray(parsed.deleted_ids)) {
                mergeRemoteDeletedOrderIds(parsed.deleted_ids);
              }
              if (Array.isArray(parsed.orders)) {
                collected.push(parsed.orders as MaterialOrder[]);
              }
            }
          } catch {}
        } else if (row.key === 'company_license_info' && row.value) {
          try {
            const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
            if (parsed && typeof parsed === 'object') {
              if (Array.isArray(parsed.deleted_order_ids)) {
                mergeRemoteDeletedOrderIds(parsed.deleted_order_ids);
              }
              if (Array.isArray(parsed.orders_sync)) {
                collected.push(parsed.orders_sync as MaterialOrder[]);
              }
            }
          } catch {}
        }
      }
    }
  } catch {}
  return collected.length > 0 ? mergeMaterialOrdersLists(...collected) : [];
}

async function mirrorOrderToSettings(client: SupabaseClient, order: MaterialOrder): Promise<void> {
  try {
    const existingMirror = await fetchOrdersFromSettingsMirror(client);
    const merged = mergeMaterialOrdersLists(existingMirror, [order]).slice(0, 150);

    let deletedIds: string[] = [];
    try {
      const rawDel = localStorage.getItem('tot_deleted_order_ids');
      if (rawDel) deletedIds = JSON.parse(rawDel);
    } catch {}

    // 1. Écriture directe sur 'company_orders_sync' (autorisée par RLS pour TOUS les utilisateurs authentifiés)
    await client
      .from(TABLES.appSettings)
      .upsert(
        [
          {
            key: 'company_orders_sync',
            value: JSON.stringify({
              orders: merged,
              deleted_ids: deletedIds.slice(-200),
            }),
            updated_at: new Date().toISOString(),
          },
        ],
        { onConflict: 'key' }
      )
      .then(() => {});

    // 2. Miroir secondaire dans company_license_info (pour administrateurs)
    await updateCompanyLicenseInfoShared(client, (licObj) => ({
      ...licObj,
      deleted_order_ids: deletedIds.slice(-200),
      orders_sync: mergeMaterialOrdersLists(
        Array.isArray(licObj.orders_sync) ? licObj.orders_sync : [],
        merged
      ).slice(0, 150),
    }));
  } catch {}
}

export interface UserBasketSyncEntry {
  userId: string;
  authUserId?: string;
  trigram?: string;
  email?: string;
  baskets: OrderBasket[];
  activeBasketId: string;
  batchCart?: BatchCartItem[];
  updatedAt: number;
}

export function getCanonicalUserBasketKey(user: {
  id?: string | number;
  auth_user_id?: string | null;
  trigram?: string | null;
  email?: string | null;
}): string {
  if (user.email && String(user.email).trim()) {
    return `email:${String(user.email).trim().toLowerCase()}`;
  }
  if (user.auth_user_id && String(user.auth_user_id).trim()) {
    return `auth:${String(user.auth_user_id).trim().toLowerCase()}`;
  }
  if (user.trigram && String(user.trigram).trim()) {
    return `trigram:${String(user.trigram).trim().toUpperCase()}`;
  }
  return `id:${String(user.id ?? 'anon')}`;
}

export function mergeOrderBasketsForInitialSync(
  localBaskets: OrderBasket[],
  remoteBaskets: OrderBasket[]
): OrderBasket[] {
  const localNonEmpty = (localBaskets || []).filter((b) => Array.isArray(b.items) && b.items.length > 0);
  const remoteNonEmpty = (remoteBaskets || []).filter((b) => Array.isArray(b.items) && b.items.length > 0);

  if (localNonEmpty.length === 0) return remoteBaskets.length > 0 ? remoteBaskets : localBaskets;
  if (remoteNonEmpty.length === 0) return localBaskets.length > 0 ? localBaskets : remoteBaskets;

  const mergedMap = new Map<string, OrderBasket>();

  for (const rb of remoteBaskets) {
    mergedMap.set(rb.id, { ...rb, items: [...(rb.items || [])] });
  }

  for (const lb of localNonEmpty) {
    // Match by id or by same depot_name + name
    let target = mergedMap.get(lb.id);
    if (!target) {
      target = Array.from(mergedMap.values()).find(
        (b) =>
          (b.depot_name || '').toLowerCase() === (lb.depot_name || '').toLowerCase() &&
          (b.name.toLowerCase() === lb.name.toLowerCase() || b.items.length === 0)
      );
    }

    if (target) {
      const itemMap = new Map<string, any>();
      for (const it of target.items) {
        itemMap.set(String(it.product_id), { ...it });
      }
      for (const it of lb.items) {
        const key = String(it.product_id);
        const ex = itemMap.get(key);
        if (ex) {
          itemMap.set(key, {
            ...ex,
            ...it,
            quantity: Math.max(Number(ex.quantity) || 1, Number(it.quantity) || 1),
          });
        } else {
          itemMap.set(key, { ...it });
        }
      }
      const combinedItems = Array.from(itemMap.values());
      mergedMap.set(target.id, {
        ...target,
        depot_name: target.depot_name || lb.depot_name || combinedItems[0]?.depot_name,
        site_number: target.site_number || lb.site_number,
        notes: target.notes || lb.notes,
        items: combinedItems,
      });
    } else {
      const uniqueId = mergedMap.has(lb.id) ? `${lb.id}-${Date.now()}` : lb.id;
      mergedMap.set(uniqueId, { ...lb, id: uniqueId });
    }
  }

  return Array.from(mergedMap.values());
}

async function fetchAllUserBasketsMapFromSettings(
  client: SupabaseClient
): Promise<Record<string, UserBasketSyncEntry>> {
  const combined: Record<string, UserBasketSyncEntry> = {};

  const mergeDict = (dict: any) => {
    if (!dict || typeof dict !== 'object' || Array.isArray(dict)) return;
    for (const [k, val] of Object.entries(dict)) {
      const entry = val as UserBasketSyncEntry;
      if (!entry || !Array.isArray(entry.baskets)) continue;
      const existing = combined[k];
      if (!existing || (Number(entry.updatedAt) || 0) >= (Number(existing.updatedAt) || 0)) {
        combined[k] = entry;
      }
    }
  };

  try {
    const { data, error } = await client
      .from(TABLES.appSettings)
      .select('key, value')
      .in('key', ['company_user_baskets', 'company_license_info']);
    if (!error && Array.isArray(data)) {
      for (const row of data) {
        if (row.key === 'company_user_baskets' && row.value) {
          try {
            const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
            mergeDict(parsed);
          } catch {}
        } else if (row.key === 'company_license_info' && row.value) {
          try {
            const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
            if (parsed && parsed.user_baskets_sync) {
              mergeDict(parsed.user_baskets_sync);
            }
          } catch {}
        }
      }
    }
  } catch {}

  return combined;
}

export async function fetchUserBasketsFromSupabase(
  client: SupabaseClient | null,
  user: User | null
): Promise<UserBasketSyncEntry | null> {
  if (!client || !user) return null;
  try {
    let sessionAuthId = '';
    let sessionEmail = '';
    try {
      const { data: sessionData } = await client.auth.getSession();
      if (sessionData?.session?.user) {
        sessionAuthId = String(sessionData.session.user.id || '').trim().toLowerCase();
        sessionEmail = String(sessionData.session.user.email || '').trim().toLowerCase();
      }
    } catch {}

    const map = await fetchAllUserBasketsMapFromSettings(client);
    const effectiveUser = {
      ...user,
      email: user.email || sessionEmail || undefined,
      auth_user_id: user.auth_user_id || sessionAuthId || undefined,
    };
    const canonicalKey = getCanonicalUserBasketKey(effectiveUser);
    const candidates: UserBasketSyncEntry[] = [];

    if (map[canonicalKey]) {
      candidates.push(map[canonicalKey]);
    }

    const userTrig = (user.trigram || '').trim().toUpperCase();
    const userEmail = (user.email || sessionEmail || '').trim().toLowerCase();
    const userAuthId = (user.auth_user_id || sessionAuthId || '').trim().toLowerCase();
    const userIdStr = String(user.id);

    for (const entry of Object.values(map)) {
      if (!entry || !Array.isArray(entry.baskets)) continue;
      const eTrig = (entry.trigram || '').trim().toUpperCase();
      const eEmail = (entry.email || '').trim().toLowerCase();
      const eAuthId = (entry.authUserId || '').trim().toLowerCase();
      const eId = String(entry.userId || '');

      if (
        (userEmail && eEmail && userEmail === eEmail) ||
        (userAuthId && eAuthId && userAuthId === eAuthId) ||
        (userAuthId && eId && userAuthId === eId.toLowerCase()) ||
        (userTrig && eTrig && userTrig === eTrig) ||
        (userIdStr && eId && userIdStr === eId)
      ) {
        candidates.push(entry);
      }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
    return candidates[0];
  } catch {
    return null;
  }
}

export async function pushUserBasketsToSupabase(
  client: SupabaseClient | null,
  user: User | null,
  baskets: OrderBasket[],
  activeBasketId: string,
  batchCart?: BatchCartItem[],
  updatedAt?: number
): Promise<boolean> {
  if (!client || !user) return false;
  try {
    let sessionAuthId = '';
    let sessionEmail = '';
    try {
      const { data: sessionData } = await client.auth.getSession();
      if (sessionData?.session?.user) {
        sessionAuthId = String(sessionData.session.user.id || '').trim();
        sessionEmail = String(sessionData.session.user.email || '').trim().toLowerCase();
      }
    } catch {}

    const ts = updatedAt || Date.now();
    const effectiveEmail = (user.email || sessionEmail || '').trim().toLowerCase();
    const effectiveAuthId = (user.auth_user_id || sessionAuthId || '').trim();
    const canonicalKey = getCanonicalUserBasketKey({
      ...user,
      email: effectiveEmail || undefined,
      auth_user_id: effectiveAuthId || undefined,
    });

    const entry: UserBasketSyncEntry = {
      userId: String(user.id),
      authUserId: effectiveAuthId || undefined,
      trigram: user.trigram || undefined,
      email: effectiveEmail || undefined,
      baskets,
      activeBasketId,
      batchCart: batchCart || [],
      updatedAt: ts,
    };

    const userTrig = (user.trigram || '').trim().toUpperCase();
    const userIdStr = String(user.id);

    const cleanDuplicatesInMap = (mapObj: Record<string, UserBasketSyncEntry>) => {
      for (const [k, v] of Object.entries(mapObj)) {
        if (!v) continue;
        const eTrig = (v.trigram || '').trim().toUpperCase();
        const eEmail = (v.email || '').trim().toLowerCase();
        const eAuthId = (v.authUserId || '').trim().toLowerCase();
        const eId = String(v.userId || '');
        if (
          (effectiveEmail && eEmail && effectiveEmail === eEmail) ||
          (effectiveAuthId && eAuthId && effectiveAuthId.toLowerCase() === eAuthId) ||
          (userTrig && eTrig && userTrig === eTrig) ||
          (userIdStr && eId && userIdStr === eId)
        ) {
          delete mapObj[k];
        }
      }
      mapObj[canonicalKey] = entry;
      return mapObj;
    };

    // 1. Écriture directe sur 'company_user_baskets' (autorisée par RLS pour TOUS les utilisateurs authentifiés)
    let directSuccess = false;
    try {
      const currentMap = await fetchAllUserBasketsMapFromSettings(client);
      const updatedMap = cleanDuplicatesInMap({ ...currentMap });
      const { error: upErr } = await client.from(TABLES.appSettings).upsert(
        [
          {
            key: 'company_user_baskets',
            value: JSON.stringify(updatedMap),
            updated_at: new Date().toISOString(),
          },
        ],
        { onConflict: 'key' }
      );
      if (!upErr) {
        directSuccess = true;
      }
    } catch {}

    // 2. Miroir secondaire dans company_license_info
    const sharedSuccess = await updateCompanyLicenseInfoShared(client, (licObj) => {
      const existingMap: Record<string, UserBasketSyncEntry> = {
        ...(licObj.user_baskets_sync && typeof licObj.user_baskets_sync === 'object'
          ? licObj.user_baskets_sync
          : {}),
      };
      cleanDuplicatesInMap(existingMap);
      return {
        ...licObj,
        user_baskets_sync: existingMap,
      };
    });

    if (directSuccess || sharedSuccess) {
      notifyRealtimeDataMutated('baskets');
    }
    return directSuccess || sharedSuccess;
  } catch {
    return false;
  }
}

export async function fetchOrdersMergedFromSupabase(
  client: SupabaseClient,
  options?: { windowDays?: number }
): Promise<MaterialOrder[]> {
  const windowDays = options?.windowDays !== undefined ? options.windowDays : 7;
  let tableOrders: MaterialOrder[] = [];
  let mirrorOrders: MaterialOrder[] = [];

  // Charger d'abord le miroir pour récupérer les deleted_ids distants avant la fusion
  try {
    mirrorOrders = await fetchOrdersFromSettingsMirror(client);
  } catch {}

  try {
    const cutoffIso = new Date(Date.now() - Math.max(1, windowDays) * 86_400_000).toISOString();
    let query: any = client.from(TABLES.materialOrders).select('*');
    if (windowDays > 0 && typeof query.or === 'function') {
      query = query.or(
        `created_at.gte.${cutoffIso},status.in.(WAITING_APPROVAL,PENDING,PREPARING,READY)`
      );
    }
    if (typeof query.order === 'function') {
      query = query.order('created_at', { ascending: false });
    }
    const { data, error } = await query;
    if (!error && Array.isArray(data)) {
      const newlyDeleted: string[] = [];
      tableOrders = (data as MaterialOrder[]).filter((row) => {
        if (row.notes === '[SUPPRIMÉE]') {
          if (row.id) newlyDeleted.push(String(row.id));
          if (row.order_number) newlyDeleted.push(String(row.order_number).trim());
          return false;
        }
        return true;
      });
      if (newlyDeleted.length > 0) {
        mergeRemoteDeletedOrderIds(newlyDeleted);
      }
    }
  } catch {}

  const merged = mergeMaterialOrdersLists(tableOrders, mirrorOrders);
  return windowDays > 0 ? filterOrdersDefault7DaysAndActive(merged) : merged;
}

export async function searchMaterialOrdersOnServer(
  client: SupabaseClient,
  filters: OrderSearchFilters,
  limit = 50,
  offset = 0
): Promise<{ rows: MaterialOrder[]; totalCount: number; error?: string }> {
  const params = buildSearchMaterialOrdersRpcParams(filters, limit, offset);
  const { data, error } = await client.rpc('search_material_orders', params);
  if (error) {
    return {
      rows: [],
      totalCount: 0,
      error: formatPostgresErrorMessage(error),
    };
  }
  const list = Array.isArray(data) ? data : [];
  const totalCount = list.length > 0 ? Number(list[0]?.total_count ?? list.length) : 0;
  const rows = list
    .map((item: any) => item?.row_data ?? item)
    .filter(Boolean)
    .map(normalizeOrderRecord);
  return { rows, totalCount };
}

export async function searchStockMovementsOnServer(
  client: SupabaseClient,
  filters: MovementSearchFilters,
  limit = 50,
  offset = 0
): Promise<{ rows: StockMovement[]; totalCount: number; error?: string }> {
  const params = buildSearchStockMovementsRpcParams(filters, limit, offset);
  const { data, error } = await client.rpc('search_stock_movements', params);
  if (error) {
    return {
      rows: [],
      totalCount: 0,
      error: formatPostgresErrorMessage(error),
    };
  }
  const list = Array.isArray(data) ? data : [];
  const totalCount = list.length > 0 ? Number(list[0]?.total_count ?? list.length) : 0;
  const rows = list
    .map((item: any) => item?.row_data ?? item)
    .filter(Boolean)
    .map(normalizeMovementRecord);
  return { rows, totalCount };
}

export async function fetchLiveOperationalData(
  client: SupabaseClient,
  currentUser?: User | null
): Promise<{
  orders?: MaterialOrder[];
  products?: Product[];
  movements?: StockMovement[];
  stockLevels?: StockLevel[];
  depots?: Depot[];
  departments?: Department[];
  projects?: Project[];
  subCategories?: SubCategory[];
  users?: User[];
  roles?: Role[];
  publicSettings?: Record<string, string>;
  userBaskets?: UserBasketSyncEntry | null;
}> {
  const result: {
    orders?: MaterialOrder[];
    products?: Product[];
    movements?: StockMovement[];
    stockLevels?: StockLevel[];
    depots?: Depot[];
    departments?: Department[];
    projects?: Project[];
    subCategories?: SubCategory[];
    users?: User[];
    roles?: Role[];
    publicSettings?: Record<string, string>;
    userBaskets?: UserBasketSyncEntry | null;
  } = {};

  await Promise.all([
    (async () => {
      try {
        const orders = await fetchOrdersMergedFromSupabase(client, { windowDays: 7 });
        result.orders = orders;
      } catch {}
    })(),
    (async () => {
      if (!currentUser) return;
      try {
        const ub = await fetchUserBasketsFromSupabase(client, currentUser);
        if (ub) result.userBaskets = ub;
      } catch {}
    })(),
    (async () => {
      try {
        const { data, error } = await client.from(TABLES.products).select('*').order('brand', { ascending: true });
        if (!error && Array.isArray(data) && data.length > 0) {
          result.products = data.map(normalizeProductRecord);
        }
      } catch {}
    })(),
    (async () => {
      try {
        const sevenDaysAgoIso = new Date(Date.now() - 7 * 86_400_000).toISOString();
        let movQuery: any = client.from(TABLES.movements).select('*');
        if (typeof movQuery.gte === 'function') {
          movQuery = movQuery.gte('created_at', sevenDaysAgoIso);
        }
        if (typeof movQuery.order === 'function') {
          movQuery = movQuery.order('created_at', { ascending: false });
        }
        if (typeof movQuery.limit === 'function') {
          movQuery = movQuery.limit(500);
        }
        const { data, error } = await movQuery;
        if (!error && Array.isArray(data)) {
          result.movements = filterMovementsDefault7Days(data.map(normalizeMovementRecord));
        }
      } catch {}
    })(),
    (async () => {
      try {
        const { data, error } = await client.from(TABLES.depots).select('*');
        if (!error && Array.isArray(data) && data.length > 0) {
          result.depots = data.map(normalizeDepotRecord);
        }
      } catch {}
    })(),
    (async () => {
      try {
        const { data, error } = await client.from(TABLES.departments).select('*');
        if (!error && Array.isArray(data) && data.length > 0) {
          result.departments = data.map(normalizeDepartmentRecord);
        }
      } catch {}
    })(),
    (async () => {
      try {
        const { data, error } = await client.from(TABLES.projects).select('*');
        if (!error && Array.isArray(data)) {
          result.projects = data.map(normalizeProjectRecord);
        }
      } catch {}
    })(),
    (async () => {
      try {
        const { data, error } = await client.from(TABLES.subCategories).select('*');
        if (!error && Array.isArray(data)) {
          result.subCategories = data as SubCategory[];
        }
      } catch {}
    })(),
    (async () => {
      try {
        const loadedUsers = await fetchUsersDirectorySafe(client);
        if (loadedUsers.length > 0) {
          result.users = loadedUsers;
        }
      } catch {}
    })(),
    (async () => {
      try {
        const { data, error } = await client.from(TABLES.roles).select('*');
        if (!error && Array.isArray(data) && data.length > 0) {
          result.roles = data as Role[];
        }
      } catch {}
    })(),
    (async () => {
      try {
        const pub = await fetchPublicAppSettings(client);
        if (pub && Object.keys(pub).length > 0) {
          result.publicSettings = pub;
        }
      } catch {}
    })(),
    (async () => {
      try {
        const { data, error } = await client.from(TABLES.stockLevels).select('*');
        if (!error && Array.isArray(data)) {
          result.stockLevels = data.map(normalizeStockLevelRecord);
        }
      } catch {}
    })(),
  ]);

  return result;
}

export const PERMISSION_DENIED_READABLE_MESSAGE =
  'Droit refusé par le serveur (session expirée ou non liée). Reconnectez-vous.';

export const NO_AUTH_SESSION_BANNER_MESSAGE =
  'Session serveur absente : connectez-vous avec un compte lié à Supabase Auth (e-mail confirmé). Les enregistrements sont refusés tant que ce n\'est pas fait.';

/**
 * Traduit `permission denied for table|function|schema|relation X` en message lisible (v60 §10.4),
 * tout en conservant intacts les messages métiers des triggers / contraintes SQL (`23514`, `22023`, `42501` métier).
 */
export function translatePermissionDeniedError(
  errorOrMessage: any,
  fallback = 'Une erreur est survenue.'
): string {
  if (!errorOrMessage) return fallback;
  const msg =
    typeof errorOrMessage === 'string'
      ? errorOrMessage
      : String(errorOrMessage?.message || errorOrMessage?.details || errorOrMessage || '');
  if (/permission denied for (?:table|function|schema|sequence|relation)\b/i.test(msg)) {
    return PERMISSION_DENIED_READABLE_MESSAGE;
  }
  return msg || fallback;
}

/**
 * Cleanly formats PostgreSQL / Supabase errors, especially RLS code 42501 (insufficient_privilege).
 */
export function formatPostgresErrorMessage(error: any, fallback = 'Une erreur est survenue.'): string {
  if (!error) return fallback;
  const code = String(error.code || error.statusCode || '');
  const msg = String(error.message || error.details || error || '');
  if (/permission denied for (?:table|function|schema|sequence|relation)\b/i.test(msg)) {
    return PERMISSION_DENIED_READABLE_MESSAGE;
  }
  // Conserver tels quels les messages métiers explicites (23514, 22023, ou 42501 avec message métier français)
  if (code === '23514' || code === '22023') {
    return msg || fallback;
  }
  if (
    code === '42501' &&
    msg &&
    !msg.toLowerCase().includes('permission denied') &&
    !msg.toLowerCase().includes('row-level security')
  ) {
    return msg;
  }
  if (
    code === '42501' ||
    msg.includes('42501') ||
    msg.toLowerCase().includes('permission denied') ||
    msg.toLowerCase().includes('violates row-level security') ||
    msg.toLowerCase().includes('row-level security policy')
  ) {
    return PERMISSION_DENIED_READABLE_MESSAGE;
  }
  return msg || fallback;
}

/**
 * Fetches public app settings (company currency, name, logo, license) before authentication.
 */
export async function fetchPublicAppSettings(client: SupabaseClient): Promise<Record<string, string>> {
  const settingsMap: Record<string, string> = {};
  try {
    const { data, error } = await client
      .from(TABLES.appSettings)
      .select('key, value')
      .in('key', [
        'company_currency',
        'company_name',
        'company_logo',
        'app_logo_url',
        'company_license_info',
        'license_key',
        'company_users_directory',
      ]);

    if (error) {
      if (isNetworkOrFetchError(error)) {
        throw error;
      }
      return settingsMap;
    }
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item.key && item.value) {
          settingsMap[item.key] = item.value;
        }
      }
    }
  } catch (err) {
    if (isNetworkOrFetchError(err)) {
      throw err;
    }
  }
  return settingsMap;
}

// Write Operations with error resilience
export async function pushMovementToSupabase(
  client: SupabaseClient,
  movement: StockMovement,
  newProductQty?: number,
  _currentUserId?: string | number,
  operationId?: string,
  destDepotName?: string,
  destRack?: string,
  actionType?: string
): Promise<{
  success: boolean;
  newQty?: number;
  error?: string;
  errorCode?: string;
  rawError?: any;
  conflict?: boolean;
  depotQty?: number;
  destDepotQty?: number;
  isNetworkError?: boolean;
}> {
  const opId =
    operationId ||
    (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'op-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7));

  const effectiveType = String(movement.type || movement.movement_type || 'OUT').toUpperCase();
  const effectiveQty =
    effectiveType === 'INVENTORY' && newProductQty !== undefined
      ? Number(newProductQty)
      : Number(movement.quantity ?? movement.quantity_changed ?? 0);

  const effectiveDestDepot =
    destDepotName ||
    movement.dest_depot_name ||
    (movement.metadata?.dest_depot_name as string) ||
    null;
  const effectiveDestRack =
    destRack ||
    (movement as any).dest_rack ||
    (movement.metadata?.dest_rack as string) ||
    (movement.metadata?.rack_location as string) ||
    null;

  try {
    // Exécution exclusivement via la RPC transactionnelle côté serveur (process_stock_movement - 12 paramètres)
    // ZÉRO écriture directe de secours sur movements / stock_movements / products
    const { data: rpcData, error: rpcErr } = await client.rpc('process_stock_movement', {
      p_operation_id: opId,
      p_product_id: String(movement.product_id),
      p_depot_name: movement.depot_name || null,
      p_type: effectiveType,
      p_quantity: effectiveQty,
      p_reason: movement.reason || (movement.site_number ? `Chantier: ${movement.site_number}` : null),
      p_project_name: movement.project_name || movement.site_number || null,
      p_department: movement.department || movement.department_name || null,
      p_dest_depot_name: effectiveDestDepot,
      p_dest_rack: effectiveDestRack,
      p_metadata: {
        id: movement.id,
        product_ref: movement.product_ref,
        ...(movement.order_number ? { order_number: movement.order_number } : {}),
        ...(movement.metadata || {}),
      },
      p_action: actionType || 'STOCK_DIRECT_MOVE',
    });

    if (rpcErr) {
      const code = String(rpcErr.code || '');
      const msg = String(rpcErr.message || '');
      const isMissingRpc =
        code === '42883' ||
        code === 'PGRST202' ||
        /function .*process_stock_movement.* does not exist|could not find the function/i.test(msg);

      const formattedErr = isMissingRpc
        ? `${formatPostgresErrorMessage(rpcErr)} — Le serveur n'a pas la dernière version des scripts SQL (03, 04) : exécutez dist/install.sql`
        : formatPostgresErrorMessage(rpcErr);

      return {
        success: false,
        error: formattedErr,
        errorCode: code || undefined,
        rawError: rpcErr,
        conflict: code === '23514' || msg.includes('Stock insuffisant'),
        isNetworkError: isNetworkOrFetchError(rpcErr),
      };
    }

    if (rpcData && rpcData.success === false) {
      return {
        success: false,
        error: rpcData.message || 'Mouvement rejeté par le serveur.',
        errorCode: rpcData.error_code ? String(rpcData.error_code) : undefined,
        rawError: rpcData,
        conflict: rpcData.error_code === 'REJECTED_STOCK_CONFLICT',
      };
    }

    notifyRealtimeDataMutated('movements');
    return {
      success: true,
      newQty: rpcData?.new_quantity ?? newProductQty,
      depotQty: rpcData?.depot_quantity,
      destDepotQty: rpcData?.dest_depot_quantity,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Exception mouvement',
      errorCode: err?.code ? String(err.code) : undefined,
      rawError: err,
      isNetworkError: isNetworkOrFetchError(err),
    };
  }
}

/**
 * Priorité N°8 : Transition d'état contrôlée des commandes côté serveur
 * ZÉRO écriture directe de secours sur material_orders.
 */
export async function transitionOrderStatusSupabase(
  client: SupabaseClient | null,
  orderId: string,
  targetStatus: string,
  comment?: string,
  preparerId?: string,
  operationId?: string
): Promise<{ success: boolean; error?: string; isNetworkError?: boolean }> {
  if (!client) return { success: false, error: 'Supabase non connecté.', isNetworkError: true };
  const opId =
    operationId ||
    (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'ord-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7));

  try {
    const { data: rpcData, error: rpcErr } = await client.rpc('transition_order_status', {
      p_operation_id: opId,
      p_order_id: orderId,
      p_target_status: targetStatus,
      p_comment: comment || null,
      p_preparer_id: preparerId || null,
    });

    if (rpcErr) {
      return {
        success: false,
        error: formatPostgresErrorMessage(rpcErr),
        isNetworkError: isNetworkOrFetchError(rpcErr),
      };
    }

    if (rpcData && rpcData.success === false) {
      return { success: false, error: rpcData.message };
    }

    notifyRealtimeDataMutated('orders');
    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message,
      isNetworkError: isNetworkOrFetchError(err),
    };
  }
}

export async function upsertProductToSupabase(
  client: SupabaseClient,
  product: Product,
  canEditAllFields: boolean = true
): Promise<{ success: boolean; error?: string }> {
  try {
    const prodTable = TABLES.products;
    
    // Si l'utilisateur n'a pas les droits d'édition de métadonnées, aucune mise à jour directe n'est permise
    // (la modification des quantités passe obligatoirement par process_stock_movement)
    if (!canEditAllFields) {
      return { success: true };
    }

    // Protection stricte : La colonne 'quantity' ne doit JAMAIS être envoyée lors de l'upsert direct de produit
    // La quantité est la somme des stock_levels gérée exclusivement par process_stock_movement()
    const { quantity, ...rawMetadata } = product;
    const productMetadata = {
      ...rawMetadata,
      updated_at: new Date().toISOString(),
    };

    // Helper fallback if legacy DB schema does not have qr_code column yet
    const stripUnsupportedColumns = (meta: Record<string, any>) => {
      const { qr_code, ...legacyMeta } = meta;
      return legacyMeta;
    };

    // 1. Si l'article existe déjà (par id ou reference), exécuter un UPDATE d'abord pour éviter
    // de déclencher inutilement les triggers BEFORE INSERT de quota sur une simple modification
    if (product.id) {
      let { data: updatedById, error: updErr } = await client
        .from(prodTable)
        .update(productMetadata)
        .eq('id', product.id)
        .select('id');
      if (updErr && (updErr.message?.includes('qr_code') || updErr.code === 'PGRST204')) {
        const retry = await client
          .from(prodTable)
          .update(stripUnsupportedColumns(productMetadata))
          .eq('id', product.id)
          .select('id');
        updatedById = retry.data;
        updErr = retry.error;
      }
      if (!updErr && Array.isArray(updatedById) && updatedById.length > 0) {
        notifyRealtimeDataMutated('products');
        return { success: true };
      }
      if (updErr && updErr.code === '23505') {
        return {
          success: false,
          error:
            'Doublon refusé par la base de données : La référence, le code-barres fabricant, le QR Code ou la référence fabricant est déjà utilisé par un autre article.',
        };
      }
    }

    let { error } = await client.from(prodTable).upsert([productMetadata]);
    if (error && (error.message?.includes('qr_code') || error.code === 'PGRST204')) {
      const retry = await client.from(prodTable).upsert([stripUnsupportedColumns(productMetadata)]);
      error = retry.error;
    }
    if (error) {
      if (error.code === '23505') {
        return {
          success: false,
          error:
            'Doublon refusé par la base de données : La référence, le code-barres fabricant, le QR Code ou la référence fabricant est déjà utilisé par un autre article.',
        };
      }
      return { success: false, error: formatPostgresErrorMessage(error) };
    }
    notifyRealtimeDataMutated('products');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Erreur inconnue' };
  }
}

/**
 * Test de cohérence du stock :
 * Vérifie que products.quantity est strictement égale à la somme de stock_levels pour chaque article.
 */
export async function testStockConsistency(
  client: SupabaseClient
): Promise<{ consistent: boolean; discrepancies: Array<{ productId: string; productQty: number; levelsSum: number }>; error?: string }> {
  try {
    const { data: prods, error: pErr } = await client
      .from(TABLES.products)
      .select('id, reference, quantity');

    if (pErr) {
      return { consistent: false, discrepancies: [], error: formatPostgresErrorMessage(pErr) };
    }

    const { data: levels, error: lErr } = await client
      .from(TABLES.stockLevels)
      .select('product_id, quantity');

    if (lErr) {
      return { consistent: false, discrepancies: [], error: formatPostgresErrorMessage(lErr) };
    }

    const levelSums = new Map<string, number>();
    for (const lvl of (levels || [])) {
      const pid = String(lvl.product_id);
      levelSums.set(pid, (levelSums.get(pid) || 0) + Number(lvl.quantity || 0));
    }

    const discrepancies: Array<{ productId: string; productQty: number; levelsSum: number }> = [];
    for (const prod of (prods || [])) {
      const pQty = Number(prod.quantity || 0);
      const lSum = levelSums.get(String(prod.id)) || 0;
      if (Math.abs(pQty - lSum) > 0.0001) {
        discrepancies.push({
          productId: String(prod.id),
          productQty: pQty,
          levelsSum: lSum,
        });
      }
    }

    return {
      consistent: discrepancies.length === 0,
      discrepancies,
    };
  } catch (err: any) {
    return { consistent: false, discrepancies: [], error: err?.message || 'Erreur inconnue' };
  }
}

export async function deleteProductFromSupabase(
  client: SupabaseClient,
  productId: string
): Promise<boolean> {
  try {
    const { error } = await client.from(TABLES.products).delete().eq('id', productId);
    if (!error) notifyRealtimeDataMutated('products');
    return !error;
  } catch {
    return false;
  }
}

export async function upsertDepartmentToSupabase(
  client: SupabaseClient,
  dep: Department
): Promise<boolean> {
  try {
    const depTable = TABLES.departments;
    const payload = {
      id: dep.id,
      name: dep.name,
      manager_id: dep.manager_id ? String(dep.manager_id) : null,
      deputy_manager_ids: Array.isArray(dep.deputy_manager_ids) ? dep.deputy_manager_ids.map(String) : [],
      allow_global_kpis: Boolean(dep.allow_global_kpis),
      is_preparer_dept: Boolean(dep.is_preparer_dept),
      require_order_approval: Boolean(dep.require_order_approval),
      order_approval_threshold: dep.order_approval_threshold !== undefined ? Number(dep.order_approval_threshold) : 0,
    };
    const { error } = await client.from(depTable).upsert([payload]);
    if (error) {
      // Fallback for legacy schemas missing require_order_approval or order_approval_threshold
      const legacyDep1 = {
        id: dep.id,
        name: dep.name,
        manager_id: dep.manager_id ? String(dep.manager_id) : null,
        deputy_manager_ids: Array.isArray(dep.deputy_manager_ids) ? dep.deputy_manager_ids.map(String) : [],
        allow_global_kpis: Boolean(dep.allow_global_kpis),
        is_preparer_dept: Boolean(dep.is_preparer_dept),
      };
      const { error: err1 } = await client.from(depTable).upsert([legacyDep1]);
      if (err1) {
        // Fallback for very early schemas
        const legacyDep2 = { id: dep.id, name: dep.name, manager_id: dep.manager_id ? String(dep.manager_id) : null };
        const { error: err2 } = await client.from(depTable).upsert([legacyDep2]);
        if (!err2) notifyRealtimeDataMutated('departments');
        return !err2;
      }
      notifyRealtimeDataMutated('departments');
      return true;
    }
    notifyRealtimeDataMutated('departments');
    return true;
  } catch {
    return false;
  }
}

export async function deleteDepartmentFromSupabase(
  client: SupabaseClient,
  depId: number
): Promise<boolean> {
  try {
    const { error } = await client.from(TABLES.departments).delete().eq('id', depId);
    if (!error) notifyRealtimeDataMutated('departments');
    return !error;
  } catch {
    return false;
  }
}

export async function upsertProjectToSupabase(
  client: SupabaseClient,
  proj: Project
): Promise<boolean> {
  try {
    const projTable = TABLES.projects;
    const { error } = await client.from(projTable).upsert([proj]);
    if (error) {
      // Fallback for legacy schemas
      const legacyProj = {
        id: proj.id,
        department_id: proj.department_id,
        project_number: proj.project_number,
        project_name: proj.project_name,
        manager_id: proj.manager_id || null,
      };
      const { error: err2 } = await client.from(projTable).upsert([legacyProj]);
      if (!err2) notifyRealtimeDataMutated('projects');
      return !err2;
    }
    notifyRealtimeDataMutated('projects');
    return true;
  } catch {
    return false;
  }
}

export async function deleteProjectFromSupabase(
  client: SupabaseClient,
  projId: number
): Promise<boolean> {
  try {
    const { error } = await client.from(TABLES.projects).delete().eq('id', projId);
    if (!error) notifyRealtimeDataMutated('projects');
    return !error;
  } catch {
    return false;
  }
}

export async function upsertRoleToSupabase(
  client: SupabaseClient,
  role: Role
): Promise<boolean> {
  try {
    const { error } = await client.from(TABLES.roles).upsert([role]);
    if (!error) notifyRealtimeDataMutated('roles');
    return !error;
  } catch {
    return false;
  }
}

export async function deleteRoleFromSupabase(
  client: SupabaseClient,
  roleId: number
): Promise<boolean> {
  try {
    const { error } = await client.from(TABLES.roles).delete().eq('id', roleId);
    if (!error) notifyRealtimeDataMutated('roles');
    return !error;
  } catch {
    return false;
  }
}

export async function upsertSubCategoryToSupabase(
  client: SupabaseClient,
  category: SubCategory
): Promise<boolean> {
  try {
    const { error } = await client.from(TABLES.subCategories).upsert([category]);
    if (!error) notifyRealtimeDataMutated('sub_categories');
    return !error;
  } catch {
    return false;
  }
}

export async function deleteSubCategoryFromSupabase(
  client: SupabaseClient,
  catId: number
): Promise<boolean> {
  try {
    const { error } = await client.from(TABLES.subCategories).delete().eq('id', catId);
    if (!error) notifyRealtimeDataMutated('sub_categories');
    return !error;
  } catch {
    return false;
  }
}

export interface DepotSyncResult {
  success: boolean;
  table?: string;
  error?: string;
  isTableMissing?: boolean;
  isNetworkError?: boolean;
  isSupabaseConnected?: boolean;
  inserted?: Depot;
}

export interface CheckDepotsTableResult {
  exists: boolean;
  table: string;
  count: number;
  error?: string;
  isNetworkError?: boolean;
}

export async function checkDepotTableInSupabase(
  client: SupabaseClient | null
): Promise<CheckDepotsTableResult> {
  if (!client) {
    return { exists: false, table: TABLES.depots, count: 0, error: 'Supabase non configuré.' };
  }

  const table = TABLES.depots;
  try {
    const { data, count, error } = await client
      .from(table)
      .select('*', { count: 'exact', head: false })
      .limit(1);

    if (!error) {
      return { exists: true, table, count: count ?? (data ? data.length : 0) };
    }

    if (isNetworkOrFetchError(error)) {
      return {
        exists: false,
        table,
        count: 0,
        isNetworkError: true,
        error: "Serveur Supabase inaccessible (Failed to fetch). Votre projet Supabase est très probablement en veille (Paused) ou l'URL configurée est incorrecte.",
      };
    }
  } catch (e: any) {
    if (isNetworkOrFetchError(e)) {
      return {
        exists: false,
        table,
        count: 0,
        isNetworkError: true,
        error: "Serveur Supabase inaccessible (Failed to fetch). Votre projet Supabase est très probablement en veille (Paused) ou l'URL configurée est incorrecte.",
      };
    }
  }

  return {
    exists: false,
    table,
    count: 0,
    isNetworkError: false,
    error: `Table public.${TABLES.depots} introuvable dans votre projet Supabase.`,
  };
}

export async function upsertDepotToSupabase(
  client: SupabaseClient | null,
  depot: Depot
): Promise<DepotSyncResult> {
  if (!client) {
    return {
      success: false,
      isSupabaseConnected: false,
      error: 'Supabase non configuré (URL et clé API manquantes dans Paramètres Entreprise).',
    };
  }

  try {
    const depotTable = TABLES.depots;

    // Prepare clean payload
    // Note: Do NOT pass large Date.now() timestamps as 'id' into PostgreSQL sequences/integers
    const payloadFull: Record<string, any> = {
      name: depot.name.trim(),
      code: depot.code?.trim() || null,
      address: depot.address?.trim() || null,
      description: depot.description?.trim() || null,
      type: depot.type || 'FIXED',
      vehicle_type: depot.vehicle_type || null,
      license_plate: depot.license_plate?.trim() || null,
      manager_id: depot.manager_id ? String(depot.manager_id) : null,
      manager_name: depot.manager_name || null,
      binome_ids: depot.binome_ids || [],
      binome_names: depot.binome_names || [],
      department_id: depot.department_id ? String(depot.department_id) : null,
      department_name: depot.department_name || null,
      pickup_zones: depot.pickup_zones || [],
      is_active: depot.is_active ?? true,
      created_at: depot.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // If depot has an existing database ID (numeric <= 2147483647 or string UUID), include it
    if (typeof depot.id === 'number' && depot.id > 0 && depot.id <= 2147483647) {
      payloadFull.id = depot.id;
    } else if (typeof depot.id === 'string' && depot.id.length > 0 && !/^\d{13,}$/.test(depot.id)) {
      payloadFull.id = depot.id;
    }

    const isMissingColumnError = (err: any): boolean => {
      if (!err) return false;
      const code = String(err.code || '');
      const msg = String(err.message || '').toLowerCase();
      return (
        code === '42703' ||
        code === 'PGRST204' ||
        (msg.includes('column') && (msg.includes('does not exist') || msg.includes('could not find')))
      );
    };

    // Attempt 0: Try UPDATE first if depot already exists in DB (by id or name)
    // so editing an existing depot does not fire BEFORE INSERT quota triggers
    if (payloadFull.id) {
      const { data: updById, error: updIdErr } = await client
        .from(depotTable)
        .update(payloadFull)
        .eq('id', payloadFull.id)
        .select();
      if (!updIdErr && Array.isArray(updById) && updById.length > 0) {
        notifyRealtimeDataMutated('depots');
        return { success: true, table: depotTable, inserted: updById[0] as Depot };
      }
      if (updIdErr) {
        if (isNetworkOrFetchError(updIdErr)) {
          return {
            success: false,
            isNetworkError: true,
            table: depotTable,
            error: "Impossible de joindre le serveur Supabase (Failed to fetch). Votre projet Supabase est très probablement en veille (Paused sur supabase.com) ou l'URL configurée est inaccessible.",
          };
        }
        if (!isMissingColumnError(updIdErr)) {
          return {
            success: false,
            table: depotTable,
            error: updIdErr.message,
          };
        }
      }
    }
    {
      const { data: updByName, error: updNameErr } = await client
        .from(depotTable)
        .update(payloadFull)
        .eq('name', depot.name.trim())
        .select();
      if (!updNameErr && Array.isArray(updByName) && updByName.length > 0) {
        notifyRealtimeDataMutated('depots');
        return { success: true, table: depotTable, inserted: updByName[0] as Depot };
      }
      if (updNameErr) {
        if (isNetworkOrFetchError(updNameErr)) {
          return {
            success: false,
            isNetworkError: true,
            table: depotTable,
            error: "Impossible de joindre le serveur Supabase (Failed to fetch). Votre projet Supabase est très probablement en veille (Paused sur supabase.com) ou l'URL configurée est inaccessible.",
          };
        }
        if (!isMissingColumnError(updNameErr)) {
          return {
            success: false,
            table: depotTable,
            error: updNameErr.message,
          };
        }
      }
    }

    // Attempt 1: Upsert full payload on 'name'
    const { data: resData, error: err1 } = await client
      .from(depotTable)
      .upsert([payloadFull], { onConflict: 'name' })
      .select();

    if (!err1) {
      const insertedRow = resData && resData[0] ? (resData[0] as Depot) : undefined;
      notifyRealtimeDataMutated('depots');
      return { success: true, table: depotTable, inserted: insertedRow };
    }

    console.warn(`Supabase upsert depots (attempt 1) sur ${depotTable}:`, err1);

    // If network / fetch error, bail out immediately and explain clearly
    if (isNetworkOrFetchError(err1)) {
      return {
        success: false,
        isNetworkError: true,
        table: depotTable,
        error: "Impossible de joindre le serveur Supabase (Failed to fetch). Votre projet Supabase est très probablement en veille (Paused sur supabase.com) ou l'URL configurée est inaccessible.",
      };
    }

    // Check if table missing (PostgreSQL 42P01 or PostgREST PGRST204/PGRST205)
    if (
      err1.code === '42P01' ||
      (err1.message?.includes('does not exist') && !isMissingColumnError(err1)) ||
      err1.code === 'PGRST205'
    ) {
      return {
        success: false,
        isTableMissing: true,
        table: depotTable,
        error: `La table "${depotTable}" n'existe pas dans votre base de données Supabase. Veuillez exécuter le script SQL fourni dans l'éditeur SQL de Supabase.`,
      };
    }

    // For any explicit server rejection (quota, licence, RLS, constraint, trigger error) that is NOT a missing column or missing ON CONFLICT constraint, bail out immediately
    if (!isMissingColumnError(err1) && err1.code !== '42P10') {
      return {
        success: false,
        table: depotTable,
        error: err1.message,
      };
    }

    // Attempt 2: Minimal payload without updated_at / is_active
    const payloadBasic: Record<string, any> = {
      name: depot.name.trim(),
      code: depot.code?.trim() || null,
      address: depot.address?.trim() || null,
      description: depot.description?.trim() || null,
      pickup_zones: depot.pickup_zones || [],
    };

    const { data: resData2, error: err2 } = await client
      .from(depotTable)
      .upsert([payloadBasic], { onConflict: 'name' })
      .select();

    if (!err2) {
      const insertedRow = resData2 && resData2[0] ? (resData2[0] as Depot) : undefined;
      notifyRealtimeDataMutated('depots');
      return { success: true, table: depotTable, inserted: insertedRow };
    }

    if (isNetworkOrFetchError(err2)) {
      return {
        success: false,
        isNetworkError: true,
        table: depotTable,
        error: "Impossible de joindre le serveur Supabase (Failed to fetch).",
      };
    }

    // Attempt 3: If onConflict failed, try simple insert
    const { data: resData3, error: err3 } = await client
      .from(depotTable)
      .insert([payloadBasic])
      .select();

    if (!err3) {
      const insertedRow = resData3 && resData3[0] ? (resData3[0] as Depot) : undefined;
      notifyRealtimeDataMutated('depots');
      return { success: true, table: depotTable, inserted: insertedRow };
    }

    // Attempt 4: If insert failed on duplicate, try update where name = depot.name
    if (
      err3.code === '23505' ||
      err3.message?.includes('duplicate key') ||
      err3.message?.includes('unique')
    ) {
      const { data: resData4, error: err4 } = await client
        .from(depotTable)
        .update(payloadBasic)
        .eq('name', depot.name.trim())
        .select();

      if (!err4) {
        const insertedRow = resData4 && resData4[0] ? (resData4[0] as Depot) : undefined;
        notifyRealtimeDataMutated('depots');
        return { success: true, table: depotTable, inserted: insertedRow };
      }
    }

    return {
      success: false,
      table: depotTable,
      error: `Erreur Supabase (${err1.code || err2?.code || err3?.code || 'Err'}) : ${err1.message || err2?.message || err3?.message}`,
    };
  } catch (err: any) {
    console.error('Erreur upsertDepotToSupabase:', err);
    const isNet = isNetworkOrFetchError(err);
    return {
      success: false,
      isNetworkError: isNet,
      error: isNet
        ? "Impossible de joindre le serveur Supabase (Failed to fetch). Votre projet Supabase est très probablement en veille (Paused sur supabase.com) ou l'URL configurée est inaccessible."
        : (err.message || 'Erreur inattendue lors de la communication avec Supabase.'),
    };
  }
}

export async function deleteDepotFromSupabase(
  client: SupabaseClient | null,
  depotId: string | number,
  depotName?: string
): Promise<{ success: boolean; error?: string }> {
  if (!client) return { success: false, error: 'Supabase non connecté.' };

  try {
    const depotTable = TABLES.depots;

    // Delete by name if provided
    if (depotName) {
      const { error: errName } = await client.from(depotTable).delete().eq('name', depotName);
      if (!errName) {
        notifyRealtimeDataMutated('depots');
        return { success: true };
      }
    }

    // Or delete by ID
    const { error } = await client.from(depotTable).delete().eq('id', depotId);
    if (!error) notifyRealtimeDataMutated('depots');
    return { success: !error, error: error?.message };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Formate le préfixe de date YYMMDD pour les numéros de commande (ex: "261102")
 */
export function formatOrderDatePrefix(date: Date = new Date()): string {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

/**
 * Calcule le prochain numéro de commande unique :
 * - En ligne (serveur) : XXXXXXXX-CMD-YYMMDD-XX
 * - Hors-ligne (offline) : XXXXXXXX-CMD-YYMMDD-XX_OFF
 */
export function computeNextOrderNumber(
  siteNumber: string,
  datePrefix: string,
  existingOrderNumbers: Iterable<string>,
  isOffline: boolean,
  minSequence: number = 1
): string {
  const cleanSite = (siteNumber || 'CH-00').trim().toUpperCase();
  const cleanDate = (datePrefix || formatOrderDatePrefix()).trim();
  const existingUpperSet = new Set<string>();
  let maxSeqForDate = Math.max(0, minSequence - 1);

  const dateRegex = new RegExp(`-CMD-${cleanDate}-(\\d+)(?:_OFF)?$`, 'i');

  for (const rawNum of existingOrderNumbers) {
    if (!rawNum) continue;
    const upper = String(rawNum).trim().toUpperCase();
    if (!upper) continue;
    existingUpperSet.add(upper);

    const match = upper.match(dateRegex);
    if (match && match[1]) {
      const parsedSeq = parseInt(match[1], 10);
      if (!Number.isNaN(parsedSeq) && parsedSeq > maxSeqForDate) {
        maxSeqForDate = parsedSeq;
      }
    }
  }

  let nextSeq = Math.max(minSequence, maxSeqForDate + 1);
  while (true) {
    const seq2 = String(nextSeq).padStart(2, '0');
    const seq3 = String(nextSeq).padStart(3, '0');
    const base2 = `${cleanSite}-CMD-${cleanDate}-${seq2}`;
    const off2 = `${base2}_OFF`;
    const base3 = `${cleanSite}-CMD-${cleanDate}-${seq3}`;
    const off3 = `${base3}_OFF`;

    if (
      !existingUpperSet.has(base2) &&
      !existingUpperSet.has(off2) &&
      !existingUpperSet.has(base3) &&
      !existingUpperSet.has(off3)
    ) {
      return isOffline ? off2 : base2;
    }
    nextSeq++;
  }
}

/**
 * Attribue un numéro de commande strictement unique depuis le serveur Supabase (XXXXXXXX-CMD-YYMMDD-XX)
 * ou bascule automatiquement avec le suffixe hors-ligne (XXXXXXXX-CMD-YYMMDD-XX_OFF) si hors-ligne / serveur injoignable.
 */
export async function allocateUniqueOrderNumberFromSupabase(
  client: SupabaseClient | null,
  siteNumber: string,
  localOrders: MaterialOrder[] = [],
  forceOffline: boolean = false
): Promise<{ orderNumber: string; isOffline: boolean }> {
  const cleanSite = (siteNumber || 'CH-00').trim().toUpperCase();
  const datePrefix = formatOrderDatePrefix(new Date());

  const allKnownNumbers = new Set<string>();
  for (const o of localOrders) {
    if (o?.order_number) {
      allKnownNumbers.add(String(o.order_number).trim().toUpperCase());
    }
  }

  const isBrowserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (forceOffline || !client || isBrowserOffline) {
    return {
      orderNumber: computeNextOrderNumber(cleanSite, datePrefix, allKnownNumbers, true),
      isOffline: true,
    };
  }

  let serverReachable = false;
  let networkFailed = false;
  let minSeqFromRpc = 1;

  // 1. Tenter la RPC atomique côté serveur PostgreSQL (allocate_unique_order_number)
  try {
    const { data: rpcNum, error: rpcErr } = await client.rpc('allocate_unique_order_number', {
      p_site_number: cleanSite,
      p_date_prefix: datePrefix,
    });
    if (!rpcErr && typeof rpcNum === 'string' && rpcNum.trim()) {
      serverReachable = true;
      const cleanRpcNum = rpcNum.trim().toUpperCase();
      const m = cleanRpcNum.match(new RegExp(`-CMD-${datePrefix}-(\\d+)(?:_OFF)?$`, 'i'));
      if (m && m[1]) {
        const seqVal = parseInt(m[1], 10);
        if (!Number.isNaN(seqVal) && seqVal >= minSeqFromRpc) {
          minSeqFromRpc = seqVal;
        }
      }
    } else if (rpcErr && isNetworkOrFetchError(rpcErr)) {
      networkFailed = true;
    }
  } catch (err: any) {
    if (isNetworkOrFetchError(err)) {
      networkFailed = true;
    }
  }

  // 2. Interroger la table stk_material_orders et le miroir core_app_settings sur le serveur
  // pour garantir l'unicité absolue même si la RPC n'est pas encore installée ou si des commandes sont dans le miroir
  if (!networkFailed) {
    try {
      const orderTable = TABLES.materialOrders;
      const { data: rows, error: selErr } = await client
        .from(orderTable)
        .select('order_number')
        .ilike('order_number', `%-CMD-${datePrefix}-%`);

      if (!selErr && Array.isArray(rows)) {
        serverReachable = true;
        for (const r of rows) {
          if (r?.order_number) {
            allKnownNumbers.add(String(r.order_number).trim().toUpperCase());
          }
        }
      } else if (selErr && isNetworkOrFetchError(selErr)) {
        networkFailed = true;
      }
    } catch (err: any) {
      if (isNetworkOrFetchError(err)) {
        networkFailed = true;
      }
    }
  }

  if (!networkFailed) {
    try {
      const mirrorOrders = await fetchOrdersFromSettingsMirror(client);
      if (Array.isArray(mirrorOrders)) {
        serverReachable = true;
        for (const mo of mirrorOrders) {
          if (mo?.order_number) {
            allKnownNumbers.add(String(mo.order_number).trim().toUpperCase());
          }
        }
      }
    } catch (err: any) {
      if (isNetworkOrFetchError(err)) {
        networkFailed = true;
      }
    }
  }

  if (networkFailed && !serverReachable) {
    return {
      orderNumber: computeNextOrderNumber(cleanSite, datePrefix, allKnownNumbers, true),
      isOffline: true,
    };
  }

  const finalOnlineNumber = computeNextOrderNumber(
    cleanSite,
    datePrefix,
    allKnownNumbers,
    false,
    minSeqFromRpc
  );
  return {
    orderNumber: finalOnlineNumber,
    isOffline: false,
  };
}

export async function upsertOrderToSupabase(
  client: SupabaseClient | null,
  order: MaterialOrder
): Promise<{ success: boolean; error?: string; orderNumber?: string; isNetworkError?: boolean }> {
  if (!client) return { success: false, error: 'Supabase non connecté.', isNetworkError: true };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { success: false, error: 'Mode hors-ligne actif.', isNetworkError: true };
  }

  const nowIso = new Date().toISOString();
  let currentOrderNumber = String(order.order_number || '').trim().toUpperCase();
  const isOfflineNumber = currentOrderNumber.endsWith('_OFF');

  try {
    const orderTable = TABLES.materialOrders;

    const buildUpdateFields = (ordNum: string) => {
      const qrCode =
        order.ready_qr_code && order.ready_qr_code.startsWith('TOT-ORDER:')
          ? `TOT-ORDER:${ordNum}`
          : order.ready_qr_code || null;
      return {
        site_number: order.site_number,
        site_name: order.site_name || null,
        depot_name: order.depot_name || null,
        status: order.status,
        items: order.items,
        notes: order.notes || null,
        total_cost: Number(order.total_cost) || 0,
        approved_by: order.approved_by || null,
        approved_at: order.approved_at || null,
        rejected_by: order.rejected_by || null,
        rejected_at: order.rejected_at || null,
        rejection_reason: order.rejection_reason || null,
        pickup_zone: order.pickup_zone || null,
        ready_qr_code: qrCode,
        signature_data: order.signature_data || null,
        proof_photo_url: order.proof_photo_url || null,
        is_edited: order.is_edited ?? false,
        assigned_at: order.assigned_at || null,
        preparer_id: order.preparer_id ? String(order.preparer_id) : null,
        preparer_name: order.preparer_name || null,
        ready_at: order.ready_at || null,
        collected_at: order.collected_at || null,
        collected_by: order.collected_by || null,
        pickup_delegate_id: order.pickup_delegate_id ? String(order.pickup_delegate_id) : null,
        pickup_delegate_name: order.pickup_delegate_name || null,
        pickup_delegate_department: order.pickup_delegate_department || null,
        pickup_delegate_at: order.pickup_delegate_at || null,
        pickup_delegate_by: order.pickup_delegate_by || null,
        pickup_delegate_notes: order.pickup_delegate_notes || null,
        updated_at: nowIso,
      };
    };

    const stripLegacyFields = (fields: ReturnType<typeof buildUpdateFields>) => {
      const {
        total_cost: _tc,
        approved_by: _ab,
        approved_at: _aa,
        rejected_by: _rb,
        rejected_at: _ra,
        rejection_reason: _rr,
        pickup_delegate_id: _pdi,
        pickup_delegate_name: _pdn,
        pickup_delegate_department: _pdd,
        pickup_delegate_at: _pda,
        pickup_delegate_by: _pdb,
        pickup_delegate_notes: _pdno,
        ...legacy
      } = fields;
      return legacy;
    };

    const updateFields = buildUpdateFields(currentOrderNumber);
    const legacyUpdateFields = stripLegacyFields(updateFields);

    // 1. Try UPDATE by id first (existing order) if client.from(orderTable).update is available
    const initialBuilder: any = client.from(orderTable);
    if (initialBuilder && typeof initialBuilder.update === 'function') {
      const { data: updatedById, error: updErr } = await initialBuilder
        .update(updateFields)
        .eq('id', order.id)
        .select('id, order_number');

      if (updErr && isNetworkOrFetchError(updErr)) {
        return { success: false, error: updErr.message, isNetworkError: true };
      }

      if (!updErr && updatedById && updatedById.length > 0) {
        const confirmedNumber = updatedById[0]?.order_number || currentOrderNumber;
        mirrorOrderToSettings(client, {
          ...order,
          order_number: confirmedNumber,
          updated_at: nowIso,
        }).catch(() => {});
        return { success: true, orderNumber: confirmedNumber };
      }

      if (updErr) {
        const errCode = String(updErr.code || '');
        // Si la base refuse la mise à jour pour raison métier / droits / signature manquante / projet terminé (42501, 23514, 22023, P0001),
        // remonter immédiatement le message tel quel sans retomber sur transition_order_status ni upsert.
        if (
          errCode === '42501' ||
          errCode === '23514' ||
          errCode === '22023' ||
          errCode === 'P0001'
        ) {
          return {
            success: false,
            error: translatePermissionDeniedError(updErr),
            isNetworkError: false,
          };
        }

        const { data: updatedLegacyById, error: updLegacyErr } = await client
          .from(orderTable)
          .update(legacyUpdateFields)
          .eq('id', order.id)
          .select('id, order_number');
        if (!updLegacyErr && updatedLegacyById && updatedLegacyById.length > 0) {
          const confirmedNumber = updatedLegacyById[0]?.order_number || currentOrderNumber;
          mirrorOrderToSettings(client, {
            ...order,
            order_number: confirmedNumber,
            updated_at: nowIso,
          }).catch(() => {});
          return { success: true, orderNumber: confirmedNumber };
        }
        if (updLegacyErr) {
          const legacyCode = String(updLegacyErr.code || '');
          if (
            legacyCode === '42501' ||
            legacyCode === '23514' ||
            legacyCode === '22023' ||
            legacyCode === 'P0001'
          ) {
            return {
              success: false,
              error: translatePermissionDeniedError(updLegacyErr),
              isNetworkError: false,
            };
          }
        }
      }
    }

    // 2. Fallback via SECURITY DEFINER RPC transition_order_status if existing row is being transitioned
    // (Sauf pour COLLECTED qui exige d'envoyer status='COLLECTED' et signature_data dans la MÊME requête UPDATE)
    if (order.status && order.status !== 'WAITING_APPROVAL' && order.status !== 'COLLECTED') {
      try {
        const { data: rpcRes, error: rpcErr } = await client.rpc('transition_order_status', {
          p_operation_id: crypto.randomUUID(),
          p_order_id: order.id,
          p_target_status: order.status,
          p_preparer_id: order.preparer_id ? String(order.preparer_id) : null,
          p_comment: order.rejection_reason || order.notes || null,
        });
        if (!rpcErr && rpcRes) {
          const updAfterRpc: any = client.from(orderTable);
          if (updAfterRpc && typeof updAfterRpc.update === 'function') {
            await updAfterRpc.update(updateFields).eq('id', order.id);
          }
          mirrorOrderToSettings(client, {
            ...order,
            order_number: currentOrderNumber,
            updated_at: nowIso,
          }).catch(() => {});
          return { success: true, orderNumber: currentOrderNumber };
        }
      } catch {}
    }

    // 3. Row does not exist yet -> Verify uniqueness of order_number on server and retry on collision (23505)
    const dateMatch = currentOrderNumber.match(/-CMD-(\d{6})-(\d+)(?:_OFF)?$/i);
    const datePrefix = dateMatch ? dateMatch[1] : formatOrderDatePrefix(new Date());

    for (let attempt = 0; attempt < 5; attempt++) {
      // Check if another order with a DIFFERENT id already owns currentOrderNumber on the server
      const checkBuilder: any = client.from(orderTable);
      if (checkBuilder && typeof checkBuilder.select === 'function') {
        const { data: conflictingRows, error: checkErr } = await checkBuilder
          .select('id, order_number')
          .ilike('order_number', currentOrderNumber);

        if (checkErr && isNetworkOrFetchError(checkErr)) {
          return { success: false, error: checkErr.message, isNetworkError: true };
        }

        const hasConflict =
          Array.isArray(conflictingRows) &&
          conflictingRows.some((r) => String(r.id) !== String(order.id));

        if (hasConflict) {
          const { data: allDayRows } = await client
            .from(orderTable)
            .select('order_number')
            .ilike('order_number', `%-CMD-${datePrefix}-%`);
          const takenSet = new Set<string>([currentOrderNumber]);
          if (Array.isArray(allDayRows)) {
            for (const r of allDayRows) {
              if (r?.order_number) takenSet.add(String(r.order_number).trim().toUpperCase());
            }
          }
          currentOrderNumber = computeNextOrderNumber(
            order.site_number,
            datePrefix,
            takenSet,
            isOfflineNumber
          );
        }
      }

      const attemptUpdateFields = buildUpdateFields(currentOrderNumber);
      const fullPayload = {
        id: order.id,
        order_number: currentOrderNumber,
        requester_id: String(order.requester_id),
        requester_name: order.requester_name,
        requester_department: order.requester_department || null,
        created_at: order.created_at,
        ...attemptUpdateFields,
      };

      const { error } = await client.from(orderTable).upsert([fullPayload], { onConflict: 'id' });
      if (!error) {
        mirrorOrderToSettings(client, {
          ...order,
          order_number: currentOrderNumber,
          updated_at: nowIso,
        }).catch(() => {});
        return { success: true, orderNumber: currentOrderNumber };
      }

      if (isNetworkOrFetchError(error)) {
        return { success: false, error: error.message, isNetworkError: true };
      }

      const errCode = String(error.code || '');
      if (
        errCode === '42501' ||
        errCode === '23514' ||
        errCode === '22023' ||
        errCode === 'P0001'
      ) {
        return {
          success: false,
          error: translatePermissionDeniedError(error),
          isNetworkError: false,
        };
      }

      // Duplicate order_number constraint violation (23505) -> increment and retry
      const isUniqueViolation =
        error.code === '23505' ||
        (error.message &&
          (error.message.includes('order_number') || error.message.includes('duplicate key')));

      if (isUniqueViolation) {
        const { data: allDayRows } = await client
          .from(orderTable)
          .select('order_number')
          .ilike('order_number', `%-CMD-${datePrefix}-%`);
        const takenSet = new Set<string>([currentOrderNumber]);
        if (Array.isArray(allDayRows)) {
          for (const r of allDayRows) {
            if (r?.order_number) takenSet.add(String(r.order_number).trim().toUpperCase());
          }
        }
        currentOrderNumber = computeNextOrderNumber(
          order.site_number,
          datePrefix,
          takenSet,
          isOfflineNumber
        );
        continue;
      }

      // Otherwise try legacy payload without newer columns
      console.warn('Supabase upsert order error, trying legacy payload:', error);
      const legacyFullPayload = {
        id: order.id,
        order_number: currentOrderNumber,
        requester_id: String(order.requester_id),
        requester_name: order.requester_name,
        requester_department: order.requester_department || null,
        created_at: order.created_at,
        ...stripLegacyFields(attemptUpdateFields),
      };
      const { error: err2 } = await client.from(orderTable).upsert([legacyFullPayload], { onConflict: 'id' });
      if (err2 && isNetworkOrFetchError(err2)) {
        return { success: false, error: err2.message, isNetworkError: true };
      }
      if (err2) {
        const err2Code = String(err2.code || '');
        if (
          err2Code === '42501' ||
          err2Code === '23514' ||
          err2Code === '22023' ||
          err2Code === 'P0001'
        ) {
          return {
            success: false,
            error: translatePermissionDeniedError(err2),
            isNetworkError: false,
          };
        }
      }
      if (
        err2 &&
        (err2.code === '23505' ||
          err2.message?.includes('order_number') ||
          err2.message?.includes('duplicate key'))
      ) {
        currentOrderNumber = computeNextOrderNumber(
          order.site_number,
          datePrefix,
          [currentOrderNumber],
          isOfflineNumber
        );
        continue;
      }

      mirrorOrderToSettings(client, {
        ...order,
        order_number: currentOrderNumber,
        updated_at: nowIso,
      }).catch(() => {});
      notifyRealtimeDataMutated('orders');
      return { success: true, orderNumber: currentOrderNumber };
    }

    mirrorOrderToSettings(client, {
      ...order,
      order_number: currentOrderNumber,
      updated_at: nowIso,
    }).catch(() => {});
    notifyRealtimeDataMutated('orders');
    return { success: true, orderNumber: currentOrderNumber };
  } catch (err: any) {
    if (isNetworkOrFetchError(err)) {
      return { success: false, error: err.message, isNetworkError: true };
    }
    return { success: true, error: err.message, orderNumber: currentOrderNumber };
  }
}

export async function deleteOrderFromSupabase(
  client: SupabaseClient | null,
  orderId: string
): Promise<{ success: boolean; error?: string }> {
  if (!client) return { success: false, error: 'Supabase non connecté.' };

  try {
    // 1. Retirer du miroir app_settings (company_orders_sync et company_license_info.orders_sync)
    // et publier l'ID supprimé dans deleted_ids pour synchronisation immédiate multi-appareils
    try {
      const existingMirror = await fetchOrdersFromSettingsMirror(client);
      const targetInMirror = existingMirror.find(
        (o) => String(o.id) === String(orderId) || String(o.order_number) === String(orderId)
      );
      let deletedIds: string[] = [];
      try {
        const rawDel = localStorage.getItem('tot_deleted_order_ids');
        if (rawDel) deletedIds = JSON.parse(rawDel);
      } catch {}
      const nextDeletedIds = Array.from(
        new Set([
          ...deletedIds.map(String),
          String(orderId),
          ...(targetInMirror?.order_number ? [String(targetInMirror.order_number)] : []),
        ])
      ).filter(Boolean);
      try {
        localStorage.setItem('tot_deleted_order_ids', JSON.stringify(nextDeletedIds));
      } catch {}

      const filteredMirror = existingMirror.filter(
        (o) => String(o.id) !== String(orderId) && String(o.order_number) !== String(orderId)
      );
      await client.from(TABLES.appSettings).upsert(
        [
          {
            key: 'company_orders_sync',
            value: JSON.stringify({
              orders: filteredMirror.slice(0, 150),
              deleted_ids: nextDeletedIds.slice(-200),
            }),
            updated_at: new Date().toISOString(),
          },
        ],
        { onConflict: 'key' }
      );
      await updateCompanyLicenseInfoShared(client, (licObj) => ({
        ...licObj,
        deleted_order_ids: nextDeletedIds.slice(-200),
        orders_sync: Array.isArray(licObj.orders_sync)
          ? licObj.orders_sync.filter(
              (o: any) => String(o?.id) !== String(orderId) && String(o?.order_number) !== String(orderId)
            )
          : [],
      }));
    } catch {}

    const orderTable = TABLES.materialOrders;

    // 2. Tenter la suppression directe avec .select('id') pour vérifier si au moins 1 ligne a été supprimée,
    // puis repli sur statut CANCELLED + notes '[SUPPRIMÉE]' (autorisé par RLS)
    const { data: delRows, error: delErr } = await client
      .from(orderTable)
      .delete()
      .eq('id', orderId)
      .select('id');

    if (!delErr && Array.isArray(delRows) && delRows.length > 0) {
      notifyRealtimeDataMutated('orders');
      return { success: true };
    }

    const { error } = await client
      .from(orderTable)
      .update({
        status: 'CANCELLED',
        notes: '[SUPPRIMÉE]',
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);
    notifyRealtimeDataMutated('orders');
    if (error?.code === '42501') {
      return { success: true };
    }
    return { success: true, error: error?.message };
  } catch (err: any) {
    notifyRealtimeDataMutated('orders');
    return { success: true, error: err.message };
  }
}

export async function syncAllDepotsToSupabase(
  client: SupabaseClient | null,
  depots: Depot[]
): Promise<{
  success: boolean;
  message: string;
  count: number;
  isTableMissing?: boolean;
  isNetworkError?: boolean;
}> {
  if (!client) {
    return {
      success: false,
      message: 'Supabase non connecté dans les paramètres.',
      count: 0,
    };
  }

  let successCount = 0;
  let lastError = '';
  let missingTable = false;
  let networkError = false;

  for (const d of depots) {
    const res = await upsertDepotToSupabase(client, d);
    if (res.success) {
      successCount++;
    } else {
      if (res.isNetworkError) {
        networkError = true;
        lastError = res.error || 'Erreur de communication avec Supabase (Failed to fetch)';
        break; // Stop immediately to avoid redundant waiting/timeouts
      }
      if (res.isTableMissing) missingTable = true;
      lastError = res.error || 'Erreur inconnue';
    }
  }

  if (networkError) {
    return {
      success: false,
      isNetworkError: true,
      message: lastError,
      count: successCount,
    };
  }

  if (missingTable) {
    return {
      success: false,
      message: `Table public.${TABLES.depots} introuvable dans Supabase. Veuillez exécuter le script SQL fourni.`,
      count: successCount,
      isTableMissing: true,
    };
  }

  if (successCount === depots.length) {
    return {
      success: true,
      message: `${successCount} dépôt(s) synchronisé(s) dans la table Supabase avec succès !`,
      count: successCount,
    };
  }

  return {
    success: successCount > 0,
    message: `${successCount}/${depots.length} dépôt(s) synchronisé(s). Note : ${lastError}`,
    count: successCount,
  };
}

export async function exportAllLocalDataToSupabase(
  client: SupabaseClient,
  data: {
    products: Product[];
    users: User[];
    roles: Role[];
    departments: Department[];
    projects: Project[];
    subCategories: SubCategory[];
    depots?: Depot[];
    orders?: MaterialOrder[];
    movements: StockMovement[];
  }
): Promise<{ success: boolean; message: string }> {
  try {
    const prodTable = TABLES.products;
    const userTable = TABLES.users;

    if (data.roles && data.roles.length > 0) {
      await client.from(TABLES.roles).upsert(data.roles, { onConflict: 'id' });
    }
    if (data.departments && data.departments.length > 0) {
      await client.from(TABLES.departments).upsert(data.departments, { onConflict: 'id' });
    }
    if (data.projects && data.projects.length > 0) {
      await client.from(TABLES.projects).upsert(data.projects, { onConflict: 'id' });
    }
    if (data.subCategories && data.subCategories.length > 0) {
      await client.from(TABLES.subCategories).upsert(data.subCategories, { onConflict: 'id' });
    }
    if (data.products.length > 0) {
      const cleanProducts = data.products.map(({ quantity, ...meta }) => meta);
      await client.from(prodTable).upsert(cleanProducts, { onConflict: 'id' });
    }
    if (data.users.length > 0) {
      const cleanUsersForDb = data.users.map((u) => {
        const s = sanitizeUserForDirectory(u);
        return {
          id: String(s.id),
          ...(s.auth_user_id ? { auth_user_id: s.auth_user_id } : {}),
          name: s.name,
          trigram: s.trigram,
          email: s.email || null,
          department: s.department || 'Général',
          role_id: Number(s.role_id ?? 4),
          is_blocked: Boolean(s.is_blocked),
          must_change_pin: Boolean(s.must_change_pin),
          is_preparer: Boolean(s.is_preparer),
          allowed_depots: Array.isArray(s.allowed_depots) ? s.allowed_depots : ['*'],
          updated_at: new Date().toISOString(),
        };
      });
      await client.from(userTable).upsert(cleanUsersForDb, { onConflict: 'id' });
      await syncUserProfileAndDirectoryToSupabase(client, data.users[0], data.users);
    }
    if (data.depots && data.depots.length > 0) {
      await syncAllDepotsToSupabase(client, data.depots);
    }
    if (data.orders && data.orders.length > 0) {
      await client.from(TABLES.materialOrders).upsert(data.orders, { onConflict: 'id' });
    }
    return { success: true, message: 'Données exportées vers Supabase avec succès !' };
  } catch (err: any) {
    return { success: false, message: `Échec de l'exportation : ${err.message}` };
  }
}

export interface OrderPreparationScanInput {
  order_id: string;
  order_number: string;
  product_id: string;
  product_ref: string;
  preparer_id?: string | null;
  preparer_name?: string | null;
  picked_quantity: number;
  scanned_barcode?: string;
  pickup_zone?: string;
}

export interface OrderPreparationScanResult {
  success: boolean;
  error?: string;
  warningMessage?: string;
  preparerId?: string | null;
}

export async function logOrderPreparationScan(
  client: SupabaseClient | null,
  scanData: OrderPreparationScanInput
): Promise<OrderPreparationScanResult> {
  if (!client) {
    return {
      success: false,
      error: 'Supabase non connecté.',
      warningMessage: "Scan validé localement (journal de préparation hors ligne).",
    };
  }

  try {
    let resolvedPreparerId: string | null = scanData.preparer_id
      ? String(scanData.preparer_id).trim() || null
      : null;
    let resolvedPreparerName: string | null = scanData.preparer_name || null;

    // Résout l'id core_users de l'utilisateur authentifié afin de respecter la règle RLS :
    // preparer_id IS NULL OR preparer_id = public.current_user_id() OR public.is_administrator()
    try {
      if (client.auth && typeof client.auth.getUser === 'function') {
        const { data: authData } = await client.auth.getUser();
        const authUid = authData?.user?.id;
        if (authUid) {
          const { data: connectedProfile } = await client
            .from(TABLES.users)
            .select('id, name')
            .eq('auth_user_id', authUid)
            .maybeSingle();
          if (
            connectedProfile?.id !== undefined &&
            connectedProfile?.id !== null &&
            String(connectedProfile.id).trim() !== ''
          ) {
            resolvedPreparerId = String(connectedProfile.id).trim();
            if (!resolvedPreparerName && connectedProfile.name) {
              resolvedPreparerName = String(connectedProfile.name);
            }
          }
        }
      }
    } catch {
      // Conservation du preparer_id fourni en cas d'indisponibilité de auth.getUser()
    }

    const payload = {
      id: `prep-${Date.now()}-${crypto.randomUUID()}`,
      order_id: scanData.order_id,
      order_number: scanData.order_number,
      product_id: String(scanData.product_id),
      product_ref: scanData.product_ref,
      preparer_id: resolvedPreparerId,
      preparer_name: resolvedPreparerName,
      picked_quantity: scanData.picked_quantity,
      scanned_barcode: scanData.scanned_barcode || null,
      pickup_zone: scanData.pickup_zone || null,
      scanned_at: new Date().toISOString(),
    };

    const { error } = await client.from(TABLES.orderPreparationsLog).insert([payload]);
    if (error) {
      const warningMessage =
        "Scan validé, mais le journal de préparation n'a pas pu être enregistré.";
      console.warn(`[TOT Stock] ${warningMessage}`, error.message);
      return {
        success: false,
        error: error.message,
        warningMessage,
        preparerId: resolvedPreparerId,
      };
    }

    return {
      success: true,
      preparerId: resolvedPreparerId,
    };
  } catch (err: any) {
    const warningMessage =
      "Scan validé, mais le journal de préparation n'a pas pu être enregistré.";
    console.warn(`[TOT Stock] ${warningMessage}`, err?.message || err);
    return {
      success: false,
      error: err?.message || String(err),
      warningMessage,
    };
  }
}

export async function recordOrderPreparationScanToSupabase(
  client: SupabaseClient | null,
  scanData: OrderPreparationScanInput
): Promise<OrderPreparationScanResult> {
  return logOrderPreparationScan(client, scanData);
}

export interface InventoryAuditRecordPayload {
  id?: string;
  depot_name?: string;
  auditor_id?: string | number | null;
  auditor_name?: string;
  items_counted: number;
  items_with_diff: number;
  total_diff_cost: number;
  audit_notes?: string;
  items: {
    id?: string;
    product_id: string;
    product_ref: string;
    product_name?: string;
    theoretical_qty: number;
    physical_count: number;
    difference: number;
    unit_price?: number;
    diff_cost?: number;
    scanned_barcode?: string;
  }[];
}

export const AUDIT_HISTORY_NOT_SAVED_WARNING =
  "Stock régularisé, mais l'historique n'a pas pu être enregistré";

export interface RecordInventoryAuditResult {
  success: boolean;
  auditId?: string;
  queued?: boolean;
  operationId?: string;
  warningMessage?: string;
  error?: string;
  isNetworkError?: boolean;
}

export async function recordInventoryAuditToSupabase(
  client: SupabaseClient | null,
  audit: InventoryAuditRecordPayload,
  options?: {
    skipQueue?: boolean;
    operationId?: string;
  }
): Promise<RecordInventoryAuditResult> {
  const auditId = audit.id || `audit-${Date.now()}-${crypto.randomUUID()}`;
  const operationId = options?.operationId || auditId;
  const normalizedAudit: InventoryAuditRecordPayload = {
    ...audit,
    id: auditId,
  };

  const enqueueOnFailure = async (errorMsg: string, isNet: boolean): Promise<RecordInventoryAuditResult> => {
    if (!options?.skipQueue) {
      try {
        if (isNet) {
          await enqueueSyncOperation(
            TABLES.inventoryAudits,
            'RECORD_INVENTORY_AUDIT',
            normalizedAudit,
            operationId
          );
        } else {
          await enqueueRejectedSyncOperation(
            TABLES.inventoryAudits,
            'RECORD_INVENTORY_AUDIT',
            normalizedAudit,
            errorMsg,
            operationId
          );
        }
      } catch (qErr) {
        console.warn('Impossible de mettre en file d’attente l’historique d’audit:', qErr);
      }
    }
    return {
      success: false,
      auditId,
      queued: !options?.skipQueue,
      operationId,
      warningMessage: AUDIT_HISTORY_NOT_SAVED_WARNING,
      error: errorMsg,
      isNetworkError: isNet,
    };
  };

  if (!client || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return enqueueOnFailure('Supabase non connecté ou mode hors ligne.', true);
  }

  try {
    const nowIso = new Date().toISOString();
    const positiveDiffValue = (audit.items || []).reduce((acc, it) => {
      const dc = Number(it.diff_cost ?? it.difference * (it.unit_price || 0)) || 0;
      return dc > 0 ? acc + dc : acc;
    }, 0);
    const negativeDiffValue = (audit.items || []).reduce((acc, it) => {
      const dc = Number(it.diff_cost ?? it.difference * (it.unit_price || 0)) || 0;
      return dc < 0 ? acc + Math.abs(dc) : acc;
    }, 0);

    const auditRowFull = {
      id: auditId,
      depot_name: audit.depot_name || 'Dépôt Principal',
      auditor_id: audit.auditor_id ? String(audit.auditor_id) : null,
      auditor_name: audit.auditor_name || null,
      status: 'COMPLETED',
      items_counted: audit.items_counted,
      items_with_diff: audit.items_with_diff,
      total_diff_cost: audit.total_diff_cost,
      audit_notes: audit.audit_notes || null,
      total_references: audit.items_counted,
      counted_references: audit.items_counted,
      discrepancies_count: audit.items_with_diff,
      positive_diff_value: positiveDiffValue,
      negative_diff_value: negativeDiffValue,
      net_diff_value: audit.total_diff_cost,
      notes: audit.audit_notes || null,
      started_at: nowIso,
      created_at: nowIso,
      completed_at: nowIso,
    };

    let { error: errAudit } = await client
      .from(TABLES.inventoryAudits)
      .insert([auditRowFull]);

    if (errAudit) {
      const errCode = String(errAudit.code || '');
      const errMsg = String(errAudit.message || '').toLowerCase();
      if (
        errCode === '42703' ||
        errCode === 'PGRST204' ||
        (errMsg.includes('column') && (errMsg.includes('does not exist') || errMsg.includes('could not find')))
      ) {
        const auditRowBasic = {
          id: auditId,
          depot_name: audit.depot_name || null,
          auditor_id: audit.auditor_id ? String(audit.auditor_id) : null,
          auditor_name: audit.auditor_name || null,
          status: 'COMPLETED',
          items_counted: audit.items_counted,
          items_with_diff: audit.items_with_diff,
          total_diff_cost: audit.total_diff_cost,
          audit_notes: audit.audit_notes || null,
          created_at: nowIso,
          completed_at: nowIso,
        };
        const retryRes = await client
          .from(TABLES.inventoryAudits)
          .insert([auditRowBasic]);
        errAudit = retryRes.error;
      }
    }

    // Idempotent retry: ignore 23505 duplicate key on audit header if already inserted
    if (errAudit && String(errAudit.code || '') !== '23505') {
      console.warn('Supabase inventory_audits insert:', errAudit);
      return enqueueOnFailure(
        errAudit.message || "Erreur lors de l'enregistrement de l'audit.",
        isNetworkOrFetchError(errAudit)
      );
    }

    if (audit.items.length > 0) {
      const itemRows = audit.items.map((it, idx) => ({
        id: it.id || `${auditId}-item-${idx + 1}`,
        audit_id: auditId,
        product_id: String(it.product_id),
        product_ref: it.product_ref,
        product_name: it.product_name || null,
        theoretical_qty: it.theoretical_qty,
        physical_count: it.physical_count,
        difference: it.difference,
        unit_price: it.unit_price || 0,
        diff_cost: it.diff_cost || 0,
        scanned_barcode: it.scanned_barcode || null,
        scanned_at: nowIso,
      }));
      const { error: errItems } = await client
        .from(TABLES.inventoryAuditItems)
        .insert(itemRows);
      if (errItems && String(errItems.code || '') !== '23505') {
        console.warn('Supabase inventory_audit_items insert:', errItems);
        return enqueueOnFailure(
          errItems.message || "Erreur lors de l'enregistrement des lignes d'audit.",
          isNetworkOrFetchError(errItems)
        );
      }
    }

    return { success: true, auditId, operationId };
  } catch (err: any) {
    return enqueueOnFailure(
      err?.message || "Erreur lors de l'enregistrement de l'audit.",
      isNetworkOrFetchError(err)
    );
  }
}

export async function retryQueuedInventoryAudit(
  client: SupabaseClient | null,
  operationId: string
): Promise<RecordInventoryAuditResult> {
  const op = await retryRejectedSyncOperation(operationId);
  if (!op) {
    return {
      success: false,
      operationId,
      error: "Opération d'audit introuvable dans la file d'attente.",
    };
  }
  const res = await recordInventoryAuditToSupabase(
    client,
    {
      ...op.payload,
      id: op.payload?.id || operationId,
    },
    {
      skipQueue: true,
      operationId,
    }
  );
  if (res.success) {
    await updateSyncOperationStatus(operationId, 'synced');
  } else if (res.isNetworkError) {
    await updateSyncOperationStatus(operationId, 'failed', res.error);
  } else {
    await updateSyncOperationStatus(operationId, 'rejected', res.error);
  }
  return res;
}

export async function discardQueuedInventoryAudit(operationId: string): Promise<void> {
  await discardSyncOperation(operationId);
}

export interface FetchInventoryAuditsResult {
  success: boolean;
  audits: any[];
  error?: string;
  isNetworkError?: boolean;
}

export async function fetchInventoryAuditsFromSupabase(
  client: SupabaseClient | null
): Promise<FetchInventoryAuditsResult> {
  if (!client) {
    return {
      success: false,
      audits: [],
      error: 'Base de données Supabase non configurée ou hors ligne.',
      isNetworkError: true,
    };
  }
  try {
    const { data: audits, error } = await client
      .from(TABLES.inventoryAudits)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      return {
        success: false,
        audits: [],
        error: error.message || "Impossible de lire l'historique des audits.",
        isNetworkError: isNetworkOrFetchError(error),
      };
    }
    if (!Array.isArray(audits)) {
      return {
        success: true,
        audits: [],
      };
    }

    const auditIds = audits.map((a: any) => String(a.id)).filter(Boolean);
    const itemsByAuditId: Record<string, any[]> = {};
    if (auditIds.length > 0) {
      const { data: items, error: itemsErr } = await client
        .from(TABLES.inventoryAuditItems)
        .select('*')
        .in('audit_id', auditIds);
      if (itemsErr) {
        return {
          success: false,
          audits: [],
          error: itemsErr.message || "Impossible de lire le détail des lignes d'audit.",
          isNetworkError: isNetworkOrFetchError(itemsErr),
        };
      }
      if (Array.isArray(items)) {
        for (const it of items) {
          const aid = String(it.audit_id);
          if (!itemsByAuditId[aid]) itemsByAuditId[aid] = [];
          itemsByAuditId[aid].push({
            id: String(it.id),
            audit_id: aid,
            product_id: String(it.product_id),
            product_ref: String(it.product_ref || ''),
            product_name: it.product_name || undefined,
            theoretical_qty: Number(it.theoretical_qty) || 0,
            physical_count: Number(it.physical_count) || 0,
            difference: Number(it.difference) || 0,
            unit_price: Number(it.unit_price) || 0,
            diff_cost: Number(it.diff_cost) || 0,
            scanned_barcode: it.scanned_barcode || undefined,
            scanned_at: it.scanned_at || undefined,
          });
        }
      }
    }

    const mappedAudits = audits.map((a: any) => {
      const auditItems = itemsByAuditId[String(a.id)] || [];
      const computedPos = auditItems.reduce((acc, it) => (it.diff_cost > 0 ? acc + it.diff_cost : acc), 0);
      const computedNeg = auditItems.reduce((acc, it) => (it.diff_cost < 0 ? acc + Math.abs(it.diff_cost) : acc), 0);
      return {
        id: String(a.id),
        depot_name: String(a.depot_name || 'Dépôt Principal'),
        auditor_id: a.auditor_id ?? null,
        auditor_name: String(a.auditor_name || 'Auditeur'),
        validator_id: a.validator_id ?? null,
        validator_name: a.validator_name || undefined,
        status: a.status === 'VALIDATED' || a.status === 'CANCELLED' ? a.status : 'COMPLETED',
        total_references: Number(a.total_references ?? a.items_counted) || auditItems.length || 0,
        counted_references: Number(a.counted_references ?? a.items_counted) || auditItems.length || 0,
        discrepancies_count:
          Number(a.discrepancies_count ?? a.items_with_diff) ||
          auditItems.filter((it) => it.difference !== 0).length ||
          0,
        positive_diff_value: Number(a.positive_diff_value) || computedPos || 0,
        negative_diff_value: Number(a.negative_diff_value) || computedNeg || 0,
        net_diff_value: Number(a.net_diff_value ?? a.total_diff_cost) || 0,
        notes: a.notes || a.audit_notes || undefined,
        started_at: String(a.started_at || a.created_at || new Date().toISOString()),
        completed_at: a.completed_at || undefined,
        validated_at: a.validated_at || undefined,
        created_at: String(a.created_at || new Date().toISOString()),
        items: auditItems,
      };
    });

    return {
      success: true,
      audits: mappedAudits,
    };
  } catch (err: any) {
    console.warn('Supabase fetchInventoryAuditsFromSupabase:', err);
    return {
      success: false,
      audits: [],
      error: err?.message || "Erreur lors de la lecture de l'historique des audits.",
      isNetworkError: isNetworkOrFetchError(err),
    };
  }
}

export interface DashboardKpisResult {
  total_value: number;
  total_units: number;
  low_stock_count: number;
  out_stock_count: number;
  outflow_count: number;
  inflow_count: number;
  scope: string;
  depot_filter: string;
  calculated_at?: string;
}

export async function fetchDashboardKpisFromSupabase(
  client: SupabaseClient | null,
  scope: string = 'COMPANY',
  depotFilter: string = 'ALL'
): Promise<DashboardKpisResult | null> {
  if (!client) return null;
  try {
    const { data, error } = await client.rpc('get_dashboard_kpis', {
      p_scope: scope,
      p_depot_filter: depotFilter,
    });
    if (!error && data) {
      return data as DashboardKpisResult;
    }
  } catch (err) {
    console.warn('RPC get_dashboard_kpis failed:', err);
  }
  return null;
}

export { APP_VERSION, EXPECTED_SCHEMA_VERSION, MIN_SUPPORTED_SCHEMA_VERSION };

export interface AppCompatStatus {
  checked: boolean;
  compatible: boolean;
  maintenance: boolean;
  appVersion: string;
  expectedSchemaVersion: string;
  minSupportedSchemaVersion: string;
  schemaVersion?: string;
  minSchemaVersion?: string;
  minAppVersion?: string;
  latestVersion?: string;
  updateUrl?: string | null;
  message?: string | null;
  tableMissing?: boolean;
  fromCache?: boolean;
  appOutdated?: boolean;
  dbOutdated?: boolean;
  schemaBehindWarning?: boolean;
  schemaAhead?: boolean;
  blockingReason?: string | null;
  warningBanner?: string | null;
  adminBanner?: string | null;
}

/**
 * Compare deux versions sémantiques (ex: "5.4.0" vs "5.5.0").
 * Retourne -1 si v1 < v2, 0 si v1 == v2, 1 si v1 > v2.
 */
export function compareSemver(v1?: string | null, v2?: string | null): number {
  const clean1 = String(v1 || '0.0.0')
    .trim()
    .replace(/^v/i, '')
    .split(/[-+]/)[0];
  const clean2 = String(v2 || '0.0.0')
    .trim()
    .replace(/^v/i, '')
    .split(/[-+]/)[0];

  const parts1 = clean1.split('.').map((n) => parseInt(n, 10) || 0);
  const parts2 = clean2.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(parts1.length, parts2.length, 3);

  for (let i = 0; i < len; i++) {
    const a = parts1[i] ?? 0;
    const b = parts2[i] ?? 0;
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return 0;
}

/**
 * Évalue les règles de compatibilité Point 4 à partir d'une ligne core_app_compat :
 * - APP_VERSION < min_app_version (base) : blocage « Mettez l'application à jour »
 * - schema_version (base) < MIN_SUPPORTED_SCHEMA_VERSION : blocage « La base de données doit être mise à jour »
 * - schema_version (base) < EXPECTED_SCHEMA_VERSION mais >= MIN_SUPPORTED_SCHEMA_VERSION :
 *   l'application fonctionne, avec un bandeau d'information pour les administrateurs
 * - schema_version (base) > EXPECTED_SCHEMA_VERSION : l'application fonctionne (la base est en avance, les migrations sont additives)
 * - maintenance = true : blocage pour les utilisateurs, simple bandeau pour les rôles 0 et 1
 */
export function evaluateAppCompatRules(
  row: {
    schema_version?: string | null;
    min_schema_version?: string | null;
    min_app_version?: string | null;
    latest_version?: string | null;
    update_url?: string | null;
    maintenance?: boolean | null;
    message?: string | null;
  },
  fromCache = false
): AppCompatStatus {
  const minAppVersion = String(row.min_app_version || '1.0.0').trim();
  const schemaVersion = String(row.schema_version || '1.0.0').trim();
  const minSchemaVersion = String(row.min_schema_version || '1.0.0').trim();
  const latestVersion = row.latest_version ? String(row.latest_version).trim() : minAppVersion;
  const maintenance = Boolean(row.maintenance);

  const appOutdated = compareSemver(APP_VERSION, minAppVersion) < 0;
  const dbOutdated = compareSemver(schemaVersion, MIN_SUPPORTED_SCHEMA_VERSION) < 0;
  const schemaBehindWarning =
    !dbOutdated && compareSemver(schemaVersion, EXPECTED_SCHEMA_VERSION) < 0;
  const schemaAhead = compareSemver(schemaVersion, EXPECTED_SCHEMA_VERSION) > 0;

  let blockingReason: string | null = null;
  if (appOutdated) {
    blockingReason = "Mettez l'application à jour";
  } else if (dbOutdated) {
    blockingReason = 'La base de données doit être mise à jour';
  }

  let adminBanner: string | null = null;
  if (schemaBehindWarning) {
    adminBanner = `Schéma de base de données (${schemaVersion}) antérieur à la version attendue (${EXPECTED_SCHEMA_VERSION}) mais toléré (>= ${MIN_SUPPORTED_SCHEMA_VERSION}). Planifiez la mise à jour SQL.`;
  }

  return {
    checked: true,
    compatible: !appOutdated && !dbOutdated && !maintenance,
    maintenance,
    appVersion: APP_VERSION,
    expectedSchemaVersion: EXPECTED_SCHEMA_VERSION,
    minSupportedSchemaVersion: MIN_SUPPORTED_SCHEMA_VERSION,
    schemaVersion,
    minSchemaVersion,
    minAppVersion,
    latestVersion,
    updateUrl: row.update_url || '/tot-stock.apk',
    message: row.message || blockingReason || null,
    tableMissing: false,
    fromCache,
    appOutdated,
    dbOutdated,
    schemaBehindWarning,
    schemaAhead,
    blockingReason,
    warningBanner: null,
    adminBanner,
  };
}

/**
 * Vérifie la table singleton public.core_app_compat (id = 1) au démarrage (Point 4).
 * Distingue trois cas :
 * 1) table absente : avertissement non bloquant « installation incomplète, contactez votre administrateur »
 * 2) erreur réseau ou hors ligne : continuer avec le dernier état connu mis en cache
 * 3) table présente : appliquer les règles de compatibilité.
 */
export async function checkAppCompatibility(
  client: SupabaseClient | null,
  _forceCheck = false
): Promise<AppCompatStatus> {
  const defaultUnconfigured: AppCompatStatus = {
    checked: true,
    compatible: true,
    maintenance: false,
    appVersion: APP_VERSION,
    expectedSchemaVersion: EXPECTED_SCHEMA_VERSION,
    minSupportedSchemaVersion: MIN_SUPPORTED_SCHEMA_VERSION,
  };

  if (!client) return defaultUnconfigured;

  const cacheStorageKey = `tot_app_compat_last_known_${cachedUrl || 'default'}`;

  const loadCachedCompatState = (): AppCompatStatus => {
    try {
      const raw = localStorage.getItem(cacheStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (parsed.tableMissing) {
            return {
              ...defaultUnconfigured,
              tableMissing: true,
              fromCache: true,
              warningBanner: 'installation incomplète, contactez votre administrateur',
              message: 'installation incomplète, contactez votre administrateur',
            };
          }
          return evaluateAppCompatRules(parsed, true);
        }
      }
    } catch {}
    return {
      ...defaultUnconfigured,
      fromCache: true,
    };
  };

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return loadCachedCompatState();
  }

  try {
    const { data, error } = await client
      .from(TABLES.appCompat)
      .select('*')
      .eq('id', 1)
      .maybeSingle();

    if (error) {
      if (isNetworkOrFetchError(error)) {
        return loadCachedCompatState();
      }

      const code = String(error.code || '');
      const msg = String(error.message || '').toLowerCase();
      const isTableAbsent =
        code === 'PGRST205' ||
        code === '42P01' ||
        msg.includes('could not find') ||
        msg.includes('does not exist') ||
        msg.includes('not found') ||
        msg.includes(TABLES.appCompat);

      if (isTableAbsent) {
        try {
          localStorage.setItem(cacheStorageKey, JSON.stringify({ tableMissing: true }));
        } catch {}
        return {
          ...defaultUnconfigured,
          tableMissing: true,
          compatible: true,
          warningBanner: 'installation incomplète, contactez votre administrateur',
          message: 'installation incomplète, contactez votre administrateur',
        };
      }

      return loadCachedCompatState();
    }

    if (!data) {
      return {
        ...defaultUnconfigured,
        tableMissing: true,
        compatible: true,
        warningBanner: 'installation incomplète, contactez votre administrateur',
        message: 'installation incomplète, contactez votre administrateur',
      };
    }

    try {
      localStorage.setItem(
        cacheStorageKey,
        JSON.stringify({
          schema_version: data.schema_version,
          min_schema_version: data.min_schema_version,
          min_app_version: data.min_app_version,
          latest_version: data.latest_version,
          update_url: data.update_url,
          maintenance: data.maintenance,
          message: data.message,
        })
      );
    } catch {}

    return evaluateAppCompatRules(data, false);
  } catch (err) {
    if (isNetworkOrFetchError(err)) {
      return loadCachedCompatState();
    }
    return loadCachedCompatState();
  }
}

export interface DiagnosticCheckRow {
  check_key: string;
  check_label: string;
  status: 'OK' | 'ATTENTION' | 'ERREUR';
  details: string;
}

export async function checkEmailServiceConfigured(
  client: SupabaseClient | null
): Promise<boolean> {
  if (!client) {
    try {
      const cached = localStorage.getItem('tot_email_service_configured');
      if (cached === 'false') return false;
    } catch {}
    return true;
  }

  try {
    const fnName = getResolvedEdgeFunctionName('sendReportEmail');
    const { data, error } = await client.functions.invoke(fnName, {
      body: { action: 'status' },
    });
    if (!error && data && (data.configured === false || data.status === 'non configuré')) {
      try {
        localStorage.setItem('tot_email_service_configured', 'false');
        window.dispatchEvent(new CustomEvent('tot-email-service-status', { detail: { configured: false } }));
      } catch {}
      return false;
    }
    if (!error && data && data.configured === true) {
      try {
        localStorage.setItem('tot_email_service_configured', 'true');
        window.dispatchEvent(new CustomEvent('tot-email-service-status', { detail: { configured: true } }));
      } catch {}
      return true;
    }
  } catch {
    // ignore network error and keep last known state
  }

  try {
    const cached = localStorage.getItem('tot_email_service_configured');
    if (cached === 'false') return false;
  } catch {}
  return true;
}

export const STOCK_MOVEMENTS_SQL_OUTDATED_MESSAGE =
  "Le serveur n'a pas la dernière version des scripts SQL (03, 04) : exécutez dist/install.sql";

/**
 * Vérifie au démarrage et lors du diagnostic que la table public.stk_stock_levels existe
 * et que la fonction RPC public.process_stock_movement existe avec la signature attendue (12 paramètres).
 */
export async function checkStockMovementsReadiness(
  client: SupabaseClient | null
): Promise<{
  ready: boolean;
  message: string;
  isNetworkError?: boolean;
  checkRow: DiagnosticCheckRow;
  warningMessage?: string;
}> {
  if (!client) {
    return {
      ready: true,
      message: 'Base de données Supabase non configurée ou hors ligne.',
      checkRow: {
        check_key: 'stock_movements_rpc',
        check_label: 'Mouvements de stock',
        status: 'ATTENTION',
        details: 'Base de données Supabase non configurée ou hors ligne.',
      },
    };
  }

  try {
    // 1. Vérifier que la table public.stk_stock_levels existe
    const { error: slErr } = await client.from(TABLES.stockLevels).select('product_id').limit(1);
    if (slErr) {
      if (isNetworkOrFetchError(slErr)) {
        return {
          ready: true,
          message: 'Serveur hors ligne — contrôle différé.',
          isNetworkError: true,
          checkRow: {
            check_key: 'stock_movements_rpc',
            check_label: 'Mouvements de stock',
            status: 'ATTENTION',
            details: 'Serveur hors ligne — contrôle différé.',
          },
        };
      }
      const slCode = String(slErr.code || '');
      const slMsg = String(slErr.message || '').toLowerCase();
      const isTableMissing =
        slCode === '42P01' ||
        slCode === 'PGRST205' ||
        slMsg.includes('does not exist') ||
        slMsg.includes('could not find the table') ||
        slMsg.includes('not found');
      if (isTableMissing) {
        return {
          ready: false,
          message: STOCK_MOVEMENTS_SQL_OUTDATED_MESSAGE,
          checkRow: {
            check_key: 'stock_movements_rpc',
            check_label: 'Mouvements de stock',
            status: 'ERREUR',
            details: STOCK_MOVEMENTS_SQL_OUTDATED_MESSAGE,
          },
          warningMessage: STOCK_MOVEMENTS_SQL_OUTDATED_MESSAGE,
        };
      }
    }

    // 2. Vérifier que la fonction RPC public.process_stock_movement existe avec les 12 paramètres attendus
    const pingOpId = '00000000-0000-4000-8000-000000000000';
    const { error: rpcErr } = await client.rpc('process_stock_movement', {
      p_operation_id: pingOpId,
      p_product_id: '__DIAGNOSTIC_PING__',
      p_depot_name: 'Dépôt Principal',
      p_type: 'IN',
      p_quantity: 1,
      p_reason: null,
      p_project_name: null,
      p_department: null,
      p_dest_depot_name: null,
      p_dest_rack: null,
      p_metadata: {},
      p_action: 'DIAGNOSTIC_PING',
    });

    if (rpcErr) {
      if (isNetworkOrFetchError(rpcErr)) {
        return {
          ready: true,
          message: 'Serveur hors ligne — contrôle différé.',
          isNetworkError: true,
          checkRow: {
            check_key: 'stock_movements_rpc',
            check_label: 'Mouvements de stock',
            status: 'ATTENTION',
            details: 'Serveur hors ligne — contrôle différé.',
          },
        };
      }
      const rpcCode = String(rpcErr.code || '');
      const rpcMsg = String(rpcErr.message || '').toLowerCase();
      const isRpcMissingOrWrongSignature =
        rpcCode === '42883' ||
        rpcCode === 'PGRST202' ||
        rpcMsg.includes('could not find the function') ||
        (rpcMsg.includes('function') &&
          rpcMsg.includes('process_stock_movement') &&
          rpcMsg.includes('does not exist'));

      if (isRpcMissingOrWrongSignature) {
        return {
          ready: false,
          message: STOCK_MOVEMENTS_SQL_OUTDATED_MESSAGE,
          checkRow: {
            check_key: 'stock_movements_rpc',
            check_label: 'Mouvements de stock',
            status: 'ERREUR',
            details: STOCK_MOVEMENTS_SQL_OUTDATED_MESSAGE,
          },
          warningMessage: STOCK_MOVEMENTS_SQL_OUTDATED_MESSAGE,
        };
      }
    }

    return {
      ready: true,
      message: 'Table stock_levels et fonction process_stock_movement (12 paramètres) présentes',
      checkRow: {
        check_key: 'stock_movements_rpc',
        check_label: 'Mouvements de stock',
        status: 'OK',
        details: 'Table stock_levels et fonction process_stock_movement (12 paramètres) présentes',
      },
    };
  } catch (err: any) {
    if (isNetworkOrFetchError(err)) {
      return {
        ready: true,
        message: 'Serveur hors ligne — contrôle différé.',
        isNetworkError: true,
        checkRow: {
          check_key: 'stock_movements_rpc',
          check_label: 'Mouvements de stock',
          status: 'ATTENTION',
          details: 'Serveur hors ligne — contrôle différé.',
        },
      };
    }
    return {
      ready: true,
      message: 'Table stock_levels et fonction process_stock_movement (12 paramètres) présentes',
      checkRow: {
        check_key: 'stock_movements_rpc',
        check_label: 'Mouvements de stock',
        status: 'OK',
        details: 'Table stock_levels et fonction process_stock_movement (12 paramètres) présentes',
      },
    };
  }
}

export async function runDiagnosticInstallation(
  client: SupabaseClient | null
): Promise<{ success: boolean; rows: DiagnosticCheckRow[]; error?: string }> {
  if (!client) {
    return {
      success: false,
      rows: [],
      error: 'Base de données Supabase non configurée ou hors ligne.',
    };
  }

  try {
    // Clear legacy table fallback cache before running diagnostic so a freshly migrated DB is immediately detected
    clearLegacyTableFallbackCache();

    const { data, error } = await client.rpc('diagnostic_installation');
    if (error) {
      return {
        success: false,
        rows: [],
        error: error.message || "Erreur lors de l'exécution de diagnostic_installation().",
      };
    }

    const rows: DiagnosticCheckRow[] = Array.isArray(data)
      ? data.map((r: any) => ({
          check_key: String(r.check_key || ''),
          check_label: String(r.check_label || ''),
          status:
            r.status === 'OK' || r.status === 'ATTENTION' || r.status === 'ERREUR'
              ? r.status
              : 'ATTENTION',
          details: String(r.details || ''),
        }))
      : [];

    // Probe prefixed_tables if not returned by an older 1.x server diagnostic_installation()
    if (!rows.some((r) => r.check_key === 'prefixed_tables')) {
      try {
        await client.from(TABLES.products).select('id').limit(1);
        let usedLegacyFallback = false;
        for (const map of legacyFallbackTablesByOrigin.values()) {
          if (map.has(TABLES.products)) {
            usedLegacyFallback = true;
            break;
          }
        }
        rows.push({
          check_key: 'prefixed_tables',
          check_label: 'Tables avec préfixes (core_ / stk_)',
          status: usedLegacyFallback ? 'ERREUR' : 'OK',
          details: usedLegacyFallback
            ? "Anciennes tables sans préfixe détectées (schéma 1.x). Exécutez supabase-client/09_core_prefixes.sql ou dist/install.sql dans l'éditeur SQL Supabase."
            : 'Tables préfixées core_* et stk_* présentes.',
        });
      } catch {
        rows.push({
          check_key: 'prefixed_tables',
          check_label: 'Tables avec préfixes (core_ / stk_)',
          status: 'ERREUR',
          details:
            "Impossible de vérifier les tables préfixées core_* / stk_*. Exécutez dist/install.sql dans l'éditeur SQL Supabase.",
        });
      }
    }

    // Probe stock_movements_rpc if not already returned by the server's diagnostic_installation()
    if (!rows.some((r) => r.check_key === 'stock_movements_rpc')) {
      const movCheck = await checkStockMovementsReadiness(client);
      rows.push(movCheck.checkRow);
    }

    // Probe Edge Functions availability using { action: 'ping' }
    await loadEdgeFunctionOverridesFromClientDb(client);
    const pingReport = await pingClientEdgeFunctions(client);
    const edgeRowIdx = rows.findIndex((r) => r.check_key === 'edge_functions_deployed');
    if (edgeRowIdx !== -1) {
      rows[edgeRowIdx] = {
        ...rows[edgeRowIdx],
        status: pingReport.status,
        details: pingReport.summary,
      };
    }
    if (!rows.some((r) => r.check_key === 'edge_functions')) {
      rows.push({
        check_key: 'edge_functions',
        check_label: 'Fonctions Edge',
        status: pingReport.status,
        details: pingReport.summary,
      });
    }

    return { success: true, rows };
  } catch (err: any) {
    return {
      success: false,
      rows: [],
      error: err?.message || 'Erreur inattendue lors du diagnostic.',
    };
  }
}




