import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  Department,
  MaterialOrder,
  OrderStatus,
  Product,
  Project,
  Role,
  StockMovement,
  User,
} from '../types';
import { Language } from '../i18n/translations';
import { tr } from '../i18n/dutchTranslator';
import { formatCurrency, formatDate } from '../utils/crypto';
import {
  getMovementDestDepot,
  getMovementSourceDepot,
  isTransferMovement,
} from './stockMovementService';
import { getClientSupabase } from './clientSupabase';
import { logAuditEventServer } from './auditService';
import { getResolvedEdgeFunctionName } from '../constants/edgeFunctions';
import { extractEdgeFunctionError } from './mailingService';
import {
  formatOrderPickupTransferSummary,
  isOrderPickupTransferred,
} from './orderTraceabilityService';
import { safeGetSensitiveItem } from './localCrypto';

export const DEFAULT_LOCAL_WINDOW_DAYS = 7;
export const DEFAULT_SEARCH_PAGE_SIZE = 50;
export const MAX_REPORT_ATTACHMENT_BYTES = 3 * 1024 * 1024; // 3 Mo (limite Microsoft Graph)
export const MAX_REPORT_ATTACHMENT_TOTAL_BYTES = MAX_REPORT_ATTACHMENT_BYTES;

export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = [
  'WAITING_APPROVAL',
  'PENDING',
  'PREPARING',
  'READY',
] as const;

export type SearchPeriodPreset = '7D' | '30D' | 'CUSTOM' | 'ALL';
export type ReportPeriodPreset = SearchPeriodPreset;
export type MovementTypeFilter = 'ALL' | 'IN' | 'OUT' | 'TRANSFER';
export type ReportKindId =
  | 'ORDERS'
  | 'MOVEMENTS'
  | 'WEEKLY_RECAP'
  | 'LOW_STOCK'
  | 'OUT_OF_STOCK'
  | 'DEPT_PROJECTS';

export interface OrderSearchFilters {
  period?: SearchPeriodPreset;
  periodPreset: SearchPeriodPreset;
  fromDate: string;
  toDate: string;
  statuses: OrderStatus[];
  preparer: string;
  requester: string;
  department: string;
  site: string;
  depot: string;
  reference: string;
  minCost: string;
  maxCost: string;
  text: string;
  collector?: string;
  pickupTransferred?: 'ALL' | 'YES' | 'NO';
}

export interface MovementSearchFilters {
  period?: SearchPeriodPreset;
  periodPreset: SearchPeriodPreset;
  fromDate: string;
  toDate: string;
  type: MovementTypeFilter;
  user: string;
  department: string;
  site: string;
  depot: string;
  reference: string;
  orderNumber: string;
  minCost: string;
  maxCost: string;
  text: string;
}

function resolvePeriodPreset(
  f?: { period?: SearchPeriodPreset; periodPreset?: SearchPeriodPreset } | null
): SearchPeriodPreset {
  if (!f) return '7D';
  // If `period` was explicitly mutated by UI to something other than '7D', or if `periodPreset` is '7D'
  if (f.period && f.period !== '7D') return f.period;
  if (f.periodPreset && f.periodPreset !== '7D') return f.periodPreset;
  return f.period || f.periodPreset || '7D';
}

export function createDefaultOrderSearchFilters(defaultDepot = 'ALL'): OrderSearchFilters {
  return {
    period: '7D',
    periodPreset: '7D',
    fromDate: '',
    toDate: '',
    statuses: [],
    preparer: '',
    requester: '',
    department: 'ALL',
    site: '',
    depot: defaultDepot || 'ALL',
    reference: '',
    minCost: '',
    maxCost: '',
    text: '',
  };
}

export function createDefaultMovementSearchFilters(defaultDepot = 'ALL'): MovementSearchFilters {
  return {
    period: '7D',
    periodPreset: '7D',
    fromDate: '',
    toDate: '',
    type: 'ALL',
    user: '',
    department: 'ALL',
    site: '',
    depot: defaultDepot || 'ALL',
    reference: '',
    orderNumber: '',
    minCost: '',
    maxCost: '',
    text: '',
  };
}

export function isOrderActiveStatus(status?: string | null): boolean {
  if (!status) return false;
  return (ACTIVE_ORDER_STATUSES as readonly string[]).includes(String(status).trim().toUpperCase());
}

/**
 * Lot 1.1 : Par défaut, n'afficher que les commandes créées depuis 7 jours
 * (+ toujours celles encore actives : WAITING_APPROVAL, PENDING, PREPARING, READY, quel que soit leur âge).
 */
export function filterOrdersDefault7DaysAndActive(
  orders: MaterialOrder[],
  nowMs: number = Date.now()
): MaterialOrder[] {
  const cutoffMs = nowMs - DEFAULT_LOCAL_WINDOW_DAYS * 86_400_000;
  return orders.filter((o) => {
    if (o.notes === '[SUPPRIMÉE]') return false;
    if (isOrderActiveStatus(o.status)) return true;
    const createdMs = new Date(o.created_at).getTime();
    if (Number.isNaN(createdMs)) return true;
    return createdMs >= cutoffMs;
  });
}

/**
 * Lot 2.2 : Par défaut, n'afficher que les mouvements créés depuis 7 jours.
 */
export function filterMovementsDefault7Days(
  movements: StockMovement[],
  nowMs: number = Date.now()
): StockMovement[] {
  const cutoffMs = nowMs - DEFAULT_LOCAL_WINDOW_DAYS * 86_400_000;
  return movements.filter((m) => {
    const createdMs = new Date(m.created_at).getTime();
    if (Number.isNaN(createdMs)) return true;
    return createdMs >= cutoffMs;
  });
}

export function computePeriodBoundsIso(
  periodPreset: SearchPeriodPreset,
  fromDate?: string,
  toDate?: string,
  nowMs: number = Date.now()
): { fromIso: string | null; toIso: string | null } {
  if (periodPreset === 'ALL') {
    return { fromIso: null, toIso: null };
  }
  if (periodPreset === '7D') {
    return {
      fromIso: new Date(nowMs - 7 * 86_400_000).toISOString(),
      toIso: null,
    };
  }
  if (periodPreset === '30D') {
    return {
      fromIso: new Date(nowMs - 30 * 86_400_000).toISOString(),
      toIso: null,
    };
  }
  // CUSTOM
  let fromIso: string | null = null;
  let toIso: string | null = null;
  if (fromDate && fromDate.trim()) {
    const d = new Date(
      fromDate.includes('T') ? fromDate.trim() : `${fromDate.trim()}T00:00:00.000Z`
    );
    if (!Number.isNaN(d.getTime())) {
      fromIso = d.toISOString();
    }
  }
  if (toDate && toDate.trim()) {
    const d = new Date(
      toDate.includes('T') ? toDate.trim() : `${toDate.trim()}T23:59:59.999Z`
    );
    if (!Number.isNaN(d.getTime())) {
      toIso = d.toISOString();
    }
  }
  return { fromIso, toIso };
}

export function hasNonDefaultOrderCriteria(filters: OrderSearchFilters): boolean {
  const preset = resolvePeriodPreset(filters);
  return Boolean(
    preset !== '7D' ||
      filters.fromDate.trim() !== '' ||
      filters.toDate.trim() !== '' ||
      filters.statuses.length > 0 ||
      filters.preparer.trim() !== '' ||
      filters.requester.trim() !== '' ||
      (filters.department && filters.department !== 'ALL') ||
      filters.site.trim() !== '' ||
      filters.reference.trim() !== '' ||
      filters.minCost.trim() !== '' ||
      filters.maxCost.trim() !== '' ||
      filters.text.trim() !== ''
  );
}

export function doesOrderFilterExceedLocalWindow(
  filters: OrderSearchFilters,
  forceServer = false,
  nowMs: number = Date.now()
): boolean {
  if (forceServer) return true;
  const preset = resolvePeriodPreset(filters);
  if (preset === '30D' || preset === 'ALL') {
    return true;
  }
  if (preset === 'CUSTOM') {
    if (!filters.fromDate.trim()) return true;
    const fromMs = new Date(`${filters.fromDate.trim()}T00:00:00.000Z`).getTime();
    if (Number.isNaN(fromMs) || fromMs < nowMs - DEFAULT_LOCAL_WINDOW_DAYS * 86_400_000) {
      return true;
    }
    return true;
  }
  return false;
}

export function doesMovementFilterExceedLocalWindow(
  filters: MovementSearchFilters,
  forceServer = false,
  nowMs: number = Date.now()
): boolean {
  if (forceServer) return true;
  const preset = resolvePeriodPreset(filters);
  if (preset === '30D' || preset === 'ALL') {
    return true;
  }
  if (preset === 'CUSTOM') {
    if (!filters.fromDate.trim()) return true;
    const fromMs = new Date(`${filters.fromDate.trim()}T00:00:00.000Z`).getTime();
    if (Number.isNaN(fromMs) || fromMs < nowMs - DEFAULT_LOCAL_WINDOW_DAYS * 86_400_000) {
      return true;
    }
    return true;
  }
  return false;
}

