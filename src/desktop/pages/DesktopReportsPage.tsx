import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowLeftRight,
  Building2,
  Calendar,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Mail,
  Paperclip,
  RotateCcw,
  Search,
  Send,
  ShoppingBag,
  SlidersHorizontal,
  WifiOff,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { MaterialOrder, OrderStatus, StockMovement } from '../../types';
import {
  buildDepartmentProjectsReport,
  buildLowStockReport,
  buildMovementsReport,
  buildOrdersReport,
  buildOutOfStockReport,
  buildSearchMaterialOrdersRpcParams,
  buildSearchStockMovementsRpcParams,
  buildWeeklyUserRecapReport,
  createDefaultMovementSearchFilters,
  createDefaultOrderSearchFilters,
  doesMovementFilterExceedLocalWindow,
  doesOrderFilterExceedLocalWindow,
  downloadReportCsv,
  downloadReportPdf,
  filterMovementsDefault7Days,
  filterMovementsLocally,
  filterOrdersDefault7DaysAndActive,
  filterOrdersLocally,
  GeneratedReportPayload,
  MAX_REPORT_ATTACHMENT_TOTAL_BYTES,
  MovementSearchFilters,
  MovementTypeFilter,
  OrderSearchFilters,
  prepareReportEmailAttachments,
  ReportKindId,
  ReportPeriodPreset,
  sendReportEmailViaEdgeFunction,
} from '../../services/reportsService';
import {
  getClientSupabase,
  normalizeMovementRecord,
  normalizeOrderRecord,
} from '../../services/clientSupabase';
import {
  canViewStockLevelsReport,
  mapStockLevelsReportRowsToProducts,
} from '../../services/transferService';
import { Product, StockLevelsReportRow } from '../../types';
import { tr } from '../../i18n/dutchTranslator';
import { SearchableSelect } from '../../components/SearchableSelect';
import { ProductRefLink } from '../../components/ProductRefLink';
import { filterVisibleDepotsForUser } from '../../utils/depotPermissions';
import { isProjectClosed } from '../../services/projectStatusService';

export interface DesktopReportsPageProps {
  selectedDepotFilter?: string;
}

const ORDER_STATUS_OPTIONS: OrderStatus[] = [
  'WAITING_APPROVAL',
  'PENDING',
  'PREPARING',
  'READY',
  'COLLECTED',
  'CANCELLED',
  'REJECTED',
];

const REPORT_RPC_LIMIT = 200;

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}

