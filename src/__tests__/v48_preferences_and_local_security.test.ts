import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { SQL_STEPS } from '../../scripts/build-sql.mjs';
import { TABLES } from '../constants/tables';
import { SQL_SCRIPT_12_USER_PREFERENCES } from '../constants/supabaseScripts';
import {
  APP_VERSION,
  EXPECTED_SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
} from '../appVersion';
import {
  DB_TO_LOCAL_PREF_MAP,
  BLACKLISTED_PREF_KEYS,
  isBlacklistedPreferenceKey,
  sanitizePreferencesPayload,
  readAllLocalPreferences,
  applyPreferencesToLocalCache,
  getUserPreference,
  setUserPreference,
  flushPendingUserPreferences,
  syncUserPreferencesOnLogin,
  getSyncBannerState,
  dismissUserPreferencesSyncBanner,
  resetUserPreferencesServiceForTests,
} from '../services/userPreferencesService';
import {
  FORBIDDEN_SERVICE_ROLE_KEY_MESSAGE,
  validateSupabaseAnonKey,
  isDangerousSupabaseKey,
  purgeStoredDangerousSupabaseKey,
} from '../services/clientSupabase';
import { buildContentSecurityPolicy } from '../utils/cspPolicy';
import {
  PBKDF2_MIN_ITERATIONS,
  CRYPTO_META_STORAGE_KEY,
  isEncryptedEnvelopeString,
  isEncryptedEnvelopeObject,
  encryptStringValue,
  decryptStringValue,
  enablePinLocalEncryption,
  disablePinLocalEncryption,
  unlockPinLocalEncryption,
  clearCryptoKeyFromMemory,
  hasActiveCryptoKeyInMemory,
  isLocalEncryptionEnabled,
  getLocalCryptoMode,
  getActiveCryptoKey,
  readSensitiveLocalStorageAsync,
  writeSensitiveLocalStorageAsync,
  resumeInterruptedCryptoMigration,
  resetLocalCryptoForTests,
} from '../services/localCrypto';
import {
  saveLocalDevicePin,
  getUnsynchronizedOperationsCount,
  resetLocalDataWithWarningAndConfirmation,
} from '../services/deviceSecurityService';
import {
  enqueueScannerOfflineAction,
  loadScannerOfflineQueue,
  clearScannerOfflineQueue,
} from '../services/scannerOfflineQueue';

const ROOT_DIR = path.resolve(__dirname, '../..');

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

function setupTestLocalStorage() {
  Object.defineProperty(globalThis, 'localStorage', {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  });
}

setupTestLocalStorage();

function createFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = Buffer.from('fake-signature-bytes').toString('base64url');
  return `${header}.${body}.${sig}`;
}

describe('Prompt v48 — LOT 0 : Nettoyage de public/assets/aistudio/', () => {
  it('supprime public/assets/aistudio/ et vérifie qu’aucun import du code ne le référence', () => {
    const aistudioAssetDir = path.join(ROOT_DIR, 'public/assets/aistudio');
    expect(fs.existsSync(aistudioAssetDir)).toBe(false);

    const srcDir = path.join(ROOT_DIR, 'src');
    const checkDir = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') checkDir(full);
        } else if (/\.(ts|tsx|js|jsx|css|html)$/.test(entry.name)) {
          const content = fs.readFileSync(full, 'utf8');
          expect(content).not.toContain('assets/aistudio');
        }
      }
    };
    checkDir(srcDir);
  });
});

