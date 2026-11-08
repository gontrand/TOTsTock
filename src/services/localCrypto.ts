import {
  clearDesktopSafeStorageKey,
  getOrCreateDesktopSafeStorageKey,
  isDesktopApp,
} from './desktopBridge';

/**
 * Enveloppe JSON normalisée pour chaque valeur chiffrée (AES-GCM 256 bits, IV 12 octets).
 */
export interface EncryptedEnvelopeV1 {
  v: 1;
  iv: string; // base64 (12 octets)
  ct: string; // base64 (ciphertext + tag d'authentification GCM 128 bits)
}

export type CryptoProviderMode = 'none' | 'pin' | 'native';

export interface LocalCryptoMeta {
  v: 1;
  enabled: boolean;
  mode: CryptoProviderMode;
  saltHex?: string; // Sel PBKDF2 aléatoire (distinct du sel de vérification du PIN)
  iterations?: number; // >= 600_000
  canary?: string; // Enveloppe chiffrée de vérification de clé
  migrationState: 'idle' | 'encrypting' | 'decrypting' | 'complete';
  updatedAt: string;
}

export interface KeyProvider {
  readonly mode: CryptoProviderMode;
  isAvailable(): boolean;
  getKey(): Promise<CryptoKey | null>;
  clearKey(): Promise<void>;
}

interface TotNativeKeystoreBridge {
  getOrCreateKeyBase64?: () => string;
  clearKey?: () => boolean;
}

declare global {
  interface Window {
    TotNativeKeystore?: TotNativeKeystoreBridge;
  }
}

export const CRYPTO_META_STORAGE_KEY = 'tot_crypto_meta';
export const PBKDF2_MIN_ITERATIONS = 600_000;
const CANARY_PLAINTEXT = 'tot_stock_crypto_canary_v1_ok';
const MIGRATION_ENC_SUFFIX = '.__mig_enc__';
const MIGRATION_PLAIN_SUFFIX = '.__mig_plain__';

/**
 * Clés `localStorage` sensibles soumises au chiffrement local (LOT 2.3).
 */
export const ENCRYPTED_LOCAL_STORAGE_EXACT_KEYS: readonly string[] = [
  'tot_inv_current_user',
  'tqt_company_key',
  'tot_inv_supabase_key',
  'tqt_company_url',
  'tot_inv_supabase_url',
  'tot_scanner_offline_queue_v1',
  'tot_inv_movements',
];

export const ENCRYPTED_LOCAL_STORAGE_PREFIXES: readonly string[] = [
  'sb-',
  'tot_inventory_audit_',
];

/**
 * Clés de catalogue et de préférences d'interface qui restent toujours en clair (LOT 2.3).
 */
export const PLAINTEXT_CATALOG_AND_PREFS_KEYS: ReadonlySet<string> = new Set([
  'tot_inv_products',
  'tot_inv_depots',
  'tot_inv_departments',
  'tot_inv_projects',
  'tot_inv_subcategories',
  'tot_inv_roles',
  'tot_inv_stock_levels',
  'tot_stock_haptics_enabled',
  'tot_stock_haptics_intensity',
  'tot_stock_sound_enabled',
  'tot_scanner_sound_enabled',
  'tot_scanner_vibration_enabled',
  'tot_inv_auto_logout_minutes',
  'tqt_language',
  'tot_inv_theme',
  'tot_desktop_sidebar_collapsed_v1',
  'tot_desktop_inventory_columns_v1',
  'tot_desktop_inventory_density_v1',
  'tot_print_station_sound_enabled',
  'tot_print_station_blink_enabled',
  'tot_print_station_id',
  'tot_print_station_name',
  'tot_print_station_depot',
  'tot_print_station_auto_mode',
  CRYPTO_META_STORAGE_KEY,
]);

let inMemoryCryptoKey: CryptoKey | null = null;
let inMemoryMode: CryptoProviderMode = 'none';
let decryptionFailureDetected = false;
const decryptedMemoryMirror = new Map<string, string>();

export function isSensitiveEncryptedStorageKey(key: string): boolean {
  if (!key) return false;
  if (key.endsWith(MIGRATION_ENC_SUFFIX) || key.endsWith(MIGRATION_PLAIN_SUFFIX)) {
    return false;
  }
  if (PLAINTEXT_CATALOG_AND_PREFS_KEYS.has(key)) {
    return false;
  }
  if (key.startsWith('tot_local_device_pin_')) {
    return false;
  }
  if (ENCRYPTED_LOCAL_STORAGE_EXACT_KEYS.includes(key)) {
    return true;
  }
  return ENCRYPTED_LOCAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0) {
    throw new Error('Hex invalide');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return out;
}

