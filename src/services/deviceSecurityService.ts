import { User } from '../types';
import { verifyLocalDevicePin } from '../utils/crypto';
import { DB_NAME, ALL_STORE_NAMES, wipeOfflineIndexedDb } from './offline/indexedDb';
import { clearScannerOfflineQueue } from './scannerOfflineQueue';

export const PIN_FAILURE_COUNT_KEY = 'tot_pin_failed_attempts';
export const LAST_ACTIVITY_TS_KEY = 'tot_last_activity_ts';
export const MAX_PIN_FAILED_ATTEMPTS = 5;

/**
 * Liste documentée des préfixes de clés localStorage effacés lors d'une purge de sécurité.
 */
export const WIPED_LOCAL_STORAGE_PREFIXES = ['tot_', 'tqt_', 'sb-'] as const;

export interface WipeDeviceResult {
  removedLocalStorageKeys: string[];
  clearedIndexedDbName: string;
  clearedIndexedDbStores: string[];
}

/**
 * Lit le compteur local d'échecs consécutifs de PIN sur cet appareil.
 */
export function getPinFailedAttempts(storage: Pick<Storage, 'getItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null): number {
  if (!storage) return 0;
  try {
    const raw = storage.getItem(PIN_FAILURE_COUNT_KEY);
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  } catch {
    return 0;
  }
}

/**
 * Remet à zéro le compteur local d'échecs de PIN (après un succès).
 */
export function resetPinFailedAttempts(storage: Pick<Storage, 'removeItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null): void {
  if (!storage) return;
  try {
    storage.removeItem(PIN_FAILURE_COUNT_KEY);
  } catch {
    // Ignore
  }
}

/**
 * Incrémente le compteur local d'échecs de PIN et retourne la nouvelle valeur.
 */
export function incrementPinFailedAttempts(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null
): number {
  if (!storage) return 1;
  const next = getPinFailedAttempts(storage) + 1;
  try {
    storage.setItem(PIN_FAILURE_COUNT_KEY, String(next));
  } catch {
    // Ignore
  }
  return next;
}

/**
 * Déconnecte la session Supabase (si présente), efface toutes les clés localStorage
 * commençant par `tot_`, `tqt_` (ainsi que les jetons `sb-` de Supabase Auth) et
 * vide/supprime la base IndexedDB `tot_stock_offline_db`.
 */
export async function wipeDeviceLocalData(options?: {
  signOutFn?: () => Promise<unknown>;
  storage?: Storage | null;
  wipeIndexedDbFn?: () => Promise<string[]>;
  reloadFn?: () => void;
  shouldReload?: boolean;
}): Promise<WipeDeviceResult> {
  const storage =
    options?.storage !== undefined
      ? options.storage
      : typeof localStorage !== 'undefined'
      ? localStorage
      : null;

  // 1. Déconnexion Supabase Auth
  if (options?.signOutFn) {
    try {
      await options.signOutFn();
    } catch {
      // Ignore network errors during emergency sign-out
    }
  }

  // 2. Suppression de toutes les clés localStorage commençant par tot_, tqt_ (et sb-)
  const removedLocalStorageKeys: string[] = [];
  if (storage) {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (
          key &&
          WIPED_LOCAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
        ) {
          keysToRemove.push(key);
        }
      }
      for (const key of keysToRemove) {
        storage.removeItem(key);
        removedLocalStorageKeys.push(key);
      }
    } catch {
      // Ignore storage errors
    }
  }

  // 3. Effacement du stockage IndexedDB hors ligne et de la file d'attente du Mode Scanner
  try {
    await clearScannerOfflineQueue();
  } catch {
    // Ignore
  }
  const wipeIdb = options?.wipeIndexedDbFn || wipeOfflineIndexedDb;
  let clearedStores: string[] = [];
  try {
    clearedStores = await wipeIdb();
  } catch {
    clearedStores = [...ALL_STORE_NAMES];
  }

  // 4. Rechargement optionnel de l'application
  if (options?.shouldReload) {
    if (options.reloadFn) {
      options.reloadFn();
    } else if (typeof window !== 'undefined' && window.location) {
      window.location.reload();
    }
  }

  return {
    removedLocalStorageKeys,
    clearedIndexedDbName: DB_NAME,
    clearedIndexedDbStores: clearedStores.length > 0 ? clearedStores : [...ALL_STORE_NAMES],
  };
}

export interface PinVerificationLockoutResult {
  success: boolean;
  attempts: number;
  remainingAttempts: number;
  wiped: boolean;
}

/**
 * Vérifie le PIN d'un appareil avec politique de verrouillage :
 * - Succès : remet le compteur local d'échecs à zéro.
 * - Échec : incrémente le compteur ; au 5e échec consécutif, appelle `signOut` et efface le cache local.
 */