function parseOptionalNumeric(val: string): number | null {
  const cleaned = String(val ?? '')
    .trim()
    .replace(',', '.');
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

/**
 * Construit les paramètres exacts de la RPC `public.search_material_orders`.
 */
export function buildSearchMaterialOrdersRpcParams(
  filters: OrderSearchFilters,
  limit: number = DEFAULT_SEARCH_PAGE_SIZE,
  offset: number = 0,
  nowMs: number = Date.now()
) {
  const preset = resolvePeriodPreset(filters);
  const { fromIso, toIso } = computePeriodBoundsIso(
    preset,
    filters.fromDate,
    filters.toDate,
    nowMs
  );

  return {
    p_from: fromIso,
    p_to: toIso,
    p_status: filters.statuses.length > 0 ? filters.statuses : null,
    p_preparer: filters.preparer.trim() || null,
    p_requester: filters.requester.trim() || null,
    p_department:
      filters.department && filters.department !== 'ALL' ? filters.department.trim() : null,
    p_site: filters.site.trim() || null,
    p_depot: filters.depot && filters.depot !== 'ALL' ? filters.depot.trim() : null,
    p_reference: filters.reference.trim() || null,
    p_min_cost: parseOptionalNumeric(filters.minCost),
    p_max_cost: parseOptionalNumeric(filters.maxCost),
    p_text: filters.text.trim() || null,
    p_limit: Math.max(1, Math.min(1000, limit)),
    p_offset: Math.max(0, offset),
  };
}

/**
 * Construit les paramètres exacts de la RPC `public.search_stock_movements`.
 */
export function buildSearchStockMovementsRpcParams(
  filters: MovementSearchFilters,
  limit: number = DEFAULT_SEARCH_PAGE_SIZE,
  offset: number = 0,
  nowMs: number = Date.now()
) {
  const preset = resolvePeriodPreset(filters);
  const { fromIso, toIso } = computePeriodBoundsIso(
    preset,
    filters.fromDate,
    filters.toDate,
    nowMs
  );

  return {
    p_type: filters.type && filters.type !== 'ALL' ? filters.type : null,
    p_user: filters.user.trim() || null,
    p_department:
      filters.department && filters.department !== 'ALL' ? filters.department.trim() : null,
    p_site: filters.site.trim() || null,
    p_depot: filters.depot && filters.depot !== 'ALL' ? filters.depot.trim() : null,
    p_reference: filters.reference.trim() || null,
    p_order_number: filters.orderNumber.trim() || null,
    p_min_cost: parseOptionalNumeric(filters.minCost),
    p_max_cost: parseOptionalNumeric(filters.maxCost),
    p_from: fromIso,
    p_to: toIso,
    p_text: filters.text.trim() || null,
    p_limit: Math.max(1, Math.min(1000, limit)),
    p_offset: Math.max(0, offset),
  };
}

/**
 * Filtrage local des commandes (fenêtre 7 j + commandes actives, ou repli hors-ligne).
 */
export function filterOrdersLocally(
  orders: MaterialOrder[],
  filters: OrderSearchFilters,
  productsOrNowMs?: Product[] | number,
  maybeNowMs?: number
): MaterialOrder[] {
  const nowMs =
    typeof productsOrNowMs === 'number'
      ? productsOrNowMs
      : typeof maybeNowMs === 'number'
      ? maybeNowMs
      : Date.now();
  const preset = resolvePeriodPreset(filters);
  const baseList =
    preset === '7D' && !filters.fromDate && !filters.toDate
      ? filterOrdersDefault7DaysAndActive(orders, nowMs)
      : orders.filter((o) => o.notes !== '[SUPPRIMÉE]');

  const { fromIso, toIso } = computePeriodBoundsIso(
    preset,
    filters.fromDate,
    filters.toDate,
    nowMs
  );
  const fromMs = fromIso ? new Date(fromIso).getTime() : null;
  const toMs = toIso ? new Date(toIso).getTime() : null;
  const minCost = parseOptionalNumeric(filters.minCost);
  const maxCost = parseOptionalNumeric(filters.maxCost);

  return baseList.filter((o) => {
    const createdMs = new Date(o.created_at).getTime();
    if (preset !== '7D' || filters.fromDate || filters.toDate) {
      if (fromMs !== null && !Number.isNaN(createdMs) && createdMs < fromMs) return false;
      if (toMs !== null && !Number.isNaN(createdMs) && createdMs > toMs) return false;
    }

    if (filters.statuses.length > 0 && !filters.statuses.includes(o.status)) {
      return false;
    }

    if (filters.depot && filters.depot !== 'ALL') {
      if ((o.depot_name || '').toLowerCase() !== filters.depot.trim().toLowerCase()) {
        return false;
      }
    }

    if (filters.department && filters.department !== 'ALL') {
      if (
        (o.requester_department || '').toLowerCase() !== filters.department.trim().toLowerCase()
      ) {
        return false;
      }
    }

    if (filters.preparer.trim()) {
      const qPrep = filters.preparer.trim().toLowerCase();
      const matchPrep =
        String(o.preparer_id || '').toLowerCase() === qPrep ||
        String(o.preparer_name || '').toLowerCase().includes(qPrep);
      if (!matchPrep) return false;
    }

    if (filters.requester.trim()) {
      const qReq = filters.requester.trim().toLowerCase();
      const matchReq =
        String(o.requester_id || '').toLowerCase() === qReq ||
        String(o.requester_name || '').toLowerCase().includes(qReq);
      if (!matchReq) return false;
    }

    if (filters.collector && filters.collector.trim()) {
      const qCol = filters.collector.trim().toLowerCase();
      const anyOrd = o as Record<string, any>;
      const rawCollectorId = String(o.collected_by ?? anyOrd.collected_by_id ?? '').toLowerCase();
      const matchCol =
        rawCollectorId === qCol ||
        rawCollectorId.includes(qCol) ||
        String(anyOrd.collected_by_name || '').toLowerCase().includes(qCol);
      if (!matchCol) return false;
    }

    if (filters.pickupTransferred === 'YES' && !isOrderPickupTransferred(o)) {
      return false;
    }
    if (filters.pickupTransferred === 'NO' && isOrderPickupTransferred(o)) {
      return false;
    }

    if (filters.site.trim()) {
      const qSite = filters.site.trim().toLowerCase();
      const matchSite =
        (o.site_number || '').toLowerCase().includes(qSite) ||
        (o.site_name || '').toLowerCase().includes(qSite);
      if (!matchSite) return false;
    }

    if (filters.reference.trim()) {
      const qRef = filters.reference.trim().toLowerCase();
      const matchRef = (o.items || []).some(
        (it) =>
          (it.product_ref || '').toLowerCase().includes(qRef) ||
          (it.product_name || '').toLowerCase().includes(qRef) ||
          (it.substituted_with_ref || '').toLowerCase().includes(qRef)
      );
      if (!matchRef) return false;
    }

    const cost = Number(o.total_cost || 0);
    if (minCost !== null && cost < minCost) return false;
    if (maxCost !== null && cost > maxCost) return false;

    if (filters.text.trim()) {
      const qText = filters.text.trim().toLowerCase();
      const hay = [
        o.order_number,
        o.notes,
        o.requester_name,
        o.preparer_name,
        o.requester_department,
        o.site_number,
        o.site_name,
        o.depot_name,
        ...(o.items || []).map((it) => `${it.product_ref} ${it.product_name}`),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(qText)) return false;
    }

    return true;
  });
}

/**
 * Filtrage local des mouvements (fenêtre 7 j par défaut ou repli hors-ligne).
 * Supporte à la fois `(movements, products, filters, nowMs)` et `(movements, filters, products, nowMs)`.
 */
export function filterMovementsLocally(
  movements: StockMovement[],
  productsOrFilters: Product[] | MovementSearchFilters,
  filtersOrProducts?: MovementSearchFilters | Product[],
  nowMs: number = Date.now()
): StockMovement[] {
  const products: Product[] = Array.isArray(productsOrFilters)
    ? productsOrFilters
    : Array.isArray(filtersOrProducts)
    ? filtersOrProducts
    : [];
  const filters: MovementSearchFilters = !Array.isArray(productsOrFilters)
    ? productsOrFilters
    : (filtersOrProducts as MovementSearchFilters);

  const productMap = new Map<string, Product>();
  for (const p of products) {
    productMap.set(String(p.id), p);
  }

  const preset = resolvePeriodPreset(filters);
  const { fromIso, toIso } = computePeriodBoundsIso(
    preset,
    filters.fromDate,
    filters.toDate,
    nowMs
  );
  const fromMs = fromIso ? new Date(fromIso).getTime() : null;
  const toMs = toIso ? new Date(toIso).getTime() : null;
  const minCost = parseOptionalNumeric(filters.minCost);
  const maxCost = parseOptionalNumeric(filters.maxCost);

  return movements.filter((m) => {
    const createdMs = new Date(m.created_at).getTime();
    if (!Number.isNaN(createdMs)) {
      if (fromMs !== null && createdMs < fromMs) return false;
      if (toMs !== null && createdMs > toMs) return false;
    }

    const mType = (m.type || m.movement_type) === 'IN' ? 'IN' : 'OUT';
    const isTrans = isTransferMovement(m);
    if (filters.type === 'TRANSFER') {
      if (!isTrans) return false;
    } else if (filters.type === 'IN' || filters.type === 'OUT') {
      if (mType !== filters.type) return false;
    }

    const prod = productMap.get(String(m.product_id));
    const mDepot = m.depot_name || prod?.store_name || '';
    const dstDepot = getMovementDestDepot(m);

    if (filters.depot && filters.depot !== 'ALL') {
      const targetDepot = filters.depot.trim().toLowerCase();
      if (
        mDepot.toLowerCase() !== targetDepot &&
        (dstDepot || '').toLowerCase() !== targetDepot
      ) {
        return false;
      }
    }

    const dept = m.department || m.department_name || '';
    if (filters.department && filters.department !== 'ALL') {
      if (dept.toLowerCase() !== filters.department.trim().toLowerCase()) {
        return false;
      }
    }

    if (filters.user.trim()) {
      const qUser = filters.user.trim().toLowerCase();
      if (
        String(m.user_id || '').toLowerCase() !== qUser &&
        !(m.user_name || '').toLowerCase().includes(qUser)
      ) {
        return false;
      }
    }

    if (filters.site.trim()) {
      const qSite = filters.site.trim().toLowerCase();
      if (!(m.site_number || '').toLowerCase().includes(qSite)) {
        return false;
      }
    }

    if (filters.reference.trim()) {
      const qRef = filters.reference.trim().toLowerCase();
      const refStr = `${m.product_ref || ''} ${prod?.reference || ''} ${prod?.brand || ''} ${prod?.model || ''}`.toLowerCase();
      if (!refStr.includes(qRef)) return false;
    }

    if (filters.orderNumber.trim()) {
      const qOrd = filters.orderNumber.trim().toLowerCase();
      if (!(m.order_number || '').toLowerCase().includes(qOrd)) {
        return false;
      }
    }

    const qty = Number(m.quantity ?? m.quantity_changed ?? 0);
    const cost =
      m.total_cost != null ? Number(m.total_cost) : qty * Number(prod?.unit_price || 0);
    if (minCost !== null && cost < minCost) return false;
    if (maxCost !== null && cost > maxCost) return false;

    if (filters.text.trim()) {
      const qText = filters.text.trim().toLowerCase();
      const hay = [
        m.product_ref,
        prod?.reference,
        prod?.brand,
        prod?.model,
        m.user_name,
        dept,
        m.site_number,
        m.order_number,
        m.reason,
        mDepot,
        dstDepot,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(qText)) return false;
    }

    return true;
  });
}

// =========================================================================
// LOT 3 — GÉNÉRATEURS DE RAPPORTS PARTAGÉS, EXPORT CSV/PDF & ENVOI E-MAIL
// =========================================================================

export type ReportTypeId =
  | 'weekly_recap'
  | 'low_stock'
  | 'out_of_stock'
  | 'department_projects'
  | 'orders'
  | 'movements';

export interface ReportColumnDef {
  key: string;
  label: string;
  header?: string;
  align?: 'left' | 'right' | 'center';
  isNumeric?: boolean;
  isCurrency?: boolean;
}

export interface GeneratedReportData {
  type: ReportTypeId;
  title: string;
  subtitle: string;
  subject: string;
  defaultRecipient: string;
  generatedAtIso: string;
  companyName: string;
  appliedFiltersSummary: string[];
  columns: ReportColumnDef[];
  rows: Array<Record<string, string | number | null | undefined>>;
  totals: Array<{ label: string; value: string }>;
  htmlContent: string;
}

export type GeneratedReportPayload = GeneratedReportData;

export interface ReportContextData {
  language: Language;
  currentUser?: User | null;
  companyName?: string;
  products: Product[];
  movements: StockMovement[];
  orders: MaterialOrder[];
  departments: Department[];
  projects: Project[];
  users: User[];
  roles: Role[];
  canViewPrices?: boolean;
}

function escapeHtml(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function withHeaderAlias(columns: ReportColumnDef[]): ReportColumnDef[] {
  return columns.map((c) => ({
    ...c,
    header: c.header || c.label,
  }));
}

function buildHtmlReportTable(
  title: string,
  accentColor: string,
  introText: string,
  appliedFiltersSummary: string[],
  columns: ReportColumnDef[],
  rows: Array<Record<string, string | number | null | undefined>>,
  totals: Array<{ label: string; value: string }>,
  language: Language
): string {
  const filtersHtml =
    appliedFiltersSummary.length > 0
      ? `<div style="margin:10px 0;padding:8px 12px;background:#f8fafc;border-radius:8px;font-size:12px;color:#475569;">
          <strong>${escapeHtml(tr(language, 'Filtres appliqués :', 'Applied filters:', 'Toegepaste filters:'))}</strong>
          ${appliedFiltersSummary.map((f) => escapeHtml(f)).join(' • ')}
        </div>`
      : '';

  const ths = columns
    .map(
      (c) =>
        `<th style="padding:8px;border:1px solid #cbd5e1;text-align:${c.align || 'left'};">${escapeHtml(c.label)}</th>`
    )
    .join('');

  const trs =
    rows.length > 0
      ? rows
          .slice(0, 250)
          .map((row) => {
            const tds = columns
              .map((c) => {
                const rawVal = row[c.key];
                const formatted =
                  c.isCurrency && typeof rawVal === 'number'
                    ? formatCurrency(rawVal)
                    : rawVal ?? '';
                return `<td style="padding:7px 8px;border:1px solid #cbd5e1;text-align:${c.align || 'left'};">${escapeHtml(formatted)}</td>`;
              })
              .join('');
            return `<tr>${tds}</tr>`;
          })
          .join('')
      : `<tr><td colspan="${columns.length}" style="padding:12px;text-align:center;color:#64748b;">${escapeHtml(
          tr(language, 'Aucune donnée pour cette sélection.', 'No data for this selection.', 'Geen gegevens voor deze selectie.')
        )}</td></tr>`;

  const totalsHtml =
    totals.length > 0
      ? `<div style="margin-top:14px;padding:10px 12px;background:#f1f5f9;border-radius:8px;font-size:12px;">
          ${totals
            .map(
              (t) =>
                `<span style="margin-right:16px;"><strong>${escapeHtml(t.label)} :</strong> ${escapeHtml(t.value)}</span>`
            )
            .join('')}
        </div>`
      : '';

  return `
    <div style="font-family:Arial,sans-serif;color:#0f172a;max-width:760px;margin:0 auto;border:1px solid #cbd5e1;border-radius:12px;padding:20px;">
      <h2 style="color:${accentColor};margin-top:0;">${escapeHtml(title)}</h2>
      <p style="font-size:13px;color:#334155;">${escapeHtml(introText)}</p>
      ${filtersHtml}
      <table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:12px;">
        <thead>
          <tr style="background:#f8fafc;">${ths}</tr>
        </thead>
        <tbody>${trs}</tbody>
      </table>
      ${totalsHtml}
      <p style="font-size:11px;color:#64748b;margin-top:18px;">${escapeHtml(
        tr(
          language,
          'Généré automatiquement par TOT Stock.',
          'Generated automatically by TOT Stock.',
          'Automatisch gegenereerd door TOT Stock.'
        )
      )}</p>
    </div>
  `;
}

/**
 * 1. Récapitulatif hebdomadaire des sorties de l'utilisateur
 */
export function buildWeeklyUserRecapReport(
  ctxOrUser: ReportContextData | User | null | undefined,
  maybeMovements?: StockMovement[],
  maybeProducts?: Product[],
  maybeLanguage?: Language
): GeneratedReportData {
  const isCtx =
    ctxOrUser &&
    typeof ctxOrUser === 'object' &&
    'movements' in ctxOrUser &&
    Array.isArray((ctxOrUser as ReportContextData).movements);

  const language: Language = isCtx
    ? (ctxOrUser as ReportContextData).language
    : maybeLanguage || 'fr';
  const currentUser: User | null | undefined = isCtx
    ? (ctxOrUser as ReportContextData).currentUser
    : (ctxOrUser as User | null | undefined);
  const movements: StockMovement[] = isCtx
    ? (ctxOrUser as ReportContextData).movements
    : maybeMovements || [];
  const companyName: string = isCtx
    ? (ctxOrUser as ReportContextData).companyName || 'TOT Stock'
    : 'TOT Stock';

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);

  const userOuts = movements.filter((m) => {
    if (currentUser && String(m.user_id) !== String(currentUser.id)) return false;
    if ((m.type || m.movement_type) !== 'OUT') return false;
    if (!m.created_at) return false;
    return new Date(m.created_at) >= sevenDaysAgo;
  });

  const columns = withHeaderAlias([
    { key: 'date', label: tr(language, 'Date', 'Date', 'Datum') },
    { key: 'reference', label: tr(language, 'Référence', 'Reference', 'Referentie') },
    {
      key: 'quantity',
      label: tr(language, 'Quantité', 'Quantity', 'Aantal'),
      align: 'right',
      isNumeric: true,
    },
    { key: 'site', label: tr(language, 'Chantier', 'Site / Project', 'Werf') },
    { key: 'depot', label: tr(language, 'Dépôt', 'Depot', 'Depot') },
  ]);

  let totalQty = 0;
  const rows = userOuts.map((m) => {
    const qty = Number(m.quantity ?? m.quantity_changed ?? 0);
    totalQty += qty;
    return {
      date: formatDate(m.created_at),
      reference: m.product_ref || '',
      quantity: -qty,
      site: m.site_number || 'N/A',
      depot: m.depot_name || '—',
    };
  });

  const title = tr(
    language,
    'Récapitulatif Hebdomadaire des Sorties',
    'Weekly Outflow Summary',
    'Wekelijks overzicht uitgiftes'
  );
  const intro = tr(
    language,
    `Bilan des sorties de stock effectuées au cours des 7 derniers jours (${currentUser?.name || 'Utilisateur'}) :`,
    `Summary of stock outflows over the last 7 days (${currentUser?.name || 'User'}):`,
    `Overzicht van voorraaduitgiftes van de afgelopen 7 dagen (${currentUser?.name || 'Gebruiker'}):`
  );
  const totals = [
    {
      label: tr(language, 'Lignes de sortie', 'Outflow lines', 'Uitgifteregels'),
      value: String(rows.length),
    },
    {
      label: tr(language, 'Quantité totale sortie', 'Total outflow quantity', 'Totaal uitgegeven aantal'),
      value: String(totalQty),
    },
  ];
  const appliedFiltersSummary = [
    tr(language, 'Période : 7 derniers jours', 'Period: Last 7 days', 'Periode: Laatste 7 dagen'),
    `${tr(language, 'Opérateur', 'Operator', 'Operator')}: ${currentUser?.name || '—'}`,
  ];

  return {
    type: 'weekly_recap',
    title,
    subtitle: intro,
    subject: tr(
      language,
      '[TOT] Votre récapitulatif hebdomadaire des sorties de stock',
      '[TOT] Your weekly inventory outflow summary',
      '[TOT] Uw wekelijks overzicht van voorraaduitgiftes'
    ),
    defaultRecipient: currentUser?.email || 'utilisateur@entreprise.com',
    generatedAtIso: now.toISOString(),
    companyName,
    appliedFiltersSummary,
    columns,
    rows,
    totals,
    htmlContent: buildHtmlReportTable(
      `📊 ${title}`,
      '#ea580c',
      intro,
      appliedFiltersSummary,
      columns,
      rows,
      totals,
      language
    ),
  };
}

/**
 * 2. Alerte journalière : Stocks faibles
 */
export function buildLowStockReport(
  ctxOrProducts: ReportContextData | Product[],
  depotFilterOrUsers: string | User[] = 'ALL',
  maybeRoles?: Role[],
  maybeCurrentUser?: User | null,
  maybeLanguage?: Language
): GeneratedReportData {
  const isCtx = !Array.isArray(ctxOrProducts);
  const language: Language = isCtx ? ctxOrProducts.language : maybeLanguage || 'fr';
  const products: Product[] = isCtx ? ctxOrProducts.products : ctxOrProducts;
  const users: User[] = isCtx
    ? ctxOrProducts.users
    : Array.isArray(depotFilterOrUsers)
    ? depotFilterOrUsers
    : [];
  const roles: Role[] = isCtx ? ctxOrProducts.roles : maybeRoles || [];
  const currentUser: User | null | undefined = isCtx
    ? ctxOrProducts.currentUser
    : maybeCurrentUser;
  const companyName: string = isCtx ? ctxOrProducts.companyName || 'TOT Stock' : 'TOT Stock';
  const depotFilter: string = typeof depotFilterOrUsers === 'string' ? depotFilterOrUsers : 'ALL';

  const managers = users.filter((u) => {
    const r = roles.find((role) => Number(role.id) === Number(u.role_id));
    return (r?.name.includes('Responsable') || r?.name.includes('Admin')) && u.email;
  });
  const targetEmail =
    managers.length > 0 ? managers[0].email! : currentUser?.email || 'admin@entreprise.com';

  const lowStockItems = products.filter((p) => {
    if (depotFilter !== 'ALL' && p.store_name && p.store_name !== depotFilter) return false;
    return (p.quantity || 0) > 0 && (p.quantity || 0) <= (p.min_stock_alert || 2);
  });

  const columns = withHeaderAlias([
    { key: 'reference', label: tr(language, 'Référence', 'Reference', 'Referentie') },
    { key: 'designation', label: tr(language, 'Produit', 'Product', 'Product') },
    {
      key: 'quantity',
      label: tr(language, 'Stock Actuel', 'Current Stock', 'Huidige voorraad'),
      align: 'right',
      isNumeric: true,
    },
    {
      key: 'min_alert',
      label: tr(language, 'Seuil Min', 'Min Threshold', 'Min. drempel'),
      align: 'right',
      isNumeric: true,
    },
    { key: 'location', label: tr(language, 'Emplacement', 'Location', 'Locatie') },
  ]);

  const rows = lowStockItems.map((p) => ({
    reference: p.reference || '',
    designation: `${p.brand || ''} ${p.model || ''}`.trim(),
    quantity: Number(p.quantity || 0),
    min_alert: Number(p.min_stock_alert ?? 2),
    location: `${p.store_name || '—'}${p.shelf_name ? ` > ${p.shelf_name}` : ''}`,
  }));

  const title = tr(
    language,
    `Alerte Journalière : Stocks Faibles (${lowStockItems.length})`,
    `Daily Alert: Low Stock (${lowStockItems.length})`,
    `Dagelijkse melding: Lage voorraad (${lowStockItems.length})`
  );
  const intro = tr(
    language,
    "Les références suivantes ont franchi leur seuil d'alerte critique :",
    'The following items have reached or breached their critical low threshold:',
    'De volgende artikelen hebben hun kritieke minimumdrempel bereikt:'
  );
  const appliedFiltersSummary = [
    `${tr(language, 'Dépôt', 'Depot', 'Depot')}: ${
      depotFilter === 'ALL' ? tr(language, 'Tous', 'All', 'Alle') : depotFilter
    }`,
  ];
  const totals = [
    {
      label: tr(language, 'Articles en stock faible', 'Low stock items', 'Artikelen met lage voorraad'),
      value: String(rows.length),
    },
  ];

  return {
    type: 'low_stock',
    title,
    subtitle: intro,
    subject: tr(
      language,
      '[TOT Alerte] Produits en stock critique à réapprovisionner',
      '[TOT Alert] Critical low stock items to restock',
      '[TOT Melding] Kritieke voorraadartikelen om aan te vullen'
    ),
    defaultRecipient: targetEmail,
    generatedAtIso: new Date().toISOString(),
    companyName,
    appliedFiltersSummary,
    columns,
    rows,
    totals,
    htmlContent: buildHtmlReportTable(
      `⚠️ ${title}`,
      '#d97706',
      intro,
      appliedFiltersSummary,
      columns,
      rows,
      totals,
      language
    ),
  };
}

/**
 * 3. Alerte urgente : Ruptures totales de stock
 */
export function buildOutOfStockReport(
  ctxOrProducts: ReportContextData | Product[],
  depotFilterOrCurrentUser: string | User | null | undefined = 'ALL',
  maybeLanguage?: Language
): GeneratedReportData {
  const isCtx = !Array.isArray(ctxOrProducts);
  const language: Language = isCtx ? ctxOrProducts.language : maybeLanguage || 'fr';
  const products: Product[] = isCtx ? ctxOrProducts.products : ctxOrProducts;
  const currentUser: User | null | undefined = isCtx
    ? ctxOrProducts.currentUser
    : typeof depotFilterOrCurrentUser === 'object'
    ? depotFilterOrCurrentUser
    : undefined;
  const companyName: string = isCtx ? ctxOrProducts.companyName || 'TOT Stock' : 'TOT Stock';
  const depotFilter: string =
    typeof depotFilterOrCurrentUser === 'string' ? depotFilterOrCurrentUser : 'ALL';

  const targetEmail = currentUser?.email || 'responsable.stock@entreprise.com';
  const outItems = products.filter((p) => {
    if (depotFilter !== 'ALL' && p.store_name && p.store_name !== depotFilter) return false;
    return (p.quantity || 0) === 0;
  });

  const columns = withHeaderAlias([
    { key: 'reference', label: tr(language, 'Référence', 'Reference', 'Referentie') },
    { key: 'designation', label: tr(language, 'Produit', 'Product', 'Product') },
    { key: 'status', label: tr(language, 'Statut', 'Status', 'Status') },
    { key: 'depot', label: tr(language, 'Dépôt', 'Depot', 'Depot') },
    { key: 'supplier', label: tr(language, 'Fournisseur habituel', 'Supplier', 'Leverancier') },
  ]);

  const rows = outItems.map((p) => ({
    reference: p.reference || '',
    designation: `${p.brand || ''} ${p.model || ''}`.trim(),
    status: `0 (${tr(language, 'RUPTURE', 'OUT', 'UITVERKOCHT')})`,
    depot: p.store_name || '—',
    supplier: p.supplier_1_name || 'N/A',
  }));

  const title = tr(
    language,
    `Alerte Urgente : Ruptures Totales de Stock (${outItems.length})`,
    `Urgent Alert: Out of Stock (${outItems.length})`,
    `Urgente melding: Voorraadtekorten (${outItems.length})`
  );
  const intro = tr(
    language,
    'Les articles ci-dessous sont actuellement épuisés en rayon :',
    'The following items are currently out of stock:',
    'Onderstaande artikelen zijn momenteel niet op voorraad:'
  );
  const appliedFiltersSummary = [
    `${tr(language, 'Dépôt', 'Depot', 'Depot')}: ${
      depotFilter === 'ALL' ? tr(language, 'Tous', 'All', 'Alle') : depotFilter
    }`,
  ];
  const totals = [
    {
      label: tr(language, 'Articles en rupture', 'Out-of-stock items', 'Artikelen zonder voorraad'),
      value: String(rows.length),
    },
  ];

  return {
    type: 'out_of_stock',
    title,
    subtitle: intro,
    subject: tr(
      language,
      '[TOT URGENT] Alerte ruptures de stock immédiates',
      '[TOT URGENT] Immediate out-of-stock alert',
      '[TOT URGENT] Onmiddellijke melding voorraadtekort'
    ),
    defaultRecipient: targetEmail,
    generatedAtIso: new Date().toISOString(),
    companyName,
    appliedFiltersSummary,
    columns,
    rows,
    totals,
    htmlContent: buildHtmlReportTable(
      `🚨 ${title}`,
      '#ef4444',
      intro,
      appliedFiltersSummary,
      columns,
      rows,
      totals,
      language
    ),
  };
}

/**
 * 4. Bilan Projets & Chantiers par Département
 */
export function buildDepartmentProjectsReport(
  ctxOrUser: ReportContextData | User | null | undefined,
  deptOverrideOrDepts?: string | Department[],
  maybeProjects?: Project[],
  maybeMovements?: StockMovement[],
  _maybeProducts?: Product[],
  maybeLanguage?: Language
): GeneratedReportData {
  const isCtx =
    ctxOrUser &&
    typeof ctxOrUser === 'object' &&
    'departments' in ctxOrUser &&
    Array.isArray((ctxOrUser as ReportContextData).departments);

  const language: Language = isCtx
    ? (ctxOrUser as ReportContextData).language
    : maybeLanguage || 'fr';
  const currentUser: User | null | undefined = isCtx
    ? (ctxOrUser as ReportContextData).currentUser
    : (ctxOrUser as User | null | undefined);
  const departments: Department[] = isCtx
    ? (ctxOrUser as ReportContextData).departments
    : Array.isArray(deptOverrideOrDepts)
    ? deptOverrideOrDepts
    : [];
  const projects: Project[] = isCtx
    ? (ctxOrUser as ReportContextData).projects
    : maybeProjects || [];
  const movements: StockMovement[] = isCtx
    ? (ctxOrUser as ReportContextData).movements
    : maybeMovements || [];
  const companyName: string = isCtx
    ? (ctxOrUser as ReportContextData).companyName || 'TOT Stock'
    : 'TOT Stock';
  const departmentOverride: string | undefined =
    typeof deptOverrideOrDepts === 'string' ? deptOverrideOrDepts : undefined;

  const userDep =
    departmentOverride && departmentOverride !== 'ALL'
      ? departmentOverride
      : currentUser?.department || departments[0]?.name || 'Général';

  const depProjects = projects.filter((p) => {
    const d = departments.find((dept) => dept.id === p.department_id);
    return d?.name.toLowerCase() === userDep.toLowerCase();
  });

  const projectNumbers = depProjects.map((p) => p.project_number.toLowerCase());
  const projMovements = movements.filter(
    (m) =>
      (m.site_number && projectNumbers.includes(m.site_number.toLowerCase())) ||
      (m.department || m.department_name || '').toLowerCase() === userDep.toLowerCase()
  );

  const columns = withHeaderAlias([
    { key: 'date', label: tr(language, 'Date', 'Date', 'Datum') },
    { key: 'type', label: tr(language, 'Sens', 'Type', 'Type') },
    { key: 'project', label: tr(language, 'Projet / Chantier', 'Project / Site', 'Project / Werf') },
    { key: 'reference', label: tr(language, 'Référence', 'Reference', 'Referentie') },
    {
      key: 'quantity',
      label: tr(language, 'Quantité', 'Quantity', 'Aantal'),
      align: 'right',
      isNumeric: true,
    },
  ]);

  const rows = projMovements.map((m) => {
    const isOut = (m.type || m.movement_type) === 'OUT';
    const qty = Number(m.quantity ?? m.quantity_changed ?? 0);
    return {
      date: formatDate(m.created_at),
      type: isOut
        ? tr(language, 'SORTIE', 'OUT', 'UIT')
        : tr(language, 'ENTRÉE', 'IN', 'IN'),
      project: m.site_number || '—',
      reference: m.product_ref || '',
      quantity: isOut ? -qty : qty,
    };
  });

  const title = tr(
    language,
    `Bilan Projets & Chantiers - Département ${userDep}`,
    `Site Projects Summary - Department ${userDep}`,
    `Projectoverzicht - Afdeling ${userDep}`
  );
  const intro = tr(
    language,
    'Synthèse des flux récents sur les chantiers rattachés au département :',
    'Recent movement summary for projects linked to the department:',
    'Overzicht van recente bewegingen op werven gekoppeld aan de afdeling:'
  );
  const appliedFiltersSummary = [
    `${tr(language, 'Département', 'Department', 'Afdeling')}: ${userDep}`,
  ];
  const totals = [
    {
      label: tr(language, 'Mouvements chantiers', 'Site movements', 'Werfbewegingen'),
      value: String(rows.length),
    },
  ];

  return {
    type: 'department_projects',
    title,
    subtitle: intro,
    subject: tr(
      language,
      `[TOT] Flux projets récents - Département ${userDep}`,
      `[TOT] Recent project flows - Department ${userDep}`,
      `[TOT] Recente projectstromen - Afdeling ${userDep}`
    ),
    defaultRecipient: currentUser?.email || 'responsable.departement@entreprise.com',
    generatedAtIso: new Date().toISOString(),
    companyName,
    appliedFiltersSummary,
    columns,
    rows,
    totals,
    htmlContent: buildHtmlReportTable(
      `🏢 ${title}`,
      '#0284c7',
      intro,
      appliedFiltersSummary,
      columns,
      rows,
      totals,
      language
    ),
  };
}

/**
 * 5. Nouveau rapport Lot 3.2 : Rapport Commandes (sur une période + filtres du Lot 1)
 */
export function buildOrdersReport(
  orders: MaterialOrder[],
  filters: OrderSearchFilters,
  ctxOrCanViewPrices: ReportContextData | boolean = true,
  maybeCurrentUser?: User | null,
  maybeLanguage?: Language
): GeneratedReportData {
  const isCtx = typeof ctxOrCanViewPrices === 'object' && ctxOrCanViewPrices !== null;
  const language: Language = isCtx ? ctxOrCanViewPrices.language : maybeLanguage || 'fr';
  const currentUser: User | null | undefined = isCtx
    ? ctxOrCanViewPrices.currentUser
    : maybeCurrentUser;
  const canViewPrices: boolean = isCtx
    ? ctxOrCanViewPrices.canViewPrices ?? true
    : Boolean(ctxOrCanViewPrices);
  const companyName: string = isCtx ? ctxOrCanViewPrices.companyName || 'TOT Stock' : 'TOT Stock';

  const columns = withHeaderAlias([
    { key: 'created_at', label: tr(language, 'Date', 'Date', 'Datum') },
    { key: 'order_number', label: tr(language, 'N° Commande', 'Order #', 'Bestelnr.') },
    { key: 'status', label: tr(language, 'Statut', 'Status', 'Status') },
    { key: 'requester', label: tr(language, 'Demandeur', 'Requester', 'Aanvrager') },
    { key: 'preparer', label: tr(language, 'Préparateur', 'Preparer', 'Orderpicker') },
    { key: 'collector', label: tr(language, 'Enleveur', 'Collector', 'Afhaler') },
    {
      key: 'pickup_transferred',
      label: tr(language, 'Retrait transféré', 'Pickup transferred', 'Afhaling overgedragen'),
    },
    { key: 'department', label: tr(language, 'Département', 'Department', 'Afdeling') },
    { key: 'site', label: tr(language, 'Chantier', 'Job site', 'Werf') },
    { key: 'depot', label: tr(language, 'Dépôt', 'Depot', 'Depot') },
    {
      key: 'lines_count',
      label: tr(language, 'Lignes', 'Lines', 'Regels'),
      align: 'right',
      isNumeric: true,
    },
    ...(canViewPrices
      ? [
          {
            key: 'total_cost',
            label: tr(language, 'Montant HT', 'Net Amount', 'Bedrag excl. btw'),
            align: 'right' as const,
            isNumeric: true,
            isCurrency: true,
          },
        ]
      : []),
  ]);

  let sumCost = 0;
  let sumLines = 0;
  const rows = orders.map((o) => {
    const cost = Number(o.total_cost || 0);
    const linesCount = Array.isArray(o.items) ? o.items.length : 0;
    sumCost += cost;
    sumLines += linesCount;
    const anyOrd = o as Record<string, any>;
    const rawCollector =
      anyOrd.collected_by_name ||
      (o.collected_by !== undefined && o.collected_by !== null
        ? String(o.collected_by)
        : anyOrd.collected_by_id !== undefined && anyOrd.collected_by_id !== null
        ? String(anyOrd.collected_by_id)
        : '—');
    return {
      created_at: formatDate(o.created_at),
      order_number: o.order_number || '',
      status: o.status || '',
      requester: o.requester_name || '',
      preparer: o.preparer_name || '—',
      collector: rawCollector || '—',
      pickup_transferred: formatOrderPickupTransferSummary(o, language),
      department: o.requester_department || '—',
      site: o.site_number || '—',
      depot: o.depot_name || '—',
      lines_count: linesCount,
      ...(canViewPrices ? { total_cost: Number(cost.toFixed(2)) } : {}),
    };
  });

  const preset = resolvePeriodPreset(filters);
  const appliedFiltersSummary: string[] = [
    `${tr(language, 'Période', 'Period', 'Periode')}: ${preset}`,
  ];
  if (filters.fromDate || filters.toDate) {
    appliedFiltersSummary.push(`${filters.fromDate || '…'} → ${filters.toDate || '…'}`);
  }
  if (filters.statuses.length > 0) {
    appliedFiltersSummary.push(
      `${tr(language, 'Statuts', 'Statuses', 'Statussen')}: ${filters.statuses.join(', ')}`
    );
  }
  if (filters.depot && filters.depot !== 'ALL') {
    appliedFiltersSummary.push(`${tr(language, 'Dépôt', 'Depot', 'Depot')}: ${filters.depot}`);
  }
  if (filters.department && filters.department !== 'ALL') {
    appliedFiltersSummary.push(
      `${tr(language, 'Département', 'Department', 'Afdeling')}: ${filters.department}`
    );
  }
  if (filters.site.trim()) {
    appliedFiltersSummary.push(`${tr(language, 'Chantier', 'Site', 'Werf')}: ${filters.site.trim()}`);
  }
  if (filters.requester.trim()) {
    appliedFiltersSummary.push(
      `${tr(language, 'Demandeur', 'Requester', 'Aanvrager')}: ${filters.requester.trim()}`
    );
  }
  if (filters.preparer.trim()) {
    appliedFiltersSummary.push(
      `${tr(language, 'Préparateur', 'Preparer', 'Orderpicker')}: ${filters.preparer.trim()}`
    );
  }
  if (filters.reference.trim()) {
    appliedFiltersSummary.push(
      `${tr(language, 'Référence', 'Reference', 'Referentie')}: ${filters.reference.trim()}`
    );
  }

  const totals = [
    {
      label: tr(language, 'Total commandes', 'Total orders', 'Totaal bestellingen'),
      value: String(orders.length),
    },
    {
      label: tr(language, 'Total lignes articles', 'Total item lines', 'Totaal artikelregels'),
      value: String(sumLines),
    },
    ...(canViewPrices
      ? [
          {
            label: tr(language, 'Montant total HT', 'Total net amount', 'Totaalbedrag excl. btw'),
            value: formatCurrency(sumCost),
          },
        ]
      : []),
  ];

  const title = tr(
    language,
    `Rapport des Commandes Matériel (${orders.length})`,
    `Material Orders Report (${orders.length})`,
    `Rapport Materiaalbestellingen (${orders.length})`
  );
  const intro = tr(
    language,
    'État détaillé des commandes de matériel selon les critères sélectionnés :',
    'Detailed material orders report matching the selected filters:',
    'Gedetailleerd overzicht van materiaalbestellingen volgens de geselecteerde filters:'
  );

  return {
    type: 'orders',
    title,
    subtitle: intro,
    subject: tr(
      language,
      `[TOT Rapport] Commandes de matériel (${orders.length})`,
      `[TOT Report] Material orders (${orders.length})`,
      `[TOT Rapport] Materiaalbestellingen (${orders.length})`
    ),
    defaultRecipient: currentUser?.email || 'logistique@entreprise.com',
    generatedAtIso: new Date().toISOString(),
    companyName,
    appliedFiltersSummary,
    columns,
    rows,
    totals,
    htmlContent: buildHtmlReportTable(
      `📦 ${title}`,
      '#ea580c',
      intro,
      appliedFiltersSummary,
      columns,
      rows,
      totals,
      language
    ),
  };
}

/**
 * 6. Nouveau rapport Lot 3.2 : Rapport Mouvements (sur une période + filtres du Lot 2)
 */
export function buildMovementsReport(
  movements: StockMovement[],
  filtersOrProducts: MovementSearchFilters | Product[],
  ctxOrFilters: ReportContextData | MovementSearchFilters,
  maybeCanViewPrices?: boolean,
  maybeCurrentUser?: User | null,
  maybeLanguage?: Language
): GeneratedReportData {
  const isProductsSecond = Array.isArray(filtersOrProducts);
  const products: Product[] = isProductsSecond
    ? filtersOrProducts
    : (ctxOrFilters as ReportContextData).products || [];
  const filters: MovementSearchFilters = isProductsSecond
    ? (ctxOrFilters as MovementSearchFilters)
    : (filtersOrProducts as MovementSearchFilters);
  const ctx: ReportContextData | null = !isProductsSecond
    ? (ctxOrFilters as ReportContextData)
    : null;

  const language: Language = ctx ? ctx.language : maybeLanguage || 'fr';
  const currentUser: User | null | undefined = ctx ? ctx.currentUser : maybeCurrentUser;
  const canViewPrices: boolean = ctx ? ctx.canViewPrices ?? true : maybeCanViewPrices ?? true;
  const companyName: string = ctx ? ctx.companyName || 'TOT Stock' : 'TOT Stock';

  const prodMap = new Map<string, Product>();
  for (const p of products) {
    prodMap.set(String(p.id), p);
  }

  const columns = withHeaderAlias([
    { key: 'created_at', label: tr(language, 'Date', 'Date', 'Datum') },
    { key: 'type', label: tr(language, 'Type', 'Type', 'Type') },
    { key: 'reference', label: tr(language, 'Référence', 'Reference', 'Referentie') },
    { key: 'designation', label: tr(language, 'Article', 'Item', 'Artikel') },
    {
      key: 'quantity',
      label: tr(language, 'Quantité', 'Quantity', 'Aantal'),
      align: 'right',
      isNumeric: true,
    },
    { key: 'depot', label: tr(language, 'Dépôt', 'Depot', 'Depot') },
    { key: 'user_name', label: tr(language, 'Opérateur', 'Operator', 'Operator') },
    { key: 'department', label: tr(language, 'Département', 'Department', 'Afdeling') },
    { key: 'site_number', label: tr(language, 'Chantier', 'Job site', 'Werf') },
    { key: 'order_number', label: tr(language, 'N° Commande', 'Order #', 'Bestelnr.') },
    ...(canViewPrices
      ? [
          {
            key: 'total_cost',
            label: tr(language, 'Coût HT', 'Net Cost', 'Kostprijs excl. btw'),
            align: 'right' as const,
            isNumeric: true,
            isCurrency: true,
          },
        ]
      : []),
  ]);

  let totalIn = 0;
  let totalOut = 0;
  let sumCost = 0;

  const rows = movements.map((m) => {
    const prod = prodMap.get(String(m.product_id));
    const qty = Number(m.quantity ?? m.quantity_changed ?? 0);
    const isTrans = isTransferMovement(m);
    const isOut = (m.type || m.movement_type) !== 'IN';
    if (!isTrans) {
      if (isOut) totalOut += qty;
      else totalIn += qty;
    }
    const cost =
      m.total_cost != null ? Number(m.total_cost) : qty * Number(prod?.unit_price || 0);
    sumCost += cost;
    const srcDepot = getMovementSourceDepot(m) || m.depot_name || prod?.store_name || '—';
    const dstDepot = getMovementDestDepot(m);

    return {
      created_at: formatDate(m.created_at),
      type: isTrans
        ? tr(language, 'TRANSFERT', 'TRANSFER', 'OVERDRACHT')
        : isOut
        ? tr(language, 'SORTIE', 'OUT', 'UIT')
        : tr(language, 'ENTRÉE', 'IN', 'IN'),
      reference: prod?.reference || m.product_ref || '',
      designation: prod ? `${prod.brand || ''} ${prod.model || ''}`.trim() : m.product_ref || '',
      quantity: isTrans ? qty : isOut ? -qty : qty,
      depot: isTrans && dstDepot ? `${srcDepot} → ${dstDepot}` : srcDepot,
      user_name: m.user_name || '—',
      department: m.department || m.department_name || '—',
      site_number: m.site_number || '—',
      order_number: m.order_number || '—',
      ...(canViewPrices ? { total_cost: Number(cost.toFixed(2)) } : {}),
    };
  });

  const preset = resolvePeriodPreset(filters);
  const appliedFiltersSummary: string[] = [
    `${tr(language, 'Période', 'Period', 'Periode')}: ${preset}`,
  ];
  if (filters.fromDate || filters.toDate) {
    appliedFiltersSummary.push(`${filters.fromDate || '…'} → ${filters.toDate || '…'}`);
  }
  if (filters.type && filters.type !== 'ALL') {
    appliedFiltersSummary.push(`${tr(language, 'Type', 'Type', 'Type')}: ${filters.type}`);
  }
  if (filters.depot && filters.depot !== 'ALL') {
    appliedFiltersSummary.push(`${tr(language, 'Dépôt', 'Depot', 'Depot')}: ${filters.depot}`);
  }
  if (filters.department && filters.department !== 'ALL') {
    appliedFiltersSummary.push(
      `${tr(language, 'Département', 'Department', 'Afdeling')}: ${filters.department}`
    );
  }
  if (filters.site.trim()) {
    appliedFiltersSummary.push(`${tr(language, 'Chantier', 'Site', 'Werf')}: ${filters.site.trim()}`);
  }
  if (filters.user.trim()) {
    appliedFiltersSummary.push(
      `${tr(language, 'Opérateur', 'Operator', 'Operator')}: ${filters.user.trim()}`
    );
  }
  if (filters.reference.trim()) {
    appliedFiltersSummary.push(
      `${tr(language, 'Référence', 'Reference', 'Referentie')}: ${filters.reference.trim()}`
    );
  }
  if (filters.orderNumber.trim()) {
    appliedFiltersSummary.push(
      `${tr(language, 'Commande', 'Order', 'Bestelling')}: ${filters.orderNumber.trim()}`
    );
  }

  const totals = [
    {
      label: tr(language, 'Total mouvements', 'Total movements', 'Totaal bewegingen'),
      value: String(movements.length),
    },
    {
      label: tr(language, 'Total entrées', 'Total inflows', 'Totaal innames'),
      value: `+${totalIn}`,
    },
    {
      label: tr(language, 'Total sorties', 'Total outflows', 'Totaal uitgiftes'),
      value: `-${totalOut}`,
    },
    ...(canViewPrices
      ? [
          {
            label: tr(language, 'Valorisation totale HT', 'Total net valuation', 'Totale waardering excl. btw'),
            value: formatCurrency(sumCost),
          },
        ]
      : []),
  ];

  const title = tr(
    language,
    `Rapport des Mouvements de Stock (${movements.length})`,
    `Stock Movements Report (${movements.length})`,
    `Rapport Voorraadbewegingen (${movements.length})`
  );
  const intro = tr(
    language,
    'Journal détaillé des mouvements de stock selon les critères sélectionnés :',
    'Detailed stock movements log matching the selected filters:',
    'Gedetailleerd logboek van voorraadbewegingen volgens de geselecteerde filters:'
  );

  return {
    type: 'movements',
    title,
    subtitle: intro,
    subject: tr(
      language,
      `[TOT Rapport] Mouvements de stock (${movements.length})`,
      `[TOT Report] Stock movements (${movements.length})`,
      `[TOT Rapport] Voorraadbewegingen (${movements.length})`
    ),
    defaultRecipient: currentUser?.email || 'logistique@entreprise.com',
    generatedAtIso: new Date().toISOString(),
    companyName,
    appliedFiltersSummary,
    columns,
    rows,
    totals,
    htmlContent: buildHtmlReportTable(
      `🔄 ${title}`,
      '#0284c7',
      intro,
      appliedFiltersSummary,
      columns,
      rows,
      totals,
      language
    ),
  };
}

/**
 * Lot 3.3 : Export CSV UTF-8 avec BOM (\uFEFF), séparateur ';', décimales à virgule (',').
 */
export function formatCsvCellValue(
  value: string | number | null | undefined,
  isNumeric = false,
  isCurrency = false
): string {
  if (value === null || value === undefined) return '""';
  if (typeof value === 'number') {
    const formatted = isCurrency
      ? value.toFixed(2).replace('.', ',')
      : String(value).replace('.', ',');
    return `"${formatted}"`;
  }
  const str = String(value);
  if (isNumeric && /^-?\d+\.\d+$/.test(str.trim())) {
    return `"${str.trim().replace('.', ',')}"`;
  }
  const escaped = str.replace(/\r?\n/g, ' ').replace(/"/g, '""');
  return `"${escaped}"`;
}

export function generateReportCsv(report: GeneratedReportData): string {
  const headerLine = report.columns
    .map((c) => `"${String(c.label || c.header || '').replace(/"/g, '""')}"`)
    .join(';');

  const dataLines = report.rows.map((row) =>
    report.columns
      .map((col) => formatCsvCellValue(row[col.key], col.isNumeric, col.isCurrency))
      .join(';')
  );

  return '\uFEFF' + [headerLine, ...dataLines].join('\r\n');
}

/**
 * Lot 3.3 : Export PDF côté client via jsPDF + jspdf-autotable
 * (en-tête société, date, filtres appliqués, pagination, totaux).
 */
export function generateReportPdfBytes(
  report: GeneratedReportData,
  languageOrOpts: Language | { companyName?: string; language?: Language } = 'fr'
): Uint8Array {
  const language: Language =
    typeof languageOrOpts === 'string' ? languageOrOpts : languageOrOpts?.language || 'fr';
  const companyNameOverride =
    typeof languageOrOpts === 'object' && languageOrOpts?.companyName
      ? languageOrOpts.companyName
      : report.companyName;

  const orientation = report.columns.length > 6 ? 'landscape' : 'portrait';
  const doc = new jsPDF({
    orientation,
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const locale = language === 'nl' ? 'nl-NL' : language === 'en' ? 'en-GB' : 'fr-FR';
  const dateStr = new Date(report.generatedAtIso).toLocaleString(locale);

  // En-tête société
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(234, 88, 12); // orange-600
  doc.text(companyNameOverride || 'TOT Stock', 14, 15);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(dateStr, pageWidth - 14, 15, { align: 'right' });

  // Titre du rapport
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(report.title, 14, 23);

  // Filtres appliqués
  let currentY = 29;
  if (report.appliedFiltersSummary.length > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    const filterLine = `${tr(language, 'Filtres :', 'Filters:', 'Filters:')} ${report.appliedFiltersSummary.join(' | ')}`;
    const splitFilters = doc.splitTextToSize(filterLine, pageWidth - 28);
    doc.text(splitFilters, 14, currentY);
    currentY += splitFilters.length * 4 + 2;
  }

  // Tableau principal via jspdf-autotable
  const head = [report.columns.map((c) => c.label || c.header || '')];
  const body = report.rows.map((row) =>
    report.columns.map((c) => {
      const val = row[c.key];
      if (val === null || val === undefined) return '';
      if (typeof val === 'number') {
        return c.isCurrency ? val.toFixed(2).replace('.', ',') : String(val).replace('.', ',');
      }
      return String(val);
    })
  );

  autoTable(doc, {
    startY: currentY + 2,
    head,
    body,
    styles: {
      fontSize: 8,
      cellPadding: 2,
    },
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    margin: { left: 14, right: 14, bottom: 18 },
  });

  // Totaux en fin de tableau
  const finalY = (doc as any).lastAutoTable?.finalY || currentY + 20;
  if (report.totals.length > 0) {
    const totalsText = report.totals.map((t) => `${t.label} : ${t.value}`).join('   •   ');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    const targetY = Math.min(finalY + 8, doc.internal.pageSize.getHeight() - 16);
    doc.text(totalsText, 14, targetY);
  }

  // Pagination sur chaque page
  const pageCount = doc.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `TOT Stock — ${tr(language, 'Page', 'Page', 'Pagina')} ${i} / ${pageCount}`,
      pageWidth / 2,
      pageHeight - 8,
      { align: 'center' }
    );
  }

  const arrayBuffer = doc.output('arraybuffer');
  return new Uint8Array(arrayBuffer);
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...Array.from(sub));
  }
  return btoa(binary);
}

