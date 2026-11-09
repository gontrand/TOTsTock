import { Depot, Product, StockLevel, SubCategory, User } from '../types';
import { formatCurrency } from '../utils/crypto';
import { canUserViewDepot } from '../utils/depotPermissions';
import { getProductDepotBreakdown, getProductDisplayLocation, sanitizeCsvCell } from './desktopInventoryLogic';
import { escapeLabelHtml } from './labelRendering';

export const LOCAL_AUDIT_HISTORY_KEY = 'tot_inventory_audit_history_v1';

export interface StockByDepotMatrixRow {
  product: Product;
  productId: string;
  reference: string;
  brand: string;
  model: string;
  categoryId: string;
  categoryName: string;
  unitPrice: number;
  quantitiesByDepot: Record<string, number>;
  racksByDepot: Record<string, string>;
  allowedTotalQuantity: number;
  sumOfStockLevels: number;
  productQuantity: number;
  hasExplicitStockLevels: boolean;
  hasDiscrepancy: boolean;
  discrepancyDelta: number;
}

export interface StockByDepotMatrixFilter {
  searchQuery?: string;
  categoryId?: string;
  brand?: string;
  discrepancyOnly?: boolean;
  sortBy?: 'reference' | 'designation' | 'brand' | 'category' | 'total' | string;
  sortDir?: 'asc' | 'desc';
  users?: User[];
}

export interface StockByDepotMatrixResult {
  depotColumns: string[];
  rows: StockByDepotMatrixRow[];
  totalDiscrepancies: number;
}

export interface AuditCountingRow {
  product: Product;
  productId: string;
  reference: string;
  brand: string;
  model: string;
  barcode: string;
  categoryName: string;
  depotName: string;
  rackLocation: string;
  theoreticalQty: number;
  countedQty: number | null;
  difference: number | null;
  unitPrice: number;
  differenceValue: number | null;
  isCounted: boolean;
}

export interface AuditSessionStats {
  totalTheoreticalCount: number;
  countedCount: number;
  matchedCount: number;
  missingCount: number;
  surplusCount: number;
  uncountedCount: number;
  theoreticalVal: number;
  physicalVal: number;
  varianceVal: number;
  lossVal: number;
  progressPct: number;
  accuracyRate: number;
}

export interface AuditAdjustmentPayload {
  productId: string;
  depotName?: string;
  physicalCount: number;
  theoreticalQty: number;
  difference: number;
  reason?: string;
}

export interface AuditHistoryItemRecord {
  id: string;
  audit_id: string;
  product_id: string;
  product_ref: string;
  product_name?: string | null;
  theoretical_qty: number;
  physical_count: number;
  difference: number;
  unit_price: number;
  diff_cost: number;
  scanned_barcode?: string | null;
  scanned_at?: string;
}

export interface AuditHistoryRecord {
  id: string;
  depot_name: string;
  auditor_id?: string | null;
  auditor_name: string;
  status: string;
  items_counted: number;
  items_with_diff: number;
  total_diff_cost: number;
  audit_notes?: string | null;
  created_at: string;
  completed_at?: string | null;
  items: AuditHistoryItemRecord[];
}

/**
 * Liste ordonnée des dépôts autorisés pour l'utilisateur courant.
 */
