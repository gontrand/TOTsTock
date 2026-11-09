import React, { useState } from 'react';
import { tr } from '../../i18n/dutchTranslator';
import { useApp } from '../../context/AppContext';
import { useDashboardMetrics, describeDonutSlice } from '../../hooks/useDashboardMetrics';
import { formatCurrency } from '../../utils/crypto';
import { RecentActivityFeed } from '../../components/RecentActivityFeed';
import { SearchableSelect } from '../../components/SearchableSelect';
import { ProductRefLink } from '../../components/ProductRefLink';
import { DesktopPageId } from '../types';
import {
  Package,
  Layers,
  AlertTriangle,
  AlertOctagon,
  TrendingUp,
  TrendingDown,
  ArrowDownCircle,
  ArrowUpCircle,
  Flame,
  Snowflake,
  BarChart3,
  PieChart,
  Timer,
  Globe,
  Building2,
  User as UserIcon,
  FolderOpen,
} from 'lucide-react';

interface DesktopDashboardPageProps {
  onNavigatePage: (page: DesktopPageId) => void;
  onOpenProductDetail: (productId: string) => void;
}

export const DesktopDashboardPage: React.FC<DesktopDashboardPageProps> = ({
  onNavigatePage,
  onOpenProductDetail,
}) => {
  const { currentUser, departments, language } = useApp();
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
    slaStats,
    totalValue,
    totalUnits,
    lowStockCount,
    outStockCount,
    trendPercentage,
    sparklineData,
    outStats,
    inStats,
    topRotation,
    flopRotation,
    chartMetrics,
    maxSparklineVal,
    showAllVehiclesAndContainers,
    setShowAllVehiclesAndContainers,
    canToggleAllVehiclesAndContainers,
  } = useDashboardMetrics();

  const [hoveredDeptIndex, setHoveredDeptIndex] = useState<number | null>(null);

  return (
    <div className="max-w-[1680px] mx-auto p-6 space-y-6">
      {/* Header & Scope Filter Row */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {tr(language, 'Tableau de bord opérationnel', 'Operational Dashboard', 'Operationeel dashboard')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {currentUser?.name || tr(language, 'Opérateur', 'Operator', 'Operator')} ·{' '}
            {role?.name || tr(language, 'Opérateur', 'Operator', 'Operator')} ·{' '}
            {userDept || tr(language, 'Dépôt Général', 'Main Depot', 'Hoofddepot')}
          </p>
        </div>

        {/* Scope & Depot Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {isLogistiqueOrDirection && (
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setKpiScope('COMPANY')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 ${
                  kpiScope === 'COMPANY'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Globe className="w-3.5 h-3.5 text-orange-600" />
                <span>{tr(language, 'Toute la société', 'All company', 'Hele bedrijf')}</span>
              </button>
              <button
                type="button"
                onClick={() => setKpiScope('MY_DEPARTMENT')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 ${
                  kpiScope === 'MY_DEPARTMENT'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Building2 className="w-3.5 h-3.5 text-orange-600" />
                <span>{tr(language, 'Mon département', 'My department', 'Mijn afdeling')}</span>
              </button>
              <button
                type="button"
                onClick={() => setKpiScope('OTHER_DEPARTMENT')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 ${
                  kpiScope === 'OTHER_DEPARTMENT'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <FolderOpen className="w-3.5 h-3.5 text-orange-600" />
                <span>{tr(language, 'Autre département', 'Other department', 'Andere afdeling')}</span>
              </button>
              <button
                type="button"
                onClick={() => setKpiScope('INDIVIDUAL')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 ${
                  kpiScope === 'INDIVIDUAL'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <UserIcon className="w-3.5 h-3.5 text-orange-600" />
                <span>{tr(language, 'Individuel', 'Individual', 'Individueel')}</span>
              </button>
            </div>
          )}

          {!isLogistiqueOrDirection && isDepartmentManager && (
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setKpiScope('MY_DEPARTMENT')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  kpiScope === 'MY_DEPARTMENT'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {tr(language, 'Mon département', 'My department', 'Mijn afdeling')}
              </button>
              <button
                type="button"
                onClick={() => setKpiScope('INDIVIDUAL')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  kpiScope === 'INDIVIDUAL'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {tr(language, 'Individuel', 'Individual', 'Individueel')}
              </button>
            </div>
          )}

          {kpiScope === 'OTHER_DEPARTMENT' && isLogistiqueOrDirection && (
            <SearchableSelect
              value={selectedOtherDept}
              onChange={(val) => setSelectedOtherDept(val)}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
            >
              {departments.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </SearchableSelect>
          )}

          {canToggleAllVehiclesAndContainers && kpiScope === 'MY_DEPARTMENT' && (
            <button
              type="button"
              role="switch"
              aria-checked={showAllVehiclesAndContainers}
              data-testid="desktop-toggle-all-vehicles-containers"
              onClick={() => setShowAllVehiclesAndContainers((v) => !v)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                showAllVehiclesAndContainers
                  ? 'bg-orange-600 text-white border-orange-600'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
              }`}
            >
              {tr(
                language,
                'Tous les véhicules et conteneurs',
                'All vehicles and containers',
                'Alle voertuigen en containers'
              )}
            </button>
          )}

          {canFilterDepots && kpiScope === 'COMPANY' && (
            <SearchableSelect
              value={selectedDepot}
              onChange={(val) => setSelectedDepot(val)}
              recentKey="depots"
              aria-label={tr(language, 'Filtrer par dépôt', 'Filter by depot', 'Filter op depot')}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
            >
              <option value="ALL">
                {tr(language, 'Tous les dépôts', 'All depots', 'Alle depots')}
              </option>
              {depotOptions.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name} ({d.count})
                </option>
              ))}
            </SearchableSelect>
          )}
        </div>
      </div>

      {/* 12-Column Grid */}
      <div className="grid grid-cols-12 gap-6 items-start">
        {/* Main 8 columns: KPIs + Charts */}
        <div className="col-span-8 space-y-6">
          {/* KPI Row (4 cards) */}
          {hasKpiPerm && (
            <div className="grid grid-cols-4 gap-4">
              {/* Total Stock Value (or Units if no finance perm) */}
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>
                    {hasFinancePerm
                      ? isStandardUser || kpiScope !== 'COMPANY'
                        ? tr(language, 'Coût sorties', 'Outbound cost', 'Uitgiftekosten')
                        : tr(language, 'Valeur du stock', 'Stock value', 'Voorraadwaarde')
                      : tr(language, 'Unités totales', 'Total units', 'Totale eenheden')}
                  </span>
                  <Layers className="w-4 h-4 text-orange-600" />
                </div>
                <div className="text-2xl font-black font-mono tabular-nums text-slate-900 dark:text-white mt-2">
                  {hasFinancePerm ? formatCurrency(totalValue) : totalUnits.toLocaleString('fr-FR')}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] font-mono tabular-nums">
                  {trendPercentage >= 0 ? (
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <TrendingDown className="w-3.5 h-3.5 text-amber-600" />
                  )}
                  <span
                    className={
                      trendPercentage >= 0
                        ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                        : 'text-amber-600 dark:text-amber-400 font-semibold'
                    }
                  >
                    {trendPercentage >= 0 ? '+' : ''}
                    {trendPercentage.toFixed(1)}%
                  </span>
                  <span className="text-slate-400">({kpiPeriod})</span>
                </div>
              </div>

              {/* Total Units */}
              <div
                onClick={() => onNavigatePage('inventory')}
                className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-orange-500/50 transition cursor-pointer"
              >
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>{tr(language, 'Unités en stock', 'Units in stock', 'Eenheden op voorraad')}</span>
                  <Package className="w-4 h-4 text-sky-600" />
                </div>
                <div className="text-2xl font-black font-mono tabular-nums text-slate-900 dark:text-white mt-2">
                  {totalUnits.toLocaleString('fr-FR')}
                </div>
                <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  {tr(language, 'Voir le catalogue', 'View catalog', 'Catalogus bekijken')} →
                </div>
              </div>

              {/* Low Stock Alerts */}
              <div
                onClick={() => onNavigatePage('inventory')}
                className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-amber-500/50 transition cursor-pointer"
              >
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>
                    {isStandardUser || kpiScope !== 'COMPANY'
                      ? tr(language, 'Sorties enregistrées', 'Recorded outputs', 'Uitgiftes')
                      : tr(language, 'Stock bas', 'Low stock', 'Lage voorraad')}
                  </span>
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                </div>
                <div className="text-2xl font-black font-mono tabular-nums text-amber-600 dark:text-amber-400 mt-2">
                  {lowStockCount}
                </div>
                <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  {tr(language, 'Sous le seuil minimal', 'Below alert threshold', 'Onder drempelwaarde')}
                </div>
              </div>

              {/* Out of Stock */}
              <div
                onClick={() => onNavigatePage('inventory')}
                className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-red-500/50 transition cursor-pointer"
              >
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>
                    {isStandardUser || kpiScope !== 'COMPANY'
                      ? tr(language, 'Entrées enregistrées', 'Recorded inputs', 'Innames')
                      : tr(language, 'Ruptures', 'Out of stock', 'Niet op voorraad')}
                  </span>
                  <AlertOctagon className="w-4 h-4 text-red-600" />
                </div>
                <div className="text-2xl font-black font-mono tabular-nums text-red-600 dark:text-red-400 mt-2">
                  {outStockCount}
                </div>
                <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  {tr(language, 'Réapprovisionnement requis', 'Restock required', 'Aanvullen vereist')}
                </div>
              </div>
            </div>
          )}

          {/* Side-by-side Charts Row 1: Financial Trend & IN/OUT Flows */}
          <div className="grid grid-cols-2 gap-6">
            {/* Financial / Volume Trend */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-orange-600" />
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                    {hasFinancePerm
                      ? tr(language, 'Évolution de la valorisation', 'Valuation trend', 'Waardeontwikkeling')
                      : tr(language, 'Tendance des stocks', 'Stock trend', 'Voorraadtrend')}
                  </h2>
                </div>
                <div className="flex items-center gap-1">
                  {(['1d', '1w', '3m', '6m', '1y'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setKpiPeriod(p)}
                      className={`px-2 py-1 rounded-md text-[11px] font-mono font-semibold cursor-pointer ${
                        kpiPeriod === p
                          ? 'bg-orange-600 text-white'
                          : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-36 flex items-end gap-2 pt-4">
                {sparklineData.map((pt, i) => {
                  const hPct = Math.max(8, Math.round((pt.value / maxSparklineVal) * 100));
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                      <div
                        style={{ height: `${hPct}%` }}
                        className="w-full rounded-t-lg bg-orange-500/85 hover:bg-orange-600 transition-all"
                        title={`${pt.date.toLocaleDateString()} : ${
                          hasFinancePerm ? formatCurrency(pt.value) : pt.value
                        }`}
                      />
                      <span className="text-[10px] font-mono tabular-nums text-slate-400">
                        {pt.date.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* IN vs OUT Comparison */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  {tr(language, 'Flux Entrées / Sorties', 'Inbound / Outbound Flows', 'In- / Uitstroom')}
                </h2>
                <div className="flex items-center gap-1">
                  {(['1d', '1w', '1m', '1y'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        setChartPeriod(p);
                        setInPeriod(p);
                        setOutPeriod(p);
                      }}
                      className={`px-2 py-1 rounded-md text-[11px] font-mono font-semibold cursor-pointer ${
                        chartPeriod === p
                          ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                          : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-1">
                <div className="p-3.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/50">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                    <ArrowUpCircle className="w-4 h-4 text-amber-600" />
                    <span>{tr(language, 'Sorties', 'Outbound', 'Uitgiftes')}</span>
                  </div>
                  <div className="text-xl font-black font-mono tabular-nums text-slate-900 dark:text-white mt-1.5">
                    {outStats.qty} <span className="text-xs font-normal text-slate-500">u.</span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                    {outStats.count} mvt{hasFinancePerm ? ` · ${formatCurrency(outStats.val)}` : ''}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/50">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                    <ArrowDownCircle className="w-4 h-4 text-emerald-600" />
                    <span>{tr(language, 'Entrées', 'Inbound', 'Innames')}</span>
                  </div>
                  <div className="text-xl font-black font-mono tabular-nums text-slate-900 dark:text-white mt-1.5">
                    {inStats.qty} <span className="text-xs font-normal text-slate-500">u.</span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                    {inStats.count} mvt{hasFinancePerm ? ` · ${formatCurrency(inStats.val)}` : ''}
                  </div>
                </div>
              </div>

              {/* Balance progress bar */}
              {(() => {
                const totalFlow = chartMetrics.inQty + chartMetrics.outQty;
                const inPct = totalFlow > 0 ? Math.round((chartMetrics.inQty / totalFlow) * 100) : 50;
                return (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] font-mono tabular-nums text-slate-500">
                      <span>
                        {tr(language, 'Entrées', 'In', 'In')} {inPct}%
                      </span>
                      <span>
                        {tr(language, 'Sorties', 'Out', 'Uit')} {100 - inPct}%
                      </span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-amber-500/80 overflow-hidden flex">
                      <div
                        style={{ width: `${inPct}%` }}
                        className="h-full bg-emerald-500 transition-all"
                      />
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Side-by-side Charts Row 2: Department Breakdown & Rotation / SLA */}
          <div className="grid grid-cols-2 gap-6">
            {/* Department Donut */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <PieChart className="w-4 h-4 text-orange-600" />
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                    {tr(language, 'Répartition par département', 'Department Breakdown', 'Verdeling per afdeling')}
                  </h2>
                </div>
                <div className="flex items-center gap-1 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setDeptChartMetric('ORDERS')}
                    className={`px-2 py-1 rounded-md font-semibold cursor-pointer ${
                      deptChartMetric === 'ORDERS'
                        ? 'bg-orange-600 text-white'
                        : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {tr(language, 'Commandes', 'Orders', 'Bestellingen')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeptChartMetric('MOVEMENTS')}
                    className={`px-2 py-1 rounded-md font-semibold cursor-pointer ${
                      deptChartMetric === 'MOVEMENTS'
                        ? 'bg-orange-600 text-white'
                        : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {tr(language, 'Sorties', 'Outputs', 'Uitgiftes')}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-5">
                <svg viewBox="0 0 120 120" className="w-28 h-28 shrink-0">
                  {(() => {
                    let currentAngle = 0;
                    if (deptActivityData.items.length === 0) {
                      return (
                        <circle
                          cx="60"
                          cy="60"
                          r="42"
                          fill="none"
                          stroke="#cbd5e1"
                          strokeWidth="16"
                        />
                      );
                    }
                    return deptActivityData.items.map((item, idx) => {
                      const sliceAngle = (item.percent / 100) * 360;
                      const d = describeDonutSlice(
                        60,
                        60,
                        50,
                        30,
                        currentAngle,
                        currentAngle + sliceAngle
                      );
                      currentAngle += sliceAngle;
                      return (
                        <path
                          key={item.name}
                          d={d}
                          fill={item.color}
                          onMouseEnter={() => setHoveredDeptIndex(idx)}
                          onMouseLeave={() => setHoveredDeptIndex(null)}
                          className="transition-opacity cursor-pointer"
                          style={{
                            opacity:
                              hoveredDeptIndex === null || hoveredDeptIndex === idx ? 1 : 0.45,
                          }}
                        />
                      );
                    });
                  })()}
                </svg>

                <div className="flex-1 space-y-1.5 text-xs min-w-0">
                  {deptActivityData.items.slice(0, 5).map((item) => (
                    <div key={item.name} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-xs shrink-0"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="truncate text-slate-700 dark:text-slate-300">
                          {item.name}
                        </span>
                      </div>
                      <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white shrink-0">
                        {item.value} ({Math.round(item.percent)}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Rotation Top / Flop & SLA */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-orange-600" />
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                    {tr(language, 'Rotation & SLA Magasin', 'Rotation & Store SLA', 'Rotatie & Magazijn-SLA')}
                  </h2>
                </div>
                <div className="flex items-center gap-1 text-[11px] font-mono">
                  {(['1w', '1m', '1y'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setRotationPeriod(p)}
                      className={`px-2 py-0.5 rounded font-semibold cursor-pointer ${
                        rotationPeriod === p
                          ? 'bg-orange-600 text-white'
                          : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] text-slate-500">
                    {tr(language, 'Prise en charge', 'Intake', 'Inname')}
                  </div>
                  <div className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
                    {slaStats.avgIntake} min
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] text-slate-500">
                    {tr(language, 'Préparation', 'Picking', 'Picken')}
                  </div>
                  <div className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
                    {slaStats.avgPrep} min
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] text-slate-500">SLA ≤ 60m</div>
                  <div className="text-sm font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-0.5">
                    {slaStats.slaSuccessRate}%
                  </div>
                </div>
              </div>

              <div className="space-y-1.5 text-xs">
                {topRotation.slice(0, 3).map((item) => (
                  <div
                    key={item.product.id}
                    onClick={() => onOpenProductDetail(item.product.id)}
                    className="w-full py-1.5 px-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between gap-2 text-left transition cursor-pointer"
                  >
                    <span className="truncate font-medium text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <ProductRefLink
                        productId={item.product.id}
                        reference={item.product.reference}
                        onOpenProduct={onOpenProductDetail}
                      />
                      <span className="truncate">
                        {item.product.brand} {item.product.model}
                      </span>
                    </span>
                    <span className="font-mono tabular-nums font-bold text-orange-600 dark:text-orange-400 shrink-0">
                      {item.volume} u.
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right 4 columns: Recent Activity Feed */}
        <div className="col-span-4">
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <RecentActivityFeed />
          </div>
        </div>
      </div>
    </div>
  );
};
