import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Calendar,
  Download,
  ExternalLink,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  WifiOff,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { StockMovement, Product } from '../../types';
import { formatCurrency } from '../../utils/crypto';
import {
  isTransferMovement,
  getMovementSourceDepot,
  getMovementDestDepot,
  getMovementBatchId,
} from '../../services/stockMovementService';
import {
  requestGuardedNavigation,
  useRegisterUnsavedForm,
} from '../../services/unsavedChangesGuard';
import {
  buildSearchStockMovementsRpcParams,
  createDefaultMovementSearchFilters,
  doesMovementFilterExceedLocalWindow,
  filterMovementsDefault7Days,
  filterMovementsLocally,
  MovementSearchFilters,
  MovementTypeFilter,
  ReportPeriodPreset,
} from '../../services/reportsService';
import { getClientSupabase, normalizeMovementRecord } from '../../services/clientSupabase';
import { logAuditEventServer } from '../../services/auditService';
import { tr } from '../../i18n/dutchTranslator';
import { SearchableSelect } from '../../components/SearchableSelect';

export interface DesktopMovementsPageProps {
  selectedDepotFilter?: string;
  openNewMovementRequested?: boolean;
  onConsumeNewMovementRequest?: () => void;
  externalNewMovementTrigger?: number;
  globalDepotFilter?: string;
  onSelectProductForDetail?: (productId: string) => void;
}

const SERVER_PAGE_SIZE = 50;

