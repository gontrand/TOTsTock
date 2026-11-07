import React, { useEffect, useRef, useState, useMemo } from 'react';
import { tr } from '../i18n/dutchTranslator';
import { useApp } from '../context/AppContext';
import {
  formatCurrency,
  formatDate,
  isUserAllowedForDepot,
  isDepotClosed,
  canUserBorrowFromDepot,
  canUserEnterStockInDepot,
} from '../utils/crypto';
import { renderQrCodeWithTotLogo } from '../utils/qrCodeHelper';
import JsBarcode from 'jsbarcode';
import {
  X,
  MapPin,
  Tag,
  Building,
  ArrowDownCircle,
  ArrowUpCircle,
  Edit,
  Trash2,
  Printer,
  Share2,
  AlertTriangle,
  AlertOctagon,
  Copy,
  Check,
  PauseCircle,
  Barcode,
  History,
  FileSpreadsheet,
  Search,
  ArrowRight,
  TrendingDown,
  TrendingUp,
  ArrowLeftRight,
  Calendar,
  User as UserIcon,
  Lock,
  ShoppingCart,
  Plus,
} from 'lucide-react';
import { getProductDepotBreakdown } from '../services/desktopInventoryLogic';
import {
  buildAvailableDepotsSignature,
  buildProductEditableSignature,
  buildProductStockLevelsSignature,
  computeDefaultAddDepotTarget,
} from '../hooks/useProductDetailController';