describe('Prompt v48 — LOT 1 : Préférences utilisateur en base (core_user_preferences) & Schéma 2.2.0 / App 5.7.0', () => {
  beforeEach(() => {
    setupTestLocalStorage();
    resetUserPreferencesServiceForTests();
  });

  it('1.1 déclare userPreferences dans TABLES, le script 12 dans SQL_STEPS (après 11 et avant 07), et met à jour les versions', () => {
    expect(TABLES.userPreferences).toBe('core_user_preferences');
    expect(APP_VERSION).toBe('5.13.0');
    expect(EXPECTED_SCHEMA_VERSION).toBe('2.7.0');
    expect(MIN_SUPPORTED_SCHEMA_VERSION).toBe('1.0.0');

    const stepNumbers = SQL_STEPS.map((s: any) => String(s.step));
    const idx11 = stepNumbers.indexOf('11');
    const idx12 = stepNumbers.indexOf('12');
    const idx07 = stepNumbers.indexOf('07');
    expect(idx11).toBeGreaterThan(0);
    expect(idx12).toBe(idx11 + 1);
    expect(idx07).toBeGreaterThan(idx12);

    expect(SQL_SCRIPT_12_USER_PREFERENCES).toContain('CREATE TABLE IF NOT EXISTS public.core_user_preferences');
    expect(SQL_SCRIPT_12_USER_PREFERENCES).toContain('Select own or super_admin core_user_preferences');
    expect(SQL_SCRIPT_12_USER_PREFERENCES).toContain('Insert own core_user_preferences');
    expect(SQL_SCRIPT_12_USER_PREFERENCES).toContain('Update own core_user_preferences');
    expect(SQL_SCRIPT_12_USER_PREFERENCES).toContain('Delete own core_user_preferences');
  });

  it(
    '1.1 SQL PGlite : exécute 12_user_preferences.sql deux fois (idempotent), vérifie RLS (propre ligne uniquement, anon refusé, super-admin lit, CHECK <= 16 Ko objet JSON, ON DELETE CASCADE) et diagnostic_installation()',
    async () => {
      const db = new PGlite();
      const authStub = `
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
        END $$;
        CREATE SCHEMA IF NOT EXISTS auth;
        GRANT USAGE ON SCHEMA auth TO PUBLIC, anon, authenticated, service_role;
        CREATE TABLE IF NOT EXISTS auth.users (
          id UUID PRIMARY KEY,
          instance_id UUID,
          aud TEXT,
          role TEXT,
          email TEXT,
          encrypted_password TEXT,
          email_confirmed_at TIMESTAMPTZ DEFAULT now(),
          raw_app_meta_data JSONB DEFAULT '{}'::jsonb,
          raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
          SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
        $$;
        CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS $$
          SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
        $$;
        GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC, anon, authenticated, service_role;
        GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC, anon, authenticated, service_role;
      `;
      await db.exec(authStub);

      const scripts = [
        '00_complete_tot_stock_schema.sql',
        '09_core_prefixes.sql',
        '01_auth_link.sql',
        '01b_migrate_users_id_to_text.sql',
        '02_rls_hardening.sql',
        '03_rpc_stock_and_orders.sql',
        '04_mouvements_et_depots_vehicules.sql',
        '05_rpc_admin_users.sql',
        '06_install_additional_roles.sql',
        '08_print_jobs.sql',
        '11_suite_tables.sql',
        '12_user_preferences.sql',
        '13_transfer_stock_batch.sql',
        '14_mailing.sql',
        '15_search_orders_movements.sql',
        '07_app_compat.sql',
      ];
      for (const s of scripts) {
        await db.exec(fs.readFileSync(path.join(ROOT_DIR, 'supabase-client', s), 'utf8'));
      }
      // Double exécution idempotente de 12_user_preferences.sql et 07_app_compat.sql
      await db.exec(fs.readFileSync(path.join(ROOT_DIR, 'supabase-client/12_user_preferences.sql'), 'utf8'));
      await db.exec(fs.readFileSync(path.join(ROOT_DIR, 'supabase-client/07_app_compat.sql'), 'utf8'));

      const UUID_ADMIN = '00000000-0000-4000-8000-000000000001';
      const UUID_USER_A = '00000000-0000-4000-8000-000000000011';
      const UUID_USER_B = '00000000-0000-4000-8000-000000000022';

      await db.exec(`
        INSERT INTO auth.users (id, email) VALUES
          ('${UUID_ADMIN}', 'admin@tot.local'),
          ('${UUID_USER_A}', 'usera@tot.local'),
          ('${UUID_USER_B}', 'userb@tot.local')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO public.core_users (id, name, email, pin, role_id, is_blocked, auth_user_id) VALUES
          ('usr-admin', 'Super Admin', 'admin@tot.local', '', 0, false, '${UUID_ADMIN}'),
          ('usr-a', 'User A', 'usera@tot.local', '', 3, false, '${UUID_USER_A}'),
          ('usr-b', 'User B', 'userb@tot.local', '', 3, false, '${UUID_USER_B}')
        ON CONFLICT (id) DO UPDATE SET auth_user_id = EXCLUDED.auth_user_id, role_id = EXCLUDED.role_id;
      `);

      // User A insère et met à jour sa propre ligne
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_USER_A}', true);
        SELECT set_config('request.jwt.claim.role', 'authenticated', true);
        INSERT INTO public.core_user_preferences (user_id, prefs)
        VALUES ('usr-a', '{"sound_enabled":true,"language":"nl"}'::jsonb);
        COMMIT;
      `);

      // User B insère sa propre ligne mais ne peut ni lire ni modifier celle de User A
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_USER_B}', true);
        SELECT set_config('request.jwt.claim.role', 'authenticated', true);
        INSERT INTO public.core_user_preferences (user_id, prefs)
        VALUES ('usr-b', '{"sound_enabled":false,"language":"fr"}'::jsonb);
        COMMIT;
      `);

      await db.exec(`
        SET ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_USER_B}', false);
        SELECT set_config('request.jwt.claim.role', 'authenticated', false);
      `);
      const visibleToB = await db.query<{ user_id: string; prefs: any }>(
        `SELECT user_id, prefs FROM public.core_user_preferences;`
      );
      expect(visibleToB.rows.length).toBe(1);
      expect(visibleToB.rows[0].user_id).toBe('usr-b');

      // Tentative d'écriture sur la ligne de User A par User B -> bloquée par RLS
      await expect(
        db.query(`
          INSERT INTO public.core_user_preferences (user_id, prefs)
          VALUES ('usr-a', '{"sound_enabled":false}'::jsonb);
        `)
      ).rejects.toThrow(/row-level security/i);
      await db.exec(`RESET ROLE;`);

      // Super-admin (rôle 0) peut lire toutes les lignes
      await db.exec(`
        SET ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_ADMIN}', false);
        SELECT set_config('request.jwt.claim.role', 'authenticated', false);
      `);
      const visibleToAdmin = await db.query<{ user_id: string }>(
        `SELECT user_id FROM public.core_user_preferences ORDER BY user_id ASC;`
      );
      expect(visibleToAdmin.rows.map((r) => r.user_id)).toEqual(['usr-a', 'usr-b']);

      // Diagnostic SQL vérifie la table core_user_preferences et ses 4 politiques
      const diagRes = await db.query<{ check_key: string; status: string; details: string }>(
        `SELECT check_key, status, details FROM public.diagnostic_installation() WHERE check_key = 'user_preferences_rls';`
      );
      expect(diagRes.rows[0]?.status).toBe('OK');
      await db.exec(`RESET ROLE;`);

      // anon refusé
      await expect(
        db.exec(`
          BEGIN;
          SET LOCAL ROLE anon;
          SELECT * FROM public.core_user_preferences;
          COMMIT;
        `)
      ).rejects.toThrow(/permission denied/i);
      await db.exec(`ROLLBACK;`);

      // CHECK : objet JSON uniquement (tableau refusé) et taille <= 16 Ko
      await expect(
        db.query(`
          INSERT INTO public.core_user_preferences (user_id, prefs)
          VALUES ('usr-admin', '[1,2,3]'::jsonb);
        `)
      ).rejects.toThrow(/core_user_preferences_prefs_valid_chk|check constraint/i);

      const hugeString = 'x'.repeat(17000);
      await expect(
        db.query(
          `INSERT INTO public.core_user_preferences (user_id, prefs) VALUES ('usr-admin', $1::jsonb);`,
          [JSON.stringify({ huge: hugeString })]
        )
      ).rejects.toThrow(/core_user_preferences_prefs_valid_chk|check constraint/i);

      // ON DELETE CASCADE à la suppression de l'utilisateur
      await db.query(`DELETE FROM public.core_users WHERE id = 'usr-b';`);
      const afterCascade = await db.query(
        `SELECT user_id FROM public.core_user_preferences WHERE user_id = 'usr-b';`
      );
      expect(afterCascade.rows.length).toBe(0);

      await db.close();
    },
    120_000
  );

  it('1.2 applique strictement la liste blanche et rejette toute clé de la liste noire', () => {
    expect(Object.keys(DB_TO_LOCAL_PREF_MAP).sort()).toEqual(
      [
        'haptics_enabled',
        'haptics_intensity',
        'sound_enabled',
        'scanner_sound',
        'scanner_vibration',
        'auto_logout_minutes',
        'language',
        'theme',
        'desktop_sidebar_collapsed',
        'desktop_inventory_columns',
        'desktop_inventory_density',
        'print_sound',
        'print_blink',
      ].sort()
    );

    expect(BLACKLISTED_PREF_KEYS.size).toBeGreaterThanOrEqual(10);
    expect(isBlacklistedPreferenceKey('tot_local_device_pin_usr1')).toBe(true);
    expect(isBlacklistedPreferenceKey('tot_pin_failed_attempts')).toBe(true);
    expect(isBlacklistedPreferenceKey('tot_last_activity_ts')).toBe(true);
    expect(isBlacklistedPreferenceKey('tqt_company_key')).toBe(true);
    expect(isBlacklistedPreferenceKey('tot_inv_supabase_key')).toBe(true);
    expect(isBlacklistedPreferenceKey('tot_print_station_id')).toBe(true);
    expect(isBlacklistedPreferenceKey('tot_print_station_depot')).toBe(true);
    expect(isBlacklistedPreferenceKey('tot_scanner_offline_queue_v1')).toBe(true);
    expect(isBlacklistedPreferenceKey('smtp_password')).toBe(true);

    const sanitized = sanitizePreferencesPayload({
      haptics_enabled: false,
      haptics_intensity: 'strong',
      sound_enabled: true,
      auto_logout_minutes: 10,
      language: 'nl',
      theme: 'dark',
      // Clés interdites qui ne doivent jamais passer
      tot_local_device_pin_1: '1234',
      tqt_company_key: 'secret',
      smtp: 'secret-smtp',
      license_token: 'tok',
    });

    expect(sanitized).toEqual({
      haptics_enabled: false,
      haptics_intensity: 'strong',
      sound_enabled: true,
      auto_logout_minutes: 10,
      language: 'nl',
      theme: 'dark',
    });
  });

  it('1.4 Scénario d’acceptation « nouvel appareil » : Appareil A -> Base -> Appareil B (localStorage vide) -> Modif hors-ligne sur B -> Reconnexion -> Appareil A', async () => {
    const serverDb = new Map<string, { user_id: string; prefs: Record<string, unknown>; updated_at: string }>();
    let isOnline = true;

    const createMockClient = () => ({
      from: (table: string) => {
        expect(table).toBe(TABLES.userPreferences);
        return {
          select: () => ({
            eq: (_col: string, userId: string) => ({
              maybeSingle: async () => {
                if (!isOnline) {
                  return { data: null, error: { message: 'Failed to fetch (offline)' } };
                }
                const row = serverDb.get(userId) || null;
                return { data: row, error: null };
              },
            }),
          }),
          upsert: async (payload: { user_id: string; prefs: Record<string, unknown>; updated_at: string }) => {
            if (!isOnline) {
              return { error: { message: 'Network offline' } };
            }
            serverDb.set(payload.user_id, {
              user_id: payload.user_id,
              prefs: { ...payload.prefs },
              updated_at: payload.updated_at,
            });
            return { error: null };
          },
        };
      },
    });

    const userId = 'usr-operator-42';

    // --- ÉTAPE 1 : Appareil A règle haptique OFF, son ON, auto_logout 10 min, langue NL ---
    await syncUserPreferencesOnLogin(createMockClient() as any, userId);
    setUserPreference('haptics_enabled', false);
    setUserPreference('sound_enabled', true);
    setUserPreference('auto_logout_minutes', 10);
    setUserPreference('language', 'nl');
    await flushPendingUserPreferences(createMockClient() as any, userId);

    expect(serverDb.get(userId)?.prefs).toMatchObject({
      haptics_enabled: false,
      sound_enabled: true,
      auto_logout_minutes: 10,
      language: 'nl',
    });

    // --- ÉTAPE 2 : Appareil B (localStorage totalement vide) se connecte avec le même compte ---
    setupTestLocalStorage();
    resetUserPreferencesServiceForTests();

    const syncB = await syncUserPreferencesOnLogin(createMockClient() as any, userId);

    expect(syncB.synced).toBe(true);
    expect(getUserPreference('haptics_enabled')).toBe(false);
    expect(getUserPreference('sound_enabled')).toBe(true);
    expect(getUserPreference('auto_logout_minutes')).toBe(10);
    expect(getUserPreference('language')).toBe('nl');
    expect(localStorage.getItem('tot_stock_haptics_enabled')).toBe('false');
    expect(localStorage.getItem('tot_stock_sound_enabled')).toBe('true');
    expect(localStorage.getItem('tot_inv_auto_logout_minutes')).toBe('10');
    expect(localStorage.getItem('tqt_language')).toBe('nl');

    // --- ÉTAPE 3 : Appareil B coupe le réseau, change le son (OFF), puis se reconnecte ---
    isOnline = false;
    setUserPreference('sound_enabled', false);
    const offlineFlush = await flushPendingUserPreferences(createMockClient() as any, userId);
    expect(offlineFlush.synced).toBe(false);
    expect(getUserPreference('sound_enabled')).toBe(false);

    // Reconnexion de B : synchronisation vers la base (la clé locale en attente n'est pas écrasée par le serveur)
    isOnline = true;
    await syncUserPreferencesOnLogin(createMockClient() as any, userId);
    expect(getUserPreference('sound_enabled')).toBe(false);
    expect(serverDb.get(userId)?.prefs.sound_enabled).toBe(false);

    // --- ÉTAPE 4 : Appareil A se reconnecte / rouvre l'application et reçoit sound_enabled = false ---
    setupTestLocalStorage();
    resetUserPreferencesServiceForTests();
    applyPreferencesToLocalCache({
      haptics_enabled: false,
      sound_enabled: true,
      auto_logout_minutes: 10,
      language: 'nl',
    });

    await syncUserPreferencesOnLogin(createMockClient() as any, userId);
    expect(getUserPreference('sound_enabled')).toBe(false);
    expect(readAllLocalPreferences().sound_enabled).toBe(false);
  });

  it('1.3 affiche une seule fois par session le bandeau discret si la table core_user_preferences (script SQL 12) est absente', async () => {
    const missingTableClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: null,
              error: {
                code: '42P01',
                message: 'relation "public.core_user_preferences" does not exist',
              },
            }),
          }),
        }),
      }),
    };

    expect(getSyncBannerState().visible).toBe(false);
    const res = await syncUserPreferencesOnLogin(missingTableClient as any, 'usr-1');
    expect(res.synced).toBe(false);
    expect(getSyncBannerState().visible).toBe(true);
    expect(getSyncBannerState().message).toContain(
      'Préférences non synchronisées (script SQL 12 manquant)'
    );

    dismissUserPreferencesSyncBanner();
    expect(getSyncBannerState().visible).toBe(false);

    await syncUserPreferencesOnLogin(missingTableClient as any, 'usr-1');
    expect(getSyncBannerState().visible).toBe(false);
  });
});