export function getAllowedAuditDepotColumns(
  depots: Depot[] = [],
  products: Product[] = [],
  stockLevels: StockLevel[] = [],
  currentUser?: User | null,
  users: User[] = []
): string[] {
  const closedSet = new Set(
    (depots || [])
      .filter((d) => d.is_active === false)
      .map((d) => (d.name || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const mapLowerToDisplay = new Map<string, string>();
  const addDepot = (raw: string | undefined | null) => {
    const clean = (raw || '').trim();
    if (!clean) return;
    const lower = clean.toLowerCase();
    if (closedSet.has(lower)) return;
    if (currentUser && !canUserViewDepot(clean, currentUser, depots, users)) return;
    if (!mapLowerToDisplay.has(lower)) {
      mapLowerToDisplay.set(lower, clean);
    }
  };

  for (const d of depots || []) {
    if (d.is_active !== false) addDepot(d.name);
  }
  for (const sl of stockLevels || []) {
    addDepot(sl.depot_name);
  }
  for (const p of products || []) {
    addDepot(p.store_name);
  }

  return Array.from(mapLowerToDisplay.values()).sort((a, b) =>
    a.localeCompare(b, 'fr', { sensitivity: 'base' })
  );
}

/**
 * Construit la matrice « Stock par dépôt » (référence × dépôts + total + détection d'écart de cohérence).
 */
export function buildStockByDepotMatrix(
  products: Product[] = [],
  depots: Depot[] = [],
  stockLevels: StockLevel[] = [],
  subCategories: SubCategory[] = [],
  currentUser?: User | null,
  filter: StockByDepotMatrixFilter = {}
): StockByDepotMatrixResult {
  const usersList = filter.users || [];
  const depotColumns = getAllowedAuditDepotColumns(depots, products, stockLevels, currentUser, usersList);
  const subCatMap = new Map<string, string>();
  for (const sc of subCategories || []) {
    subCatMap.set(String(sc.id), sc.name);
  }

  const q = (filter.searchQuery || '').trim().toLowerCase();
  const catFilter = (filter.categoryId || '').trim();
  const brandFilter = (filter.brand || '').trim().toLowerCase();
  const discrepancyOnly = Boolean(filter.discrepancyOnly);

  let totalDiscrepancies = 0;
  const rows: StockByDepotMatrixRow[] = [];

  for (const p of products || []) {
    const breakdown = getProductDepotBreakdown(p, stockLevels, currentUser, depots, usersList);
    if (breakdown.hasDiscrepancy) {
      totalDiscrepancies++;
    }

    // Si l'utilisateur a des restrictions de dépôt et que le produit n'a aucune ligne dans ses dépôts autorisés, on masque
    if (currentUser && breakdown.depotRows.length === 0) {
      continue;
    }

    const catId = p.sub_category_id != null ? String(p.sub_category_id) : '';
    const catName = catId ? subCatMap.get(catId) || '—' : '—';

    if (catFilter && catFilter !== 'ALL' && catId !== catFilter) continue;
    if (brandFilter && brandFilter !== 'all' && (p.brand || '').trim().toLowerCase() !== brandFilter) {
      continue;
    }
    if (discrepancyOnly && !breakdown.hasDiscrepancy) continue;

    if (q) {
      const hay = [
        p.reference,
        p.brand,
        p.model,
        p.barcode,
        p.manufacturer_ref,
        catName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) continue;
    }

    const quantitiesByDepot: Record<string, number> = {};
    const racksByDepot: Record<string, string> = {};
    for (const col of depotColumns) {
      quantitiesByDepot[col] = 0;
      racksByDepot[col] = '';
    }

    for (const dRow of breakdown.depotRows) {
      const matchedCol =
        depotColumns.find((c) => c.toLowerCase() === dRow.depotName.toLowerCase()) || dRow.depotName;
      quantitiesByDepot[matchedCol] = (quantitiesByDepot[matchedCol] || 0) + dRow.quantity;
      if (dRow.rackLocation) {
        racksByDepot[matchedCol] = dRow.rackLocation;
      }
    }

    rows.push({
      product: p,
      productId: String(p.id),
      reference: p.reference || '',
      brand: p.brand || '',
      model: p.model || '',
      categoryId: catId,
      categoryName: catName,
      unitPrice: Number(p.unit_price) || 0,
      quantitiesByDepot,
      racksByDepot,
      allowedTotalQuantity: breakdown.allowedTotalQuantity,
      sumOfStockLevels: breakdown.sumOfStockLevels,
      productQuantity: breakdown.productQuantity,
      hasExplicitStockLevels: breakdown.hasExplicitStockLevels,
      hasDiscrepancy: breakdown.hasDiscrepancy,
      discrepancyDelta: breakdown.discrepancyDelta,
    });
  }

  const sortBy = filter.sortBy || 'reference';
  const dir = filter.sortDir === 'desc' ? -1 : 1;

  rows.sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'reference') {
      cmp = a.reference.localeCompare(b.reference, 'fr', { numeric: true, sensitivity: 'base' });
    } else if (sortBy === 'designation') {
      cmp = `${a.brand} ${a.model}`.localeCompare(`${b.brand} ${b.model}`, 'fr', {
        sensitivity: 'base',
      });
    } else if (sortBy === 'brand') {
      cmp = a.brand.localeCompare(b.brand, 'fr', { sensitivity: 'base' });
    } else if (sortBy === 'category') {
      cmp = a.categoryName.localeCompare(b.categoryName, 'fr', { sensitivity: 'base' });
    } else if (sortBy === 'total') {
      cmp = a.allowedTotalQuantity - b.allowedTotalQuantity;
    } else if (sortBy in a.quantitiesByDepot) {
      cmp = (a.quantitiesByDepot[sortBy] || 0) - (b.quantitiesByDepot[sortBy] || 0);
    }
    if (cmp === 0) {
      cmp = a.reference.localeCompare(b.reference, 'fr', { numeric: true, sensitivity: 'base' });
    }
    return cmp * dir;
  });

  return {
    depotColumns,
    rows,
    totalDiscrepancies,
  };
}

