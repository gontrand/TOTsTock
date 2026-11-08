import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  getPinFailedAttempts,
  verifyDevicePinWithLockout,
  verifyUserStatusOnResume,
  wipeDeviceLocalData,
  MAX_PIN_FAILED_ATTEMPTS,
  PIN_FAILURE_COUNT_KEY,
} from '../services/deviceSecurityService';
import { validateSupabaseServerUrl } from '../services/clientSupabase';
import { buildApkDownloadUrl, parseApkSha256Text } from '../utils/apkDownload';
import { APP_VERSION } from '../appVersion';
import { translations } from '../i18n/translations';
import { User } from '../types';

const rootDir = process.cwd();

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

const sampleUser: User = {
  id: 42,
  name: 'Technicien Chantier',
  trigram: 'TEC',
  role_id: 2,
  pin: '1234',
  is_blocked: false,
  auth_user_id: 'uuid-tech-42',
};

describe('Tâche 1 — Épinglage de certificat Android (optionnel, désactivé par défaut)', () => {
  it('network_security_config.xml interdit cleartext, limite trust-anchors à system et ne contient aucun pin-set actif', () => {
    const xmlPath = path.join(
      rootDir,
      'android/app/src/main/res/xml/network_security_config.xml'
    );
    expect(fs.existsSync(xmlPath)).toBe(true);
    const xml = fs.readFileSync(xmlPath, 'utf-8');
    expect(xml).toContain('cleartextTrafficPermitted="false"');
    expect(xml).toContain('<certificates src="system"');
    expect(xml).not.toContain('<pin-set');

    const manifest = fs.readFileSync(
      path.join(rootDir, 'android/app/src/main/AndroidManifest.xml'),
      'utf-8'
    );
    expect(manifest).toContain('android:networkSecurityConfig="@xml/network_security_config"');
  });
});

