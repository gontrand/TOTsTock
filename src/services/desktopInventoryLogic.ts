import { Department, Depot, Product, Project, StockLevel, SubCategory, User } from '../types';
import { isUserAllowedForDepot } from '../utils/crypto';
import { canUserViewDepot } from '../utils/depotPermissions';
import { compareRackLocationsNatural } from './orderPickingLogic';

export type InventoryStockStatusFilter = 'ALL' | 'LOW' | 'OUT';

export interface InventoryFilterParams {
  searchQuery?: string;
  stockStatus?: InventoryStockStatusFilter;
  selectedSubCat?: string;
  selectedStore?: string;
  selectedSupplier?: string;
  roomQuery?: string;
  shelfQuery?: string;
}

export interface InventoryFilterOptions {
  isLambdaUser: boolean;
  includeClosedDepots: boolean;
  closedDepotNames: Set<string>;
  stockLevels?: StockLevel[];
  currentUser?: User | null;
  expandMultiDepotOnSearch?: boolean;
  depots?: Depot[];
  departments?: Department[];
  allUsers?: User[];
  projects?: Project[];
}

export interface ProductDepotStockRow {
  depotName: string;
  quantity: number;
  rackLocation: string;
  minAlert: number;
  isLow: boolean;
  isOut: boolean;
}

export interface ProductDepotBreakdown {
  /** Lignes de stock par dépôt visibles pour l'utilisateur courant (selon allowed_depots et canUserViewDepot) */
  depotRows: ProductDepotStockRow[];
  /** Toutes les lignes de stock par dépôt (tous dépôts confondus) */
  allDepotRows: ProductDepotStockRow[];
  /** Total des quantités sur les dépôts autorisés */
  allowedTotalQuantity: number;
  /** Somme globale de toutes les lignes stock_levels de cet article */
  sumOfStockLevels: number;
  /** Quantité globale stockée sur products.quantity */
  productQuantity: number;
  /** Indique si la table stock_levels contient au moins une ligne pour cet article */
  hasExplicitStockLevels: boolean;
  /** Vrai si products.quantity diffère de la somme des stock_levels */
  hasDiscrepancy: boolean;
  /** Écart (products.quantity - sumOfStockLevels) */
  discrepancyDelta: number;
}

/**
 * Calcule la répartition exacte du stock par dépôt d'une référence à partir de `stock_levels`,
 * filtre selon `allowed_depots` et `canUserViewDepot` (véhicules/conteneurs du département),
 * et détecte tout écart de cohérence avec `products.quantity`.
 */
