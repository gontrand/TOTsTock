import React, { useEffect, useMemo, useRef, useState } from 'react';
import { tr } from '../../i18n/dutchTranslator';
import { useApp } from '../../context/AppContext';
import { formatCurrency, isUserAllowedForDepot, playScanBeep } from '../../utils/crypto';
import { findCatalogProductByCode } from '../../services/orderPickingLogic';
import {
  buildClosedDepotNamesSet,
  buildInventoryCsvContent,
  computeSelectionAfterClick,
  createInitialBarcodeBurstState,
  DEFAULT_INVENTORY_COLUMNS,
  filterInventoryProducts,
  getProductDisplayLocation,
  getProductStockState,
  INVENTORY_COLUMNS_STORAGE_KEY,
  INVENTORY_DENSITY_STORAGE_KEY,
  InventoryColumnId,
  InventorySortColumn,
  InventoryStockStatusFilter,
  isEditableEventTarget,
  processKeyForBarcodeBurst,
  SortDirection,
  sortInventoryProducts,
  toggleSelectAllVisible,
} from '../../services/desktopInventoryLogic';
import { DesktopProductDetailPanel } from '../components/DesktopProductDetailPanel';
import { registerDesktopInlinePanel } from '../../services/desktopInlinePanelRegistry';
import { DesktopProductFormDrawer } from '../components/DesktopProductFormDrawer';
import { SearchableSelect } from '../../components/SearchableSelect';
import { requestGuardedNavigation } from '../../services/unsavedChangesGuard';
import { copyToClipboard } from '../../services/clipboard';
import { logAuditEventServer } from '../../services/auditService';
import {
  readLocalPreferenceValue,
  setUserPreference,
  subscribeUserPreferences,
} from '../../services/userPreferencesService';
import {
  Search,
  Filter,
  Plus,
  Printer,
  Download,
  Upload,
  Columns,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ArrowLeftRight,
  Barcode,
  AlertTriangle,
  Copy,
  ExternalLink,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';

const VIRTUALIZATION_THRESHOLD = 200;

interface DesktopInventoryPageProps {
  externalSearchFocusTrigger?: number;
  externalNewProductTrigger?: number;
  globalDepotFilter?: string;
  onOpenCsvImportModal?: () => void;
}

export const DesktopInventoryPage: React.FC<DesktopInventoryPageProps> = ({
  externalSearchFocusTrigger,
  externalNewProductTrigger,
  globalDepotFilter,
  onOpenCsvImportModal,
}) => {
  const {
    products,
    stockLevels,
    depots,
    subCategories,
    activeProductId,
    setActiveProductId,
    productFormState,
    setProductFormState,
    setPrintLabelsModal,
    setScanState,
    addToCart,
    setBatchCartModalOpen,
    userHasPermission,
    currentUser,
    canTransferBetweenDepots,
    openStockTransferModal,
    language,
    t,
  } = useApp();

  // Permissions
  const canManageDepots = userHasPermission('perm_manage_depots');
  const isLambdaUser = !canManageDepots;
  const canEditProduct = userHasPermission('perm_prod_edit');
  const canCreateProduct = userHasPermission('perm_action_create_prod') || canEditProduct;
  const canViewPrices = userHasPermission('perm_prod_view_price');
  const canPrintLabels = userHasPermission('perm_menu_print_labels');
  const canExportCsv = userHasPermission('perm_mov_export_csv') || userHasPermission('perm_prod_view');

  // Le panneau latéral remplace la fiche modale tant que cette page est affichée
  useEffect(() => {
    const unregister = registerDesktopInlinePanel();
    return () => {
      // En quittant la page, on ferme aussi le panneau : sinon la fiche modale s'ouvrirait à sa place.
      setActiveProductId(null);
      unregister();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filter state (same defaults as mobile InventoryView)
  const [filterPaneOpen, setFilterPaneOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [stockStatus, setStockStatus] = useState<InventoryStockStatusFilter>('ALL');
  const [selectedSubCat, setSelectedSubCat] = useState('');
  const [selectedStore, setSelectedStore] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [roomQuery, setRoomQuery] = useState('');
  const [shelfQuery, setShelfQuery] = useState('');
  const [includeClosedDepots, setIncludeClosedDepots] = useState(true);

  useEffect(() => {
    if (globalDepotFilter !== undefined) {
      setSelectedStore(globalDepotFilter === 'ALL' ? '' : globalDepotFilter);
    }
  }, [globalDepotFilter]);

  // Sort state
  const [sortColumn, setSortColumn] = useState<InventorySortColumn>('designation');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Persisted column visibility
  const [visibleColumns, setVisibleColumns] = useState<InventoryColumnId[]>(() => {
    try {
      const prefCols = readLocalPreferenceValue('desktop_inventory_columns');
      if (Array.isArray(prefCols) && prefCols.length > 0) {
        return prefCols as InventoryColumnId[];
      }
      const saved = localStorage.getItem(INVENTORY_COLUMNS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // Ignore
    }
    return DEFAULT_INVENTORY_COLUMNS;
  });

  const [columnsDropdownOpen, setColumnsDropdownOpen] = useState(false);

  // Persisted density ('normal' | 'compact')
  const [density, setDensity] = useState<'normal' | 'compact'>(() => {
    try {
      const prefDensity = readLocalPreferenceValue('desktop_inventory_density');
      if (prefDensity === 'compact' || prefDensity === 'normal') return prefDensity;
      const saved = localStorage.getItem(INVENTORY_DENSITY_STORAGE_KEY);
      if (saved === 'compact' || saved === 'normal') return saved;
    } catch {
      // Ignore
    }
    return 'normal';
  });

  useEffect(() => {
    return subscribeUserPreferences((prefs) => {
      if (Array.isArray(prefs.desktop_inventory_columns) && prefs.desktop_inventory_columns.length > 0) {
        setVisibleColumns(prefs.desktop_inventory_columns as InventoryColumnId[]);
      }
      if (prefs.desktop_inventory_density === 'compact' || prefs.desktop_inventory_density === 'normal') {
        setDensity(prefs.desktop_inventory_density);
      }
    });
  }, []);

  // Selection state (checkboxes + Shift+Click)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);

  // Unknown USB barcode alert
  const [unknownScannedCode, setUnknownScannedCode] = useState<string | null>(null);
  const [lastUsbScannedRef, setLastUsbScannedRef] = useState<string | null>(null);
  const [prefillNewCode, setPrefillNewCode] = useState<string | null>(null);

  // Right-click Context Menu
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    productId: string;
  } | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    if (externalSearchFocusTrigger && externalSearchFocusTrigger > 0) {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
  }, [externalSearchFocusTrigger]);

  useEffect(() => {
    if (externalNewProductTrigger && externalNewProductTrigger > 0 && canCreateProduct) {
      setPrefillNewCode(null);
      setProductFormState({ open: true, product: null });
    }
  }, [externalNewProductTrigger, canCreateProduct, setProductFormState]);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  // Always-active USB Barcode Scanner Burst Listener (< 50ms inter-key delay + Enter)
  const burstStateRef = useRef(createInitialBarcodeBurstState());

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const editable = isEditableEventTarget(e.target);
      const step = processKeyForBarcodeBurst(
        burstStateRef.current,
        e.key,
        typeof e.timeStamp === 'number' && e.timeStamp > 0 ? e.timeStamp : performance.now(),
        {
          isEditableTarget: editable,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
        }
      );
      burstStateRef.current = step.state;

      if (step.committedCode) {
        e.preventDefault();
        const found = findCatalogProductByCode(step.committedCode, products);
        if (found) {
          playScanBeep();
          setUnknownScannedCode(null);
          setLastUsbScannedRef(found.reference);
          setActiveProductId(found.id);
        } else {
          setUnknownScannedCode(step.committedCode);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [products, setActiveProductId]);

  const closedDepotNames = useMemo(() => buildClosedDepotNamesSet(depots), [depots]);
  const hasClosedDepots = closedDepotNames.size > 0;

  const uniqueStores = useMemo(() => {
    const names = new Set<string>();
    depots.forEach((d) => {
      if (d.name) names.add(d.name);
    });
    products.forEach((p) => {
      if (p.store_name) names.add(p.store_name);
    });
    (stockLevels || []).forEach((sl) => {
      if (sl.depot_name) names.add(sl.depot_name);
    });
    const raw = Array.from(names).filter((st) => isUserAllowedForDepot(currentUser, st));
    if (isLambdaUser) {
      return raw.filter((st) => !closedDepotNames.has(st.toLowerCase().trim()));
    }
    return raw;
  }, [depots, products, stockLevels, currentUser, isLambdaUser, closedDepotNames]);

  const uniqueSuppliers = useMemo(() => {
    const s = new Set<string>();
    products.forEach((p) => {
      if (p.supplier_1_name) s.add(p.supplier_1_name);
      if (p.supplier_2_name) s.add(p.supplier_2_name);
    });
    return Array.from(s);
  }, [products]);

  const subCatMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const sc of subCategories) {
      m.set(Number(sc.id), sc.name);
    }
    return m;
  }, [subCategories]);

  // Filter + Sort
  const filteredAndSortedProducts = useMemo(() => {
    const filtered = filterInventoryProducts(
      products,
      {
        searchQuery,
        stockStatus,
        selectedSubCat,
        selectedStore,
        selectedSupplier,
        roomQuery,
        shelfQuery,
      },
      {
        isLambdaUser,
        includeClosedDepots,
        closedDepotNames,
        stockLevels,
        currentUser,
      }
    );
    return sortInventoryProducts(filtered, sortColumn, sortDirection, subCategories);
  }, [
    products,
    stockLevels,
    currentUser,
    searchQuery,
    stockStatus,
    selectedSubCat,
    selectedStore,
    selectedSupplier,
    roomQuery,
    shelfQuery,
    isLambdaUser,
    includeClosedDepots,
    closedDepotNames,
    sortColumn,
    sortDirection,
    subCategories,
  ]);

  const orderedIds = useMemo(
    () => filteredAndSortedProducts.map((p) => p.id),
    [filteredAndSortedProducts]
  );

  // Keyboard ↑ / ↓ / Enter navigation on table rows when not typing in an input
  useEffect(() => {
    const handleRowNav = (e: KeyboardEvent) => {
      if (isEditableEventTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (orderedIds.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const curIdx = activeProductId ? orderedIds.indexOf(activeProductId) : -1;
        const nextIdx = curIdx < orderedIds.length - 1 ? curIdx + 1 : 0;
        setActiveProductId(orderedIds[nextIdx]);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const curIdx = activeProductId ? orderedIds.indexOf(activeProductId) : 0;
        const prevIdx = curIdx > 0 ? curIdx - 1 : orderedIds.length - 1;
        setActiveProductId(orderedIds[prevIdx]);
      } else if (e.key === 'Escape' && activeProductId) {
        setActiveProductId(null);
      }
    };
    window.addEventListener('keydown', handleRowNav);
    return () => window.removeEventListener('keydown', handleRowNav);
  }, [orderedIds, activeProductId, setActiveProductId]);

  const handleSortClick = (col: InventorySortColumn) => {
    if (sortColumn === col) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(col);
      setSortDirection('asc');
    }
  };

  const toggleColumnVisibility = (colId: InventoryColumnId) => {
    setVisibleColumns((prev) => {
      const next = prev.includes(colId)
        ? prev.filter((c) => c !== colId)
        : [...prev, colId];
      if (next.length === 0) return prev;
      try {
        setUserPreference('desktop_inventory_columns', next);
      } catch {
        try {
          localStorage.setItem(INVENTORY_COLUMNS_STORAGE_KEY, JSON.stringify(next));
        } catch {}
      }
      return next;
    });
  };

  const toggleDensity = (nextDensity: 'normal' | 'compact') => {
    setDensity(nextDensity);
    try {
      setUserPreference('desktop_inventory_density', nextDensity);
    } catch {
      try {
        localStorage.setItem(INVENTORY_DENSITY_STORAGE_KEY, nextDensity);
      } catch {}
    }
  };

  const handleRowCheckboxClick = (productId: string, shiftKey: boolean) => {
    const res = computeSelectionAfterClick({
      currentSelectedIds: selectedIds,
      clickedId: productId,
      orderedIds,
      shiftKey,
      lastClickedId,
    });
    setSelectedIds(res.selectedIds);
    setLastClickedId(res.lastClickedId);
  };

  const handleSelectAllClick = () => {
    setSelectedIds(toggleSelectAllVisible(selectedIds, orderedIds));
  };

  const selectedProducts = useMemo(
    () => products.filter((p) => selectedIds.has(p.id)),
    [products, selectedIds]
  );

  const handleExportSelectionCsv = (itemsToExport = selectedProducts) => {
    const targetList = itemsToExport.length > 0 ? itemsToExport : filteredAndSortedProducts;
    if (targetList.length === 0) return;
    const csv = buildInventoryCsvContent(targetList, subCategories, canViewPrices);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const filename = `inventaire-tot-stock-${new Date().toISOString().slice(0, 10)}.csv`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    logAuditEventServer({
      category: 'EXPORTS',
      type: 'csv_export',
      title: 'Export CSV du catalogue / inventaire (Bureau)',
      description: `${targetList.length} articles exportés`,
      meta: {
        rows: targetList.length,
        filters: {
          depot: selectedStore,
          category: selectedSubCat,
          stockStatus,
        },
        filename,
      },
    }).catch(() => {});
  };

  const handleBulkMovement = () => {
    for (const p of selectedProducts) {
      addToCart(p, -1);
    }
    setBatchCartModalOpen(true);
  };

  const handleBulkPrintLabels = () => {
    const firstId = selectedProducts[0]?.id || null;
    setPrintLabelsModal({ open: true, initialProductId: firstId });
  };

  // Virtualization (> 200 rows)
  const rowHeightPx = density === 'compact' ? 36 : 46;
  const isVirtualized = filteredAndSortedProducts.length > VIRTUALIZATION_THRESHOLD;
  const viewportHeightPx = 640;
  const overscan = 12;

  const { visibleSlice, topPaddingPx, bottomPaddingPx } = useMemo(() => {
    if (!isVirtualized) {
      return {
        visibleSlice: filteredAndSortedProducts,
        topPaddingPx: 0,
        bottomPaddingPx: 0,
      };
    }
    const startIdx = Math.max(0, Math.floor(scrollTop / rowHeightPx) - overscan);
    const visibleCount = Math.ceil(viewportHeightPx / rowHeightPx) + overscan * 2;
    const endIdx = Math.min(filteredAndSortedProducts.length, startIdx + visibleCount);
    return {
      visibleSlice: filteredAndSortedProducts.slice(startIdx, endIdx),
      topPaddingPx: startIdx * rowHeightPx,
      bottomPaddingPx: Math.max(0, (filteredAndSortedProducts.length - endIdx) * rowHeightPx),
    };
  }, [isVirtualized, filteredAndSortedProducts, scrollTop, rowHeightPx]);

  const effectiveColumns = visibleColumns.filter((c) =>
    c === 'unit_price' ? canViewPrices : true
  );

  const renderSortIcon = (col: InventorySortColumn) => {
    if (sortColumn !== col) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
    return sortDirection === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-orange-600" />
    ) : (
      <ArrowDown className="w-3 h-3 text-orange-600" />
    );
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-slate-50 dark:bg-slate-950">
      {/* Left Collapsible Filter Pane */}
      {filterPaneOpen && (
        <aside
          aria-label={tr(language, "Filtres d'inventaire", 'Inventory filters', 'Voorraadfilters')}
          className="w-64 shrink-0 h-full border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col gap-4 overflow-y-auto no-print"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
              <Filter className="w-3.5 h-3.5 text-orange-600" />
              <span>{tr(language, 'Filtres', 'Filters', 'Filters')}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setStockStatus('ALL');
                setSelectedSubCat('');
                setSelectedStore('');
                setSelectedSupplier('');
                setRoomQuery('');
                setShelfQuery('');
              }}
              className="text-[11px] font-semibold text-orange-600 hover:underline cursor-pointer"
            >
              {t('inv_reset_filters')}
            </button>
          </div>

          {/* Stock Status Filter */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              {t('product_stock_state')}
            </label>
            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
              {(['ALL', 'LOW', 'OUT'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStockStatus(st)}
                  className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                    stockStatus === st
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {st === 'ALL'
                    ? t('search_all_stock')
                    : st === 'LOW'
                    ? t('search_low_stock')
                    : t('search_out_stock')}
                </button>
              ))}
            </div>
          </div>

          {/* Store / Depot */}
          <div className="space-y-1">
            <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              {t('inv_warehouse')}
            </label>
            <SearchableSelect
              value={selectedStore}
              onChange={(val) => setSelectedStore(val)}
              recentKey="depots"
              className="w-full px-2.5 py-2 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
            >
              <option value="">{t('search_store_all')}</option>
              {uniqueStores.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </SearchableSelect>
          </div>

          {/* Category */}
          <div className="space-y-1">
            <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              {t('inv_category')}
            </label>
            <SearchableSelect
              value={selectedSubCat}
              onChange={(val) => setSelectedSubCat(val)}
              className="w-full px-2.5 py-2 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
            >
              <option value="">{t('search_subcat_all')}</option>
              {subCategories.map((sc) => (
                <option key={sc.id} value={String(sc.id)}>
                  {sc.name}
                </option>
              ))}
            </SearchableSelect>
          </div>

          {/* Supplier */}
          <div className="space-y-1">
            <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              {t('inv_supplier')}
            </label>
            <SearchableSelect
              value={selectedSupplier}
              onChange={(val) => setSelectedSupplier(val)}
              className="w-full px-2.5 py-2 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
            >
              <option value="">{t('search_supplier_all')}</option>
              {uniqueSuppliers.map((sup) => (
                <option key={sup} value={sup}>
                  {sup}
                </option>
              ))}
            </SearchableSelect>
          </div>

          {/* Room / Shelf */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                {t('search_room_filter')}
              </label>
              <input
                type="text"
                value={roomQuery}
                onChange={(e) => setRoomQuery(e.target.value)}
                placeholder="Ex: Zone A"
                className="w-full px-2.5 py-1.5 rounded-lg text-xs border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                {t('search_shelf_filter')}
              </label>
              <input
                type="text"
                value={shelfQuery}
                onChange={(e) => setShelfQuery(e.target.value)}
                placeholder="Ex: Bac 4"
                className="w-full px-2.5 py-1.5 rounded-lg text-xs border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
          </div>

          {/* Manager Closed Depots Toggle */}
          {!isLambdaUser && hasClosedDepots && (
            <label className="flex items-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={includeClosedDepots}
                onChange={(e) => setIncludeClosedDepots(e.target.checked)}
                className="rounded border-slate-300 text-orange-600 focus:ring-orange-500"
              />
              <span>{t('search_include_closed_depots')}</span>
            </label>
          )}

          {/* USB Scanner Status */}
          <div className="mt-auto p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400 space-y-1">
            <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Barcode className="w-3.5 h-3.5 text-emerald-600" />
              <span>{t('desktop_usb_scanner_ready')}</span>
            </div>
            <p className="leading-snug">
              {tr(
                language,
                'Scannez un article à tout moment avec votre douchette USB pour ouvrir sa fiche.',
                'Scan any item at any time with your USB barcode reader to open its details.',
                'Scan op elk moment een artikel met uw USB-scanner om de fiche te openen.'
              )}
            </p>
            {lastUsbScannedRef && (
              <div className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400">
                {tr(language, 'Dernier scan :', 'Last scan:', 'Laatste scan:')} {lastUsbScannedRef}
              </div>
            )}
          </div>
        </aside>
      )}

      {/* Center Data Table Column */}
      <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3 no-print">
          <div className="flex items-center gap-2 flex-1 min-w-[260px] max-w-xl">
            <button
              type="button"
              onClick={() => setFilterPaneOpen((v) => !v)}
              title={
                filterPaneOpen
                  ? tr(language, 'Masquer les filtres', 'Hide filters', 'Filters verbergen')
                  : tr(language, 'Afficher les filtres', 'Show filters', 'Filters tonen')
              }
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              {filterPaneOpen ? (
                <PanelLeftClose className="w-4 h-4" />
              ) : (
                <PanelLeftOpen className="w-4 h-4" />
              )}
            </button>

            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`${t('search_placeholder')} (/)`}
                className="w-full pl-9 pr-8 py-1.5 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:border-orange-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
              {filteredAndSortedProducts.length} {t('inv_found')}
            </span>
          </div>

          {/* Right Toolbar Controls */}
          <div className="flex items-center gap-2">
            {/* Density Selector */}
            <div className="flex items-center p-0.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => toggleDensity('normal')}
                className={`px-2.5 py-1 rounded-lg transition cursor-pointer whitespace-nowrap shrink-0 ${
                  density === 'normal'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                    : 'text-slate-500'
                }`}
              >
                {t('desktop_density_normal')}
              </button>
              <button
                type="button"
                onClick={() => toggleDensity('compact')}
                className={`px-2.5 py-1 rounded-lg transition cursor-pointer whitespace-nowrap shrink-0 ${
                  density === 'compact'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                    : 'text-slate-500'
                }`}
              >
                {t('desktop_density_compact')}
              </button>
            </div>

            {/* Columns Selector */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setColumnsDropdownOpen((v) => !v)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-700 transition cursor-pointer whitespace-nowrap shrink-0"
              >
                <Columns className="w-3.5 h-3.5 text-orange-600" />
                <span>{t('desktop_columns_btn')}</span>
              </button>

              {columnsDropdownOpen && (
                <div className="absolute right-0 mt-1.5 w-52 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl p-2 z-30 text-xs space-y-1">
                  {DEFAULT_INVENTORY_COLUMNS.filter((c) =>
                    c === 'unit_price' ? canViewPrices : true
                  ).map((colId) => {
                    const colLabel =
                      colId === 'reference'
                        ? tr(language, 'Référence', 'Reference', 'Referentie')
                        : colId === 'designation'
                        ? tr(language, 'Désignation', 'Designation', 'Omschrijving')
                        : colId === 'brand'
                        ? tr(language, 'Marque', 'Brand', 'Merk')
                        : colId === 'category'
                        ? tr(language, 'Catégorie', 'Category', 'Categorie')
                        : colId === 'store_name'
                        ? tr(language, 'Dépôt', 'Depot', 'Depot')
                        : colId === 'location'
                        ? tr(language, 'Emplacement', 'Location', 'Locatie')
                        : colId === 'quantity'
                        ? tr(language, 'Quantité', 'Quantity', 'Aantal')
                        : colId === 'min_stock_alert'
                        ? tr(language, 'Seuil', 'Min Alert', 'Drempel')
                        : colId === 'unit_price'
                        ? tr(language, 'Prix HT', 'Unit Price', 'Eenheidsprijs')
                        : colId === 'status'
                        ? tr(language, 'État', 'State', 'Status')
                        : colId;
                    return (
                      <label
                        key={colId}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={visibleColumns.includes(colId)}
                          onChange={() => toggleColumnVisibility(colId)}
                          className="rounded border-slate-300 text-orange-600"
                        />
                        <span>{colLabel}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* CSV Export */}
            {canExportCsv && (
              <button
                type="button"
                onClick={() => handleExportSelectionCsv(filteredAndSortedProducts)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-700 transition cursor-pointer whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5 text-emerald-600" />
                <span>CSV</span>
              </button>
            )}

            {/* CSV Import (Lot 4) */}
            {canCreateProduct && onOpenCsvImportModal && (
              <button
                type="button"
                onClick={onOpenCsvImportModal}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-700 transition cursor-pointer whitespace-nowrap shrink-0"
              >
                <Upload className="w-3.5 h-3.5 text-sky-600" />
                <span>{t('desktop_import_csv_btn')}</span>
              </button>
            )}

            {/* New Product */}
            {canCreateProduct && (
              <button
                type="button"
                onClick={() => {
                  setPrefillNewCode(null);
                  setProductFormState({ open: true, product: null });
                }}
                className="px-3.5 py-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t('inv_new')}</span>
              </button>
            )}
          </div>
        </div>

        {/* Unknown USB Barcode Banner */}
        {unknownScannedCode && (
          <div className="mx-4 mt-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
              <span>
                <strong>{t('desktop_unknown_barcode_title')} :</strong>{' '}
                <code className="font-mono font-bold">{unknownScannedCode}</code>
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {canCreateProduct && (
                <button
                  type="button"
                  onClick={() => {
                    setPrefillNewCode(unknownScannedCode);
                    setUnknownScannedCode(null);
                    setProductFormState({ open: true, product: null });
                  }}
                  className="px-3 py-1 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-semibold cursor-pointer"
                >
                  {t('desktop_unknown_barcode_create')}
                </button>
              )}
              <button
                type="button"
                onClick={() => setUnknownScannedCode(null)}
                className="p-1 rounded hover:bg-amber-200/50 text-amber-800 dark:text-amber-200 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Bulk Selection Action Bar */}
        {selectedIds.size > 0 && (
          <div className="mx-4 mt-3 px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-800 text-white flex items-center justify-between gap-4 text-xs no-print">
            <div className="flex items-center gap-2 font-semibold">
              <span className="font-mono tabular-nums text-orange-400">{selectedIds.size}</span>
              <span>
                {tr(
                  language,
                  'référence(s) sélectionnée(s)',
                  'selected item(s)',
                  'geselecteerde referentie(s)'
                )}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {canPrintLabels && (
                <button
                  type="button"
                  onClick={handleBulkPrintLabels}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 font-semibold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-orange-400" />
                  <span>{t('desktop_bulk_print_labels')}</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleBulkMovement}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 font-semibold flex items-center gap-1.5 transition cursor-pointer"
              >
                <ArrowLeftRight className="w-3.5 h-3.5 text-emerald-400" />
                <span>{t('desktop_bulk_movement')}</span>
              </button>
              {canTransferBetweenDepots && (
                <button
                  type="button"
                  data-testid="desktop-bulk-transfer-btn"
                  onClick={() => {
                    const defaultSrc =
                      selectedStore || selectedProducts[0]?.store_name || undefined;
                    openStockTransferModal({
                      sourceDepot: defaultSrc,
                      items: selectedProducts.map((p) => ({
                        productId: p.id,
                        quantity: 1,
                      })),
                    });
                  }}
                  className="px-3 py-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/30 font-semibold flex items-center gap-1.5 transition cursor-pointer text-sky-200"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5 text-sky-400" />
                  <span>
                    {tr(
                      language,
                      'Transférer la sélection',
                      'Transfer selection',
                      'Selectie overdragen'
                    )}
                  </span>
                </button>
              )}
              {canExportCsv && (
                <button
                  type="button"
                  onClick={() => handleExportSelectionCsv(selectedProducts)}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 font-semibold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-sky-400" />
                  <span>{t('desktop_bulk_export_csv')}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="px-2.5 py-1.5 rounded-lg text-slate-300 hover:text-white cursor-pointer"
              >
                {tr(language, 'Tout désélectionner', 'Clear', 'Wissen')}
              </button>
            </div>
          </div>
        )}

        {/* Data Table Container */}
        <div className="flex-1 min-h-0 flex flex-col p-4 desktop-printable-table-area">
          <div
            ref={tableContainerRef}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            className="flex-1 min-h-0 overflow-y-auto overflow-x-auto bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800"
          >
            <table
              role="grid"
              aria-label={tr(language, "Tableau d'inventaire", 'Inventory table', 'Voorraadtabel')}
              className="w-full border-collapse bg-white dark:bg-slate-900 text-xs"
            >
              <thead className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 shadow-[0_1px_0_0_rgba(226,232,240,1)] dark:shadow-[0_1px_0_0_rgba(51,65,85,1)] text-slate-600 dark:text-slate-300 select-none">
                <tr className="bg-slate-100 dark:bg-slate-800">
                <th className="w-10 px-3 py-2.5 text-center no-print">
                  <input
                    type="checkbox"
                    checked={
                      orderedIds.length > 0 && orderedIds.every((id) => selectedIds.has(id))
                    }
                    onChange={handleSelectAllClick}
                    aria-label={tr(language, 'Tout sélectionner', 'Select all', 'Alles selecteren')}
                    className="rounded border-slate-300 text-orange-600 cursor-pointer"
                  />
                </th>

                {effectiveColumns.includes('reference') && (
                  <th
                    onClick={() => handleSortClick('reference')}
                    className="px-3 py-2.5 text-left font-bold cursor-pointer hover:text-slate-900 dark:hover:text-white"
                  >
                    <span className="inline-flex items-center gap-1">
                      <span>{tr(language, 'Référence', 'Reference', 'Referentie')}</span>
                      {renderSortIcon('reference')}
                    </span>
                  </th>
                )}

                {effectiveColumns.includes('designation') && (
                  <th
                    onClick={() => handleSortClick('designation')}
                    className="px-3 py-2.5 text-left font-bold cursor-pointer hover:text-slate-900 dark:hover:text-white"
                  >
                    <span className="inline-flex items-center gap-1">
                      <span>{tr(language, 'Désignation', 'Designation', 'Omschrijving')}</span>
                      {renderSortIcon('designation')}
                    </span>
                  </th>
                )}

                {effectiveColumns.includes('brand') && (
                  <th
                    onClick={() => handleSortClick('brand')}
                    className="px-3 py-2.5 text-left font-bold cursor-pointer hover:text-slate-900 dark:hover:text-white"
                  >
                    <span className="inline-flex items-center gap-1">
                      <span>{tr(language, 'Marque', 'Brand', 'Merk')}</span>
                      {renderSortIcon('brand')}
                    </span>
                  </th>
                )}

                {effectiveColumns.includes('category') && (
                  <th
                    onClick={() => handleSortClick('category')}
                    className="px-3 py-2.5 text-left font-bold cursor-pointer hover:text-slate-900 dark:hover:text-white"
                  >
                    <span className="inline-flex items-center gap-1">
                      <span>{tr(language, 'Catégorie', 'Category', 'Categorie')}</span>
                      {renderSortIcon('category')}
                    </span>
                  </th>
                )}

                {effectiveColumns.includes('store_name') && (
                  <th
                    onClick={() => handleSortClick('store_name')}
                    className="px-3 py-2.5 text-left font-bold cursor-pointer hover:text-slate-900 dark:hover:text-white"
                  >
                    <span className="inline-flex items-center gap-1">
                      <span>{tr(language, 'Dépôt', 'Depot', 'Depot')}</span>
                      {renderSortIcon('store_name')}
                    </span>
                  </th>
                )}

                {effectiveColumns.includes('location') && (
                  <th
                    onClick={() => handleSortClick('location')}
                    className="px-3 py-2.5 text-left font-bold cursor-pointer hover:text-slate-900 dark:hover:text-white"
                  >
                    <span className="inline-flex items-center gap-1">
                      <span>{tr(language, 'Emplacement', 'Location', 'Locatie')}</span>
                      {renderSortIcon('location')}
                    </span>
                  </th>
                )}

                {effectiveColumns.includes('quantity') && (
                  <th
                    onClick={() => handleSortClick('quantity')}
                    className="px-3 py-2.5 text-right font-bold cursor-pointer hover:text-slate-900 dark:hover:text-white"
                  >
                    <span className="inline-flex items-center justify-end gap-1">
                      <span>{tr(language, 'Quantité', 'Qty', 'Aantal')}</span>
                      {renderSortIcon('quantity')}
                    </span>
                  </th>
                )}

                {effectiveColumns.includes('min_stock_alert') && (
                  <th
                    onClick={() => handleSortClick('min_stock_alert')}
                    className="px-3 py-2.5 text-right font-bold cursor-pointer hover:text-slate-900 dark:hover:text-white"
                  >
                    <span className="inline-flex items-center justify-end gap-1">
                      <span>{tr(language, 'Seuil', 'Min', 'Drempel')}</span>
                      {renderSortIcon('min_stock_alert')}
                    </span>
                  </th>
                )}

                {effectiveColumns.includes('unit_price') && (
                  <th
                    onClick={() => handleSortClick('unit_price')}
                    className="px-3 py-2.5 text-right font-bold cursor-pointer hover:text-slate-900 dark:hover:text-white"
                  >
                    <span className="inline-flex items-center justify-end gap-1">
                      <span>{tr(language, 'Prix HT', 'Unit Price', 'Prijs')}</span>
                      {renderSortIcon('unit_price')}
                    </span>
                  </th>
                )}

                {effectiveColumns.includes('status') && (
                  <th
                    onClick={() => handleSortClick('status')}
                    className="px-3 py-2.5 text-left font-bold cursor-pointer hover:text-slate-900 dark:hover:text-white"
                  >
                    <span className="inline-flex items-center gap-1">
                      <span>{tr(language, 'État', 'State', 'Status')}</span>
                      {renderSortIcon('status')}
                    </span>
                  </th>
                )}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800">
              {topPaddingPx > 0 && (
                <tr style={{ height: `${topPaddingPx}px` }} aria-hidden="true">
                  <td colSpan={effectiveColumns.length + 1} />
                </tr>
              )}

              {visibleSlice.length === 0 ? (
                <tr>
                  <td
                    colSpan={effectiveColumns.length + 1}
                    className="py-12 text-center text-slate-500 dark:text-slate-400"
                  >
                    {t('search_no_results')}
                  </td>
                </tr>
              ) : (
                visibleSlice.map((p) => {
                  const isSelected = selectedIds.has(p.id);
                  const isActive = String(activeProductId) === String(p.id);
                  const state = getProductStockState(p);
                  const loc = getProductDisplayLocation(p);
                  const catName = p.sub_category_id
                    ? subCatMap.get(Number(p.sub_category_id)) || '—'
                    : '—';
                  const cellPad = density === 'compact' ? 'py-1.5 px-3' : 'py-2.5 px-3';

                  return (
                    <tr
                      key={`${p.id}::${p.store_name || ''}`}
                      onClick={() => {
                        if (String(activeProductId) !== String(p.id)) {
                          requestGuardedNavigation(
                            () => setActiveProductId(p.id),
                            ['desktop-product-inline']
                          );
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          productId: p.id,
                        });
                      }}
                      className={`transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-orange-50/90 dark:bg-orange-950/35'
                          : isSelected
                          ? 'bg-slate-100/80 dark:bg-slate-800/60'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td
                        className={`${cellPad} text-center no-print`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRowCheckboxClick(p.id, e.shiftKey);
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          className="rounded border-slate-300 text-orange-600 cursor-pointer"
                        />
                      </td>

                      {effectiveColumns.includes('reference') && (
                        <td className={`${cellPad} font-mono font-semibold text-slate-900 dark:text-white whitespace-nowrap`}>
                          {p.reference}
                        </td>
                      )}

                      {effectiveColumns.includes('designation') && (
                        <td className={`${cellPad} font-semibold text-slate-900 dark:text-white max-w-[260px] truncate`}>
                          {p.model}
                        </td>
                      )}

                      {effectiveColumns.includes('brand') && (
                        <td className={`${cellPad} text-slate-600 dark:text-slate-300 whitespace-nowrap`}>
                          {p.brand}
                        </td>
                      )}

                      {effectiveColumns.includes('category') && (
                        <td className={`${cellPad} text-slate-600 dark:text-slate-300 whitespace-nowrap`}>
                          {catName}
                        </td>
                      )}

                      {effectiveColumns.includes('store_name') && (
                        <td className={`${cellPad} text-slate-600 dark:text-slate-300 whitespace-nowrap`}>
                          {p.store_name || '—'}
                        </td>
                      )}

                      {effectiveColumns.includes('location') && (
                        <td className={`${cellPad} font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap`}>
                          {loc || '—'}
                        </td>
                      )}

                      {effectiveColumns.includes('quantity') && (
                        <td
                          className={`${cellPad} text-right font-mono tabular-nums font-bold ${
                            state === 'OUT'
                              ? 'text-red-600 dark:text-red-400'
                              : state === 'LOW'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-slate-900 dark:text-white'
                          }`}
                        >
                          {p.quantity ?? 0}
                        </td>
                      )}

                      {effectiveColumns.includes('min_stock_alert') && (
                        <td className={`${cellPad} text-right font-mono tabular-nums text-slate-500 dark:text-slate-400`}>
                          {p.min_stock_alert ?? 2}
                        </td>
                      )}

                      {effectiveColumns.includes('unit_price') && (
                        <td className={`${cellPad} text-right font-mono tabular-nums text-slate-700 dark:text-slate-200 whitespace-nowrap`}>
                          {formatCurrency(p.unit_price || 0)}
                        </td>
                      )}

                      {effectiveColumns.includes('status') && (
                        <td className={`${cellPad} whitespace-nowrap`}>
                          <span
                            className={`font-semibold ${
                              state === 'OUT'
                                ? 'text-red-600 dark:text-red-400'
                                : state === 'LOW'
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-emerald-600 dark:text-emerald-400'
                            }`}
                          >
                            {state === 'OUT'
                              ? tr(language, 'Rupture', 'Out', 'Op')
                              : state === 'LOW'
                              ? tr(language, 'Stock bas', 'Low', 'Laag')
                              : tr(language, 'OK', 'OK', 'OK')}
                          </span>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}

              {bottomPaddingPx > 0 && (
                <tr style={{ height: `${bottomPaddingPx}px` }} aria-hidden="true">
                  <td colSpan={effectiveColumns.length + 1} />
                </tr>
              )}
            </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Right Anchored Detail Panel */}
      {activeProductId && (
        <DesktopProductDetailPanel
          productId={activeProductId}
          onClose={() => setActiveProductId(null)}
        />
      )}

      {/* Right-click Context Menu (Lot 3.6) */}
      {contextMenu && (
        <div
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed z-50 w-52 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-1.5 text-xs space-y-0.5 no-print"
        >
          <button
            type="button"
            onClick={() => {
              const targetId = contextMenu.productId;
              setContextMenu(null);
              requestGuardedNavigation(() => setActiveProductId(targetId), ['desktop-product-inline']);
            }}
            className="w-full px-3 py-2 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 font-medium text-slate-800 dark:text-slate-200 cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5 text-orange-600" />
            <span>{tr(language, 'Ouvrir la fiche', 'Open details', 'Details openen')}</span>
          </button>
          {userHasPermission('perm_prod_edit') && (
            <button
              type="button"
              onClick={() => {
                const prod = products.find((p) => p.id === contextMenu.productId);
                setContextMenu(null);
                if (prod) {
                  requestGuardedNavigation(() => {
                    setPrefillNewCode(null);
                    setProductFormState({ open: true, product: prod });
                  });
                }
              }}
              className="w-full px-3 py-2 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 font-medium text-slate-800 dark:text-slate-200 cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5 text-amber-600" />
              <span>{tr(language, 'Éditer le formulaire', 'Edit in form', 'Formulier bewerken')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              const prod = products.find((p) => p.id === contextMenu.productId);
              if (prod) await copyToClipboard(prod.reference);
              setContextMenu(null);
            }}
            className="w-full px-3 py-2 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 font-medium text-slate-800 dark:text-slate-200 cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5 text-slate-500" />
            <span>{tr(language, 'Copier la référence', 'Copy reference', 'Referentie kopiëren')}</span>
          </button>
          {canPrintLabels && (
            <button
              type="button"
              onClick={() => {
                setPrintLabelsModal({ open: true, initialProductId: contextMenu.productId });
                setContextMenu(null);
              }}
              className="w-full px-3 py-2 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 font-medium text-slate-800 dark:text-slate-200 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5 text-orange-600" />
              <span>{tr(language, "Imprimer l'étiquette", 'Print label', 'Etiket afdrukken')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              const prod = products.find((p) => p.id === contextMenu.productId);
              if (prod) {
                setScanState({ open: false, mode: 'OUT' });
                addToCart(prod, 1);
                setBatchCartModalOpen(true);
              }
              setContextMenu(null);
            }}
            className="w-full px-3 py-2 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 font-medium text-slate-800 dark:text-slate-200 cursor-pointer"
          >
            <ArrowLeftRight className="w-3.5 h-3.5 text-emerald-600" />
            <span>{tr(language, 'Nouveau mouvement', 'New movement', 'Nieuwe beweging')}</span>
          </button>
          {canTransferBetweenDepots && (
            <button
              type="button"
              onClick={() => {
                const prod = products.find((p) => p.id === contextMenu.productId);
                setContextMenu(null);
                if (prod) {
                  openStockTransferModal({
                    sourceDepot: prod.store_name || undefined,
                    items: [{ productId: prod.id, quantity: 1 }],
                  });
                }
              }}
              className="w-full px-3 py-2 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 font-medium text-slate-800 dark:text-slate-200 cursor-pointer"
            >
              <ArrowLeftRight className="w-3.5 h-3.5 text-sky-600" />
              <span>{tr(language, 'Transférer', 'Transfer', 'Overdragen')}</span>
            </button>
          )}
        </div>
      )}

      {/* Desktop 2-Column Product Creation / Edit Dialog */}
      <DesktopProductFormDrawer
        open={Boolean(productFormState?.open)}
        product={productFormState?.product || null}
        prefillCode={prefillNewCode}
        onClose={() => {
          setPrefillNewCode(null);
          setProductFormState({ open: false, product: null });
        }}
      />
    </div>
  );
};
