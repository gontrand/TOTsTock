import { SupabaseClient } from '@supabase/supabase-js';
import { TABLES } from '../constants/tables';

/**
 * Clés de préférences autorisées en base (`public.core_user_preferences.prefs`)
 * et correspondance bidirectionnelle avec les clés `localStorage`.
 */
export const LOCAL_TO_DB_PREF_MAP = {
  tot_stock_haptics_enabled: 'haptics_enabled',
  tot_stock_haptics_intensity: 'haptics_intensity',
  tot_stock_sound_enabled: 'sound_enabled',
  tot_scanner_sound_enabled: 'scanner_sound',
  tot_scanner_vibration_enabled: 'scanner_vibration',
  tot_inv_auto_logout_minutes: 'auto_logout_minutes',
  tqt_language: 'language',
  tot_inv_theme: 'theme',
  tot_desktop_sidebar_collapsed_v1: 'desktop_sidebar_collapsed',
  tot_desktop_inventory_columns_v1: 'desktop_inventory_columns',
  tot_desktop_inventory_density_v1: 'desktop_inventory_density',
  tot_print_station_sound_enabled: 'print_sound',
  tot_print_station_blink_enabled: 'print_blink',
} as const;

export type LocalPrefKey = keyof typeof LOCAL_TO_DB_PREF_MAP;
export type DbPrefKey = (typeof LOCAL_TO_DB_PREF_MAP)[LocalPrefKey];

export const DB_TO_LOCAL_PREF_MAP: Readonly<Record<DbPrefKey, LocalPrefKey>> = {
  haptics_enabled: 'tot_stock_haptics_enabled',
  haptics_intensity: 'tot_stock_haptics_intensity',
  sound_enabled: 'tot_stock_sound_enabled',
  scanner_sound: 'tot_scanner_sound_enabled',
  scanner_vibration: 'tot_scanner_vibration_enabled',
  auto_logout_minutes: 'tot_inv_auto_logout_minutes',
  language: 'tqt_language',
  theme: 'tot_inv_theme',
  desktop_sidebar_collapsed: 'tot_desktop_sidebar_collapsed_v1',
  desktop_inventory_columns: 'tot_desktop_inventory_columns_v1',
  desktop_inventory_density: 'tot_desktop_inventory_density_v1',
  print_sound: 'tot_print_station_sound_enabled',
  print_blink: 'tot_print_station_blink_enabled',
};

export const WHITELISTED_DB_PREF_KEYS: ReadonlySet<DbPrefKey> = new Set<DbPrefKey>(
  Object.values(LOCAL_TO_DB_PREF_MAP)
);

export const WHITELISTED_LOCAL_PREF_KEYS: ReadonlySet<LocalPrefKey> = new Set<LocalPrefKey>(
  Object.keys(LOCAL_TO_DB_PREF_MAP) as LocalPrefKey[]
);

/**
 * Liste noire explicite : ces clés ou motifs ne doivent JAMAIS quitter l'appareil
 * vers `core_user_preferences`.
 */
export const BLACKLISTED_PREF_KEYS: ReadonlySet<string> = new Set([
  'tot_pin_failed_attempts',
  'pin_failed_attempts',
  'tot_last_activity_ts',
  'last_activity_ts',
  'tqt_company_key',
  'tqt_company_url',
  'tot_inv_supabase_key',
  'tot_inv_supabase_url',
  'supabase_key',
  'supabase_url',
  'tot_print_station_id',
  'tot_print_station_name',
  'tot_print_station_depot',
  'tot_print_station_auto_mode',
  'print_station_id',
  'print_station_name',
  'print_station_depot',
  'print_station_auto_mode',
  'tot_scanner_offline_queue_v1',
  'sync_queue',
  'offline_queue',
  'company_license_info',
  'signed_token',
  'license_token',
  'license_key',
  'smtp',
  'tot_inv_current_user',
]);

export const BLACKLISTED_PREF_PREFIXES: readonly string[] = [
  'tot_local_device_pin_',
  'tot_inventory_audit_',
  'tot_smtp_',
  'sb-',
];

