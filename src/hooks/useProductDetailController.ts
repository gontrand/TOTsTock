import { useEffect, useMemo, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import { useApp } from '../context/AppContext';
import {
  canUserBorrowFromDepot,
  canUserEnterStockInDepot,
  isDepotClosed,
  isUserAllowedForDepot,
} from '../utils/crypto';
import { renderQrCodeWithTotLogo } from '../utils/qrCodeHelper';

export function useProductDetailController(productIdOverride?: string | null) {
  const {
    activeProductId,
    setActiveProductId,
    products,
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
    saveProduct,
  } = useApp();

  const resolvedProductId = productIdOverride !== undefined ? productIdOverride : activeProductId;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const barcodeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState<'details' | 'history'>('details');
  const [historySearch, setHistorySearch] = useState('');
  const [historyTypeFilter, setHistoryTypeFilter] = useState<'ALL' | 'IN' | 'OUT'>('ALL');

  const product = useMemo(
    () => products.find((p) => String(p.id) === String(resolvedProductId)) || null,
    [products, resolvedProductId]
  );

  const subCategory = useMemo(
    () => subCategories.find((s) => Number(s.id) === Number(product?.sub_category_id)) || null,
    [subCategories, product]
  );

  useEffect(() => {
    setActiveTab('details');
    setHistorySearch('');
    setHistoryTypeFilter('ALL');
    setConfirmDeleteOpen(false);
  }, [resolvedProductId]);

  const isDepotClosedState = isDepotClosed(depots, product?.store_name);
  const isDepotAllowed = isUserAllowedForDepot(currentUser, product?.store_name);

  const borrowCheck = canUserBorrowFromDepot(
    currentUser,
    product?.store_name,
    depots,
    language,
    departments,
    users
  );
  const hasGeneralStockIn = userHasPermission('perm_stock_in');
  const entryCheck = canUserEnterStockInDepot(
    currentUser,
    product?.store_name,
    depots,
    hasGeneralStockIn,
    language,
    departments,
    users
  );

  const canEditProduct = userHasPermission('perm_prod_edit');
  const hasFinancePerm = userHasPermission('perm_dash_finance');
  const canViewPrices = userHasPermission('perm_prod_view_price');
  const canOut = userHasPermission('perm_mov_out') && borrowCheck.allowed;
  const canIn = entryCheck.allowed;
  const canDelete = userHasPermission('perm_prod_delete');
  const canPrintLabels = userHasPermission('perm_menu_print_labels');

  useEffect(() => {
    if (product && canvasRef.current) {
      const qrValue = (product.qr_code || product.reference || '').trim();
      renderQrCodeWithTotLogo(canvasRef.current, qrValue, {
        size: 180,
        margin: 2,
      }).catch(() => {});
    }

    if (product?.barcode && barcodeCanvasRef.current) {
      try {
        const clean = product.barcode.trim();
        let format = 'CODE128';
        if (/^\d{13}$/.test(clean)) format = 'EAN13';
        else if (/^\d{8}$/.test(clean)) format = 'EAN8';
        JsBarcode(barcodeCanvasRef.current, clean, {
          format,
          width: 1.6,
          height: 44,
          displayValue: true,
          fontSize: 12,
          margin: 4,
        });
      } catch {
        try {
          JsBarcode(barcodeCanvasRef.current, product.barcode.trim(), {
            format: 'CODE128',
            width: 1.6,
            height: 44,
            displayValue: true,
            fontSize: 12,
            margin: 4,
          });
        } catch {
          // Ignore invalid barcode
        }
      }
    }
  }, [product, activeTab]);

  const productMovements = useMemo(() => {
    if (!product) return [];
    const q = historySearch.toLowerCase().trim();
    return movements
      .filter((m) => {
        const matchProduct =
          String(m.product_id) === String(product.id) ||
          (m.product_ref &&
            product.reference &&
            m.product_ref.toLowerCase() === product.reference.toLowerCase());
        if (!matchProduct) return false;
        if (historyTypeFilter !== 'ALL' && m.movement_type !== historyTypeFilter) return false;
        if (q) {
          const matchUser = m.user_name?.toLowerCase().includes(q);
          const matchSite = m.site_number?.toLowerCase().includes(q);
          const matchDep = m.department_name?.toLowerCase().includes(q);
          const matchOrder = m.order_number?.toLowerCase().includes(q);
          if (!matchUser && !matchSite && !matchDep && !matchOrder) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [movements, product, historySearch, historyTypeFilter]);

  const handleCopyRef = () => {
    if (!product) return;
    navigator.clipboard?.writeText(product.reference);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDelete = async () => {
    if (!product || isDeleting) return;
    setIsDeleting(true);
    try {
      const ok = await deleteProduct(product.id);
      if (ok) {
        setConfirmDeleteOpen(false);
        setActiveProductId(null);
      }
    } finally {
      setIsDeleting(false);
    }
  };

  return {
    product,
    subCategory,
    canvasRef,
    barcodeCanvasRef,
    copied,
    handleCopyRef,
    confirmDeleteOpen,
    setConfirmDeleteOpen,
    isDeleting,
    handleDelete,
    activeTab,
    setActiveTab,
    historySearch,
    setHistorySearch,
    historyTypeFilter,
    setHistoryTypeFilter,
    productMovements,
    isDepotClosedState,
    isDepotAllowed,
    borrowCheck,
    entryCheck,
    canEditProduct,
    hasFinancePerm,
    canViewPrices,
    canOut,
    canIn,
    canDelete,
    canPrintLabels,
    canViewArticleHistory,
    setActiveProductId,
    setProductFormState,
    addToCart,
    setBatchCartModalOpen,
    addToOrderCart,
    setOrderCartModalOpen,
    setScanState,
    setPrintLabelsModal,
    saveProduct,
  };
}