describe('Tâche 2 — Protection d’un appareil perdu ou volé', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createMemoryStorage();
  });

  describe('Compteur d’échecs de PIN et effacement au 5e échec', () => {
    it('incrémente le compteur à chaque échec et le remet à 0 après un succès', async () => {
      expect(getPinFailedAttempts(storage)).toBe(0);

      // 3 échecs consécutifs
      for (let i = 1; i <= 3; i++) {
        const res = await verifyDevicePinWithLockout({
          userId: 42,
          pin: '0000',
          verifyPinFn: async () => false,
          storage,
        });
        expect(res.success).toBe(false);
        expect(res.wiped).toBe(false);
        expect(res.attempts).toBe(i);
        expect(res.remainingAttempts).toBe(MAX_PIN_FAILED_ATTEMPTS - i);
      }

      expect(getPinFailedAttempts(storage)).toBe(3);

      // Succès au 4e essai -> remise à zéro
      const successRes = await verifyDevicePinWithLockout({
        userId: 42,
        pin: '1234',
        verifyPinFn: async () => true,
        storage,
      });
      expect(successRes.success).toBe(true);
      expect(successRes.wiped).toBe(false);
      expect(successRes.attempts).toBe(0);
      expect(getPinFailedAttempts(storage)).toBe(0);
    });

    it('déconnecte de Supabase et efface le cache local au 5e échec consécutif', async () => {
      const signOutSpy = vi.fn().mockResolvedValue(undefined);
      const wipeIdbSpy = vi.fn().mockResolvedValue(['products', 'sync_queue']);

      storage.setItem('tot_session_user', '{"id":42}');
      storage.setItem('tot_cached_products', '[{"id":10}]');
      storage.setItem('tqt_legacy_key', 'abc');
      storage.setItem('sb-xyz-auth-token', 'secret-jwt');
      storage.setItem('unrelated_key', 'keep_me');

      for (let i = 1; i < MAX_PIN_FAILED_ATTEMPTS; i++) {
        const res = await verifyDevicePinWithLockout({
          userId: 42,
          pin: '0000',
          verifyPinFn: async () => false,
          signOutFn: signOutSpy,
          storage,
        });
        expect(res.wiped).toBe(false);
        expect(signOutSpy).not.toHaveBeenCalled();
      }

      // 5e échec -> déclenche signOut + wipe
      const fifth = await verifyDevicePinWithLockout({
        userId: 42,
        pin: '0000',
        verifyPinFn: async () => false,
        wipeFn: () =>
          wipeDeviceLocalData({
            signOutFn: signOutSpy,
            storage,
            wipeIndexedDbFn: wipeIdbSpy,
            shouldReload: false,
          }),
        storage,
      });

      expect(fifth.success).toBe(false);
      expect(fifth.wiped).toBe(true);
      expect(fifth.attempts).toBe(MAX_PIN_FAILED_ATTEMPTS);
      expect(fifth.remainingAttempts).toBe(0);
      expect(signOutSpy).toHaveBeenCalledTimes(1);
      expect(wipeIdbSpy).toHaveBeenCalledTimes(1);

      // Toutes les clés tot_*, tqt_*, sb-* sont supprimées
      expect(storage.getItem('tot_session_user')).toBeNull();
      expect(storage.getItem('tot_cached_products')).toBeNull();
      expect(storage.getItem('tqt_legacy_key')).toBeNull();
      expect(storage.getItem('sb-xyz-auth-token')).toBeNull();
      expect(storage.getItem(PIN_FAILURE_COUNT_KEY)).toBeNull();
      expect(storage.getItem('unrelated_key')).toBe('keep_me');
    });
  });

  describe('Vérification de l’utilisateur à la reprise (utilisateur bloqué / supprimé -> effacement)', () => {
    it('déconnecte et efface les données locales si l’utilisateur est bloqué (is_blocked = true)', async () => {
      const signOutSpy = vi.fn().mockResolvedValue(undefined);
      const wipeIdbSpy = vi.fn().mockResolvedValue(['products']);
      const lockSessionSpy = vi.fn();

      storage.setItem('tot_session_user', '{"id":42,"name":"Tech"}');
      storage.setItem('tot_cached_orders', '[1,2,3]');

      const res = await verifyUserStatusOnResume({
        currentUser: sampleUser,
        isOnline: true,
        isSupabaseConfigured: true,
        fetchRemoteProfile: async () => ({
          found: true,
          user: { ...sampleUser, is_blocked: true },
        }),
        signOutAndWipe: () =>
          wipeDeviceLocalData({
            signOutFn: signOutSpy,
            storage,
            wipeIndexedDbFn: wipeIdbSpy,
            shouldReload: false,
          }),
        lockSession: lockSessionSpy,
      });

      expect(res.action).toBe('wiped');
      expect(res.reason).toBe('user_blocked');
      expect(signOutSpy).toHaveBeenCalledTimes(1);
      expect(wipeIdbSpy).toHaveBeenCalledTimes(1);
      expect(storage.getItem('tot_session_user')).toBeNull();
      expect(storage.getItem('tot_cached_orders')).toBeNull();
    });

    it('déconnecte et efface les données locales si l’utilisateur a été supprimé ou est introuvable', async () => {
      const signOutSpy = vi.fn().mockResolvedValue(undefined);
      const wipeIdbSpy = vi.fn().mockResolvedValue(['users']);
      const lockSessionSpy = vi.fn();

      storage.setItem('tot_session_user', '{"id":42}');

      const res = await verifyUserStatusOnResume({
        currentUser: sampleUser,
        isOnline: true,
        isSupabaseConfigured: true,
        fetchRemoteProfile: async () => ({ found: false }),
        signOutAndWipe: () =>
          wipeDeviceLocalData({
            signOutFn: signOutSpy,
            storage,
            wipeIndexedDbFn: wipeIdbSpy,
            shouldReload: false,
          }),
        lockSession: lockSessionSpy,
      });

      expect(res.action).toBe('wiped');
      expect(res.reason).toBe('user_deleted_or_missing');
      expect(signOutSpy).toHaveBeenCalledTimes(1);
      expect(wipeIdbSpy).toHaveBeenCalledTimes(1);
      expect(storage.getItem('tot_session_user')).toBeNull();
    });

    it('verrouille normalement la session hors ligne lorsque le délai d’inactivité est dépassé', async () => {
      const signOutAndWipeSpy = vi.fn();
      const lockSessionSpy = vi.fn();
      const now = 1_000_000;

      const res = await verifyUserStatusOnResume({
        currentUser: sampleUser,
        isOnline: false,
        isSupabaseConfigured: true,
        fetchRemoteProfile: async () => ({ found: true, user: sampleUser }),
        signOutAndWipe: signOutAndWipeSpy,
        lockSession: lockSessionSpy,
        autoLogoutMinutes: 5,
        lastActivityTimestamp: now - 6 * 60 * 1000,
        now,
      });

      expect(res.action).toBe('locked');
      expect(res.reason).toBe('inactivity_timeout');
      expect(lockSessionSpy).toHaveBeenCalledTimes(1);
      expect(signOutAndWipeSpy).not.toHaveBeenCalled();
    });
  });
});

