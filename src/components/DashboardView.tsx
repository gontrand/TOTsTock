import React, { useState, useMemo, useEffect } from 'react';
import { tr } from '../i18n/dutchTranslator';
import { useApp } from '../context/AppContext';
import { formatCurrency, formatDate } from '../utils/crypto';
import { RecentActivityFeed } from './RecentActivityFeed';
import {
  fetchDashboardKpisFromSupabase,
  DashboardKpisResult,
  getClientSupabase,
} from '../services/clientSupabase';
import {
  Package,
  Layers,
  AlertTriangle,
  AlertOctagon,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  TrendingDown,
  ArrowDownCircle,
  ArrowUpCircle,
  Flame,
  Snowflake,
  ChevronRight,
  BarChart3,
  Calendar,
  Building,
  MapPin,
  Filter,
  User as UserIcon,
  Users,
  Globe,
  FolderOpen,
  Building2,
  PieChart,
  Timer,
  Hourglass,
  CheckCircle2,
  ShieldCheck,
  Zap,
} from 'lucide-react';

import {
  useDashboardMetrics,
  describeDonutSlice,
  KpiScope,
} from '../hooks/useDashboardMetrics';

export type { KpiScope };

export const DashboardView: React.FC = () => {
  const {
    currentUser,
    products,
    departments,
    setActiveTab,
    setActiveProductId,
    setDepartmentsProjectsModal,
    language,
    t,
  } = useApp();

  const {
    userDept,
    role,
    isLogistiqueOrDirection,
    isDepartmentManager,
    isStandardUser,
    canFilterDepots,
    kpiScope,
    setKpiScope,
    selectedOtherDept,
    setSelectedOtherDept,
    selectedDepot,
    setSelectedDepot,
    kpiPeriod,
    setKpiPeriod,
    outPeriod,
    setOutPeriod,
    inPeriod,
    setInPeriod,
    chartPeriod,
    setChartPeriod,
    rotationPeriod,
    setRotationPeriod,
    deptChartMetric,
    setDeptChartMetric,
    deptActivityData,
    hasFinancePerm,
    hasKpiPerm,
    depotOptions,
    scopedMovements,
    scopedProducts,
    slaStats,
    totalValue,
    totalUnits,
    lowStockCount,
    outStockCount,
    serverPowered,
    trendPercentage,
    sparklineData,
    targetStartDate,
    outStats,
    inStats,
    topRotation,
    flopRotation,
    chartMetrics,
    maxSparklineVal,
  } = useDashboardMetrics();

  const [hoveredDeptIndex, setHoveredDeptIndex] = useState<number | null>(null);
  const [sparklineHover, setSparklineHover] = useState<string | null>(null);

  return (
    <div className="space-y-4 pb-24 animate-fadeIn">
      {/* Greeting Header */}
      <div className="flex items-center justify-between gap-2 relative overflow-hidden">
        <div className="min-w-0 flex-1 relative z-10 overflow-hidden">
          <h1 className="text-xl font-black tracking-tight text-slate-900 dark:text-white truncate">
            {tr(language, 'Bonjour', 'Hello')} {currentUser?.name?.split(' ')[0] || (tr(language, 'Utilisateur', 'User'))} 👋
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
            {role ? role.name : (tr(language, 'Opérateur', 'Operator'))} • {userDept || (tr(language, 'Dépôt Général', 'Main Depot'))}
          </p>
        </div>
        <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-950/60 border border-orange-200 dark:border-orange-800 text-orange-600 dark:text-orange-400 font-extrabold text-xs flex items-center justify-center shadow-sm shrink-0 relative z-20">
          {currentUser?.trigram || 'USR'}
        </div>
      </div>

      {/* KPI Scope Navigation Segment */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3 shadow-2xs space-y-2.5 overflow-hidden">
        <div className="flex items-center justify-between gap-2 relative overflow-hidden">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 min-w-0 flex-1 relative z-10 overflow-hidden">
            <Filter className="w-3.5 h-3.5 text-orange-500 shrink-0 relative z-20" />
            <span className="truncate relative z-10">{tr(language, "Périmètre d'Analyse des KPI", 'KPI Analysis Scope')}</span>
          </span>
          <div className="flex items-center gap-1.5 shrink-0 relative z-20">
            {serverPowered ? (
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 flex items-center gap-1 max-w-[140px] sm:max-w-none overflow-hidden">
                <Zap className="w-3 h-3 text-emerald-600 shrink-0 relative z-20" />
                <span className="truncate relative z-10">{tr(language, 'Fonction Serveur RPC (can_view_movement)', 'Server RPC (can_view_movement)')}</span>
              </span>
            ) : (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 flex items-center gap-1 max-w-[130px] sm:max-w-none overflow-hidden">
                <ShieldCheck className="w-3 h-3 text-slate-500 shrink-0 relative z-20" />
                <span className="truncate relative z-10">{tr(language, 'Périmètre can_view_movement', 'can_view_movement Scope')}</span>
              </span>
            )}
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 max-w-[120px] sm:max-w-none truncate relative z-10">
              {isLogistiqueOrDirection
                ? (tr(language, 'Accès Logistique & Direction', 'Logistics & Management Access'))
                : isDepartmentManager
                ? (tr(language, `Responsable : ${userDept || 'Département'}`, `Manager: ${userDept || 'Department'}`))
                : (tr(language, 'Collaborateur (Vue Individuelle)', 'Staff (Individual View)'))}
            </span>
            <button
              type="button"
              onClick={() => setDepartmentsProjectsModal({ open: true, tab: 'deps' })}
              title={tr(language, 'Ouvrir la gestion des départements', 'Open departments management')}
              className="p-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/60 transition cursor-pointer shrink-0 relative z-20"
            >
              <Building2 className="w-3 h-3 shrink-0" />
            </button>
          </div>
        </div>

        {/* Options pour Logistique & Direction : Toute la Société, Mon Dép., Autre Dép., Individuel */}
        {isLogistiqueOrDirection && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            <button
              type="button"
              onClick={() => setKpiScope('COMPANY')}
              className={`py-2 px-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition cursor-pointer min-w-0 relative overflow-hidden ${
                kpiScope === 'COMPANY'
                  ? 'bg-orange-500 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Globe className="w-3.5 h-3.5 shrink-0 relative z-20" />
              <span className="truncate relative z-10">{tr(language, 'Toute la Société', 'All Company')}</span>
            </button>

            <button
              type="button"
              onClick={() => setKpiScope('MY_DEPARTMENT')}
              className={`py-2 px-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition cursor-pointer min-w-0 relative overflow-hidden ${
                kpiScope === 'MY_DEPARTMENT'
                  ? 'bg-orange-500 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Building className="w-3.5 h-3.5 shrink-0 relative z-20" />
              <span className="truncate relative z-10">{userDept || (tr(language, 'Mon Dép.', 'My Dept'))}</span>
            </button>

            <button
              type="button"
              onClick={() => setKpiScope('OTHER_DEPARTMENT')}
              className={`py-2 px-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition cursor-pointer min-w-0 relative overflow-hidden ${
                kpiScope === 'OTHER_DEPARTMENT'
                  ? 'bg-orange-500 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5 shrink-0 relative z-20" />
              <span className="truncate relative z-10">{tr(language, 'Autre Dép.', 'Other Dept')}</span>
            </button>

            <button
              type="button"
              onClick={() => setKpiScope('INDIVIDUAL')}
              className={`py-2 px-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition cursor-pointer min-w-0 relative overflow-hidden ${
                kpiScope === 'INDIVIDUAL'
                  ? 'bg-orange-500 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <UserIcon className="w-3.5 h-3.5 shrink-0 relative z-20" />
              <span className="truncate relative z-10">{tr(language, 'Mes KPI', 'My KPIs')}</span>
            </button>
          </div>
        )}

        {/* Options pour Responsable de Département : Mon Département vs Mes KPI Individuels */}
        {isDepartmentManager && (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setKpiScope('MY_DEPARTMENT')}
              className={`py-2 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition cursor-pointer min-w-0 relative overflow-hidden ${
                kpiScope === 'MY_DEPARTMENT'
                  ? 'bg-orange-500 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Building className="w-3.5 h-3.5 shrink-0 relative z-20" />
              <span className="truncate relative z-10">{tr(language, `Département (${userDept || 'Équipe'})`, `Department (${userDept})`)}</span>
            </button>

            <button
              type="button"
              onClick={() => setKpiScope('INDIVIDUAL')}
              className={`py-2 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition cursor-pointer min-w-0 relative overflow-hidden ${
                kpiScope === 'INDIVIDUAL'
                  ? 'bg-orange-500 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <UserIcon className="w-3.5 h-3.5 shrink-0 relative z-20" />
              <span className="truncate relative z-10">{tr(language, 'Mes KPI Individuels', 'My Individual KPIs')}</span>
            </button>
          </div>
        )}

        {/* Bandeau d'information pour Utilisateurs Standards : KPIs individuels */}
        {isStandardUser && (
          <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 text-xs relative overflow-hidden">
            <div className="flex items-center gap-2 min-w-0 flex-1 relative z-10 overflow-hidden">
              <div className="w-7 h-7 rounded-lg bg-orange-100 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400 flex items-center justify-center font-bold shrink-0 relative z-20">
                <UserIcon className="w-4 h-4 shrink-0" />
              </div>
              <div className="min-w-0 flex-1 relative z-10 overflow-hidden">
                <span className="font-extrabold text-slate-900 dark:text-white block truncate">
                  {tr(language, 'Mode KPI Individuel', 'Individual KPI Mode')}
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block truncate">
                  {tr(language, 'Affichage de vos entrées, sorties et manipulations personnelles.', 'Displaying your personal entries, exits and stock operations.')}
                </span>
              </div>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400 font-extrabold shrink-0 relative z-20">
              {currentUser?.trigram || 'PERSO'}
            </span>
          </div>
        )}

        {/* Choix d'un autre département (disponible pour Logistique/Direction) */}
        {isLogistiqueOrDirection && kpiScope === 'OTHER_DEPARTMENT' && (
          <div className="pt-2 border-t border-dashed border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 relative overflow-hidden">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5 min-w-0 flex-1 relative z-10 overflow-hidden">
              <FolderOpen className="w-3.5 h-3.5 text-orange-500 shrink-0 relative z-20" />
              <span className="truncate relative z-10">{tr(language, 'Choisir le département :', 'Choose department:')}</span>
            </span>
            <div className="flex items-center gap-1.5 shrink-0 relative z-20">
              <select
                value={selectedOtherDept}
                onChange={(e) => setSelectedOtherDept(e.target.value)}
                className="text-xs font-bold py-1.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 outline-none cursor-pointer"
              >
                {departments.map((d) => (
                  <option key={d.id} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setDepartmentsProjectsModal({ open: true, tab: 'deps' })}
                title={tr(language, 'Gérer les départements', 'Manage departments')}
                className="p-1.5 rounded-xl bg-slate-200/80 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 transition cursor-pointer shrink-0 relative z-20"
              >
                <Building2 className="w-3.5 h-3.5 shrink-0" />
              </button>
            </div>
          </div>
        )}

        {/* Filtre des dépôts : Accessible aux départements habilités (Logistique, Direction, option cochée) ou rôles autorisés */}
        {canFilterDepots && (
          <div className="pt-2.5 border-t border-dashed border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 relative overflow-hidden">
            <div className="flex items-center gap-2 min-w-0 flex-1 relative z-10 overflow-hidden">
              <Building className="w-4 h-4 text-orange-500 shrink-0 relative z-20" />
              <div className="min-w-0 flex-1 relative z-10 overflow-hidden">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block truncate">
                  {tr(language, 'Filtre des Dépôts (Option Active)', 'Depot Filter (Active Option)')}
                </span>
                <span className="text-xs font-black text-slate-800 dark:text-slate-200 block truncate">
                  {selectedDepot === 'ALL'
                    ? (tr(language, '🏢 Tous les dépôts réunis', '🏢 All depots combined'))
                    : `📍 ${selectedDepot}`}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0 relative z-20">
              <select
                value={selectedDepot}
                onChange={(e) => setSelectedDepot(e.target.value)}
                className="w-full sm:w-auto text-xs font-bold py-1.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 outline-none cursor-pointer"
              >
                <option value="ALL">
                  {tr(language, '🏢 Tous les dépôts', '🏢 All Depots')} ({products.length} réf.)
                </option>
                {depotOptions.map((dep) => (
                  <option key={dep.name} value={dep.name}>
                    📍 {dep.name} ({dep.count} réf.)
                  </option>
                ))}
              </select>
              {selectedDepot !== 'ALL' && (
                <button
                  type="button"
                  onClick={() => setSelectedDepot('ALL')}
                  className="text-[11px] font-extrabold px-2 py-1 rounded-lg bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-400 hover:bg-orange-200 transition shrink-0 cursor-pointer relative z-20"
                >
                  {tr(language, 'Tous', 'All')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Financial Total Value & Sparkline */}
      {hasFinancePerm && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm overflow-hidden">
          <div className="flex items-start justify-between gap-2 mb-3 relative overflow-hidden">
            <div className="min-w-0 flex-1 relative z-10 overflow-hidden">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block truncate">
                {isStandardUser || kpiScope === 'INDIVIDUAL'
                  ? (tr(language, 'Vos Sorties Matériel (Valeur HT)', 'Your Material Exits (Value HT)'))
                  : kpiScope === 'MY_DEPARTMENT'
                  ? (tr(language, `Consommation Département ${userDept} (HT)`, `Department ${userDept} Consumption (HT)`))
                  : kpiScope === 'OTHER_DEPARTMENT'
                  ? (tr(language, `Consommation Département ${selectedOtherDept} (HT)`, `Department ${selectedOtherDept} Consumption (HT)`))
                  : t('dash_stock_value')}
              </span>
              <div className="text-2xl font-black text-orange-600 dark:text-orange-500 mt-0.5 truncate">
                {formatCurrency(totalValue)}
              </div>
            </div>

            <div className="flex flex-col items-end gap-1.5 shrink-0 relative z-20">
              <select
                value={kpiPeriod}
                onChange={(e) => setKpiPeriod(e.target.value as typeof kpiPeriod)}
                className="text-[11px] font-semibold py-1 px-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 outline-none"
              >
                <option value="1d">{t('dash_vs_1_day')}</option>
                <option value="1w">{t('dash_vs_1_week')}</option>
                <option value="3m">{t('dash_vs_3_months')}</option>
                <option value="6m">{t('dash_vs_6_months')}</option>
                <option value="1y">{t('dash_vs_1_year')}</option>
                <option value="2y">{t('dash_vs_2_years')}</option>
              </select>

              <div
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold shrink-0 relative z-20 ${
                  trendPercentage > 0
                    ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                    : trendPercentage < 0
                    ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-700'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700'
                }`}
              >
                {trendPercentage > 0 ? (
                  <TrendingUp className="w-3 h-3 shrink-0 relative z-20" />
                ) : trendPercentage < 0 ? (
                  <TrendingDown className="w-3 h-3 shrink-0 relative z-20" />
                ) : null}
                <span className="relative z-10">
                  {trendPercentage > 0 ? '+' : ''}
                  {trendPercentage.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          {/* Sparkline & Range info */}
          <div className="pt-2 border-t border-dashed border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 mb-1.5 relative overflow-hidden">
              <span className="truncate min-w-0 flex-1 relative z-10">{t('dash_financial_evolution')}</span>
              <span className="text-orange-500 font-medium shrink-0 relative z-20">
                {sparklineHover || `${targetStartDate.toLocaleDateString(tr(language, 'fr-FR', 'en-US', 'nl-NL'))} ➔ ${tr(language, "Aujourd'hui", 'Today')}`}
              </span>
            </div>

            <div className="flex items-end justify-between h-14 gap-1.5 pt-2">
              {sparklineData.map((pt, idx) => {
                const ratio = maxSparklineVal > 0 ? pt.value / maxSparklineVal : 0.2;
                const hPx = Math.max(6, Math.round(ratio * 46));
                return (
                  <div
                    key={idx}
                    onMouseEnter={() =>
                      setSparklineHover(`${pt.date.toLocaleDateString(tr(language, 'fr-FR', 'en-US', 'nl-NL'))} : ${formatCurrency(pt.value)}`)
                    }
                    onMouseLeave={() => setSparklineHover(null)}
                    onClick={() =>
                      setSparklineHover(`${pt.date.toLocaleDateString(tr(language, 'fr-FR', 'en-US', 'nl-NL'))} : ${formatCurrency(pt.value)}`)
                    }
                    className="flex-1 rounded-t bg-gradient-to-t from-orange-600 to-amber-400 hover:brightness-110 active:scale-y-105 transition-all cursor-pointer relative group"
                    style={{ height: `${hPx}px` }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* KPI 4-Box Grid */}
      {hasKpiPerm && (
        <div className="grid grid-cols-4 gap-2">
          <button
            onClick={() => setActiveTab('search')}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 rounded-xl text-center hover:border-orange-500 transition active:scale-95 shadow-sm cursor-pointer min-w-0 overflow-hidden relative"
          >
            <div className="w-7 h-7 mx-auto rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 mb-1 shrink-0 relative z-20">
              <Package className="w-3.5 h-3.5 shrink-0" />
            </div>
            <div className="text-base font-black text-slate-900 dark:text-white relative z-10 truncate">
              {scopedProducts.length}
            </div>
            <div className="text-[10px] text-slate-500 font-semibold relative z-10 truncate">
              {isStandardUser || kpiScope === 'INDIVIDUAL'
                ? (tr(language, 'Réf. manipulées', 'Items handled'))
                : t('common_references')}
            </div>
          </button>

          <button
            onClick={() => setActiveTab('search')}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 rounded-xl text-center hover:border-orange-500 transition active:scale-95 shadow-sm cursor-pointer min-w-0 overflow-hidden relative"
          >
            <div className="w-7 h-7 mx-auto rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 mb-1 shrink-0 relative z-20">
              <Layers className="w-3.5 h-3.5 shrink-0" />
            </div>
            <div className="text-base font-black text-slate-900 dark:text-white relative z-10 truncate">
              {totalUnits}
            </div>
            <div className="text-[10px] text-slate-500 font-semibold relative z-10 truncate">
              {isStandardUser || kpiScope === 'INDIVIDUAL'
                ? (tr(language, 'Unités manipulées', 'Units handled'))
                : kpiScope === 'MY_DEPARTMENT' || kpiScope === 'OTHER_DEPARTMENT'
                ? (tr(language, 'Unités mouvementées', 'Units moved'))
                : t('dash_physical_units')}
            </div>
          </button>

          <button
            onClick={() => setActiveTab('search')}
            className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/40 p-2.5 rounded-xl text-center hover:border-amber-500 transition active:scale-95 shadow-sm cursor-pointer min-w-0 overflow-hidden relative"
          >
            <div className="w-7 h-7 mx-auto rounded-lg bg-amber-50 dark:bg-amber-950/60 flex items-center justify-center text-amber-500 mb-1 shrink-0 relative z-20">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            </div>
            <div className="text-base font-black text-amber-500 relative z-10 truncate">{lowStockCount}</div>
            <div className="text-[10px] text-slate-500 font-semibold relative z-10 truncate">
              {isStandardUser || kpiScope === 'INDIVIDUAL'
                ? (tr(language, 'Vos Sorties', 'Your Exits'))
                : kpiScope === 'MY_DEPARTMENT' || kpiScope === 'OTHER_DEPARTMENT'
                ? (tr(language, 'Sorties Équipe', 'Team Exits'))
                : t('search_low_stock')}
            </div>
          </button>

          <button
            onClick={() => setActiveTab('search')}
            className="bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/40 p-2.5 rounded-xl text-center hover:border-red-500 transition active:scale-95 shadow-sm cursor-pointer min-w-0 overflow-hidden relative"
          >
            <div className="w-7 h-7 mx-auto rounded-lg bg-red-50 dark:bg-red-950/60 flex items-center justify-center text-red-500 mb-1 shrink-0 relative z-20">
              <AlertOctagon className="w-3.5 h-3.5 shrink-0" />
            </div>
            <div className="text-base font-black text-red-500 relative z-10 truncate">{outStockCount}</div>
            <div className="text-[10px] text-slate-500 font-semibold relative z-10 truncate">
              {isStandardUser || kpiScope === 'INDIVIDUAL'
                ? (tr(language, 'Vos Entrées', 'Your Entries'))
                : kpiScope === 'MY_DEPARTMENT' || kpiScope === 'OTHER_DEPARTMENT'
                ? (tr(language, 'Entrées Équipe', 'Team Entries'))
                : t('search_out_stock')}
            </div>
          </button>
        </div>
      )}

      {/* Movement Widgets: Sorties & Entrées */}
      <div className="grid grid-cols-2 gap-2.5">
        {/* Sorties */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3 shadow-sm flex flex-col justify-between overflow-hidden">
          <div className="flex items-center justify-between gap-1 mb-2 relative overflow-hidden">
            <span className="text-xs font-bold text-red-600 dark:text-red-400 flex items-center gap-1 min-w-0 flex-1 relative z-10 overflow-hidden">
              <ArrowDownCircle className="w-3.5 h-3.5 shrink-0 relative z-20" />
              <span className="truncate relative z-10">{t('dash_recent_out')}</span>
            </span>
            <select
              value={outPeriod}
              onChange={(e) => setOutPeriod(e.target.value as typeof outPeriod)}
              className="text-[10px] font-semibold py-0.5 px-1.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-700 outline-none shrink-0 relative z-20"
            >
              <option value="1d">{t('dash_today')}</option>
              <option value="1w">{t('dash_7_days')}</option>
              <option value="1m">{t('dash_30_days')}</option>
              <option value="1y">{t('dash_year')}</option>
            </select>
          </div>
          <div className="text-center py-1">
            <div className="text-xl font-black text-red-600 dark:text-red-400">
              {outStats.count} <span className="text-xs font-bold">op.</span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {outStats.qty} {t('mov_units')}
              {hasFinancePerm && (
                <div className="text-[10px] font-bold text-red-500">{formatCurrency(outStats.val)}</div>
              )}
            </div>
          </div>
        </div>

        {/* Entrées */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3 shadow-sm flex flex-col justify-between overflow-hidden">
          <div className="flex items-center justify-between gap-1 mb-2 relative overflow-hidden">
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 min-w-0 flex-1 relative z-10 overflow-hidden">
              <ArrowUpCircle className="w-3.5 h-3.5 shrink-0 relative z-20" />
              <span className="truncate relative z-10">{t('dash_recent_in')}</span>
            </span>
            <select
              value={inPeriod}
              onChange={(e) => setInPeriod(e.target.value as typeof inPeriod)}
              className="text-[10px] font-semibold py-0.5 px-1.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-700 outline-none shrink-0 relative z-20"
            >
              <option value="1d">{t('dash_today')}</option>
              <option value="1w">{t('dash_7_days')}</option>
              <option value="1m">{t('dash_30_days')}</option>
              <option value="1y">{t('dash_year')}</option>
            </select>
          </div>
          <div className="text-center py-1">
            <div className="text-xl font-black text-emerald-600 dark:text-emerald-400">
              {inStats.count} <span className="text-xs font-bold">op.</span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {inStats.qty} {t('mov_units')}
              {hasFinancePerm && (
                <div className="text-[10px] font-bold text-emerald-500">{formatCurrency(inStats.val)}</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stock Rotation: Top 3 & Flop 3 */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-2 mb-3 relative overflow-hidden">
          <h3 className="text-xs font-extrabold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 min-w-0 flex-1 relative z-10 overflow-hidden">
            <Flame className="w-4 h-4 text-orange-500 shrink-0 relative z-20" />
            <span className="truncate relative z-10">{t('dash_stock_rotation')}</span>
          </h3>
          <select
            value={rotationPeriod}
            onChange={(e) => setRotationPeriod(e.target.value as typeof rotationPeriod)}
            className="text-[10px] font-semibold py-0.5 px-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-700 outline-none shrink-0 relative z-20"
          >
            <option value="1w">{t('dash_7_days')}</option>
            <option value="1m">{t('dash_30_days')}</option>
            <option value="1y">{t('dash_this_year')}</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          {/* Top 3 */}
          <div className="p-2.5 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 overflow-hidden">
            <div className="font-bold text-[11px] text-emerald-700 dark:text-emerald-400 mb-2 flex items-center gap-1 min-w-0 relative overflow-hidden">
              <Flame className="w-3 h-3 text-emerald-500 shrink-0 relative z-20" />
              <span className="truncate relative z-10">{t('dash_top_out')}</span>
            </div>
            <div className="space-y-1.5">
              {topRotation.length === 0 || topRotation.every((t) => t.volume === 0) ? (
                <span className="text-[11px] text-slate-400">{t('dash_empty_rotation')}</span>
              ) : (
                topRotation.map((item, idx) => (
                  <div
                    key={idx}
                    onClick={() => setActiveProductId(item.product.id)}
                    className="flex items-center justify-between gap-1 cursor-pointer hover:underline text-[11px] relative overflow-hidden"
                  >
                    <span className="truncate min-w-0 flex-1 font-medium text-slate-700 dark:text-slate-300 relative z-10">
                      {item.product.brand} {item.product.model}
                    </span>
                    <span className="font-bold text-emerald-600 shrink-0 relative z-20">
                      {item.volume} un.
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Flop 3 */}
          <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="font-bold text-[11px] text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1 min-w-0 relative overflow-hidden">
              <Snowflake className="w-3 h-3 text-blue-400 shrink-0 relative z-20" />
              <span className="truncate relative z-10">{t('dash_dormant_tools')}</span>
            </div>
            <div className="space-y-1.5">
              {flopRotation.map((item, idx) => (
                <div
                  key={idx}
                  onClick={() => setActiveProductId(item.product.id)}
                  className="flex items-center justify-between gap-1 cursor-pointer hover:underline text-[11px] relative overflow-hidden"
                >
                  <span className="truncate min-w-0 flex-1 font-medium text-slate-600 dark:text-slate-400 relative z-10">
                    {item.product.brand} {item.product.model}
                  </span>
                  <span className="font-bold text-slate-400 shrink-0 relative z-20">
                    {item.volume} un.
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Comparison Chart: Entrées vs Sorties */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-2 mb-3 relative overflow-hidden">
          <h3 className="text-xs font-extrabold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 min-w-0 flex-1 relative z-10 overflow-hidden">
            <BarChart3 className="w-4 h-4 text-orange-500 shrink-0 relative z-20" />
            <span className="truncate relative z-10">{t('dash_in_out_comparison')}</span>
          </h3>
          <select
            value={chartPeriod}
            onChange={(e) => setChartPeriod(e.target.value as typeof chartPeriod)}
            className="text-[10px] font-semibold py-0.5 px-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-700 outline-none shrink-0 relative z-20"
          >
            <option value="1d">{t('dash_today')}</option>
            <option value="1w">{t('dash_7_days')}</option>
            <option value="1m">{t('dash_30_days')}</option>
            <option value="1y">{t('dash_year')}</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4 pt-2 border-b border-dashed border-slate-200 dark:border-slate-800 pb-3">
          {/* Volume bars */}
          <div className="flex flex-col items-center">
            <div className="flex items-end gap-2 h-24">
              <div className="flex flex-col items-center">
                <div
                  style={{
                    height: `${Math.max(
                      14,
                      Math.round(
                        (chartMetrics.inQty / Math.max(chartMetrics.inQty, chartMetrics.outQty, 1)) * 75
                      )
                    )}px`,
                  }}
                  className="w-8 rounded-t-lg bg-emerald-500 text-white text-[10px] font-extrabold flex items-start justify-center pt-1 shadow-sm"
                >
                  {chartMetrics.inQty}
                </div>
              </div>

              <div className="flex flex-col items-center">
                <div
                  style={{
                    height: `${Math.max(
                      14,
                      Math.round(
                        (chartMetrics.outQty / Math.max(chartMetrics.inQty, chartMetrics.outQty, 1)) * 75
                      )
                    )}px`,
                  }}
                  className="w-8 rounded-t-lg bg-rose-500 text-white text-[10px] font-extrabold flex items-start justify-center pt-1 shadow-sm"
                >
                  {chartMetrics.outQty}
                </div>
              </div>
            </div>
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mt-1">
              {t('dash_volume_units')}
            </span>
          </div>

          {/* Operations Count bars */}
          <div className="flex flex-col items-center">
            <div className="flex items-end gap-2 h-24">
              <div className="flex flex-col items-center">
                <div
                  style={{
                    height: `${Math.max(
                      14,
                      Math.round(
                        (chartMetrics.inCount / Math.max(chartMetrics.inCount, chartMetrics.outCount, 1)) * 75
                      )
                    )}px`,
                  }}
                  className="w-8 rounded-t-lg bg-emerald-500 text-white text-[10px] font-extrabold flex items-start justify-center pt-1 shadow-sm"
                >
                  {chartMetrics.inCount}
                </div>
              </div>

              <div className="flex flex-col items-center">
                <div
                  style={{
                    height: `${Math.max(
                      14,
                      Math.round(
                        (chartMetrics.outCount / Math.max(chartMetrics.inCount, chartMetrics.outCount, 1)) * 75
                      )
                    )}px`,
                  }}
                  className="w-8 rounded-t-lg bg-rose-500 text-white text-[10px] font-extrabold flex items-start justify-center pt-1 shadow-sm"
                >
                  {chartMetrics.outCount}
                </div>
              </div>
            </div>
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mt-1">
              {t('dash_operations_count')}
            </span>
          </div>
        </div>

        <div className="flex justify-center gap-6 mt-2 text-[11px] font-bold">
          <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
            <span className="w-2.5 h-2.5 rounded bg-emerald-500 shrink-0" />
            {t('mov_type_in')}
          </span>
          <span className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
            <span className="w-2.5 h-2.5 rounded bg-rose-500 shrink-0" />
            {t('mov_type_out')}
          </span>
        </div>
      </div>

      {/* KPI Départements les plus actifs (Graphique en Fromage) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 shadow-sm space-y-3 overflow-hidden">
        <div className="flex items-center justify-between gap-2 relative overflow-hidden">
          <h3 className="text-xs font-extrabold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 min-w-0 flex-1 relative z-10 overflow-hidden">
            <PieChart className="w-4 h-4 text-orange-500 shrink-0 relative z-20" />
            <span className="truncate relative z-10">{tr(language, 'Départements les plus actifs', 'Most Active Departments')}</span>
          </h3>

          {/* Metric Selector: Commandes Magasin vs Consommation Matériel */}
          <div className="flex bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg text-[10px] font-bold shrink-0 relative z-20">
            <button
              type="button"
              onClick={() => {
                setDeptChartMetric('ORDERS');
                setHoveredDeptIndex(null);
              }}
              className={`px-2 py-0.5 rounded-md transition cursor-pointer ${
                deptChartMetric === 'ORDERS'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
              }`}
            >
              {tr(language, 'Commandes', 'Orders')}
            </button>
            <button
              type="button"
              onClick={() => {
                setDeptChartMetric('MOVEMENTS');
                setHoveredDeptIndex(null);
              }}
              className={`px-2 py-0.5 rounded-md transition cursor-pointer ${
                deptChartMetric === 'MOVEMENTS'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
              }`}
            >
              {tr(language, 'Sorties', 'Exits')}
            </button>
          </div>
        </div>

        {deptActivityData.total === 0 ? (
          <div className="py-6 text-center text-slate-400 space-y-1">
            <PieChart className="w-8 h-8 mx-auto opacity-40 text-slate-400" />
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
              {tr(language, 'Aucune activité enregistrée', 'No activity recorded yet')}
            </p>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row items-center gap-4">
            {/* SVG Pie / Donut Chart */}
            <div className="relative w-44 h-44 shrink-0 mx-auto">
              <svg viewBox="0 0 200 200" className="w-full h-full transform -rotate-90">
                {(() => {
                  let currentAngle = 0;
                  return deptActivityData.items.map((item, index) => {
                    const sliceAngle = (item.value / deptActivityData.total) * 360;
                    const startAngle = currentAngle;
                    const endAngle = currentAngle + sliceAngle;
                    currentAngle = endAngle;

                    const isHovered = hoveredDeptIndex === index;
                    const outerRadius = isHovered ? 86 : 80;
                    const innerRadius = isHovered ? 40 : 44;
                    const pathData = describeDonutSlice(100, 100, outerRadius, innerRadius, startAngle, endAngle);

                    return (
                      <path
                        key={item.name}
                        d={pathData}
                        fill={item.color}
                        stroke="#ffffff"
                        strokeWidth="1.5"
                        onMouseEnter={() => setHoveredDeptIndex(index)}
                        onMouseLeave={() => setHoveredDeptIndex(null)}
                        onClick={() => setHoveredDeptIndex(hoveredDeptIndex === index ? null : index)}
                        className="transition-all duration-200 cursor-pointer hover:opacity-90"
                      />
                    );
                  });
                })()}
              </svg>

              {/* Center Details Display */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center p-2">
                {hoveredDeptIndex !== null && deptActivityData.items[hoveredDeptIndex] ? (
                  <>
                    <span className="text-[10px] font-extrabold text-slate-400 truncate max-w-[90px]">
                      {deptActivityData.items[hoveredDeptIndex].name}
                    </span>
                    <span className="text-sm font-black text-slate-900 dark:text-white leading-none my-0.5">
                      {deptActivityData.items[hoveredDeptIndex].percent.toFixed(1)}%
                    </span>
                    <span className="text-[9px] font-bold text-slate-500">
                      {deptActivityData.items[hoveredDeptIndex].value}{' '}
                      {deptChartMetric === 'ORDERS' ? 'cmd' : 'un.'}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-[10px] font-bold text-slate-400">Total</span>
                    <span className="text-sm font-black text-slate-900 dark:text-white leading-none my-0.5">
                      {deptActivityData.total}
                    </span>
                    <span className="text-[9px] font-bold text-slate-500">
                      {deptChartMetric === 'ORDERS' ? 'commandes' : 'unités'}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Department Breakdown Legend */}
            <div className="flex-1 w-full space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {deptActivityData.items.map((item, index) => {
                const isHovered = hoveredDeptIndex === index;
                return (
                  <div
                    key={item.name}
                    onMouseEnter={() => setHoveredDeptIndex(index)}
                    onMouseLeave={() => setHoveredDeptIndex(null)}
                    onClick={() => setHoveredDeptIndex(hoveredDeptIndex === index ? null : index)}
                    className={`flex items-center justify-between gap-2 p-1.5 rounded-xl transition cursor-pointer text-xs relative overflow-hidden ${
                      isHovered
                        ? 'bg-slate-100 dark:bg-slate-800 scale-[1.01]'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1 relative z-10 overflow-hidden">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0 relative z-20"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="font-bold text-slate-800 dark:text-slate-200 truncate relative z-10">
                        {item.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 relative z-20">
                      <span className="text-[11px] font-mono text-slate-400">
                        {item.value} {deptChartMetric === 'ORDERS' ? 'cmd' : 'un.'}
                      </span>
                      <span className="font-black text-[11px] text-slate-700 dark:text-slate-300 w-12 text-right">
                        {item.percent.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* KPI SLA Magasin & Délais de Préparation (User Requested for Analysis & Audits) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 shadow-sm space-y-3 overflow-hidden">
        <div className="flex items-center justify-between gap-2 relative overflow-hidden">
          <h3 className="text-xs font-extrabold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 min-w-0 flex-1 relative z-10 overflow-hidden">
            <Timer className="w-4 h-4 text-purple-600 shrink-0 relative z-20" />
            <span className="truncate relative z-10">{tr(language, 'SLA Magasin & Délais de Préparation', 'Warehouse Prep SLA & Cycle Times')}</span>
          </h3>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 flex items-center gap-1 shrink-0 relative z-20">
            <ShieldCheck className="w-3 h-3 text-purple-600 shrink-0 relative z-20" />
            <span className="relative z-10">{tr(language, 'Audit Logistique', 'Audit & SLA')}</span>
          </span>
        </div>

        {/* 4 SLA KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {/* 1. Prise en charge */}
          <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 overflow-hidden">
            <div className="text-[10px] font-bold text-slate-500 flex items-center gap-1 min-w-0 relative overflow-hidden">
              <Hourglass className="w-3 h-3 text-blue-500 shrink-0 relative z-20" />
              <span className="truncate relative z-10">{tr(language, 'Prise en charge', 'Intake time')}</span>
            </div>
            <div className="text-base font-black text-slate-900 dark:text-white mt-1">
              {slaStats.avgIntake} <span className="text-xs font-bold text-slate-500">min</span>
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5 truncate">
              {tr(language, 'Réactivité magasin', 'Order claim')}
            </div>
          </div>

          {/* 2. Pointage */}
          <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 overflow-hidden">
            <div className="text-[10px] font-bold text-slate-500 flex items-center gap-1 min-w-0 relative overflow-hidden">
              <Package className="w-3 h-3 text-amber-500 shrink-0 relative z-20" />
              <span className="truncate relative z-10">{tr(language, 'Picking & Bac', 'Picking time')}</span>
            </div>
            <div className="text-base font-black text-slate-900 dark:text-white mt-1">
              {slaStats.avgPrep} <span className="text-xs font-bold text-slate-500">min</span>
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5 truncate">
              {tr(language, 'Préparation pure', 'Bin prep')}
            </div>
          </div>

          {/* 3. Cycle total mise à disposition */}
          <div className="p-2.5 rounded-xl bg-purple-50/60 dark:bg-purple-950/30 border border-purple-200/80 dark:border-purple-800/80 overflow-hidden">
            <div className="text-[10px] font-bold text-purple-700 dark:text-purple-300 flex items-center gap-1 min-w-0 relative overflow-hidden">
              <Timer className="w-3 h-3 text-purple-600 shrink-0 relative z-20" />
              <span className="truncate relative z-10">{tr(language, 'Mise à dispo.', 'Ready cycle')}</span>
            </div>
            <div className="text-base font-black text-purple-950 dark:text-purple-100 mt-1">
              {slaStats.avgCycle} <span className="text-xs font-bold text-purple-600">min</span>
            </div>
            <div className="text-[10px] text-purple-700/80 dark:text-purple-300/80 mt-0.5 truncate">
              {tr(language, 'Délai total demandeur', 'Total wait')}
            </div>
          </div>

          {/* 4. Taux de respect du SLA */}
          <div className="p-2.5 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/80 overflow-hidden">
            <div className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1 min-w-0 relative overflow-hidden">
              <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0 relative z-20" />
              <span className="truncate relative z-10">{tr(language, 'Taux SLA (< 1h)', 'SLA Rate (< 1h)')}</span>
            </div>
            <div className="text-base font-black text-emerald-950 dark:text-emerald-100 mt-1">
              {slaStats.slaSuccessRate}%
            </div>
            <div className="text-[10px] text-emerald-700/80 dark:text-emerald-300/80 mt-0.5 truncate">
              {tr(language, 'Commandes à l\'heure', 'On-time delivery')}
            </div>
          </div>
        </div>

        {/* Retrait & Audit log */}
        <div className="pt-1 flex items-center justify-between gap-2 text-[11px] text-slate-500 border-t border-slate-100 dark:border-slate-800 relative overflow-hidden">
          <span className="truncate min-w-0 flex-1 relative z-10">
            {tr(language, `Temps moyen de retrait au casier : ${slaStats.avgCollect} min après mise à disposition`, `Average pickup on shelf: ${slaStats.avgCollect} mins after readiness`)}
          </span>
          <span className="font-mono font-bold text-slate-600 dark:text-slate-400 shrink-0 relative z-20">
            {slaStats.auditedCount} {tr(language, 'commandes auditées', 'audited')}
          </span>
        </div>
      </div>

      {/* Recent Activity Feed (Movements, Scans & System Updates) */}
      <RecentActivityFeed
        customMovements={scopedMovements}
        scopeLabel={
          isStandardUser || kpiScope === 'INDIVIDUAL'
            ? (tr(language, 'Vos activités individuelles', 'Your individual activity'))
            : kpiScope === 'MY_DEPARTMENT'
            ? (tr(language, `Activités ${userDept}`, `${userDept} activities`))
            : kpiScope === 'OTHER_DEPARTMENT'
            ? (tr(language, `Activités ${selectedOtherDept}`, `${selectedOtherDept} activities`))
            : undefined
        }
      />
    </div>
  );
};
