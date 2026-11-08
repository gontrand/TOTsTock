import React, { useState, useMemo } from 'react';
import { tr } from '../i18n/dutchTranslator';
import { useApp } from '../context/AppContext';
import { formatDate, formatCurrency } from '../utils/crypto';
import { MaterialOrder, MaterialOrderItem } from '../types';
import { SearchableSelect } from './SearchableSelect';
import {
  isTransferMovement,
  getMovementSourceDepot,
  getMovementDestDepot,
  groupMovementsByTransferBatch,
} from '../services/stockMovementService';
import { logAuditEventServer } from '../services/auditService';
import {
  ArrowLeftRight,
  Download,
  Search,
  Calendar,
  Building2,
  Filter,
  ArrowDownCircle,
  ArrowUpCircle,
  X,
  ShoppingBag,
  ChevronDown,
  ChevronUp,
  PackageCheck,
  Clock,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  MapPin,
  User,
  Tag,
  Check,
  ShieldAlert,
} from 'lucide-react';

export const MovementsView: React.FC = () => {
  const {
    movements,
    products,
    departments,
    projects,
    orders,
    currentUser,
    setActiveProductId,
    userHasPermission,
    isAdmin,
    isDepartmentManager,
    canApproveOrder,
    approveOrder,
    rejectOrder,
    canTransferBetweenDepots,
    openStockTransferModal,
    language,
    t,
  } = useApp();

  const canSeeTabs = userHasPermission('perm_mov_tabs');
  const canViewAll = isAdmin || Number(currentUser?.role_id) === 0 || userHasPermission('perm_mov_view_all');
  const canViewDepot = userHasPermission('perm_mov_view_depot');
  const canMyTab = userHasPermission('perm_mov_tab_my') || canSeeTabs;
  const canProjTab = userHasPermission('perm_mov_tab_proj') || canSeeTabs;
  const canOrdersTab = isDepartmentManager || isAdmin || userHasPermission('perm_orders_view') || canProjTab;
  const canFilterDep = userHasPermission('perm_mov_filter_dep') || isAdmin || isDepartmentManager;
  const canExportCSV = userHasPermission('perm_mov_export_csv') || canSeeTabs || isDepartmentManager || isAdmin;

  const [subTab, setSubTab] = useState<'MY' | 'DEPOT' | 'ALL' | 'PROJ' | 'ORDERS'>(() => {
    if (canViewAll) return 'ALL';
    if (canViewDepot) return 'DEPOT';
    return 'MY';
  });
  const [selectedDepId, setSelectedDepId] = useState<string>('ALL');
  const [globalSearch, setGlobalSearch] = useState('');
  const [siteSearch, setSiteSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'IN' | 'OUT' | 'TRANSFER'>('ALL');
  const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(new Set());

  const toggleExpandOrder = (orderId: string) => {
    setExpandedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  // Filtered movements
  const filteredMovements = useMemo(() => {
    let list = movements;

    // Sub-tab logic
    if (subTab === 'MY' && currentUser) {
      list = list.filter((m) => String(m.user_id) === String(currentUser.id));
    } else if (subTab === 'DEPOT') {
      const allowed = currentUser?.allowed_depots;
      if (allowed && allowed.length > 0 && !allowed.includes('*') && !allowed.includes('ALL')) {
        list = list.filter((m) => m.depot_name && allowed.includes(m.depot_name));
      }
    } else if (subTab === 'ALL') {
      // Full company movements list
    } else if (subTab === 'PROJ') {
      // Show movements belonging to department projects
      const depIds: number[] = [];
      if (selectedDepId !== 'ALL') {
        depIds.push(Number(selectedDepId));
      } else if (currentUser?.department) {
        const found = departments.find(
          (d) => d.name.toLowerCase() === currentUser.department?.toLowerCase()
        );
        if (found) depIds.push(found.id);
      }

      if (depIds.length > 0) {
        const depProjects = projects.filter((p) => depIds.includes(p.department_id));
        const allowedSites = depProjects.map((p) => p.project_number.toLowerCase());
        list = list.filter((m) => m.site_number && allowedSites.includes(m.site_number.toLowerCase()));
      }
    }

    // Department filter (if granted and not in project subtab with explicit dep)
    if (canFilterDep && selectedDepId !== 'ALL' && subTab === 'MY') {
      const targetDep = departments.find((d) => String(d.id) === selectedDepId);
      if (targetDep) {
        list = list.filter(
          (m) => m.department_name?.toLowerCase() === targetDep.name.toLowerCase()
        );
      }
    }

    // Text & Project search
    const gq = globalSearch.toLowerCase().trim();
    const sq = siteSearch.toLowerCase().trim();

    list = list.filter((m) => {
      if (sq && (!m.site_number || !m.site_number.toLowerCase().includes(sq))) {
        return false;
      }

      if (gq) {
        const matchRef = m.product_ref?.toLowerCase().includes(gq);
        const matchSite = m.site_number?.toLowerCase().includes(gq);
        const matchUser = m.user_name?.toLowerCase().includes(gq);
        const matchDep = m.department_name?.toLowerCase().includes(gq);
        const matchOrder = m.order_number?.toLowerCase().includes(gq);
        const prod = products.find((p) => p.id === m.product_id);
        const matchProd = prod && `${prod.brand} ${prod.model}`.toLowerCase().includes(gq);
        if (!matchRef && !matchSite && !matchUser && !matchDep && !matchProd && !matchOrder) return false;
      }

      if (m.created_at) {
        const mDate = m.created_at.split('T')[0];
        if (startDate && mDate < startDate) return false;
        if (endDate && mDate > endDate) return false;
      }

      if (typeFilter === 'TRANSFER') {
        if (!isTransferMovement(m)) return false;
      } else if (typeFilter === 'IN') {
        if ((m.type || m.movement_type) !== 'IN') return false;
      } else if (typeFilter === 'OUT') {
        if ((m.type || m.movement_type) !== 'OUT') return false;
      }

      return true;
    });

    return list;
  }, [
    movements,
    subTab,
    currentUser,
    selectedDepId,
    departments,
    projects,
    canFilterDep,
    globalSearch,
    siteSearch,
    startDate,
    endDate,
    typeFilter,
    products,
  ]);

  const groupedMovements = useMemo(
    () => groupMovementsByTransferBatch(filteredMovements),
    [filteredMovements]
  );

  // Filtered orders for the dedicated ORDERS tab
  const filteredOrders = useMemo(() => {
    let list: MaterialOrder[] = orders;

    if (selectedDepId !== 'ALL') {
      const targetDep = departments.find((d) => String(d.id) === selectedDepId);
      if (targetDep) {
        list = list.filter(
          (o: MaterialOrder) => o.requester_department?.toLowerCase() === targetDep.name.toLowerCase()
        );
      }
    } else if (!isAdmin && isDepartmentManager && currentUser?.department) {
      list = list.filter(
        (o: MaterialOrder) => o.requester_department?.toLowerCase() === currentUser.department?.toLowerCase()
      );
    }

    const gq = globalSearch.toLowerCase().trim();
    const sq = siteSearch.toLowerCase().trim();

    list = list.filter((o: MaterialOrder) => {
      if (sq && (!o.site_number || !o.site_number.toLowerCase().includes(sq))) {
        return false;
      }
      if (gq) {
        const matchNum = o.order_number?.toLowerCase().includes(gq);
        const matchSite = o.site_number?.toLowerCase().includes(gq);
        const matchReq = o.requester_name?.toLowerCase().includes(gq);
        const matchDep = o.requester_department?.toLowerCase().includes(gq);
        const matchItem = o.items.some(
          (it: MaterialOrderItem) =>
            it.product_name.toLowerCase().includes(gq) ||
            it.product_ref.toLowerCase().includes(gq)
        );
        if (!matchNum && !matchSite && !matchReq && !matchDep && !matchItem) return false;
      }

      if (o.created_at) {
        const oDate = o.created_at.split('T')[0];
        if (startDate && oDate < startDate) return false;
        if (endDate && oDate > endDate) return false;
      }

      return true;
    });

    return list;
  }, [
    orders,
    selectedDepId,
    departments,
    isAdmin,
    isDepartmentManager,
    currentUser,
    globalSearch,
    siteSearch,
    startDate,
    endDate,
  ]);

  // Movements CSV Export
  const handleExportCSV = () => {
    if (filteredMovements.length === 0) {
      alert(tr(language, 'Aucun mouvement à exporter.', 'No movements to export.'));
      return;
    }

    const headers = [
      'Date',
      'Type',
      'Type_Origine',
      'Depot_Source',
      'Depot_Destination',
      'Numero_Commande',
      'Reference Produit',
      'Designation',
      'Quantite',
      'Chantier_Projet',
      'Operateur',
      'Departement',
      'Motif',
      'Cout_Total_EUR',
    ];

    const rows = filteredMovements.map((m) => {
      const prod = products.find((p) => p.id === m.product_id);
      const title = prod ? `${prod.brand} ${prod.model}` : m.product_ref || '';
      const isTrans = isTransferMovement(m);
      const srcDepot = getMovementSourceDepot(m) || (prod?.store_name ?? '');
      const dstDepot = getMovementDestDepot(m);
      return [
        m.created_at ? new Date(m.created_at).toLocaleString('fr-FR') : '',
        isTrans ? 'TRANSFERT' : (m.type || m.movement_type) === 'OUT' ? 'SORTIE' : 'ENTREE',
        isTrans ? 'TRANSFERT_INTER_DEPOT' : m.order_number ? 'COMMANDE' : 'MOUVEMENT_DIRECT_UNIQUE',
        `"${srcDepot.replace(/"/g, '""')}"`,
        `"${dstDepot.replace(/"/g, '""')}"`,
        `"${(m.order_number || 'N/A').replace(/"/g, '""')}"`,
        `"${(m.product_ref || '').replace(/"/g, '""')}"`,
        `"${title.replace(/"/g, '""')}"`,
        m.quantity ?? m.quantity_changed ?? 0,
        `"${(m.site_number || 'N/A').replace(/"/g, '""')}"`,
        `"${(m.user_name || '').replace(/"/g, '""')}"`,
        `"${(m.department_name || '').replace(/"/g, '""')}"`,
        `"${(m.reason || '').replace(/"/g, '""')}"`,
        (m.total_cost || 0).toFixed(2),
      ].join(';');
    });

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const filename = `journal_mouvements_${new Date().toISOString().split('T')[0]}.csv`;
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    logAuditEventServer({
      category: 'EXPORTS',
      type: 'csv_export',
      title: 'Export CSV des mouvements (Mobile)',
      description: `${filteredMovements.length} mouvements exportés`,
      meta: {
        rows: filteredMovements.length,
        filename,
      },
    }).catch(() => {});
  };

  // Orders CSV Export (User Requested)
  const handleExportOrdersCSV = () => {
    if (filteredOrders.length === 0) {
      alert(tr(language, 'Aucune commande à exporter.', 'No orders to export.'));
      return;
    }

    const headers = [
      'Numero_Commande',
      'Date_Creation',
      'Chantier_Projet',
      'Demandeur',
      'Departement',
      'Depot',
      'Statut',
      'Zone_Retrait',
      'Preparateur',
      'Nb_Articles',
      'Detail_Articles',
      'Notes',
      'Retire_Par',
      'Date_Retrait',
    ];

    const rows = filteredOrders.map((o: MaterialOrder) => {
      const itemsDetail = o.items
        .map(
          (it: MaterialOrderItem) =>
            `${it.product_ref} (${it.product_name}) x${it.quantity}${
              it.unavailable ? ' [RUPTURE]' : it.substituted ? ' [SUBSTITUÉ]' : ''
            }`
        )
        .join(' | ');

      return [
        `"${o.order_number}"`,
        o.created_at ? new Date(o.created_at).toLocaleString('fr-FR') : '',
        `"${(o.site_number || '').replace(/"/g, '""')}"`,
        `"${(o.requester_name || '').replace(/"/g, '""')}"`,
        `"${(o.requester_department || '').replace(/"/g, '""')}"`,
        `"${(o.depot_name || '').replace(/"/g, '""')}"`,
        o.status,
        `"${(o.pickup_zone || '').replace(/"/g, '""')}"`,
        `"${(o.preparer_name || '').replace(/"/g, '""')}"`,
        o.items.length,
        `"${itemsDetail.replace(/"/g, '""')}"`,
        `"${(o.notes || '').replace(/"/g, '""')}"`,
        `"${(o.collected_by || '').replace(/"/g, '""')}"`,
        o.collected_at ? new Date(o.collected_at).toLocaleString('fr-FR') : '',
      ].join(';');
    });

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const filename = `commandes_materiel_departement_${new Date().toISOString().split('T')[0]}.csv`;
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    logAuditEventServer({
      category: 'EXPORTS',
      type: 'csv_export',
      title: 'Export CSV des commandes matériel (Mobile)',
      description: `${filteredOrders.length} commandes exportées`,
      meta: {
        rows: filteredOrders.length,
        filename,
      },
    }).catch(() => {});
  };

  return (
    <div className="space-y-3 pb-24 animate-fadeIn">
      {/* Top Header */}
      <div className="flex items-center justify-between gap-2 relative overflow-hidden">
        <div className="min-w-0 flex-1 relative z-10 overflow-hidden">
          <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-1.5 min-w-0 overflow-hidden">
            <ArrowLeftRight className="w-4 h-4 text-orange-500 shrink-0 relative z-20" />
            <span className="truncate relative z-10">{t('mov_title')}</span>
          </h2>
          <p className="text-[11px] text-slate-400 truncate">
            {subTab === 'ORDERS'
              ? `${filteredOrders.length} ${tr(language, 'commandes répertoriées', 'orders found')}`
              : `${filteredMovements.length} ${t('mov_total_found')}`}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 relative z-20">
          {canTransferBetweenDepots && (
            <button
              type="button"
              data-testid="movements-transfer-btn"
              onClick={() => openStockTransferModal({})}
              className="py-1.5 px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition active:scale-95 cursor-pointer shrink-0 bg-sky-600 hover:bg-sky-700 text-white"
            >
              <ArrowLeftRight className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                {tr(
                  language,
                  'Transfert entre dépôts',
                  'Inter-depot transfer',
                  'Overdracht tussen depots'
                )}
              </span>
            </button>
          )}
          {canExportCSV && (
            <button
              onClick={subTab === 'ORDERS' ? handleExportOrdersCSV : handleExportCSV}
              className={`py-1.5 px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition active:scale-95 cursor-pointer shrink-0 relative z-20 overflow-hidden ${
                subTab === 'ORDERS'
                  ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 hover:bg-purple-100 border border-purple-200 dark:border-purple-800'
                  : 'bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 hover:bg-orange-100 border border-orange-200 dark:border-orange-800'
              }`}
            >
              <Download className="w-3.5 h-3.5 shrink-0 relative z-20" />
              <span className="truncate relative z-10">
                {subTab === 'ORDERS'
                  ? tr(language, 'Exporter les Commandes (CSV)', 'Export Orders (CSV)')
                  : t('mov_export_csv')}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs: My Movements vs Assigned Depots vs All vs Projects vs Department Orders */}
      {canSeeTabs && (canMyTab || canViewDepot || canViewAll || canProjTab || canOrdersTab) && (
        <div className="flex rounded-xl bg-slate-100 dark:bg-slate-800/80 p-1 border border-slate-200 dark:border-slate-700 gap-1 flex-wrap overflow-hidden">
          {canMyTab && (
            <button
              onClick={() => setSubTab('MY')}
              className={`flex-1 min-w-[90px] py-1.5 px-2 text-xs font-bold rounded-lg transition cursor-pointer relative overflow-hidden ${
                subTab === 'MY'
                  ? 'bg-white dark:bg-slate-900 text-orange-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <span className="truncate block relative z-10">{t('mov_my_tab')}</span>
            </button>
          )}

          {canViewDepot && (
            <button
              onClick={() => setSubTab('DEPOT')}
              className={`flex-1 min-w-[120px] py-1.5 px-2 text-xs font-bold rounded-lg transition cursor-pointer flex items-center justify-center gap-1 relative overflow-hidden ${
                subTab === 'DEPOT'
                  ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm font-extrabold'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <span className="truncate relative z-10">🚚 {tr(language, 'Mes Dépôts / Véhicules', 'My Depots / Vehicles')}</span>
            </button>
          )}

          {canViewAll && (
            <button
              onClick={() => setSubTab('ALL')}
              className={`flex-1 min-w-[110px] py-1.5 px-2 text-xs font-bold rounded-lg transition cursor-pointer flex items-center justify-center gap-1 relative overflow-hidden ${
                subTab === 'ALL'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm font-extrabold'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <span className="truncate relative z-10">🌐 {tr(language, 'Tous les flux', 'All Company')}</span>
            </button>
          )}

          {canProjTab && (
            <button
              onClick={() => setSubTab('PROJ')}
              className={`flex-1 min-w-[90px] py-1.5 px-2 text-xs font-bold rounded-lg transition cursor-pointer relative overflow-hidden ${
                subTab === 'PROJ'
                  ? 'bg-white dark:bg-slate-900 text-orange-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <span className="truncate block relative z-10">{t('mov_projects_tab')}</span>
            </button>
          )}

          {canOrdersTab && (
            <button
              onClick={() => setSubTab('ORDERS')}
              className={`flex-1 min-w-[130px] py-1.5 px-2 text-xs font-bold rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5 relative overflow-hidden ${
                subTab === 'ORDERS'
                  ? 'bg-white dark:bg-slate-900 text-purple-600 dark:text-purple-400 shadow-sm font-extrabold'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5 shrink-0 relative z-20" />
              <span className="truncate relative z-10">{tr(language, 'Commandes Département', 'Department Orders')}</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 font-black shrink-0 relative z-20">
                {filteredOrders.length}
              </span>
            </button>
          )}
        </div>
      )}

      {/* Filter Card */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3 space-y-2.5 shadow-sm text-xs overflow-hidden">
        {canFilterDep && (
          <div>
            <label className="font-bold text-slate-500 mb-1 flex items-center gap-1 min-w-0 overflow-hidden">
              <Building2 className="w-3 h-3 text-orange-500 shrink-0 relative z-20" />
              <span className="truncate relative z-10">{t('mov_filter_dep')}</span>
            </label>
            <SearchableSelect
              value={selectedDepId}
              onChange={(val) => setSelectedDepId(val)}
              className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none"
            >
              <option value="ALL">{t('mov_all_deps')}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </SearchableSelect>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div className="min-w-0">
            <label className="font-bold block text-slate-500 mb-1 truncate">
              {t('mov_global_search')}
            </label>
            <input
              type="text"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder={
                subTab === 'ORDERS'
                  ? tr(language, 'N° commande, article, demandeur...', 'Order #, item, requester...')
                  : t('mov_search_placeholder')
              }
              className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none"
            />
          </div>
          <div className="min-w-0">
            <label className="font-bold block text-slate-500 mb-1 truncate">{t('mov_site_filter')}</label>
            <input
              type="text"
              value={siteSearch}
              onChange={(e) => setSiteSearch(e.target.value)}
              placeholder="Ex: CH-2026..."
              className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="min-w-0">
            <label className="font-bold block text-slate-500 mb-1 truncate">📅 {t('mov_start_date')}</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none"
            />
          </div>
          <div className="min-w-0">
            <label className="font-bold block text-slate-500 mb-1 truncate">📅 {t('mov_end_date')}</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none"
            />
          </div>
        </div>

        {subTab !== 'ORDERS' && (
          <div className="flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 gap-1">
            {(
              [
                ['ALL', tr(language, 'Tous', 'All', 'Alle')],
                ['IN', tr(language, 'Entrées', 'Inflows', 'Innames')],
                ['OUT', tr(language, 'Sorties', 'Outflows', 'Uitgiftes')],
                ['TRANSFER', tr(language, 'Transferts', 'Transfers', 'Overdrachten')],
              ] as const
            ).map(([tf, label]) => (
              <button
                key={tf}
                type="button"
                data-testid={`movements-type-filter-${tf.toLowerCase()}`}
                onClick={() => setTypeFilter(tf)}
                className={`flex-1 py-1 px-2 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                  typeFilter === tf
                    ? tf === 'TRANSFER'
                      ? 'bg-sky-600 text-white shadow-2xs'
                      : 'bg-white dark:bg-slate-900 text-orange-600 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main Content: Orders Tab View vs Movements List View */}
      {subTab === 'ORDERS' ? (
        <div className="space-y-2.5">
          {filteredOrders.length === 0 ? (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 text-slate-400 text-xs space-y-1">
              <ShoppingBag className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
              <p className="font-bold text-slate-700 dark:text-slate-300">
                {tr(language, 'Aucune commande trouvée', 'No orders found')}
              </p>
              <p className="text-[11px] text-slate-400">
                {tr(language, 'Modifiez vos filtres ou la période sélectionnée.', 'Adjust filters or selected dates.')}
              </p>
            </div>
          ) : (
            filteredOrders.map((order: MaterialOrder) => {
              const isExpanded = expandedOrderIds.has(order.id);
              const isWaitingApproval = order.status === 'WAITING_APPROVAL';
              const isPending = order.status === 'PENDING';
              const isPreparing = order.status === 'PREPARING';
              const isReady = order.status === 'READY';
              const isCollected = order.status === 'COLLECTED';
              const isRejected = order.status === 'REJECTED';
              const totalItems = order.items.length;
              const unavailableItems = order.items.filter((it: MaterialOrderItem) => it.unavailable);
              const substitutedItems = order.items.filter((it: MaterialOrderItem) => it.substituted);

              return (
                <div
                  key={order.id}
                  className={`rounded-2xl border transition shadow-xs p-3.5 space-y-2.5 overflow-hidden ${
                    isWaitingApproval
                      ? 'bg-purple-50/50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800 ring-1 ring-purple-500/20'
                      : isRejected
                      ? 'bg-rose-50/40 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/50'
                      : isPending
                      ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50'
                      : isPreparing
                      ? 'bg-blue-50/40 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/50'
                      : isReady
                      ? 'bg-purple-50/40 dark:bg-purple-950/20 border-purple-200 dark:border-purple-900/50'
                      : 'bg-emerald-50/30 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/50'
                  }`}
                >
                  {/* Order Header Row */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0 flex-1 relative z-10">
                      <span className="font-mono font-black text-xs text-slate-900 dark:text-white bg-white dark:bg-slate-800 px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-700 shadow-2xs shrink-0">
                        {order.order_number}
                      </span>

                      <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-300 flex items-center gap-1 min-w-0 overflow-hidden">
                        <Building2 className="w-3.5 h-3.5 shrink-0 relative z-20" />
                        <span className="truncate relative z-10">Chantier {order.site_number}</span>
                      </span>

                      {order.total_cost !== undefined && order.total_cost > 0 && (
                        <span className="text-xs font-extrabold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-700 shadow-2xs shrink-0">
                          {formatCurrency(order.total_cost)}
                        </span>
                      )}

                      {/* Status Badge */}
                      {isWaitingApproval && (
                        <span className="px-2 py-0.5 rounded-lg text-[11px] font-black bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-300 border border-purple-300 dark:border-purple-800 flex items-center gap-1 shadow-2xs shrink-0">
                          <ShieldAlert className="w-3 h-3 text-purple-600 shrink-0 relative z-20" />
                          <span className="relative z-10">{tr(language, 'À Valider', 'Approval Req.')}</span>
                        </span>
                      )}
                      {isRejected && (
                        <span className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-300 flex items-center gap-1 shrink-0">
                          <X className="w-3 h-3 text-rose-600 shrink-0 relative z-20" />
                          <span className="relative z-10">{tr(language, 'Refusée', 'Rejected')}</span>
                        </span>
                      )}
                      {isPending && (
                        <span className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800 flex items-center gap-1 shrink-0">
                          <Clock className="w-3 h-3 text-amber-600 shrink-0 relative z-20" />
                          <span className="relative z-10">{tr(language, 'À Préparer', 'Pending')}</span>
                        </span>
                      )}
                      {isPreparing && (
                        <span className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-300 dark:border-blue-800 flex items-center gap-1 min-w-0 overflow-hidden">
                          <Clock className="w-3 h-3 animate-spin text-blue-600 shrink-0 relative z-20" />
                          <span className="truncate relative z-10">En cours : {order.preparer_name || 'Magasinier'}</span>
                        </span>
                      )}
                      {isReady && (
                        <span className="px-2 py-0.5 rounded-lg text-[11px] font-black bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 border border-purple-300 dark:border-purple-800 flex items-center gap-1 shrink-0">
                          <CheckCircle2 className="w-3 h-3 text-purple-600 shrink-0 relative z-20" />
                          <span className="relative z-10">Prête au retrait</span>
                        </span>
                      )}
                      {isCollected && (
                        <span className="px-2 py-0.5 rounded-lg text-[11px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 flex items-center gap-1 min-w-0 overflow-hidden">
                          <PackageCheck className="w-3 h-3 text-emerald-600 shrink-0 relative z-20" />
                          <span className="truncate relative z-10">Retirée ({order.collected_by || 'Demandeur'})</span>
                        </span>
                      )}

                      {unavailableItems.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded-md text-[10px] font-extrabold bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border border-rose-300 flex items-center gap-1 shrink-0">
                          <AlertTriangle className="w-3 h-3 shrink-0 relative z-20" />
                          <span className="relative z-10">{unavailableItems.length} rupture</span>
                        </span>
                      )}

                      {substitutedItems.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded-md text-[10px] font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 flex items-center gap-1 shrink-0">
                          <RefreshCw className="w-3 h-3 shrink-0 relative z-20" />
                          <span className="relative z-10">{substitutedItems.length} substitué</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 relative z-20">
                      {isWaitingApproval && canApproveOrder(order) && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => approveOrder(order.id)}
                            className="py-1 px-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs shadow-xs transition active:scale-95 cursor-pointer flex items-center gap-1 shrink-0 relative z-20"
                            title={tr(language, 'Valider la commande', 'Approve')}
                          >
                            <Check className="w-3.5 h-3.5 shrink-0 relative z-20" />
                            <span className="relative z-10">{tr(language, 'Valider', 'Approve')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const reason = prompt(
                                tr(language, 'Motif de refus de la commande :', 'Rejection reason:')
                              );
                              if (reason !== null && reason.trim()) {
                                rejectOrder(order.id, reason.trim());
                              }
                            }}
                            className="py-1 px-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-bold text-xs border border-rose-200 dark:border-rose-800 transition active:scale-95 cursor-pointer flex items-center gap-1 shrink-0 relative z-20"
                            title={tr(language, 'Refuser la commande', 'Reject')}
                          >
                            <X className="w-3.5 h-3.5 shrink-0 relative z-20" />
                            <span className="relative z-10">{tr(language, 'Refuser', 'Reject')}</span>
                          </button>
                        </div>
                      )}

                      {/* Accordion toggle button */}
                      <button
                        type="button"
                        onClick={() => toggleExpandOrder(order.id)}
                        className="py-1 px-2.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shrink-0 relative z-20"
                      >
                        <span className="relative z-10">{isExpanded ? 'Masquer contenu' : 'Voir contenu'}</span>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 shrink-0 relative z-20">
                          {totalItems} art.
                        </span>
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5 shrink-0 relative z-20" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0 relative z-20" />}
                      </button>
                    </div>
                  </div>

                  {/* Metadata line */}
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
                    <span className="font-bold flex items-center gap-1 text-slate-800 dark:text-slate-200 min-w-0 overflow-hidden">
                      <User className="w-3.5 h-3.5 text-slate-400 shrink-0 relative z-20" />
                      <span className="truncate relative z-10">{order.requester_name}</span>
                      {order.requester_department && (
                        <span className="text-slate-500 font-normal truncate relative z-10">({order.requester_department})</span>
                      )}
                    </span>

                    <span>•</span>

                    <span className="text-[11px] text-slate-500 flex items-center gap-1 shrink-0">
                      <Calendar className="w-3 h-3 shrink-0 relative z-20" />
                      <span className="relative z-10">{new Date(order.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                    </span>

                    {order.approved_by && (
                      <>
                        <span>•</span>
                        <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1 min-w-0 overflow-hidden">
                          <CheckCircle2 className="w-3 h-3 shrink-0 relative z-20" />
                          <span className="truncate relative z-10">Validée par {order.approved_by}</span>
                        </span>
                      </>
                    )}

                    {order.rejected_by && (
                      <>
                        <span>•</span>
                        <span className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-1 min-w-0 overflow-hidden">
                          <X className="w-3 h-3 shrink-0 relative z-20" />
                          <span className="truncate relative z-10">Refusée par {order.rejected_by} {order.rejection_reason ? `(« ${order.rejection_reason} »)` : ''}</span>
                        </span>
                      </>
                    )}

                    {order.depot_name && (
                      <>
                        <span>•</span>
                        <span className="text-[11px] text-slate-500 font-medium truncate">🏢 {order.depot_name}</span>
                      </>
                    )}

                    {order.pickup_zone && (
                      <>
                        <span>•</span>
                        <span className="text-[11px] font-bold text-purple-700 dark:text-purple-300 flex items-center gap-1 min-w-0 overflow-hidden">
                          <MapPin className="w-3 h-3 shrink-0 relative z-20" />
                          <span className="truncate relative z-10">{order.pickup_zone}</span>
                        </span>
                      </>
                    )}
                  </div>

                  {order.notes && (
                    <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-xs text-amber-800 dark:text-amber-200">
                      <strong>Note :</strong> {order.notes}
                    </div>
                  )}

                  {/* Full Order Contents (Expandable Accordion) */}
                  {isExpanded && (
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2 animate-fadeIn">
                      <div className="text-[11px] font-extrabold text-slate-700 dark:text-slate-300 flex items-center justify-between gap-2 relative overflow-hidden">
                        <span className="truncate min-w-0 flex-1 relative z-10">Contenu de la commande ({order.items.length} articles) :</span>
                        <span className="text-[10px] text-slate-400 shrink-0 relative z-20">
                          {order.collected_at ? `Clôturée le ${new Date(order.collected_at).toLocaleString('fr-FR')}` : 'En cours'}
                        </span>
                      </div>

                      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden text-xs">
                        {order.items.map((it: MaterialOrderItem, idx: number) => (
                          <div
                            key={idx}
                            className={`p-2.5 transition flex flex-col gap-1 overflow-hidden ${
                              it.unavailable
                                ? 'bg-rose-50/50 dark:bg-rose-950/20'
                                : it.substituted
                                ? 'bg-amber-50/50 dark:bg-amber-950/20'
                                : ''
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 relative overflow-hidden">
                              <div className="flex items-center gap-2 min-w-0 flex-1 relative z-10 overflow-hidden">
                                <span className="font-mono font-bold text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-700 dark:text-slate-300 shrink-0 relative z-20">
                                  {it.product_ref}
                                </span>
                                <span className="font-bold text-slate-900 dark:text-white truncate relative z-10">
                                  {it.product_name}
                                </span>
                              </div>

                              <span className="font-extrabold text-xs text-slate-900 dark:text-white shrink-0 relative z-20 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-lg">
                                {it.quantity} {it.unit || 'pc'}
                              </span>
                            </div>

                            {/* Rupture info */}
                            {it.unavailable && (
                              <div className="text-[11px] text-rose-600 dark:text-rose-400 font-bold flex items-center gap-1 min-w-0 overflow-hidden">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0 relative z-20" />
                                <span className="truncate relative z-10">Article en rupture : {it.unavailable_comment || 'Non disponible magasin'}</span>
                              </div>
                            )}

                            {/* Substituted info */}
                            {it.substituted && (
                              <div className="text-[11px] text-amber-700 dark:text-amber-300 font-bold flex items-center gap-1 min-w-0 overflow-hidden">
                                <RefreshCw className="w-3.5 h-3.5 text-amber-600 shrink-0 relative z-20" />
                                <span className="truncate relative z-10">
                                  Substitué par : <strong>{it.substituted_with_ref} - {it.substituted_with_name}</strong>
                                </span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Audit History Timeline for this Order */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[10px] text-slate-500 dark:text-slate-400 pt-1">
                        <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
                          <span className="font-bold block text-slate-700 dark:text-slate-300 truncate">1. Reçue</span>
                          <span>{new Date(order.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
                          <span className="font-bold block text-slate-700 dark:text-slate-300 truncate">2. Prise en charge</span>
                          <span>{order.assigned_at ? new Date(order.assigned_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                        </div>
                        <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
                          <span className="font-bold block text-slate-700 dark:text-slate-300 truncate">3. Fin préparation</span>
                          <span>{order.ready_at ? new Date(order.ready_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                        </div>
                        <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
                          <span className="font-bold block text-slate-700 dark:text-slate-300 truncate">4. Retrait</span>
                          <span>{order.collected_at ? new Date(order.collected_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* Movements List */
        <div className="space-y-2">
          {groupedMovements.length === 0 ? (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 text-slate-400 text-xs">
              {t('mov_no_records')}
            </div>
          ) : (
            groupedMovements.map((group) => {
              const isMultiLineBatch = Boolean(group.batchId && group.items.length > 1);
              return (
                <div
                  key={group.key}
                  data-testid={group.batchId ? `transfer-batch-group-${group.batchId}` : undefined}
                  className={
                    isMultiLineBatch
                      ? 'rounded-2xl border-2 border-sky-300 dark:border-sky-800 bg-sky-50/30 dark:bg-sky-950/20 p-2.5 space-y-2'
                      : ''
                  }
                >
                  {isMultiLineBatch && (
                    <div className="flex items-center justify-between gap-2 px-1 text-[11px] font-black text-sky-800 dark:text-sky-200">
                      <span className="flex items-center gap-1.5">
                        <ArrowLeftRight className="w-3.5 h-3.5 text-sky-600" />
                        {tr(
                          language,
                          `Lot de transfert (${group.items.length} articles, ${group.totalQuantity} pces)`,
                          `Transfer batch (${group.items.length} items, ${group.totalQuantity} pcs)`,
                          `Overdrachtsbatch (${group.items.length} artikelen, ${group.totalQuantity} st.)`
                        )}
                      </span>
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300">
                        {group.sourceDepot} → {group.destDepot}
                      </span>
                    </div>
                  )}

                  {group.items.map((m) => {
                    const isTrans = isTransferMovement(m);
                    const isOut = (m.type || m.movement_type) === 'OUT';
                    const prod = products.find((p) => String(p.id) === String(m.product_id));
                    const title = prod ? `${prod.brand} ${prod.model}` : m.product_ref;
                    const srcDepot = getMovementSourceDepot(m);
                    const dstDepot = getMovementDestDepot(m);
                    const qty = Number(m.quantity ?? m.quantity_changed ?? 0);

                    return (
                      <div
                        key={m.id}
                        onClick={() => setActiveProductId(String(m.product_id))}
                        className={`p-3 rounded-2xl border transition cursor-pointer active:scale-[0.99] shadow-sm overflow-hidden ${
                          isTrans
                            ? 'bg-sky-50/50 dark:bg-sky-950/25 border-sky-200 dark:border-sky-900/60 hover:border-sky-400'
                            : isOut
                            ? 'bg-rose-50/40 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/50 hover:border-rose-400'
                            : 'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/50 hover:border-emerald-400'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 relative overflow-hidden">
                          <div className="flex items-center gap-1.5 flex-wrap min-w-0 flex-1 relative z-10">
                            {isTrans ? (
                              <span className="inline-flex items-center gap-1 text-xs font-black px-2 py-0.5 rounded-lg shrink-0 bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                                <ArrowLeftRight className="w-3 h-3 shrink-0" />
                                <span>
                                  {tr(language, 'TRANSFERT', 'TRANSFER', 'OVERDRACHT')}
                                </span>
                              </span>
                            ) : (
                              <span
                                className={`inline-flex items-center gap-1 text-xs font-black px-2 py-0.5 rounded-lg shrink-0 ${
                                  isOut
                                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400'
                                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                                }`}
                              >
                                {isOut ? (
                                  <ArrowDownCircle className="w-3 h-3 shrink-0 relative z-20" />
                                ) : (
                                  <ArrowUpCircle className="w-3 h-3 shrink-0 relative z-20" />
                                )}
                                <span className="relative z-10">
                                  {isOut
                                    ? t('mov_type_out').toUpperCase()
                                    : t('mov_type_in').toUpperCase()}
                                </span>
                              </span>
                            )}

                            {isTrans && srcDepot && dstDepot ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-black px-2 py-0.5 rounded-lg bg-white dark:bg-slate-800 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 min-w-0 overflow-hidden">
                                <span className="truncate">
                                  {srcDepot} → {dstDepot}
                                </span>
                              </span>
                            ) : m.order_number ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-black px-2 py-0.5 rounded-lg bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 border border-purple-200 dark:border-purple-800 shadow-2xs min-w-0 overflow-hidden">
                                <ShoppingBag className="w-3 h-3 text-purple-600 shrink-0 relative z-20" />
                                <span className="truncate relative z-10">
                                  {tr(
                                    language,
                                    `Commande N° ${m.order_number}`,
                                    `Order #${m.order_number}`
                                  )}
                                </span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700 min-w-0 overflow-hidden">
                                <span className="truncate relative z-10">
                                  ⚡{' '}
                                  {tr(
                                    language,
                                    'Mouvement Unique (Direct)',
                                    'Single Movement'
                                  )}
                                </span>
                              </span>
                            )}
                          </div>

                          <span className="font-extrabold text-sm text-slate-900 dark:text-white shrink-0 relative z-20">
                            {isTrans ? '' : isOut ? '-' : '+'}
                            {qty}{' '}
                            <span className="text-xs font-medium text-slate-400">
                              {t('mov_units')}
                            </span>
                          </span>
                        </div>

                        <div className="mt-1.5 font-bold text-xs text-slate-900 dark:text-white leading-tight truncate relative z-10">
                          {title}{' '}
                          <span className="text-orange-600 font-semibold">
                            ({m.product_ref})
                          </span>
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400 relative z-10">
                          <span>📅 {formatDate(m.created_at)}</span>
                          <span>•</span>
                          <span className="truncate">
                            {tr(language, 'Par', 'By')} :{' '}
                            <strong>
                              {m.user_name || tr(language, 'Opérateur', 'Operator')}
                            </strong>
                          </span>
                          {m.site_number && (
                            <>
                              <span>•</span>
                              <span className="font-bold text-orange-600 truncate">
                                🏗️ {m.site_number}
                              </span>
                            </>
                          )}
                          {m.department_name && (
                            <>
                              <span>•</span>
                              <span className="truncate">🏢 {m.department_name}</span>
                            </>
                          )}
                          {srcDepot && (
                            <>
                              <span>•</span>
                              <span className="font-semibold text-emerald-700 dark:text-emerald-400 truncate">
                                📦 {srcDepot}
                              </span>
                            </>
                          )}
                          {dstDepot && (
                            <>
                              <span>→</span>
                              <span className="font-semibold text-sky-700 dark:text-sky-400 truncate">
                                📦 {dstDepot}
                              </span>
                            </>
                          )}
                          {m.reason && (
                            <>
                              <span>•</span>
                              <span className="italic text-slate-600 dark:text-slate-300 truncate">
                                « {m.reason} »
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