describe('Tâche 3 — Contrôle de l’adresse du serveur à la configuration', () => {
  it('accepte une URL Supabase valide en https://*.supabase.co sans double confirmation', () => {
    const res = validateSupabaseServerUrl('https://abcd1234.supabase.co/', {
      allowedHostsEnv: '',
      isDevBuild: false,
    });
    expect(res.valid).toBe(true);
    expect(res.normalizedUrl).toBe('https://abcd1234.supabase.co');
    expect(res.hostname).toBe('abcd1234.supabase.co');
    expect(res.isOfficialSupabaseHost).toBe(true);
    expect(res.requiresCustomDomainConfirmation).toBe(false);
  });

  it('refuse le protocole non chiffré http:// (sauf localhost en dev build)', () => {
    const prodHttp = validateSupabaseServerUrl('http://abcd1234.supabase.co', {
      allowedHostsEnv: '',
      isDevBuild: false,
    });
    expect(prodHttp.valid).toBe(false);
    expect(prodHttp.errorCode).toBe('INSECURE_PROTOCOL');

    const prodLocalHttp = validateSupabaseServerUrl('http://localhost:54321', {
      allowedHostsEnv: '',
      isDevBuild: false,
    });
    expect(prodLocalHttp.valid).toBe(false);
    expect(prodLocalHttp.errorCode).toBe('INSECURE_PROTOCOL');

    const devLocalHttp = validateSupabaseServerUrl('http://localhost:54321', {
      allowedHostsEnv: '',
      isDevBuild: true,
    });
    expect(devLocalHttp.valid).toBe(true);
    expect(devLocalHttp.hostname).toBe('localhost');
  });

  it('refuse toute URL contenant un identifiant ou un mot de passe (user:pass@)', () => {
    const withUserPass = validateSupabaseServerUrl(
      'https://admin:secret123@abcd1234.supabase.co',
      { allowedHostsEnv: '', isDevBuild: false }
    );
    expect(withUserPass.valid).toBe(false);
    expect(withUserPass.errorCode).toBe('CREDENTIALS_FORBIDDEN');

    const withUserOnly = validateSupabaseServerUrl('https://admin@abcd1234.supabase.co', {
      allowedHostsEnv: '',
      isDevBuild: false,
    });
    expect(withUserOnly.valid).toBe(false);
    expect(withUserOnly.errorCode).toBe('CREDENTIALS_FORBIDDEN');
  });

  it('refuse un domaine hors de la liste VITE_ALLOWED_SUPABASE_HOSTS et accepte les jokers *.exemple.com', () => {
    const allowedList = 'abcd1234.supabase.co, *.mon-entreprise.fr';

    const rejected = validateSupabaseServerUrl('https://autre999.supabase.co', {
      allowedHostsEnv: allowedList,
      isDevBuild: false,
    });
    expect(rejected.valid).toBe(false);
    expect(rejected.errorCode).toBe('HOST_NOT_ALLOWED');

    const allowedExact = validateSupabaseServerUrl('https://abcd1234.supabase.co', {
      allowedHostsEnv: allowedList,
      isDevBuild: false,
    });
    expect(allowedExact.valid).toBe(true);

    const allowedWildcard = validateSupabaseServerUrl('https://supabase.mon-entreprise.fr', {
      allowedHostsEnv: allowedList,
      isDevBuild: false,
    });
    expect(allowedWildcard.valid).toBe(true);
    expect(allowedWildcard.requiresCustomDomainConfirmation).toBe(true);

    // Valeur vide entre guillemets ('""') ou placeholder AI Studio ('MY_VITE_ALLOWED_SUPABASE_HOSTS')
    const withEmptyQuotes = validateSupabaseServerUrl(
      'https://gdiyfvvjtidhraguuxjv.supabase.co',
      {
        allowedHostsEnv: '""',
        isDevBuild: false,
      }
    );
    expect(withEmptyQuotes.valid).toBe(true);
    expect(withEmptyQuotes.hostname).toBe('gdiyfvvjtidhraguuxjv.supabase.co');

    const withPlaceholder = validateSupabaseServerUrl(
      'https://gdiyfvvjtidhraguuxjv.supabase.co',
      {
        allowedHostsEnv: 'MY_VITE_ALLOWED_SUPABASE_HOSTS',
        isDevBuild: false,
      }
    );
    expect(withPlaceholder.valid).toBe(true);
  });

  it('accepte un domaine personnalisé mais exige la seconde confirmation explicite', () => {
    const custom = validateSupabaseServerUrl('https://stock-api.client-btp.fr', {
      allowedHostsEnv: '',
      isDevBuild: false,
    });
    expect(custom.valid).toBe(true);
    expect(custom.hostname).toBe('stock-api.client-btp.fr');
    expect(custom.isOfficialSupabaseHost).toBe(false);
    expect(custom.requiresCustomDomainConfirmation).toBe(true);
  });
});