export interface UserPreferencesRecord {
  haptics_enabled?: boolean;
  haptics_intensity?: 'light' | 'normal' | 'medium' | 'strong' | 'heavy';
  sound_enabled?: boolean;
  scanner_sound?: boolean;
  scanner_vibration?: boolean;
  auto_logout_minutes?: number;
  language?: 'fr' | 'en' | 'nl';
  theme?: 'light' | 'dark';
  desktop_sidebar_collapsed?: boolean;
  desktop_inventory_columns?: string[];
  desktop_inventory_density?: 'normal' | 'compact';
  print_sound?: boolean;
  print_blink?: boolean;
}

export interface UserPreferencesSyncBannerState {
  visible: boolean;
  dismissed: boolean;
  errorCode: string;
  message: string;
}

const PENDING_PREFS_STORAGE_KEY = 'tot_user_prefs_pending_keys_v1';
const LAST_SYNCED_UPDATED_AT_KEY = 'tot_user_prefs_updated_at_v1';
const MAX_PREFS_JSON_BYTES = 16384;
const DEBOUNCE_MS = 1000;

let activeClientResolver: (() => SupabaseClient | null) | null = null;
let activeUserIdResolver: (() => string | null) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let inMemoryPendingValues: Partial<Record<DbPrefKey, unknown>> = {};
let bannerShownOnceInSession = false;
let currentSyncBanner: UserPreferencesSyncBannerState = {
  visible: false,
  dismissed: false,
  errorCode: '',
  message: '',
};

type PreferencesChangeListener = (prefs: UserPreferencesRecord) => void;
type SyncBannerListener = (state: UserPreferencesSyncBannerState) => void;

const preferenceListeners = new Set<PreferencesChangeListener>();
const syncBannerListeners = new Set<SyncBannerListener>();

export function isBlacklistedPreferenceKey(key: string): boolean {
  const clean = String(key || '').trim();
  if (!clean) return true;
  if (BLACKLISTED_PREF_KEYS.has(clean)) return true;
  const lower = clean.toLowerCase();
  if (BLACKLISTED_PREF_KEYS.has(lower)) return true;
  for (const prefix of BLACKLISTED_PREF_PREFIXES) {
    if (lower.startsWith(prefix.toLowerCase())) return true;
  }
  if (
    lower.includes('pin') ||
    lower.includes('secret') ||
    lower.includes('service_role') ||
    lower.includes('smtp') ||
    lower.includes('license') ||
    lower.includes('offline_queue') ||
    lower.includes('supabase_key') ||
    lower.includes('company_key')
  ) {
    return true;
  }
  return false;
}

export function isWhitelistedDbPrefKey(key: string): key is DbPrefKey {
  return WHITELISTED_DB_PREF_KEYS.has(key as DbPrefKey) && !isBlacklistedPreferenceKey(key);
}

export function isWhitelistedLocalPrefKey(key: string): key is LocalPrefKey {
  return WHITELISTED_LOCAL_PREF_KEYS.has(key as LocalPrefKey) && !isBlacklistedPreferenceKey(key);
}

/**
 * Filtre et valide strictement un objet de préférences avant envoi ou application :
 * - Rejette toute clé hors liste blanche ou présente dans la liste noire
 * - Normalise les types scalaires / tableaux plats
 * - Garantit que l'objet JSON sérialisé ne dépasse pas 16 Ko (16384 octets)
 */
