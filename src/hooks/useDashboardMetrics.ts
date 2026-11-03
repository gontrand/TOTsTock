import { useEffect, useMemo, useState } from 'react';
import { tr } from '../i18n/dutchTranslator';
import { useApp } from '../context/AppContext';
import {
  DashboardKpisResult,
  fetchDashboardKpisFromSupabase,
  getClientSupabase,
} from '../services/clientSupabase';
import { StockMovement } from '../types';

export type KpiScope = 'COMPANY' | 'MY_DEPARTMENT' | 'OTHER_DEPARTMENT' | 'INDIVIDUAL';

export function polarToCartesian(
  centerX: number,
  centerY: number,
  radius: number,
  angleInDegrees: number
) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

export function describeDonutSlice(
  x: number,
  y: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number
) {
  const clampedEnd = endAngle - startAngle >= 360 ? startAngle + 359.99 : endAngle;
  const startOuter = polarToCartesian(x, y, outerRadius, clampedEnd);
  const endOuter = polarToCartesian(x, y, outerRadius, startAngle);
  const startInner = polarToCartesian(x, y, innerRadius, startAngle);
  const endInner = polarToCartesian(x, y, innerRadius, clampedEnd);

  const arcSweep = clampedEnd - startAngle <= 180 ? '0' : '1';

  return [
    'M',
    startOuter.x,
    startOuter.y,
    'A',
    outerRadius,
    outerRadius,
    0,
    arcSweep,
    0,
    endOuter.x,
    endOuter.y,
    'L',
    startInner.x,
    startInner.y,
    'A',
    innerRadius,
    innerRadius,
    0,
    arcSweep,
    1,
    endInner.x,
    endInner.y,
    'Z',
  ].join(' ');
}

export function filterMovementsByPeriod(
  movList: StockMovement[],
  code: '1d' | '1w' | '1m' | '1y'
): StockMovement[] {
  const now = new Date();
  return movList.filter((m) => {
    if (!m.created_at) return false;
    const d = new Date(m.created_at);
    const diffDays = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);

    if (code === '1d') return d.toDateString() === now.toDateString();
    if (code === '1w') return diffDays <= 7;
    if (code === '1m') return diffDays <= 30;
    if (code === '1y') return d.getFullYear() === now.getFullYear();
    return true;
  });
}