export function getProductDepotBreakdown(
  product: Product | null | undefined,
  stockLevels: StockLevel[] = [],
  currentUser?: User | null,
  depots?: Depot[],
  departments: Department[] | User[] = [],
  allUsers: User[] | Department[] = [],
  projects: Project[] = []
): ProductDepotBreakdown {
  if (!product) {
    return {
      depotRows: [],
      allDepotRows: [],
      allowedTotalQuantity: 0,
      sumOfStockLevels: 0,
      productQuantity: 0,
      hasExplicitStockLevels: false,
      hasDiscrepancy: false,
      discrepancyDelta: 0,
    };
  }

  const pid = String(product.id);
  const matchingLevels = (stockLevels || []).filter((sl) => String(sl.product_id) === pid);
  const hasExplicitStockLevels = matchingLevels.length > 0;
  const defaultMin = Number(product.min_stock_alert) || 2;
  const defaultRack = getProductDisplayLocation(product);

  const allDepotRows: ProductDepotStockRow[] = hasExplicitStockLevels
    ? matchingLevels
        .map((sl) => {
          const qty = Number(sl.quantity) || 0;
          const min = sl.min_alert !== undefined && sl.min_alert !== null ? Number(sl.min_alert) : defaultMin;
          return {
            depotName: (sl.depot_name || product.store_name || 'Dépôt Principal').trim(),
            quantity: qty,
            rackLocation: (sl.rack_location || '').trim() || (sl.depot_name === product.store_name ? defaultRack : ''),
            minAlert: min,
            isOut: qty <= 0,
            isLow: qty > 0 && qty <= min,
          };
        })
        .sort((a, b) => a.depotName.localeCompare(b.depotName, 'fr', { sensitivity: 'base' }))
    : [
        {
          depotName: (product.store_name || 'Dépôt Principal').trim(),
          quantity: Number(product.quantity) || 0,
          rackLocation: defaultRack,
          minAlert: defaultMin,
          isOut: (Number(product.quantity) || 0) <= 0,
          isLow:
            (Number(product.quantity) || 0) > 0 &&
            (Number(product.quantity) || 0) <= defaultMin,
        },
      ];

  const isRowVisibleForUser = (depotName: string): boolean => {
    if (!currentUser) return true;
    if (!isUserAllowedForDepot(currentUser, depotName)) return false;
    if (Array.isArray(depots) && depots.length > 0) {
      const clean = (depotName || '').trim().toLowerCase();
      const depotObj = depots.find(
        (d) =>
          (d.name || '').trim().toLowerCase() === clean ||
          String(d.id).trim().toLowerCase() === clean
      );
      if (depotObj && !canUserViewDepot(currentUser, depotObj, departments, allUsers, projects)) {
        return false;
      }
    }
    return true;
  };

  const depotRows = currentUser
    ? allDepotRows.filter((row) => isRowVisibleForUser(row.depotName))
    : allDepotRows;

  const sumOfStockLevels = allDepotRows.reduce((acc, r) => acc + (Number(r.quantity) || 0), 0);
  const allowedTotalQuantity = depotRows.reduce((acc, r) => acc + (Number(r.quantity) || 0), 0);
  const productQuantity = Number(product.quantity) || 0;
  const discrepancyDelta = productQuantity - sumOfStockLevels;
  const hasDiscrepancy = hasExplicitStockLevels && discrepancyDelta !== 0;

  return {
    depotRows,
    allDepotRows,
    allowedTotalQuantity,
    sumOfStockLevels,
    productQuantity,
    hasExplicitStockLevels,
    hasDiscrepancy,
    discrepancyDelta,
  };
}

export type InventorySortColumn =
  | 'reference'
  | 'designation'
  | 'brand'
  | 'category'
  | 'store_name'
  | 'location'
  | 'quantity'
  | 'min_stock_alert'
  | 'unit_price'
  | 'status';

export type SortDirection = 'asc' | 'desc';

export type InventoryColumnId =
  | 'reference'
  | 'designation'
  | 'brand'
  | 'category'
  | 'store_name'
  | 'location'
  | 'quantity'
  | 'min_stock_alert'
  | 'unit_price'
  | 'status';

export const DEFAULT_INVENTORY_COLUMNS: InventoryColumnId[] = [
  'reference',
  'designation',
  'brand',
  'category',
  'store_name',
  'location',
  'quantity',
  'min_stock_alert',
  'unit_price',
  'status',
];

export const INVENTORY_COLUMNS_STORAGE_KEY = 'tot_desktop_inventory_columns_v1';
export const INVENTORY_DENSITY_STORAGE_KEY = 'tot_desktop_inventory_density_v1';

/**
 * Construit l'ensemble des noms de dépôts fermés (`is_active === false`), en minuscules.
 */
export function buildClosedDepotNamesSet(depots: Depot[]): Set<string> {
  return new Set(
    (depots || [])
      .filter((d) => d.is_active === false)
      .map((d) => (d.name || '').toLowerCase().trim())
      .filter(Boolean)
  );
}

/**
 * Retourne l'emplacement lisible d'un produit (`rack_location` ou `room_name / shelf_name`).
 */
export function getProductDisplayLocation(p: Product): string {
  if (p.rack_location && p.rack_location.trim()) {
    return p.rack_location.trim();
  }
  const parts = [p.room_name?.trim(), p.shelf_name?.trim()].filter(Boolean);
  return parts.join(' · ');
}

/**
 * Retourne le statut de stock d'un produit : `'OUT'` (rupture), `'LOW'` (stock bas), `'OK'` (en stock).
 */
export function getProductStockState(p: Product): 'OUT' | 'LOW' | 'OK' {
  const qty = Number(p.quantity) || 0;
  const min = Number(p.min_stock_alert) || 2;
  if (qty <= 0) return 'OUT';
  if (qty <= min) return 'LOW';
  return 'OK';
}

