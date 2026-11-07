import { describe, it, expect } from 'vitest';
import {
  getProductDepotBreakdown,
  filterInventoryProducts,
  InventoryFilterParams,
  InventoryFilterOptions,
} from '../services/desktopInventoryLogic';
import { validateCsvProductImport } from '../services/csvProductImport';
import { Product, StockLevel, User } from '../types';

const baseProduct: Product = {
  id: 'prod-multi-1',
  reference: 'REF-MULTI-01',
  brand: 'Schneider',
  model: 'Disjoncteur iC60N 20A',
  quantity: 14,
  min_stock_alert: 3,
  unit_price: 24.5,
  store_name: 'Dépôt A',
  shelf_name: 'RACK-A1',
};

const threeDepotLevels: StockLevel[] = [
  {
    id: 'sl-a',
    product_id: 'prod-multi-1',
    depot_name: 'Dépôt A',
    quantity: 10,
    min_alert: 3,
    rack_location: 'RACK-A1',
  },
  {
    id: 'sl-b',
    product_id: 'prod-multi-1',
    depot_name: 'Dépôt B',
    quantity: 4,
    min_alert: 2,
    rack_location: 'RACK-B2',
  },
  {
    id: 'sl-c',
    product_id: 'prod-multi-1',
    depot_name: 'Dépôt C',
    quantity: 0,
    min_alert: 1,
    rack_location: 'VAN-C1',
  },
];

const adminUser: User = {
  id: 'u-admin',
  name: 'Admin',
  trigram: 'ADM',
  pin: '0000',
  role_id: 0,
  is_blocked: false,
  allowed_depots: ['*'],
};

const restrictedUserDepotB: User = {
  id: 'u-tech-b',
  name: 'Tech B',
  trigram: 'TCB',
  pin: '0000',
  role_id: 2,
  is_blocked: false,
  allowed_depots: ['Dépôt B'],
};

const baseFilter: InventoryFilterParams = {
  searchQuery: '',
  selectedStore: '',
  selectedSubCat: '',
  selectedSupplier: '',
  stockStatus: 'ALL',
};

const makeOptions = (levels: StockLevel[], user: User | null = adminUser): InventoryFilterOptions => ({
  isLambdaUser: false,
  includeClosedDepots: true,
  closedDepotNames: new Set<string>(),
  stockLevels: levels,
  currentUser: user,
  expandMultiDepotOnSearch: true,
});

