import React, { useState, useEffect, useRef } from 'react';
import { tr } from '../../i18n/dutchTranslator';
import { useApp } from '../../context/AppContext';
import {
  computeDefaultAddDepotTarget,
  useProductDetailController,
} from '../../hooks/useProductDetailController';
import { formatCurrency, formatDate } from '../../utils/crypto';
import { getProductDisplayLocation, getProductStockState } from '../../services/desktopInventoryLogic';
import {
  X,
  Copy,
  Check,
  Edit3,
  Save,
  Trash2,
  Printer,
  ArrowDownCircle,
  ArrowUpCircle,
  ShoppingCart,
  MapPin,
  Building,
  Tag,
  History,
  Package,
  AlertTriangle,
  PauseCircle,
  Plus,
  ArrowLeftRight,
} from 'lucide-react';
import {
  requestGuardedNavigation,
  scrollToAndFocusForm,
  useRegisterUnsavedForm,
} from '../../services/unsavedChangesGuard';

interface DesktopProductDetailPanelProps {
  productId: string | null;
  onClose: () => void;
  onRequestLabelPrint?: (productId: string) => void;
  onRequestMovement?: (productId: string, type: 'IN' | 'OUT') => void;
}

export const DesktopProductDetailPanel: React.FC<DesktopProductDetailPanelProps> = ({
  productId,
  onClose,
  onRequestLabelPrint,
  onRequestMovement,
}) => {
  const {
    language,
    subCategories,
    depots,
    setProductFormState,
    canTransferBetweenDepots,
    openStockTransferModal,
  } = useApp();
  const ctrl = useProductDetailController(productId);
  const {
    product,
    productSignature,
    subCategory,
    depotBreakdown,
    availableDepotsForAdd,
    addProductToDepot,
  } = ctrl;

  const [isEditingInline, setIsEditingInline] = useState(false);
  const [editReference, setEditReference] = useState('');
  const [editBarcode, setEditBarcode] = useState('');
  const [editManufacturerRef, setEditManufacturerRef] = useState('');
  const [editQrCode, setEditQrCode] = useState('');
  const [editBrand, setEditBrand] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editRackLocation, setEditRackLocation] = useState('');
  const [editRoomName, setEditRoomName] = useState('');
  const [editShelfName, setEditShelfName] = useState('');
  const [editQuantity, setEditQuantity] = useState('0');
  const [editMinAlert, setEditMinAlert] = useState('2');
  const [editUnitPrice, setEditUnitPrice] = useState('0');
  const [editStoreName, setEditStoreName] = useState('');
  const [editSubCatId, setEditSubCatId] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [savingInline, setSavingInline] = useState(false);

  const inlineFormRef = useRef<HTMLFormElement | null>(null);
  const editRefInputRef = useRef<HTMLInputElement | null>(null);

  // État « Ajouter à un autre dépôt »
  const [addDepotOpen, setAddDepotOpen] = useState(false);
  const [targetDepotName, setTargetDepotName] = useState('');
  const [targetInitialQty, setTargetInitialQty] = useState('1');
  const [targetRackLocation, setTargetRackLocation] = useState('');
  const [targetMinAlert, setTargetMinAlert] = useState('2');
  const [addingToDepot, setAddingToDepot] = useState(false);

  const isEditingInlineRef = useRef(isEditingInline);
  isEditingInlineRef.current = isEditingInline;
  const addDepotOpenRef = useRef(addDepotOpen);
  addDepotOpenRef.current = addDepotOpen;
  const userSelectedTargetDepotRef = useRef(false);

  const populateInlineFieldsFromProduct = (p: typeof product) => {
    if (!p) return;
    setEditReference(p.reference || '');
    setEditBarcode(p.barcode || '');
    setEditManufacturerRef(p.manufacturer_ref || '');
    setEditQrCode(p.qr_code || p.reference || '');
    setEditBrand(p.brand || '');
    setEditModel(p.model || '');
    setEditRackLocation(p.rack_location || '');
    setEditRoomName(p.room_name || '');
    setEditShelfName(p.shelf_name || '');
    setEditQuantity(String(p.quantity ?? 0));
    setEditMinAlert(String(p.min_stock_alert ?? 2));
    setEditUnitPrice(String(p.unit_price ?? 0));
    setEditStoreName(p.store_name || '');
    setEditSubCatId(p.sub_category_id ? String(p.sub_category_id) : '');
    setEditDescription(p.description || '');
  };

  // 1. Réinitialisation uniquement au changement de produit
  useEffect(() => {
    setIsEditingInline(false);
    setAddDepotOpen(false);
    isEditingInlineRef.current = false;
    addDepotOpenRef.current = false;
    userSelectedTargetDepotRef.current = false;
    setTargetDepotName('');
    setTargetInitialQty('1');
    setTargetRackLocation('');
    setTargetMinAlert(String(product?.min_stock_alert ?? 2));
  }, [product?.id]);

  // 2. Remplissage des champs d'édition sur signature stable du produit (bloqué pendant l'édition ou l'ajout à un dépôt)
  useEffect(() => {
    if (!product) return;
    if (isEditingInlineRef.current || addDepotOpenRef.current) return;
    populateInlineFieldsFromProduct(product);
  }, [product?.id, productSignature]);

  // 3. Calcul du dépôt cible par défaut uniquement à l'ouverture du menu « Ajouter à un autre dépôt »
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

  const performSaveInline = async (): Promise<boolean> => {
    if (!product || !ctrl.canEditProduct || savingInline) return false;
    setSavingInline(true);
    try {
      const cleanRef = editReference.trim() || product.reference;
      const ok = await ctrl.saveProduct(
        {
          ...product,
          reference: cleanRef,
          barcode: editBarcode.trim(),
          manufacturer_ref: editManufacturerRef.trim(),
          qr_code: editQrCode.trim() || cleanRef,
          brand: editBrand.trim() || product.brand,
          model: editModel.trim() || product.model,
          rack_location: editRackLocation.trim(),
          room_name: editRoomName.trim(),
          shelf_name: editShelfName.trim(),
          quantity: Math.max(0, Number(editQuantity) || 0),
          min_stock_alert: Math.max(0, Number(editMinAlert) || 0),
          unit_price: ctrl.canViewPrices
            ? Math.max(0, Number(editUnitPrice) || 0)
            : product.unit_price,
          store_name: editStoreName || product.store_name,
          sub_category_id: editSubCatId ? Number(editSubCatId) : null,
          description: editDescription.trim(),
        },
        { isNew: false, editingId: product.id }
      );
      if (ok) {
        setIsEditingInline(false);
        isEditingInlineRef.current = false;
      }
      return Boolean(ok);
    } finally {
      setSavingInline(false);
    }
  };

  const discardInlineEdit = () => {
    if (product) {
      populateInlineFieldsFromProduct(product);
    }
    setIsEditingInline(false);
    isEditingInlineRef.current = false;
  };

  useRegisterUnsavedForm({
    id: 'desktop-product-inline',
    isDirty: Boolean(product && isEditingInline),
    label: product
      ? `${tr(language, 'Produit', 'Product', 'Product')} : ${product.reference} (${product.brand} ${product.model})`
      : undefined,
    onSave: () => performSaveInline(),
    onDiscard: () => discardInlineEdit(),
  });

  if (!product) {
    return null;
  }

  const stockState = getProductStockState(product);
  const displayLoc = getProductDisplayLocation(product);

  const handleSaveInline = async (e: React.FormEvent) => {
    e.preventDefault();
    await performSaveInline();
  };

  const handleStartEditInline = () => {
    ctrl.setActiveTab('details');
    setIsEditingInline(true);
    isEditingInlineRef.current = true;
    scrollToAndFocusForm(inlineFormRef.current, editRefInputRef.current);
  };

  return (
    <aside
      role="region"
      aria-label={tr(language, 'Détail du produit', 'Product detail', 'Productdetail')}
      className="w-[390px] xl:w-[430px] shrink-0 h-full border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
              {product.reference}
            </span>
            <button
              type="button"
              onClick={ctrl.handleCopyRef}
              className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white transition cursor-pointer"
              title={tr(language, 'Copier la référence', 'Copy reference', 'Referentie kopiëren')}
            >
              {ctrl.copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
            <span aria-hidden="true">·</span>
            <span
              className={`font-semibold ${
                stockState === 'OUT'
                  ? 'text-red-600 dark:text-red-400'
                  : stockState === 'LOW'
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {stockState === 'OUT'
                ? tr(language, 'Rupture', 'Out of stock', 'Niet op voorraad')
                : stockState === 'LOW'
                ? tr(language, 'Stock bas', 'Low stock', 'Lage voorraad')
                : tr(language, 'En stock', 'In stock', 'Op voorraad')}
            </span>
          </div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white mt-0.5 truncate">
            {product.brand} {product.model}
          </h2>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {ctrl.canEditProduct && (
            <button
              type="button"
              onClick={() => {
                if (!isEditingInline) {
                  handleStartEditInline();
                } else {
                  requestGuardedNavigation(() => discardInlineEdit(), ['desktop-product-inline']);
                }
              }}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition cursor-pointer ${
                isEditingInline
                  ? 'bg-orange-600 text-white border-orange-600'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>{tr(language, 'Éditer', 'Edit', 'Bewerken')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => requestGuardedNavigation(onClose, ['desktop-product-inline'])}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
            aria-label={tr(language, 'Fermer le panneau', 'Close panel', 'Paneel sluiten')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 pt-2 border-b border-slate-200 dark:border-slate-800 flex items-center gap-4 text-xs font-semibold">
        <button
          type="button"
          onClick={() => ctrl.setActiveTab('details')}
          className={`pb-2 border-b-2 transition cursor-pointer flex items-center gap-1.5 ${
            ctrl.activeTab === 'details'
              ? 'border-orange-600 text-orange-600 dark:text-orange-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Package className="w-3.5 h-3.5" />
          <span>{tr(language, 'Fiche & Édition', 'Details & Edit', 'Details & Bewerken')}</span>
        </button>
        {ctrl.canViewArticleHistory && (
          <button
            type="button"
            onClick={() =>
              requestGuardedNavigation(() => ctrl.setActiveTab('history'), ['desktop-product-inline'])
            }
            className={`pb-2 border-b-2 transition cursor-pointer flex items-center gap-1.5 ${
              ctrl.activeTab === 'history'
                ? 'border-orange-600 text-orange-600 dark:text-orange-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>
              {tr(language, 'Mouvements récents', 'Recent movements', 'Recente bewegingen')} (
              {ctrl.productMovements.length})
            </span>
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {ctrl.isDepotClosedState && (
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2">
            <PauseCircle className="w-4 h-4 shrink-0 text-amber-600" />
            <span>
              {tr(
                language,
                'Ce dépôt est actuellement en fermeture temporaire.',
                'This depot is currently temporarily closed.',
                'Dit depot is momenteel tijdelijk gesloten.'
              )}
            </span>
          </div>
        )}

        {ctrl.activeTab === 'details' ? (
          isEditingInline ? (
            <form ref={inlineFormRef} onSubmit={handleSaveInline} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {tr(language, 'Référence Interne', 'Internal Ref', 'Interne ref.')}
                  </label>
                  <input
                    ref={editRefInputRef}
                    type="text"
                    value={editReference}
                    onChange={(e) => setEditReference(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {tr(language, 'Code-barres 1D (EAN / UPC)', '1D Barcode (EAN / UPC)', '1D Barcode (EAN / UPC)')}
                  </label>
                  <input
                    type="text"
                    value={editBarcode}
                    onChange={(e) => setEditBarcode(e.target.value)}
                    placeholder="Ex: 3700001234567"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {tr(language, 'Réf. Fabricant (OEM)', 'Manufacturer Ref (OEM)', 'Fabrikantref. (OEM)')}
                  </label>
                  <input
                    type="text"
                    value={editManufacturerRef}
                    onChange={(e) => setEditManufacturerRef(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {tr(language, 'Code QR', 'QR Code', 'QR-code')}
                  </label>
                  <input
                    type="text"
                    value={editQrCode}
                    onChange={(e) => setEditQrCode(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {tr(language, 'Marque', 'Brand', 'Merk')}
                  </label>
                  <input
                    type="text"
                    value={editBrand}
                    onChange={(e) => setEditBrand(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {tr(language, 'Modèle / Désignation', 'Model / Designation', 'Model / Omschrijving')}
                  </label>
                  <input
                    type="text"
                    value={editModel}
                    onChange={(e) => setEditModel(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {tr(language, 'Dépôt', 'Depot', 'Depot')}
                  </label>
                  <select
                    value={editStoreName}
                    onChange={(e) => setEditStoreName(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    {depots.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {tr(language, 'Catégorie', 'Category', 'Categorie')}
                  </label>
                  <select
                    value={editSubCatId}
                    onChange={(e) => setEditSubCatId(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="">—</option>
                    {subCategories.map((sc) => (
                      <option key={sc.id} value={String(sc.id)}>
                        {sc.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {tr(language, 'Emplacement (Rack)', 'Rack Location', 'Reklocatie')}
                  </label>
                  <input
                    type="text"
                    value={editRackLocation}
                    onChange={(e) => setEditRackLocation(e.target.value)}
                    placeholder="Ex: A2-04"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {tr(language, 'Zone / Pièce', 'Room / Zone', 'Zone / Ruimte')}
                  </label>
                  <input
                    type="text"
                    value={editRoomName}
                    onChange={(e) => setEditRoomName(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {tr(language, 'Étagère / Bac', 'Shelf / Bin', 'Plank / Bak')}
                  </label>
                  <input
                    type="text"
                    value={editShelfName}
                    onChange={(e) => setEditShelfName(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {tr(language, 'Quantité', 'Quantity', 'Aantal')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={editQuantity}
                    onChange={(e) => setEditQuantity(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {tr(language, 'Seuil min.', 'Min. alert', 'Min. drempel')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={editMinAlert}
                    onChange={(e) => setEditMinAlert(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono tabular-nums"
                  />
                </div>
                {ctrl.canViewPrices && (
                  <div>
                    <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      {tr(language, 'Prix HT', 'Unit Price', 'Eenheidsprijs')}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={editUnitPrice}
                      onChange={(e) => setEditUnitPrice(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono tabular-nums"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  {tr(language, 'Description / Notes', 'Description / Notes', 'Beschrijving / Notities')}
                </label>
                <textarea
                  rows={2}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div className="flex items-center justify-between gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setProductFormState({ open: true, product })}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  {tr(language, 'Formulaire complet…', 'Full form…', 'Volledig formulier…')}
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={discardInlineEdit}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    {tr(language, 'Annuler', 'Cancel', 'Annuleren')}
                  </button>
                  <button
                    type="submit"
                    disabled={savingInline}
                    className="px-3.5 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{tr(language, 'Enregistrer', 'Save', 'Opslaan')}</span>
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <>
              {/* Key Metrics Row */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {tr(language, 'En stock', 'In stock', 'Voorraad')}
                  </div>
                  <div className="text-xl font-black font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
                    {product.quantity ?? 0}
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                    {tr(language, 'Seuil :', 'Min:', 'Min:')} {product.min_stock_alert ?? 2}
                  </div>
                </div>

                {ctrl.canViewPrices ? (
                  <>
                    <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {tr(language, 'Prix unitaire', 'Unit price', 'Eenheidsprijs')}
                      </div>
                      <div className="text-base font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                        {formatCurrency(product.unit_price || 0)}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {tr(language, 'Valeur totale', 'Total value', 'Totale waarde')}
                      </div>
                      <div className="text-base font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                        {formatCurrency((product.quantity || 0) * (product.unit_price || 0))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="col-span-2 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 flex items-center text-xs text-slate-500">
                    {tr(
                      language,
                      'Emplacement :',
                      'Location:',
                      'Locatie:'
                    )}{' '}
                    <strong className="ml-1 font-mono text-slate-800 dark:text-slate-200">
                      {displayLoc || '—'}
                    </strong>
                  </div>
                )}
              </div>

              {/* Action Buttons (Stock In / Out / Order / Label) */}
              <div className="grid grid-cols-2 gap-2">
                {ctrl.canOut && (
                  <button
                    type="button"
                    onClick={() => {
                      if (onRequestMovement) {
                        onRequestMovement(product.id, 'OUT');
                      } else {
                        ctrl.setScanState({ open: false, mode: 'OUT' });
                        ctrl.addToCart(product, 1);
                        ctrl.setBatchCartModalOpen(true);
                      }
                    }}
                    className="py-2 px-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                  >
                    <ArrowUpCircle className="w-4 h-4 shrink-0" />
                    <span>{tr(language, 'Sortie de stock', 'Stock Out', 'Uitgifte')}</span>
                  </button>
                )}
                {ctrl.canIn && (
                  <button
                    type="button"
                    onClick={() => {
                      if (onRequestMovement) {
                        onRequestMovement(product.id, 'IN');
                      } else {
                        ctrl.setScanState({ open: false, mode: 'IN' });
                        ctrl.addToCart(product, 1);
                        ctrl.setBatchCartModalOpen(true);
                      }
                    }}
                    className="py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                  >
                    <ArrowDownCircle className="w-4 h-4 shrink-0" />
                    <span>{tr(language, 'Entrée de stock', 'Stock In', 'Inname')}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    ctrl.addToOrderCart(product, 1);
                  }}
                  className="py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 font-semibold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <ShoppingCart className="w-4 h-4 text-orange-600 shrink-0" />
                  <span>{tr(language, 'Ajouter commande', 'Add to order', 'Aan bestelling toevoegen')}</span>
                </button>
                {ctrl.canPrintLabels && (
                  <button
                    type="button"
                    onClick={() => {
                      if (onRequestLabelPrint) {
                        onRequestLabelPrint(product.id);
                      } else {
                        ctrl.setPrintLabelsModal({ open: true, initialProductId: product.id });
                      }
                    }}
                    className="py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 font-semibold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                  >
                    <Printer className="w-4 h-4 text-orange-600 shrink-0" />
                    <span>{tr(language, 'Imprimer étiquette', 'Print label', 'Etiket afdrukken')}</span>
                  </button>
                )}
                {canTransferBetweenDepots && (
                  <button
                    type="button"
                    data-testid="desktop-product-transfer-btn"
                    onClick={() => {
                      const defaultSrc =
                        depotBreakdown.depotRows.find((r) => r.quantity > 0)?.depotName ||
                        product.store_name ||
                        undefined;
                      openStockTransferModal({
                        sourceDepot: defaultSrc,
                        items: [{ productId: product.id, quantity: 1 }],
                      });
                    }}
                    className="col-span-2 py-2 px-3 rounded-xl border border-sky-200 dark:border-sky-800/70 bg-sky-50/80 dark:bg-sky-950/40 hover:bg-sky-100 dark:hover:bg-sky-900/60 text-sky-700 dark:text-sky-300 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                  >
                    <ArrowLeftRight className="w-4 h-4 text-sky-600 shrink-0" />
                    <span>
                      {tr(
                        language,
                        'Transférer vers un autre dépôt',
                        'Transfer to another depot',
                        'Overdragen naar een ander depot'
                      )}
                    </span>
                  </button>
                )}
              </div>

              {/* Section Stock par dépôt (LOT 2 v40) */}
              <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Building className="w-3.5 h-3.5 text-orange-600" />
                    <span>
                      {tr(language, 'Stock par dépôt', 'Stock per depot', 'Voorraad per depot')}
                    </span>
                  </span>
                  {(ctrl.canIn || ctrl.canEditProduct) && availableDepotsForAdd.length > 0 && (
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
                      className="px-2 py-1 rounded-lg bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800/60 hover:bg-orange-100 font-bold text-[11px] flex items-center gap-1 transition cursor-pointer"
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
                    className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2"
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
                          className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold"
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
                          className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs"
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
                          className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs"
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
                          className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs"
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

                <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead className="bg-slate-50 dark:bg-slate-800/70 text-[10px] font-bold uppercase text-slate-500">
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
                        <tr key={row.depotName} className="bg-white dark:bg-slate-900">
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

              {/* Metadata Grid */}
              <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-2 text-xs">
                <div className="flex items-center justify-between py-1">
                  <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <Building className="w-3.5 h-3.5" />
                    <span>{tr(language, 'Dépôt', 'Depot', 'Depot')}</span>
                  </span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {product.store_name || '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" />
                    <span>{tr(language, 'Emplacement', 'Location', 'Locatie')}</span>
                  </span>
                  <span className="font-mono font-semibold text-slate-900 dark:text-white">
                    {displayLoc || '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5" />
                    <span>{tr(language, 'Catégorie', 'Category', 'Categorie')}</span>
                  </span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {subCategory?.name || '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-slate-500 dark:text-slate-400">
                    {tr(language, 'Code-barres 1D', '1D Barcode', '1D Barcode')}
                  </span>
                  <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                    {product.barcode || '—'}
                  </span>
                </div>
                {product.manufacturer_ref && (
                  <div className="flex items-center justify-between py-1">
                    <span className="text-slate-500 dark:text-slate-400">
                      {tr(language, 'Réf. fabricant', 'OEM Ref', 'Fabrikantref.')}
                    </span>
                    <span className="font-mono text-slate-800 dark:text-slate-200">
                      {product.manufacturer_ref}
                    </span>
                  </div>
                )}
                {product.supplier_1_name && (
                  <div className="flex items-center justify-between py-1">
                    <span className="text-slate-500 dark:text-slate-400">
                      {tr(language, 'Fournisseur', 'Supplier', 'Leverancier')}
                    </span>
                    <span className="text-slate-800 dark:text-slate-200">
                      {product.supplier_1_name}
                      {product.ref_supplier_1 ? ` · ${product.ref_supplier_1}` : ''}
                    </span>
                  </div>
                )}
                {product.description && (
                  <div className="pt-1 text-slate-600 dark:text-slate-300 leading-relaxed">
                    {product.description}
                  </div>
                )}
              </div>

              {/* Traceability Codes (QR + Barcode) */}
              <div className="border-t border-slate-200 dark:border-slate-800 pt-3">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  {tr(language, 'Codes de traçabilité', 'Traceability codes', 'Traceerbaarheidscodes')}
                </div>
                <div className="flex flex-col items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                  <canvas ref={ctrl.canvasRef} className="w-32 h-32 rounded-lg bg-white p-1" />
                  {product.barcode && (
                    <canvas
                      ref={ctrl.barcodeCanvasRef}
                      className="max-w-full h-14 rounded bg-white px-2"
                    />
                  )}
                </div>
              </div>

              {/* Delete action */}
              {ctrl.canDelete && (
                <div className="border-t border-slate-200 dark:border-slate-800 pt-3">
                  {!ctrl.confirmDeleteOpen ? (
                    <button
                      type="button"
                      onClick={() => ctrl.setConfirmDeleteOpen(true)}
                      className="text-xs font-semibold text-red-600 hover:text-red-700 dark:text-red-400 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>
                        {tr(language, 'Supprimer cette référence', 'Delete product', 'Product verwijderen')}
                      </span>
                    </button>
                  ) : (
                    <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 space-y-2 text-xs">
                      <div className="font-semibold text-red-800 dark:text-red-200 flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>
                          {tr(
                            language,
                            'Confirmer la suppression définitive ?',
                            'Confirm permanent deletion?',
                            'Definitieve verwijdering bevestigen?'
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={ctrl.handleDelete}
                          disabled={ctrl.isDeleting}
                          className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold cursor-pointer"
                        >
                          {tr(language, 'Supprimer', 'Delete', 'Verwijderen')}
                        </button>
                        <button
                          type="button"
                          onClick={() => ctrl.setConfirmDeleteOpen(false)}
                          className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold cursor-pointer"
                        >
                          {tr(language, 'Annuler', 'Cancel', 'Annuleren')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )
        ) : (
          /* History Tab */
          <div className="space-y-3 text-xs">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={ctrl.historySearch}
                onChange={(e) => ctrl.setHistorySearch(e.target.value)}
                placeholder={tr(
                  language,
                  'Filtrer par opérateur, chantier, commande...',
                  'Filter by user, site, order...',
                  'Filter op gebruiker, werf, bestelling...'
                )}
                className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
              <select
                value={ctrl.historyTypeFilter}
                onChange={(e) => ctrl.setHistoryTypeFilter(e.target.value as 'ALL' | 'IN' | 'OUT')}
                className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
              >
                <option value="ALL">{tr(language, 'Tous', 'All', 'Alle')}</option>
                <option value="OUT">{tr(language, 'Sorties', 'Out', 'Uit')}</option>
                <option value="IN">{tr(language, 'Entrées', 'In', 'In')}</option>
              </select>
            </div>

            {ctrl.productMovements.length === 0 ? (
              <div className="py-8 text-center text-slate-500 dark:text-slate-400">
                {tr(
                  language,
                  'Aucun mouvement enregistré pour cet article.',
                  'No movements recorded for this item.',
                  'Geen bewegingen geregistreerd voor dit artikel.'
                )}
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                {ctrl.productMovements.slice(0, 50).map((m) => (
                  <div
                    key={m.id}
                    className="p-2.5 bg-white dark:bg-slate-900 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white">
                        <span
                          className={
                            m.movement_type === 'IN'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }
                        >
                          {m.movement_type === 'IN' ? '+' : '−'}
                          {m.quantity_changed}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">{m.user_name || '—'}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {formatDate(m.created_at)}
                        {m.site_number ? ` · ${m.site_number}` : ''}
                        {m.order_number ? ` · ${m.order_number}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