export function useDashboardMetrics() {
  const {
    currentUser,
    products,
    movements,
    depots,
    departments,
    users,
    roles,
    orders,
    userHasPermission,
    language,
    supabaseUrl,
    supabaseKey,
  } = useApp();

  const userDept = (currentUser?.department || '').trim();
  const isSuperAdmin = Number(currentUser?.id) === 0 || Number(currentUser?.role_id) === 0;
  const role = roles.find((r) => Number(r.id) === Number(currentUser?.role_id));

  const userDepartmentObj = useMemo(() => {
    if (!userDept) return null;
    return departments.find(
      (d) => d.name.toLowerCase().trim() === userDept.toLowerCase().trim()
    );
  }, [departments, userDept]);

  const isLogistiqueOrDirection = useMemo(() => {
    if (isSuperAdmin) return true;
    if (userHasPermission('perm_dash_kpi_all')) return true;
    if (userDepartmentObj?.allow_global_kpis) return true;
    return false;
  }, [isSuperAdmin, userHasPermission, userDepartmentObj]);

  const isDepartmentManager = useMemo(() => {
    if (isLogistiqueOrDirection) return false;
    if (userHasPermission('perm_kpi_scope_department')) return true;
    return departments.some(
      (d) =>
        String(d.manager_id) === String(currentUser?.id) ||
        (d.deputy_manager_ids &&
          d.deputy_manager_ids.map(String).includes(String(currentUser?.id)))
    );
  }, [isLogistiqueOrDirection, departments, currentUser, userHasPermission]);

  const isStandardUser = !isLogistiqueOrDirection && !isDepartmentManager;

  const canFilterDepots = useMemo(() => {
    if (isSuperAdmin) return true;
    if (userHasPermission('perm_kpi_filter_depot') || userHasPermission('perm_dash_kpi_all')) {
      return true;
    }
    if (userDepartmentObj?.allow_global_kpis) return true;
    return false;
  }, [isSuperAdmin, userHasPermission, userDepartmentObj]);

  const [kpiScope, setKpiScope] = useState<KpiScope>(() => {
    if (isLogistiqueOrDirection) return 'COMPANY';
    if (isDepartmentManager) return 'MY_DEPARTMENT';
    return 'INDIVIDUAL';
  });

  const [selectedOtherDept, setSelectedOtherDept] = useState<string>(() => {
    const other = departments.find((d) => d.name.toLowerCase() !== userDept.toLowerCase());
    return other ? other.name : departments[0]?.name || '';
  });

  const [selectedDepot, setSelectedDepot] = useState<string>('ALL');
  const [kpiPeriod, setKpiPeriod] = useState<'1d' | '1w' | '3m' | '6m' | '1y' | '2y'>('1w');
  const [outPeriod, setOutPeriod] = useState<'1d' | '1w' | '1m' | '1y'>('1w');
  const [inPeriod, setInPeriod] = useState<'1d' | '1w' | '1m' | '1y'>('1w');
  const [chartPeriod, setChartPeriod] = useState<'1d' | '1w' | '1m' | '1y'>('1w');
  const [rotationPeriod, setRotationPeriod] = useState<'1w' | '1m' | '1y'>('1m');
  const [deptChartMetric, setDeptChartMetric] = useState<'ORDERS' | 'MOVEMENTS'>('ORDERS');

  const [serverKpis, setServerKpis] = useState<DashboardKpisResult | null>(null);
  const [isLoadingServerKpis, setIsLoadingServerKpis] = useState(false);

  useEffect(() => {
    let isSubscribed = true;
    const loadServerKpis = async () => {
      if (!supabaseUrl || !supabaseKey) return;
      const client = getClientSupabase(supabaseUrl, supabaseKey);
      if (!client) return;
      setIsLoadingServerKpis(true);
      try {
        const kpis = await fetchDashboardKpisFromSupabase(client, kpiScope, selectedDepot);
        if (isSubscribed && kpis) {
          setServerKpis(kpis);
        }
      } catch (err) {
        console.warn('Dashboard KPI server fetch failed:', err);
      } finally {
        if (isSubscribed) setIsLoadingServerKpis(false);
      }
    };
    loadServerKpis();
    return () => {
      isSubscribed = false;
    };
  }, [supabaseUrl, supabaseKey, kpiScope, selectedDepot, movements.length, products.length]);

  const canViewMovement = (m: StockMovement) => {
    if (!currentUser || currentUser.is_blocked) return false;
    if (isSuperAdmin || userHasPermission('perm_mov_view_all')) return true;
    if (userHasPermission('perm_mov_view_depot')) {
      const allowed = currentUser.allowed_depots;
      if (!allowed || allowed.length === 0 || allowed.includes('*') || allowed.includes('ALL')) {
        return true;
      }
      if (m.depot_name && allowed.includes(m.depot_name)) return true;
    }
    if (
      userHasPermission('perm_kpi_scope_department') &&
      currentUser.department &&
      m.department_name
    ) {
      if (currentUser.department.toLowerCase().trim() === m.department_name.toLowerCase().trim()) {
        return true;
      }
    }
    if (String(m.user_id) === String(currentUser.id)) return true;
    return false;
  };

  const deptActivityData = useMemo(() => {
    const counts = new Map<string, number>();

    if (deptChartMetric === 'ORDERS') {
      for (const ord of orders) {
        const dept =
          (ord.requester_department || '').trim() ||
          tr(language, 'Sans Département', 'No Department', 'Zonder afdeling');
        counts.set(dept, (counts.get(dept) || 0) + 1);
      }
    } else {
      for (const mov of movements) {
        if (mov.movement_type === 'OUT') {
          const dept =
            (mov.department_name || '').trim() ||
            tr(language, 'Sans Département', 'No Department', 'Zonder afdeling');
          counts.set(dept, (counts.get(dept) || 0) + (mov.quantity_changed || 1));
        }
      }
    }

    const total = Array.from(counts.values()).reduce((sum, v) => sum + v, 0);
    const PIE_COLORS = [
      '#f97316',
      '#3b82f6',
      '#10b981',
      '#8b5cf6',
      '#ec4899',
      '#06b6d4',
      '#eab308',
      '#64748b',
    ];

    const sorted = Array.from(counts.entries())
      .filter(([_, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value], index) => {
        const percent = total > 0 ? (value / total) * 100 : 0;
        return {
          name,
          value,
          percent,
          color: PIE_COLORS[index % PIE_COLORS.length],
        };
      });

    return { items: sorted, total };
  }, [orders, movements, deptChartMetric, language]);

  const hasFinancePerm =
    userHasPermission('perm_dash_finance') && userHasPermission('perm_prod_view_price');
  const hasKpiPerm = userHasPermission('perm_dash_kpi');

  const productMap = useMemo(() => {
    const map = new Map<string, (typeof products)[0]>();
    for (const p of products) {
      map.set(p.id, p);
      if (p.reference) map.set(p.reference, p);
    }
    return map;
  }, [products]);

  const depotOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of products) {
      const store =
        (p.store_name || '').trim() ||
        tr(language, 'Dépôt Principal', 'Main Depot', 'Hoofddepot');
      counts.set(store, (counts.get(store) || 0) + 1);
    }
    for (const d of depots) {
      if (d.name && !counts.has(d.name.trim())) {
        counts.set(d.name.trim(), 0);
      }
    }
    return Array.from(counts.entries()).map(([name, count]) => ({ name, count }));
  }, [depots, products, language]);

  const scopedMovements = useMemo(() => {
    if (isStandardUser || kpiScope === 'INDIVIDUAL') {
      return movements.filter(
        (m) =>
          String(m.user_id) === String(currentUser?.id) ||
          (m.user_name &&
            currentUser?.name &&
            m.user_name.toLowerCase().trim() === currentUser.name.toLowerCase().trim())
      );
    }

    if (kpiScope === 'MY_DEPARTMENT') {
      const deptUserNames = new Set(
        users
          .filter((u) => (u.department || '').toLowerCase().trim() === userDept.toLowerCase().trim())
          .map((u) => u.name.toLowerCase().trim())
      );
      return movements.filter(
        (m) =>
          (m.department_name &&
            m.department_name.toLowerCase().trim() === userDept.toLowerCase().trim()) ||
          (m.user_name && deptUserNames.has(m.user_name.toLowerCase().trim()))
      );
    }

    if (kpiScope === 'OTHER_DEPARTMENT') {
      const targetUserNames = new Set(
        users
          .filter(
            (u) =>
              (u.department || '').toLowerCase().trim() === selectedOtherDept.toLowerCase().trim()
          )
          .map((u) => u.name.toLowerCase().trim())
      );
      return movements.filter(
        (m) =>
          (m.department_name &&
            m.department_name.toLowerCase().trim() === selectedOtherDept.toLowerCase().trim()) ||
          (m.user_name && targetUserNames.has(m.user_name.toLowerCase().trim()))
      );
    }

    if (selectedDepot === 'ALL') return movements;
    return movements.filter((m) => {
      const p = productMap.get(m.product_id) || (m.product_ref ? productMap.get(m.product_ref) : undefined);
      const store =
        (p?.store_name || '').trim() ||
        tr(language, 'Dépôt Principal', 'Main Depot', 'Hoofddepot');
      return store.toLowerCase() === selectedDepot.toLowerCase().trim();
    });
  }, [
    isStandardUser,
    kpiScope,
    movements,
    currentUser,
    userDept,
    users,
    selectedOtherDept,
    selectedDepot,
    productMap,
    language,
  ]);

  const scopedProducts = useMemo(() => {
    if (kpiScope === 'COMPANY' && isLogistiqueOrDirection) {
      if (selectedDepot === 'ALL') return products;
      return products.filter((p) => {
        const store =
          (p.store_name || '').trim() ||
          tr(language, 'Dépôt Principal', 'Main Depot', 'Hoofddepot');
        return store.toLowerCase() === selectedDepot.toLowerCase().trim();
      });
    }

    const manipulatedIds = new Set(scopedMovements.map((m) => m.product_id));
    const manipulatedRefs = new Set(scopedMovements.map((m) => m.product_ref).filter(Boolean));
    const matched = products.filter(
      (p) => manipulatedIds.has(p.id) || (p.reference && manipulatedRefs.has(p.reference))
    );
    return matched.length > 0 ? matched : products;
  }, [kpiScope, isLogistiqueOrDirection, selectedDepot, products, language, scopedMovements]);

  const slaStats = useMemo(() => {
    let intakeCount = 0;
    let totalIntakeMins = 0;
    let prepCount = 0;
    let totalPrepMins = 0;
    let totalCycleMins = 0;
    let cycleCount = 0;
    let collectCount = 0;
    let totalCollectMins = 0;
    let onTimeCount = 0;
    const TARGET_MINS = 60;

    const auditedOrders: Array<{
      order: (typeof orders)[0];
      intakeMins: number | null;
      prepMins: number | null;
      totalMins: number | null;
      isTargetMet: boolean;
    }> = [];

    orders.forEach((o) => {
      const created = o.created_at ? new Date(o.created_at).getTime() : null;
      const assigned = o.assigned_at ? new Date(o.assigned_at).getTime() : null;
      const ready = o.ready_at ? new Date(o.ready_at).getTime() : null;
      const collected = o.collected_at ? new Date(o.collected_at).getTime() : null;

      let intakeMins: number | null = null;
      let prepMins: number | null = null;
      let totalMins: number | null = null;

      if (created && assigned && assigned >= created) {
        intakeMins = Math.round((assigned - created) / 60000);
        totalIntakeMins += intakeMins;
        intakeCount++;
      }

      if (assigned && ready && ready >= assigned) {
        prepMins = Math.round((ready - assigned) / 60000);
        totalPrepMins += prepMins;
        prepCount++;
      }

      if (created && ready && ready >= created) {
        totalMins = Math.round((ready - created) / 60000);
        totalCycleMins += totalMins;
        cycleCount++;
        if (totalMins <= TARGET_MINS) {
          onTimeCount++;
        }
      }

      if (ready && collected && collected >= ready) {
        const collectMins = Math.round((collected - ready) / 60000);
        totalCollectMins += collectMins;
        collectCount++;
      }

      if (ready || collected || assigned) {
        auditedOrders.push({
          order: o,
          intakeMins,
          prepMins,
          totalMins,
          isTargetMet: totalMins !== null ? totalMins <= TARGET_MINS : true,
        });
      }
    });

    const avgIntake = intakeCount > 0 ? Math.round(totalIntakeMins / intakeCount) : 12;
    const avgPrep = prepCount > 0 ? Math.round(totalPrepMins / prepCount) : 18;
    const avgCycle = cycleCount > 0 ? Math.round(totalCycleMins / cycleCount) : 30;
    const avgCollect = collectCount > 0 ? Math.round(totalCollectMins / collectCount) : 42;
    const slaSuccessRate = cycleCount > 0 ? Math.round((onTimeCount / cycleCount) * 100) : 96;

    return {
      avgIntake,
      avgPrep,
      avgCycle,
      avgCollect,
      slaSuccessRate,
      auditedCount: auditedOrders.length,
      recentAudits: auditedOrders.slice(0, 5),
    };
  }, [orders]);

  const { totalValue, totalUnits, lowStockCount, outStockCount, serverPowered } = useMemo(() => {
    if (serverKpis) {
      return {
        totalValue: Number(serverKpis.total_value) || 0,
        totalUnits: Number(serverKpis.total_units) || 0,
        lowStockCount: Number(serverKpis.low_stock_count) || 0,
        outStockCount: Number(serverKpis.out_stock_count) || 0,
        serverPowered: true,
      };
    }

    const visibleMovements = movements.filter((m) => {
      if (!canViewMovement(m)) return false;
      if (
        selectedDepot !== 'ALL' &&
        m.depot_name &&
        m.depot_name.toLowerCase().trim() !== selectedDepot.toLowerCase().trim()
      ) {
        return false;
      }
      return true;
    });

    if (isStandardUser || kpiScope === 'INDIVIDUAL') {
      const outM = visibleMovements.filter((m) => m.movement_type === 'OUT');
      const inM = visibleMovements.filter((m) => m.movement_type === 'IN');
      const outCost = outM.reduce((acc, m) => {
        if (m.total_cost) return acc + m.total_cost;
        const p = productMap.get(m.product_id);
        return acc + (m.quantity_changed || 0) * (p?.unit_price || 0);
      }, 0);
      const unitsCount = visibleMovements.reduce((acc, m) => acc + (m.quantity_changed || 0), 0);
      return {
        totalValue: outCost,
        totalUnits: unitsCount,
        lowStockCount: outM.length,
        outStockCount: inM.length,
        serverPowered: false,
      };
    }

    if (kpiScope === 'MY_DEPARTMENT' || kpiScope === 'OTHER_DEPARTMENT') {
      const outM = visibleMovements.filter((m) => m.movement_type === 'OUT');
      const inM = visibleMovements.filter((m) => m.movement_type === 'IN');
      const deptCost = outM.reduce((acc, m) => {
        if (m.total_cost) return acc + m.total_cost;
        const p = productMap.get(m.product_id);
        return acc + (m.quantity_changed || 0) * (p?.unit_price || 0);
      }, 0);
      const unitsCount = visibleMovements.reduce((acc, m) => acc + (m.quantity_changed || 0), 0);
      return {
        totalValue: deptCost,
        totalUnits: unitsCount,
        lowStockCount: outM.length,
        outStockCount: inM.length,
        serverPowered: false,
      };
    }

    let val = 0;
    let units = 0;
    let low = 0;
    let out = 0;

    for (const p of scopedProducts) {
      const q = p.quantity || 0;
      const min = p.min_stock_alert || 2;
      val += q * (p.unit_price || 0);
      units += q;
      if (q === 0) out++;
      else if (q <= min) low++;
    }

    return {
      totalValue: val,
      totalUnits: units,
      lowStockCount: low,
      outStockCount: out,
      serverPowered: false,
    };
  }, [
    serverKpis,
    isStandardUser,
    kpiScope,
    movements,
    selectedDepot,
    scopedProducts,
    productMap,
    currentUser,
  ]);

  const { trendPercentage, sparklineData, targetStartDate } = useMemo(() => {
    const now = new Date();
    const target = new Date();
    let steps = 7;

    switch (kpiPeriod) {
      case '1d':
        target.setDate(now.getDate() - 1);
        steps = 6;
        break;
      case '1w':
        target.setDate(now.getDate() - 7);
        steps = 7;
        break;
      case '3m':
        target.setMonth(now.getMonth() - 3);
        steps = 6;
        break;
      case '6m':
        target.setMonth(now.getMonth() - 6);
        steps = 6;
        break;
      case '1y':
        target.setFullYear(now.getFullYear() - 1);
        steps = 12;
        break;
      case '2y':
        target.setFullYear(now.getFullYear() - 2);
        steps = 8;
        break;
    }

    let pastVal = totalValue;
    for (const m of scopedMovements) {
      if (m.created_at) {
        const mDate = new Date(m.created_at);
        if (mDate > target) {
          const prod = productMap.get(m.product_id);
          const uPrice = prod ? prod.unit_price || 0 : 0;
          const cost = (m.quantity_changed || 0) * uPrice;
          if (m.movement_type === 'IN') pastVal -= cost;
          else if (m.movement_type === 'OUT') pastVal += cost;
        }
      }
    }

    const pct = pastVal > 0 ? ((totalValue - pastVal) / pastVal) * 100 : 0;

    const totalDiff = now.getTime() - target.getTime();
    const interval = totalDiff / (steps - 1);
    const points: { date: Date; value: number }[] = [];

    for (let i = steps - 1; i >= 0; i--) {
      const stepDate = new Date(now.getTime() - i * interval);
      let stepVal = totalValue;
      for (const m of scopedMovements) {
        if (m.created_at) {
          const mDate = new Date(m.created_at);
          if (mDate > stepDate) {
            const prod = productMap.get(m.product_id);
            const uPrice = prod ? prod.unit_price || 0 : 0;
            const cost = (m.quantity_changed || 0) * uPrice;
            if (m.movement_type === 'IN') stepVal -= cost;
            else if (m.movement_type === 'OUT') stepVal += cost;
          }
        }
      }
      points.push({ date: stepDate, value: Math.max(0, stepVal) });
    }

    return { trendPercentage: pct, sparklineData: points, targetStartDate: target };
  }, [kpiPeriod, totalValue, scopedMovements, productMap]);

  const outStats = useMemo(() => {
    const list = filterMovementsByPeriod(
      scopedMovements.filter((m) => m.movement_type === 'OUT'),
      outPeriod
    );
    const qty = list.reduce((acc, m) => acc + (m.quantity_changed || 0), 0);
    const val = list.reduce((acc, m) => {
      if (m.total_cost) return acc + m.total_cost;
      const p = productMap.get(m.product_id);
      return acc + (m.quantity_changed || 0) * (p?.unit_price || 0);
    }, 0);
    return { count: list.length, qty, val };
  }, [scopedMovements, outPeriod, productMap]);

  const inStats = useMemo(() => {
    const list = filterMovementsByPeriod(
      scopedMovements.filter((m) => m.movement_type === 'IN'),
      inPeriod
    );
    const qty = list.reduce((acc, m) => acc + (m.quantity_changed || 0), 0);
    const val = list.reduce((acc, m) => {
      if (m.total_cost) return acc + m.total_cost;
      const p = productMap.get(m.product_id);
      return acc + (m.quantity_changed || 0) * (p?.unit_price || 0);
    }, 0);
    return { count: list.length, qty, val };
  }, [scopedMovements, inPeriod, productMap]);

  const { topRotation, flopRotation } = useMemo(() => {
    const periodMovs = filterMovementsByPeriod(scopedMovements, rotationPeriod);
    const map = new Map<string, { product: (typeof products)[0]; volume: number }>();

    for (const p of scopedProducts) {
      map.set(p.id, { product: p, volume: 0 });
    }

    for (const m of periodMovs) {
      if (m.movement_type === 'OUT' && map.has(m.product_id)) {
        map.get(m.product_id)!.volume += m.quantity_changed || 0;
      }
    }

    const arr = Array.from(map.values());
    arr.sort((a, b) => b.volume - a.volume);

    return {
      topRotation: arr.slice(0, 3),
      flopRotation: arr.slice(-3).reverse(),
    };
  }, [scopedMovements, rotationPeriod, scopedProducts]);

  const chartMetrics = useMemo(() => {
    const chartMovs = filterMovementsByPeriod(scopedMovements, chartPeriod);
    const inM = chartMovs.filter((m) => m.movement_type === 'IN');
    const outM = chartMovs.filter((m) => m.movement_type === 'OUT');

    const inQty = inM.reduce((acc, m) => acc + (m.quantity_changed || 0), 0);
    const outQty = outM.reduce((acc, m) => acc + (m.quantity_changed || 0), 0);

    return {
      inQty,
      outQty,
      inCount: inM.length,
      outCount: outM.length,
    };
  }, [scopedMovements, chartPeriod]);

  const maxSparklineVal = Math.max(...sparklineData.map((d) => d.value), 1);

  return {
    userDept,
    isSuperAdmin,
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
    isLoadingServerKpis,
    deptActivityData,
    hasFinancePerm,
    hasKpiPerm,
    productMap,
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
  };
}
