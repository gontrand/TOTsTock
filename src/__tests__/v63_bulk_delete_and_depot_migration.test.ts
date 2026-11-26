import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { APP_VERSION } from '../appVersion';

/**
 * v5.24.0 — suppression multiple de références, migration du contenu d'un dépôt
 * avant suppression, boutons toujours visibles.
 */
const ROOT_DIR = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8');

describe('v5.24.0 — suppression multiple, migration de dépôt, boutons visibles', () => {
  it('aligne la version sur 5.24.0', () => {
    expect(APP_VERSION).toBe('5.24.2');
    expect(JSON.parse(read('android/version-code.json')).versionCode).toBe(39);
  });

  it('étape SQL 25 : fonctions transactionnelles avec contrôle de permission', () => {
    const sql = read('supabase-client/25_bulk_delete_and_depot_migration.sql');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.delete_products_bulk');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.migrate_depot_content');
    expect(sql).toContain("current_user_has_perm('perm_prod_delete')");
    expect(sql).toContain("current_user_has_perm('perm_manage_depots')");
    expect(sql).toContain('SAME_DEPOT');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.delete_products_bulk(TEXT[]) FROM PUBLIC, anon');
    // Aucun id de rôle codé en dur dans le script
    expect(sql).not.toMatch(/role_id\s*(=|IN)\s*\(?\s*[0-9]/i);
    const install = read('dist/install.sql');
    expect(install).toContain('public.migrate_depot_content');
    expect(install).toContain('public.delete_products_bulk');
  });

  it('services : RPC + repli sur suppression par lots, pas de repli pour la migration', () => {
    const src = read('src/services/clientSupabase.ts');
    expect(src).toContain('export async function deleteProductsBulkFromSupabase');
    expect(src).toContain("rpc('delete_products_bulk'");
    expect(src).toContain('export async function migrateDepotContentOnSupabase');
    expect(src).toContain("rpc('migrate_depot_content'");
  });

  it('AppContext : deleteProducts exige perm_prod_delete et attend le serveur avant de retirer en local', () => {
    const ctx = read('src/context/AppContext.tsx');
    expect(ctx).toContain('deleteProducts: (productIds: string[])');
    const i = ctx.indexOf('const deleteProducts = useCallback');
    const body = ctx.slice(i, i + 3500);
    expect(body).toContain("userHasPermission('perm_prod_delete')");
    expect(body.indexOf('deleteProductsBulkFromSupabase')).toBeGreaterThan(-1);
    expect(body.indexOf('deleteProductsBulkFromSupabase')).toBeLessThan(body.indexOf('setProducts('));
  });

  it('AppContext : deleteDepot migre le stock (serveur d\'abord) et refuse sans migration', () => {
    const ctx = read('src/context/AppContext.tsx');
    const i = ctx.indexOf('const deleteDepot = useCallback');
    const body = ctx.slice(i, i + 7000);
    expect(body).toContain('migrateDepotContentOnSupabase(client, target.name, dest.name)');
    expect(body).toContain('setStockLevels(');
    expect(body).toContain('Migrez d\'abord son contenu');
    expect(body.indexOf('migrateDepotContentOnSupabase')).toBeLessThan(body.indexOf('deleteDepotFromSupabase('));
  });

  it('UI : bouton « Supprimer la sélection » protégé par permission + confirmation obligatoire', () => {
    const page = read('src/desktop/pages/DesktopInventoryPage.tsx');
    expect(page).toContain("userHasPermission('perm_prod_delete')");
    expect(page).toContain('desktop-bulk-delete-btn');
    expect(page).toContain('<BulkDeleteProductsDialog');
    const dlg = read('src/components/BulkDeleteProductsDialog.tsx');
    expect(dlg).toContain('bulk-delete-confirm');
    expect(dlg).toContain('TYPED_CONFIRM_THRESHOLD');
    expect(dlg).toContain('disabled={!canSubmit}');
  });

  it('UI : la suppression de dépôt passe partout par le dialogue de migration', () => {
    const dlg = read('src/components/DepotDeleteDialog.tsx');
    expect(dlg).toContain('depot-delete-confirm');
    expect(dlg).toContain('Migrer tout le contenu vers');
    expect(read('src/components/DepotsModal.tsx')).toContain('<DepotDeleteDialog');
    const settings = read('src/desktop/pages/DesktopSettingsPage.tsx');
    expect(settings).toContain('<DepotDeleteDialog');
    expect(settings).not.toContain('await deleteDepot(d.id)');
  });

  it('boutons toujours visibles : barre de sélection qui passe à la ligne, actions du tableau utilisateurs collées à droite', () => {
    const page = read('src/desktop/pages/DesktopInventoryPage.tsx');
    expect(page).toContain('flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs no-print');
    const settings = read('src/desktop/pages/DesktopSettingsPage.tsx');
    expect(settings).toMatch(/sticky right-0[^"]*">Actions<\/th>/);
    expect(settings).toContain('group-hover:bg-slate-50');
    for (const f of ['src/components/DepotDeleteDialog.tsx', 'src/components/BulkDeleteProductsDialog.tsx']) {
      const c = read(f);
      expect(c).toContain('max-h-[92vh]');
      expect(c).toContain('overflow-y-auto');
      expect(c).toContain('shrink-0');
    }
  });

  it('licenseService : plus de référence à une variable inexistante dans canCurrentUserDiscoverLicense', () => {
    const src = read('src/services/licenseService.ts');
    expect(src).not.toContain('isAdminLevel(user)');
  });
});
