import React, { useState, useMemo } from 'react';
import { tr } from '../i18n/dutchTranslator';
import { useApp } from '../context/AppContext';
import {
  ActivityItem,
  ActivityCategory,
  buildCombinedActivities,
  formatRelativeTime,
} from '../services/activityService';
import { formatCurrency, formatDate } from '../utils/crypto';
import { StockMovement } from '../types';
import {
  Activity,
  ArrowDownCircle,
  ArrowUpCircle,
  QrCode,
  Barcode,
  Layers,
  Sparkles,
  ClipboardCheck,
  Search,
  X,
  ChevronRight,
  ExternalLink,
  ShieldCheck,
  Clock,
  User as UserIcon,
  MapPin,
  Building2,
  Package,
  Calendar,
  Info,
  RefreshCw,
  Lock,
} from 'lucide-react';

interface RecentActivityFeedProps {
  customMovements?: StockMovement[];
  scopeLabel?: string;
}

export const RecentActivityFeed: React.FC<RecentActivityFeedProps> = ({ customMovements, scopeLabel }) => {
  const {
    movements: defaultMovements,
    products,
    storedActivities,
    setActiveProductId,
    setActiveTab,
    currentUser,
    userHasPermission,
    language,
    t,
  } = useApp();

  const movements = customMovements || defaultMovements;

  const [categoryFilter, setCategoryFilter] = useState<ActivityCategory>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(6);
  const [selectedActivity, setSelectedActivity] = useState<ActivityItem | null>(null);

  const canViewAllLoginLogs =
    userHasPermission('perm_view_all_login_logs') ||
    Number(currentUser?.id) === 0 ||
    Number(currentUser?.role_id) === 0;

  const canViewPrices = userHasPermission('perm_prod_view_price');

  // Combine real stock movements and logged activities into a single chronological stream with role-based privacy for login logs
  const allActivities = useMemo(() => {
    const rawStream = buildCombinedActivities(movements, products, storedActivities);
    if (canViewAllLoginLogs) return rawStream;

    return rawStream.filter((item) => {
      const isLoginOrConnexion =
        item.category === 'SYSTEM' &&
        (item.type === 'USER_ACTION' ||
          item.title.toLowerCase().includes('connexion') ||
          item.title.toLowerCase().includes('sign-in') ||
          item.title.toLowerCase().includes('pin'));

      if (!isLoginOrConnexion) return true;

      // Regular users without perm_view_all_login_logs only see their own login logs
      const isSelf =
        (item.user_name && currentUser?.name && item.user_name.toLowerCase() === currentUser.name.toLowerCase()) ||
        (item.user_trigram && currentUser?.trigram && item.user_trigram.toUpperCase() === currentUser.trigram.toUpperCase());

      return Boolean(isSelf);
    });
  }, [movements, products, storedActivities, canViewAllLoginLogs, currentUser]);

  // Activity counts for category tabs
  const counts = useMemo(() => {
    let movCount = 0;
    let scanCount = 0;
    let sysCount = 0;

    for (const a of allActivities) {
      if (a.category === 'MOVEMENTS') movCount++;
      else if (a.category === 'SCANS') scanCount++;
      else if (a.category === 'SYSTEM') sysCount++;
    }

    return {
      all: allActivities.length,
      movements: movCount,
      scans: scanCount,
      system: sysCount,
    };
  }, [allActivities]);

  // 24h KPI summary
  const last24hCounts = useMemo(() => {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    let movs = 0;
    let scans = 0;
    let sys = 0;

    for (const a of allActivities) {
      const t = new Date(a.timestamp).getTime();
      if (t >= oneDayAgo) {
        if (a.category === 'MOVEMENTS') movs++;
        else if (a.category === 'SCANS') scans++;
        else if (a.category === 'SYSTEM') sys++;
      }
    }

    return { movs, scans, sys, total: movs + scans + sys };
  }, [allActivities]);

  // Filtered activity feed
  const filteredActivities = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return allActivities.filter((item) => {
      // Category filter
      if (categoryFilter !== 'ALL' && item.category !== categoryFilter) {
        return false;
      }

      // Search filter
      if (q) {
        const titleMatch = item.title.toLowerCase().includes(q);
        const descMatch = item.description.toLowerCase().includes(q);
        const userMatch = item.user_name?.toLowerCase().includes(q) || item.user_trigram?.toLowerCase().includes(q);
        const refMatch = item.product_ref?.toLowerCase().includes(q);
        const siteMatch = item.site_number?.toLowerCase().includes(q);
        const depotMatch = item.depot_name?.toLowerCase().includes(q);
        const codeMatch = item.meta?.scannedCode?.toLowerCase().includes(q);

        if (!titleMatch && !descMatch && !userMatch && !refMatch && !siteMatch && !depotMatch && !codeMatch) {
          return false;
        }
      }

      return true;
    });
  }, [allActivities, categoryFilter, searchQuery]);

  const displayedList = useMemo(() => {
    return filteredActivities.slice(0, visibleCount);
  }, [filteredActivities, visibleCount]);

  // Icon and visual color style per activity type
  const getActivityVisuals = (item: ActivityItem) => {
    switch (item.type) {
      case 'STOCK_IN':
        return {
          icon: <ArrowDownCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />,
          bg: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60',
          badgeBg: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300',
          badgeText: tr(language, 'Entrée Réappro', 'Stock In'),
          pillColor: 'text-emerald-600 dark:text-emerald-400 font-black',
        };
      case 'STOCK_OUT':
        return {
          icon: <ArrowUpCircle className="w-5 h-5 text-rose-600 dark:text-rose-400" />,
          bg: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/60',
          badgeBg: 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-300',
          badgeText: tr(language, 'Sortie Chantier', 'Stock Out'),
          pillColor: 'text-rose-600 dark:text-rose-400 font-black',
        };
      case 'SCAN_FOUND':
        return {
          icon: <QrCode className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />,
          bg: 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800/60',
          badgeBg: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-300',
          badgeText: item.meta?.scanFormat === 'EAN_13' ? 'Scan Code-barres' : 'Scan QR',
          pillColor: 'text-indigo-600 dark:text-indigo-400 font-bold',
        };
      case 'SCAN_NOT_FOUND':
        return {
          icon: <Barcode className="w-5 h-5 text-amber-600 dark:text-amber-400" />,
          bg: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60',
          badgeBg: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300',
          badgeText: tr(language, 'Code Non Répertorié', 'Unknown Code'),
          pillColor: 'text-amber-600 dark:text-amber-400 font-bold',
        };
      case 'SCAN_CONFIG':
        return {
          icon: <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />,
          bg: 'bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800/60',
          badgeBg: 'bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-300',
          badgeText: tr(language, 'Scan Config', 'Config Scan'),
          pillColor: 'text-purple-600 dark:text-purple-400 font-bold',
        };
      case 'SCAN_INVENTORY':
        return {
          icon: <ClipboardCheck className="w-5 h-5 text-blue-600 dark:text-blue-400" />,
          bg: 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/60',
          badgeBg: 'bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300',
          badgeText: tr(language, 'Scan Inventaire', 'Audit Scan'),
          pillColor: 'text-blue-600 dark:text-blue-400 font-bold',
        };
      case 'INVENTORY_AUDIT':
        return {
          icon: <ClipboardCheck className="w-5 h-5 text-teal-600 dark:text-teal-400" />,
          bg: 'bg-teal-50 dark:bg-teal-950/40 border-teal-200 dark:border-teal-800/60',
          badgeBg: 'bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-300',
          badgeText: tr(language, 'Audit & Écarts', 'Audit Adjustment'),
          pillColor: 'text-teal-600 dark:text-teal-400 font-bold',
        };
      case 'PRODUCT_CREATED':
      case 'PRODUCT_UPDATED':
      case 'PRODUCT_DELETED':
        return {
          icon: <Package className="w-5 h-5 text-sky-600 dark:text-sky-400" />,
          bg: 'bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800/60',
          badgeBg: 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-300',
          badgeText:
            item.type === 'PRODUCT_CREATED'
              ? (tr(language, 'Création Article', 'New Item'))
              : item.type === 'PRODUCT_DELETED'
              ? (tr(language, 'Suppression', 'Deleted'))
              : (tr(language, 'Fiche Produit', 'Item Update')),
          pillColor: 'text-sky-600 dark:text-sky-400 font-bold',
        };
      case 'DEPOT_UPDATED':
        return {
          icon: <Building2 className="w-5 h-5 text-orange-600 dark:text-orange-400" />,
          bg: 'bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-800/60',
          badgeBg: 'bg-orange-100 text-orange-800 dark:bg-orange-900/60 dark:text-orange-300',
          badgeText: tr(language, 'Dépôt / Magasin', 'Warehouse'),
          pillColor: 'text-orange-600 dark:text-orange-400 font-bold',
        };
      case 'SYSTEM_SYNC':
      default:
        return {
          icon: <Layers className="w-5 h-5 text-slate-600 dark:text-slate-400" />,
          bg: 'bg-slate-50 dark:bg-slate-900/80 border-slate-200 dark:border-slate-800',
          badgeBg: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-300',
          badgeText: tr(language, 'Système & DB', 'System & DB'),
          pillColor: 'text-slate-600 dark:text-slate-400 font-bold',
        };
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm space-y-4">
      {/* Header with Title & Real-time Live Badge */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-orange-50 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400 flex items-center justify-center font-bold">
              <Activity className="w-4 h-4 animate-pulse" />
            </div>
            <h2 className="text-sm font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
              <span>{t('dash_recent_activity_title')}</span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                {t('dash_activity_badge_realtime')}
              </span>
            </h2>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {t('dash_recent_activity_subtitle')}
          </p>
        </div>

        {/* 24h Activity Mini KPI & Log Privacy Scope */}
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <div className="flex items-center gap-2 text-[10px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1 rounded-xl border border-slate-200 dark:border-slate-700/60">
            <Clock className="w-3 h-3 text-orange-500" />
            <span>{t('dash_activity_kpi_24h')}</span>
            <span className="font-extrabold text-slate-800 dark:text-slate-200">
              {last24hCounts.movs} {t('dash_activity_count_movements')}, {last24hCounts.scans} {t('dash_activity_count_scans')}, {last24hCounts.sys} {t('dash_activity_count_updates')}
            </span>
          </div>

          <div
            className={`flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-xl border ${
              canViewAllLoginLogs
                ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800/60'
                : 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800/60'
            }`}
            title={
              canViewAllLoginLogs
                ? (tr(language, 'Votre rôle vous autorise à voir les logs de connexion de tous les utilisateurs.', 'Your role allows you to view login logs of all users.'))
                : (tr(language, 'Confidentialité active : vous visualisez uniquement vos propres logs de connexion.', 'Privacy active: you only view your own connection logs.'))
            }
          >
            {canViewAllLoginLogs ? (
              <>
                <ShieldCheck className="w-3 h-3 text-amber-600" />
                <span>{tr(language, 'Supervision : Tous les logs', 'Supervisor: All logs')}</span>
              </>
            ) : (
              <>
                <Lock className="w-3 h-3 text-blue-600" />
                <span>{tr(language, 'Mes logs uniquement', 'My logs only')}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="space-y-2.5">
        {/* Category Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => {
              setCategoryFilter('ALL');
              setVisibleCount(6);
            }}
            className={`px-2.5 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 shrink-0 ${
              categoryFilter === 'ALL'
                ? 'bg-orange-600 text-white shadow-sm shadow-orange-500/20'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <span>{t('dash_activity_all')}</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-extrabold ${
                categoryFilter === 'ALL'
                  ? 'bg-white/20 text-white'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              {counts.all}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCategoryFilter('MOVEMENTS');
              setVisibleCount(6);
            }}
            className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 shrink-0 ${
              categoryFilter === 'MOVEMENTS'
                ? 'bg-orange-600 text-white shadow-sm shadow-orange-500/20'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <span>📦 {t('dash_activity_movements')}</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-extrabold ${
                categoryFilter === 'MOVEMENTS'
                  ? 'bg-white/20 text-white'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              {counts.movements}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCategoryFilter('SCANS');
              setVisibleCount(6);
            }}
            className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 shrink-0 ${
              categoryFilter === 'SCANS'
                ? 'bg-orange-600 text-white shadow-sm shadow-orange-500/20'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <span>📷 {t('dash_activity_scans')}</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-extrabold ${
                categoryFilter === 'SCANS'
                  ? 'bg-white/20 text-white'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              {counts.scans}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCategoryFilter('SYSTEM');
              setVisibleCount(6);
            }}
            className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 shrink-0 ${
              categoryFilter === 'SYSTEM'
                ? 'bg-orange-600 text-white shadow-sm shadow-orange-500/20'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <span>⚙️ {t('dash_activity_system')}</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-extrabold ${
                categoryFilter === 'SYSTEM'
                  ? 'bg-white/20 text-white'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              {counts.system}
            </span>
          </button>
        </div>

        {/* Search input with reset button */}
        <div className="relative overflow-hidden">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-20 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setVisibleCount(6);
            }}
            placeholder={t('dash_activity_search_ph')}
            className="w-full pl-8 pr-8 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-orange-500 relative z-10"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded z-20 shrink-0"
            >
              <X className="w-3.5 h-3.5 shrink-0" />
            </button>
          )}
        </div>

        {/* Privacy & Log Access Indicator */}
        {(categoryFilter === 'SYSTEM' || categoryFilter === 'ALL') && (
          <div className="flex items-center justify-between gap-2 p-2 px-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 text-[11px] animate-fadeIn relative overflow-hidden">
            <div className="flex items-center gap-1.5 min-w-0 flex-1 relative z-10 overflow-hidden">
              {canViewAllLoginLogs ? (
                <>
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-500 shrink-0 relative z-20" />
                  <span className="font-bold text-slate-700 dark:text-slate-300 truncate relative z-10">
                    {tr(language, "👑 Mode Superviseur : Affichage de l'ensemble des connexions de l'entreprise", 'Supervisor Mode: Full view of all company sign-ins')}
                  </span>
                </>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0 relative z-20" />
                  <span className="text-slate-600 dark:text-slate-400 truncate relative z-10">
                    {tr(language, '🔒 Confidentialité active : Seules vos propres connexions sont visibles', 'Log privacy active: Only your personal sign-ins are displayed')}
                  </span>
                </>
              )}
            </div>
            <span className="text-[10px] text-slate-400 font-medium shrink-0 relative z-20">
              {tr(language, 'Droits RBAC', 'RBAC Rights')}
            </span>
          </div>
        )}
      </div>

      {/* Chronological Activity Feed List */}
      <div className="space-y-2">
        {displayedList.length === 0 ? (
          <div className="p-8 text-center rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-700">
            <Info className="w-6 h-6 text-slate-400 mx-auto mb-2 opacity-60" />
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              {t('dash_activity_no_results')}
            </p>
            {(searchQuery || categoryFilter !== 'ALL') && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setCategoryFilter('ALL');
                }}
                className="mt-3 inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-bold text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/60 border border-orange-200 dark:border-orange-800 cursor-pointer"
              >
                <span>{t('dash_activity_clear_filter')}</span>
              </button>
            )}
          </div>
        ) : (
          displayedList.map((item) => {
            const visual = getActivityVisuals(item);
            const hasProduct = Boolean(item.product_id);

            return (
              <div
                key={item.id}
                className="group relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-orange-500/50 p-3 rounded-xl transition shadow-sm hover:shadow-md flex items-start justify-between gap-3 overflow-hidden"
              >
                {/* Left Visual Icon */}
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 relative z-20 border ${visual.bg}`}
                >
                  {visual.icon}
                </div>

                {/* Main Content Area */}
                <div className="flex-1 min-w-0 relative z-10 overflow-hidden">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span
                      className={`text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-md shrink-0 ${visual.badgeBg}`}
                    >
                      {visual.badgeText}
                    </span>

                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium shrink-0">
                      {formatRelativeTime(item.timestamp, language as 'fr' | 'en')}
                    </span>

                    {item.site_number && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 truncate">
                        🏗️ {item.site_number}
                      </span>
                    )}

                    {item.depot_name && (
                      <span className="text-[9px] font-medium text-slate-500 dark:text-slate-400 truncate">
                        📍 {item.depot_name}
                      </span>
                    )}
                  </div>

                  {/* Title & Description */}
                  <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                    {item.title}
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                    {item.description}
                  </p>

                  {/* Operator / User Trigram & Extra Traceability Tags */}
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400 overflow-hidden">
                    <span className="flex items-center gap-1 font-medium min-w-0 truncate">
                      <UserIcon className="w-2.5 h-2.5 text-slate-400 shrink-0 relative z-20" />
                      <span className="truncate relative z-10">{item.user_name || 'Opérateur'} {item.user_trigram ? `(${item.user_trigram})` : ''}</span>
                    </span>

                    {item.meta?.scannedCode && (
                      <span className="font-mono text-[9px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.2 rounded text-slate-600 dark:text-slate-300 shrink-0">
                        Code: {item.meta.scannedCode}
                      </span>
                    )}

                    {canViewPrices && item.meta?.totalCost !== undefined && item.meta.totalCost > 0 && (
                      <span className="font-bold text-slate-600 dark:text-slate-300 shrink-0">
                        • {formatCurrency(item.meta.totalCost)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Right Badge / Action Controls */}
                <div className="flex flex-col items-end gap-1.5 shrink-0 relative z-20">
                  {item.badgeText && (
                    <div className={`text-xs shrink-0 ${visual.pillColor}`}>
                      {item.badgeText}
                    </div>
                  )}

                  <div className="flex items-center gap-1 mt-1 shrink-0">
                    {/* View Item Button if product exists */}
                    {hasProduct && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (item.product_id) setActiveProductId(item.product_id);
                        }}
                        title={t('dash_activity_open_product')}
                        className="p-1 rounded-lg bg-orange-50 hover:bg-orange-100 dark:bg-orange-950/60 dark:hover:bg-orange-900 text-orange-600 dark:text-orange-400 text-[10px] font-bold flex items-center gap-0.5 cursor-pointer transition shrink-0 relative z-20"
                      >
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </button>
                    )}

                    {/* Detailed Traceability Drawer/Modal */}
                    <button
                      type="button"
                      onClick={() => setSelectedActivity(item)}
                      title={t('dash_activity_details_modal_title')}
                      className="p-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-medium flex items-center gap-0.5 cursor-pointer transition shrink-0 relative z-20"
                    >
                      <Info className="w-3 h-3 shrink-0" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Controls: Load More & See All Movements */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 relative overflow-hidden">
        <div className="text-xs text-slate-400 min-w-0 relative z-10">
          <span className="truncate block">
            {displayedList.length} / {filteredActivities.length} {tr(language, 'activités affichées', 'activities displayed')}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0 relative z-20">
          {filteredActivities.length > visibleCount && (
            <button
              type="button"
              onClick={() => setVisibleCount((prev) => prev + 6)}
              className="text-xs font-bold text-slate-700 dark:text-slate-300 hover:text-orange-600 dark:hover:text-orange-400 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-xl transition cursor-pointer shrink-0 relative z-20"
            >
              {t('dash_activity_load_more')} ({filteredActivities.length - visibleCount})
            </button>
          )}

          {visibleCount > 6 && (
            <button
              type="button"
              onClick={() => setVisibleCount(6)}
              className="text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 px-2 py-1 rounded-xl transition cursor-pointer shrink-0 relative z-20"
            >
              {t('dash_activity_show_less')}
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveTab('movements')}
            className="text-xs font-bold text-orange-600 hover:text-orange-700 flex items-center gap-0.5 cursor-pointer px-2 py-1 shrink-0 relative z-20"
          >
            <span className="relative z-10">{t('dash_see_all')}</span>
            <ChevronRight className="w-3.5 h-3.5 shrink-0 relative z-20" />
          </button>
        </div>
      </div>

      {/* Forensic Traceability Modal for Detailed Audit */}
      {selectedActivity && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn"
          onClick={() => setSelectedActivity(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-orange-500" />
                <h3 className="text-sm font-black text-slate-900 dark:text-white">
                  {t('dash_activity_details_modal_title')}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedActivity(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {tr(language, 'Intitulé de l\'événement', 'Event Title')}
                </div>
                <div className="font-extrabold text-sm text-slate-900 dark:text-white">
                  {selectedActivity.title}
                </div>
                <div className="text-slate-600 dark:text-slate-300">
                  {selectedActivity.description}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] font-semibold text-slate-400">
                    {tr(language, 'Catégorie', 'Category')}
                  </div>
                  <div className="font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                    {selectedActivity.category}
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] font-semibold text-slate-400">
                    {tr(language, 'Type d\'opération', 'Operation Type')}
                  </div>
                  <div className="font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                    {selectedActivity.type}
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] font-semibold text-slate-400">
                    {tr(language, 'Opérateur', 'Operator')}
                  </div>
                  <div className="font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                    {selectedActivity.user_name || 'Inconnu'}{' '}
                    {selectedActivity.user_trigram ? `(${selectedActivity.user_trigram})` : ''}
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] font-semibold text-slate-400">
                    {tr(language, 'Horodatage certifié', 'Timestamp')}
                  </div>
                  <div className="font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                    {formatDate(selectedActivity.timestamp)}
                  </div>
                </div>
              </div>

              {/* Extra Location & Project Context */}
              {(selectedActivity.site_number || selectedActivity.depot_name) && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 space-y-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {tr(language, 'Affectation & Localisation', 'Assignment & Location')}
                  </div>
                  {selectedActivity.site_number && (
                    <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                      <MapPin className="w-3.5 h-3.5 text-amber-500" />
                      <span>{tr(language, 'Chantier / Projet :', 'Project :')} <strong>{selectedActivity.site_number}</strong></span>
                    </div>
                  )}
                  {selectedActivity.depot_name && (
                    <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                      <Building2 className="w-3.5 h-3.5 text-blue-500" />
                      <span>{tr(language, 'Magasin / Dépôt :', 'Depot :')} <strong>{selectedActivity.depot_name}</strong></span>
                    </div>
                  )}
                </div>
              )}

              {/* Meta information: scans, differences, costs */}
              {selectedActivity.meta && Object.keys(selectedActivity.meta).length > 0 && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 space-y-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {tr(language, 'Métadonnées Techniques', 'Technical Metadata')}
                  </div>
                  {selectedActivity.meta.scannedCode && (
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">{tr(language, 'Code Scanné :', 'Scanned Code :')}</span>
                      <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{selectedActivity.meta.scannedCode}</span>
                    </div>
                  )}
                  {selectedActivity.meta.scanFormat && (
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">{tr(language, 'Format Code :', 'Code Format :')}</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">{selectedActivity.meta.scanFormat}</span>
                    </div>
                  )}
                  {selectedActivity.meta.deviceInfo && (
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">{tr(language, 'Capteur / Appareil :', 'Device :')}</span>
                      <span className="text-slate-700 dark:text-slate-300">{selectedActivity.meta.deviceInfo}</span>
                    </div>
                  )}
                  {canViewPrices && selectedActivity.meta.totalCost !== undefined && (
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">{tr(language, 'Impact Financier HT :', 'Financial Impact :')}</span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(selectedActivity.meta.totalCost)}</span>
                    </div>
                  )}
                  {selectedActivity.meta.difference !== undefined && (
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">{tr(language, 'Écarts Régularisés :', 'Adjusted Gaps :')}</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">{selectedActivity.meta.difference} article(s)</span>
                    </div>
                  )}
                </div>
              )}

              {/* Unique Event ID for Audit */}
              <div className="text-[10px] text-slate-400 font-mono text-center pt-1">
                ID Trace: {selectedActivity.id}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              {selectedActivity.product_id && (
                <button
                  type="button"
                  onClick={() => {
                    const id = selectedActivity.product_id;
                    setSelectedActivity(null);
                    if (id) setActiveProductId(id);
                  }}
                  className="px-3 py-1.5 rounded-xl font-bold text-xs bg-orange-600 hover:bg-orange-700 text-white flex items-center gap-1 cursor-pointer transition shadow-sm"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>{t('dash_activity_open_product')}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedActivity(null)}
                className="px-3 py-1.5 rounded-xl font-semibold text-xs bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition cursor-pointer"
              >
                {t('common_close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
