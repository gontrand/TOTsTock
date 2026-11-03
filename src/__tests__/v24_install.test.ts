import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SQL_STEPS,
  buildSqlArtifacts,
  verifySqlArtifactsSync,
} from '../../scripts/build-sql.mjs';
import {
  EDGE_FUNCTIONS,
  bundleAllFunctions,
  generateSingleFunctionBundle,
} from '../../scripts/bundle-functions.mjs';
import {
  runTotInstall,
  checkSchemaDowngradeGuard,
  sanitizeLogText,
  maskEmail,
  parseCliArgs,
} from '../../scripts/tot-install.mjs';

const ROOT_DIR = path.resolve(__dirname, '../..');

describe('TOT Stock v24 — Installation rapide, migrations générées, Edge Functions et tot-install', () => {
  it('Point 1 : les fichiers supabase/migrations/*.sql et dist/install.sql sont synchronisés avec supabase-client/', () => {
    // S'assure que les artefacts SQL sont générés et vérifie leur synchronisation exacte
    buildSqlArtifacts(ROOT_DIR);
    const syncResult = verifySqlArtifactsSync(ROOT_DIR);
    expect(syncResult.inSync).toBe(true);
    expect(syncResult.errors).toEqual([]);

    // Vérifie que chaque étape source a bien sa migration horodatée dans l'ordre
    const migrationsDir = path.join(ROOT_DIR, 'supabase', 'migrations');
    for (const step of SQL_STEPS) {
      const migFile = path.join(migrationsDir, step.migrationName);
      expect(fs.existsSync(migFile)).toBe(true);
    }

    // Vérifie la présence de dist/install.sql avec en-tête de version et RAISE NOTICE par étape
    const installSqlPath = path.join(ROOT_DIR, 'dist', 'install.sql');
    expect(fs.existsSync(installSqlPath)).toBe(true);
    const installSqlContent = fs.readFileSync(installSqlPath, 'utf8');
    expect(installSqlContent).toContain('TOT STOCK — SCRIPT D\'INSTALLATION SQL CONSOLIDÉ');
    expect(installSqlContent).toContain("RAISE NOTICE '===");

    // Vérifie qu'une divergence entre un script source et la migration générée est détectée
    const firstStep = SQL_STEPS[1];
    const targetMigration = path.join(migrationsDir, firstStep.migrationName);
    const originalContent = fs.readFileSync(targetMigration, 'utf8');
    try {
      fs.writeFileSync(targetMigration, originalContent + '\n-- modification non synchronisée\n', 'utf8');
      const desynced = verifySqlArtifactsSync(ROOT_DIR);
      expect(desynced.inSync).toBe(false);
      expect(desynced.errors.length).toBeGreaterThan(0);
    } finally {
      fs.writeFileSync(targetMigration, originalContent, 'utf8');
    }
  });

  it('Point 2 : les Edge Functions partagent _shared/, n\'exigent aucun secret manuel et génèrent dist/functions/*.single.ts', () => {
    const writtenPaths = bundleAllFunctions(ROOT_DIR);
    expect(writtenPaths.length).toBe(3);

    for (const fnDef of EDGE_FUNCTIONS) {
      const singlePath = path.join(ROOT_DIR, 'dist', 'functions', `${fnDef.name}.single.ts`);
      expect(fs.existsSync(singlePath)).toBe(true);
      const content = fs.readFileSync(singlePath, 'utf8');
      const expected = generateSingleFunctionBundle(fnDef, ROOT_DIR);
      expect(content).toBe(expected);
      expect(content).toContain(fnDef.entryCall);
      // Les fichiers .single.ts ne doivent plus contenir d'import relatif vers ../_shared/
      expect(content).not.toMatch(/from\s+['"]\.\.\/_shared\//);
    }

    // Vérifie la présence de public.get_email_secret() SECURITY DEFINER réservé au service_role
    const rlsSql = fs.readFileSync(path.join(ROOT_DIR, 'supabase-client', '02_rls_hardening.sql'), 'utf8');
    expect(rlsSql).toContain('CREATE OR REPLACE FUNCTION public.get_email_secret()');
    expect(rlsSql).toContain('REVOKE ALL ON FUNCTION public.get_email_secret() FROM PUBLIC, anon, authenticated;');
    expect(rlsSql).toContain('GRANT EXECUTE ON FUNCTION public.get_email_secret() TO service_role;');

    // Vérifie que diagnostic_installation() contient bien le contrôle edge_functions_deployed
    const compatSql = fs.readFileSync(path.join(ROOT_DIR, 'supabase-client', '07_app_compat.sql'), 'utf8');
    expect(compatSql).toContain("'edge_functions_deployed'");
    expect(compatSql).toContain('Fonctions Edge déployées');
  });

  it('Point 3 : tot-install.mjs en mode --dry-run s\'exécute sans réseau avec un CLI simulé', async () => {
    const tmpReport = path.join(os.tmpdir(), `tot-install-dryrun-${Date.now()}.txt`);
    const logs: string[] = [];

    const result = await runTotInstall({
      flags: parseCliArgs(['--dry-run', '--project-ref', 'abcdefghijklmno12345']),
      env: {},
      reportPath: tmpReport,
      logger: { log: (m: string) => logs.push(m) },
      fetchImpl: async () => {
        throw new Error('Aucun appel réseau ne doit avoir lieu en --dry-run');
      },
      runCli: () => {
        throw new Error('Aucune commande CLI réelle ne doit être exécutée en --dry-run');
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.steps.length).toBe(7);
    expect(result.steps.every((s: any) => s.status === 'OK')).toBe(true);
    expect(fs.existsSync(tmpReport)).toBe(true);
    fs.unlinkSync(tmpReport);
  });

  it('Point 3 & 7 : aucun secret (jeton, mot de passe DB, service_role, clé de licence) n\'apparaît dans la sortie ni dans tot-install-report.txt', async () => {
    const fakeAccessToken = 'sbp_FAKE_SECRET_TOKEN_9876543210';
    const fakeDbPassword = 'SuperSecretDbPassword!2026';
    const fakeServiceRole = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.FAKESERVICEROLEPAYLOAD123456.FAKESIGNATURE987654';
    const fakeLicenseKey = 'TOT-ENT-2026-SECRET-KEY-9999';
    const fakeAdminPassword = 'AdminSecretPassword!99';
    const fakeAdminEmail = 'guillaume.admin@gmail.com';

    const tmpReport = path.join(os.tmpdir(), `tot-install-secrets-${Date.now()}.txt`);
    const stdoutLogs: string[] = [];

    const mockSupabaseClient = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: table === 'app_compat' ? { schema_version: '1.0.0', maintenance: false } : null,
              error: null,
            }),
            limit: async () => ({
              data: [],
              error: null,
            }),
          }),
        }),
        upsert: async () => ({ error: null }),
        update: () => ({
          eq: async () => ({ error: null }),
        }),
      }),
      auth: {
        admin: {
          createUser: async () => ({
            data: { user: { id: '00000000-0000-0000-0000-000000000001' } },
            error: null,
          }),
          listUsers: async () => ({ data: { users: [] }, error: null }),
        },
        signInWithPassword: async () => ({ data: {}, error: null }),
      },
      rpc: async (fnName: string) => {
        if (fnName === 'diagnostic_installation') {
          return {
            data: [
              {
                check_key: 'tables_present',
                check_label: 'Tables principales présentes',
                status: 'OK',
                details: '12/12 tables présentes',
              },
              {
                check_key: 'edge_functions_deployed',
                check_label: 'Fonctions Edge déployées',
                status: 'OK',
                details: '3/3 fonctions déployées (admin-users, sync-license, send-report-email)',
              },
            ],
            error: null,
          };
        }
        return { data: null, error: null };
      },
    };

    const result = await runTotInstall({
      flags: parseCliArgs(['--yes', '--project-ref', 'projref12345']),
      env: {
        SUPABASE_PROJECT_REF: 'projref12345',
        SUPABASE_ACCESS_TOKEN: fakeAccessToken,
        SUPABASE_DB_PASSWORD: fakeDbPassword,
        TOT_LICENSE_KEY: fakeLicenseKey,
        TOT_ADMIN_EMAIL: fakeAdminEmail,
        TOT_ADMIN_PASSWORD: fakeAdminPassword,
      },
      reportPath: tmpReport,
      logger: { log: (msg: string) => stdoutLogs.push(msg) },
      fetchImpl: async (url: string) => {
        if (url.endsWith('/api-keys')) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { name: 'service_role', api_key: fakeServiceRole },
              { name: 'anon', api_key: 'anon_public_key_example' },
            ],
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'ACTIVE_HEALTHY' }),
        };
      },
      runCli: (args: string[], opts: any) => {
        // Simule un message CLI qui tenterait accidentellement d'afficher les secrets passés
        const leakyOutput = `Exécution ${args.join(' ')} avec token=${fakeAccessToken} et db=${fakeDbPassword}`;
        return {
          status: 0,
          stdout: sanitizeLogText(leakyOutput, opts.secrets),
          stderr: '',
        };
      },
      createSupabaseClient: () => mockSupabaseClient as any,
    });

    expect(result.exitCode).toBe(0);

    const combinedLogs = stdoutLogs.join('\n');
    const reportText = fs.readFileSync(tmpReport, 'utf8');

    for (const secret of [
      fakeAccessToken,
      fakeDbPassword,
      fakeServiceRole,
      fakeLicenseKey,
      fakeAdminPassword,
    ]) {
      expect(combinedLogs).not.toContain(secret);
      expect(reportText).not.toContain(secret);
    }

    // L'adresse e-mail personnelle doit être masquée dans le rapport (g***@gmail.com)
    expect(reportText).not.toContain(fakeAdminEmail);
    expect(reportText).toContain(maskEmail(fakeAdminEmail));
    expect(maskEmail(fakeAdminEmail)).toBe('g***@gmail.com');

    fs.unlinkSync(tmpReport);
  });

  it('Point 4 & 7 : --update refuse toute rétrogradation si le schéma cible est plus ancien que celui de la base et restaure maintenance = false en finally', async () => {
    // 1. Test unitaire direct du garde-fou de rétrogradation
    const downgrade = checkSchemaDowngradeGuard('2.0.0', '1.0.0');
    expect(downgrade.allowed).toBe(false);
    expect(downgrade.reason).toContain('Refus de rétrogradation');

    const sameVersion = checkSchemaDowngradeGuard('1.0.0', '1.0.0');
    expect(sameVersion.allowed).toBe(true);

    const upgrade = checkSchemaDowngradeGuard('1.0.0', '1.1.0');
    expect(upgrade.allowed).toBe(true);

    // 2. Test de bout en bout de runTotInstall --update --maintenance face à une base en version 9.9.0 (> EXPECTED_SCHEMA_VERSION)
    const tmpReport = path.join(os.tmpdir(), `tot-install-downgrade-${Date.now()}.txt`);
    const maintenanceStates: boolean[] = [];

    const mockSupabaseWithNewerSchema = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: table === 'app_compat' ? { schema_version: '9.9.0', maintenance: false } : null,
              error: null,
            }),
          }),
        }),
        update: (payload: any) => ({
          eq: async () => {
            if (typeof payload?.maintenance === 'boolean') {
              maintenanceStates.push(payload.maintenance);
            }
            return { error: null };
          },
        }),
      }),
    };

    const result = await runTotInstall({
      flags: parseCliArgs(['--update', '--yes', '--maintenance', '--project-ref', 'projref12345']),
      env: {
        SUPABASE_PROJECT_REF: 'projref12345',
        SUPABASE_ACCESS_TOKEN: 'sbp_test_token_12345678',
        SUPABASE_DB_PASSWORD: 'TestDbPassword123!',
      },
      reportPath: tmpReport,
      logger: { log: () => {} },
      fetchImpl: async (url: string) => {
        if (url.endsWith('/api-keys')) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ name: 'service_role', api_key: 'sr_key_test_12345' }],
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      },
      runCli: () => ({ status: 0, stdout: '', stderr: '' }),
      createSupabaseClient: () => mockSupabaseWithNewerSchema as any,
    });

    // Doit échouer avec code != 0 et une étape ERREUR explicite refusant la rétrogradation
    expect(result.exitCode).toBe(1);
    expect(result.steps.some((s: any) => s.status === 'ERREUR' && s.details.includes('Refus de rétrogradation'))).toBe(
      true
    );

    if (fs.existsSync(tmpReport)) {
      fs.unlinkSync(tmpReport);
    }

    // 3. Vérifie que si une erreur survient pendant db push avec --maintenance, maintenance est bien remis à false dans finally
    const tmpReport2 = path.join(os.tmpdir(), `tot-install-maint-${Date.now()}.txt`);
    const maintHistory: boolean[] = [];

    const mockSupabaseCompatible = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: table === 'app_compat' ? { schema_version: '1.0.0', maintenance: false } : null,
              error: null,
            }),
          }),
        }),
        update: (payload: any) => ({
          eq: async () => {
            if (typeof payload?.maintenance === 'boolean') {
              maintHistory.push(payload.maintenance);
            }
            return { error: null };
          },
        }),
      }),
    };

    const resMaint = await runTotInstall({
      flags: parseCliArgs(['--update', '--yes', '--maintenance', '--project-ref', 'projref12345']),
      env: {
        SUPABASE_PROJECT_REF: 'projref12345',
        SUPABASE_ACCESS_TOKEN: 'sbp_test_token_12345678',
        SUPABASE_DB_PASSWORD: 'TestDbPassword123!',
      },
      reportPath: tmpReport2,
      logger: { log: () => {} },
      fetchImpl: async (url: string) => {
        if (url.endsWith('/api-keys')) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ name: 'service_role', api_key: 'sr_key_test_12345' }],
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      },
      // Simule un échec lors de db push après l'activation de maintenance = true
      runCli: (args: string[]) => {
        if (args[0] === 'db' && args[1] === 'push') {
          return { status: 1, stdout: '', stderr: 'Simulated db push failure' };
        }
        return { status: 0, stdout: '', stderr: '' };
      },
      createSupabaseClient: () => mockSupabaseCompatible as any,
    });

    expect(resMaint.exitCode).toBe(1);
    expect(maintHistory).toEqual([true, false]);

    if (fs.existsSync(tmpReport2)) {
      fs.unlinkSync(tmpReport2);
    }
  });
});
