import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '..');

export const SQL_STEPS = [
  {
    step: '00',
    sourceRel: 'supabase-client/00_complete_tot_stock_schema.sql',
    migrationName: '20261003_complete_tot_stock_schema.sql',
    label: 'Schéma de base TOT Stock (tables, index, RLS initial)',
  },
  {
    step: '01',
    sourceRel: 'supabase-client/01_auth_link.sql',
    migrationName: '20261005010000_01_auth_link.sql',
    label: 'Liaison Supabase Auth (auth.users <-> public.users)',
  },
  {
    step: '01b',
    sourceRel: 'supabase-client/01b_migrate_users_id_to_text.sql',
    migrationName: '20261005013000_01b_migrate_users_id_to_text.sql',
    label: 'Migration auto-protégée public.users.id vers TEXT',
  },
  {
    step: '02',
    sourceRel: 'supabase-client/02_rls_hardening.sql',
    migrationName: '20261005020000_02_rls_hardening.sql',
    label: 'Durcissement RLS, plan_limits(plan) et get_email_secret()',
  },
  {
    step: '03',
    sourceRel: 'supabase-client/03_rpc_stock_and_orders.sql',
    migrationName: '20261005030000_03_rpc_stock_and_orders.sql',
    label: 'RPC transactionnelles stock, commandes et quota max_references',
  },
  {
    step: '04',
    sourceRel: 'supabase-client/04_mouvements_et_depots_vehicules.sql',
    migrationName: '20261005040000_04_mouvements_et_depots_vehicules.sql',
    label: 'Mouvements, dépôts multi-types (FIXED/VEHICLE/CONTAINER) et stock_levels',
  },
  {
    step: '05',
    sourceRel: 'supabase-client/05_rpc_admin_users.sql',
    migrationName: '20261005050000_05_rpc_admin_users.sql',
    label: 'Sécurité utilisateurs, get_or_link_my_profile() et révocation annuaire anonyme',
  },
  {
    step: '06',
    sourceRel: 'supabase-client/06_install_additional_roles.sql',
    migrationName: '20261005060000_06_install_additional_roles.sql',
    label: 'Installation idempotente des rôles métier complémentaires (5 à 10)',
  },
  {
    step: '08',
    sourceRel: 'supabase-client/08_print_jobs.sql',
    migrationName: '20261005080000_08_print_jobs.sql',
    label: 'Postes et file de travaux d\'impression d\'étiquettes à distance (print_stations, print_jobs)',
  },
  {
    step: '07',
    sourceRel: 'supabase-client/07_app_compat.sql',
    migrationName: '20261005070000_07_app_compat.sql',
    label: 'Table app_compat, is_active_admin(), diagnostic_installation() et durcissement final anon',
  },
];

