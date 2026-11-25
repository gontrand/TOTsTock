import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { APP_VERSION, EXPECTED_SCHEMA_VERSION } from '../appVersion';

/**
 * v5.23.0 — pivot « 100% permissions ».
 *
 * Verrouille la règle : les comparaisons role_id === 0/1 (ou IN (0,1,5,8)) sont
 * interdites dans le code applicatif, sauf aux emplacements explicitement
 * autorisés ci-dessous :
 *   - userHasPermission()                : seul endroit qui bypass le super admin.
 *   - utils/userPerms.ts                 : helpers isSuperAdmin() / isAdminLevel().
 *   - utils/crypto.ts                    : bypass super admin dans un helper bas niveau.
 *   - utils/depotPermissions.ts          : bypass super admin dans un helper bas niveau.
 *   - services/mailingService.ts         : fallback de dernier recours.
 *   - Identification spécifique du rôle 0 pour empêcher l'édition du super admin
 *     (UsersRolesModal, CompanySetupModal, DesktopSettingsPage).
 */

const ROOT_DIR = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8');

function listTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      listTsFiles(p, out);
    } else if (name.endsWith('.ts') || name.endsWith('.tsx')) {
      out.push(p);
    }
  }
  return out;
}

const ALLOWED_FILES_FOR_ROLE_ID_0 = new Set([
  path.join(ROOT_DIR, 'src/context/AppContext.tsx'),
  path.join(ROOT_DIR, 'src/utils/userPerms.ts'),
  path.join(ROOT_DIR, 'src/utils/crypto.ts'),
  path.join(ROOT_DIR, 'src/utils/depotPermissions.ts'),
  path.join(ROOT_DIR, 'src/services/mailingService.ts'),
  // Identification spécifique « est-ce le super admin ? » pour l'UI
  path.join(ROOT_DIR, 'src/components/UsersRolesModal.tsx'),
  path.join(ROOT_DIR, 'src/components/CompanySetupModal.tsx'),
  path.join(ROOT_DIR, 'src/desktop/pages/DesktopSettingsPage.tsx'),
]);

describe('v5.23.0 — 100% permissions (plus de role_id codés en dur)', () => {
  it('aligne la version sur 5.23.3 (versionCode 31)', () => {
    expect(APP_VERSION).toBe('5.23.3');
    expect(EXPECTED_SCHEMA_VERSION).toBe('2.10.0');
    expect(JSON.parse(read('android/version-code.json')).versionCode).toBe(31);
    expect(read('android/app/build.gradle')).toContain('versionName "5.23.3"');
  });

  it('userHasPermission bypasse uniquement role_id === 0 (plus role 1)', () => {
    const ctx = read('src/context/AppContext.tsx');
    // Ne doit plus contenir le triple bypass id=0 / role=0 / role=1
    expect(ctx).not.toMatch(
      /if\s*\(\s*Number\(currentUser\.id\)\s*===\s*0\s*\|\|\s*Number\(currentUser\.role_id\)\s*===\s*0\s*\|\|\s*Number\(currentUser\.role_id\)\s*===\s*1\s*\)\s*\{\s*return\s+true;/
    );
    // Doit contenir le seul bypass super admin
    expect(ctx).toContain('if (Number(currentUser.role_id) === 0) return true;');
    expect(ctx).toContain('role.permissions?.includes(\'*\')');
  });

  it('les helpers userPerms isAdminLevel / isSuperAdmin existent', () => {
    const src = read('src/utils/userPerms.ts');
    expect(src).toContain('export function isSuperAdmin');
    expect(src).toContain('export function isAdminLevel');
    expect(src).toContain('export function userHasPerm');
  });

  it('les nouvelles permissions sont déclarées dans permissionMatrix', () => {
    const src = read('src/data/permissionMatrix.ts');
    for (const p of [
      'perm_admin_level',
      'perm_diagnostic',
      'perm_depot_view_all',
      'perm_mail_admin',
      'perm_orders_prepare_any_dept',
    ]) {
      expect(src).toContain(`'${p}'`);
    }
  });

  it('plus aucun role_id === 1 dans le code applicatif', () => {
    const files = listTsFiles(path.join(ROOT_DIR, 'src'));
    const offenders: string[] = [];
    for (const f of files) {
      const content = fs.readFileSync(f, 'utf8');
      if (/\.role_id\s*===\s*1|roleId\s*===\s*1|role_id\s*<=\s*1/.test(content)) {
        offenders.push(path.relative(ROOT_DIR, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('role_id === 0 n\'apparaît qu\'aux emplacements autorisés', () => {
    const files = listTsFiles(path.join(ROOT_DIR, 'src'));
    const offenders: string[] = [];
    for (const f of files) {
      const content = fs.readFileSync(f, 'utf8');
      if (/\.role_id\)\s*===\s*0|\.role_id\s*===\s*0/.test(content)) {
        if (!ALLOWED_FILES_FOR_ROLE_ID_0.has(f)) {
          offenders.push(path.relative(ROOT_DIR, f));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('plus aucune liste codée [0, 1], [0, 1, 5], [0, 1, 5, 8]', () => {
    const files = listTsFiles(path.join(ROOT_DIR, 'src'));
    const offenders: string[] = [];
    for (const f of files) {
      const content = fs.readFileSync(f, 'utf8');
      if (/\[\s*0\s*,\s*1\s*(,|\])|\[\s*0\s*,\s*1\s*,\s*5\s*,\s*8\s*\]/.test(content)) {
        offenders.push(path.relative(ROOT_DIR, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('l\'étape SQL 24 existe et seede perm_admin_level', () => {
    const sql = read('supabase-client/24_perm_only_policies.sql');
    expect(sql).toContain('perm_admin_level');
    expect(sql).toContain('GRANT ALL ON ALL TABLES');
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated');
    expect(sql).toContain('ALTER DEFAULT PRIVILEGES');
    expect(sql).toContain('depots_insert_by_perm');
    expect(sql).toContain('Admin seed others core_user_preferences');
  });
});
