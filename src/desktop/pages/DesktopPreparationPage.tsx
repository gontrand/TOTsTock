import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  MapPin,
  Printer,
  RefreshCw,
  RotateCcw,
  ScanBarcode,
  Search,
  UserCheck,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { MaterialOrder, MaterialOrderItem, Product } from '../../types';
import {
  canFinishOrder,
  filterOrdersForPreparer,
  getItemRackLocation,
  getNextItemToPick,
  getOrderProgress,
  getSortedOrderItemsForPicking,
  isOrderLockedForUser,
  isScannerSoundEnabled,
  matchScannedCodeInOrder,
  setScannerSoundEnabled,
  triggerScannerFeedback,
} from '../../services/orderPickingLogic';
import {
  createInitialBarcodeBurstState,
  isEditableEventTarget,
  processKeyForBarcodeBurst,
} from '../../services/desktopInventoryLogic';
import { getPickingLineVisualStatus } from '../../services/desktopOrdersMovementsLogic';
import {
  getSavedPrintStationId,
  getScannerSelectedLabelFormat,
  getScannerSelectedStationId,
  rpcCreatePrintJob,
  rpcListPrintStations,
  PrintStationRecord,
} from '../../services/printStationService';

interface DesktopPreparationPageProps {
  selectedDepotFilter: string;
  initialOrderId?: string | null;
}