export function isEncryptedEnvelopeObject(val: unknown): val is EncryptedEnvelopeV1 {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
  const obj = val as Record<string, unknown>;
  return (
    obj.v === 1 &&
    typeof obj.iv === 'string' &&
    obj.iv.length >= 12 &&
    typeof obj.ct === 'string' &&
    obj.ct.length >= 16
  );
}

export function isEncryptedEnvelopeString(raw: string | null | undefined): boolean {
  if (!raw || typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return isEncryptedEnvelopeObject(parsed);
  } catch {
    return false;
  }
}

/**
 * Chiffre une chaîne UTF-8 avec AES-GCM 256 et un IV aléatoire de 12 octets.
 * Retourne l'enveloppe JSON `{"v":1,"iv":"...","ct":"..."}`.
 */
export async function encryptStringWithKey(
  plaintext: string,
  key: CryptoKey
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    encoded as BufferSource
  );
  const envelope: EncryptedEnvelopeV1 = {
    v: 1,
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(cipherBuffer)),
  };
  return JSON.stringify(envelope);
}

/**
 * Déchiffre une enveloppe JSON `{"v":1,"iv":"...","ct":"..."}` avec AES-GCM 256.
 */
export async function decryptStringWithKey(
  envelopeJson: string,
  key: CryptoKey
): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelopeJson);
  } catch {
    throw new Error('Enveloppe chiffrée JSON invalide.');
  }
  if (!isEncryptedEnvelopeObject(parsed)) {
    throw new Error('Format d’enveloppe chiffrée non reconnu.');
  }
  const iv = base64ToBytes(parsed.iv);
  if (iv.byteLength !== 12) {
    throw new Error('IV AES-GCM invalide (12 octets requis).');
  }
  const ct = base64ToBytes(parsed.ct);
  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ct as BufferSource
  );
  return new TextDecoder().decode(plainBuffer);
}

/**
 * Dérive une `CryptoKey` AES-GCM 256 non extractible (`extractable: false`)
 * depuis un code PIN utilisateur via PBKDF2-SHA256 (>= 600 000 itérations).
 */
export async function derivePinCryptoKey(
  pin: string,
  saltHex: string,
  iterations: number = PBKDF2_MIN_ITERATIONS
): Promise<CryptoKey> {
  const actualIterations = Math.max(PBKDF2_MIN_ITERATIONS, Number(iterations) || PBKDF2_MIN_ITERATIONS);
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin.trim()),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  const saltBytes = hexToBytes(saltHex);
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes as BufferSource,
      iterations: actualIterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false, // Non extractible
    ['encrypt', 'decrypt']
  );
}

/**
 * Importe une clé brute de 32 octets (base64) issue du trousseau natif (Electron safeStorage / Android Keystore)
 * sous forme de `CryptoKey` AES-GCM 256 non extractible.
 */
export async function importNativeRawKeyBase64(keyBase64: string): Promise<CryptoKey> {
  const rawBytes = base64ToBytes(keyBase64.trim());
  if (rawBytes.byteLength !== 32) {
    throw new Error('Clé native invalide (256 bits / 32 octets requis).');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    rawBytes as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false, // Non extractible
    ['encrypt', 'decrypt']
  );
  rawBytes.fill(0);
  return key;
}

/**
 * Fournisseur de clé natif (Android Keystore `TotNativeKeystore` ou Desktop Electron `safeStorage`).
 */
export class NativeKeyProvider implements KeyProvider {
  readonly mode: CryptoProviderMode = 'native';

  isAvailable(): boolean {
    if (isDesktopApp()) return true;
    if (
      typeof window !== 'undefined' &&
      window.TotNativeKeystore &&
      typeof window.TotNativeKeystore.getOrCreateKeyBase64 === 'function'
    ) {
      return true;
    }
    return false;
  }

  async getKey(): Promise<CryptoKey | null> {
    try {
      if (isDesktopApp()) {
        const keyB64 = await getOrCreateDesktopSafeStorageKey();
        if (keyB64) {
          return await importNativeRawKeyBase64(keyB64);
        }
      }
      if (
        typeof window !== 'undefined' &&
        window.TotNativeKeystore &&
        typeof window.TotNativeKeystore.getOrCreateKeyBase64 === 'function'
      ) {
        const keyB64 = window.TotNativeKeystore.getOrCreateKeyBase64();
        if (keyB64) {
          return await importNativeRawKeyBase64(keyB64);
        }
      }
    } catch {
      // Ne jamais journaliser la clé
    }
    return null;
  }

