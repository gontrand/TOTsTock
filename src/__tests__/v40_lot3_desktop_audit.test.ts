import { describe, it, expect } from 'vitest';
import {
  buildStockByDepotMatrix,
  buildStockByDepotMatrixCsv,
  buildDepotAuditCountingRows,
  buildAuditAdjustmentsFromSession,
  buildAuditReportCsvContent,
} from '../services/inventoryAuditLogic';
import { Depot, Product, StockLevel, SubCategory, User } from '../types';

const depots: Depot[] = [
  { id: 'd-a', name: 'Dépôt A', type: 'FIXED', is_active: true },
  { id: 'd-b', name: 'Dépôt B', type: 'FIXED', is_active: true },
  { id: 'd-c', name: 'Dépôt C', type: 'VEHICLE', is_active: true },
];

const subCategories: SubCategory[] = [{ id: 1, name: 'Disjoncteurs' }];

const products: Product[] = [
  {
    id: 'p-1',
    reference: 'REF-AUD-01',
    brand: 'Schneider',
    model: 'iC60N 16A',
    sub_category_id: 1,
    quantity: 14,
    min_stock_alert: 3,
    unit_price: 20,
    store_name: 'Dépôt A',
  },
  {
    id: 'p-inconsistent',
    reference: 'REF-AUD-BAD',
    brand: 'Legrand',
    model: '=SUM(A1:A10) Disjoncteur',
    sub_category_id: 1,
    quantity: 25, // Incohérent : stock_levels = 5
    min_stock_alert: 2,
    unit_price: 15,
    store_name: 'Dépôt A',
  },
];

const stockLevels: StockLevel[] = [
  { id: 'sl-1a', product_id: 'p-1', depot_name: 'Dépôt A', quantity: 10, min_alert: 3, rack_location: 'A-01' },
  { id: 'sl-1b', product_id: 'p-1', depot_name: 'Dépôt B', quantity: 4, min_alert: 2, rack_location: 'B-02' },
  { id: 'sl-1c', product_id: 'p-1', depot_name: 'Dépôt C', quantity: 0, min_alert: 1, rack_location: 'C-03' },
  { id: 'sl-2a', product_id: 'p-inconsistent', depot_name: 'Dépôt A', quantity: 5, min_alert: 2, rack_location: 'A-09' },
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

describe('Prompt v40 LOT 3 — Page Audit sur le Bureau (Matrice Stock par dépôt, Comptage par dépôt, Rapports)', () => {
  it('construit la matrice référence × dépôts avec détection des écarts de cohérence (products.quantity != sum(stock_levels)) et export CSV protégé', () => {
    const matrix = buildStockByDepotMatrix(
      products,
      depots,
      stockLevels,
      subCategories,
      adminUser
    );

    expect(matrix.depotColumns).toEqual(['Dépôt A', 'Dépôt B', 'Dépôt C']);
    expect(matrix.totalDiscrepancies).toBe(1);
    expect(matrix.rows).toHaveLength(2);

    const row1 = matrix.rows.find((r) => r.reference === 'REF-AUD-01')!;
    expect(row1.quantitiesByDepot).toEqual({
      'Dépôt A': 10,
      'Dépôt B': 4,
      'Dépôt C': 0,
    });
    expect(row1.allowedTotalQuantity).toBe(14);
    expect(row1.hasDiscrepancy).toBe(false);

    const rowBad = matrix.rows.find((r) => r.reference === 'REF-AUD-BAD')!;
    expect(rowBad.hasDiscrepancy).toBe(true);
    expect(rowBad.productQuantity).toBe(25);
    expect(rowBad.sumOfStockLevels).toBe(5);

    // Filtre discrepancyOnly
    const onlyDiscrepancies = buildStockByDepotMatrix(
      products,
      depots,
      stockLevels,
      subCategories,
      adminUser,
      { discrepancyOnly: true }
    );
    expect(onlyDiscrepancies.rows).toHaveLength(1);
    expect(onlyDiscrepancies.rows[0].reference).toBe('REF-AUD-BAD');

    // Export CSV avec neutralisation d'injection de formules (=SUM...)
    const csv = buildStockByDepotMatrixCsv(matrix.rows, matrix.depotColumns, true);
    expect(csv).toContain('REF-AUD-01');
    expect(csv).toContain("'=SUM(A1:A10) Disjoncteur");
  });

  it('calcule les quantités théoriques et les écarts strictement sur le dépôt sélectionné (Dépôt B = 4, et non 14)', () => {
    const { scopeRows, stats } = buildDepotAuditCountingRows({
      products,
      stockLevels,
      subCategories,
      currentUser: adminUser,
      selectedDepot: 'Dépôt B',
      counts: {
        'p-1': 6, // Compté 6 dans Dépôt B où le théorique est 4 -> écart +2
      },
    });

    // Seul p-1 est présent dans le Dépôt B
    expect(scopeRows).toHaveLength(1);
    expect(scopeRows[0].reference).toBe('REF-AUD-01');
    expect(scopeRows[0].depotName).toBe('Dépôt B');
    expect(scopeRows[0].theoreticalQty).toBe(4);
    expect(scopeRows[0].countedQty).toBe(6);
    expect(scopeRows[0].difference).toBe(2);
    expect(scopeRows[0].differenceValue).toBe(40); // +2 * 20€

    expect(stats.countedCount).toBe(1);
    expect(stats.surplusCount).toBe(1);
    expect(stats.varianceVal).toBe(40);

    const adjustments = buildAuditAdjustmentsFromSession(scopeRows, { 'p-1': 6 }, 'Dépôt B');
    expect(adjustments).toEqual([
      {
        productId: 'p-1',
        depotName: 'Dépôt B',
        physicalCount: 6,
        theoreticalQty: 4,
        difference: 2,
        reason: 'Régularisation Inventaire Physique TOT',
      },
    ]);

    const reportCsv = buildAuditReportCsvContent(scopeRows, true);
    expect(reportCsv).toContain('Dépôt B');
    expect(reportCsv).toContain('Surplus');
  });
});
