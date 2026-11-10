import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import {
  APP_VERSION,
  EXPECTED_SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
} from '../appVersion';
import { TABLES, SUITE_MAIL_APPLICATIONS, CURRENT_MAIL_APP_CODE } from '../constants/tables';
import {
  SQL_SCRIPT_14_MAILING,
  SQL_SCRIPT_07_APP_COMPAT,
} from '../constants/supabaseScripts';
import { SQL_STEPS, verifySqlArtifactsSync } from '../../scripts/build-sql.mjs';
import { RECENT_CHANGELOG } from '../data/changelog';
import { translations } from '../i18n/translations';
import {
  MSGRAPH_MAX_ATTACHMENT_BYTES,
  clearMsGraphTokenCache,
  maskEmailRecipient,
  maskEmailRecipientList,
  sanitizeAndTranslateMailError,
  sendMailWithProvider,
  ResolvedMailConfig,
} from '../../supabase/functions/_shared/mailProviders';
import {
  MAX_EMAILS_PER_USER_PER_HOUR,
  VALID_MAIL_KINDS,
  buildMailLogInsertPayload,
  createSendReportEmailHandler,
  normalizeMailKind,
  parseAndValidateRecipients,
} from '../../supabase/functions/_shared/sendReportEmailHandler';
import {
  MAIL_ADMIN_ROLE_IDS,
  MAIL_PROVIDER_PRESETS,
  canUserManageMailSettings,
  checkSenderDomainMismatch,
  evaluateMsGraphSecretExpiry,
  extractEdgeFunctionError,
  isValidEmailAddress,
  isValidGuid,
  isValidMsGraphTenant,
  requiresVerifiedSenderReminder,
  sendTestEmailRequest,
} from '../services/mailingService';
import {
  evaluateDbSchemaStatus,
  extractSafeSupabaseHost,
  formatDiagnosticSupportSummary,
} from '../components/AboutAppPanel';

const ROOT_DIR = path.resolve(__dirname, '../..');

const AUTH_STUB_SQL = `
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

/**
 * Simule l'extension officielle Supabase Vault dans PGlite pour les tests « base avec Vault ».
 */
const VAULT_EXTENSION_STUB_SQL = `
  CREATE SCHEMA IF NOT EXISTS vault;
  CREATE TABLE IF NOT EXISTS vault.secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE,
    description TEXT DEFAULT '',
    secret TEXT NOT NULL,
    key_id UUID,
    nonce BYTEA,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE OR REPLACE VIEW vault.decrypted_secrets AS
    SELECT id, name, description, secret, secret AS decrypted_secret, key_id, nonce, created_at, updated_at
    FROM vault.secrets;

  CREATE OR REPLACE FUNCTION vault.create_secret(
    new_secret TEXT,
    new_name TEXT DEFAULT NULL,
    new_description TEXT DEFAULT ''
  ) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
  DECLARE
    v_id UUID;
  BEGIN
    INSERT INTO vault.secrets (name, description, secret, updated_at)
    VALUES (new_name, COALESCE(new_description, ''), new_secret, now())
    ON CONFLICT (name) DO UPDATE
      SET secret = EXCLUDED.secret,
          description = EXCLUDED.description,
          updated_at = now()
    RETURNING id INTO v_id;
    RETURN v_id;
  END;
  $$;

  CREATE OR REPLACE FUNCTION vault.update_secret(
    secret_id UUID,
    new_secret TEXT DEFAULT NULL,
    new_name TEXT DEFAULT NULL,
    new_description TEXT DEFAULT ''
  ) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
  BEGIN
    UPDATE vault.secrets
    SET secret = COALESCE(new_secret, secret),
        name = COALESCE(new_name, name),
        description = COALESCE(new_description, description),
        updated_at = now()
    WHERE id = secret_id;
  END;
  $$;
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

describe('Prompt v50 & v51 — LOT 1 : Cohérence des versions (5.16.0 / 2.10.0), en-têtes SQL 00..18 et build:sql --check', () => {
  it('aligne APP_VERSION=5.16.0, EXPECTED_SCHEMA_VERSION=2.10.0, MIN_SUPPORTED_SCHEMA_VERSION=1.0.0 et déclare le script 14 dans SQL_STEPS, supabaseScripts, INSTALL.md et les traductions FR/EN/NL', () => {
    expect(APP_VERSION).toBe('5.16.2');
    expect(EXPECTED_SCHEMA_VERSION).toBe('2.10.0');
    expect(MIN_SUPPORTED_SCHEMA_VERSION).toBe('1.0.0');

    expect(TABLES.mailAccounts).toBe('core_mail_accounts');
    expect(TABLES.mailSenders).toBe('core_mail_senders');
    expect(TABLES.mailLog).toBe('core_mail_log');
    expect(CURRENT_MAIL_APP_CODE).toBe('stk');
    expect(SUITE_MAIL_APPLICATIONS.map((a) => a.code)).toEqual(['stk', 'hab', 'rpt', 'tools']);

    const stepNumbers = SQL_STEPS.map((s: any) => String(s.step));
    const idx13 = stepNumbers.indexOf('13');
    const idx14 = stepNumbers.indexOf('14');
    const idx07 = stepNumbers.indexOf('07');
    expect(idx13).toBeGreaterThan(0);
    expect(idx14).toBe(idx13 + 1);
    expect(idx07).toBeGreaterThan(idx14);

    expect(SQL_SCRIPT_14_MAILING).toContain('CREATE TABLE IF NOT EXISTS public.core_mail_accounts');
    expect(SQL_SCRIPT_14_MAILING).toContain('CREATE TABLE IF NOT EXISTS public.core_mail_senders');
    expect(SQL_SCRIPT_14_MAILING).toContain('CREATE TABLE IF NOT EXISTS public.core_mail_log');
    expect(SQL_SCRIPT_14_MAILING).toContain("'msgraph'");
    expect(SQL_SCRIPT_14_MAILING).toContain('core_mail_accounts_msgraph_extra_chk');
    // Ne doit jamais créer un schéma vault de secours ni une table vault.secrets non chiffrée
    expect(SQL_SCRIPT_14_MAILING).not.toMatch(/CREATE\s+SCHEMA\s+IF\s+NOT\s+EXISTS\s+vault/i);
    expect(SQL_SCRIPT_14_MAILING).not.toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+vault\.secrets/i);
    expect(SQL_SCRIPT_14_MAILING).toContain(
      "Supabase Vault indisponible : activez l''extension Vault (Database > Extensions)"
    );
    expect(SQL_SCRIPT_07_APP_COMPAT).toContain("'mailing_module'");

    const installMd = fs.readFileSync(path.join(ROOT_DIR, 'supabase-client/INSTALL.md'), 'utf8');
    expect(installMd).toContain('14_mailing.sql');
    expect(installMd).toContain('2.10.0');
    expect(installMd).toContain('5.16.0');

    expect(translations.fr.sql_script_14_title).toContain('14_mailing.sql');
    expect(translations.en.sql_script_14_title).toContain('14_mailing.sql');
    expect(translations.nl.sql_script_14_title).toContain('14_mailing.sql');
  });

  it('uniformise les en-têtes des scripts SQL 00 à 14 (numéro, rôle, ordre d’exécution, idempotence)', () => {
    const scriptsWithHeaders = [
      '00_complete_tot_stock_schema.sql',
      '01_auth_link.sql',
      '01b_migrate_users_id_to_text.sql',
      '02_rls_hardening.sql',
      '03_rpc_stock_and_orders.sql',
      '04_mouvements_et_depots_vehicules.sql',
      '05_rpc_admin_users.sql',
      '06_install_additional_roles.sql',
      '07_app_compat.sql',
      '08_print_jobs.sql',
      '09_core_prefixes.sql',
      '10_drop_compat_views.sql',
      '11_suite_tables.sql',
      '12_user_preferences.sql',
      '13_transfer_stock_batch.sql',
      '14_mailing.sql',
    ];

    for (const file of scriptsWithHeaders) {
      const content = fs.readFileSync(path.join(ROOT_DIR, 'supabase-client', file), 'utf8');
      const firstLines = content.split('\n').slice(0, 25).join('\n');
      expect(firstLines).toMatch(/-- ={60,}/);
      expect(firstLines).toMatch(/Idempotent|Rejouable\s*:\s*oui/i);
    }
  });

  it('vérifie que dist/install.sql, supabase/migrations/ et supabase-client/generated/edge-functions*/ sont synchronisés (build:sql --check)', () => {
    const syncResult = verifySqlArtifactsSync(ROOT_DIR);
    expect(syncResult.errors).toEqual([]);
    expect(syncResult.inSync).toBe(true);
  });
});

