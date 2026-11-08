import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildProductEditableSignature,
  buildProductStockLevelsSignature,
  buildAvailableDepotsSignature,
  computeDefaultAddDepotTarget,
  createInitialProductDetailFormState,
  applyProductDetailSyncUpdate,
  openAddDepotMenuInState,
} from '../hooks/useProductDetailController';
import { getProductDepotBreakdown } from '../services/desktopInventoryLogic';
import { EXPECTED_SCHEMA_VERSION, MIN_SUPPORTED_SCHEMA_VERSION } from '../appVersion';
import { translations } from '../i18n/translations';
import {
  extractCreateTableColumnsFromSql,
  cleanColumnDefinitionForAddColumn,
  generateLegacyColumnsAlignmentSql,
} from '../../scripts/build-sql.mjs';
import { Product, Depot, StockLevel, User } from '../types';

describe('Prompt v41 — Menu « Ajouter à un autre dépôt » + mise à jour des scripts SQL pour les anciennes bases', () => {
  const sampleAdminUser: User = {
    id: 'user-admin',
    name: 'Admin Test',
    trigram: 'ADM',
    role_id: 0,
    is_blocked: false,
    allowed_depots: ['*'],
  };

  const makeSampleProduct = (overrides: Partial<Product> = {}): Product => ({
    id: 'prod-v41-01',
    reference: 'REF-V41-001',
    manufacturer_ref: 'OEM-99',
    barcode: '3700000041001',
    brand: 'Bosch',
    model: 'Meuleuse GWS 18V',
    unit_price: 185,
    description: 'Meuleuse sans fil 125mm',
    store_name: 'Dépôt Nord',
    room_name: 'Zone Outillage',
    shelf_name: 'RACK-A01',
    quantity: 12,
    min_stock_alert: 3,
    ...overrides,
  });

  const makeSampleDepots = (): Depot[] => [
    { id: 'dep-1', name: 'Dépôt Nord', type: 'FIXED', is_active: true },
    { id: 'dep-2', name: 'Dépôt Sud', type: 'FIXED', is_active: true },
    { id: 'dep-3', name: 'Camionnette 01', type: 'VEHICLE', is_active: true },
  ];

  const makeSampleStockLevels = (): StockLevel[] => [
    {
      id: 'sl-1',
      product_id: 'prod-v41-01',
      depot_name: 'Dépôt Nord',
      quantity: 12,
      min_alert: 3,
      rack_location: 'RACK-A01',
    },
  ];

  describe('Partie A — Stabilité du menu « Ajouter à un autre dépôt » et de l’édition en ligne lors des synchronisations Realtime / Polling', () => {
    it('A.1 Ouvrir le menu, saisir des champs et simuler 3 resynchronisations renvoyant de nouveaux tableaux/objets identiques -> le menu reste ouvert et les champs saisis sont conservés', () => {
      const initialProduct = makeSampleProduct();
      const initialDepots = makeSampleDepots();
      const initialLevels = makeSampleStockLevels();
      const initialBreakdown = getProductDepotBreakdown(
        initialProduct,
        initialLevels,
        sampleAdminUser
      );
      const initialAvailableForAdd = initialDepots.filter(
        (d) =>
          d.is_active !== false &&
          !initialBreakdown.allDepotRows.some((r) => r.depotName === d.name)
      );

      // État initial à l'ouverture de la fiche produit
      let state = createInitialProductDetailFormState(initialProduct);
      expect(state.addDepotOpen).toBe(false);
      expect(state.isEditingInline).toBe(false);

      // L'utilisateur ouvre le menu « Ajouter à un autre dépôt »
      state = openAddDepotMenuInState(state, {
        product: initialProduct,
        allDepotRows: initialBreakdown.allDepotRows,
        availableDepotsForAdd: initialAvailableForAdd,
      });
      expect(state.addDepotOpen).toBe(true);
      expect(state.targetDepotName).toBe('Dépôt Sud');

      // L'utilisateur choisit un dépôt cible et saisit une quantité initiale et un emplacement
      state = {
        ...state,
        userHasSelectedTargetDepot: true,
        targetDepotName: 'Camionnette 01',
        targetInitialQty: '4',
        targetRackLocation: 'BAC-LAT-2',
        isEditingInline: true,
        editModel: 'Meuleuse GWS 18V Pro',
        editShelfName: 'RACK-A02-MODIF',
      };

      const sigProd0 = buildProductEditableSignature(initialProduct);
      const sigLevels0 = buildProductStockLevelsSignature(initialProduct.id, initialLevels);
      const sigDepots0 = buildAvailableDepotsSignature(initialDepots, sampleAdminUser);

      // Simulation de 3 resynchronisations successives (toutes les 6s / Realtime)
      // qui recréent de nouvelles références d'objets et de tableaux avec les mêmes valeurs
      for (let syncTick = 1; syncTick <= 3; syncTick += 1) {
        const clonedProduct = { ...makeSampleProduct() };
        const clonedDepots = makeSampleDepots().map((d) => ({ ...d }));
        const clonedLevels = makeSampleStockLevels().map((sl) => ({ ...sl }));

        // Les signatures primitives restent strictement identiques (aucun recalcul ni effet parasite)
        expect(buildProductEditableSignature(clonedProduct)).toBe(sigProd0);
        expect(buildProductStockLevelsSignature(clonedProduct.id, clonedLevels)).toBe(
          sigLevels0
        );
        expect(buildAvailableDepotsSignature(clonedDepots, { ...sampleAdminUser })).toBe(
          sigDepots0
        );

        // Même si applyProductDetailSyncUpdate est invoqué avec le nouvel objet produit
        state = applyProductDetailSyncUpdate(state, clonedProduct);

        // Le menu « Ajouter à un autre dépôt » reste ouvert et les saisies utilisateur sont intactes
        expect(state.addDepotOpen).toBe(true);
        expect(state.isEditingInline).toBe(true);
        expect(state.targetDepotName).toBe('Camionnette 01');
        expect(state.targetInitialQty).toBe('4');
        expect(state.targetRackLocation).toBe('BAC-LAT-2');
        expect(state.editModel).toBe('Meuleuse GWS 18V Pro');
        expect(state.editShelfName).toBe('RACK-A02-MODIF');
      }
    });

    it('A.2 Changer de produit -> le menu se ferme, le mode édition en ligne se ferme et les champs se rechargent sur le nouveau produit', () => {
      const prod1 = makeSampleProduct();
      const depots = makeSampleDepots();
      const levels1 = makeSampleStockLevels();
      const breakdown1 = getProductDepotBreakdown(
        prod1,
        levels1,
        sampleAdminUser
      );
      const avail1 = depots.filter(
        (d) =>
          d.is_active !== false &&
          !breakdown1.allDepotRows.some((r) => r.depotName === d.name)
      );

      let state = createInitialProductDetailFormState(prod1);
      state = openAddDepotMenuInState(state, {
        product: prod1,
        allDepotRows: breakdown1.allDepotRows,
        availableDepotsForAdd: avail1,
      });
      state = {
        ...state,
        isEditingInline: true,
        userHasSelectedTargetDepot: true,
        targetDepotName: 'Camionnette 01',
        targetInitialQty: '7',
        targetRackLocation: 'VAN-RACK-9',
        editBrand: 'Saisie en cours',
      };

      // Changement de produit sélectionné (prod-v41-02)
      const prod2: Product = makeSampleProduct({
        id: 'prod-v41-02',
        reference: 'REF-V41-002',
        brand: 'Makita',
        model: 'Visseuse DDF484',
        shelf_name: 'ETAG-B09',
        unit_price: 210,
      });

      state = applyProductDetailSyncUpdate(state, prod2);

      expect(state.lastProductId).toBe('prod-v41-02');
      expect(state.addDepotOpen).toBe(false);
      expect(state.isEditingInline).toBe(false);
      expect(state.editReference).toBe('REF-V41-002');
      expect(state.editBrand).toBe('Makita');
      expect(state.editModel).toBe('Visseuse DDF484');
      expect(state.editShelfName).toBe('ETAG-B09');
      expect(state.targetInitialQty).toBe('1');
      expect(state.targetRackLocation).toBe('');
      expect(state.userHasSelectedTargetDepot).toBe(false);
    });

    it("A.3 Modification distante réelle du produit alors qu'aucune édition ni menu d'ajout n'est ouvert -> les champs d'édition sont mis à jour", () => {
      const prod1 = makeSampleProduct();
      let state = createInitialProductDetailFormState(prod1);
      expect(state.isEditingInline).toBe(false);
      expect(state.addDepotOpen).toBe(false);

      // Le produit est mis à jour en base par un autre poste (ex: changement d'emplacement et de prix)
      const updatedProdSameId: Product = makeSampleProduct({
        shelf_name: 'NOUVEAU-RACK-Z9',
        unit_price: 199.9,
      });

      state = applyProductDetailSyncUpdate(state, updatedProdSameId);

      expect(state.editShelfName).toBe('NOUVEAU-RACK-Z9');
      expect(state.editUnitPrice).toBe('199.9');
    });

    it('A.4 computeDefaultAddDepotTarget ne remplace jamais un dépôt déjà choisi par l’utilisateur', () => {
      const allRows = [{ depotName: 'Dépôt Nord' }];
      const avail: Depot[] = [
        { id: 'dep-2', name: 'Dépôt Sud', type: 'FIXED', is_active: true },
        { id: 'dep-3', name: 'Camionnette 01', type: 'VEHICLE', is_active: true },
      ];
      expect(
        computeDefaultAddDepotTarget({
          currentTargetDepotName: '',
          allDepotRows: allRows,
          availableDepotsForAdd: avail,
          userHasSelectedTarget: false,
        })
      ).toBe('Dépôt Sud');
      expect(
        computeDefaultAddDepotTarget({
          currentTargetDepotName: 'Camionnette 01',
          allDepotRows: allRows,
          availableDepotsForAdd: avail,
          userHasSelectedTarget: true,
        })
      ).toBe('Camionnette 01');
    });
  });

  describe('Partie B — Alignement des colonnes, purge des déclencheurs hérités et version de schéma 1.1.1', () => {
    it('B.1 build-sql.mjs ignore les commentaires SQL (--) et retire NOT NULL, PRIMARY KEY, REFERENCES, UNIQUE, CHECK', () => {
      const sampleSql = `
        CREATE TABLE IF NOT EXISTS public.sample_legacy_test (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          -- fake_commented_col TEXT NOT NULL,
          code TEXT NOT NULL UNIQUE, -- inline comment with 'quotes' and fake_col2 INT
          status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DONE')),
          parent_id BIGINT REFERENCES public.roles(id) ON DELETE SET NULL DEFAULT 4,
          updated_at TIMESTAMPTZ DEFAULT now()
        );
      `;
      const extracted = extractCreateTableColumnsFromSql(sampleSql);
      expect(extracted.map((c) => c.columnName)).toEqual([
        'code',
        'status',
        'parent_id',
        'updated_at',
      ]);
      expect(extracted.find((c) => c.columnName === 'code')?.definition).toBe('TEXT');
      expect(extracted.find((c) => c.columnName === 'status')?.definition).toBe(
        "TEXT DEFAULT 'PENDING'"
      );
      expect(extracted.find((c) => c.columnName === 'parent_id')?.definition).toBe(
        'BIGINT DEFAULT 4'
      );
      expect(cleanColumnDefinitionForAddColumn(' NUMERIC(10,2) NOT NULL DEFAULT 0 ')).toBe(
        'NUMERIC(10,2) DEFAULT 0'
      );
    });

    it('B.1b 02_rls_hardening.sql et dist/install.sql contiennent les ADD COLUMN IF NOT EXISTS pour stk_products.updated_at, stk_stock_levels.updated_at, stk_stock_levels.rack_location et stk_depots.phone', () => {
      const rootDir = path.resolve(__dirname, '../..');
      const generatedBlock = generateLegacyColumnsAlignmentSql(rootDir);
      expect(generatedBlock).toContain(
        'ALTER TABLE IF EXISTS public.stk_products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();'
      );
      expect(generatedBlock).toContain(
        'ALTER TABLE IF EXISTS public.stk_stock_levels ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();'
      );
      expect(generatedBlock).toContain(
        'ALTER TABLE IF EXISTS public.stk_stock_levels ADD COLUMN IF NOT EXISTS rack_location TEXT DEFAULT NULL;'
      );
      expect(generatedBlock).toContain(
        'ALTER TABLE IF EXISTS public.stk_depots ADD COLUMN IF NOT EXISTS phone TEXT;'
      );

      const script02 = fs.readFileSync(
        path.join(rootDir, 'supabase-client', '02_rls_hardening.sql'),
        'utf8'
      );
      expect(script02).toContain('-- [BEGIN AUTO_GENERATED_ADD_COLUMNS]');
      expect(script02).toContain(
        'ALTER TABLE IF EXISTS public.stk_products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();'
      );
    });

    it('B.2 03_rpc_stock_and_orders.sql purge trg_process_stock_movement et les déclencheurs inconnus, et 07/08 exposent unknown_stock_triggers et stock_consistency', () => {
      const rootDir = path.resolve(__dirname, '../..');
      const script03 = fs.readFileSync(
        path.join(rootDir, 'supabase-client', '03_rpc_stock_and_orders.sql'),
        'utf8'
      );
      expect(script03).toContain(
        'DROP TRIGGER IF EXISTS trg_process_stock_movement ON public.stk_movements;'
      );
      expect(script03).toContain('DROP FUNCTION IF EXISTS public.process_stock_movement();');
      expect(script03).toContain('trg_enforce_license_max_references');

      const script07 = fs.readFileSync(
        path.join(rootDir, 'supabase-client', '07_app_compat.sql'),
        'utf8'
      );
      const script08 = fs.readFileSync(
        path.join(rootDir, 'supabase-client', '08_print_jobs.sql'),
        'utf8'
      );
      expect(script07).toContain("'unknown_stock_triggers'");
      expect(script07).toContain("'stock_consistency'");
      expect(script08).toContain("'unknown_stock_triggers'");
      expect(script08).toContain("'stock_consistency'");
    });

    it('B.3 EXPECTED_SCHEMA_VERSION vaut 2.7.0 (MIN_SUPPORTED_SCHEMA_VERSION = 1.0.0), INSTALL.md documente les bases anciennes et la mention FR/EN/NL est présente', () => {
      expect(EXPECTED_SCHEMA_VERSION).toBe('2.7.0');
      expect(MIN_SUPPORTED_SCHEMA_VERSION).toBe('1.0.0');

      expect(translations.fr.sql_legacy_db_auto_fix_notice).toContain(
        'À exécuter sur une base ancienne : colonnes manquantes, règles RLS, déclencheurs hérités et identifiants numériques sont corrigés automatiquement'
      );
      expect(translations.en.sql_legacy_db_auto_fix_notice.length).toBeGreaterThan(20);
      expect(translations.nl.sql_legacy_db_auto_fix_notice.length).toBeGreaterThan(20);

      const rootDir = path.resolve(__dirname, '../..');
      const installMd = fs.readFileSync(
        path.join(rootDir, 'supabase-client', 'INSTALL.md'),
        'utf8'
      );
      expect(installMd).toContain('## Base ancienne : que fait l\'installation automatiquement');
      expect(installMd).toContain('dist/install.sql');
      expect(installMd).toContain('diagnostic_installation()');
      expect(installMd).toContain('2.7.0');
    });
  });
});
