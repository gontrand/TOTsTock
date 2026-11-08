import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { tr } from '../i18n/dutchTranslator';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import {
  decodeBarcodeFromCanvas,
  openSmartphoneCameraStream,
  prewarmSmartphoneCameraStream,
  attachStreamToVideoElement,
} from '../utils/qrCodeHelper';
import { useApp } from '../context/AppContext';
import { MaterialOrder, OrderStatus } from '../types';
import { SearchableSelect } from './SearchableSelect';
import { printHtmlViaIframe, generateOrderSlipHtml, generateThermalLabelHtml } from '../utils/printHelper';
import { playScanBeep } from '../utils/crypto';
import { hapticFeedback } from '../utils/haptics';
import {
  findOrderItemByCode,
  findCatalogProductByCode,
  canFinishOrder,
  isOrderLockedForUser,
  canUserAccessScannerMode,
} from '../services/orderPickingLogic';
import {
  X,
  Package,
  Clock,
  CheckCircle2,
  AlertCircle,
  Building2,
  User,
  Search,
  Check,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronUp,
  FileText,
  UserCheck,
  PackageCheck,
  Calendar,
  AlertTriangle,
  MessageSquare,
  QrCode,
  Lock,
  Printer,
  MapPin,
  RefreshCw,
  Tag,
  Sparkles,
  ArrowLeft,
  Focus,
  Target,
  Scan,
  Barcode,
  Camera,
  CameraOff,
  Zap,
  ZapOff,
  ShieldAlert,
  Volume2,
} from 'lucide-react';

