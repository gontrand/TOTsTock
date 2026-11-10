import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { APP_VERSION, EXPECTED_SCHEMA_VERSION, MIN_SUPPORTED_SCHEMA_VERSION } from '../appVersion';
import { RECENT_CHANGELOG } from '../data/changelog';
import { TABLES } from '../constants/tables';
import { EDGE_FUNCTIONS, EDGE_FUNCTION_NAMES } from '../constants/edgeFunctions';
import {
  EDGE_FN_BUNDLE_ADMIN_USERS,
  EDGE_FN_BUNDLE_PASSWORD_RESET,
  EDGE_FN_BUNDLE_SEND_REPORT_EMAIL,
  EDGE_FN_BUNDLE_SYNC_LICENSE,
  SQL_SCRIPT_18_PASSWORD_RESET,
  SQL_SCRIPT_07_APP_COMPAT,
} from '../constants/supabaseScripts';
import { CLIENT_EDGE_FUNCTION_ITEMS } from '../components/EdgeFunctionsSetupPanel';
import { SQL_STEPS, verifySqlArtifactsSync } from '../../scripts/build-sql.mjs';
import {
  createPasswordResetHandler,
  hashPasswordResetCode,
  type PasswordResetHandlerDeps,
} from '../../supabase/functions/_shared/passwordResetHandler';
import {
  requestPasswordResetCode,
  confirmPasswordResetCode,
} from '../services/passwordResetService';
import { copyToClipboard } from '../services/clipboard';
import { isAllowedPermissionRequest } from '../../desktop/security.mjs';
import {
  LICENSE_STORAGE_KEY,
  INVALID_LICENSE_KEY_FORMAT_MESSAGE,
  SYNC_SERVICE_UNAVAILABLE_MESSAGE,
  validateLicenseKeyInput,
  verifyLicenseKey,
  syncLicenseToClientDatabase,
  getSavedLicense,
  enforceSignedLicenseQuotasSync,
} from '../services/licenseService';
import type { LicenseInfo } from '../types';

const ROOT_DIR = path.resolve(__dirname, '../..');

