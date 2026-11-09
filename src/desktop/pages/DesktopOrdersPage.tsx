import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Copy,
  Download,
  Loader2,
  Plus,
  Printer,
  QrCode,
  RotateCcw,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Trash2,
  Truck,
  WifiOff,
  X,
  XCircle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { MaterialOrder, OrderStatus } from '../../types';
import { formatCurrency } from '../../utils/crypto';
import { copyToClipboard } from '../../services/clipboard';
import { filterVisibleDepotsForUser } from '../../utils/depotPermissions';
import { ProductRefLink } from '../../components/ProductRefLink';
import {
  buildFullPrintableDocumentHtml,
  renderOrderReadyLabelSheetHtml,
} from '../../services/labelRendering';
import { generateQrCodeDataUrlWithTotLogo } from '../../utils/qrCodeHelper';
import { dispatchStationPrintDocument } from '../../services/printStationService';
import {
  requestGuardedNavigation,
  useRegisterUnsavedForm,
} from '../../services/unsavedChangesGuard';
import {
  buildSearchMaterialOrdersRpcParams,
  createDefaultOrderSearchFilters,
  doesOrderFilterExceedLocalWindow,
  filterOrdersDefault7DaysAndActive,
  filterOrdersLocally,
  OrderSearchFilters,
  ReportPeriodPreset,
} from '../../services/reportsService';
import {
  getClientSupabase,
  NO_AUTH_SESSION_BANNER_MESSAGE,
  normalizeOrderRecord,
} from '../../services/clientSupabase';
import {
  buildOrderTraceabilityDetails,
  canUserValidateOrderPickup,
  canUserViewOrderSignature,
  formatOrderPickupTransferSummary,
  getOrderPickupReservedMessage,
  isOrderPickupTransferred,
  isValidPickupSignature,
} from '../../services/orderTraceabilityService';
import {
  filterProjectsForSelection,
  validateProjectForOutflowOrOrder,
} from '../../services/projectStatusService';
import { tr } from '../../i18n/dutchTranslator';
import { Language } from '../../i18n/translations';
import { SearchableSelect } from '../../components/SearchableSelect';

export interface DesktopOrdersPageProps {
  selectedDepotFilter?: string;
  selectedOrderId?: string | null;
  onSelectOrder?: (id: string | null) => void;
  openNewOrderRequested?: boolean;
  onConsumeNewOrderRequest?: () => void;
  onOpenPreparationForOrder?: (ordId: string) => void;
  initialSelectedOrderId?: string | null;
  globalDepotFilter?: string;
  onOpenOrderInPreparation?: (orderId: string) => void;
}

const ORDER_STATUS_OPTIONS: OrderStatus[] = [
  'WAITING_APPROVAL',
  'PENDING',
  'PREPARING',
  'READY',
  'COLLECTED',
  'CANCELLED',
  'REJECTED',
];

const SERVER_PAGE_SIZE = 50;

function getStatusBadge(
  status: OrderStatus | string | null | undefined,
  language: Language
): { label: string; classes: string } {
  const normalized = String(status || 'PENDING')
    .trim()
    .toUpperCase();
  switch (normalized) {
    case 'WAITING_APPROVAL':
      return {
        label: tr(language, 'À valider', 'Pending approval', 'Te valideren'),
        classes: 'bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300',
      };
    case 'PENDING':
      return {
        label: tr(language, 'À préparer', 'To prepare', 'Te verzamelen'),
        classes: 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300',
      };
    case 'PREPARING':
    case 'PARTIAL':
      return {
        label: tr(language, 'En préparation', 'In preparation', 'In voorbereiding'),
        classes: 'bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300',
      };
    case 'READY':
      return {
        label: tr(language, 'Prête au retrait', 'Ready for pickup', 'Klaar voor afhaling'),
        classes: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300',
      };
    case 'COLLECTED':
    case 'DELIVERED':
      return {
        label: tr(language, 'Retirée', 'Collected', 'Afgehaald'),
        classes: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
      };
    case 'CANCELLED':
      return {
        label: tr(language, 'Annulée', 'Cancelled', 'Geannuleerd'),
        classes: 'bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300',
      };
    case 'REJECTED':
      return {
        label: tr(language, 'Refusée', 'Rejected', 'Geweigerd'),
        classes: 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300',
      };
    default:
      return {
        label: normalized || tr(language, 'À préparer', 'To prepare', 'Te verzamelen'),
        classes: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
      };
  }
}

