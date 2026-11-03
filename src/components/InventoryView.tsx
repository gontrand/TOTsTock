import React, { useState, useMemo } from 'react';
import { tr } from '../i18n/dutchTranslator';
import { useApp } from '../context/AppContext';
import { formatCurrency } from '../utils/crypto';
import {
  QrCode,
  Search,
  Plus,
  Filter,
  Package,
  MapPin,
  Building,
  Tag,
  AlertTriangle,
  AlertOctagon,
  ChevronDown,
  X,
  PauseCircle,
  EyeOff,
  Eye,
  Warehouse,
  Printer,
  ClipboardCheck,
  ShoppingCart,
} from 'lucide-react';

export const InventoryView: React.FC = () => {
  const {
    products,
    depots,
    subCategories,
    setActiveProductId,
    setProductFormState,
    setScanState,
    setPrintLabelsModal,
    setInventoryAuditModalOpen,
    addToOrderCart,
    setOrderCartModalOpen,
    userHasPermission,
    currentUser,
    license,
    setCompanySetupModalOpen,
    language,
    t,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [stockStatus, setStockStatus] = useState<'ALL' | 'LOW' | 'OUT'>('ALL');
  const [selectedSubCat, setSelectedSubCat] = useState<string>('');
  const [selectedStore, setSelectedStore] = useState<string>('');
  const [selectedSupplier, setSelectedSupplier] = useState<string>('');
  const [roomQuery, setRoomQuery] = useState('');
  const [shelfQuery, setShelfQuery] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // User permissions & lambda operator check
  const canManageDepots = userHasPermission('perm_manage_depots');
  const isLambdaUser = !canManageDepots;
  const hasFinancePerm = userHasPermission('perm_dash_finance');
  const canEditProduct = userHasPermission('perm_prod_edit');
  const canViewPrices = userHasPermission('perm_prod_view_price');
  const canScan = userHasPermission('perm_inv_btn_scan') || userHasPermission('perm_prod_view');
  const canPrintLabels = userHasPermission('perm_menu_print_labels');
  const canInventoryAudit = userHasPermission('perm_menu_inventory_audit');
  const canFilters = userHasPermission('perm_inv_filters') || userHasPermission('perm_prod_view');

  // Closed / Inactive depots
  const closedDepotNames = useMemo(() => {
    return new Set(
      depots
        .filter((d) => d.is_active === false)
        .map((d) => (d.name || '').toLowerCase().trim())
    );
  }, [depots]);

  const closedDepotsList = useMemo(() => {
    return depots.filter((d) => d.is_active === false);
  }, [depots]);

  const hasClosedDepots = closedDepotsList.length > 0;

  // For managers: toggle whether to include or hide closed depots in view
  const [includeClosedDepots, setIncludeClosedDepots] = useState(true);

  // Count tools in closed depots
  const closedToolsCount = useMemo(() => {
    return products.filter((p) => p.store_name && closedDepotNames.has(p.store_name.toLowerCase().trim())).length;
  }, [products, closedDepotNames]);

  // Unique stores & suppliers for filter dropdowns (filter out closed stores for lambda users)
  const uniqueStores = useMemo(() => {
    const rawStores = Array.from(new Set(products.map((p) => p.store_name).filter(Boolean))) as string[];
    if (isLambdaUser) {
      return rawStores.filter((st) => !closedDepotNames.has(st.toLowerCase().trim()));
    }
    return rawStores;
  }, [products, isLambdaUser, closedDepotNames]);

  const uniqueSuppliers = useMemo(() => {
    const s = new Set<string>();
    products.forEach((p) => {
      if (p.supplier_1_name) s.add(p.supplier_1_name);
      if (p.supplier_2_name) s.add(p.supplier_2_name);
    });
    return Array.from(s);
  }, [products]);

  // Filtered Products: lambda users NEVER see products from closed depots!
  const filteredProducts = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const rq = roomQuery.toLowerCase().trim();
    const sq = shelfQuery.toLowerCase().trim();

    return products
      .filter((p) => {
        const storeNameTrimmed = (p.store_name || '').toLowerCase().trim();
        const isDepotClosed = Boolean(p.store_name && closedDepotNames.has(storeNameTrimmed));

        // CRITICAL REQUIREMENT:
        // Tools of closed depots are unavailable in search for lambda users!
        if (isLambdaUser && isDepotClosed) {
          return false;
        }

        // For managers: respect the toggle if they choose to hide closed depots
        if (!isLambdaUser && isDepotClosed && !includeClosedDepots) {
          return false;
        }

        const qty = p.quantity || 0;
        const min = p.min_stock_alert || 2;

        // Stock status
        if (stockStatus === 'LOW' && (qty <= 0 || qty > min)) return false;
        if (stockStatus === 'OUT' && qty > 0) return false;

        // Subcategory
        if (selectedSubCat && String(p.sub_category_id) !== selectedSubCat) return false;

        // Store
        if (selectedStore && p.store_name !== selectedStore) return false;

        // Supplier
        if (
          selectedSupplier &&
          p.supplier_1_name !== selectedSupplier &&
          p.supplier_2_name !== selectedSupplier
        )
          return false;

        // Room / Shelf
        if (rq && (!p.room_name || !p.room_name.toLowerCase().includes(rq))) return false;
        if (sq && (!p.shelf_name || !p.shelf_name.toLowerCase().includes(sq))) return false;

        // Main text query
        if (q) {
          const matchRef = p.reference.toLowerCase().includes(q);
          const matchBrand = p.brand.toLowerCase().includes(q);
          const matchModel = p.model.toLowerCase().includes(q);
          const matchOem = p.manufacturer_ref?.toLowerCase().includes(q);
          const matchTags = p.tags?.toLowerCase().includes(q);
          if (!matchRef && !matchBrand && !matchModel && !matchOem && !matchTags) return false;
        }

        return true;
      })
      .sort((a, b) => `${a.brand} ${a.model}`.localeCompare(`${b.brand} ${b.model}`, 'fr'));
  }, [
    products,
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
  ]);

  const activeFiltersCount = [
    selectedSubCat,
    selectedStore,
    selectedSupplier,
    roomQuery,
    shelfQuery,
  ].filter(Boolean).length;

  const resetFilters = () => {
    setSearchQuery('');
    setStockStatus('ALL');
    setSelectedSubCat('');
    setSelectedStore('');
    setSelectedSupplier('');
    setRoomQuery('');
    setShelfQuery('');
  };

  return (
    <div className="space-y-3 pb-24 animate-fadeIn">
      {/* Top Action Bar */}
      {(canScan || canPrintLabels || canInventoryAudit || canEditProduct) && (
        <div className="flex items-center gap-2 overflow-hidden">
          {canScan && (
            <button
              onClick={() => setScanState({ open: true, mode: 'SEARCH' })}
              className="flex-1 min-w-0 py-2.5 px-3 rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-bold text-xs shadow-md shadow-orange-500/25 flex items-center justify-center gap-2 transition active:scale-95 cursor-pointer relative overflow-hidden"
            >
              <QrCode className="w-4 h-4 shrink-0 relative z-20" />
              <span className="whitespace-nowrap relative z-10">{t('inv_scan_qr')}</span>
            </button>
          )}

          {canPrintLabels && (
            <button
              onClick={() => setPrintLabelsModal({ open: true })}
              title={t('prod_print_labels_btn')}
              className="py-2.5 px-3 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 font-bold text-xs flex items-center justify-center gap-1.5 transition active:scale-95 border border-slate-200 dark:border-slate-700 cursor-pointer shadow-2xs shrink-0 relative z-20"
            >
              <Printer className="w-4 h-4 text-orange-500 shrink-0 relative z-20" />
              <span className="hidden sm:inline whitespace-nowrap relative z-10">{t('prod_print_labels_btn')}</span>
            </button>
          )}

          {canInventoryAudit && (
            <button
              onClick={() => setInventoryAuditModalOpen(true)}
              title={t('menu_inventory_audit_tile')}
              className="py-2.5 px-3 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-emerald-600 dark:text-emerald-400 font-bold text-xs flex items-center justify-center gap-1.5 transition active:scale-95 border border-slate-200 dark:border-slate-700 cursor-pointer shadow-2xs shrink-0 relative z-20"
            >
              <ClipboardCheck className="w-4 h-4 text-emerald-500 shrink-0 relative z-20" />
              <span className="hidden sm:inline whitespace-nowrap relative z-10">{t('inv_audit_btn')}</span>
            </button>
          )}

          {canEditProduct && (
            <button
              onClick={() => setProductFormState({ open: true, product: null })}
              className="py-2.5 px-3 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition active:scale-95 border border-slate-700 cursor-pointer shrink-0 relative z-20"
            >
              <Plus className="w-4 h-4 shrink-0 relative z-20" />
              <span className="whitespace-nowrap relative z-10">{t('inv_new')}</span>
            </button>
          )}
        </div>
      )}

      {/* Closed Depots Informative Banner */}
      {hasClosedDepots && (
        <div className="p-3 rounded-2xl bg-amber-500/10 dark:bg-amber-950/40 border border-amber-400/50 dark:border-amber-700/60 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 animate-fadeIn relative overflow-hidden">
          <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1 relative z-10">
            <div className="w-7 h-7 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 mt-0.5 sm:mt-0 font-bold relative z-20">
              <PauseCircle className="w-4 h-4 shrink-0 relative z-20" />
            </div>
            <div className="min-w-0 flex-1 relative z-0">
              <div className="font-extrabold text-amber-900 dark:text-amber-200 text-xs flex items-center gap-1.5 flex-wrap">
                <span>
                  {closedDepotsList.length === 1
                    ? `${t('inv_closed_banner_single')} : « ${closedDepotsList[0].name} »`
                    : `${closedDepotsList.length} ${t('inv_closed_banner_multi')}`}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded font-black bg-amber-200/80 dark:bg-amber-900 text-amber-900 dark:text-amber-300 shrink-0">
                  {closedToolsCount} {t('common_references')}
                </span>
              </div>
              <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80 mt-0.5">
                {isLambdaUser
                  ? t('inv_closed_banner_lambda')
                  : t('inv_closed_banner_manager')}
              </p>
            </div>
          </div>

          {!isLambdaUser && (
            <button
              type="button"
              onClick={() => setIncludeClosedDepots((prev) => !prev)}
              className={`px-2.5 py-1.5 rounded-xl font-bold text-[11px] flex items-center gap-1.5 transition shrink-0 relative z-20 cursor-pointer ${
                includeClosedDepots
                  ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-xs'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700'
              }`}
            >
              {includeClosedDepots ? (
                <>
                  <Eye className="w-3.5 h-3.5 shrink-0 relative z-20" />
                  <span>{t('inv_show_closed')}</span>
                </>
              ) : (
                <>
                  <EyeOff className="w-3.5 h-3.5 shrink-0 relative z-20" />
                  <span>{t('inv_hide_closed')}</span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* License Quota Indicator */}
      {(() => {
        const maxRefs = license?.max_references || 30;
        const isFree = !license?.plan_type || license.plan_type === 'free';
        const pct = Math.min(100, Math.round((products.length / maxRefs) * 100));
        const isNearLimit = products.length >= maxRefs * 0.8;
        const isFull = products.length >= maxRefs;

        return (
          <div
            className={`p-2.5 rounded-xl border transition flex items-center justify-between gap-3 text-xs relative overflow-hidden ${
              isFull
                ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200'
                : isNearLimit
                ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200'
                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
            }`}
          >
            <div className="flex-1 min-w-0 relative z-10">
              <div className="flex items-center justify-between font-bold mb-1 text-[11px]">
                <span>
                  {t('inv_catalog_quota')} <span className="font-extrabold">{products.length}</span> / {maxRefs >= 99999 ? '∞' : maxRefs} {t('common_references')}
                </span>
                <span className="font-extrabold text-[10px] shrink-0">
                  {isFree ? t('inv_free_plan') : (license?.plan_type || 'FREE').toUpperCase()} ({pct}%)
                </span>
              </div>
              <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    isFull ? 'bg-rose-500' : isNearLimit ? 'bg-amber-500' : 'bg-orange-500'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
            {(isNearLimit || isFree) && (
              <button
                type="button"
                onClick={() => setCompanySetupModalOpen(true)}
                className="shrink-0 relative z-20 px-2.5 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-extrabold text-[10px] shadow-sm transition active:scale-95 cursor-pointer"
              >
                {isFull ? t('inv_unlock') : t('inv_upgrade')}
              </button>
            )}
          </div>
        );
      })()}

      {/* Global Search Input */}
      <div className="relative overflow-hidden">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-20 shrink-0" />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('search_placeholder')}
          className="w-full pl-9 pr-8 py-2.5 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none shadow-sm transition relative z-10"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer z-20 shrink-0"
          >
            <X className="w-4 h-4 shrink-0" />
          </button>
        )}
      </div>

      {/* Stock Status Pills */}
      {canFilters && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setStockStatus('ALL')}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
              stockStatus === 'ALL'
                ? 'bg-orange-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
            }`}
          >
            {t('search_all_stock')} ({filteredProducts.length})
          </button>

          <button
            onClick={() => setStockStatus('LOW')}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap flex items-center gap-1 transition cursor-pointer ${
              stockStatus === 'LOW'
                ? 'bg-amber-500 text-white shadow-sm'
                : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-amber-600 dark:text-amber-400 hover:bg-slate-50'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 relative z-20" />
            <span>{t('search_low_stock')}</span>
          </button>

          <button
            onClick={() => setStockStatus('OUT')}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap flex items-center gap-1 transition cursor-pointer ${
              stockStatus === 'OUT'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-rose-600 dark:text-rose-400 hover:bg-slate-50'
            }`}
          >
            <AlertOctagon className="w-3.5 h-3.5 shrink-0 relative z-20" />
            <span>{t('search_out_stock')}</span>
          </button>

          <button
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap flex items-center gap-1.5 transition sm:ml-auto cursor-pointer ${
              activeFiltersCount > 0
                ? 'bg-orange-100 dark:bg-orange-950/60 text-orange-600 border border-orange-300 dark:border-orange-800'
                : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            <Filter className="w-3.5 h-3.5 shrink-0 relative z-20" />
            <span>{t('search_advanced_filters')}</span>
            {activeFiltersCount > 0 && (
              <span className="w-4 h-4 rounded-full bg-orange-600 text-white text-[10px] flex items-center justify-center font-black shrink-0 relative z-20">
                {activeFiltersCount}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Advanced Filter Collapsible Drawer */}
      {canFilters && showAdvancedFilters && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
              {t('search_advanced_filters')}
            </span>
            {activeFiltersCount > 0 && (
              <button
                onClick={resetFilters}
                className="text-[11px] font-bold text-orange-600 hover:underline cursor-pointer"
              >
                {t('inv_reset_filters')}
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">
                {t('inv_category')}
              </label>
              <select
                value={selectedSubCat}
                onChange={(e) => setSelectedSubCat(e.target.value)}
                className="w-full text-xs p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none"
              >
                <option value="">{t('search_subcat_all')}</option>
                {subCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">
                {t('inv_warehouse')}
              </label>
              <select
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value)}
                className="w-full text-xs p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none"
              >
                <option value="">{t('search_store_all')}</option>
                {uniqueStores.map((st) => {
                  const isClosed = closedDepotNames.has(st.toLowerCase().trim());
                  return (
                    <option key={st} value={st}>
                      {st} {isClosed ? (tr(language, '⚠️ (Fermé temporairement)', '⚠️ (Closed)')) : ''}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">
                {t('inv_supplier')}
              </label>
              <select
                value={selectedSupplier}
                onChange={(e) => setSelectedSupplier(e.target.value)}
                className="w-full text-xs p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none"
              >
                <option value="">{t('search_supplier_all')}</option>
                {uniqueSuppliers.map((sup) => (
                  <option key={sup} value={sup}>
                    {sup}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">
                {t('search_room_filter')}
              </label>
              <input
                type="text"
                value={roomQuery}
                onChange={(e) => setRoomQuery(e.target.value)}
                placeholder="Ex: Plomberie..."
                className="w-full text-xs p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">
              {t('search_shelf_filter')}
            </label>
            <input
              type="text"
              value={shelfQuery}
              onChange={(e) => setShelfQuery(e.target.value)}
              placeholder="Ex: Rack P2..."
              className="w-full text-xs p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none"
            />
          </div>
        </div>
      )}

      {/* Results Header */}
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 px-1">
        <span>
          {filteredProducts.length} {t('common_references')} {t('inv_found')}
        </span>
      </div>

      {/* Product List */}
      <div className="space-y-2">
        {filteredProducts.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center text-slate-400">
            <Package className="w-10 h-10 mx-auto mb-2 opacity-40 text-orange-500 shrink-0" />
            <p className="text-sm font-semibold">{t('search_no_results')}</p>
            {hasClosedDepots && isLambdaUser && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                {t('inv_closed_notice')}
              </p>
            )}
            <button
              onClick={resetFilters}
              className="mt-3 text-xs text-orange-600 font-bold hover:underline cursor-pointer"
            >
              {t('inv_clear_filters')}
            </button>
          </div>
        ) : (
          filteredProducts.map((p) => {
            const qty = p.quantity || 0;
            const min = p.min_stock_alert || 2;
            const isOut = qty === 0;
            const isLow = qty > 0 && qty <= min;
            const isClosedDepot = Boolean(
              p.store_name && closedDepotNames.has(p.store_name.toLowerCase().trim())
            );

            return (
              <div
                key={p.id}
                onClick={() => setActiveProductId(p.id)}
                className={`bg-[#f7ecdf] dark:bg-slate-900 rounded-2xl border ${
                  isClosedDepot
                    ? 'border-amber-300 dark:border-amber-700/70 bg-amber-500/10'
                    : 'border-orange-200/80 dark:border-slate-800 hover:border-orange-500/60 hover:shadow-xs'
                } p-3.5 shadow-2xs cursor-pointer transition active:scale-[0.99] flex flex-col gap-2 relative overflow-hidden`}
              >
                <div className="flex items-start justify-between gap-2 relative overflow-hidden">
                  <div className="min-w-0 flex-1 relative z-10">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white leading-tight">
                        {p.brand} {p.model}
                      </h3>
                      {isClosedDepot && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-700 flex items-center gap-1 shrink-0 relative z-20">
                          <PauseCircle className="w-3 h-3 text-amber-600 shrink-0" />
                          <span>{t('search_depot_closed_badge')}</span>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-1">
                      <span className="font-semibold text-orange-600 dark:text-orange-400 shrink-0">
                        {p.reference}
                      </span>
                      {p.manufacturer_ref && (
                        <>
                          <span className="shrink-0">•</span>
                          <span className="truncate max-w-[140px]">OEM: {p.manufacturer_ref}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {canViewPrices && (
                    <div className="text-right shrink-0 relative z-20">
                      <div className="text-sm font-black text-slate-900 dark:text-white">
                        {formatCurrency(p.unit_price)}
                      </div>
                      <div className="text-[10px] text-slate-400 font-medium">HT / unité</div>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-orange-200/60 dark:border-slate-800 text-xs relative overflow-hidden">
                  <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400 text-[11px] min-w-0 flex-1 relative z-10 overflow-hidden">
                    <MapPin className="w-3 h-3 shrink-0 text-slate-400 relative z-20" />
                    <span className="whitespace-nowrap relative z-0">
                      {p.store_name || 'Dépôt'} &gt; {p.room_name || 'Zone'} &gt; {p.shelf_name || 'Bac'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 relative z-20 bg-[#f7ecdf] dark:bg-slate-900 pl-1.5">
                    <span
                      className={`px-2 py-0.5 rounded-lg text-xs font-black flex items-center gap-1 shrink-0 relative z-20 ${
                        isOut
                          ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400'
                          : isLow
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-400'
                          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-400'
                      }`}
                    >
                      {isOut && <AlertOctagon className="w-3 h-3 shrink-0" />}
                      {isLow && <AlertTriangle className="w-3 h-3 shrink-0" />}
                      <span>Stock: {qty}</span>
                    </span>

                    {canViewPrices && (
                      <span className="text-[11px] font-bold text-orange-600 dark:text-orange-400 shrink-0">
                        {formatCurrency(qty * (p.unit_price || 0))}
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        addToOrderCart(p, 1);
                        setOrderCartModalOpen(true);
                      }}
                      title={tr(language, 'Commander pour chantier (Panier)', 'Order for site')}
                      className="p-1 rounded-lg bg-orange-100 hover:bg-orange-200 dark:bg-orange-950/60 dark:hover:bg-orange-900/60 text-orange-600 dark:text-orange-400 transition active:scale-90 cursor-pointer shrink-0 relative z-20"
                    >
                      <ShoppingCart className="w-3.5 h-3.5 shrink-0 relative z-20" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

