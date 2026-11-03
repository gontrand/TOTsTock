import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { tr } from '../i18n/dutchTranslator';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { useApp } from '../context/AppContext';
import { MaterialOrder, MaterialOrderItem, OrderBasket } from '../types';
import { formatCurrency, playScanBeep } from '../utils/crypto';
import { computeNextOrderNumber, formatOrderDatePrefix } from '../services/clientSupabase';
import {
  openSmartphoneCameraStream,
  prewarmSmartphoneCameraStream,
  attachStreamToVideoElement,
} from '../utils/qrCodeHelper';
import { generateOrderSlipHtml, printHtmlViaIframe } from '../utils/printHelper';
import {
  X,
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  CheckCircle2,
  Clock,
  Building2,
  MapPin,
  AlertTriangle,
  PackageCheck,
  Send,
  Calendar,
  UserCheck,
  Check,
  ChevronDown,
  ChevronUp,
  History,
  Sparkles,
  FileText,
  Camera,
  CameraOff,
  QrCode,
  Search,
  PlusCircle,
  PenTool,
  Eraser,
  Image as ImageIcon,
  FileCheck,
  Edit3,
  Edit2,
  Copy,
  Printer,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ArrowLeft,
  Warehouse,
  User,
  Package,
  Users,
  ArrowRightLeft,
  ArrowUp,
  ArrowDown,
  Layers,
} from 'lucide-react';

