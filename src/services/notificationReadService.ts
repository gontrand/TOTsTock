export const NOTIFICATION_DISMISSALS_TABLE = 'core_notification_dismissals' as const;
export const NOTIFICATION_DISMISSALS_STORAGE_PREFIX = 'tot_notif_dismissed_v1_';
export const NOTIFICATION_DISMISSALS_PENDING_PREFIX = 'tot_notif_dismissed_pending_v1_';
export const NOTIFICATION_READS_SQL_WARNING =
  'Notifications lues non synchronisées : exécutez le script SQL 20';

const memoryDismissedByUser = new Map<string, Set<string>>();
const memoryPendingByUser = new Map<string, Set<string>>();
let notificationReadsSqlMissingFlag = false;
const listeners = new Set<(userId: string, dismissed: ReadonlySet<string>) => void>();

function normalizeUserId(userId?: string | number | null): string {
  if (userId === undefined || userId === null) return '';
  return String(userId).trim();
}

export function getDismissedStorageKey(userId?: string | number | null): string {
  const uid = normalizeUserId(userId);
  return `${NOTIFICATION_DISMISSALS_STORAGE_PREFIX}${uid || 'anon'}`;
}

export function getPendingDismissedStorageKey(userId?: string | number | null): string {
  const uid = normalizeUserId(userId);
  return `${NOTIFICATION_DISMISSALS_PENDING_PREFIX}${uid || 'anon'}`;
}

export function isNotificationReadsSqlMissing(): boolean {
  return notificationReadsSqlMissingFlag;
}

export function setNotificationReadsSqlMissing(missing: boolean): void {
  notificationReadsSqlMissingFlag = Boolean(missing);
}

function isMissingSql20Error(err: unknown): boolean {
  if (!err) return false;
  const msg = String(
    (err as any)?.message ||
      (err as any)?.details ||
      (err as any)?.hint ||
      (err as any)?.error_description ||
      err
  );
  const code = String((err as any)?.code || '');
  return (
    /function .* does not exist/i.test(msg) ||
    /could not find the function/i.test(msg) ||
    /relation .*core_notification_dismissals.* does not exist/i.test(msg) ||
    /could not find the table .*core_notification_dismissals/i.test(msg) ||
    /schema cache/i.test(msg) ||
    code === 'PGRST202' ||
    code === 'PGRST205' ||
    code === '42883' ||
    code === '42P01'
  );
}

function readSetFromLocalStorage(
  storageKey: string,
  storage: Pick<Storage, 'getItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null
): Set<string> {
  const set = new Set<string>();
  if (!storage) return set;
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return set;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const clean = String(item || '').trim();
        if (clean) set.add(clean);
      }
    }
  } catch {
    // Ignore malformed JSON
  }
  return set;
}

function writeSetToLocalStorage(
  storageKey: string,
  values: ReadonlySet<string>,
  storage: Pick<Storage, 'setItem' | 'removeItem'> | null =
    typeof localStorage !== 'undefined' ? localStorage : null
): void {
  if (!storage) return;
  try {
    const arr = Array.from(values);
    storage.setItem(storageKey, JSON.stringify(arr));
  } catch {
    // Ignore storage quota errors
  }
}

function notifyListeners(userId: string, set: ReadonlySet<string>): void {
  for (const listener of listeners) {
    try {
      listener(userId, set);
    } catch {
      // Ignore listener errors
    }
  }
}

