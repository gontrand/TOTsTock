import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  TABLES,
  SUITE_APP_PREFIXES,
  CURRENT_SUITE_APP_CODE,
  LEGACY_TO_PREFIXED_TABLE_MAP,
  resolvePrefixedTableName,
} from '../constants/tables';
import {
  APP_VERSION,
  EXPECTED_SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
} from '../appVersion';
import {
  SQL_SCRIPT_09_CORE_PREFIXES,
  SQL_SCRIPT_10_DROP_COMPAT_VIEWS,
} from '../constants/supabaseScripts';
import { translations } from '../i18n/translations';
import { SQL_STEPS, verifySqlArtifactsSync } from '../../scripts/build-sql.mjs';

const ROOT_DIR = path.resolve(__dirname, '../..');

function collectTsFiles(dirPath: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dirPath)) return results;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      results.push(...collectTsFiles(full));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

describe('Prompt v42 — Préfixes de tables core_ et stk_ pour la suite TOT (schéma 2.0.0)', () => {
  describe('1. Nomenclature centrale dans src/constants/tables.ts', () => {
    it('définit toutes les tables core_* et stk_* ainsi que les conventions hab_ et rpt_', () => {
      expect(TABLES).toEqual({
        // Tables partagées Suite TOT (core_)
        users: 'core_users',
        roles: 'core_roles',
        departments: 'core_departments',
        projects: 'core_projects',
        companySettings: 'core_company_settings',
        appSettings: 'core_app_settings',
        licenseConfig: 'core_license_config',
        appCompat: 'core_app_compat',
        auditLogs: 'core_audit_logs',
        loginLogs: 'core_login_logs',
        processedOperations: 'core_processed_operations',
        files: 'core_files',
        userPreferences: 'core_user_preferences',
        mailAccounts: 'core_mail_accounts',
        mailSenders: 'core_mail_senders',
        mailLog: 'core_mail_log',

        // Tables TOT Stock (stk_)
        products: 'stk_products',
        categories: 'stk_categories',
        subCategories: 'stk_sub_categories',
        stockLevels: 'stk_stock_levels',
        depots: 'stk_depots',
        movements: 'stk_movements',
        stockMovements: 'stk_movements',
        materialOrders: 'stk_material_orders',
        materialOrderItems: 'stk_material_order_items',
        printJobs: 'stk_print_jobs',
        printStations: 'stk_print_stations',
        inventoryAudits: 'stk_inventory_audits',
        inventoryAuditItems: 'stk_inventory_audit_items',
        orderPreparationsLog: 'stk_order_preparations_log',
      });

      expect(SUITE_APP_PREFIXES).toEqual({
        core: 'core_',
        stock: 'stk_',
        habilitation: 'hab_',
        report: 'rpt_',
        tools: 'tools_',
      });
      expect(CURRENT_SUITE_APP_CODE).toBe('stock');
    });

    it('resolvePrefixedTableName convertit les anciens noms (y compris stock_movements et movements) vers les noms préfixés', () => {
      expect(resolvePrefixedTableName('users')).toBe('core_users');
      expect(resolvePrefixedTableName('products')).toBe('stk_products');
      expect(resolvePrefixedTableName('stock_movements')).toBe('stk_movements');
      expect(resolvePrefixedTableName('movements')).toBe('stk_movements');
      expect(resolvePrefixedTableName('stock_levels')).toBe('stk_stock_levels');
      expect(resolvePrefixedTableName('audit_logs')).toBe('core_audit_logs');
      expect(resolvePrefixedTableName('processed_operations')).toBe('core_processed_operations');
      expect(resolvePrefixedTableName('stk_products')).toBe('stk_products');
      expect(resolvePrefixedTableName('core_users')).toBe('core_users');
      expect(Object.keys(LEGACY_TO_PREFIXED_TABLE_MAP).length).toBeGreaterThanOrEqual(25);
    });

    it('aucun appel Supabase .from(...) avec un ancien nom de table en dur ne subsiste dans src/ ni supabase/functions/', () => {
      const legacyTableNames = Object.keys(LEGACY_TO_PREFIXED_TABLE_MAP);
      const legacyFromRegex = new RegExp(
        `\\.from\\(\\s*['"\`](${legacyTableNames.join('|')})['"\`]\\s*\\)`,
        'g'
      );

      const filesToScan = [
        ...collectTsFiles(path.join(ROOT_DIR, 'src')),
        ...collectTsFiles(path.join(ROOT_DIR, 'supabase/functions')),
      ];

      const violations: Array<{ file: string; match: string }> = [];
      for (const filePath of filesToScan) {
        if (filePath.endsWith(path.join('src', 'constants', 'tables.ts'))) continue;
        const content = fs.readFileSync(filePath, 'utf8');
        const matches = content.match(legacyFromRegex);
        if (matches && matches.length > 0) {
          violations.push({
            file: path.relative(ROOT_DIR, filePath),
            match: matches.join(', '),
          });
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe('2. Scripts SQL 09_core_prefixes.sql, 10_drop_compat_views.sql et build-sql.mjs', () => {
    it('place 09_core_prefixes.sql avant 02_rls_hardening.sql dans SQL_STEPS et synchronise dist/install.sql', () => {
      const idx09 = SQL_STEPS.findIndex((s: any) =>
        String(s.sourceRel || '').endsWith('09_core_prefixes.sql')
      );
      const idx02 = SQL_STEPS.findIndex((s: any) =>
        String(s.sourceRel || '').endsWith('02_rls_hardening.sql')
      );
      expect(idx09).toBeGreaterThanOrEqual(0);
      expect(idx02).toBeGreaterThan(idx09);

      const sync = verifySqlArtifactsSync(ROOT_DIR);
      expect(sync.inSync).toBe(true);
    });

    it('exporte SQL_SCRIPT_09_CORE_PREFIXES et SQL_SCRIPT_10_DROP_COMPAT_VIEWS et documente la convention de la suite TOT', () => {
      expect(SQL_SCRIPT_09_CORE_PREFIXES).toContain('09_core_prefixes.sql');
      expect(SQL_SCRIPT_09_CORE_PREFIXES).toContain('_tot_refresh_compat_views');
      expect(SQL_SCRIPT_10_DROP_COMPAT_VIEWS).toContain('10_drop_compat_views.sql');
      expect(SQL_SCRIPT_10_DROP_COMPAT_VIEWS).toContain('DROP FUNCTION IF EXISTS public._tot_refresh_compat_views()');

      const docPath = path.join(ROOT_DIR, 'docs', 'CONVENTION_PREFIXES_SUITE_TOT.md');
      expect(fs.existsSync(docPath)).toBe(true);
      const docContent = fs.readFileSync(docPath, 'utf8');
      expect(docContent).toContain('core_');
      expect(docContent).toContain('stk_');
      expect(docContent).toContain('hab_');
      expect(docContent).toContain('rpt_');
      expect(docContent).toContain('10_drop_compat_views.sql');
    });
  });

  describe('3. Version de schéma 2.7.0 et traductions FR / EN / NL du diagnostic', () => {
    it('définit EXPECTED_SCHEMA_VERSION = 2.7.0 et MIN_SUPPORTED_SCHEMA_VERSION = 1.0.0', () => {
      expect(APP_VERSION).toBe('5.13.0');
      expect(EXPECTED_SCHEMA_VERSION).toBe('2.7.0');
      expect(MIN_SUPPORTED_SCHEMA_VERSION).toBe('1.0.0');
    });

    it('fournit les clés de traduction FR, EN et NL pour les contrôles prefixed_tables, compat_views_present et les scripts 09/10', () => {
      const requiredKeys = [
        'diag_prefixed_tables_label',
        'diag_compat_views_present_label',
        'diag_prefixed_tables_error_hint',
        'diag_compat_views_warning_hint',
        'sql_script_09_title',
        'sql_script_09_badge',
        'sql_script_09_desc',
        'sql_script_10_title',
        'sql_script_10_badge',
        'sql_script_10_desc',
      ] as const;

      for (const lang of ['fr', 'en', 'nl'] as const) {
        for (const key of requiredKeys) {
          const val = (translations[lang] as Record<string, string>)[key];
          expect(typeof val).toBe('string');
          expect(val.trim().length).toBeGreaterThan(5);
        }
      }
    });
  });
});
