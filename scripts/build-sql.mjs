import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEdgeFunctions, verifyEdgeFunctionsSync } from './build-edge.mjs';

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
    step: '09',
    sourceRel: 'supabase-client/09_core_prefixes.sql',
    migrationName: '20261004000000_09_core_prefixes.sql',
    label: 'Renommage idempotent des tables vers core_* et stk_* + vues de compatibilité',
  },
  {
    step: '01',
    sourceRel: 'supabase-client/01_auth_link.sql',
    migrationName: '20261005010000_01_auth_link.sql',
    label: 'Liaison Supabase Auth (auth.users <-> public.core_users)',
  },
  {
    step: '01b',
    sourceRel: 'supabase-client/01b_migrate_users_id_to_text.sql',
    migrationName: '20261005013000_01b_migrate_users_id_to_text.sql',
    label: 'Migration auto-protégée public.core_users.id vers TEXT',
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
    migrationName: '20261005065000_08_print_jobs.sql',
    label: 'Postes et file de travaux d\'impression d\'étiquettes à distance (print_stations, print_jobs)',
  },
  {
    step: '11',
    sourceRel: 'supabase-client/11_suite_tables.sql',
    migrationName: '20261005068000_11_suite_tables.sql',
    label: 'Tables manquantes (stk_order_preparations_log, stk_categories, stk_material_order_items), core_files et bucket privé tot-files',
  },
  {
    step: '12',
    sourceRel: 'supabase-client/12_user_preferences.sql',
    migrationName: '20261005069000_12_user_preferences.sql',
    label: 'Préférences utilisateur synchronisées entre appareils (core_user_preferences)',
  },
  {
    step: '13',
    sourceRel: 'supabase-client/13_transfer_stock_batch.sql',
    migrationName: '20261005069500_13_transfer_stock_batch.sql',
    label: 'Transfert de matériel entre dépôts par lot (transfer_stock_batch) & permission perm_stock_transfer',
  },
  {
    step: '14',
    sourceRel: 'supabase-client/14_mailing.sql',
    migrationName: '20261005069800_14_mailing.sql',
    label: 'Mailing multi-fournisseurs, expéditeurs par application (stk, hab, rpt, tools) et journal core_mail_log',
  },
  {
    step: '15',
    sourceRel: 'supabase-client/15_search_orders_movements.sql',
    migrationName: '20261005069900_15_search_orders_movements.sql',
    label: 'Recherche serveur paginée Commandes (search_material_orders) & Mouvements (search_stock_movements)',
  },
  {
    step: '16',
    sourceRel: 'supabase-client/16_audit_trail.sql',
    migrationName: '20261005069950_16_audit_trail.sql',
    label: 'Journal d\'audit serveur complet immuable, triggers automatiques & recherche paginée (16_audit_trail.sql)',
  },
  {
    step: '17',
    sourceRel: 'supabase-client/17_transferts_valides.sql',
    migrationName: '20261005069970_17_transferts_valides.sql',
    label: 'Transferts validés à la réception, responsables de dépôt (stk_depot_holders, stk_transfers) & droits fins (17_transferts_valides.sql)',
  },
  {
    step: '18',
    sourceRel: 'supabase-client/18_password_reset.sql',
    migrationName: '20261005069980_18_password_reset.sql',
    label: 'Réinitialisation du mot de passe par code à 6 chiffres à usage unique (core_password_resets & purge_expired_password_resets)',
  },
  {
    step: '19',
    sourceRel: 'supabase-client/19_order_trace.sql',
    migrationName: '20261005069990_19_order_trace.sql',
    label: 'Traçabilité des commandes : demandeur, préparateur, enleveur, retrait transféré (trigger trg_order_trace & get_order_trace)',
  },
  {
    step: '20',
    sourceRel: 'supabase-client/20_notification_reads.sql',
    migrationName: '20261005069995_20_notification_reads.sql',
    label: 'Notifications lues par utilisateur (core_notification_dismissals, dismiss_notifications, clear_my_dismissals)',
  },
  {
    step: '21',
    sourceRel: 'supabase-client/21_vehicules_transferts_regles.sql',
    migrationName: '20261005069997_21_vehicules_transferts_regles.sql',
    label: 'Visibilité véhicules/conteneurs par département, cohérence attribution, retour des transferts de plus de 7 jours',
  },
  {
    step: '07',
    sourceRel: 'supabase-client/07_app_compat.sql',
    migrationName: '20261005070000_07_app_compat.sql',
    label: 'Table app_compat, is_active_admin(), diagnostic_installation() et durcissement final anon',
  },
];