  async clearKey(): Promise<void> {
    try {
      if (isDesktopApp()) {
        await clearDesktopSafeStorageKey();
      }
      if (
        typeof window !== 'undefined' &&
        window.TotNativeKeystore &&
        typeof window.TotNativeKeystore.clearKey === 'function'
      ) {
        window.TotNativeKeystore.clearKey();
      }
    } catch {}
  }
}

/**
 * Fournisseur de clé dérivée du PIN (PWA / Navigateur).
 */
export class PinKeyProvider implements KeyProvider {
  readonly mode: CryptoProviderMode = 'pin';
  private pinResolver: (() => string | null) | null;

  constructor(pinResolver?: () => string | null) {
    this.pinResolver = pinResolver || null;
  }

  isAvailable(): boolean {
    const meta = readLocalCryptoMeta();
    return Boolean(meta?.enabled && meta.mode === 'pin' && meta.saltHex);
  }

  async getKey(): Promise<CryptoKey | null> {
    if (inMemoryCryptoKey && inMemoryMode === 'pin') {
      return inMemoryCryptoKey;
    }
    const meta = readLocalCryptoMeta();
    if (!meta?.enabled || meta.mode !== 'pin' || !meta.saltHex) {
      return null;
    }
    const pin = this.pinResolver?.();
    if (!pin) return null;
    return derivePinCryptoKey(pin, meta.saltHex, meta.iterations || PBKDF2_MIN_ITERATIONS);
  }

  async clearKey(): Promise<void> {
    inMemoryCryptoKey = null;
    if (inMemoryMode === 'pin') {
      inMemoryMode = 'none';
    }
  }
}

export function readLocalCryptoMeta(): LocalCryptoMeta | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(CRYPTO_META_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.v !== 1) return null;
    return parsed as LocalCryptoMeta;
  } catch {
    return null;
  }
}

export function writeLocalCryptoMeta(meta: LocalCryptoMeta): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CRYPTO_META_STORAGE_KEY, JSON.stringify(meta));
  } catch {
    // Ignore
  }
}

export function isLocalEncryptionEnabled(): boolean {
  const meta = readLocalCryptoMeta();
  return Boolean(meta?.enabled && (meta.mode === 'pin' || meta.mode === 'native'));
}

export function getLocalEncryptionMode(): CryptoProviderMode {
  const meta = readLocalCryptoMeta();
  if (!meta?.enabled) return 'none';
  return meta.mode;
}

export function getActiveCryptoKey(): CryptoKey | null {
  return inMemoryCryptoKey;
}

export function isLocalCryptoLocked(): boolean {
  const meta = readLocalCryptoMeta();
  if (!meta?.enabled) return false;
  return inMemoryCryptoKey === null;
}

export function hasDecryptionFailureOccurred(): boolean {
  return decryptionFailureDetected;
}

export function clearDecryptionFailureFlag(): void {
  decryptionFailureDetected = false;
}

/**
 * Efface la `CryptoKey` de la mémoire vive lors du verrouillage d'inactivité (LOT 2.3).
 * Les données dans `localStorage` et `IndexedDB` restent chiffrées sur disque.
 */
export function clearCryptoKeyFromMemory(): void {
  inMemoryCryptoKey = null;
  decryptedMemoryMirror.clear();
}

/**
 * Définit explicitement la clé active en mémoire (utilisé par les fournisseurs de clé et les tests).
 */
export function setActiveCryptoKeyInMemory(
  key: CryptoKey | null,
  mode: CryptoProviderMode = 'pin'
): void {
  inMemoryCryptoKey = key;
  inMemoryMode = key ? mode : 'none';
  if (!key) {
    decryptedMemoryMirror.clear();
  }
}

function collectSensitiveKeysInStorage(storage: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && isSensitiveEncryptedStorageKey(k)) {
      keys.push(k);
    }
  }
  return keys;
}

/**
 * Migration atomique sûre d'une clé `localStorage` du clair vers le chiffré :
 * 1. Écrit la copie chiffrée dans `${key}.__mig_enc__`
 * 2. Relit et déchiffre pour vérifier l'intégrité exacte
 * 3. Remplace l'original en clair par l'enveloppe chiffrée et supprime `${key}.__mig_enc__`
 */
