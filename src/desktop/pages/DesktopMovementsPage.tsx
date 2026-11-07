import React, { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Calendar,
  Download,
  ExternalLink,
  Plus,
  Search,
  SlidersHorizontal,
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
import { tr } from '../../i18n/dutchTranslator';

export interface DesktopMovementsPageProps {
  selectedDepotFilter?: string;
  openNewMovementRequested?: boolean;
  onConsumeNewMovementRequest?: () => void;
  externalNewMovementTrigger?: number;
  globalDepotFilter?: string;
  onSelectProductForDetail?: (productId: string) => void;
}

type TypeFilter = 'ALL' | 'IN' | 'OUT' | 'TRANSFER';
type PeriodPreset = 'TODAY' | '7D' | '30D' | 'ALL' | 'CUSTOM';

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
    userHasPermission,
    confirmBatchMovements,
    canTransferBetweenDepots,
    openStockTransferModal,
    language,
    t,
  } = useApp();

  const effectiveDepotFilter = selectedDepotFilter ?? globalDepotFilter ?? 'ALL';
  const locale = language === 'nl' ? 'nl-NL' : language === 'en' ? 'en-GB' : 'fr-FR';

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('ALL');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
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

  React.useEffect(() => {
    if (openNewMovementRequested) {
      setDrawerOpen(true);
      onConsumeNewMovementRequest?.();
    }
  }, [openNewMovementRequested, onConsumeNewMovementRequest]);

  React.useEffect(() => {
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

  const filteredMovements = useMemo(() => {
    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    return movements.filter((m) => {
      const mType = getMovType(m);
      const isTrans = isTransferMovement(m);
      if (typeFilter === 'TRANSFER') {
        if (!isTrans) return false;
      } else if (typeFilter !== 'ALL' && mType !== typeFilter) {
        return false;
      }

      const prod = productById.get(String(m.product_id));
      if (effectiveDepotFilter !== 'ALL') {
        const mDepot = getMovDepot(m, prod);
        const dstDepot = getMovementDestDepot(m);
        if (mDepot !== effectiveDepotFilter && dstDepot !== effectiveDepotFilter) return false;
      }

      if (departmentFilter !== 'ALL') {
        if (getMovDept(m) !== departmentFilter) return false;
      }

      const ts = new Date(m.created_at).getTime();
      if (!Number.isNaN(ts)) {
        if (periodPreset === 'TODAY' && ts < startOfToday.getTime()) return false;
        if (periodPreset === '7D' && ts < now - 7 * 86400_000) return false;
        if (periodPreset === '30D' && ts < now - 30 * 86400_000) return false;
        if (periodPreset === 'CUSTOM') {
          if (customStart) {
            const s = new Date(customStart).getTime();
            if (!Number.isNaN(s) && ts < s) return false;
          }
          if (customEnd) {
            const e = new Date(customEnd).getTime() + 86399_999;
            if (!Number.isNaN(e) && ts > e) return false;
          }
        }
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const haystack = [
          m.product_ref,
          prod?.reference,
          prod?.brand,
          prod?.model,
          m.user_name,
          getMovDept(m),
          m.site_number,
          m.order_number,
          m.reason,
          getMovDepot(m, prod),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }, [
    movements,
    typeFilter,
    effectiveDepotFilter,
    departmentFilter,
    periodPreset,
    customStart,
    customEnd,
    searchQuery,
    productById,
  ]);

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
      ).toFixed(2);
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
    const a = document.createElement('a');
    a.href = url;
    a.download = `mouvements-stock-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      {/* Top Toolbar */}
      <div className="px-6 py-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
            {t('desktop_nav_movements')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
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

      {/* Filter Bar */}
      <div className="px-6 py-3 bg-white/70 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={tr(
              language,
              'Rechercher réf, article, chantier, commande, utilisateur...',
              'Search ref, item, job site, order, user...',
              'Zoek ref, artikel, werf, bestelling, gebruiker...'
            )}
            className="w-full pl-9 pr-8 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Type segmented control */}
        <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-0.5 text-xs font-bold">
          {(['ALL', 'IN', 'OUT', 'TRANSFER'] as TypeFilter[]).map((tf) => (
            <button
              key={tf}
              type="button"
              data-testid={`desktop-movements-filter-${tf.toLowerCase()}`}
              onClick={() => setTypeFilter(tf)}
              className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                typeFilter === tf
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

        {/* Period presets */}
        <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-0.5 text-xs font-bold">
          {(
            [
              ['TODAY', tr(language, 'Aujourd’hui', 'Today', 'Vandaag')],
              ['7D', tr(language, '7 j', '7 d', '7 d')],
              ['30D', tr(language, '30 j', '30 d', '30 d')],
              ['ALL', tr(language, 'Tout', 'All', 'Alles')],
              ['CUSTOM', tr(language, 'Dates', 'Dates', 'Datums')],
            ] as Array<[PeriodPreset, string]>
          ).map(([preset, label]) => (
            <button
              key={preset}
              type="button"
              onClick={() => setPeriodPreset(preset)}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                periodPreset === preset
                  ? 'bg-white dark:bg-slate-900 text-orange-600 dark:text-orange-400 shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {periodPreset === 'CUSTOM' && (
          <div className="flex items-center gap-1.5 text-xs">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
            />
            <span className="text-slate-400">→</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
            />
          </div>
        )}

        {/* Department filter */}
        <div className="flex items-center gap-1.5 text-xs">
          <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200"
          >
            <option value="ALL">
              {tr(
                language,
                'Tous départements / utilisateurs',
                'All departments / users',
                'Alle afdelingen / gebruikers'
              )}
            </option>
            {departments.map((d) => (
              <option key={d.id} value={d.name}>
                {tr(language, 'Dépt :', 'Dept:', 'Afd:')} {d.name}
              </option>
            ))}
          </select>
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
                <select
                  required
                  value={movProductId}
                  onChange={(e) => {
                    setMovProductId(e.target.value);
                    const p = productById.get(e.target.value);
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
                </select>
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
                  <select
                    value={movDepot}
                    onChange={(e) => setMovDepot(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  >
                    {depots.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {movType === 'OUT' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {tr(language, 'Département', 'Department', 'Afdeling')}
                    </label>
                    <select
                      value={movDepartment}
                      onChange={(e) => setMovDepartment(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                    >
                      <option value="">{tr(language, '— Aucun —', '— None —', '— Geen —')}</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.name}>
                          {d.name}
                        </option>
                      ))}
                    </select>
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