/**
 * Filtre les produits d'inventaire avec les mêmes règles sur mobile et Bureau :
 * - Les opérateurs standards (`isLambdaUser === true`) ne voient jamais les articles des dépôts fermés.
 * - Les responsables peuvent afficher/masquer les dépôts fermés via `includeClosedDepots`.
 * - Respecte `allowed_depots` de l'utilisateur courant (`currentUser`).
 * - Quand un dépôt précis (`selectedStore`) est sélectionné, n'affiche que les articles présents dans ce dépôt
 *   et projette `quantity`, `rack_location` et `min_stock_alert` avec les valeurs exactes de `stock_levels` pour ce dépôt.
 * - Quand une recherche (`searchQuery`) est active sans filtre de dépôt et qu'une référence existe dans plusieurs dépôts,
 *   retourne une ligne par dépôt autorisé où la référence est présente.
 */
export function filterInventoryProducts(
  products: Product[],
  filters: InventoryFilterParams,
  options: InventoryFilterOptions
): Product[] {
  const q = (filters.searchQuery || '').toLowerCase().trim();
  const rq = (filters.roomQuery || '').toLowerCase().trim();
  const sq = (filters.shelfQuery || '').toLowerCase().trim();
  const stockStatus = filters.stockStatus || 'ALL';
  const selectedSubCat = filters.selectedSubCat || '';
  const selectedStore = (filters.selectedStore || '').trim();
  const selectedSupplier = filters.selectedSupplier || '';
  const stockLevels = options.stockLevels || [];
  const currentUser = options.currentUser || null;
  const expandMultiDepot = options.expandMultiDepotOnSearch !== false;

  // Regrouper stock_levels par product_id pour un accès O(1)
  const levelsByProduct = new Map<string, StockLevel[]>();
  for (const sl of stockLevels) {
    const pid = String(sl.product_id);
    const list = levelsByProduct.get(pid);
    if (list) list.push(sl);
    else levelsByProduct.set(pid, [sl]);
  }

  const isDepotVisible = (depotName: string | undefined): boolean => {
    const clean = (depotName || '').trim();
    if (currentUser && clean && !isUserAllowedForDepot(currentUser, clean)) {
      return false;
    }
    const lower = clean.toLowerCase();
    if (currentUser && clean && Array.isArray(options.depots) && options.depots.length > 0) {
      const depotObj = options.depots.find(
        (d) =>
          (d.name || '').trim().toLowerCase() === lower ||
          String(d.id).trim().toLowerCase() === lower
      );
      if (
        depotObj &&
        !canUserViewDepot(
          currentUser,
          depotObj,
          options.departments || [],
          options.allUsers || [],
          options.projects || []
        )
      ) {
        return false;
      }
    }
    const isDepotClosed = Boolean(clean && options.closedDepotNames.has(lower));
    if (options.isLambdaUser && isDepotClosed) return false;
    if (!options.isLambdaUser && isDepotClosed && !options.includeClosedDepots) return false;
    return true;
  };

  const results: Product[] = [];

  for (const p of products || []) {
    if (selectedSubCat && String(p.sub_category_id) !== selectedSubCat) continue;
    if (
      selectedSupplier &&
      p.supplier_1_name !== selectedSupplier &&
      p.supplier_2_name !== selectedSupplier
    ) {
      continue;
    }
    if (rq && (!p.room_name || !p.room_name.toLowerCase().includes(rq))) continue;

    if (q) {
      const matchRef = (p.reference || '').toLowerCase().includes(q);
      const matchBrand = (p.brand || '').toLowerCase().includes(q);
      const matchModel = (p.model || '').toLowerCase().includes(q);
      const matchOem = Boolean(p.manufacturer_ref?.toLowerCase().includes(q));
      const matchTags = Boolean(p.tags?.toLowerCase().includes(q));
      const matchBarcode = Boolean(p.barcode?.toLowerCase().includes(q));
      const matchQr = Boolean(p.qr_code?.toLowerCase().includes(q));
      if (
        !matchRef &&
        !matchBrand &&
        !matchModel &&
        !matchOem &&
        !matchTags &&
        !matchBarcode &&
        !matchQr
      ) {
        continue;
      }
    }

    const pLevels = levelsByProduct.get(String(p.id)) || [];

    // Cas A : Un dépôt précis est sélectionné dans le filtre
    if (selectedStore) {
      if (!isDepotVisible(selectedStore)) continue;

      let effectiveQty: number | null = null;
      let effectiveRack = p.rack_location;
      let effectiveShelf = p.shelf_name;
      let effectiveMin = Number(p.min_stock_alert) || 2;

      if (pLevels.length > 0) {
        const matchLevel = pLevels.find(
          (sl) => sl.depot_name.trim().toLowerCase() === selectedStore.toLowerCase()
        );
        if (!matchLevel) {
          continue; // Cette référence n'est pas présente dans ce dépôt
        }
        effectiveQty = Number(matchLevel.quantity) || 0;
        if (matchLevel.rack_location) {
          effectiveRack = matchLevel.rack_location;
          effectiveShelf = matchLevel.rack_location;
        }
        if (matchLevel.min_alert !== undefined && matchLevel.min_alert !== null) {
          effectiveMin = Number(matchLevel.min_alert);
        }
      } else {
        if ((p.store_name || '').trim().toLowerCase() !== selectedStore.toLowerCase()) {
          continue;
        }
        effectiveQty = Number(p.quantity) || 0;
      }

      if (
        sq &&
        !(effectiveShelf && effectiveShelf.toLowerCase().includes(sq)) &&
        !(effectiveRack && effectiveRack.toLowerCase().includes(sq))
      ) {
        continue;
      }

      if (stockStatus === 'LOW' && (effectiveQty <= 0 || effectiveQty > effectiveMin)) continue;
      if (stockStatus === 'OUT' && effectiveQty > 0) continue;

      results.push({
        ...p,
        store_name: selectedStore,
        quantity: effectiveQty,
        rack_location: effectiveRack,
        shelf_name: effectiveShelf,
        min_stock_alert: effectiveMin,
      });
      continue;
    }

    // Cas B : Tous les dépôts ("ALL")
    if (pLevels.length > 0) {
      const visibleLevels = pLevels.filter((sl) => isDepotVisible(sl.depot_name));
      if (visibleLevels.length === 0) continue;

      // Si recherche active et référence présente dans plusieurs dépôts autorisés : une ligne par dépôt
      if (q && expandMultiDepot && visibleLevels.length > 1) {
        for (const sl of visibleLevels) {
          const dQty = Number(sl.quantity) || 0;
          const dMin =
            sl.min_alert !== undefined && sl.min_alert !== null
              ? Number(sl.min_alert)
              : Number(p.min_stock_alert) || 2;
          const dRack = sl.rack_location || p.rack_location;
          const dShelf = sl.rack_location || p.shelf_name;

          if (
            sq &&
            !(dShelf && dShelf.toLowerCase().includes(sq)) &&
            !(dRack && dRack.toLowerCase().includes(sq))
          ) {
            continue;
          }
          if (stockStatus === 'LOW' && (dQty <= 0 || dQty > dMin)) continue;
          if (stockStatus === 'OUT' && dQty > 0) continue;

          results.push({
            ...p,
            store_name: sl.depot_name,
            quantity: dQty,
            rack_location: dRack,
            shelf_name: dShelf,
            min_stock_alert: dMin,
          });
        }
        continue;
      }

      // Sinon : 1 ligne globale pour la référence (somme des dépôts autorisés si restriction ou si des véhicules/conteneurs ont été exclus)
      const hasHiddenDepots = visibleLevels.length < pLevels.length;
      const isRestrictedUser = Boolean(
        hasHiddenDepots ||
          (currentUser?.allowed_depots &&
            currentUser.allowed_depots.length > 0 &&
            !currentUser.allowed_depots.includes('*'))
      );
      const effectiveQty = isRestrictedUser
        ? visibleLevels.reduce((acc, sl) => acc + (Number(sl.quantity) || 0), 0)
        : Number(p.quantity) || 0;
      const min = Number(p.min_stock_alert) || 2;

      if (sq && (!p.shelf_name || !p.shelf_name.toLowerCase().includes(sq))) continue;
      if (stockStatus === 'LOW' && (effectiveQty <= 0 || effectiveQty > min)) continue;
      if (stockStatus === 'OUT' && effectiveQty > 0) continue;

      results.push(
        isRestrictedUser
          ? {
              ...p,
              quantity: effectiveQty,
              store_name: visibleLevels[0]?.depot_name || p.store_name,
            }
          : p
      );
      continue;
    }

    // Repli si aucune ligne stock_levels n'est chargée pour ce produit
    if (!isDepotVisible(p.store_name)) continue;
    if (sq && (!p.shelf_name || !p.shelf_name.toLowerCase().includes(sq))) continue;

    const qty = Number(p.quantity) || 0;
    const min = Number(p.min_stock_alert) || 2;
    if (stockStatus === 'LOW' && (qty <= 0 || qty > min)) continue;
    if (stockStatus === 'OUT' && qty > 0) continue;

    results.push(p);
  }

  return results;
}