export const ProductDetailModal: React.FC = () => {
  const {
    activeProductId,
    setActiveProductId,
    products,
    stockLevels,
    depots,
    departments,
    users,
    subCategories,
    movements,
    setProductFormState,
    deleteProduct,
    addToCart,
    setBatchCartModalOpen,
    addToOrderCart,
    setOrderCartModalOpen,
    setScanState,
    setPrintLabelsModal,
    userHasPermission,
    canViewArticleHistory,
    currentUser,
    language,
    t,
    addProductToDepot,
    canTransferBetweenDepots,
    openStockTransferModal,
  } = useApp();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const barcodeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Tab and History states
  const [activeTab, setActiveTab] = useState<'details' | 'history'>('details');
  const [historySearch, setHistorySearch] = useState('');
  const [historyTypeFilter, setHistoryTypeFilter] = useState<'ALL' | 'IN' | 'OUT'>('ALL');

  const [addDepotOpen, setAddDepotOpen] = useState(false);
  const [targetDepotName, setTargetDepotName] = useState('');
  const [targetInitialQty, setTargetInitialQty] = useState('1');
  const [targetRackLocation, setTargetRackLocation] = useState('');
  const [targetMinAlert, setTargetMinAlert] = useState('2');
  const [addingToDepot, setAddingToDepot] = useState(false);

  const addDepotOpenRef = useRef(addDepotOpen);
  addDepotOpenRef.current = addDepotOpen;
  const userSelectedTargetDepotRef = useRef(false);

  const rawProduct = useMemo(
    () => products.find((p) => String(p.id) === String(activeProductId)) || undefined,
    [products, activeProductId]
  );

  const productSignature = useMemo(() => buildProductEditableSignature(rawProduct), [rawProduct]);
  const stockLevelsSignature = useMemo(
    () => buildProductStockLevelsSignature(activeProductId, stockLevels),
    [activeProductId, stockLevels]
  );
  const availableDepotsSignature = useMemo(
    () => buildAvailableDepotsSignature(depots, currentUser),
    [depots, currentUser]
  );

  const latestDataRef = useRef({
    rawProduct,
    stockLevels,
    depots,
    currentUser,
  });
  latestDataRef.current = {
    rawProduct,
    stockLevels,
    depots,
    currentUser,
  };

  const product = useMemo(
    () => latestDataRef.current.rawProduct,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [productSignature]
  );

  const subCategory = subCategories.find((s) => Number(s.id) === Number(product?.sub_category_id));

  const depotBreakdown = useMemo(
    () =>
      getProductDepotBreakdown(
        latestDataRef.current.rawProduct,
        latestDataRef.current.stockLevels,
        latestDataRef.current.currentUser
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [productSignature, stockLevelsSignature, availableDepotsSignature]
  );

  const availableDepotsForAdd = useMemo(
    () =>
      (latestDataRef.current.depots || []).filter(
        (d) =>
          d.is_active !== false &&
          isUserAllowedForDepot(latestDataRef.current.currentUser, d.name)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [availableDepotsSignature]
  );

  // 1. Réinitialisation uniquement au changement de fiche produit
  useEffect(() => {
    setActiveTab('details');
    setHistorySearch('');
    setHistoryTypeFilter('ALL');
    setAddDepotOpen(false);
    addDepotOpenRef.current = false;
    userSelectedTargetDepotRef.current = false;
    setTargetDepotName('');
    setTargetInitialQty('1');
    setTargetRackLocation('');
    setTargetMinAlert(String(product?.min_stock_alert ?? 2));
  }, [activeProductId]);

  // 2. Mise à jour du seuil par défaut quand le produit évolue réellement (hors saisie en cours dans le menu)
  useEffect(() => {
    if (!product || addDepotOpenRef.current) return;
    setTargetMinAlert(String(product.min_stock_alert ?? 2));
  }, [activeProductId, productSignature]);

  // 3. Calcul du dépôt cible par défaut à l'ouverture du menu « Ajouter à un autre dépôt »
  useEffect(() => {
    if (!addDepotOpen || !product) return;
    setTargetDepotName((prev) =>
      computeDefaultAddDepotTarget({
        currentTargetDepotName: prev,
        allDepotRows: depotBreakdown.allDepotRows,
        availableDepotsForAdd,
        userHasSelectedTarget: userSelectedTargetDepotRef.current,
      })
    );
    if (!userSelectedTargetDepotRef.current) {
      setTargetMinAlert(String(product.min_stock_alert ?? 2));
    }
  }, [addDepotOpen]);

  const isDepotClosedState = isDepotClosed(depots, product?.store_name);
  const isDepotAllowed = isUserAllowedForDepot(currentUser, product?.store_name);

  const borrowCheck = canUserBorrowFromDepot(currentUser, product?.store_name, depots, language, departments, users);
  const hasGeneralStockIn = userHasPermission('perm_stock_in');
  const entryCheck = canUserEnterStockInDepot(currentUser, product?.store_name, depots, hasGeneralStockIn, language, departments, users);

  const canEditProduct = userHasPermission('perm_prod_edit');
  const hasFinancePerm = userHasPermission('perm_dash_finance');
  const canViewPrices = userHasPermission('perm_prod_view_price');
  const canOut = userHasPermission('perm_mov_out') && borrowCheck.allowed;
  const canIn = entryCheck.allowed;
  const canDelete = userHasPermission('perm_prod_delete');

  useEffect(() => {
    if (product && canvasRef.current) {
      const qrValue = (product.qr_code || product.reference || '').trim();
      renderQrCodeWithTotLogo(canvasRef.current, qrValue, {
        size: 220,
        margin: 2,
      }).catch((error) => {
        console.error('Error generating QR Code with TOT logo:', error);
      });
    }

    if (product?.barcode && barcodeCanvasRef.current) {
      try {
        const clean = product.barcode.trim();
        let format = 'CODE128';
        if (/^\d{13}$/.test(clean)) format = 'EAN13';
        else if (/^\d{8}$/.test(clean)) format = 'EAN8';
        else if (/^\d{12}$/.test(clean)) format = 'UPC';

        JsBarcode(barcodeCanvasRef.current, clean, {
          format,
          width: 1.5,
          height: 40,
          displayValue: true,
          fontSize: 12,
          margin: 4,
          background: '#ffffff',
          lineColor: '#000000',
        });
      } catch (err) {
        try {
          JsBarcode(barcodeCanvasRef.current, product.barcode.trim(), {
            format: 'CODE128',
            width: 1.5,
            height: 40,
            displayValue: true,
            fontSize: 12,
            margin: 4,
            background: '#ffffff',
            lineColor: '#000000',
          });
        } catch {
          // ignore barcode canvas draw failure
        }
      }
    }
  }, [product?.id, product?.qr_code, product?.reference, product?.barcode]);

  // 1. All movements for this product sorted newest first
  const productMovements = useMemo(() => {
    if (!product) return [];
    return movements
      .filter((m) => String(m.product_id) === String(product.id) || m.product_ref === product.reference)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [movements, product]);

  // 2. Computed summary stats for this product
  const historyStats = useMemo(() => {
    let totalInQty = 0;
    let totalOutQty = 0;
    let totalInCost = 0;
    let totalOutCost = 0;

    for (const m of productMovements) {
      const cost = m.total_cost ?? (m.quantity_changed * (product?.unit_price || 0));
      if (m.movement_type === 'IN') {
        totalInQty += m.quantity_changed;
        totalInCost += cost;
      } else {
        totalOutQty += m.quantity_changed;
        totalOutCost += cost;
      }
    }

    const netFlow = totalInQty - totalOutQty;
    const lastMovement = productMovements[0] || null;

    return {
      totalInQty,
      totalOutQty,
      totalInCost,
      totalOutCost,
      netFlow,
      lastMovement,
      totalCount: productMovements.length,
      outCount: productMovements.filter((m) => m.movement_type === 'OUT').length,
      inCount: productMovements.filter((m) => m.movement_type === 'IN').length,
    };
  }, [productMovements, product]);

  // 3. Filtered movements list
  const filteredProductMovements = useMemo(() => {
    return productMovements.filter((m) => {
      if (historyTypeFilter !== 'ALL' && m.movement_type !== historyTypeFilter) {
        return false;
      }
      if (historySearch.trim()) {
        const q = historySearch.toLowerCase().trim();
        const matchesUser = String(m.user_name ?? '').toLowerCase().includes(q);
        const matchesSite = String(m.site_number ?? '').toLowerCase().includes(q);
        const matchesDep = String(m.department_name ?? '').toLowerCase().includes(q);
        const matchesId = String(m.id ?? '').toLowerCase().includes(q);
        if (!matchesUser && !matchesSite && !matchesDep && !matchesId) {
          return false;
        }
      }
      return true;
    });
  }, [productMovements, historyTypeFilter, historySearch]);

  const handleCopyRef = () => {
    if (!product) return;
    navigator.clipboard.writeText(product.reference);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleQuickMovement = (type: 'IN' | 'OUT') => {
    if (!product) return;
    if (type === 'OUT' && !borrowCheck.allowed) {
      alert(borrowCheck.reason || (tr(language, 'Sortie interdite sur ce dépôt.', 'Withdrawal not allowed.')));
      return;
    }
    if (type === 'IN' && !entryCheck.allowed) {
      alert(entryCheck.reason || (tr(language, 'Entrée interdite sur ce dépôt.', 'Stock entry not allowed.')));
      return;
    }
    setScanState({ open: false, mode: type });
    addToCart(product, 1);
    setBatchCartModalOpen(true);
    setActiveProductId(null);
  };

  const handleConfirmDelete = async () => {
    if (!product) return;
    setIsDeleting(true);
    const ok = await deleteProduct(product.id);
    setIsDeleting(false);
    if (ok) {
      setConfirmDeleteOpen(false);
      setActiveProductId(null);
    }
  };

  const handlePrintLabel = () => {
    if (!product) return;
    setActiveProductId(null);
    setPrintLabelsModal({ open: true, initialProductId: product.id });
  };

  // 4. Export CSV of product's transaction history
  const handleExportProductHistoryCSV = () => {
    if (!product || productMovements.length === 0) return;
    const rows = [
      [
        'Date & Heure',
        'Type',
        'Quantité',
        'Chantier / Projet',
        'Opérateur',
        'Département / Motif',
        'Valeur Totale HT (€)',
        'ID Mouvement',
      ],
    ];

    productMovements.forEach((m) => {
      const isOut = m.movement_type === 'OUT';
      const cost = m.total_cost ?? (m.quantity_changed * (product.unit_price || 0));
      rows.push([
        `"${formatDate(m.created_at)}"`,
        `"${isOut ? 'Sortie' : 'Entrée'}"`,
        String(m.quantity_changed),
        `"${m.site_number || ''}"`,
        `"${m.user_name || ''}"`,
        `"${m.department_name || ''}"`,
        cost.toFixed(2),
        `"${m.id}"`,
      ]);
    });

    const csvContent = '\uFEFF' + rows.map((e) => e.join(';')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Historique_${product.reference}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Keyboard shortcut: close on Escape
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeProductId) {
        setActiveProductId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeProductId, setActiveProductId]);

  if (!product) return null;

  const qty = product.quantity || 0;
  const min = product.min_stock_alert || 2;
  const isOut = qty === 0;
  const isLow = qty > 0 && qty <= min;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setActiveProductId(null);
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/75 backdrop-blur-sm animate-fadeIn"
    >
      <div className="w-full max-w-md sm:max-w-lg bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-3.5 sm:p-5 pb-[max(0.875rem,env(safe-area-inset-bottom))] text-slate-800 dark:text-slate-100 max-h-[94dvh] sm:max-h-[92dvh] flex flex-col overflow-hidden overscroll-contain">
        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-orange-600 dark:text-orange-400">
                {product.reference}
              </span>
              <button
                type="button"
                onClick={handleCopyRef}
                title="Copier la référence"
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer p-0.5 active:scale-90"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              {subCategory && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                  {subCategory.name}
                </span>
              )}
            </div>
            <h2 className="text-base font-black text-slate-900 dark:text-white mt-1">
              {product.brand} {product.model}
            </h2>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setActiveProductId(null);
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer active:scale-90 shadow-xs shrink-0"
            title={t('common_close')}
            aria-label="Fermer"
          >
            <X className="w-4 h-4 stroke-[2.5]" />
          </button>
        </div>

        {/* Tab Navigation Switcher */}
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/60 p-1 rounded-2xl my-2.5">
          <button
            type="button"
            onClick={() => setActiveTab('details')}
            className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
              activeTab === 'details'
                ? 'bg-white dark:bg-slate-900 text-orange-600 dark:text-orange-400 shadow-2xs font-extrabold'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Tag className="w-3.5 h-3.5" />
            <span>{t('product_tab_details')}</span>
          </button>

          {canViewArticleHistory ? (
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                activeTab === 'history'
                  ? 'bg-white dark:bg-slate-900 text-orange-600 dark:text-orange-400 shadow-2xs font-extrabold'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>{t('product_tab_history')}</span>
              <span
                className={`text-[10px] font-black px-1.5 py-0.2 rounded-full ${
                  activeTab === 'history'
                    ? 'bg-orange-500 text-white'
                    : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                {productMovements.length}
              </span>
            </button>
          ) : (
            <div
              title={
                tr(language, 'Historique réservé aux responsables de département et administrateurs', 'History reserved for department managers and admins')
              }
              className="flex-1 py-1.5 px-3 rounded-xl text-xs font-semibold text-slate-400 dark:text-slate-500 flex items-center justify-center gap-1.5 opacity-60 cursor-not-allowed select-none"
            >
              <Lock className="w-3.5 h-3.5 text-slate-400" />
              <span>{t('product_tab_history')}</span>
            </div>
          )}
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto py-2 space-y-4 pr-1">
          {activeTab === 'details' ? (
            <>
          {/* Closed Depot Warning */}
          {isDepotClosedState && (
            <div className="p-3.5 rounded-2xl bg-amber-500/10 dark:bg-amber-950/40 border border-amber-400 dark:border-amber-700/70 text-amber-900 dark:text-amber-200 text-xs flex items-center gap-3">
              <PauseCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
              <div>
                <span className="font-extrabold block text-xs">
                  {t('search_depot_closed_badge')} ({product.store_name || t('common_main_depot')})
                </span>
                <span className="text-[11px] opacity-90 block mt-0.5">
                  {t('product_closed_depot_warning')}
                </span>
              </div>
            </div>
          )}

          {/* Stock & Quick Move Banner */}
          <div className="p-3 sm:p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                {t('product_stock_state')}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span
                  className={`text-2xl font-black ${
                    isOut ? 'text-rose-600' : isLow ? 'text-amber-500' : 'text-emerald-600'
                  }`}
                >
                  {qty}
                </span>
                <span className="text-xs text-slate-400">
                  {t('product_units')} ({t('product_alert_threshold')}: {min})
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              {isDepotClosedState ? (
                <div
                  className="p-1.5 px-2.5 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 text-[11px] font-bold flex items-center gap-1.5 cursor-not-allowed select-none"
                  title={
                    tr(language, `Sortie impossible : Le dépôt « ${product.store_name || 'Dépôt principal'} » est fermé / inactif.`, 'Closed depot: withdrawal prohibited')
                  }
                >
                  <Lock className="w-3.5 h-3.5 text-amber-600" />
                  <span>{tr(language, 'Dépôt fermé', 'Closed depot')}</span>
                </div>
              ) : !borrowCheck.allowed ? (
                <div
                  className="p-1.5 px-2.5 rounded-xl bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 text-[11px] font-bold flex items-center gap-1.5 cursor-not-allowed"
                  title={borrowCheck.reason}
                >
                  <Lock className="w-3.5 h-3.5 text-purple-600" />
                  <span>
                    {borrowCheck.isVehicle
                      ? tr(language, 'Camionnette réservée', 'Reserved vehicle')
                      : tr(language, 'Dépôt restreint', 'Restricted depot')}
                  </span>
                </div>
              ) : canOut ? (
                <button
                  onClick={() => handleQuickMovement('OUT')}
                  disabled={qty <= 0}
                  className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/50 hover:bg-rose-100 font-bold text-xs flex items-center gap-1 transition active:scale-95 disabled:opacity-40"
                  title={t('action_out_title')}
                >
                  <ArrowDownCircle className="w-4 h-4" />
                  <span>{t('product_out_btn')}</span>
                </button>
              ) : null}

              {canIn && (
                <button
                  onClick={() => handleQuickMovement('IN')}
                  className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50 hover:bg-emerald-100 font-bold text-xs flex items-center gap-1 transition active:scale-95"
                  title={
                    !hasGeneralStockIn && (entryCheck.isVehicleHolder || entryCheck.isVehicleBinome)
                      ? tr(language, 'Entrée autorisée dans votre camionnette', 'Stock entry allowed into your assigned vehicle')
                      : t('action_in_title')
                  }
                >
                  <ArrowUpCircle className="w-4 h-4" />
                  <span>
                    {t('product_in_btn')}
                    {!hasGeneralStockIn && (entryCheck.isVehicleHolder || entryCheck.isVehicleBinome) ? ' 🚐' : ''}
                  </span>
                </button>
              )}

              {canTransferBetweenDepots && (
                <button
                  type="button"
                  data-testid="product-detail-transfer-btn"
                  onClick={() => {
                    const sourceDepot = product.store_name || depots[0]?.name || undefined;
                    openStockTransferModal({
                      sourceDepot,
                      items: [{ productId: product.id, quantity: 1 }],
                    });
                  }}
                  className="p-2 rounded-xl bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800/60 hover:bg-sky-100 font-bold text-xs flex items-center gap-1 transition active:scale-95 cursor-pointer"
                  title={tr(
                    language,
                    'Transférer vers un autre dépôt',
                    'Transfer to another depot',
                    'Overdragen naar een ander depot'
                  )}
                >
                  <ArrowLeftRight className="w-4 h-4" />
                  <span>{tr(language, 'Transférer', 'Transfer', 'Overdragen')}</span>
                </button>
              )}
            </div>
          </div>

          {/* Bannière de restriction de prélèvement si sortie / emprunt non autorisé */}
          {!borrowCheck.allowed && (
            <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200 animate-fadeIn">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
              <div>
                <strong className="block font-bold">
                  {borrowCheck.isVehicle
                    ? tr(language, 'Camionnette sous contrôle strict (titulaire et binômes)', 'Vehicle under strict access (holder & binômes)')
                    : tr(language, 'Sortie de matériel non autorisée dans ce dépôt', 'Withdrawal not allowed in this depot')}
                </strong>
                <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
                  {borrowCheck.reason}
                </p>
              </div>
            </div>
          )}

          {/* Bannière d'information pour technicien dans sa camionnette */}
          {!hasGeneralStockIn && (entryCheck.isVehicleHolder || entryCheck.isVehicleBinome) && (
            <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 flex items-center gap-2 text-xs text-emerald-800 dark:text-emerald-300 animate-fadeIn">
              <span className="text-base">🚐</span>
              <p className="text-[11px] font-medium leading-tight">
                {tr(language, 'Vous êtes titulaire ou binôme de ce véhicule : vous pouvez y enregistrer des entrées de matériel et retours chantiers librement.', 'You are the assigned driver or binôme: you can freely record stock inflows and jobsite returns.')}
              </p>
            </div>
          )}

          {/* Location & Pricing Details */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span className="text-[10px] font-bold text-slate-400 uppercase">{t('product_location')}</span>
              <div className="font-bold text-slate-800 dark:text-slate-200 mt-1 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                <span>{product.store_name || t('common_main_depot')}</span>
              </div>
              <div className="text-slate-500 text-[11px] mt-0.5">
                {product.room_name || t('product_zone')} &gt; {product.shelf_name || t('product_bin')}
              </div>
            </div>

            {canViewPrices ? (
              <div className="p-3 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <span className="text-[10px] font-bold text-slate-400 uppercase">{t('product_unit_price_short')}</span>
                <div className="font-bold text-orange-600 dark:text-orange-400 text-sm mt-1">
                  {formatCurrency(product.unit_price)}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {t('product_total_value_short')} : {formatCurrency(qty * (product.unit_price || 0))}
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <span className="text-[10px] font-bold text-slate-400 uppercase">{t('product_mfr_ref')}</span>
                <div className="font-bold text-slate-800 dark:text-slate-200 mt-1 truncate">
                  {product.manufacturer_ref || 'N/A'}
                </div>
              </div>
            )}
          </div>

          {/* Stock par dépôt (LOT 2 v40) */}
          <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 space-y-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <Building className="w-3.5 h-3.5 text-orange-500" />
                <span>
                  {tr(language, 'Stock par dépôt', 'Stock per depot', 'Voorraad per depot')}
                </span>
              </span>
              {(canIn || canEditProduct) && availableDepotsForAdd.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setAddDepotOpen((prev) => {
                      const next = !prev;
                      if (next && product) {
                        const defaultTarget = computeDefaultAddDepotTarget({
                          currentTargetDepotName: targetDepotName,
                          allDepotRows: depotBreakdown.allDepotRows,
                          availableDepotsForAdd,
                          userHasSelectedTarget: userSelectedTargetDepotRef.current,
                        });
                        setTargetDepotName(defaultTarget);
                        if (!userSelectedTargetDepotRef.current) {
                          setTargetMinAlert(String(product.min_stock_alert ?? 2));
                        }
                      }
                      return next;
                    });
                  }}
                  className="px-2 py-1 rounded-lg bg-orange-50 dark:bg-orange-950/50 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-800/60 hover:bg-orange-100 font-bold text-[11px] flex items-center gap-1 transition cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>
                    {tr(
                      language,
                      'Ajouter à un autre dépôt',
                      'Add to another depot',
                      'Toevoegen aan een ander depot'
                    )}
                  </span>
                </button>
              )}
            </div>

            {depotBreakdown.hasDiscrepancy && (
              <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-rose-700 dark:text-rose-300 flex items-start gap-2 text-[11px]">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                <div>
                  <strong className="font-bold block">
                    {tr(
                      language,
                      'Écart de cohérence',
                      'Consistency discrepancy',
                      'Consistentieafwijking'
                    )}
                  </strong>
                  <span>
                    {tr(
                      language,
                      `Stock fiche (${depotBreakdown.productQuantity}) ≠ somme des dépôts (${depotBreakdown.sumOfStockLevels}).`,
                      `Product quantity (${depotBreakdown.productQuantity}) ≠ sum of depots (${depotBreakdown.sumOfStockLevels}).`,
                      `Productvoorraad (${depotBreakdown.productQuantity}) ≠ som van depots (${depotBreakdown.sumOfStockLevels}).`
                    )}
                  </span>
                </div>
              </div>
            )}

            {addDepotOpen && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!targetDepotName || addingToDepot) return;
                  setAddingToDepot(true);
                  try {
                    const res = await addProductToDepot({
                      productId: product.id,
                      depotName: targetDepotName,
                      quantity: Math.max(1, Number(targetInitialQty) || 1),
                      rackLocation: targetRackLocation.trim() || undefined,
                      minAlert: Math.max(0, Number(targetMinAlert) || 0),
                    });
                    if (res.success) {
                      setAddDepotOpen(false);
                      userSelectedTargetDepotRef.current = false;
                      setTargetDepotName('');
                      setTargetInitialQty('1');
                      setTargetRackLocation('');
                    }
                  } finally {
                    setAddingToDepot(false);
                  }
                }}
                className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 space-y-2"
              >
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">
                      {tr(language, 'Dépôt cible', 'Target depot', 'Doeldepot')}
                    </label>
                    <select
                      value={targetDepotName}
                      onChange={(e) => {
                        userSelectedTargetDepotRef.current = true;
                        setTargetDepotName(e.target.value);
                      }}
                      className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold"
                    >
                      {availableDepotsForAdd.map((d) => (
                        <option key={d.id} value={d.name}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">
                      {tr(language, 'Quantité initiale', 'Initial quantity', 'Beginvoorraad')}
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={targetInitialQty}
                      onChange={(e) => setTargetInitialQty(e.target.value)}
                      className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono text-xs"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">
                      {tr(language, 'Emplacement (Rack)', 'Rack location', 'Reklocatie')}
                    </label>
                    <input
                      type="text"
                      value={targetRackLocation}
                      onChange={(e) => setTargetRackLocation(e.target.value)}
                      placeholder="Ex: B2-01"
                      className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">
                      {tr(language, 'Seuil min.', 'Min. alert', 'Min. drempel')}
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={targetMinAlert}
                      onChange={(e) => setTargetMinAlert(e.target.value)}
                      className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono text-xs"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-end gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setAddDepotOpen(false)}
                    className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-[11px] font-semibold cursor-pointer"
                  >
                    {tr(language, 'Annuler', 'Cancel', 'Annuleren')}
                  </button>
                  <button
                    type="submit"
                    disabled={addingToDepot || !targetDepotName}
                    className="px-3 py-1 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-[11px] font-bold cursor-pointer disabled:opacity-50"
                  >
                    {tr(language, 'Valider l’entrée', 'Confirm entry', 'Inname bevestigen')}
                  </button>
                </div>
              </form>
            )}

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-slate-900">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead className="bg-slate-100 dark:bg-slate-800 text-[10px] font-bold uppercase text-slate-500">
                  <tr>
                    <th className="py-1.5 px-2.5">
                      {tr(language, 'Dépôt', 'Depot', 'Depot')}
                    </th>
                    <th className="py-1.5 px-2">
                      {tr(language, 'Emplacement', 'Location', 'Locatie')}
                    </th>
                    <th className="py-1.5 px-2 text-right">
                      {tr(language, 'Seuil', 'Min', 'Min')}
                    </th>
                    <th className="py-1.5 px-2.5 text-right">
                      {tr(language, 'Qté', 'Qty', 'Aantal')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {depotBreakdown.depotRows.map((row) => (
                    <tr key={row.depotName}>
                      <td className="py-1.5 px-2.5 font-semibold text-slate-800 dark:text-slate-200">
                        {row.depotName}
                      </td>
                      <td className="py-1.5 px-2 font-mono text-slate-500">
                        {row.rackLocation || '—'}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono text-slate-400">
                        {row.minAlert}
                      </td>
                      <td
                        className={`py-1.5 px-2.5 text-right font-mono font-bold ${
                          row.isOut
                            ? 'text-rose-600 dark:text-rose-400'
                            : row.isLow
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {row.quantity}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 dark:bg-slate-800/70 font-bold border-t border-slate-200 dark:border-slate-800">
                  <tr>
                    <td colSpan={3} className="py-1.5 px-2.5 text-slate-600 dark:text-slate-300">
                      {tr(language, 'Total dépôts autorisés', 'Total allowed depots', 'Totaal toegestane depots')}
                    </td>
                    <td className="py-1.5 px-2.5 text-right font-mono text-slate-900 dark:text-white">
                      {depotBreakdown.allowedTotalQuantity}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Description */}
          {product.description && (
            <div className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-2xl border border-slate-200 dark:border-slate-800">
              <span className="font-bold block text-[10px] text-slate-400 uppercase mb-1">
                {t('product_description')}
              </span>
              <p className="leading-relaxed">{product.description}</p>
            </div>
          )}

          {/* Suppliers */}
          {(product.supplier_1_name || product.supplier_2_name) && (
            <div className="text-xs p-3 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-1.5">
              <span className="font-bold block text-[10px] text-slate-400 uppercase mb-1">
                {t('product_suppliers')}
              </span>
              {product.supplier_1_name && (
                <div className="flex justify-between">
                  <span className="text-slate-500">{t('product_supplier_1')} :</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    {product.supplier_1_name}{' '}
                    {product.ref_supplier_1 && `(${product.ref_supplier_1})`}
                  </span>
                </div>
              )}
              {product.supplier_2_name && (
                <div className="flex justify-between">
                  <span className="text-slate-500">{t('product_supplier_2')} :</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    {product.supplier_2_name}{' '}
                    {product.ref_supplier_2 && `(${product.ref_supplier_2})`}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Manufacturer Data & 1D Barcode Section */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Barcode className="w-3.5 h-3.5 text-orange-500" />
                <span>{tr(language, 'Identification & Code-barres Fabricant', 'Manufacturer ID & Barcode')}</span>
              </span>
              <div className="flex items-center gap-1.5">
                {product.manufacturer_ref && (
                  <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                    Réf OEM: {product.manufacturer_ref}
                  </span>
                )}
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                  {tr(language, '✓ Unique', '✓ Unique')}
                </span>
              </div>
            </div>

            {product.barcode ? (
              <div className="flex flex-col items-center justify-center p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                <div className="p-2 bg-white rounded-lg shadow-2xs border border-slate-200 max-w-full overflow-hidden">
                  <canvas ref={barcodeCanvasRef} className="max-h-12 max-w-full block" />
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="font-mono text-xs font-black tracking-wider text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 rounded-md">
                    {product.barcode}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(product.barcode!);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    title={tr(language, 'Copier le code-barres fabricant', 'Copy manufacturer barcode')}
                    className="p-1.5 text-slate-400 hover:text-orange-500 dark:hover:text-orange-400 transition cursor-pointer rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <span className="text-[10px] text-slate-400 mt-0.5">
                  {tr(language, 'Code-barres fabricant 1D unique (EAN-13 / Code-128)', 'Unique Manufacturer EAN-13 / Code-128')}
                </span>
              </div>
            ) : (
              <div className="p-3 bg-white/60 dark:bg-slate-900/60 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-center">
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                  {tr(language, 'Aucun code-barres fabricant (EAN / UPC) associé à cet article.', 'No manufacturer barcode (EAN / UPC) assigned to this item.')}
                </p>
                {canEditProduct && (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveProductId(null);
                      setProductFormState({ open: true, product });
                    }}
                    className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400 hover:bg-orange-100 font-extrabold text-[11px] transition cursor-pointer"
                  >
                    <Edit className="w-3 h-3" />
                    <span>{tr(language, 'Scanner ou renseigner un code-barres', 'Scan or enter barcode')}</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* QR Code Canvas */}
          <div className="flex flex-col items-center justify-center p-4 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-800">
            <div className="p-3 bg-white rounded-xl shadow-sm border border-slate-200">
              <canvas ref={canvasRef} className="w-[160px] h-[160px] block" />
            </div>
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-2 font-mono">
              {product.qr_code || product.reference}
            </span>
            <span className="text-[11px] text-slate-400">
              {t('product_qr_code')} ({tr(language, 'Identifiant QR unique', 'Unique QR ID')})
            </span>

            <button
              onClick={handlePrintLabel}
              className="mt-3 py-2 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-extrabold flex items-center gap-2 shadow-sm transition active:scale-95 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>{t('prod_print_labels_btn')}</span>
            </button>
          </div>

          {/* Mini Preview of Recent Transactions */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-orange-500" />
                <span>{t('product_history_recent_card_title')}</span>
              </span>
              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className="text-xs font-bold text-orange-600 dark:text-orange-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <span>{t('product_history_view_all')} ({productMovements.length})</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            {productMovements.length === 0 ? (
              <div className="text-[11px] text-slate-400 py-2 text-center">
                {t('product_history_empty')}
              </div>
            ) : (
              <div className="space-y-1.5">
                {productMovements.slice(0, 2).map((m) => {
                  const isOut = m.movement_type === 'OUT';
                  return (
                    <div
                      key={m.id}
                      className="p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`p-1 rounded-md text-[10px] font-black ${
                            isOut
                              ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400'
                              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                          }`}
                        >
                          {isOut ? '-' : '+'}
                          {m.quantity_changed}
                        </span>
                        <span className="text-slate-600 dark:text-slate-300 text-[11px] font-medium">
                          {m.site_number ? `Chantier ${m.site_number}` : m.department_name || (isOut ? 'Sortie' : 'Entrée')}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400">
                        {formatDate(m.created_at)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : !canViewArticleHistory ? (
        <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/40 rounded-3xl border border-slate-200 dark:border-slate-800 space-y-3">
          <Lock className="w-8 h-8 text-slate-400 mx-auto" />
          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
            {tr(language, 'Historique de stock confidentiel', 'Restricted Stock History')}
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
            {tr(language, 'La traçabilité détaillée des mouvements est réservée aux responsables de département et administrateurs.', 'Movement history is restricted to department managers and admins.')}
          </p>
        </div>
      ) : (
        /* TAB 2: FULL TRANSACTION AUDIT TRAIL */
        <div className="space-y-3.5 animate-in fade-in duration-150">
          {/* Executive KPI Stats Strip for this Product */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
              <span className="text-[10px] font-bold text-rose-500 uppercase block mb-0.5">
                {t('product_history_total_out')}
              </span>
              <div className="text-base font-black text-rose-600 dark:text-rose-400">
                -{historyStats.totalOutQty} <span className="text-[11px] font-medium text-slate-400">{t('product_units')}</span>
              </div>
              {canViewPrices && (
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {formatCurrency(historyStats.totalOutCost)}
                </div>
              )}
            </div>

            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
              <span className="text-[10px] font-bold text-emerald-500 uppercase block mb-0.5">
                {t('product_history_total_in')}
              </span>
              <div className="text-base font-black text-emerald-600 dark:text-emerald-400">
                +{historyStats.totalInQty} <span className="text-[11px] font-medium text-slate-400">{t('product_units')}</span>
              </div>
              {canViewPrices && (
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {formatCurrency(historyStats.totalInCost)}
                </div>
              )}
            </div>

            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
              <span className="text-[10px] font-bold text-slate-400 uppercase block mb-0.5">
                {t('product_history_net_flow')}
              </span>
              <div
                className={`text-base font-black ${
                  historyStats.netFlow > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : historyStats.netFlow < 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                {historyStats.netFlow > 0 ? '+' : ''}
                {historyStats.netFlow} <span className="text-[11px] font-medium text-slate-400">{t('product_units')}</span>
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                Stock actuel : <strong>{qty}</strong>
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
              <span className="text-[10px] font-bold text-slate-400 uppercase block mb-0.5">
                {t('product_history_last_activity')}
              </span>
              <div className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate mt-1">
                {historyStats.lastMovement ? formatDate(historyStats.lastMovement.created_at) : 'N/A'}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                {historyStats.lastMovement?.user_name || 'Aucun'}
              </div>
            </div>
          </div>

          {/* Filters & Actions Bar */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder={t('product_history_search_placeholder')}
                  className="w-full py-2 pl-8 pr-7 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs outline-none focus:border-orange-500 transition"
                />
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                {historySearch && (
                  <button
                    type="button"
                    onClick={() => setHistorySearch('')}
                    className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {productMovements.length > 0 && (
                <button
                  type="button"
                  onClick={handleExportProductHistoryCSV}
                  title={t('product_history_export_csv')}
                  className="px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shrink-0"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="hidden sm:inline">CSV</span>
                </button>
              )}
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setHistoryTypeFilter('ALL')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  historyTypeFilter === 'ALL'
                    ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                }`}
              >
                {t('product_history_filter_all')} ({historyStats.totalCount})
              </button>

              <button
                type="button"
                onClick={() => setHistoryTypeFilter('OUT')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  historyTypeFilter === 'OUT'
                    ? 'bg-rose-600 text-white'
                    : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100'
                }`}
              >
                {t('product_history_filter_out')} ({historyStats.outCount})
              </button>

              <button
                type="button"
                onClick={() => setHistoryTypeFilter('IN')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  historyTypeFilter === 'IN'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100'
                }`}
              >
                {t('product_history_filter_in')} ({historyStats.inCount})
              </button>
            </div>
          </div>

          {/* Transactions Feed */}
          <div className="space-y-2">
            {filteredProductMovements.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-800 text-slate-400 text-xs">
                <History className="w-8 h-8 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                <p className="font-bold text-slate-600 dark:text-slate-300">
                  {historySearch
                    ? 'Aucun mouvement correspondant à votre recherche.'
                    : t('product_history_empty')}
                </p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Les sorties chantiers et entrées de stock enregistrées pour cette référence apparaîtront automatiquement ici.
                </p>
              </div>
            ) : (
              filteredProductMovements.map((m) => {
                const isOut = m.movement_type === 'OUT';
                const isAuditRegul = m.site_number === 'INV-REGUL' || (m.department_name || '').toLowerCase().includes('inventaire');
                const cost = m.total_cost ?? (m.quantity_changed * (product.unit_price || 0));

                return (
                  <div
                    key={m.id}
                    className={`p-3 rounded-2xl border transition shadow-2xs ${
                      isOut
                        ? 'bg-rose-50/40 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/40 hover:border-rose-300'
                        : 'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/40 hover:border-emerald-300'
                    }`}
                  >
                    {/* Top Line: Badge & Big Quantity */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-black px-2 py-0.5 rounded-lg ${
                            isOut
                              ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400'
                              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                          }`}
                        >
                          {isOut ? <ArrowDownCircle className="w-3 h-3" /> : <ArrowUpCircle className="w-3 h-3" />}
                          <span>
                            {isAuditRegul
                              ? 'RÉGULARISATION'
                              : isOut
                              ? t('mov_type_out').toUpperCase()
                              : t('mov_type_in').toUpperCase()}
                          </span>
                        </span>

                        <span className="text-[10px] text-slate-400 font-mono">
                          #{String(m.id ?? '').slice(-6)}
                        </span>
                      </div>

                      <div className="text-right">
                        <span
                          className={`font-black text-sm ${
                            isOut ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          {isOut ? '-' : '+'}
                          {m.quantity_changed}{' '}
                          <span className="text-xs font-semibold text-slate-400">
                            {t('product_units')}
                          </span>
                        </span>
                      </div>
                    </div>

                    {/* Mid Line: Details and Metadata */}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                      {/* Date */}
                      <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400 text-[11px]">
                        <Calendar className="w-3 h-3 text-slate-400" />
                        <span>{formatDate(m.created_at)}</span>
                      </div>

                      {/* Operator */}
                      <div className="flex items-center gap-1 text-[11px]">
                        <UserIcon className="w-3 h-3 text-slate-400" />
                        <span>
                          {tr(language, 'Par', 'By')}:{' '}
                          <strong className="text-slate-800 dark:text-slate-200">
                            {m.user_name || (tr(language, 'Opérateur', 'Operator'))}
                          </strong>
                        </span>
                      </div>

                      {/* Site / Project */}
                      {m.site_number && (
                        <div className="flex items-center gap-1 text-[11px] font-bold text-orange-600 dark:text-orange-400">
                          <span>🏗️ {m.site_number}</span>
                        </div>
                      )}

                      {/* Department or Reason */}
                      {m.department_name && (
                        <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                          <span>• {m.department_name}</span>
                        </div>
                      )}

                      {/* Total Financial Value */}
                      {canViewPrices && cost > 0 && (
                        <div className="ml-auto text-xs font-black text-slate-700 dark:text-slate-200">
                          {formatCurrency(cost)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>

        {/* Footer Actions */}
        <div className="pt-2.5 sm:pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-1.5 sm:gap-2 shrink-0">
          {product && (
            <button
              type="button"
              onClick={() => {
                addToOrderCart(product, 1);
                setOrderCartModalOpen(true);
                setActiveProductId(null);
              }}
              className="flex-1 min-w-[120px] py-2 sm:py-2.5 px-2.5 sm:px-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition active:scale-95 shadow-sm cursor-pointer"
            >
              <ShoppingCart className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{tr(language, 'Commander', 'Order')}</span>
            </button>
          )}

          {canEditProduct && (
            <button
              onClick={() => {
                setProductFormState({ open: true, product });
                setActiveProductId(null);
              }}
              className="flex-1 min-w-[100px] py-2 sm:py-2.5 px-2.5 sm:px-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition active:scale-95 shadow-sm"
            >
              <Edit className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{t('product_edit')}</span>
            </button>
          )}

          {canDelete && (
            <button
              onClick={() => setConfirmDeleteOpen(true)}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 hover:bg-rose-100 text-rose-600 flex items-center justify-center transition active:scale-95 shrink-0"
              title={t('common_delete')}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={() => setActiveProductId(null)}
            className="py-2 sm:py-2.5 px-3 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs transition shrink-0"
          >
            {t('common_close')}
          </button>
        </div>

        {/* Confirmation Modal for Deleting Reference */}
        {confirmDeleteOpen && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-fadeIn">
            <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border-2 border-rose-500/40 p-5 text-slate-800 dark:text-slate-100 text-center animate-scaleIn">
              <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-rose-100 dark:bg-rose-950/80 text-rose-600 flex items-center justify-center shadow-inner">
                <AlertTriangle className="w-7 h-7 text-rose-600 dark:text-rose-400" />
              </div>

              <h3 className="text-base font-black text-slate-900 dark:text-white mb-1">
                {t('product_delete_confirm_title')}
              </h3>

              <div className="p-3 my-3 bg-slate-50 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 text-left">
                <div className="text-xs font-black text-rose-600 dark:text-rose-400">
                  {product.reference}
                </div>
                <div className="text-xs font-bold text-slate-800 dark:text-slate-100 mt-0.5">
                  {product.brand} {product.model}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center justify-between">
                  <span>{t('product_current_stock')} :</span>
                  <span className="font-bold text-slate-700 dark:text-slate-200">
                    {product.quantity || 0} {t('product_units')}
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mb-4">
                ⚠️ {t('product_delete_warning')}
              </p>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteOpen(false)}
                  disabled={isDeleting}
                  className="flex-1 py-2.5 px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  {t('common_cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={isDeleting}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-rose-600/30 transition disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{isDeleting ? t('common_loading') : t('common_delete')}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
