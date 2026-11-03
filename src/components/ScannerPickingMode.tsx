import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import {
  X,
  Scan,
  Package,
  MapPin,
  Warehouse,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  Zap,
  ZapOff,
  Keyboard,
  RotateCcw,
  ChevronUp,
  ChevronDown,
  Search,
  RefreshCw,
  WifiOff,
  Check,
  XCircle,
  ArrowRight,
  Volume2,
  VolumeX,
  Smartphone,
  QrCode,
  Clock,
  User,
  Lock,
  Printer,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { MaterialOrder, MaterialOrderItem, Product } from '../types';
import { PrintLabelFormat } from '../services/labelRendering';
import {
  PrintStationRecord,
  PrintJobStatus,
  rpcListPrintStations,
  rpcCreatePrintJob,
  rpcCancelPrintJob,
  rpcGetPrintJobStatus,
  getScannerSelectedStationId,
  setScannerSelectedStationId,
} from '../services/printStationService';
import {
  decodeBarcodeFromCanvas,
  openSmartphoneCameraStream,
  attachStreamToVideoElement,
} from '../utils/qrCodeHelper';
import {
  findCatalogProductByCode,
  matchScannedCodeInOrder,
  getNextItemToPick,
  getSortedOrderItemsForPicking,
  canFinishOrder,
  getOrderProgress,
  isOrderLockedForUser,
  canUserAccessScannerMode,
  filterOrdersForPreparer,
  parseOrderQrCodePayload,
  isScannerSoundEnabled,
  setScannerSoundEnabled,
  isScannerVibrationEnabled,
  setScannerVibrationEnabled,
  triggerScannerFeedback,
} from '../services/orderPickingLogic';
import {
  ScannerOfflineAction,
  ScannerOrderConflict,
  enqueueScannerOfflineAction,
  loadScannerOfflineQueue,
  replayScannerOfflineQueue,
  getScannerQueueConflicts,
  abandonOrderScannerConflict,
} from '../services/scannerOfflineQueue';

const SCAN_COOLDOWN_MS = 1500;

export const ScannerPickingMode: React.FC = () => {
  const {
    scannerPickingModeOpen,
    setScannerPickingModeOpen,
    scannerInitialOrderId,
    orders,
    products,
    depots,
    currentUser,
    isPreparer,
    userHasPermission,
    assignOrderToMe,
    validateOrderItemScanned,
    unpickOrderItem,
    updateOrderItemAvailability,
    substituteOrderItem,
    markOrderReady,
    syncFromSupabase,
    t,
  } = useApp();

  const hasOrderPrepPerm = userHasPermission('perm_menu_order_prep');
  const hasManagePerm = userHasPermission('perm_orders_manage');
  const canPrintLabels = userHasPermission('perm_menu_print_labels');
  const canAccess = canUserAccessScannerMode(currentUser, isPreparer, hasOrderPrepPerm);

  // Screen navigation: 'LIST' (Screen 1), 'PICKING' (Screen 2), 'FINISH' (Screen 3)
  const [screen, setScreen] = useState<'LIST' | 'PICKING' | 'FINISH'>('LIST');
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);

  // Screen 1 filters & Order QR scanner
  const [searchQuery, setSearchQuery] = useState('');
  const [depotFilter, setDepotFilter] = useState('ALL');
  const [orderQrScanOpen, setOrderQrScanOpen] = useState(false);
  const [orderQrManualInput, setOrderQrManualInput] = useState('');
  const [assigningOrderId, setAssigningOrderId] = useState<string | null>(null);
  const [listBanner, setListBanner] = useState<{ type: 'error' | 'warn' | 'success'; text: string } | null>(null);

  // Screen 2 picking states
  const [skippedProductIds, setSkippedProductIds] = useState<Array<string | number>>([]);
  const [forcedProductId, setForcedProductId] = useState<string | number | null>(null);
  const [lastPickedProductId, setLastPickedProductId] = useState<string | number | null>(null);
  const [allLinesDrawerOpen, setAllLinesDrawerOpen] = useState(false);

  // Scan flash & banners on Screen 2
  const [scanFlash, setScanFlash] = useState<'green' | 'orange' | 'red' | null>(null);
  const [scanBanner, setScanBanner] = useState<{
    type: 'success' | 'warn' | 'error';
    text: string;
    otherLineItem?: MaterialOrderItem;
    substituteCandidate?: Product;
  } | null>(null);

  // Quantity confirmation & partial confirmation modals
  const [qtyPrompt, setQtyPrompt] = useState<{
    item: MaterialOrderItem;
    scannedCode: string;
    qty: number;
    confirmPartial: boolean;
  } | null>(null);

  // Missing reason prompt
  const [missingPrompt, setMissingPrompt] = useState<{
    item: MaterialOrderItem;
    reason: string;
  } | null>(null);

  // Replace / Substitute modal
  const [replacePrompt, setReplacePrompt] = useState<{
    item: MaterialOrderItem;
    query: string;
  } | null>(null);

  // Manual code entry input
  const [manualInputOpen, setManualInputOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');

  // Quit confirmation dialog
  const [quitConfirmOpen, setQuitConfirmOpen] = useState(false);

  // Screen 3 (Finish order) states
  const [pickupZone, setPickupZone] = useState('Étagère A1');
  const [submittingReady, setSubmittingReady] = useState(false);
  const [readyQrUrl, setReadyQrUrl] = useState<string | null>(null);
  const [orderMarkedReady, setOrderMarkedReady] = useState(false);

  // v30 Remote Label Printing states
  const [printStations, setPrintStations] = useState<PrintStationRecord[]>([]);
  const [selectedStationId, setSelectedStationIdState] = useState<string>(
    () => getScannerSelectedStationId() || ''
  );
  const [printOrderLabelChecked, setPrintOrderLabelChecked] = useState<boolean>(true);
  const [productPrintPrompt, setProductPrintPrompt] = useState<{
    item: MaterialOrderItem;
    copies: number;
    format: PrintLabelFormat;
  } | null>(null);
  const [sendingPrintJob, setSendingPrintJob] = useState(false);
  const [activePrintBanner, setActivePrintBanner] = useState<{
    jobId?: string;
    stationName: string;
    status: PrintJobStatus | 'OFFLINE_REFUSED' | 'ERROR';
    error?: string;
    retryAction?: () => void;
  } | null>(null);

  // Camera & Torch refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const lastScannedCodeRef = useRef<{ code: string; ts: number }>({ code: '', ts: 0 });
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [hasTorch, setHasTorch] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);

  // Sound & Vibration per-device state
  const [soundOn, setSoundOn] = useState<boolean>(() => isScannerSoundEnabled());
  const [vibOn, setVibOn] = useState<boolean>(() => isScannerVibrationEnabled());

  // Offline & Queue state (Lot 2)
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true
  );
  const [offlineQueue, setOfflineQueue] = useState<ScannerOfflineAction[]>([]);
  const [conflicts, setConflicts] = useState<ScannerOrderConflict[]>([]);
  const [syncingOfflineQueue, setSyncingOfflineQueue] = useState(false);

  const refreshOfflineQueueState = useCallback(async () => {
    const q = await loadScannerOfflineQueue();
    setOfflineQueue(q);
    const c = await getScannerQueueConflicts();
    setConflicts(c);
  }, []);

  useEffect(() => {
    if (!scannerPickingModeOpen) return;
    refreshOfflineQueueState();
    const handleQueueChange = () => {
      refreshOfflineQueueState();
    };
    window.addEventListener('tot-scanner-queue-changed', handleQueueChange);
    return () => window.removeEventListener('tot-scanner-queue-changed', handleQueueChange);
  }, [scannerPickingModeOpen, refreshOfflineQueueState]);

  // Initialize initial order if passed via openScannerPickingMode(orderId)
  useEffect(() => {
    if (!scannerPickingModeOpen) return;
    if (scannerInitialOrderId) {
      const target = orders.find((o) => o.id === scannerInitialOrderId);
      if (target) {
        setActiveOrderId(target.id);
        setScreen(canFinishOrder(target) ? 'FINISH' : 'PICKING');
        return;
      }
    }
    setActiveOrderId(null);
    setScreen('LIST');
  }, [scannerPickingModeOpen, scannerInitialOrderId]);

  // Wake Lock management: keep screen awake while Scanner Mode is open
  useEffect(() => {
    if (!scannerPickingModeOpen) {
      setWakeLockActive(false);
      return;
    }
    let wakeLockSentinel: any = null;
    let cancelled = false;

    const requestWakeLock = async () => {
      try {
        if (typeof navigator !== 'undefined' && 'wakeLock' in navigator && (navigator as any).wakeLock?.request) {
          wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
          if (!cancelled) setWakeLockActive(true);
        }
      } catch {
        if (!cancelled) setWakeLockActive(false);
      }
    };

    requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && scannerPickingModeOpen) {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLockSentinel && typeof wakeLockSentinel.release === 'function') {
        wakeLockSentinel.release().catch(() => {});
      }
    };
  }, [scannerPickingModeOpen]);

  // Replay offline queue automatically when network returns
  const handleReplayOfflineQueue = useCallback(async () => {
    if (syncingOfflineQueue) return;
    const currentQueue = await loadScannerOfflineQueue();
    if (currentQueue.length === 0) return;

    setSyncingOfflineQueue(true);
    try {
      await syncFromSupabase();
      const ordersById = new Map<string, MaterialOrder>();
      orders.forEach((o) => ordersById.set(o.id, o));

      await replayScannerOfflineQueue({
        fetchRemoteOrder: async (orderId: string) => ordersById.get(orderId) || null,
        persistUpdatedOrder: async (_updatedOrder: MaterialOrder, action: ScannerOfflineAction) => {
          const { action_type, payload, order_id } = action;
          if (action_type === 'PICK_ITEM') {
            const res = validateOrderItemScanned(
              order_id,
              payload.product_id,
              payload.picked_quantity || 1,
              payload.scanned_barcode || ''
            );
            return { success: res.success, error: res.message };
          }
          if (action_type === 'MARK_UNAVAILABLE') {
            updateOrderItemAvailability(
              order_id,
              payload.product_id,
              true,
              payload.unavailable_comment || ''
            );
            return { success: true };
          }
          if (action_type === 'SUBSTITUTE_ITEM' && payload.substitute_product) {
            const subProd = products.find(
              (p) => String(p.id) === String(payload.substitute_product?.id)
            );
            if (!subProd) return { success: false, error: 'Substitute product not found' };
            const res = await substituteOrderItem(
              order_id,
              payload.product_id,
              subProd,
              payload.substitute_reason || ''
            );
            return { success: res.success, error: res.message };
          }
          if (action_type === 'UNPICK_ITEM') {
            unpickOrderItem(order_id, payload.product_id);
            return { success: true };
          }
          return { success: true };
        },
      });
      await refreshOfflineQueueState();
    } finally {
      setSyncingOfflineQueue(false);
    }
  }, [
    syncingOfflineQueue,
    syncFromSupabase,
    orders,
    validateOrderItemScanned,
    updateOrderItemAvailability,
    products,
    substituteOrderItem,
    unpickOrderItem,
    refreshOfflineQueueState,
  ]);

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      handleReplayOfflineQueue();
    };
    const onOffline = () => {
      setIsOnline(false);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [handleReplayOfflineQueue]);

  // Active order object
  const activeOrder = useMemo(
    () => orders.find((o) => o.id === activeOrderId) || null,
    [orders, activeOrderId]
  );

  // Allowed depots for filter
  const userAllowedDepots = useMemo(() => {
    if (!currentUser) return [];
    const isSuper =
      Number(currentUser.id) === 0 ||
      Number(currentUser.role_id) === 0 ||
      Number(currentUser.role_id) === 1;
    if (isSuper) return depots.map((d) => d.name);
    if (Array.isArray(currentUser.allowed_depots) && currentUser.allowed_depots.length > 0) {
      return currentUser.allowed_depots;
    }
    return depots.map((d) => d.name);
  }, [currentUser, depots]);

  // Filtered and sorted orders for Screen 1
  const preparerOrders = useMemo(
    () =>
      filterOrdersForPreparer(orders, currentUser, {
        searchQuery,
        depotFilter,
      }),
    [orders, currentUser, searchQuery, depotFilter]
  );

  // Next item to pick on Screen 2
  const currentPickingItem = useMemo(() => {
    if (!activeOrder) return null;
    if (forcedProductId !== null) {
      const forced = activeOrder.items.find(
        (it) => String(it.product_id) === String(forcedProductId) && !it.picked && !it.unavailable
      );
      if (forced) return forced;
    }
    return getNextItemToPick(activeOrder, {
      strategy: 'rack_location',
      products,
      skippedProductIds,
    });
  }, [activeOrder, forcedProductId, products, skippedProductIds]);

  const sortedOrderItems = useMemo(() => {
    if (!activeOrder) return [];
    return getSortedOrderItemsForPicking(activeOrder, {
      strategy: 'rack_location',
      products,
      skippedProductIds,
    });
  }, [activeOrder, products, skippedProductIds]);

  const currentCatalogProduct = useMemo(() => {
    if (!currentPickingItem) return undefined;
    return products.find((p) => String(p.id) === String(currentPickingItem.product_id));
  }, [currentPickingItem, products]);

  const progress = useMemo(() => getOrderProgress(activeOrder), [activeOrder]);

  // Generate QR preview when entering Screen 3
  useEffect(() => {
    if (screen === 'FINISH' && activeOrder) {
      const payload = activeOrder.ready_qr_code || `TOT-ORDER:${activeOrder.order_number}`;
      QRCode.toDataURL(payload, { width: 260, margin: 2 })
        .then((url) => setReadyQrUrl(url))
        .catch(() => setReadyQrUrl(null));

      const depotObj = depots.find(
        (d) => d.name.toLowerCase().trim() === (activeOrder.depot_name || '').toLowerCase().trim()
      );
      const zones =
        depotObj?.pickup_zones && depotObj.pickup_zones.length > 0
          ? depotObj.pickup_zones
          : [
              t('scanner_mode_pickup_zone_preset_1'),
              t('scanner_mode_pickup_zone_preset_2'),
              t('scanner_mode_pickup_zone_preset_3'),
            ];
      setPickupZone(activeOrder.pickup_zone || zones[0] || t('scanner_mode_pickup_zone_preset_1'));
      setOrderMarkedReady(activeOrder.status === 'READY');
      const hasOnlineStation = printStations.some(
        (s) => (selectedStationId ? s.id === selectedStationId : true) && s.is_online
      );
      setPrintOrderLabelChecked(hasOnlineStation);
    }
  }, [screen, activeOrder, depots, t, printStations, selectedStationId]);

  // Load and refresh available print stations when Scanner Mode is open
  const refreshPrintStations = useCallback(async () => {
    if (!scannerPickingModeOpen || !canPrintLabels || !isOnline) return;
    const res = await rpcListPrintStations();
    if (!res.error) {
      setPrintStations(res.stations);
      const savedId = getScannerSelectedStationId();
      const exists = res.stations.find((s) => s.id === savedId);
      if (exists) {
        setSelectedStationIdState(exists.id);
      } else if (res.stations.length > 0) {
        const preferred = res.stations.find((s) => s.is_online) || res.stations[0];
        setSelectedStationIdState(preferred.id);
        setScannerSelectedStationId(preferred.id);
      }
    }
  }, [scannerPickingModeOpen, canPrintLabels, isOnline]);

  useEffect(() => {
    if (!scannerPickingModeOpen || !canPrintLabels) return;
    refreshPrintStations();
    const timer = window.setInterval(refreshPrintStations, 15000);
    return () => window.clearInterval(timer);
  }, [scannerPickingModeOpen, canPrintLabels, refreshPrintStations]);

  // Poll active print job status until DONE / FAILED / CANCELLED
  useEffect(() => {
    if (!scannerPickingModeOpen || !activePrintBanner?.jobId || !isOnline) return;
    if (activePrintBanner.status !== 'PENDING' && activePrintBanner.status !== 'PRINTING') {
      return;
    }
    const jobId = activePrintBanner.jobId;
    const interval = window.setInterval(async () => {
      const res = await rpcGetPrintJobStatus(jobId);
      if (!res.error && res.status) {
        setActivePrintBanner((prev) =>
          prev && prev.jobId === jobId
            ? {
                ...prev,
                status: res.status!,
                error: res.errorText || undefined,
              }
            : prev
        );
      }
    }, 3000);
    return () => window.clearInterval(interval);
  }, [scannerPickingModeOpen, activePrintBanner?.jobId, activePrintBanner?.status, isOnline]);

  const selectedStation = useMemo(
    () => printStations.find((s) => s.id === selectedStationId) || null,
    [printStations, selectedStationId]
  );

  // Send product label print job to selected station
  const handleSendProductPrintJob = useCallback(
    async (item: MaterialOrderItem, copies: number, format: PrintLabelFormat) => {
      const station = printStations.find((s) => s.id === selectedStationId);
      if (!station) return;

      if (!isOnline) {
        // Strict rule: never queue print jobs offline
        setProductPrintPrompt(null);
        setActivePrintBanner({
          stationName: station.name,
          status: 'OFFLINE_REFUSED',
          retryAction: () => handleSendProductPrintJob(item, copies, format),
        });
        return;
      }

      setSendingPrintJob(true);
      try {
        const res = await rpcCreatePrintJob({
          stationId: station.id,
          kind: 'product_label',
          format,
          copies: Math.max(1, Math.min(100, Math.round(copies || 1))),
          payload: {
            product_id: String(item.substituted_with_id || item.product_id),
            product_ref: String(item.substituted_with_ref || item.product_ref || '').slice(0, 80),
          },
        });
        setProductPrintPrompt(null);
        if (res.jobId && !res.error) {
          triggerScannerFeedback('success');
          setActivePrintBanner({
            jobId: res.jobId,
            stationName: station.name,
            status: 'PENDING',
          });
        } else {
          triggerScannerFeedback('error');
          setActivePrintBanner({
            stationName: station.name,
            status: 'ERROR',
            error: res.error || 'Error',
          });
        }
      } finally {
        setSendingPrintJob(false);
      }
    },
    [printStations, selectedStationId, isOnline]
  );

  // Send order ready label print job to selected station (with dedupe_key = 'order:' + order_number)
  const handleSendOrderPrintJob = useCallback(
    async (order: MaterialOrder, zone: string) => {
      const station = printStations.find((s) => s.id === selectedStationId);
      if (!station) return;

      if (!isOnline) {
        setActivePrintBanner({
          stationName: station.name,
          status: 'OFFLINE_REFUSED',
          retryAction: () => handleSendOrderPrintJob(order, zone),
        });
        return;
      }

      setSendingPrintJob(true);
      try {
        const res = await rpcCreatePrintJob({
          stationId: station.id,
          kind: 'order_label',
          format: 'bin_90x50',
          copies: 1,
          dedupeKey: `order:${order.order_number}`,
          payload: {
            order_id: String(order.id).slice(0, 80),
            order_number: String(order.order_number || '').slice(0, 80),
            site_number: String(order.site_number || '').slice(0, 80),
            site_name: String(order.site_name || '').slice(0, 120),
            requester_name: String(order.requester_name || '').slice(0, 120),
            pickup_zone: String(zone || order.pickup_zone || '').slice(0, 120),
            depot_name: String(order.depot_name || '').slice(0, 80),
          },
        });

        if (res.jobId && !res.error) {
          setActivePrintBanner({
            jobId: res.jobId,
            stationName: station.name,
            status: 'PENDING',
          });
        } else {
          setActivePrintBanner({
            stationName: station.name,
            status: 'ERROR',
            error: res.error || 'Error',
          });
        }
      } finally {
        setSendingPrintJob(false);
      }
    },
    [printStations, selectedStationId, isOnline]
  );

  // Cancel a PENDING print job
  const handleCancelActivePrintJob = useCallback(async () => {
    if (!activePrintBanner?.jobId) return;
    const res = await rpcCancelPrintJob(activePrintBanner.jobId);
    if (!res.error) {
      setActivePrintBanner((prev) => (prev ? { ...prev, status: 'CANCELLED' } : null));
    }
  }, [activePrintBanner?.jobId]);

  const stopCamera = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    setTorchEnabled(false);
    setHasTorch(false);
  }, []);

  const toggleTorch = useCallback(async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;
    try {
      const next = !torchEnabled;
      // @ts-expect-error torch constraint
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchEnabled(next);
    } catch {
      // ignore if unsupported
    }
  }, [torchEnabled]);

  const triggerVisualFlash = useCallback((color: 'green' | 'orange' | 'red') => {
    setScanFlash(color);
    setTimeout(() => {
      setScanFlash((prev) => (prev === color ? null : prev));
    }, 650);
  }, []);

  // Confirm picking an item (online + offline queue support)
  const handleConfirmItemPick = useCallback(
    async (item: MaterialOrderItem, pickedQuantity: number, scannedCode: string) => {
      if (!activeOrder || !currentUser) return;

      const res = validateOrderItemScanned(
        activeOrder.id,
        item.product_id,
        pickedQuantity,
        scannedCode || item.product_ref
      );

      if (!isOnline) {
        await enqueueScannerOfflineAction({
          order_id: activeOrder.id,
          order_number: activeOrder.order_number,
          user_id: currentUser.id,
          action_type: 'PICK_ITEM',
          payload: {
            product_id: item.product_id,
            product_ref: item.product_ref,
            picked_quantity: pickedQuantity,
            scanned_barcode: scannedCode || item.product_ref,
          },
        });
      }

      if (res.success || !isOnline) {
        setLastPickedProductId(item.product_id);
        setForcedProductId(null);
        setQtyPrompt(null);
        setScanBanner({
          type: 'success',
          text: `${item.product_name} (${pickedQuantity} ${item.unit || 'pcs'})`,
        });

        const remainingAfter = activeOrder.items.filter(
          (it) =>
            String(it.product_id) !== String(item.product_id) && !it.picked && !it.unavailable
        );
        if (remainingAfter.length === 0) {
          setTimeout(() => {
            setScreen('FINISH');
          }, 350);
        }
      } else {
        triggerScannerFeedback('error');
        setScanBanner({ type: 'error', text: res.message });
      }
    },
    [activeOrder, currentUser, validateOrderItemScanned, isOnline]
  );

  // Process a scanned code in Screen 2 (Picking) or Screen 1 (Order QR)
  const handleScannedCode = useCallback(
    (rawCode: string, fromCamera: boolean = false) => {
      const code = rawCode.trim();
      if (!code) return;

      if (fromCamera) {
        const now = Date.now();
        if (
          lastScannedCodeRef.current.code.toLowerCase() === code.toLowerCase() &&
          now - lastScannedCodeRef.current.ts < SCAN_COOLDOWN_MS
        ) {
          return;
        }
        lastScannedCodeRef.current = { code, ts: now };
      }

      // Screen 1: scanning TOT-ORDER:<order_number>
      if (screen === 'LIST') {
        const parsedOrderNumber = parseOrderQrCodePayload(code);
        const searchTarget = (parsedOrderNumber || code).toLowerCase();
        const foundOrder = preparerOrders.find(
          (o) =>
            o.order_number.toLowerCase() === searchTarget ||
            String(o.id).toLowerCase() === searchTarget
        );
        if (foundOrder) {
          triggerScannerFeedback('success');
          setOrderQrScanOpen(false);
          setOrderQrManualInput('');
          if (isOrderLockedForUser(foundOrder, currentUser, hasManagePerm)) {
            setListBanner({
              type: 'error',
              text: `${t('scanner_mode_locked_by_other')} (${foundOrder.preparer_name || ''})`,
            });
            return;
          }
          setActiveOrderId(foundOrder.id);
          setScreen(canFinishOrder(foundOrder) ? 'FINISH' : 'PICKING');
        } else {
          triggerScannerFeedback('error');
          setListBanner({
            type: 'error',
            text: `${t('scanner_mode_unknown_code_msg')} « ${code} »`,
          });
        }
        return;
      }

      // Screen 2: Picking item scan
      if (screen !== 'PICKING' || !activeOrder) return;

      if (isOrderLockedForUser(activeOrder, currentUser, hasManagePerm)) {
        triggerScannerFeedback('error');
        triggerVisualFlash('red');
        setScanBanner({
          type: 'error',
          text: `${t('scanner_mode_locked_by_other')} (${activeOrder.preparer_name || ''})`,
        });
        return;
      }

      if (replacePrompt) {
        const subProd = findCatalogProductByCode(code, products);
        if (subProd) {
          triggerScannerFeedback('success');
          setReplacePrompt({ ...replacePrompt, query: subProd.reference });
        } else {
          triggerScannerFeedback('error');
        }
        return;
      }

      const matchResult = matchScannedCodeInOrder(
        activeOrder,
        code,
        products,
        currentPickingItem
      );

      if (matchResult.kind === 'expected_item' && matchResult.matchedItem) {
        triggerScannerFeedback('success');
        triggerVisualFlash('green');
        const item = matchResult.matchedItem;
        if (item.quantity <= 1) {
          handleConfirmItemPick(item, 1, code);
        } else {
          setQtyPrompt({
            item,
            scannedCode: code,
            qty: item.quantity,
            confirmPartial: false,
          });
        }
        return;
      }

      if (matchResult.kind === 'other_order_item' && matchResult.matchedItem) {
        triggerScannerFeedback('error');
        triggerVisualFlash('orange');
        setScanBanner({
          type: 'warn',
          text: `${t('scanner_mode_other_line_msg')} : ${matchResult.matchedItem.product_name} (${matchResult.matchedItem.product_ref})`,
          otherLineItem: matchResult.matchedItem,
        });
        return;
      }

      if (matchResult.kind === 'already_picked_item' && matchResult.matchedItem) {
        triggerScannerFeedback('error');
        triggerVisualFlash('orange');
        setScanBanner({
          type: 'warn',
          text: `${t('scanner_mode_already_picked_msg')} : ${matchResult.matchedItem.product_name}`,
        });
        return;
      }

      if (matchResult.kind === 'catalog_substitute_candidate' && matchResult.catalogProduct) {
        triggerScannerFeedback('error');
        triggerVisualFlash('red');
        setScanBanner({
          type: 'error',
          text: `${t('scanner_mode_wrong_item_msg')} ${matchResult.catalogProduct.model || matchResult.catalogProduct.reference} (${matchResult.catalogProduct.reference})`,
          substituteCandidate: matchResult.catalogProduct,
        });
        return;
      }

      triggerScannerFeedback('error');
      triggerVisualFlash('red');
      setScanBanner({
        type: 'error',
        text: `${t('scanner_mode_unknown_code_msg')} « ${code} »`,
      });
    },
    [
      screen,
      preparerOrders,
      currentUser,
      hasManagePerm,
      t,
      activeOrder,
      replacePrompt,
      products,
      currentPickingItem,
      triggerVisualFlash,
      handleConfirmItemPick,
    ]
  );

  const handleScannedCodeRef = useRef(handleScannedCode);
  useEffect(() => {
    handleScannedCodeRef.current = handleScannedCode;
  }, [handleScannedCode]);

  const shouldCameraBeActive =
    scannerPickingModeOpen &&
    ((screen === 'PICKING' &&
      Boolean(currentPickingItem) &&
      !qtyPrompt &&
      !missingPrompt &&
      !productPrintPrompt) ||
      (screen === 'LIST' && orderQrScanOpen));

  useEffect(() => {
    if (!shouldCameraBeActive) {
      stopCamera();
      return;
    }

    let isSubscribed = true;
    let nativeDetector: any = null;
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        // @ts-expect-error BarcodeDetector
        nativeDetector = new window.BarcodeDetector({
          formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e'],
        });
      } catch {
        nativeDetector = null;
      }
    }

    setCameraError(null);
    openSmartphoneCameraStream()
      .then(async (stream) => {
        if (!isSubscribed) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        if (track && typeof track.getCapabilities === 'function') {
          const caps = track.getCapabilities() as any;
          if (caps && caps.torch) setHasTorch(true);
        }

        if (videoRef.current) {
          await attachStreamToVideoElement(videoRef.current, stream);
        }

        const scanLoop = async () => {
          if (!isSubscribed) return;
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (video && canvas && video.readyState >= 2) {
            if (nativeDetector) {
              try {
                const barcodes = await nativeDetector.detect(video);
                if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                  handleScannedCodeRef.current(barcodes[0].rawValue, true);
                }
              } catch {
                // fallback
              }
            }

            const w = video.videoWidth || 640;
            const h = video.videoHeight || 480;
            if (w > 0 && h > 0) {
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                ctx.drawImage(video, 0, 0, w, h);
                const imgData = ctx.getImageData(0, 0, w, h);
                const qr = jsQR(imgData.data, w, h, { inversionAttempts: 'dontInvert' });
                if (qr && qr.data) {
                  handleScannedCodeRef.current(qr.data, true);
                } else {
                  const barcode1d = await decodeBarcodeFromCanvas(canvas);
                  if (barcode1d) {
                    handleScannedCodeRef.current(barcode1d, true);
                  }
                }
              }
            }
          }
          if (isSubscribed) {
            animFrameRef.current = requestAnimationFrame(scanLoop);
          }
        };

        animFrameRef.current = requestAnimationFrame(scanLoop);
      })
      .catch((err) => {
        if (!isSubscribed) return;
        setCameraError(err?.message || 'Camera unavailable');
      });

    return () => {
      isSubscribed = false;
      stopCamera();
    };
  }, [shouldCameraBeActive, stopCamera]);

  if (!scannerPickingModeOpen || !canAccess) return null;

  const pendingActionsCount = offlineQueue.filter(
    (a) => a.status === 'pending' || a.status === 'syncing'
  ).length;

  // Handle "Prendre en charge" on Screen 1
  const handleTakeCharge = async (order: MaterialOrder) => {
    setListBanner(null);
    if (!isOnline) {
      setListBanner({
        type: 'warn',
        text: t('scanner_mode_take_charge_offline_disabled'),
      });
      return;
    }

    setAssigningOrderId(order.id);
    try {
      await syncFromSupabase();
      const fresh = orders.find((o) => o.id === order.id);
      if (fresh && isOrderLockedForUser(fresh, currentUser, hasManagePerm)) {
        triggerScannerFeedback('error');
        setListBanner({
          type: 'error',
          text: t('scanner_mode_already_taken_msg'),
        });
        return;
      }

      const res = await assignOrderToMe(order.id);
      if (!res.success) {
        triggerScannerFeedback('error');
        setListBanner({
          type: 'error',
          text: res.message || t('scanner_mode_already_taken_msg'),
        });
        await syncFromSupabase();
        return;
      }

      triggerScannerFeedback('success');
      setActiveOrderId(order.id);
      setSkippedProductIds([]);
      setForcedProductId(null);
      setScreen(canFinishOrder(order) ? 'FINISH' : 'PICKING');
    } finally {
      setAssigningOrderId(null);
    }
  };

  // Handle marking current item as missing
  const handleConfirmMissing = async () => {
    if (!activeOrder || !missingPrompt || !currentUser) return;
    const { item, reason } = missingPrompt;
    updateOrderItemAvailability(
      activeOrder.id,
      item.product_id,
      true,
      reason.trim() || 'Rupture constatée au picking'
    );

    if (!isOnline) {
      await enqueueScannerOfflineAction({
        order_id: activeOrder.id,
        order_number: activeOrder.order_number,
        user_id: currentUser.id,
        action_type: 'MARK_UNAVAILABLE',
        payload: {
          product_id: item.product_id,
          product_ref: item.product_ref,
          unavailable: true,
          unavailable_comment: reason.trim() || 'Rupture constatée au picking',
        },
      });
    }

    setMissingPrompt(null);
    setForcedProductId(null);
    triggerScannerFeedback('error');

    const remainingAfter = activeOrder.items.filter(
      (it) =>
        String(it.product_id) !== String(item.product_id) && !it.picked && !it.unavailable
    );
    if (remainingAfter.length === 0) {
      setTimeout(() => setScreen('FINISH'), 300);
    }
  };

  // Handle substituting current item
  const handleConfirmSubstitute = async (targetItem: MaterialOrderItem, subProduct: Product) => {
    if (!activeOrder || !currentUser) return;
    const res = await substituteOrderItem(
      activeOrder.id,
      targetItem.product_id,
      subProduct,
      'Remplacement en Mode Scanner'
    );

    if (!isOnline) {
      await enqueueScannerOfflineAction({
        order_id: activeOrder.id,
        order_number: activeOrder.order_number,
        user_id: currentUser.id,
        action_type: 'SUBSTITUTE_ITEM',
        payload: {
          product_id: targetItem.product_id,
          product_ref: targetItem.product_ref,
          substitute_product: {
            id: subProduct.id,
            reference: subProduct.reference,
            brand: subProduct.brand,
            model: subProduct.model,
          },
          substitute_reason: 'Remplacement en Mode Scanner',
        },
      });
    }

    if (res.success || !isOnline) {
      triggerScannerFeedback('success');
      setReplacePrompt(null);
      setScanBanner({
        type: 'success',
        text: `${targetItem.product_ref} → ${subProduct.reference}`,
      });
    } else {
      triggerScannerFeedback('error');
      setScanBanner({ type: 'error', text: res.message });
    }
  };

  // Handle Undo last pick
  const handleUndoLastPick = async () => {
    if (!activeOrder || lastPickedProductId === null || !currentUser) return;
    unpickOrderItem(activeOrder.id, lastPickedProductId);
    if (!isOnline) {
      await enqueueScannerOfflineAction({
        order_id: activeOrder.id,
        order_number: activeOrder.order_number,
        user_id: currentUser.id,
        action_type: 'UNPICK_ITEM',
        payload: {
          product_id: lastPickedProductId,
        },
      });
    }
    setForcedProductId(lastPickedProductId);
    setLastPickedProductId(null);
    triggerScannerFeedback('error');
  };

  // Handle "Commande prête" on Screen 3
  const handleMarkOrderReady = async () => {
    if (!activeOrder) return;
    if (!canFinishOrder(activeOrder)) return;
    if (!isOnline || pendingActionsCount > 0) return;

    setSubmittingReady(true);
    try {
      const effectiveZone = pickupZone.trim() || 'Étagère A1';
      const res = await markOrderReady(activeOrder.id, effectiveZone);
      if (res.success) {
        triggerScannerFeedback('success');
        setOrderMarkedReady(true);
        if (canPrintLabels && printOrderLabelChecked && selectedStationId) {
          await handleSendOrderPrintJob(activeOrder, effectiveZone);
        }
      } else {
        triggerScannerFeedback('error');
        setScanBanner({ type: 'error', text: res.message });
      }
    } finally {
      setSubmittingReady(false);
    }
  };

  const handleRequestQuit = () => {
    if (screen === 'PICKING' && activeOrder) {
      setQuitConfirmOpen(true);
    } else {
      stopCamera();
      setScannerPickingModeOpen(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[65] bg-slate-950 text-white flex flex-col select-none overflow-hidden">
      {/* Visual Scan Flash Overlay */}
      {scanFlash && (
        <div
          className={`pointer-events-none fixed inset-0 z-[75] transition-opacity duration-300 ${
            scanFlash === 'green'
              ? 'bg-emerald-500/35'
              : scanFlash === 'orange'
              ? 'bg-amber-500/35'
              : 'bg-rose-600/40'
          }`}
        />
      )}

      {/* Top Bar */}
      <header className="px-3 py-2.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {screen !== 'LIST' && (
            <button
              type="button"
              onClick={() => {
                setScreen('LIST');
                setActiveOrderId(null);
                setScanBanner(null);
              }}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer active:scale-95"
              title={t('scanner_mode_screen1_title')}
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
            <Scan className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-black tracking-tight truncate">
                {t('scanner_mode_title')}
              </h1>
              {wakeLockActive && (
                <span className="hidden sm:inline-block px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700/50 text-[9px] font-bold">
                  {t('scanner_mode_wakelock_active')}
                </span>
              )}
            </div>
            {/* Offline / Sync Status Indicator */}
            <div className="flex items-center gap-1.5 text-[10px]">
              {!isOnline || pendingActionsCount > 0 ? (
                <span className="text-amber-400 font-bold flex items-center gap-1">
                  <WifiOff className="w-3 h-3" />
                  <span>
                    {t('scanner_mode_offline_badge')} — {pendingActionsCount}{' '}
                    {t('scanner_mode_pending_actions')}
                  </span>
                </span>
              ) : (
                <span className="text-emerald-400 font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>{t('scanner_mode_synced_badge')}</span>
                </span>
              )}
              {isOnline && pendingActionsCount > 0 && (
                <button
                  type="button"
                  onClick={handleReplayOfflineQueue}
                  disabled={syncingOfflineQueue}
                  className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-400/40 text-amber-300 font-black hover:bg-amber-500/30 cursor-pointer"
                >
                  {syncingOfflineQueue ? '...' : t('scanner_mode_sync_now_btn')}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right Controls: Sound, Vibration, Quit */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              const next = !soundOn;
              setSoundOn(next);
              setScannerSoundEnabled(next);
              if (next) triggerScannerFeedback('success');
            }}
            className={`p-2 rounded-xl border transition cursor-pointer ${
              soundOn
                ? 'bg-slate-800 border-emerald-500/40 text-emerald-400'
                : 'bg-slate-900 border-slate-800 text-slate-500'
            }`}
            title={t('profile_scanner_sound')}
          >
            {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={() => {
              const next = !vibOn;
              setVibOn(next);
              setScannerVibrationEnabled(next);
              if (next) triggerScannerFeedback('success');
            }}
            className={`p-2 rounded-xl border transition cursor-pointer ${
              vibOn
                ? 'bg-slate-800 border-emerald-500/40 text-emerald-400'
                : 'bg-slate-900 border-slate-800 text-slate-500'
            }`}
            title={t('profile_scanner_vibration')}
          >
            <Smartphone className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleRequestQuit}
            className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-black text-xs flex items-center gap-1 cursor-pointer active:scale-95"
          >
            <X className="w-4 h-4" />
            <span>{t('scanner_mode_quit')}</span>
          </button>
        </div>
      </header>

      {/* v30 Remote Print Station Selector & Active Print Job Feedback Bar */}
      {canPrintLabels && (
        <div className="px-3 py-2 bg-slate-900/95 border-b border-slate-800 flex flex-col gap-1.5 shrink-0">
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <Printer className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="font-bold text-slate-300 shrink-0">
                {t('scanner_print_station_label')}
              </span>
              {printStations.length === 0 ? (
                <span className="text-[11px] font-semibold text-amber-300 truncate">
                  {t('scanner_print_no_station')}
                </span>
              ) : (
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      selectedStation?.is_online ? 'bg-emerald-400' : 'bg-slate-500'
                    }`}
                    title={
                      selectedStation?.is_online
                        ? t('print_station_online_badge')
                        : t('print_station_offline_badge')
                    }
                  />
                  <select
                    value={selectedStationId}
                    onChange={(e) => {
                      setSelectedStationIdState(e.target.value);
                      setScannerSelectedStationId(e.target.value);
                    }}
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs font-bold text-white outline-none focus:border-emerald-500 max-w-[220px] truncate cursor-pointer"
                  >
                    {printStations.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.is_online ? '● ' : '○ '}
                        {st.name}
                        {st.depot_name ? ` (${st.depot_name})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={refreshPrintStations}
              disabled={!isOnline}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 cursor-pointer shrink-0"
              title="Actualiser les postes"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Active Print Job Status Banner */}
          {activePrintBanner && (
            <div
              className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-bold flex items-center justify-between gap-2 ${
                activePrintBanner.status === 'DONE'
                  ? 'bg-emerald-950/80 border-emerald-600/60 text-emerald-200'
                  : activePrintBanner.status === 'PENDING' ||
                    activePrintBanner.status === 'PRINTING'
                  ? 'bg-sky-950/80 border-sky-600/60 text-sky-200'
                  : activePrintBanner.status === 'OFFLINE_REFUSED'
                  ? 'bg-amber-950/80 border-amber-600/60 text-amber-200'
                  : 'bg-rose-950/80 border-rose-600/60 text-rose-200'
              }`}
            >
              <div className="min-w-0 flex-1 truncate">
                {activePrintBanner.status === 'PENDING' ||
                activePrintBanner.status === 'PRINTING' ? (
                  <span>
                    {t('scanner_print_sent_status')} <strong>{activePrintBanner.stationName}</strong>
                  </span>
                ) : activePrintBanner.status === 'DONE' ? (
                  <span>✓ {t('scanner_print_done_status')}</span>
                ) : activePrintBanner.status === 'CANCELLED' ? (
                  <span>{t('scanner_print_cancelled_status')}</span>
                ) : activePrintBanner.status === 'OFFLINE_REFUSED' ? (
                  <span>{t('scanner_print_offline_unavailable')}</span>
                ) : (
                  <span>
                    {t('scanner_print_failed_status')} : {activePrintBanner.error || ''}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {activePrintBanner.status === 'PENDING' && activePrintBanner.jobId && (
                  <button
                    type="button"
                    onClick={handleCancelActivePrintJob}
                    className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-black text-[10px] cursor-pointer"
                  >
                    {t('scanner_print_cancel_job_btn')}
                  </button>
                )}
                {activePrintBanner.status === 'OFFLINE_REFUSED' &&
                  isOnline &&
                  activePrintBanner.retryAction && (
                    <button
                      type="button"
                      onClick={activePrintBanner.retryAction}
                      className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[10px] cursor-pointer"
                    >
                      {t('scanner_print_retry_online_btn')}
                    </button>
                  )}
                <button
                  type="button"
                  onClick={() => setActivePrintBanner(null)}
                  className="text-slate-400 hover:text-white p-0.5 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lot 2: Sync Conflicts Banner */}
      {conflicts.length > 0 && (
        <div className="px-3 py-2 bg-rose-950/90 border-b border-rose-700 space-y-2 shrink-0">
          {conflicts.map((c) => {
            const reasonText =
              c.reason === 'ORDER_CANCELLED'
                ? t('scanner_mode_conflict_cancelled')
                : c.reason === 'TAKEN_BY_OTHER'
                ? `${t('scanner_mode_conflict_taken_by_other')} (${c.remotePreparerName || ''})`
                : t('scanner_mode_conflict_already_ready');
            return (
              <div
                key={c.order_id}
                className="p-2.5 rounded-xl bg-rose-900/60 border border-rose-600/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div>
                  <div className="font-black text-rose-200 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>
                      {t('scanner_mode_conflict_title')} {c.order_number} ({c.actionsCount} action(s))
                    </span>
                  </div>
                  <p className="text-[11px] text-rose-300 mt-0.5">{reasonText}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={async () => {
                      await abandonOrderScannerConflict(c.order_id);
                      await refreshOfflineQueueState();
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-600 text-white font-bold text-[11px] cursor-pointer"
                  >
                    {t('scanner_mode_conflict_abandon_btn')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveOrderId(c.order_id);
                      setScreen('PICKING');
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 font-bold text-[11px] cursor-pointer"
                  >
                    {t('scanner_mode_conflict_view_btn')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* =====================================================================
          SCREEN 1: ORDERS TO PREPARE ('LIST')
         ===================================================================== */}
      {screen === 'LIST' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {/* Search + Depot Filter + Scan Order QR */}
          <div className="space-y-2 bg-slate-900 p-3 rounded-2xl border border-slate-800">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('scanner_mode_search_placeholder')}
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-bold text-white placeholder:text-slate-500 outline-none focus:border-emerald-500"
                />
              </div>
              <button
                type="button"
                onClick={() => setOrderQrScanOpen((prev) => !prev)}
                className={`px-3 py-2.5 rounded-xl font-black text-xs flex items-center gap-1.5 border transition cursor-pointer shrink-0 ${
                  orderQrScanOpen
                    ? 'bg-emerald-600 border-emerald-500 text-white'
                    : 'bg-slate-800 border-slate-700 text-emerald-400 hover:bg-slate-700'
                }`}
              >
                <QrCode className="w-4 h-4" />
                <span className="hidden sm:inline">{t('scanner_mode_scan_order_qr')}</span>
              </button>
            </div>

            {userAllowedDepots.length > 1 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setDepotFilter('ALL')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold shrink-0 cursor-pointer ${
                    depotFilter === 'ALL'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {t('scanner_mode_all_depots')}
                </button>
                {userAllowedDepots.map((depName) => (
                  <button
                    key={depName}
                    type="button"
                    onClick={() => setDepotFilter(depName)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold shrink-0 cursor-pointer ${
                      depotFilter === depName
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {depName}
                  </button>
                ))}
              </div>
            )}

            {/* Order QR Camera & Manual Entry Box */}
            {orderQrScanOpen && (
              <div className="pt-2 border-t border-slate-800 space-y-2">
                <div className="relative h-40 rounded-xl overflow-hidden bg-black border border-emerald-500/40">
                  <video
                    ref={videoRef}
                    className="w-full h-full object-cover"
                    playsInline
                    muted
                    autoPlay
                  />
                  <canvas ref={canvasRef} className="hidden" />
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-48 h-24 border-2 border-emerald-400/80 rounded-xl shadow-[0_0_25px_rgba(16,185,129,0.4)]" />
                  </div>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (orderQrManualInput.trim()) {
                      handleScannedCode(orderQrManualInput, false);
                    }
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={orderQrManualInput}
                    onChange={(e) => setOrderQrManualInput(e.target.value)}
                    placeholder="TOT-ORDER:CMD-2026-001"
                    className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-white outline-none focus:border-emerald-500"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs cursor-pointer"
                  >
                    {t('scanner_mode_manual_submit')}
                  </button>
                </form>
              </div>
            )}
          </div>

          {listBanner && (
            <div
              className={`p-3 rounded-xl border text-xs font-bold flex items-center justify-between gap-2 ${
                listBanner.type === 'error'
                  ? 'bg-rose-950/70 border-rose-700 text-rose-200'
                  : listBanner.type === 'warn'
                  ? 'bg-amber-950/70 border-amber-700 text-amber-200'
                  : 'bg-emerald-950/70 border-emerald-700 text-emerald-200'
              }`}
            >
              <span>{listBanner.text}</span>
              <button
                type="button"
                onClick={() => setListBanner(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Orders List Cards */}
          {preparerOrders.length === 0 ? (
            <div className="py-16 text-center space-y-2 text-slate-400">
              <Package className="w-10 h-10 mx-auto text-slate-600" />
              <p className="text-sm font-bold">{t('scanner_mode_no_orders')}</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {preparerOrders.map((ord) => {
                const isMine =
                  ord.preparer_id !== undefined &&
                  ord.preparer_id !== null &&
                  String(ord.preparer_id) === String(currentUser?.id);
                const isLockedByOther = isOrderLockedForUser(ord, currentUser, hasManagePerm);
                const ordProgress = getOrderProgress(ord);
                const createdTime = new Date(ord.created_at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                });

                return (
                  <div
                    key={ord.id}
                    className={`p-3.5 rounded-2xl border transition ${
                      isMine
                        ? 'bg-emerald-950/30 border-emerald-600/60'
                        : isLockedByOther
                        ? 'bg-slate-900/50 border-slate-800 opacity-75'
                        : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-base font-black text-white font-mono">
                            {ord.order_number}
                          </span>
                          {isMine ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-600 text-white">
                              {t('scanner_mode_status_mine')}
                            </span>
                          ) : isLockedByOther ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-600/30 text-amber-300 border border-amber-500/40 flex items-center gap-1">
                              <Lock className="w-3 h-3" />
                              <span>
                                {t('scanner_mode_status_other')} ({ord.preparer_name})
                              </span>
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-600/30 text-blue-300 border border-blue-500/40">
                              {t('scanner_mode_status_to_prepare')}
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-bold text-slate-300 mt-1">
                          {ord.site_number} {ord.site_name ? `— ${ord.site_name}` : ''}
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-1 flex-wrap">
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {ord.requester_name}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {createdTime}
                          </span>
                          {ord.depot_name && (
                            <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                              <Warehouse className="w-3 h-3" />
                              {ord.depot_name}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-sm font-black text-white">
                          {ordProgress.processedLines} / {ordProgress.totalLines}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {t('scanner_mode_progress_lines')}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-end gap-2">
                      {isMine ? (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveOrderId(ord.id);
                            setSkippedProductIds([]);
                            setForcedProductId(null);
                            setScreen(canFinishOrder(ord) ? 'FINISH' : 'PICKING');
                          }}
                          className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                        >
                          <Scan className="w-4 h-4" />
                          <span>{t('scanner_mode_continue_picking')}</span>
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      ) : !isLockedByOther ? (
                        <button
                          type="button"
                          disabled={assigningOrderId === ord.id || !isOnline}
                          onClick={() => handleTakeCharge(ord)}
                          className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-45 text-white font-black text-xs flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                        >
                          <Package className="w-4 h-4" />
                          <span>
                            {assigningOrderId === ord.id
                              ? '...'
                              : t('scanner_mode_take_charge')}
                          </span>
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          SCREEN 2: SINGLE-LINE PICKING ('PICKING')
         ===================================================================== */}
      {screen === 'PICKING' && activeOrder && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Progress Header */}
          <div className="px-3 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-black text-emerald-400">
                  {activeOrder.order_number}
                </span>
                <span className="text-xs font-bold text-slate-300 truncate">
                  • {activeOrder.site_number}
                </span>
              </div>
              <div className="w-44 sm:w-64 h-2 bg-slate-800 rounded-full overflow-hidden mt-1">
                <div
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div className="px-2.5 py-1 rounded-xl bg-slate-800 border border-slate-700 text-right">
                <span className="text-base font-black text-white">
                  {progress.processedLines} / {progress.totalLines}
                </span>
                <span className="block text-[9px] text-slate-400 uppercase font-bold">
                  {t('scanner_mode_progress_lines')}
                </span>
              </div>

              {canFinishOrder(activeOrder) && (
                <button
                  type="button"
                  onClick={() => setScreen('FINISH')}
                  className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs flex items-center gap-1 cursor-pointer"
                >
                  <span>{t('scanner_mode_screen3_title')}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Scan Feedback Banner */}
          {scanBanner && (
            <div
              className={`mx-3 mt-2 p-2.5 rounded-xl border text-xs font-bold flex flex-col gap-2 shrink-0 ${
                scanBanner.type === 'success'
                  ? 'bg-emerald-950/80 border-emerald-600 text-emerald-200'
                  : scanBanner.type === 'warn'
                  ? 'bg-amber-950/90 border-amber-500 text-amber-100'
                  : 'bg-rose-950/90 border-rose-600 text-rose-100'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span>{scanBanner.text}</span>
                <button
                  type="button"
                  onClick={() => setScanBanner(null)}
                  className="p-1 text-slate-300 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {scanBanner.otherLineItem && (
                <button
                  type="button"
                  onClick={() => {
                    const target = scanBanner.otherLineItem!;
                    setForcedProductId(target.product_id);
                    setScanBanner(null);
                    if (target.quantity <= 1) {
                      handleConfirmItemPick(target, 1, target.product_ref);
                    } else {
                      setQtyPrompt({
                        item: target,
                        scannedCode: target.product_ref,
                        qty: target.quantity,
                        confirmPartial: false,
                      });
                    }
                  }}
                  className="w-full py-2 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs cursor-pointer"
                >
                  {t('scanner_mode_other_line_switch_btn')}
                </button>
              )}
              {scanBanner.substituteCandidate && currentPickingItem && (
                <button
                  type="button"
                  onClick={() => {
                    const cand = scanBanner.substituteCandidate!;
                    setScanBanner(null);
                    handleConfirmSubstitute(currentPickingItem, cand);
                  }}
                  className="w-full py-2 px-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-black text-xs cursor-pointer"
                >
                  {t('scanner_mode_use_as_substitute_btn')}
                </button>
              )}
            </div>
          )}

          {/* Active Item Card (One line at a time) */}
          <div className="flex-1 overflow-y-auto p-3 flex flex-col justify-between gap-2">
            {currentPickingItem ? (
              <div className="bg-slate-900 border-2 border-slate-800 rounded-3xl p-4 flex flex-col justify-between gap-3 shadow-xl">
                {/* Rack Location & Depot Top Row */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="px-3 py-1.5 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 shrink-0" />
                    <span className="text-[11px] uppercase font-bold text-amber-200/80">
                      {t('scanner_mode_rack_location')} :
                    </span>
                    <span className="text-base font-black tracking-wide">
                      {currentPickingItem.rack_location ||
                        currentCatalogProduct?.rack_location ||
                        t('scanner_mode_no_location')}
                    </span>
                  </div>

                  <div className="px-2.5 py-1 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold flex items-center gap-1.5">
                    <Warehouse className="w-3.5 h-3.5 text-emerald-400" />
                    <span>
                      {currentPickingItem.depot_name ||
                        currentCatalogProduct?.store_name ||
                        activeOrder.depot_name}
                    </span>
                  </div>
                </div>

                {/* Product Ref, Name, Brand & Huge Quantity */}
                <div className="flex items-center justify-between gap-3 my-1">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="inline-block px-2 py-0.5 rounded bg-slate-800 font-mono text-xs font-black text-emerald-400">
                      {currentPickingItem.substituted_with_ref || currentPickingItem.product_ref}
                    </div>
                    <h2 className="text-lg sm:text-xl font-black text-white leading-snug">
                      {currentPickingItem.substituted_with_name || currentPickingItem.product_name}
                    </h2>
                    {currentCatalogProduct?.brand && (
                      <div className="text-xs font-bold text-slate-400">
                        {currentCatalogProduct.brand}
                      </div>
                    )}
                  </div>

                  {/* Huge Quantity Box */}
                  <div className="px-4 py-3 rounded-2xl bg-emerald-600/20 border-2 border-emerald-500 text-center shrink-0 min-w-[96px]">
                    <div className="text-4xl font-black text-emerald-400 leading-none">
                      {currentPickingItem.quantity}
                    </div>
                    <div className="text-xs font-extrabold uppercase text-emerald-200 mt-1">
                      {currentPickingItem.unit || 'pcs'}
                    </div>
                  </div>
                </div>

                {/* Quick Action Buttons on Current Line */}
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() =>
                      setMissingPrompt({ item: currentPickingItem, reason: '' })
                    }
                    className="py-2 px-2 rounded-xl bg-rose-950/70 hover:bg-rose-900 border border-rose-700/60 text-rose-200 font-bold text-[11px] flex items-center justify-center gap-1 cursor-pointer active:scale-95"
                  >
                    <XCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{t('scanner_mode_action_missing')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setReplacePrompt({ item: currentPickingItem, query: '' })
                    }
                    className="py-2 px-2 rounded-xl bg-amber-950/70 hover:bg-amber-900 border border-amber-700/60 text-amber-200 font-bold text-[11px] flex items-center justify-center gap-1 cursor-pointer active:scale-95"
                  >
                    <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                    <span>{t('scanner_mode_action_replace')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setForcedProductId(null);
                      setSkippedProductIds((prev) => [
                        ...prev.filter((id) => String(id) !== String(currentPickingItem.product_id)),
                        currentPickingItem.product_id,
                      ]);
                    }}
                    className="py-2 px-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-[11px] flex items-center justify-center gap-1 cursor-pointer active:scale-95"
                  >
                    <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                    <span>{t('scanner_mode_action_skip')}</span>
                  </button>

                  {hasTorch && (
                    <button
                      type="button"
                      onClick={toggleTorch}
                      className={`py-2 px-2 rounded-xl border font-bold text-[11px] flex items-center justify-center gap-1 cursor-pointer active:scale-95 ${
                        torchEnabled
                          ? 'bg-yellow-500 text-slate-950 border-yellow-400'
                          : 'bg-slate-800 border-slate-700 text-slate-200'
                      }`}
                    >
                      {torchEnabled ? (
                        <Zap className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <ZapOff className="w-3.5 h-3.5 shrink-0" />
                      )}
                      <span>{t('scanner_mode_action_torch')}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setManualInputOpen((prev) => !prev)}
                    className={`py-2 px-2 rounded-xl border font-bold text-[11px] flex items-center justify-center gap-1 cursor-pointer active:scale-95 ${
                      manualInputOpen
                        ? 'bg-emerald-600 border-emerald-500 text-white'
                        : 'bg-slate-800 border-slate-700 text-slate-200'
                    }`}
                  >
                    <Keyboard className="w-3.5 h-3.5 shrink-0" />
                    <span>{t('scanner_mode_action_manual')}</span>
                  </button>

                  {canPrintLabels && (
                    <button
                      type="button"
                      onClick={() => {
                        if (!isOnline) {
                          setActivePrintBanner({
                            stationName: selectedStation?.name || '',
                            status: 'OFFLINE_REFUSED',
                          });
                          return;
                        }
                        setProductPrintPrompt({
                          item: currentPickingItem,
                          copies: 1,
                          format: 'avery_70x37',
                        });
                      }}
                      disabled={printStations.length === 0}
                      className="py-2 px-2 rounded-xl bg-sky-950/80 hover:bg-sky-900 disabled:opacity-40 border border-sky-700/60 text-sky-200 font-bold text-[11px] flex items-center justify-center gap-1 cursor-pointer active:scale-95 col-span-3 sm:col-span-1"
                    >
                      <Printer className="w-3.5 h-3.5 shrink-0" />
                      <span>{t('scanner_print_product_btn')}</span>
                    </button>
                  )}
                </div>

                {/* Manual Code Input Form */}
                {manualInputOpen && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (manualCode.trim()) {
                        handleScannedCode(manualCode, false);
                        setManualCode('');
                      }
                    }}
                    className="flex gap-2 pt-1"
                  >
                    <input
                      type="text"
                      value={manualCode}
                      onChange={(e) => setManualCode(e.target.value)}
                      placeholder={t('scanner_mode_manual_placeholder')}
                      className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs font-mono text-white outline-none focus:border-emerald-500"
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs cursor-pointer"
                    >
                      {t('scanner_mode_manual_submit')}
                    </button>
                  </form>
                )}

                {/* Undo Last Pick Button */}
                {lastPickedProductId !== null && (
                  <button
                    type="button"
                    onClick={handleUndoLastPick}
                    className="w-full py-2 px-3 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-amber-300 font-bold text-xs flex items-center justify-center gap-1.5 border border-slate-700 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{t('scanner_mode_undo_last_pick')}</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="bg-slate-900 border border-emerald-600/50 rounded-3xl p-6 text-center space-y-3">
                <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
                <h3 className="text-lg font-black text-white">
                  {t('scanner_mode_screen3_title')}
                </h3>
                <button
                  type="button"
                  onClick={() => setScreen('FINISH')}
                  className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm cursor-pointer"
                >
                  {t('scanner_mode_screen3_title')} →
                </button>
              </div>
            )}

            {/* Collapsible Drawer: View All Lines */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shrink-0">
              <button
                type="button"
                onClick={() => setAllLinesDrawerOpen((prev) => !prev)}
                className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs font-bold text-slate-300 hover:bg-slate-800/60 cursor-pointer"
              >
                <span>
                  {allLinesDrawerOpen
                    ? t('scanner_mode_hide_all_lines')
                    : t('scanner_mode_view_all_lines')}{' '}
                  ({progress.processedLines}/{progress.totalLines})
                </span>
                {allLinesDrawerOpen ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronUp className="w-4 h-4" />
                )}
              </button>

              {allLinesDrawerOpen && (
                <div className="max-h-48 overflow-y-auto divide-y divide-slate-800 border-t border-slate-800">
                  {sortedOrderItems.map((it) => {
                    const cat = products.find((p) => String(p.id) === String(it.product_id));
                    const rack = it.rack_location || cat?.rack_location || '';
                    return (
                      <div
                        key={String(it.product_id)}
                        className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-white truncate">
                            {it.product_name}{' '}
                            <span className="font-mono text-[10px] text-slate-400">
                              ({it.product_ref})
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 flex items-center gap-2">
                            <span>
                              Qté: {it.picked_quantity ?? it.quantity} / {it.quantity}
                            </span>
                            {rack && <span className="text-amber-400">• {rack}</span>}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {it.picked ? (
                            <button
                              type="button"
                              onClick={() => {
                                unpickOrderItem(activeOrder.id, it.product_id);
                                setForcedProductId(it.product_id);
                              }}
                              className="px-2 py-1 rounded bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 font-bold text-[10px] cursor-pointer"
                            >
                              ✓ {t('scanner_mode_line_status_picked')}
                            </button>
                          ) : it.unavailable ? (
                            <button
                              type="button"
                              onClick={() => {
                                updateOrderItemAvailability(activeOrder.id, it.product_id, false, '');
                                setForcedProductId(it.product_id);
                              }}
                              className="px-2 py-1 rounded bg-rose-600/20 border border-rose-500/40 text-rose-300 font-bold text-[10px] cursor-pointer"
                            >
                              ✕ {t('scanner_mode_line_status_missing')}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setForcedProductId(it.product_id);
                                setAllLinesDrawerOpen(false);
                              }}
                              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-[10px] cursor-pointer"
                            >
                              {t('scanner_mode_line_status_todo')}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Always-Open Bottom Camera Viewport */}
          {currentPickingItem && (
            <div className="h-36 sm:h-44 bg-black border-t border-slate-800 relative shrink-0 overflow-hidden">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
                autoPlay
              />
              <canvas ref={canvasRef} className="hidden" />
              <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
                <div className="w-60 h-20 border-2 border-emerald-400/80 rounded-2xl shadow-[0_0_30px_rgba(16,185,129,0.35)]" />
                <span className="mt-1.5 px-2.5 py-0.5 rounded-full bg-slate-950/80 text-[10px] font-bold text-emerald-300">
                  {t('scanner_mode_camera_active')}
                </span>
              </div>
              {cameraError && (
                <div className="absolute inset-0 bg-slate-950/90 flex items-center justify-center p-3 text-center text-xs text-amber-300 font-bold">
                  {cameraError} — {t('scanner_mode_action_manual')}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          SCREEN 3: FINISH ORDER ('FINISH')
         ===================================================================== */}
      {screen === 'FINISH' && activeOrder && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-mono text-sm font-black text-emerald-400">
                  {activeOrder.order_number}
                </span>
                <h2 className="text-lg font-black text-white">
                  {t('scanner_mode_screen3_title')}
                </h2>
              </div>
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </div>

            {/* Summary Metrics */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-3 rounded-2xl bg-emerald-950/40 border border-emerald-700/50">
                <div className="text-2xl font-black text-emerald-400">
                  {progress.pickedLines}
                </div>
                <div className="text-[10px] font-bold text-emerald-200 uppercase">
                  {t('scanner_mode_finish_picked_count')}
                </div>
              </div>
              <div className="p-3 rounded-2xl bg-rose-950/40 border border-rose-700/50">
                <div className="text-2xl font-black text-rose-400">
                  {progress.unavailableLines}
                </div>
                <div className="text-[10px] font-bold text-rose-200 uppercase">
                  {t('scanner_mode_finish_missing_count')}
                </div>
              </div>
              <div className="p-3 rounded-2xl bg-amber-950/40 border border-amber-700/50">
                <div className="text-2xl font-black text-amber-400">
                  {progress.substitutedLines}
                </div>
                <div className="text-[10px] font-bold text-amber-200 uppercase">
                  {t('scanner_mode_finish_replaced_count')}
                </div>
              </div>
            </div>

            {/* Pickup Zone Selector */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-300">
                {t('scanner_mode_pickup_zone_label')}
              </label>
              <input
                type="text"
                value={pickupZone}
                onChange={(e) => setPickupZone(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm font-bold text-white outline-none focus:border-emerald-500"
              />
              <div className="flex flex-wrap gap-1.5">
                {[
                  t('scanner_mode_pickup_zone_preset_1'),
                  t('scanner_mode_pickup_zone_preset_2'),
                  t('scanner_mode_pickup_zone_preset_3'),
                ].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setPickupZone(preset)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border cursor-pointer ${
                      pickupZone === preset
                        ? 'bg-emerald-600 border-emerald-500 text-white'
                        : 'bg-slate-800 border-slate-700 text-slate-300'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {!canFinishOrder(activeOrder) && (
              <div className="p-3 rounded-xl bg-amber-950/70 border border-amber-600 text-amber-200 text-xs font-bold">
                {t('scanner_mode_cannot_finish_warning')}
              </div>
            )}

            {(!isOnline || pendingActionsCount > 0) && (
              <div className="p-3 rounded-xl bg-amber-950/70 border border-amber-600 text-amber-200 text-xs font-bold flex items-center gap-2">
                <WifiOff className="w-4 h-4 shrink-0" />
                <span>{t('scanner_mode_ready_requires_online')}</span>
              </div>
            )}

            {/* v30 Order Ready Label Remote Print Checkbox */}
            {canPrintLabels && (
              <div className="p-3 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-2">
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <input
                      type="checkbox"
                      checked={printOrderLabelChecked}
                      disabled={!isOnline || printStations.length === 0}
                      onChange={(e) => setPrintOrderLabelChecked(e.target.checked)}
                      className="w-4 h-4 rounded accent-emerald-500 cursor-pointer"
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-black text-white flex items-center gap-1.5">
                        <Printer className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>{t('scanner_print_order_checkbox')}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {!isOnline
                          ? t('scanner_print_offline_unavailable')
                          : selectedStation
                          ? `${t('scanner_print_station_label')} ${selectedStation.name}`
                          : t('scanner_print_no_station')}
                      </div>
                    </div>
                  </div>
                </label>

                {orderMarkedReady && selectedStation && (
                  <button
                    type="button"
                    disabled={!isOnline || sendingPrintJob}
                    onClick={() =>
                      handleSendOrderPrintJob(activeOrder, pickupZone.trim() || 'Étagère A1')
                    }
                    className="w-full py-2 px-3 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>{t('scanner_print_order_checkbox')}</span>
                  </button>
                )}
              </div>
            )}

            {!orderMarkedReady ? (
              <button
                type="button"
                disabled={
                  !canFinishOrder(activeOrder) ||
                  !isOnline ||
                  pendingActionsCount > 0 ||
                  submittingReady
                }
                onClick={handleMarkOrderReady}
                className="w-full py-3.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 cursor-pointer"
              >
                <Check className="w-5 h-5" />
                <span>
                  {submittingReady ? '...' : t('scanner_mode_mark_ready_btn')}
                </span>
              </button>
            ) : (
              <div className="p-4 rounded-2xl bg-white text-slate-900 text-center space-y-2">
                {readyQrUrl && (
                  <img
                    src={readyQrUrl}
                    alt={activeOrder.order_number}
                    className="w-44 h-44 mx-auto"
                  />
                )}
                <div className="font-mono font-black text-sm">
                  TOT-ORDER:{activeOrder.order_number}
                </div>
                <p className="text-xs text-slate-600 font-semibold">
                  {t('scanner_mode_ready_qr_help')}
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setActiveOrderId(null);
                setScreen('LIST');
              }}
              className="w-full py-3 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-black text-xs flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>{t('scanner_mode_next_order_btn')}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: QUANTITY & PARTIAL QUANTITY CONFIRMATION (when qty > 1)
         ===================================================================== */}
      {qtyPrompt && (
        <div className="fixed inset-0 z-[80] bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-3xl p-5 space-y-4">
            <h3 className="text-base font-black text-white">
              {qtyPrompt.confirmPartial
                ? t('scanner_mode_partial_confirm_title')
                : t('scanner_mode_qty_confirm_title')}
            </h3>
            <p className="text-xs font-bold text-emerald-400">
              {qtyPrompt.item.product_name} ({qtyPrompt.item.product_ref})
            </p>

            {!qtyPrompt.confirmPartial ? (
              <>
                <div className="flex items-center justify-center gap-4 py-2">
                  <button
                    type="button"
                    onClick={() =>
                      setQtyPrompt((prev) =>
                        prev ? { ...prev, qty: Math.max(1, prev.qty - 1) } : null
                      )
                    }
                    className="w-12 h-12 rounded-2xl bg-slate-800 hover:bg-slate-700 text-2xl font-black text-white cursor-pointer"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={qtyPrompt.item.quantity}
                    value={qtyPrompt.qty}
                    onChange={(e) =>
                      setQtyPrompt((prev) =>
                        prev
                          ? {
                              ...prev,
                              qty: Math.max(1, Number(e.target.value) || 1),
                            }
                          : null
                      )
                    }
                    className="w-24 text-center text-3xl font-black bg-slate-950 border border-emerald-500 rounded-2xl py-2 text-white outline-none"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setQtyPrompt((prev) =>
                        prev
                          ? {
                              ...prev,
                              qty: Math.min(prev.item.quantity, prev.qty + 1),
                            }
                          : null
                      )
                    }
                    className="w-12 h-12 rounded-2xl bg-slate-800 hover:bg-slate-700 text-2xl font-black text-white cursor-pointer"
                  >
                    +
                  </button>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setQtyPrompt(null)}
                    className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs cursor-pointer"
                  >
                    {t('common_cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (qtyPrompt.qty < qtyPrompt.item.quantity) {
                        setQtyPrompt({ ...qtyPrompt, confirmPartial: true });
                      } else {
                        handleConfirmItemPick(
                          qtyPrompt.item,
                          qtyPrompt.qty,
                          qtyPrompt.scannedCode
                        );
                      }
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs cursor-pointer"
                  >
                    {t('scanner_mode_qty_validate_btn')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-amber-200 leading-relaxed">
                  {t('scanner_mode_partial_confirm_desc')} ({qtyPrompt.qty} /{' '}
                  {qtyPrompt.item.quantity})
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setQtyPrompt({ ...qtyPrompt, confirmPartial: false })
                    }
                    className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs cursor-pointer"
                  >
                    {t('common_cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleConfirmItemPick(
                        qtyPrompt.item,
                        qtyPrompt.qty,
                        qtyPrompt.scannedCode
                      )
                    }
                    className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs cursor-pointer"
                  >
                    {t('scanner_mode_qty_validate_btn')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: MISSING ITEM REASON
         ===================================================================== */}
      {missingPrompt && (
        <div className="fixed inset-0 z-[80] bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-3xl p-5 space-y-3">
            <h3 className="text-base font-black text-rose-400">
              {t('scanner_mode_action_missing')} — {missingPrompt.item.product_name}
            </h3>
            <input
              type="text"
              value={missingPrompt.reason}
              onChange={(e) =>
                setMissingPrompt({ ...missingPrompt, reason: e.target.value })
              }
              placeholder={t('scanner_mode_missing_reason_placeholder')}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white outline-none focus:border-rose-500"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMissingPrompt(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs cursor-pointer"
              >
                {t('common_cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmMissing}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs cursor-pointer"
              >
                {t('scanner_mode_missing_confirm_btn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: REPLACE / SUBSTITUTE ITEM
         ===================================================================== */}
      {replacePrompt && (
        <div className="fixed inset-0 z-[80] bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-3xl p-5 space-y-3 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-amber-400">
                {t('scanner_mode_replace_title')}
              </h3>
              <button
                type="button"
                onClick={() => setReplacePrompt(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              value={replacePrompt.query}
              onChange={(e) =>
                setReplacePrompt({ ...replacePrompt, query: e.target.value })
              }
              placeholder={t('scanner_mode_replace_search_placeholder')}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white outline-none focus:border-amber-500"
            />
            <div className="flex-1 overflow-y-auto divide-y divide-slate-800">
              {products
                .filter((p) => {
                  if (String(p.id) === String(replacePrompt.item.product_id)) return false;
                  if (!replacePrompt.query.trim()) return true;
                  const q = replacePrompt.query.toLowerCase().trim();
                  return (
                    p.reference.toLowerCase().includes(q) ||
                    (p.model && p.model.toLowerCase().includes(q)) ||
                    (p.brand && p.brand.toLowerCase().includes(q)) ||
                    (p.barcode && p.barcode.toLowerCase().includes(q))
                  );
                })
                .slice(0, 20)
                .map((p) => (
                  <button
                    key={String(p.id)}
                    type="button"
                    onClick={() => handleConfirmSubstitute(replacePrompt.item, p)}
                    className="w-full py-2.5 px-2 text-left hover:bg-slate-800 flex items-center justify-between gap-2 cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate">
                        {p.model || p.reference}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {p.reference} • Stock: {p.quantity}
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg bg-amber-500 text-slate-950 font-black text-[10px] shrink-0">
                      {t('scanner_mode_action_replace')}
                    </span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: QUIT CONFIRMATION
         ===================================================================== */}
      {quitConfirmOpen && (
        <div className="fixed inset-0 z-[85] bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-3xl p-5 space-y-4">
            <h3 className="text-base font-black text-white">
              {t('scanner_mode_quit_confirm_title')}
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              {t('scanner_mode_quit_confirm_desc')}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setQuitConfirmOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-200 font-bold text-xs cursor-pointer"
              >
                {t('scanner_mode_quit_stay_btn')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setQuitConfirmOpen(false);
                  stopCamera();
                  setScannerPickingModeOpen(false);
                }}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs cursor-pointer"
              >
                {t('scanner_mode_quit_confirm_btn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: PRODUCT LABEL REMOTE PRINT (v30)
         ===================================================================== */}
      {productPrintPrompt && (
        <div className="fixed inset-0 z-[85] bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-3xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-black text-sky-400 flex items-center gap-2">
                <Printer className="w-4 h-4" />
                <span>{t('scanner_print_product_btn')}</span>
              </h3>
              <button
                type="button"
                onClick={() => setProductPrintPrompt(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs">
              <div className="font-mono font-black text-emerald-400">
                {productPrintPrompt.item.substituted_with_ref || productPrintPrompt.item.product_ref}
              </div>
              <div className="font-bold text-white truncate">
                {productPrintPrompt.item.substituted_with_name || productPrintPrompt.item.product_name}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-300">
                {t('scanner_print_copies_label')} (1 – 100)
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setProductPrintPrompt((prev) =>
                      prev ? { ...prev, copies: Math.max(1, prev.copies - 1) } : null
                    )
                  }
                  className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 font-black text-lg text-white cursor-pointer"
                >
                  -
                </button>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={productPrintPrompt.copies}
                  onChange={(e) =>
                    setProductPrintPrompt((prev) =>
                      prev
                        ? {
                            ...prev,
                            copies: Math.max(1, Math.min(100, Number(e.target.value) || 1)),
                          }
                        : null
                    )
                  }
                  className="flex-1 text-center py-2 rounded-xl bg-slate-950 border border-slate-700 font-black text-lg text-white outline-none focus:border-sky-500"
                />
                <button
                  type="button"
                  onClick={() =>
                    setProductPrintPrompt((prev) =>
                      prev ? { ...prev, copies: Math.min(100, prev.copies + 1) } : null
                    )
                  }
                  className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 font-black text-lg text-white cursor-pointer"
                >
                  +
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-300">
                {t('scanner_print_format_label')}
              </label>
              <select
                value={productPrintPrompt.format}
                onChange={(e) =>
                  setProductPrintPrompt((prev) =>
                    prev ? { ...prev, format: e.target.value as PrintLabelFormat } : null
                  )
                }
                className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs font-bold text-white outline-none focus:border-sky-500 cursor-pointer"
              >
                <option value="avery_70x37">{t('scanner_print_format_avery_70x37')}</option>
                <option value="avery_105x42">{t('scanner_print_format_avery_105x42')}</option>
                <option value="thermal_50x30">{t('scanner_print_format_thermal_50x30')}</option>
                <option value="bin_90x50">{t('scanner_print_format_bin_90x50')}</option>
              </select>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setProductPrintPrompt(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs cursor-pointer"
              >
                {t('common_cancel')}
              </button>
              <button
                type="button"
                disabled={sendingPrintJob || !selectedStation}
                onClick={() =>
                  handleSendProductPrintJob(
                    productPrintPrompt.item,
                    productPrintPrompt.copies,
                    productPrintPrompt.format
                  )
                }
                className="flex-1 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>{sendingPrintJob ? '...' : t('scanner_print_send_btn')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