export const DesktopReportsPage: React.FC<DesktopReportsPageProps> = ({
  selectedDepotFilter = 'ALL',
}) => {
  const {
    orders,
    movements,
    products,
    depots,
    departments,
    projects,
    users,
    roles,
    currentUser,
    license,
    supabaseUrl,
    supabaseKey,
    userHasPermission,
    language,
  } = useApp();

  const canViewPrices = userHasPermission('perm_prod_view_price');
  const canViewStockLevels = canViewStockLevelsReport(
    currentUser,
    userHasPermission('perm_report_stock_levels')
  );
  const companyName = (license as any)?.company_name || 'TOT Stock';

  const visibleDepots = useMemo(
    () => filterVisibleDepotsForUser(depots, currentUser, users),
    [depots, currentUser, users]
  );

  const [activeReportKind, setActiveReportKind] = useState<ReportKindId>('ORDERS');
  const [includeClosedProjects, setIncludeClosedProjects] = useState<boolean>(true);
  const [orderFilters, setOrderFilters] = useState<OrderSearchFilters>(() =>
    createDefaultOrderSearchFilters()
  );
  const [movementFilters, setMovementFilters] = useState<MovementSearchFilters>(() =>
    createDefaultMovementSearchFilters()
  );

  // Server RPC data for Orders, Movements & Stock Level reports
  const [rpcOrders, setRpcOrders] = useState<MaterialOrder[] | null>(null);
  const [rpcMovements, setRpcMovements] = useState<StockMovement[] | null>(null);
  const [rpcStockProducts, setRpcStockProducts] = useState<Product[] | null>(null);
  const [isLoadingRpc, setIsLoadingRpc] = useState(false);
  const [localFallback, setLocalFallback] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  // Email Modal State
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailRecipient, setEmailRecipient] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [attachCsv, setAttachCsv] = useState(true);
  const [attachPdf, setAttachPdf] = useState(true);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [statusFeedback, setStatusFeedback] = useState<{
    type: 'success' | 'error' | 'warning';
    message: string;
  } | null>(null);

  const searchSeqRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Ensure restricted stock level tabs cannot remain active if user lacks permission
  useEffect(() => {
    if (
      !canViewStockLevels &&
      (activeReportKind === 'LOW_STOCK' || activeReportKind === 'OUT_OF_STOCK')
    ) {
      setActiveReportKind('ORDERS');
    }
  }, [canViewStockLevels, activeReportKind]);

  const effectiveOrderFilters: OrderSearchFilters = useMemo(() => {
    const depot =
      orderFilters.depot && orderFilters.depot !== 'ALL'
        ? orderFilters.depot
        : selectedDepotFilter !== 'ALL'
        ? selectedDepotFilter
        : '';
    return { ...orderFilters, depot };
  }, [orderFilters, selectedDepotFilter]);

  const effectiveMovementFilters: MovementSearchFilters = useMemo(() => {
    const depot =
      movementFilters.depot && movementFilters.depot !== 'ALL'
        ? movementFilters.depot
        : selectedDepotFilter !== 'ALL'
        ? selectedDepotFilter
        : '';
    return { ...movementFilters, depot };
  }, [movementFilters, selectedDepotFilter]);

  const fetchReportRpcData = useCallback(
    async (
      kind: 'ORDERS' | 'MOVEMENTS',
      ordFilters: OrderSearchFilters,
      movFilters: MovementSearchFilters
    ) => {
      const seq = ++searchSeqRef.current;
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const offlineNow = typeof navigator !== 'undefined' && !navigator.onLine;
      const client = !offlineNow ? getClientSupabase(supabaseUrl, supabaseKey) : null;

      if (!client || offlineNow || typeof (client as any).rpc !== 'function') {
        if (seq !== searchSeqRef.current) return;
        setLocalFallback(true);
        setRpcOrders(null);
        setRpcMovements(null);
        setIsLoadingRpc(false);
        return;
      }

      setIsLoadingRpc(true);
      try {
        if (kind === 'ORDERS') {
          const params = buildSearchMaterialOrdersRpcParams(ordFilters, REPORT_RPC_LIMIT, 0);
          let call: any = client.rpc('search_material_orders', params);
          if (call && typeof call.abortSignal === 'function') {
            call = call.abortSignal(controller.signal);
          }
          const { data, error } = await call;
          if (seq !== searchSeqRef.current || controller.signal.aborted) return;
          if (error) {
            setLocalFallback(true);
            setRpcOrders(null);
            return;
          }
          const rows = (Array.isArray(data) ? data : [])
            .map((r: any) => r?.row_data ?? r)
            .filter(Boolean)
            .map(normalizeOrderRecord);
          setLocalFallback(false);
          setRpcOrders(rows);
        } else {
          const params = buildSearchStockMovementsRpcParams(movFilters, REPORT_RPC_LIMIT, 0);
          let call: any = client.rpc('search_stock_movements', params);
          if (call && typeof call.abortSignal === 'function') {
            call = call.abortSignal(controller.signal);
          }
          const { data, error } = await call;
          if (seq !== searchSeqRef.current || controller.signal.aborted) return;
          if (error) {
            setLocalFallback(true);
            setRpcMovements(null);
            return;
          }
          const rows = (Array.isArray(data) ? data : [])
            .map((r: any) => r?.row_data ?? r)
            .filter(Boolean)
            .map(normalizeMovementRecord);
          setLocalFallback(false);
          setRpcMovements(rows);
        }
      } catch {
        if (seq !== searchSeqRef.current || controller.signal.aborted) return;
        setLocalFallback(true);
        setRpcOrders(null);
        setRpcMovements(null);
      } finally {
        if (seq === searchSeqRef.current) {
          setIsLoadingRpc(false);
        }
      }
    },
    [supabaseUrl, supabaseKey]
  );

  // Trigger RPC for LOW_STOCK / OUT_OF_STOCK via get_stock_levels_report
  useEffect(() => {
    if (activeReportKind !== 'LOW_STOCK' && activeReportKind !== 'OUT_OF_STOCK') {
      setRpcStockProducts(null);
      return;
    }
    if (!canViewStockLevels) {
      setRpcStockProducts([]);
      return;
    }
    const offlineNow = typeof navigator !== 'undefined' && !navigator.onLine;
    const client = !offlineNow ? getClientSupabase(supabaseUrl, supabaseKey) : null;
    if (!client || offlineNow || typeof (client as any).rpc !== 'function') {
      setRpcStockProducts(null);
      return;
    }

    let cancelled = false;
    setIsLoadingRpc(true);
    Promise.resolve(
      client.rpc('get_stock_levels_report', {
        p_depot: selectedDepotFilter !== 'ALL' ? selectedDepotFilter : null,
        p_only_low: true,
      })
    )
      .then(({ data, error }: any) => {
        if (cancelled) return;
        if (error || !Array.isArray(data)) {
          setRpcStockProducts(null);
          return;
        }
        const rows: StockLevelsReportRow[] = data.map((r: Record<string, unknown>) => ({
          product_id: String(r.product_id ?? ''),
          reference: String(r.reference ?? ''),
          brand: String(r.brand ?? ''),
          model: String(r.model ?? ''),
          sub_category_id:
            r.sub_category_id !== null && r.sub_category_id !== undefined
              ? Number(r.sub_category_id)
              : null,
          depot_name: String(r.depot_name ?? 'Dépôt Principal'),
          rack_location: String(r.rack_location ?? ''),
          quantity: Number(r.quantity ?? 0),
          min_stock_alert: Number(r.min_stock_alert ?? 0),
          unit_price: Number(r.unit_price ?? 0),
          total_value: Number(r.total_value ?? 0),
          in_transit_qty: Number(r.in_transit_qty ?? 0),
          is_low_stock: Boolean(r.is_low_stock),
          is_out_of_stock: Boolean(r.is_out_of_stock),
        }));
        setRpcStockProducts(mapStockLevelsReportRowsToProducts(rows, products));
      })
      .catch(() => {
        if (!cancelled) setRpcStockProducts(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingRpc(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeReportKind, canViewStockLevels, selectedDepotFilter, supabaseUrl, supabaseKey, products]);

  // Trigger RPC search on 400ms debounce for ORDERS and MOVEMENTS reports when filters exceed local window
  useEffect(() => {
    if (activeReportKind === 'ORDERS') {
      if (!doesOrderFilterExceedLocalWindow(effectiveOrderFilters)) {
        setRpcOrders(null);
        setLocalFallback(!isOnline);
        setIsLoadingRpc(false);
        return;
      }
      const timer = setTimeout(() => {
        fetchReportRpcData('ORDERS', effectiveOrderFilters, effectiveMovementFilters);
      }, 400);
      return () => clearTimeout(timer);
    }

    if (activeReportKind === 'MOVEMENTS') {
      if (!doesMovementFilterExceedLocalWindow(effectiveMovementFilters)) {
        setRpcMovements(null);
        setLocalFallback(!isOnline);
        setIsLoadingRpc(false);
        return;
      }
      const timer = setTimeout(() => {
        fetchReportRpcData('MOVEMENTS', effectiveOrderFilters, effectiveMovementFilters);
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [
    activeReportKind,
    effectiveOrderFilters,
    effectiveMovementFilters,
    isOnline,
    fetchReportRpcData,
  ]);

  const resolvedOrdersForReport = useMemo(() => {
    if (rpcOrders !== null) return rpcOrders;
    if (
      !doesOrderFilterExceedLocalWindow(effectiveOrderFilters) &&
      effectiveOrderFilters.period === '7D'
    ) {
      const base = filterOrdersDefault7DaysAndActive(orders);
      return filterOrdersLocally(base, { ...effectiveOrderFilters, period: 'ALL' }, products);
    }
    return filterOrdersLocally(orders, effectiveOrderFilters, products);
  }, [rpcOrders, orders, products, effectiveOrderFilters]);

  const resolvedMovementsForReport = useMemo(() => {
    if (rpcMovements !== null) return rpcMovements;
    if (
      !doesMovementFilterExceedLocalWindow(effectiveMovementFilters) &&
      effectiveMovementFilters.period === '7D'
    ) {
      const base = filterMovementsDefault7Days(movements);
      return filterMovementsLocally(
        base,
        { ...effectiveMovementFilters, period: 'ALL' },
        products
      );
    }
    return filterMovementsLocally(movements, effectiveMovementFilters, products);
  }, [rpcMovements, movements, products, effectiveMovementFilters]);

  const resolvedStockProductsForReport = useMemo(() => {
    if (!canViewStockLevels) return [];
    return rpcStockProducts !== null ? rpcStockProducts : products;
  }, [canViewStockLevels, rpcStockProducts, products]);

  const closedProjectNumbersSet = useMemo(() => {
    const s = new Set<string>();
    for (const p of projects) {
      if (isProjectClosed(p) && p.project_number) {
        s.add(p.project_number.trim().toLowerCase());
      }
    }
    return s;
  }, [projects]);

  const filteredProjectsForReport = useMemo(
    () => (includeClosedProjects ? projects : projects.filter((p) => !isProjectClosed(p))),
    [projects, includeClosedProjects]
  );

  const filteredOrdersForReport = useMemo(
    () =>
      includeClosedProjects
        ? resolvedOrdersForReport
        : resolvedOrdersForReport.filter(
            (o) => !o.site_number || !closedProjectNumbersSet.has(o.site_number.trim().toLowerCase())
          ),
    [resolvedOrdersForReport, includeClosedProjects, closedProjectNumbersSet]
  );

  const filteredMovementsForReport = useMemo(
    () =>
      includeClosedProjects
        ? resolvedMovementsForReport
        : resolvedMovementsForReport.filter(
            (m) => !m.site_number || !closedProjectNumbersSet.has(m.site_number.trim().toLowerCase())
          ),
    [resolvedMovementsForReport, includeClosedProjects, closedProjectNumbersSet]
  );

  const currentReport: GeneratedReportPayload = useMemo(() => {
    switch (activeReportKind) {
      case 'WEEKLY_RECAP':
        return buildWeeklyUserRecapReport(currentUser, filteredMovementsForReport, products, language);
      case 'LOW_STOCK':
        return buildLowStockReport(
          resolvedStockProductsForReport,
          users,
          roles,
          currentUser,
          language
        );
      case 'OUT_OF_STOCK':
        return buildOutOfStockReport(resolvedStockProductsForReport, currentUser, language);
      case 'DEPT_PROJECTS':
        return buildDepartmentProjectsReport(
          currentUser,
          departments,
          filteredProjectsForReport,
          filteredMovementsForReport,
          products,
          language
        );
      case 'MOVEMENTS':
        return buildMovementsReport(
          filteredMovementsForReport,
          products,
          effectiveMovementFilters,
          canViewPrices,
          currentUser,
          language
        );
      case 'ORDERS':
      default:
        return buildOrdersReport(
          filteredOrdersForReport,
          effectiveOrderFilters,
          canViewPrices,
          currentUser,
          language
        );
    }
  }, [
    activeReportKind,
    currentUser,
    filteredMovementsForReport,
    products,
    resolvedStockProductsForReport,
    users,
    roles,
    departments,
    filteredProjectsForReport,
    effectiveMovementFilters,
    filteredOrdersForReport,
    effectiveOrderFilters,
    canViewPrices,
    language,
  ]);

  const preparedAttachments = useMemo(() => {
    return prepareReportEmailAttachments(currentReport, {
      attachCsv,
      attachPdf,
      companyName,
    });
  }, [currentReport, attachCsv, attachPdf, companyName]);

  const handleOpenEmailModal = () => {
    setEmailRecipient(currentReport.defaultRecipient || currentUser?.email || '');
    setEmailSubject(currentReport.subject);
    setAttachCsv(true);
    setAttachPdf(true);
    setStatusFeedback(null);
    setEmailModalOpen(true);
  };

  const handleDownloadCsv = () => {
    downloadReportCsv(currentReport);
    setStatusFeedback({
      type: 'success',
      message: tr(
        language,
        'Fichier CSV téléchargé (UTF-8 avec BOM).',
        'CSV file downloaded (UTF-8 with BOM).',
        'CSV-bestand gedownload (UTF-8 met BOM).'
      ),
    });
  };

  const handleDownloadPdf = () => {
    downloadReportPdf(currentReport, { companyName });
    setStatusFeedback({
      type: 'success',
      message: tr(
        language,
        'Rapport PDF généré et téléchargé.',
        'PDF report generated and downloaded.',
        'PDF-rapport gegenereerd en gedownload.'
      ),
    });
  };

  const handleSendReportEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailRecipient.trim()) return;
    if (preparedAttachments.exceedsLimit) {
      setStatusFeedback({
        type: 'warning',
        message: tr(
          language,
          'La taille cumulée des pièces jointes dépasse la limite de 3 Mo (Microsoft Graph). Envoyez le CSV seul ou réduisez la période.',
          'Total attachment size exceeds the 3 MB limit (Microsoft Graph). Send CSV only or reduce the period.',
          'De totale grootte van de bijlagen overschrijdt de limiet van 3 MB (Microsoft Graph). Verzend alleen CSV of verkort de periode.'
        ),
      });
      return;
    }

    setSendingEmail(true);
    setStatusFeedback(null);
    try {
      const client = getClientSupabase(supabaseUrl, supabaseKey);
      const res = await sendReportEmailViaEdgeFunction({
        client,
        supabaseUrl,
        supabaseKey,
        recipient: emailRecipient.trim(),
        subject: emailSubject.trim() || currentReport.subject,
        htmlContent: currentReport.htmlContent,
        attachments: preparedAttachments.attachments,
        kind: activeReportKind === 'ORDERS' ? 'order' : 'report',
      });

      if (res.success) {
        setStatusFeedback({
          type: 'success',
          message: tr(
            language,
            `Rapport envoyé avec succès à ${emailRecipient.trim()} (application expéditrice : rpt).`,
            `Report successfully sent to ${emailRecipient.trim()} (sender app: rpt).`,
            `Rapport succesvol verzonden naar ${emailRecipient.trim()} (afzender-app: rpt).`
          ),
        });
        setEmailModalOpen(false);
      } else {
        setStatusFeedback({
          type: 'error',
          message:
            res.error ||
            tr(
              language,
              "Échec lors de l'envoi du rapport par e-mail.",
              'Failed to send report by email.',
              'Verzenden van rapport per e-mail mislukt.'
            ),
        });
      }
    } finally {
      setSendingEmail(false);
    }
  };

  const toggleOrderStatus = (st: OrderStatus) => {
    setOrderFilters((prev) => ({
      ...prev,
      statuses: prev.statuses.includes(st)
        ? prev.statuses.filter((x) => x !== st)
        : [...prev.statuses, st],
    }));
  };

  const visibleReportTabs = useMemo(() => {
    const tabs: Array<{ id: ReportKindId; label: string; icon: any }> = [
      {
        id: 'ORDERS',
        label: tr(language, 'Rapport Commandes', 'Orders Report', 'Bestellingenrapport'),
        icon: ShoppingBag,
      },
      {
        id: 'MOVEMENTS',
        label: tr(language, 'Rapport Mouvements', 'Movements Report', 'Bewegingenrapport'),
        icon: ArrowLeftRight,
      },
      {
        id: 'WEEKLY_RECAP',
        label: tr(language, 'Récap Hebdo Sorties', 'Weekly Outflows', 'Wekelijkse uitgiftes'),
        icon: Calendar,
      },
    ];
    if (canViewStockLevels) {
      tabs.push(
        {
          id: 'LOW_STOCK',
          label: tr(language, 'Stocks Faibles', 'Low Stock', 'Lage voorraad'),
          icon: AlertTriangle,
        },
        {
          id: 'OUT_OF_STOCK',
          label: tr(language, 'Ruptures de Stock', 'Out of Stock', 'Voorraadbreuken'),
          icon: AlertOctagon,
        }
      );
    }
    tabs.push({
      id: 'DEPT_PROJECTS',
      label: tr(language, 'Département & Chantiers', 'Dept & Job Sites', 'Afdeling & Werven'),
      icon: Building2,
    });
    return tabs;
  }, [language, canViewStockLevels]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-slate-50 dark:bg-slate-950">
      {/* Offline / Local Fallback Banner */}
      {(!isOnline || localFallback) &&
        (activeReportKind === 'ORDERS' || activeReportKind === 'MOVEMENTS') && (
          <div
            role="status"
            data-testid="reports-local-fallback-banner"
            className="px-6 py-2 bg-amber-50 dark:bg-amber-950/60 border-b border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs font-bold flex items-center gap-2 shrink-0"
          >
            <WifiOff className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>
              {tr(
                language,
                'Recherche limitée aux données locales',
                'Search limited to local data',
                'Zoekopdracht beperkt tot lokale gegevens'
              )}
            </span>
          </div>
        )}

      {/* Top Header + Export Actions */}
      <div className="px-6 py-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div>
          <div className="flex items-center gap-2.5">
            <FileSpreadsheet className="w-5 h-5 text-orange-600" />
            <h1 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
              {tr(language, 'Rapports & Exports (CSV / PDF / E-mail)', 'Reports & Exports (CSV / PDF / Email)', 'Rapporten & Exports (CSV / PDF / E-mail)')}
            </h1>
            {isLoadingRpc && (
              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-600" />
                {tr(language, 'Chargement serveur...', 'Loading from server...', 'Server laden...')}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {currentReport.subtitle} • {currentReport.appliedFiltersSummary}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            data-testid="reports-download-csv-btn"
            onClick={handleDownloadCsv}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            {tr(language, 'Télécharger CSV', 'Download CSV', 'CSV downloaden')}
          </button>

          <button
            type="button"
            data-testid="reports-download-pdf-btn"
            onClick={handleDownloadPdf}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
          >
            <FileText className="w-4 h-4 text-rose-600" />
            {tr(language, 'Télécharger PDF', 'Download PDF', 'PDF downloaden')}
          </button>

          <button
            type="button"
            data-testid="reports-open-email-btn"
            onClick={handleOpenEmailModal}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white shadow-xs transition-colors cursor-pointer"
          >
            <Mail className="w-4 h-4" />
            {tr(language, 'Envoyer par e-mail', 'Send by email', 'Verzenden per e-mail')}
          </button>
        </div>
      </div>

      {statusFeedback && (
        <div
          role="status"
          className={`px-6 py-2.5 text-xs font-bold flex items-center justify-between gap-2 border-b shrink-0 ${
            statusFeedback.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : statusFeedback.type === 'warning'
              ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
              : 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
          }`}
        >
          <span className="flex items-center gap-2">
            {statusFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span>{statusFeedback.message}</span>
          </span>
          <button
            type="button"
            onClick={() => setStatusFeedback(null)}
            className="p-1 rounded hover:bg-black/5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Report Type Tabs */}
      <div className="px-6 py-2.5 bg-white/80 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0 text-xs font-bold">
        <div className="flex flex-wrap items-center gap-2">
          {visibleReportTabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              data-testid={`report-tab-${id.toLowerCase()}`}
              onClick={() => setActiveReportKind(id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                activeReportKind === id
                  ? 'bg-orange-600 text-white shadow-2xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeClosedProjects}
            onChange={(e) => setIncludeClosedProjects(e.target.checked)}
            className="rounded border-slate-300 text-orange-600 focus:ring-orange-500"
          />
          <span>
            {tr(
              language,
              'Inclure les projets terminés',
              'Include closed projects',
              'Afgesloten projecten opnemen'
            )}
          </span>
        </label>
      </div>

      {/* Conditional Filter Bar for Orders Report */}
      {activeReportKind === 'ORDERS' && (
        <div className="px-6 py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 space-y-2.5 shrink-0 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-0.5 font-bold">
                {(
                  [
                    ['7D', tr(language, '7 j', '7 d', '7 d')],
                    ['30D', tr(language, '30 j', '30 d', '30 d')],
                    ['CUSTOM', tr(language, 'Personnalisée', 'Custom', 'Aangepast')],
                    ['ALL', tr(language, 'Tout', 'All', 'Alles')],
                  ] as Array<[ReportPeriodPreset, string]>
                ).map(([preset, label]) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setOrderFilters((prev) => ({ ...prev, period: preset }))}
                    className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                      orderFilters.period === preset
                        ? 'bg-white dark:bg-slate-900 text-orange-600 shadow-2xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {orderFilters.period === 'CUSTOM' && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={orderFilters.fromDate}
                    onChange={(e) =>
                      setOrderFilters((prev) => ({ ...prev, fromDate: e.target.value }))
                    }
                    className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                  <span>→</span>
                  <input
                    type="date"
                    value={orderFilters.toDate}
                    onChange={(e) =>
                      setOrderFilters((prev) => ({ ...prev, toDate: e.target.value }))
                    }
                    className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
              )}

              <div className="flex flex-wrap items-center gap-1 font-bold">
                <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400 mr-1" />
                {ORDER_STATUS_OPTIONS.map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => toggleOrderStatus(st)}
                    className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                      orderFilters.statuses.includes(st)
                        ? 'bg-orange-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  fetchReportRpcData('ORDERS', effectiveOrderFilters, effectiveMovementFilters)
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 cursor-pointer"
              >
                <Search className="w-3.5 h-3.5" />
                {tr(language, 'Rechercher', 'Search', 'Zoeken')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOrderFilters(createDefaultOrderSearchFilters());
                  setRpcOrders(null);
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-bold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {tr(language, 'Réinitialiser', 'Reset', 'Resetten')}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
            <input
              type="text"
              value={orderFilters.text}
              onChange={(e) => setOrderFilters((prev) => ({ ...prev, text: e.target.value }))}
              placeholder={tr(language, 'Texte libre (n°, notes)', 'Free text (#, notes)', 'Vrije tekst')}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            />
            <input
              type="text"
              value={orderFilters.reference}
              onChange={(e) => setOrderFilters((prev) => ({ ...prev, reference: e.target.value }))}
              placeholder={tr(language, 'Réf. article', 'Item ref', 'Artikelref.')}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
            />
            <input
              type="text"
              value={orderFilters.requester}
              onChange={(e) => setOrderFilters((prev) => ({ ...prev, requester: e.target.value }))}
              placeholder={tr(language, 'Demandeur', 'Requester', 'Aanvrager')}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            />
            <input
              type="text"
              value={orderFilters.preparer}
              onChange={(e) => setOrderFilters((prev) => ({ ...prev, preparer: e.target.value }))}
              placeholder={tr(language, 'Préparateur', 'Preparer', 'Orderpicker')}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            />
            <SearchableSelect
              value={orderFilters.department}
              onChange={(val) => setOrderFilters((prev) => ({ ...prev, department: val }))}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            >
              <option value="">{tr(language, 'Tous départements', 'All depts', 'Alle afd.')}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </SearchableSelect>
            <input
              type="text"
              value={orderFilters.site}
              onChange={(e) => setOrderFilters((prev) => ({ ...prev, site: e.target.value }))}
              placeholder={tr(language, 'Chantier', 'Job site', 'Werf')}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
            />
            <SearchableSelect
              value={orderFilters.depot}
              onChange={(val) => setOrderFilters((prev) => ({ ...prev, depot: val }))}
              recentKey="depots"
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            >
              <option value="">{tr(language, 'Tous dépôts', 'All depots', 'Alle depots')}</option>
              {visibleDepots.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </SearchableSelect>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                value={orderFilters.minCost}
                onChange={(e) => setOrderFilters((prev) => ({ ...prev, minCost: e.target.value }))}
                placeholder="Min €"
                className="w-1/2 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
              />
              <input
                type="number"
                min={0}
                value={orderFilters.maxCost}
                onChange={(e) => setOrderFilters((prev) => ({ ...prev, maxCost: e.target.value }))}
                placeholder="Max €"
                className="w-1/2 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
              />
            </div>
          </div>
        </div>
      )}

      {/* Conditional Filter Bar for Movements Report */}
      {activeReportKind === 'MOVEMENTS' && (
        <div className="px-6 py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 space-y-2.5 shrink-0 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-0.5 font-bold">
                {(['ALL', 'IN', 'OUT', 'TRANSFER'] as MovementTypeFilter[]).map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => setMovementFilters((prev) => ({ ...prev, type: tf }))}
                    className={`px-2.5 py-1 rounded-md cursor-pointer ${
                      movementFilters.type === tf
                        ? 'bg-white dark:bg-slate-900 text-orange-600 shadow-2xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>

              <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-0.5 font-bold">
                {(
                  [
                    ['7D', tr(language, '7 j', '7 d', '7 d')],
                    ['30D', tr(language, '30 j', '30 d', '30 d')],
                    ['CUSTOM', tr(language, 'Personnalisée', 'Custom', 'Aangepast')],
                    ['ALL', tr(language, 'Tout', 'All', 'Alles')],
                  ] as Array<[ReportPeriodPreset, string]>
                ).map(([preset, label]) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setMovementFilters((prev) => ({ ...prev, period: preset }))}
                    className={`px-2.5 py-1 rounded-md cursor-pointer ${
                      movementFilters.period === preset
                        ? 'bg-white dark:bg-slate-900 text-orange-600 shadow-2xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {movementFilters.period === 'CUSTOM' && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={movementFilters.fromDate}
                    onChange={(e) =>
                      setMovementFilters((prev) => ({ ...prev, fromDate: e.target.value }))
                    }
                    className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                  <span>→</span>
                  <input
                    type="date"
                    value={movementFilters.toDate}
                    onChange={(e) =>
                      setMovementFilters((prev) => ({ ...prev, toDate: e.target.value }))
                    }
                    className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  fetchReportRpcData('MOVEMENTS', effectiveOrderFilters, effectiveMovementFilters)
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 cursor-pointer"
              >
                <Search className="w-3.5 h-3.5" />
                {tr(language, 'Rechercher', 'Search', 'Zoeken')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMovementFilters(createDefaultMovementSearchFilters());
                  setRpcMovements(null);
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-bold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {tr(language, 'Réinitialiser', 'Reset', 'Resetten')}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
            <input
              type="text"
              value={movementFilters.text}
              onChange={(e) => setMovementFilters((prev) => ({ ...prev, text: e.target.value }))}
              placeholder={tr(language, 'Texte libre', 'Free text', 'Vrije tekst')}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            />
            <input
              type="text"
              value={movementFilters.reference}
              onChange={(e) =>
                setMovementFilters((prev) => ({ ...prev, reference: e.target.value }))
              }
              placeholder={tr(language, 'Réf. article', 'Item ref', 'Artikelref.')}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
            />
            <input
              type="text"
              value={movementFilters.user}
              onChange={(e) => setMovementFilters((prev) => ({ ...prev, user: e.target.value }))}
              placeholder={tr(language, 'Opérateur', 'Operator', 'Operator')}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            />
            <SearchableSelect
              value={movementFilters.department}
              onChange={(val) =>
                setMovementFilters((prev) => ({ ...prev, department: val }))
              }
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            >
              <option value="">{tr(language, 'Tous départements', 'All depts', 'Alle afd.')}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </SearchableSelect>
            <input
              type="text"
              value={movementFilters.site}
              onChange={(e) => setMovementFilters((prev) => ({ ...prev, site: e.target.value }))}
              placeholder={tr(language, 'Chantier', 'Job site', 'Werf')}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
            />
            <input
              type="text"
              value={movementFilters.orderNumber}
              onChange={(e) =>
                setMovementFilters((prev) => ({ ...prev, orderNumber: e.target.value }))
              }
              placeholder={tr(language, 'N° commande', 'Order #', 'Bestelnr.')}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
            />
            <SearchableSelect
              value={movementFilters.depot}
              onChange={(val) => setMovementFilters((prev) => ({ ...prev, depot: val }))}
              recentKey="depots"
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            >
              <option value="">{tr(language, 'Tous dépôts', 'All depots', 'Alle depots')}</option>
              {visibleDepots.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </SearchableSelect>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                value={movementFilters.minCost}
                onChange={(e) =>
                  setMovementFilters((prev) => ({ ...prev, minCost: e.target.value }))
                }
                placeholder="Min €"
                className="w-1/2 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
              />
              <input
                type="number"
                min={0}
                value={movementFilters.maxCost}
                onChange={(e) =>
                  setMovementFilters((prev) => ({ ...prev, maxCost: e.target.value }))
                }
                placeholder="Max €"
                className="w-1/2 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
              />
            </div>
          </div>
        </div>
      )}

      {/* Totals Summary Strip */}
      {currentReport.totals.length > 0 && (
        <div className="px-6 py-2.5 bg-slate-100/80 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-4 text-xs shrink-0">
          {currentReport.totals.map((tot, idx) => (
            <div key={idx} className="flex items-center gap-1.5">
              <span className="text-slate-500">{tot.label} :</span>
              <strong className="font-mono text-slate-900 dark:text-white">{tot.value}</strong>
            </div>
          ))}
        </div>
      )}

      {/* Preview Table */}
      <div className="flex-1 min-h-0 overflow-auto p-6">
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xs">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">
              <tr>
                {currentReport.columns.map((col) => (
                  <th
                    key={col.key}
                    className={`py-2.5 px-4 ${
                      col.align === 'right'
                        ? 'text-right'
                        : col.align === 'center'
                        ? 'text-center'
                        : 'text-left'
                    }`}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
              {currentReport.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={currentReport.columns.length}
                    className="py-12 text-center text-slate-400"
                  >
                    {tr(
                      language,
                      'Aucune donnée à afficher pour ce rapport.',
                      'No data to display for this report.',
                      'Geen gegevens om weer te geven voor dit rapport.'
                    )}
                  </td>
                </tr>
              ) : (
                currentReport.rows.map((row, idx) => (
                  <tr
                    key={idx}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    {currentReport.columns.map((col) => {
                      const val = row[col.key];
                      const formatted =
                        typeof val === 'number' && !Number.isInteger(val)
                          ? val.toFixed(2).replace('.', ',')
                          : String(val ?? '—');
                      const isRefCol =
                        (col.key === 'reference' || col.key === 'product_ref') &&
                        formatted &&
                        formatted !== '—';
                      return (
                        <td
                          key={col.key}
                          className={`py-2.5 px-4 ${
                            col.align === 'right'
                              ? 'text-right font-mono'
                              : col.align === 'center'
                              ? 'text-center'
                              : 'text-left'
                          }`}
                        >
                          {isRefCol ? (
                            <ProductRefLink
                              productId={
                                row.product_id || row.productId
                                  ? String(row.product_id || row.productId)
                                  : undefined
                              }
                              reference={formatted}
                            />
                          ) : (
                            formatted
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Email Dispatch Modal (Lot 3.4) */}
      {emailModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEmailModalOpen(false);
          }}
        >
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail className="w-5 h-5 text-orange-600" />
                <h2 className="text-base font-black text-slate-900 dark:text-white">
                  {tr(
                    language,
                    'Envoyer le rapport par e-mail',
                    'Send report by email',
                    'Rapport per e-mail verzenden'
                  )}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setEmailModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSendReportEmail} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {tr(language, 'Destinataire(s) *', 'Recipient(s) *', 'Ontvanger(s) *')}
                </label>
                <input
                  type="text"
                  required
                  data-testid="reports-email-recipient-input"
                  value={emailRecipient}
                  onChange={(e) => setEmailRecipient(e.target.value)}
                  placeholder="responsable@entreprise.com"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-semibold"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {tr(language, 'Objet', 'Subject', 'Onderwerp')}
                </label>
                <input
                  type="text"
                  required
                  data-testid="reports-email-subject-input"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>

              {/* Attachments Checkboxes */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Paperclip className="w-3.5 h-3.5 text-orange-600" />
                    {tr(language, 'Pièces jointes (Base64)', 'Attachments (Base64)', 'Bijlagen (Base64)')}
                  </span>
                  <span
                    data-testid="reports-attachments-size"
                    className={`font-mono text-[11px] font-bold ${
                      preparedAttachments.exceedsLimit
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-slate-500'
                    }`}
                  >
                    {formatByteSize(preparedAttachments.totalBytes)} /{' '}
                    {formatByteSize(MAX_REPORT_ATTACHMENT_TOTAL_BYTES)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <label className="inline-flex items-center gap-2 cursor-pointer font-semibold">
                    <input
                      type="checkbox"
                      data-testid="reports-attach-csv-checkbox"
                      checked={attachCsv}
                      onChange={(e) => setAttachCsv(e.target.checked)}
                      className="rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                    />
                    <span>
                      {tr(language, 'Joindre CSV', 'Attach CSV', 'CSV bijvoegen')} (
                      {formatByteSize(preparedAttachments.csvBytes)})
                    </span>
                  </label>

                  <label className="inline-flex items-center gap-2 cursor-pointer font-semibold">
                    <input
                      type="checkbox"
                      data-testid="reports-attach-pdf-checkbox"
                      checked={attachPdf}
                      onChange={(e) => setAttachPdf(e.target.checked)}
                      className="rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                    />
                    <span>
                      {tr(language, 'Joindre PDF', 'Attach PDF', 'PDF bijvoegen')} (
                      {formatByteSize(preparedAttachments.pdfBytes)})
                    </span>
                  </label>
                </div>

                {preparedAttachments.exceedsLimit && (
                  <div
                    role="alert"
                    data-testid="reports-attachment-limit-alert"
                    className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 space-y-2"
                  >
                    <div className="font-bold flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                      <span>
                        {tr(
                          language,
                          'Limite de 3 Mo dépassée (Microsoft Graph / Edge Function).',
                          '3 MB limit exceeded (Microsoft Graph / Edge Function).',
                          'Limiet van 3 MB overschreden (Microsoft Graph / Edge Function).'
                        )}
                      </span>
                    </div>
                    <p className="text-[11px]">
                      {tr(
                        language,
                        'Veuillez envoyer uniquement le fichier CSV ou réduire la période du rapport.',
                        'Please send the CSV file only or reduce the report period.',
                        'Verzend alleen het CSV-bestand of verkort de rapportperiode.'
                      )}
                    </p>
                    {preparedAttachments.canFallbackToCsvOnly && attachPdf && (
                      <button
                        type="button"
                        data-testid="reports-fallback-csv-only-btn"
                        onClick={() => {
                          setAttachCsv(true);
                          setAttachPdf(false);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] cursor-pointer"
                      >
                        {tr(
                          language,
                          'Envoyer le CSV seul',
                          'Send CSV only',
                          'Alleen CSV verzenden'
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="text-[11px] text-slate-400">
                {tr(
                  language,
                  "L'envoi utilise l'expéditeur configuré pour l'application « rpt » (Rapports) et journalise l'opération de manière conforme au RGPD (destinataires masqués, aucun contenu stocké).",
                  'Sending uses the sender configured for app "rpt" (Reports) and logs the operation in GDPR compliance (masked recipients, no content stored).',
                  'Verzending gebruikt de afzender die is geconfigureerd voor app "rpt" (Rapporten) en logt AVG-conform (gemaskeerde ontvangers, geen inhoud opgeslagen).'
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEmailModalOpen(false)}
                  className="px-4 py-2 rounded-lg font-bold border border-slate-200 dark:border-slate-700"
                >
                  {tr(language, 'Annuler', 'Cancel', 'Annuleren')}
                </button>
                <button
                  type="submit"
                  data-testid="reports-send-email-submit-btn"
                  disabled={
                    sendingEmail ||
                    !emailRecipient.trim() ||
                    preparedAttachments.exceedsLimit
                  }
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg font-bold bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white cursor-pointer"
                >
                  {sendingEmail ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {sendingEmail
                      ? tr(language, 'Envoi en cours...', 'Sending...', 'Verzenden...')
                      : tr(language, 'Envoyer', 'Send', 'Verzenden')}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
