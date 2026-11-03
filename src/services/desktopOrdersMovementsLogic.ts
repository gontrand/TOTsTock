import {
  Department,
  MaterialOrder,
  MaterialOrderItem,
  MovementType,
  OrderStatus,
  Product,
  StockMovement,
  User,
} from '../types';
import { isUserAllowedForDepot } from '../utils/crypto';
import { sanitizeCsvCell } from './desktopInventoryLogic';

export type MovementPeriodFilter = 'TODAY' | '7D' | '30D' | 'ALL' | 'CUSTOM';

export interface DesktopMovementsFilterCriteria {
  searchQuery?: string;
  typeFilter?: 'ALL' | MovementType;
  depotFilter?: string;
  userOrDeptFilter?: string;
  periodFilter?: MovementPeriodFilter;
  dateFrom?: string;
  dateTo?: string;
  closedDepotNames?: Set<string>;
}

export type DesktopMovementSortField =
  | 'created_at'
  | 'movement_type'
  | 'product_ref'
  | 'quantity_changed'
  | 'depot_name'
  | 'user_name'
  | 'site_number';

/**
 * Filtre les mouvements de stock en respectant les dépôts autorisés de l'utilisateur,
 * les dépôts fermés, la période, le type (IN/OUT) et la recherche plein texte.
 */