export async function verifyDevicePinWithLockout(params: {
  userId: string | number;
  pin: string;
  verifyPinFn?: (userId: string | number, pin: string) => Promise<boolean>;
  signOutFn?: () => Promise<unknown>;
  wipeFn?: () => Promise<unknown>;
  storage?: Storage | null;
}): Promise<PinVerificationLockoutResult> {
  const storage =
    params.storage !== undefined
      ? params.storage
      : typeof localStorage !== 'undefined'
      ? localStorage
      : null;
  const verifyFn = params.verifyPinFn || verifyLocalDevicePin;

  const isMatch = await verifyFn(params.userId, params.pin);
  if (isMatch) {
    resetPinFailedAttempts(storage);
    return {
      success: true,
      attempts: 0,
      remainingAttempts: MAX_PIN_FAILED_ATTEMPTS,
      wiped: false,
    };
  }

  const attempts = incrementPinFailedAttempts(storage);
  if (attempts >= MAX_PIN_FAILED_ATTEMPTS) {
    if (params.wipeFn) {
      await params.wipeFn();
    } else {
      await wipeDeviceLocalData({
        signOutFn: params.signOutFn,
        storage,
        shouldReload: false,
      });
    }
    resetPinFailedAttempts(storage);
    return {
      success: false,
      attempts,
      remainingAttempts: 0,
      wiped: true,
    };
  }

  return {
    success: false,
    attempts,
    remainingAttempts: Math.max(0, MAX_PIN_FAILED_ATTEMPTS - attempts),
    wiped: false,
  };
}

export interface ResumeSecurityCheckResult {
  action: 'none' | 'ok' | 'locked' | 'wiped';
  reason?: 'user_blocked' | 'user_deleted_or_missing' | 'inactivity_timeout';
  updatedUser?: User;
}

/**
 * Vérifie l'état de sécurité lors du retour de l'application au premier plan (`visibilitychange` / `resume`) :
 * - En ligne : relit le profil de l'utilisateur ; s'il est bloqué (`is_blocked`), supprimé ou introuvable,
 *   déconnecte la session Supabase et efface le cache local.
 * - Hors ligne : applique le verrouillage normal (si `is_blocked` en cache local -> effacement ;
 *   si le délai d'inactivité `autoLogoutMinutes` est dépassé -> verrouillage de la session).
 */
export async function verifyUserStatusOnResume(params: {
  currentUser: User | null;
  isOnline: boolean;
  isSupabaseConfigured: boolean;
  fetchRemoteProfile: (user: User) => Promise<{
    found: boolean;
    user?: User & { is_deleted?: boolean };
    networkError?: boolean;
  }>;
  signOutAndWipe: () => Promise<unknown>;
  lockSession: () => Promise<unknown> | void;
  autoLogoutMinutes?: number;
  lastActivityTimestamp?: number | null;
  now?: number;
}): Promise<ResumeSecurityCheckResult> {
  const { currentUser } = params;
  if (!currentUser) {
    return { action: 'none' };
  }

  const now = params.now ?? Date.now();
  const autoLogoutMinutes = params.autoLogoutMinutes ?? 0;
  const lastActivity = params.lastActivityTimestamp ?? now;
  const isInactivityExpired =
    autoLogoutMinutes > 0 && now - lastActivity >= autoLogoutMinutes * 60 * 1000;

  // 1. Si l'appareil est en ligne et que Supabase est configuré (hors compte Super Admin démo local id=0 sans auth_user_id)
  const isLocalDemoOnly =
    Number(currentUser.id) === 0 && !currentUser.auth_user_id;

  if (params.isOnline && params.isSupabaseConfigured && !isLocalDemoOnly) {
    try {
      const remote = await params.fetchRemoteProfile(currentUser);
      if (!remote.networkError) {
        if (!remote.found || !remote.user || remote.user.is_deleted) {
          await params.signOutAndWipe();
          return { action: 'wiped', reason: 'user_deleted_or_missing' };
        }
        if (remote.user.is_blocked) {
          await params.signOutAndWipe();
          return { action: 'wiped', reason: 'user_blocked' };
        }
        if (isInactivityExpired) {
          await params.lockSession();
          return { action: 'locked', reason: 'inactivity_timeout', updatedUser: remote.user };
        }
        return { action: 'ok', updatedUser: remote.user };
      }
    } catch {
      // En cas d'erreur réseau imprévue, basculer sur le comportement hors ligne
    }
  }

  // 2. Hors ligne (ou erreur réseau transitoire) : appliquer le verrouillage normal
  if (currentUser.is_blocked) {
    await params.signOutAndWipe();
    return { action: 'wiped', reason: 'user_blocked' };
  }

  if (isInactivityExpired) {
    await params.lockSession();
    return { action: 'locked', reason: 'inactivity_timeout' };
  }

  return { action: 'ok' };
}