describe('Tâche 4 — Versions Android, absence d’APK embarqué et empreinte SHA-256', () => {
  it('aligne versionName et versionCode dans android/app/build.gradle avec APP_VERSION et android/version-code.json', () => {
    const gradle = fs.readFileSync(path.join(rootDir, 'android/app/build.gradle'), 'utf-8');
    const versionCodeJson = JSON.parse(
      fs.readFileSync(path.join(rootDir, 'android/version-code.json'), 'utf-8')
    );
    expect(versionCodeJson.versionCode).toBe(12);
    expect(gradle).toContain(`versionName "${APP_VERSION}"`);
    expect(gradle).toContain(`versionCode ${versionCodeJson.versionCode}`);
  });

  it('n’embarque aucun fichier tot-stock.apk à la racine, dans public/ ni dans android/app/src/main/assets/, et aucun dossier android/keystore/', () => {
    expect(fs.existsSync(path.join(rootDir, 'tot-stock.apk'))).toBe(false);
    expect(fs.existsSync(path.join(rootDir, 'public/tot-stock.apk'))).toBe(false);
    expect(
      fs.existsSync(path.join(rootDir, 'android/app/src/main/assets/public/tot-stock.apk'))
    ).toBe(false);
    expect(fs.existsSync(path.join(rootDir, 'android/keystore'))).toBe(false);
  });

  it('calcule correctement le lien de téléchargement APK et l’empreinte SHA-256', () => {
    expect(buildApkDownloadUrl('', '5.5.0')).toBeNull();
    expect(buildApkDownloadUrl(null, '5.5.0')).toBeNull();
    expect(buildApkDownloadUrl('https://cdn.exemple.com/tot-stock.apk', '5.5.0')).toBe(
      'https://cdn.exemple.com/tot-stock.apk?v=5.5.0'
    );

    const validHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    expect(parseApkSha256Text(`${validHash}  tot-stock.apk\n`)).toBe(validHash);
    expect(parseApkSha256Text('<!DOCTYPE html><html><head></head></html>')).toBeNull();
  });

  it('garantit que les 3 langues (FR, EN, NL) ont exactement les mêmes clés de traduction', () => {
    const frKeys = Object.keys(translations.fr).sort();
    const enKeys = Object.keys(translations.en).sort();
    const nlKeys = Object.keys(translations.nl).sort();
    expect(enKeys).toEqual(frKeys);
    expect(nlKeys).toEqual(frKeys);
  });
});