export function sanitizePreferencesPayload(
  raw: Record<string, unknown> | null | undefined
): UserPreferencesRecord {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const clean: UserPreferencesRecord = {};

  for (const [rawKey, rawVal] of Object.entries(raw)) {
    if (rawVal === undefined || rawVal === null) continue;
    if (isBlacklistedPreferenceKey(rawKey)) continue;

    const dbKey: DbPrefKey | undefined = isWhitelistedDbPrefKey(rawKey)
      ? rawKey
      : isWhitelistedLocalPrefKey(rawKey)
        ? LOCAL_TO_DB_PREF_MAP[rawKey]
        : undefined;

    if (!dbKey || !isWhitelistedDbPrefKey(dbKey)) continue;

    switch (dbKey) {
      case 'haptics_enabled':
      case 'sound_enabled':
      case 'scanner_sound':
      case 'scanner_vibration':
      case 'desktop_sidebar_collapsed':
      case 'print_sound':
      case 'print_blink': {
        if (typeof rawVal === 'boolean') {
          clean[dbKey] = rawVal;
        } else if (rawVal === 'true' || rawVal === '1' || rawVal === 1) {
          clean[dbKey] = true;
        } else if (rawVal === 'false' || rawVal === '0' || rawVal === 0) {
          clean[dbKey] = false;
        }
        break;
      }
      case 'haptics_intensity': {
        if (
          rawVal === 'light' ||
          rawVal === 'normal' ||
          rawVal === 'medium' ||
          rawVal === 'strong' ||
          rawVal === 'heavy'
        ) {
          clean.haptics_intensity = rawVal;
        }
        break;
      }
      case 'auto_logout_minutes': {
        const n = Number(rawVal);
        if (Number.isFinite(n) && n >= 0 && n <= 1440) {
          clean.auto_logout_minutes = Math.round(n);
        }
        break;
      }
      case 'language': {
        if (rawVal === 'fr' || rawVal === 'en' || rawVal === 'nl') {
          clean.language = rawVal;
        }
        break;
      }
      case 'theme': {
        if (rawVal === 'light' || rawVal === 'dark') {
          clean.theme = rawVal;
        }
        break;
      }
      case 'desktop_inventory_density': {
        if (rawVal === 'normal' || rawVal === 'compact') {
          clean.desktop_inventory_density = rawVal;
        }
        break;
      }
      case 'desktop_inventory_columns': {
        let arr: unknown = rawVal;
        if (typeof rawVal === 'string') {
          try {
            arr = JSON.parse(rawVal);
          } catch {
            arr = null;
          }
        }
        if (Array.isArray(arr)) {
          const validCols = arr
            .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            .slice(0, 30);
          if (validCols.length > 0) {
            clean.desktop_inventory_columns = validCols;
          }
        }
        break;
      }
    }
  }

  const encoded = new TextEncoder().encode(JSON.stringify(clean));
  if (encoded.byteLength > MAX_PREFS_JSON_BYTES) {
    throw new Error(`Objet de préférences trop volumineux (${encoded.byteLength} octets > 16384).`);
  }

  return clean;
}

export function getPendingPreferenceKeys(): Set<DbPrefKey> {
  try {
    if (typeof localStorage === 'undefined') return new Set();
    const raw = localStorage.getItem(PENDING_PREFS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((k): k is DbPrefKey => isWhitelistedDbPrefKey(String(k))));
  } catch {
    return new Set();
  }
}

function savePendingPreferenceKeys(keys: Iterable<DbPrefKey>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const arr = Array.from(new Set(keys)).filter(isWhitelistedDbPrefKey);
    if (arr.length === 0) {
      localStorage.removeItem(PENDING_PREFS_STORAGE_KEY);
    } else {
      localStorage.setItem(PENDING_PREFS_STORAGE_KEY, JSON.stringify(arr));
    }
  } catch {
    // Ignore storage errors
  }
}

function markPendingPreferenceKey(dbKey: DbPrefKey): void {
  const current = getPendingPreferenceKeys();
  current.add(dbKey);
  savePendingPreferenceKeys(current);
}

function clearPendingPreferenceKeys(clearedKeys: Iterable<DbPrefKey>): void {
  const current = getPendingPreferenceKeys();
  for (const k of clearedKeys) {
    current.delete(k);
  }
  savePendingPreferenceKeys(current);
}

/**
 * Lit une valeur dans `localStorage` et la convertit au format typé de `UserPreferencesRecord`.
 */