export const DesktopMovementsPage: React.FC<DesktopMovementsPageProps> = ({
  selectedDepotFilter,
  openNewMovementRequested,
  onConsumeNewMovementRequest,
  externalNewMovementTrigger,
  globalDepotFilter = 'ALL',
  onSelectProductForDetail,
}) => {
  const {
    movements,
    products,
    depots,
    departments,
    projects,
    currentUser,
    supabaseUrl,
    supabaseKey,
    userHasPermission,
    confirmBatchMovements,
    canTransferBetweenDepots,
    openStockTransferModal,
    language,
    t,
  } = useApp();

  const isSuperAdmin =
    Number(currentUser?.role_id) === 0 || Number(currentUser?.role_id) === 1;

  const effectiveDepotFilter = selectedDepotFilter ?? globalDepotFilter ?? 'ALL';
  const locale = language === 'nl' ? 'nl-NL' : language === 'en' ? 'en-GB' : 'fr-FR';

  const [filters, setFilters] = useState<MovementSearchFilters>(() =>
    createDefaultMovementSearchFilters()
  );
  const [serverModeActive, setServerModeActive] = useState(false);
  const [serverMovements, setServerMovements] = useState<StockMovement[]>([]);
  const [serverTotalCount, setServerTotalCount] = useState<number>(0);
  const [isSearchingServer, setIsSearchingServer] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [localFallbackActive, setLocalFallbackActive] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

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

  const [selectedMovement, setSelectedMovement] = useState<StockMovement | null>(null);

  // Quick Movement Drawer State
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [movType, setMovType] = useState<'IN' | 'OUT'>('OUT');
  const [movProductId, setMovProductId] = useState<string>('');
  const [movProductSearch, setMovProductSearch] = useState('');
  const [movDepot, setMovDepot] = useState<string>('');
  const [movQuantity, setMovQuantity] = useState<number>(1);
  const [movDepartment, setMovDepartment] = useState<string>('');
  const [movSiteNumber, setMovSiteNumber] = useState<string>('');
  const [movComment, setMovComment] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (openNewMovementRequested) {
      setDrawerOpen(true);
      onConsumeNewMovementRequest?.();
    }
  }, [openNewMovementRequested, onConsumeNewMovementRequest]);

  useEffect(() => {
    if (externalNewMovementTrigger && externalNewMovementTrigger > 0) {
      setDrawerOpen(true);
    }
  }, [externalNewMovementTrigger]);

  const canViewPrices = userHasPermission('perm_prod_view_price');
  const canExportCsv = userHasPermission('perm_mov_export_csv');
  const canCreateIn = userHasPermission('perm_stock_in') || userHasPermission('perm_mov_in');
  const canCreateOut = userHasPermission('perm_mov_out');

  const productById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of products) {
      map.set(String(p.id), p);
    }
    return map;
  }, [products]);

  const getMovType = (m: StockMovement): 'IN' | 'OUT' =>
    (m.type || m.movement_type) === 'IN' ? 'IN' : 'OUT';

  const getMovQty = (m: StockMovement): number =>
    Number(m.quantity ?? m.quantity_changed ?? 0);

  const getMovDept = (m: StockMovement): string =>
    m.department || m.department_name || '';

  const getMovDepot = (m: StockMovement, prod?: Product): string =>
    m.depot_name || prod?.store_name || '';

  const getMovProductName = (m: StockMovement, prod?: Product): string =>
    prod ? `${prod.brand || ''} ${prod.model || ''}`.trim() : m.product_ref || '';

  // Respect existing movement permissions (perm_mov_view_all / depot restrictions)
  const canViewMovement = useCallback(
    (m: StockMovement): boolean => {
      if (!currentUser) return true;
      if (currentUser.is_blocked) return false;
      const roleIdNum = Number(currentUser.role_id);
      if (
        isSuperAdmin ||
        roleIdNum === 0 ||
        roleIdNum === 1 ||
        userHasPermission('perm_mov_view_all')
      ) {
        return true;
      }
      const prod = productById.get(String(m.product_id));
      const movDepot = getMovDepot(m, prod);
      const dstDepot = getMovementDestDepot(m);
      const allowed = currentUser.allowed_depots;
      const hasAllDepots =
        !allowed || allowed.length === 0 || allowed.includes('*') || allowed.includes('ALL');

      if (userHasPermission('perm_mov_view_depot')) {
        if (hasAllDepots) return true;
        if (movDepot && allowed.includes(movDepot)) return true;
        if (dstDepot && allowed.includes(dstDepot)) return true;
      }

      if (!hasAllDepots) {
        const matchesAllowedDepot =
          (movDepot && allowed.includes(movDepot)) || (dstDepot && allowed.includes(dstDepot));
        if (!matchesAllowedDepot && String(m.user_id) !== String(currentUser.id)) {
          return false;
        }
      }

      if (
        userHasPermission('perm_kpi_scope_department') &&
        currentUser.department &&
        getMovDept(m)
      ) {
        if (currentUser.department.toLowerCase().trim() === getMovDept(m).toLowerCase().trim()) {
          return true;
        }
      }

      if (String(m.user_id) === String(currentUser.id)) return true;
      if (hasAllDepots) return true;
      return false;
    },
    [currentUser, isSuperAdmin, userHasPermission, productById]
  );

  const effectiveFilters: MovementSearchFilters = useMemo(() => {
    const resolvedDepot =
      filters.depot && filters.depot !== 'ALL'
        ? filters.depot
        : effectiveDepotFilter !== 'ALL'
        ? effectiveDepotFilter
        : '';
    return {
      ...filters,
      depot: resolvedDepot,
    };
  }, [filters, effectiveDepotFilter]);

  const exceedsLocalWindow = useMemo(
    () => doesMovementFilterExceedLocalWindow(effectiveFilters),
    [effectiveFilters]
  );

  const executeServerMovementSearch = useCallback(
    async (targetFilters: MovementSearchFilters, offset: number, append: boolean) => {
      const seq = ++searchSeqRef.current;
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const offlineNow = typeof navigator !== 'undefined' && !navigator.onLine;
      const client = !offlineNow ? getClientSupabase(supabaseUrl, supabaseKey) : null;

      if (!client || offlineNow || typeof (client as any).rpc !== 'function') {
        if (seq !== searchSeqRef.current) return;
        setLocalFallbackActive(true);
        setServerModeActive(false);
        setIsSearchingServer(false);
        setIsLoadingMore(false);
        return;
      }

      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsSearchingServer(true);
      }
      setServerError(null);

      try {
        const rpcParams = buildSearchStockMovementsRpcParams(
          targetFilters,
          SERVER_PAGE_SIZE,
          offset
        );
        let rpcCall: any = client.rpc('search_stock_movements', rpcParams);
        if (rpcCall && typeof rpcCall.abortSignal === 'function') {
          rpcCall = rpcCall.abortSignal(controller.signal);
        }
        const { data, error } = await rpcCall;
        if (seq !== searchSeqRef.current || controller.signal.aborted) return;

        if (error) {
          setLocalFallbackActive(true);
          setServerModeActive(false);
          setServerError(error.message || String(error));
          return;
        }

        const rawList = Array.isArray(data) ? data : [];
        const total =
          rawList.length > 0 ? Number(rawList[0]?.total_count ?? rawList.length) : 0;
        const rows = rawList
          .map((r: any) => r?.row_data ?? r)
          .filter(Boolean)
          .map(normalizeMovementRecord)
          .filter(canViewMovement);

        setLocalFallbackActive(false);
        setServerModeActive(true);
        setServerTotalCount(total);
        setServerMovements((prev) => {
          if (!append) return rows;
          const existingIds = new Set(prev.map((m) => String(m.id)));
          const merged = [...prev];
          for (const row of rows) {
            if (!existingIds.has(String(row.id))) {
              merged.push(row);
            }
          }
          return merged;
        });
      } catch (err: any) {
        if (seq !== searchSeqRef.current || controller.signal.aborted) return;
        setLocalFallbackActive(true);
        setServerModeActive(false);
        setServerError(err?.message || null);
      } finally {
        if (seq === searchSeqRef.current) {
          setIsSearchingServer(false);
          setIsLoadingMore(false);
        }
      }
    },
    [supabaseUrl, supabaseKey, canViewMovement]
  );

  // Debounce 400ms when filter exceeds local 7d window
  useEffect(() => {
    if (!exceedsLocalWindow) {
      searchSeqRef.current += 1;
      abortControllerRef.current?.abort();
      setServerModeActive(false);
      setIsSearchingServer(false);
      setIsLoadingMore(false);
      setLocalFallbackActive(!isOnline);
      return;
    }

    const timer = setTimeout(() => {
      executeServerMovementSearch(effectiveFilters, 0, false);
    }, 400);

    return () => {
      clearTimeout(timer);
    };
  }, [effectiveFilters, exceedsLocalWindow, isOnline, executeServerMovementSearch]);

  const handleManualSearchClick = () => {
    executeServerMovementSearch(effectiveFilters, 0, false);
  };

  const handleResetFilters = () => {
    searchSeqRef.current += 1;
    abortControllerRef.current?.abort();
    setFilters(createDefaultMovementSearchFilters());
    setServerModeActive(false);
    setServerMovements([]);
    setServerTotalCount(0);
    setLocalFallbackActive(false);
    setServerError(null);
  };

  const handleLoadMore = () => {
    if (isLoadingMore || isSearchingServer) return;
    executeServerMovementSearch(effectiveFilters, serverMovements.length, true);
  };

  const permittedLocalMovements = useMemo(
    () => movements.filter(canViewMovement),
    [movements, canViewMovement]
  );

  const localFilteredMovements = useMemo(() => {
    if (!exceedsLocalWindow && filters.period === '7D') {
      const base7d = filterMovementsDefault7Days(permittedLocalMovements);
      return filterMovementsLocally(
        base7d,
        {
          ...effectiveFilters,
          period: 'ALL',
        },
        products
      );
    }
    return filterMovementsLocally(permittedLocalMovements, effectiveFilters, products);
  }, [permittedLocalMovements, products, effectiveFilters, exceedsLocalWindow, filters.period]);

  const filteredMovements = serverModeActive ? serverMovements : localFilteredMovements;
  const totalResultsCount = serverModeActive ? serverTotalCount : localFilteredMovements.length;
  const showOfflineBanner = !isOnline || localFallbackActive;

  const totals = useMemo(() => {
    let totalIn = 0;
    let totalOut = 0;
    let totalValuationOut = 0;
    for (const m of filteredMovements) {
      const qty = getMovQty(m);
      if (getMovType(m) === 'IN') {
        totalIn += qty;
      } else {
        totalOut += qty;
        const prod = productById.get(String(m.product_id));
        const lineCost =
          m.total_cost != null
            ? Number(m.total_cost)
            : qty * Number(prod?.unit_price || 0);
        totalValuationOut += lineCost;
      }
    }
    return { totalIn, totalOut, totalValuationOut };
  }, [filteredMovements, productById]);

  const handleExportCsv = () => {
    const headers = [
      tr(language, 'Date', 'Date', 'Datum'),
      tr(language, 'Type', 'Type', 'Type'),
      tr(language, 'Référence', 'Reference', 'Referentie'),
      tr(language, 'Article', 'Item', 'Artikel'),
      tr(language, 'Quantité', 'Quantity', 'Aantal'),
      tr(language, 'Dépôt source', 'Source depot', 'Brondepot'),
      tr(language, 'Dépôt destination', 'Destination depot', 'Bestemmingsdepot'),
      tr(language, 'Utilisateur', 'User', 'Gebruiker'),
      tr(language, 'Département', 'Department', 'Afdeling'),
      tr(language, 'Chantier', 'Job site', 'Werf'),
      tr(language, 'Commande', 'Order', 'Bestelling'),
      ...(canViewPrices ? [tr(language, 'Coût HT', 'Net Cost', 'Kostprijs excl. btw')] : []),
      tr(language, 'Commentaire', 'Comment', 'Opmerking'),
    ];
    const lines = [headers.join(';')];
    for (const m of filteredMovements) {
      const prod = productById.get(String(m.product_id));
      const qty = getMovQty(m);
      const isTrans = isTransferMovement(m);
      const srcDepot = getMovementSourceDepot(m) || getMovDepot(m, prod);
      const dstDepot = getMovementDestDepot(m);
      const lineCost = (
        m.total_cost != null ? Number(m.total_cost) : qty * Number(prod?.unit_price || 0)
      )
        .toFixed(2)
        .replace('.', ',');
      const row = [
        new Date(m.created_at).toLocaleString(locale),
        isTrans
          ? tr(language, 'TRANSFERT', 'TRANSFER', 'OVERDRACHT')
          : getMovType(m) === 'IN'
          ? tr(language, 'ENTRÉE', 'IN', 'IN')
          : tr(language, 'SORTIE', 'OUT', 'UIT'),
        prod?.reference || m.product_ref || '',
        getMovProductName(m, prod),
        String(qty),
        srcDepot,
        dstDepot,
        m.user_name || '',
        getMovDept(m),
        m.site_number || '',
        m.order_number || '',
        ...(canViewPrices ? [lineCost] : []),
        (m.reason || '').replace(/;/g, ','),
      ];
      lines.push(row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'));
    }
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const filename = `mouvements-stock-${new Date().toISOString().slice(0, 10)}.csv`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    logAuditEventServer({
      category: 'EXPORTS',
      type: 'csv_export',
      title: 'Export CSV des mouvements de stock (Bureau)',
      description: `${filteredMovements.length} mouvements exportés`,
      meta: {
        rows: filteredMovements.length,
        period: filters.period,
        filters: {
          type: filters.type,
          depot: filters.depot,
          department: filters.department,
          site: filters.site,
        },
        filename,
      },
    }).catch(() => {});
  };

  const performQuickMovementSave = async (): Promise<boolean> => {
    if (!movProductId || movQuantity <= 0) return false;
    const targetProd = productById.get(movProductId);
    if (!targetProd) return false;
    setSubmitting(true);
    try {
      const depotName = movDepot || targetProd.store_name || depots[0]?.name || 'Dépôt Principal';
      const productWithDepot: Product = {
        ...targetProd,
        store_name: depotName,
      };
      const res = await confirmBatchMovements(
        movSiteNumber || undefined,
        [{ product: productWithDepot, qtyActual: movQuantity }],
        movType
      );
      if (res.success) {
        setDrawerOpen(false);
        setMovComment('');
        setMovQuantity(1);
        return true;
      }
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitQuickMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    await performQuickMovementSave();
  };

  const isMovementDrawerDirty = Boolean(
    drawerOpen && (movProductId || movComment.trim() || movSiteNumber.trim())
  );

  useRegisterUnsavedForm({
    id: 'desktop-movement-drawer',
    isDirty: isMovementDrawerDirty,
    label: tr(language, 'Nouveau mouvement de stock', 'New stock movement', 'Nieuwe voorraadbeweging'),
    onSave: () => performQuickMovementSave(),
    onDiscard: () => {
      setDrawerOpen(false);
      setMovProductId('');
      setMovComment('');
      setMovQuantity(1);
    },
  });

  const handleCloseMovementDrawer = () => {
    requestGuardedNavigation(
      () => {
        setDrawerOpen(false);
      },
      ['desktop-movement-drawer']
    );
  };

  const selectableProducts = useMemo(() => {
    const q = movProductSearch.toLowerCase().trim();
    const list = q
      ? products.filter((p) =>
          `${p.reference} ${p.brand} ${p.model} ${p.barcode || ''}`
            .toLowerCase()
            .includes(q)
        )
      : products;
    return list.slice(0, 50);
  }, [products, movProductSearch]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-slate-50 dark:bg-slate-950">
      {/* Offline / Local Fallback Banner */}
      {showOfflineBanner && (
        <div
          role="status"
          data-testid="movements-local-fallback-banner"
          className="px-6 py-2 bg-amber-50 dark:bg-amber-950/60 border-b border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs font-bold flex items-center justify-between gap-2 shrink-0"
        >
          <div className="flex items-center gap-2">
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
          {serverError && (
            <span className="text-[11px] font-normal text-amber-700 dark:text-amber-300 truncate max-w-md">
              {serverError}
            </span>
          )}
        </div>
      )}

      {/* Top Toolbar */}
      <div className="px-6 py-3.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
              {t('desktop_nav_movements')}
            </h1>
            <span
              data-testid="movements-results-count"
              className="px-2.5 py-0.5 text-xs font-mono font-bold rounded-full bg-orange-50 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800"
            >
              {totalResultsCount} {tr(language, 'résultats', 'results', 'resultaten')}
            </span>
            {isSearchingServer && (
              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-600" />
                {tr(language, 'Recherche...', 'Searching...', 'Zoeken...')}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {filteredMovements.length}{' '}
            {tr(language, 'mouvement(s) affiché(s)', 'movement(s) displayed', 'beweging(en) weergegeven')} •{' '}
            {tr(language, 'Entrées :', 'Inflows:', 'Innames:')}{' '}
            <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
              +{totals.totalIn}
            </span>{' '}
            • {tr(language, 'Sorties :', 'Outflows:', 'Uitgiftes:')}{' '}
            <span className="font-mono font-bold text-rose-600 dark:text-rose-400">
              -{totals.totalOut}
            </span>
            {canViewPrices && (
              <>
                {' '}
                • {tr(language, 'Valorisation sorties :', 'Outflows valuation:', 'Waardering uitgiftes:')}{' '}
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                  {formatCurrency(totals.totalValuationOut)}
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {canExportCsv && (
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              <Download className="w-4 h-4 text-orange-500" />
              {t('desktop_export_csv')}
            </button>
          )}
          {canTransferBetweenDepots && (
            <button
              type="button"
              data-testid="desktop-movements-transfer-btn"
              onClick={() => openStockTransferModal({})}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold bg-sky-600 hover:bg-sky-700 text-white shadow-xs transition-colors cursor-pointer"
            >
              <ArrowLeftRight className="w-4 h-4" />
              {tr(
                language,
                'Transfert entre dépôts',
                'Inter-depot transfer',
                'Overdracht tussen depots'
              )}
            </button>
          )}
          {(canCreateIn || canCreateOut) && (
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white shadow-xs transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t('desktop_new_movement')}
            </button>
          )}
        </div>
      </div>

      {/* Filter Bar (Lot 2) */}
      <div className="px-6 py-3 bg-white/80 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800 space-y-2.5 shrink-0">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Type segmented control */}
          <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-0.5 text-xs font-bold">
            {(['ALL', 'IN', 'OUT', 'TRANSFER'] as MovementTypeFilter[]).map((tf) => (
              <button
                key={tf}
                type="button"
                data-testid={`desktop-movements-filter-${tf.toLowerCase()}`}
                onClick={() => setFilters((prev) => ({ ...prev, type: tf }))}
                className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                  filters.type === tf
                    ? tf === 'TRANSFER'
                      ? 'bg-sky-600 text-white shadow-2xs'
                      : 'bg-white dark:bg-slate-900 text-orange-600 dark:text-orange-400 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                {tf === 'ALL'
                  ? tr(language, 'Tous', 'All', 'Alle')
                  : tf === 'IN'
                  ? tr(language, 'Entrées', 'Inflows', 'Innames')
                  : tf === 'OUT'
                  ? tr(language, 'Sorties', 'Outflows', 'Uitgiftes')
                  : tr(language, 'Transferts', 'Transfers', 'Overdrachten')}
              </button>
            ))}
          </div>

          {/* Period presets (7D default) */}
          <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-0.5 text-xs font-bold">
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
                data-testid={`movements-period-${preset.toLowerCase()}`}
                onClick={() => setFilters((prev) => ({ ...prev, period: preset }))}
                className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                  filters.period === preset
                    ? 'bg-white dark:bg-slate-900 text-orange-600 dark:text-orange-400 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {filters.period === 'CUSTOM' && (
            <div className="flex items-center gap-1.5 text-xs">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <input
                type="date"
                aria-label={tr(language, 'Date de début', 'Start date', 'Startdatum')}
                value={filters.fromDate}
                onChange={(e) => setFilters((prev) => ({ ...prev, fromDate: e.target.value }))}
                className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
              />
              <span className="text-slate-400">→</span>
              <input
                type="date"
                aria-label={tr(language, 'Date de fin', 'End date', 'Einddatum')}
                value={filters.toDate}
                onChange={(e) => setFilters((prev) => ({ ...prev, toDate: e.target.value }))}
                className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
              />
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              data-testid="movements-search-btn"
              onClick={handleManualSearchClick}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Search className="w-3.5 h-3.5" />
              {tr(language, 'Rechercher', 'Search', 'Zoeken')}
            </button>

            <button
              type="button"
              data-testid="movements-reset-btn"
              onClick={handleResetFilters}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {tr(language, 'Réinitialiser', 'Reset', 'Resetten')}
            </button>
          </div>
        </div>

        {/* Detailed filter inputs */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-9 gap-2 text-xs">
          <div className="relative lg:col-span-2">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              data-testid="movements-filter-text"
              value={filters.text}
              onChange={(e) => setFilters((prev) => ({ ...prev, text: e.target.value }))}
              placeholder={tr(
                language,
                'Rechercher réf, article, chantier, commande, motif...',
                'Search ref, item, job site, order, reason...',
                'Zoek ref, artikel, werf, bestelling, reden...'
              )}
              className="w-full pl-8 pr-6 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs"
            />
            {filters.text && (
              <button
                type="button"
                onClick={() => setFilters((prev) => ({ ...prev, text: '' }))}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <input
            type="text"
            data-testid="movements-filter-reference"
            value={filters.reference}
            onChange={(e) => setFilters((prev) => ({ ...prev, reference: e.target.value }))}
            placeholder={tr(language, 'Réf. article', 'Item ref', 'Artikelref.')}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono"
          />

          <input
            type="text"
            data-testid="movements-filter-user"
            value={filters.user}
            onChange={(e) => setFilters((prev) => ({ ...prev, user: e.target.value }))}
            placeholder={tr(language, 'Opérateur / Utilisateur', 'Operator / User', 'Operator / Gebruiker')}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
          />

          <SearchableSelect
            data-testid="movements-filter-department"
            value={filters.department}
            onChange={(val) => setFilters((prev) => ({ ...prev, department: val }))}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
          >
            <option value="">
              {tr(language, 'Tous départements', 'All departments', 'Alle afdelingen')}
            </option>
            {departments.map((d) => (
              <option key={d.id} value={d.name}>
                {d.name}
              </option>
            ))}
          </SearchableSelect>

          <input
            type="text"
            data-testid="movements-filter-site"
            value={filters.site}
            onChange={(e) => setFilters((prev) => ({ ...prev, site: e.target.value }))}
            placeholder={tr(language, 'Chantier', 'Job site', 'Werf')}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono"
          />

          <input
            type="text"
            data-testid="movements-filter-order-number"
            value={filters.orderNumber}
            onChange={(e) => setFilters((prev) => ({ ...prev, orderNumber: e.target.value }))}
            placeholder={tr(language, 'N° commande', 'Order #', 'Bestelnr.')}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono"
          />

          <SearchableSelect
            data-testid="movements-filter-depot"
            value={filters.depot}
            onChange={(val) => setFilters((prev) => ({ ...prev, depot: val }))}
            recentKey="depots"
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
          >
            <option value="">{tr(language, 'Tous dépôts', 'All depots', 'Alle depots')}</option>
            {depots.map((d) => (
              <option key={d.id} value={d.name}>
                {d.name}
              </option>
            ))}
          </SearchableSelect>

          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              step="0.01"
              data-testid="movements-filter-min-cost"
              value={filters.minCost}
              onChange={(e) => setFilters((prev) => ({ ...prev, minCost: e.target.value }))}
              placeholder={tr(language, 'Min €', 'Min €', 'Min €')}
              className="w-1/2 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono"
            />
            <input
              type="number"
              min={0}
              step="0.01"
              data-testid="movements-filter-max-cost"
              value={filters.maxCost}
              onChange={(e) => setFilters((prev) => ({ ...prev, maxCost: e.target.value }))}
              placeholder={tr(language, 'Max €', 'Max €', 'Max €')}
              className="w-1/2 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono"
            />
          </div>
        </div>
      </div>

      {/* Main Content Split: Table + Detail Drawer */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 overflow-auto">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <tr>
                <th className="py-2.5 px-4">{tr(language, 'Date / Heure', 'Date / Time', 'Datum / Tijd')}</th>
                <th className="py-2.5 px-3">{tr(language, 'Type', 'Type', 'Type')}</th>
                <th className="py-2.5 px-4">{tr(language, 'Article', 'Item', 'Artikel')}</th>
                <th className="py-2.5 px-3 text-right">{tr(language, 'Quantité', 'Quantity', 'Aantal')}</th>
                <th className="py-2.5 px-3">{tr(language, 'Dépôt', 'Depot', 'Depot')}</th>
                <th className="py-2.5 px-3">{tr(language, 'Opérateur / Dépt', 'Operator / Dept', 'Operator / Afd')}</th>
                <th className="py-2.5 px-3">{tr(language, 'Chantier / Commande', 'Site / Order', 'Werf / Bestelling')}</th>
                {canViewPrices && (
                  <th className="py-2.5 px-4 text-right">{tr(language, 'Coût HT', 'Net Cost', 'Kostprijs')}</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/70 text-xs bg-white dark:bg-slate-900">
              {filteredMovements.length === 0 ? (
                <tr>
                  <td
                    colSpan={canViewPrices ? 8 : 7}
                    className="py-12 text-center text-slate-400 dark:text-slate-500"
                  >
                    {tr(
                      language,
                      'Aucun mouvement ne correspond aux filtres sélectionnés.',
                      'No movement matches the selected filters.',
                      'Geen bewegingen gevonden voor de geselecteerde filters.'
                    )}
                  </td>
                </tr>
              ) : (
                filteredMovements.map((m, idx) => {
                  const prod = productById.get(String(m.product_id));
                  const isSelected = selectedMovement?.id === m.id;
                  const mType = getMovType(m);
                  const isTrans = isTransferMovement(m);
                  const srcDepot = getMovementSourceDepot(m) || getMovDepot(m, prod);
                  const dstDepot = getMovementDestDepot(m);
                  const batchId = getMovementBatchId(m);
                  const prevBatchId =
                    idx > 0 ? getMovementBatchId(filteredMovements[idx - 1]) : null;
                  const isNewBatchHeader = Boolean(
                    batchId &&
                      batchId !== prevBatchId &&
                      filteredMovements.filter((x) => getMovementBatchId(x) === batchId).length > 1
                  );
                  const batchSiblingsCount = isNewBatchHeader
                    ? filteredMovements.filter((x) => getMovementBatchId(x) === batchId).length
                    : 0;
                  const qty = getMovQty(m);
                  const lineTotal =
                    m.total_cost != null
                      ? Number(m.total_cost)
                      : qty * Number(prod?.unit_price || 0);
                  const deptName = getMovDept(m);

                  return (
                    <React.Fragment key={m.id}>
                      {isNewBatchHeader && (
                        <tr
                          data-testid={`desktop-transfer-batch-row-${batchId}`}
                          className="bg-sky-50/90 dark:bg-sky-950/40 border-t-2 border-sky-300 dark:border-sky-800"
                        >
                          <td
                            colSpan={canViewPrices ? 8 : 7}
                            className="py-1.5 px-4 text-[11px] font-black text-sky-800 dark:text-sky-200"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1.5">
                                <ArrowLeftRight className="w-3.5 h-3.5 text-sky-600" />
                                {tr(
                                  language,
                                  `Lot de transfert (${batchSiblingsCount} lignes) : ${srcDepot} → ${dstDepot}`,
                                  `Transfer batch (${batchSiblingsCount} lines): ${srcDepot} → ${dstDepot}`,
                                  `Overdrachtsbatch (${batchSiblingsCount} regels): ${srcDepot} → ${dstDepot}`
                                )}
                              </span>
                              {m.reason && (
                                <span className="font-normal italic text-sky-700 dark:text-sky-300">
                                  « {m.reason} »
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                      <tr
                        onClick={() => setSelectedMovement(m)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-orange-50/90 dark:bg-orange-950/40'
                            : batchId
                            ? 'bg-sky-50/20 dark:bg-sky-950/10 hover:bg-sky-50/50 dark:hover:bg-sky-950/30 border-l-4 border-l-sky-400'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                        }`}
                      >
                        <td className="py-2.5 px-4 font-mono text-[11px] text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {new Date(m.created_at).toLocaleString(locale, {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {isTrans ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                              <ArrowLeftRight className="w-3.5 h-3.5" />
                              {tr(language, 'TRANSFERT', 'TRANSFER', 'OVERDRACHT')}
                            </span>
                          ) : mType === 'IN' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                              <ArrowDownLeft className="w-3.5 h-3.5" />
                              {tr(language, 'ENTRÉE', 'IN', 'IN')}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300">
                              <ArrowUpRight className="w-3.5 h-3.5" />
                              {tr(language, 'SORTIE', 'OUT', 'UIT')}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="font-bold text-slate-900 dark:text-white">
                            {getMovProductName(m, prod)}
                          </div>
                          {(prod?.reference || m.product_ref) && (
                            <div className="font-mono text-[11px] text-slate-500">
                              {prod?.reference || m.product_ref}
                            </div>
                          )}
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right font-mono font-black ${
                            isTrans
                              ? 'text-sky-600 dark:text-sky-400'
                              : mType === 'IN'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {isTrans ? qty : mType === 'IN' ? `+${qty}` : `-${qty}`}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                          {isTrans && srcDepot && dstDepot ? (
                            <span className="font-semibold text-sky-700 dark:text-sky-300">
                              {srcDepot} → {dstDepot}
                            </span>
                          ) : (
                            getMovDepot(m, prod) || '—'
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-slate-800 dark:text-slate-200">
                            {m.user_name || '—'}
                          </div>
                          {deptName && (
                            <div className="text-[11px] text-slate-500">{deptName}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          {m.site_number && (
                            <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                              {m.site_number}
                            </span>
                          )}
                          {m.order_number && (
                            <div className="font-mono text-[11px] text-orange-600 dark:text-orange-400">
                              {m.order_number}
                            </div>
                          )}
                          {isTrans && m.reason && !m.site_number && !m.order_number && (
                            <span className="text-[11px] italic text-slate-500">{m.reason}</span>
                          )}
                          {!m.site_number && !m.order_number && !(isTrans && m.reason) && (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        {canViewPrices && (
                          <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-700 dark:text-slate-300">
                            {formatCurrency(lineTotal)}
                          </td>
                        )}
                      </tr>
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>

          {/* Pagination: Charger plus */}
          {serverModeActive && serverMovements.length < serverTotalCount && (
            <div className="p-4 text-center bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                data-testid="movements-load-more-btn"
                disabled={isLoadingMore}
                onClick={handleLoadMore}
                className="py-2 px-6 rounded-lg text-xs font-bold bg-orange-50 dark:bg-orange-950/50 border border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-300 hover:bg-orange-100 transition-colors cursor-pointer disabled:opacity-50"
              >
                {isLoadingMore
                  ? tr(language, 'Chargement...', 'Loading...', 'Laden...')
                  : `${tr(language, 'Charger plus', 'Load more', 'Meer laden')} (${serverMovements.length} / ${serverTotalCount})`}
              </button>
            </div>
          )}
        </div>

        {/* Right Detail Panel for Selected Movement */}
        {selectedMovement && (
          <aside className="w-96 shrink-0 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 overflow-y-auto flex flex-col gap-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {tr(language, 'Détail du mouvement', 'Movement detail', 'Bewegingsdetail')}
                </span>
                <h2 className="text-sm font-black text-slate-900 dark:text-white mt-0.5">
                  {getMovProductName(
                    selectedMovement,
                    productById.get(String(selectedMovement.product_id))
                  )}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMovement(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">{tr(language, 'Opération', 'Operation', 'Bewerking')}</span>
                <span
                  className={`font-mono font-black ${
                    getMovType(selectedMovement) === 'IN'
                      ? 'text-emerald-600'
                      : 'text-rose-600'
                  }`}
                >
                  {getMovType(selectedMovement) === 'IN'
                    ? `${tr(language, 'ENTRÉE', 'IN', 'IN')} +${getMovQty(selectedMovement)}`
                    : `${tr(language, 'SORTIE', 'OUT', 'UIT')} -${getMovQty(selectedMovement)}`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{tr(language, 'Date & heure', 'Date & time', 'Datum & tijd')}</span>
                <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                  {new Date(selectedMovement.created_at).toLocaleString(locale)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{tr(language, 'Opérateur', 'Operator', 'Operator')}</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {selectedMovement.user_name || '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{tr(language, 'Dépôt', 'Depot', 'Depot')}</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {getMovDepot(
                    selectedMovement,
                    productById.get(String(selectedMovement.product_id))
                  ) || '—'}
                </span>
              </div>
              {getMovDept(selectedMovement) && (
                <div className="flex justify-between">
                  <span className="text-slate-500">{tr(language, 'Département', 'Department', 'Afdeling')}</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {getMovDept(selectedMovement)}
                  </span>
                </div>
              )}
              {selectedMovement.site_number && (
                <div className="flex justify-between">
                  <span className="text-slate-500">{tr(language, 'Chantier / Projet', 'Job site / Project', 'Werf / Project')}</span>
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                    {selectedMovement.site_number}
                  </span>
                </div>
              )}
              {selectedMovement.order_number && (
                <div className="flex justify-between">
                  <span className="text-slate-500">{tr(language, 'N° Commande', 'Order #', 'Bestelnr.')}</span>
                  <span className="font-mono font-bold text-orange-600 dark:text-orange-400">
                    {selectedMovement.order_number}
                  </span>
                </div>
              )}
              {selectedMovement.reason && (
                <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                  <span className="text-slate-500 block mb-1">{tr(language, 'Commentaire', 'Comment', 'Opmerking')}</span>
                  <p className="text-slate-800 dark:text-slate-200 font-medium">
                    {selectedMovement.reason}
                  </p>
                </div>
              )}
            </div>

            {productById.has(String(selectedMovement.product_id)) && (
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
                <div className="text-[11px] font-bold uppercase text-slate-400">
                  {tr(language, 'Article associé', 'Associated item', 'Gekoppeld artikel')}
                </div>
                {(() => {
                  const p = productById.get(String(selectedMovement.product_id))!;
                  return (
                    <>
                      <div className="font-mono text-xs font-bold text-orange-600">
                        {p.reference}
                      </div>
                      <div className="font-bold text-slate-900 dark:text-white">
                        {p.brand} {p.model}
                      </div>
                      <div className="text-slate-500">
                        {tr(language, 'Stock actuel :', 'Current stock:', 'Huidige voorraad:')}{' '}
                        <strong className="font-mono text-slate-900 dark:text-white">
                          {p.quantity}
                        </strong>{' '}
                        ({p.rack_location || tr(language, 'Sans emplacement', 'No location', 'Geen locatie')})
                      </div>
                      {onSelectProductForDetail && (
                        <button
                          type="button"
                          onClick={() => onSelectProductForDetail(String(p.id))}
                          className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 dark:bg-slate-800 hover:bg-orange-50 dark:hover:bg-orange-950/50 text-slate-800 dark:text-slate-200 hover:text-orange-600 transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          {tr(language, 'Ouvrir la fiche article', 'Open product details', 'Productfiche openen')}
                        </button>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </aside>
        )}
      </div>

      {/* Quick New Movement Drawer */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex justify-end"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseMovementDrawer();
          }}
        >
          <div className="w-full max-w-md bg-white dark:bg-slate-900 h-full shadow-2xl border-l border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="text-base font-black text-slate-900 dark:text-white">
                {tr(language, 'Enregistrer un mouvement', 'Record a movement', 'Beweging registreren')}
              </h2>
              <button
                type="button"
                onClick={handleCloseMovementDrawer}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={handleSubmitQuickMovement}
              className="flex-1 overflow-y-auto p-6 space-y-4 text-xs"
            >
              <div className="grid grid-cols-2 gap-2">
                {canCreateOut && (
                  <button
                    type="button"
                    onClick={() => setMovType('OUT')}
                    className={`py-2.5 px-3 rounded-xl font-bold border flex items-center justify-center gap-2 ${
                      movType === 'OUT'
                        ? 'border-rose-500 bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <ArrowUpRight className="w-4 h-4" />
                    {tr(language, 'Sortie de stock', 'Stock Outflow', 'Voorraaduitgifte')}
                  </button>
                )}
                {canCreateIn && (
                  <button
                    type="button"
                    onClick={() => setMovType('IN')}
                    className={`py-2.5 px-3 rounded-xl font-bold border flex items-center justify-center gap-2 ${
                      movType === 'IN'
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <ArrowDownLeft className="w-4 h-4" />
                    {tr(language, 'Entrée en stock', 'Stock Inflow', 'Voorraadinname')}
                  </button>
                )}
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {tr(language, "Rechercher l'article", 'Search item', 'Zoek artikel')}
                </label>
                <input
                  type="text"
                  value={movProductSearch}
                  onChange={(e) => setMovProductSearch(e.target.value)}
                  placeholder={tr(
                    language,
                    'Référence, code-barres ou modèle...',
                    'Reference, barcode, or model...',
                    'Referentie, streepjescode of model...'
                  )}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 mb-2"
                />
                <SearchableSelect
                  required
                  value={movProductId}
                  onChange={(val) => {
                    setMovProductId(val);
                    const p = productById.get(val);
                    if (p?.store_name) setMovDepot(p.store_name);
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-semibold"
                >
                  <option value="">
                    {tr(language, '— Choisir un article —', '— Select an item —', '— Kies een artikel —')}
                  </option>
                  {selectableProducts.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      [{p.reference}] {p.brand} {p.model} (Stock: {p.quantity})
                    </option>
                  ))}
                </SearchableSelect>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {tr(language, 'Quantité', 'Quantity', 'Aantal')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={movQuantity}
                    onChange={(e) =>
                      setMovQuantity(Math.max(1, Number(e.target.value) || 1))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {tr(language, 'Dépôt concerné', 'Target depot', 'Betrokken depot')}
                  </label>
                  <SearchableSelect
                    value={movDepot}
                    onChange={(val) => setMovDepot(val)}
                    recentKey="depots"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  >
                    {depots.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </SearchableSelect>
                </div>
              </div>

              {movType === 'OUT' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {tr(language, 'Département', 'Department', 'Afdeling')}
                    </label>
                    <SearchableSelect
                      value={movDepartment}
                      onChange={(val) => setMovDepartment(val)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                    >
                      <option value="">{tr(language, '— Aucun —', '— None —', '— Geen —')}</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.name}>
                          {d.name}
                        </option>
                      ))}
                    </SearchableSelect>
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {tr(language, 'Chantier / Projet', 'Job site / Project', 'Werf / Project')}
                    </label>
                    <input
                      type="text"
                      list="desktop-mov-projects"
                      value={movSiteNumber}
                      onChange={(e) => setMovSiteNumber(e.target.value)}
                      placeholder="Ex: CH-2026-01"
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                    />
                    <datalist id="desktop-mov-projects">
                      {projects.map((pr) => (
                        <option key={pr.id} value={pr.project_number}>
                          {pr.project_name}
                        </option>
                      ))}
                    </datalist>
                  </div>
                </div>
              )}

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {tr(language, 'Motif / Commentaire', 'Reason / Comment', 'Reden / Opmerking')}
                </label>
                <textarea
                  rows={3}
                  value={movComment}
                  onChange={(e) => setMovComment(e.target.value)}
                  placeholder={tr(
                    language,
                    'Référence BL, motif de sortie...',
                    'Delivery note ref, outflow reason...',
                    'Leveringsbon ref, reden van uitgifte...'
                  )}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleCloseMovementDrawer}
                  className="px-4 py-2 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                >
                  {t('common_cancel')}
                </button>
                <button
                  type="submit"
                  disabled={!movProductId || submitting}
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white"
                >
                  {submitting
                    ? tr(language, 'Enregistrement...', 'Saving...', 'Opslaan...')
                    : tr(language, 'Valider le mouvement', 'Confirm movement', 'Beweging bevestigen')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