export const DesktopOrdersPage: React.FC<DesktopOrdersPageProps> = ({
  selectedDepotFilter,
  selectedOrderId: controlledOrderId,
  onSelectOrder,
  openNewOrderRequested,
  onConsumeNewOrderRequest,
  onOpenPreparationForOrder,
  initialSelectedOrderId,
  globalDepotFilter = 'ALL',
  onOpenOrderInPreparation,
}) => {
  const {
    orders,
    products,
    depots,
    departments,
    projects,
    currentUser,
    users,
    isSupabaseConnected,
    hasAuthSession,
    supabaseUrl,
    supabaseKey,
    userHasPermission,
    canApproveOrder,
    approveOrder,
    rejectOrder,
    cancelOrder,
    markOrderCollected,
    addToOrderCart,
    orderCart,
    removeFromOrderCart,
    updateOrderCartQty,
    submitMaterialOrder,
    language,
    t,
  } = useApp();

  const visibleDepots = useMemo(
    () => filterVisibleDepotsForUser(depots, currentUser, users),
    [depots, currentUser, users]
  );

  const writeDisabledByAuth = Boolean(isSupabaseConnected && !hasAuthSession);
  const activeProjects = useMemo(
    () => filterProjectsForSelection(projects, 'ORDER'),
    [projects]
  );

  const effectiveDepotFilter = selectedDepotFilter ?? globalDepotFilter ?? 'ALL';
  const handlePrepRedirect = onOpenPreparationForOrder ?? onOpenOrderInPreparation;
  const locale = language === 'nl' ? 'nl-NL' : language === 'en' ? 'en-GB' : 'fr-FR';

  const [filters, setFilters] = useState<OrderSearchFilters>(() => createDefaultOrderSearchFilters());
  const [serverModeActive, setServerModeActive] = useState(false);
  const [serverOrders, setServerOrders] = useState<MaterialOrder[]>([]);
  const [serverTotalCount, setServerTotalCount] = useState<number>(0);
  const [isSearchingServer, setIsSearchingServer] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [localFallbackActive, setLocalFallbackActive] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  const searchSeqRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const [internalOrderId, setInternalOrderId] = useState<string | null>(
    controlledOrderId ?? initialSelectedOrderId ?? null
  );

  const selectedOrderId = controlledOrderId !== undefined ? controlledOrderId : internalOrderId;
  const setSelectedOrderId = (id: string | null) => {
    setInternalOrderId(id);
    onSelectOrder?.(id);
  };

  // New Order Modal State
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [orderSiteNumber, setOrderSiteNumber] = useState('');
  const [orderDepartment, setOrderDepartment] = useState('');
  const [orderDepot, setOrderDepot] = useState(depots[0]?.name || 'Dépôt Principal');
  const [orderNotes, setOrderNotes] = useState('');
  const [catalogQuery, setCatalogQuery] = useState('');
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [newOrderError, setNewOrderError] = useState<string | null>(null);

  // Desktop Pickup Signature Modal State (v60)
  const [desktopPickupModalOrder, setDesktopPickupModalOrder] = useState<MaterialOrder | null>(null);
  const [desktopSignatureData, setDesktopSignatureData] = useState<string | null>(null);
  const [desktopSigStrokeCount, setDesktopSigStrokeCount] = useState<number>(0);
  const [isDrawingDesktopSig, setIsDrawingDesktopSig] = useState(false);
  const [isSubmittingDesktopPickup, setIsSubmittingDesktopPickup] = useState(false);
  const [desktopPickupError, setDesktopPickupError] = useState<string | null>(null);
  const desktopSigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const desktopLastPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (openNewOrderRequested) {
      setNewOrderOpen(true);
      onConsumeNewOrderRequest?.();
    }
  }, [openNewOrderRequested, onConsumeNewOrderRequest]);

  useEffect(() => {
    if (initialSelectedOrderId) {
      setInternalOrderId(initialSelectedOrderId);
    }
  }, [initialSelectedOrderId]);

  const canCreateOrder = userHasPermission('perm_create_order');
  const canPrepOrder =
    userHasPermission('perm_menu_order_prep') || userHasPermission('perm_orders_manage');
  const canCancelOrder =
    userHasPermission('perm_order_cancel') || userHasPermission('perm_orders_manage');
  const canViewPrices = userHasPermission('perm_prod_view_price');

  const effectiveFilters: OrderSearchFilters = useMemo(() => {
    const resolvedDepot =
      filters.depot && filters.depot !== 'ALL'
        ? filters.depot
        : effectiveDepotFilter !== 'ALL'
        ? effectiveDepotFilter
        : '';
    return {
      ...filters,
      depot: resolvedDepot,
    };
  }, [filters, effectiveDepotFilter]);

  const exceedsLocalWindow = useMemo(
    () => doesOrderFilterExceedLocalWindow(effectiveFilters),
    [effectiveFilters]
  );

  const executeServerOrderSearch = useCallback(
    async (targetFilters: OrderSearchFilters, offset: number, append: boolean) => {
      const seq = ++searchSeqRef.current;
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const offlineNow = typeof navigator !== 'undefined' && !navigator.onLine;
      const client = !offlineNow ? getClientSupabase(supabaseUrl, supabaseKey) : null;

      if (!client || offlineNow || typeof (client as any).rpc !== 'function') {
        if (seq !== searchSeqRef.current) return;
        setLocalFallbackActive(true);
        setServerModeActive(false);
        setIsSearchingServer(false);
        setIsLoadingMore(false);
        return;
      }

      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsSearchingServer(true);
      }
      setServerError(null);

      try {
        const rpcParams = buildSearchMaterialOrdersRpcParams(
          targetFilters,
          SERVER_PAGE_SIZE,
          offset
        );
        let rpcCall: any = client.rpc('search_material_orders', rpcParams);
        if (rpcCall && typeof rpcCall.abortSignal === 'function') {
          rpcCall = rpcCall.abortSignal(controller.signal);
        }
        const { data, error } = await rpcCall;
        if (seq !== searchSeqRef.current || controller.signal.aborted) return;

        if (error) {
          setLocalFallbackActive(true);
          setServerModeActive(false);
          setServerError(error.message || String(error));
          return;
        }

        const rawList = Array.isArray(data) ? data : [];
        const total =
          rawList.length > 0 ? Number(rawList[0]?.total_count ?? rawList.length) : 0;
        const rows = rawList
          .map((r: any) => r?.row_data ?? r)
          .filter(Boolean)
          .map(normalizeOrderRecord);

        setLocalFallbackActive(false);
        setServerModeActive(true);
        setServerTotalCount(total);
        setServerOrders((prev) => {
          if (!append) return rows;
          const existingIds = new Set(prev.map((o) => String(o.id)));
          const merged = [...prev];
          for (const row of rows) {
            if (!existingIds.has(String(row.id))) {
              merged.push(row);
            }
          }
          return merged;
        });
      } catch (err: any) {
        if (seq !== searchSeqRef.current || controller.signal.aborted) return;
        setLocalFallbackActive(true);
        setServerModeActive(false);
        setServerError(err?.message || null);
      } finally {
        if (seq === searchSeqRef.current) {
          setIsSearchingServer(false);
          setIsLoadingMore(false);
        }
      }
    },
    [supabaseUrl, supabaseKey]
  );

  // Debounce 400ms when any filter exceeds local 7-day window
  useEffect(() => {
    if (!exceedsLocalWindow) {
      searchSeqRef.current += 1;
      abortControllerRef.current?.abort();
      setServerModeActive(false);
      setIsSearchingServer(false);
      setIsLoadingMore(false);
      setLocalFallbackActive(!isOnline);
      return;
    }

    const timer = setTimeout(() => {
      executeServerOrderSearch(effectiveFilters, 0, false);
    }, 400);

    return () => {
      clearTimeout(timer);
    };
  }, [effectiveFilters, exceedsLocalWindow, isOnline, executeServerOrderSearch]);

  const handleManualSearchClick = () => {
    executeServerOrderSearch(effectiveFilters, 0, false);
  };

  const handleResetFilters = () => {
    searchSeqRef.current += 1;
    abortControllerRef.current?.abort();
    setFilters(createDefaultOrderSearchFilters());
    setServerModeActive(false);
    setServerOrders([]);
    setServerTotalCount(0);
    setLocalFallbackActive(false);
    setServerError(null);
  };

  const handleLoadMore = () => {
    if (isLoadingMore || isSearchingServer) return;
    executeServerOrderSearch(effectiveFilters, serverOrders.length, true);
  };

  const toggleStatusSelection = (status: OrderStatus) => {
    setFilters((prev) => {
      const exists = prev.statuses.includes(status);
      const nextStatuses = exists
        ? prev.statuses.filter((s) => s !== status)
        : [...prev.statuses, status];
      return { ...prev, statuses: nextStatuses };
    });
  };

  // Default 7-day + active orders local list (or filtered local cache on fallback)
  const localFilteredOrders = useMemo(() => {
    if (!exceedsLocalWindow && filters.period === '7D') {
      const base7dAndActive = filterOrdersDefault7DaysAndActive(orders);
      return filterOrdersLocally(
        base7dAndActive,
        {
          ...effectiveFilters,
          // Period already applied with active preservation
          period: 'ALL',
        },
        products
      );
    }
    return filterOrdersLocally(orders, effectiveFilters, products);
  }, [orders, products, effectiveFilters, exceedsLocalWindow, filters.period]);

  const displayedOrders = serverModeActive ? serverOrders : localFilteredOrders;
  const totalResultsCount = serverModeActive ? serverTotalCount : localFilteredOrders.length;
  const showOfflineBanner = !isOnline || localFallbackActive;

  const activeOrder: MaterialOrder | null = useMemo(() => {
    if (selectedOrderId) {
      const found = displayedOrders.find((o) => o.id === selectedOrderId);
      if (found) return found;
    }
    return displayedOrders[0] || null;
  }, [displayedOrders, selectedOrderId]);

  const [orderQrDataUrl, setOrderQrDataUrl] = useState<string>('');
  const [readyShelfQrDataUrl, setReadyShelfQrDataUrl] = useState<string>('');
  const [copiedOrderQrCode, setCopiedOrderQrCode] = useState<boolean>(false);

  const activeOrderQrPayload = activeOrder ? `TOT-ORDER:${activeOrder.order_number}` : '';
  const activeShelfQrPayload =
    activeOrder && activeOrder.status === 'READY' && activeOrder.ready_qr_code
      ? activeOrder.ready_qr_code
      : '';

  useEffect(() => {
    let cancelled = false;
    setCopiedOrderQrCode(false);
    if (!activeOrderQrPayload) {
      setOrderQrDataUrl('');
      return;
    }
    generateQrCodeDataUrlWithTotLogo(activeOrderQrPayload, { size: 180, margin: 1 })
      .then((url) => {
        if (!cancelled) setOrderQrDataUrl(url || '');
      })
      .catch(() => {
        if (!cancelled) setOrderQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [activeOrderQrPayload]);

  useEffect(() => {
    let cancelled = false;
    if (!activeShelfQrPayload) {
      setReadyShelfQrDataUrl('');
      return;
    }
    generateQrCodeDataUrlWithTotLogo(activeShelfQrPayload, { size: 160, margin: 1 })
      .then((url) => {
        if (!cancelled) setReadyShelfQrDataUrl(url || '');
      })
      .catch(() => {
        if (!cancelled) setReadyShelfQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [activeShelfQrPayload]);

  const handleCopyOrderQrCode = async () => {
    if (!activeOrderQrPayload) return;
    const ok = await copyToClipboard(activeOrderQrPayload);
    if (ok) {
      setCopiedOrderQrCode(true);
      setTimeout(() => setCopiedOrderQrCode(false), 2000);
    }
  };

  const handleDownloadOrderQrPng = async () => {
    if (!activeOrder) return;
    let url = orderQrDataUrl;
    if (!url) {
      try {
        url = await generateQrCodeDataUrlWithTotLogo(`TOT-ORDER:${activeOrder.order_number}`, {
          size: 260,
          margin: 2,
        });
      } catch {
        url = '';
      }
    }
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = `QR_${activeOrder.order_number}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrintOrderSlip = async (order: MaterialOrder) => {
    let qrDataUrl = '';
    try {
      qrDataUrl = await generateQrCodeDataUrlWithTotLogo(`TOT-ORDER:${order.order_number}`, {
        size: 180,
        margin: 1,
      });
    } catch {
      qrDataUrl = '';
    }
    const bodyHtml = renderOrderReadyLabelSheetHtml(
      {
        order_number: order.order_number,
        site_number: order.site_number || undefined,
        site_name: order.site_name || undefined,
        requester_name: order.requester_name || undefined,
        pickup_zone: order.pickup_zone || undefined,
        depot_name: order.depot_name || undefined,
        items_count: order.items.length,
        qrDataUrl,
      },
      'avery_105x42',
      1
    );
    const docHtml = buildFullPrintableDocumentHtml(
      bodyHtml,
      'avery_105x42',
      `${tr(language, 'Bon Commande', 'Order Slip', 'Bestelbon')} ${order.order_number}`
    );
    await dispatchStationPrintDocument({
      html: docHtml,
      format: 'avery_105x42',
      copies: 1,
    });
  };

  const performCreateOrderSubmit = async (): Promise<boolean> => {
    if (orderCart.length === 0) return false;
    setNewOrderError(null);
    const siteCheck = validateProjectForOutflowOrOrder(
      orderSiteNumber || 'CHANTIER',
      projects,
      language
    );
    if (!siteCheck.valid) {
      setNewOrderError(
        siteCheck.message || `Le projet ${orderSiteNumber} est terminé : sortie impossible`
      );
      return false;
    }
    setSubmittingOrder(true);
    try {
      const res = await submitMaterialOrder(
        orderSiteNumber || 'CHANTIER',
        orderDepot || undefined,
        orderNotes || undefined
      );
      if (res.success) {
        setNewOrderOpen(false);
        setOrderNotes('');
        setNewOrderError(null);
      } else {
        setNewOrderError(res.message);
      }
      return Boolean(res.success);
    } finally {
      setSubmittingOrder(false);
    }
  };

  const handleCreateOrderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await performCreateOrderSubmit();
  };

  const handleOpenDesktopPickupModal = (order: MaterialOrder) => {
    if (!canUserValidateOrderPickup(currentUser, order)) {
      setDesktopPickupError(getOrderPickupReservedMessage(order, language));
      return;
    }
    setDesktopPickupModalOrder(order);
    setDesktopSignatureData(null);
    setDesktopSigStrokeCount(0);
    setDesktopPickupError(null);
  };

  const clearDesktopSignature = () => {
    const canvas = desktopSigCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    setDesktopSignatureData(null);
    setDesktopSigStrokeCount(0);
  };

  const handleDesktopSigPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = desktopSigCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const pos = {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
    setIsDrawingDesktopSig(true);
    desktopLastPosRef.current = pos;
  };

  const handleDesktopSigPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingDesktopSig || !desktopLastPosRef.current) return;
    e.preventDefault();
    const canvas = desktopSigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const pos = {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(desktopLastPosRef.current.x, desktopLastPosRef.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    desktopLastPosRef.current = pos;
    setDesktopSigStrokeCount((prev) => prev + 1);
  };

  const handleDesktopSigPointerUp = () => {
    if (!isDrawingDesktopSig) return;
    setIsDrawingDesktopSig(false);
    desktopLastPosRef.current = null;
    const canvas = desktopSigCanvasRef.current;
    if (canvas) {
      setDesktopSignatureData(canvas.toDataURL('image/png'));
    }
  };

  const handleConfirmDesktopPickup = async () => {
    if (!desktopPickupModalOrder) return;
    if (!isValidPickupSignature(desktopSignatureData, desktopSigStrokeCount)) {
      setDesktopPickupError(
        tr(
          language,
          'Veuillez signer dans le cadre avant de confirmer le retrait.',
          'Please sign in the box before confirming pickup.'
        )
      );
      return;
    }
    setIsSubmittingDesktopPickup(true);
    setDesktopPickupError(null);
    try {
      const res = await markOrderCollected(desktopPickupModalOrder.id, {
        signatureData: desktopSignatureData || undefined,
      });
      if (res.success) {
        setDesktopPickupModalOrder(null);
        setDesktopSignatureData(null);
        setDesktopSigStrokeCount(0);
      } else {
        setDesktopPickupError(res.message);
      }
    } catch (err: any) {
      setDesktopPickupError(err?.message || 'Erreur lors de la validation du retrait.');
    } finally {
      setIsSubmittingDesktopPickup(false);
    }
  };

  const isNewOrderDirty = Boolean(
    newOrderOpen &&
      (orderCart.length > 0 || orderSiteNumber.trim() !== '' || orderNotes.trim() !== '')
  );

  useRegisterUnsavedForm({
    id: 'desktop-new-order-drawer',
    isDirty: isNewOrderDirty,
    label: tr(language, 'Nouvelle commande matériel', 'New material order', 'Nieuwe materiaalbestelling'),
    onSave: () => performCreateOrderSubmit(),
    onDiscard: () => {
      setNewOrderOpen(false);
      setOrderNotes('');
    },
  });

  const handleCloseNewOrderDrawer = () => {
    requestGuardedNavigation(
      () => {
        setNewOrderOpen(false);
      },
      ['desktop-new-order-drawer']
    );
  };

  const depotCatalogProducts = useMemo(() => {
    const q = catalogQuery.toLowerCase().trim();
    return products
      .filter((p) => {
        if (orderDepot && p.store_name && p.store_name !== orderDepot) return false;
        if (!q) return true;
        return `${p.reference} ${p.brand} ${p.model}`
          .toLowerCase()
          .includes(q);
      })
      .slice(0, 40);
  }, [products, orderDepot, catalogQuery]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-slate-50 dark:bg-slate-950">
      {/* Offline / Local Fallback Banner */}
      {showOfflineBanner && (
        <div
          role="status"
          data-testid="orders-local-fallback-banner"
          className="px-6 py-2 bg-amber-50 dark:bg-amber-950/60 border-b border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs font-bold flex items-center justify-between gap-2 shrink-0"
        >
          <div className="flex items-center gap-2">
            <WifiOff className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>
              {tr(
                language,
                'Recherche limitée aux données locales',
                'Search limited to local data',
                'Zoekopdracht beperkt tot lokale gegevens'
              )}
            </span>
          </div>
          {serverError && (
            <span className="text-[11px] font-normal text-amber-700 dark:text-amber-300 truncate max-w-md">
              {serverError}
            </span>
          )}
        </div>
      )}

      {/* Top Filter Bar (Lot 1.2) */}
      <div className="px-5 py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 space-y-2.5 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <ShoppingBag className="w-5 h-5 text-orange-600" />
            <h1 className="text-base font-black text-slate-900 dark:text-white">
              {t('desktop_nav_orders')}
            </h1>
            <span
              data-testid="orders-results-count"
              className="px-2.5 py-0.5 text-xs font-mono font-bold rounded-full bg-orange-50 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800"
            >
              {totalResultsCount} {tr(language, 'résultats', 'results', 'resultaten')}
            </span>
            {isSearchingServer && (
              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-600" />
                {tr(language, 'Recherche...', 'Searching...', 'Zoeken...')}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Period selector */}
            <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-0.5 text-xs font-bold">
              {(
                [
                  ['7D', tr(language, '7 j', '7 d', '7 d')],
                  ['30D', tr(language, '30 j', '30 d', '30 d')],
                  ['CUSTOM', tr(language, 'Personnalisée', 'Custom', 'Aangepast')],
                  ['ALL', tr(language, 'Tout', 'All', 'Alles')],
                ] as Array<[ReportPeriodPreset, string]>
              ).map(([preset, label]) => (
                <button
                  key={preset}
                  type="button"
                  data-testid={`orders-period-${preset.toLowerCase()}`}
                  onClick={() => setFilters((prev) => ({ ...prev, period: preset }))}
                  className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                    filters.period === preset
                      ? 'bg-white dark:bg-slate-900 text-orange-600 dark:text-orange-400 shadow-2xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {filters.period === 'CUSTOM' && (
              <div className="flex items-center gap-1.5 text-xs">
                <input
                  type="date"
                  aria-label={tr(language, 'Date de début', 'Start date', 'Startdatum')}
                  value={filters.fromDate}
                  onChange={(e) => setFilters((prev) => ({ ...prev, fromDate: e.target.value }))}
                  className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                />
                <span className="text-slate-400">→</span>
                <input
                  type="date"
                  aria-label={tr(language, 'Date de fin', 'End date', 'Einddatum')}
                  value={filters.toDate}
                  onChange={(e) => setFilters((prev) => ({ ...prev, toDate: e.target.value }))}
                  className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                />
              </div>
            )}

            <button
              type="button"
              data-testid="orders-search-btn"
              onClick={handleManualSearchClick}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Search className="w-3.5 h-3.5" />
              {tr(language, 'Rechercher', 'Search', 'Zoeken')}
            </button>

            <button
              type="button"
              data-testid="orders-reset-btn"
              onClick={handleResetFilters}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {tr(language, 'Réinitialiser', 'Reset', 'Resetten')}
            </button>

            {canCreateOrder && (
              <button
                type="button"
                disabled={writeDisabledByAuth}
                title={writeDisabledByAuth ? NO_AUTH_SESSION_BANNER_MESSAGE : undefined}
                onClick={() => setNewOrderOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('desktop_new_order')}
              </button>
            )}
          </div>
        </div>

        {/* Multi-status filter pills */}
        <div className="flex flex-wrap items-center gap-1 text-[11px] font-bold">
          <span className="text-slate-400 mr-1 flex items-center gap-1">
            <SlidersHorizontal className="w-3 h-3" />
            {tr(language, 'Statuts :', 'Statuses:', 'Statussen:')}
          </span>
          <button
            type="button"
            onClick={() => setFilters((prev) => ({ ...prev, statuses: [] }))}
            className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
              filters.statuses.length === 0
                ? 'bg-orange-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
            }`}
          >
            {tr(language, 'Tous', 'All', 'Alle')}
          </button>
          {ORDER_STATUS_OPTIONS.map((st) => {
            const active = filters.statuses.includes(st);
            const badge = getStatusBadge(st, language);
            return (
              <button
                key={st}
                type="button"
                data-testid={`orders-status-${st.toLowerCase()}`}
                onClick={() => toggleStatusSelection(st)}
                className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                  active
                    ? 'bg-orange-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                {badge.label}
              </button>
            );
          })}
        </div>

        {/* Detailed filter inputs */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-9 gap-2 text-xs">
          <div className="relative lg:col-span-2">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              data-testid="orders-filter-text"
              value={filters.text}
              onChange={(e) => setFilters((prev) => ({ ...prev, text: e.target.value }))}
              placeholder={tr(
                language,
                'Texte libre (n° commande, notes...)',
                'Free text (order #, notes...)',
                'Vrije tekst (bestelnr., notities...)'
              )}
              className="w-full pl-8 pr-6 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-xs"
            />
            {filters.text && (
              <button
                type="button"
                onClick={() => setFilters((prev) => ({ ...prev, text: '' }))}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <input
            type="text"
            data-testid="orders-filter-reference"
            value={filters.reference}
            onChange={(e) => setFilters((prev) => ({ ...prev, reference: e.target.value }))}
            placeholder={tr(language, 'Réf. article', 'Item ref', 'Artikelref.')}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono"
          />

          <input
            type="text"
            data-testid="orders-filter-requester"
            value={filters.requester}
            onChange={(e) => setFilters((prev) => ({ ...prev, requester: e.target.value }))}
            placeholder={tr(language, 'Demandeur', 'Requester', 'Aanvrager')}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
          />

          <input
            type="text"
            data-testid="orders-filter-preparer"
            value={filters.preparer}
            onChange={(e) => setFilters((prev) => ({ ...prev, preparer: e.target.value }))}
            placeholder={tr(language, 'Préparateur', 'Preparer', 'Orderpicker')}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
          />

          <input
            type="text"
            data-testid="orders-filter-collector"
            value={filters.collector || ''}
            onChange={(e) => setFilters((prev) => ({ ...prev, collector: e.target.value }))}
            placeholder={tr(language, 'Enleveur', 'Collector', 'Afhaler')}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
          />

          <SearchableSelect
            data-testid="orders-filter-pickup-transferred"
            value={filters.pickupTransferred || 'ALL'}
            onChange={(val) =>
              setFilters((prev) => ({
                ...prev,
                pickupTransferred: val as 'ALL' | 'YES' | 'NO',
              }))
            }
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
          >
            <option value="ALL">
              {tr(language, 'Retrait transféré : Tous', 'Pickup transferred: All', 'Afhaling overgedragen: Alle')}
            </option>
            <option value="YES">
              {tr(language, 'Retrait transféré : Oui', 'Pickup transferred: Yes', 'Afhaling overgedragen: Ja')}
            </option>
            <option value="NO">
              {tr(language, 'Retrait transféré : Non', 'Pickup transferred: No', 'Afhaling overgedragen: Nee')}
            </option>
          </SearchableSelect>

          <SearchableSelect
            data-testid="orders-filter-department"
            value={filters.department}
            onChange={(val) => setFilters((prev) => ({ ...prev, department: val }))}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
          >
            <option value="">{tr(language, 'Tous départements', 'All departments', 'Alle afdelingen')}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.name}>
                {d.name}
              </option>
            ))}
          </SearchableSelect>

          <input
            type="text"
            data-testid="orders-filter-site"
            value={filters.site}
            onChange={(e) => setFilters((prev) => ({ ...prev, site: e.target.value }))}
            placeholder={tr(language, 'Chantier', 'Job site', 'Werf')}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono"
          />

          <SearchableSelect
            data-testid="orders-filter-depot"
            value={filters.depot}
            onChange={(val) => setFilters((prev) => ({ ...prev, depot: val }))}
            recentKey="depots"
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
          >
            <option value="">{tr(language, 'Tous dépôts', 'All depots', 'Alle depots')}</option>
            {visibleDepots.map((d) => (
              <option key={d.id} value={d.name}>
                {d.name}
              </option>
            ))}
          </SearchableSelect>

          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              step="0.01"
              data-testid="orders-filter-min-cost"
              value={filters.minCost}
              onChange={(e) => setFilters((prev) => ({ ...prev, minCost: e.target.value }))}
              placeholder={tr(language, 'Min €', 'Min €', 'Min €')}
              className="w-1/2 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono"
            />
            <input
              type="number"
              min={0}
              step="0.01"
              data-testid="orders-filter-max-cost"
              value={filters.maxCost}
              onChange={(e) => setFilters((prev) => ({ ...prev, maxCost: e.target.value }))}
              placeholder={tr(language, 'Max €', 'Max €', 'Max €')}
              className="w-1/2 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono"
            />
          </div>
        </div>
      </div>

      {/* Main Split View: Left Orders List + Right Order Detail */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left Column: Orders List */}
        <div className="w-[410px] shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col h-full">
          <div className="flex-1 overflow-y-auto divide-y divide-slate-200/70 dark:divide-slate-800">
            {displayedOrders.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                {tr(
                  language,
                  'Aucune commande trouvée pour ce filtre.',
                  'No order found for this filter.',
                  'Geen bestellingen gevonden voor dit filter.'
                )}
              </div>
            ) : (
              displayedOrders.map((order) => {
                const isSelected = activeOrder?.id === order.id;
                const badge = getStatusBadge(order.status, language);
                const orderItems = Array.isArray(order.items) ? order.items : [];
                const totalLines = orderItems.length;
                const pickedLines = orderItems.filter(
                  (it) => it.picked || it.unavailable
                ).length;

                return (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => setSelectedOrderId(order.id)}
                    className={`w-full text-left p-4 transition-colors flex flex-col gap-1.5 ${
                      isSelected
                        ? 'bg-orange-50/90 dark:bg-orange-950/40 border-l-4 border-l-orange-600'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-black text-slate-900 dark:text-white">
                        {order.order_number}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${badge.classes}`}
                      >
                        {badge.label}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                      <span className="font-semibold truncate">
                        {order.requester_name} • {order.site_number || '—'}
                      </span>
                      <span className="font-mono text-[11px] text-slate-500">
                        {pickedLines}/{totalLines} {tr(language, 'lignes', 'lines', 'regels')}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>
                        {order.depot_name || tr(language, 'Dépôt Principal', 'Main Depot', 'Hoofddepot')}
                      </span>
                      <span className="font-mono">
                        {new Date(order.created_at).toLocaleDateString(locale)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-500 dark:text-slate-400 pt-0.5">
                      {order.preparer_name && (
                        <span>
                          {tr(language, 'Prép.:', 'Prep:', 'Pick:')} <strong>{order.preparer_name}</strong>
                        </span>
                      )}
                      {order.collected_by && (
                        <span>
                          {tr(language, 'Enlev.:', 'Coll.:', 'Afh.:')} <strong>{order.collected_by}</strong>
                        </span>
                      )}
                      {isOrderPickupTransferred(order) && (
                        <span className="px-1.5 py-0.2 rounded bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 font-bold">
                          {formatOrderPickupTransferSummary(order, language)}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}

            {/* Pagination: Charger plus */}
            {serverModeActive && serverOrders.length < serverTotalCount && (
              <div className="p-3 text-center bg-slate-50/60 dark:bg-slate-800/30">
                <button
                  type="button"
                  data-testid="orders-load-more-btn"
                  disabled={isLoadingMore}
                  onClick={handleLoadMore}
                  className="w-full py-2 px-4 rounded-lg text-xs font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isLoadingMore
                    ? tr(language, 'Chargement...', 'Loading...', 'Laden...')
                    : `${tr(language, 'Charger plus', 'Load more', 'Meer laden')} (${serverOrders.length} / ${serverTotalCount})`}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Order Detail & Actions */}
        <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
          {!activeOrder ? (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-400">
              {tr(
                language,
                'Sélectionnez une commande dans la liste de gauche pour afficher ses lignes.',
                'Select an order from the left list to view its lines.',
                'Selecteer een bestelling in de lijst links om de regels te bekijken.'
              )}
            </div>
          ) : (
            <>
              {/* Order Header */}
              <div className="px-6 py-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-black font-mono text-slate-900 dark:text-white">
                      {activeOrder.order_number}
                    </h2>
                    <span
                      className={`px-2.5 py-0.5 rounded-md text-xs font-bold ${
                        getStatusBadge(activeOrder.status, language).classes
                      }`}
                    >
                      {getStatusBadge(activeOrder.status, language).label}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {tr(language, 'Demandeur :', 'Requester:', 'Aanvrager:')}{' '}
                    <strong className="text-slate-800 dark:text-slate-200">
                      {activeOrder.requester_name}
                    </strong>{' '}
                    • {tr(language, 'Chantier :', 'Job site:', 'Werf:')}{' '}
                    <strong className="font-mono text-slate-800 dark:text-slate-200">
                      {activeOrder.site_number || '—'}
                    </strong>{' '}
                    • {tr(language, 'Dépôt :', 'Depot:', 'Depot:')}{' '}
                    <strong className="text-slate-800 dark:text-slate-200">
                      {activeOrder.depot_name || tr(language, 'Dépôt Principal', 'Main Depot', 'Hoofddepot')}
                    </strong>
                    {activeOrder.preparer_name && (
                      <>
                        {' '}
                        • {tr(language, 'Préparateur :', 'Preparer:', 'Orderpicker:')}{' '}
                        <strong className="text-slate-800 dark:text-slate-200">
                          {activeOrder.preparer_name}
                        </strong>
                      </>
                    )}
                    {activeOrder.pickup_zone && (
                      <>
                        {' '}
                        • {tr(language, 'Zone retrait :', 'Pickup zone:', 'Afhaalzone:')}{' '}
                        <strong className="font-mono text-emerald-600 dark:text-emerald-400">
                          {activeOrder.pickup_zone}
                        </strong>
                      </>
                    )}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handlePrintOrderSlip(activeOrder)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50"
                  >
                    <Printer className="w-3.5 h-3.5 text-orange-500" />
                    {tr(language, 'Imprimer bon', 'Print slip', 'Bon afdrukken')}
                  </button>

                  {activeOrder.status === 'WAITING_APPROVAL' &&
                    canApproveOrder(activeOrder) && (
                      <>
                        <button
                          type="button"
                          onClick={() => approveOrder(activeOrder.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {tr(language, 'Approuver', 'Approve', 'Goedkeuren')}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            rejectOrder(
                              activeOrder.id,
                              tr(
                                language,
                                'Refusé depuis le poste bureau',
                                'Rejected from desktop workstation',
                                'Geweigerd vanaf desktopwerkstation'
                              )
                            )
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          {tr(language, 'Refuser', 'Reject', 'Weigeren')}
                        </button>
                      </>
                    )}

                  {(activeOrder.status === 'PENDING' ||
                    activeOrder.status === 'PREPARING') &&
                    canPrepOrder &&
                    handlePrepRedirect && (
                      <button
                        type="button"
                        onClick={() => handlePrepRedirect(activeOrder.id)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white"
                      >
                        <ClipboardList className="w-3.5 h-3.5" />
                        {tr(
                          language,
                          'Ouvrir en préparation (Picking)',
                          'Open in Picking',
                          'Openen in Orderpicken'
                        )}
                      </button>
                    )}

                  {activeOrder.status === 'READY' &&
                    (canUserValidateOrderPickup(currentUser, activeOrder) ? (
                      <button
                        type="button"
                        data-testid="desktop-order-collect-btn"
                        disabled={writeDisabledByAuth}
                        title={writeDisabledByAuth ? NO_AUTH_SESSION_BANNER_MESSAGE : undefined}
                        onClick={() => handleOpenDesktopPickupModal(activeOrder)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white cursor-pointer"
                      >
                        <Truck className="w-3.5 h-3.5" />
                        {tr(language, 'Valider le retrait', 'Confirm pickup', 'Afhaling bevestigen')}
                      </button>
                    ) : (
                      <div
                        data-testid="desktop-order-pickup-reserved"
                        className="px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs font-bold"
                      >
                        {getOrderPickupReservedMessage(activeOrder, language)}
                      </div>
                    ))}

                  {(activeOrder.status === 'PENDING' ||
                    activeOrder.status === 'WAITING_APPROVAL') &&
                    canCancelOrder && (
                      <button
                        type="button"
                        onClick={() => cancelOrder(activeOrder.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {tr(language, 'Annuler', 'Cancel', 'Annuleren')}
                      </button>
                    )}
                </div>
              </div>

              {/* Order Items Table + QR Code + Traceability Block */}
              <div className="flex-1 overflow-auto p-6 space-y-4">
                {/* Section 6 (v59): QR Code de la commande + Code de retrait étagère */}
                <div
                  data-testid="desktop-order-qr-block"
                  className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-white border border-slate-200 shadow-2xs flex flex-col items-center">
                        <img
                          data-testid="desktop-order-qr-img"
                          src={
                            orderQrDataUrl ||
                            'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
                          }
                          alt={activeOrderQrPayload}
                          className="w-24 h-24 object-contain"
                        />
                        <span
                          data-testid="desktop-order-qr-code-text"
                          className="mt-1 font-mono font-bold text-[10px] text-slate-700"
                        >
                          {activeOrderQrPayload}
                        </span>
                      </div>
                      <div className="space-y-1">
                        <div className="font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                          <QrCode className="w-4 h-4 text-orange-500" />
                          <span>
                            {tr(
                              language,
                              'QR Code de la commande',
                              'Order QR Code',
                              'QR-code van de bestelling'
                            )}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-xs">
                          {tr(
                            language,
                            'Scannez ce code en préparation ou au retrait pour ouvrir directement la commande.',
                            'Scan this code during picking or pickup to open the order directly.',
                            'Scan deze code tijdens het verzamelen of afhalen om de bestelling direct te openen.'
                          )}
                        </p>
                        <div className="font-mono font-bold text-slate-800 dark:text-slate-200">
                          {activeOrder.order_number}
                        </div>
                      </div>
                    </div>

                    {activeOrder.status === 'READY' && activeOrder.ready_qr_code && (
                      <div
                        data-testid="desktop-order-shelf-qr-block"
                        className="flex items-center gap-3 pl-4 border-l border-slate-200 dark:border-slate-800"
                      >
                        <div className="p-2 rounded-xl bg-white border border-emerald-300 shadow-2xs flex flex-col items-center">
                          <img
                            data-testid="desktop-order-shelf-qr-img"
                            src={
                              readyShelfQrDataUrl ||
                              'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
                            }
                            alt={activeOrder.ready_qr_code}
                            className="w-20 h-20 object-contain"
                          />
                          <span className="mt-1 font-mono font-bold text-[10px] text-emerald-700">
                            {activeOrder.ready_qr_code}
                          </span>
                        </div>
                        <div className="space-y-1">
                          <div className="font-black text-emerald-700 dark:text-emerald-300">
                            {tr(
                              language,
                              'Code de retrait étagère',
                              'Shelf pickup code',
                              'Afhaalcode schap'
                            )}
                          </div>
                          {activeOrder.pickup_zone && (
                            <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                              {tr(language, 'Zone :', 'Zone:', 'Zone:')} {activeOrder.pickup_zone}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      data-testid="desktop-order-copy-qr-btn"
                      onClick={handleCopyOrderQrCode}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5 text-orange-500" />
                      <span>
                        {copiedOrderQrCode
                          ? tr(language, 'Code copié ✓', 'Copied ✓', 'Gekopieerd ✓')
                          : tr(language, 'Copier le code', 'Copy code', 'Code kopiëren')}
                      </span>
                    </button>

                    <button
                      type="button"
                      data-testid="desktop-order-download-qr-btn"
                      onClick={handleDownloadOrderQrPng}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 text-orange-500" />
                      <span>
                        {tr(
                          language,
                          'Télécharger le QR (PNG)',
                          'Download QR (PNG)',
                          'QR downloaden (PNG)'
                        )}
                      </span>
                    </button>

                    <button
                      type="button"
                      data-testid="desktop-order-print-slip-btn"
                      onClick={() => handlePrintOrderSlip(activeOrder)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>
                        {tr(language, 'Imprimer le bon', 'Print slip', 'Bon afdrukken')}
                      </span>
                    </button>
                  </div>
                </div>
                {(() => {
                  const trace = buildOrderTraceabilityDetails(activeOrder, language, {
                    currentUser,
                    departments,
                    projects,
                  });
                  return (
                    <div
                      data-testid="desktop-order-traceability-block"
                      className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2.5 text-xs"
                    >
                      <div className="font-black text-[11px] uppercase tracking-wider text-slate-700 dark:text-slate-200">
                        {tr(language, 'Traçabilité de la commande', 'Order Traceability', 'Traceerbaarheid van de bestelling')}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70">
                          <span className="text-[10px] font-bold uppercase text-slate-400 block">
                            {tr(language, 'Demandeur', 'Requester', 'Aanvrager')}
                          </span>
                          <span className="font-bold text-slate-900 dark:text-white">
                            {trace.requesterName}
                          </span>
                          <span className="text-[11px] font-mono text-slate-500 block">
                            {trace.createdAtFormatted}
                          </span>
                        </div>

                        <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70">
                          <span className="text-[10px] font-bold uppercase text-slate-400 block">
                            {tr(language, 'Préparateur', 'Preparer', 'Orderpicker')}
                          </span>
                          <span className="font-bold text-slate-900 dark:text-white">
                            {trace.preparerName}
                          </span>
                          <span className="text-[11px] font-mono text-slate-500 block">
                            {trace.readyAtFormatted !== '—'
                              ? `${tr(language, 'Prête :', 'Ready:', 'Klaar:')} ${trace.readyAtFormatted}`
                              : trace.assignedAtFormatted !== '—'
                              ? `${tr(language, 'Prise :', 'Assigned:', 'Toegewezen:')} ${trace.assignedAtFormatted}`
                              : '—'}
                          </span>
                        </div>

                        <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70">
                          <span className="text-[10px] font-bold uppercase text-slate-400 block">
                            {tr(language, 'Enleveur', 'Collector', 'Afhaler')}
                          </span>
                          <span className="font-bold text-slate-900 dark:text-white">
                            {trace.collectorName}
                          </span>
                          <span className="text-[11px] font-mono text-slate-500 block">
                            {trace.collectedAtFormatted}
                          </span>
                        </div>

                        <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70">
                          <span className="text-[10px] font-bold uppercase text-slate-400 block">
                            {tr(language, 'Retrait transféré', 'Pickup transferred', 'Afhaling overgedragen')}
                          </span>
                          <span
                            data-testid="desktop-order-traceability-transferred"
                            className={`font-bold ${
                              trace.pickupTransferred
                                ? 'text-purple-700 dark:text-purple-300'
                                : 'text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {trace.pickupTransferSummary}
                          </span>
                          {trace.pickupDelegateNotes && (
                            <span className="text-[11px] text-slate-500 block italic">
                              « {trace.pickupDelegateNotes} »
                            </span>
                          )}
                        </div>
                      </div>

                      {/* v60 points 8.7 & 8.8 : Signature de retrait en lecture seule selon les droits */}
                      {(activeOrder.status === 'COLLECTED' || trace.hasSignature) && (
                        <div
                          data-testid="desktop-order-traceability-signature"
                          className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1.5"
                        >
                          <span className="text-[10px] font-bold uppercase text-slate-400 block">
                            {tr(language, 'Signature de retrait', 'Pickup Signature', 'Afhaalhandtekening')}
                          </span>
                          {trace.hasSignature ? (
                            trace.canViewSignature && trace.signatureData ? (
                              <div className="space-y-1">
                                <div className="p-2 bg-white rounded-lg border border-slate-200 flex items-center justify-center">
                                  <img
                                    src={trace.signatureData}
                                    alt="Signature de retrait"
                                    className="max-h-24 object-contain"
                                  />
                                </div>
                                <div className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                                  {trace.signedByLabel}
                                </div>
                              </div>
                            ) : (
                              <div className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                                {tr(language, 'Retrait signé', 'Signed pickup', 'Ondertekende afhaling')}
                              </div>
                            )
                          ) : (
                            <div className="text-xs text-slate-400 italic">
                              {tr(language, 'Aucune signature enregistrée', 'No signature recorded')}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-100 dark:bg-slate-800/80 text-[11px] font-bold uppercase text-slate-500">
                      <tr>
                        <th className="py-2.5 px-4">{tr(language, 'Référence', 'Reference', 'Referentie')}</th>
                        <th className="py-2.5 px-4">{tr(language, 'Désignation', 'Designation', 'Omschrijving')}</th>
                        <th className="py-2.5 px-3">{tr(language, 'Emplacement', 'Location', 'Locatie')}</th>
                        <th className="py-2.5 px-3 text-right">{tr(language, 'Demandé', 'Requested', 'Gevraagd')}</th>
                        <th className="py-2.5 px-3 text-right">{tr(language, 'Préparé', 'Picked', 'Verzameld')}</th>
                        <th className="py-2.5 px-4">{tr(language, 'Statut ligne', 'Line status', 'Regelstatus')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                      {(Array.isArray(activeOrder.items) ? activeOrder.items : []).map((it) => {
                        const pickedQty = it.picked_quantity ?? (it.picked ? it.quantity : 0);
                        const isMissing = Boolean(it.unavailable);
                        const isPartial = !isMissing && it.picked && pickedQty > 0 && pickedQty < it.quantity;

                        return (
                          <tr key={String(it.product_id)} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="py-3 px-4 font-mono font-bold text-orange-600 dark:text-orange-400">
                              <ProductRefLink
                                productId={it.product_id}
                                reference={it.product_ref}
                              />
                            </td>
                            <td className="py-3 px-4">
                              <div className="font-bold text-slate-900 dark:text-white">
                                {it.product_name}
                              </div>
                              {it.substituted && it.substituted_with_ref && (
                                <div className="text-[11px] text-amber-600">
                                  {tr(language, 'Remplacé par', 'Replaced with', 'Vervangen door')}{' '}
                                  <ProductRefLink
                                    productId={it.substituted_with_id}
                                    reference={it.substituted_with_ref}
                                    className="text-amber-600"
                                  />{' '}
                                  ({it.substituted_with_name})
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-3 font-mono text-slate-600 dark:text-slate-300">
                              {it.rack_location || '—'}
                            </td>
                            <td className="py-3 px-3 text-right font-mono font-bold">
                              {it.quantity}
                            </td>
                            <td className="py-3 px-3 text-right font-mono font-black text-emerald-600 dark:text-emerald-400">
                              {pickedQty}
                            </td>
                            <td className="py-3 px-4">
                              {isMissing ? (
                                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                                  {tr(language, 'Manquant', 'Missing', 'Ontbrekend')}{' '}
                                  {it.unavailable_comment ? `(${it.unavailable_comment})` : ''}
                                </span>
                              ) : isPartial ? (
                                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                                  {tr(language, 'Partiel', 'Partial', 'Gedeeltelijk')} ({pickedQty}/{it.quantity})
                                </span>
                              ) : it.picked ? (
                                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                                  {tr(language, 'Pointé', 'Picked', 'Verzameld')}
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                  {tr(language, 'En attente', 'Pending', 'In wachtrij')}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {canViewPrices && activeOrder.total_cost != null && (
                  <div className="mt-4 flex justify-end">
                    <div className="px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
                      {tr(language, 'Total estimé HT :', 'Estimated net total:', 'Geschat totaal excl. btw:')}{' '}
                      <strong className="font-mono text-sm text-slate-900 dark:text-white ml-2">
                        {formatCurrency(activeOrder.total_cost)}
                      </strong>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* New Order Drawer */}
      {newOrderOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex justify-end"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseNewOrderDrawer();
          }}
        >
          <div className="w-full max-w-2xl bg-white dark:bg-slate-900 h-full shadow-2xl border-l border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="text-base font-black text-slate-900 dark:text-white">
                {t('desktop_new_order_material')}
              </h2>
              <button
                type="button"
                onClick={handleCloseNewOrderDrawer}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={handleCreateOrderSubmit}
              className="flex-1 overflow-y-auto p-6 space-y-5 text-xs"
            >
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {tr(language, 'Dépôt (mono-dépôt)', 'Depot (single-depot)', 'Depot (één depot)')}
                  </label>
                  <SearchableSelect
                    value={orderDepot}
                    onChange={(val) => setOrderDepot(val)}
                    disabled={orderCart.length > 0}
                    recentKey="depots"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-semibold disabled:opacity-60"
                  >
                    {visibleDepots.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </SearchableSelect>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {tr(language, 'N° Chantier *', 'Job Site # *', 'Werfnr. *')}
                  </label>
                  <input
                    type="text"
                    required
                    list="desktop-order-projects"
                    value={orderSiteNumber}
                    onChange={(e) => setOrderSiteNumber(e.target.value)}
                    placeholder="Ex: CH-2026-01"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                  />
                  <datalist id="desktop-order-projects">
                    {activeProjects.map((p) => (
                      <option key={p.id} value={p.project_number}>
                        {p.project_name}
                      </option>
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {tr(language, 'Département', 'Department', 'Afdeling')}
                  </label>
                  <SearchableSelect
                    value={orderDepartment}
                    onChange={(val) => setOrderDepartment(val)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  >
                    <option value="">{tr(language, '— Choisir —', '— Select —', '— Kiezen —')}</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </SearchableSelect>
                </div>
              </div>

              {newOrderError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-200 font-bold text-xs"
                >
                  {newOrderError}
                </div>
              )}

              {/* Add catalog items */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    {tr(
                      language,
                      `Ajouter des articles du dépôt « ${orderDepot} »`,
                      `Add items from depot "${orderDepot}"`,
                      `Artikelen toevoegen uit depot "${orderDepot}"`
                    )}
                  </span>
                </div>
                <input
                  type="text"
                  value={catalogQuery}
                  onChange={(e) => setCatalogQuery(e.target.value)}
                  placeholder={tr(
                    language,
                    'Filtrer par référence ou désignation...',
                    'Filter by reference or designation...',
                    'Filter op referentie of omschrijving...'
                  )}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
                <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                  {depotCatalogProducts.map((p) => (
                    <div
                      key={p.id}
                      className="py-1.5 flex items-center justify-between gap-2"
                    >
                      <div>
                        <span className="font-mono font-bold text-orange-600 mr-2">
                          <ProductRefLink productId={p.id} reference={p.reference} />
                        </span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {p.brand} {p.model}
                        </span>
                        <span className="ml-2 text-[11px] text-slate-400 font-mono">
                          (Stock: {p.quantity})
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => addToOrderCart(p, 1)}
                        className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-orange-600 hover:text-white font-bold text-[11px] transition-colors"
                      >
                        {tr(language, '+ Ajouter', '+ Add', '+ Toevoegen')}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Current Cart */}
              <div className="space-y-2">
                <div className="font-bold text-slate-800 dark:text-slate-200">
                  {tr(language, 'Panier de la commande', 'Order cart', 'Bestelwagen')} ({orderCart.length}{' '}
                  {tr(language, 'ligne(s)', 'line(s)', 'regel(s)')})
                </div>
                {orderCart.length === 0 ? (
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-center text-slate-400">
                    {tr(language, 'Aucun article sélectionné.', 'No item selected.', 'Geen artikel geselecteerd.')}
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                    {orderCart.map((c) => (
                      <div
                        key={String(c.product_id)}
                        className="p-2.5 flex items-center justify-between gap-3 bg-white dark:bg-slate-900"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-[11px] font-bold text-orange-600">
                            <ProductRefLink productId={c.product_id} reference={c.product_ref} />
                          </div>
                          <div className="font-semibold truncate text-slate-900 dark:text-white">
                            {c.product_name}
                          </div>
                        </div>
                        <input
                          type="number"
                          min={1}
                          value={c.quantity}
                          onChange={(e) =>
                            updateOrderCartQty(
                              c.product_id,
                              Math.max(1, Number(e.target.value) || 1)
                            )
                          }
                          className="w-20 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-right font-mono font-bold"
                        />
                        <button
                          type="button"
                          onClick={() => removeFromOrderCart(c.product_id)}
                          className="p-1 text-rose-500 hover:bg-rose-50 rounded"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {tr(
                    language,
                    'Instructions / Notes de préparation',
                    'Preparation instructions / notes',
                    'Voorbereidingsinstructies / opmerkingen'
                  )}
                </label>
                <textarea
                  rows={2}
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleCloseNewOrderDrawer}
                  className="px-4 py-2 rounded-lg font-bold border border-slate-200 dark:border-slate-700"
                >
                  {t('common_cancel')}
                </button>
                <button
                  type="submit"
                  disabled={
                    orderCart.length === 0 ||
                    !orderSiteNumber.trim() ||
                    submittingOrder ||
                    writeDisabledByAuth
                  }
                  title={writeDisabledByAuth ? NO_AUTH_SESSION_BANNER_MESSAGE : undefined}
                  className="px-5 py-2 rounded-lg font-bold bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white"
                >
                  {submittingOrder
                    ? tr(language, 'Création...', 'Creating...', 'Aanmaken...')
                    : tr(language, 'Envoyer la commande', 'Submit order', 'Bestelling verzenden')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Desktop Pickup Signature Modal (v60) */}
      {desktopPickupModalOrder && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSubmittingDesktopPickup) {
              setDesktopPickupModalOrder(null);
            }
          }}
        >
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-5 space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white">
                  {tr(language, 'Émargement & Validation du Retrait', 'Signature & Pickup Confirmation')}
                </h3>
                <p className="text-[11px] font-mono text-emerald-600 font-bold">
                  {desktopPickupModalOrder.order_number} • Chantier {desktopPickupModalOrder.site_number}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDesktopPickupModalOrder(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {desktopPickupError && (
              <div
                role="alert"
                data-testid="desktop-pickup-error-toast"
                className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 font-bold"
              >
                {desktopPickupError}
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-bold text-slate-700 dark:text-slate-300">
                <span>
                  {tr(language, 'Signature obligatoire du demandeur ou délégué :', 'Required signature of requester or delegate:')}
                </span>
                <button
                  type="button"
                  onClick={clearDesktopSignature}
                  className="text-rose-600 hover:underline font-bold cursor-pointer"
                >
                  {tr(language, 'Effacer', 'Clear')}
                </button>
              </div>
              <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-950 overflow-hidden relative">
                <canvas
                  ref={desktopSigCanvasRef}
                  width={500}
                  height={160}
                  onPointerDown={handleDesktopSigPointerDown}
                  onPointerMove={handleDesktopSigPointerMove}
                  onPointerUp={handleDesktopSigPointerUp}
                  onPointerCancel={handleDesktopSigPointerUp}
                  className="w-full h-36 cursor-crosshair block touch-none"
                  style={{ touchAction: 'none' }}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                disabled={isSubmittingDesktopPickup}
                onClick={() => setDesktopPickupModalOrder(null)}
                className="px-4 py-2 rounded-lg font-bold border border-slate-200 dark:border-slate-700"
              >
                {t('common_cancel')}
              </button>
              <button
                type="button"
                data-testid="desktop-confirm-pickup-submit-btn"
                disabled={
                  isSubmittingDesktopPickup ||
                  !isValidPickupSignature(desktopSignatureData, desktopSigStrokeCount)
                }
                onClick={handleConfirmDesktopPickup}
                className="px-4 py-2 rounded-lg font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white cursor-pointer"
              >
                {isSubmittingDesktopPickup
                  ? tr(language, 'Validation...', 'Confirming...')
                  : tr(language, 'Confirmer le retrait', 'Confirm Pickup')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