export function readLocalPreferenceValue<K extends DbPrefKey>(
  dbKey: K
): UserPreferencesRecord[K] | undefined {
  if (!isWhitelistedDbPrefKey(dbKey)) return undefined;
  try {
    if (typeof localStorage === 'undefined') return undefined;
    const localKey = DB_TO_LOCAL_PREF_MAP[dbKey];
    const raw = localStorage.getItem(localKey);
    if (raw === null) return undefined;
    const sanitized = sanitizePreferencesPayload({ [dbKey]: raw });
    return sanitized[dbKey];
  } catch {
    return undefined;
  }
}

export const getUserPreference = readLocalPreferenceValue;

/**
 * Lit toutes les préférences explicitement présentes dans `localStorage`.
 */
export function readAllLocalPreferences(): UserPreferencesRecord {
  const rawObj: Record<string, unknown> = {};
  try {
    if (typeof localStorage === 'undefined') return {};
    for (const [localKey, dbKey] of Object.entries(LOCAL_TO_DB_PREF_MAP) as [
      LocalPrefKey,
      DbPrefKey,
    ][]) {
      const val = localStorage.getItem(localKey);
      if (val !== null) {
        rawObj[dbKey] = val;
      }
    }
  } catch {
    return {};
  }
  return sanitizePreferencesPayload(rawObj);
}

/**
 * Écrit une valeur typée dans `localStorage` sans déclencher d'upsert distant
 * (utilisé lors de l'application des préférences reçues du serveur).
 */
export function writeLocalPreferenceCacheOnly<K extends DbPrefKey>(
  dbKey: K,
  value: UserPreferencesRecord[K]
): void {
  if (!isWhitelistedDbPrefKey(dbKey) || value === undefined) return;
  try {
    if (typeof localStorage === 'undefined') return;
    const localKey = DB_TO_LOCAL_PREF_MAP[dbKey];
    if (Array.isArray(value)) {
      localStorage.setItem(localKey, JSON.stringify(value));
    } else {
      localStorage.setItem(localKey, String(value));
    }
  } catch {
    // Ignore quota errors
  }
}

export function applyPreferencesToLocalCache(prefs: UserPreferencesRecord): void {
  const sanitized = sanitizePreferencesPayload(prefs as Record<string, unknown>);
  for (const [k, v] of Object.entries(sanitized) as [DbPrefKey, any][]) {
    if (v !== undefined) {
      writeLocalPreferenceCacheOnly(k, v);
    }
  }
  notifyPreferenceListeners(readAllLocalPreferences());
}

function notifyPreferenceListeners(prefs: UserPreferencesRecord): void {
  for (const listener of preferenceListeners) {
    try {
      listener(prefs);
    } catch {
      // Ignore listener error
    }
  }
}

export function subscribeUserPreferences(listener: PreferencesChangeListener): () => void {
  preferenceListeners.add(listener);
  return () => {
    preferenceListeners.delete(listener);
  };
}

export function getSyncBannerState(): UserPreferencesSyncBannerState {
  return { ...currentSyncBanner };
}

export function subscribeUserPreferencesSyncBanner(listener: SyncBannerListener): () => void {
  syncBannerListeners.add(listener);
  listener(getSyncBannerState());
  return () => {
    syncBannerListeners.delete(listener);
  };
}

export function dismissUserPreferencesSyncBanner(): void {
  currentSyncBanner = {
    ...currentSyncBanner,
    visible: false,
    dismissed: true,
  };
  for (const listener of syncBannerListeners) {
    try {
      listener(getSyncBannerState());
    } catch {}
  }
}

function triggerSyncErrorBannerOnce(error: any): void {
  if (bannerShownOnceInSession) return;
  const code = String(error?.code || error?.status || 'SQL_12_MISSING');
  bannerShownOnceInSession = true;
  currentSyncBanner = {
    visible: true,
    dismissed: false,
    errorCode: code,
    message: 'Préférences non synchronisées (script SQL 12 manquant)',
  };
  for (const listener of syncBannerListeners) {
    try {
      listener(getSyncBannerState());
    } catch {}
  }
}