export async function migrateSingleKeyPlainToEncrypted(
  storageKey: string,
  key: CryptoKey,
  storage: Storage = localStorage
): Promise<boolean> {
  const stagingKey = `${storageKey}${MIGRATION_ENC_SUFFIX}`;
  const rawVal = storage.getItem(storageKey);

  // Reprise après interruption : si la clé de staging existe déjà et est valide
  const stagedVal = storage.getItem(stagingKey);
  if (stagedVal && isEncryptedEnvelopeString(stagedVal)) {
    try {
      const verifiedPlain = await decryptStringWithKey(stagedVal, key);
      storage.setItem(storageKey, stagedVal);
      storage.removeItem(stagingKey);
      decryptedMemoryMirror.set(storageKey, verifiedPlain);
      return true;
    } catch {
      storage.removeItem(stagingKey);
    }
  }

  if (rawVal === null) return true;

  // Déjà chiffré : vérifier que la clé courante peut le déchiffrer
  if (isEncryptedEnvelopeString(rawVal)) {
    const plain = await decryptStringWithKey(rawVal, key);
    decryptedMemoryMirror.set(storageKey, plain);
    return true;
  }

  const encryptedEnvelope = await encryptStringWithKey(rawVal, key);
  storage.setItem(stagingKey, encryptedEnvelope);

  const readBackEnvelope = storage.getItem(stagingKey);
  if (!readBackEnvelope) {
    throw new Error(`Échec d'écriture de la copie chiffrée pour ${storageKey}`);
  }

  const verifiedPlain = await decryptStringWithKey(readBackEnvelope, key);
  if (verifiedPlain !== rawVal) {
    storage.removeItem(stagingKey);
    throw new Error(`Échec de vérification après chiffrement pour ${storageKey}`);
  }

  storage.setItem(storageKey, readBackEnvelope);
  storage.removeItem(stagingKey);
  decryptedMemoryMirror.set(storageKey, rawVal);
  return true;
}

/**
 * Migration atomique sûre d'une clé `localStorage` du chiffré vers le clair :
 * 1. Déchiffre l'enveloppe et écrit le clair dans `${key}.__mig_plain__`
 * 2. Relit `${key}.__mig_plain__` pour vérifier qu'elle est identique au texte déchiffré
 * 3. Remplace l'enveloppe chiffrée par le texte clair et supprime `${key}.__mig_plain__`
 */
export async function migrateSingleKeyEncryptedToPlain(
  storageKey: string,
  key: CryptoKey,
  storage: Storage = localStorage
): Promise<boolean> {
  const stagingKey = `${storageKey}${MIGRATION_PLAIN_SUFFIX}`;
  const stagedPlain = storage.getItem(stagingKey);
  const rawVal = storage.getItem(storageKey);

  if (stagedPlain !== null && !isEncryptedEnvelopeString(stagedPlain)) {
    storage.setItem(storageKey, stagedPlain);
    storage.removeItem(stagingKey);
    decryptedMemoryMirror.set(storageKey, stagedPlain);
    return true;
  }

  if (rawVal === null) return true;

  if (!isEncryptedEnvelopeString(rawVal)) {
    decryptedMemoryMirror.set(storageKey, rawVal);
    return true;
  }

  const decryptedPlain = await decryptStringWithKey(rawVal, key);
  storage.setItem(stagingKey, decryptedPlain);

  const readBackPlain = storage.getItem(stagingKey);
  if (readBackPlain !== decryptedPlain) {
    storage.removeItem(stagingKey);
    throw new Error(`Échec de vérification après déchiffrement pour ${storageKey}`);
  }

  storage.setItem(storageKey, readBackPlain);
  storage.removeItem(stagingKey);
  decryptedMemoryMirror.set(storageKey, readBackPlain);
  return true;
}

/**
 * Migre toutes les clés sensibles de `localStorage` vers le format chiffré AES-GCM 256.
 */
export async function migrateAllSensitiveLocalStorageToEncrypted(
  key: CryptoKey,
  storage: Storage = localStorage
): Promise<void> {
  const keys = collectSensitiveKeysInStorage(storage);
  for (const k of keys) {
    await migrateSingleKeyPlainToEncrypted(k, key, storage);
  }
}

/**
 * Déchiffre de manière atomique toutes les clés sensibles de `localStorage` vers le texte clair.
 */
export async function migrateAllSensitiveLocalStorageToPlaintext(
  key: CryptoKey,
  storage: Storage = localStorage
): Promise<void> {
  const keys = collectSensitiveKeysInStorage(storage);
  for (const k of keys) {
    await migrateSingleKeyEncryptedToPlain(k, key, storage);
  }
}

