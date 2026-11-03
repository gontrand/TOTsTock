import React, { useEffect, useState } from 'react';
import { tr } from '../../i18n/dutchTranslator';
import { useApp } from '../../context/AppContext';
import { Product } from '../../types';
import { validateProductIdentifiersUniqueness } from '../../utils/crypto';
import { getPlanMaxReferences } from '../../services/licenseService';
import { X, Save, Package, AlertTriangle, Lock } from 'lucide-react';

interface DesktopProductFormDrawerProps {
  open: boolean;
  product: Product | null;
  prefillCode?: string | null;
  onClose: () => void;
  onSaved?: (savedRef: string) => void;
}

export const DesktopProductFormDrawer: React.FC<DesktopProductFormDrawerProps> = ({
  open,
  product,
  prefillCode,
  onClose,
  onSaved,
}) => {
  const {
    saveProduct,
    subCategories,
    depots,
    userHasPermission,
    license,
    products,
    language,
  } = useApp();

  const isEdit = Boolean(product);
  const maxReferences = getPlanMaxReferences(license?.plan_type);
  const isQuotaReached = !isEdit && products.length >= maxReferences;
  const canViewPrices = userHasPermission('perm_prod_view_price');

  const [reference, setReference] = useState('');
  const [manufacturerRef, setManufacturerRef] = useState('');
  const [barcode, setBarcode] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [subCategoryId, setSubCategoryId] = useState('');
  const [unitPrice, setUnitPrice] = useState('0.00');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [supplier1Name, setSupplier1Name] = useState('');
  const [refSupplier1, setRefSupplier1] = useState('');
  const [supplier2Name, setSupplier2Name] = useState('');
  const [refSupplier2, setRefSupplier2] = useState('');
  const [storeName, setStoreName] = useState('Dépôt Principal');
  const [rackLocation, setRackLocation] = useState('');
  const [roomName, setRoomName] = useState('');
  const [shelfName, setShelfName] = useState('');
  const [quantity, setQuantity] = useState('10');
  const [minStockAlert, setMinStockAlert] = useState('2');
  const [errorMsg, setErrorMsg] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrorMsg('');
    if (product) {
      setReference(product.reference || '');
      setManufacturerRef(product.manufacturer_ref || '');
      setBarcode(product.barcode || '');
      setQrCode(product.qr_code || '');
      setBrand(product.brand || '');
      setModel(product.model || '');
      setSubCategoryId(product.sub_category_id ? String(product.sub_category_id) : '');
      setUnitPrice(String(product.unit_price ?? 0));
      setDescription(product.description || '');
      setTags(product.tags || '');
      setSupplier1Name(product.supplier_1_name || '');
      setRefSupplier1(product.ref_supplier_1 || '');
      setSupplier2Name(product.supplier_2_name || '');
      setRefSupplier2(product.ref_supplier_2 || '');
      setStoreName(product.store_name || (depots[0]?.name || 'Dépôt Principal'));
      setRackLocation(product.rack_location || '');
      setRoomName(product.room_name || '');
      setShelfName(product.shelf_name || '');
      setQuantity(String(product.quantity ?? 0));
      setMinStockAlert(String(product.min_stock_alert ?? 2));
    } else {
      const code = (prefillCode || '').trim();
      setReference(code || '');
      setManufacturerRef('');
      setBarcode(code || '');
      setQrCode(code || '');
      setBrand('');
      setModel('');
      setSubCategoryId('');
      setUnitPrice('0.00');
      setDescription('');
      setTags('');
      setSupplier1Name('');
      setRefSupplier1('');
      setSupplier2Name('');
      setRefSupplier2('');
      setStoreName(depots[0]?.name || 'Dépôt Principal');
      setRackLocation('');
      setRoomName('');
      setShelfName('');
      setQuantity('10');
      setMinStockAlert('2');
    }
  }, [open, product, prefillCode, depots]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const cleanRef = reference.trim();
    const cleanBrand = brand.trim();
    const cleanModel = model.trim();

    if (!cleanRef || !cleanBrand || !cleanModel) {
      setErrorMsg(
        tr(
          language,
          'Veuillez renseigner la référence, la marque et le modèle.',
          'Please fill in reference, brand, and model.',
          'Vul referentie, merk en model in.'
        )
      );
      return;
    }

    const uniqueness = validateProductIdentifiersUniqueness(
      {
        id: product?.id,
        reference: cleanRef,
        manufacturer_ref: manufacturerRef.trim(),
        barcode: barcode.trim(),
        qr_code: qrCode.trim() || cleanRef,
      },
      products,
      {
        isNew: !product,
        editingId: product?.id || null,
        language,
      }
    );

    if (!uniqueness.valid) {
      setErrorMsg(uniqueness.error || 'Doublon détecté.');
      return;
    }

    setSaving(true);
    try {
      const ok = await saveProduct(
        {
          reference: cleanRef,
          manufacturer_ref: manufacturerRef.trim(),
          barcode: barcode.trim() || cleanRef,
          qr_code: qrCode.trim() || cleanRef,
          brand: cleanBrand,
          model: cleanModel,
          sub_category_id: subCategoryId ? Number(subCategoryId) : null,
          unit_price: canViewPrices ? Math.max(0, Number(unitPrice) || 0) : product?.unit_price || 0,
          description: description.trim(),
          tags: tags.trim(),
          supplier_1_name: supplier1Name.trim(),
          ref_supplier_1: refSupplier1.trim(),
          supplier_2_name: supplier2Name.trim(),
          ref_supplier_2: refSupplier2.trim(),
          store_name: storeName,
          rack_location: rackLocation.trim(),
          room_name: roomName.trim(),
          shelf_name: shelfName.trim(),
          quantity: Math.max(0, Number(quantity) || 0),
          min_stock_alert: Math.max(0, Number(minStockAlert) || 0),
        },
        { isNew: !isEdit, editingId: product?.id || null }
      );
      if (ok) {
        onSaved?.(cleanRef);
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={
        isEdit
          ? tr(language, 'Modifier le produit', 'Edit Product', 'Product bewerken')
          : tr(language, 'Nouveau produit', 'New Product', 'Nieuw product')
      }
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/60 backdrop-blur-xs"
    >
      <div className="w-full max-w-3xl bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-orange-50 dark:bg-orange-950/50 border border-orange-200 dark:border-orange-800/60 flex items-center justify-center text-orange-600 dark:text-orange-400">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {isEdit
                  ? tr(language, 'Modifier la référence', 'Edit Product', 'Product bewerken')
                  : tr(language, 'Nouvelle référence produit', 'New Product Reference', 'Nieuwe productreferentie')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {tr(
                  language,
                  `Catalogue : ${products.length} / ${maxReferences === Infinity ? '∞' : maxReferences} références`,
                  `Catalog: ${products.length} / ${maxReferences === Infinity ? '∞' : maxReferences} items`,
                  `Catalogus: ${products.length} / ${maxReferences === Infinity ? '∞' : maxReferences} artikelen`
                )}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {isQuotaReached ? (
          <div className="p-6 space-y-4 text-sm">
            <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-start gap-3 text-amber-800 dark:text-amber-200">
              <Lock className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">
                  {tr(
                    language,
                    `Limite du forfait atteinte (${maxReferences} références maximum)`,
                    `Plan limit reached (${maxReferences} items maximum)`,
                    `Pakketlimiet bereikt (maximaal ${maxReferences} artikelen)`
                  )}
                </div>
                <p className="text-xs mt-1">
                  {tr(
                    language,
                    'Passez à un forfait supérieur dans Paramètres → Licence pour ajouter de nouvelles références.',
                    'Upgrade your plan in Settings → License to add more references.',
                    'Upgrade uw pakket via Instellingen → Licentie om meer referenties toe te voegen.'
                  )}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
            {errorMsg && (
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Two-column layout on large screen */}
            <div className="grid grid-cols-2 gap-6">
              {/* Left Column: Identification & Classification */}
              <div className="space-y-3.5">
                <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-800 pb-1.5">
                  {tr(
                    language,
                    '01. Identification & Traçabilité',
                    '01. Identification & Traceability',
                    '01. Identificatie & Traceerbaarheid'
                  )}
                </h3>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {tr(language, 'Référence interne *', 'Internal Ref *', 'Interne ref. *')}
                    </label>
                    <input
                      type="text"
                      required
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder="Ex: BOS-18V-01"
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {tr(language, 'Réf. fabricant (OEM)', 'OEM Reference', 'Fabrikantref.')}
                    </label>
                    <input
                      type="text"
                      value={manufacturerRef}
                      onChange={(e) => setManufacturerRef(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {tr(language, 'Marque *', 'Brand *', 'Merk *')}
                    </label>
                    <input
                      type="text"
                      required
                      value={brand}
                      onChange={(e) => setBrand(e.target.value)}
                      placeholder="Ex: Bosch, Hilti..."
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {tr(language, 'Modèle / Désignation *', 'Model / Designation *', 'Model / Omschrijving *')}
                    </label>
                    <input
                      type="text"
                      required
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder="Ex: Perforateur SDS+"
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {tr(language, 'Code-barres 1D', '1D Barcode', '1D Streepjescode')}
                    </label>
                    <input
                      type="text"
                      value={barcode}
                      onChange={(e) => setBarcode(e.target.value)}
                      placeholder={tr(language, 'Auto = Référence', 'Auto = Reference', 'Auto = Referentie')}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {tr(language, 'Code QR', 'QR Code', 'QR-code')}
                    </label>
                    <input
                      type="text"
                      value={qrCode}
                      onChange={(e) => setQrCode(e.target.value)}
                      placeholder={tr(language, 'Auto = Référence', 'Auto = Reference', 'Auto = Referentie')}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {tr(language, 'Catégorie', 'Category', 'Categorie')}
                  </label>
                  <select
                    value={subCategoryId}
                    onChange={(e) => setSubCategoryId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="">
                      {tr(language, 'Aucune catégorie', 'Uncategorized', 'Geen categorie')}
                    </option>
                    {subCategories.map((sc) => (
                      <option key={sc.id} value={String(sc.id)}>
                        {sc.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {tr(language, 'Description & Mots-clés', 'Description & Tags', 'Beschrijving & Labels')}
                  </label>
                  <textarea
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              {/* Right Column: Stock, Location & Suppliers */}
              <div className="space-y-3.5">
                <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-800 pb-1.5">
                  {tr(
                    language,
                    '02. Stock, Emplacement & Fournisseurs',
                    '02. Stock, Location & Suppliers',
                    '02. Voorraad, Locatie & Leveranciers'
                  )}
                </h3>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {tr(language, 'Magasin / Dépôt', 'Store / Depot', 'Magazijn / Depot')}
                  </label>
                  <select
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    {depots.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {tr(language, 'Emplacement (Rack)', 'Rack Location', 'Reklocatie')}
                    </label>
                    <input
                      type="text"
                      value={rackLocation}
                      onChange={(e) => setRackLocation(e.target.value)}
                      placeholder="Ex: A2-04"
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {tr(language, 'Pièce / Zone', 'Room / Zone', 'Zone / Ruimte')}
                    </label>
                    <input
                      type="text"
                      value={roomName}
                      onChange={(e) => setRoomName(e.target.value)}
                      placeholder="Ex: Allée B"
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {tr(language, 'Étagère / Bac', 'Shelf / Bin', 'Plank / Bak')}
                    </label>
                    <input
                      type="text"
                      value={shelfName}
                      onChange={(e) => setShelfName(e.target.value)}
                      placeholder="Ex: Bac 12"
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {tr(language, 'Quantité en stock', 'Stock Quantity', 'Voorraadaantal')}
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {tr(language, 'Seuil alerte', 'Alert threshold', 'Min. drempel')}
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={minStockAlert}
                      onChange={(e) => setMinStockAlert(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono tabular-nums"
                    />
                  </div>
                  {canViewPrices && (
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {tr(language, 'Prix HT', 'Unit Price', 'Eenheidsprijs')}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        value={unitPrice}
                        onChange={(e) => setUnitPrice(e.target.value)}
                        className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono tabular-nums"
                      />
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {tr(language, 'Fournisseur principal', 'Primary Supplier', 'Hoofdleverancier')}
                    </label>
                    <input
                      type="text"
                      value={supplier1Name}
                      onChange={(e) => setSupplier1Name(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {tr(language, 'Réf. fournisseur', 'Supplier Ref', 'Leveranciersref.')}
                    </label>
                    <input
                      type="text"
                      value={refSupplier1}
                      onChange={(e) => setRefSupplier1(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                {tr(language, 'Annuler', 'Cancel', 'Annuleren')}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-semibold flex items-center gap-2 transition cursor-pointer disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>
                  {isEdit
                    ? tr(language, 'Enregistrer les modifications', 'Save changes', 'Wijzigingen opslaan')
                    : tr(language, 'Créer la référence', 'Create product', 'Product aanmaken')}
                </span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