export function clearSyncErrorBannerOnSuccess(): void {
  if (!currentSyncBanner.visible && !bannerShownOnceInSession) return;
  bannerShownOnceInSession = false;
  currentSyncBanner = {
    visible: false,
    dismissed: false,
    errorCode: '',
    message: '',
  };
  for (const listener of syncBannerListeners) {
    try {
      listener(getSyncBannerState());
    } catch {}
  }
}

export function isMissingSql12TableOrFunctionError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || '').trim().toUpperCase();
  const msg = String(err.message || err.details || '').toLowerCase();
  // Ne jamais afficher le bandeau « script SQL 12 manquant » sur une erreur 42501 / RLS / permission denied
  if (
    code === '42501' ||
    code === 'PGRST301' ||
    msg.includes('permission denied') ||
    msg.includes('row-level security')
  ) {
    return false;
  }
  return (
    code === '42P01' ||
    code === 'PGRST202' ||
    code === 'PGRST205' ||
    code === '42883' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('could not find the function')
  );
}

const isMissingTableOrRlsError = isMissingSql12TableOrFunctionError;

/**
 * Configure les résolveurs du client Supabase et de l'identifiant utilisateur courant.
 */
export function configureUserPreferencesSync(options: {
  getClient: () => SupabaseClient | null;
  getUserId: () => string | null;
}): void {
  activeClientResolver = options.getClient;
  activeUserIdResolver = options.getUserId;
}

/**
 * Met à jour immédiatement la préférence en cache local et programme un upsert
 * temporisé (debounce 1 s) vers `public.core_user_preferences`.
 */
export function setUserPreference<K extends DbPrefKey>(
  dbKey: K,
  value: UserPreferencesRecord[K]
): void {
  if (!isWhitelistedDbPrefKey(dbKey)) {
    throw new Error(`Clé de préférence non autorisée : ${String(dbKey)}`);
  }

  const sanitized = sanitizePreferencesPayload({ [dbKey]: value });
  const finalVal = sanitized[dbKey];
  if (finalVal === undefined) return;

  writeLocalPreferenceCacheOnly(dbKey, finalVal);
  markPendingPreferenceKey(dbKey);
  inMemoryPendingValues[dbKey] = finalVal;
  notifyPreferenceListeners(readAllLocalPreferences());

  scheduleDebouncedPreferencesUpsert();
}

export function setUserPreferenceByLocalKey(localKey: string, value: unknown): void {
  if (isBlacklistedPreferenceKey(localKey) || !isWhitelistedLocalPrefKey(localKey)) {
    throw new Error(`Clé locale non autorisée à la synchronisation : ${localKey}`);
  }
  const dbKey = LOCAL_TO_DB_PREF_MAP[localKey];
  setUserPreference(dbKey, value as any);
}

function scheduleDebouncedPreferencesUpsert(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void flushPendingUserPreferences();
  }, DEBOUNCE_MS);
}

/**
 * Envoie immédiatement toutes les préférences locales en attente vers `core_user_preferences`.
 * Si hors-ligne ou sans client actif, conserve les drapeaux « en attente » pour la reconnexion.
 */