describe('Prompt v48 — LOT 2.1 : Rejet des clés Supabase dangereuses (service_role / sb_secret_)', () => {
  beforeEach(() => {
    setupTestLocalStorage();
  });

  it('rejette un JWT service_role et toute clé sb_secret_* avec le message exact et accepte anon / sb_publishable_*', () => {
    const serviceRoleJwt = createFakeJwt({
      role: 'service_role',
      iss: 'supabase',
      ref: 'abcdefghijkl',
    });
    const anonJwt = createFakeJwt({
      role: 'anon',
      iss: 'supabase',
      ref: 'abcdefghijkl',
    });

    const srResult = validateSupabaseAnonKey(serviceRoleJwt);
    expect(srResult.valid).toBe(false);
    expect(srResult.errorCode).toBe('FORBIDDEN_SECRET_KEY');
    expect(srResult.errorMessage).toBe(FORBIDDEN_SERVICE_ROLE_KEY_MESSAGE);
    expect(srResult.errorMessage).toBe(
      "Cette clé est secrète (service_role). Utilisez la clé publique “anon”. Ne la collez jamais dans l'application."
    );

    const sbSecretResult = validateSupabaseAnonKey('sb_secret_1234567890abcdef1234567890');
    expect(sbSecretResult.valid).toBe(false);
    expect(sbSecretResult.errorCode).toBe('FORBIDDEN_SECRET_KEY');
    expect(sbSecretResult.errorMessage).toBe(FORBIDDEN_SERVICE_ROLE_KEY_MESSAGE);

    const malformedResult = validateSupabaseAnonKey('not-a-valid-key');
    expect(malformedResult.valid).toBe(false);

    const anonResult = validateSupabaseAnonKey(anonJwt);
    expect(anonResult.valid).toBe(true);
    expect(anonResult.normalizedKey).toBe(anonJwt);

    const publishableResult = validateSupabaseAnonKey('sb_publishable_abcdef1234567890abcdef');
    expect(publishableResult.valid).toBe(true);
  });

  it('supprime au démarrage toute clé service_role ou sb_secret_ déjà enregistrée dans localStorage', () => {
    const serviceRoleJwt = createFakeJwt({ role: 'service_role', iss: 'supabase' });
    localStorage.setItem('tqt_company_key', serviceRoleJwt);
    localStorage.setItem('tot_inv_supabase_key', 'sb_secret_super_secret_value_12345');

    expect(isDangerousSupabaseKey(serviceRoleJwt)).toBe(true);
    const res = purgeStoredDangerousSupabaseKey();
    expect(res.purged).toBe(true);
    expect(localStorage.getItem('tqt_company_key')).toBeNull();
    expect(localStorage.getItem('tot_inv_supabase_key')).toBeNull();
  });
});