/**
 * Reprend une migration interrompue (`migrationState === 'encrypting'` ou `'decrypting'`
 * ou fichiers temporaires `.__mig_enc__` / `.__mig_plain__`) dès que la clé est disponible.
 */
export async function resumeInterruptedCryptoMigration(
  key: CryptoKey,
  storage: Storage = localStorage
): Promise<void> {
  const meta = readLocalCryptoMeta();

  // Rechercher d'éventuelles clés temporaires .__mig_enc__ ou .__mig_plain__
  const allKeys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k) allKeys.push(k);
  }

  for (const k of allKeys) {
    if (k.endsWith(MIGRATION_ENC_SUFFIX)) {
      const baseKey = k.slice(0, -MIGRATION_ENC_SUFFIX.length);
      await migrateSingleKeyPlainToEncrypted(baseKey, key, storage);
    } else if (k.endsWith(MIGRATION_PLAIN_SUFFIX)) {
      const baseKey = k.slice(0, -MIGRATION_PLAIN_SUFFIX.length);
      await migrateSingleKeyEncryptedToPlain(baseKey, key, storage);
    }
  }

  if (meta?.migrationState === 'encrypting' || meta?.enabled) {
    await migrateAllSensitiveLocalStorageToEncrypted(key, storage);
    if (meta) {
      writeLocalCryptoMeta({
        ...meta,
        migrationState: 'complete',
        updatedAt: new Date().toISOString(),
      });
    }
  } else if (meta?.migrationState === 'decrypting') {
    await migrateAllSensitiveLocalStorageToPlaintext(key, storage);
    if (meta) {
      writeLocalCryptoMeta({
        ...meta,
        enabled: false,
        mode: 'none',
        migrationState: 'idle',
        updatedAt: new Date().toISOString(),
      });
    }
  }
}

/**
 * Active le chiffrement local par PIN (PWA / navigateur) :
 * - Génère un sel aléatoire de 16 octets distinct du sel de vérification du PIN
 * - Dérive une `CryptoKey` PBKDF2-SHA256 (>= 600 000 itérations) non extractible
 * - Migre de manière atomique toutes les données sensibles locales
 */
export async function enablePinLocalEncryption(
  pin: string,
  options?: { iterations?: number; storage?: Storage }
): Promise<{ ok: boolean; error?: string }> {
  const cleanPin = String(pin || '').trim();
  if (!/^\d{4,8}$/.test(cleanPin)) {
    return { ok: false, error: 'Un code PIN de 4 à 8 chiffres est requis.' };
  }

  const storage = options?.storage || localStorage;
  const iterations = Math.max(
    PBKDF2_MIN_ITERATIONS,
    options?.iterations ?? PBKDF2_MIN_ITERATIONS
  );

  try {
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const saltHex = bytesToHex(saltBytes);
    const key = await derivePinCryptoKey(cleanPin, saltHex, iterations);
    const canary = await encryptStringWithKey(CANARY_PLAINTEXT, key);

    writeLocalCryptoMeta({
      v: 1,
      enabled: true,
      mode: 'pin',
      saltHex,
      iterations,
      canary,
      migrationState: 'encrypting',
      updatedAt: new Date().toISOString(),
    });

    setActiveCryptoKeyInMemory(key, 'pin');
    await migrateAllSensitiveLocalStorageToEncrypted(key, storage);

    writeLocalCryptoMeta({
      v: 1,
      enabled: true,
      mode: 'pin',
      saltHex,
      iterations,
      canary,
      migrationState: 'complete',
      updatedAt: new Date().toISOString(),
    });

    decryptionFailureDetected = false;
    return { ok: true };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Impossible d’activer le chiffrement local.',
    };
  }
}

/**
 * Déverrouille le cache local chiffré par PIN et reprend toute migration interrompue.
 * En cas de mauvais PIN, ne supprime AUCUNE donnée et signale l'échec de déchiffrement.
 */