export function filterMovementsList(
  movements: StockMovement[],
  products: Product[],
  currentUser: User | null | undefined,
  criteria: DesktopMovementsFilterCriteria,
  nowMs: number = Date.now()
): StockMovement[] {
  if (!Array.isArray(movements)) return [];

  const q = (criteria.searchQuery || '').trim().toLowerCase();
  const typeFilter = criteria.typeFilter || 'ALL';
  const depotFilter = (criteria.depotFilter || 'ALL').trim();
  const userOrDept = (criteria.userOrDeptFilter || 'ALL').trim().toLowerCase();
  const period = criteria.periodFilter || 'ALL';
  const closedSet = criteria.closedDepotNames || new Set<string>();

  const productById = new Map<string, Product>();
  for (const p of products || []) {
    productById.set(String(p.id), p);
  }

  const startOfToday = new Date(nowMs);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();
  const sevenDaysAgoMs = nowMs - 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgoMs = nowMs - 30 * 24 * 60 * 60 * 1000;

  const customFromMs = criteria.dateFrom ? Date.parse(`${criteria.dateFrom}T00:00:00`) : NaN;
  const customToMs = criteria.dateTo ? Date.parse(`${criteria.dateTo}T23:59:59.999`) : NaN;

  return movements.filter((mov) => {
    const prod = productById.get(String(mov.product_id));
    const effectiveDepot = (mov.depot_name || prod?.store_name || '').trim();

    if (effectiveDepot && closedSet.has(effectiveDepot.toLowerCase())) {
      return false;
    }

    if (currentUser && effectiveDepot && !isUserAllowedForDepot(currentUser, effectiveDepot)) {
      return false;
    }

    const movType = (mov.movement_type || mov.type || 'OUT').toUpperCase();
    if (typeFilter !== 'ALL' && movType !== typeFilter) {
      return false;
    }

    if (depotFilter !== 'ALL') {
      if (effectiveDepot.toLowerCase() !== depotFilter.toLowerCase()) {
        return false;
      }
    }

    if (userOrDept && userOrDept !== 'all') {
      const uName = (mov.user_name || '').toLowerCase();
      const dName = (mov.department_name || mov.department || '').toLowerCase();
      if (!uName.includes(userOrDept) && !dName.includes(userOrDept)) {
        return false;
      }
    }

    const ts = Date.parse(mov.created_at || '');
    if (!Number.isNaN(ts)) {
      if (period === 'TODAY' && ts < startOfTodayMs) return false;
      if (period === '7D' && ts < sevenDaysAgoMs) return false;
      if (period === '30D' && ts < thirtyDaysAgoMs) return false;
      if (period === 'CUSTOM') {
        if (!Number.isNaN(customFromMs) && ts < customFromMs) return false;
        if (!Number.isNaN(customToMs) && ts > customToMs) return false;
      }
    }

    if (q) {
      const hay = [
        mov.product_ref,
        prod?.reference,
        prod?.brand,
        prod?.model,
        prod?.description,
        mov.user_name,
        mov.department_name,
        mov.site_number,
        mov.order_number,
        mov.reason,
        effectiveDepot,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }

    return true;
  });
}

/**
 * Trie les mouvements de stock selon la colonne et la direction choisies.
 */
export function sortMovementsList(
  movements: StockMovement[],
  field: DesktopMovementSortField,
  direction: 'asc' | 'desc'
): StockMovement[] {
  const dir = direction === 'asc' ? 1 : -1;
  return [...movements].sort((a, b) => {
    switch (field) {
      case 'created_at': {
        const ta = Date.parse(a.created_at || '') || 0;
        const tb = Date.parse(b.created_at || '') || 0;
        return (ta - tb) * dir;
      }
      case 'quantity_changed': {
        const qa = Number(a.quantity_changed ?? a.quantity ?? 0);
        const qb = Number(b.quantity_changed ?? b.quantity ?? 0);
        return (qa - qb) * dir;
      }
      case 'movement_type':
        return String(a.movement_type || '').localeCompare(String(b.movement_type || '')) * dir;
      case 'product_ref':
        return String(a.product_ref || '').localeCompare(String(b.product_ref || ''), undefined, {
          numeric: true,
          sensitivity: 'base',
        }) * dir;
      case 'depot_name':
        return String(a.depot_name || '').localeCompare(String(b.depot_name || ''), undefined, {
          sensitivity: 'base',
        }) * dir;
      case 'user_name':
        return String(a.user_name || '').localeCompare(String(b.user_name || ''), undefined, {
          sensitivity: 'base',
        }) * dir;
      case 'site_number':
        return String(a.site_number || a.order_number || '').localeCompare(
          String(b.site_number || b.order_number || ''),
          undefined,
          { numeric: true, sensitivity: 'base' }
        ) * dir;
      default:
        return 0;
    }
  });
}

/**
 * Génère le contenu CSV des mouvements filtrés en protégeant contre l'injection de formules tableur.
 */
export function buildMovementsCsvContent(
  movements: StockMovement[],
  products: Product[],
  options: { canViewPrices?: boolean } = {}
): string {
  const productById = new Map<string, Product>();
  for (const p of products || []) {
    productById.set(String(p.id), p);
  }

  const headers = [
    'Date',
    'Type',
    'Référence',
    'Article',
    'Quantité',
    'Dépôt',
    'Utilisateur',
    'Département',
    'Chantier / Commande',
    ...(options.canViewPrices ? ['Coût Total'] : []),
  ];

  const rows = movements.map((m) => {
    const prod = productById.get(String(m.product_id));
    const dateStr = m.created_at ? new Date(m.created_at).toISOString() : '';
    const ref = m.product_ref || prod?.reference || '';
    const name = prod ? `${prod.brand || ''} ${prod.model || ''}`.trim() : '';
    const qty = Number(m.quantity_changed ?? m.quantity ?? 0);
    const depot = m.depot_name || prod?.store_name || '';
    const siteOrOrder = [m.site_number, m.order_number].filter(Boolean).join(' / ');
    const baseCols = [
      sanitizeCsvCell(dateStr),
      sanitizeCsvCell(m.movement_type || m.type || ''),
      sanitizeCsvCell(ref),
      sanitizeCsvCell(name),
      sanitizeCsvCell(String(qty)),
      sanitizeCsvCell(depot),
      sanitizeCsvCell(m.user_name || ''),
      sanitizeCsvCell(m.department_name || m.department || ''),
      sanitizeCsvCell(siteOrOrder),
    ];
    if (options.canViewPrices) {
      baseCols.push(sanitizeCsvCell(String(Number(m.total_cost || 0).toFixed(2))));
    }
    return baseCols.join(';');
  });

  return '\uFEFF' + [headers.join(';'), ...rows].join('\r\n');
}

/**
 * Filtre les commandes de matériel par statut, dépôt et recherche.
 */
export function filterOrdersByStatusAndSearch(
  orders: MaterialOrder[],
  currentUser: User | null | undefined,
  options: {
    statusFilter?: 'ALL' | OrderStatus;
    depotFilter?: string;
    searchQuery?: string;
    canViewAllOrders?: boolean;
  } = {}
): MaterialOrder[] {
  if (!Array.isArray(orders)) return [];
  const statusFilter = options.statusFilter || 'ALL';
  const depotFilter = (options.depotFilter || 'ALL').trim();
  const q = (options.searchQuery || '').trim().toLowerCase();
  const canViewAll = options.canViewAllOrders ?? true;

  const isAdmin =
    currentUser &&
    (Number(currentUser.id) === 0 ||
      Number(currentUser.role_id) === 0 ||
      Number(currentUser.role_id) === 1);

  return orders
    .filter((order) => {
      if (
        currentUser &&
        !isAdmin &&
        order.depot_name &&
        !isUserAllowedForDepot(currentUser, order.depot_name)
      ) {
        return false;
      }

      if (
        currentUser &&
        !isAdmin &&
        !canViewAll &&
        String(order.requester_id) !== String(currentUser.id) &&
        String(order.pickup_delegate_id || '') !== String(currentUser.id)
      ) {
        return false;
      }

      if (statusFilter !== 'ALL' && order.status !== statusFilter) {
        return false;
      }

      if (depotFilter !== 'ALL') {
        if ((order.depot_name || '').trim().toLowerCase() !== depotFilter.toLowerCase()) {
          return false;
        }
      }

      if (q) {
        const itemsText = (order.items || [])
          .map((it) => `${it.product_ref || ''} ${it.product_name || ''}`)
          .join(' ');
        const hay = [
          order.order_number,
          order.site_number,
          order.site_name,
          order.requester_name,
          order.requester_department,
          order.depot_name,
          order.preparer_name,
          order.pickup_zone,
          order.notes,
          itemsText,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    })
    .sort((a, b) => {
      const ta = Date.parse(a.created_at || '') || 0;
      const tb = Date.parse(b.created_at || '') || 0;
      return tb - ta;
    });
}

/**
 * Vérifie si l'utilisateur courant peut approuver ou refuser une commande en attente d'approbation.
 */
export function canUserApproveOrRejectOrder(
  order: MaterialOrder | null | undefined,
  currentUser: User | null | undefined,
  departments: Department[],
  hasManageOrdersPerm: boolean
): boolean {
  if (!order || !currentUser || order.status !== 'WAITING_APPROVAL') return false;
  if (
    Number(currentUser.id) === 0 ||
    Number(currentUser.role_id) === 0 ||
    Number(currentUser.role_id) === 1 ||
    hasManageOrdersPerm
  ) {
    return true;
  }

  const reqDept = (order.requester_department || '').trim().toLowerCase();
  if (!reqDept) return false;
  const dept = (departments || []).find((d) => (d.name || '').trim().toLowerCase() === reqDept);
  if (!dept) return false;

  if (dept.manager_id !== undefined && String(dept.manager_id) === String(currentUser.id)) {
    return true;
  }
  if (
    Array.isArray(dept.deputy_manager_ids) &&
    dept.deputy_manager_ids.some((id) => String(id) === String(currentUser.id))
  ) {
    return true;
  }
  return false;
}

/**
 * Détermine le statut visuel d'une ligne de commande en préparation.
 */
export type PickingLineVisualStatus = 'todo' | 'picked' | 'partial' | 'missing' | 'replaced';

export function getPickingLineVisualStatus(item: MaterialOrderItem): PickingLineVisualStatus {
  if (item.unavailable) return 'missing';
  if (item.substituted && item.picked) return 'replaced';
  if (item.picked) {
    const req = Math.max(0, Number(item.quantity) || 0);
    const picked =
      item.picked_quantity !== undefined ? Math.max(0, Number(item.picked_quantity) || 0) : req;
    if (picked > 0 && picked < req) return 'partial';
    return 'picked';
  }
  return 'todo';
}