/**
 * Exporte la matrice « Stock par dépôt » en CSV avec neutralisation d'injection de formules.
 */
export function buildStockByDepotMatrixCsv(
  matrixRows: StockByDepotMatrixRow[],
  depotColumns: string[],
  canViewPrices: boolean
): string {
  const headers = [
    'Référence',
    'Marque',
    'Modèle',
    'Catégorie',
    ...depotColumns,
    'Total Dépôts',
    'Quantité Globale (products.quantity)',
    'Cohérence',
    ...(canViewPrices ? ['Prix Unitaire HT (€)', 'Valeur Totale HT (€)'] : []),
  ];

  const lines = [headers.map((h) => sanitizeCsvCell(h)).join(';')];

  for (const row of matrixRows) {
    const depotCells = depotColumns.map((col) => String(row.quantitiesByDepot[col] ?? 0));
    const coherenceStatus = row.hasDiscrepancy
      ? `ÉCART (${row.discrepancyDelta > 0 ? '+' : ''}${row.discrepancyDelta})`
      : 'OK';
    const priceCells = canViewPrices
      ? [
          row.unitPrice.toFixed(2),
          (row.allowedTotalQuantity * row.unitPrice).toFixed(2),
        ]
      : [];

    const cells = [
      row.reference,
      row.brand,
      row.model,
      row.categoryName,
      ...depotCells,
      String(row.allowedTotalQuantity),
      String(row.productQuantity),
      coherenceStatus,
      ...priceCells,
    ];
    lines.push(cells.map((c) => sanitizeCsvCell(c)).join(';'));
  }

  return '\uFEFF' + lines.join('\r\n');
}

/**
 * Calcule la quantité théorique et l'emplacement d'un article pour le périmètre d'audit sélectionné.
 * Si un dépôt spécifique est sélectionné, la quantité théorique provient strictement de `stock_levels` pour ce dépôt.
 */