export const DesktopPreparationPage: React.FC<DesktopPreparationPageProps> = ({
  selectedDepotFilter,
  initialOrderId,
}) => {
  const {
    orders,
    products,
    depots,
    currentUser,
    userHasPermission,
    assignOrderToMe,
    updateMaterialOrder,
    markOrderReady,
    t,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(initialOrderId || null);
  const [selectedLineProductId, setSelectedLineProductId] = useState<string | number | null>(null);
  const [manualScanCode, setManualScanCode] = useState('');
  const [pickupZoneInput, setPickupZoneInput] = useState('Zone Retrait A');
  const [printReadyLabelOnFinish, setPrintReadyLabelOnFinish] = useState(true);
  const [stations, setStations] = useState<PrintStationRecord[]>([]);
  const [selectedStationId, setSelectedStationId] = useState<string>(
    getScannerSelectedStationId() || getSavedPrintStationId() || ''
  );
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => isScannerSoundEnabled());
  const [scanBanner, setScanBanner] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<MaterialOrderItem[] | null>(null);
  const [showReplaceSelector, setShowReplaceSelector] = useState(false);
  const [replaceSearch, setReplaceSearch] = useState('');
  const [customQtyPrompt, setCustomQtyPrompt] = useState<number | null>(null);

  const burstStateRef = useRef(createInitialBarcodeBurstState());
  const hasManagePerm = userHasPermission('perm_orders_manage');

  useEffect(() => {
    if (initialOrderId) {
      setSelectedOrderId(initialOrderId);
    }
  }, [initialOrderId]);

  useEffect(() => {
    rpcListPrintStations().then((res) => {
      if (res.stations.length > 0) {
        setStations(res.stations);
        if (!selectedStationId) {
          const online = res.stations.find((s) => s.is_online) || res.stations[0];
          if (online) setSelectedStationId(online.id);
        }
      }
    });
  }, [selectedStationId]);

  const preparerOrders = useMemo(() => {
    return filterOrdersForPreparer(orders, currentUser, {
      depotFilter: selectedDepotFilter,
      searchQuery,
    });
  }, [orders, currentUser, selectedDepotFilter, searchQuery]);

  const activeOrder: MaterialOrder | null = useMemo(() => {
    if (selectedOrderId) {
      const found = preparerOrders.find((o) => o.id === selectedOrderId);
      if (found) return found;
    }
    return preparerOrders[0] || null;
  }, [preparerOrders, selectedOrderId]);

  const sortedItems = useMemo(() => {
    if (!activeOrder) return [];
    return getSortedOrderItemsForPicking(activeOrder, {
      strategy: 'rack_location',
      products,
    });
  }, [activeOrder, products]);

  const expectedItem: MaterialOrderItem | null = useMemo(() => {
    if (!activeOrder) return null;
    if (selectedLineProductId !== null) {
      const explicit = activeOrder.items.find(
        (it) => String(it.product_id) === String(selectedLineProductId)
      );
      if (explicit) return explicit;
    }
    return getNextItemToPick(activeOrder, { strategy: 'rack_location', products });
  }, [activeOrder, selectedLineProductId, products]);

  const progress = useMemo(() => getOrderProgress(activeOrder), [activeOrder]);
  const isLockedByOther = useMemo(
    () => isOrderLockedForUser(activeOrder, currentUser, hasManagePerm),
    [activeOrder, currentUser, hasManagePerm]
  );

  const ensureOrderAssignedToMe = useCallback(
    async (order: MaterialOrder) => {
      if (!currentUser) return;
      if (!order.preparer_id || order.status === 'PENDING') {
        await assignOrderToMe(order.id);
      }
    },
    [currentUser, assignOrderToMe]
  );

  const applyItemsUpdate = useCallback(
    async (nextItems: MaterialOrderItem[], bannerMsg: string) => {
      if (!activeOrder || isLockedByOther) return;
      setUndoSnapshot(activeOrder.items.map((it) => ({ ...it })));
      await ensureOrderAssignedToMe(activeOrder);
      await updateMaterialOrder(activeOrder.id, { items: nextItems });
      setScanBanner({ type: 'success', message: bannerMsg });
    },
    [activeOrder, isLockedByOther, ensureOrderAssignedToMe, updateMaterialOrder]
  );

  const handlePickLine = useCallback(
    async (targetItem: MaterialOrderItem, qtyToPick?: number, scannedBarcode?: string) => {
      if (!activeOrder || isLockedByOther) return;
      const finalQty =
        qtyToPick !== undefined ? Math.max(1, Math.trunc(qtyToPick)) : targetItem.quantity;
      const nextItems = activeOrder.items.map((it) =>
        String(it.product_id) === String(targetItem.product_id)
          ? {
              ...it,
              picked: true,
              picked_quantity: finalQty,
              unavailable: false,
              scanned_barcode: scannedBarcode || it.product_ref,
              scanned_at: new Date().toISOString(),
            }
          : it
      );
      triggerScannerFeedback('success');
      await applyItemsUpdate(
        nextItems,
        `Article pointé : ${targetItem.product_ref} (Qté : ${finalQty}/${targetItem.quantity})`
      );
      setSelectedLineProductId(null);
      setCustomQtyPrompt(null);
    },
    [activeOrder, isLockedByOther, applyItemsUpdate]
  );

  const handleMarkUnavailable = useCallback(
    async (targetItem: MaterialOrderItem) => {
      if (!activeOrder || isLockedByOther) return;
      const nextItems = activeOrder.items.map((it) =>
        String(it.product_id) === String(targetItem.product_id)
          ? {
              ...it,
              picked: false,
              picked_quantity: 0,
              unavailable: true,
              unavailable_comment: 'Rupture constatée au picking bureau',
            }
          : it
      );
      await applyItemsUpdate(nextItems, `Ligne marquée manquante : ${targetItem.product_ref}`);
      setSelectedLineProductId(null);
    },
    [activeOrder, isLockedByOther, applyItemsUpdate]
  );

  const handleSubstituteLine = useCallback(
    async (targetItem: MaterialOrderItem, replacement: Product) => {
      if (!activeOrder || isLockedByOther) return;
      const nextItems = activeOrder.items.map((it) =>
        String(it.product_id) === String(targetItem.product_id)
          ? {
              ...it,
              substituted: true,
              substituted_with_id: replacement.id,
              substituted_with_ref: replacement.reference,
              substituted_with_name: `${replacement.brand} ${replacement.model}`.trim(),
              picked: true,
              picked_quantity: it.quantity,
              unavailable: false,
              scanned_at: new Date().toISOString(),
            }
          : it
      );
      triggerScannerFeedback('success');
      await applyItemsUpdate(
        nextItems,
        `Article ${targetItem.product_ref} remplacé par ${replacement.reference}`
      );
      setShowReplaceSelector(false);
      setSelectedLineProductId(null);
    },
    [activeOrder, isLockedByOther, applyItemsUpdate]
  );

  const handleUndoLastPick = useCallback(async () => {
    if (!activeOrder || !undoSnapshot || isLockedByOther) return;
    await updateMaterialOrder(activeOrder.id, { items: undoSnapshot });
    setUndoSnapshot(null);
    setScanBanner({ type: 'info', message: 'Dernière action annulée.' });
  }, [activeOrder, undoSnapshot, isLockedByOther, updateMaterialOrder]);

  const handleScannedCode = useCallback(
    async (rawCode: string) => {
      if (!activeOrder || isLockedByOther) return;
      const match = matchScannedCodeInOrder(activeOrder, rawCode, products, expectedItem);

      if (match.kind === 'expected_item' && match.matchedItem) {
        await handlePickLine(match.matchedItem, match.matchedItem.quantity, rawCode);
        return;
      }

      if (match.kind === 'other_order_item' && match.matchedItem) {
        await handlePickLine(match.matchedItem, match.matchedItem.quantity, rawCode);
        return;
      }

      if (match.kind === 'already_picked_item' && match.matchedItem) {
        triggerScannerFeedback('error');
        setScanBanner({
          type: 'info',
          message: `L'article ${match.matchedItem.product_ref} a déjà été pointé.`,
        });
        return;
      }

      if (match.kind === 'catalog_substitute_candidate' && match.catalogProduct && expectedItem) {
        triggerScannerFeedback('error');
        setScanBanner({
          type: 'error',
          message: `Code hors commande (${match.catalogProduct.reference}). Utilisez « Remplacer » si vous souhaitez substituer l'article attendu.`,
        });
        return;
      }

      triggerScannerFeedback('error');
      setScanBanner({
        type: 'error',
        message: `Code inconnu ou non attendu dans cette commande : "${rawCode}"`,
      });
    },
    [activeOrder, isLockedByOther, products, expectedItem, handlePickLine]
  );

  const handleFinishOrderReady = useCallback(async () => {
    if (!activeOrder || !canFinishOrder(activeOrder) || isLockedByOther) return;
    await markOrderReady(activeOrder.id, pickupZoneInput.trim() || 'Zone Retrait');

    if (printReadyLabelOnFinish && selectedStationId) {
      await rpcCreatePrintJob({
        stationId: selectedStationId,
        kind: 'order_label',
        format: getScannerSelectedLabelFormat(),
        payload: {
          order_id: activeOrder.id,
          order_number: activeOrder.order_number,
          site_number: activeOrder.site_number,
          site_name: activeOrder.site_name || '',
          requester_name: activeOrder.requester_name,
          pickup_zone: pickupZoneInput.trim() || 'Zone Retrait',
          depot_name: activeOrder.depot_name || 'Dépôt Principal',
        },
        copies: 1,
        dedupeKey: `order_ready_${activeOrder.id}`,
      });
    }

    setScanBanner({
      type: 'success',
      message: `Commande ${activeOrder.order_number} marquée PRÊTE (${pickupZoneInput}).`,
    });
  }, [
    activeOrder,
    isLockedByOther,
    markOrderReady,
    pickupZoneInput,
    printReadyLabelOnFinish,
    selectedStationId,
  ]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2' && expectedItem) {
        e.preventDefault();
        setCustomQtyPrompt(expectedItem.picked_quantity || expectedItem.quantity);
        return;
      }
      if (e.key === 'F4' && expectedItem) {
        e.preventDefault();
        handleMarkUnavailable(expectedItem);
        return;
      }
      if (e.key === 'F8' && activeOrder && canFinishOrder(activeOrder)) {
        e.preventDefault();
        handleFinishOrderReady();
        return;
      }

      if (isEditableEventTarget(e.target)) return;
      const res = processKeyForBarcodeBurst(
        burstStateRef.current,
        e.key,
        performance.now(),
        {
          isEditableTarget: false,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
        }
      );
      burstStateRef.current = res.state;
      if (res.committedCode) {
        e.preventDefault();
        handleScannedCode(res.committedCode);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expectedItem, activeOrder, handleMarkUnavailable, handleFinishOrderReady, handleScannedCode]);

  const handlePrintProductLabel = async (item: MaterialOrderItem) => {
    if (!selectedStationId) {
      setScanBanner({
        type: 'error',
        message: "Aucun poste d'impression sélectionné.",
      });
      return;
    }
    const res = await rpcCreatePrintJob({
      stationId: selectedStationId,
      kind: 'product_label',
      format: getScannerSelectedLabelFormat(),
      payload: {
        product_id: String(item.product_id),
        product_ref: item.product_ref,
      },
      copies: 1,
    });
    if (res.error) {
      setScanBanner({ type: 'error', message: res.error });
    } else {
      setScanBanner({
        type: 'success',
        message: `Étiquette ${item.product_ref} envoyée au poste d'impression.`,
      });
    }
  };

  const pickupZonesList = useMemo(() => {
    const d = depots.find(
      (dep) =>
        dep.name.toLowerCase() === (activeOrder?.depot_name || 'Dépôt Principal').toLowerCase()
    );
    return d?.pickup_zones && d.pickup_zones.length > 0
      ? d.pickup_zones
      : ['Zone Retrait A', 'Zone Retrait B', 'Comptoir Magasin', 'Casier Extérieur'];
  }, [depots, activeOrder]);

  return (
    <div className="grid grid-cols-12 h-full min-h-0 bg-slate-50 dark:bg-slate-950 divide-x divide-slate-200 dark:divide-slate-800">
      {/* ZONE 1 (Gauche - 3 col) : File des commandes à préparer */}
      <div className="col-span-3 flex flex-col min-h-0 bg-white dark:bg-slate-900">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between">
            <h1 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
              {t('desktop_nav_preparation' as any, 'Préparation (Picking)')}
            </h1>
            <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-orange-100 text-orange-700 dark:bg-orange-950/70 dark:text-orange-300">
              {preparerOrders.length}
            </span>
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filtrer commande ou chantier..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {preparerOrders.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">
              Aucune commande en attente de préparation.
            </div>
          ) : (
            preparerOrders.map((ord) => {
              const prog = getOrderProgress(ord);
              const isMine =
                ord.preparer_id && String(ord.preparer_id) === String(currentUser?.id);
              const isSelected = activeOrder?.id === ord.id;
              return (
                <button
                  key={ord.id}
                  type="button"
                  onClick={() => {
                    setSelectedOrderId(ord.id);
                    setSelectedLineProductId(null);
                  }}
                  className={`w-full text-left p-3.5 transition-colors space-y-1.5 ${
                    isSelected
                      ? 'bg-orange-50/90 dark:bg-orange-950/30 border-l-4 border-l-orange-600'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-black text-slate-900 dark:text-white truncate">
                      {ord.order_number}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        isMine
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          : ord.preparer_id
                          ? 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                      }`}
                    >
                      {isMine
                        ? 'En cours par moi'
                        : ord.preparer_name
                        ? `Par ${ord.preparer_name}`
                        : 'À préparer'}
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate">
                    Chantier : {ord.site_number}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>{ord.requester_name}</span>
                    <span className="font-mono font-bold">
                      {prog.processedLines}/{prog.totalLines} lignes ({prog.percent}%)
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-orange-600 transition-all"
                      style={{ width: `${prog.percent}%` }}
                    />
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ZONE 2 (Centre - 5 col) : Tableau des lignes triées par emplacement */}
      <div className="col-span-5 flex flex-col min-h-0 bg-white dark:bg-slate-900">
        {!activeOrder ? (
          <div className="flex-1 flex items-center justify-center text-xs text-slate-400 p-8">
            Sélectionnez une commande à préparer dans la colonne de gauche.
          </div>
        ) : (
          <>
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-mono text-sm font-black text-slate-900 dark:text-white">
                    {activeOrder.order_number}
                  </h2>
                  <span className="text-xs text-slate-500">
                    • {activeOrder.depot_name || 'Dépôt Principal'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Trié par emplacement de casier croissant • {progress.processedLines}/
                  {progress.totalLines} lignes traitées ({progress.pickedQuantity}/
                  {progress.requestedQuantity} u.)
                </p>
              </div>
              {undoSnapshot && (
                <button
                  type="button"
                  onClick={handleUndoLastPick}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Annuler dernier pointage
                </button>
              )}
            </div>

            {scanBanner && (
              <div
                className={`px-4 py-2 text-xs font-bold flex items-center justify-between ${
                  scanBanner.type === 'success'
                    ? 'bg-emerald-600 text-white'
                    : scanBanner.type === 'error'
                    ? 'bg-rose-600 text-white'
                    : 'bg-sky-600 text-white'
                }`}
              >
                <span>{scanBanner.message}</span>
                <button
                  type="button"
                  onClick={() => setScanBanner(null)}
                  className="text-white/80 hover:text-white text-[11px]"
                >
                  Fermer
                </button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 text-[10px] font-bold uppercase text-slate-500 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="py-2 px-3">Casier</th>
                    <th className="py-2 px-3">Article</th>
                    <th className="py-2 px-3 text-right">Qté</th>
                    <th className="py-2 px-3">État</th>
                    <th className="py-2 px-3 text-right">Étiquette</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {sortedItems.map((it) => {
                    const loc = getItemRackLocation(it, products);
                    const vStatus = getPickingLineVisualStatus(it);
                    const isCurrentExpected =
                      expectedItem && String(expectedItem.product_id) === String(it.product_id);
                    const pQty =
                      it.picked_quantity !== undefined
                        ? it.picked_quantity
                        : it.picked
                        ? it.quantity
                        : 0;
                    return (
                      <tr
                        key={String(it.product_id)}
                        onClick={() => setSelectedLineProductId(it.product_id)}
                        className={`cursor-pointer transition-colors ${
                          isCurrentExpected
                            ? 'bg-orange-50 dark:bg-orange-950/40 font-semibold'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="py-2.5 px-3 font-mono font-black text-orange-600 dark:text-orange-400">
                          {loc || '—'}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-mono font-bold text-slate-900 dark:text-white">
                            {it.product_ref}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate max-w-[200px]">
                            {it.product_name}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold">
                          {pQty}/{it.quantity}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              vStatus === 'picked'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : vStatus === 'partial'
                                ? 'bg-amber-100 text-amber-800'
                                : vStatus === 'missing'
                                ? 'bg-rose-100 text-rose-800'
                                : vStatus === 'replaced'
                                ? 'bg-purple-100 text-purple-800'
                                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                            }`}
                          >
                            {vStatus === 'picked'
                              ? 'Pointé'
                              : vStatus === 'partial'
                              ? 'Partiel'
                              : vStatus === 'missing'
                              ? 'Manquant'
                              : vStatus === 'replaced'
                              ? 'Remplacé'
                              : 'À prendre'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePrintProductLabel(it);
                            }}
                            title="Envoyer l'étiquette produit au poste d'impression"
                            className="p-1.5 rounded-lg text-slate-500 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-slate-800"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ZONE 3 (Droite - 4 col) : Zone de scan active, article attendu en grand et clôture */}
      <div className="col-span-4 flex flex-col min-h-0 bg-slate-50 dark:bg-slate-950 p-5 gap-4 overflow-y-auto">
        <div className="p-3.5 rounded-xl bg-slate-900 text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <div>
              <div className="text-xs font-bold flex items-center gap-1.5">
                <ScanBarcode className="w-4 h-4 text-orange-400" />
                Douchette USB HID active
              </div>
              <div className="text-[10px] text-slate-400">
                Scannez directement sans cliquer dans un champ (&lt; 50 ms)
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              setScannerSoundEnabled(next);
            }}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
            title={soundEnabled ? 'Son du scanner activé' : 'Son coupé'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!manualScanCode.trim()) return;
            handleScannedCode(manualScanCode.trim());
            setManualScanCode('');
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={manualScanCode}
            onChange={(e) => setManualScanCode(e.target.value)}
            placeholder="Ou saisir une réf / code-barres + Entrée..."
            className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
          />
          <button
            type="submit"
            className="px-3 py-2 rounded-lg text-xs font-bold bg-slate-800 text-white hover:bg-slate-700"
          >
            Valider
          </button>
        </form>

        {expectedItem ? (
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border-2 border-orange-500/80 shadow-sm space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-orange-600">
                  Prochain article à prélever
                </span>
                <div className="font-mono text-xl font-black text-slate-900 dark:text-white mt-0.5">
                  {expectedItem.product_ref}
                </div>
                <div className="text-sm font-bold text-slate-700 dark:text-slate-200">
                  {expectedItem.product_name}
                </div>
              </div>
              <div className="px-3 py-2 rounded-xl bg-orange-50 dark:bg-orange-950/60 border border-orange-200 dark:border-orange-800 text-right">
                <div className="text-[10px] font-bold uppercase text-orange-600">Casier</div>
                <div className="font-mono text-lg font-black text-orange-700 dark:text-orange-300 flex items-center gap-1">
                  <MapPin className="w-4 h-4" />
                  {getItemRackLocation(expectedItem, products) || 'N/A'}
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">Quantité à prélever</span>
              <span className="font-mono text-2xl font-black text-slate-900 dark:text-white">
                {expectedItem.quantity} {expectedItem.unit || 'u'}
              </span>
            </div>

            {customQtyPrompt !== null && (
              <div className="p-3 rounded-xl bg-orange-50 dark:bg-orange-950/40 border border-orange-200 flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={expectedItem.quantity}
                  value={customQtyPrompt}
                  onChange={(e) => setCustomQtyPrompt(Math.max(1, Number(e.target.value) || 1))}
                  className="w-24 px-2.5 py-1.5 font-mono font-bold text-sm rounded border border-orange-300 bg-white dark:bg-slate-900"
                />
                <button
                  type="button"
                  onClick={() => handlePickLine(expectedItem, customQtyPrompt)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-orange-600 text-white"
                >
                  Pointer Qté partielle
                </button>
                <button
                  type="button"
                  onClick={() => setCustomQtyPrompt(null)}
                  className="text-xs text-slate-500"
                >
                  Annuler
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                disabled={isLockedByOther}
                onClick={() => handlePickLine(expectedItem, expectedItem.quantity)}
                className="col-span-2 py-2.5 px-4 rounded-xl text-xs font-black bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white flex items-center justify-center gap-2 shadow-xs"
              >
                <CheckCircle2 className="w-4 h-4" />
                Pointer conforme ({expectedItem.quantity})
              </button>
              <button
                type="button"
                disabled={isLockedByOther}
                onClick={() => setCustomQtyPrompt(expectedItem.quantity)}
                className="py-2 px-3 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Quantité (F2)
              </button>
              <button
                type="button"
                disabled={isLockedByOther}
                onClick={() => handleMarkUnavailable(expectedItem)}
                className="py-2 px-3 rounded-lg text-xs font-bold border border-rose-200 text-rose-600 hover:bg-rose-50"
              >
                Manquant (F4)
              </button>
              <button
                type="button"
                disabled={isLockedByOther}
                onClick={() => setShowReplaceSelector((v) => !v)}
                className="col-span-2 py-2 px-3 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Remplacer par un autre article du catalogue
              </button>
            </div>

            {showReplaceSelector && (
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                <input
                  type="text"
                  value={replaceSearch}
                  onChange={(e) => setReplaceSearch(e.target.value)}
                  placeholder="Rechercher l'article de substitution..."
                  className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700"
                />
                <div className="max-h-36 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {products
                    .filter((p) =>
                      `${p.reference} ${p.brand} ${p.model}`
                        .toLowerCase()
                        .includes(replaceSearch.trim().toLowerCase())
                    )
                    .slice(0, 15)
                    .map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleSubstituteLine(expectedItem, p)}
                        className="w-full text-left py-1.5 px-2 hover:bg-orange-50 dark:hover:bg-slate-800 flex items-center justify-between"
                      >
                        <span className="font-mono font-bold">{p.reference}</span>
                        <span className="truncate ml-2 text-slate-500">
                          {p.brand} {p.model}
                        </span>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          activeOrder && (
            <div className="p-5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
              <div className="text-sm font-black text-emerald-900 dark:text-emerald-200">
                Toutes les lignes ont été traitées !
              </div>
              <p className="text-xs text-emerald-700 dark:text-emerald-300">
                Choisissez la zone de retrait ci-dessous et validez « Commande prête (F8) ».
              </p>
            </div>
          )
        )}

        {activeOrder && (
          <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3 mt-auto">
            <div className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Validation Commande Prête
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">
                Emplacement de retrait
              </label>
              <select
                value={pickupZoneInput}
                onChange={(e) => setPickupZoneInput(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              >
                {pickupZonesList.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between gap-2 text-xs">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={printReadyLabelOnFinish}
                  onChange={(e) => setPrintReadyLabelOnFinish(e.target.checked)}
                  className="rounded text-orange-600"
                />
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  Imprimer l'étiquette de commande
                </span>
              </label>
              {stations.length > 0 && (
                <select
                  value={selectedStationId}
                  onChange={(e) => setSelectedStationId(e.target.value)}
                  className="px-2 py-1 text-[11px] rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  {stations.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.is_online ? '●' : '○'}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <button
              type="button"
              disabled={!canFinishOrder(activeOrder) || isLockedByOther}
              onClick={handleFinishOrderReady}
              className="w-full py-2.5 px-4 rounded-xl text-xs font-black bg-orange-600 hover:bg-orange-700 disabled:opacity-40 text-white shadow-sm flex items-center justify-center gap-2"
            >
              <UserCheck className="w-4 h-4" />
              Commande prête au retrait (F8)
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