export function readAppVersionInfo(rootDir = ROOT_DIR) {
  const pkgPath = path.join(rootDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const appVerPath = path.join(rootDir, 'src', 'appVersion.ts');
  let expectedSchema = '1.0.0';
  if (fs.existsSync(appVerPath)) {
    const content = fs.readFileSync(appVerPath, 'utf8');
    const m = content.match(/EXPECTED_SCHEMA_VERSION\s*=\s*['"]([^'"]+)['"]/);
    if (m) expectedSchema = m[1];
  }
  return {
    appVersion: pkg.version || '5.5.0',
    expectedSchemaVersion: expectedSchema,
  };
}

export function generateMigrationContent(stepObj, rawSource) {
  if (stepObj.step === '00') {
    return rawSource.endsWith('\n') ? rawSource : `${rawSource}\n`;
  }
  const header = [
    '-- =========================================================================',
    `-- FICHIER GÉNÉRÉ AUTOMATIQUEMENT PAR scripts/build-sql.mjs — NE PAS MODIFIER DIRECTEMENT`,
    `-- Source de vérité : ${stepObj.sourceRel}`,
    `-- Étape ${stepObj.step} : ${stepObj.label}`,
    '-- =========================================================================',
    '',
  ].join('\n');
  const normalized = rawSource.endsWith('\n') ? rawSource : `${rawSource}\n`;
  return `${header}${normalized}`;
}

export function generateInstallSqlContent(rootDir = ROOT_DIR) {
  const { appVersion, expectedSchemaVersion } = readAppVersionInfo(rootDir);
  const chunks = [
    '-- =========================================================================',
    '-- TOT STOCK — SCRIPT D\'INSTALLATION SQL CONSOLIDÉ (dist/install.sql)',
    `-- Version de l'application : v${appVersion}`,
    `-- Version du schéma attendu : v${expectedSchemaVersion}`,
    '-- Date de référence du schéma : 2026-10-05',
    '-- Généré automatiquement par : npm run build:sql (scripts/build-sql.mjs)',
    '-- Compatible Supabase SQL Editor & psql — 100 % Rejouable (Idempotent)',
    '-- =========================================================================',
    '',
  ];

  for (const item of SQL_STEPS) {
    const absSource = path.join(rootDir, item.sourceRel);
    const raw = fs.readFileSync(absSource, 'utf8').trim();
    const safeNotice = `=== [TOT STOCK v${appVersion}] Étape ${item.step} : ${item.label} (${item.sourceRel}) ===`.replace(/'/g, "''");

    chunks.push(
      `-- -------------------------------------------------------------------------`,
      `-- ÉTAPE ${item.step} : ${item.label}`,
      `-- Source : ${item.sourceRel}`,
      `-- -------------------------------------------------------------------------`,
      `DO $$ BEGIN RAISE NOTICE '${safeNotice}'; END $$;`,
      '',
      raw,
      ''
    );
  }

  chunks.push(
    `DO $$ BEGIN RAISE NOTICE '=== [TOT STOCK v${appVersion}] Installation SQL terminée avec succès ==='; END $$;`,
    ''
  );

  return chunks.join('\n');
}

export function buildSqlArtifacts(rootDir = ROOT_DIR) {
  const migrationsDir = path.join(rootDir, 'supabase', 'migrations');
  const distDir = path.join(rootDir, 'dist');
  fs.mkdirSync(migrationsDir, { recursive: true });
  fs.mkdirSync(distDir, { recursive: true });

  // Ensure 00_complete_tot_stock_schema.sql exists if migrating from 20261003_complete_tot_stock_schema.sql
  const step0Source = path.join(rootDir, SQL_STEPS[0].sourceRel);
  const step0Migration = path.join(migrationsDir, SQL_STEPS[0].migrationName);
  if (!fs.existsSync(step0Source) && fs.existsSync(step0Migration)) {
    fs.copyFileSync(step0Migration, step0Source);
  }

  const writtenMigrations = [];
  for (const item of SQL_STEPS) {
    const absSource = path.join(rootDir, item.sourceRel);
    if (!fs.existsSync(absSource)) {
      throw new Error(`Script SQL source introuvable : ${item.sourceRel}`);
    }
    const raw = fs.readFileSync(absSource, 'utf8');
    const outContent = generateMigrationContent(item, raw);
    const outPath = path.join(migrationsDir, item.migrationName);
    fs.writeFileSync(outPath, outContent, 'utf8');
    writtenMigrations.push(outPath);
  }

  const installSql = generateInstallSqlContent(rootDir);
  const installSqlPath = path.join(distDir, 'install.sql');
  fs.writeFileSync(installSqlPath, installSql, 'utf8');

  return {
    writtenMigrations,
    installSqlPath,
  };
}

export function verifySqlArtifactsSync(rootDir = ROOT_DIR) {
  const migrationsDir = path.join(rootDir, 'supabase', 'migrations');
  const installSqlPath = path.join(rootDir, 'dist', 'install.sql');
  const errors = [];

  for (const item of SQL_STEPS) {
    const absSource = path.join(rootDir, item.sourceRel);
    const migPath = path.join(migrationsDir, item.migrationName);
    if (!fs.existsSync(absSource)) {
      errors.push(`Source manquante : ${item.sourceRel}`);
      continue;
    }
    if (!fs.existsSync(migPath)) {
      errors.push(`Migration générée manquante : supabase/migrations/${item.migrationName}`);
      continue;
    }
    const expectedMig = generateMigrationContent(item, fs.readFileSync(absSource, 'utf8'));
    const actualMig = fs.readFileSync(migPath, 'utf8');
    if (actualMig !== expectedMig) {
      errors.push(
        `Migration désynchronisée : supabase/migrations/${item.migrationName} diffère de ${item.sourceRel}`
      );
    }
  }

  if (!fs.existsSync(installSqlPath)) {
    errors.push('Fichier consolidé dist/install.sql manquant');
  } else {
    const expectedInstall = generateInstallSqlContent(rootDir);
    const actualInstall = fs.readFileSync(installSqlPath, 'utf8');
    if (actualInstall !== expectedInstall) {
      errors.push('Le fichier consolidé dist/install.sql est désynchronisé des scripts sources');
    }
  }

  return {
    inSync: errors.length === 0,
    errors,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const res = buildSqlArtifacts();
  console.log(`[build:sql] ${res.writtenMigrations.length} migrations générées dans supabase/migrations/`);
  console.log(`[build:sql] Fichier consolidé généré : ${path.relative(ROOT_DIR, res.installSqlPath)}`);
}