export function getProductAuditDepotData(
  product: Product,
  selectedDepot: string,
  stockLevels: StockLevel[] = [],
  currentUser?: User | null,
  depots: Depot[] = [],
  users: User[] = []
): { presentInScope: boolean; theoreticalQty: number; rackLocation: string; depotName: string } {
  const breakdown = getProductDepotBreakdown(product, stockLevels, currentUser, depots, users);
  const cleanSelected = (selectedDepot || 'ALL').trim();

  if (!cleanSelected || cleanSelected === 'ALL') {
    const present = !currentUser || breakdown.depotRows.length > 0;
    const theo = breakdown.hasExplicitStockLevels
      ? breakdown.allowedTotalQuantity
      : Number(product.quantity) || 0;
    return {
      presentInScope: present,
      theoreticalQty: theo,
      rackLocation: getProductDisplayLocation(product),
      depotName: product.store_name || 'Dépôt Principal',
    };
  }

  if (currentUser && !canUserViewDepot(cleanSelected, currentUser, depots, users)) {
    return {
      presentInScope: false,
      theoreticalQty: 0,
      rackLocation: '',
      depotName: cleanSelected,
    };
  }

  const targetLower = cleanSelected.toLowerCase();
  const levelRow = breakdown.depotRows.find((r) => r.depotName.toLowerCase() === targetLower);
  if (levelRow) {
    return {
      presentInScope: true,
      theoreticalQty: levelRow.quantity,
      rackLocation: levelRow.rackLocation || getProductDisplayLocation(product),
      depotName: levelRow.depotName,
    };
  }

  // Repli uniquement si aucune ligne stock_levels n'existe pour cet article et que son store_name correspond
  if (
    !breakdown.hasExplicitStockLevels &&
    (product.store_name || '').trim().toLowerCase() === targetLower &&
    (!currentUser || canUserViewDepot(cleanSelected, currentUser, depots, users))
  ) {
    return {
      presentInScope: true,
      theoreticalQty: Number(product.quantity) || 0,
      rackLocation: getProductDisplayLocation(product),
      depotName: cleanSelected,
    };
  }

  return {
    presentInScope: false,
    theoreticalQty: 0,
    rackLocation: '',
    depotName: cleanSelected,
  };
}

/**
 * Construit les lignes de comptage pour le dépôt sélectionné (avec filtre optionnel de catégorie, zone/emplacement et recherche).
 */
