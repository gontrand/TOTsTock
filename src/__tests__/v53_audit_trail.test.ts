import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import {
  APP_VERSION,
  EXPECTED_SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
} from '../appVersion';
import {
  SQL_SCRIPT_16_AUDIT_TRAIL,
  SQL_SCRIPT_07_APP_COMPAT,
} from '../constants/supabaseScripts';
import { SQL_STEPS, verifySqlArtifactsSync } from '../../scripts/build-sql.mjs';
import {
  buildSearchAuditLogsRpcParams,
  buildSearchLoginLogsRpcParams,
  detectRepeatedLoginFailures,
  formatAuditChangesDiff,
  generateAuditLogsCsv,
  generateLoginLogsCsv,
  logAuditEventServer,
  logLoginEventServer,
  logLoginFailureServer,
  resetSessionRestoredThrottleForTests,
  sanitizeAuditMeta,
} from '../services/auditService';

const ROOT_DIR = path.resolve(__dirname, '../..');

const AUTH_STUB_SQL = `
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  GRANT USAGE ON SCHEMA auth TO PUBLIC, anon, authenticated, service_role;
  CREATE TABLE IF NOT EXISTS auth.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  CREATE OR REPLACE FUNCTION auth.jwt() RETURNS JSONB LANGUAGE sql STABLE AS $$
    SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  $$;
  GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION auth.jwt() TO PUBLIC, anon, authenticated, service_role;
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

describe('Prompt v53 — Versions 5.16.0 / 2.10.0, Script 16_audit_trail.sql & Edge admin-users', () => {
  it('aligne APP_VERSION=5.16.0, EXPECTED_SCHEMA_VERSION=2.10.0 et déclare le script 16 dans SQL_STEPS (après 15 et avant 07)', () => {
    expect(APP_VERSION).toBe('5.16.2');
    expect(EXPECTED_SCHEMA_VERSION).toBe('2.10.0');
    expect(MIN_SUPPORTED_SCHEMA_VERSION).toBe('1.0.0');

    const stepNumbers = SQL_STEPS.map((s: any) => String(s.step));
    const idx14 = stepNumbers.indexOf('14');
    const idx15 = stepNumbers.indexOf('15');
    const idx16 = stepNumbers.indexOf('16');
    const idx07 = stepNumbers.indexOf('07');
    expect(idx14).toBeGreaterThan(0);
    expect(idx15).toBe(idx14 + 1);
    expect(idx16).toBe(idx15 + 1);
    expect(idx07).toBeGreaterThan(idx16);

    expect(SQL_SCRIPT_16_AUDIT_TRAIL).toContain('CREATE OR REPLACE FUNCTION public.log_audit_event');
    expect(SQL_SCRIPT_16_AUDIT_TRAIL).toContain('CREATE OR REPLACE FUNCTION public.log_login_event');
    expect(SQL_SCRIPT_16_AUDIT_TRAIL).toContain('CREATE OR REPLACE FUNCTION public.log_login_failure');
    expect(SQL_SCRIPT_16_AUDIT_TRAIL).toContain('CREATE OR REPLACE FUNCTION public.purge_audit_logs');
    expect(SQL_SCRIPT_16_AUDIT_TRAIL).toContain('CREATE OR REPLACE FUNCTION public.search_audit_logs');
    expect(SQL_SCRIPT_16_AUDIT_TRAIL).toContain('CREATE OR REPLACE FUNCTION public.search_login_logs');
    expect(SQL_SCRIPT_07_APP_COMPAT).toContain("'log_audit_event'");
    expect(SQL_SCRIPT_07_APP_COMPAT).toContain("'purge_audit_logs'");

    const syncResult = verifySqlArtifactsSync(ROOT_DIR);
    expect(syncResult.errors).toEqual([]);
    expect(syncResult.inSync).toBe(true);
  });

  it('vérifie le helper logAudit dans adminUsersHandler.ts (USER_ADMIN_<ACTION>, category USERS, WARNING sur delete/reset_password/set_role/block)', () => {
    const handlerCode = fs.readFileSync(
      path.join(ROOT_DIR, 'supabase/functions/_shared/adminUsersHandler.ts'),
      'utf8'
    );
    expect(handlerCode).toContain("type: 'USER_ADMIN_' + actionType.toUpperCase()");
    expect(handlerCode).toContain("category: 'USERS'");
    expect(handlerCode).toContain(
      "['delete', 'reset_password', 'set_role', 'block'].includes(actionType)"
    );
    expect(handlerCode).toContain("severity");
  });
});

describe('Prompt v53 — Construction des paramètres, diff meta.changes, échecs répétés, secrets & export CSV', () => {
  beforeEach(() => {
    resetSessionRestoredThrottleForTests();
  });

  it('construit les paramètres RPC pour search_audit_logs et search_login_logs', () => {
    const now = new Date('2026-11-09T12:00:00.000Z');
    const auditParams = buildSearchAuditLogsRpcParams(
      {
        period: '7d',
        category: 'USERS',
        user: 'Jean',
        type: 'ROW_UPDATE',
        severity: 'WARNING',
        text: 'role_id',
        limit: 50,
        offset: 100,
      },
      now
    );
    expect(auditParams).toEqual({
      p_from: '2026-11-02T12:00:00.000Z',
      p_to: null,
      p_category: 'USERS',
      p_user: 'Jean',
      p_type: 'ROW_UPDATE',
      p_severity: 'WARNING',
      p_text: 'role_id',
      p_limit: 50,
      p_offset: 100,
    });

    const loginParams = buildSearchLoginLogsRpcParams(
      {
        period: '30d',
        user: 'admin@tot.local',
        action: 'LOGIN_FAILED',
        text: '192.168.1.10',
        limit: 50,
        offset: 0,
      },
      now
    );
    expect(loginParams).toEqual({
      p_from: '2026-10-10T12:00:00.000Z',
      p_to: null,
      p_user: 'admin@tot.local',
      p_action: 'LOGIN_FAILED',
      p_text: '192.168.1.10',
      p_limit: 50,
      p_offset: 0,
    });
  });

  it('regroupe les échecs de connexion répétés (>= 5 pour un même identifiant sur la période)', () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, idx) => ({
        id: `fail-${idx}`,
        app: 'stock',
        created_at: `2026-11-09T10:0${idx}:00.000Z`,
        user_name: 'attaquant@exemple.fr',
        identifier: 'attaquant@exemple.fr',
        action: 'LOGIN_FAILED',
        reason: 'INVALID_CREDENTIALS',
        ip_address: '203.0.113.5',
        meta: {},
      })),
      ...Array.from({ length: 3 }, (_, idx) => ({
        id: `other-${idx}`,
        app: 'stock',
        created_at: `2026-11-09T11:0${idx}:00.000Z`,
        user_name: 'autre@exemple.fr',
        identifier: 'autre@exemple.fr',
        action: 'LOGIN_FAILED',
        reason: 'INVALID_CREDENTIALS',
        ip_address: '203.0.113.9',
        meta: {},
      })),
    ];

    const repeated = detectRepeatedLoginFailures(rows, 5);
    expect(repeated).toHaveLength(1);
    expect(repeated[0].identifier).toBe('attaquant@exemple.fr');
    expect(repeated[0].count).toBe(5);
    expect(repeated[0].ipAddresses).toContain('203.0.113.5');
  });

  it('formate le diff meta.changes (« champ : ancienne valeur -> nouvelle valeur ») et conserve ***', () => {
    const diffs = formatAuditChangesDiff({
      table: 'core_users',
      record_id: 'usr-1',
      changes: {
        role_id: { old: 2, new: 1 },
        pin: { old: '***', new: '***' },
        is_blocked: { old: false, new: true },
      },
    });

    expect(diffs).toEqual([
      { field: 'is_blocked', oldValue: 'false', newValue: 'true', isMasked: false },
      { field: 'pin', oldValue: '***', newValue: '***', isMasked: true },
      { field: 'role_id', oldValue: '2', newValue: '1', isMasked: false },
    ]);
  });

  it('ne transmet jamais de secret ni de lignes exportées dans p_meta (sanitizeAuditMeta & logLoginFailureServer)', async () => {
    const sanitized = sanitizeAuditMeta({
      source: 'test',
      password: 'MonSuperPasswordSecret!',
      pin: '1234',
      pin_hash: '$2a$10$hash',
      brevo_api_key: 'xkeysib-123456',
      signed_token: 'eyJhbGciOiJFZERTQSJ9.secret',
      rows_data: [{ id: 1, secret: 'ligne' }],
      csv_content: 'col1;col2\nval1;val2',
      nested: {
        client_secret: 'msgraph-secret-value',
        normal_field: 'ok',
      },
    });

    expect(sanitized.password).toBe('***');
    expect(sanitized.pin).toBe('***');
    expect(sanitized.pin_hash).toBe('***');
    expect(sanitized.brevo_api_key).toBe('***');
    expect(sanitized.signed_token).toBe('***');
    expect(sanitized.rows_data).toBeUndefined();
    expect(sanitized.csv_content).toBeUndefined();
    expect(sanitized.nested.client_secret).toBe('***');
    expect(sanitized.nested.normal_field).toBe('ok');

    const rpcCalls: Array<{ fn: string; args: any }> = [];
    const fakeClient: any = {
      rpc: async (fn: string, args: any) => {
        rpcCalls.push({ fn, args });
        return { data: 'ok', error: null };
      },
    };

    // Si quelqu'un tente de passer un code PIN numérique comme identifiant, il est masqué en '[PIN]'
    await logLoginFailureServer(
      '4829',
      'INVALID_PIN',
      { attempted_pin: '4829', password: 'secret-password' },
      fakeClient
    );
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('log_login_failure');
    expect(rpcCalls[0].args.p_identifier).toBe('[PIN]');
    expect(rpcCalls[0].args.p_meta.attempted_pin).toBe('***');
    expect(rpcCalls[0].args.p_meta.password).toBe('***');
    expect(JSON.stringify(rpcCalls[0].args)).not.toContain('4829');
    expect(JSON.stringify(rpcCalls[0].args)).not.toContain('secret-password');

    // Vérifier le throttle 1/heure sur SESSION_RESTORED
    await logLoginEventServer('SESSION_RESTORED', { mode: 'supabase_auth' }, fakeClient);
    await logLoginEventServer('SESSION_RESTORED', { mode: 'supabase_auth' }, fakeClient);
    const restoredCalls = rpcCalls.filter(
      (c) => c.fn === 'log_login_event' && c.args.p_action === 'SESSION_RESTORED'
    );
    expect(restoredCalls).toHaveLength(1);

    // Vérifier logAuditEventServer
    await logAuditEventServer(
      {
        category: 'EXPORTS',
        type: 'csv_export',
        title: 'Export CSV',
        meta: { row_count: 12, rows_data: ['interdit'], api_key: 'top-secret' },
      },
      fakeClient
    );
    const auditCall = rpcCalls.find((c) => c.fn === 'log_audit_event');
    expect(auditCall?.args.p_meta.row_count).toBe(12);
    expect(auditCall?.args.p_meta.rows_data).toBeUndefined();
    expect(auditCall?.args.p_meta.api_key).toBe('***');
  });

  it('génère l’export CSV (BOM UTF-8 + séparateur ;) pour les événements et les connexions', () => {
    const csvEvents = generateAuditLogsCsv(
      [
        {
          id: 'ev-1',
          app: 'stock',
          created_at: '2026-11-09T09:00:00.000Z',
          user_name: 'Admin Général',
          user_trigram: 'ADM',
          type: 'ROW_UPDATE',
          action: 'ROW_UPDATE',
          category: 'USERS',
          severity: 'WARNING',
          title: 'Modification core_users',
          description: 'Changement de rôle ; test',
          table_name: 'core_users',
          record_id: 'usr-1',
          ip_address: '10.0.0.1',
          meta: {},
        },
      ],
      'fr'
    );
    expect(csvEvents.startsWith('\uFEFF')).toBe(true);
    expect(csvEvents).toContain('Date / Heure;Sévérité;Catégorie;Type;Acteur');
    expect(csvEvents).toContain('"Changement de rôle ; test"');

    const csvLogins = generateLoginLogsCsv(
      [
        {
          id: 'lg-1',
          app: 'stock',
          created_at: '2026-11-09T09:05:00.000Z',
          user_name: 'Admin Général',
          user_trigram: 'ADM',
          identifier: 'admin@tot.local',
          action: 'LOGIN_SUCCESS',
          reason: null,
          ip_address: '10.0.0.1',
          user_agent: 'Mozilla/5.0',
          meta: {},
        },
      ],
      'fr'
    );
    expect(csvLogins.startsWith('\uFEFF')).toBe(true);
    expect(csvLogins).toContain('Date / Heure;Action;Identifiant;Utilisateur');
    expect(csvLogins).toContain('LOGIN_SUCCESS;admin@tot.local;Admin Général');
  });
});

describe('Prompt v53 — Tests SQL PGlite de 16_audit_trail.sql (triggers, masquage ***, immuabilité, RPCs et purge >= 90 j)', () => {
  it(
    'exécute 16_audit_trail.sql deux fois sans erreur, trace automatiquement les modifications avec masquage ***, bloque UPDATE/DELETE directs et valide les RPCs',
    async () => {
      const db = new PGlite();
      await db.exec(AUTH_STUB_SQL);

      for (const script of ORDERED_CLIENT_SCRIPTS) {
        await db.exec(fs.readFileSync(path.join(ROOT_DIR, 'supabase-client', script), 'utf8'));
      }
      // 2e exécution idempotente
      await db.exec(fs.readFileSync(path.join(ROOT_DIR, 'supabase-client/16_audit_trail.sql'), 'utf8'));
      await db.exec(fs.readFileSync(path.join(ROOT_DIR, 'supabase-client/07_app_compat.sql'), 'utf8'));

      const UUID_SUPER_ADMIN = '00000000-0000-4000-8000-000000000900';
      const UUID_STD_USER = '00000000-0000-4000-8000-000000000901';

      await db.exec(`
        INSERT INTO auth.users (id, email) VALUES
          ('${UUID_SUPER_ADMIN}', 'superadmin@tot.local'),
          ('${UUID_STD_USER}', 'operateur@tot.local');

        INSERT INTO public.core_users (id, name, trigram, email, pin, role_id, is_blocked, auth_user_id)
        VALUES
          ('usr-super', 'Super Admin', 'SUP', 'superadmin@tot.local', '1234', 0, false, '${UUID_SUPER_ADMIN}'),
          ('usr-std', 'Opérateur Terrain', 'OPE', 'operateur@tot.local', '5678', 3, false, '${UUID_STD_USER}');
      `);

      // 1. Vérifier que le trigger trg_audit_core_users a enregistré l'INSERT et masqué le champ `pin` en '***'
      const insertAuditRes = await db.query<{
        category: string;
        type: string;
        meta: any;
      }>(`
        SELECT category, type, meta
        FROM public.core_audit_logs
        WHERE table_name = 'core_users' AND record_id = 'usr-std' AND type = 'CORE_USERS_INSERT'
        LIMIT 1;
      `);
      expect(insertAuditRes.rows).toHaveLength(1);
      expect(insertAuditRes.rows[0].category).toBe('USERS');
      expect(insertAuditRes.rows[0].meta.snapshot.pin).toBe('***');

      // 2. Modifier core_users (changement de rôle + changement de pin) sous l'identité du Super Admin
      await db.exec(`
        BEGIN;
        SELECT set_config('request.jwt.claim.sub', '${UUID_SUPER_ADMIN}', true);
        SELECT set_config('request.jwt.claim.role', 'authenticated', true);
        UPDATE public.core_users SET role_id = 2, pin = '9999' WHERE id = 'usr-std';
        COMMIT;
      `);

      const updateAuditRes = await db.query<{
        severity: string;
        user_name: string;
        meta: any;
      }>(`
        SELECT severity, user_name, meta
        FROM public.core_audit_logs
        WHERE table_name = 'core_users' AND record_id = 'usr-std' AND type = 'CORE_USERS_UPDATE'
        ORDER BY created_at DESC
        LIMIT 1;
      `);
      expect(updateAuditRes.rows).toHaveLength(1);
      expect(updateAuditRes.rows[0].severity).toBe('WARNING');
      expect(updateAuditRes.rows[0].user_name).toBe('Super Admin');
      expect(updateAuditRes.rows[0].meta.changes.role_id).toEqual({ old: 3, new: 2 });
      expect(updateAuditRes.rows[0].meta.changes.pin).toEqual({ old: '***', new: '***' });

      // 3. Immuabilité : tout UPDATE ou DELETE direct sur core_audit_logs ou core_login_logs est refusé
      await expect(
        db.query(`DELETE FROM public.core_audit_logs WHERE record_id = 'usr-std';`)
      ).rejects.toThrow(/immuable/i);

      await expect(
        db.query(`UPDATE public.core_audit_logs SET title = 'Truqué' WHERE record_id = 'usr-std';`)
      ).rejects.toThrow(/immuable/i);

      // 4. log_login_failure est appelable par anon et masque les secrets dans meta
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE anon;
        SELECT public.log_login_failure('inconnu@tot.local', 'INVALID_CREDENTIALS', '{"password":"secret_password"}'::jsonb);
        COMMIT;
      `);

      const failRes = await db.query<{
        action: string;
        identifier: string;
        meta: any;
      }>(`
        SELECT action, identifier, meta
        FROM public.core_login_logs
        WHERE identifier = 'inconnu@tot.local'
        LIMIT 1;
      `);
      expect(failRes.rows).toHaveLength(1);
      expect(failRes.rows[0].action).toBe('LOGIN_FAILED');
      expect(failRes.rows[0].meta.password).toBe('***');

      // 5. search_audit_logs & search_login_logs (Super Admin autorisé, utilisateur sans permission refusé)
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_STD_USER}', true);
        SELECT set_config('request.jwt.claim.role', 'authenticated', true);
      `);
      await expect(
        db.query(`SELECT * FROM public.search_audit_logs();`)
      ).rejects.toThrow(/Permission refusée|Accès refusé/i);
      await db.exec(`ROLLBACK;`);

      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_SUPER_ADMIN}', true);
        SELECT set_config('request.jwt.claim.role', 'authenticated', true);
      `);
      const searchRes = await db.query<{ total_count: number; row_data: any }>(
        `SELECT * FROM public.search_audit_logs(NULL, NULL, 'USERS', NULL, NULL, NULL, NULL, 50, 0);`
      );
      expect(Number(searchRes.rows[0]?.total_count)).toBeGreaterThanOrEqual(2);

      // 6. purge_audit_logs : refuse < 90 jours, accepte >= 90 jours pour rôle 0
      await expect(
        db.query(`SELECT public.purge_audit_logs(30);`)
      ).rejects.toThrow(/90 jours/i);
      await db.exec(`ROLLBACK;`);

      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_SUPER_ADMIN}', true);
        SELECT set_config('request.jwt.claim.role', 'authenticated', true);
      `);
      const purgeRes = await db.query<{ purge_audit_logs: any }>(
        `SELECT public.purge_audit_logs(90);`
      );
      expect(purgeRes.rows[0].purge_audit_logs.older_than_days).toBe(90);
      await db.exec(`COMMIT;`);

      await db.close();
    },
    120_000
  );
});