export function subscribeNotificationDismissals(
  listener: (userId: string, dismissed: ReadonlySet<string>) => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Retourne de manière synchrone l'ensemble des clés de notifications marquées « lues »
 * pour l'utilisateur `userId` (cache mémoire + localStorage propre à cet utilisateur).
 */
export function getDismissedKeysSync(
  userId?: string | number | null,
  storage: Pick<Storage, 'getItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null
): Set<string> {
  const uid = normalizeUserId(userId);
  if (!uid) return new Set<string>();

  const storageKey = getDismissedStorageKey(uid);
  const fromStorage = readSetFromLocalStorage(storageKey, storage);
  const inMem = memoryDismissedByUser.get(uid);

  const merged = new Set<string>(fromStorage);
  if (inMem) {
    for (const k of inMem) {
      merged.add(k);
    }
  }
  memoryDismissedByUser.set(uid, merged);
  return new Set<string>(merged);
}

export interface NotificationReadServiceOptions {
  userId?: string | number | null;
  client?: any;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  existingDismissed?: ReadonlySet<string>;
}

export type NotificationReadServiceArg =
  | NotificationReadServiceOptions
  | string
  | number
  | null
  | undefined;

function resolveNotificationReadOptions(
  arg?: NotificationReadServiceArg,
  clientOverride?: any
): {
  uid: string;
  client: any;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
} {
  if (arg !== null && typeof arg === 'object') {
    const uid = normalizeUserId(arg.userId);
    const storage =
      arg.storage !== undefined
        ? arg.storage
        : typeof localStorage !== 'undefined'
          ? localStorage
          : null;
    return {
      uid,
      client: arg.client ?? clientOverride ?? null,
      storage,
    };
  }
  const uid = normalizeUserId(arg);
  const storage = typeof localStorage !== 'undefined' ? localStorage : null;
  return {
    uid,
    client: clientOverride ?? null,
    storage,
  };
}

/**
 * Charge les clés de notifications « lues » de l'utilisateur courant depuis `core_notification_dismissals`
 * (la RLS ne renvoie que les lignes de l'utilisateur authentifié), fusionne avec le cache local hors-ligne
 * et met à jour `localStorage['tot_notif_dismissed_v1_<userId>']`.
 * Si le script SQL 20 n'est pas installé, retombe silencieusement sur `localStorage` seul.
 */
export async function loadMyDismissedKeys(
  options: NotificationReadServiceArg = {},
  clientOverride?: any
): Promise<Set<string>> {
  const { uid, client, storage } = resolveNotificationReadOptions(options, clientOverride);

  if (!uid) return new Set<string>();

  const storageKey = getDismissedStorageKey(uid);
  const localSet = getDismissedKeysSync(uid, storage);

  if (!client || typeof client.from !== 'function') {
    return localSet;
  }

  // Synchroniser d'abord d'éventuelles lectures faites hors-ligne
  await flushPendingOfflineDismissals({ userId: uid, client, storage });

  try {
    const query = client.from(NOTIFICATION_DISMISSALS_TABLE).select('notif_key');
    const { data, error } =
      query && typeof query.limit === 'function' ? await query.limit(2000) : await query;

    if (error) {
      if (isMissingSql20Error(error)) {
        notificationReadsSqlMissingFlag = true;
      }
      return localSet;
    }

    notificationReadsSqlMissingFlag = false;
    const merged = new Set<string>(localSet);
    if (Array.isArray(data)) {
      for (const row of data) {
        const key = String((row as any)?.notif_key ?? (row as any)?.key ?? '').trim();
        if (key) {
          merged.add(key);
        }
      }
    }

    memoryDismissedByUser.set(uid, merged);
    writeSetToLocalStorage(storageKey, merged, storage);
    notifyListeners(uid, merged);
    return new Set<string>(merged);
  } catch (err) {
    if (isMissingSql20Error(err)) {
      notificationReadsSqlMissingFlag = true;
    }
    return localSet;
  }
}

/**
 * Marque une ou plusieurs clés de notifications comme « lues » pour l'utilisateur courant
 * via la RPC `dismiss_notifications(text[])` et dans `localStorage['tot_notif_dismissed_v1_<userId>']`.
 * - N'effectue AUCUN appel RPC si toutes les clés fournies sont déjà marquées comme lues.
 * - Retombe silencieusement sur `localStorage` si la RPC n'existe pas (script SQL 20 non installé).
 */
export async function dismissNotifications(
  keys: string[],
  options: NotificationReadServiceArg = {},
  clientOverride?: any
): Promise<Set<string>> {
  const { uid, client, storage } = resolveNotificationReadOptions(options, clientOverride);

  if (!uid) return new Set<string>();

  const cleanKeys = Array.from(
    new Set(
      (Array.isArray(keys) ? keys : [])
        .map((k) => String(k || '').trim())
        .filter((k) => k.length > 0)
    )
  );

  const currentSet = getDismissedKeysSync(uid, storage);
  const newKeys = cleanKeys.filter((k) => !currentSet.has(k));

  // Règle stricte : aucun appel RPC pour une clé déjà lue
  if (newKeys.length === 0) {
    return currentSet;
  }

  for (const k of newKeys) {
    currentSet.add(k);
  }

  const storageKey = getDismissedStorageKey(uid);
  memoryDismissedByUser.set(uid, currentSet);
  writeSetToLocalStorage(storageKey, currentSet, storage);
  notifyListeners(uid, currentSet);

  if (!client || typeof client.rpc !== 'function') {
    enqueuePendingOfflineDismissals(uid, newKeys, storage);
    return new Set<string>(currentSet);
  }

  try {
    const { error } = await client.rpc('dismiss_notifications', { p_keys: newKeys });
    if (error) {
      if (isMissingSql20Error(error)) {
        notificationReadsSqlMissingFlag = true;
        return new Set<string>(currentSet);
      }
      enqueuePendingOfflineDismissals(uid, newKeys, storage);
      return new Set<string>(currentSet);
    }
    notificationReadsSqlMissingFlag = false;
  } catch (err) {
    if (isMissingSql20Error(err)) {
      notificationReadsSqlMissingFlag = true;
    } else {
      enqueuePendingOfflineDismissals(uid, newKeys, storage);
    }
  }

  return new Set<string>(currentSet);
}

/**
 * Réinitialise uniquement la cloche de l'utilisateur courant via la RPC `clear_my_dismissals()`
 * et vide `localStorage['tot_notif_dismissed_v1_<userId>']`.
 * N'affecte jamais les notifications d'un autre utilisateur.
 */
export async function clearMyDismissals(
  options: NotificationReadServiceArg = {},
  clientOverride?: any
): Promise<Set<string>> {
  const { uid, client, storage } = resolveNotificationReadOptions(options, clientOverride);

  if (!uid) return new Set<string>();

  const emptySet = new Set<string>();
  memoryDismissedByUser.set(uid, emptySet);
  memoryPendingByUser.delete(uid);

  const storageKey = getDismissedStorageKey(uid);
  const pendingKey = getPendingDismissedStorageKey(uid);
  writeSetToLocalStorage(storageKey, emptySet, storage);
  if (storage && typeof storage.removeItem === 'function') {
    try {
      storage.removeItem(pendingKey);
    } catch {
      // Ignore
    }
  }
  notifyListeners(uid, emptySet);

  if (!client || typeof client.rpc !== 'function') {
    return emptySet;
  }

  try {
    const { error } = await client.rpc('clear_my_dismissals');
    if (error) {
      if (isMissingSql20Error(error)) {
        notificationReadsSqlMissingFlag = true;
      }
      return emptySet;
    }
    notificationReadsSqlMissingFlag = false;
  } catch (err) {
    if (isMissingSql20Error(err)) {
      notificationReadsSqlMissingFlag = true;
    }
  }

  return emptySet;
}

function enqueuePendingOfflineDismissals(
  uid: string,
  keys: string[],
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
): void {
  if (!uid || keys.length === 0) return;
  const pendingKey = getPendingDismissedStorageKey(uid);
  const existing = readSetFromLocalStorage(pendingKey, storage);
  const inMem = memoryPendingByUser.get(uid) || new Set<string>();
  for (const k of existing) inMem.add(k);
  for (const k of keys) inMem.add(k);
  memoryPendingByUser.set(uid, inMem);
  writeSetToLocalStorage(pendingKey, inMem, storage);
}

export async function flushPendingOfflineDismissals(
  options: NotificationReadServiceArg = {},
  clientOverride?: any
): Promise<void> {
  const { uid, client, storage } = resolveNotificationReadOptions(options, clientOverride);

  if (!uid || !client || typeof client.rpc !== 'function') return;

  const pendingKey = getPendingDismissedStorageKey(uid);
  const pendingSet = readSetFromLocalStorage(pendingKey, storage);
  const inMem = memoryPendingByUser.get(uid);
  if (inMem) {
    for (const k of inMem) pendingSet.add(k);
  }
  if (pendingSet.size === 0) return;

  const keysToSync = Array.from(pendingSet);
  try {
    const { error } = await client.rpc('dismiss_notifications', { p_keys: keysToSync });
    if (!error) {
      notificationReadsSqlMissingFlag = false;
      memoryPendingByUser.delete(uid);
      if (storage && typeof storage.removeItem === 'function') {
        storage.removeItem(pendingKey);
      } else {
        writeSetToLocalStorage(pendingKey, new Set<string>(), storage);
      }
    } else if (isMissingSql20Error(error)) {
      notificationReadsSqlMissingFlag = true;
    }
  } catch (err) {
    if (isMissingSql20Error(err)) {
      notificationReadsSqlMissingFlag = true;
    }
  }
}

export function resetNotificationReadMemoryCacheForTests(): void {
  memoryDismissedByUser.clear();
  memoryPendingByUser.clear();
  notificationReadsSqlMissingFlag = false;
}

export const __resetNotificationReadServiceForTests = resetNotificationReadMemoryCacheForTests;
