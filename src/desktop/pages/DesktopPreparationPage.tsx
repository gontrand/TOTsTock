import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Barcode,
  Check,
  CheckCircle2,
  MapPin,
  Printer,
  RefreshCw,
  Search,
  Undo2,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { MaterialOrder, MaterialOrderItem, Product } from '../../types';
import {
  canFinishOrder,
  filterOrdersForPreparer,
  findCatalogProductByCode,
  getNextItemToPick,
  getOrderProgress,
  getSortedOrderItemsForPicking,
  isOrderLockedForUser,
  matchScannedCodeInOrder,
  triggerScannerFeedback,
} from '../../services/orderPickingLogic';
import {
  createInitialBarcodeBurstState,
  isEditableEventTarget,
  processKeyForBarcodeBurst,
} from '../../services/desktopInventoryLogic';
import {
  buildFullPrintableDocumentHtml,
  generateProductVisualsMap,
  renderOrderReadyLabelSheetHtml,
  renderProductLabelsSheetHtml,
} from '../../services/labelRendering';
import { generateQrCodeDataUrlWithTotLogo } from '../../utils/qrCodeHelper';
import { dispatchStationPrintDocument } from '../../services/printStationService';
import { tr } from '../../i18n/dutchTranslator';

export interface DesktopPreparationPageProps {
  selectedDepotFilter?: string;
  initialOrderId?: string | null;
  globalDepotFilter?: string;
}