describe('Prompt v48 — LOT 2.2 : Content-Security-Policy (CSP)', () => {
  it('génère une politique CSP stricte et vérifie la présence de la balise meta dans index.html', () => {
    const csp = buildContentSecurityPolicy({ extraConnectSrc: 'https://custom.example.com' });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self' https://*.supabase.co wss://*.supabase.co");
    expect(csp).toContain('https://custom.example.com');
    expect(csp).toContain("img-src 'self' data: blob: https:");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");

    const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
    expect(indexHtml).toContain('http-equiv="Content-Security-Policy"');
    expect(indexHtml).toContain("default-src 'self'");
    expect(indexHtml).toContain("https://*.supabase.co wss://*.supabase.co");
    expect(indexHtml).toContain("object-src 'none'");
  });
});

describe('Prompt v48 — LOT 2.3 : Chiffrement local AES-GCM 256 (localCrypto.ts) & Réinitialisation sécurisée', () => {
  beforeEach(async () => {
    setupTestLocalStorage();
    resetLocalCryptoForTests();
    await clearScannerOfflineQueue();
  });

  it('utilise PBKDF2-SHA256 >= 600 000 itérations, chiffre avec IV aléatoire de 12 octets (2 chiffrements = 2 IV différents), et migre atomiquement clair <-> chiffré', async () => {
    expect(PBKDF2_MIN_ITERATIONS).toBeGreaterThanOrEqual(600_000);

    const userId = 'usr-crypto-1';
    const pin = '2580';
    await saveLocalDevicePin(userId, pin);

    // Données initiales en clair dans localStorage
    const userProfileJson = JSON.stringify({ id: userId, name: 'Jean Dupont', role_id: 1 });
    const anonJwt = createFakeJwt({ role: 'anon', iss: 'supabase' });
    localStorage.setItem('tot_inv_current_user', userProfileJson);
    localStorage.setItem('tqt_company_key', anonJwt);
    localStorage.setItem('tot_inventory_audit_DEP1', JSON.stringify({ depotId: 'DEP1', counts: { P1: 5 } }));
    // Catalogue et préférences UI laissés en clair
    localStorage.setItem('tqt_language', 'fr');

    const enabled = await enablePinLocalEncryption(pin);
    expect(enabled.ok).toBe(true);
    expect(isLocalEncryptionEnabled()).toBe(true);
    expect(getLocalCryptoMode()).toBe('pin');
    expect(hasActiveCryptoKeyInMemory()).toBe(true);

    // Les valeurs sensibles sur disque sont désormais des enveloppes chiffrées {"v":1,"iv":"...","ct":"..."}
    const rawStoredProfile = localStorage.getItem('tot_inv_current_user')!;
    const rawStoredKey = localStorage.getItem('tqt_company_key')!;
    const rawStoredAudit = localStorage.getItem('tot_inventory_audit_DEP1')!;

    expect(isEncryptedEnvelopeString(rawStoredProfile)).toBe(true);
    expect(isEncryptedEnvelopeString(rawStoredKey)).toBe(true);
    expect(isEncryptedEnvelopeString(rawStoredAudit)).toBe(true);
    expect(rawStoredProfile).not.toContain('Jean Dupont');

    // Les préférences UI restent en clair
    expect(localStorage.getItem('tqt_language')).toBe('fr');

    // Lecture transparente via readSensitiveLocalStorageAsync
    expect(await readSensitiveLocalStorageAsync('tot_inv_current_user')).toBe(userProfileJson);
    expect(await readSensitiveLocalStorageAsync('tqt_company_key')).toBe(anonJwt);

    // Deux chiffrements d'une même valeur produisent deux IV aléatoires distincts
    const enc1 = await encryptStringValue('same-plaintext-value');
    const enc2 = await encryptStringValue('same-plaintext-value');
    const env1 = JSON.parse(enc1);
    const env2 = JSON.parse(enc2);
    expect(isEncryptedEnvelopeObject(env1)).toBe(true);
    expect(isEncryptedEnvelopeObject(env2)).toBe(true);
    expect(env1.iv).not.toBe(env2.iv);
    expect(env1.ct).not.toBe(env2.ct);
    expect(await decryptStringValue(enc1)).toBe('same-plaintext-value');
    expect(await decryptStringValue(enc2)).toBe('same-plaintext-value');

    // Mauvais PIN lors de la tentative de désactivation : refusé proprement sans perte de données
    const wrongDisable = await disablePinLocalEncryption('9999');
    expect(wrongDisable.ok).toBe(false);
    expect(isLocalEncryptionEnabled()).toBe(true);
    expect(isEncryptedEnvelopeString(localStorage.getItem('tot_inv_current_user'))).toBe(true);

    // Verrouillage d'inactivité : efface la CryptoKey de la mémoire vive
    clearCryptoKeyFromMemory();
    expect(hasActiveCryptoKeyInMemory()).toBe(false);

    // Mauvais PIN au déverrouillage : échoue proprement sans supprimer les données
    const wrongUnlock = await unlockPinLocalEncryption('0000');
    expect(wrongUnlock.ok).toBe(false);
    expect(hasActiveCryptoKeyInMemory()).toBe(false);

    // Bon PIN au déverrouillage : re-dérive la clé et permet à nouveau le déchiffrement
    const goodUnlock = await unlockPinLocalEncryption(pin);
    expect(goodUnlock.ok).toBe(true);
    expect(hasActiveCryptoKeyInMemory()).toBe(true);
    expect(await readSensitiveLocalStorageAsync('tot_inv_current_user')).toBe(userProfileJson);

    // Désactivation complète avec le bon PIN : déchiffre atomiquement toutes les données
    const disabled = await disablePinLocalEncryption(pin);
    expect(disabled.ok).toBe(true);
    expect(isLocalEncryptionEnabled()).toBe(false);
    expect(localStorage.getItem('tot_inv_current_user')).toBe(userProfileJson);
    expect(localStorage.getItem('tqt_company_key')).toBe(anonJwt);
  }, 60_000);

  it('reprend proprement une migration interrompue au démarrage suivant avec zéro perte de données', async () => {
    const userId = 'usr-mig-interrupt';
    const pin = '1357';
    await saveLocalDevicePin(userId, pin);

    await enablePinLocalEncryption(pin);
    await writeSensitiveLocalStorageAsync('tot_inv_current_user', '{"id":"usr-mig-interrupt"}');

    // Simuler une migration interrompue vers 'encrypting' où une clé sensible est encore en clair
    localStorage.setItem('tqt_company_url', 'https://interrupt-test.supabase.co');
    const metaRaw = JSON.parse(localStorage.getItem(CRYPTO_META_STORAGE_KEY)!);
    metaRaw.migrationState = 'encrypting';
    localStorage.setItem(CRYPTO_META_STORAGE_KEY, JSON.stringify(metaRaw));

    const activeKey = getActiveCryptoKey()!;
    await resumeInterruptedCryptoMigration(activeKey);

    const updatedMeta = JSON.parse(localStorage.getItem(CRYPTO_META_STORAGE_KEY)!);
    expect(updatedMeta.migrationState).toBe('complete');
    expect(isEncryptedEnvelopeString(localStorage.getItem('tqt_company_url'))).toBe(true);
    expect(await readSensitiveLocalStorageAsync('tqt_company_url')).toBe(
      'https://interrupt-test.supabase.co'
    );
  }, 60_000);

  it('avertit du nombre exact d’opérations hors-ligne non synchronisées avant réinitialisation et ne supprime jamais sans confirmation', async () => {
    await clearScannerOfflineQueue();
    await enqueueScannerOfflineAction({
      order_id: 'ORD-1',
      order_number: 'CMD-1',
      user_id: 'usr-1',
      action_type: 'PICK_ITEM',
      payload: {
        product_id: 'P-1',
        product_ref: 'REF-1',
        picked_quantity: 2,
      },
    });
    await enqueueScannerOfflineAction({
      order_id: 'ORD-1',
      order_number: 'CMD-1',
      user_id: 'usr-1',
      action_type: 'PICK_ITEM',
      payload: {
        product_id: 'P-2',
        product_ref: 'REF-2',
        picked_quantity: 5,
      },
    });

    const countBefore = await getUnsynchronizedOperationsCount();
    expect(countBefore).toBe(2);

    // 1. Si l'utilisateur annule la confirmation -> aucune opération hors-ligne n'est supprimée
    let syncAttempted = false;
    const cancelledRes = await resetLocalDataWithWarningAndConfirmation({
      attemptPriorSyncFn: async () => {
        syncAttempted = true;
      },
      confirmResetFn: async ({ unsynchronizedCount }) => {
        expect(unsynchronizedCount).toBe(2);
        return false;
      },
    });

    expect(syncAttempted).toBe(true);
    expect(cancelledRes.confirmed).toBe(false);
    expect(cancelledRes.unsynchronizedRemaining).toBe(2);
    expect((await loadScannerOfflineQueue()).length).toBe(2);

    // 2. Si l'utilisateur confirme -> réinitialisation effectuée
    const confirmedRes = await resetLocalDataWithWarningAndConfirmation({
      confirmResetFn: async ({ unsynchronizedCount }) => {
        expect(unsynchronizedCount).toBe(2);
        return true;
      },
    });
    expect(confirmedRes.confirmed).toBe(true);
    expect((await loadScannerOfflineQueue()).length).toBe(0);
  });

  it('Traduction trilingue (FR / EN / NL) sur tous les menus et sous-menus', async () => {
    const { translations } = await import('../i18n/translations');
    const { tr, translateTextToEn, translateTextToNl } = await import('../i18n/dutchTranslator');

    // Vérifie les clés de menu Desktop dans les 3 langues
    const menuKeys = [
      'desktop_nav_dashboard',
      'desktop_nav_inventory',
      'desktop_nav_movements',
      'desktop_nav_orders',
      'desktop_nav_preparation',
      'desktop_nav_print_station',
      'desktop_nav_settings',
      'desktop_export_csv',
      'desktop_new_movement',
      'desktop_new_order',
      'desktop_new_order_material',
    ] as const;

    for (const key of menuKeys) {
      expect(translations.fr[key]).toBeTruthy();
      expect(translations.en[key]).toBeTruthy();
      expect(translations.nl[key]).toBeTruthy();
      expect(translations.en[key]).not.toBe(translations.fr[key]);
    }

    // Vérifie la traduction des sous-menus Paramètres & Administration en EN et NL
    expect(translateTextToEn('Administration & Préférences')).toBe('Administration & Preferences');
    expect(translateTextToNl('Administration & Préférences')).toBe('Beheer & Voorkeuren');
    expect(translateTextToEn('Utilisateurs et rôles')).toBe('Users & Roles');
    expect(translateTextToNl('Utilisateurs et rôles')).toBe('Gebruikers & Rollen');
    expect(translateTextToEn('Dépôts & Véhicules')).toBe('Depots & Vehicles');
    expect(translateTextToNl('Dépôts & Véhicules')).toBe('Depots & Voertuigen');
    expect(tr('fr', 'Profil et sécurité', 'Profile & Security', 'Profiel & Beveiliging')).toBe(
      'Profil et sécurité'
    );
    expect(tr('en', 'Profil et sécurité', 'Profile & Security', 'Profiel & Beveiliging')).toBe(
      'Profile & Security'
    );
    expect(tr('nl', 'Profil et sécurité', 'Profile & Security', 'Profiel & Beveiliging')).toBe(
      'Profiel & Beveiliging'
    );
  });
});