export async function unlockPinLocalEncryption(
  pin: string,
  storage: Storage = localStorage
): Promise<{ ok: boolean; error?: string }> {
  const meta = readLocalCryptoMeta();
  if (!meta?.enabled || meta.mode !== 'pin' || !meta.saltHex) {
    return { ok: true };
  }

  try {
    const key = await derivePinCryptoKey(
      String(pin || '').trim(),
      meta.saltHex,
      meta.iterations || PBKDF2_MIN_ITERATIONS
    );

    if (meta.canary) {
      const check = await decryptStringWithKey(meta.canary, key);
      if (check !== CANARY_PLAINTEXT) {
        decryptionFailureDetected = true;
        return { ok: false, error: 'Code PIN incorrect pour déchiffrer les données locales.' };
      }
    }

    setActiveCryptoKeyInMemory(key, 'pin');
    await resumeInterruptedCryptoMigration(key, storage);

    // Hydrater le miroir mémoire pour les lectures synchrones
    const keys = collectSensitiveKeysInStorage(storage);
    for (const k of keys) {
      const raw = storage.getItem(k);
      if (raw && isEncryptedEnvelopeString(raw)) {
        const plain = await decryptStringWithKey(raw, key);
        decryptedMemoryMirror.set(k, plain);
      } else if (raw !== null) {
        decryptedMemoryMirror.set(k, raw);
      }
    }

    decryptionFailureDetected = false;
    return { ok: true };
  } catch {
    decryptionFailureDetected = true;
    return {
      ok: false,
      error: 'Impossible de déchiffrer le cache local avec ce code PIN.',
    };
  }
}

/**
 * Désactive le chiffrement local par PIN en déchiffrant atomiquement toutes les données.
 */
export async function disablePinLocalEncryption(
  pin?: string,
  storage: Storage = localStorage
): Promise<{ ok: boolean; error?: string }> {
  const meta = readLocalCryptoMeta();
  if (!meta?.enabled) {
    return { ok: true };
  }

  let key: CryptoKey | null = null;
  if (pin && meta.saltHex) {
    try {
      const derived = await derivePinCryptoKey(
        pin.trim(),
        meta.saltHex,
        meta.iterations || PBKDF2_MIN_ITERATIONS
      );
      if (meta.canary) {
        const check = await decryptStringWithKey(meta.canary, derived);
        if (check !== CANARY_PLAINTEXT) {
          return { ok: false, error: 'Code PIN invalide pour désactiver le chiffrement.' };
        }
      }
      key = derived;
    } catch {
      return { ok: false, error: 'Code PIN invalide pour désactiver le chiffrement.' };
    }
  } else {
    key = inMemoryCryptoKey;
  }

  if (!key) {
    return {
      ok: false,
      error: 'Veuillez saisir votre code PIN pour déchiffrer les données avant désactivation.',
    };
  }

  try {
    writeLocalCryptoMeta({
      ...meta,
      migrationState: 'decrypting',
      updatedAt: new Date().toISOString(),
    });

    await migrateAllSensitiveLocalStorageToPlaintext(key, storage);

    writeLocalCryptoMeta({
      v: 1,
      enabled: false,
      mode: 'none',
      migrationState: 'idle',
      updatedAt: new Date().toISOString(),
    });

    clearCryptoKeyFromMemory();
    decryptionFailureDetected = false;
    return { ok: true };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Erreur lors du déchiffrement atomique des données locales.',
    };
  }
}

/**
 * Initialise automatiquement le chiffrement natif (Electron `safeStorage` / Android Keystore)
 * au démarrage si disponible, sans rien demander à l'utilisateur.
 */