export function buildDepotAuditCountingRows(params: {
  products: Product[];
  stockLevels: StockLevel[];
  subCategories?: SubCategory[];
  currentUser?: User | null;
  depots?: Depot[];
  users?: User[];
  selectedDepot: string;
  selectedCategory?: string;
  zoneQuery?: string;
  searchQuery?: string;
  tableFilter?: 'ALL' | 'DIFF_ONLY' | 'MATCHED' | 'MISSING' | 'SURPLUS' | 'UNCOUNTED';
  counts: Record<string, number>;
}): { scopeRows: AuditCountingRow[]; filteredRows: AuditCountingRow[]; stats: AuditSessionStats } {
  const {
    products = [],
    stockLevels = [],
    subCategories = [],
    currentUser = null,
    depots = [],
    users = [],
    selectedDepot = 'ALL',
    selectedCategory = 'ALL',
    zoneQuery = '',
    searchQuery = '',
    tableFilter = 'ALL',
    counts = {},
  } = params;

  const subCatMap = new Map<string, string>();
  for (const sc of subCategories) {
    subCatMap.set(String(sc.id), sc.name);
  }

  const cleanZone = zoneQuery.trim().toLowerCase();
  const cleanSearch = searchQuery.trim().toLowerCase();

  const scopeRows: AuditCountingRow[] = [];

  for (const p of products) {
    if (selectedCategory && selectedCategory !== 'ALL') {
      if (String(p.sub_category_id) !== selectedCategory) continue;
    }

    const depotData = getProductAuditDepotData(
      p,
      selectedDepot,
      stockLevels,
      currentUser,
      depots,
      users
    );
    if (!depotData.presentInScope) continue;

    if (cleanZone) {
      const locHay = [depotData.rackLocation, p.room_name, p.shelf_name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!locHay.includes(cleanZone)) continue;
    }

    const isCounted = Object.prototype.hasOwnProperty.call(counts, p.id);
    const countedQty = isCounted ? Number(counts[p.id]) : null;
    const theoreticalQty = depotData.theoreticalQty;
    const difference = countedQty !== null ? countedQty - theoreticalQty : null;
    const unitPrice = Number(p.unit_price) || 0;
    const differenceValue = difference !== null ? difference * unitPrice : null;
    const catName =
      p.sub_category_id != null ? subCatMap.get(String(p.sub_category_id)) || '—' : '—';

    scopeRows.push({
      product: {
        ...p,
        store_name: depotData.depotName,
        rack_location: depotData.rackLocation,
        quantity: theoreticalQty,
      },
      productId: String(p.id),
      reference: p.reference || '',
      brand: p.brand || '',
      model: p.model || '',
      barcode: p.barcode || '',
      categoryName: catName,
      depotName: depotData.depotName,
      rackLocation: depotData.rackLocation,
      theoreticalQty,
      countedQty,
      difference,
      unitPrice,
      differenceValue,
      isCounted,
    });
  }

  scopeRows.sort((a, b) =>
    a.reference.localeCompare(b.reference, 'fr', { numeric: true, sensitivity: 'base' })
  );

  // Calcul des KPIs sur le périmètre
  let countedCount = 0;
  let matchedCount = 0;
  let missingCount = 0;
  let surplusCount = 0;
  let uncountedCount = 0;
  let theoreticalVal = 0;
  let physicalVal = 0;
  let varianceVal = 0;
  let lossVal = 0;

  for (const row of scopeRows) {
    theoreticalVal += row.theoreticalQty * row.unitPrice;
    if (row.isCounted && row.countedQty !== null && row.difference !== null) {
      countedCount++;
      physicalVal += row.countedQty * row.unitPrice;
      varianceVal += row.difference * row.unitPrice;
      if (row.difference === 0) {
        matchedCount++;
      } else if (row.difference < 0) {
        missingCount++;
        lossVal += Math.abs(row.difference) * row.unitPrice;
      } else {
        surplusCount++;
      }
    } else {
      uncountedCount++;
    }
  }

  const totalTheoreticalCount = scopeRows.length;
  const progressPct =
    totalTheoreticalCount > 0 ? Math.round((countedCount / totalTheoreticalCount) * 100) : 0;
  const accuracyRate = countedCount > 0 ? Math.round((matchedCount / countedCount) * 100) : 0;

  const stats: AuditSessionStats = {
    totalTheoreticalCount,
    countedCount,
    matchedCount,
    missingCount,
    surplusCount,
    uncountedCount,
    theoreticalVal,
    physicalVal,
    varianceVal,
    lossVal,
    progressPct,
    accuracyRate,
  };

  const filteredRows = scopeRows.filter((row) => {
    if (cleanSearch) {
      const hay = [
        row.reference,
        row.brand,
        row.model,
        row.barcode,
        row.product.manufacturer_ref,
        row.rackLocation,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(cleanSearch)) return false;
    }

    if (tableFilter === 'DIFF_ONLY') return row.isCounted && row.difference !== 0;
    if (tableFilter === 'MATCHED') return row.isCounted && row.difference === 0;
    if (tableFilter === 'MISSING') return row.isCounted && row.difference !== null && row.difference < 0;
    if (tableFilter === 'SURPLUS') return row.isCounted && row.difference !== null && row.difference > 0;
    if (tableFilter === 'UNCOUNTED') return !row.isCounted;
    return true;
  });

  return { scopeRows, filteredRows, stats };
}

/**
 * Prépare la liste des ajustements d'inventaire (un mouvement INVENTORY par ligne avec écart)
 * pour `applyInventoryAdjustments`.
 */