describe('Prompt v40 LOT 2 — Même référence dans plusieurs dépôts, stock exact par dépôt & import CSV multi-dépôts', () => {
  it('calcule la ventilation exacte par dépôt (10, 4, 0 -> total 14) et détecte un écart de cohérence si products.quantity != sum(stock_levels)', () => {
    const breakdown = getProductDepotBreakdown(baseProduct, threeDepotLevels, adminUser);
    expect(breakdown.hasExplicitStockLevels).toBe(true);
    expect(breakdown.sumOfStockLevels).toBe(14);
    expect(breakdown.allowedTotalQuantity).toBe(14);
    expect(breakdown.hasDiscrepancy).toBe(false);
    expect(breakdown.depotRows.map((r) => ({ depot: r.depotName, qty: r.quantity }))).toEqual([
      { depot: 'Dépôt A', qty: 10 },
      { depot: 'Dépôt B', qty: 4 },
      { depot: 'Dépôt C', qty: 0 },
    ]);

    // Si products.quantity vaut 19 alors que sum(stock_levels) vaut 14 -> Écart de cohérence (+5)
    const inconsistentProduct: Product = { ...baseProduct, quantity: 19 };
    const badBreakdown = getProductDepotBreakdown(inconsistentProduct, threeDepotLevels, adminUser);
    expect(badBreakdown.hasDiscrepancy).toBe(true);
    expect(badBreakdown.discrepancyDelta).toBe(5);
  });

  it('filtre par dépôt (Dépôt B) en affichant uniquement la quantité exacte de ce dépôt (4) et son emplacement (RACK-B2)', () => {
    const otherProductOnlyInA: Product = {
      id: 'prod-only-a',
      reference: 'REF-ONLY-A',
      brand: 'Hilti',
      model: 'Mèche SDS',
      quantity: 8,
      min_stock_alert: 2,
      unit_price: 12,
      store_name: 'Dépôt A',
    };
    const allLevels: StockLevel[] = [
      ...threeDepotLevels,
      {
        id: 'sl-only-a',
        product_id: 'prod-only-a',
        depot_name: 'Dépôt A',
        quantity: 8,
        min_alert: 2,
        rack_location: 'A-99',
      },
    ];

    const filteredDepotB = filterInventoryProducts(
      [baseProduct, otherProductOnlyInA],
      { ...baseFilter, selectedStore: 'Dépôt B' },
      makeOptions(allLevels, adminUser)
    );

    expect(filteredDepotB).toHaveLength(1);
    expect(filteredDepotB[0].reference).toBe('REF-MULTI-01');
    expect(filteredDepotB[0].store_name).toBe('Dépôt B');
    expect(filteredDepotB[0].quantity).toBe(4);
    expect(filteredDepotB[0].rack_location).toBe('RACK-B2');
    expect(filteredDepotB[0].min_stock_alert).toBe(2);
  });

  it('déplie toutes les lignes des dépôts où la référence est présente lors d’une recherche sans filtre de dépôt', () => {
    const searched = filterInventoryProducts(
      [baseProduct],
      { ...baseFilter, searchQuery: 'REF-MULTI-01', selectedStore: '' },
      makeOptions(threeDepotLevels, adminUser)
    );

    expect(searched).toHaveLength(3);
    expect(searched.map((p) => ({ depot: p.store_name, qty: p.quantity }))).toEqual([
      { depot: 'Dépôt A', qty: 10 },
      { depot: 'Dépôt B', qty: 4 },
      { depot: 'Dépôt C', qty: 0 },
    ]);
  });

  it('respecte allowed_depots : un utilisateur restreint au Dépôt B ne voit que le stock du Dépôt B (4)', () => {
    const visibleForTechB = filterInventoryProducts(
      [baseProduct],
      baseFilter,
      makeOptions(threeDepotLevels, restrictedUserDepotB)
    );
    expect(visibleForTechB).toHaveLength(1);
    expect(visibleForTechB[0].quantity).toBe(4);
    expect(visibleForTechB[0].store_name).toBe('Dépôt B');
  });

  it('Import CSV multi-dépôts : une même référence sur 3 lignes avec des dépôts différents crée 1 seule fiche produit + 2 ajouts de dépôt et ne consomme qu’une référence de licence', () => {
    const csvRows = [
      {
        reference: 'REF-CSV-MULTI',
        brand: 'Bosch',
        model: 'Disque 125mm',
        quantity: '10',
        min_stock_alert: '2',
        unit_price: '4.50',
        store_name: 'Dépôt A',
        rack_location: 'A-10',
      },
      {
        reference: 'REF-CSV-MULTI',
        brand: 'Bosch',
        model: 'Disque 125mm',
        quantity: '4',
        min_stock_alert: '2',
        unit_price: '4.50',
        store_name: 'Dépôt B',
        rack_location: 'B-04',
      },
      {
        reference: 'REF-CSV-MULTI',
        brand: 'Bosch',
        model: 'Disque 125mm',
        quantity: '0',
        min_stock_alert: '1',
        unit_price: '4.50',
        store_name: 'Dépôt C',
        rack_location: 'C-01',
      },
    ];

    const summary = validateCsvProductImport({
      rows: csvRows,
      mapping: {
        reference: 'reference',
        brand: 'brand',
        model: 'model',
        quantity: 'quantity',
        min_stock_alert: 'min_stock_alert',
        unit_price: 'unit_price',
        store_name: 'store_name',
        rack_location: 'rack_location',
      },
      existingProducts: [baseProduct], // 1 référence existante
      subCategories: [],
      license: {
        license_key: 'TOT-STOCK-FREE-COMMUNITY',
        plan_type: 'free', // max_references = 50
        modules: ['stock'],
        max_depots: 1,
        is_active: true,
        last_verified_at: new Date().toISOString(),
        status: 'valid',
      },
      defaultDepotName: 'Dépôt A',
      duplicateStrategy: 'update',
    });

    expect(summary.quotaExceeded).toBe(false);
    expect(summary.toCreateCount).toBe(1);
    expect(summary.toAddDepotCount).toBe(2);
    expect(summary.projectedTotalReferences).toBe(2); // 1 existante + 1 nouvelle (et non 1 + 3)
    expect(summary.rows.map((r) => r.status)).toEqual(['create', 'add_depot', 'add_depot']);
  });
});