export async function flushPendingUserPreferences(
  explicitClient?: SupabaseClient | null,
  explicitUserId?: string | number | null
): Promise<{ synced: boolean; prefs?: UserPreferencesRecord; error?: any }> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  const pendingKeys = getPendingPreferenceKeys();
  for (const k of Object.keys(inMemoryPendingValues) as DbPrefKey[]) {
    if (isWhitelistedDbPrefKey(k)) pendingKeys.add(k);
  }

  if (pendingKeys.size === 0) {
    return { synced: true, prefs: readAllLocalPreferences() };
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { synced: false };
  }

  const client = explicitClient !== undefined ? explicitClient : activeClientResolver?.() ?? null;
  const rawUserId =
    explicitUserId !== undefined && explicitUserId !== null
      ? String(explicitUserId).trim()
      : activeUserIdResolver?.()?.trim() ?? '';

  if (!client || !rawUserId) {
    return { synced: false };
  }

  // Construire le dictionnaire complet en lisant la ligne existante (si présente) + les clés locales en attente
  try {
    let remotePrefs: UserPreferencesRecord = {};
    const { data: existingRow, error: selectErr } = await client
      .from(TABLES.userPreferences)
      .select('prefs, updated_at')
      .eq('user_id', rawUserId)
      .maybeSingle();

    if (selectErr) {
      if (isMissingTableOrRlsError(selectErr)) {
        triggerSyncErrorBannerOnce(selectErr);
      }
      return { synced: false, error: selectErr };
    }

    if (existingRow?.prefs && typeof existingRow.prefs === 'object') {
      remotePrefs = sanitizePreferencesPayload(existingRow.prefs as Record<string, unknown>);
    }

    const localPrefs = readAllLocalPreferences();
    const pendingPatch: Record<string, unknown> = {};
    for (const key of pendingKeys) {
      if (inMemoryPendingValues[key] !== undefined) {
        pendingPatch[key] = inMemoryPendingValues[key];
      } else if (localPrefs[key] !== undefined) {
        pendingPatch[key] = localPrefs[key];
      }
    }

    const mergedPrefs = sanitizePreferencesPayload({
      ...remotePrefs,
      ...localPrefs,
      ...pendingPatch,
    });

    const nowIso = new Date().toISOString();
    const { error: upsertErr } = await client.from(TABLES.userPreferences).upsert(
      {
        user_id: rawUserId,
        prefs: mergedPrefs,
        updated_at: nowIso,
      },
      { onConflict: 'user_id' }
    );

    if (upsertErr) {
      if (isMissingTableOrRlsError(upsertErr)) {
        triggerSyncErrorBannerOnce(upsertErr);
      }
      return { synced: false, error: upsertErr };
    }

    clearPendingPreferenceKeys(pendingKeys);
    inMemoryPendingValues = {};
    clearSyncErrorBannerOnSuccess();
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LAST_SYNCED_UPDATED_AT_KEY, nowIso);
      }
    } catch {}

    return { synced: true, prefs: mergedPrefs };
  } catch (err) {
    if (isMissingTableOrRlsError(err)) {
      triggerSyncErrorBannerOnce(err);
    }
    return { synced: false, error: err };
  }
}

/**
 * Synchronise les préférences à la connexion d'un utilisateur :
 * 1. `select prefs, updated_at` de la ligne de l'utilisateur dans `core_user_preferences`.
 * 2. Si une ligne existe : applique les valeurs serveur SAUF les clés modifiées localement
 *    hors-ligne et encore marquées « en attente » (`pendingKeys`). Si des clés étaient en
 *    attente, pousse la fusion vers la base.
 * 3. Si aucune ligne n'existe en base à la première connexion : crée la ligne avec les
 *    valeurs locales courantes (ne remplace jamais une ligne déjà existante en base par les
 *    valeurs par défaut d'un nouvel appareil).
 */