describe('Prompt v50 & v51 — LOT 1 & 2.1 : Tests SQL PGlite de 14_mailing.sql (Vault, service_role via request.jwt.claims, msgraph extra validation, core_mail_log & 30/h)', () => {
  it(
    'base SANS Vault : 14_mailing.sql s’exécute 2 fois sans erreur, ne crée aucune table vault de secours et lève « Supabase Vault indisponible : activez l’extension Vault (Database > Extensions) » lors de set_mail_account_secret',
    async () => {
      const db = new PGlite();
      await db.exec(AUTH_STUB_SQL);

      for (const s of ORDERED_CLIENT_SCRIPTS) {
        await db.exec(fs.readFileSync(path.join(ROOT_DIR, 'supabase-client', s), 'utf8'));
      }
      // 2e exécution idempotente sans Vault
      await db.exec(fs.readFileSync(path.join(ROOT_DIR, 'supabase-client/14_mailing.sql'), 'utf8'));

      // Vérifier qu'aucun schéma vault de secours n'a été créé
      const vaultSchemaRes = await db.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'vault';`
      );
      expect(vaultSchemaRes.rows.length).toBe(0);

      // Créer un compte e-mail et un admin (rôle 0)
      const UUID_ADMIN = '00000000-0000-4000-8000-000000000601';
      await db.exec(`
        INSERT INTO auth.users (id, email) VALUES ('${UUID_ADMIN}', 'admin@tot.local');
        INSERT INTO public.core_users (id, name, email, pin, role_id, is_blocked, auth_user_id)
        VALUES ('usr-admin-novault', 'Admin NoVault', 'admin@tot.local', '', 0, false, '${UUID_ADMIN}');
      `);

      const accRes = await db.query<{ id: string }>(`
        INSERT INTO public.core_mail_accounts (name, provider, is_active)
        VALUES ('Brevo Sans Vault', 'brevo', true)
        RETURNING id;
      `);
      const accountId = accRes.rows[0].id;

      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_ADMIN}', true);
        SELECT set_config('request.jwt.claim.role', 'authenticated', true);
      `);
      await expect(
        db.query(`SELECT public.set_mail_account_secret($1::uuid, 'xkeysib-secret');`, [accountId])
      ).rejects.toThrow(
        /Supabase Vault indisponible : activez l'extension Vault \(Database > Extensions\)/
      );
      await db.exec(`ROLLBACK;`);

      await db.close();
    },
    120_000
  );

  it(
    'base AVEC Vault : s’exécute 2 fois sans erreur, migre Brevo, valide service_role via request.jwt.claims JSON uniquement (authenticated et anon refusés), valide les contraintes msgraph (tenant_id GUID/domaine + client_id GUID), et teste l’insertion SQL réelle du payload handler + limite 30/heure dans core_mail_log',
    async () => {
      const db = new PGlite();
      await db.exec(AUTH_STUB_SQL);
      await db.exec(VAULT_EXTENSION_STUB_SQL);

      // 1. Exécution de toute la chaîne 00..14..07 puis double exécution idempotente de 14_mailing.sql et 07_app_compat.sql
      for (const s of ORDERED_CLIENT_SCRIPTS) {
        await db.exec(fs.readFileSync(path.join(ROOT_DIR, 'supabase-client', s), 'utf8'));
      }
      await db.exec(fs.readFileSync(path.join(ROOT_DIR, 'supabase-client/14_mailing.sql'), 'utf8'));
      await db.exec(fs.readFileSync(path.join(ROOT_DIR, 'supabase-client/07_app_compat.sql'), 'utf8'));

      // 2. Vérifier diagnostic_installation() -> mailing_module = 'OK' et app_compat = 'OK' (2.4.1)
      const diagRes = await db.query<{
        check_key: string;
        status: string;
        details: string;
      }>(`SELECT check_key, status, details FROM public.diagnostic_installation();`);
      const mailingRow = diagRes.rows.find((r) => r.check_key === 'mailing_module');
      const compatRow = diagRes.rows.find((r) => r.check_key === 'app_compat');
      expect(mailingRow?.status).toBe('OK');
      expect(mailingRow?.details).toContain('msgraph');
      expect(compatRow?.status).toBe('OK');
      expect(compatRow?.details).toContain('2.10.0');

      // 3. Tester la migration automatique d'une ancienne configuration Brevo (core_app_settings + vault.secrets)
      await db.exec(`
        DELETE FROM public.core_mail_accounts;
        INSERT INTO public.core_app_settings (key, value) VALUES
          ('smtp_from', 'alertes@ancien-client.fr'),
          ('smtp_from_name', 'Ancien Client Stock')
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
      `);
      await db.query(`SELECT public._tot_write_mail_vault_secret('BREVO_API_KEY', 'xkeysib-legacy-key-999');`);

      await db.exec(fs.readFileSync(path.join(ROOT_DIR, 'supabase-client/14_mailing.sql'), 'utf8'));
      await db.exec(fs.readFileSync(path.join(ROOT_DIR, 'supabase-client/07_app_compat.sql'), 'utf8'));

      const migratedAccRes = await db.query<{
        id: string;
        provider: string;
        is_active: boolean;
      }>(`SELECT id, provider, is_active FROM public.core_mail_accounts;`);
      expect(migratedAccRes.rows.length).toBe(1);
      expect(migratedAccRes.rows[0].provider).toBe('brevo');
      expect(migratedAccRes.rows[0].is_active).toBe(true);
      const migratedAccountId = migratedAccRes.rows[0].id;

      // 4. Tester la règle unique de permissions (_tot_is_mail_admin) : rôles 0, 1, 5, 8 ou perm_config_email ou perm_config_db
      const UUID_ADMIN = '00000000-0000-4000-8000-000000000501';
      const UUID_USER = '00000000-0000-4000-8000-000000000502';
      const UUID_ROLE8 = '00000000-0000-4000-8000-000000000508';
      const UUID_PERM_EMAIL = '00000000-0000-4000-8000-000000000509';
      await db.exec(`
        INSERT INTO auth.users (id, email) VALUES
          ('${UUID_ADMIN}', 'admin@tot.local'),
          ('${UUID_USER}', 'user@tot.local'),
          ('${UUID_ROLE8}', 'resp-si@tot.local'),
          ('${UUID_PERM_EMAIL}', 'delegue-mail@tot.local')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO public.core_roles (id, name, permissions) VALUES
          (99, 'Délégué E-mail', ARRAY['perm_config_email']::text[])
        ON CONFLICT (id) DO UPDATE SET permissions = EXCLUDED.permissions;

        INSERT INTO public.core_users (id, name, email, pin, role_id, is_blocked, auth_user_id) VALUES
          ('usr-admin-50', 'Admin 50', 'admin@tot.local', '', 0, false, '${UUID_ADMIN}'),
          ('usr-std-50', 'User 50', 'user@tot.local', '', 3, false, '${UUID_USER}'),
          ('usr-si-50', 'Resp SI 50', 'resp-si@tot.local', '', 8, false, '${UUID_ROLE8}'),
          ('usr-perm-50', 'Délégué Mail', 'delegue-mail@tot.local', '', 99, false, '${UUID_PERM_EMAIL}')
        ON CONFLICT (id) DO UPDATE SET auth_user_id = EXCLUDED.auth_user_id, role_id = EXCLUDED.role_id;
      `);

      // Rôle 3 (sans perm_config_email / perm_config_db) -> _tot_is_mail_admin() = false
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_USER}', true);
        SELECT set_config('request.jwt.claim.role', 'authenticated', true);
      `);
      const stdAdminCheck = await db.query<{ ok: boolean }>(`SELECT public._tot_is_mail_admin() AS ok;`);
      expect(stdAdminCheck.rows[0].ok).toBe(false);
      await expect(
        db.query(`SELECT public.set_mail_account_secret($1::uuid, 'new-secret');`, [migratedAccountId])
      ).rejects.toThrow(/Accès refusé|Permission refusée/i);
      await db.exec(`ROLLBACK;`);

      // Rôle 8 -> _tot_is_mail_admin() = true
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_ROLE8}', true);
        SELECT set_config('request.jwt.claim.role', 'authenticated', true);
      `);
      const role8Check = await db.query<{ ok: boolean }>(`SELECT public._tot_is_mail_admin() AS ok;`);
      expect(role8Check.rows[0].ok).toBe(true);
      await db.exec(`ROLLBACK;`);

      // Rôle 99 avec perm_config_email -> _tot_is_mail_admin() = true
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_PERM_EMAIL}', true);
        SELECT set_config('request.jwt.claim.role', 'authenticated', true);
      `);
      const permEmailCheck = await db.query<{ ok: boolean }>(`SELECT public._tot_is_mail_admin() AS ok;`);
      expect(permEmailCheck.rows[0].ok).toBe(true);
      await db.exec(`ROLLBACK;`);

      // Super-Admin (rôle 0) met à jour le secret dans Vault et configure 'hab'
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_ADMIN}', true);
        SELECT set_config('request.jwt.claim.role', 'authenticated', true);
      `);
      await db.query(
        `SELECT public.set_mail_account_secret($1::uuid, 'xkeysib-updated-vault-secret-777');`,
        [migratedAccountId]
      );
      await db.query(
        `
        INSERT INTO public.core_mail_senders (app_code, account_id, from_name, from_email, is_active)
        VALUES ('hab', $1::uuid, 'TOT Habilitations RH', 'hab@entreprise.fr', true)
        ON CONFLICT (app_code) DO UPDATE
          SET account_id = EXCLUDED.account_id,
              from_name = EXCLUDED.from_name,
              from_email = EXCLUDED.from_email,
              is_active = EXCLUDED.is_active;
      `,
        [migratedAccountId]
      );
      await db.exec(`COMMIT;`);

      // 5. LOT 1.4 : Tester get_mail_config avec UNIQUEMENT request.jwt.claims = '{"role":"service_role"}' (sans request.jwt.claim.role et sans SET ROLE service_role)
      await db.exec(`
        BEGIN;
        SELECT set_config('request.jwt.claim.role', '', true);
        SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
      `);
      const cfgStkRes = await db.query<{ cfg: ResolvedMailConfig }>(
        `SELECT public.get_mail_config('stk') AS cfg;`
      );
      const cfgHabRes = await db.query<{ cfg: ResolvedMailConfig }>(
        `SELECT public.get_mail_config('hab') AS cfg;`
      );
      await db.exec(`COMMIT;`);

      expect(cfgStkRes.rows[0].cfg.configured).toBe(true);
      expect(cfgStkRes.rows[0].cfg.secret).toBe('xkeysib-updated-vault-secret-777');
      expect(cfgStkRes.rows[0].cfg.from_email).toBe('alertes@ancien-client.fr');
      expect(cfgHabRes.rows[0].cfg.from_email).toBe('hab@entreprise.fr');

      // Vérifier que request.jwt.claims = '{"role":"authenticated"}' et '{"role":"anon"}' sont refusés sur get_mail_config
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.role', '', true);
        SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
      `);
      await expect(db.query(`SELECT public.get_mail_config('stk');`)).rejects.toThrow(
        /Accès refusé|Permission denied/i
      );
      await db.exec(`ROLLBACK;`);

      await db.exec(`
        BEGIN;
        SET LOCAL ROLE anon;
        SELECT set_config('request.jwt.claim.role', '', true);
        SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
      `);
      await expect(db.query(`SELECT public.get_mail_config('stk');`)).rejects.toThrow(
        /permission denied|Accès refusé/i
      );
      await db.exec(`ROLLBACK;`);

      // 6. LOT 2.1 : Tester les contraintes SQL pour provider = 'msgraph' (compte valide GUID/domaine, tenant manquant refusé, client_id invalide refusé)
      // Compte msgraph valide avec domaine + GUID client_id
      const validGraphRes = await db.query<{ id: string }>(`
        INSERT INTO public.core_mail_accounts (name, provider, preset, extra, is_active)
        VALUES (
          'M365 Graph Domaine',
          'msgraph',
          'msgraph',
          '{"tenant_id":"contoso.onmicrosoft.com","client_id":"11111111-2222-3333-4444-555555555555","secret_expires_at":"2028-06-30"}'::jsonb,
          false
        )
        RETURNING id;
      `);
      expect(validGraphRes.rows[0].id).toBeTruthy();

      // Compte msgraph valide avec GUID tenant_id + GUID client_id
      const validGraphGuidRes = await db.query<{ id: string }>(`
        INSERT INTO public.core_mail_accounts (name, provider, preset, extra, is_active)
        VALUES (
          'M365 Graph GUID',
          'msgraph',
          'msgraph',
          '{"tenant_id":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","client_id":"11111111-2222-3333-4444-555555555555"}'::jsonb,
          false
        )
        RETURNING id;
      `);
      expect(validGraphGuidRes.rows[0].id).toBeTruthy();

      // Tenant manquant -> refusé par core_mail_accounts_msgraph_extra_chk
      await expect(
        db.query(`
          INSERT INTO public.core_mail_accounts (name, provider, preset, extra, is_active)
          VALUES (
            'M365 Sans Tenant',
            'msgraph',
            'msgraph',
            '{"client_id":"11111111-2222-3333-4444-555555555555"}'::jsonb,
            false
          );
        `)
      ).rejects.toThrow(/core_mail_accounts_msgraph_extra_chk/i);

      // Client ID invalide (non GUID) -> refusé par core_mail_accounts_msgraph_extra_chk
      await expect(
        db.query(`
          INSERT INTO public.core_mail_accounts (name, provider, preset, extra, is_active)
          VALUES (
            'M365 Client Invalide',
            'msgraph',
            'msgraph',
            '{"tenant_id":"contoso.onmicrosoft.com","client_id":"not-a-valid-guid"}'::jsonb,
            false
          );
        `)
      ).rejects.toThrow(/core_mail_accounts_msgraph_extra_chk/i);

      // 7. Test SQL : insérer le payload EXACT construit par sendReportEmailHandler dans la vraie table core_mail_log
      const exactHandlerPayload = buildMailLogInsertPayload({
        app_code: 'stk',
        account_id: migratedAccountId,
        provider: 'brevo',
        sender_email: 'alertes@ancien-client.fr',
        recipient_masked: 'c***@client.fr',
        recipient_count: 2,
        subject: 'Rapport hebdomadaire',
        kind: 'custom_unknown_kind_normalized_to_report',
        status: 'sent',
        message_id: '<msg-42@brevo>',
        error_message: null,
        user_id: 'usr-admin-50',
      });

      expect(exactHandlerPayload.kind).toBe('report');
      expect(exactHandlerPayload.sender_email).toBe('alertes@ancien-client.fr');
      expect(exactHandlerPayload.user_id).toBe('usr-admin-50');
      expect(exactHandlerPayload).not.toHaveProperty('from_email');
      expect(exactHandlerPayload).not.toHaveProperty('sent_by');

      const cols = Object.keys(exactHandlerPayload);
      const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(', ');
      const values = cols.map((k) => (exactHandlerPayload as Record<string, unknown>)[k]);

      const insertedRowRes = await db.query<{
        id: string;
        sender_email: string;
        user_id: string;
        kind: string;
        recipient_count: number;
        status: string;
      }>(
        `INSERT INTO public.core_mail_log (${cols.join(', ')}) VALUES (${placeholders}) RETURNING id, sender_email, user_id, kind, recipient_count, status;`,
        values
      );
      expect(insertedRowRes.rows.length).toBe(1);
      expect(insertedRowRes.rows[0].sender_email).toBe('alertes@ancien-client.fr');
      expect(insertedRowRes.rows[0].user_id).toBe('usr-admin-50');
      expect(insertedRowRes.rows[0].kind).toBe('report');
      expect(insertedRowRes.rows[0].recipient_count).toBe(2);
      expect(insertedRowRes.rows[0].status).toBe('sent');

      // 8. Test SQL de la limite horaire de 30 envois/heure (MAX_EMAILS_PER_USER_PER_HOUR = 30) branché sur la vraie table core_mail_log
      expect(MAX_EMAILS_PER_USER_PER_HOUR).toBe(30);
      await db.exec(`DELETE FROM public.core_mail_log;`);

      const pgliteSupabaseAdmin = {
        rpc: async (fn: string, args: any) => {
          if (fn === 'get_mail_config') {
            return {
              data: {
                configured: true,
                account_id: migratedAccountId,
                provider: 'brevo',
                preset: 'brevo',
                secret: 'xkeysib-live-key',
                app_code: args.p_app_code || 'stk',
                from_name: 'TOT Stock',
                from_email: 'alertes@ancien-client.fr',
                reply_to: null,
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
        from: (table: string) => {
          if (table === TABLES.mailLog) {
            return {
              insert: async (rows: any[]) => {
                for (const row of rows) {
                  const rowCols = Object.keys(row);
                  const rowPlaceholders = rowCols.map((_, idx) => `$${idx + 1}`).join(', ');
                  const rowVals = rowCols.map((k) => row[k]);
                  await db.query(
                    `INSERT INTO public.core_mail_log (${rowCols.join(', ')}) VALUES (${rowPlaceholders});`,
                    rowVals
                  );
                }
                return { data: rows, error: null };
              },
              select: () => ({
                eq: (col: string, val: string) => ({
                  gte: async (tsCol: string, sinceIso: string) => {
                    const res = await db.query<{ cnt: number }>(
                      `SELECT count(*)::int AS cnt FROM public.core_mail_log WHERE ${col} = $1 AND ${tsCol} >= $2::timestamptz;`,
                      [val, sinceIso]
                    );
                    return { count: res.rows[0]?.cnt ?? 0, error: null };
                  },
                }),
              }),
            };
          }
          return {};
        },
      };

      const sqlBackedHandler = createSendReportEmailHandler({
        authenticate: async () => ({
          ok: true,
          ctx: {
            supabaseUrl: 'https://xyz.supabase.co',
            serviceRoleKey: 'srv-key',
            supabaseAdmin: pgliteSupabaseAdmin,
            authCaller: { id: UUID_ADMIN, email: 'admin@tot.local' },
            callerProfile: {
              id: 'usr-admin-50',
              auth_user_id: UUID_ADMIN,
              name: 'Admin 50',
              email: 'admin@tot.local',
              role_id: 0,
              is_blocked: false,
            },
            callerPerms: ['*'],
            isSuperAdmin: true,
            hasUniversal: true,
          },
        }),
        fetchFn: async () => new Response(JSON.stringify({ messageId: 'brevo-ok' }), { status: 200 }),
      });

      // Pré-insérer 29 envois dans la dernière heure pour usr-admin-50
      await db.exec(`
        INSERT INTO public.core_mail_log (app_code, sender_email, recipient_masked, recipient_count, subject, kind, status, user_id, created_at)
        SELECT 'stk', 'alertes@ancien-client.fr', 'u***@client.fr', 1, 'Envoi #' || g, 'report', 'sent', 'usr-admin-50', now() - INTERVAL '10 minutes'
        FROM generate_series(1, 29) AS g;
      `);

      // Le 30e envoi passe (29 < 30) et s'insère réellement dans public.core_mail_log
      const res30 = await sqlBackedHandler(
        new Request('https://xyz.supabase.co/functions/v1/APP_TOT-Stock_send-report-email', {
          method: 'POST',
          body: JSON.stringify({
            app_code: 'stk',
            to: 'client30@entreprise.fr',
            subject: '30e envoi horaire',
            htmlContent: '<p>OK 30</p>',
            kind: 'non_standard_kind',
          }),
        })
      );
      expect(res30.status).toBe(200);

      // Le 31e envoi dans l'heure est bloqué par la limite 30/heure (HTTP 429)
      const res31 = await sqlBackedHandler(
        new Request('https://xyz.supabase.co/functions/v1/APP_TOT-Stock_send-report-email', {
          method: 'POST',
          body: JSON.stringify({
            app_code: 'stk',
            to: 'client31@entreprise.fr',
            subject: '31e envoi horaire',
            htmlContent: '<p>Bloqué 31</p>',
          }),
        })
      );
      expect(res31.status).toBe(429);

      const finalCountRes = await db.query<{ cnt: number; failed_cnt: number }>(
        `SELECT count(*)::int AS cnt, count(*) FILTER (WHERE status = 'failed')::int AS failed_cnt FROM public.core_mail_log WHERE user_id = 'usr-admin-50';`
      );
      // 29 pré-insérés + 1 (30e sent) + 1 (31e failed loggé) = 31 lignes dans la vraie table core_mail_log
      expect(finalCountRes.rows[0].cnt).toBe(31);
      expect(finalCountRes.rows[0].failed_cnt).toBe(1);

      await db.close();
    },
    120_000
  );
});

describe('Prompt v50 & v51 — LOT 1.4, 1.5 & LOT 2 : Adaptateurs multi-fournisseurs (dont Microsoft 365 Graph), erreurs explicites & permissions', () => {
  it('normalise kind aux 5 valeurs autorisées (transactional, report, order, alert, test) avec défaut report', () => {
    expect(VALID_MAIL_KINDS).toEqual(['transactional', 'report', 'order', 'alert', 'test']);
    expect(normalizeMailKind(undefined)).toBe('report');
    expect(normalizeMailKind('')).toBe('report');
    expect(normalizeMailKind('UNKNOWN_KIND')).toBe('report');
    expect(normalizeMailKind('ORDER')).toBe('order');
    expect(normalizeMailKind('transactional')).toBe('transactional');
    expect(normalizeMailKind('alert')).toBe('alert');
    expect(normalizeMailKind('report', true)).toBe('test');
  });

  it('LOT 1.4 : ne retombe plus en silence sur « non configuré » si get_mail_config renvoie une erreur — journalise et renvoie « Lecture de la configuration e-mail refusée : <message> »', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const deniedSupabaseAdmin = {
      rpc: async (fn: string) => {
        if (fn === 'get_mail_config') {
          return {
            data: null,
            error: {
              code: 'P0001',
              message: 'Accès refusé : get_mail_config est strictement réservée au rôle serveur (service_role).',
            },
          };
        }
        return { data: null, error: null };
      },
      from: () => ({
        insert: async () => ({ data: null, error: null }),
        select: () => ({ eq: () => ({ gte: async () => ({ count: 0, error: null }) }) }),
      }),
    };

    const handler = createSendReportEmailHandler({
      authenticate: async () => ({
        ok: true,
        ctx: {
          supabaseUrl: 'https://xyz.supabase.co',
          serviceRoleKey: 'srv-key',
          supabaseAdmin: deniedSupabaseAdmin,
          authCaller: { id: 'auth-1', email: 'admin@domaine.fr' },
          callerProfile: {
            id: 'usr-1',
            auth_user_id: 'auth-1',
            name: 'Admin',
            email: 'admin@domaine.fr',
            role_id: 0,
            is_blocked: false,
          },
          callerPerms: ['*'],
          isSuperAdmin: true,
          hasUniversal: true,
        },
      }),
    });

    const res = await handler(
      new Request('https://xyz.supabase.co/functions/v1/APP_TOT-Stock_send-report-email', {
        method: 'POST',
        body: JSON.stringify({
          app_code: 'stk',
          to: 'jean@client.fr',
          test: true,
        }),
      })
    );

    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Lecture de la configuration e-mail refusée :');
    expect(body.error).toContain('service_role');
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();
  });

  it('LOT 1.5 : extrait le message JSON de error.context (Response 502 / 403 / 429) avec le code HTTP sans jamais afficher de secret', async () => {
    // 1. Simulation d'une réponse 502 (Clé API Brevo refusée contenant accidentellement une clé xkeysib-)
    const res502 = new Response(
      JSON.stringify({
        success: false,
        error: 'Clé API Brevo refusée (xkeysib-999888777secret)',
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
    const parsed502 = await extractEdgeFunctionError({
      message: 'Edge Function returned a non-2xx status code',
      context: res502,
    });
    expect(parsed502.statusCode).toBe(502);
    expect(parsed502.message).toContain('Clé API Brevo refusée');
    expect(parsed502.message).not.toContain('xkeysib-999888777secret');

    // 2. Simulation d'une réponse 403 (Expéditeur non validé chez le fournisseur) via sendTestEmailRequest
    const fakeClient403 = {
      functions: {
        invoke: async () => ({
          data: null,
          error: {
            message: 'Edge Function returned a non-2xx status code',
            context: new Response(
              JSON.stringify({
                error: 'Expéditeur non validé chez le fournisseur (domaine SPF/DKIM requis).',
              }),
              { status: 403, headers: { 'Content-Type': 'application/json' } }
            ),
          },
        }),
      },
    };
    const test403 = await sendTestEmailRequest(fakeClient403, {
      to: 'admin@entreprise.fr',
      appCode: 'stk',
    });
    expect(test403.ok).toBe(false);
    expect(test403.statusCode).toBe(403);
    expect(test403.message).toBe(
      'Expéditeur non validé chez le fournisseur (domaine SPF/DKIM requis).'
    );

    // 3. Simulation d'une réponse 429 (Limite d'envoi atteinte)
    const fakeClient429 = {
      functions: {
        invoke: async () => ({
          data: null,
          error: {
            message: 'FunctionsHttpError: Edge Function returned a non-2xx status code',
            context: new Response(
              JSON.stringify({
                error: "Limite d'envoi atteinte (maximum 30 e-mails par heure et par utilisateur).",
              }),
              { status: 429, headers: { 'Content-Type': 'application/json' } }
            ),
          },
        }),
      },
    };
    const test429 = await sendTestEmailRequest(fakeClient429, {
      to: 'admin@entreprise.fr',
      appCode: 'stk',
    });
    expect(test429.ok).toBe(false);
    expect(test429.statusCode).toBe(429);
    expect(test429.message).toContain("Limite d'envoi atteinte");
  });

  it('LOT 2.2 : adaptateur Microsoft 365 (Graph) — jeton OAuth2 + sendMail 202 OK, cache jeton réutilisé, pièce jointe > 3 Mo refusée, erreurs 401/403/404/429 normalisées sans fuite du secret', async () => {
    clearMsGraphTokenCache();
    const secretValue = 'msgraph~SuperSecretClientValue2026!XYZ';
    const msgraphConfig: ResolvedMailConfig = {
      configured: true,
      provider: 'msgraph',
      preset: 'msgraph',
      secret: secretValue,
      extra: {
        tenant_id: 'contoso.onmicrosoft.com',
        client_id: '11111111-2222-3333-4444-555555555555',
      },
    };

    const baseMessage = {
      fromName: 'TOT Stock',
      fromEmail: 'stock@contoso.com',
      replyTo: 'support@contoso.com',
      to: ['dest@client.fr'],
      subject: 'Test Microsoft Graph',
      htmlContent: '<p>Bonjour depuis Graph</p>',
    };

    // 1. Jeton + sendMail 202 OK + vérification que le 2e appel réutilise le jeton en cache
    let tokenCalls = 0;
    let sendMailCalls = 0;
    let capturedGraphPayload: any = null;

    const mockFetchOk = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('login.microsoftonline.com')) {
        tokenCalls += 1;
        return new Response(
          JSON.stringify({ access_token: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.graph_tok', expires_in: 3599 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('graph.microsoft.com/v1.0/users/')) {
        sendMailCalls += 1;
        capturedGraphPayload = JSON.parse(String(init?.body || '{}'));
        return new Response(null, {
          status: 202,
          headers: { 'request-id': 'msgraph-req-id-001' },
        });
      }
      return new Response('Not Found', { status: 404 });
    };

    const send1 = await sendMailWithProvider(msgraphConfig, baseMessage, mockFetchOk);
    expect(send1.ok).toBe(true);
    expect(send1.provider).toBe('msgraph');
    expect(send1.messageId).toBe('msgraph-req-id-001');
    expect(tokenCalls).toBe(1);
    expect(sendMailCalls).toBe(1);
    expect(capturedGraphPayload.saveToSentItems).toBe(true);
    expect(capturedGraphPayload.message.body.contentType).toBe('HTML');
    expect(capturedGraphPayload.message.toRecipients[0].emailAddress.address).toBe('dest@client.fr');

    // 2e envoi immédiat -> le jeton en mémoire est réutilisé (tokenCalls reste à 1)
    const send2 = await sendMailWithProvider(msgraphConfig, baseMessage, mockFetchOk);
    expect(send2.ok).toBe(true);
    expect(tokenCalls).toBe(1);
    expect(sendMailCalls).toBe(2);

    // 2. Pièce jointe dépassant 3 Mo -> refusée avant appel réseau
    expect(MSGRAPH_MAX_ATTACHMENT_BYTES).toBe(3 * 1024 * 1024);
    const oversizedBase64 = 'A'.repeat(4_200_000); // ~3.15 Mo décodé
    const oversizedRes = await sendMailWithProvider(
      msgraphConfig,
      {
        ...baseMessage,
        attachments: [
          {
            filename: 'gros-rapport.pdf',
            contentBase64: oversizedBase64,
            contentType: 'application/pdf',
          },
        ],
      },
      mockFetchOk
    );
    expect(oversizedRes.ok).toBe(false);
    expect(oversizedRes.error).toContain('3 Mo');

    // 3. Erreur 401 / invalid_client sur le token (avec le secret dans le texte d'erreur brut) -> message clair sans secret
    clearMsGraphTokenCache();
    const res401 = await sendMailWithProvider(
      msgraphConfig,
      baseMessage,
      async () =>
        new Response(
          JSON.stringify({
            error: 'invalid_client',
            error_description: `AADSTS7000215: Invalid client secret provided (${secretValue}).`,
          }),
          { status: 401 }
        )
    );
    expect(res401.ok).toBe(false);
    expect(res401.error).toContain('secret expiré ou incorrect');
    expect(res401.error).not.toContain(secretValue);

    // 4. Erreur 403 ErrorAccessDenied sur sendMail -> consentement administrateur manquant
    clearMsGraphTokenCache();
    const res403 = await sendMailWithProvider(msgraphConfig, baseMessage, async (input) => {
      if (String(input).includes('login.microsoftonline.com')) {
        return new Response(JSON.stringify({ access_token: 'tok-403', expires_in: 3600 }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({
          error: {
            code: 'ErrorAccessDenied',
            message: `Access is denied. Check credentials and try again (${secretValue}).`,
          },
        }),
        { status: 403 }
      );
    });
    expect(res403.ok).toBe(false);
    expect(res403.error).toContain(
      "consentement administrateur manquant ou boîte non autorisée par la stratégie d'accès de l'application"
    );
    expect(res403.error).not.toContain(secretValue);

    // 5. Erreur 404 -> boîte aux lettres introuvable dans ce tenant
    clearMsGraphTokenCache();
    const res404 = await sendMailWithProvider(msgraphConfig, baseMessage, async (input) => {
      if (String(input).includes('login.microsoftonline.com')) {
        return new Response(JSON.stringify({ access_token: 'tok-404', expires_in: 3600 }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({
          error: { code: 'ErrorInvalidUser', message: 'The requested user was not found.' },
        }),
        { status: 404 }
      );
    });
    expect(res404.ok).toBe(false);
    expect(res404.error).toContain('boîte aux lettres introuvable dans ce tenant');
    expect(res404.error).not.toContain(secretValue);

    // 6. Erreur 429 -> limite de débit Microsoft avec Retry-After
    clearMsGraphTokenCache();
    const res429 = await sendMailWithProvider(msgraphConfig, baseMessage, async (input) => {
      if (String(input).includes('login.microsoftonline.com')) {
        return new Response(JSON.stringify({ access_token: 'tok-429', expires_in: 3600 }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({
          error: { code: 'ApplicationThrottled', message: 'Too many requests.' },
        }),
        { status: 429, headers: { 'Retry-After': '45' } }
      );
    });
    expect(res429.ok).toBe(false);
    expect(res429.error).toContain('limite de débit Microsoft atteinte');
    expect(res429.error).toContain('45');
    expect(res429.error).not.toContain(secretValue);
  });

  it('ne masque plus silencieusement une erreur d’insertion dans core_mail_log : la journalise dans console.error sans exposer de secret', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const failingLogSupabaseAdmin = {
      rpc: async (fn: string) => {
        if (fn === 'get_mail_config') {
          return {
            data: {
              configured: true,
              account_id: 'acc-err',
              provider: 'resend',
              preset: 'resend',
              secret: 're_super_secret_token_999',
              app_code: 'stk',
              from_name: 'TOT Stock',
              from_email: 'stock@domaine.fr',
              reply_to: null,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
      from: (table: string) => {
        if (table === TABLES.mailLog) {
          return {
            insert: async () => ({
              data: null,
              error: {
                message: 'column "from_email" of relation "core_mail_log" does not exist (secret=re_super_secret_token_999)',
              },
            }),
            select: () => ({
              eq: () => ({
                gte: async () => ({ count: 0, error: null }),
              }),
            }),
          };
        }
        return {};
      },
    };

    const handler = createSendReportEmailHandler({
      authenticate: async () => ({
        ok: true,
        ctx: {
          supabaseUrl: 'https://xyz.supabase.co',
          serviceRoleKey: 'srv-key',
          supabaseAdmin: failingLogSupabaseAdmin,
          authCaller: { id: 'auth-1', email: 'admin@domaine.fr' },
          callerProfile: {
            id: 'usr-1',
            auth_user_id: 'auth-1',
            name: 'Admin',
            email: 'admin@domaine.fr',
            role_id: 0,
            is_blocked: false,
          },
          callerPerms: ['*'],
          isSuperAdmin: true,
          hasUniversal: true,
        },
      }),
      fetchFn: async () => new Response(JSON.stringify({ id: 'resend-1' }), { status: 200 }),
    });

    const res = await handler(
      new Request('https://xyz.supabase.co/functions/v1/APP_TOT-Stock_send-report-email', {
        method: 'POST',
        body: JSON.stringify({
          app_code: 'stk',
          to: 'jean@client.fr',
          subject: 'Test log error',
          htmlContent: '<p>Test</p>',
        }),
      })
    );

    expect(res.status).toBe(200);
    expect(errSpy).toHaveBeenCalled();
    const loggedErrorText = errSpy.mock.calls.map((c) => c.join(' ')).join(' ');
    expect(loggedErrorText).toContain('[send-report-email] Erreur insertion core_mail_log');
    expect(loggedErrorText).not.toContain('re_super_secret_token_999');

    errSpy.mockRestore();
  });

  it('aligne la règle de permission e-mail/SMTP sur rôles 0, 1, 5, 8 ou perm_config_email ou perm_config_db (sans perm_menu_smtp)', () => {
    expect(MAIL_ADMIN_ROLE_IDS).toEqual([0, 1, 5, 8]);

    for (const roleId of [0, 1, 5, 8]) {
      expect(canUserManageMailSettings({ role_id: roleId }, () => false)).toBe(true);
    }
    expect(canUserManageMailSettings({ role_id: 3 }, () => false)).toBe(false);
    // perm_menu_smtp seul ne donne PAS accès
    expect(
      canUserManageMailSettings({ role_id: 3 }, (p) => p === 'perm_menu_smtp')
    ).toBe(false);
    // perm_config_email ou perm_config_db donne accès
    expect(
      canUserManageMailSettings({ role_id: 3 }, (p) => p === 'perm_config_email')
    ).toBe(true);
    expect(
      canUserManageMailSettings({ role_id: 3 }, (p) => p === 'perm_config_db')
    ).toBe(true);
  });

  it('masque les destinataires (j***@domaine.fr) et nettoie tout secret dans les messages d’erreur', () => {
    expect(maskEmailRecipient('jean.dupont@domaine.fr')).toBe('j***@domaine.fr');
    expect(maskEmailRecipientList(['alice@test.fr', 'bob@test.fr', 'charlie@test.fr'])).toBe(
      'a***@test.fr (+2)'
    );

    const errText = sanitizeAndTranslateMailError(
      'Invalid key xkeysib-secret123456789 or my-super-secret-pass',
      401,
      'brevo',
      'my-super-secret-pass'
    );
    expect(errText).not.toContain('xkeysib-secret123456789');
    expect(errText).not.toContain('my-super-secret-pass');
    expect(errText).toContain('Authentification refusée par BREVO');
  });

  it('valide les destinataires (1 à 20 max, format e-mail valide)', () => {
    expect(parseAndValidateRecipients('').ok).toBe(false);
    expect(parseAndValidateRecipients('pas-un-email').ok).toBe(false);
    const twentyOne = Array.from({ length: 21 }, (_, i) => `u${i}@domaine.fr`);
    expect(parseAndValidateRecipients(twentyOne).ok).toBe(false);

    const valid = parseAndValidateRecipients('a@domaine.fr, b@domaine.fr');
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.recipients).toEqual(['a@domaine.fr', 'b@domaine.fr']);
    }
  });

  it('envoie via les 7 fournisseurs historiques (brevo, resend, sendgrid, mailgun, postmark, mailjet, smtp) et rejette le port SMTP 25', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes('sendgrid.com')) {
        return new Response('', { status: 202, headers: { 'x-message-id': 'sg-123' } });
      }
      if (url.includes('mailjet.com')) {
        return new Response(
          JSON.stringify({ Messages: [{ Status: 'success', To: [{ MessageUUID: 'mj-123' }] }] }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({ id: 'msg-123', messageId: 'msg-123', MessageID: 'pm-123' }),
        { status: 200 }
      );
    };

    const baseMessage = {
      fromName: 'TOT Stock',
      fromEmail: 'stock@entreprise.fr',
      replyTo: 'support@entreprise.fr',
      to: ['dest@client.fr'],
      subject: 'Test multi-fournisseurs',
      htmlContent: '<p>Bonjour</p>',
    };

    for (const provider of ['brevo', 'resend', 'sendgrid', 'mailgun', 'postmark', 'mailjet'] as const) {
      const res = await sendMailWithProvider(
        {
          configured: true,
          provider,
          secret: 'secret-token-xyz',
          username: provider === 'mailjet' ? 'mj-public-key' : null,
          extra: provider === 'mailgun' ? { domain: 'mg.entreprise.fr', region: 'eu' } : {},
        },
        baseMessage,
        mockFetch
      );
      expect(res.ok).toBe(true);
      expect(res.provider).toBe(provider);
    }
    expect(calls.length).toBe(6);

    // SMTP port 25 rejeté
    const smtp25 = await sendMailWithProvider(
      {
        configured: true,
        provider: 'smtp',
        host: 'smtp.entreprise.fr',
        port: 25,
        encryption: 'none',
        secret: 'smtp-pass',
      },
      baseMessage
    );
    expect(smtp25.ok).toBe(false);
    expect(smtp25.error).toContain('25');

    // SMTP port 587 via transport injecté
    const smtp587 = await sendMailWithProvider(
      {
        configured: true,
        provider: 'smtp',
        host: 'smtp.entreprise.fr',
        port: 587,
        encryption: 'starttls',
        username: 'stock@entreprise.fr',
        secret: 'smtp-pass',
      },
      baseMessage,
      mockFetch,
      async () => ({ ok: true, messageId: 'smtp-587-ok' })
    );
    expect(smtp587.ok).toBe(true);
    expect(smtp587.messageId).toBe('smtp-587-ok');
  });

  it('ignore sender_name / sender_email fournis par le client, applique la limite de débit et journalise sender_email + user_id dans core_mail_log', async () => {
    const loggedEntries: any[] = [];
    let simulatedRecentCount = 0;
    let lastDispatchedBody: any = null;

    const fakeSupabaseAdmin = {
      rpc: async (fn: string, args: any) => {
        if (fn === 'get_mail_config') {
          return {
            data: {
              configured: true,
              account_id: 'acc-1',
              provider: 'resend',
              preset: 'resend',
              secret: 're_secret_server_key',
              app_code: args.p_app_code,
              from_name: args.p_app_code === 'hab' ? 'TOT Habilitations' : 'TOT Stock Officiel',
              from_email: args.p_app_code === 'hab' ? 'hab@domaine.fr' : 'stock@domaine.fr',
              reply_to: 'reply@domaine.fr',
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
      from: (table: string) => {
        if (table === TABLES.mailLog) {
          return {
            insert: async (rows: any[]) => {
              loggedEntries.push(...rows);
              return { data: rows, error: null };
            },
            select: () => ({
              eq: () => ({
                gte: async () => ({ count: simulatedRecentCount, error: null }),
              }),
            }),
          };
        }
        return {};
      },
    };

    const handler = createSendReportEmailHandler({
      authenticate: async () => ({
        ok: true,
        ctx: {
          supabaseUrl: 'https://xyz.supabase.co',
          serviceRoleKey: 'srv-key',
          supabaseAdmin: fakeSupabaseAdmin,
          authCaller: { id: 'auth-1', email: 'admin@domaine.fr' },
          callerProfile: {
            id: 'usr-1',
            auth_user_id: 'auth-1',
            name: 'Admin',
            email: 'admin@domaine.fr',
            role_id: 0,
            is_blocked: false,
          },
          callerPerms: ['*'],
          isSuperAdmin: true,
          hasUniversal: true,
        },
      }),
      fetchFn: async (_url, init) => {
        lastDispatchedBody = JSON.parse(String(init?.body || '{}'));
        return new Response(JSON.stringify({ id: 'resend-msg-1' }), { status: 200 });
      },
      maxPerHour: 5,
    });

    // 1. Tentative d'usurpation de sender_email et sender_name par le client : ignorée !
    const req1 = new Request('https://xyz.supabase.co/functions/v1/APP_TOT-Stock_send-report-email', {
      method: 'POST',
      body: JSON.stringify({
        app_code: 'stk',
        to: 'jean@client.fr',
        subject: 'Rapport de stock',
        htmlContent: '<p>Rapport</p>',
        sender_name: ' pirate ',
        sender_email: 'pirate@evil.com',
      }),
    });
    const res1 = await handler(req1);
    const json1 = await res1.json();
    expect(res1.status).toBe(200);
    expect(json1.success).toBe(true);
    expect(json1.from_email).toBe('stock@domaine.fr');
    expect(json1.from_name).toBe('TOT Stock Officiel');
    expect(lastDispatchedBody.from).toBe('TOT Stock Officiel <stock@domaine.fr>');
    expect(loggedEntries.length).toBe(1);
    expect(loggedEntries[0].recipient_masked).toBe('j***@client.fr');
    expect(loggedEntries[0].sender_email).toBe('stock@domaine.fr');
    expect(loggedEntries[0].user_id).toBe('usr-1');
    expect(loggedEntries[0].kind).toBe('report');
    expect(loggedEntries[0].status).toBe('sent');

    // 2. Dépassement du rate-limit (simulatedRecentCount = 5 >= maxPerHour 5) -> HTTP 429
    simulatedRecentCount = 5;
    const req2 = new Request('https://xyz.supabase.co/functions/v1/APP_TOT-Stock_send-report-email', {
      method: 'POST',
      body: JSON.stringify({
        app_code: 'stk',
        to: 'jean@client.fr',
        subject: 'Rapport 2',
        htmlContent: '<p>Rapport 2</p>',
      }),
    });
    const res2 = await handler(req2);
    expect(res2.status).toBe(429);
    expect(loggedEntries[1].status).toBe('failed');
    expect(loggedEntries[1].user_id).toBe('usr-1');
  });
});

describe('Prompt v50 & v51 — LOT 2.3, 3 & 4 : Presets E-mails (dont Microsoft 365 Graph & alerte expiration secret 30j), SPF/DKIM, Changelog & Diagnostic À propos', () => {
  it('fournit les presets API et SMTP (dont msgraph, Gmail 16 car., avertissement Outlook fin décembre 2026), valide tenant/GUID et alerte 30 jours avant expiration du secret', () => {
    const presetIds = MAIL_PROVIDER_PRESETS.map((p) => p.id);
    expect(presetIds).toEqual([
      'brevo',
      'resend',
      'sendgrid',
      'mailgun',
      'postmark',
      'mailjet',
      'msgraph',
      'gmail',
      'outlook',
      'ovh',
      'infomaniak',
      'smtp_custom',
    ]);

    const msgraphPreset = MAIL_PROVIDER_PRESETS.find((p) => p.id === 'msgraph');
    expect(msgraphPreset?.provider).toBe('msgraph');
    expect(msgraphPreset?.labelFr).toContain('Microsoft 365 (Graph) — recommandé pour Outlook');

    const gmail = MAIL_PROVIDER_PRESETS.find((p) => p.id === 'gmail');
    expect(gmail?.helpBannerFr).toContain('myaccount.google.com/apppasswords');
    expect(gmail?.helpBannerFr).toContain('500');

    const outlook = MAIL_PROVIDER_PRESETS.find((p) => p.id === 'outlook');
    expect(outlook?.warningBannerFr).toContain('2026');

    expect(isValidGuid('11111111-2222-3333-4444-555555555555')).toBe(true);
    expect(isValidGuid('not-a-guid')).toBe(false);
    expect(isValidMsGraphTenant('contoso.onmicrosoft.com')).toBe(true);
    expect(isValidMsGraphTenant('11111111-2222-3333-4444-555555555555')).toBe(true);
    expect(isValidMsGraphTenant('invalid tenant')).toBe(false);

    // Test de l'avertissement d'expiration du secret (30 jours avant expiration ou expiré)
    const refNow = Date.parse('2026-11-07T12:00:00Z');
    expect(evaluateMsGraphSecretExpiry(null, refNow).status).toBe('none');
    expect(evaluateMsGraphSecretExpiry('2027-06-01', refNow).status).toBe('ok');
    const soon = evaluateMsGraphSecretExpiry('2026-11-20', refNow);
    expect(soon.status).toBe('expiring_soon');
    expect(soon.daysRemaining).toBeGreaterThan(0);
    expect(soon.daysRemaining).toBeLessThanOrEqual(30);
    expect(evaluateMsGraphSecretExpiry('2026-10-01', refNow).status).toBe('expired');

    expect(isValidEmailAddress('stock@entreprise.fr')).toBe(true);
    expect(isValidEmailAddress('invalide@@domaine')).toBe(false);
    expect(requiresVerifiedSenderReminder('brevo')).toBe(true);
    expect(requiresVerifiedSenderReminder('msgraph')).toBe(true);
    expect(requiresVerifiedSenderReminder('smtp')).toBe(false);

    const mismatchRes = checkSenderDomainMismatch('stock@autre-domaine.fr', {
      id: 'acc-1',
      name: 'SMTP OVH',
      provider: 'smtp',
      username: 'contact@mon-entreprise.fr',
      is_active: true,
    });
    expect(mismatchRes.mismatch).toBe(true);
    expect(mismatchRes.senderDomain).toBe('autre-domaine.fr');
    expect(mismatchRes.accountDomain).toBe('mon-entreprise.fr');
  });

  it('expose les 5 dernières versions dans RECENT_CHANGELOG (FR/EN/NL) et génère un diagnostic À propos sans aucun secret', () => {
    expect(RECENT_CHANGELOG.length).toBeGreaterThanOrEqual(5);
    expect(RECENT_CHANGELOG[0].version).toBe('5.16.2');
    expect(RECENT_CHANGELOG[0].schemaVersion).toBe('2.10.0');
    for (const entry of RECENT_CHANGELOG.slice(0, 5)) {
      expect(entry.title.fr.length).toBeGreaterThan(5);
      expect(entry.title.en.length).toBeGreaterThan(5);
      expect(entry.title.nl.length).toBeGreaterThan(5);
      expect(entry.highlights.fr.length).toBeGreaterThanOrEqual(2);
    }

    expect(evaluateDbSchemaStatus('2.10.0', '2.10.0', '1.0.0')).toBe('up_to_date');
    expect(evaluateDbSchemaStatus('2.2.0', '2.10.0', '1.0.0')).toBe('tolerated');
    expect(evaluateDbSchemaStatus('0.9.0', '2.10.0', '1.0.0')).toBe('outdated');

    expect(
      extractSafeSupabaseHost('https://monprojet.supabase.co/rest/v1?apikey=eyJhbGciOiJIUzI1NiJ9.secret.sig')
    ).toBe('monprojet.supabase.co');

    const summary = formatDiagnosticSupportSummary({
      appVersion: '5.16.0',
      expectedSchemaVersion: '2.10.0',
      minSupportedSchemaVersion: '1.0.0',
      actualSchemaVersion: '2.10.0',
      platform: 'Desktop Electron',
      planCode: 'pro',
      referencesUsed: 120,
      referencesMax: 1000,
      depotsUsed: 3,
      depotsMax: 10,
      usersUsed: 8,
      signedTokenPresent: true,
      supabaseUrl: 'https://monprojet.supabase.co?apikey=sb_secret_123456',
      appSenderName: 'TOT Stock',
      appSenderEmail: 'stock@entreprise.fr',
      encryptionMode: 'native',
      pendingOfflineCount: 0,
    });

    expect(summary).toContain('TOT Stock v5.16.0');
    expect(summary).toContain('monprojet.supabase.co');
    expect(summary).toContain('TOT Stock <stock@entreprise.fr>');
    expect(summary).not.toContain('sb_secret_123456');
  });
});