/**
 * Trie les produits d'inventaire selon la colonne et la direction choisies.
 */
export function sortInventoryProducts(
  products: Product[],
  sortColumn: InventorySortColumn,
  sortDirection: SortDirection = 'asc',
  subCategories: SubCategory[] = []
): Product[] {
  const subCatMap = new Map<number, string>();
  for (const sc of subCategories) {
    subCatMap.set(Number(sc.id), sc.name || '');
  }

  const mult = sortDirection === 'asc' ? 1 : -1;
  const copy = [...products];

  copy.sort((a, b) => {
    let cmp = 0;
    switch (sortColumn) {
      case 'reference':
        cmp = (a.reference || '').localeCompare(b.reference || '', 'fr', {
          numeric: true,
          sensitivity: 'base',
        });
        break;
      case 'designation':
        cmp = `${a.brand || ''} ${a.model || ''}`
          .trim()
          .localeCompare(`${b.brand || ''} ${b.model || ''}`.trim(), 'fr', {
            sensitivity: 'base',
          });
        break;
      case 'brand':
        cmp = (a.brand || '').localeCompare(b.brand || '', 'fr', { sensitivity: 'base' });
        break;
      case 'category': {
        const catA = a.sub_category_id ? subCatMap.get(Number(a.sub_category_id)) || '' : '';
        const catB = b.sub_category_id ? subCatMap.get(Number(b.sub_category_id)) || '' : '';
        cmp = catA.localeCompare(catB, 'fr', { sensitivity: 'base' });
        break;
      }
      case 'store_name':
        cmp = (a.store_name || '').localeCompare(b.store_name || '', 'fr', { sensitivity: 'base' });
        break;
      case 'location': {
        const locA = getProductDisplayLocation(a);
        const locB = getProductDisplayLocation(b);
        return compareRackLocationsNatural(locA, locB) * mult;
      }
      case 'quantity':
        cmp = (Number(a.quantity) || 0) - (Number(b.quantity) || 0);
        break;
      case 'min_stock_alert':
        cmp = (Number(a.min_stock_alert) || 2) - (Number(b.min_stock_alert) || 2);
        break;
      case 'unit_price':
        cmp = (Number(a.unit_price) || 0) - (Number(b.unit_price) || 0);
        break;
      case 'status': {
        const rank = { OUT: 0, LOW: 1, OK: 2 };
        cmp = rank[getProductStockState(a)] - rank[getProductStockState(b)];
        break;
      }
      default:
        cmp = 0;
    }
    if (cmp === 0) {
      cmp = (a.reference || '').localeCompare(b.reference || '', 'fr', { numeric: true });
    }
    return cmp * mult;
  });

  return copy;
}