export const MaterialOrdersModal: React.FC = () => {
  const {
    orderCartModalOpen,
    setOrderCartModalOpen,
    orderCart,
    orderBaskets,
    activeOrderBasketId,
    setActiveOrderBasketId,
    createOrderBasket,
    deleteOrderBasket,
    renameOrderBasket,
    duplicateOrderBasket,
    moveOrderBasket,
    updateOrderBasketSite,
    updateOrderBasket,
    switchAndAddOrderBasket,
    addToOrderCart,
    updateOrderCartQty,
    removeFromOrderCart,
    clearOrderCart,
    submitMaterialOrder,
    markOrderCollected,
    updateMaterialOrder,
    canApproveOrder,
    approveOrder,
    rejectOrder,
    cancelOrder,
    deleteMaterialOrder,
    transferOrderPickup,
    orders,
    products,
    users,
    projects,
    departments,
    depots,
    subCategories,
    currentUser,
    userHasPermission,
    canViewPrices,
    isDepartmentManager,
    isAdmin,
    supabaseConfig,
    supabaseSyncStatus,
    language,
    t,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'cart' | 'orders'>(() => {
    return orderCart.length > 0 ? 'cart' : 'orders';
  });

  // Active basket definition at top-level
  const activeBasket = useMemo(() => {
    return orderBaskets.find((b) => b.id === activeOrderBasketId) || orderBaskets[0] || null;
  }, [orderBaskets, activeOrderBasketId]);

  // Règle : dans la commande, on ne voit QUE les chantiers du département d'appartenance du demandeur
  const userDeptObj = useMemo(() => {
    if (!currentUser?.department) return null;
    const str = currentUser.department.toLowerCase().trim();
    return (
      departments.find(
        (d) => d.name.toLowerCase().trim() === str || String(d.id) === str
      ) || null
    );
  }, [currentUser, departments]);

  const departmentProjects = useMemo(() => {
    if (userDeptObj) {
      const filtered = projects.filter((p) => p.department_id === userDeptObj.id);
      if (filtered.length > 0) return filtered;
    }
    // Si l'utilisateur est superadmin ou si aucun chantier n'est spécifié pour son département
    return projects;
  }, [projects, userDeptObj]);

  const [selectedSiteNumber, setSelectedSiteNumber] = useState<string>(() => {
    if (activeBasket?.site_number) return activeBasket.site_number;
    return departmentProjects.length > 0 ? departmentProjects[0].project_number : '';
  });

  // Synchronise le chantier choisi avec celui spécifiquement attribué à ce panier
  useEffect(() => {
    if (!activeBasket) return;
    if (activeBasket.site_number) {
      const matchProj = departmentProjects.find(
        (p) => p.project_number.toUpperCase() === activeBasket.site_number?.toUpperCase()
      );
      if (matchProj) {
        setSelectedSiteNumber(matchProj.project_number);
        setUseCustomSite(false);
      } else {
        setUseCustomSite(true);
        setCustomSiteNumber(activeBasket.site_number);
      }
    } else if (departmentProjects.length > 0) {
      const defaultSite = departmentProjects[0].project_number;
      setSelectedSiteNumber(defaultSite);
      setUseCustomSite(false);
      updateOrderBasketSite(activeBasket.id, defaultSite);
    }
  }, [activeBasket?.id, activeBasket?.site_number, departmentProjects, updateOrderBasketSite]);

  // Garantit que toutes les miniatures de paniers disposent immédiatement d'un numéro de chantier
  useEffect(() => {
    if (departmentProjects.length > 0) {
      const defaultSite = departmentProjects[0].project_number;
      orderBaskets.forEach((b) => {
        if (!b.site_number) {
          updateOrderBasketSite(b.id, defaultSite);
        }
      });
    }
  }, [orderBaskets, departmentProjects, updateOrderBasketSite]);

  const handleSiteSelectChange = (newSite: string) => {
    setSelectedSiteNumber(newSite);
    if (activeBasket) {
      updateOrderBasketSite(activeBasket.id, newSite);
    }
  };

  const handleCustomSiteChange = (val: string) => {
    setCustomSiteNumber(val);
    if (activeBasket) {
      updateOrderBasketSite(activeBasket.id, val.trim().toUpperCase());
    }
  };

  const handleCreateNewBasket = () => {
    const defaultSite = departmentProjects[0]?.project_number;
    const newId = createOrderBasket(undefined, undefined, defaultSite);
    setEditingBasketNameId(newId);
    setBasketNameInput('');
  };

  // État de la fenêtre dédiée pour consulter l'ensemble du contenu d'une commande
  const [selectedDetailOrderId, setSelectedDetailOrderId] = useState<string | null>(null);
  const selectedDetailOrder = useMemo(() => {
    return orders.find((o) => o.id === selectedDetailOrderId) || null;
  }, [orders, selectedDetailOrderId]);

  const [customSiteNumber, setCustomSiteNumber] = useState<string>('');
  const [useCustomSite, setUseCustomSite] = useState<boolean>(false);
  const [selectedDepot, setSelectedDepot] = useState<string>(() => {
    return depots.length > 0 ? depots[0].name : 'Dépôt Principal';
  });
  const [orderNotes, setOrderNotes] = useState<string>('');
  const [editingBasketNameId, setEditingBasketNameId] = useState<string | null>(null);
  const [basketNameInput, setBasketNameInput] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitSuccessMsg, setSubmitSuccessMsg] = useState<string | null>(null);
  const [showArchivedOrders, setShowArchivedOrders] = useState<boolean>(false);


  // Multi-panier display toggle (Agrandir ↑ pour afficher tous les paniers en grille détaillée, Diminuer ↓ pour barre compacte)
  const [isBasketsExpanded, setIsBasketsExpanded] = useState<boolean>(false);

  // Cart articles visibility toggle (Agrandir ↑ pour afficher la liste, Diminuer ↓ pour la masquer)
  const [isArticlesListHidden, setIsArticlesListHidden] = useState<boolean>(false);

  // Expanded order cards accordion state (Agrandir ↑ / Diminuer ↓ des commandes dans le suivi)
  const [expandedOrdersMap, setExpandedOrdersMap] = useState<Record<string, boolean>>({});

  // Non-blocking in-modal dialogs (replaces window.alert and window.confirm for iframe safety)
  const [toastError, setToastError] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    isDanger?: boolean;
    onConfirm: () => void;
  } | null>(null);

  // Transfer / Delegation states (si celui qui a passé la commande n'est pas disponible pour la prendre)
  const [delegatingOrder, setDelegatingOrder] = useState<MaterialOrder | null>(null);
  const [selectedDelegateUserId, setSelectedDelegateUserId] = useState<string>('');
  const [delegateNotes, setDelegateNotes] = useState<string>('');
  const [isSubmittingDelegation, setIsSubmittingDelegation] = useState<boolean>(false);

  const handleOpenDelegateModal = (order: MaterialOrder) => {
    setDelegatingOrder(order);
    setSelectedDelegateUserId(order.pickup_delegate_id ? String(order.pickup_delegate_id) : '');
    setDelegateNotes(order.pickup_delegate_notes || '');
  };

  const handleConfirmDelegation = async () => {
    if (!delegatingOrder || !selectedDelegateUserId) {
      setToastError(tr(language, 'Veuillez sélectionner un collègue du département.', 'Please select a colleague.'));
      return;
    }
    setIsSubmittingDelegation(true);
    const res = await transferOrderPickup(delegatingOrder.id, selectedDelegateUserId, delegateNotes);
    setIsSubmittingDelegation(false);
    if (res.success) {
      setSubmitSuccessMsg(res.message);
      setDelegatingOrder(null);
      setTimeout(() => setSubmitSuccessMsg(null), 4000);
    } else {
      setToastError(res.message);
    }
  };

  const departmentColleagues = useMemo(() => {
    if (!delegatingOrder) return [];
    const reqDept = (delegatingOrder.requester_department || currentUser?.department || '').trim().toLowerCase();
    return users
      .filter((u) => {
        // Don't select the requester themselves
        if (String(u.id) === String(delegatingOrder.requester_id)) return false;
        return true;
      })
      .sort((a, b) => {
        const aDept = (a.department || '').trim().toLowerCase();
        const bDept = (b.department || '').trim().toLowerCase();
        const aSame = Boolean(reqDept && aDept === reqDept);
        const bSame = Boolean(reqDept && bDept === reqDept);
        if (aSame && !bSame) return -1;
        if (!aSame && bSame) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [delegatingOrder, users, currentUser]);

  // Suppression autorisée par l'utilisateur si la commande n'a pas encore été retirée
  const handleDeleteOrder = async (order: MaterialOrder) => {
    if (order.status === 'COLLECTED') {
      setToastError(
        tr(language, 'Impossible de supprimer cette commande : elle a déjà été retirée.', 'Cannot delete order: already collected.')
      );
      return;
    }

    setConfirmDialog({
      title: tr(language, 'Supprimer la commande ?', 'Delete order?'),
      message: tr(language, `Êtes-vous sûr de vouloir supprimer définitivement la commande ${order.order_number} ? Cette action est irréversible.`, `Are you sure you want to permanently delete order ${order.order_number}?`),
      confirmText: tr(language, 'Supprimer', 'Delete'),
      isDanger: true,
      onConfirm: async () => {
        const res = await deleteMaterialOrder(order.id);
        if (res.success) {
          setSubmitSuccessMsg(res.message);
          if (selectedDetailOrderId === order.id) {
            setSelectedDetailOrderId(null);
          }
          setTimeout(() => setSubmitSuccessMsg(null), 4000);
        } else {
          setToastError(res.message);
        }
      },
    });
  };

  // Quick Add Product Picker states (requested by user to add items from the cart)
  const [isAddProductPickerOpen, setIsAddProductPickerOpen] = useState<boolean>(false);
  const [pickerSearchQuery, setPickerSearchQuery] = useState<string>('');
  const [pickerSelectedCategory, setPickerSelectedCategory] = useState<string>('ALL');
  const [pickerFeedbackMsg, setPickerFeedbackMsg] = useState<string | null>(null);

  // Edit Pending Order states (User requested ability to edit order before preparation starts)
  const [editingOrder, setEditingOrder] = useState<MaterialOrder | null>(null);
  const [editOrderItems, setEditOrderItems] = useState<MaterialOrderItem[]>([]);
  const [editSiteNumber, setEditSiteNumber] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [isSavingEdit, setIsSavingEdit] = useState<boolean>(false);
  const [isEditProductPickerOpen, setIsEditProductPickerOpen] = useState<boolean>(false);
  const [editPickerSearch, setEditPickerSearch] = useState<string>('');

  // Rejection modal states for managers
  const [rejectingOrder, setRejectingOrder] = useState<MaterialOrder | null>(null);
  const [rejectionReasonInput, setRejectionReasonInput] = useState<string>('');
  const [approvalActionLoading, setApprovalActionLoading] = useState<boolean>(false);

  // Digital Signature & Proof of collection modal states
  const [retraitModalOrder, setRetraitModalOrder] = useState<MaterialOrder | null>(null);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [proofPhotoUrl, setProofPhotoUrl] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [hasDrawnSignature, setHasDrawnSignature] = useState<boolean>(false);
  const [isSubmittingRetrait, setIsSubmittingRetrait] = useState<boolean>(false);
  const [viewProofOrder, setViewProofOrder] = useState<MaterialOrder | null>(null);

  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  // Scanner state for Requester pickup on shelf
  const [isPickupScannerOpen, setIsPickupScannerOpen] = useState<boolean>(false);
  const [scannedOrderMatch, setScannedOrderMatch] = useState<MaterialOrder | null>(null);
  const [scanErrorMessage, setScanErrorMessage] = useState<string | null>(null);
  const [manualCodeInput, setManualCodeInput] = useState<string>('');
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const isCooldownRef = useRef<boolean>(false);

  // Keyboard shortcut: close on Escape
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && orderCartModalOpen) {
        setOrderCartModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [orderCartModalOpen, setOrderCartModalOpen]);

  // Active orders: my own active orders (WAITING_APPROVAL, PENDING, PREPARING, READY)
  // PLUS orders delegated to current user by a colleague of the same department!
  // PLUS orders waiting for approval that current user is authorized to approve (for Project/Dept Managers & Admins)
  const myActiveOrders = useMemo(() => {
    if (!currentUser) return [];
    return orders
      .filter((o) => {
        const isMyOrder =
          String(o.requester_id) === String(currentUser.id) ||
          (o.requester_name && o.requester_name.toLowerCase() === currentUser.name.toLowerCase());
        const isDelegatedToMe =
          Boolean(o.pickup_delegate_id && String(o.pickup_delegate_id) === String(currentUser.id)) ||
          Boolean(o.pickup_delegate_name && o.pickup_delegate_name.toLowerCase() === currentUser.name.toLowerCase());
        const isActive =
          o.status === 'WAITING_APPROVAL' ||
          o.status === 'PENDING' ||
          o.status === 'PREPARING' ||
          o.status === 'READY';
        const canIApprove = canApproveOrder(o);
        return ((isMyOrder || isDelegatedToMe) && isActive) || (canIApprove && o.status === 'WAITING_APPROVAL');
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [orders, currentUser, canApproveOrder]);

  // Past/Collected/Rejected orders for audit history if toggled
  const myArchivedOrders = useMemo(() => {
    if (!currentUser) return [];
    return orders
      .filter((o) => {
        const isMyOrder =
          String(o.requester_id) === String(currentUser.id) ||
          (o.requester_name && o.requester_name.toLowerCase() === currentUser.name.toLowerCase());
        const isDelegatedToMe =
          Boolean(o.pickup_delegate_id && String(o.pickup_delegate_id) === String(currentUser.id)) ||
          Boolean(o.pickup_delegate_name && o.pickup_delegate_name.toLowerCase() === currentUser.name.toLowerCase()) ||
          Boolean(o.collected_by && o.collected_by.toLowerCase() === currentUser.name.toLowerCase());
        return (isMyOrder || isDelegatedToMe) && (o.status === 'COLLECTED' || o.status === 'CANCELLED' || o.status === 'REJECTED');
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [orders, currentUser]);

  const handleApproveOrder = async (order: MaterialOrder) => {
    if (approvalActionLoading) return;
    setApprovalActionLoading(true);
    try {
      const res = await approveOrder(order.id);
      if (res.success) {
        setSubmitSuccessMsg(res.message);
        setTimeout(() => setSubmitSuccessMsg(null), 4000);
      } else {
        setToastError(res.message);
      }
    } catch (err: any) {
      setToastError(err?.message || (tr(language, "Erreur lors de l'approbation de la commande.", 'Error approving order.')));
    } finally {
      setApprovalActionLoading(false);
    }
  };

  const handleConfirmRejectOrder = async () => {
    if (!rejectingOrder || approvalActionLoading) return;
    setApprovalActionLoading(true);
    try {
      const res = await rejectOrder(rejectingOrder.id, rejectionReasonInput);
      if (res.success) {
        setSubmitSuccessMsg(res.message);
        setTimeout(() => setSubmitSuccessMsg(null), 4000);
        setRejectingOrder(null);
        setRejectionReasonInput('');
      } else {
        setToastError(res.message);
      }
    } catch (err: any) {
      setToastError(err?.message || (tr(language, 'Erreur lors du refus de la commande.', 'Error rejecting order.')));
    } finally {
      setApprovalActionLoading(false);
    }
  };

  // Ready orders count
  const myReadyOrdersCount = useMemo(() => {
    return myActiveOrders.filter((o) => o.status === 'READY').length;
  }, [myActiveOrders]);

  if (!orderCartModalOpen) return null;

  const totalCartCost = orderCart.reduce(
    (sum, item) => sum + item.quantity * (item.unit_price || 0),
    0
  );

  const isOfflineMode =
    (typeof navigator !== 'undefined' && navigator.onLine === false) ||
    !supabaseConfig?.url ||
    !supabaseConfig?.key ||
    supabaseSyncStatus === 'error';

  const activeEffectiveSite = (
    (useCustomSite ? customSiteNumber.trim() : selectedSiteNumber.trim()) ||
    activeBasket?.site_number ||
    departmentProjects[0]?.project_number ||
    'CH-00'
  ).toUpperCase();

  const previewNextOrderNumber = computeNextOrderNumber(
    activeEffectiveSite,
    formatOrderDatePrefix(new Date()),
    orders.map((o) => o.order_number),
    isOfflineMode
  );

  const handleOrderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (orderCart.length === 0) {
      setToastError(tr(language, 'Votre panier de commande est vide.', 'Cart is empty.'));
      return;
    }

    const site = useCustomSite ? customSiteNumber.trim() : selectedSiteNumber.trim();
    if (!site) {
      setToastError(tr(language, 'Veuillez sélectionner ou renseigner un code chantier.', 'Please select or enter a site code.'));
      return;
    }

    const totalUnits = orderCart.reduce((acc, it) => acc + (it.quantity || 0), 0);
    const siteProj = projects.find((p) => p.project_number.toUpperCase() === site.toUpperCase());
    const basketName = activeBasket?.name || (tr(language, 'Panier en cours', 'Active basket'));
    const previewNum = computeNextOrderNumber(
      site.toUpperCase(),
      formatOrderDatePrefix(new Date()),
      orders.map((o) => o.order_number),
      isOfflineMode
    );

    setConfirmDialog({
      title: tr(language, 'Transmettre la commande au magasin ?', 'Transmit order to warehouse?'),
      message: language === 'fr'
        ? `Êtes-vous sûr de vouloir valider et transmettre le panier « ${basketName} » au magasin ?\n\n• N° Commande (${isOfflineMode ? 'Mode Hors-Ligne _OFF' : 'Unicité Serveur'}) : ${previewNum}\n• Chantier : 🏗️ ${site}${siteProj?.project_name ? ` (${siteProj.project_name})` : ''}\n• Contenu : ${orderCart.length} référence(s), ${totalUnits} pièces${canViewPrices && totalCartCost > 0 ? ` • ${formatCurrency(totalCartCost)}` : ''}\n• Dépôt de retrait : 🏢 ${selectedDepot}`
        : `Validate and transmit order for basket "${basketName}" to warehouse?\n\n• Order #: ${previewNum}\n• Site: ${site}\n• Items: ${orderCart.length} refs, ${totalUnits} pcs\n• Depot: ${selectedDepot}`,
      confirmText: tr(language, 'Confirmer la transmission', 'Confirm & Transmit'),
      cancelText: tr(language, 'Annuler', 'Cancel'),
      isDanger: false,
      onConfirm: async () => {
        setIsSubmitting(true);
        try {
          const res = await submitMaterialOrder(site, selectedDepot, orderNotes, activeBasket?.id);
          if (res.success) {
            setSubmitSuccessMsg(res.message);
            setOrderNotes('');
            setActiveTab('orders');
            setTimeout(() => setSubmitSuccessMsg(null), 4000);
          } else {
            setToastError(res.message);
          }
        } catch (err: any) {
          setToastError(err?.message || (tr(language, 'Une erreur est survenue lors de la transmission de la commande.', 'An error occurred while submitting order.')));
        } finally {
          setIsSubmitting(false);
        }
      },
    });
  };

  const handleQuickTransmitBasket = (basket: OrderBasket) => {
    if (basket.items.length === 0) {
      setToastError(tr(language, 'Ce panier est vide. Ajoutez des articles avant de le transmettre.', 'This basket is empty.'));
      return;
    }
    const effectiveSite =
      basket.site_number ||
      (basket.id === activeOrderBasketId ? (useCustomSite ? customSiteNumber : selectedSiteNumber) : undefined) ||
      departmentProjects[0]?.project_number ||
      projects[0]?.project_number ||
      'CH-00';
    const totalUnits = basket.items.reduce((acc: number, it: MaterialOrderItem) => acc + (it.quantity || 0), 0);
    const totalCost = basket.items.reduce((acc: number, it: MaterialOrderItem) => acc + (it.quantity || 0) * (it.unit_price || 0), 0);
    const siteProj = projects.find((p) => p.project_number.toUpperCase() === effectiveSite.toUpperCase());
    const depotName = basket.depot_name || selectedDepot || 'Dépôt Principal';
    const previewNum = computeNextOrderNumber(
      effectiveSite.toUpperCase(),
      formatOrderDatePrefix(new Date()),
      orders.map((o) => o.order_number),
      isOfflineMode
    );

    setConfirmDialog({
      title: tr(language, 'Transmettre la commande au magasin ?', 'Transmit order to warehouse?'),
      message: language === 'fr'
        ? `Êtes-vous sûr de vouloir valider et transmettre le panier « ${basket.name} » au magasin ?\n\n• N° Commande (${isOfflineMode ? 'Mode Hors-Ligne _OFF' : 'Unicité Serveur'}) : ${previewNum}\n• Chantier : 🏗️ ${effectiveSite}${siteProj?.project_name ? ` (${siteProj.project_name})` : ''}\n• Contenu : ${basket.items.length} référence(s), ${totalUnits} pièces${canViewPrices && totalCost > 0 ? ` • ${formatCurrency(totalCost)}` : ''}\n• Dépôt de retrait : 🏢 ${depotName}`
        : `Validate and transmit order for basket "${basket.name}" to warehouse?\n\n• Order #: ${previewNum}\n• Items: ${basket.items.length} refs, ${totalUnits} pcs\n• Site: ${effectiveSite}\n• Depot: ${depotName}`,
      confirmText: tr(language, 'Confirmer la transmission', 'Confirm & Transmit'),
      cancelText: tr(language, 'Annuler', 'Cancel'),
      isDanger: false,
      onConfirm: async () => {
        setIsSubmitting(true);
        try {
          const res = await submitMaterialOrder(effectiveSite, depotName, basket.notes, basket.id);
          if (res.success) {
            setSubmitSuccessMsg(res.message);
            setActiveTab('orders');
            setTimeout(() => setSubmitSuccessMsg(null), 4000);
          } else {
            setToastError(res.message);
          }
        } catch (err: any) {
          setToastError(err?.message || (tr(language, 'Erreur lors de la transmission.', 'Error while transmitting order.')));
        } finally {
          setIsSubmitting(false);
        }
      },
    });
  };

  const isSuperAdmin =
    Number(currentUser?.id) === 0 ||
    Number(currentUser?.role_id) === 0 ||
    Number(currentUser?.role_id) === 1;

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
  }, []);

  const handleProcessScannedCode = useCallback(
    (rawText: string) => {
      if (!rawText.trim()) return;
      const clean = rawText.trim();

      const matched = orders.find((o) => {
        if (o.order_number && (o.order_number.toLowerCase() === clean.toLowerCase() || clean.includes(o.order_number))) return true;
        if (o.ready_qr_code && (o.ready_qr_code === clean || clean.includes(o.ready_qr_code))) return true;
        if (clean.startsWith('TOT-ORDER:') && clean.replace('TOT-ORDER:', '') === o.order_number) return true;
        return o.items.some((it) => it.product_ref && it.product_ref.toLowerCase() === clean.toLowerCase());
      });

      if (!matched) {
        playScanBeep(false);
        setScanErrorMessage(
          tr(language, `Aucune commande trouvée correspondant au code : "${clean}". Veuillez vérifier le QR Code ou renseigner le n° de commande.`, `No order found matching: "${clean}".`)
        );
        return;
      }

      // Check ownership or delegation
      const isDelegatedToMe =
        Boolean(matched.pickup_delegate_id && String(matched.pickup_delegate_id) === String(currentUser?.id)) ||
        Boolean(matched.pickup_delegate_name && currentUser?.name && matched.pickup_delegate_name.toLowerCase() === currentUser.name.toLowerCase());
      const isMine =
        isSuperAdmin ||
        isDelegatedToMe ||
        String(matched.requester_id) === String(currentUser?.id) ||
        (matched.requester_name && currentUser?.name && matched.requester_name.toLowerCase() === currentUser.name.toLowerCase());

      if (!isMine) {
        playScanBeep(false);
        setScanErrorMessage(
          tr(language, `⚠️ Cette commande (${matched.order_number}) appartient à « ${matched.requester_name} ». Vous ne pouvez confirmer le retrait que pour vos propres commandes ou celles qui vous ont été formellement déléguées.`, `This order belongs to ${matched.requester_name}. You can only collect your own orders or orders delegated to you.`)
        );
        return;
      }

      playScanBeep(true);
      setScannedOrderMatch(matched);
      setScanErrorMessage(null);
      stopCamera();
      setIsPickupScannerOpen(false);
    },
    [orders, currentUser, isSuperAdmin, language, stopCamera]
  );

  const handleProcessScannedCodeRef = useRef(handleProcessScannedCode);
  useEffect(() => {
    handleProcessScannedCodeRef.current = handleProcessScannedCode;
  }, [handleProcessScannedCode]);

  const handleStartPickupScanner = useCallback(() => {
    prewarmSmartphoneCameraStream();
    setIsPickupScannerOpen(true);
    setScanErrorMessage(null);
    setCameraError(null);
    setManualCodeInput('');
  }, []);

  useEffect(() => {
    if (!isPickupScannerOpen) {
      stopCamera();
      return;
    }

    let isSubscribed = true;
    openSmartphoneCameraStream()
      .then(async (stream) => {
        if (!isSubscribed) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          await attachStreamToVideoElement(videoRef.current, stream);
        }

        const scanLoop = () => {
          if (!videoRef.current || !canvasRef.current) {
            animFrameRef.current = requestAnimationFrame(scanLoop);
            return;
          }
          if (videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              canvas.width = videoRef.current.videoWidth;
              canvas.height = videoRef.current.videoHeight;
              ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: 'dontInvert',
              });
              if (code && code.data) {
                if (!isCooldownRef.current) {
                  isCooldownRef.current = true;
                  handleProcessScannedCodeRef.current(code.data);
                  setTimeout(() => {
                    isCooldownRef.current = false;
                  }, 1500);
                  return;
                }
              }
            }
          }
          animFrameRef.current = requestAnimationFrame(scanLoop);
        };
        animFrameRef.current = requestAnimationFrame(scanLoop);
      })
      .catch((err) => {
        console.warn('Camera access denied or error:', err);
        setCameraError(
          tr(language, "Impossible d'accéder à la caméra. Veuillez autoriser la caméra ou saisir le code ci-dessous.", 'Camera access unavailable. Please enter code manually.')
        );
      });

    return () => {
      isSubscribed = false;
      stopCamera();
    };
  }, [isPickupScannerOpen, language, stopCamera]);

  // Current Cart Depot for Mono-depot enforcement
  const currentCartDepot = useMemo(() => {
    return orderCart[0]?.depot_name || null;
  }, [orderCart]);

  // Categories available for quick picker
  const subCategoryMap = useMemo(() => {
    const map = new Map<number, string>();
    subCategories.forEach((sc) => map.set(sc.id, sc.name));
    return map;
  }, [subCategories]);

  const availablePickerCategories = useMemo(() => {
    return subCategories.map((s) => s.name);
  }, [subCategories]);

  // Filtered products in picker respecting mono-depot rule
  const pickerProducts = useMemo(() => {
    return products.filter((p) => {
      const pDepot = (p.store_name || '').trim();
      if (currentCartDepot && pDepot && pDepot !== currentCartDepot) {
        return false;
      }
      const catName = p.sub_category_id ? subCategoryMap.get(p.sub_category_id) || '' : p.tags || '';
      if (pickerSelectedCategory !== 'ALL' && catName !== pickerSelectedCategory) {
        return false;
      }
      if (pickerSearchQuery.trim()) {
        const q = pickerSearchQuery.toLowerCase().trim();
        const mRef = p.reference && p.reference.toLowerCase().includes(q);
        const mBrand = p.brand && p.brand.toLowerCase().includes(q);
        const mModel = p.model && p.model.toLowerCase().includes(q);
        const mCat = catName && catName.toLowerCase().includes(q);
        const mBar = p.barcode && p.barcode.toLowerCase().includes(q);
        if (!mRef && !mBrand && !mModel && !mCat && !mBar) {
          return false;
        }
      }
      return true;
    });
  }, [products, currentCartDepot, subCategoryMap, pickerSelectedCategory, pickerSearchQuery]);

  const handleQuickAddProductToCart = (prod: (typeof products)[0]) => {
    const res = addToOrderCart(prod, 1);
    if (res.success) {
      setPickerFeedbackMsg(`✓ « ${prod.reference} » ajouté au panier !`);
      setTimeout(() => setPickerFeedbackMsg(null), 2500);
    } else if (res.conflict) {
      setConfirmDialog({
        title: tr(language, 'Changement de dépôt nécessaire', 'Depot change needed'),
        message: `${res.message}\n\n👉 Souhaitez-vous créer ou basculer sur un panier dédié au « ${res.productDepot} » et y ajouter cet article ?`,
        confirmText: tr(language, 'Basculer & Ajouter', 'Switch & Add'),
        onConfirm: () => {
          switchAndAddOrderBasket(prod, 1);
          setPickerFeedbackMsg(`✓ Panier pour « ${res.productDepot} » créé/activé avec « ${prod.reference} » !`);
          setTimeout(() => setPickerFeedbackMsg(null), 3000);
        },
      });
    } else {
      setToastError(res.message || 'Erreur lors de l\'ajout au panier');
    }
  };

  // Order modification handlers (allowed while PENDING or WAITING_APPROVAL)
  const handleStartEditOrder = (order: MaterialOrder) => {
    if (order.status !== 'PENDING' && order.status !== 'WAITING_APPROVAL') return;
    setEditingOrder(order);
    setEditOrderItems(order.items.map((i) => ({ ...i })));
    setEditSiteNumber(order.site_number);
    setEditNotes(order.notes || '');
    setEditPickerSearch('');
    setIsEditProductPickerOpen(false);
  };

  const handleUpdateEditItemQty = (productId: string | number, delta: number) => {
    setEditOrderItems((prev) =>
      prev
        .map((it) => {
          if (String(it.product_id) === String(productId)) {
            const newQty = Math.max(1, (it.quantity || 1) + delta);
            return { ...it, quantity: newQty };
          }
          return it;
        })
        .filter((it) => it.quantity > 0)
    );
  };

  const handleRemoveEditItem = (productId: string | number) => {
    setEditOrderItems((prev) => prev.filter((it) => String(it.product_id) !== String(productId)));
  };

  const handleAddProductToEditOrder = (prod: any) => {
    setEditOrderItems((prev) => {
      const existing = prev.find((it) => String(it.product_id) === String(prod.id));
      if (existing) {
        return prev.map((it) =>
          String(it.product_id) === String(prod.id)
            ? { ...it, quantity: (it.quantity || 1) + 1 }
            : it
        );
      }
      return [
        ...prev,
        {
          product_id: prod.id,
          product_ref: prod.reference,
          product_name: `${prod.brand} ${prod.model}`,
          quantity: 1,
          unit: prod.unit || 'pcs',
          unit_price: prod.unit_price || 0,
        },
      ];
    });
    setIsEditProductPickerOpen(false);
  };

  const handleSaveEditedOrder = async () => {
    if (!editingOrder) return;
    if (editOrderItems.length === 0) {
      setToastError(tr(language, 'La commande doit comporter au moins 1 article.', 'Order must contain at least 1 item.'));
      return;
    }
    setIsSavingEdit(true);
    const res = await updateMaterialOrder(editingOrder.id, {
      items: editOrderItems,
      site_number: editSiteNumber,
      notes: editNotes,
    });
    setIsSavingEdit(false);
    if (res.success) {
      setSubmitSuccessMsg(res.message);
      setEditingOrder(null);
      setTimeout(() => setSubmitSuccessMsg(null), 5000);
    } else {
      setToastError(res.message);
    }
  };

  const handlePrintRequesterSlip = async (order: MaterialOrder) => {
    let qrUrl = order.ready_qr_code || null;
    if (!qrUrl) {
      try {
        const payload = JSON.stringify({
          type: 'TOT_ORDER_PICKUP',
          order_id: order.id,
          order_number: order.order_number,
          site_number: order.site_number,
          depot: order.depot_name,
        });
        qrUrl = await QRCode.toDataURL(payload, { width: 200, margin: 1 });
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
      preparerName: order.preparer_name || 'Magasinier',
      items: order.items,
      qrCodeDataUrl: qrUrl,
      notes: order.notes,
    });
    printHtmlViaIframe(html);
  };

  // High-precision touch / pointer signature pad with coordinate scaling
  const getCanvasCoordinates = (
    canvas: HTMLCanvasElement,
    clientX: number,
    clientY: number
  ) => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (_) {}
    const pos = getCanvasCoordinates(canvas, e.clientX, e.clientY);
    if (!pos) return;
    setIsDrawing(true);
    setHasDrawnSignature(true);
    lastPosRef.current = pos;

    // Draw initial dot
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !lastPosRef.current) return;
    e.preventDefault();
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const currentPos = getCanvasCoordinates(canvas, e.clientX, e.clientY);
    if (!currentPos) return;

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
    ctx.lineTo(currentPos.x, currentPos.y);
    ctx.stroke();

    lastPosRef.current = currentPos;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    setIsDrawing(false);
    lastPosRef.current = null;
    const canvas = sigCanvasRef.current;
    if (canvas) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (_) {}
      setSignatureData(canvas.toDataURL('image/png'));
    }
  };

  const startDrawing = handlePointerDown;
  const draw = handlePointerMove;
  const stopDrawing = handlePointerUp;

  const clearSignature = () => {
    const canvas = sigCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    setHasDrawnSignature(false);
    setSignatureData(null);
  };

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setProofPhotoUrl(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleInitiateCollection = (order: MaterialOrder) => {
    setRetraitModalOrder(order);
    setSignatureData(null);
    setProofPhotoUrl(null);
    setHasDrawnSignature(false);
  };

  const handleFinalizeCollection = async () => {
    if (!retraitModalOrder) return;
    setIsSubmittingRetrait(true);
    try {
      const res = await markOrderCollected(retraitModalOrder.id, {
        signatureData: signatureData || undefined,
        proofPhotoUrl: proofPhotoUrl || undefined,
      });
      if (res.success) {
        setRetraitModalOrder(null);
        setScannedOrderMatch(null);
      } else {
        setToastError(res.message);
      }
    } catch (err: any) {
      setToastError(err?.message || (tr(language, 'Erreur lors du retrait de la commande.', 'Error finalizing pickup.')));
    } finally {
      setIsSubmittingRetrait(false);
    }
  };

  const handleConfirmCollection = async (orderId: string) => {
    const target = orders.find((o) => o.id === orderId);
    if (target) {
      handleInitiateCollection(target);
    } else {
      const res = await markOrderCollected(orderId);
      if (res.success) {
        setScannedOrderMatch(null);
      } else {
        setToastError(res.message);
      }
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setOrderCartModalOpen(false);
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/80 backdrop-blur-xs animate-fadeIn"
    >
      <div
        className="bg-white dark:bg-slate-900 w-full max-w-4xl max-h-[94dvh] sm:max-h-[92vh] rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col transition-all duration-300 relative"
      >
        {/* Header */}
        <div className="p-3 sm:p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 bg-gradient-to-r from-orange-500/10 via-amber-500/10 to-transparent">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-orange-500 text-white flex items-center justify-center shadow-md shadow-orange-500/30 shrink-0">
              <ShoppingCart className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-white truncate">
                  {tr(language, 'Panier & Commandes Matériel', 'Material Cart & Site Orders')}
                </h2>
                {myReadyOrdersCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500 text-white animate-pulse shrink-0">
                    {myReadyOrdersCount} {tr(language, 'Prête(s) !', 'Ready!')}
                  </span>
                )}
                {/* Visual badge of articles list state (Agrandir ↑ / Diminuer ↓) */}
                {activeTab === 'cart' && orderCart.length > 0 && (
                  <span className={`hidden sm:inline-flex px-2 py-0.5 rounded-lg text-[10px] font-black border ${
                    isArticlesListHidden
                      ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                      : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                  }`}>
                    {isArticlesListHidden
                      ? (tr(language, 'Articles masqués (↓)', 'Items hidden (↓)'))
                      : (tr(language, 'Articles affichés (↑)', 'Items visible (↑)'))}
                  </span>
                )}
              </div>
              <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 truncate">
                {tr(language, 'Drive Chantier : commandez vos articles, le magasin prépare et vous alerte', 'Site Drive: request items, warehouse prepares and notifies you')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Boutons Agrandir (↑) et Diminuer (↓) destinés à masquer / afficher la liste des articles */}
            {activeTab === 'cart' && orderCart.length > 0 && (
              <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setIsArticlesListHidden(false)}
                  className={`px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition cursor-pointer ${
                    !isArticlesListHidden
                      ? 'bg-orange-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 hover:text-orange-600'
                  }`}
                  title={tr(language, 'Agrandir / Afficher la liste des articles (↑)', 'Expand / Show items (↑)')}
                  aria-label="Agrandir la liste des articles"
                >
                  <ArrowUp className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span className="text-[11px] hidden sm:inline">{tr(language, 'Agrandir', 'Expand')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsArticlesListHidden(true)}
                  className={`px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition cursor-pointer ${
                    isArticlesListHidden
                      ? 'bg-orange-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 hover:text-orange-600'
                  }`}
                  title={tr(language, 'Diminuer / Masquer la liste des articles (↓)', 'Reduce / Hide items (↓)')}
                  aria-label="Masquer la liste des articles"
                >
                  <ArrowDown className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span className="text-[11px] hidden sm:inline">{tr(language, 'Diminuer', 'Reduce')}</span>
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setOrderCartModalOpen(false)}
              className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              title={tr(language, 'Fermer', 'Close')}
              aria-label="Fermer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Global Toast Error Banner */}
        {toastError && (
          <div className="mx-4 mt-3 p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between gap-2 font-bold animate-fadeIn">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
              <span>{toastError}</span>
            </div>
            <button
              type="button"
              onClick={() => setToastError(null)}
              className="p-1 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/50 text-rose-500 transition cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-1.5 gap-1.5 text-[11px] sm:text-xs font-bold">
          <button
            type="button"
            onClick={() => setActiveTab('cart')}
            className={`flex-1 min-w-0 py-2 px-2 sm:px-3 rounded-xl flex items-center justify-center gap-1.5 sm:gap-2 transition cursor-pointer ${
              activeTab === 'cart'
                ? 'bg-white dark:bg-slate-800 text-orange-600 dark:text-orange-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <ShoppingCart className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span className="truncate">{tr(language, 'Mon Panier de Demande', 'My Order Basket')}</span>
            {orderCart.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-orange-500 text-white text-[10px] font-black flex items-center justify-center shrink-0">
                {orderCart.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('orders')}
            className={`flex-1 min-w-0 py-2 px-2 sm:px-3 rounded-xl flex items-center justify-center gap-1.5 sm:gap-2 transition cursor-pointer relative ${
              activeTab === 'orders'
                ? 'bg-white dark:bg-slate-800 text-orange-600 dark:text-orange-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <PackageCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span className="truncate">{tr(language, 'Mes Commandes en Cours', 'Active Orders & Tracking')}</span>
            {myActiveOrders.length > 0 && (
              <span
                className={`w-5 h-5 rounded-full text-white text-[10px] font-black flex items-center justify-center shrink-0 ${
                  myReadyOrdersCount > 0 ? 'bg-emerald-500 animate-bounce' : 'bg-slate-500'
                }`}
              >
                {myActiveOrders.length}
              </span>
            )}
          </button>
        </div>

        {/* Tab 1: Order Cart Content */}
        {activeTab === 'cart' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {submitSuccessMsg && (
              <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-2 font-bold animate-fadeIn">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <span>{submitSuccessMsg}</span>
              </div>
            )}

            {/* Multi-Panier Bar (Gestion de plusieurs paniers simultanés) */}
            {(() => {
              const activeBasket = orderBaskets.find((b) => b.id === activeOrderBasketId) || orderBaskets[0];
              return (
                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-2.5">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-orange-100 dark:bg-orange-950/60 text-orange-600 flex items-center justify-center font-bold">
                        <ShoppingCart className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <span className="text-xs font-black text-slate-800 dark:text-slate-100">
                          {tr(language, 'Mes Paniers Actifs', 'My Active Baskets')} ({orderBaskets.length})
                        </span>
                        <span className="text-[10px] text-slate-400 block">
                          {tr(language, 'Basculez, agrandissez (↑) ou réduisez (↓) vos différents paniers simultanés.', 'Switch, expand (↑) or reduce (↓) your active carts.')}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {/* Boutons Agrandir (↑) et Diminuer (↓) la vue de tous les paniers */}
                      <div className="flex items-center bg-white dark:bg-slate-900 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-2xs">
                        <button
                          type="button"
                          onClick={() => setIsBasketsExpanded(true)}
                          className={`px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition cursor-pointer ${
                            isBasketsExpanded
                              ? 'bg-orange-600 text-white shadow-xs'
                              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                          title={tr(language, 'Agrandir tous les paniers (↑)', 'Expand all carts (↑)')}
                        >
                          <ArrowUp className="w-3.5 h-3.5 stroke-[2.5]" />
                          <span className="text-[11px]">{tr(language, 'Agrandir', 'Expand')}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsBasketsExpanded(false)}
                          className={`px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition cursor-pointer ${
                            !isBasketsExpanded
                              ? 'bg-orange-600 text-white shadow-xs'
                              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                          title={tr(language, 'Diminuer / Vue compacte (↓)', 'Reduce / Compact (↓)')}
                        >
                          <ArrowDown className="w-3.5 h-3.5 stroke-[2.5]" />
                          <span className="text-[11px]">{tr(language, 'Diminuer', 'Reduce')}</span>
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={handleCreateNewBasket}
                        className="px-2.5 py-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition active:scale-95 cursor-pointer shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5 stroke-[2.5] shrink-0" />
                        <span>{tr(language, 'Nouveau panier', 'New basket')}</span>
                      </button>
                    </div>
                  </div>

                  {/* VUE DES PANIERS ACTIFS */}
                  {orderBaskets.length === 0 ? (
                    <div className="p-3 rounded-xl bg-white/80 dark:bg-slate-900/60 border border-dashed border-slate-300 dark:border-slate-700 text-center text-xs text-slate-500 dark:text-slate-400">
                      {tr(language, 'Aucun panier ou commande non transmise en cours. Cliquez sur « + Nouveau panier » ou ajoutez un article depuis le catalogue.', 'No active untransmitted basket. Click "+ New basket" or add an item from the catalog.')}
                    </div>
                  ) : isBasketsExpanded ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1 animate-fadeIn">
                      {orderBaskets.map((basket, bIdx) => {
                        const isActive = basket.id === activeOrderBasketId;
                        const basketUnits = basket.items.reduce((acc, it) => acc + (it.quantity || 0), 0);
                        const basketTotal = basket.items.reduce((acc, it) => acc + (it.quantity || 0) * (it.unit_price || 0), 0);

                        return (
                          <div
                            key={basket.id}
                            className={`p-3 rounded-2xl border transition relative flex flex-col justify-between ${
                              isActive
                                ? 'bg-white dark:bg-slate-900 border-orange-500 ring-2 ring-orange-500/25 shadow-md'
                                : 'bg-white/60 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                            }`}
                          >
                            <div>
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-base">🧺</span>
                                  <div className="min-w-0">
                                    <div className="font-extrabold text-xs text-slate-900 dark:text-white truncate">
                                      {basket.name}
                                    </div>
                                    <div className="text-[10px] text-slate-400">
                                      {basket.items.length} réf. • {basketUnits} pcs
                                      {canViewPrices && basketTotal > 0 && ` • ${formatCurrency(basketTotal)}`}
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center gap-1">
                                  {/* Ordre monter/descendre le panier */}
                                  <button
                                    type="button"
                                    onClick={() => moveOrderBasket(basket.id, 'up')}
                                    disabled={bIdx === 0}
                                    className="w-6 h-6 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 disabled:opacity-20 cursor-pointer"
                                    title={tr(language, 'Déplacer ce panier vers le haut (↑)', 'Move basket up (↑)')}
                                  >
                                    <ArrowUp className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => moveOrderBasket(basket.id, 'down')}
                                    disabled={bIdx === orderBaskets.length - 1}
                                    className="w-6 h-6 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 disabled:opacity-20 cursor-pointer"
                                    title={tr(language, 'Déplacer ce panier vers le bas (↓)', 'Move basket down (↓)')}
                                  >
                                    <ArrowDown className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>

                              {(() => {
                                const effectiveBasketSite =
                                  basket.site_number ||
                                  (basket.id === activeOrderBasketId ? (useCustomSite ? customSiteNumber : selectedSiteNumber) : undefined) ||
                                  departmentProjects[0]?.project_number ||
                                  projects[0]?.project_number ||
                                  '';
                                const siteProj = projects.find(
                                  (p) => p.project_number.toUpperCase() === effectiveBasketSite.toUpperCase()
                                );

                                return (
                                  <>
                                    <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                                      {basket.depot_name && (
                                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-bold border border-amber-200 dark:border-amber-800 flex items-center gap-1">
                                          🏢 {basket.depot_name}
                                        </span>
                                      )}
                                      <span className="text-[10.5px] px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950/80 text-blue-900 dark:text-blue-200 font-black border border-blue-300 dark:border-blue-700 flex items-center gap-1 shadow-2xs">
                                        <span>🏗️</span>
                                        <span>
                                          {tr(language, 'Chantier :', 'Site:')}{' '}
                                          <strong className="underline underline-offset-2">{effectiveBasketSite || (tr(language, 'À définir', 'None'))}</strong>
                                          {siteProj?.project_name ? <span className="opacity-80 font-normal"> — {siteProj.project_name}</span> : ''}
                                        </span>
                                      </span>
                                    </div>

                                    {/* Sélecteur direct du Chantier pour cette miniature */}
                                    <div className="mt-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
                                      <div className="flex items-center gap-1 min-w-0">
                                        <span className="text-xs">🏗️</span>
                                        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                                          {tr(language, 'Affecter chantier :', 'Assign site:')}
                                        </span>
                                      </div>
                                      <select
                                        value={basket.site_number || effectiveBasketSite}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          updateOrderBasketSite(basket.id, val);
                                          if (basket.id === activeOrderBasketId) {
                                            setSelectedSiteNumber(val);
                                            setUseCustomSite(false);
                                          }
                                        }}
                                        className="text-[11px] font-extrabold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-slate-800 dark:text-slate-100 outline-none max-w-[210px] truncate cursor-pointer hover:border-orange-500 shadow-2xs"
                                      >
                                        {(departmentProjects.length > 0 ? departmentProjects : projects).map((p) => (
                                          <option key={p.id} value={p.project_number}>
                                            {p.project_number} — {p.project_name}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  </>
                                );
                              })()}

                              {/* Aperçu des articles */}
                              <div className="mt-2 text-[11px] space-y-1 max-h-24 overflow-y-auto pr-1">
                                {basket.items.length === 0 ? (
                                  <span className="text-slate-400 italic text-[10px]">
                                    {tr(language, 'Panier vide pour le moment', 'Empty basket')}
                                  </span>
                                ) : (
                                  basket.items.slice(0, 4).map((it) => (
                                    <div key={String(it.product_id)} className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                                      <span className="truncate pr-2">• {it.product_name}</span>
                                      <span className="font-bold shrink-0">x{it.quantity}</span>
                                    </div>
                                  ))
                                )}
                                {basket.items.length > 4 && (
                                  <div className="text-[10px] text-slate-400 font-bold">
                                    + {basket.items.length - 4} autre(s) article(s)...
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Actions sur ce panier */}
                            <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-1.5 flex-wrap">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {isActive ? (
                                  <span className="px-2.5 py-1 rounded-xl bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300 font-extrabold text-[11px] flex items-center gap-1">
                                    ✓ Panier actif
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setActiveOrderBasketId(basket.id)}
                                    className="px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-[11px] transition cursor-pointer"
                                  >
                                    {tr(language, 'Utiliser ce panier', 'Select basket')}
                                  </button>
                                )}

                                {/* Bouton rapide Transmettre au magasin */}
                                <button
                                  type="button"
                                  disabled={basket.items.length === 0 || isSubmitting}
                                  onClick={() => handleQuickTransmitBasket(basket)}
                                  className="px-2.5 py-1 rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white font-extrabold text-[11px] flex items-center gap-1.5 shadow-sm shadow-emerald-600/25 transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                                  title={tr(language, 'Valider et transmettre ce panier au magasin', 'Transmit order to warehouse')}
                                >
                                  <Send className="w-3 h-3 stroke-[2.3]" />
                                  <span>{tr(language, 'Transmettre au magasin', 'Transmit')}</span>
                                </button>
                              </div>

                              <div className="flex items-center gap-1">
                                {/* Vider ce panier (si articles présents) */}
                                {basket.items.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setConfirmDialog({
                                        title: tr(language, 'Vider ce panier ?', 'Clear basket?'),
                                        message: tr(language, `Êtes-vous sûr de vouloir retirer tous les articles du panier « ${basket.name} » (${basket.items.length} articles) ?`, `Remove all items from basket "${basket.name}"?`),
                                        confirmText: tr(language, 'Vider', 'Clear'),
                                        isDanger: true,
                                        onConfirm: () => clearOrderCart(basket.id),
                                      });
                                    }}
                                    className="p-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950/60 text-amber-600 hover:text-amber-700 transition cursor-pointer"
                                    title={tr(language, 'Vider ce panier', 'Clear basket')}
                                  >
                                    <Eraser className="w-3.5 h-3.5" />
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() => duplicateOrderBasket(basket.id)}
                                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-700 transition cursor-pointer"
                                  title={tr(language, 'Dupliquer ce panier', 'Duplicate')}
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setConfirmDialog({
                                      title: tr(language, 'Supprimer ce panier ?', 'Delete basket?'),
                                      message: tr(language, `Êtes-vous sûr de vouloir supprimer définitivement le panier « ${basket.name} » (${basket.items.length} article(s)) ?`, `Delete basket "${basket.name}"?`),
                                      confirmText: tr(language, 'Supprimer', 'Delete'),
                                      isDanger: true,
                                      onConfirm: () => deleteOrderBasket(basket.id),
                                    });
                                  }}
                                  className="p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/60 text-rose-500 hover:text-rose-700 transition cursor-pointer"
                                  title={tr(language, 'Supprimer ce panier', 'Delete')}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* VUE COMPACTE DES PANIERS (isBasketsExpanded === false) */
                    <>
                      <div className="flex flex-col gap-2 pb-1 w-full max-w-full">
                        {orderBaskets.map((basket, bIdx) => {
                          const isActive = basket.id === activeOrderBasketId;
                          const effectiveMiniSite =
                            basket.site_number ||
                            (basket.id === activeOrderBasketId ? (useCustomSite ? customSiteNumber : selectedSiteNumber) : undefined) ||
                            departmentProjects[0]?.project_number ||
                            projects[0]?.project_number ||
                            '';
                          const miniProj = projects.find(
                            (p) => p.project_number.toUpperCase() === effectiveMiniSite.toUpperCase()
                          );

                          return (
                            <div
                              key={basket.id}
                              onClick={() => {
                                setActiveOrderBasketId(basket.id);
                                const site = basket.site_number || effectiveMiniSite;
                                if (site) {
                                  setSelectedSiteNumber(site);
                                  const inDept = departmentProjects.some((p) => p.project_number.toUpperCase() === site.toUpperCase());
                                  setUseCustomSite(!inDept);
                                  if (!inDept) setCustomSiteNumber(site);
                                }
                              }}
                              className={`w-full max-w-full flex flex-col gap-1.5 px-3 py-2.5 rounded-2xl border text-xs transition cursor-pointer shadow-2xs overflow-hidden ${
                                isActive
                                  ? 'bg-white dark:bg-slate-900 border-orange-500 ring-2 ring-orange-500/25 text-slate-900 dark:text-white font-black shadow-xs'
                                  : 'bg-white/70 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold hover:border-slate-300 dark:hover:border-slate-600'
                              }`}
                            >
                              {/* Ligne 1 : Nom du panier, compteur, dépôt et numéro de chantier */}
                              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span>🧺 {basket.name}</span>
                                  <span
                                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-black ${
                                      isActive
                                        ? 'bg-orange-500 text-white'
                                        : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                                    }`}
                                  >
                                    {basket.items.length}
                                  </span>
                                </div>

                                {basket.depot_name && (
                                  <span className="text-[9.5px] px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-bold border border-amber-200 dark:border-amber-800 truncate max-w-full">
                                    🏢 {basket.depot_name}
                                  </span>
                                )}

                                {/* Numéro de chantier obligatoirement présent et visible dans la miniature */}
                                <div
                                  className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-blue-100 dark:bg-blue-950/80 text-blue-900 dark:text-blue-200 font-black border border-blue-300 dark:border-blue-700 text-[10px] shadow-2xs truncate max-w-full"
                                  title={miniProj ? `${miniProj.project_number} — ${miniProj.project_name}` : (effectiveMiniSite ? `Chantier ${effectiveMiniSite}` : 'Chantier')}
                                >
                                  <span className="shrink-0">🏗️</span>
                                  <span className="truncate">{effectiveMiniSite ? `Chantier : ${effectiveMiniSite}` : (tr(language, 'Chantier : À définir', 'Site: None'))}</span>
                                </div>
                              </div>

                              {/* Ligne 2 : Sélecteur de chantier & Icônes d'actions alignées sans débordement */}
                              <div className="flex items-center justify-between gap-1.5 flex-wrap pt-1.5 border-t border-slate-100 dark:border-slate-800/80">
                                {/* Sélecteur direct de chantier depuis la miniature */}
                                <div onClick={(e) => e.stopPropagation()} className="min-w-[115px] flex-1 max-w-full sm:max-w-[180px]">
                                  <select
                                    value={basket.site_number || effectiveMiniSite}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      const val = e.target.value;
                                      updateOrderBasketSite(basket.id, val);
                                      if (basket.id === activeOrderBasketId) {
                                        setSelectedSiteNumber(val);
                                        setUseCustomSite(false);
                                      }
                                    }}
                                    className="w-full text-[10px] font-extrabold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-slate-800 dark:text-slate-100 outline-none truncate cursor-pointer hover:border-orange-500 shadow-2xs"
                                    title={tr(language, 'Affecter ou changer le chantier de ce panier', 'Assign or change site for this basket')}
                                  >
                                    {(departmentProjects.length > 0 ? departmentProjects : projects).map((p) => (
                                      <option key={p.id} value={p.project_number}>
                                        {p.project_number} — {p.project_name}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                <div className="flex items-center gap-1 flex-wrap max-w-full ml-auto">
                                  {/* Bouton rapide de validation & transmission au magasin depuis la miniature */}
                                  <button
                                    type="button"
                                    disabled={basket.items.length === 0 || isSubmitting}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleQuickTransmitBasket(basket);
                                    }}
                                    className="px-2.5 py-1 rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white font-black text-[10px] flex items-center gap-1 shadow-xs transition active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer shrink-0"
                                    title={tr(language, 'Valider et transmettre ce panier au magasin', 'Validate and transmit basket to warehouse')}
                                  >
                                    <Send className="w-2.5 h-2.5 shrink-0" />
                                    <span>{tr(language, 'Transmettre', 'Send')}</span>
                                  </button>

                                  {/* Bouton vider rapide sur la miniature */}
                                  {basket.items.length > 0 && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setConfirmDialog({
                                          title: tr(language, 'Vider ce panier ?', 'Clear basket?'),
                                          message: tr(language, `Êtes-vous sûr de vouloir retirer tous les articles du panier « ${basket.name} » (${basket.items.length} article(s)) ?`, `Remove all items from basket "${basket.name}"?`),
                                          confirmText: tr(language, 'Vider', 'Clear'),
                                          cancelText: tr(language, 'Annuler', 'Cancel'),
                                          isDanger: true,
                                          onConfirm: () => clearOrderCart(basket.id),
                                        });
                                      }}
                                      className="p-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-600 hover:text-amber-700 hover:bg-amber-100 transition cursor-pointer shrink-0"
                                      title={tr(language, 'Vider les articles de ce panier', 'Clear basket')}
                                    >
                                      <Eraser className="w-3 h-3 shrink-0" />
                                    </button>
                                  )}

                                  {/* Bouton supprimer le panier sur la miniature */}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setConfirmDialog({
                                        title: tr(language, 'Supprimer ce panier ?', 'Delete basket?'),
                                        message: tr(language, `Êtes-vous sûr de vouloir supprimer définitivement le panier « ${basket.name} » (${basket.items.length} article(s)) ?`, `Delete basket "${basket.name}"?`),
                                        confirmText: tr(language, 'Supprimer', 'Delete'),
                                        cancelText: tr(language, 'Annuler', 'Cancel'),
                                        isDanger: true,
                                        onConfirm: () => deleteOrderBasket(basket.id),
                                      });
                                    }}
                                    className="p-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-500 hover:text-rose-700 hover:bg-rose-100 transition cursor-pointer shrink-0"
                                    title={tr(language, 'Supprimer ce panier', 'Delete basket')}
                                  >
                                    <Trash2 className="w-3 h-3 shrink-0" />
                                  </button>

                                  {isActive && orderBaskets.length > 1 && (
                                    <div className="flex items-center gap-0.5 ml-0.5 border-l border-slate-200 dark:border-slate-700 pl-1" onClick={(e) => e.stopPropagation()}>
                                      <button
                                        type="button"
                                        onClick={() => moveOrderBasket(basket.id, 'up')}
                                        disabled={bIdx === 0}
                                        className="p-1 text-slate-500 hover:text-orange-600 disabled:opacity-20 cursor-pointer shrink-0"
                                        title={tr(language, 'Monter (↑)', 'Move up (↑)')}
                                      >
                                        <ArrowUp className="w-3 h-3 shrink-0" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => moveOrderBasket(basket.id, 'down')}
                                        disabled={bIdx === orderBaskets.length - 1}
                                        className="p-1 text-slate-500 hover:text-orange-600 disabled:opacity-20 cursor-pointer shrink-0"
                                        title={tr(language, 'Descendre (↓)', 'Move down (↓)')}
                                      >
                                        <ArrowDown className="w-3 h-3 shrink-0" />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Active Basket Toolbar (Rename, Duplicate, Delete) */}
                      {activeBasket && (
                        <div className="pt-2 border-t border-slate-200 dark:border-slate-700/60 flex items-center justify-between flex-wrap gap-2 text-xs">
                          <div className="flex items-center gap-2 min-w-0 flex-wrap">
                            {editingBasketNameId === activeBasket.id ? (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  value={basketNameInput}
                                  onChange={(e) => setBasketNameInput(e.target.value)}
                                  placeholder={activeBasket.name}
                                  autoFocus
                                  className="px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-orange-400 text-xs font-bold outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (basketNameInput.trim()) {
                                      renameOrderBasket(activeBasket.id, basketNameInput.trim());
                                    }
                                    setEditingBasketNameId(null);
                                  }}
                                  className="px-2 py-1 rounded-lg bg-orange-600 text-white font-bold text-xs cursor-pointer"
                                >
                                  OK
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingBasketNameId(null)}
                                  className="text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
                                >
                                  ✕
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <span className="font-extrabold text-slate-800 dark:text-slate-200">
                                  {activeBasket.name}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingBasketNameId(activeBasket.id);
                                    setBasketNameInput(activeBasket.name);
                                  }}
                                  className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 transition cursor-pointer"
                                  title={tr(language, 'Renommer ce panier', 'Rename basket')}
                                >
                                  <Edit2 className="w-3 h-3" />
                                </button>
                              </div>
                            )}
                            {activeBasket.depot_name && (
                              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                                • {tr(language, 'Dépôt réservé :', 'Depot:')} <strong>{activeBasket.depot_name}</strong>
                              </span>
                            )}
                            {activeBasket.site_number && (
                              <span className="text-[10px] px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-bold border border-blue-200 dark:border-blue-800 flex items-center gap-1">
                                <span>🏗️</span>
                                <span>{tr(language, 'Chantier :', 'Site:')} <strong>{activeBasket.site_number}</strong></span>
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 flex-wrap">
                            <button
                              type="button"
                              disabled={activeBasket.items.length === 0 || isSubmitting}
                              onClick={() => handleQuickTransmitBasket(activeBasket)}
                              className="px-2.5 py-1 rounded-lg bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white font-extrabold text-[11px] flex items-center gap-1 shadow-xs transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                              title={tr(language, 'Valider et transmettre ce panier au magasin', 'Transmit order to warehouse')}
                            >
                              <Send className="w-3 h-3 stroke-[2.3]" />
                              <span>{tr(language, 'Transmettre au magasin', 'Transmit')}</span>
                            </button>

                            {activeBasket.items.length > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setConfirmDialog({
                                    title: tr(language, 'Vider ce panier ?', 'Clear basket?'),
                                    message: tr(language, `Êtes-vous sûr de vouloir retirer tous les articles du panier « ${activeBasket.name} » (${activeBasket.items.length} articles) ?`, `Remove all items from basket "${activeBasket.name}"?`),
                                    confirmText: tr(language, 'Vider', 'Clear'),
                                    isDanger: true,
                                    onConfirm: () => clearOrderCart(activeBasket.id),
                                  });
                                }}
                                className="px-2 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 font-bold text-[11px] flex items-center gap-1 transition cursor-pointer"
                                title={tr(language, 'Vider les articles de ce panier', 'Clear basket')}
                              >
                                <Eraser className="w-3 h-3" />
                                <span>{tr(language, 'Vider', 'Clear')}</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => duplicateOrderBasket(activeBasket.id)}
                              className="px-2 py-1 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-[11px] flex items-center gap-1 transition cursor-pointer"
                              title={tr(language, 'Dupliquer ce panier', 'Duplicate basket')}
                            >
                              <Copy className="w-3 h-3" />
                              <span>{tr(language, 'Dupliquer', 'Duplicate')}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmDialog({
                                  title: tr(language, 'Supprimer ce panier ?', 'Delete basket?'),
                                  message: tr(language, `Êtes-vous sûr de vouloir supprimer définitivement le panier « ${activeBasket.name} » (${activeBasket.items.length} article(s)) ?`, `Delete basket "${activeBasket.name}"?`),
                                  confirmText: tr(language, 'Supprimer', 'Delete'),
                                  cancelText: tr(language, 'Annuler', 'Cancel'),
                                  isDanger: true,
                                  onConfirm: () => deleteOrderBasket(activeBasket.id),
                                });
                              }}
                              className="px-2 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 text-rose-600 border border-rose-200 dark:border-rose-800 font-bold text-[11px] flex items-center gap-1 transition cursor-pointer"
                              title={tr(language, 'Supprimer ce panier', 'Delete basket')}
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>{tr(language, 'Supprimer', 'Delete')}</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })()}

            {orderCart.length === 0 ? (
              <div className="p-8 text-center text-slate-400 dark:text-slate-500 space-y-3">
                <div className="w-16 h-16 mx-auto rounded-3xl bg-orange-50 dark:bg-orange-950/40 text-orange-400 flex items-center justify-center">
                  <ShoppingCart className="w-8 h-8 opacity-60" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    {tr(language, 'Votre panier de matériel est vide', 'Your cart is empty')}
                  </p>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                    {tr(language, 'Parcourez le catalogue ou scannez des références pour ajouter les articles dont vous avez besoin sur chantier.', 'Browse the catalog or scan barcodes to add items needed for your job site.')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOrderCartModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs shadow-md shadow-orange-500/20 transition cursor-pointer"
                >
                  {tr(language, 'Consulter le catalogue matériel', 'Browse catalog')}
                </button>
              </div>
            ) : (
              <form onSubmit={handleOrderSubmit} className="space-y-4">
                {/* Items List */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-500 px-1 font-bold flex-wrap gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-slate-800 dark:text-slate-200">
                        {orderCart.length} {tr(language, 'article(s) sélectionné(s)', 'item(s) in cart')}
                        <span className="text-slate-400 font-normal ml-1">
                          ({orderCart.reduce((acc, it) => acc + (it.quantity || 0), 0)} pcs)
                        </span>
                      </span>

                      {/* Boutons Agrandir (↑ Afficher) et Diminuer (↓ Masquer) la liste des articles */}
                      <div className="flex items-center bg-white dark:bg-slate-900 rounded-lg p-0.5 border border-slate-200 dark:border-slate-700 text-[11px] shadow-2xs">
                        <button
                          type="button"
                          onClick={() => setIsArticlesListHidden(false)}
                          className={`px-2 py-0.5 rounded flex items-center gap-1 transition cursor-pointer ${
                            !isArticlesListHidden
                              ? 'bg-orange-500 text-white font-black shadow-2xs'
                              : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                          }`}
                          title={tr(language, 'Agrandir / Afficher la liste des articles (↑)', 'Expand / Show items (↑)')}
                        >
                          <ArrowUp className="w-3 h-3 stroke-[2.5]" />
                          <span className="text-[10px] hidden sm:inline">{tr(language, 'Agrandir (Afficher)', 'Expand (Show)')}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsArticlesListHidden(true)}
                          className={`px-2 py-0.5 rounded flex items-center gap-1 transition cursor-pointer ${
                            isArticlesListHidden
                              ? 'bg-orange-500 text-white font-black shadow-2xs'
                              : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                          }`}
                          title={tr(language, 'Diminuer / Masquer la liste des articles (↓)', 'Reduce / Hide items (↓)')}
                        >
                          <ArrowDown className="w-3 h-3 stroke-[2.5]" />
                          <span className="text-[10px] hidden sm:inline">{tr(language, 'Diminuer (Masquer)', 'Reduce (Hide)')}</span>
                        </button>
                      </div>
                    </div>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => {
                            if (!activeBasket) return;
                            setConfirmDialog({
                              title: tr(language, 'Vider ce panier ?', 'Clear basket?'),
                              message: tr(language, `Êtes-vous sûr de vouloir retirer tous les articles du panier « ${activeBasket.name} » (${activeBasket.items.length} article(s)) ?`, `Remove all items from basket "${activeBasket.name}"?`),
                              confirmText: tr(language, 'Vider', 'Clear'),
                              cancelText: tr(language, 'Annuler', 'Cancel'),
                              isDanger: true,
                              onConfirm: () => clearOrderCart(activeBasket.id),
                            });
                          }}
                          className="text-amber-600 hover:text-amber-700 text-[11px] font-bold flex items-center gap-1 cursor-pointer px-2 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 transition"
                          title={tr(language, 'Vider tous les articles de ce panier', 'Clear all items in basket')}
                        >
                          <Eraser className="w-3 h-3" />
                          <span>{tr(language, 'Vider le panier', 'Clear cart')}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            if (!activeBasket) return;
                            setConfirmDialog({
                              title: tr(language, 'Supprimer ce panier ?', 'Delete basket?'),
                              message: tr(language, `Êtes-vous sûr de vouloir supprimer définitivement le panier « ${activeBasket.name} » (${activeBasket.items.length} article(s)) ?`, `Delete basket "${activeBasket.name}"?`),
                              confirmText: tr(language, 'Supprimer', 'Delete'),
                              cancelText: tr(language, 'Annuler', 'Cancel'),
                              isDanger: true,
                              onConfirm: () => deleteOrderBasket(activeBasket.id),
                            });
                          }}
                          className="text-rose-600 hover:text-rose-700 text-[11px] font-bold flex items-center gap-1 cursor-pointer px-2 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 transition"
                          title={tr(language, 'Supprimer définitivement ce panier', 'Delete basket')}
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>{tr(language, 'Supprimer le panier', 'Delete basket')}</span>
                        </button>
                      </div>
                    </div>

                  {/* VUE MASQUÉE (isArticlesListHidden === true) */}
                  {isArticlesListHidden ? (
                    <div
                      onClick={() => setIsArticlesListHidden(false)}
                      className="p-3.5 rounded-2xl bg-slate-100/90 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:border-orange-500 transition cursor-pointer flex items-center justify-between gap-2.5 flex-wrap shadow-2xs group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-orange-100 dark:bg-orange-950/60 text-orange-600 flex items-center justify-center font-bold text-base shrink-0">
                          📦
                        </div>
                        <div className="min-w-0">
                          <div className="font-extrabold text-xs text-slate-800 dark:text-slate-100 truncate">
                            {orderCart.length} article(s) • {orderCart.reduce((sum, it) => sum + (it.quantity || 0), 0)} pièces au total
                            {canViewPrices && totalCartCost > 0 && (
                              <span className="text-orange-600 dark:text-orange-400 font-bold ml-1.5">
                                ({formatCurrency(totalCartCost)})
                              </span>
                            )}
                          </div>
                          <div className="text-[10.5px] text-slate-400">
                            {tr(language, 'Articles masqués (↓) pour accéder directement au chantier et au retrait. Cliquez sur Agrandir (↑).', 'Items hidden (↓). Click Expand (↑) to show details.')}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsArticlesListHidden(false);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-orange-600 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs group-hover:bg-orange-700 transition shrink-0 cursor-pointer"
                      >
                        <ArrowUp className="w-3.5 h-3.5 stroke-[2.5]" />
                        <span>{tr(language, 'Agrandir (↑)', 'Expand (↑)')}</span>
                      </button>
                    </div>
                  ) : (
                    /* VUE DÉPLIÉE / AGRANDIE DES ARTICLES (isArticlesListHidden === false) */
                    <>
                      <div className="bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800 overflow-hidden">
                        {orderCart.map((item) => (
                          <div
                            key={String(item.product_id)}
                            className="p-3 flex items-center justify-between gap-2.5 flex-wrap text-xs transition bg-white/40 dark:bg-slate-900/40"
                          >
                            <div className="min-w-[140px] flex-1">
                              <div className="font-bold text-slate-800 dark:text-slate-100 truncate">
                                {item.product_name}
                              </div>
                              <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5 flex-wrap">
                                <span className="font-mono font-semibold text-orange-600 dark:text-orange-400">
                                  {item.product_ref}
                                </span>
                                {item.depot_name && (
                                  <span className="text-slate-500 dark:text-slate-400">
                                    • 🏢 {item.depot_name}
                                  </span>
                                )}
                                {canViewPrices && item.unit_price && item.unit_price > 0 && (
                                  <span>• {formatCurrency(item.unit_price)} / u</span>
                                )}
                                {canViewPrices && item.unit_price && item.unit_price > 0 && (
                                  <span className="font-extrabold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.2 rounded">
                                    Total: {formatCurrency(item.quantity * item.unit_price)}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Stepper avec boutons ↑ et ↓ */}
                            <div className="flex items-center gap-2 flex-wrap ml-auto">
                              <div className="flex items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-0.5 shadow-2xs">
                                <button
                                  type="button"
                                  onClick={() => updateOrderCartQty(item.product_id, Math.max(1, item.quantity - 1))}
                                  className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                                  title={tr(language, 'Diminuer la quantité (↓ / -)', 'Decrease quantity (↓ / -)')}
                                >
                                  <ChevronDown className="w-3.5 h-3.5 stroke-[2.5]" />
                                </button>
                                <input
                                  type="number"
                                  min="1"
                                  value={item.quantity}
                                  onChange={(e) =>
                                    updateOrderCartQty(
                                      item.product_id,
                                      Math.max(1, parseInt(e.target.value) || 1)
                                    )
                                  }
                                  className="w-10 text-center font-bold text-xs bg-transparent outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => updateOrderCartQty(item.product_id, item.quantity + 1)}
                                  className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                                  title={tr(language, 'Augmenter la quantité (↑ / +)', 'Increase quantity (↑ / +)')}
                                >
                                  <ChevronUp className="w-3.5 h-3.5 stroke-[2.5]" />
                                </button>
                              </div>

                              <button
                                type="button"
                                onClick={() => removeFromOrderCart(item.product_id)}
                                className="w-7 h-7 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center justify-center transition cursor-pointer"
                                title="Supprimer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      {canViewPrices && totalCartCost > 0 && (
                        <div className="flex justify-between items-center px-2 py-1 text-xs text-slate-500 font-bold">
                          <span>{tr(language, 'Total estimé du matériel :', 'Estimated total:')}</span>
                          <span className="text-sm font-black text-slate-900 dark:text-white">
                            {formatCurrency(totalCartCost)}
                          </span>
                        </div>
                      )}

                      {/* Quick Add Product Button (User Requested) */}
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setIsAddProductPickerOpen(true);
                            setPickerFeedbackMsg(null);
                          }}
                          className="w-full py-2.5 px-3 rounded-2xl border-2 border-dashed border-orange-300 dark:border-orange-800/80 bg-orange-50/70 dark:bg-orange-950/20 hover:bg-orange-100/70 dark:hover:bg-orange-950/40 text-orange-700 dark:text-orange-400 font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer active:scale-98 shadow-2xs group"
                        >
                          <PlusCircle className="w-4 h-4 text-orange-500 group-hover:scale-110 transition" />
                          <span>
                            {tr(language, '+ Ajouter un article à la commande', '+ Add an item to this order')}
                          </span>
                        </button>
                      </div>
                    </>
                  )}
                </div>

                 {/* Destination & Preparation Settings */}
                <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-3.5 border border-slate-200 dark:border-slate-800 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <Building2 className="w-4 h-4 text-orange-500" />
                      <span>{tr(language, 'Affectation & Lieu de Retrait', 'Site & Pickup Depot')}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10.5px] font-bold text-slate-500 dark:text-slate-400">
                        {isOfflineMode
                          ? tr(language, 'N° Hors-Ligne (OFF) :', 'Offline Order #:')
                          : tr(language, 'N° Serveur Unique :', 'Server Unique #:')}
                      </span>
                      <span
                        className={`font-mono font-black text-[11px] px-2 py-0.5 rounded-lg border ${
                          isOfflineMode
                            ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-900 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                            : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                        }`}
                      >
                        {previewNextOrderNumber}
                      </span>
                    </div>
                  </div>

                  {/* Project / Site (Filtré par département d'appartenance et propre à ce panier) */}
                  <div>
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                      <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400">
                        {tr(language, `Chantier de destination pour ce panier « ${activeBasket?.name || 'Panier'} » (${userDeptObj ? userDeptObj.name : currentUser?.department || 'Votre Département'}) :`, `Job Site for this basket "${activeBasket?.name || 'Basket'}" (${userDeptObj ? userDeptObj.name : currentUser?.department || 'Your Department'}):`)}
                      </label>
                      <button
                        type="button"
                        onClick={() => setUseCustomSite(!useCustomSite)}
                        className="text-[10px] text-orange-600 font-bold hover:underline cursor-pointer shrink-0"
                      >
                        {useCustomSite
                          ? tr(language, 'Choisir dans mon département', 'Select from my dept')
                          : tr(language, 'Saisie manuelle (+)', 'Manual code (+)')}
                      </button>
                    </div>

                    {useCustomSite ? (
                      <input
                        type="text"
                        value={customSiteNumber}
                        onChange={(e) => handleCustomSiteChange(e.target.value)}
                        placeholder="Ex: CH-2026-99"
                        required
                        className="w-full text-xs p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none uppercase font-bold"
                      />
                    ) : (
                      <select
                        value={selectedSiteNumber}
                        onChange={(e) => handleSiteSelectChange(e.target.value)}
                        className="w-full text-xs p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none font-bold"
                      >
                        {departmentProjects.length === 0 ? (
                          <option value="">
                            {tr(language, 'Aucun chantier pour votre département', 'No site for your department')}
                          </option>
                        ) : (
                          departmentProjects.map((p) => (
                            <option key={p.id} value={p.project_number}>
                              {p.project_number} — {p.project_name}
                            </option>
                          ))
                        )}
                      </select>
                    )}
                  </div>

                  {/* Depot for Pickup (Mono-dépôt restriction) */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                      {tr(language, 'Dépôt / Magasin de retrait :', 'Warehouse / Pickup Location:')}
                    </label>
                    <select
                      value={orderCart.length > 0 && orderCart[0]?.depot_name ? orderCart[0].depot_name : selectedDepot}
                      disabled={orderCart.length > 0 && Boolean(orderCart[0]?.depot_name)}
                      onChange={(e) => setSelectedDepot(e.target.value)}
                      className={`w-full text-xs p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none font-bold ${
                        orderCart.length > 0 ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-not-allowed' : ''
                      }`}
                    >
                      {depots.map((d) => (
                        <option key={String(d.id)} value={d.name}>
                          {d.name} {d.code ? `(${d.code})` : ''}
                        </option>
                      ))}
                    </select>
                    {orderCart.length > 0 && orderCart[0]?.depot_name && (
                      <p className="text-[10px] text-orange-600 dark:text-orange-400 font-bold mt-1 flex items-center gap-1">
                        <span>🔒</span>
                        <span>
                          {tr(language, `Commande mono-dépôt : tous les articles proviennent du « ${orderCart[0].depot_name} ».`, `Single-depot rule: all items are from "${orderCart[0].depot_name}".`)}
                        </span>
                      </p>
                    )}
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                      {tr(language, 'Instructions pour le préparateur (optionnel) :', 'Notes for storekeeper (optional):')}
                    </label>
                    <textarea
                      value={orderNotes}
                      onChange={(e) => setOrderNotes(e.target.value)}
                      placeholder={
                        tr(language, 'Ex: Besoin urgent pour l\'équipe de 13h30, cage d\'escalier B...', 'Ex: Urgent for afternoon crew...')
                      }
                      rows={2}
                      className="w-full text-xs p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none resize-none"
                    />
                  </div>
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-extrabold text-sm shadow-lg shadow-orange-500/25 flex items-center justify-center gap-2 transition active:scale-98 cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  <span>
                    {isSubmitting
                      ? tr(language, 'Envoi en cours...', 'Submitting...')
                      : tr(language, 'Transmettre la Commande au Magasin', 'Submit Order to Warehouse')}
                  </span>
                </button>
              </form>
            )}
          </div>
        )}

        {/* Tab 2: Orders Follow-up & Collection */}
        {activeTab === 'orders' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {/* QR Code Shelf Pickup Scanner Banner */}
            <div className="p-3 rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 text-white shadow-md shadow-emerald-600/20 flex items-center justify-between gap-2.5 flex-wrap">
              <div className="flex items-center gap-2.5 min-w-[180px] flex-1">
                <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                  <QrCode className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0">
                  <div className="font-extrabold text-xs leading-tight">
                    {tr(language, 'Retrait sur étagère de magasin', 'Warehouse Shelf Pickup')}
                  </div>
                  <div className="text-[11px] text-emerald-100 truncate">
                    {tr(language, 'Scannez le QR code sur l\'étagère pour valider votre commande', 'Scan QR code on shelf to verify and confirm pickup')}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleStartPickupScanner}
                className="py-2 px-3.5 rounded-xl bg-white text-emerald-800 font-extrabold text-xs shadow-sm hover:bg-emerald-50 transition active:scale-95 cursor-pointer flex items-center gap-1.5 shrink-0"
              >
                <Camera className="w-4 h-4 text-emerald-700" />
                <span>{tr(language, 'Scanner Retrait', 'Scan to Collect')}</span>
              </button>
            </div>

            {myActiveOrders.length === 0 ? (
              <div className="p-8 text-center text-slate-400 dark:text-slate-500 space-y-3">
                <div className="w-14 h-14 mx-auto rounded-3xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    {tr(language, 'Aucune commande en attente de retrait', 'No pending orders')}
                  </p>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                    {tr(language, 'Dès que vous confirmez le retrait d\'une commande, elle disparaît automatiquement de cette liste active.', 'Once you confirm collection, orders automatically disappear from this active view.')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('cart')}
                  className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs shadow-md shadow-orange-500/20 transition cursor-pointer"
                >
                  {tr(language, 'Créer une nouvelle commande', 'Create new order')}
                </button>
              </div>
            ) : selectedDetailOrder ? (
              /* DEDICATED FULL WINDOW FOR SELECTED ORDER (Fenêtre dédiée avec bouton retour) */
              <div className="space-y-4 animate-fadeIn">
                {/* Navigation Bar with Prominent Back Button */}
                <div className="flex items-center justify-between gap-3 p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex-wrap">
                  <button
                    type="button"
                    onClick={() => setSelectedDetailOrderId(null)}
                    className="py-2 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-black text-xs flex items-center gap-2 transition active:scale-95 cursor-pointer shadow-2xs"
                  >
                    <ArrowLeft className="w-4 h-4 stroke-[2.5]" />
                    <span>{tr(language, '← Revenir à la liste des commandes', '← Back to orders list')}</span>
                  </button>

                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-black text-xs px-2.5 py-1 rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-2xs">
                      {selectedDetailOrder.order_number}
                    </span>
                    {selectedDetailOrder.order_number?.endsWith('_OFF') && (
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                        OFF (Offline)
                      </span>
                    )}

                    {/* Status Badge */}
                    {selectedDetailOrder.status === 'WAITING_APPROVAL' && (
                      <span className="px-2.5 py-1 rounded-full text-xs font-black bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-300 border border-purple-300 flex items-center gap-1">
                        <ShieldAlert className="w-3.5 h-3.5 text-purple-600" />
                        <span>{tr(language, 'À Valider par Chef de Service / Chantier', 'Approval Required')}</span>
                      </span>
                    )}
                    {selectedDetailOrder.status === 'PENDING' && (
                      <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300 flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{tr(language, 'En attente de préparation magasin', 'Pending pick')}</span>
                      </span>
                    )}
                    {selectedDetailOrder.status === 'PREPARING' && (
                      <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-300 flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 animate-spin" />
                        <span>{tr(language, `En préparation : ${selectedDetailOrder.preparer_name || 'Magasinier'}`, 'Preparing')}</span>
                      </span>
                    )}
                    {selectedDetailOrder.status === 'READY' && (
                      <span className="px-2.5 py-1 rounded-full text-xs font-black bg-emerald-500 text-white flex items-center gap-1 shadow-sm">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{tr(language, 'PRÊTE AU RETRAIT', 'READY FOR PICKUP')}</span>
                      </span>
                    )}
                    {selectedDetailOrder.status === 'REJECTED' && (
                      <span className="px-2.5 py-1 rounded-full text-xs font-black bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-300 border border-rose-300 flex items-center gap-1">
                        <X className="w-3.5 h-3.5 text-rose-600" />
                        <span>{tr(language, 'Commande Refusée', 'Rejected')}</span>
                      </span>
                    )}
                    {selectedDetailOrder.status === 'COLLECTED' && (
                      <span className="px-2.5 py-1 rounded-full text-xs font-black bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200 border border-slate-300 flex items-center gap-1">
                        <PackageCheck className="w-3.5 h-3.5 text-emerald-600" />
                        <span>{tr(language, 'Retirée', 'Collected')}</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Workflow Status Banners */}
                {selectedDetailOrder.status === 'REJECTED' && (
                  <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-800 text-xs text-rose-900 dark:text-rose-200 space-y-1">
                    <div className="font-extrabold flex items-center gap-1.5">
                      <X className="w-4 h-4 text-rose-600" />
                      <span>
                        Commande refusée par <strong>{selectedDetailOrder.rejected_by || 'le Responsable'}</strong>{' '}
                        {selectedDetailOrder.rejected_at ? `le ${new Date(selectedDetailOrder.rejected_at).toLocaleString('fr-FR')}` : ''}
                      </span>
                    </div>
                    <div className="text-[11.5px] text-rose-800 dark:text-rose-300 pl-5">
                      <strong>Motif du refus :</strong> {selectedDetailOrder.rejection_reason || 'Non précisé'}
                    </div>
                  </div>
                )}

                {selectedDetailOrder.approved_by && (
                  <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>
                      Commande validée par <strong>{selectedDetailOrder.approved_by}</strong>{' '}
                      {selectedDetailOrder.approved_at ? `le ${new Date(selectedDetailOrder.approved_at).toLocaleString('fr-FR')}` : ''}.
                    </span>
                  </div>
                )}

                {/* Ready Callout with Pickup Zone and Actions */}
                {selectedDetailOrder.status === 'READY' && (
                  <div className="p-4 rounded-2xl bg-emerald-100 dark:bg-emerald-950/80 border-2 border-emerald-400 dark:border-emerald-600 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-sm">
                        <Check className="w-6 h-6 stroke-[3]" />
                      </div>
                      <div>
                        <div className="font-black text-sm text-emerald-950 dark:text-white">
                          {tr(language, 'Matériel prêt au magasin !', 'Your material is ready!')}
                        </div>
                        <div className="text-xs font-black text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5 mt-0.5">
                          <MapPin className="w-4 h-4 text-emerald-600" />
                          <span>
                            {tr(language, `Emplacement de retrait : ${selectedDetailOrder.pickup_zone || 'Zone de retrait magasin'}`, `Pickup Location: ${selectedDetailOrder.pickup_zone || 'Store pickup area'}`)}
                          </span>
                        </div>
                        <div className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5">
                          {selectedDetailOrder.preparer_name ? `Préparé par ${selectedDetailOrder.preparer_name}` : ''}{' '}
                          {selectedDetailOrder.ready_at ? `le ${new Date(selectedDetailOrder.ready_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => handlePrintRequesterSlip(selectedDetailOrder)}
                        className="py-2 px-3.5 rounded-xl bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 font-bold text-xs border border-slate-300 dark:border-slate-700 shadow-2xs flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5 text-slate-500" />
                        <span>{tr(language, 'Imprimer Bon', 'Print Slip')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleStartPickupScanner}
                        className="py-2 px-3.5 rounded-xl bg-white dark:bg-slate-800 text-emerald-800 dark:text-emerald-300 font-bold text-xs border border-emerald-300 dark:border-emerald-700 shadow-2xs flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
                      >
                        <Camera className="w-3.5 h-3.5 text-emerald-600" />
                        <span>{tr(language, 'Scanner Étagère', 'Scan Shelf')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleConfirmCollection(selectedDetailOrder.id)}
                        className="py-2 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-md shadow-emerald-600/30 flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
                      >
                        <PackageCheck className="w-4 h-4" />
                        <span>{tr(language, 'Confirmer Retrait', 'Confirm Pickup')}</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Metadata Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Chantier / Projet</span>
                    <span className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-1.5 mt-0.5">
                      <Building2 className="w-4 h-4 text-orange-500" />
                      <span>{selectedDetailOrder.site_number}</span>
                    </span>
                    {selectedDetailOrder.site_name && (
                      <span className="text-xs text-slate-500 block truncate mt-0.5">{selectedDetailOrder.site_name}</span>
                    )}
                  </div>

                  <div className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Lieu de retrait</span>
                    <span className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-1.5 mt-0.5">
                      <Warehouse className="w-4 h-4 text-amber-500" />
                      <span>{selectedDetailOrder.depot_name || 'Dépôt Principal'}</span>
                    </span>
                    {selectedDetailOrder.pickup_zone && (
                      <span className="text-xs font-bold text-purple-600 dark:text-purple-400 block mt-0.5">
                        Emplacement : {selectedDetailOrder.pickup_zone}
                      </span>
                    )}
                  </div>

                  <div className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Demandeur & Date</span>
                    <span className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-1.5 mt-0.5">
                      <User className="w-4 h-4 text-blue-500" />
                      <span>{selectedDetailOrder.requester_name}</span>
                    </span>
                    <span className="text-xs text-slate-500 block mt-0.5">
                      {selectedDetailOrder.requester_department ? `Dép. ${selectedDetailOrder.requester_department} • ` : ''}
                      {new Date(selectedDetailOrder.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  </div>
                </div>

                {/* Notes */}
                {selectedDetailOrder.notes && (
                  <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-xs text-amber-900 dark:text-amber-200">
                    <strong>Instructions du demandeur :</strong> {selectedDetailOrder.notes}
                  </div>
                )}

                {/* Delegation / Transfert à un collègue */}
                <div className="p-3.5 rounded-2xl border bg-purple-50/40 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 flex items-center justify-center shrink-0">
                      <Users className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1.5 flex-wrap">
                        <span>Prise en charge du retrait :</span>
                        {selectedDetailOrder.pickup_delegate_name ? (
                          <span className="px-2 py-0.5 rounded-md bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-200 text-[11px] font-extrabold border border-purple-300 dark:border-purple-800">
                            Délégué à {selectedDetailOrder.pickup_delegate_name} ({selectedDetailOrder.pickup_delegate_department || 'Département'})
                          </span>
                        ) : (
                          <span className="text-slate-500 font-bold">Demandeur initial ({selectedDetailOrder.requester_name})</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {selectedDetailOrder.pickup_delegate_name ? (
                          <>
                            Délégation enregistrée par {selectedDetailOrder.pickup_delegate_by || selectedDetailOrder.requester_name}
                            {selectedDetailOrder.pickup_delegate_at ? ` le ${new Date(selectedDetailOrder.pickup_delegate_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}` : ''}
                            {selectedDetailOrder.pickup_delegate_notes && ` — « ${selectedDetailOrder.pickup_delegate_notes} »`}
                          </>
                        ) : (
                          "Si le demandeur n'est pas disponible pour récupérer la commande, il peut la transférer à un collègue de son département."
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Transfer button for Requester or Manager */}
                  {(String(selectedDetailOrder.requester_id) === String(currentUser?.id) ||
                    (currentUser && (Number(currentUser.id) === 0 || Number(currentUser.role_id) <= 1 || userHasPermission('perm_orders_manage')))) &&
                    selectedDetailOrder.status !== 'COLLECTED' &&
                    selectedDetailOrder.status !== 'REJECTED' && (
                      <button
                        type="button"
                        onClick={() => handleOpenDelegateModal(selectedDetailOrder)}
                        className="py-1.5 px-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-extrabold text-xs flex items-center gap-1.5 transition active:scale-95 cursor-pointer shrink-0 shadow-xs"
                      >
                        <ArrowRightLeft className="w-3.5 h-3.5" />
                        <span>{selectedDetailOrder.pickup_delegate_id ? 'Changer délégation' : 'Transférer à un collègue'}</span>
                      </button>
                    )}
                </div>

                {/* Items List */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 shadow-xs">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                    <h3 className="font-black text-sm text-slate-900 dark:text-white flex items-center gap-2">
                      <Package className="w-4 h-4 text-orange-500" />
                      <span>Articles commandés ({selectedDetailOrder.items.length})</span>
                    </h3>
                    {selectedDetailOrder.total_cost !== undefined && selectedDetailOrder.total_cost > 0 && canViewPrices && (
                      <span className="font-black text-sm text-slate-900 dark:text-white px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800">
                        Total : {formatCurrency(selectedDetailOrder.total_cost)}
                      </span>
                    )}
                  </div>

                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {selectedDetailOrder.items.map((it, idx) => (
                      <div key={idx} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-lg bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-300 font-black">
                              {it.quantity} {it.unit || 'pcs'}
                            </span>
                            <span className="truncate">{it.product_name}</span>
                          </div>
                          <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                            Réf: {it.product_ref} {it.brand ? `• ${it.brand}` : ''}
                          </div>

                          {it.unavailable && (
                            <div className="mt-1 p-1 px-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-[10.5px] font-bold border border-rose-200 dark:border-rose-900">
                              ⚠️ Article non disponible au magasin {it.unavailable_comment ? `— ${it.unavailable_comment}` : ''}
                            </div>
                          )}

                          {it.substituted && (
                            <div className="mt-1 p-1 px-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-[10.5px] font-bold border border-amber-200 dark:border-amber-800">
                              🔄 Substitué par le magasin : <strong>{it.substituted_with_ref} - {it.substituted_with_name}</strong>
                            </div>
                          )}
                        </div>

                        {canViewPrices && it.unit_price !== undefined && (
                          <div className="text-right shrink-0">
                            <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                              {formatCurrency((it.unit_price || 0) * it.quantity)}
                            </span>
                            <div className="text-[10px] text-slate-400">
                              {formatCurrency(it.unit_price)} / u.
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Detailed View Action Bar */}
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setSelectedDetailOrderId(null)}
                    className="py-2 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>{tr(language, '← Revenir à la liste', '← Back to list')}</span>
                  </button>

                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Approbations (Chefs de Département / Projet & Suppléants) */}
                    {selectedDetailOrder.status === 'WAITING_APPROVAL' && canApproveOrder(selectedDetailOrder) && (
                      <>
                        <button
                          type="button"
                          disabled={approvalActionLoading}
                          onClick={() => handleApproveOrder(selectedDetailOrder)}
                          className="py-2 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs transition active:scale-95 cursor-pointer flex items-center gap-1.5 shadow-sm"
                        >
                          <Check className="w-4 h-4" />
                          <span>{tr(language, 'Valider la commande', 'Approve Order')}</span>
                        </button>
                        <button
                          type="button"
                          disabled={approvalActionLoading}
                          onClick={() => {
                            setRejectingOrder(selectedDetailOrder);
                            setRejectionReasonInput('');
                          }}
                          className="py-2 px-4 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-black text-xs border border-rose-300 transition active:scale-95 cursor-pointer flex items-center gap-1.5"
                        >
                          <X className="w-4 h-4" />
                          <span>{tr(language, 'Refuser la commande', 'Reject Order')}</span>
                        </button>
                      </>
                    )}
                    {selectedDetailOrder.status === 'WAITING_APPROVAL' && !canApproveOrder(selectedDetailOrder) && (
                      <button
                        type="button"
                        onClick={() => {
                          alert(
                            tr(language, 'Accès refusé : Seuls les Chefs de Département & Suppléants et les Chefs de Chantier / Chefs de Projet & Suppléants du service rattaché (ou les administrateurs) peuvent valider ou refuser cette commande.', 'Access denied: Only department heads/deputies and site/project managers/deputies of the service (or administrators) can approve or reject this order.')
                          );
                        }}
                        className="py-2 px-3.5 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800 text-xs font-bold flex items-center gap-1.5 cursor-pointer hover:bg-purple-100 transition shadow-2xs"
                        title="Seuls les Chefs de Département & Suppléants et Chefs de Chantier / Projet & Suppléants peuvent valider cette commande"
                      >
                        <ShieldAlert className="w-4 h-4 text-purple-600 shrink-0" />
                        <span>{tr(language, 'Validation réservée aux Chefs & Suppléants', 'Approval restricted to Managers')}</span>
                      </button>
                    )}

                    {/* Modifier si non encore en préparation */}
                    {(selectedDetailOrder.status === 'WAITING_APPROVAL' || selectedDetailOrder.status === 'PENDING') && (
                      <button
                        type="button"
                        onClick={() => handleStartEditOrder(selectedDetailOrder)}
                        className="py-2 px-3.5 rounded-xl bg-orange-50 hover:bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300 font-bold text-xs border border-orange-200 dark:border-orange-800 transition cursor-pointer flex items-center gap-1.5"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-orange-600" />
                        <span>{tr(language, 'Modifier', 'Edit')}</span>
                      </button>
                    )}

                    {/* Supprimer définitivement la commande si non encore en traitement */}
                    {(selectedDetailOrder.status === 'WAITING_APPROVAL' || selectedDetailOrder.status === 'PENDING') && (
                      <button
                        type="button"
                        onClick={() => handleDeleteOrder(selectedDetailOrder)}
                        className="py-2 px-4 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-black text-xs border border-rose-300 transition active:scale-95 cursor-pointer flex items-center gap-1.5 shadow-2xs"
                        title="Supprimer définitivement la commande"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                        <span>{tr(language, 'Supprimer la commande', 'Delete Order')}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              /* REDUCED / COMPACT TILES LIST (Tuiles avec boutons Agrandir ↑ et Diminuer ↓) */
              <div className="space-y-2.5">
                {/* Orders list toolbar with Agrandir (↑) and Diminuer (↓) */}
                <div className="flex items-center justify-between px-1 text-xs text-slate-500 font-bold flex-wrap gap-2">
                  <span>{myActiveOrders.length} {tr(language, 'commande(s) en cours', 'active order(s)')}</span>

                  <div className="flex items-center bg-white dark:bg-slate-900 rounded-xl p-0.5 border border-slate-200 dark:border-slate-700 text-[11px] shadow-2xs">
                    <button
                      type="button"
                      onClick={() => {
                        const allExp: Record<string, boolean> = {};
                        myActiveOrders.forEach((o) => { allExp[o.id] = true; });
                        setExpandedOrdersMap(allExp);
                      }}
                      className="px-2 py-0.5 rounded-lg flex items-center gap-1 text-slate-600 dark:text-slate-300 hover:text-orange-600 transition cursor-pointer"
                      title={tr(language, 'Agrandir / Déplier toutes les commandes (↑)', 'Expand all orders (↑)')}
                    >
                      <ArrowUp className="w-3 h-3" />
                      <span>{tr(language, 'Agrandir tout (↑)', 'Expand all (↑)')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedOrdersMap({})}
                      className="px-2 py-0.5 rounded-lg flex items-center gap-1 text-slate-600 dark:text-slate-300 hover:text-orange-600 transition cursor-pointer"
                      title={tr(language, 'Diminuer / Réduire toutes les commandes (↓)', 'Reduce all orders (↓)')}
                    >
                      <ArrowDown className="w-3 h-3" />
                      <span>{tr(language, 'Diminuer tout (↓)', 'Reduce all (↓)')}</span>
                    </button>
                  </div>
                </div>

                {myActiveOrders.map((order) => {
                  const isWaitingApproval = order.status === 'WAITING_APPROVAL';
                  const isReady = order.status === 'READY';
                  const isPreparing = order.status === 'PREPARING';
                  const isPending = order.status === 'PENDING';
                  const canIApproveThisOrder = canApproveOrder(order);
                  const isMyOrder =
                    String(order.requester_id) === String(currentUser?.id) ||
                    Boolean(
                      (currentUser as any)?.auth_user_id &&
                        String(order.requester_id) === String((currentUser as any).auth_user_id)
                    ) ||
                    Boolean(
                      order.requester_name &&
                        currentUser?.name &&
                        order.requester_name.trim().toLowerCase() === currentUser.name.trim().toLowerCase()
                    );
                  const canDelete =
                    order.status !== 'COLLECTED' && (isMyOrder || canIApproveThisOrder || isAdmin);
                  const isOrderExpanded = Boolean(expandedOrdersMap[order.id]);

                  return (
                    <div
                      key={order.id}
                      onClick={() => setSelectedDetailOrderId(order.id)}
                      className={`rounded-2xl border p-3.5 transition cursor-pointer hover:shadow-md hover:ring-2 hover:ring-orange-400/30 group ${
                        isWaitingApproval
                          ? 'bg-purple-50/40 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800'
                          : isReady
                          ? 'bg-emerald-500/10 border-emerald-500/40 shadow-xs'
                          : isPreparing
                          ? 'bg-blue-500/5 border-blue-500/30'
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      {/* Line 1: Header (Order #, Site, Total amount, Status pill, Accordion ↑/↓) */}
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-black text-xs text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-lg group-hover:bg-orange-100 group-hover:text-orange-950 dark:group-hover:bg-orange-950 dark:group-hover:text-orange-200 transition">
                            {order.order_number}
                          </span>
                          {order.order_number?.endsWith('_OFF') && (
                            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-black bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                              OFF
                            </span>
                          )}
                          <span className="text-xs font-bold text-orange-600 dark:text-orange-400 flex items-center gap-1">
                            <Building2 className="w-3.5 h-3.5" />
                            <span>{order.site_number}</span>
                          </span>
                          {order.total_cost !== undefined && order.total_cost > 0 && canViewPrices && (
                            <span className="text-xs font-extrabold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-700">
                              {formatCurrency(order.total_cost)}
                            </span>
                          )}
                        </div>

                        {/* Status Badges & Accordion Toggle */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {isWaitingApproval && (
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-300 border border-purple-300 flex items-center gap-1 shadow-2xs">
                              <ShieldAlert className="w-3.5 h-3.5 text-purple-600" />
                              <span>{tr(language, 'À Valider', 'Approval Req.')}</span>
                            </span>
                          )}
                          {isPending && (
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300 flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5" />
                              <span>{tr(language, 'À préparer', 'Pending pick')}</span>
                            </span>
                          )}
                          {isPreparing && (
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-300 flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5 animate-spin" />
                              <span>{tr(language, 'En préparation', 'Preparing')}</span>
                            </span>
                          )}
                          {isReady && (
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-500 text-white flex items-center gap-1 shadow-xs">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>{tr(language, 'PRÊTE', 'READY')}</span>
                            </span>
                          )}

                          {/* Bouton Agrandir (↑) / Diminuer (↓) cette commande individuellement */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedOrdersMap((prev) => ({
                                ...prev,
                                [order.id]: !prev[order.id],
                              }));
                            }}
                            className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-orange-600 transition cursor-pointer"
                            title={isOrderExpanded ? (tr(language, 'Diminuer la commande (↓)', 'Reduce order (↓)')) : (tr(language, 'Agrandir la commande (↑)', 'Expand order (↑)'))}
                          >
                            {isOrderExpanded ? <ChevronUp className="w-4 h-4 stroke-[2.5]" /> : <ChevronDown className="w-4 h-4 stroke-[2.5]" />}
                          </button>
                        </div>
                      </div>

                      {/* Line 2: Details (Requester, Dept, Depot, Date, Items Count) */}
                      <div className="mt-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 flex-wrap gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            {order.requester_name}
                            {order.requester_department && ` (${order.requester_department})`}
                          </span>
                          <span>•</span>
                          <span>🏢 {order.depot_name || 'Dépôt'}</span>
                          <span>•</span>
                          <span>{new Date(order.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                        </div>

                        <div className="font-bold text-slate-700 dark:text-slate-300">
                          {order.items.length} {tr(language, `référence${order.items.length > 1 ? 's' : ''}`, 'items')}
                          <span className="font-normal text-slate-400 ml-1">
                            ({order.items.reduce((s, it) => s + (it.quantity || 0), 0)} pcs)
                          </span>
                        </div>
                      </div>

                      {/* Line 3: Ready Callout / Pickup Zone Pill */}
                      {isReady && order.pickup_zone && (
                        <div className="mt-2 text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/50 p-1.5 px-2.5 rounded-xl border border-emerald-200 dark:border-emerald-800">
                          <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Emplacement de retrait : <strong>{order.pickup_zone}</strong></span>
                        </div>
                      )}

                      {/* Line 3.5: Delegation Pill */}
                      {order.pickup_delegate_name && (
                        <div className="mt-2 text-xs font-bold text-purple-900 dark:text-purple-200 flex items-center justify-between gap-1.5 flex-wrap bg-purple-50 dark:bg-purple-950/60 p-1.5 px-2.5 rounded-xl border border-purple-200 dark:border-purple-800">
                          <div className="flex items-center gap-1.5">
                            <Users className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                            <span>
                              Retrait confié à : <strong>{order.pickup_delegate_name}</strong>
                              {order.pickup_delegate_department ? ` (${order.pickup_delegate_department})` : ''}
                            </span>
                          </div>
                          {String(order.pickup_delegate_id) === String(currentUser?.id) && (
                            <span className="text-[10px] bg-emerald-600 text-white px-1.5 py-0.5 rounded font-black shadow-2xs">
                              Délégué à vous
                            </span>
                          )}
                        </div>
                      )}

                      {/* VUE DÉPLIÉE DES ARTICLES DE LA COMMANDE (isOrderExpanded === true) */}
                      {isOrderExpanded && (
                        <div className="mt-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-1.5 animate-fadeIn">
                          <div className="text-[11px] font-extrabold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                            <Package className="w-3.5 h-3.5 text-orange-500" />
                            <span>{tr(language, 'Détail des articles commandés :', 'Ordered items breakdown:')}</span>
                          </div>
                          <div className="divide-y divide-slate-200 dark:divide-slate-700/60 text-xs">
                            {order.items.map((it, idx) => (
                              <div key={idx} className="py-1.5 flex items-center justify-between gap-2 text-slate-700 dark:text-slate-200">
                                <div className="truncate pr-2">
                                  <span className="font-mono font-bold text-orange-600 dark:text-orange-400 mr-1.5">[{it.product_ref}]</span>
                                  <span>{it.product_name}</span>
                                </div>
                                <span className="font-extrabold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-md text-[11px] shrink-0">
                                  x{it.quantity} {it.unit || 'pcs'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Line 4: Action Footer with Direct Delete / Validation Buttons and "Voir Détail" */}
                      <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {/* Supprimer la commande si non encore en traitement */}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteOrder(order);
                              }}
                              className="py-1 px-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-bold text-xs border border-rose-200 dark:border-rose-900 transition cursor-pointer flex items-center gap-1 active:scale-95"
                              title="Supprimer définitivement la commande"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                              <span>{tr(language, 'Supprimer', 'Delete')}</span>
                            </button>
                          )}

                          {/* Quick Approve / Reject for Managers */}
                          {isWaitingApproval && (
                            canIApproveThisOrder ? (
                              <>
                                <button
                                  type="button"
                                  disabled={approvalActionLoading}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleApproveOrder(order);
                                  }}
                                  className="py-1 px-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs transition active:scale-95 cursor-pointer flex items-center gap-1 shadow-2xs"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>{tr(language, 'Valider', 'Approve')}</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={approvalActionLoading}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setRejectingOrder(order);
                                    setRejectionReasonInput('');
                                  }}
                                  className="py-1 px-2 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-bold text-xs border border-rose-200 dark:border-rose-800 transition active:scale-95 cursor-pointer flex items-center gap-1"
                                >
                                  <X className="w-3.5 h-3.5 text-rose-600" />
                                  <span>{tr(language, 'Refuser', 'Reject')}</span>
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setToastError(
                                    tr(language, 'Accès refusé : Seuls les Chefs de Département & Suppléants et les Chefs de Chantier / Chefs de Projet & Suppléants du service rattaché (ou les administrateurs) peuvent valider ou refuser cette commande.', 'Access denied: Only department heads/deputies and site/project managers/deputies of the service (or administrators) can approve or reject this order.')
                                  );
                                }}
                                className="py-1 px-2 rounded-xl bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 font-bold text-[10.5px] border border-purple-200 dark:border-purple-800 transition active:scale-95 cursor-pointer flex items-center gap-1 shadow-2xs"
                                title="Seuls les Chefs de Département & Suppléants et Chefs de Chantier / Projet & Suppléants peuvent valider cette commande"
                              >
                                <ShieldAlert className="w-3.5 h-3.5 text-purple-600" />
                                <span>{tr(language, 'À valider (Chefs)', 'Approval req.')}</span>
                              </button>
                            )
                          )}

                          {/* Transférer le retrait à un collègue si demandeur ou admin */}
                          {(isMyOrder || isAdmin) && order.status !== 'COLLECTED' && order.status !== 'REJECTED' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenDelegateModal(order);
                              }}
                              className="py-1 px-2.5 rounded-xl bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 font-bold text-xs border border-purple-200 dark:border-purple-800 transition cursor-pointer flex items-center gap-1 active:scale-95"
                              title="Transférer le retrait à un collègue du département"
                            >
                              <ArrowRightLeft className="w-3.5 h-3.5 text-purple-600" />
                              <span>{order.pickup_delegate_id ? (tr(language, 'Délégué', 'Delegated')) : (tr(language, 'Transférer', 'Transfer'))}</span>
                            </button>
                          )}
                        </div>

                        {/* Open Dedicated Window Button */}
                        <button
                          type="button"
                          onClick={() => setSelectedDetailOrderId(order.id)}
                          className="py-1 px-3 rounded-xl bg-slate-100 group-hover:bg-orange-500 group-hover:text-white dark:bg-slate-800 dark:group-hover:bg-orange-600 text-slate-700 dark:text-slate-200 font-extrabold text-xs flex items-center gap-1 transition cursor-pointer ml-auto"
                        >
                          <span>{tr(language, 'Voir détail complet →', 'View details →')}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Archived / Past orders expandable section */}
            {myArchivedOrders.length > 0 && !selectedDetailOrder && (
              <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowArchivedOrders(!showArchivedOrders)}
                  className="w-full py-2 flex items-center justify-between text-xs font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5" />
                    <span>
                      {tr(language, `Historique des commandes retirées (${myArchivedOrders.length})`, `Past collected orders archive (${myArchivedOrders.length})`)}
                    </span>
                  </span>
                  {showArchivedOrders ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

                {showArchivedOrders && (
                  <div className="mt-2 space-y-2">
                    {myArchivedOrders.map((ao) => (
                      <div
                        key={ao.id}
                        onClick={() => setSelectedDetailOrderId(ao.id)}
                        className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 text-xs flex items-center justify-between cursor-pointer hover:border-slate-400 transition"
                      >
                        <div>
                          <div className="font-mono font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                            <span>{ao.order_number}</span>
                            <span className="text-[10px] font-normal text-slate-400">Cliquez pour voir détail</span>
                          </div>
                          <div className="text-[11px] text-slate-400">
                            Chantier {ao.site_number} • {ao.items.length} article(s)
                          </div>
                        </div>

                        <div className="text-right">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                            {ao.status === 'COLLECTED' ? 'Retirée' : 'Annulée'}
                          </span>
                          {ao.collected_at && (
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              {new Date(ao.collected_at).toLocaleDateString('fr-FR', { dateStyle: 'short' })}
                            </div>
                          )}
                          {(ao.signature_data || ao.proof_photo_url) && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setViewProofOrder(ao);
                              }}
                              className="mt-1 text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 justify-end cursor-pointer"
                            >
                              <FileCheck className="w-3 h-3 text-blue-500" />
                              <span>{tr(language, 'Preuve / Signature', 'Proof / Signature')}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* MODAL: Pickup Scanner (Camera & Code Entry) */}
      {isPickupScannerOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsPickupScannerOpen(false);
              stopCamera();
            }
          }}
          className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-xs animate-fadeIn"
        >
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 animate-scaleUp">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center">
                  <Camera className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">
                    {tr(language, 'Scanner le QR Code Retrait', 'Scan Shelf Pickup QR Code')}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {tr(language, 'Pointez la caméra sur l\'étagère ou le bac', 'Point camera at shelf / bin')}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsPickupScannerOpen(false);
                  stopCamera();
                }}
                className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Camera Viewport */}
            <div className="relative w-full aspect-square rounded-2xl overflow-hidden bg-black flex items-center justify-center border-2 border-emerald-500/40 shadow-inner">
              <video
                ref={videoRef}
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              <canvas ref={canvasRef} className="hidden" />

              {/* Scanning visual target box */}
              <div className="absolute inset-8 border-2 border-dashed border-emerald-400/80 rounded-2xl pointer-events-none flex items-center justify-center">
                <div className="w-full h-0.5 bg-emerald-400/80 shadow-lg shadow-emerald-400 animate-pulse" />
              </div>

              {cameraError && (
                <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-4 text-center text-slate-300 space-y-2">
                  <CameraOff className="w-8 h-8 text-rose-400" />
                  <p className="text-xs font-bold text-white">{cameraError}</p>
                </div>
              )}
            </div>

            {/* Error Message Alert */}
            {scanErrorMessage && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/60 text-xs font-bold text-rose-700 dark:text-rose-300 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <span>{scanErrorMessage}</span>
              </div>
            )}

            {/* Manual Code Input Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleProcessScannedCode(manualCodeInput);
              }}
              className="space-y-2 pt-1"
            >
              <div className="text-[11px] font-bold text-slate-600 dark:text-slate-400">
                {tr(language, 'Ou saisie manuelle du numéro de commande / référence :', 'Or enter order # / product ref manually:')}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualCodeInput}
                  onChange={(e) => setManualCodeInput(e.target.value)}
                  placeholder="Ex: CH-01-CMD-261002-001"
                  className="flex-1 text-xs font-bold p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white outline-none uppercase"
                />
                <button
                  type="submit"
                  className="py-2 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition active:scale-95 cursor-pointer"
                >
                  {tr(language, 'Vérifier', 'Verify')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Scanned Order Verification & Confirmation */}
      {scannedOrderMatch && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setScannedOrderMatch(null);
            }
          }}
          className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-xs animate-fadeIn"
        >
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl shadow-2xl border border-emerald-500/40 p-5 space-y-4 animate-scaleUp">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center shadow-xs">
                  <Check className="w-5 h-5 stroke-[3]" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">
                    {tr(language, 'Commande Identifiée !', 'Order Verified!')}
                  </h3>
                  <p className="text-[11px] font-mono text-emerald-600 font-bold">
                    {scannedOrderMatch.order_number}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setScannedOrderMatch(null)}
                className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Location callout */}
            <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 space-y-1">
              <div className="text-[10px] uppercase tracking-wider font-extrabold text-emerald-700 dark:text-emerald-400">
                {tr(language, 'Emplacement de Retrait', 'Pickup Location')}
              </div>
              <div className="text-sm font-black text-emerald-950 dark:text-emerald-100 flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-emerald-600" />
                <span>
                  {scannedOrderMatch.pickup_zone || (tr(language, 'Zone de retrait magasin', 'Store pickup area'))}
                </span>
              </div>
            </div>

            {/* Order info details */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <span className="text-[10px] text-slate-400 font-bold block">{tr(language, 'Chantier', 'Site')}</span>
                <span className="font-extrabold text-slate-800 dark:text-slate-200">{scannedOrderMatch.site_number}</span>
              </div>
              <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <span className="text-[10px] text-slate-400 font-bold block">{tr(language, 'Demandeur', 'Requester')}</span>
                <span className="font-extrabold text-slate-800 dark:text-slate-200">{scannedOrderMatch.requester_name}</span>
              </div>
            </div>

            {/* Articles checklist */}
            <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {scannedOrderMatch.items.map((it, idx) => (
                <div key={idx} className="p-2 flex items-center justify-between text-[11px]">
                  <span className={it.unavailable ? 'line-through text-rose-500' : 'text-slate-800 dark:text-slate-200 font-medium'}>
                    {it.product_name}
                  </span>
                  <span className="font-black text-emerald-700 dark:text-emerald-400 shrink-0 ml-2">
                    {it.unavailable ? (
                      <span className="text-rose-500 font-bold">{tr(language, 'Non dispo', 'Unavailable')}</span>
                    ) : (
                      <span>{it.quantity} {it.unit || 'pcs'}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>

            {/* Confirmation Action Button */}
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setScannedOrderMatch(null)}
                className="flex-1 py-2.5 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                {tr(language, 'Annuler', 'Cancel')}
              </button>

              <button
                type="button"
                onClick={() => handleConfirmCollection(scannedOrderMatch.id)}
                className="flex-1 py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black text-xs shadow-md shadow-emerald-600/30 flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer"
              >
                <PackageCheck className="w-4 h-4" />
                <span>{tr(language, 'Confirmer le Retrait', 'Confirm Pickup')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: Quick Add Product Picker (User requested '+ Ajouter un article' directly from cart) */}
      {isAddProductPickerOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsAddProductPickerOpen(false);
            }
          }}
          className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-xs animate-fadeIn"
        >
          <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[88vh] animate-scaleUp">
            {/* Header */}
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-orange-50/50 dark:bg-orange-950/20">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-orange-500 text-white flex items-center justify-center shadow-md shadow-orange-500/20">
                  <PlusCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">
                    {tr(language, 'Ajouter des Articles au Panier', 'Add Items to Cart')}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {currentCartDepot
                      ? (tr(language, `Articles du dépôt : ${currentCartDepot}`, `Depot items: ${currentCartDepot}`))
                      : (tr(language, 'Recherchez un article dans le catalogue', 'Search catalog'))}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddProductPickerOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Mono-depot banner indicator */}
            {currentCartDepot && (
              <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900/60 text-[11px] font-bold text-amber-800 dark:text-amber-300 flex items-center justify-between">
                <span>🏢 Dépôt exclusif de la commande : <strong>{currentCartDepot}</strong></span>
                <span className="text-[10px] text-amber-600 dark:text-amber-400">Règle mono-dépôt</span>
              </div>
            )}

            {/* Success notice */}
            {pickerFeedbackMsg && (
              <div className="mx-4 mt-3 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-bold flex items-center gap-2 animate-fadeIn">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{pickerFeedbackMsg}</span>
              </div>
            )}

            {/* Search bar & Category filters */}
            <div className="p-3 border-b border-slate-100 dark:border-slate-800 space-y-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={pickerSearchQuery}
                  onChange={(e) => setPickerSearchQuery(e.target.value)}
                  placeholder={tr(language, 'Rechercher par référence, désignation, marque...', 'Search by ref, name, brand...')}
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border-none outline-none font-medium"
                  autoFocus
                />
                {pickerSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setPickerSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Categories Pills */}
              <div className="flex flex-wrap items-center gap-1.5 pb-1 text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => setPickerSelectedCategory('ALL')}
                  className={`px-2.5 py-1 rounded-lg shrink-0 transition cursor-pointer ${
                    pickerSelectedCategory === 'ALL'
                      ? 'bg-orange-500 text-white shadow-2xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                  }`}
                >
                  {tr(language, 'Tous', 'All')}
                </button>
                {availablePickerCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setPickerSelectedCategory(cat)}
                    className={`px-2.5 py-1 rounded-lg shrink-0 transition cursor-pointer ${
                      pickerSelectedCategory === cat
                        ? 'bg-orange-500 text-white shadow-2xs'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Products List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {pickerProducts.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-xs">
                  <p className="font-bold">{tr(language, 'Aucun article trouvé', 'No items found')}</p>
                  {currentCartDepot && (
                    <p className="text-[11px] text-slate-400 mt-1">
                      Vérifiez que des articles existent dans le dépôt « {currentCartDepot} »
                    </p>
                  )}
                </div>
              ) : (
                pickerProducts.map((prod) => {
                  const alreadyInCart = orderCart.find((it) => String(it.product_id) === String(prod.id));
                  return (
                    <div
                      key={prod.id}
                      className="p-2.5 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-orange-300 dark:hover:border-orange-800/60 bg-white dark:bg-slate-900 transition flex items-center justify-between gap-3 text-xs shadow-2xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono font-bold text-orange-600 dark:text-orange-400 text-[11px]">
                            {prod.reference}
                          </span>
                          <span className="font-bold text-slate-900 dark:text-white truncate">
                            {prod.brand} {prod.model}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                          <span>{prod.sub_category_id ? subCategoryMap.get(prod.sub_category_id) : prod.tags || prod.store_name}</span>
                          <span>•</span>
                          <span className="font-bold text-slate-600 dark:text-slate-300">
                            Stock : {prod.quantity}
                          </span>
                          {canViewPrices && prod.unit_price && prod.unit_price > 0 && (
                            <>
                              <span>•</span>
                              <span>{formatCurrency(prod.unit_price)}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-2">
                        {alreadyInCart && (
                          <span className="text-[10px] font-black text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/60 px-2 py-0.5 rounded-md border border-orange-200 dark:border-orange-800">
                            {alreadyInCart.quantity} au panier
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => handleQuickAddProductToCart(prod)}
                          className="py-1.5 px-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs shadow-xs transition active:scale-95 cursor-pointer flex items-center gap-1"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>{tr(language, 'Ajouter', 'Add')}</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                {orderCart.length} {tr(language, 'article(s) au panier', 'item(s) in cart')}
              </span>
              <button
                type="button"
                onClick={() => setIsAddProductPickerOpen(false)}
                className="py-2 px-4 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-extrabold text-xs shadow-sm transition cursor-pointer"
              >
                {tr(language, 'Voir mon panier', 'Back to cart')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Digital Signature & Photo Proof on Collection */}
      {retraitModalOrder && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSubmittingRetrait) {
              setRetraitModalOrder(null);
            }
          }}
          className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-xs animate-fadeIn"
        >
          <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 animate-scaleUp max-h-[92vh] flex flex-col overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center shadow-md shadow-emerald-500/20">
                  <PenTool className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">
                    {tr(language, 'Émargement & Preuve de Retrait', 'Signature & Pickup Proof')}
                  </h3>
                  <p className="text-[11px] font-mono text-emerald-600 font-bold">
                    {retraitModalOrder.order_number}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRetraitModalOrder(null)}
                className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Order summary pill */}
            <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center justify-between text-xs">
              <div>
                <span className="font-extrabold text-slate-900 dark:text-white block">
                  Chantier : {retraitModalOrder.site_number}
                </span>
                <span className="text-[11px] text-slate-500">
                  Retrait par : <strong>{currentUser ? currentUser.name : retraitModalOrder.requester_name}</strong>
                </span>
              </div>
              <div className="text-right">
                <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-emerald-600" />
                  <span>{retraitModalOrder.pickup_zone || 'Zone Retrait'}</span>
                </span>
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  {retraitModalOrder.items.length} référence(s)
                </span>
              </div>
            </div>

            {/* Signature Pad */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
                <span className="flex items-center gap-1.5">
                  <PenTool className="w-3.5 h-3.5 text-blue-500" />
                  <span>{tr(language, 'Émargement tactile (Signature)', 'Touch Signature')} :</span>
                </span>
                <button
                  type="button"
                  onClick={clearSignature}
                  className="text-[11px] text-rose-500 hover:text-rose-600 font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Eraser className="w-3 h-3" />
                  <span>{tr(language, 'Effacer', 'Clear')}</span>
                </button>
              </div>

              <div className="relative border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl overflow-hidden bg-slate-50 dark:bg-slate-950">
                <canvas
                  ref={sigCanvasRef}
                  width={500}
                  height={180}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  className="w-full h-36 cursor-crosshair block touch-none"
                  style={{ touchAction: 'none' }}
                />
                {!hasDrawnSignature && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-slate-400 text-xs font-medium">
                    {tr(language, 'Signez ici avec votre doigt ou la souris', 'Sign here with touch or mouse')}
                  </div>
                )}
              </div>
            </div>

            {/* Photo Proof Option */}
            <div className="space-y-1.5 pt-1">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-emerald-500" />
                <span>{tr(language, 'Photo de preuve du matériel (Optionnel)', 'Proof photo (Optional)')} :</span>
              </div>

              {proofPhotoUrl ? (
                <div className="relative rounded-2xl overflow-hidden border border-emerald-300 dark:border-emerald-800 bg-slate-100 max-h-36">
                  <img src={proofPhotoUrl} alt="Preuve" className="w-full h-36 object-cover" />
                  <button
                    type="button"
                    onClick={() => setProofPhotoUrl(null)}
                    className="absolute top-2 right-2 w-6 h-6 rounded-full bg-slate-900/80 text-white flex items-center justify-center hover:bg-slate-900 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <label className="p-3 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-emerald-400 bg-slate-50 dark:bg-slate-800/40 text-center flex flex-col items-center justify-center gap-1 cursor-pointer transition">
                  <Camera className="w-5 h-5 text-slate-400" />
                  <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                    {tr(language, 'Prendre une photo du bac ou du bon', 'Take photo of bin / slip')}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handlePhotoCapture}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            {/* Action buttons */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
              <button
                type="button"
                disabled={isSubmittingRetrait}
                onClick={handleFinalizeCollection}
                className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-extrabold text-xs shadow-md shadow-emerald-600/30 flex items-center justify-center gap-2 transition active:scale-98 cursor-pointer disabled:opacity-50"
              >
                <PackageCheck className="w-4 h-4" />
                <span>
                  {isSubmittingRetrait
                    ? (tr(language, 'Validation en cours...', 'Confirming...'))
                    : hasDrawnSignature
                    ? (tr(language, 'Valider le Retrait avec Signature', 'Confirm with Signature'))
                    : (tr(language, 'Valider le Retrait', 'Confirm Pickup'))}
                </span>
              </button>

              <button
                type="button"
                disabled={isSubmittingRetrait}
                onClick={() => setRetraitModalOrder(null)}
                className="w-full py-2 text-center text-xs font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                {tr(language, 'Annuler et revenir', 'Cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Proof Viewer Dialog (Signature & Photo preview for audit) */}
      {viewProofOrder && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setViewProofOrder(null);
            }
          }}
          className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs animate-fadeIn"
        >
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 animate-scaleUp">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <FileCheck className="w-5 h-5 text-blue-500" />
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">
                    {tr(language, 'Preuve d\'Émargement / Audit', 'Pickup Proof Audit')}
                  </h3>
                  <p className="text-[11px] font-mono text-slate-400">
                    {viewProofOrder.order_number}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewProofOrder(null)}
                className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs space-y-1 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-2xl">
              <div>Chantier : <strong>{viewProofOrder.site_number}</strong></div>
              <div>Demandeur : <strong>{viewProofOrder.requester_name}</strong></div>
              <div>Retiré le : <strong>{viewProofOrder.collected_at ? new Date(viewProofOrder.collected_at).toLocaleString('fr-FR') : '—'}</strong></div>
              <div>Par : <strong>{viewProofOrder.collected_by || viewProofOrder.requester_name}</strong></div>
            </div>

            {/* Signature image */}
            {viewProofOrder.signature_data && (
              <div className="space-y-1">
                <span className="text-[11px] font-bold text-slate-500 block">Signature numérique enregistrée :</span>
                <div className="p-3 bg-white rounded-2xl border border-slate-200 flex items-center justify-center">
                  <img src={viewProofOrder.signature_data} alt="Signature demandeur" className="max-h-28 object-contain" />
                </div>
              </div>
            )}

            {/* Photo proof */}
            {viewProofOrder.proof_photo_url && (
              <div className="space-y-1">
                <span className="text-[11px] font-bold text-slate-500 block">Photo de remise de matériel :</span>
                <div className="rounded-2xl border border-slate-200 overflow-hidden max-h-48 bg-slate-100">
                  <img src={viewProofOrder.proof_photo_url} alt="Photo preuve" className="w-full h-48 object-cover" />
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setViewProofOrder(null)}
              className="w-full py-2.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-extrabold text-xs rounded-xl cursor-pointer"
            >
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* Modal Motif de Refus de Commande (Chefs de Projet / Département) */}
      {rejectingOrder && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-5 space-y-4 shadow-2xl animate-scaleUp">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-500" />
                <span>Refuser la commande {rejectingOrder.order_number}</span>
              </h3>
              <button
                type="button"
                onClick={() => setRejectingOrder(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300">
              Veuillez indiquer un motif de refus pour informer le demandeur (<strong>{rejectingOrder.requester_name}</strong>) :
            </p>

            <textarea
              value={rejectionReasonInput}
              onChange={(e) => setRejectionReasonInput(e.target.value)}
              placeholder="Ex: Budget du chantier dépassé, demande d'arbitrage avec la direction..."
              rows={3}
              className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs outline-none"
            />

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRejectingOrder(null)}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={approvalActionLoading}
                onClick={handleConfirmRejectOrder}
                className="px-4 py-1.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-sm cursor-pointer"
              >
                Confirmer le Refus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Délégation / Transfert de Retrait Commande à un collègue du département */}
      {delegatingOrder && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 max-w-lg w-full p-5 sm:p-6 space-y-4 shadow-2xl animate-scaleUp">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 flex items-center justify-center shrink-0">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-sm text-slate-900 dark:text-white">
                    {tr(language, 'Déléguer le retrait de commande', 'Transfer order pickup')}
                  </h3>
                  <div className="font-mono text-xs text-purple-700 dark:text-purple-400 font-bold">
                    {delegatingOrder.order_number}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDelegatingOrder(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Context Explainer */}
            <div className="p-3 bg-purple-50/70 dark:bg-purple-950/40 rounded-2xl border border-purple-200 dark:border-purple-800 text-xs text-purple-900 dark:text-purple-200">
              <p className="font-bold">
                {tr(language, 'Indisponible pour retirer votre matériel au magasin ?', 'Unavailable to pick up your order?')}
              </p>
              <p className="text-[11px] opacity-90 mt-0.5">
                {tr(language, `Vous pouvez confier le retrait de cette commande à un collègue de votre département (${delegatingOrder.requester_department || 'Même service'}). Il recevra la commande dans ses commandes actives et aura l'autorisation de la retirer.`, 'You can delegate pickup to a colleague in your department. They will be authorized to collect the order.')}
              </p>
            </div>

            {/* Colleague Selection */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                <span>{tr(language, 'Sélectionner le collègue délégataire :', 'Select colleague:')}</span>
                <span className="text-[11px] text-slate-400 font-normal">
                  {departmentColleagues.length} {tr(language, 'disponibles', 'available')}
                </span>
              </label>

              <select
                value={selectedDelegateUserId}
                onChange={(e) => setSelectedDelegateUserId(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="">{tr(language, '— Choisir un collègue du département —', '— Choose a colleague —')}</option>
                {departmentColleagues.map((u) => {
                  const isSameDept = Boolean(
                    delegatingOrder.requester_department &&
                      u.department &&
                      u.department.toLowerCase() === delegatingOrder.requester_department.toLowerCase()
                  );
                  return (
                    <option key={u.id} value={u.id}>
                      {u.name} {u.department ? `(${u.department})` : ''} {isSameDept ? '★ Même département' : ''}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Optional Note / Message */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                {tr(language, 'Instructions / Consigne pour le collègue (optionnel) :', 'Notes / Instructions (optional):')}
              </label>
              <textarea
                value={delegateNotes}
                onChange={(e) => setDelegateNotes(e.target.value)}
                placeholder={
                  tr(language, 'Ex: Je suis retenu sur le chantier Nord. Merci de récupérer les pièces au casier B et de me prévenir.', 'Instructions for your colleague...')
                }
                rows={3}
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setDelegatingOrder(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer"
              >
                {tr(language, 'Annuler', 'Cancel')}
              </button>
              <button
                type="button"
                disabled={!selectedDelegateUserId || isSubmittingDelegation}
                onClick={handleConfirmDelegation}
                className="px-5 py-2 rounded-xl text-xs font-black bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white shadow-md shadow-purple-600/30 flex items-center gap-2 transition cursor-pointer"
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                <span>
                  {isSubmittingDelegation
                    ? (tr(language, 'Enregistrement...', 'Saving...'))
                    : (tr(language, 'Confirmer la délégation', 'Confirm Delegation'))}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Non-blocking Confirmation Modal Dialog (Suppression de panier, Vider panier, Validation & Transmission) */}
      {confirmDialog && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-3 bg-slate-950/80 backdrop-blur-xs animate-fadeIn"
          onClick={() => setConfirmDialog(null)}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 animate-scaleUp text-slate-800 dark:text-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div
                className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                  confirmDialog.isDanger
                    ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400'
                    : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {confirmDialog.isDanger ? (
                  <Trash2 className="w-5 h-5 stroke-[2.2]" />
                ) : (
                  <Send className="w-5 h-5 stroke-[2.2]" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-black text-slate-900 dark:text-white">
                  {confirmDialog.title}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed whitespace-pre-line">
                  {confirmDialog.message}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition cursor-pointer"
              >
                {confirmDialog.cancelText || (tr(language, 'Annuler', 'Cancel'))}
              </button>
              <button
                type="button"
                onClick={async () => {
                  const fn = confirmDialog.onConfirm;
                  setConfirmDialog(null);
                  try {
                    await fn();
                  } catch (err) {
                    console.error('Error executing confirmation dialog action:', err);
                  }
                }}
                className={`px-4 py-2 rounded-xl text-xs font-black text-white shadow-md transition cursor-pointer flex items-center gap-1.5 active:scale-95 ${
                  confirmDialog.isDanger
                    ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/30'
                    : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/30'
                }`}
              >
                {confirmDialog.isDanger ? (
                  <Trash2 className="w-3.5 h-3.5" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span>{confirmDialog.confirmText || (tr(language, 'Confirmer', 'Confirm'))}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