export const OrdersPreparationModal: React.FC = () => {
  const {
    preparerOrdersModalOpen,
    setPreparerOrdersModalOpen,
    orders,
    products,
    depots,
    subCategories,
    assignOrderToMe,
    markOrderReady,
    substituteOrderItem,
    toggleOrderItemPicked,
    validateOrderItemScanned,
    unpickOrderItem,
    updateOrderItemAvailability,
    canApproveOrder,
    approveOrder,
    rejectOrder,
    currentUser,
    isPreparer,
    userHasPermission,
    openScannerPickingMode,
    language,
    t,
  } = useApp();

  const [statusFilter, setStatusFilter] = useState<'ALL' | OrderStatus>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDepotFilter, setSelectedDepotFilter] = useState<string>('ALL');
  const [expandedOrderIds, setExpandedOrderIds] = useState<string[]>([]);

  // Mandatory Item Scan & Quantity Validation Modal state
  const [scanValidationModal, setScanValidationModal] = useState<{
    open: boolean;
    order: MaterialOrder;
    item: (MaterialOrder['items'])[0];
    catalogProduct?: (typeof products)[0];
    barcodeInput: string;
    isBarcodeMatched: boolean;
    encodedQuantity: number;
    errorMsg: string | null;
  } | null>(null);

  // Focus Mode for preparer: isolate single order for zero distraction
  const [focusedOrderId, setFocusedOrderId] = useState<string | null>(null);
  const [barcodeScanInput, setBarcodeScanInput] = useState<string>('');
  const [scanFeedback, setScanFeedback] = useState<{ type: 'success' | 'warn' | 'error'; message: string } | null>(null);

  // Live Camera Scanner states for Store Order Fulfillment
  const [isCameraScannerOpen, setIsCameraScannerOpen] = useState<boolean>(false);
  const [scannerTargetOrder, setScannerTargetOrder] = useState<MaterialOrder | null>(null);
  const [continuousScanMode, setContinuousScanMode] = useState<boolean>(true);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [torchEnabled, setTorchEnabled] = useState<boolean>(false);
  const [lastScannedArticle, setLastScannedArticle] = useState<{
    name: string;
    ref: string;
    qty: number;
    unit?: string;
    already?: boolean;
  } | null>(null);
  const [manualScanInput, setManualScanInput] = useState<string>('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const isCooldownRef = useRef<boolean>(false);

  // Modals state for Mark Ready & QR Code & Checklist Warning
  const [markReadyTargetOrder, setMarkReadyTargetOrder] = useState<MaterialOrder | null>(null);
  const [readyPickupZone, setReadyPickupZone] = useState<string>('Étagère Retrait A1');
  const [readyQrPreviewUrl, setReadyQrPreviewUrl] = useState<string | null>(null);
  const [isSubmittingReady, setIsSubmittingReady] = useState<boolean>(false);

  const [viewQrCodeOrder, setViewQrCodeOrder] = useState<MaterialOrder | null>(null);
  const [viewQrCodeUrl, setViewQrCodeUrl] = useState<string | null>(null);
  const [unconfirmedWarningOrder, setUnconfirmedWarningOrder] = useState<MaterialOrder | null>(null);

  // Quick 1-Click Substitution Dialog states
  const [substitutionTargetOrder, setSubstitutionTargetOrder] = useState<MaterialOrder | null>(null);
  const [substitutionTargetItem, setSubstitutionTargetItem] = useState<any | null>(null);
  const [substituteSearchQuery, setSubstituteSearchQuery] = useState<string>('');
  const [substitutionReason, setSubstitutionReason] = useState<string>('Remplacement équivalent suite rupture');
  const [isSubmittingSubstitution, setIsSubmittingSubstitution] = useState<boolean>(false);

  // Thermal Label Print Modal states (60x40 mm / 100x150 mm)
  const [printThermalLabelOrder, setPrintThermalLabelOrder] = useState<MaterialOrder | null>(null);
  const [printThermalQrUrl, setPrintThermalQrUrl] = useState<string | null>(null);
  const [thermalFormat, setThermalFormat] = useState<'60x40' | '100x150'>('60x40');

  // User depot access evaluation
  const isSuperAdmin =
    Number(currentUser?.id) === 0 ||
    Number(currentUser?.role_id) === 0 ||
    Number(currentUser?.role_id) === 1;

  const userAllowedDepots = useMemo(() => {
    if (!currentUser) return [];
    if (isSuperAdmin) return depots.map((d) => d.name);
    if (currentUser.allowed_depots && currentUser.allowed_depots.length > 0) {
      return currentUser.allowed_depots;
    }
    return depots.map((d) => d.name);
  }, [currentUser, isSuperAdmin, depots]);

  const hasMultipleDepots = isSuperAdmin || userAllowedDepots.length > 1;
  const singleAssignedDepot =
    !hasMultipleDepots && userAllowedDepots.length === 1 ? userAllowedDepots[0] : null;

  // Keyboard shortcut: close on Escape
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && preparerOrdersModalOpen) {
        setPreparerOrdersModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [preparerOrdersModalOpen, setPreparerOrdersModalOpen]);

  // Access check: only preparers or role 0/1 or super-admin
  const canAccessPrep = isPreparer || userHasPermission('perm_menu_order_prep');
  const canOpenScannerMode = canUserAccessScannerMode(
    currentUser,
    isPreparer,
    userHasPermission('perm_menu_order_prep')
  );

  // Preparer permissions (only assign and mark ready!)
  const canAssign = userHasPermission('perm_order_assign');
  const canMarkReady = userHasPermission('perm_order_mark_ready');

  // Règle d'exclusivité : un préparateur ne peut pas modifier la commande déjà assignée à un autre préparateur
  const isOrderAssignedToOther = useCallback(
    (order?: MaterialOrder | null): boolean => {
      return isOrderLockedForUser(order, currentUser, userHasPermission('perm_orders_manage'));
    },
    [currentUser, userHasPermission]
  );

  // Preparers see ALL orders across all departments and sites!
  // Collected orders remain visible for 24h
  const visibleOrders = useMemo(() => {
    const now = Date.now();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

    return orders.filter((o) => {
      if (o.status === 'COLLECTED') {
        if (!o.collected_at) return false;
        const collectedTime = new Date(o.collected_at).getTime();
        if (now - collectedTime > TWENTY_FOUR_HOURS) {
          return false;
        }
      }
      return true;
    });
  }, [orders]);

  // Apply UI filters with user depot permission constraints
  const filteredOrders = useMemo(() => {
    return visibleOrders
      .filter((o) => {
        // Enforce user depot assignment:
        if (singleAssignedDepot) {
          if (o.depot_name && o.depot_name !== singleAssignedDepot) {
            return false;
          }
        } else if (userAllowedDepots.length > 0 && !isSuperAdmin) {
          if (o.depot_name && !userAllowedDepots.includes(o.depot_name)) {
            return false;
          }
        }

        // Status filter
        if (statusFilter !== 'ALL' && o.status !== statusFilter) {
          return false;
        }
        // Depot UI filter
        if (selectedDepotFilter !== 'ALL' && o.depot_name !== selectedDepotFilter) {
          return false;
        }
        // Search query
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const matchNum = o.order_number.toLowerCase().includes(q);
          const matchSite = o.site_number.toLowerCase().includes(q);
          const matchReq = o.requester_name.toLowerCase().includes(q);
          const matchItems = o.items.some(
            (it) =>
              it.product_name.toLowerCase().includes(q) || it.product_ref.toLowerCase().includes(q)
          );
          if (!matchNum && !matchSite && !matchReq && !matchItems) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [visibleOrders, statusFilter, selectedDepotFilter, searchQuery, singleAssignedDepot, userAllowedDepots, isSuperAdmin]);

  // Counts by status
  const waitingApprovalCount = visibleOrders.filter((o) => o.status === 'WAITING_APPROVAL').length;
  const pendingCount = visibleOrders.filter((o) => o.status === 'PENDING').length;
  const preparingCount = visibleOrders.filter((o) => o.status === 'PREPARING').length;
  const readyCount = visibleOrders.filter((o) => o.status === 'READY').length;
  const collected24hCount = visibleOrders.filter((o) => o.status === 'COLLECTED').length;

  const toggleExpand = (orderId: string) => {
    setExpandedOrderIds((prev) =>
      prev.includes(orderId) ? prev.filter((id) => id !== orderId) : [...prev, orderId]
    );
  };

  const handleInitiateMarkReady = async (order: MaterialOrder) => {
    if (isOrderAssignedToOther(order)) {
      alert(
        tr(language, `Action refusée : Cette commande est assignée à ${order.preparer_name || 'un autre préparateur'}. Seul ce préparateur ou un administrateur peut la marquer comme prête.`, `Action blocked: This order is assigned to ${order.preparer_name || 'another preparer'}.`)
      );
      return;
    }

    // Requirement: all items must be confirmed (picked OR unavailable)
    if (!canFinishOrder(order)) {
      setUnconfirmedWarningOrder(order);
      return;
    }

    const payload = `TOT-ORDER:${order.order_number}`;
    try {
      const url = await QRCode.toDataURL(payload, {
        width: 320,
        margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' },
      });
      setReadyQrPreviewUrl(url);
    } catch (e) {
      console.warn('QR gen preview error:', e);
    }
    const depotObj = depots.find(
      (d) => d.name.toLowerCase().trim() === (order.depot_name || '').toLowerCase().trim()
    );
    const preconfiguredZones =
      depotObj?.pickup_zones && depotObj.pickup_zones.length > 0
        ? depotObj.pickup_zones
        : ['Casier A1', 'Casier A2', 'Zone Drive Magasin', 'Étagère Retrait 1'];
    setReadyPickupZone(order.pickup_zone || preconfiguredZones[0] || 'Zone Retrait');
    setMarkReadyTargetOrder(order);
  };

  const handleConfirmMarkReady = async () => {
    if (!markReadyTargetOrder) return;
    setIsSubmittingReady(true);
    try {
      const res = await markOrderReady(markReadyTargetOrder.id, readyPickupZone);
      if (res.success) {
        const payload = `TOT-ORDER:${markReadyTargetOrder.order_number}`;
        const url = await QRCode.toDataURL(payload, {
          width: 320,
          margin: 2,
          color: { dark: '#0f172a', light: '#ffffff' },
        });
        setViewQrCodeUrl(url);
        setViewQrCodeOrder({
          ...markReadyTargetOrder,
          status: 'READY',
          pickup_zone: readyPickupZone,
          ready_qr_code: payload,
        });
        setMarkReadyTargetOrder(null);
      } else {
        alert(res.message);
      }
    } finally {
      setIsSubmittingReady(false);
    }
  };

  const handleOpenViewQrCode = async (order: MaterialOrder) => {
    const payload = order.ready_qr_code || `TOT-ORDER:${order.order_number}`;
    try {
      const url = await QRCode.toDataURL(payload, {
        width: 320,
        margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' },
      });
      setViewQrCodeUrl(url);
      setViewQrCodeOrder(order);
    } catch (e) {
      console.warn('QR gen error:', e);
    }
  };

  const subCategoryMap = useMemo(() => {
    const map = new Map<number, string>();
    subCategories.forEach((sc) => map.set(sc.id, sc.name));
    return map;
  }, [subCategories]);

  // Eligible substitute products
  const eligibleSubstitutes = useMemo(() => {
    if (!substitutionTargetOrder || !substitutionTargetItem) return [];
    const orderDepot = (substitutionTargetOrder.depot_name || '').trim();
    return products.filter((p) => {
      if (
        String(p.id) === String(substitutionTargetItem.product_id) ||
        p.reference === substitutionTargetItem.product_ref
      ) {
        return false;
      }
      const pDepot = (p.store_name || '').trim();
      if (orderDepot && pDepot && pDepot.toLowerCase() !== orderDepot.toLowerCase()) {
        return false;
      }
      const catName = p.sub_category_id ? subCategoryMap.get(p.sub_category_id) || '' : p.tags || '';
      if (substituteSearchQuery.trim()) {
        const q = substituteSearchQuery.toLowerCase().trim();
        const mRef = p.reference && p.reference.toLowerCase().includes(q);
        const mBrand = p.brand && p.brand.toLowerCase().includes(q);
        const mModel = p.model && p.model.toLowerCase().includes(q);
        const mCat = catName && catName.toLowerCase().includes(q);
        if (!mRef && !mBrand && !mModel && !mCat) return false;
      }
      return true;
    });
  }, [products, substitutionTargetOrder, substitutionTargetItem, subCategoryMap, substituteSearchQuery]);

  const handleOpenSubstitutionModal = (order: MaterialOrder, item: any) => {
    if (isOrderAssignedToOther(order)) {
      alert(
        tr(language, `Action refusée : Cette commande est assignée à ${order.preparer_name || 'un autre préparateur'}. Vous ne pouvez pas substituer de produit.`, `Action blocked: This order is assigned to ${order.preparer_name || 'another preparer'}.`)
      );
      return;
    }
    setSubstitutionTargetOrder(order);
    setSubstitutionTargetItem(item);
    setSubstituteSearchQuery('');
    setSubstitutionReason('Remplacement équivalent suite rupture');
  };

  const handleConfirmSubstitution = async (substituteProd: (typeof products)[0]) => {
    if (!substitutionTargetOrder || !substitutionTargetItem) return;
    setIsSubmittingSubstitution(true);
    try {
      const res = await substituteOrderItem(
        substitutionTargetOrder.id,
        substitutionTargetItem.product_id,
        substituteProd,
        substitutionReason
      );
      if (res.success) {
        setSubstitutionTargetOrder(null);
        setSubstitutionTargetItem(null);
      } else {
        alert(res.message);
      }
    } finally {
      setIsSubmittingSubstitution(false);
    }
  };

  const handleOpenThermalLabelModal = async (order: MaterialOrder) => {
    const payload = order.ready_qr_code || `TOT-ORDER:${order.order_number}`;
    try {
      const url = await QRCode.toDataURL(payload, {
        width: 320,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
      });
      setPrintThermalQrUrl(url);
      setPrintThermalLabelOrder(order);
      setThermalFormat('60x40');
    } catch (e) {
      console.warn('Thermal QR gen error:', e);
    }
  };

  const handlePrintThermalDirect = (format: '60x40' | '100x150') => {
    if (!printThermalLabelOrder) return;
    const html = generateThermalLabelHtml({
      orderNumber: printThermalLabelOrder.order_number,
      siteNumber: printThermalLabelOrder.site_number,
      requesterName: printThermalLabelOrder.requester_name,
      pickupZone: printThermalLabelOrder.pickup_zone || 'RETRAIT',
      depotName: printThermalLabelOrder.depot_name || 'Magasin',
      preparerName: printThermalLabelOrder.preparer_name || currentUser?.name || 'Magasinier',
      itemsCount: printThermalLabelOrder.items.length,
      qrCodeDataUrl: printThermalQrUrl,
      format,
    });
    printHtmlViaIframe(html);
  };

  const handlePrintOrderSlipDirect = async (order: MaterialOrder, qrUrl?: string | null) => {
    let finalQr = qrUrl || order.ready_qr_code || null;
    if (!finalQr) {
      try {
        const payload = JSON.stringify({
          type: 'TOT_ORDER_PICKUP',
          order_id: order.id,
          order_number: order.order_number,
          site_number: order.site_number,
          depot: order.depot_name,
        });
        finalQr = await QRCode.toDataURL(payload, { width: 200, margin: 1 });
      } catch (err) {
        console.warn('QR generation error for print slip:', err);
      }
    }

    const html = generateOrderSlipHtml({
      orderNumber: order.order_number,
      siteNumber: order.site_number,
      requesterName: order.requester_name,
      pickupZone: order.pickup_zone || 'Zone de retrait magasin',
      depotName: order.depot_name || 'Magasin',
      preparerName: order.preparer_name || currentUser?.name || 'Magasinier',
      items: order.items,
      qrCodeDataUrl: finalQr,
      notes: order.notes,
    });
    printHtmlViaIframe(html);
  };

  const stopCamera = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    setTorchEnabled(false);
  }, []);

  const toggleTorch = useCallback(async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;
    try {
      const nextTorch = !torchEnabled;
      // @ts-expect-error advanced constraint
      await track.applyConstraints({ advanced: [{ torch: nextTorch }] });
      setTorchEnabled(nextTorch);
    } catch (err) {
      console.warn('Torch toggle failed:', err);
    }
  }, [torchEnabled]);

  const handleOpenScanner = useCallback(
    (order: MaterialOrder) => {
      if (isOrderAssignedToOther(order)) {
        alert(
          tr(language, `Action refusée : Cette commande est assignée à ${order.preparer_name || 'un autre préparateur'}. Seul ce préparateur ou un administrateur peut pointer les articles.`, `Action blocked: This order is assigned to ${order.preparer_name || 'another preparer'}.`)
        );
        return;
      }
      prewarmSmartphoneCameraStream();
      setScannerTargetOrder(order);
      setCameraError(null);
      setLastScannedArticle(null);
      setManualScanInput('');
      setIsCameraScannerOpen(true);
    },
    [isOrderAssignedToOther, language]
  );

  const handleCloseScanner = useCallback(() => {
    stopCamera();
    setIsCameraScannerOpen(false);
    setScannerTargetOrder(null);
    setLastScannedArticle(null);
  }, [stopCamera]);

  const handleProcessBarcodeMatch = useCallback(
    (rawCode: string, targetOrder: MaterialOrder, isCameraSource: boolean = false) => {
      const code = rawCode.trim();
      if (!code) return;
      setScanFeedback(null);

      if (isOrderAssignedToOther(targetOrder)) {
        playScanBeep(false);
        setScanFeedback({
          type: 'error',
          message:
            tr(language, `Action refusée : Cette commande est assignée à ${targetOrder.preparer_name || 'un autre préparateur'}.`, `Action blocked: This order is assigned to ${targetOrder.preparer_name || 'another preparer'}.`),
        });
        return;
      }

      // Check catalog for barcode / QR / manufacturer_ref / reference matching via shared pure logic
      const catalogProd = findCatalogProductByCode(code, products);

      // 1. Check if matches any item in the order checklist directly or via catalog item
      const matchedItem = findOrderItemByCode(targetOrder, code, products);

      if (matchedItem) {
        if (matchedItem.picked) {
          playScanBeep(false);
          const feedbackMsg = tr(language, `ℹ️ Article déjà pointé : ${matchedItem.product_name}`, `ℹ️ Item already checked: ${matchedItem.product_name}`);
          setScanFeedback({ type: 'warn', message: feedbackMsg });
          setLastScannedArticle({
            name: matchedItem.product_name,
            ref: matchedItem.product_ref,
            qty: matchedItem.quantity,
            unit: matchedItem.unit,
            already: true,
          });
        } else {
          // Article reconnu par le scan !
          // Conformément à la consigne : l'article doit obligatoirement être scanné ET la quantité encodée par le préparateur
          const catalogItem = products.find((p) => String(p.id) === String(matchedItem.product_id));
          playScanBeep(true);
          setScanValidationModal({
            open: true,
            order: targetOrder,
            item: matchedItem,
            catalogProduct: catalogItem,
            barcodeInput: code,
            isBarcodeMatched: true,
            encodedQuantity: matchedItem.quantity,
            errorMsg: null,
          });

          if (isCameraSource) {
            handleCloseScanner();
          }
        }
        setBarcodeScanInput('');
        setManualScanInput('');
        return;
      }

      // 2. Not in this order checklist: check if it's a known product from catalog for substitution!
      if (catalogProd) {
        playScanBeep(false);
        const unpickedItem = targetOrder.items.find((it) => !it.picked || it.unavailable);
        if (unpickedItem) {
          setSubstitutionTargetOrder(targetOrder);
          setSubstitutionTargetItem(unpickedItem);
          setSubstituteSearchQuery(catalogProd.reference);
          const feedbackMsg = tr(language, `Article scanné (${catalogProd.reference}) ne fait pas partie de la commande. Prêt pour substitution !`, `Scanned item not in order. Ready for substitution!`);
          setScanFeedback({ type: 'warn', message: feedbackMsg });
        } else {
          const feedbackMsg = tr(language, `Article scanné (${catalogProd.reference}) introuvable dans cette commande.`, `Scanned item not in this order.`);
          setScanFeedback({ type: 'error', message: feedbackMsg });
        }
      } else {
        playScanBeep(false);
        const feedbackMsg = tr(language, `❌ Référence / Code-barres « ${code} » inconnu au catalogue.`, `❌ Unknown code "${code}".`);
        setScanFeedback({ type: 'error', message: feedbackMsg });
      }
      setBarcodeScanInput('');
      setManualScanInput('');
    },
    [products, language, handleCloseScanner, isOrderAssignedToOther]
  );

  const handleOpenItemScanValidation = useCallback(
    (order: MaterialOrder, item: (MaterialOrder['items'])[0]) => {
      if (isOrderAssignedToOther(order)) {
        alert(
          tr(language, `Action refusée : Cette commande est assignée à ${order.preparer_name || 'un autre préparateur'}. Seul ce préparateur ou un administrateur peut modifier cette préparation.`, `Action blocked: This order is assigned to ${order.preparer_name || 'another preparer'}.`)
        );
        return;
      }

      if (item.picked) {
        if (
          confirm(
            tr(language, `Voulez-vous annuler le pointage de l'article "${item.product_name}" ?`, `Do you want to cancel the verification of "${item.product_name}"?`)
          )
        ) {
          unpickOrderItem(order.id, item.product_id);
        }
        return;
      }

      const catalogItem = products.find((p) => String(p.id) === String(item.product_id));
      setScanValidationModal({
        open: true,
        order,
        item,
        catalogProduct: catalogItem,
        barcodeInput: '',
        isBarcodeMatched: false,
        encodedQuantity: item.quantity,
        errorMsg: null,
      });
    },
    [isOrderAssignedToOther, products, unpickOrderItem, language]
  );

  const handleCheckBarcodeInput = useCallback(
    (inputCode: string) => {
      if (!scanValidationModal) return;
      const clean = inputCode.trim();
      const item = scanValidationModal.item;
      const catalogItem = scanValidationModal.catalogProduct;

      if (!clean) {
        setScanValidationModal((prev) => (prev ? { ...prev, barcodeInput: '', isBarcodeMatched: false, errorMsg: null } : null));
        return;
      }

      const matchedInOrder = findOrderItemByCode(
        { ...scanValidationModal.order, items: [item] },
        clean,
        catalogItem ? [catalogItem] : products
      );
      const matches = Boolean(matchedInOrder);

      if (matches) {
        playScanBeep(true);
        setScanValidationModal((prev) =>
          prev
            ? {
                ...prev,
                barcodeInput: clean,
                isBarcodeMatched: true,
                errorMsg: null,
              }
            : null
        );
      } else {
        playScanBeep(false);
        setScanValidationModal((prev) =>
          prev
            ? {
                ...prev,
                barcodeInput: clean,
                isBarcodeMatched: false,
                errorMsg:
                  tr(language, `❌ Code « ${clean} » non conforme. Attendu : ${item.product_ref} ou code-barres fabricant.`, `❌ Code "${clean}" does not match.`),
              }
            : null
        );
      }
    },
    [scanValidationModal, language]
  );

  const handleSubmitScanValidation = useCallback(() => {
    if (!scanValidationModal) return;
    const { order, item, barcodeInput, isBarcodeMatched, encodedQuantity } = scanValidationModal;

    if (!isBarcodeMatched) {
      setScanValidationModal((prev) =>
        prev
          ? {
              ...prev,
              errorMsg:
                tr(language, "Veuillez obligatoirement scanner le code-barres / QR de l'article pour valider sa conformité.", 'Please scan the item barcode to verify conformity.'),
            }
          : null
      );
      return;
    }

    if (!encodedQuantity || encodedQuantity <= 0) {
      setScanValidationModal((prev) =>
        prev
          ? {
              ...prev,
              errorMsg:
                tr(language, 'Veuillez encoder la quantité préparée (supérieure à 0).', 'Please encode a valid quantity > 0.'),
            }
          : null
      );
      return;
    }

    const res = validateOrderItemScanned(
      order.id,
      item.product_id,
      encodedQuantity,
      barcodeInput.trim() || item.product_ref
    );

    if (res.success) {
      hapticFeedback.medium();
      setScanFeedback({
        type: 'success',
        message:
          tr(language, `✅ Article validé : ${item.product_name} (${encodedQuantity} pcs encodées)`, `✅ Item verified: ${item.product_name} (${encodedQuantity} pcs)`),
      });
      setLastScannedArticle({
        name: item.product_name,
        ref: item.product_ref,
        qty: encodedQuantity,
        unit: item.unit,
        already: false,
      });
      setScanValidationModal(null);
    } else {
      setScanValidationModal((prev) => (prev ? { ...prev, errorMsg: res.message } : null));
    }
  }, [scanValidationModal, validateOrderItemScanned, language]);

  const handleScanOrSubmitBarcode = useCallback(
    (rawCode: string, targetOrder: MaterialOrder) => {
      handleProcessBarcodeMatch(rawCode, targetOrder, false);
    },
    [handleProcessBarcodeMatch]
  );

  const handleProcessBarcodeMatchRef = useRef(handleProcessBarcodeMatch);
  useEffect(() => {
    handleProcessBarcodeMatchRef.current = handleProcessBarcodeMatch;
  }, [handleProcessBarcodeMatch]);

  // Camera stream & scanning loop
  useEffect(() => {
    if (!isCameraScannerOpen || !scannerTargetOrder) {
      stopCamera();
      return;
    }

    let isSubscribed = true;
    let nativeDetector: any = null;
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        // @ts-expect-error Native BarcodeDetector
        nativeDetector = new window.BarcodeDetector({
          formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e'],
        });
      } catch {
        nativeDetector = null;
      }
    }

    openSmartphoneCameraStream()
      .then(async (stream) => {
        if (!isSubscribed) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        if (track && track.getCapabilities) {
          const cap = track.getCapabilities() as any;
          setHasTorch(Boolean(cap?.torch));
        }

        if (videoRef.current) {
          await attachStreamToVideoElement(videoRef.current, stream);
        }

        const scanLoop = async () => {
          if (!videoRef.current || !canvasRef.current || !isSubscribed) return;
          const video = videoRef.current;
          const canvas = canvasRef.current;

          if (video.readyState >= 2 && video.videoWidth > 0 && canvas && !isCooldownRef.current) {
            // 1. Try Native BarcodeDetector
            if (nativeDetector) {
              try {
                const barcodes = await nativeDetector.detect(video);
                if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                  const val = barcodes[0].rawValue;
                  isCooldownRef.current = true;
                  handleProcessBarcodeMatchRef.current(val, scannerTargetOrder, true);
                  setTimeout(() => {
                    isCooldownRef.current = false;
                  }, 1400);
                  animFrameRef.current = requestAnimationFrame(scanLoop);
                  return;
                }
              } catch {}
            }

            // 2. Fallback Canvas with jsQR and ZXing
            if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
            }
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

              // Check QR code
              const qr = jsQR(imgData.data, imgData.width, imgData.height, {
                inversionAttempts: 'dontInvert',
              });
              if (qr && qr.data) {
                isCooldownRef.current = true;
                handleProcessBarcodeMatchRef.current(qr.data, scannerTargetOrder, true);
                setTimeout(() => {
                  isCooldownRef.current = false;
                }, 1400);
                animFrameRef.current = requestAnimationFrame(scanLoop);
                return;
              }

              // Check 1D Barcode with ZXing
              const barcode1D = decodeBarcodeFromCanvas(canvas);
              if (barcode1D) {
                isCooldownRef.current = true;
                handleProcessBarcodeMatchRef.current(barcode1D, scannerTargetOrder, true);
                setTimeout(() => {
                  isCooldownRef.current = false;
                }, 1400);
                animFrameRef.current = requestAnimationFrame(scanLoop);
                return;
              }
            }
          }
          animFrameRef.current = requestAnimationFrame(scanLoop);
        };

        animFrameRef.current = requestAnimationFrame(scanLoop);
      })
      .catch((err) => {
        console.warn('Camera access denied or failed:', err);
        setCameraError(
          tr(language, 'Impossible d’accéder à la caméra. Autorisez la caméra ou saisissez le code ci-dessous.', 'Camera access denied. Please enter the barcode manually.')
        );
      });

    return () => {
      isSubscribed = false;
      stopCamera();
    };
  }, [isCameraScannerOpen, scannerTargetOrder, stopCamera, language]);

  if (!preparerOrdersModalOpen) return null;

  if (!canAccessPrep) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs">
        <div className="bg-white dark:bg-slate-900 max-w-md w-full p-6 rounded-3xl text-center space-y-3 border border-slate-200 dark:border-slate-800 shadow-2xl">
          <AlertCircle className="w-12 h-12 text-rose-500 mx-auto" />
          <h3 className="text-base font-bold text-slate-900 dark:text-white">Accès Non Autorisé</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Ce menu est réservé aux <strong>Préparateurs</strong>. Pour être Préparateur, votre département doit comporter l'option « Préparateurs » cochée et votre profil utilisateur doit être configuré sur « Préparateur : OUI ».
          </p>
          <button
            type="button"
            onClick={() => setPreparerOrdersModalOpen(false)}
            className="px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold cursor-pointer hover:bg-slate-700"
          >
            Fermer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setPreparerOrdersModalOpen(false);
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/80 backdrop-blur-xs animate-fadeIn"
    >
      <div className="bg-white dark:bg-slate-900 w-full max-w-4xl lg:max-w-5xl xl:max-w-6xl rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[95dvh] sm:max-h-[94vh] h-[94dvh] sm:h-auto">
        {/* Header Bar */}
        <div className="p-3 sm:p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 bg-gradient-to-r from-blue-600/10 via-indigo-600/10 to-transparent">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-600/30 shrink-0">
              <Package className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-white truncate">
                  {tr(language, 'Préparation des Commandes Magasin', 'Warehouse Order Fulfillment')}
                </h2>
                {pendingCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-orange-500 text-white animate-pulse shrink-0">
                    {pendingCount} {tr(language, 'À préparer', 'Pending')}
                  </span>
                )}
              </div>
              <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 truncate">
                {tr(language, 'Gestion des commandes chantiers : assignation, pointage des pièces et mise à disposition', 'Order fulfillment, picking checklist, stock unavailability and readiness')}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-1.5 sm:gap-2 shrink-0">
            {canOpenScannerMode && (
              <button
                type="button"
                onClick={() => {
                  setPreparerOrdersModalOpen(false);
                  openScannerPickingMode(focusedOrderId || undefined);
                }}
                className="py-1.5 px-2.5 sm:px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs flex items-center gap-1.5 shadow-sm shadow-emerald-600/30 transition active:scale-95 cursor-pointer"
                title={t('scanner_mode_subtitle')}
              >
                <Scan className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>{t('scanner_mode_btn')}</span>
              </button>
            )}

            {orders.some((o) => o.status === 'PENDING' || o.status === 'PREPARING') && (
              <button
                type="button"
                onClick={() => {
                  const target = orders.find((o) => o.status === 'PREPARING') || orders.find((o) => o.status === 'PENDING');
                  if (target) {
                    handleOpenScanner(target);
                  }
                }}
                className="py-1.5 px-2.5 sm:px-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-black text-xs flex items-center gap-1.5 shadow-sm shadow-purple-600/30 transition active:scale-95 cursor-pointer"
                title="Scanner les articles d'une commande à préparer"
              >
                <Camera className="w-3.5 h-3.5 stroke-[2.5]" />
                <span className="hidden sm:inline">{tr(language, 'Scanner articles', 'Scan items')}</span>
                <span className="sm:hidden">{tr(language, 'Scanner', 'Scan')}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setPreparerOrdersModalOpen(false)}
              className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {focusedOrderId ? (
          (() => {
            const focusedOrder = orders.find((o) => o.id === focusedOrderId);
            if (!focusedOrder) return null;
            const isPending = focusedOrder.status === 'PENDING';
            const isPreparing = focusedOrder.status === 'PREPARING';
            const isReady = focusedOrder.status === 'READY';
            const isCollected = focusedOrder.status === 'COLLECTED';
            const totalItems = focusedOrder.items.length;
            const pickedItems = focusedOrder.items.filter((i) => i.picked).length;
            const allConfirmed = canFinishOrder(focusedOrder);
            const isAssignedToOther = isOrderAssignedToOther(focusedOrder);
            const isAssignedToMe = Boolean(focusedOrder.preparer_id && String(focusedOrder.preparer_id) === String(currentUser?.id));
            const canAssign = isPreparer && (focusedOrder.preparer_id === null || focusedOrder.preparer_id === undefined) && !isAssignedToOther;
            const canMarkReady = isPreparer && (isPreparing || isPending) && !isAssignedToOther;

            return (
              <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-4 bg-slate-50/60 dark:bg-slate-950/60 flex flex-col">
                {/* Focus Bar */}
                <div className="flex items-center justify-between gap-2 p-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex-wrap">
                  <button
                    type="button"
                    onClick={() => setFocusedOrderId(null)}
                    className="py-1.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>{tr(language, '← Revenir à la liste des commandes', '← Back to orders')}</span>
                  </button>

                  <div className="flex items-center gap-2">
                    {canOpenScannerMode && !(isReady || isCollected) && !isAssignedToOther && (
                      <button
                        type="button"
                        onClick={() => {
                          setPreparerOrdersModalOpen(false);
                          openScannerPickingMode(focusedOrder.id);
                        }}
                        className="py-1.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs flex items-center gap-1.5 shadow-md shadow-emerald-600/30 transition active:scale-95 cursor-pointer"
                      >
                        <Scan className="w-4 h-4 stroke-[2.5]" />
                        <span>{t('scanner_mode_btn')}</span>
                      </button>
                    )}
                    {!(isReady || isCollected) && !isAssignedToOther && (
                      <button
                        type="button"
                        onClick={() => handleOpenScanner(focusedOrder)}
                        className="py-1.5 px-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-black text-xs flex items-center gap-1.5 shadow-md shadow-purple-600/30 transition active:scale-95 cursor-pointer"
                      >
                        <Camera className="w-4 h-4 stroke-[2.5]" />
                        <span>{tr(language, 'Scanner les articles', 'Scan items')}</span>
                      </button>
                    )}
                    <span className="px-2.5 py-1 rounded-full text-xs font-black bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-800 flex items-center gap-1">
                      <Target className="w-3.5 h-3.5 text-purple-600 animate-pulse" />
                      <span>{tr(language, 'Mode Focus Préparation (Anti-Distraction)', 'Exclusive Focus Mode')}</span>
                    </span>
                  </div>
                </div>

                {/* Exclusive assignment locked warning for other preparers */}
                {isAssignedToOther && (
                  <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 text-xs flex items-center gap-3 shadow-xs animate-fadeIn">
                    <Lock className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
                    <div className="flex-1">
                      <strong className="text-sm">
                        {tr(language, 'Commande verrouillée en mode consultation', 'Order locked in read-only mode')}
                      </strong>
                      <p className="text-[11px] text-amber-800 dark:text-amber-300 mt-0.5">
                        {tr(language, `Cette commande est actuellement prise en charge par ${focusedOrder.preparer_name || 'un autre préparateur'}. Un préparateur ne peut pas modifier la commande d'un collègue. Les pointages, substitutions et mises à disposition sont réservés à ce préparateur ou à un administrateur.`, `This order is assigned to ${focusedOrder.preparer_name || 'another preparer'}. Only they or an administrator can modify items, scan barcodes, or mark it ready.`)}
                      </p>
                    </div>
                  </div>
                )}

                {/* Focus Order Banner */}
                <div className="p-4 bg-white dark:bg-slate-900 rounded-3xl border border-purple-200 dark:border-purple-900/60 shadow-md space-y-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-black text-sm px-2.5 py-1 rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900">
                          {focusedOrder.order_number}
                        </span>
                        <span className="text-xs font-black px-2.5 py-1 rounded-xl bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-300 flex items-center gap-1">
                          <Building2 className="w-3.5 h-3.5" />
                          <span>Chantier {focusedOrder.site_number}</span>
                        </span>
                        {focusedOrder.depot_name && (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                            🏢 {focusedOrder.depot_name}
                          </span>
                        )}
                      </div>

                      <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-3 flex-wrap">
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          Demandeur : <strong>{focusedOrder.requester_name}</strong>
                          {focusedOrder.requester_department && ` (${focusedOrder.requester_department})`}
                        </span>
                        <span>•</span>
                        <span>Créée le {new Date(focusedOrder.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                      </div>

                      {focusedOrder.notes && (
                        <div className="mt-2 p-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-xs text-amber-800 dark:text-amber-200">
                          <strong>Note demandeur :</strong> {focusedOrder.notes}
                        </div>
                      )}
                    </div>

                    {/* Status Pill */}
                    <div>
                      {isPending && (
                        <span className="px-3 py-1.5 rounded-xl text-xs font-black bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200 border border-amber-300 flex items-center gap-1.5">
                          <Clock className="w-4 h-4 text-amber-600" />
                          <span>À Préparer</span>
                        </span>
                      )}
                      {isPreparing && (
                        <span className="px-3 py-1.5 rounded-xl text-xs font-black bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200 border border-blue-300 flex items-center gap-1.5">
                          <Clock className="w-4 h-4 text-blue-600 animate-spin" />
                          <span>En Préparation : {focusedOrder.preparer_name || 'Moi'}</span>
                        </span>
                      )}
                      {isReady && (
                        <span className="px-3 py-1.5 rounded-xl text-xs font-black bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200 border border-purple-300 flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-purple-600" />
                          <span>Prête au Retrait (Zone: {focusedOrder.pickup_zone || 'Retrait'})</span>
                        </span>
                      )}
                      {isCollected && (
                        <span className="px-3 py-1.5 rounded-xl text-xs font-black bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200 border border-emerald-300 flex items-center gap-1.5">
                          <PackageCheck className="w-4 h-4 text-emerald-600" />
                          <span>Retirée par le demandeur</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Progress Indicator */}
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
                      <span>Progression du Pointage :</span>
                      <span>
                        {pickedItems} / {totalItems} articles confirmés ({totalItems > 0 ? Math.round((pickedItems / totalItems) * 100) : 0}%)
                      </span>
                    </div>
                    <div className="w-full h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-purple-500 to-emerald-500 transition-all duration-300"
                        style={{ width: `${totalItems > 0 ? Math.round((pickedItems / totalItems) * 100) : 0}%` }}
                      ></div>
                    </div>
                  </div>
                </div>

                {/* Scan Barcode / QR Code Quick Input */}
                {!(isReady || isCollected) && !isAssignedToOther && (
                  <div className="p-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex flex-wrap items-center justify-between gap-1">
                      <span className="flex items-center gap-1.5">
                        <Scan className="w-4 h-4 text-purple-600 shrink-0" />
                        <span>Scanner un article au code-barres / QR / Réf pour pointer :</span>
                      </span>
                      <span className="text-[10px] text-slate-400">Appuyez sur Entrée après scan</span>
                    </label>

                    <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                      <div className="relative flex-1 min-w-[180px]">
                        <Barcode className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={barcodeScanInput}
                          onChange={(e) => setBarcodeScanInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleScanOrSubmitBarcode(barcodeScanInput, focusedOrder);
                            }
                          }}
                          placeholder="Scannez ou saisissez la référence ou le code-barres..."
                          className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-purple-500 font-mono font-bold"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleScanOrSubmitBarcode(barcodeScanInput, focusedOrder)}
                        className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center gap-1.5 transition active:scale-95 cursor-pointer shrink-0"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Valider scan</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenScanner(focusedOrder)}
                        className="py-2 px-3.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-black text-xs flex items-center gap-1.5 shadow-md shadow-purple-600/30 transition active:scale-95 cursor-pointer shrink-0"
                        title={tr(language, 'Ouvrir le viseur caméra pour scanner les articles', 'Open camera to scan items')}
                      >
                        <Camera className="w-4 h-4 stroke-[2.5]" />
                        <span>{tr(language, 'Scanner Caméra', 'Camera Scan')}</span>
                      </button>
                    </div>

                    {scanFeedback && (
                      <div
                        className={`p-2 rounded-xl text-xs font-bold flex items-center justify-between ${
                          scanFeedback.type === 'success'
                            ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                            : scanFeedback.type === 'warn'
                            ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                            : 'bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-800'
                        }`}
                      >
                        <span>{scanFeedback.message}</span>
                        <button
                          type="button"
                          onClick={() => setScanFeedback(null)}
                          className="text-slate-400 hover:text-slate-600 text-xs ml-2 cursor-pointer"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Checklist of Items */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-extrabold text-slate-800 dark:text-slate-200 px-1">
                    <span>Articles à pointer ({focusedOrder.items.length}) :</span>
                    <span className="text-[11px] text-slate-400 font-normal">
                      Cochez chaque article ou scannez-le au fur et à mesure de la mise en bac
                    </span>
                  </div>

                  {focusedOrder.items.map((it, idx) => {
                    const isPicked = Boolean(it.picked);
                    const isUnavailable = Boolean(it.unavailable);
                    const isSubstituted = Boolean(it.substituted);

                    return (
                      <div
                        key={idx}
                        className={`p-3.5 rounded-2xl border transition shadow-2xs space-y-2 ${
                          isPicked
                            ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800'
                            : isUnavailable
                            ? 'bg-rose-50/60 dark:bg-rose-950/20 border-rose-300 dark:border-rose-800'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2.5 flex-wrap">
                          {/* Left: Checkbox & Name */}
                          <div className="flex items-start gap-2.5 min-w-[150px] flex-1">
                            <button
                              type="button"
                              disabled={isReady || isCollected || isAssignedToOther}
                              onClick={() => {
                                if (isReady || isCollected) return;
                                handleOpenItemScanValidation(focusedOrder, it);
                              }}
                              className={`w-7 h-7 sm:w-8 sm:h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 transition ${
                                isReady || isCollected || isAssignedToOther
                                  ? 'cursor-not-allowed opacity-60'
                                  : 'cursor-pointer active:scale-95'
                              } ${
                                isPicked
                                  ? 'bg-emerald-600 text-white shadow-xs'
                                  : 'bg-slate-100 dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-600 text-transparent'
                              }`}
                              title={
                                isAssignedToOther
                                  ? `Verrouillée pour les autres préparateurs (Assignée à ${focusedOrder.preparer_name})`
                                  : isPicked
                                  ? 'Cliquer pour dépointer'
                                  : 'Scanner et encoder la quantité'
                              }
                            >
                              <Check className="w-4 h-4 stroke-[3]" />
                            </button>

                            <div>
                              <div className="font-extrabold text-xs text-slate-900 dark:text-white flex items-center gap-1.5 flex-wrap">
                                <span className={isUnavailable ? 'line-through text-slate-400' : ''}>
                                  {it.product_name}
                                </span>
                                <span className="font-mono text-[11px] text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                                  {it.product_ref}
                                </span>
                              </div>

                              {/* Picked Status Badge with Encoded Quantity */}
                              {isPicked && (
                                <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 text-[11px] font-bold border border-emerald-300 dark:border-emerald-800">
                                    <Check className="w-3 h-3 text-emerald-600 stroke-[3]" />
                                    <span>Scanné & validé : <strong>{it.picked_quantity || it.quantity}</strong> {it.unit || 'pcs'}</span>
                                  </span>
                                  {it.scanned_barcode && (
                                    <span className="text-[10px] font-mono text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                                      Code: {it.scanned_barcode}
                                    </span>
                                  )}
                                </div>
                              )}

                              {/* Substituted badge */}
                              {isSubstituted && (
                                <div className="mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200 text-[11px] font-bold border border-amber-300 dark:border-amber-800">
                                  <RefreshCw className="w-3 h-3 text-amber-600" />
                                  <span>Substitué par : {it.substituted_with_ref} - {it.substituted_with_name}</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Right: Quantity & Quick Scan */}
                          <div className="flex items-center gap-2 shrink-0">
                            {!isPicked && !isUnavailable && !(isReady || isCollected) && !isAssignedToOther && (
                              <button
                                type="button"
                                onClick={() => handleOpenScanner(focusedOrder)}
                                className="p-1.5 rounded-xl bg-purple-50 dark:bg-purple-950/60 hover:bg-purple-100 text-purple-600 dark:text-purple-300 transition cursor-pointer"
                                title={tr(language, 'Scanner cet article à la caméra', 'Scan this item with camera')}
                              >
                                <Camera className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <span className="font-mono font-black text-sm text-slate-900 dark:text-white">
                              {it.quantity} {it.unit || 'pcs'}
                            </span>
                          </div>
                        </div>

                        {/* Unavailable & Substitution Actions Row */}
                        {!(isReady || isCollected) && !isAssignedToOther && (
                          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/80 text-xs flex-wrap">
                            <label className="flex items-center gap-1.5 font-bold text-rose-600 dark:text-rose-400 cursor-pointer text-[11px]">
                              <input
                                type="checkbox"
                                checked={isUnavailable}
                                onChange={(e) =>
                                  updateOrderItemAvailability(
                                    focusedOrder.id,
                                    it.product_id,
                                    e.target.checked,
                                    e.target.checked ? it.unavailable_comment || 'Rupture magasin' : ''
                                  )
                                }
                                className="accent-rose-600 rounded"
                              />
                              <span>Signaler indisponible / Rupture</span>
                            </label>

                            {isUnavailable && (
                              <button
                                type="button"
                                onClick={() => handleOpenSubstitutionModal(focusedOrder, it)}
                                className="py-1 px-2.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-[11px] shadow-2xs flex items-center gap-1 transition cursor-pointer"
                              >
                                <RefreshCw className="w-3 h-3" />
                                <span>Substitution en 1 Clic</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Bottom Action Footer for Focus Mode */}
                <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setFocusedOrderId(null)}
                    className="py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                  >
                    ← Quitter le Mode Focus
                  </button>

                  <div className="flex items-center gap-2 flex-wrap">
                    {isPending && canAssign && !isAssignedToOther && (
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await assignOrderToMe(focusedOrder.id);
                          if (!res.success) alert(res.message);
                        }}
                        className="py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs shadow-md transition active:scale-95 cursor-pointer flex items-center gap-1.5"
                      >
                        <UserCheck className="w-4 h-4" />
                        <span>Prendre en charge cette commande</span>
                      </button>
                    )}

                    {isAssignedToOther && (
                      <div className="py-2 px-3 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 text-xs font-bold flex items-center gap-2 border border-amber-300 dark:border-amber-700">
                        <Lock className="w-4 h-4 text-amber-600" />
                        <span>{tr(language, `Verrouillée : Préparateur ${focusedOrder.preparer_name}`, `Locked : Assigned to ${focusedOrder.preparer_name}`)}</span>
                      </div>
                    )}

                    {isPreparing && canMarkReady && !isAssignedToOther && (
                      <button
                        type="button"
                        onClick={() => handleInitiateMarkReady(focusedOrder)}
                        className={`py-2.5 px-4 rounded-xl font-extrabold text-xs shadow-md transition active:scale-95 cursor-pointer flex items-center gap-1.5 ${
                          allConfirmed
                            ? 'bg-purple-600 hover:bg-purple-700 text-white shadow-purple-600/30'
                            : 'bg-purple-400 text-white cursor-pointer'
                        }`}
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Mettre en Prête (Sélectionner la zone)</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handlePrintOrderSlipDirect(focusedOrder)}
                      className="py-2.5 px-3 rounded-xl bg-purple-100 hover:bg-purple-200 dark:bg-purple-950/80 dark:hover:bg-purple-900 text-purple-800 dark:text-purple-200 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
                      title="Imprimer le bon de préparation / retrait (A4/A5)"
                    >
                      <Printer className="w-3.5 h-3.5 text-purple-600" />
                      <span>{tr(language, 'Imprimer Bon', 'Print Slip')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenThermalLabelModal(focusedOrder)}
                      className="py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
                      title="Étiquette de bac thermique 60x40 ou 100x150"
                    >
                      <Tag className="w-3.5 h-3.5 text-orange-400 dark:text-orange-600" />
                      <span>{tr(language, 'Étiquette Bac', 'Label')}</span>
                    </button>

                    {(isReady || isCollected) && (
                      <button
                        type="button"
                        onClick={() => handleOpenViewQrCode(focusedOrder)}
                        className="py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs flex items-center gap-1.5 hover:bg-slate-200 transition cursor-pointer"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                        <span>{tr(language, 'Voir QR', 'View QR')}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })()
        ) : (
          <>
            {/* Filter Pills Bar */}
            <div className="p-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 space-y-2.5">
          {/* Status Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 pb-1 text-xs font-bold">
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className={`px-3 py-1.5 rounded-xl transition cursor-pointer shrink-0 flex items-center gap-1.5 ${
                statusFilter === 'ALL'
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-xs'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
              }`}
            >
              <span>{tr(language, 'Toutes', 'All')}</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                {visibleOrders.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('WAITING_APPROVAL')}
              className={`px-3 py-1.5 rounded-xl transition cursor-pointer shrink-0 flex items-center gap-1.5 ${
                statusFilter === 'WAITING_APPROVAL'
                  ? 'bg-purple-700 text-white shadow-xs'
                  : 'bg-white dark:bg-slate-800 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 hover:bg-purple-50 dark:hover:bg-purple-950/40'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>{tr(language, 'À Valider', 'To Approve')}</span>
              {waitingApprovalCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-purple-100 text-purple-900 font-black">
                  {waitingApprovalCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('PENDING')}
              className={`px-3 py-1.5 rounded-xl transition cursor-pointer shrink-0 flex items-center gap-1.5 ${
                statusFilter === 'PENDING'
                  ? 'bg-orange-500 text-white shadow-xs'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
              }`}
            >
              <span>{tr(language, 'À Préparer', 'Pending')}</span>
              {pendingCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300 font-black">
                  {pendingCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('PREPARING')}
              className={`px-3 py-1.5 rounded-xl transition cursor-pointer shrink-0 flex items-center gap-1.5 ${
                statusFilter === 'PREPARING'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
              }`}
            >
              <span>{tr(language, 'En Cours', 'In Prep')}</span>
              {preparingCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 font-black">
                  {preparingCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('READY')}
              className={`px-3 py-1.5 rounded-xl transition cursor-pointer shrink-0 flex items-center gap-1.5 ${
                statusFilter === 'READY'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
              }`}
            >
              <span>{tr(language, 'Prêtes au Retrait', 'Ready for Pickup')}</span>
              {readyCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 font-black">
                  {readyCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('COLLECTED')}
              className={`px-3 py-1.5 rounded-xl transition cursor-pointer shrink-0 flex items-center gap-1.5 ${
                statusFilter === 'COLLECTED'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
              }`}
            >
              <span>{tr(language, 'Retirées (< 24h)', 'Collected (< 24h)')}</span>
              {collected24hCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-black">
                  {collected24hCount}
                </span>
              )}
            </button>
          </div>

          {/* Search bar & Depot Filter */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  tr(language, 'Rechercher par n° de commande, chantier, demandeur, référence...', 'Search by order #, site, requester, product...')
                }
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none"
              />
            </div>

            {/* Preparer Depot Selector or Fixed Depot badge */}
            {hasMultipleDepots ? (
              <div className="flex items-center gap-1.5 shrink-0">
                <Building2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <SearchableSelect
                  value={selectedDepotFilter}
                  onChange={(val) => setSelectedDepotFilter(val)}
                  recentKey="depots"
                  className="text-xs py-1.5 px-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 outline-none cursor-pointer"
                >
                  <option value="ALL">
                    {tr(language, '🏢 Tous mes dépôts', '🏢 All allowed depots')}
                  </option>
                  {userAllowedDepots.map((depName) => (
                    <option key={depName} value={depName}>
                      {depName}
                    </option>
                  ))}
                </SearchableSelect>
              </div>
            ) : singleAssignedDepot ? (
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-900 text-blue-800 dark:text-blue-300 text-xs font-bold shrink-0">
                <Building2 className="w-3.5 h-3.5 text-blue-600" />
                <span>{singleAssignedDepot}</span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Orders List Body: Compact Tiles styled exactly like MovementsView / InventoryView */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2.5">
          {filteredOrders.length === 0 ? (
            <div className="p-10 text-center text-slate-400 space-y-2">
              <Package className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-700 opacity-60" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                {tr(language, 'Aucune commande correspondante', 'No orders found')}
              </p>
              <p className="text-xs text-slate-400">
                {tr(language, 'Toutes les commandes retirées depuis plus de 24h sont automatiquement archivées.', 'Orders collected over 24h ago are automatically archived.')}
              </p>
            </div>
          ) : (
            filteredOrders.map((order) => {
              const isExpanded = expandedOrderIds.includes(order.id);
              const isWaitingApproval = order.status === 'WAITING_APPROVAL';
              const isPending = order.status === 'PENDING';
              const isPreparing = order.status === 'PREPARING';
              const isReady = order.status === 'READY';
              const isCollected = order.status === 'COLLECTED';
              const isAssignedToOther = isOrderAssignedToOther(order);
              const isAssignedToMe = Boolean(order.preparer_id && String(order.preparer_id) === String(currentUser?.id));

              // Calculate time remaining in the 24h window if collected
              let hoursLeft = 24;
              if (isCollected && order.collected_at) {
                const elapsedMs = Date.now() - new Date(order.collected_at).getTime();
                hoursLeft = Math.max(0, Math.round((24 * 3600 * 1000 - elapsedMs) / (3600 * 1000)));
              }

              // Quantities & picking count
              const totalItems = order.items.length;
              const pickedItems = order.items.filter((i) => i.picked).length;
              const totalQty = order.items.reduce((s, it) => s + (it.quantity || 0), 0);
              const unavailableItems = order.items.filter((i) => i.unavailable);
              const hasUnavailable = unavailableItems.length > 0;

              return (
                <div
                  key={order.id}
                  onClick={(e) => {
                    const target = e.target as HTMLElement;
                    if (!target.closest('button, input, select, textarea, a, label')) {
                      setFocusedOrderId(order.id);
                    }
                  }}
                  title={tr(language, 'Cliquer pour ouvrir cette commande en mode focus exclusif', 'Click to open in focus mode')}
                  className={`rounded-2xl border transition shadow-2xs hover:shadow-md p-3 sm:p-3.5 flex flex-col gap-2 cursor-pointer group hover:ring-2 hover:ring-purple-400/30 ${
                    isWaitingApproval
                      ? 'bg-purple-50/40 dark:bg-purple-950/20 border-purple-200 dark:border-purple-900/50 hover:border-purple-400 ring-1 ring-purple-500/20'
                      : isPending
                      ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50 hover:border-amber-400'
                      : isPreparing
                      ? 'bg-blue-50/40 dark:bg-blue-950/20 border-blue-300 dark:border-blue-900/50 hover:border-blue-400 ring-1 ring-blue-500/10'
                      : isReady
                      ? 'bg-purple-50/40 dark:bg-purple-950/20 border-purple-200 dark:border-purple-900/50 hover:border-purple-400'
                      : 'bg-emerald-50/30 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/50 hover:border-emerald-400 opacity-95'
                  }`}
                >
                  {/* Row 1: Header (Order #, Site, Status, Items Count) */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono font-black text-xs text-slate-900 dark:text-white bg-white dark:bg-slate-800 px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-700 shadow-2xs group-hover:border-purple-500 transition">
                        {order.order_number}
                      </span>

                      <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-300 flex items-center gap-1">
                        <Building2 className="w-3.5 h-3.5" />
                        <span>{order.site_number}</span>
                      </span>

                      {/* Status Badge */}
                      {isWaitingApproval && (
                        <span className="px-2 py-0.5 rounded-lg text-[11px] font-black bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-300 border border-purple-300 dark:border-purple-800 flex items-center gap-1 shadow-2xs">
                          <ShieldAlert className="w-3.5 h-3.5 text-purple-600" />
                          <span>{tr(language, 'À Valider', 'Waiting Approval')}</span>
                        </span>
                      )}
                      {isPending && (
                        <span className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                          ⏳ À Préparer
                        </span>
                      )}
                      {isPreparing && (
                        <span
                          className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border flex items-center gap-1 ${
                            isAssignedToMe
                              ? 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200 border-blue-400 dark:border-blue-700 shadow-2xs'
                              : isAssignedToOther
                              ? 'bg-amber-100/90 text-amber-900 dark:bg-amber-950/80 dark:text-amber-300 border-amber-300 dark:border-amber-700'
                              : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border-blue-300 dark:border-blue-800'
                          }`}
                        >
                          {isAssignedToOther ? (
                            <Lock className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
                          ) : (
                            <Clock className="w-3 h-3 animate-spin shrink-0" />
                          )}
                          <span>
                            {isAssignedToMe
                              ? (tr(language, 'Votre préparation', 'Your preparation'))
                              : isAssignedToOther
                              ? (tr(language, `Prise : ${order.preparer_name || 'Collègue'}`, `Assigned: ${order.preparer_name}`))
                              : `En cours : ${order.preparer_name || 'Magasinier'}`}
                          </span>
                        </span>
                      )}
                      {isReady && (
                        <span className="px-2 py-0.5 rounded-lg text-[11px] font-black bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 border border-purple-300 dark:border-purple-800 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-purple-600" />
                          <span>Prête</span>
                        </span>
                      )}
                      {isCollected && (
                        <span className="px-2 py-0.5 rounded-lg text-[11px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 flex items-center gap-1">
                          <PackageCheck className="w-3 h-3 text-emerald-600" />
                          <span>Retirée ({hoursLeft}h)</span>
                        </span>
                      )}

                      {/* Alert if unavailable items */}
                      {hasUnavailable && (
                        <span className="px-1.5 py-0.5 rounded-md text-[10px] font-extrabold bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border border-rose-300 dark:border-rose-800 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          <span>{unavailableItems.length} rupture</span>
                        </span>
                      )}
                    </div>

                    {/* Total units count */}
                    <div className="font-extrabold text-xs text-slate-800 dark:text-slate-200">
                      <span>{totalItems} réf.</span>
                      <span className="text-slate-400 dark:text-slate-500 font-normal ml-1">
                        ({totalQty} pcs)
                      </span>
                    </div>
                  </div>

                  {/* Row 2: Metadata (Requester, Dept, Date, Depot, Notes) */}
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
                    <span className="font-bold flex items-center gap-1 text-slate-800 dark:text-slate-200">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      <span>{order.requester_name}</span>
                      {order.requester_department && (
                        <span className="text-slate-500 font-normal">({order.requester_department})</span>
                      )}
                    </span>

                    <span>•</span>

                    <span className="text-[11px] text-slate-500 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      <span>
                        {new Date(order.created_at).toLocaleString('fr-FR', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </span>
                    </span>

                    {order.depot_name && (
                      <>
                        <span>•</span>
                        <span className="text-[11px] text-slate-500 font-medium">
                          🏢 {order.depot_name}
                        </span>
                      </>
                    )}

                    {order.notes && (
                      <>
                        <span>•</span>
                        <span className="text-[11px] text-amber-700 dark:text-amber-300 italic truncate max-w-[200px]">
                          ⚠️ {order.notes}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Row 3: Action Buttons (Preparer only: Assigner & Mettre en prête) + Accordion Toggle */}
                  <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-200/60 dark:border-slate-800/80 flex-wrap">
                    {/* Left: Accordion Expand Button */}
                    <button
                      type="button"
                      onClick={() => toggleExpand(order.id)}
                      className="text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center gap-1.5 transition cursor-pointer py-1 px-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      <span>
                        {tr(language, 'Détails & Pointage', 'Items & Picking')} ({pickedItems}/{totalItems})
                      </span>
                    </button>

                    {/* Right: Preparer Allowed Actions ONLY ("Assigner" and "Mettre en prête") */}
                    <div className="flex items-center gap-1.5 flex-wrap max-w-full ml-auto">
                      {/* Focus Mode Button (Anti-distraction) */}
                      <button
                        type="button"
                        onClick={() => setFocusedOrderId(order.id)}
                        className="py-1 px-2.5 rounded-xl bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/60 dark:hover:bg-purple-900/60 text-purple-700 dark:text-purple-300 font-extrabold text-[11px] border border-purple-200 dark:border-purple-800 transition active:scale-95 cursor-pointer flex items-center gap-1"
                        title={tr(language, 'Préparer seul en Mode Focus sans distraction', 'Focus Mode')}
                      >
                        <Focus className="w-3.5 h-3.5 text-purple-600" />
                        <span>{tr(language, 'Mode Focus', 'Focus')}</span>
                      </button>

                      {/* Action 0: Validation hiérarchique si en attente */}
                      {isWaitingApproval && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {canApproveOrder(order) ? (
                            <>
                              <button
                                type="button"
                                onClick={() => approveOrder(order.id)}
                                className="py-1.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs shadow-xs transition active:scale-95 cursor-pointer flex items-center gap-1"
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>{tr(language, 'Valider', 'Approve')}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const reason = prompt(
                                    tr(language, 'Indiquez le motif de refus de la commande :', 'Enter rejection reason:')
                                  );
                                  if (reason !== null && reason.trim()) {
                                    rejectOrder(order.id, reason.trim());
                                  }
                                }}
                                className="py-1.5 px-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-bold text-xs border border-rose-200 dark:border-rose-800 transition active:scale-95 cursor-pointer flex items-center gap-1"
                              >
                                <X className="w-3.5 h-3.5" />
                                <span>{tr(language, 'Refuser', 'Reject')}</span>
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                alert(
                                  tr(language, 'Accès refusé : Seuls les Chefs de Département & Suppléants et les Chefs de Chantier / Chefs de Projet & Suppléants du service rattaché (ou les administrateurs) peuvent valider ou refuser cette commande.', 'Access denied: Only department heads/deputies and site/project managers/deputies of the service (or administrators) can approve or reject this order.')
                                );
                              }}
                              className="text-[11px] font-bold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/40 px-2.5 py-1 rounded-xl border border-purple-200 dark:border-purple-800 flex items-center gap-1 hover:bg-purple-100 transition cursor-pointer"
                              title="Cliquez pour voir les conditions d'habilitation"
                            >
                              <ShieldAlert className="w-3.5 h-3.5 text-purple-600" />
                              <span>{tr(language, 'À valider par Chef de Service', 'Awaiting approval')}</span>
                            </button>
                          )}
                        </div>
                      )}

                      {/* Action 1: Assigner */}
                      {isPending && canAssign && !isAssignedToOther && (
                        <button
                          type="button"
                          onClick={() => assignOrderToMe(order.id)}
                          className="py-1.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition active:scale-95 cursor-pointer flex items-center gap-1"
                        >
                          <UserCheck className="w-3.5 h-3.5" />
                          <span>{tr(language, "M'assigner", 'Claim')}</span>
                        </button>
                      )}

                      {/* Indicateur si assignée à un autre préparateur */}
                      {isAssignedToOther && (
                        <span
                          className="text-[11px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 shadow-2xs"
                          title={tr(language, `Prise en charge par ${order.preparer_name || 'un autre préparateur'}. Non modifiable.`, `Assigned to ${order.preparer_name}. Read-only.`)}
                        >
                          <Lock className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
                          <span>{tr(language, `Prise : ${order.preparer_name || 'Collègue'}`, `Assigned: ${order.preparer_name}`)}</span>
                        </span>
                      )}

                      {/* Action Scanner Caméra */}
                      {(isPending || isPreparing) && !isAssignedToOther && (
                        <button
                          type="button"
                          onClick={() => handleOpenScanner(order)}
                          className="py-1.5 px-3 rounded-xl bg-purple-50 dark:bg-purple-950/60 hover:bg-purple-100 dark:hover:bg-purple-900/60 text-purple-700 dark:text-purple-300 font-bold text-xs border border-purple-200 dark:border-purple-800 shadow-2xs transition active:scale-95 cursor-pointer flex items-center gap-1.5"
                          title={tr(language, 'Scanner les articles de cette commande à la caméra', 'Scan items for this order with camera')}
                        >
                          <Camera className="w-3.5 h-3.5 text-purple-600 stroke-[2.5]" />
                          <span>{tr(language, 'Scanner', 'Scan')}</span>
                        </button>
                      )}

                      {/* Action 2: Mettre en prête */}
                      {isPreparing && canMarkReady && !isAssignedToOther && (
                        <button
                          type="button"
                          onClick={() => handleInitiateMarkReady(order)}
                          className="py-1.5 px-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-xs transition active:scale-95 cursor-pointer flex items-center gap-1"
                        >
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                          <span>{tr(language, 'Mettre en Prête', 'Mark Ready')}</span>
                        </button>
                      )}

                      {/* Info when Ready: Waiting for requester to collect */}
                      {isReady && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] font-bold text-purple-700 dark:text-purple-300 flex items-center gap-1 bg-purple-50 dark:bg-purple-950/40 px-2 py-1 rounded-lg border border-purple-200 dark:border-purple-800">
                            <MapPin className="w-3 h-3 text-purple-600" />
                            <span>{order.pickup_zone || 'Zone de retrait'}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => handleOpenViewQrCode(order)}
                            className="py-1 px-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-bold text-[11px] shadow-xs flex items-center gap-1 transition cursor-pointer"
                          >
                            <QrCode className="w-3 h-3" />
                            <span>{tr(language, 'Bon / QR Code', 'QR Slip')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenThermalLabelModal(order)}
                            className="py-1 px-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-[11px] shadow-xs flex items-center gap-1 transition cursor-pointer"
                            title="Format thermique 60x40 mm ou 100x150 mm"
                          >
                            <Tag className="w-3 h-3 text-orange-400" />
                            <span>{tr(language, 'Étiquette Bac', 'Label')}</span>
                          </button>
                        </div>
                      )}

                      {/* Info when Collected */}
                      {isCollected && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800">
                            <PackageCheck className="w-3 h-3 text-emerald-600" />
                            <span>Retirée ({order.collected_by || 'Demandeur'})</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => handleOpenViewQrCode(order)}
                            className="py-1 px-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-[11px] border border-slate-200 dark:border-slate-700 flex items-center gap-1 transition cursor-pointer"
                          >
                            <QrCode className="w-3 h-3 text-slate-500" />
                            <span>QR</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Expanded Section: Picking Checklist with Unavailable check & Comment */}
                  {isExpanded && (
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2 animate-fadeIn">
                      {/* Locking banner if ready or collected */}
                      {(isReady || isCollected) && (
                        <div className="p-2 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-xs font-bold text-purple-900 dark:text-purple-200 flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Lock className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                            <span>
                              {tr(language, `Commande prête au retrait (Zone : ${order.pickup_zone || 'Magasin'}). Pointage verrouillé.`, `Order ready in zone "${order.pickup_zone || 'Store'}". Picking locked.`)}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleOpenViewQrCode(order)}
                            className="text-[11px] text-purple-700 dark:text-purple-300 underline font-black cursor-pointer hover:opacity-80 shrink-0"
                          >
                            {tr(language, 'Voir le QR Code', 'View QR Code')}
                          </button>
                        </div>
                      )}

                      <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 flex items-center justify-between flex-wrap gap-2">
                        <span>
                          {tr(language, 'Pointage des articles & signalement de rupture :', 'Picking checklist & unavailability reporting:')}
                        </span>
                        <div className="flex items-center gap-2">
                          {!(isReady || isCollected) && !isAssignedToOther && (
                            <button
                              type="button"
                              onClick={() => handleOpenScanner(order)}
                              className="px-2.5 py-1 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-black text-[11px] flex items-center gap-1 shadow-2xs transition active:scale-95 cursor-pointer"
                              title={tr(language, 'Ouvrir la caméra pour pointer les pièces', 'Open camera to pick items')}
                            >
                              <Camera className="w-3.5 h-3.5 stroke-[2.5]" />
                              <span>{tr(language, 'Scanner à la caméra', 'Scan items')}</span>
                            </button>
                          )}
                          <span className="text-[10px] text-slate-400">
                            {isReady || isCollected
                              ? tr(language, '🔒 Modification verrouillée', '🔒 Modification locked')
                              : isAssignedToOther
                              ? tr(language, `🔒 Assignée à ${order.preparer_name || 'un collègue'}`, `🔒 Assigned to ${order.preparer_name}`)
                              : tr(language, 'Cochez chaque pièce ou scannez-la', 'Check items or scan them')}
                          </span>
                        </div>
                      </div>

                      {/* Items List */}
                      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden text-xs">
                        {order.items.map((it, idx) => (
                          <div
                            key={idx}
                            className={`p-2.5 transition flex flex-col gap-1.5 ${
                              it.unavailable
                                ? 'bg-rose-50/50 dark:bg-rose-950/20'
                                : it.picked
                                ? 'bg-emerald-50/50 dark:bg-emerald-950/20'
                                : ''
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              {/* Left: Checkbox Picking + Item info */}
                              <div className="flex items-center gap-2 min-w-[140px] flex-1">
                                <button
                                  type="button"
                                  disabled={isReady || isCollected || isAssignedToOther}
                                  onClick={() => {
                                    if (isReady || isCollected) return;
                                    handleOpenItemScanValidation(order, it);
                                  }}
                                  className={`transition shrink-0 ${
                                    isReady || isCollected || isAssignedToOther
                                      ? 'cursor-not-allowed opacity-60'
                                      : 'cursor-pointer active:scale-95'
                                  }`}
                                  title={
                                    isReady || isCollected
                                      ? 'Commande verrouillée'
                                      : isAssignedToOther
                                      ? `Verrouillée : Assignée à ${order.preparer_name}`
                                      : it.picked
                                      ? 'Cliquer pour dépointer'
                                      : 'Scanner et encoder la quantité'
                                  }
                                >
                                  {it.picked ? (
                                    <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" />
                                  ) : (
                                    <Square className="w-4 h-4 text-slate-400 shrink-0" />
                                  )}
                                </button>

                                <div className="min-w-0 flex-1">
                                  <div
                                    className={`font-bold truncate ${
                                      it.picked
                                        ? 'line-through text-slate-400 dark:text-slate-500'
                                        : 'text-slate-800 dark:text-slate-100'
                                    }`}
                                  >
                                    {it.product_name}
                                  </div>
                                  <div className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5 flex-wrap">
                                    <span>Réf: {it.product_ref}</span>
                                    {it.picked && (
                                      <span className="text-emerald-600 dark:text-emerald-400 font-bold not-italic">
                                        • Pointé : {it.picked_quantity || it.quantity} {it.unit || 'pcs'}
                                      </span>
                                    )}
                                    {it.picked && it.scanned_barcode && (
                                      <span className="text-[10px] text-slate-400 font-mono">
                                        [{it.scanned_barcode}]
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Right: Quantity + Quick Scan + Unavailable toggle */}
                              <div className="flex items-center gap-1.5 flex-wrap max-w-full ml-auto">
                                {!it.picked && !it.unavailable && !(isReady || isCollected) && !isAssignedToOther && (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenScanner(order)}
                                    className="p-1 rounded-lg bg-purple-50 dark:bg-purple-950/60 hover:bg-purple-100 text-purple-600 dark:text-purple-300 transition cursor-pointer"
                                    title={tr(language, 'Scanner cet article à la caméra', 'Scan this item with camera')}
                                  >
                                    <Camera className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <span className="px-2 py-0.5 rounded-lg bg-orange-100 dark:bg-orange-950/60 text-orange-800 dark:text-orange-300 font-black text-xs">
                                  {it.quantity} {it.unit || 'pièce'}
                                </span>

                                {/* Case "Non disponible" */}
                                <label
                                  className={`flex items-center gap-1 text-[11px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-2 py-1 rounded-lg border border-rose-200 dark:border-rose-900/60 select-none ${
                                    isReady || isCollected || isAssignedToOther ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    disabled={isReady || isCollected || isAssignedToOther}
                                    checked={Boolean(it.unavailable)}
                                    onChange={(e) =>
                                      !(isReady || isCollected || isAssignedToOther) &&
                                      updateOrderItemAvailability(
                                        order.id,
                                        it.product_id,
                                        e.target.checked,
                                        e.target.checked ? it.unavailable_comment || '' : ''
                                      )
                                    }
                                    className="accent-rose-600 rounded"
                                  />
                                  <span>{tr(language, 'Non disponible', 'Unavailable')}</span>
                                </label>
                              </div>
                            </div>

                            {/* Comment input if Non disponible is checked */}
                            {it.unavailable && (
                              <div className="pt-1.5 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 animate-fadeIn">
                                <div className="flex items-center gap-1.5 flex-1">
                                  <MessageSquare className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                                  <input
                                    type="text"
                                    disabled={isReady || isCollected || isAssignedToOther}
                                    value={it.unavailable_comment || ''}
                                    onChange={(e) =>
                                      !(isReady || isCollected || isAssignedToOther) &&
                                      updateOrderItemAvailability(
                                        order.id,
                                        it.product_id,
                                        true,
                                        e.target.value
                                      )
                                    }
                                    placeholder={
                                      tr(language, 'Commentaire pour le demandeur (ex: Rupture fournisseur...)', 'Note for requester (e.g., supplier out of stock...)')
                                    }
                                    className={`w-full text-xs p-1.5 px-2.5 rounded-lg bg-white dark:bg-slate-800 border border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200 outline-none ${
                                      isReady || isCollected || isAssignedToOther ? 'opacity-70 bg-slate-50 cursor-not-allowed' : ''
                                    }`}
                                  />
                                </div>

                                {/* 1-Click Substitution Button (User Requested) */}
                                <button
                                  type="button"
                                  disabled={isReady || isCollected || isAssignedToOther}
                                  onClick={() => handleOpenSubstitutionModal(order, it)}
                                  className="shrink-0 px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-black text-[11px] shadow-xs flex items-center justify-center gap-1 transition active:scale-95 cursor-pointer disabled:opacity-50"
                                >
                                  <RefreshCw className="w-3.5 h-3.5" />
                                  <span>{tr(language, 'Substituer en 1 clic', 'Substitute (1-click)')}</span>
                                </button>
                              </div>
                            )}

                            {/* Substituted Notice */}
                            {it.substituted && (
                              <div className="mt-1 p-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] font-bold text-amber-800 dark:text-amber-300 flex items-center justify-between animate-fadeIn">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <RefreshCw className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                  <span className="truncate">
                                    {tr(language, 'Substitué par :', 'Substituted with:')}{' '}
                                    <strong>{it.substituted_with_ref} - {it.substituted_with_name}</strong>
                                  </span>
                                </div>
                                <span className="text-[10px] bg-amber-200 dark:bg-amber-800 px-1.5 py-0.5 rounded text-amber-950 dark:text-amber-100 shrink-0 ml-2">
                                  {tr(language, 'Remplacement validé', 'Substituted')}
                                </span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Audit Log Timeline */}
                      <div className="p-2.5 rounded-xl bg-slate-100/70 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/80 text-[11px] space-y-1">
                        <div className="font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1">
                          <FileText className="w-3 h-3 text-blue-500" />
                          <span>Historique de commande :</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                          <div className="p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                            <span className="font-bold block text-slate-700 dark:text-slate-300">1. Reçue</span>
                            <span>{new Date(order.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <div className="p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                            <span className="font-bold block text-slate-700 dark:text-slate-300">2. Prise en charge</span>
                            <span>{order.assigned_at ? new Date(order.assigned_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                          </div>
                          <div className="p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                            <span className="font-bold block text-slate-700 dark:text-slate-300">3. Fin préparation</span>
                            <span>{order.ready_at ? new Date(order.ready_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                          </div>
                          <div className="p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                            <span className="font-bold block text-slate-700 dark:text-slate-300">4. Retrait</span>
                            <span>{order.collected_at ? new Date(order.collected_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
          </>
        )}
      </div>

      {/* MODAL 1: Mark Ready & Specify Pickup Zone & QR Code */}
      {markReadyTargetOrder && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSubmittingReady) {
              setMarkReadyTargetOrder(null);
            }
          }}
          className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-xs animate-fadeIn"
        >
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 animate-scaleUp">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-purple-100 dark:bg-purple-950/60 text-purple-600 flex items-center justify-center">
                  <Check className="w-4 h-4 stroke-[3]" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">
                    {tr(language, 'Mettre la commande en Prête', 'Mark Order as Ready')}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {markReadyTargetOrder.order_number} • {markReadyTargetOrder.site_number}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMarkReadyTargetOrder(null)}
                className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Pickup Zone Input */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-purple-600" />
                  <span>{tr(language, 'Zone ou étagère de retrait :', 'Pickup Zone / Shelf Location:')}</span>
                </span>
              </label>

              <input
                type="text"
                value={readyPickupZone}
                onChange={(e) => setReadyPickupZone(e.target.value)}
                placeholder={
                  tr(language, 'Ex: Étagère Retrait A1, Casier 3, Comptoir...', 'E.g. Shelf A1, Locker 3...')
                }
                className="w-full text-xs font-bold p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-purple-500/20"
              />

              {/* Quick suggestions presets */}
              <div className="space-y-1 pt-1">
                <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold">
                  <span>
                    {tr(language, `Zones préconfigurées pour ${markReadyTargetOrder.depot_name || 'ce dépôt'} :`, `Preconfigured zones for ${markReadyTargetOrder.depot_name || 'this depot'}:`)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(() => {
                    const targetDep = depots.find(
                      (d) => d.name.toLowerCase().trim() === (markReadyTargetOrder.depot_name || '').toLowerCase().trim()
                    );
                    const dynamicPresets =
                      targetDep?.pickup_zones && targetDep.pickup_zones.length > 0
                        ? targetDep.pickup_zones
                        : ['Casier A1', 'Casier A2', 'Zone Drive Magasin', 'Étagère Retrait 1'];
                    return dynamicPresets.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setReadyPickupZone(preset)}
                        className={`text-[10.5px] font-bold px-2.5 py-1 rounded-lg border transition cursor-pointer flex items-center gap-1 ${
                          readyPickupZone === preset
                            ? 'bg-purple-600 text-white border-purple-600 shadow-2xs'
                            : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-purple-400'
                        }`}
                      >
                        <MapPin className="w-3 h-3" />
                        <span>{preset}</span>
                      </button>
                    ));
                  })()}
                </div>
              </div>
            </div>

            {/* QR Code Preview & Info Box */}
            <div className="p-3 rounded-2xl bg-purple-50/60 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 flex items-center gap-3">
              {readyQrPreviewUrl ? (
                <img
                  src={readyQrPreviewUrl}
                  alt="QR Code Preview"
                  className="w-16 h-16 rounded-xl bg-white p-1 border border-purple-200 shrink-0 shadow-2xs"
                />
              ) : (
                <div className="w-16 h-16 rounded-xl bg-white dark:bg-slate-800 flex items-center justify-center shrink-0">
                  <QrCode className="w-8 h-8 text-purple-600" />
                </div>
              )}
              <div className="text-[11px] text-purple-900 dark:text-purple-200 leading-tight space-y-1">
                <div className="font-extrabold flex items-center gap-1 text-purple-700 dark:text-purple-300">
                  <Lock className="w-3 h-3" />
                  <span>{tr(language, 'Verrouillage automatique', 'Auto-lock')}</span>
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                  {tr(language, 'Une fois validée, la commande sera verrouillée. Le demandeur recevra une alerte avec l\'emplacement et scannera ce QR code au retrait.', 'Once ready, the order is locked. The requester will be notified to scan and pick it up.')}
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setMarkReadyTargetOrder(null)}
                disabled={isSubmittingReady}
                className="flex-1 py-2.5 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"
              >
                {tr(language, 'Annuler', 'Cancel')}
              </button>

              <button
                type="button"
                onClick={handleConfirmMarkReady}
                disabled={isSubmittingReady || !readyPickupZone.trim()}
                className="flex-1 py-2.5 px-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-extrabold text-xs shadow-md shadow-purple-600/30 flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5 stroke-[3]" />
                <span>
                  {isSubmittingReady
                    ? tr(language, 'Validation...', 'Saving...')
                    : tr(language, 'Confirmer la Mise en Prête', 'Confirm Ready')}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Unconfirmed Items Warning Dialog */}
      {unconfirmedWarningOrder && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setUnconfirmedWarningOrder(null);
            }
          }}
          className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-xs animate-fadeIn"
        >
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl shadow-2xl border border-rose-200 dark:border-rose-900/50 p-5 space-y-4 animate-scaleUp">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-100 dark:bg-rose-950 text-rose-600 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-black text-slate-900 dark:text-white">
                  {tr(language, 'Validation Impossible', 'Validation Blocked')}
                </h3>
                <p className="text-xs text-rose-600 dark:text-rose-400 font-bold mt-0.5">
                  {tr(language, 'Tous les articles doivent être confirmés mis en bac ou signalés non disponibles.', 'All items must be confirmed picked or marked unavailable first.')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setUnconfirmedWarningOrder(null)}
                className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-600 dark:text-slate-400">
              <p>
                {tr(language, 'Les articles suivants n\'ont pas encore été pointés par le préparateur :', 'The following items are still pending verification:')}
              </p>
            </div>

            <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 bg-slate-50/50 dark:bg-slate-900/50 text-xs">
              {unconfirmedWarningOrder.items
                .filter((it) => !it.picked && !it.unavailable)
                .map((it, idx) => (
                  <div key={idx} className="p-2 flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-800 dark:text-slate-200 truncate">
                      {it.product_name}
                    </span>
                    <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 shrink-0">
                      {it.quantity} {it.unit || 'pcs'}
                    </span>
                  </div>
                ))}
            </div>

            <button
              type="button"
              onClick={() => {
                toggleExpand(unconfirmedWarningOrder.id);
                setUnconfirmedWarningOrder(null);
              }}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold text-xs shadow-md transition active:scale-95 cursor-pointer"
            >
              {tr(language, 'Revenir au Pointage des Articles', 'Return to Picking Checklist')}
            </button>
          </div>
        </div>
      )}

      {/* MODAL 3: View & Print QR Code and Ready Slip */}
      {viewQrCodeOrder && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setViewQrCodeOrder(null);
            }
          }}
          className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-xs animate-fadeIn"
        >
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 animate-scaleUp max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-purple-100 dark:bg-purple-950/60 text-purple-600 flex items-center justify-center font-bold">
                  <QrCode className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">
                    {tr(language, 'Bon de Retrait Commande', 'Order Pickup Slip')}
                  </h3>
                  <p className="text-[11px] font-mono text-slate-400">
                    {viewQrCodeOrder.order_number}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewQrCodeOrder(null)}
                className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Printable Slip Content */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-center" id="printable-order-slip">
              {/* QR Code Image */}
              <div className="p-3 bg-white rounded-2xl border-2 border-slate-200 shadow-inner inline-block mx-auto">
                {viewQrCodeUrl ? (
                  <img
                    src={viewQrCodeUrl}
                    alt="QR Code Retrait"
                    className="w-44 h-44 mx-auto object-contain"
                  />
                ) : (
                  <div className="w-44 h-44 flex items-center justify-center text-slate-400">
                    <QrCode className="w-16 h-16 animate-pulse" />
                  </div>
                )}
                <div className="text-[10px] font-mono font-bold text-slate-700 mt-1">
                  TOT-ORDER:{viewQrCodeOrder.order_number}
                </div>
              </div>

              {/* Pickup Location Highlight Badge */}
              <div className="p-3 rounded-2xl bg-purple-50 dark:bg-purple-950/50 border border-purple-200 dark:border-purple-800 text-center space-y-1">
                <div className="text-[10px] uppercase tracking-wider font-extrabold text-purple-600 dark:text-purple-400">
                  {tr(language, 'Emplacement de Retrait', 'Pickup Location')}
                </div>
                <div className="text-base font-black text-purple-950 dark:text-purple-100 flex items-center justify-center gap-1.5">
                  <MapPin className="w-4 h-4 text-purple-600" />
                  <span>{viewQrCodeOrder.pickup_zone || (tr(language, 'Zone de retrait magasin', 'Store pickup area'))}</span>
                </div>
              </div>

              {/* Details table */}
              <div className="grid grid-cols-2 gap-2 text-left text-xs">
                <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  <span className="text-[10px] text-slate-400 font-bold block">{tr(language, 'Chantier', 'Site')}</span>
                  <span className="font-extrabold text-slate-800 dark:text-slate-200">{viewQrCodeOrder.site_number}</span>
                </div>
                <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  <span className="text-[10px] text-slate-400 font-bold block">{tr(language, 'Demandeur', 'Requester')}</span>
                  <span className="font-extrabold text-slate-800 dark:text-slate-200">{viewQrCodeOrder.requester_name}</span>
                </div>
              </div>

              {/* Items summary */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 text-left text-xs overflow-hidden">
                <div className="p-2 bg-slate-100 dark:bg-slate-800 font-bold text-[11px] text-slate-600 dark:text-slate-300">
                  {viewQrCodeOrder.items.length} {tr(language, 'article(s) préparé(s) :', 'items prepared:')}
                </div>
                {viewQrCodeOrder.items.map((it, idx) => (
                  <div key={idx} className="p-2 flex items-center justify-between text-[11px]">
                    <span className={it.unavailable ? 'line-through text-rose-500' : 'text-slate-800 dark:text-slate-200 font-medium'}>
                      {it.product_name}
                    </span>
                    <span className="font-bold shrink-0 ml-2">
                      {it.unavailable ? (
                        <span className="text-rose-600 text-[10px]">{tr(language, 'Rupture', 'Out')}</span>
                      ) : (
                        <span>{it.quantity} {it.unit || 'pcs'}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Print & Close */}
            <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => handlePrintOrderSlipDirect(viewQrCodeOrder, viewQrCodeUrl)}
                className="flex-1 py-2.5 px-3 rounded-xl bg-purple-100 hover:bg-purple-200 dark:bg-purple-950/80 dark:hover:bg-purple-900 text-purple-800 dark:text-purple-200 font-extrabold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>{tr(language, 'Imprimer le Bon de Retrait', 'Print Pickup Slip')}</span>
              </button>

              <button
                type="button"
                onClick={() => setViewQrCodeOrder(null)}
                className="flex-1 py-2.5 px-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-extrabold text-xs shadow-md transition cursor-pointer"
              >
                {tr(language, 'Fermer', 'Close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: 1-Click Substitution Dialog */}
      {substitutionTargetOrder && substitutionTargetItem && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSubmittingSubstitution) {
              setSubstitutionTargetOrder(null);
              setSubstitutionTargetItem(null);
            }
          }}
          className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-xs animate-fadeIn"
        >
          <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 animate-scaleUp max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-md shadow-amber-500/20">
                  <RefreshCw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">
                    {tr(language, 'Substitution d\'Article en 1 Clic', '1-Click Item Substitution')}
                  </h3>
                  <p className="text-[11px] font-mono text-slate-400">
                    Commande {substitutionTargetOrder.order_number}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSubstitutionTargetOrder(null);
                  setSubstitutionTargetItem(null);
                }}
                className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Target Item summary */}
            <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs">
              <span className="text-[10px] uppercase font-black tracking-wider text-rose-600 block">
                Article en rupture signalé :
              </span>
              <div className="font-bold text-slate-900 dark:text-white mt-0.5">
                {substitutionTargetItem.product_name}
              </div>
              <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                Réf: {substitutionTargetItem.product_ref} • Quantité requise : {substitutionTargetItem.quantity} {substitutionTargetItem.unit || 'pièce'}
              </div>
            </div>

            {/* Search substitute in same depot */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
                <span>Sélectionnez l'article de remplacement :</span>
                <span className="text-[10px] text-amber-600 dark:text-amber-400 font-mono">
                  Dépôt : {substitutionTargetOrder.depot_name || 'Magasin'}
                </span>
              </div>

              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={substituteSearchQuery}
                  onChange={(e) => setSubstituteSearchQuery(e.target.value)}
                  placeholder="Filtrer parmi les articles du dépôt..."
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border-none outline-none font-medium"
                  autoFocus
                />
              </div>

              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                {eligibleSubstitutes.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-400">
                    Aucun article de remplacement trouvé dans ce dépôt.
                  </div>
                ) : (
                  eligibleSubstitutes.map((prod) => (
                    <div
                      key={prod.id}
                      className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-amber-400 dark:hover:border-amber-600 bg-white dark:bg-slate-900 flex items-center justify-between gap-3 text-xs transition shadow-2xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono font-bold text-amber-600 dark:text-amber-400 text-[11px]">
                            {prod.reference}
                          </span>
                          <span className="font-bold text-slate-900 dark:text-white truncate">
                            {prod.brand} {prod.model}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {(prod.sub_category_id ? subCategoryMap.get(prod.sub_category_id) : prod.tags) || prod.store_name || ''} • Stock dispo : <strong className="text-slate-700 dark:text-slate-300">{prod.quantity}</strong>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={isSubmittingSubstitution}
                        onClick={() => handleConfirmSubstitution(prod)}
                        className="py-1.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-xs shadow-xs transition active:scale-95 cursor-pointer disabled:opacity-50 shrink-0 flex items-center gap-1"
                      >
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                        <span>Remplacer</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Substitution Note input */}
            <div className="space-y-1 pt-1">
              <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 block">
                Motif explicatif pour le demandeur :
              </label>
              <input
                type="text"
                value={substitutionReason}
                onChange={(e) => setSubstitutionReason(e.target.value)}
                placeholder="Ex: Remplacement équivalent même gamme suite rupture"
                className="w-full text-xs p-2 rounded-xl bg-slate-100 dark:bg-slate-800 border-none outline-none font-medium"
              />
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setSubstitutionTargetOrder(null);
                  setSubstitutionTargetItem(null);
                }}
                className="w-full py-2 text-xs font-bold text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Thermal Label Printing (60x40 mm & 100x150 mm) */}
      {printThermalLabelOrder && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setPrintThermalLabelOrder(null);
            }
          }}
          className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-xs animate-fadeIn"
        >
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 animate-scaleUp">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center">
                  <Tag className="w-5 h-5 text-orange-400" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">
                    {tr(language, 'Impression Étiquette Thermique', 'Thermal Label Print')}
                  </h3>
                  <p className="text-[11px] font-mono text-slate-400">
                    {printThermalLabelOrder.order_number}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPrintThermalLabelOrder(null)}
                className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Format Selector Pills */}
            <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl text-xs font-bold">
              <button
                type="button"
                onClick={() => setThermalFormat('60x40')}
                className={`flex-1 py-2 rounded-xl transition cursor-pointer text-center ${
                  thermalFormat === '60x40'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs font-black'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                🏷️ 60 x 40 mm (Bac / Casier)
              </button>
              <button
                type="button"
                onClick={() => setThermalFormat('100x150')}
                className={`flex-1 py-2 rounded-xl transition cursor-pointer text-center ${
                  thermalFormat === '100x150'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs font-black'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                📦 100 x 150 mm (Colis / Palette)
              </button>
            </div>

            {/* Visual Preview Frame */}
            <div className="p-3 bg-slate-100 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 flex items-center justify-center">
              <div
                className={`bg-white text-black border-2 border-black rounded-lg shadow-md p-2.5 flex flex-col justify-between transition-all ${
                  thermalFormat === '60x40' ? 'w-64 h-44 text-[10px]' : 'w-64 h-64 text-xs'
                }`}
              >
                <div className="border-b-2 border-black pb-1 flex justify-between items-center font-black">
                  <span className="uppercase tracking-wider">DRIVE CHANTIER</span>
                  <span className="text-[11px]">{printThermalLabelOrder.site_number}</span>
                </div>

                <div className="bg-black text-white text-center font-black py-1 px-2 my-1 rounded text-xs uppercase tracking-wide">
                  ZONE : {printThermalLabelOrder.pickup_zone || 'RETRAIT'}
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="leading-tight flex-1 text-[9px]">
                    <div className="font-mono font-black text-[10px] break-all">
                      {printThermalLabelOrder.order_number}
                    </div>
                    <div>Demandeur : <strong>{printThermalLabelOrder.requester_name}</strong></div>
                    <div>Articles : <strong>{printThermalLabelOrder.items.length} réf.</strong></div>
                  </div>
                  {printThermalQrUrl && (
                    <img src={printThermalQrUrl} alt="QR" className="w-16 h-16 object-contain" />
                  )}
                </div>

                <div className="border-t border-black pt-1 flex justify-between text-[8px] text-slate-600 font-mono">
                  <span>Prep: {printThermalLabelOrder.preparer_name || 'Magasinier'}</span>
                  <span>{new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>
            </div>

            {/* Print trigger button */}
            <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setPrintThermalLabelOrder(null)}
                className="flex-1 py-2.5 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs hover:bg-slate-100 cursor-pointer"
              >
                Fermer
              </button>

              <button
                type="button"
                onClick={() => handlePrintThermalDirect(thermalFormat)}
                className="flex-1 py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-black text-white font-black text-xs shadow-md flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer"
              >
                <Printer className="w-4 h-4 text-orange-400" />
                <span>Imprimer ({thermalFormat} mm)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 📷 LIVE CAMERA SCANNER MODAL OVERLAY FOR STORE ORDER FULFILLMENT         */}
      {/* ========================================================================= */}
      {isCameraScannerOpen && scannerTargetOrder && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleCloseScanner();
            }
          }}
          className="fixed inset-0 z-60 flex items-center justify-center p-3 bg-slate-950/85 backdrop-blur-md animate-fadeIn"
        >
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[94vh]">
            {/* Scanner Header */}
            <div className="p-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/60 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-2xl bg-purple-600 text-white flex items-center justify-center shadow-md shadow-purple-600/30 shrink-0">
                  <Camera className="w-5 h-5 stroke-[2.5]" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2 truncate">
                    <span>{tr(language, 'Scanner de Pointage Commande', 'Order Picking Scanner')}</span>
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
                    {scannerTargetOrder.order_number} • {scannerTargetOrder.requester_name}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {/* Continuous Mode Toggle */}
                <button
                  type="button"
                  onClick={() => setContinuousScanMode((prev) => !prev)}
                  className={`px-2.5 py-1 rounded-xl text-[11px] font-black transition cursor-pointer flex items-center gap-1 border ${
                    continuousScanMode
                      ? 'bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-800'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-300 dark:border-slate-700'
                  }`}
                  title={
                    continuousScanMode
                      ? 'Mode Continu actif : le scanner reste ouvert pour pointer plusieurs articles à la suite'
                      : 'Mode Unitaire : ferme après 1 scan'
                  }
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>{continuousScanMode ? 'Mode continu' : 'Scan unitaire'}</span>
                </button>

                {/* Torch / Flashlight Toggle */}
                {hasTorch && (
                  <button
                    type="button"
                    onClick={toggleTorch}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition cursor-pointer ${
                      torchEnabled
                        ? 'bg-amber-500 text-white shadow-md shadow-amber-500/30'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-800'
                    }`}
                    title="Activer la torche / lampe"
                  >
                    {torchEnabled ? <Zap className="w-4 h-4 fill-current text-white" /> : <ZapOff className="w-4 h-4" />}
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleCloseScanner}
                  className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white transition cursor-pointer"
                  title="Fermer le scanner"
                >
                  <X className="w-4 h-4 stroke-[2.5]" />
                </button>
              </div>
            </div>

            {/* Viewfinder Camera Feed */}
            <div className="relative bg-black flex-1 min-h-[260px] max-h-[380px] flex items-center justify-center overflow-hidden">
              <video
                ref={videoRef}
                playsInline
                autoPlay
                muted
                className="w-full h-full object-cover"
              />
              <canvas ref={canvasRef} className="hidden" />

              {/* Laser Target Box Overlay */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-6">
                <div className="w-64 h-44 border-2 border-purple-400/80 rounded-2xl relative shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
                  {/* Target Corners */}
                  <div className="absolute -top-1 -left-1 w-5 h-5 border-t-4 border-l-4 border-purple-500 rounded-tl-lg" />
                  <div className="absolute -top-1 -right-1 w-5 h-5 border-t-4 border-r-4 border-purple-500 rounded-tr-lg" />
                  <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-4 border-l-4 border-purple-500 rounded-bl-lg" />
                  <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-4 border-r-4 border-purple-500 rounded-br-lg" />

                  {/* Animated Sweeping Laser Line */}
                  <div className="absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-red-500 to-transparent shadow-[0_0_12px_#ef4444] animate-pulse top-1/2 -translate-y-1/2" />

                  <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-black text-white/90 bg-black/60 px-3 py-0.5 rounded-full backdrop-blur-xs">
                    Visez le code-barres ou QR code
                  </span>
                </div>
              </div>

              {/* Camera Error Message if any */}
              {cameraError && (
                <div className="absolute inset-0 bg-slate-950/90 p-6 flex flex-col items-center justify-center text-center text-white space-y-3">
                  <CameraOff className="w-12 h-12 text-rose-500" />
                  <p className="text-xs text-slate-300 font-medium max-w-xs">{cameraError}</p>
                </div>
              )}

              {/* Scanned Feedback Overlay */}
              {lastScannedArticle && (
                <div className="absolute top-3 left-3 right-3 p-3 rounded-2xl bg-emerald-600/95 backdrop-blur-md text-white shadow-xl flex items-center gap-2.5 animate-fadeIn z-20">
                  <CheckCircle2 className="w-6 h-6 shrink-0 text-white" />
                  <div className="min-w-0 flex-1 text-xs">
                    <div className="font-black text-sm truncate">{lastScannedArticle.name}</div>
                    <div className="text-[11px] opacity-90 font-mono">
                      Réf: {lastScannedArticle.ref} • {lastScannedArticle.qty} {lastScannedArticle.unit || 'pcs'}{' '}
                      {lastScannedArticle.already ? '(Déjà pointé)' : '(Pointé avec succès ✓)'}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Progress & Checklist Summary */}
            <div className="p-3.5 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 space-y-2.5 text-xs shrink-0">
              {/* Progress bar */}
              <div className="space-y-1">
                <div className="flex items-center justify-between font-bold text-slate-700 dark:text-slate-300 text-[11px]">
                  <span>Articles pointés dans cette commande :</span>
                  <span className="font-black text-purple-600 dark:text-purple-400">
                    {scannerTargetOrder.items.filter((i) => i.picked).length} / {scannerTargetOrder.items.length}{' '}
                    (
                    {scannerTargetOrder.items.length > 0
                      ? Math.round(
                          (scannerTargetOrder.items.filter((i) => i.picked).length / scannerTargetOrder.items.length) * 100
                        )
                      : 0}
                    %)
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-emerald-500 transition-all duration-300"
                    style={{
                      width: `${
                        scannerTargetOrder.items.length > 0
                          ? Math.round(
                              (scannerTargetOrder.items.filter((i) => i.picked).length / scannerTargetOrder.items.length) * 100
                            )
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>

              {/* Items pills to pick */}
              <div className="flex flex-wrap items-center gap-1.5 py-1">
                {scannerTargetOrder.items.map((it, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleOpenItemScanValidation(scannerTargetOrder, it)}
                    className={`px-2.5 py-1 rounded-xl text-[10.5px] font-bold flex items-center gap-1 transition cursor-pointer border shrink-0 ${
                      it.picked
                        ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                        : it.unavailable
                        ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border-rose-300 line-through'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {it.picked ? (
                      <Check className="w-3 h-3 text-emerald-600 stroke-[3]" />
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    )}
                    <span className="truncate max-w-[120px]">{it.product_name}</span>
                    <span className="font-mono text-[9px] opacity-70">x{it.quantity}</span>
                  </button>
                ))}
              </div>

              {/* Manual Input Fallback */}
              <div className="flex items-center gap-1.5 pt-1 border-t border-slate-100 dark:border-slate-800">
                <div className="relative flex-1">
                  <Barcode className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={manualScanInput}
                    onChange={(e) => setManualScanInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleProcessBarcodeMatch(manualScanInput, scannerTargetOrder, true);
                      }
                    }}
                    placeholder={tr(language, 'Saisir code-barres / réf manuellement...', 'Enter code manually...')}
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-1 focus:ring-purple-500 font-mono font-bold"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleProcessBarcodeMatch(manualScanInput, scannerTargetOrder, true)}
                  className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-black text-xs transition cursor-pointer shrink-0"
                >
                  {tr(language, 'Pointer', 'Check')}
                </button>
              </div>

              {/* Close Button */}
              <div className="flex items-center justify-end pt-0.5">
                <button
                  type="button"
                  onClick={handleCloseScanner}
                  className="w-full py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-black text-xs transition cursor-pointer text-center"
                >
                  {tr(language, 'Terminer et fermer le scanner', 'Done & Close Scanner')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL OBLIGATOIRE : SCAN ARTICLE & ENCODAGE QUANTITE */}
      {scanValidationModal && scanValidationModal.open && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setScanValidationModal(null);
            }
          }}
        >
          <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-gradient-to-r from-purple-500/10 via-indigo-500/10 to-transparent">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-purple-600 text-white flex items-center justify-center shadow-md shadow-purple-600/30">
                  <Scan className="w-5 h-5 stroke-[2.5]" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm sm:text-base text-slate-900 dark:text-white flex items-center gap-1.5">
                    <span>{tr(language, 'Validation Obligatoire par Scan', 'Mandatory Scan Verification')}</span>
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {tr(language, 'L’article doit être scanné et la quantité encodée par le préparateur', 'Item must be scanned and picked quantity encoded')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setScanValidationModal(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Target Article Card */}
            <div className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-xs font-black text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/60 px-2 py-0.5 rounded-md border border-purple-200 dark:border-purple-800">
                      {scanValidationModal.item.product_ref}
                    </span>
                    <h4 className="font-extrabold text-sm text-slate-900 dark:text-white mt-1">
                      {scanValidationModal.item.product_name}
                    </h4>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">
                      {tr(language, 'Demandé', 'Ordered')}
                    </span>
                    <span className="font-black text-base text-slate-900 dark:text-white">
                      {scanValidationModal.item.quantity} {scanValidationModal.item.unit || 'pcs'}
                    </span>
                  </div>
                </div>

                {/* Location tags */}
                {scanValidationModal.catalogProduct && (
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200/60 dark:border-slate-700/60 flex-wrap">
                    <span>📍 {scanValidationModal.catalogProduct.store_name || scanValidationModal.order.depot_name || 'Dépôt'}</span>
                    {scanValidationModal.catalogProduct.shelf_name && (
                      <span>• Rayon : <strong>{scanValidationModal.catalogProduct.shelf_name}</strong></span>
                    )}
                    {scanValidationModal.catalogProduct.barcode && (
                      <span className="font-mono text-[10px] bg-white dark:bg-slate-900 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                        EAN: {scanValidationModal.catalogProduct.barcode}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* STEP 1: SCAN ARTICLE */}
              <div className="space-y-2">
                <label className="text-xs font-extrabold text-slate-800 dark:text-slate-200 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-purple-600 text-white text-[10px] font-black flex items-center justify-center">1</span>
                    <span>{tr(language, 'Scanner le code-barres / QR :', 'Scan barcode / QR:')}</span>
                  </span>
                  {scanValidationModal.isBarcodeMatched ? (
                    <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                      <span>{tr(language, 'Code conforme vérifié', 'Conform barcode')}</span>
                    </span>
                  ) : (
                    <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
                      {tr(language, 'Scan obligatoire', 'Scan required')}
                    </span>
                  )}
                </label>

                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Barcode className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      autoFocus
                      value={scanValidationModal.barcodeInput}
                      onChange={(e) => {
                        const val = e.target.value;
                        setScanValidationModal((prev) => (prev ? { ...prev, barcodeInput: val } : null));
                        handleCheckBarcodeInput(val);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleCheckBarcodeInput(scanValidationModal.barcodeInput);
                        }
                      }}
                      placeholder={tr(language, 'Scannez avec la douchette ou saisissez la réf...', 'Scan barcode...')}
                      className={`w-full pl-9 pr-3 py-2.5 text-xs rounded-xl outline-none font-mono font-bold border transition ${
                        scanValidationModal.isBarcodeMatched
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 dark:border-emerald-600 text-emerald-900 dark:text-emerald-100 ring-2 ring-emerald-500/20'
                          : 'bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500'
                      }`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      handleOpenScanner(scanValidationModal.order);
                    }}
                    className="py-2.5 px-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition active:scale-95 cursor-pointer shrink-0"
                    title={tr(language, 'Scanner via la caméra', 'Camera scan')}
                  >
                    <Camera className="w-4 h-4 stroke-[2.5]" />
                    <span className="hidden sm:inline">{tr(language, 'Caméra', 'Camera')}</span>
                  </button>
                </div>

                {/* Match confirmation message */}
                {scanValidationModal.isBarcodeMatched && (
                  <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>
                      {tr(language, `Article physique reconnu : « ${scanValidationModal.barcodeInput} ». Encodez maintenant la quantité préparée.`, `Item recognized. Now enter picked quantity.`)}
                    </span>
                  </div>
                )}

                {scanValidationModal.errorMsg && (
                  <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs font-bold text-rose-800 dark:text-rose-300 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>{scanValidationModal.errorMsg}</span>
                  </div>
                )}
              </div>

              {/* STEP 2: ENCODE QUANTITY */}
              <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <label className="text-xs font-extrabold text-slate-800 dark:text-slate-200 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-purple-600 text-white text-[10px] font-black flex items-center justify-center">2</span>
                    <span>{tr(language, 'Quantité préparée et encodée par le préparateur :', 'Picked quantity encoded by preparer:')}</span>
                  </span>
                  <span className="text-[11px] font-bold text-slate-400">
                    {tr(language, `Commandé : ${scanValidationModal.item.quantity}`, `Target: ${scanValidationModal.item.quantity}`)}
                  </span>
                </label>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setScanValidationModal((prev) =>
                        prev ? { ...prev, encodedQuantity: Math.max(1, prev.encodedQuantity - 1) } : null
                      )
                    }
                    className="w-11 h-11 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-black text-lg flex items-center justify-center transition active:scale-95 cursor-pointer shadow-xs"
                  >
                    -
                  </button>

                  <input
                    type="number"
                    min={1}
                    value={scanValidationModal.encodedQuantity}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setScanValidationModal((prev) =>
                        prev ? { ...prev, encodedQuantity: isNaN(val) ? 0 : val } : null
                      );
                    }}
                    className="flex-1 py-2.5 px-3 text-center text-lg font-black bg-slate-50 dark:bg-slate-800 border-2 border-purple-300 dark:border-purple-700 rounded-2xl outline-none focus:ring-2 focus:ring-purple-500 text-slate-900 dark:text-white"
                  />

                  <button
                    type="button"
                    onClick={() =>
                      setScanValidationModal((prev) =>
                        prev ? { ...prev, encodedQuantity: prev.encodedQuantity + 1 } : null
                      )
                    }
                    className="w-11 h-11 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-black text-lg flex items-center justify-center transition active:scale-95 cursor-pointer shadow-xs"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/50 dark:bg-slate-900/50">
              <button
                type="button"
                onClick={() => setScanValidationModal(null)}
                className="px-4 py-2.5 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs transition cursor-pointer"
              >
                {tr(language, 'Annuler', 'Cancel')}
              </button>

              <button
                type="button"
                onClick={handleSubmitScanValidation}
                disabled={!scanValidationModal.isBarcodeMatched || scanValidationModal.encodedQuantity <= 0}
                className="flex-1 py-2.5 px-5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25 transition active:scale-95 cursor-pointer disabled:cursor-not-allowed disabled:shadow-none"
              >
                <Check className="w-4 h-4 stroke-[3]" />
                <span>
                  {tr(language, `Valider la mise en bac (${scanValidationModal.encodedQuantity} pcs)`, `Confirm picked item (${scanValidationModal.encodedQuantity} pcs)`)}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