export function stringToUtf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return uint8ArrayToBase64(bytes);
}

export interface PreparedEmailAttachmentsResult {
  attachments: Array<{
    filename: string;
    contentBase64: string;
    contentType: 'text/csv' | 'application/pdf';
    byteSize: number;
  }>;
  totalBytes: number;
  csvBytes: number;
  pdfBytes: number;
  exceedsLimit: boolean;
  csvOnlyFits: boolean;
  canFallbackToCsvOnly: boolean;
  warningMessage?: string;
}

export function prepareReportEmailAttachments(
  optionsOrReport:
    | {
        report: GeneratedReportData;
        attachCsv: boolean;
        attachPdf: boolean;
        language?: Language;
        companyName?: string;
      }
    | GeneratedReportData,
  maybeOpts?: {
    attachCsv: boolean;
    attachPdf: boolean;
    language?: Language;
    companyName?: string;
  }
): PreparedEmailAttachmentsResult {
  const isWrapped = 'report' in optionsOrReport;
  const report: GeneratedReportData = isWrapped ? optionsOrReport.report : optionsOrReport;
  const attachCsv = isWrapped ? optionsOrReport.attachCsv : Boolean(maybeOpts?.attachCsv);
  const attachPdf = isWrapped ? optionsOrReport.attachPdf : Boolean(maybeOpts?.attachPdf);
  const language: Language =
    (isWrapped ? optionsOrReport.language : maybeOpts?.language) || 'fr';
  const companyName = isWrapped ? optionsOrReport.companyName : maybeOpts?.companyName;

  const dateSlug = report.generatedAtIso.slice(0, 10);
  const baseSlug = `tot-rapport-${report.type}-${dateSlug}`.replace(/[^a-zA-Z0-9._-]/g, '_');

  const attachments: PreparedEmailAttachmentsResult['attachments'] = [];
  let csvBytes = 0;
  let pdfBytes = 0;

  if (attachCsv) {
    const csvContent = generateReportCsv(report);
    const encoded = new TextEncoder().encode(csvContent);
    csvBytes = encoded.byteLength;
    attachments.push({
      filename: `${baseSlug}.csv`,
      contentBase64: uint8ArrayToBase64(encoded),
      contentType: 'text/csv',
      byteSize: csvBytes,
    });
  }

  if (attachPdf) {
    const pdfUint8 = generateReportPdfBytes(report, { companyName, language });
    pdfBytes = pdfUint8.byteLength;
    attachments.push({
      filename: `${baseSlug}.pdf`,
      contentBase64: uint8ArrayToBase64(pdfUint8),
      contentType: 'application/pdf',
      byteSize: pdfBytes,
    });
  }

  const totalBytes = csvBytes + pdfBytes;
  const exceedsLimit = totalBytes > MAX_REPORT_ATTACHMENT_BYTES;
  const csvOnlyFits = csvBytes > 0 && csvBytes <= MAX_REPORT_ATTACHMENT_BYTES;

  let warningMessage: string | undefined;
  if (exceedsLimit) {
    warningMessage = tr(
      language,
      `La taille cumulée des pièces jointes (${(totalBytes / (1024 * 1024)).toFixed(2)} Mo) dépasse la limite de 3 Mo (Microsoft Graph). Envoyez uniquement le fichier CSV ou réduisez la période sélectionnée.`,
      `Total attachment size (${(totalBytes / (1024 * 1024)).toFixed(2)} MB) exceeds the 3 MB limit (Microsoft Graph). Send the CSV file only or narrow the selected period.`,
      `De totale grootte van de bijlagen (${(totalBytes / (1024 * 1024)).toFixed(2)} MB) overschrijdt de limiet van 3 MB (Microsoft Graph). Verzend alleen het CSV-bestand of verklein de geselecteerde periode.`
    );
  }

  return {
    attachments,
    totalBytes,
    csvBytes,
    pdfBytes,
    exceedsLimit,
    csvOnlyFits,
    canFallbackToCsvOnly: csvOnlyFits,
    warningMessage,
  };
}