export function buildAuditAdjustmentsFromSession(
  scopeRows: AuditCountingRow[],
  counts: Record<string, number>,
  selectedDepot: string,
  reason = 'Régularisation Inventaire Physique TOT'
): AuditAdjustmentPayload[] {
  const adjustments: AuditAdjustmentPayload[] = [];
  const targetDepot = selectedDepot && selectedDepot !== 'ALL' ? selectedDepot : undefined;

  for (const row of scopeRows) {
    if (!Object.prototype.hasOwnProperty.call(counts, row.productId)) continue;
    const phys = Number(counts[row.productId]);
    if (!Number.isFinite(phys) || phys < 0) continue;
    const theo = row.theoreticalQty;
    adjustments.push({
      productId: row.productId,
      depotName: targetDepot || row.depotName,
      physicalCount: phys,
      theoreticalQty: theo,
      difference: phys - theo,
      reason,
    });
  }

  return adjustments;
}

/**
 * Génère le rapport CSV d'une session de comptage ou d'un audit archivé.
 */
export function buildAuditReportCsvContent(
  rows: AuditCountingRow[],
  canViewPrices: boolean
): string {
  const headers = [
    'Référence',
    'Code-barres',
    'Marque',
    'Modèle',
    'Dépôt',
    'Emplacement',
    'Stock Théorique',
    'Stock Compté',
    'Écart Unités',
    ...(canViewPrices ? ['Prix Unitaire HT (€)', 'Valeur Écart HT (€)'] : []),
    'Statut',
  ];

  const lines = [headers.map((h) => sanitizeCsvCell(h)).join(';')];

  for (const r of rows) {
    const status =
      r.difference === null
        ? 'Non compté'
        : r.difference === 0
        ? 'Conforme'
        : r.difference < 0
        ? 'Manquant / Perte'
        : 'Surplus';

    const priceCells = canViewPrices
      ? [
          r.unitPrice.toFixed(2),
          r.differenceValue !== null ? r.differenceValue.toFixed(2) : '',
        ]
      : [];

    const cells = [
      r.reference,
      r.barcode,
      r.brand,
      r.model,
      r.depotName,
      r.rackLocation,
      String(r.theoreticalQty),
      r.countedQty !== null ? String(r.countedQty) : '',
      r.difference !== null ? String(r.difference) : '',
      ...priceCells,
      status,
    ];
    lines.push(cells.map((c) => sanitizeCsvCell(c)).join(';'));
  }

  return '\uFEFF' + lines.join('\r\n');
}

/**
 * Génère le document HTML imprimable pour un rapport d'audit (en cours ou historique).
 */