export async function syncUserPreferencesOnLogin(
  client: SupabaseClient | null,
  userId: string | number | null | undefined
): Promise<{
  synced: boolean;
  createdInitialRow: boolean;
  appliedPrefs: UserPreferencesRecord;
  error?: any;
}> {
  const cleanUserId = userId !== null && userId !== undefined ? String(userId).trim() : '';
  const localCurrent = readAllLocalPreferences();

  if (!client || !cleanUserId) {
    return { synced: false, createdInitialRow: false, appliedPrefs: localCurrent };
  }

  try {
    const { data: row, error: selectErr } = await client
      .from(TABLES.userPreferences)
      .select('prefs, updated_at')
      .eq('user_id', cleanUserId)
      .maybeSingle();

    if (selectErr) {
      if (isMissingTableOrRlsError(selectErr)) {
        triggerSyncErrorBannerOnce(selectErr);
      }
      return {
        synced: false,
        createdInitialRow: false,
        appliedPrefs: localCurrent,
        error: selectErr,
      };
    }

    const pendingKeys = getPendingPreferenceKeys();
    for (const k of Object.keys(inMemoryPendingValues) as DbPrefKey[]) {
      if (isWhitelistedDbPrefKey(k)) pendingKeys.add(k);
    }

    // Cas 1 : Une ligne existe déjà en base pour cet utilisateur
    if (row && row.prefs && typeof row.prefs === 'object') {
      const serverPrefs = sanitizePreferencesPayload(row.prefs as Record<string, unknown>);
      const mergedToApply: UserPreferencesRecord = { ...serverPrefs };

      // Conserver uniquement les clés modifiées hors-ligne encore marquées « en attente »
      const pendingOverrides: Record<string, unknown> = {};
      for (const pendingKey of pendingKeys) {
        const localVal =
          inMemoryPendingValues[pendingKey] !== undefined
            ? inMemoryPendingValues[pendingKey]
            : localCurrent[pendingKey];
        if (localVal !== undefined) {
          (mergedToApply as Record<string, unknown>)[pendingKey] = localVal;
          pendingOverrides[pendingKey] = localVal;
        }
      }

      applyPreferencesToLocalCache(mergedToApply);

      if (row.updated_at && typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(LAST_SYNCED_UPDATED_AT_KEY, String(row.updated_at));
        } catch {}
      }

      // Si des modifications hors-ligne étaient en attente, les pousser maintenant
      if (Object.keys(pendingOverrides).length > 0) {
        const nowIso = new Date().toISOString();
        const finalMerged = sanitizePreferencesPayload({
          ...serverPrefs,
          ...pendingOverrides,
        });
        const { error: upsertErr } = await client.from(TABLES.userPreferences).upsert(
          {
            user_id: cleanUserId,
            prefs: finalMerged,
            updated_at: nowIso,
          },
          { onConflict: 'user_id' }
        );
        if (!upsertErr) {
          clearPendingPreferenceKeys(pendingKeys);
          inMemoryPendingValues = {};
          try {
            localStorage.setItem(LAST_SYNCED_UPDATED_AT_KEY, nowIso);
          } catch {}
        } else if (isMissingTableOrRlsError(upsertErr)) {
          triggerSyncErrorBannerOnce(upsertErr);
        }
      }

      clearSyncErrorBannerOnSuccess();

      return {
        synced: true,
        createdInitialRow: false,
        appliedPrefs: mergedToApply,
      };
    }

    // Cas 2 : Aucune ligne en base (première connexion de cet utilisateur) -> créer avec les valeurs locales courantes
    const initialPrefs = sanitizePreferencesPayload(localCurrent as Record<string, unknown>);
    const nowIso = new Date().toISOString();
    const { error: insertErr } = await client.from(TABLES.userPreferences).upsert(
      {
        user_id: cleanUserId,
        prefs: initialPrefs,
        updated_at: nowIso,
      },
      { onConflict: 'user_id' }
    );

    if (insertErr) {
      if (isMissingTableOrRlsError(insertErr)) {
        triggerSyncErrorBannerOnce(insertErr);
      }
      return {
        synced: false,
        createdInitialRow: false,
        appliedPrefs: initialPrefs,
        error: insertErr,
      };
    }

    clearPendingPreferenceKeys(pendingKeys);
    inMemoryPendingValues = {};
    clearSyncErrorBannerOnSuccess();
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LAST_SYNCED_UPDATED_AT_KEY, nowIso);
      }
    } catch {}

    return {
      synced: true,
      createdInitialRow: true,
      appliedPrefs: initialPrefs,
    };
  } catch (err) {
    if (isMissingTableOrRlsError(err)) {
      triggerSyncErrorBannerOnce(err);
    }
    return {
      synced: false,
      createdInitialRow: false,
      appliedPrefs: localCurrent,
      error: err,
    };
  }
}

/**
 * Réinitialise l'état interne du service de préférences (utile pour les tests unitaires).
 */
export function resetUserPreferencesServiceForTests(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  inMemoryPendingValues = {};
  bannerShownOnceInSession = false;
  currentSyncBanner = {
    visible: false,
    dismissed: false,
    errorCode: '',
    message: '',
  };
  preferenceListeners.clear();
  syncBannerListeners.clear();
}