export const DesktopPreparationPage: React.FC<DesktopPreparationPageProps> = ({
  selectedDepotFilter,
  initialOrderId,
  globalDepotFilter = 'ALL',
}) => {
  const {
    orders,
    products,
    depots,
    currentUser,
    userHasPermission,
    assignOrderToMe,
    validateOrderItemScanned,
    unpickOrderItem,
    updateOrderItemAvailability,
    substituteOrderItem,
    markOrderReady,
    language,
    t,
  } = useApp();

  const effectiveDepotFilter = selectedDepotFilter ?? globalDepotFilter ?? 'ALL';
  const hasManagePerm = userHasPermission('perm_orders_manage');
  const canPrintLabels = userHasPermission('perm_menu_print_labels');

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(
    initialOrderId || null
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [manualScanCode, setManualScanCode] = useState('');
  const [activeProductId, setActiveProductId] = useState<string | number | null>(null);
  const [qtyInput, setQtyInput] = useState<number>(1);
  const [pickupLocation, setPickupLocation] = useState('Étagère A1');
  const [autoPrintOrderSlip, setAutoPrintOrderSlip] = useState(true);
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'success' | 'warn' | 'error';
    text: string;
  } | null>(null);

  // Missing / Substitute modals
  const [missingModalItem, setMissingModalItem] = useState<MaterialOrderItem | null>(
    null
  );
  const [missingReason, setMissingReason] = useState('Rupture de stock en rayon');
  const [substituteModalItem, setSubstituteModalItem] =
    useState<MaterialOrderItem | null>(null);
  const [substituteSearch, setSubstituteSearch] = useState('');
  const [lastPickedProductId, setLastPickedProductId] = useState<
    string | number | null
  >(null);

  const burstStateRef = useRef(createInitialBarcodeBurstState());
  const qtyInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (initialOrderId) {
      setSelectedOrderId(initialOrderId);
    }
  }, [initialOrderId]);

  const preparableOrders = useMemo(() => {
    return filterOrdersForPreparer(orders, currentUser, {
      depotFilter: effectiveDepotFilter,
      searchQuery,
    });
  }, [orders, currentUser, effectiveDepotFilter, searchQuery]);

  const activeOrder: MaterialOrder | null = useMemo(() => {
    if (selectedOrderId) {
      const found = preparableOrders.find((o) => o.id === selectedOrderId);
      if (found) return found;
    }
    return preparableOrders[0] || null;
  }, [preparableOrders, selectedOrderId]);

  const sortedItems = useMemo(() => {
    if (!activeOrder) return [];
    return getSortedOrderItemsForPicking(activeOrder, { products });
  }, [activeOrder, products]);

  const currentItem: MaterialOrderItem | null = useMemo(() => {
    if (!activeOrder) return null;
    if (activeProductId != null) {
      const found = activeOrder.items.find(
        (it) => String(it.product_id) === String(activeProductId)
      );
      if (found) return found;
    }
    return getNextItemToPick(activeOrder, { products });
  }, [activeOrder, activeProductId, products]);

  useEffect(() => {
    if (currentItem) {
      const remaining = Math.max(
        1,
        currentItem.quantity - (currentItem.picked_quantity || 0)
      );
      setQtyInput(remaining);
    }
  }, [currentItem?.product_id, currentItem?.quantity, currentItem?.picked_quantity]);

  const ensureOrderAssigned = useCallback(
    async (order: MaterialOrder) => {
      if (order.status === 'PENDING' && !order.preparer_id) {
        await assignOrderToMe(order.id);
      }
    },
    [assignOrderToMe]
  );

  const handleValidateLine = useCallback(
    async (item: MaterialOrderItem, codeUsed: string, quantityToPick: number) => {
      if (!activeOrder) return;
      await ensureOrderAssigned(activeOrder);
      const res = validateOrderItemScanned(
        activeOrder.id,
        item.product_id,
        quantityToPick,
        codeUsed || item.product_ref
      );
      if (res.success) {
        triggerScannerFeedback('success');
        setLastPickedProductId(item.product_id);
        setFeedbackBanner({
          type: 'success',
          text: tr(
            language,
            `Ligne pointée : ${item.product_ref} (×${quantityToPick})`,
            `Line picked: ${item.product_ref} (×${quantityToPick})`,
            `Regel verzameld: ${item.product_ref} (×${quantityToPick})`
          ),
        });
        setActiveProductId(null);
      } else {
        triggerScannerFeedback('error');
        setFeedbackBanner({
          type: 'error',
          text: tr(
            language,
            `Échec de validation pour ${item.product_ref}`,
            `Validation failed for ${item.product_ref}`,
            `Validatie mislukt voor ${item.product_ref}`
          ),
        });
      }
    },
    [activeOrder, ensureOrderAssigned, validateOrderItemScanned, language]
  );

  const handleScannedCode = useCallback(
    async (rawCode: string) => {
      if (!activeOrder) return;
      const clean = rawCode.trim();
      if (!clean) return;

      const match = matchScannedCodeInOrder(
        activeOrder,
        clean,
        products,
        currentItem
      );

      if (match.kind === 'expected_item' && match.matchedItem) {
        await handleValidateLine(
          match.matchedItem,
          clean,
          match.matchedItem.quantity
        );
        return;
      }

      if (match.kind === 'other_order_item' && match.matchedItem) {
        triggerScannerFeedback('error');
        setActiveProductId(match.matchedItem.product_id);
        setFeedbackBanner({
          type: 'warn',
          text: tr(
            language,
            `Article d'une autre ligne détecté (${match.matchedItem.product_ref}) — ligne sélectionnée.`,
            `Item from another line detected (${match.matchedItem.product_ref}) — line selected.`,
            `Artikel van een andere regel gedetecteerd (${match.matchedItem.product_ref}) — regel geselecteerd.`
          ),
        });
        return;
      }

      if (match.kind === 'already_picked_item' && match.matchedItem) {
        triggerScannerFeedback('error');
        setFeedbackBanner({
          type: 'warn',
          text: tr(
            language,
            `La ligne ${match.matchedItem.product_ref} est déjà pointée.`,
            `Line ${match.matchedItem.product_ref} is already picked.`,
            `Regel ${match.matchedItem.product_ref} is al verzameld.`
          ),
        });
        return;
      }

      if (match.kind === 'catalog_substitute_candidate' && match.catalogProduct) {
        triggerScannerFeedback('error');
        setFeedbackBanner({
          type: 'error',
          text: tr(
            language,
            `Article hors commande (${match.catalogProduct.reference} — ${match.catalogProduct.brand} ${match.catalogProduct.model}).`,
            `Product not in order (${match.catalogProduct.reference} — ${match.catalogProduct.brand} ${match.catalogProduct.model}).`,
            `Artikel niet in bestelling (${match.catalogProduct.reference} — ${match.catalogProduct.brand} ${match.catalogProduct.model}).`
          ),
        });
        return;
      }

      triggerScannerFeedback('error');
      setFeedbackBanner({
        type: 'error',
        text: tr(
          language,
          `Code-barres inconnu : ${clean}`,
          `Unknown barcode: ${clean}`,
          `Onbekende streepjescode: ${clean}`
        ),
      });
    },
    [activeOrder, currentItem, products, handleValidateLine, language]
  );

  const handleMarkOrderReady = useCallback(async () => {
    if (!activeOrder || !canFinishOrder(activeOrder)) return;
    const res = await markOrderReady(activeOrder.id, pickupLocation);
    if (res.success) {
      triggerScannerFeedback('success');
      setFeedbackBanner({
        type: 'success',
        text: tr(
          language,
          `Commande ${activeOrder.order_number} prête au retrait (${pickupLocation}) !`,
          `Order ${activeOrder.order_number} ready for pickup (${pickupLocation})!`,
          `Bestelling ${activeOrder.order_number} klaar voor afhaling (${pickupLocation})!`
        ),
      });
      if (autoPrintOrderSlip && canPrintLabels) {
        let qrDataUrl = '';
        try {
          qrDataUrl = await generateQrCodeDataUrlWithTotLogo(
            `TOT-ORDER:${activeOrder.order_number}`,
            { size: 180, margin: 1 }
          );
        } catch {
          qrDataUrl = '';
        }
        const slipHtml = renderOrderReadyLabelSheetHtml(
          {
            order_number: activeOrder.order_number,
            site_number: activeOrder.site_number,
            site_name: activeOrder.site_name,
            requester_name: activeOrder.requester_name,
            pickup_zone: pickupLocation,
            depot_name: activeOrder.depot_name,
            items_count: activeOrder.items.length,
            qrDataUrl,
          },
          'avery_105x42',
          1
        );
        const fullDoc = buildFullPrintableDocumentHtml(
          slipHtml,
          'avery_105x42',
          `${tr(language, 'Bon Commande', 'Order Slip', 'Bestelbon')} ${activeOrder.order_number}`
        );
        await dispatchStationPrintDocument({
          html: fullDoc,
          format: 'avery_105x42',
          copies: 1,
        });
      }
    }
  }, [activeOrder, markOrderReady, pickupLocation, language, autoPrintOrderSlip, canPrintLabels]);

  // Global USB Barcode Scanner listener + Function keys F2, F4, F8
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2' && currentItem) {
        e.preventDefault();
        qtyInputRef.current?.focus();
        qtyInputRef.current?.select();
        return;
      }
      if (e.key === 'F4' && currentItem) {
        e.preventDefault();
        setMissingModalItem(currentItem);
        return;
      }
      if (e.key === 'F8' && activeOrder && canFinishOrder(activeOrder)) {
        e.preventDefault();
        handleMarkOrderReady();
        return;
      }

      const res = processKeyForBarcodeBurst(
        burstStateRef.current,
        e.key,
        e.timeStamp || performance.now(),
        {
          isEditableTarget: isEditableEventTarget(e.target),
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
        }
      );
      burstStateRef.current = res.state;
      if (res.committedCode) {
        handleScannedCode(res.committedCode);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentItem, activeOrder, handleScannedCode, handleMarkOrderReady]);

  const handleUndoLastPick = () => {
    if (!activeOrder || lastPickedProductId == null) return;
    unpickOrderItem(activeOrder.id, lastPickedProductId);
    setFeedbackBanner({
      type: 'warn',
      text: tr(language, 'Dernier pointage annulé.', 'Last pick undone.', 'Laatste pick ongedaan gemaakt.'),
    });
    setLastPickedProductId(null);
  };

  const handleConfirmMissing = async () => {
    if (!activeOrder || !missingModalItem) return;
    await ensureOrderAssigned(activeOrder);
    updateOrderItemAvailability(
      activeOrder.id,
      missingModalItem.product_id,
      true,
      missingReason
    );
    setMissingModalItem(null);
    setFeedbackBanner({
      type: 'warn',
      text: tr(
        language,
        `Ligne ${missingModalItem.product_ref} marquée manquante.`,
        `Line ${missingModalItem.product_ref} marked missing.`,
        `Regel ${missingModalItem.product_ref} gemarkeerd als ontbrekend.`
      ),
    });
  };

  const handleConfirmSubstitute = async (newProd: Product) => {
    if (!activeOrder || !substituteModalItem) return;
    await ensureOrderAssigned(activeOrder);
    await substituteOrderItem(
      activeOrder.id,
      substituteModalItem.product_id,
      newProd,
      tr(language, 'Équivalent magasin', 'Warehouse equivalent', 'Magazijn-equivalent')
    );
    setSubstituteModalItem(null);
    setFeedbackBanner({
      type: 'success',
      text: tr(
        language,
        `Article remplacé par ${newProd.reference}.`,
        `Item replaced by ${newProd.reference}.`,
        `Artikel vervangen door ${newProd.reference}.`
      ),
    });
  };

  const handlePrintProductLabel = async (item: MaterialOrderItem) => {
    const prod =
      products.find((p) => String(p.id) === String(item.product_id)) ||
      findCatalogProductByCode(item.product_ref, products);
    if (!prod) return;
    const visuals = await generateProductVisualsMap([prod], {
      showQr: true,
      showBarcode: true,
    });
    const sheetHtml = renderProductLabelsSheetHtml([prod], {
      format: 'thermal_50x30',
      showQr: true,
      showBarcode: true,
      showLocation: true,
      showOem: true,
      showPrice: false,
      canViewPrices: false,
      imagesCache: visuals,
    });
    const fullDoc = buildFullPrintableDocumentHtml(
      sheetHtml,
      'thermal_50x30',
      `${tr(language, 'Étiquette', 'Label', 'Etiket')} ${prod.reference}`
    );
    await dispatchStationPrintDocument({
      html: fullDoc,
      format: 'thermal_50x30',
      copies: 1,
    });
  };

  const orderProgress = useMemo(
    () => (activeOrder ? getOrderProgress(activeOrder) : null),
    [activeOrder]
  );

  const pickupZoneOptions = useMemo(() => {
    const d = depots.find((dp) => dp.name === activeOrder?.depot_name);
    if (d?.pickup_zones && d.pickup_zones.length > 0) return d.pickup_zones;
    return [
      tr(language, 'Étagère A1', 'Shelf A1', 'Stelling A1'),
      tr(language, 'Casier Retrait B', 'Pickup Bin B', 'Afhaalvak B'),
      tr(language, 'Palette Zone Retrait', 'Pickup Zone Pallet', 'Pallet Afhaalzone'),
      tr(language, 'Comptoir Magasin', 'Warehouse Counter', 'Magazijnbalie'),
    ];
  }, [depots, activeOrder?.depot_name, language]);

  return (
    <div className="grid grid-cols-12 h-full min-h-0 bg-slate-50 dark:bg-slate-950 divide-x divide-slate-200 dark:divide-slate-800">
      {/* ZONE A: Left Queue of Orders to Prepare (3 cols) */}
      <div className="col-span-3 flex flex-col h-full min-h-0 bg-white dark:bg-slate-900">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between">
            <h1 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
              {t('desktop_nav_preparation')}
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-orange-100 text-orange-800 dark:bg-orange-950/70 dark:text-orange-300">
              {preparableOrders.length}
            </span>
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={tr(
                language,
                'Filtrer commande ou chantier...',
                'Filter order or job site...',
                'Filter bestelling of werf...'
              )}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-200/70 dark:divide-slate-800">
          {preparableOrders.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">
              {tr(
                language,
                'Aucune commande en attente de préparation.',
                'No orders waiting for preparation.',
                'Geen bestellingen in afwachting van voorbereiding.'
              )}
            </div>
          ) : (
            preparableOrders.map((o) => {
              const prog = getOrderProgress(o);
              const locked = isOrderLockedForUser(o, currentUser, hasManagePerm);
              const isSelected = activeOrder?.id === o.id;

              return (
                <button
                  key={o.id}
                  type="button"
                  disabled={locked}
                  onClick={() => setSelectedOrderId(o.id)}
                  className={`w-full text-left p-3.5 transition-colors flex flex-col gap-1.5 ${
                    isSelected
                      ? 'bg-orange-50 dark:bg-orange-950/40 border-l-4 border-l-orange-600'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  } ${locked ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-black text-slate-900 dark:text-white">
                      {o.order_number}
                    </span>
                    <span className="font-mono text-[11px] font-bold text-orange-600">
                      {prog.processedLines}/{prog.totalLines}
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate">
                    {o.site_number || '—'} • {o.requester_name}
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-orange-600 transition-all"
                      style={{
                        width: `${prog.percent}%`,
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>{o.depot_name || tr(language, 'Dépôt Principal', 'Main Depot', 'Hoofddepot')}</span>
                    <span>
                      {o.preparer_name
                        ? `👷 ${o.preparer_name}`
                        : o.status === 'PREPARING'
                        ? tr(language, 'En cours par moi', 'In progress by me', 'Bezig door mij')
                        : tr(language, 'À préparer', 'To prepare', 'Te verzamelen')}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ZONE B: Center Lines Table Sorted by Rack Location (5 cols) */}
      <div className="col-span-5 flex flex-col h-full min-h-0 bg-white dark:bg-slate-900">
        {!activeOrder ? (
          <div className="flex-1 flex items-center justify-center text-xs text-slate-400 p-6">
            {tr(
              language,
              'Sélectionnez une commande à préparer dans la colonne de gauche.',
              'Select an order to prepare from the left column.',
              'Selecteer een te verzamelen bestelling in de linkerkolom.'
            )}
          </div>
        ) : (
          <>
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-black text-slate-900 dark:text-white">
                    {activeOrder.order_number}
                  </span>
                  <span className="text-xs font-semibold text-slate-500">
                    • {activeOrder.site_number || '—'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  {tr(
                    language,
                    'Lignes triées par emplacement (Rack / Casier) pour optimiser le parcours',
                    'Lines sorted by location (Rack / Bin) to optimize picking route',
                    'Regels gesorteerd op locatie (Rek / Vak) voor optimale looproute'
                  )}
                </p>
              </div>
              {lastPickedProductId != null && (
                <button
                  type="button"
                  onClick={handleUndoLastPick}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Undo2 className="w-3.5 h-3.5 text-orange-500" />
                  {tr(language, 'Annuler dernier pointage', 'Undo last pick', 'Laatste pick ongedaan maken')}
                </button>
              )}
            </div>

            {feedbackBanner && (
              <div
                className={`mx-4 mt-3 px-3 py-2 rounded-lg text-xs font-bold flex items-center justify-between ${
                  feedbackBanner.type === 'success'
                    ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200'
                    : feedbackBanner.type === 'warn'
                    ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200'
                    : 'bg-rose-50 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200'
                }`}
              >
                <span>{feedbackBanner.text}</span>
                <button
                  type="button"
                  onClick={() => setFeedbackBanner(null)}
                  className="text-[10px] underline ml-2"
                >
                  OK
                </button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-100 dark:bg-slate-800 text-[10px] font-bold uppercase text-slate-500">
                  <tr>
                    <th className="py-2 px-2.5">{tr(language, 'Casier', 'Bin', 'Vak')}</th>
                    <th className="py-2 px-2.5">{tr(language, 'Article', 'Item', 'Artikel')}</th>
                    <th className="py-2 px-2 text-right">{tr(language, 'Qté', 'Qty', 'Aant')}</th>
                    <th className="py-2 px-2.5">{tr(language, 'État', 'State', 'Status')}</th>
                    {canPrintLabels && (
                      <th className="py-2 px-2 text-right">{tr(language, 'Étiquette', 'Label', 'Etiket')}</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                  {sortedItems.map((it) => {
                    const isCurrent =
                      String(currentItem?.product_id) === String(it.product_id);
                    const pickedQty = it.picked_quantity ?? (it.picked ? it.quantity : 0);
                    const isMissing = Boolean(it.unavailable);
                    const isPartial = !isMissing && it.picked && pickedQty > 0 && pickedQty < it.quantity;

                    return (
                      <tr
                        key={String(it.product_id)}
                        onClick={() => setActiveProductId(it.product_id)}
                        className={`cursor-pointer transition-colors ${
                          isCurrent
                            ? 'bg-orange-50/90 dark:bg-orange-950/40 font-semibold'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="py-2.5 px-2.5 font-mono font-bold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                          {it.rack_location || '—'}
                        </td>
                        <td className="py-2.5 px-2.5">
                          <div className="font-mono text-[11px] font-bold text-orange-600">
                            {it.product_ref}
                          </div>
                          <div className="text-slate-900 dark:text-white truncate max-w-[200px]">
                            {it.product_name}
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono font-black">
                          {pickedQty}/{it.quantity}
                        </td>
                        <td className="py-2.5 px-2.5 whitespace-nowrap">
                          {isMissing ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700">
                              {tr(language, 'Manquant', 'Missing', 'Ontbrekend')}
                            </span>
                          ) : isPartial ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                              {tr(language, 'Partiel', 'Partial', 'Gedeeltelijk')}
                            </span>
                          ) : it.picked ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">
                              {tr(language, 'Pointé', 'Picked', 'Verzameld')}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-100 text-sky-800">
                              {tr(language, 'À prendre', 'To pick', 'Te pakken')}
                            </span>
                          )}
                        </td>
                        {canPrintLabels && (
                          <td
                            className="py-2.5 px-2 text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => handlePrintProductLabel(it)}
                              title={tr(
                                language,
                                'Imprimer étiquette article',
                                'Print item label',
                                'Artikeletiket afdrukken'
                              )}
                              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-orange-600"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ZONE C: Right Active Scan & Validation Console (4 cols) */}
      <div className="col-span-4 flex flex-col h-full min-h-0 bg-slate-50/70 dark:bg-slate-900/50 p-5 gap-4 overflow-y-auto">
        {/* USB Barcode Input Box */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-black text-emerald-600 dark:text-emerald-400">
              <Barcode className="w-4 h-4" />
              {tr(language, 'Douchette USB HID active', 'USB HID Scanner active', 'USB HID-scanner actief')}
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              {tr(language, 'F2 Qté • F4 Manquant • F8 Prête', 'F2 Qty • F4 Missing • F8 Ready', 'F2 Aant • F4 Ontbr. • F8 Klaar')}
            </span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (manualScanCode.trim()) {
                handleScannedCode(manualScanCode);
                setManualScanCode('');
              }
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={manualScanCode}
              onChange={(e) => setManualScanCode(e.target.value)}
              placeholder={tr(
                language,
                'Scanner ou saisir réf / code-barres + Entrée...',
                'Scan or enter ref / barcode + Enter...',
                'Scan of voer ref / streepjescode in + Enter...'
              )}
              className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            />
            <button
              type="submit"
              className="px-3.5 py-2 rounded-lg text-xs font-bold bg-slate-900 dark:bg-slate-700 text-white"
            >
              OK
            </button>
          </form>
        </div>

        {/* Active Line Card */}
        {currentItem ? (
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border-2 border-orange-500/80 shadow-sm space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-orange-600">
                  {tr(language, 'Prochain article à prélever', 'Next item to pick', 'Volgend te verzamelen artikel')}
                </span>
                <h2 className="text-base font-black text-slate-900 dark:text-white mt-0.5">
                  {currentItem.product_name}
                </h2>
                <div className="font-mono text-xs font-bold text-slate-500 mt-0.5">
                  {tr(language, 'Réf :', 'Ref:', 'Ref:')} {currentItem.product_ref}
                </div>
              </div>
              <div className="px-3 py-1.5 rounded-xl bg-orange-50 dark:bg-orange-950/60 border border-orange-200 dark:border-orange-900 text-right">
                <div className="text-[10px] font-bold uppercase text-orange-600 flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> {tr(language, 'Casier', 'Bin', 'Vak')}
                </div>
                <div className="font-mono text-sm font-black text-slate-900 dark:text-white">
                  {currentItem.rack_location || tr(language, 'Non défini', 'Not set', 'Niet ingesteld')}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70">
              <div>
                <span className="text-[11px] text-slate-500 block">
                  {tr(language, 'Quantité à prélever', 'Quantity to pick', 'Te verzamelen aantal')}
                </span>
                <input
                  ref={qtyInputRef}
                  type="number"
                  min={1}
                  max={currentItem.quantity}
                  value={qtyInput}
                  onChange={(e) =>
                    setQtyInput(Math.max(1, Number(e.target.value) || 1))
                  }
                  className="mt-1 w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-base font-black"
                />
              </div>
              <div className="flex flex-col justify-end">
                <button
                  type="button"
                  onClick={() =>
                    handleValidateLine(currentItem, currentItem.product_ref, qtyInput)
                  }
                  className="w-full py-2.5 px-3 rounded-xl font-black text-xs bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center gap-1.5 shadow-xs"
                >
                  <Check className="w-4 h-4" />
                  {tr(language, 'Pointer conforme', 'Confirm pick', 'Pick bevestigen')} (×{qtyInput})
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  qtyInputRef.current?.focus();
                  qtyInputRef.current?.select();
                }}
                className="py-2 px-3 rounded-lg font-bold border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
              >
                {tr(language, 'Quantité (F2)', 'Quantity (F2)', 'Aantal (F2)')}
              </button>
              <button
                type="button"
                onClick={() => setMissingModalItem(currentItem)}
                className="py-2 px-3 rounded-lg font-bold border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50"
              >
                {tr(language, 'Manquant (F4)', 'Missing (F4)', 'Ontbrekend (F4)')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSubstituteModalItem(currentItem);
                  setSubstituteSearch('');
                }}
                className="col-span-2 py-2 px-3 rounded-lg font-bold border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5 text-orange-500" />
                {tr(
                  language,
                  'Remplacer par un autre article du catalogue',
                  'Replace with another catalog item',
                  'Vervangen door een ander catalogusartikel'
                )}
              </button>
            </div>
          </div>
        ) : activeOrder ? (
          <div className="p-5 rounded-2xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-center space-y-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
            <div className="text-sm font-black text-emerald-900 dark:text-emerald-200">
              {tr(
                language,
                'Toutes les lignes ont été traitées !',
                'All lines have been processed!',
                'Alle regels zijn verwerkt!'
              )}
            </div>
            <p className="text-xs text-emerald-700 dark:text-emerald-300">
              {tr(
                language,
                "Choisissez l'emplacement de retrait ci-dessous puis validez la commande (F8).",
                'Select the pickup location below and confirm the order (F8).',
                'Kies hieronder de afhaallocatie en bevestig de bestelling (F8).'
              )}
            </p>
          </div>
        ) : null}

        {/* Finish Order Card */}
        {activeOrder && orderProgress && (
          <div className="mt-auto p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-700 dark:text-slate-300">
                {tr(language, 'Validation Commande Prête', 'Order Ready Confirmation', 'Bevestiging Bestelling Klaar')}
              </span>
              <span className="font-mono text-[11px] text-slate-500">
                {orderProgress.pickedLines} {tr(language, 'pointé(s)', 'picked', 'verzameld')} •{' '}
                {orderProgress.unavailableLines} {tr(language, 'manquant(s)', 'missing', 'ontbrekend')}
              </span>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">
                {tr(language, 'Emplacement de retrait', 'Pickup location', 'Afhaallocatie')}
              </label>
              <input
                type="text"
                list="desktop-prep-zones"
                value={pickupLocation}
                onChange={(e) => setPickupLocation(e.target.value)}
                className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
              <datalist id="desktop-prep-zones">
                {pickupZoneOptions.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
            </div>

            {canPrintLabels && (
              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoPrintOrderSlip}
                  onChange={(e) => setAutoPrintOrderSlip(e.target.checked)}
                  className="rounded text-orange-600"
                />
                {tr(
                  language,
                  "Imprimer l'étiquette de commande (QR retrait)",
                  'Print order label (pickup QR)',
                  'Bestelbon-etiket afdrukken (afhaal-QR)'
                )}
              </label>
            )}

            <button
              type="button"
              disabled={!canFinishOrder(activeOrder)}
              onClick={handleMarkOrderReady}
              className="w-full py-2.5 px-4 rounded-xl font-black text-xs bg-orange-600 hover:bg-orange-700 disabled:opacity-40 text-white shadow-xs transition-colors"
            >
              {tr(language, 'Commande prête au retrait (F8)', 'Order ready for pickup (F8)', 'Bestelling klaar voor afhaling (F8)')}
            </button>
          </div>
        )}
      </div>

      {/* Missing Reason Modal */}
      {missingModalItem && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 space-y-4 text-xs">
            <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-500" />
              {tr(language, 'Déclarer manquant :', 'Declare missing:', 'Markeer als ontbrekend:')}{' '}
              {missingModalItem.product_ref}
            </h3>
            <select
              value={missingReason}
              onChange={(e) => setMissingReason(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold"
            >
              <option value="Rupture de stock en rayon">
                {tr(language, 'Rupture de stock en rayon', 'Out of stock on shelf', 'Niet op voorraad in schap')}
              </option>
              <option value="Article introuvable à l'emplacement">
                {tr(language, "Article introuvable à l'emplacement", 'Item not found at location', 'Artikel niet gevonden op locatie')}
              </option>
              <option value="Article endommagé / non conforme">
                {tr(language, 'Article endommagé / non conforme', 'Damaged / non-compliant item', 'Artikel beschadigd / niet-conform')}
              </option>
            </select>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMissingModalItem(null)}
                className="px-3 py-1.5 rounded-lg font-bold border border-slate-200 dark:border-slate-700"
              >
                {t('common_cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmMissing}
                className="px-4 py-1.5 rounded-lg font-bold bg-rose-600 text-white"
              >
                {tr(language, 'Confirmer manquant', 'Confirm missing', 'Ontbrekend bevestigen')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Substitute Item Modal */}
      {substituteModalItem && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 space-y-4 text-xs">
            <h3 className="text-sm font-black text-slate-900 dark:text-white">
              {tr(language, 'Remplacer', 'Replace', 'Vervang')} {substituteModalItem.product_ref} —{' '}
              {substituteModalItem.product_name}
            </h3>
            <input
              type="text"
              value={substituteSearch}
              onChange={(e) => setSubstituteSearch(e.target.value)}
              placeholder={tr(
                language,
                'Rechercher un article de remplacement...',
                'Search a replacement item...',
                'Zoek een vervangend artikel...'
              )}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            />
            <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {products
                .filter((p) => {
                  const q = substituteSearch.toLowerCase().trim();
                  if (!q) return true;
                  return `${p.reference} ${p.brand} ${p.model}`
                    .toLowerCase()
                    .includes(q);
                })
                .slice(0, 25)
                .map((p) => (
                  <div
                    key={p.id}
                    className="py-2 flex items-center justify-between gap-2"
                  >
                    <div>
                      <span className="font-mono font-bold text-orange-600 mr-2">
                        {p.reference}
                      </span>
                      <span className="font-semibold">
                        {p.brand} {p.model}
                      </span>
                      <span className="ml-2 text-slate-400 font-mono">
                        (Stock: {p.quantity})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleConfirmSubstitute(p)}
                      className="px-3 py-1 rounded-lg bg-orange-600 text-white font-bold"
                    >
                      {tr(language, 'Choisir', 'Select', 'Kiezen')}
                    </button>
                  </div>
                ))}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setSubstituteModalItem(null)}
                className="px-3 py-1.5 rounded-lg font-bold border border-slate-200 dark:border-slate-700"
              >
                {tr(language, 'Fermer', 'Close', 'Sluiten')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