export const CREATE_TABLE_SOURCE_FILES = [
  'supabase-client/02_rls_hardening.sql',
  'supabase-client/00_complete_tot_stock_schema.sql',
  'supabase-client/03_rpc_stock_and_orders.sql',
  'supabase-client/04_mouvements_et_depots_vehicules.sql',
  'supabase-client/07_app_compat.sql',
  'supabase-client/08_print_jobs.sql',
  'supabase-client/11_suite_tables.sql',
  'supabase-client/12_user_preferences.sql',
  'supabase-client/14_mailing.sql',
  'supabase-client/16_audit_trail.sql',
  'supabase-client/17_transferts_valides.sql',
  'supabase-client/18_password_reset.sql',
];

const AUTO_COLUMNS_START_MARKER = '-- [BEGIN AUTO_GENERATED_ADD_COLUMNS]';
const AUTO_COLUMNS_END_MARKER = '-- [END AUTO_GENERATED_ADD_COLUMNS]';

export function stripSqlComments(sql) {
  let out = '';
  let i = 0;
  let inSingleQuote = false;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (inSingleQuote) {
      out += ch;
      if (ch === "'" && next === "'") {
        out += next;
        i += 2;
        continue;
      }
      if (ch === "'") {
        inSingleQuote = false;
      }
      i += 1;
      continue;
    }
    if (ch === "'") {
      inSingleQuote = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') {
        i += 1;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) {
        i += 1;
      }
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function splitTopLevelCommas(body) {
  const parts = [];
  let current = '';
  let depth = 0;
  let inSingleQuote = false;

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    const next = body[i + 1];
    if (inSingleQuote) {
      current += ch;
      if (ch === "'" && next === "'") {
        current += next;
        i += 1;
        continue;
      }
      if (ch === "'") {
        inSingleQuote = false;
      }
      continue;
    }
    if (ch === "'") {
      inSingleQuote = true;
      current += ch;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      current += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

function stripBalancedCheckClauses(input) {
  let result = input;
  const checkRegex = /\bCHECK\s*\(/i;
  let safety = 0;
  while (safety < 20) {
    safety += 1;
    const m = checkRegex.exec(result);
    if (!m) break;
    const startIdx = m.index;
    const openParenIdx = startIdx + m[0].length - 1;
    let depth = 1;
    let inQuote = false;
    let j = openParenIdx + 1;
    while (j < result.length && depth > 0) {
      const ch = result[j];
      const next = result[j + 1];
      if (inQuote) {
        if (ch === "'" && next === "'") {
          j += 2;
          continue;
        }
        if (ch === "'") inQuote = false;
        j += 1;
        continue;
      }
      if (ch === "'") {
        inQuote = true;
      } else if (ch === '(') {
        depth += 1;
      } else if (ch === ')') {
        depth -= 1;
      }
      j += 1;
    }
    result = `${result.slice(0, startIdx)} ${result.slice(j)}`;
  }
  return result;
}

export function cleanColumnDefinitionForAddColumn(rawDef) {
  let def = stripBalancedCheckClauses(rawDef);
  def = def.replace(
    /\bREFERENCES\s+[a-zA-Z0-9_.]+\s*\([^)]*\)(?:\s+ON\s+(?:DELETE|UPDATE)\s+(?:CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION))*/gi,
    ' '
  );
  def = def.replace(/\bPRIMARY\s+KEY\b/gi, ' ');
  def = def.replace(/\bNOT\s+NULL\b/gi, ' ');
  def = def.replace(/\bUNIQUE\b/gi, ' ');
  def = def.replace(/(?<!DEFAULT\s)\bNULL\b/gi, ' ');
  def = def.replace(/^BIGSERIAL\b/i, 'BIGINT').replace(/^SERIAL\b/i, 'INT');
  return def.replace(/\s+/g, ' ').trim();
}

export function extractCreateTableColumnsFromSql(sqlContent) {
  let withoutAutoBlock = sqlContent;
  const sIdx = withoutAutoBlock.indexOf(AUTO_COLUMNS_START_MARKER);
  const eIdx = withoutAutoBlock.indexOf(AUTO_COLUMNS_END_MARKER);
  if (sIdx !== -1 && eIdx !== -1 && eIdx > sIdx) {
    withoutAutoBlock =
      withoutAutoBlock.slice(0, sIdx) +
      withoutAutoBlock.slice(eIdx + AUTO_COLUMNS_END_MARKER.length);
  }
  const cleanSql = stripSqlComments(withoutAutoBlock);
  const createRegex = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.([a-zA-Z0-9_]+)\s*\(/gi;
  const extracted = [];
  let match;

  while ((match = createRegex.exec(cleanSql)) !== null) {
    const tableName = match[1];
    const openParenIdx = match.index + match[0].length - 1;
    let depth = 1;
    let inQuote = false;
    let j = openParenIdx + 1;
    while (j < cleanSql.length && depth > 0) {
      const ch = cleanSql[j];
      const next = cleanSql[j + 1];
      if (inQuote) {
        if (ch === "'" && next === "'") {
          j += 2;
          continue;
        }
        if (ch === "'") inQuote = false;
        j += 1;
        continue;
      }
      if (ch === "'") {
        inQuote = true;
      } else if (ch === '(') {
        depth += 1;
      } else if (ch === ')') {
        depth -= 1;
      }
      j += 1;
    }
    const body = cleanSql.slice(openParenIdx + 1, j - 1);
    const items = splitTopLevelCommas(body);
    for (const rawItem of items) {
      const normalized = rawItem.replace(/\s+/g, ' ').trim();
      if (!normalized) continue;
      if (/^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY)\b/i.test(normalized)) {
        continue;
      }
      const colMatch = normalized.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+(.+)$/);
      if (!colMatch) continue;
      const colName = colMatch[1];
      if (colName.toLowerCase() === 'id') continue;
      const cleanedDef = cleanColumnDefinitionForAddColumn(colMatch[2]);
      if (!cleanedDef) continue;
      extracted.push({
        tableName,
        columnName: colName,
        definition: cleanedDef,
      });
    }
  }
  return extracted;
}

export function generateLegacyColumnsAlignmentSql(rootDir = ROOT_DIR) {
  const seen = new Set();
  const statements = [];

  for (const relPath of CREATE_TABLE_SOURCE_FILES) {
    const absPath = path.join(rootDir, relPath);
    if (!fs.existsSync(absPath)) continue;
    const content = fs.readFileSync(absPath, 'utf8');
    const cols = extractCreateTableColumnsFromSql(content);
    for (const c of cols) {
      const key = `${c.tableName.toLowerCase()}.${c.columnName.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      statements.push(
        `ALTER TABLE IF EXISTS public.${c.tableName} ADD COLUMN IF NOT EXISTS ${c.columnName} ${c.definition};`
      );
    }
  }

  return [
    AUTO_COLUMNS_START_MARKER,
    '-- Alignement automatique des colonnes manquantes sur les tables déjà existantes (généré par scripts/build-sql.mjs)',
    ...statements,
    AUTO_COLUMNS_END_MARKER,
  ].join('\n');
}

export function syncScript02AutoGeneratedColumns(rootDir = ROOT_DIR) {
  const script02Path = path.join(rootDir, 'supabase-client', '02_rls_hardening.sql');
  if (!fs.existsSync(script02Path)) return;
  const raw = fs.readFileSync(script02Path, 'utf8');
  const startIdx = raw.indexOf(AUTO_COLUMNS_START_MARKER);
  const endIdx = raw.indexOf(AUTO_COLUMNS_END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return;

  const generatedBlock = generateLegacyColumnsAlignmentSql(rootDir);
  const updated =
    raw.slice(0, startIdx) +
    generatedBlock +
    raw.slice(endIdx + AUTO_COLUMNS_END_MARKER.length);

  if (updated !== raw) {
    fs.writeFileSync(script02Path, updated, 'utf8');
  }
}

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

  syncScript02AutoGeneratedColumns(rootDir);

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

  const edgeResult = buildEdgeFunctions(rootDir);

  return {
    writtenMigrations,
    installSqlPath,
    edgeResult,
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

  const edgeErrors = verifyEdgeFunctionsSync(rootDir);
  errors.push(...edgeErrors);

  return {
    inSync: errors.length === 0,
    errors,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const args = process.argv.slice(2);
  if (args.includes('--check')) {
    const sync = verifySqlArtifactsSync(ROOT_DIR);
    if (!sync.inSync) {
      for (const err of sync.errors) {
        console.error(`[build:sql --check] ERREUR : ${err}`);
      }
      process.exit(1);
    }
    console.log(
      '[build:sql --check] OK : migrations, dist/install.sql et supabase-client/generated/edge-functions* sont à jour.'
    );
    process.exit(0);
  }

  const res = buildSqlArtifacts();
  console.log(`[build:sql] ${res.writtenMigrations.length} migrations générées dans supabase/migrations/`);
  console.log(`[build:sql] Fichier consolidé généré : ${path.relative(ROOT_DIR, res.installSqlPath)}`);
  console.log(
    `[build:sql] ${res.edgeResult.writtenClientFiles.length} fonctions Edge clientes + 1 fonction maître générées dans supabase-client/generated/edge-functions/`
  );
}