export function triggerBrowserDownload(
  content: BlobPart,
  filename: string,
  mimeType: string
): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadReportCsv(report: GeneratedReportData): void {
  const csv = generateReportCsv(report);
  const dateSlug = report.generatedAtIso.slice(0, 10);
  const filename = `tot-rapport-${report.type}-${dateSlug}.csv`.replace(/[^a-zA-Z0-9._-]/g, '_');
  triggerBrowserDownload(csv, filename, 'text/csv;charset=utf-8');
  logAuditEventServer({
    category: 'EXPORTS',
    type: 'csv_export',
    title: `Export CSV rapport (${report.type})`,
    description: `${report.title} — ${report.rows.length} lignes`,
    meta: {
      report_type: report.type,
      rows: report.rows.length,
      period: report.subtitle,
      filters: report.appliedFiltersSummary,
      filename,
    },
  }).catch(() => {});
}

export function downloadReportPdf(
  report: GeneratedReportData,
  opts?: { companyName?: string; language?: Language }
): void {
  const bytes = generateReportPdfBytes(report, opts || 'fr');
  const dateSlug = report.generatedAtIso.slice(0, 10);
  const filename = `tot-rapport-${report.type}-${dateSlug}.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_');
  triggerBrowserDownload(bytes as unknown as BlobPart, filename, 'application/pdf');
  logAuditEventServer({
    category: 'EXPORTS',
    type: 'pdf_export',
    title: `Export PDF rapport (${report.type})`,
    description: `${report.title} — ${report.rows.length} lignes`,
    meta: {
      report_type: report.type,
      rows: report.rows.length,
      period: report.subtitle,
      filters: report.appliedFiltersSummary,
      filename,
    },
  }).catch(() => {});
}

export async function sendReportEmailViaEdgeFunction(params: {
  to?: string;
  recipient?: string;
  subject: string;
  htmlContent: string;
  attachments?: Array<{
    filename: string;
    contentBase64: string;
    contentType: 'text/csv' | 'application/pdf';
  }>;
  appCode?: 'rpt' | 'stk';
  kind?: string;
  client?: any;
  supabaseUrl?: string;
  supabaseKey?: string;
}): Promise<{
  success: boolean;
  configured?: boolean;
  error?: string;
  message?: string;
}> {
  const supabaseUrl = (
    params.supabaseUrl ||
    safeGetSensitiveItem('tot_inv_supabase_url') ||
    safeGetSensitiveItem('tqt_company_url') ||
    ''
  ).trim();
  const supabaseKey = (
    params.supabaseKey ||
    safeGetSensitiveItem('tot_inv_supabase_key') ||
    safeGetSensitiveItem('tqt_company_key') ||
    ''
  ).trim();
  const client = params.client || getClientSupabase(supabaseUrl, supabaseKey);
  const sendEmailFn = getResolvedEdgeFunctionName('sendReportEmail');
  const targetTo = (params.to || params.recipient || '').trim();
  const payload = {
    app_code: params.appCode || 'rpt',
    kind: params.kind || 'report',
    to: targetTo,
    subject: params.subject,
    htmlContent: params.htmlContent,
    attachments:
      params.attachments && params.attachments.length > 0
        ? params.attachments.map((a) => ({
            filename: a.filename,
            contentBase64: a.contentBase64,
            contentType: a.contentType,
          }))
        : undefined,
    user_permissions: ['perm_report_view'],
  };

  if (client && typeof client.functions?.invoke === 'function') {
    const { data, error } = await client.functions.invoke(sendEmailFn, {
      body: payload,
    });
    if (error) {
      const parsed = await extractEdgeFunctionError(error, data);
      return {
        success: false,
        configured: true,
        error: parsed.statusCode
          ? `${parsed.message} (HTTP ${parsed.statusCode})`
          : parsed.message,
      };
    }
    if (data?.configured === false || data?.status === 'non configuré') {
      return {
        success: false,
        configured: false,
        error: data?.error || 'Service e-mail non configuré.',
      };
    }
    if (data?.success) {
      logAuditEventServer(
        {
          category: 'EXPORTS',
          type: 'report_email',
          title: `Envoi e-mail de rapport : ${params.subject}`,
          description: `Destinataire : ${targetTo}`,
          meta: {
            recipient: targetTo,
            subject: params.subject,
            attachments_count: params.attachments?.length || 0,
            filenames: params.attachments?.map((a) => a.filename) || [],
          },
        },
        client
      ).catch(() => {});
      return {
        success: true,
        configured: true,
        message: data?.message,
      };
    }
    return {
      success: false,
      configured: true,
      error: data?.error || 'Échec de transmission du rapport.',
    };
  }

  const endpoint = supabaseUrl
    ? `${supabaseUrl.replace(/\/$/, '')}/functions/v1/${sendEmailFn}`
    : '/api/send-report-email';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(supabaseKey ? { Authorization: `Bearer ${supabaseKey}`, apikey: supabaseKey } : {}),
    },
    body: JSON.stringify(payload),
  });
  const resData = await res.json().catch(() => ({}));
  if (resData?.configured === false || resData?.status === 'non configuré') {
    return {
      success: false,
      configured: false,
      error: resData?.error || 'Service e-mail non configuré.',
    };
  }
  if (res.ok && resData?.success) {
    return {
      success: true,
      configured: true,
      message: resData?.message,
    };
  }
  return {
    success: false,
    configured: true,
    error: resData?.error || `Erreur serveur (${res.status})`,
  };
}