export async function initNativeLocalCryptoIfAvailable(
  storage: Storage = typeof localStorage !== 'undefined' ? localStorage : ({} as Storage)
): Promise<boolean> {
  const provider = new NativeKeyProvider();
  if (!provider.isAvailable()) {
    return false;
  }

  try {
    const key = await provider.getKey();
    if (!key) return false;

    const canary = await encryptStringWithKey(CANARY_PLAINTEXT, key);
    const existingMeta = readLocalCryptoMeta();
    setActiveCryptoKeyInMemory(key, 'native');

    if (!existingMeta?.enabled || existingMeta.mode !== 'native') {
      writeLocalCryptoMeta({
        v: 1,
        enabled: true,
        mode: 'native',
        canary,
        migrationState: 'encrypting',
        updatedAt: new Date().toISOString(),
      });
    }

    await resumeInterruptedCryptoMigration(key, storage);

    const keys = collectSensitiveKeysInStorage(storage);
    for (const k of keys) {
      const raw = storage.getItem(k);
      if (raw && isEncryptedEnvelopeString(raw)) {
        const plain = await decryptStringWithKey(raw, key);
        decryptedMemoryMirror.set(k, plain);
      }
    }

    writeLocalCryptoMeta({
      v: 1,
      enabled: true,
      mode: 'native',
      canary,
      migrationState: 'complete',
      updatedAt: new Date().toISOString(),
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * Lit une clé sensible depuis `localStorage` (synchrone via le miroir mémoire déchiffré,
 * ou directement si non chiffrée). Ne retourne jamais l'enveloppe chiffrée brute comme valeur métier.
 */
export function readSensitiveLocalStorageSync(
  storageKey: string,
  storage: Storage = localStorage
): string | null {
  try {
    if (decryptedMemoryMirror.has(storageKey)) {
      return decryptedMemoryMirror.get(storageKey)!;
    }
    const raw = storage.getItem(storageKey);
    if (raw === null) return null;
    if (isEncryptedEnvelopeString(raw)) {
      // Cache chiffré mais clé non encore déverrouillée en mémoire
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

/**
 * Lecture synchrone sûre d'une clé sensible (URL / clé anon Supabase).
 * Retourne la valeur en clair, ou '' si la valeur est encore chiffrée et non déverrouillée.
 * Ne retourne JAMAIS l'enveloppe chiffrée {"v":1,"iv":...,"ct":...}.
 */
export function safeGetSensitiveItem(storageKey: string, storage?: Storage): string {
  try {
    const st = storage || (typeof localStorage !== 'undefined' ? localStorage : undefined);
    if (!st) return '';
    const v = readSensitiveLocalStorageSync(storageKey, st);
    if (v) return v;
    const raw = st.getItem(storageKey);
    if (!raw || isEncryptedEnvelopeString(raw)) return '';
    // Valeur corrompue par une ancienne normalisation (ex. "https://{\"v\":1,\"iv\":...}")
    if (/[{}]/.test(raw) && raw.includes('"iv"')) return '';
    return raw;
  } catch {
    return '';
  }
}

/**
 * Lit et déchiffre de manière asynchrone une clé sensible depuis `localStorage`.
 */
export async function readSensitiveLocalStorageAsync(
  storageKey: string,
  storage: Storage = localStorage
): Promise<string | null> {
  try {
    const raw = storage.getItem(storageKey);
    if (raw === null) {
      decryptedMemoryMirror.delete(storageKey);
      return null;
    }
    if (!isEncryptedEnvelopeString(raw)) {
      if (isSensitiveEncryptedStorageKey(storageKey) && inMemoryCryptoKey && isLocalEncryptionEnabled()) {
        await migrateSingleKeyPlainToEncrypted(storageKey, inMemoryCryptoKey, storage);
      } else {
        decryptedMemoryMirror.set(storageKey, raw);
      }
      return raw;
    }
    if (!inMemoryCryptoKey) {
      return null;
    }
    try {
      const plain = await decryptStringWithKey(raw, inMemoryCryptoKey);
      decryptedMemoryMirror.set(storageKey, plain);
      return plain;
    } catch {
      decryptionFailureDetected = true;
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Écrit une clé sensible dans `localStorage`. Si le chiffrement est actif et la clé présente
 * en mémoire, écrit l'enveloppe AES-GCM 256 et met à jour le miroir mémoire.
 */
export async function writeSensitiveLocalStorageAsync(
  storageKey: string,
  plaintextValue: string,
  storage: Storage = localStorage
): Promise<void> {
  decryptedMemoryMirror.set(storageKey, plaintextValue);
  if (
    isSensitiveEncryptedStorageKey(storageKey) &&
    isLocalEncryptionEnabled() &&
    inMemoryCryptoKey
  ) {
    const encrypted = await encryptStringWithKey(plaintextValue, inMemoryCryptoKey);
    storage.setItem(storageKey, encrypted);
    return;
  }
  storage.setItem(storageKey, plaintextValue);
}

/**
 * Écriture synchrone avec chiffrement asynchrone immédiat en arrière-plan
 * (pour les appels synchrones existants de l'application).
 */
export function writeSensitiveLocalStorageSync(
  storageKey: string,
  plaintextValue: string,
  storage: Storage = localStorage
): void {
  decryptedMemoryMirror.set(storageKey, plaintextValue);
  if (
    isSensitiveEncryptedStorageKey(storageKey) &&
    isLocalEncryptionEnabled() &&
    inMemoryCryptoKey
  ) {
    const activeKey = inMemoryCryptoKey;
    void encryptStringWithKey(plaintextValue, activeKey)
      .then((encrypted) => {
        storage.setItem(storageKey, encrypted);
      })
      .catch(() => {});
    return;
  }
  try {
    storage.setItem(storageKey, plaintextValue);
  } catch {}
}

export function removeSensitiveLocalStorageKey(
  storageKey: string,
  storage: Storage = localStorage
): void {
  decryptedMemoryMirror.delete(storageKey);
  try {
    storage.removeItem(storageKey);
    storage.removeItem(`${storageKey}${MIGRATION_ENC_SUFFIX}`);
    storage.removeItem(`${storageKey}${MIGRATION_PLAIN_SUFFIX}`);
  } catch {}
}

export const removeSensitiveLocalStorage = removeSensitiveLocalStorageKey;
export const getLocalCryptoMode = getLocalEncryptionMode;
export const isEnvelopeString = isEncryptedEnvelopeString;
export const isLocalEncryptionActive = isLocalEncryptionEnabled;
export const readSensitiveLocalStorage = readSensitiveLocalStorageAsync;
export const writeSensitiveLocalStorage = writeSensitiveLocalStorageAsync;

export function hasActiveCryptoKeyInMemory(): boolean {
  return inMemoryCryptoKey !== null;
}

export async function encryptStringValue(plaintext: string): Promise<string> {
  if (!inMemoryCryptoKey) {
    return plaintext;
  }
  return encryptStringWithKey(plaintext, inMemoryCryptoKey);
}

export async function decryptStringValue(envelopeJson: string): Promise<string | null> {
  if (!inMemoryCryptoKey) {
    return null;
  }
  try {
    return await decryptStringWithKey(envelopeJson, inMemoryCryptoKey);
  } catch {
    decryptionFailureDetected = true;
    return null;
  }
}

export function resetLocalCryptoForTests(): void {
  inMemoryCryptoKey = null;
  inMemoryMode = 'none';
  decryptionFailureDetected = false;
  decryptedMemoryMirror.clear();
}

/**
 * Adaptateur `auth.storage` personnalisé pour `createClient` de `@supabase/supabase-js`
 * afin de chiffrer les jetons `sb-*` avec AES-GCM 256 lorsque le chiffrement local est actif.
 */
export function createSupabaseEncryptedAuthStorage(
  backingStorage: Storage = typeof localStorage !== 'undefined' ? localStorage : ({} as Storage)
) {
  return {
    getItem: async (key: string): Promise<string | null> => {
      return readSensitiveLocalStorageAsync(key, backingStorage);
    },
    setItem: async (key: string, value: string): Promise<void> => {
      await writeSensitiveLocalStorageAsync(key, value, backingStorage);
    },
    removeItem: async (key: string): Promise<void> => {
      removeSensitiveLocalStorageKey(key, backingStorage);
    },
  };
}

/**
 * Chiffre un objet destiné à IndexedDB (`sync_queue` ou `stock_movements`) si une clé active est présente.
 * Conserve les champs d'indexation requis par IndexedDB (`id`, `status`, `timestamp`, `created_at`, `product_id`, `movement_type`)
 * et chiffre le reste dans `__encrypted_envelope_v1`.
 */
export async function encryptRecordForIndexedDb<T extends Record<string, any>>(
  record: T,
  indexFieldsToKeepPlain: readonly string[] = ['id', 'status', 'timestamp', 'created_at', 'product_id', 'movement_type']
): Promise<T> {
  if (!isLocalEncryptionEnabled() || !inMemoryCryptoKey) {
    return record;
  }
  const serialized = JSON.stringify(record);
  const envelope = await encryptStringWithKey(serialized, inMemoryCryptoKey);
  const shell: Record<string, any> = {
    __encrypted_envelope_v1: envelope,
  };
  for (const field of indexFieldsToKeepPlain) {
    if (record[field] !== undefined) {
      shell[field] = record[field];
    }
  }
  return shell as T;
}

/**
 * Déchiffre un enregistrement lu depuis IndexedDB (`sync_queue` ou `stock_movements`).
 * Si l'enregistrement est chiffré mais que la clé n'est pas disponible ou échoue,
 * ne supprime JAMAIS l'enregistrement et lève une erreur explicite ou retourne `null`.
 */
export async function decryptRecordFromIndexedDb<T extends Record<string, any>>(
  record: T | null | undefined
): Promise<T | null> {
  if (!record) return null;
  const envelope = (record as any).__encrypted_envelope_v1;
  if (!envelope || typeof envelope !== 'string') {
    return record;
  }
  if (!inMemoryCryptoKey) {
    decryptionFailureDetected = true;
    return null;
  }
  try {
    const plainJson = await decryptStringWithKey(envelope, inMemoryCryptoKey);
    return JSON.parse(plainJson) as T;
  } catch {
    decryptionFailureDetected = true;
    return null;
  }
}