// ---------------------------------------------------------------------------
// Sélection multiple (cases à cocher, Maj+clic, tout sélectionner)
// ---------------------------------------------------------------------------
export interface SelectionClickParams {
  currentSelectedIds: Set<string>;
  clickedId: string;
  orderedIds: string[];
  shiftKey?: boolean;
  lastClickedId?: string | null;
}

export interface SelectionClickResult {
  selectedIds: Set<string>;
  lastClickedId: string;
}

export function computeSelectionAfterClick(params: SelectionClickParams): SelectionClickResult {
  const { currentSelectedIds, clickedId, orderedIds, shiftKey = false, lastClickedId = null } =
    params;
  const next = new Set(currentSelectedIds);

  if (shiftKey && lastClickedId && lastClickedId !== clickedId) {
    const startIdx = orderedIds.indexOf(lastClickedId);
    const endIdx = orderedIds.indexOf(clickedId);
    if (startIdx !== -1 && endIdx !== -1) {
      const from = Math.min(startIdx, endIdx);
      const to = Math.max(startIdx, endIdx);
      const shouldSelect = !currentSelectedIds.has(clickedId);
      for (let i = from; i <= to; i++) {
        const id = orderedIds[i];
        if (shouldSelect) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      return { selectedIds: next, lastClickedId: clickedId };
    }
  }

  if (next.has(clickedId)) {
    next.delete(clickedId);
  } else {
    next.add(clickedId);
  }

  return { selectedIds: next, lastClickedId: clickedId };
}

export function toggleSelectAllVisible(
  currentSelectedIds: Set<string>,
  visibleIds: string[]
): Set<string> {
  if (visibleIds.length === 0) return new Set(currentSelectedIds);
  const allSelected = visibleIds.every((id) => currentSelectedIds.has(id));
  const next = new Set(currentSelectedIds);
  if (allSelected) {
    for (const id of visibleIds) {
      next.delete(id);
    }
  } else {
    for (const id of visibleIds) {
      next.add(id);
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// Reconnaissance d'une rafale de scan USB (HID Keyboard Wedge)
// Délai entre touches < 50 ms suivi de Entrée, hors champ de saisie.
// ---------------------------------------------------------------------------
export const MAX_SCANNER_INTER_KEY_DELAY_MS = 50;
export const MIN_SCANNER_BURST_LENGTH = 3;

export interface BarcodeBurstState {
  buffer: string;
  lastKeyTimestampMs: number | null;
  fastIntervalsCount: number;
}

export interface BarcodeBurstStepResult {
  state: BarcodeBurstState;
  committedCode: string | null;
}

export function createInitialBarcodeBurstState(): BarcodeBurstState {
  return {
    buffer: '',
    lastKeyTimestampMs: null,
    fastIntervalsCount: 0,
  };
}

/**
 * Automates purs de détection d'une rafale de lecteur USB (caractères imprimables séparés
 * par < `maxInterKeyDelayMs`, terminés par `Enter`).
 * Une saisie manuelle (intervalle >= 50 ms) réinitialise le tampon pour éviter tout faux positif.
 */
export function processKeyForBarcodeBurst(
  prevState: BarcodeBurstState,
  key: string,
  timestampMs: number,
  options?: {
    maxInterKeyDelayMs?: number;
    minBurstLength?: number;
    isEditableTarget?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
  }
): BarcodeBurstStepResult {
  const maxDelay = options?.maxInterKeyDelayMs ?? MAX_SCANNER_INTER_KEY_DELAY_MS;
  const minLen = options?.minBurstLength ?? MIN_SCANNER_BURST_LENGTH;

  // Ne jamais intercepter la frappe dans un champ de saisie ou avec Ctrl/Alt/Meta
  if (options?.isEditableTarget || options?.ctrlKey || options?.altKey || options?.metaKey) {
    return {
      state: createInitialBarcodeBurstState(),
      committedCode: null,
    };
  }

  // Touche modificatrice isolée (Shift, CapsLock) : conserver le tampon courant sans casser la rafale
  if (key === 'Shift' || key === 'CapsLock' || key === 'Dead') {
    return {
      state: prevState,
      committedCode: null,
    };
  }

  const delta =
    prevState.lastKeyTimestampMs !== null ? timestampMs - prevState.lastKeyTimestampMs : null;

  if (key === 'Enter') {
    if (
      prevState.buffer.length >= minLen &&
      prevState.fastIntervalsCount >= minLen - 1 &&
      delta !== null &&
      delta >= 0 &&
      delta <= maxDelay * 2
    ) {
      const code = prevState.buffer.trim();
      return {
        state: createInitialBarcodeBurstState(),
        committedCode: code || null,
      };
    }
    return {
      state: createInitialBarcodeBurstState(),
      committedCode: null,
    };
  }

  // Seuls les caractères imprimables uniques (longueur 1) alimentent la rafale
  if (typeof key !== 'string' || key.length !== 1) {
    return {
      state: createInitialBarcodeBurstState(),
      committedCode: null,
    };
  }

  if (delta !== null && delta >= 0 && delta < maxDelay) {
    return {
      state: {
        buffer: prevState.buffer + key,
        lastKeyTimestampMs: timestampMs,
        fastIntervalsCount: prevState.fastIntervalsCount + 1,
      },
      committedCode: null,
    };
  }

  // Première touche ou délai trop lent (saisie humaine) : on redémarre le tampon à ce caractère
  return {
    state: {
      buffer: key,
      lastKeyTimestampMs: timestampMs,
      fastIntervalsCount: 0,
    },
    committedCode: null,
  };
}

// ---------------------------------------------------------------------------
// Table des raccourcis clavier bureau (aucun déclenchement dans un champ de saisie)
// ---------------------------------------------------------------------------
export type DesktopShortcutAction =
  | 'OPEN_COMMAND_PALETTE'
  | 'FOCUS_SEARCH'
  | 'NEW_ITEM'
  | 'CLOSE_PANEL'
  | 'NAVIGATE_UP'
  | 'NAVIGATE_DOWN'
  | 'OPEN_SELECTED'
  | 'PRINT_LABELS'
  | 'OPEN_SHORTCUTS_HELP'
  | 'PICK_QUANTITY_F2'
  | 'PICK_MISSING_F4'
  | 'PICK_READY_F8';

export interface DesktopShortcutDef {
  action: DesktopShortcutAction;
  keysLabel: string;
  descriptionFr: string;
  descriptionEn: string;
  descriptionNl: string;
}

export const DESKTOP_SHORTCUTS_TABLE: DesktopShortcutDef[] = [
  {
    action: 'OPEN_COMMAND_PALETTE',
    keysLabel: 'Ctrl+K / ⌘K',
    descriptionFr: 'Ouvrir la palette de commandes',
    descriptionEn: 'Open command palette',
    descriptionNl: 'Opdrachtenpalet openen',
  },
  {
    action: 'FOCUS_SEARCH',
    keysLabel: '/',
    descriptionFr: 'Placer le curseur dans la recherche',
    descriptionEn: 'Focus search input',
    descriptionNl: 'Zoekveld focussen',
  },
  {
    action: 'NEW_ITEM',
    keysLabel: 'Ctrl+N',
    descriptionFr: 'Nouveau produit ou nouvelle commande (selon la page)',
    descriptionEn: 'New product or new order (depending on page)',
    descriptionNl: 'Nieuw product of nieuwe bestelling (afhankelijk van pagina)',
  },
  {
    action: 'PRINT_LABELS',
    keysLabel: 'Ctrl+P',
    descriptionFr: "Imprimer des étiquettes (ou la sélection)",
    descriptionEn: 'Print labels (or current selection)',
    descriptionNl: 'Etiketten afdrukken (of huidige selectie)',
  },
  {
    action: 'NAVIGATE_UP',
    keysLabel: '↑ / ↓',
    descriptionFr: 'Naviguer dans les lignes du tableau',
    descriptionEn: 'Navigate table rows',
    descriptionNl: 'Door tabelrijen navigeren',
  },
  {
    action: 'OPEN_SELECTED',
    keysLabel: 'Entrée',
    descriptionFr: 'Ouvrir le détail de la ligne sélectionnée',
    descriptionEn: 'Open selected row detail',
    descriptionNl: 'Detail van geselecteerde rij openen',
  },
  {
    action: 'CLOSE_PANEL',
    keysLabel: 'Échap',
    descriptionFr: 'Fermer le panneau latéral ou la fenêtre active',
    descriptionEn: 'Close side panel or active modal',
    descriptionNl: 'Zijpaneel of actief venster sluiten',
  },
  {
    action: 'OPEN_SHORTCUTS_HELP',
    keysLabel: '? ou Ctrl+/',
    descriptionFr: 'Afficher l’aide des raccourcis clavier',
    descriptionEn: 'Show keyboard shortcuts help',
    descriptionNl: 'Sneltoetshulp weergeven',
  },
  {
    action: 'PICK_QUANTITY_F2',
    keysLabel: 'F2',
    descriptionFr: 'Préparation : saisir la quantité de la ligne',
    descriptionEn: 'Picking: enter line quantity',
    descriptionNl: 'Orderpicken: regelaantal invoeren',
  },
  {
    action: 'PICK_MISSING_F4',
    keysLabel: 'F4',
    descriptionFr: 'Préparation : déclarer la ligne manquante',
    descriptionEn: 'Picking: mark line as missing',
    descriptionNl: 'Orderpicken: regel als ontbrekend markeren',
  },
  {
    action: 'PICK_READY_F8',
    keysLabel: 'F8',
    descriptionFr: 'Préparation : terminer et marquer la commande prête',
    descriptionEn: 'Picking: finish and mark order ready',
    descriptionNl: 'Orderpicken: afronden en bestelling gereed melden',
  },
];

/**
 * Indique si l'élément cible d'un événement clavier est un champ de saisie.
 */
export function isEditableEventTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as {
    tagName?: string;
    isContentEditable?: boolean;
    getAttribute?: (attr: string) => string | null;
  };
  if (el.isContentEditable) return true;
  if (typeof el.getAttribute === 'function' && el.getAttribute('contenteditable') === 'true') {
    return true;
  }
  const tag = (el.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export interface ShortcutKeyEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: unknown;
}

/**
 * Résout l'action de raccourci clavier correspondant à un événement clavier.
 * Règle impérative : aucun raccourci ne s'active pendant la saisie dans un champ (`isEditableEventTarget`).
 */
export function matchDesktopShortcut(event: ShortcutKeyEventLike): DesktopShortcutAction | null {
  if (!event || typeof event.key !== 'string') return null;

  // Interdiction stricte d'intercepter les touches pendant la saisie dans un champ
  if (isEditableEventTarget(event.target)) {
    return null;
  }

  const key = event.key;
  const mod = Boolean(event.ctrlKey || event.metaKey);

  if (mod && !event.altKey) {
    const lower = key.toLowerCase();
    if (lower === 'k') return 'OPEN_COMMAND_PALETTE';
    if (lower === 'n') return 'NEW_ITEM';
    if (lower === 'p') return 'PRINT_LABELS';
    if (key === '/' || key === '?') return 'OPEN_SHORTCUTS_HELP';
    return null;
  }

  if (event.altKey || event.ctrlKey || event.metaKey) {
    return null;
  }

  if (key === 'Escape') return 'CLOSE_PANEL';
  if (key === '/') return 'FOCUS_SEARCH';
  if (key === '?') return 'OPEN_SHORTCUTS_HELP';
  if (key === 'ArrowUp') return 'NAVIGATE_UP';
  if (key === 'ArrowDown') return 'NAVIGATE_DOWN';
  if (key === 'Enter') return 'OPEN_SELECTED';
  if (key === 'F2') return 'PICK_QUANTITY_F2';
  if (key === 'F4') return 'PICK_MISSING_F4';
  if (key === 'F8') return 'PICK_READY_F8';

  return null;
}

// ---------------------------------------------------------------------------
// Export CSV sécurisé (neutralisation des formules =, +, -, @)
// ---------------------------------------------------------------------------
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let str = String(value).replace(/\r?\n/g, ' ').trim();
  // Neutraliser l'injection de formules tableur (=, +, -, @ en début de cellule, sauf nombres négatifs purs si besoin, mais la consigne impose =, +, -, @)
  if (/^[=+\-@]/.test(str)) {
    str = `'${str}`;
  }
  if (str.includes(';') || str.includes(',') || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildInventoryCsvContent(
  products: Product[],
  subCategories: SubCategory[] = [],
  canViewPrices: boolean = false
): string {
  const subCatMap = new Map<number, string>();
  for (const sc of subCategories) {
    subCatMap.set(Number(sc.id), sc.name || '');
  }

  const headers = [
    'Reference',
    'Marque',
    'Modele',
    'Categorie',
    'Depot',
    'Emplacement',
    'Quantite',
    'Seuil_Alerte',
    ...(canViewPrices ? ['Prix_Unitaire_HT'] : []),
    'Code_Barres',
    'Ref_Fabricant',
    'Fournisseur_1',
  ];

  const lines = [headers.join(';')];
  for (const p of products) {
    const cat = p.sub_category_id ? subCatMap.get(Number(p.sub_category_id)) || '' : '';
    const loc = getProductDisplayLocation(p);
    const row = [
      sanitizeCsvCell(p.reference),
      sanitizeCsvCell(p.brand),
      sanitizeCsvCell(p.model),
      sanitizeCsvCell(cat),
      sanitizeCsvCell(p.store_name || ''),
      sanitizeCsvCell(loc),
      String(Number(p.quantity) || 0),
      String(Number(p.min_stock_alert) || 2),
      ...(canViewPrices ? [String(Number(p.unit_price || 0).toFixed(2))] : []),
      sanitizeCsvCell(p.barcode || ''),
      sanitizeCsvCell(p.manufacturer_ref || ''),
      sanitizeCsvCell(p.supplier_1_name || ''),
    ];
    lines.push(row.join(';'));
  }

  return '\uFEFF' + lines.join('\r\n');
}
