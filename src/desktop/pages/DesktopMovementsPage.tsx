import React, { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowUpDown,
  Download,
  Plus,
  Search,
  Warehouse,
  Calendar,
  X,
  Check,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { MovementType, Product, StockMovement } from '../../types';
import { formatCurrency, isUserAllowedForDepot } from '../../utils/crypto';
import { buildClosedDepotNamesSet } from '../../services/desktopInventoryLogic';
import {
  DesktopMovementSortField,
  MovementPeriodFilter,
  buildMovementsCsvContent,
  filterMovementsList,
  sortMovementsList,
} from '../../services/desktopOrdersMovementsLogic';

interface DesktopMovementsPageProps {
  externalSearchQuery?: string;
  selectedDepotFilter: string;
  onSelectProductForDetail?: (product: Product) => void;
  openNewMovementRequested?: boolean;
  onConsumeNewMovementRequest?: () => void;
}

export const DesktopMovementsPage: React.FC<DesktopMovementsPageProps> = ({
  externalSearchQuery = '',
  selectedDepotFilter,
  onSelectProductForDetail,
  openNewMovementRequested,
  onConsumeNewMovementRequest,
}) => {
  const {
    movements,
    products,
    depots,
    departments,
    projects,
    currentUser,
    userHasPermission,
    canViewPrices,
    addToCart,
    confirmBatchMovements,
    clearCart,
    setActiveProductId,
    t,
  } = useApp();

  const [localSearch, setLocalSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | MovementType>('ALL');
  const [periodFilter, setPeriodFilter] = useState<MovementPeriodFilter>('30D');
  const [userOrDeptFilter, setUserOrDeptFilter] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortField, setSortField] = useState<DesktopMovementSortField>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedMovement, setSelectedMovement] = useState<StockMovement | null>(null);

  // Quick new movement drawer state
  const [showNewMovDrawer, setShowNewMovDrawer] = useState(false);
  const [newMovType, setNewMovType] = useState<MovementType>('OUT');
  const [newMovProductSearch, setNewMovProductSearch] = useState('');
  const [newMovSelectedProductId, setNewMovSelectedProductId] = useState<string>('');
  const [newMovQty, setNewMovQty] = useState<number>(1);
  const [newMovSiteNumber, setNewMovSiteNumber] = useState<string>('');
  const [newMovSubmitting, setNewMovSubmitting] = useState(false);

  React.useEffect(() => {
    if (openNewMovementRequested) {
      setShowNewMovDrawer(true);
      onConsumeNewMovementRequest?.();
    }
  }, [openNewMovementRequested, onConsumeNewMovementRequest]);

  const canExportCsv =
    userHasPermission('perm_mov_export_csv') || userHasPermission('perm_prod_export_csv');
  const canRecordIn = userHasPermission('perm_stock_in') || userHasPermission('perm_mov_in');
  const canRecordOut = userHasPermission('perm_mov_out') || userHasPermission('perm_stock_out');

  const closedDepotNames = useMemo(() => buildClosedDepotNamesSet(depots), [depots]);

  const effectiveSearch = (localSearch || externalSearchQuery).trim();

  const filteredMovements = useMemo(() => {
    const filtered = filterMovementsList(movements, products, currentUser, {
      searchQuery: effectiveSearch,
      typeFilter,
      depotFilter: selectedDepotFilter,
      userOrDeptFilter,
      periodFilter,
      dateFrom,
      dateTo,
      closedDepotNames,
    });
    return sortMovementsList(filtered, sortField, sortDir);
  }, [
    movements,
    products,
    currentUser,
    effectiveSearch,
    typeFilter,
    selectedDepotFilter,
    userOrDeptFilter,
    periodFilter,
    dateFrom,
    dateTo,
    closedDepotNames,
    sortField,
    sortDir,
  ]);

  const productById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of products) {
      map.set(String(p.id), p);
    }
    return map;
  }, [products]);

  const stats = useMemo(() => {
    let totalIn = 0;
    let totalOut = 0;
    let totalCostOut = 0;
    for (const m of filteredMovements) {
      const qty = Math.abs(Number(m.quantity_changed ?? m.quantity ?? 0));
      if ((m.movement_type || m.type) === 'IN') {
        totalIn += qty;
      } else {
        totalOut += qty;
        totalCostOut += Number(m.total_cost || 0);
      }
    }
    return { totalIn, totalOut, totalCostOut };
  }, [filteredMovements]);

  const handleSort = (field: DesktopMovementSortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'created_at' ? 'desc' : 'asc');
    }
  };

  const handleExportCsv = () => {
    if (!canExportCsv) return;
    const csv = buildMovementsCsvContent(filteredMovements, products, { canViewPrices });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tot-stock-mouvements-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const matchingCatalogProducts = useMemo(() => {
    const q = newMovProductSearch.trim().toLowerCase();
    const list = products.filter((p) => {
      if (p.store_name && closedDepotNames.has(p.store_name.toLowerCase())) return false;
      if (currentUser && p.store_name && !isUserAllowedForDepot(currentUser, p.store_name)) {
        return false;
      }
      if (!q) return true;
      return `${p.reference} ${p.brand} ${p.model} ${p.barcode || ''}`
        .toLowerCase()
        .includes(q);
    });
    return list.slice(0, 30);
  }, [products, newMovProductSearch, closedDepotNames, currentUser]);

  const handleSubmitNewMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    const prod = productById.get(newMovSelectedProductId);
    if (!prod || newMovQty <= 0) return;
    setNewMovSubmitting(true);
    try {
      clearCart();
      const signedDelta =
        newMovType === 'IN' ? Math.trunc(newMovQty) : -Math.trunc(newMovQty);
      addToCart(prod, Math.max(0, prod.quantity + signedDelta));
      await confirmBatchMovements(newMovSiteNumber.trim() || undefined);
      setShowNewMovDrawer(false);
      setNewMovSelectedProductId('');
      setNewMovQty(1);
      setNewMovSiteNumber('');
    } finally {
      setNewMovSubmitting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 bg-slate-50 dark:bg-slate-950">
      {/* Zone principale : barre de filtres + tableau */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 p-5 gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-black tracking-tight text-slate-900 dark:text-white">
              {t('nav_movements' as any, 'Mouvements de stock')}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {filteredMovements.length} mouvement(s) affiché(s) • Entrées :{' '}
              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                +{stats.totalIn}
              </span>{' '}
              • Sorties :{' '}
              <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                -{stats.totalOut}
              </span>
              {canViewPrices && (
                <>
                  {' '}
                  • Valorisation sorties :{' '}
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                    {formatCurrency(stats.totalCostOut)}
                  </span>
                </>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {canExportCsv && (
              <button
                type="button"
                onClick={handleExportCsv}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <Download className="w-4 h-4 text-orange-600" />
                {t('desktop_export_csv' as any, 'Exporter en CSV')}
              </button>
            )}
            {(canRecordIn || canRecordOut) && (
              <button
                type="button"
                onClick={() => setShowNewMovDrawer(true)}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white shadow-sm transition-colors"
              >
                <Plus className="w-4 h-4" />
                {t('desktop_new_movement' as any, 'Nouveau mouvement')}
              </button>
            )}
          </div>
        </div>

        {/* Barre de filtres */}
        <div className="grid grid-cols-12 gap-3 p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="col-span-4 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              placeholder="Rechercher réf, article, chantier, commande, utilisateur..."
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>

          <div className="col-span-2 flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
            {(['ALL', 'IN', 'OUT'] as const).map((tp) => (
              <button
                key={tp}
                type="button"
                onClick={() => setTypeFilter(tp)}
                className={`flex-1 py-1 text-[11px] font-bold rounded-md transition-colors ${
                  typeFilter === tp
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {tp === 'ALL' ? 'Tous' : tp === 'IN' ? 'Entrées' : 'Sorties'}
              </button>
            ))}
          </div>

          <div className="col-span-3 flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
            {(
              [
                { id: 'TODAY', label: 'Aujourd’hui' },
                { id: '7D', label: '7 j' },
                { id: '30D', label: '30 j' },
                { id: 'ALL', label: 'Tout' },
                { id: 'CUSTOM', label: 'Dates' },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPeriodFilter(p.id)}
                className={`flex-1 py-1 text-[11px] font-bold rounded-md transition-colors ${
                  periodFilter === p.id
                    ? 'bg-white dark:bg-slate-900 text-orange-600 dark:text-orange-400 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="col-span-3">
            <select
              value={userOrDeptFilter}
              onChange={(e) => setUserOrDeptFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200"
            >
              <option value="ALL">Tous départements / utilisateurs</option>
              {departments.map((d) => (
                <option key={d.id} value={d.name}>
                  Dépt : {d.name}
                </option>
              ))}
            </select>
          </div>

          {periodFilter === 'CUSTOM' && (
            <div className="col-span-12 flex items-center gap-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
              <Calendar className="w-4 h-4 text-slate-400" />
              <span className="text-slate-500">Du :</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
              <span className="text-slate-500">Au :</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>
          )}
        </div>

        {/* Tableau des mouvements */}
        <div className="flex-1 min-h-0 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
          <div className="flex-1 overflow-auto">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-100/95 dark:bg-slate-800/95 backdrop-blur-xs text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="py-2.5 px-3">
                    <button
                      type="button"
                      onClick={() => handleSort('created_at')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      Date / Heure <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-3">
                    <button
                      type="button"
                      onClick={() => handleSort('movement_type')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      Type <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-3">
                    <button
                      type="button"
                      onClick={() => handleSort('product_ref')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      Article <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('quantity_changed')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      Quantité <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-3">
                    <button
                      type="button"
                      onClick={() => handleSort('depot_name')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      Dépôt <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-3">
                    <button
                      type="button"
                      onClick={() => handleSort('user_name')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      Opérateur / Dépt <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-3">
                    <button
                      type="button"
                      onClick={() => handleSort('site_number')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      Chantier / Commande <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  {canViewPrices && <th className="py-2.5 px-3 text-right">Coût HT</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {filteredMovements.length === 0 ? (
                  <tr>
                    <td
                      colSpan={canViewPrices ? 8 : 7}
                      className="py-12 text-center text-slate-400 dark:text-slate-500"
                    >
                      Aucun mouvement ne correspond aux filtres sélectionnés.
                    </td>
                  </tr>
                ) : (
                  filteredMovements.slice(0, 500).map((mov) => {
                    const prod = productById.get(String(mov.product_id));
                    const isIn = (mov.movement_type || mov.type) === 'IN';
                    const qty = Math.abs(Number(mov.quantity_changed ?? mov.quantity ?? 0));
                    const isSelected = selectedMovement?.id === mov.id;
                    return (
                      <tr
                        key={mov.id}
                        onClick={() => setSelectedMovement(mov)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-orange-50/80 dark:bg-orange-950/30'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap">
                          {mov.created_at
                            ? new Date(mov.created_at).toLocaleString('fr-FR', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '—'}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold ${
                              isIn
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60'
                                : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60'
                            }`}
                          >
                            {isIn ? (
                              <ArrowDownLeft className="w-3 h-3" />
                            ) : (
                              <ArrowUpRight className="w-3 h-3" />
                            )}
                            {isIn ? 'ENTRÉE' : 'SORTIE'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-mono font-bold text-slate-900 dark:text-white">
                            {mov.product_ref || prod?.reference || '—'}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[260px]">
                            {prod ? `${prod.brand} ${prod.model}` : 'Article catalogue'}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-black text-sm">
                          <span
                            className={
                              isIn
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }
                          >
                            {isIn ? `+${qty}` : `-${qty}`}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">
                          <span className="inline-flex items-center gap-1">
                            <Warehouse className="w-3.5 h-3.5 text-slate-400" />
                            {mov.depot_name || prod?.store_name || 'Dépôt Principal'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-slate-800 dark:text-slate-200">
                            {mov.user_name || '—'}
                          </div>
                          {(mov.department_name || mov.department) && (
                            <div className="text-[10px] text-slate-500">
                              {mov.department_name || mov.department}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                          {mov.site_number && <div>Chantier : {mov.site_number}</div>}
                          {mov.order_number && (
                            <div className="text-orange-600 dark:text-orange-400">
                              Cmd : {mov.order_number}
                            </div>
                          )}
                          {!mov.site_number && !mov.order_number && '—'}
                        </td>
                        {canViewPrices && (
                          <td className="py-2.5 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                            {mov.total_cost ? formatCurrency(mov.total_cost) : '—'}
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Panneau latéral droit : détail du mouvement sélectionné */}
      {selectedMovement && (
        <aside className="w-88 shrink-0 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col gap-4 overflow-y-auto">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-orange-600">
                Détail du mouvement
              </span>
              <h2 className="text-sm font-black text-slate-900 dark:text-white font-mono">
                #{selectedMovement.id.slice(0, 12)}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setSelectedMovement(null)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {(() => {
            const prod = productById.get(String(selectedMovement.product_id));
            const isIn = (selectedMovement.movement_type || selectedMovement.type) === 'IN';
            const qty = Math.abs(
              Number(selectedMovement.quantity_changed ?? selectedMovement.quantity ?? 0)
            );
            return (
              <div className="space-y-4 text-xs">
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Opération</span>
                    <span
                      className={`font-bold ${
                        isIn ? 'text-emerald-600' : 'text-amber-600'
                      }`}
                    >
                      {isIn ? `ENTRÉE (+${qty})` : `SORTIE (-${qty})`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Date</span>
                    <span className="font-mono text-slate-800 dark:text-slate-200">
                      {selectedMovement.created_at
                        ? new Date(selectedMovement.created_at).toLocaleString('fr-FR')
                        : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Dépôt</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {selectedMovement.depot_name || prod?.store_name || 'Dépôt Principal'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Opérateur</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {selectedMovement.user_name || '—'}
                    </span>
                  </div>
                  {(selectedMovement.department_name || selectedMovement.department) && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Département</span>
                      <span className="text-slate-800 dark:text-slate-200">
                        {selectedMovement.department_name || selectedMovement.department}
                      </span>
                    </div>
                  )}
                  {selectedMovement.site_number && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Chantier / Projet</span>
                      <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                        {selectedMovement.site_number}
                      </span>
                    </div>
                  )}
                  {selectedMovement.order_number && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">N° Commande</span>
                      <span className="font-mono font-bold text-orange-600">
                        {selectedMovement.order_number}
                      </span>
                    </div>
                  )}
                  {canViewPrices && selectedMovement.total_cost !== undefined && (
                    <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-700">
                      <span className="text-slate-500">Valorisation HT</span>
                      <span className="font-mono font-black text-slate-900 dark:text-white">
                        {formatCurrency(selectedMovement.total_cost)}
                      </span>
                    </div>
                  )}
                </div>

                {prod && (
                  <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                    <div className="text-[10px] font-bold uppercase text-slate-400">
                      Article associé
                    </div>
                    <div className="font-mono font-bold text-slate-900 dark:text-white">
                      {prod.reference}
                    </div>
                    <div className="text-slate-600 dark:text-slate-300">
                      {prod.brand} {prod.model}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Stock actuel :{' '}
                      <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                        {prod.quantity}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveProductId(prod.id);
                        onSelectProductForDetail?.(prod);
                      }}
                      className="w-full mt-2 py-1.5 px-3 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition-colors"
                    >
                      Ouvrir la fiche article
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
        </aside>
      )}

      {/* Tiroir de saisie rapide d'un nouveau mouvement (Entrée / Sortie) */}
      {showNewMovDrawer && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 h-full shadow-2xl border-l border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-base font-black text-slate-900 dark:text-white">
                  {t('desktop_new_movement' as any, 'Enregistrer un mouvement')}
                </h2>
                <p className="text-xs text-slate-500">
                  Entrée ou sortie immédiate de stock avec traçabilité chantier
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewMovDrawer(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitNewMovement} className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-2">
                {canRecordOut && (
                  <button
                    type="button"
                    onClick={() => setNewMovType('OUT')}
                    className={`py-2.5 px-3 rounded-xl font-bold border flex items-center justify-center gap-2 ${
                      newMovType === 'OUT'
                        ? 'bg-amber-600 text-white border-amber-600'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <ArrowUpRight className="w-4 h-4" /> Sortie de stock
                  </button>
                )}
                {canRecordIn && (
                  <button
                    type="button"
                    onClick={() => setNewMovType('IN')}
                    className={`py-2.5 px-3 rounded-xl font-bold border flex items-center justify-center gap-2 ${
                      newMovType === 'IN'
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <ArrowDownLeft className="w-4 h-4" /> Entrée en stock
                  </button>
                )}
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Rechercher l'article
                </label>
                <input
                  type="text"
                  value={newMovProductSearch}
                  onChange={(e) => setNewMovProductSearch(e.target.value)}
                  placeholder="Référence, modèle, code-barres..."
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 mb-2"
                />
                <select
                  required
                  value={newMovSelectedProductId}
                  onChange={(e) => setNewMovSelectedProductId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                >
                  <option value="">-- Sélectionner un article --</option>
                  {matchingCatalogProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      [{p.reference}] {p.brand} {p.model} (Stock: {p.quantity} • {p.store_name || 'Dépôt Principal'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Quantité
                </label>
                <input
                  type="number"
                  min={1}
                  required
                  value={newMovQty}
                  onChange={(e) => setNewMovQty(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold"
                />
              </div>

              {newMovType === 'OUT' && (
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    N° Chantier / Projet
                  </label>
                  <input
                    type="text"
                    list="desktop-mov-projects"
                    value={newMovSiteNumber}
                    onChange={(e) => setNewMovSiteNumber(e.target.value)}
                    placeholder="Ex: CH-2026-01"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                  />
                  <datalist id="desktop-mov-projects">
                    {projects.map((pr) => (
                      <option key={pr.id} value={pr.project_number}>
                        {pr.project_name}
                      </option>
                    ))}
                  </datalist>
                </div>
              )}

              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewMovDrawer(false)}
                  className="px-4 py-2 rounded-lg font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={!newMovSelectedProductId || newMovSubmitting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg font-bold bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white"
                >
                  <Check className="w-4 h-4" />
                  Valider le mouvement
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