const BOOTSTRAP_AUTH_SQL = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS extensions;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin NOLOGIN SUPERUSER;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  encrypted_password text,
  email_confirmed_at timestamptz DEFAULT now(),
  raw_app_meta_data jsonb DEFAULT '{"provider":"email","providers":["email"]}'::jsonb,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  aud text DEFAULT 'authenticated',
  role text DEFAULT 'authenticated',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth.identities (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  identity_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider text NOT NULL DEFAULT 'email',
  provider_id text NOT NULL DEFAULT '',
  last_sign_in_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $fn$
  SELECT NULLIF(
    COALESCE(
      current_setting('request.jwt.claim.sub', true),
      (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid;
$fn$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $fn$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    current_user::text
  );
$fn$;

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $fn$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb,
    jsonb_build_object(
      'sub', current_setting('request.jwt.claim.sub', true),
      'role', current_setting('request.jwt.claim.role', true)
    )
  );
$fn$;

GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt() TO PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  public boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now(),
  metadata jsonb
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
`;

const ORDERED_CLIENT_SCRIPTS = [
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
  '16_audit_trail.sql',
  '17_transferts_valides.sql',
  '18_password_reset.sql',
  '07_app_compat.sql',
];

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

describe('Prompt v55 — Versions 5.16.0 / Schéma 2.10.0, Script 18_password_reset.sql & Bundles Edge (4 fonctions)', () => {
  it('aligne APP_VERSION=5.16.0, EXPECTED_SCHEMA_VERSION=2.10.0, versionCode=12, déclare 18_password_reset.sql dans SQL_STEPS et synchronise les 4 bundles Edge sans createSyncLicenseHandler/createAdminUsersHandler manquants', () => {
    expect(APP_VERSION).toBe('5.16.0');
    expect(EXPECTED_SCHEMA_VERSION).toBe('2.10.0');
    expect(MIN_SUPPORTED_SCHEMA_VERSION).toBe('1.0.0');
    expect(RECENT_CHANGELOG[0].version).toBe('5.16.0');
    expect(RECENT_CHANGELOG[0].schemaVersion).toBe('2.10.0');
    expect(TABLES.passwordResets).toBe('core_password_resets');

    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
    const desktopPkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'desktop/package.json'), 'utf8'));
    const versionCodeJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'android/version-code.json'), 'utf8'));
    const buildGradle = fs.readFileSync(path.join(ROOT_DIR, 'android/app/build.gradle'), 'utf8');

    expect(pkg.version).toBe('5.16.0');
    expect(desktopPkg.version).toBe('5.16.0');
    expect(versionCodeJson.versionCode).toBeGreaterThanOrEqual(12);
    expect(buildGradle).toMatch(/versionCode (1[2-9]|[2-9]\d)/);
    expect(buildGradle).toContain('versionName "5.16.0"');

    const stepNumbers = SQL_STEPS.map((s: any) => String(s.step));
    const idx17 = stepNumbers.indexOf('17');
    const idx18 = stepNumbers.indexOf('18');
    const idx19 = stepNumbers.indexOf('19');
    const idx20 = stepNumbers.indexOf('20');
    const idx21 = stepNumbers.indexOf('21');
    const idx07 = stepNumbers.indexOf('07');
    expect(idx17).toBeGreaterThan(0);
    expect(idx18).toBe(idx17 + 1);
    // v56/v58 : 19 (traçabilité des commandes) et 20 (notifications lues) s'intercalent avant 07
    expect(idx19).toBe(idx18 + 1);
    expect(idx20).toBe(idx19 + 1);
    expect(idx21).toBe(idx20 + 1);
    expect(idx07).toBe(idx21 + 1);

    expect(SQL_SCRIPT_18_PASSWORD_RESET).toContain('CREATE TABLE IF NOT EXISTS public.core_password_resets');
    expect(SQL_SCRIPT_18_PASSWORD_RESET).toContain('CREATE OR REPLACE FUNCTION public.purge_expired_password_resets()');
    expect(SQL_SCRIPT_07_APP_COMPAT).toContain("'core_password_resets'");
    expect(SQL_SCRIPT_07_APP_COMPAT).toContain("'purge_expired_password_resets'");
    expect(SQL_SCRIPT_07_APP_COMPAT).toContain('APP_TOT-Stock_password-reset');

    expect(EDGE_FUNCTION_NAMES).toEqual([
      'APP_TOT-Stock_admin-users',
      'APP_TOT-Stock_licenses_sync-license',
      'APP_TOT-Stock_send-report-email',
      'APP_TOT-Stock_password-reset',
    ]);
    expect(CLIENT_EDGE_FUNCTION_ITEMS).toHaveLength(4);
    expect(EDGE_FN_BUNDLE_PASSWORD_RESET).toContain('createPasswordResetHandler');
    expect(EDGE_FN_BUNDLE_SYNC_LICENSE).toContain('export function createSyncLicenseHandler');
    expect(EDGE_FN_BUNDLE_SYNC_LICENSE).toContain('serve(createSyncLicenseHandler());');
    expect(EDGE_FN_BUNDLE_ADMIN_USERS).toContain('export function createAdminUsersHandler');
    expect(EDGE_FN_BUNDLE_ADMIN_USERS).toContain('serve(createAdminUsersHandler());');
    expect(EDGE_FN_BUNDLE_SEND_REPORT_EMAIL).toContain('export function createSendReportEmailHandler');

    const syncResult = verifySqlArtifactsSync(ROOT_DIR);
    expect(syncResult.errors).toEqual([]);
    expect(syncResult.inSync).toBe(true);
  });

  it(
    'SQL PGlite : exécute 18_password_reset.sql + 07_app_compat.sql (2 passages idempotents), vérifie RLS sur core_password_resets, purge_expired_password_resets réservé à service_role et diagnostic_installation() = OK (2.9.0)',
    async () => {
      const db = new PGlite();
      await db.exec(BOOTSTRAP_AUTH_SQL);
      for (const scriptName of ORDERED_CLIENT_SCRIPTS) {
        const sql = fs.readFileSync(path.join(ROOT_DIR, 'supabase-client', scriptName), 'utf8');
        await db.exec(sql);
      }
      // Second passage idempotent sur 18 et 07
      await db.exec(fs.readFileSync(path.join(ROOT_DIR, 'supabase-client/18_password_reset.sql'), 'utf8'));
      await db.exec(fs.readFileSync(path.join(ROOT_DIR, 'supabase-client/07_app_compat.sql'), 'utf8'));

      const diagRes = await db.query<{
        check_key: string;
        status: string;
        details: string;
      }>(`SELECT check_key, status, details FROM public.diagnostic_installation();`);

      const compatRow = diagRes.rows.find((r) => r.check_key === 'app_compat');
      const rlsRow = diagRes.rows.find((r) => r.check_key === 'tables_rls');
      const sensitiveRow = diagRes.rows.find((r) => r.check_key === 'sensitive_functions');
      expect(compatRow?.status).toBe('OK');
      expect(compatRow?.details).toContain('2.10.0');
      expect(rlsRow?.status).toBe('OK');
      expect(sensitiveRow?.status).toBe('OK');

      const compatTableRes = await db.query<{ schema_version: string; latest_version: string }>(
        `SELECT schema_version, latest_version FROM public.core_app_compat WHERE id = 1;`
      );
      expect(compatTableRes.rows[0]?.schema_version).toBe('2.10.0');
      expect(compatTableRes.rows[0]?.latest_version).toBe('5.16.0');

      // Insérer deux lignes dans core_password_resets (une expirée depuis 2h, une récente)
      await db.exec(`
        INSERT INTO public.core_password_resets (user_id, email, code_hash, expires_at, created_at)
        VALUES
          ('u-1', 'expired@tot.local', 'hash_expired', now() - interval '2 hours', now() - interval '3 hours'),
          ('u-2', 'fresh@tot.local', 'hash_fresh', now() + interval '15 minutes', now());
      `);

      // anon et authenticated ne doivent avoir aucun droit sur purge_expired_password_resets()
      const anonExecRes = await db.query<{ can_exec: boolean }>(`
        SELECT has_function_privilege('anon', 'public.purge_expired_password_resets()', 'EXECUTE') AS can_exec;
      `);
      const authExecRes = await db.query<{ can_exec: boolean }>(`
        SELECT has_function_privilege('authenticated', 'public.purge_expired_password_resets()', 'EXECUTE') AS can_exec;
      `);
      const srvExecRes = await db.query<{ can_exec: boolean }>(`
        SELECT has_function_privilege('service_role', 'public.purge_expired_password_resets()', 'EXECUTE') AS can_exec;
      `);
      expect(anonExecRes.rows[0]?.can_exec).toBe(false);
      expect(authExecRes.rows[0]?.can_exec).toBe(false);
      expect(srvExecRes.rows[0]?.can_exec).toBe(true);

      // Exécuter purge_expired_password_resets() en tant que service_role
      await db.exec(`SELECT public.purge_expired_password_resets();`);
      const remaining = await db.query<{ email: string }>(`SELECT email FROM public.core_password_resets;`);
      expect(remaining.rows.map((r) => r.email)).toEqual(['fresh@tot.local']);

      await db.close();
    },
    120_000
  );
});

describe('Prompt v55 — Partie A : Handler APP_TOT-Stock_password-reset & passwordResetService', () => {
  interface MockResetRow {
    id: string;
    user_id: string;
    email: string;
    code_hash: string;
    expires_at: string;
    attempts: number;
    used_at: string | null;
    created_at: string;
  }

  function createFakeResetEnvironment(options?: {
    missingTable?: boolean;
    mailConfigError?: string;
    fixedCode?: string;
  }) {
    const users = [
      {
        id: 'usr-active-1',
        name: 'Alice Martin',
        email: 'alice@tot.local',
        is_blocked: false,
        auth_user_id: '00000000-0000-4000-8000-000000000111',
        must_change_pin: true,
      },
      {
        id: 'usr-blocked-2',
        name: 'Bob Bloqué',
        email: 'blocked@tot.local',
        is_blocked: true,
        auth_user_id: '00000000-0000-4000-8000-000000000222',
        must_change_pin: false,
      },
    ];

    const resets: MockResetRow[] = [];
    const mailLogs: Array<Record<string, unknown>> = [];
    const auditLogs: Array<Record<string, unknown>> = [];
    const sentEmails: Array<{ to: string; subject: string; html: string }> = [];
    const updatedAuthPasswords: Array<{ authUserId: string; password: string }> = [];
    const signedOutUsers: Array<{ authUserId: string; scope?: string }> = [];

    const adminClient = {
      rpc: vi.fn(async (fnName: string) => {
        if (fnName === 'purge_expired_password_resets') {
          if (options?.missingTable) {
            return {
              data: null,
              error: { code: '42P01', message: 'relation "public.core_password_resets" does not exist' },
            };
          }
          return { data: null, error: null };
        }
        if (fnName === 'get_mail_config') {
          if (options?.mailConfigError) {
            return { data: { error: options.mailConfigError }, error: null };
          }
          return {
            data: {
              account_id: 'acc-1',
              provider: 'brevo',
              from_email: 'stock@tot.local',
              from_name: 'TOT Stock',
              reply_to: null,
              secret: 'xkeysib-test-secret',
              extra: {},
            },
            error: null,
          };
        }
        return { data: null, error: null };
      }),
      from: vi.fn((table: string) => {
        if (table === 'core_password_resets' && options?.missingTable) {
          return {
            select: () => ({
              eq: () => ({
                gte: async () => ({
                  count: null,
                  error: { code: '42P01', message: 'relation "public.core_password_resets" does not exist' },
                }),
                is: () => ({
                  gt: () => ({
                    order: () => ({
                      limit: async () => ({
                        data: null,
                        error: { code: '42P01', message: 'relation "public.core_password_resets" does not exist' },
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }

        if (table === 'core_users') {
          return {
            select: () => ({
              ilike: (_col: string, val: string) => ({
                limit: async () => {
                  const found = users.filter((u) => u.email.toLowerCase() === String(val).toLowerCase());
                  return { data: found, error: null };
                },
              }),
            }),
            update: (patch: Record<string, unknown>) => ({
              eq: async (_col: string, idVal: string) => {
                const target = users.find((u) => u.id === idVal);
                if (target && 'must_change_pin' in patch) {
                  target.must_change_pin = Boolean(patch.must_change_pin);
                }
                return { error: null };
              },
            }),
          };
        }

        if (table === 'core_password_resets') {
          return {
            select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
              if (opts?.head) {
                return {
                  eq: (_c1: string, emailVal: string) => ({
                    gte: async (_c2: string, sinceIso: string) => {
                      const sinceMs = new Date(sinceIso).getTime();
                      const count = resets.filter(
                        (r) => r.email === emailVal && new Date(r.created_at).getTime() >= sinceMs
                      ).length;
                      return { count, error: null };
                    },
                  }),
                };
              }
              return {
                eq: (_c1: string, emailVal: string) => ({
                  is: (_c2: string, _nullVal: null) => ({
                    gt: (_c3: string, nowIso: string) => ({
                      order: () => ({
                        limit: async () => {
                          const nowMs = new Date(nowIso).getTime();
                          const active = resets
                            .filter(
                              (r) =>
                                r.email === emailVal &&
                                r.used_at === null &&
                                new Date(r.expires_at).getTime() > nowMs
                            )
                            .sort(
                              (a, b) =>
                                new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                            );
                          return { data: active.slice(0, 1), error: null };
                        },
                      }),
                    }),
                  }),
                }),
              };
            },
            update: (patch: Record<string, unknown>) => ({
              eq: (_c1: string, val1: string) => {
                if (_c1 === 'id') {
                  const row = resets.find((r) => r.id === val1);
                  if (row) {
                    if ('attempts' in patch) row.attempts = Number(patch.attempts);
                    if ('used_at' in patch) row.used_at = String(patch.used_at);
                  }
                  return Promise.resolve({ error: null });
                }
                return {
                  is: async () => {
                    for (const r of resets) {
                      if (r.email === val1 && r.used_at === null && 'used_at' in patch) {
                        r.used_at = String(patch.used_at);
                      }
                    }
                    return { error: null };
                  },
                };
              },
            }),
            insert: async (payload: Record<string, unknown>) => {
              resets.push({
                id: `rst-${resets.length + 1}`,
                user_id: String(payload.user_id),
                email: String(payload.email),
                code_hash: String(payload.code_hash),
                expires_at: String(payload.expires_at),
                attempts: Number(payload.attempts ?? 0),
                used_at: null,
                created_at: new Date().toISOString(),
              });
              return { error: null };
            },
          };
        }

        if (table === 'core_mail_log') {
          return {
            insert: async (payload: Record<string, unknown>) => {
              mailLogs.push(payload);
              return { error: null };
            },
          };
        }

        if (table === 'core_audit_logs') {
          return {
            insert: async (payload: Record<string, unknown>) => {
              auditLogs.push(payload);
              return { error: null };
            },
          };
        }

        return {};
      }),
      auth: {
        admin: {
          updateUserById: vi.fn(async (uid: string, attrs: { password: string }) => {
            updatedAuthPasswords.push({ authUserId: uid, password: attrs.password });
            return { data: { user: { id: uid } }, error: null };
          }),
          signOut: vi.fn(async (uid: string, scope?: string) => {
            signedOutUsers.push({ authUserId: uid, scope });
            return { error: null };
          }),
        },
      },
    };

    const deps: PasswordResetHandlerDeps = {
      getEnv: (k: string) => {
        if (k === 'SUPABASE_URL') return 'https://test.supabase.co';
        if (k === 'SUPABASE_SERVICE_ROLE_KEY') return 'service-role-key';
        return undefined;
      },
      createAdminClient: () => adminClient as any,
      generateSixDigitCode: () => options?.fixedCode || '482915',
      fetchImpl: vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        sentEmails.push({
          to: body.to?.[0]?.email || '',
          subject: body.subject || '',
          html: body.htmlContent || '',
        });
        return new Response(JSON.stringify({ messageId: 'msg-reset-1' }), { status: 201 });
      }) as any,
    };

    return {
      handler: createPasswordResetHandler(deps),
      users,
      resets,
      mailLogs,
      auditLogs,
      sentEmails,
      updatedAuthPasswords,
      signedOutUsers,
    };
  }

  it('répond à { action: "ping" } avec { success: true, status: "ok" }', async () => {
    const { handler } = createFakeResetEnvironment();
    const res = await handler(
      new Request('https://test.supabase.co/functions/v1/APP_TOT-Stock_password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ping' }),
      })
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true, status: 'ok' });
  });

  it('action="request" : renvoie toujours la même réponse générique (compte existant, inconnu ou bloqué), applique la limite 3/15min et ne journalise jamais le code en clair dans core_audit_logs', async () => {
    const env = createFakeResetEnvironment({ fixedCode: '654321' });

    // 1. Compte inconnu -> réponse générique, aucun e-mail envoyé
    const resUnknown = await env.handler(
      new Request('https://test.supabase.co/functions/v1/APP_TOT-Stock_password-reset', {
        method: 'POST',
        body: JSON.stringify({ action: 'request', email: 'inconnu@tot.local' }),
      })
    );
    expect(resUnknown.status).toBe(200);
    await expect(resUnknown.json()).resolves.toEqual({
      success: true,
      message: 'Si ce compte existe, un code a été envoyé.',
    });
    expect(env.sentEmails).toHaveLength(0);
    expect(env.resets).toHaveLength(0);

    // 2. Compte bloqué -> même réponse générique, aucun e-mail envoyé
    const resBlocked = await env.handler(
      new Request('https://test.supabase.co/functions/v1/APP_TOT-Stock_password-reset', {
        method: 'POST',
        body: JSON.stringify({ action: 'request', email: 'blocked@tot.local' }),
      })
    );
    expect(resBlocked.status).toBe(200);
    await expect(resBlocked.json()).resolves.toEqual({
      success: true,
      message: 'Si ce compte existe, un code a été envoyé.',
    });
    expect(env.sentEmails).toHaveLength(0);

    // 3. Compte actif -> envoie l'e-mail, stocke uniquement le SHA-256(code + ':' + lower(email)) et trace PASSWORD_RESET_REQUESTED sans code
    const resActive1 = await env.handler(
      new Request('https://test.supabase.co/functions/v1/APP_TOT-Stock_password-reset', {
        method: 'POST',
        body: JSON.stringify({ action: 'request', email: '  ALICE@tot.local ' }),
      })
    );
    expect(resActive1.status).toBe(200);
    await expect(resActive1.json()).resolves.toEqual({
      success: true,
      message: 'Si ce compte existe, un code a été envoyé.',
    });
    expect(env.sentEmails).toHaveLength(1);
    expect(env.sentEmails[0].to).toBe('alice@tot.local');
    expect(env.sentEmails[0].subject).toBe('TOT Stock — Code de réinitialisation de votre mot de passe');
    expect(env.sentEmails[0].html).toContain('654321');
    expect(env.resets).toHaveLength(1);

    const expectedHash = await hashPasswordResetCode('654321', 'alice@tot.local');
    expect(env.resets[0].code_hash).toBe(expectedHash);
    expect(env.resets[0].code_hash).not.toContain('654321');

    expect(env.auditLogs).toHaveLength(1);
    expect(env.auditLogs[0].action).toBe('PASSWORD_RESET_REQUESTED');
    expect(JSON.stringify(env.auditLogs[0])).not.toContain('654321');

    // 4. Rate limit : 2e et 3e demandes passent, la 4e en moins de 15 min ne renvoie pas d'e-mail mais retourne la même réponse générique
    await env.handler(
      new Request('https://test.supabase.co/functions/v1/APP_TOT-Stock_password-reset', {
        method: 'POST',
        body: JSON.stringify({ action: 'request', email: 'alice@tot.local' }),
      })
    );
    await env.handler(
      new Request('https://test.supabase.co/functions/v1/APP_TOT-Stock_password-reset', {
        method: 'POST',
        body: JSON.stringify({ action: 'request', email: 'alice@tot.local' }),
      })
    );
    expect(env.sentEmails).toHaveLength(3);

    const resFourth = await env.handler(
      new Request('https://test.supabase.co/functions/v1/APP_TOT-Stock_password-reset', {
        method: 'POST',
        body: JSON.stringify({ action: 'request', email: 'alice@tot.local' }),
      })
    );
    expect(resFourth.status).toBe(200);
    await expect(resFourth.json()).resolves.toEqual({
      success: true,
      message: 'Si ce compte existe, un code a été envoyé.',
    });
    expect(env.sentEmails).toHaveLength(3);
  });

  it('action="request" : renvoie des messages explicites si core_password_resets est absente (42P01) ou si le mailing n’est pas configuré', async () => {
    const envNoTable = createFakeResetEnvironment({ missingTable: true });
    const resNoTable = await envNoTable.handler(
      new Request('https://test.supabase.co/functions/v1/APP_TOT-Stock_password-reset', {
        method: 'POST',
        body: JSON.stringify({ action: 'request', email: 'alice@tot.local' }),
      })
    );
    expect(resNoTable.status).toBe(500);
    const jsonNoTable = await resNoTable.json();
    expect(jsonNoTable.error).toContain('Table core_password_resets absente — exécutez install_v55.sql');

    const envNoMail = createFakeResetEnvironment({ mailConfigError: 'NO_MAIL_ACCOUNT' });
    const resNoMail = await envNoMail.handler(
      new Request('https://test.supabase.co/functions/v1/APP_TOT-Stock_password-reset', {
        method: 'POST',
        body: JSON.stringify({ action: 'request', email: 'alice@tot.local' }),
      })
    );
    expect(resNoMail.status).toBe(500);
    const jsonNoMail = await resNoMail.json();
    expect(jsonNoMail.error).toContain(
      "Envoi d'e-mail non configuré — demandez à votre administrateur de réinitialiser votre mot de passe ou de configurer Paramètres > E-mail"
    );
  });

  it('action="confirm" : bloque après 5 tentatives erronées, valide un code correct, révoque les sessions, remet must_change_pin=false et trace PASSWORD_RESET_COMPLETED sans secret', async () => {
    const env = createFakeResetEnvironment({ fixedCode: '739204' });

    // Demander un premier code
    await env.handler(
      new Request('https://test.supabase.co/functions/v1/APP_TOT-Stock_password-reset', {
        method: 'POST',
        body: JSON.stringify({ action: 'request', email: 'alice@tot.local' }),
      })
    );
    expect(env.resets[0].used_at).toBeNull();

    // Mot de passe trop court (< 6) -> rejeté avant de consommer une tentative
    const resShort = await env.handler(
      new Request('https://test.supabase.co/functions/v1/APP_TOT-Stock_password-reset', {
        method: 'POST',
        body: JSON.stringify({
          action: 'confirm',
          email: 'alice@tot.local',
          code: '739204',
          newPassword: '123',
        }),
      })
    );
    expect(resShort.status).toBe(400);
    expect(env.resets[0].attempts).toBe(0);

    // 5 tentatives erronées -> verrouillage du code (used_at renseigné à la 5e)
    for (let i = 1; i <= 5; i++) {
      const resBad = await env.handler(
        new Request('https://test.supabase.co/functions/v1/APP_TOT-Stock_password-reset', {
          method: 'POST',
          body: JSON.stringify({
            action: 'confirm',
            email: 'alice@tot.local',
            code: '000000',
            newPassword: 'NewSecurePassword1!',
          }),
        })
      );
      expect(resBad.status).toBe(400);
      await expect(resBad.json()).resolves.toEqual({
        success: false,
        error: 'Code invalide ou expiré',
      });
      expect(env.resets[0].attempts).toBe(i);
    }
    expect(env.resets[0].used_at).not.toBeNull();

    // Même avec le bon code ensuite, il est désormais verrouillé
    const resAfterLock = await env.handler(
      new Request('https://test.supabase.co/functions/v1/APP_TOT-Stock_password-reset', {
        method: 'POST',
        body: JSON.stringify({
          action: 'confirm',
          email: 'alice@tot.local',
          code: '739204',
          newPassword: 'NewSecurePassword1!',
        }),
      })
    );
    expect(resAfterLock.status).toBe(400);

    // Demander un nouveau code et le confirmer avec succès
    await env.handler(
      new Request('https://test.supabase.co/functions/v1/APP_TOT-Stock_password-reset', {
        method: 'POST',
        body: JSON.stringify({ action: 'request', email: 'alice@tot.local' }),
      })
    );
    const resConfirmOk = await env.handler(
      new Request('https://test.supabase.co/functions/v1/APP_TOT-Stock_password-reset', {
        method: 'POST',
        body: JSON.stringify({
          action: 'confirm',
          email: 'alice@tot.local',
          code: '739204',
          newPassword: 'NewSecurePassword1!',
        }),
      })
    );
    expect(resConfirmOk.status).toBe(200);
    await expect(resConfirmOk.json()).resolves.toEqual({ success: true });

    expect(env.updatedAuthPasswords).toEqual([
      {
        authUserId: '00000000-0000-4000-8000-000000000111',
        password: 'NewSecurePassword1!',
      },
    ]);
    expect(env.signedOutUsers).toEqual([
      {
        authUserId: '00000000-0000-4000-8000-000000000111',
        scope: 'global',
      },
    ]);
    expect(env.users[0].must_change_pin).toBe(false);

    const completedAudit = env.auditLogs.find((a) => a.action === 'PASSWORD_RESET_COMPLETED');
    expect(completedAudit).toBeDefined();
    expect(JSON.stringify(completedAudit)).not.toContain('739204');
    expect(JSON.stringify(completedAudit)).not.toContain('NewSecurePassword1!');
  });

  it('passwordResetService : affiche un message clair si la fonction Edge renvoie 404 (non déployée)', async () => {
    const fakeClient404 = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
      functions: {
        invoke: vi.fn(async () => ({
          data: null,
          error: {
            message: 'Requested function was not found',
            context: { status: 404 },
          },
        })),
      },
    };

    const reqRes = await requestPasswordResetCode(fakeClient404, 'alice@tot.local');
    expect(reqRes.success).toBe(false);
    expect(reqRes.message).toContain('APP_TOT-Stock_password-reset');
    expect(reqRes.message).toContain('non déployée');

    const confRes = await confirmPasswordResetCode(
      fakeClient404,
      'alice@tot.local',
      '123456',
      'Secret123!'
    );
    expect(confRes.success).toBe(false);
    expect(confRes.message).toContain('APP_TOT-Stock_password-reset');
    expect(confRes.message).toContain('non déployée');
  });
});

describe('Prompt v55 — Partie B.1 & B.2 : Presse-papiers Desktop (copyToClipboard & security.mjs)', () => {
  it('autorise clipboard-sanitized-write pour l’origine app://tot mais refuse toujours clipboard-read', () => {
    expect(isAllowedPermissionRequest('clipboard-sanitized-write', 'app://tot/index.html')).toBe(true);
    expect(isAllowedPermissionRequest('media', 'app://tot/index.html')).toBe(true);
    expect(isAllowedPermissionRequest('clipboard-read', 'app://tot/index.html')).toBe(false);
    expect(isAllowedPermissionRequest('clipboard-sanitized-write', 'https://evil.example.com')).toBe(false);
  });

  it('copyToClipboard : chaîne de priorité (1) window.totDesktop.copyText -> (2) navigator.clipboard.writeText -> (3) execCommand("copy"), retourne false sur chaîne vide et ne lève jamais d’exception', async () => {
    const g = globalThis as any;
    const prevWindow = g.window;
    const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const prevDocument = g.document;

    try {
      g.window = g.window || {};
      const mockNav: any = {};
      Object.defineProperty(globalThis, 'navigator', {
        value: mockNav,
        configurable: true,
        writable: true,
      });

      // Chaîne vide -> false
      await expect(copyToClipboard('')).resolves.toBe(false);

      // 1. Priorité Electron IPC
      const ipcCopyMock = vi.fn(async (t: string) => ({ ok: true, len: t.length }));
      g.window.totDesktop = { copyText: ipcCopyMock };
      await expect(copyToClipboard('Texte Desktop IPC')).resolves.toBe(true);
      expect(ipcCopyMock).toHaveBeenCalledWith('Texte Desktop IPC');

      // 2. Repli sur navigator.clipboard.writeText si Electron IPC échoue
      g.window.totDesktop = {
        copyText: vi.fn(async () => {
          throw new Error('IPC indisponible');
        }),
      };
      const writeTextMock = vi.fn(async () => undefined);
      mockNav.clipboard = { writeText: writeTextMock };
      await expect(copyToClipboard('Texte Web Clipboard')).resolves.toBe(true);
      expect(writeTextMock).toHaveBeenCalledWith('Texte Web Clipboard');

      // 3. Repli sur document.execCommand('copy') si navigator.clipboard rejette
      mockNav.clipboard = {
        writeText: vi.fn(async () => {
          throw new Error('NotAllowedError');
        }),
      };
      const execCommandMock = vi.fn(() => true);
      const fakeTextarea = {
        value: '',
        setAttribute: vi.fn(),
        style: {},
        focus: vi.fn(),
        select: vi.fn(),
        setSelectionRange: vi.fn(),
      };
      g.document = {
        createElement: vi.fn(() => fakeTextarea),
        body: {
          appendChild: vi.fn(),
          removeChild: vi.fn(),
        },
        execCommand: execCommandMock,
      };
      await expect(copyToClipboard('Texte Fallback Textarea')).resolves.toBe(true);
      expect(execCommandMock).toHaveBeenCalledWith('copy');
    } finally {
      g.window = prevWindow;
      if (prevNavigatorDesc) {
        Object.defineProperty(globalThis, 'navigator', prevNavigatorDesc);
      }
      g.document = prevDocument;
    }
  });

  it('vérifie qu’aucun appel direct à navigator.clipboard.writeText ne subsiste dans src/ hors de src/services/clipboard.ts', () => {
    function walkTsFiles(dir: string): string[] {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '__tests__') continue;
          files.push(...walkTsFiles(full));
        } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
          files.push(full);
        }
      }
      return files;
    }

    const srcFiles = walkTsFiles(path.join(ROOT_DIR, 'src'));
    const offenders: string[] = [];
    for (const file of srcFiles) {
      const rel = path.relative(ROOT_DIR, file).replace(/\\/g, '/');
      if (rel === 'src/services/clipboard.ts') continue;
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes('navigator.clipboard.writeText')) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('Prompt v55 — Partie B.3 : Validation de clé de licence & Non-rétrogradation en FREE sur erreur réseau/Edge', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
  });

  it('validateLicenseKeyInput : trim les espaces/retours chariot, rejette vide, URL, SQL, texte long ou multi-lignes avec "Ceci n\'est pas une clé de licence", et accepte TOT-PRO-...', () => {
    expect(validateLicenseKeyInput('   ').valid).toBe(false);
    expect(validateLicenseKeyInput('   ').error).toBe(INVALID_LICENSE_KEY_FORMAT_MESSAGE);

    expect(validateLicenseKeyInput('https://monprojet.supabase.co').valid).toBe(false);
    expect(validateLicenseKeyInput('https://monprojet.supabase.co').error).toBe(
      INVALID_LICENSE_KEY_FORMAT_MESSAGE
    );

    expect(validateLicenseKeyInput('CREATE TABLE public.stk_products (id text);').valid).toBe(false);
    expect(validateLicenseKeyInput('CREATE TABLE public.stk_products (id text);').error).toBe(
      INVALID_LICENSE_KEY_FORMAT_MESSAGE
    );

    expect(validateLicenseKeyInput('TOT-PRO-1234\nTOT-PRO-5678').valid).toBe(false);
    expect(validateLicenseKeyInput('A'.repeat(65)).valid).toBe(false);

    const validRes = validateLicenseKeyInput('  \n TOT-PRO-2026-ABCD-9876 \r\n ');
    expect(validRes).toEqual({
      valid: true,
      cleanKey: 'TOT-PRO-2026-ABCD-9876',
    });
  });

  it('ne rétrograde JAMAIS une licence PRO signée valide en FREE si la fonction Edge sync-license renvoie 404/500 ou une erreur réseau', async () => {
    const futureIso = new Date(Date.now() + 30 * 86400 * 1000).toISOString();
    const proLicense: LicenseInfo = {
      license_key: 'TOT-STOCK-PRO-2026-KEEP',
      organization_name: 'Entreprise Test PRO',
      client_supabase_url: 'https://client-test.supabase.co',
      plan: 'pro',
      plan_type: 'pro',
      modules: ['stock'],
      max_depots: 10,
      max_references: 1000,
      is_active: true,
      created_at: new Date().toISOString(),
      expires_at: futureIso,
      last_verified_at: new Date().toISOString(),
      status: 'valid',
      signed_token: {
        token_version: 5,
        kid: 'v1',
        license_key: 'TOT-STOCK-PRO-2026-KEEP',
        organization_name: 'Entreprise Test PRO',
        client_supabase_url: 'https://client-test.supabase.co',
        plan: 'pro',
        modules: ['stock'],
        max_depots: 10,
        issued_at: new Date().toISOString(),
        expires_at: futureIso,
        offline_until: futureIso,
        signature: 'ed25519_sig_valid_keep_pro_token',
        raw_token: 'v1.ed25519_sig_valid_keep_pro_token',
      },
    };
    localStorage.setItem(LICENSE_STORAGE_KEY, JSON.stringify(proLicense));

    // 1. Saisie invalide (ex: URL collée par erreur) -> rejet immédiat sans toucher à la licence PRO enregistrée
    const badInputRes = await verifyLicenseKey('https://bad-paste.supabase.co', 'https://client-test.supabase.co');
    expect(badInputRes.success).toBe(false);
    expect(badInputRes.message).toBe("Ceci n'est pas une clé de licence");
    expect(enforceSignedLicenseQuotasSync(getSavedLicense()).plan).toBe('pro');
    expect(enforceSignedLicenseQuotasSync(getSavedLicense()).max_depots).toBe(10);

    // 2. Appel syncLicenseToClientDatabase alors que la fonction Edge renvoie 500
    const fakeClient500 = {
      auth: {
        getSession: async () => ({
          data: { session: { access_token: 'jwt-token', user: { id: 'u-1' } } },
          error: null,
        }),
      },
      functions: {
        invoke: vi.fn(async () => ({
          data: null,
          error: {
            message: 'Edge Function returned a non-2xx status code (500)',
            context: { status: 500 },
          },
        })),
      },
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
          limit: async () => ({ data: [], error: null }),
        }),
        upsert: async () => ({ error: null }),
      })),
    };

    const syncRes = await syncLicenseToClientDatabase(proLicense, fakeClient500 as any);
    expect(syncRes.success).toBe(false);
    expect(syncRes.message).toContain(SYNC_SERVICE_UNAVAILABLE_MESSAGE);

    const savedAfter = getSavedLicense();
    const quotasAfter = enforceSignedLicenseQuotasSync(savedAfter);
    expect(quotasAfter.plan).toBe('pro');
    expect(quotasAfter.max_depots).toBe(10);
    expect(quotasAfter.max_references).toBe(1000);
    expect(savedAfter.signed_token).toBeTruthy();
  });
});
