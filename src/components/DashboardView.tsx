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

export type KpiScope = 'COMPANY' | 'MY_DEPARTMENT' | 'OTHER_DEPARTMENT' | 'INDIVIDUAL';

export const DashboardView: React.FC = () => {
  const {
    currentUser,
    products,
    movements,
    depots,
    departments,
    users,
    roles,
    orders,
    setActiveTab,
    setActiveProductId,
    setDepartmentsProjectsModal,
    userHasPermission,
    language,
    t,
    supabaseUrl,
    supabaseKey,
    isSupabaseConnected,
  } = useApp();

  const userDept = (currentUser?.department || '').trim();
  const isSuperAdmin = Number(currentUser?.id) === 0 || Number(currentUser?.role_id) === 0;
  const role = roles.find((r) => Number(r.id) === Number(currentUser?.role_id));

  // Trouver l'objet Département assigné à l'utilisateur
  const userDepartmentObj = useMemo(() => {
    if (!userDept) return null;
    return departments.find(
      (d) => d.name.toLowerCase().trim() === userDept.toLowerCase().trim()
    );
  }, [departments, userDept]);

  // 1. Privilège KPI complet (Toute la société & filtres dépôts) configuré dynamiquement dans l'app :
  // - Option à cocher sur le département (allow_global_kpis)
  // - OU Permission accordée au rôle (perm_dash_kpi_all)
  // - OU Super Administrateur
  const isLogistiqueOrDirection = useMemo(() => {
    if (isSuperAdmin) return true;
    if (userHasPermission('perm_dash_kpi_all')) return true;
    if (userDepartmentObj?.allow_global_kpis) return true;
    return false;
  }, [isSuperAdmin, userHasPermission, userDepartmentObj]);

  // 2. Détection Responsable de Département ou Conducteur de Travaux (et suppléants) :
  // - Désigné comme manager ou suppléant dans les départements de l'application
  // - OU Permission perm_kpi_scope_department sur le rôle
  const isDepartmentManager = useMemo(() => {
    if (isLogistiqueOrDirection) return false;
    if (userHasPermission('perm_kpi_scope_department')) return true;
    const isDeptMgr = departments.some(
      (d) =>
        String(d.manager_id) === String(currentUser?.id) ||
        (d.deputy_manager_ids && d.deputy_manager_ids.map(String).includes(String(currentUser?.id)))
    );
    return isDeptMgr;
  }, [isLogistiqueOrDirection, departments, currentUser, userHasPermission]);

  // 3. Utilisateur Standard (ni Logistique/Direction, ni Responsable de département)
  const isStandardUser = !isLogistiqueOrDirection && !isDepartmentManager;

  // 4. Droit effectif de filtrer par dépôt (configuré par option à cocher sur le département ou le rôle)
  const canFilterDepots = useMemo(() => {
    if (isSuperAdmin) return true;
    if (userHasPermission('perm_kpi_filter_depot') || userHasPermission('perm_dash_kpi_all')) return true;
    if (userDepartmentObj?.allow_global_kpis) return true;
    return false;
  }, [isSuperAdmin, userHasPermission, userDepartmentObj]);

  // État du Périmètre KPI
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
  const [hoveredDeptIndex, setHoveredDeptIndex] = useState<number | null>(null);

  const [sparklineHover, setSparklineHover] = useState<string | null>(null);

  // Serveur RPC : Indicateurs calculés par get_dashboard_kpis() respectant can_view_movement
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

  // Règle de visibilité serveur can_view_movement reproduite pour le repli hors-ligne
  const canViewMovement = (m: (typeof movements)[0]) => {
    if (!currentUser || currentUser.is_blocked) return false;
    if (isSuperAdmin || userHasPermission('perm_mov_view_all')) return true;
    if (userHasPermission('perm_mov_view_depot')) {
      const allowed = currentUser.allowed_depots;
      if (!allowed || allowed.length === 0 || allowed.includes('*') || allowed.includes('ALL')) return true;
      if (m.depot_name && allowed.includes(m.depot_name)) return true;
    }
    if (userHasPermission('perm_kpi_scope_department') && currentUser.department && m.department_name) {
      if (currentUser.department.toLowerCase().trim() === m.department_name.toLowerCase().trim()) return true;
    }
    if (String(m.user_id) === String(currentUser.id)) return true;
    return false;
  };

  // KPI Département : Calcul de l'activité par département pour le graphique en fromage
  const deptActivityData = useMemo(() => {
    const counts = new Map<string, number>();

    if (deptChartMetric === 'ORDERS') {
      for (const ord of orders) {
        const dept = (ord.requester_department || '').trim() || (tr(language, 'Sans Département', 'No Department'));
        counts.set(dept, (counts.get(dept) || 0) + 1);
      }
    } else {
      for (const mov of movements) {
        if (mov.movement_type === 'OUT') {
          const dept = (mov.department_name || '').trim() || (tr(language, 'Sans Département', 'No Department'));
          counts.set(dept, (counts.get(dept) || 0) + (mov.quantity_changed || 1));
        }
      }
    }

    const total = Array.from(counts.values()).reduce((sum, v) => sum + v, 0);
    const PIE_COLORS = [
      '#f97316', // orange-500
      '#3b82f6', // blue-500
      '#10b981', // emerald-500
      '#8b5cf6', // purple-500
      '#ec4899', // pink-500
      '#06b6d4', // cyan-500
      '#eab308', // yellow-500
      '#64748b', // slate-500
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

  // Polar to Cartesian helper for Donut / Pie slices
  const polarToCartesian = (centerX: number, centerY: number, radius: number, angleInDegrees: number) => {
    const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
    return {
      x: centerX + radius * Math.cos(angleInRadians),
      y: centerY + radius * Math.sin(angleInRadians),
    };
  };

  const describeDonutSlice = (
    x: number,
    y: number,
    outerRadius: number,
    innerRadius: number,
    startAngle: number,
    endAngle: number
  ) => {
    const clampedEnd = endAngle - startAngle >= 360 ? startAngle + 359.99 : endAngle;
    const startOuter = polarToCartesian(x, y, outerRadius, clampedEnd);
    const endOuter = polarToCartesian(x, y, outerRadius, startAngle);
    const startInner = polarToCartesian(x, y, innerRadius, startAngle);
    const endInner = polarToCartesian(x, y, innerRadius, clampedEnd);

    const arcSweep = clampedEnd - startAngle <= 180 ? '0' : '1';

    return [
      'M', startOuter.x, startOuter.y,
      'A', outerRadius, outerRadius, 0, arcSweep, 0, endOuter.x, endOuter.y,
      'L', startInner.x, startInner.y,
      'A', innerRadius, innerRadius, 0, arcSweep, 1, endInner.x, endInner.y,
      'Z',
    ].join(' ');
  };

  const hasFinancePerm = userHasPermission('perm_dash_finance') && userHasPermission('perm_prod_view_price');
  const hasKpiPerm = userHasPermission('perm_dash_kpi');

  // Map O(1) des produits pour des calculs instantanés et une fluidité maximale
  const productMap = useMemo(() => {
    const map = new Map<string, (typeof products)[0]>();
    for (const p of products) {
      map.set(p.id, p);
      if (p.reference) map.set(p.reference, p);
    }
    return map;
  }, [products]);

  // Liste des dépôts uniques avec effectif d'articles
  const depotOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of products) {
      const store = (p.store_name || '').trim() || (tr(language, 'Dépôt Principal', 'Main Depot'));
      counts.set(store, (counts.get(store) || 0) + 1);
    }
    for (const d of depots) {
      if (d.name && !counts.has(d.name.trim())) {
        counts.set(d.name.trim(), 0);
      }
    }
    return Array.from(counts.entries()).map(([name, count]) => ({ name, count }));
  }, [depots, products, language]);

  // Mouvements filtrés selon le périmètre sélectionné (Individuel, Mon Département, Autre Département, Toute la Société)
  const scopedMovements = useMemo(() => {
    // 1. Périmètre Individuel (forcé pour utilisateurs standards, ou sélectionné)
    if (isStandardUser || kpiScope === 'INDIVIDUAL') {
      return movements.filter(
        (m) =>
          String(m.user_id) === String(currentUser?.id) ||
          (m.user_name && currentUser?.name && m.user_name.toLowerCase().trim() === currentUser.name.toLowerCase().trim())
      );
    }

    // 2. Périmètre Mon Département
    if (kpiScope === 'MY_DEPARTMENT') {
      const deptUserNames = new Set(
        users
          .filter((u) => (u.department || '').toLowerCase().trim() === userDept.toLowerCase().trim())
          .map((u) => u.name.toLowerCase().trim())
      );
      return movements.filter(
        (m) =>
          (m.department_name && m.department_name.toLowerCase().trim() === userDept.toLowerCase().trim()) ||
          (m.user_name && deptUserNames.has(m.user_name.toLowerCase().trim()))
      );
    }

    // 3. Périmètre Autre Département (réservé Logistique/Direction)
    if (kpiScope === 'OTHER_DEPARTMENT') {
      const targetUserNames = new Set(
        users
          .filter((u) => (u.department || '').toLowerCase().trim() === selectedOtherDept.toLowerCase().trim())
          .map((u) => u.name.toLowerCase().trim())
      );
      return movements.filter(
        (m) =>
          (m.department_name && m.department_name.toLowerCase().trim() === selectedOtherDept.toLowerCase().trim()) ||
          (m.user_name && targetUserNames.has(m.user_name.toLowerCase().trim()))
      );
    }

    // 4. Toute la Société (avec filtre par dépôt optionnel)
    if (selectedDepot === 'ALL') return movements;
    return movements.filter((m) => {
      const p = productMap.get(m.product_id) || (m.product_ref ? productMap.get(m.product_ref) : undefined);
      const store = (p?.store_name || '').trim() || (tr(language, 'Dépôt Principal', 'Main Depot'));
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

  // Articles dans le périmètre actif
  const scopedProducts = useMemo(() => {
    if (kpiScope === 'COMPANY' && isLogistiqueOrDirection) {
      if (selectedDepot === 'ALL') return products;
      return products.filter((p) => {
        const store = (p.store_name || '').trim() || (tr(language, 'Dépôt Principal', 'Main Depot'));
        return store.toLowerCase() === selectedDepot.toLowerCase().trim();
      });
    }

    const manipulatedIds = new Set(scopedMovements.map((m) => m.product_id));
    const manipulatedRefs = new Set(scopedMovements.map((m) => m.product_ref).filter(Boolean));
    const matched = products.filter((p) => manipulatedIds.has(p.id) || (p.reference && manipulatedRefs.has(p.reference)));
    return matched.length > 0 ? matched : products;
  }, [kpiScope, isLogistiqueOrDirection, selectedDepot, products, language, scopedMovements]);

  // Calcul du temps moyen de préparation (SLA Magasin) & Analyses Audit
  const slaStats = useMemo(() => {
    let intakeCount = 0;
    let totalIntakeMins = 0;

    let prepCount = 0;
    let totalPrepMins = 0;

    let totalCycleMins = 0;
    let cycleCount = 0;

    let collectCount = 0;
    let totalCollectMins = 0;

    let onTimeCount = 0; // Target: <= 60 minutes
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

  // Total current stock / activity stats selon le périmètre (Fonction Serveur get_dashboard_kpis)
  const { totalValue, totalUnits, lowStockCount, outStockCount, serverPowered } = useMemo(() => {
    // 1. Si données retournées par la fonction serveur RPC (respectant can_view_movement)
    if (serverKpis) {
      return {
        totalValue: Number(serverKpis.total_value) || 0,
        totalUnits: Number(serverKpis.total_units) || 0,
        lowStockCount: Number(serverKpis.low_stock_count) || 0,
        outStockCount: Number(serverKpis.out_stock_count) || 0,
        serverPowered: true,
      };
    }

    // 2. Calcul local respectant strictement le périmètre de can_view_movement
    const visibleMovements = movements.filter((m) => {
      if (!canViewMovement(m)) return false;
      if (selectedDepot !== 'ALL' && m.depot_name && m.depot_name.toLowerCase().trim() !== selectedDepot.toLowerCase().trim()) return false;
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

    // Périmètre entreprise globale : valeur du stock physique & alertes
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

    return { totalValue: val, totalUnits: units, lowStockCount: low, outStockCount: out, serverPowered: false };
  }, [serverKpis, isStandardUser, kpiScope, movements, selectedDepot, scopedProducts, productMap, currentUser]);

  // Target date for financial trend
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

    // Calculate historical value at target start date
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

    // Build points for sparkline
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

  // Helper filter by period
  const filterByPeriod = (movList: typeof movements, code: '1d' | '1w' | '1m' | '1y') => {
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
  };

  // Out Widget metrics (scoped)
  const outStats = useMemo(() => {
    const list = filterByPeriod(
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

  // In Widget metrics (scoped)
  const inStats = useMemo(() => {
    const list = filterByPeriod(
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

  // Top / Flop Rotation (scoped)
  const { topRotation, flopRotation } = useMemo(() => {
    const periodMovs = filterByPeriod(scopedMovements, rotationPeriod);
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

  // Chart Comparison Metrics (scoped)
  const chartMetrics = useMemo(() => {
    const chartMovs = filterByPeriod(scopedMovements, chartPeriod);
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

  // Max sparkline value for scaling
  const maxSparklineVal = Math.max(...sparklineData.map((d) => d.value), 1);

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