export function buildAuditPrintableReportHtml(params: {
  title: string;
  subtitle: string;
  dateStr: string;
  auditorName: string;
  depotLabel: string;
  auditId?: string;
  rows: AuditCountingRow[];
  stats: AuditSessionStats;
  canViewPrices: boolean;
  sigAuditorLabel: string;
  sigManagerLabel: string;
}): string {
  const {
    title,
    subtitle,
    dateStr,
    auditorName,
    depotLabel,
    auditId,
    rows,
    stats,
    canViewPrices,
    sigAuditorLabel,
    sigManagerLabel,
  } = params;

  const itemsWithDiff = rows.filter((r) => r.isCounted && r.difference !== null && r.difference !== 0);
  const itemsMatched = rows.filter((r) => r.isCounted && r.difference === 0);
  const itemsUncounted = rows.filter((r) => !r.isCounted);

  return `<!DOCTYPE html>
<html>
<head>
  <title>${escapeLabelHtml(title)} - TOT Stock</title>
  <meta charset="utf-8" />
  <style>
    @page { size: A4 portrait; margin: 12mm 10mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 0;
      color: #0f172a;
      font-size: 10.5px;
      background: #fff;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #ea580c;
      padding-bottom: 10px;
      margin-bottom: 12px;
    }
    .logo-title { display: flex; align-items: center; gap: 8px; }
    .logo-badge {
      background: #ea580c;
      color: #fff;
      font-weight: 900;
      font-size: 14px;
      padding: 4px 8px;
      border-radius: 6px;
      letter-spacing: 1px;
    }
    .title { font-size: 16px; font-weight: 900; color: #0f172a; margin: 0; }
    .subtitle { font-size: 10px; color: #64748b; margin-top: 2px; }
    .meta-box { text-align: right; font-size: 9.5px; color: #475569; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
    .kpi-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px; background: #f8fafc; }
    .kpi-label { font-size: 8.5px; text-transform: uppercase; font-weight: 800; color: #64748b; }
    .kpi-val { font-size: 14px; font-weight: 900; margin-top: 3px; }
    .section-title {
      font-size: 12px;
      font-weight: 900;
      color: #0f172a;
      margin: 14px 0 6px 0;
      display: flex;
      justify-content: space-between;
    }
    table { width: 100%; border-collapse: collapse; font-size: 9.5px; margin-bottom: 14px; }
    th { background-color: #f1f5f9; border: 1px solid #cbd5e1; padding: 5px 6px; text-align: left; font-weight: 800; }
    td { border: 1px solid #e2e8f0; padding: 5px 6px; vertical-align: middle; }
    .badge-diff-neg { color: #dc2626; font-weight: 800; }
    .badge-diff-pos { color: #2563eb; font-weight: 800; }
    .signatures {
      margin-top: 24px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      page-break-inside: avoid;
    }
    .sig-box {
      border: 1px dashed #94a3b8;
      border-radius: 8px;
      height: 75px;
      padding: 8px;
      font-size: 9px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo-title">
      <span class="logo-badge">TOT</span>
      <div>
        <h1 class="title">${escapeLabelHtml(title)}</h1>
        <div class="subtitle">${escapeLabelHtml(subtitle)}</div>
      </div>
    </div>
    <div class="meta-box">
      ${auditId ? `<div><strong>ID Audit :</strong> ${escapeLabelHtml(auditId)}</div>` : ''}
      <div><strong>Date :</strong> ${escapeLabelHtml(dateStr)}</div>
      <div><strong>Auditeur :</strong> ${escapeLabelHtml(auditorName)}</div>
      <div><strong>Dépôt :</strong> ${escapeLabelHtml(depotLabel)}</div>
    </div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-label">Articles Audités</div>
      <div class="kpi-val">${stats.countedCount} / ${stats.totalTheoreticalCount} (${stats.progressPct}%)</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Taux d'Exactitude</div>
      <div class="kpi-val" style="color: ${stats.accuracyRate >= 85 ? '#16a34a' : '#d97706'}">${stats.accuracyRate}%</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Écarts Identifiés</div>
      <div class="kpi-val" style="color: ${itemsWithDiff.length > 0 ? '#dc2626' : '#16a34a'}">
        ${itemsWithDiff.length} réf. (${stats.missingCount} déficit, ${stats.surplusCount} surplus)
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Impact Financier Net</div>
      <div class="kpi-val" style="color: ${stats.varianceVal < 0 ? '#dc2626' : stats.varianceVal > 0 ? '#2563eb' : '#16a34a'}">
        ${canViewPrices ? `${stats.varianceVal >= 0 ? '+' : ''}${formatCurrency(stats.varianceVal)}` : 'Confidentiel'}
      </div>
    </div>
  </div>

  <div class="section-title">
    <span>1. Tableau des Écarts & Anomalies constatées (${itemsWithDiff.length})</span>
    ${canViewPrices ? `<span style="font-size: 10px; color: #dc2626; font-weight: normal;">Pertes brutes : -${formatCurrency(stats.lossVal)}</span>` : ''}
  </div>

  ${
    itemsWithDiff.length === 0
      ? '<p style="color: #16a34a; font-weight: 700; margin: 8px 0 16px 0;">✓ Aucun écart constaté sur les articles comptés.</p>'
      : `<table>
          <thead>
            <tr>
              <th style="width: 14%;">Réf. TOT</th>
              <th style="width: 28%;">Désignation Article</th>
              <th style="width: 16%;">Dépôt & Emplacement</th>
              <th style="width: 10%; text-align: center;">Théorique</th>
              <th style="width: 10%; text-align: center;">Compté</th>
              <th style="width: 10%; text-align: center;">Écart</th>
              <th style="width: 12%; text-align: right;">Val. Écart HT</th>
            </tr>
          </thead>
          <tbody>
            ${itemsWithDiff
              .map((r) => {
                const diff = r.difference || 0;
                const diffVal = r.differenceValue || 0;
                return `<tr>
                  <td><strong>${escapeLabelHtml(r.reference)}</strong></td>
                  <td>${escapeLabelHtml(`${r.brand} ${r.model}`.trim())}</td>
                  <td>${escapeLabelHtml(r.depotName)} ${r.rackLocation ? `(${escapeLabelHtml(r.rackLocation)})` : ''}</td>
                  <td style="text-align: center;">${r.theoreticalQty}</td>
                  <td style="text-align: center; font-weight: 800;">${r.countedQty ?? 0}</td>
                  <td style="text-align: center;" class="${diff < 0 ? 'badge-diff-neg' : 'badge-diff-pos'}">${diff > 0 ? '+' : ''}${diff}</td>
                  <td style="text-align: right; font-weight: 800;" class="${diffVal < 0 ? 'badge-diff-neg' : 'badge-diff-pos'}">
                    ${canViewPrices ? (diffVal > 0 ? '+' : '') + formatCurrency(diffVal) : '—'}
                  </td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>`
  }

  <div class="section-title">
    <span>2. Articles Conformes Vérifiés (${itemsMatched.length})</span>
  </div>
  <div style="font-size: 9px; color: #475569; margin-bottom: 12px;">
    ${
      itemsMatched.length > 0
        ? itemsMatched.map((r) => `<strong>${escapeLabelHtml(r.reference)}</strong> (${r.theoreticalQty})`).join(' • ')
        : 'Aucun article conforme compté à ce stade.'
    }
  </div>

  ${
    itemsUncounted.length > 0
      ? `<div class="section-title"><span>3. Articles Non Vérifiés (${itemsUncounted.length})</span></div>
         <div style="font-size: 8.5px; color: #94a3b8; margin-bottom: 16px;">
           ${itemsUncounted.map((r) => escapeLabelHtml(r.reference)).join(', ')}
         </div>`
      : ''
  }

  <div class="signatures">
    <div class="sig-box">
      <strong>${escapeLabelHtml(sigAuditorLabel)}</strong><br/>
      Nom : ${escapeLabelHtml(auditorName)}<br/>
      Date : ${escapeLabelHtml(dateStr)}<br/>
      Signature :
    </div>
    <div class="sig-box">
      <strong>${escapeLabelHtml(sigManagerLabel)}</strong><br/>
      Nom : ___________________________<br/>
      Date : ____ / ____ / ________<br/>
      Signature & Cachet :
    </div>
  </div>
</body>
</html>`;
}

/**
 * Enregistre un audit validé dans le cache local (`localStorage`) pour consultation hors ligne
 * dans l'onglet « Historique des audits ».
 */
export function saveLocalAuditHistoryRecord(record: AuditHistoryRecord): void {
  try {
    const existing = loadLocalAuditHistoryRecords();
    const filtered = existing.filter((r) => r.id !== record.id);
    const next = [record, ...filtered].slice(0, 100);
    localStorage.setItem(LOCAL_AUDIT_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors
  }
}

export function loadLocalAuditHistoryRecords(): AuditHistoryRecord[] {
  try {
    const raw = localStorage.getItem(LOCAL_AUDIT_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
