import { useEffect, useMemo, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import { useApp } from '../context/AppContext';
import { Depot, Product, StockLevel, User } from '../types';
import {
  canUserBorrowFromDepot,
  canUserEnterStockInDepot,
  isDepotClosed,
  isUserAllowedForDepot,
} from '../utils/crypto';
import { getProductDepotBreakdown } from '../services/desktopInventoryLogic';
import { renderQrCodeWithTotLogo } from '../utils/qrCodeHelper';

export function buildProductEditableSignature(product: Product | null | undefined): string {
  if (!product) return '';
  return [
    String(product.id),
    (product as Product & { updated_at?: string }).updated_at || '',
    product.reference || '',
    product.barcode || '',
    product.manufacturer_ref || '',
    product.qr_code || '',
    product.brand || '',
    product.model || '',
    product.rack_location || '',
    product.room_name || '',
    product.shelf_name || '',
    String(product.quantity ?? 0),
    String(product.min_stock_alert ?? 2),
    String(product.unit_price ?? 0),
    product.store_name || '',
    String(product.sub_category_id ?? ''),
    product.description || '',
  ].join('|');
}

export function buildProductStockLevelsSignature(
  productId: string | number | null | undefined,
  stockLevels: StockLevel[] | undefined
): string {
  if (productId === null || productId === undefined || !Array.isArray(stockLevels)) return '';
  const pid = String(productId);
  return stockLevels
    .filter((sl) => sl && String(sl.product_id) === pid)
    .map(
      (sl) =>
        `${sl.id ?? ''}:${sl.depot_name || ''}:${Number(sl.quantity ?? 0)}:${Number((sl as StockLevel & { min_stock?: number }).min_stock ?? sl.min_alert ?? 0)}:${sl.rack_location || ''}`
    )
    .sort()
    .join('|');
}

export function buildAvailableDepotsSignature(
  depots: Depot[] | undefined,
  currentUser: User | null | undefined
): string {
  const depotPart = (depots || [])
    .map((d) => `${d.id}:${d.name}:${d.is_active !== false ? '1' : '0'}`)
    .join('|');
  const userPart = currentUser
    ? `${currentUser.id}:${currentUser.role_id}:${(currentUser.allowed_depots || []).join(',')}`
    : 'anon';
  return `${depotPart}::${userPart}`;
}

export function computeDefaultAddDepotTarget(params: {
  currentTargetDepotName: string;
  allDepotRows: Array<{ depotName: string }>;
  availableDepotsForAdd: Depot[];
  userHasSelectedTarget: boolean;
}): string {
  const { currentTargetDepotName, allDepotRows, availableDepotsForAdd, userHasSelectedTarget } =
    params;
  if (
    userHasSelectedTarget &&
    currentTargetDepotName &&
    availableDepotsForAdd.some((d) => d.name === currentTargetDepotName)
  ) {
    return currentTargetDepotName;
  }
  const existingNames = new Set(
    (allDepotRows || []).map((r) => (r.depotName || '').trim().toLowerCase())
  );
  const firstOther =
    availableDepotsForAdd.find((d) => !existingNames.has((d.name || '').trim().toLowerCase())) ||
    availableDepotsForAdd[0];
  return firstOther?.name || '';
}

export interface ProductDetailFormStateSnapshot {
  lastProductId: string | number | null;
  lastProductSignature: string;
  isEditingInline: boolean;
  addDepotOpen: boolean;
  userHasSelectedTargetDepot: boolean;
  targetDepotName: string;
  targetInitialQty: string;
  targetRackLocation: string;
  targetMinAlert: string;
  editReference: string;
  editBarcode: string;
  editManufacturerRef: string;
  editQrCode: string;
  editBrand: string;
  editModel: string;
  editRackLocation: string;
  editRoomName: string;
  editShelfName: string;
  editQuantity: string;
  editMinAlert: string;
  editUnitPrice: string;
  editStoreName: string;
  editSubCatId: string;
  editDescription: string;
}

export function createInitialProductDetailFormState(
  product: Product | null | undefined
): ProductDetailFormStateSnapshot {
  const sig = buildProductEditableSignature(product);
  return {
    lastProductId: product?.id ?? null,
    lastProductSignature: sig,
    isEditingInline: false,
    addDepotOpen: false,
    userHasSelectedTargetDepot: false,
    targetDepotName: '',
    targetInitialQty: '1',
    targetRackLocation: '',
    targetMinAlert: String(product?.min_stock_alert ?? 2),
    editReference: product?.reference || '',
    editBarcode: product?.barcode || '',
    editManufacturerRef: product?.manufacturer_ref || '',
    editQrCode: product?.qr_code || product?.reference || '',
    editBrand: product?.brand || '',
    editModel: product?.model || '',
    editRackLocation: product?.rack_location || '',
    editRoomName: product?.room_name || '',
    editShelfName: product?.shelf_name || '',
    editQuantity: String(product?.quantity ?? 0),
    editMinAlert: String(product?.min_stock_alert ?? 2),
    editUnitPrice: String(product?.unit_price ?? 0),
    editStoreName: product?.store_name || '',
    editSubCatId: product?.sub_category_id ? String(product.sub_category_id) : '',
    editDescription: product?.description || '',
  };
}

export function applyProductDetailSyncUpdate(
  state: ProductDetailFormStateSnapshot,
  nextProduct: Product | null | undefined
): ProductDetailFormStateSnapshot {
  const nextId = nextProduct?.id ?? null;
  const nextSig = buildProductEditableSignature(nextProduct);
  const productSwitched = String(state.lastProductId ?? '') !== String(nextId ?? '');

  if (productSwitched) {
    return createInitialProductDetailFormState(nextProduct);
  }

  // Même produit : ne jamais fermer addDepotOpen ni quitter isEditingInline, et ne pas écraser la saisie en cours
  if (state.isEditingInline || state.addDepotOpen) {
    return state;
  }

  if (state.lastProductSignature === nextSig || !nextProduct) {
    return state;
  }

  return {
    ...state,
    lastProductSignature: nextSig,
    editReference: nextProduct.reference || '',
    editBarcode: nextProduct.barcode || '',
    editManufacturerRef: nextProduct.manufacturer_ref || '',
    editQrCode: nextProduct.qr_code || nextProduct.reference || '',
    editBrand: nextProduct.brand || '',
    editModel: nextProduct.model || '',
    editRackLocation: nextProduct.rack_location || '',
    editRoomName: nextProduct.room_name || '',
    editShelfName: nextProduct.shelf_name || '',
    editQuantity: String(nextProduct.quantity ?? 0),
    editMinAlert: String(nextProduct.min_stock_alert ?? 2),
    editUnitPrice: String(nextProduct.unit_price ?? 0),
    editStoreName: nextProduct.store_name || '',
    editSubCatId: nextProduct.sub_category_id ? String(nextProduct.sub_category_id) : '',
    editDescription: nextProduct.description || '',
  };
}

export function openAddDepotMenuInState(
  state: ProductDetailFormStateSnapshot,
  params: {
    product: Product | null | undefined;
    allDepotRows: Array<{ depotName: string }>;
    availableDepotsForAdd: Depot[];
  }
): ProductDetailFormStateSnapshot {
  const nextTarget = computeDefaultAddDepotTarget({
    currentTargetDepotName: state.targetDepotName,
    allDepotRows: params.allDepotRows,
    availableDepotsForAdd: params.availableDepotsForAdd,
    userHasSelectedTarget: state.userHasSelectedTargetDepot,
  });
  return {
    ...state,
    addDepotOpen: true,
    targetDepotName: nextTarget,
    targetMinAlert: state.userHasSelectedTargetDepot
      ? state.targetMinAlert
      : String(params.product?.min_stock_alert ?? 2),
  };
}

export function useProductDetailController(productIdOverride?: string | null) {
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
    saveProduct,
    addProductToDepot,
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

  const rawProduct = useMemo(
    () => products.find((p) => String(p.id) === String(resolvedProductId)) || null,
    [products, resolvedProductId]
  );

  const productSignature = useMemo(() => buildProductEditableSignature(rawProduct), [rawProduct]);
  const stockLevelsSignature = useMemo(
    () => buildProductStockLevelsSignature(resolvedProductId, stockLevels),
    [resolvedProductId, stockLevels]
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

  // Référence stable : ne change que si les champs primitifs de la fiche changent
  const product = useMemo(
    () => latestDataRef.current.rawProduct,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [productSignature]
  );

  const subCategory = useMemo(
    () => subCategories.find((s) => Number(s.id) === Number(product?.sub_category_id)) || null,
    [subCategories, product?.sub_category_id]
  );

  // Tableaux stabilisés par signature primitive : une resynchronisation sans changement réel ne crée pas de nouvelles références
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

  const availableDepotsForAdd = useMemo(() => {
    return (latestDataRef.current.depots || []).filter(
      (d) =>
        d.is_active !== false &&
        isUserAllowedForDepot(latestDataRef.current.currentUser, d.name)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableDepotsSignature]);

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
  }, [product?.id, product?.qr_code, product?.reference, product?.barcode, activeTab]);

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
    productSignature,
    subCategory,
    stockLevels,
    depotBreakdown,
    availableDepotsForAdd,
    addProductToDepot,
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

