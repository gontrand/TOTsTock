import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardList,
  Plus,
  Printer,
  Search,
  ShoppingBag,
  Trash2,
  Truck,
  X,
  XCircle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { MaterialOrder, OrderStatus } from '../../types';
import { formatCurrency } from '../../utils/crypto';
import {
  buildFullPrintableDocumentHtml,
  renderOrderReadyLabelSheetHtml,
} from '../../services/labelRendering';
import { generateQrCodeDataUrlWithTotLogo } from '../../utils/qrCodeHelper';
import { dispatchStationPrintDocument } from '../../services/printStationService';
import {
  requestGuardedNavigation,
  useRegisterUnsavedForm,
} from '../../services/unsavedChangesGuard';
import { tr } from '../../i18n/dutchTranslator';
import { Language } from '../../i18n/translations';

export interface DesktopOrdersPageProps {
  selectedDepotFilter?: string;
  selectedOrderId?: string | null;
  onSelectOrder?: (id: string | null) => void;
  openNewOrderRequested?: boolean;
  onConsumeNewOrderRequest?: () => void;
  onOpenPreparationForOrder?: (ordId: string) => void;
  initialSelectedOrderId?: string | null;
  globalDepotFilter?: string;
  onOpenOrderInPreparation?: (orderId: string) => void;
}

function getStatusBadge(status: OrderStatus, language: Language): { label: string; classes: string } {
  switch (status) {
    case 'WAITING_APPROVAL':
      return {
        label: tr(language, 'À valider', 'Pending approval', 'Te valideren'),
        classes: 'bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300',
      };
    case 'PENDING':
      return {
        label: tr(language, 'À préparer', 'To prepare', 'Te verzamelen'),
        classes: 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300',
      };
    case 'PREPARING':
      return {
        label: tr(language, 'En préparation', 'In preparation', 'In voorbereiding'),
        classes: 'bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300',
      };
    case 'READY':
      return {
        label: tr(language, 'Prête au retrait', 'Ready for pickup', 'Klaar voor afhaling'),
        classes: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300',
      };
    case 'COLLECTED':
      return {
        label: tr(language, 'Retirée', 'Collected', 'Afgehaald'),
        classes: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
      };
    case 'CANCELLED':
      return {
        label: tr(language, 'Annulée', 'Cancelled', 'Geannuleerd'),
        classes: 'bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300',
      };
    case 'REJECTED':
      return {
        label: tr(language, 'Refusée', 'Rejected', 'Geweigerd'),
        classes: 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300',
      };
  }
}

export const DesktopOrdersPage: React.FC<DesktopOrdersPageProps> = ({
  selectedDepotFilter,
  selectedOrderId: controlledOrderId,
  onSelectOrder,
  openNewOrderRequested,
  onConsumeNewOrderRequest,
  onOpenPreparationForOrder,
  initialSelectedOrderId,
  globalDepotFilter = 'ALL',
  onOpenOrderInPreparation,
}) => {
  const {
    orders,
    products,
    depots,
    departments,
    projects,
    userHasPermission,
    canApproveOrder,
    approveOrder,
    rejectOrder,
    cancelOrder,
    markOrderCollected,
    addToOrderCart,
    orderCart,
    removeFromOrderCart,
    updateOrderCartQty,
    submitMaterialOrder,
    language,
    t,
  } = useApp();

  const effectiveDepotFilter = selectedDepotFilter ?? globalDepotFilter ?? 'ALL';
  const handlePrepRedirect = onOpenPreparationForOrder ?? onOpenOrderInPreparation;
  const locale = language === 'nl' ? 'nl-NL' : language === 'en' ? 'en-GB' : 'fr-FR';

  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [internalOrderId, setInternalOrderId] = useState<string | null>(
    controlledOrderId ?? initialSelectedOrderId ?? null
  );

  const selectedOrderId = controlledOrderId !== undefined ? controlledOrderId : internalOrderId;
  const setSelectedOrderId = (id: string | null) => {
    setInternalOrderId(id);
    onSelectOrder?.(id);
  };

  // New Order Modal State
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [orderSiteNumber, setOrderSiteNumber] = useState('');
  const [orderDepartment, setOrderDepartment] = useState('');
  const [orderDepot, setOrderDepot] = useState(depots[0]?.name || 'Dépôt Principal');
  const [orderNotes, setOrderNotes] = useState('');
  const [catalogQuery, setCatalogQuery] = useState('');
  const [submittingOrder, setSubmittingOrder] = useState(false);

  React.useEffect(() => {
    if (openNewOrderRequested) {
      setNewOrderOpen(true);
      onConsumeNewOrderRequest?.();
    }
  }, [openNewOrderRequested, onConsumeNewOrderRequest]);

  React.useEffect(() => {
    if (initialSelectedOrderId) {
      setInternalOrderId(initialSelectedOrderId);
    }
  }, [initialSelectedOrderId]);

  const canCreateOrder = userHasPermission('perm_create_order');
  const canPrepOrder =
    userHasPermission('perm_menu_order_prep') || userHasPermission('perm_orders_manage');
  const canCollectOrder =
    userHasPermission('perm_order_mark_collected') || userHasPermission('perm_orders_manage');
  const canCancelOrder =
    userHasPermission('perm_order_cancel') || userHasPermission('perm_orders_manage');
  const canViewPrices = userHasPermission('perm_prod_view_price');

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (statusFilter !== 'ALL' && o.status !== statusFilter) return false;
      if (effectiveDepotFilter !== 'ALL' && o.depot_name && o.depot_name !== effectiveDepotFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const hay = [
          o.order_number,
          o.requester_name,
          o.requester_department,
          o.site_number,
          o.depot_name,
          o.notes,
          ...o.items.map((it) => `${it.product_ref} ${it.product_name}`),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [orders, statusFilter, effectiveDepotFilter, searchQuery]);

  const activeOrder: MaterialOrder | null = useMemo(() => {
    if (selectedOrderId) {
      const found = filteredOrders.find((o) => o.id === selectedOrderId);
      if (found) return found;
    }
    return filteredOrders[0] || null;
  }, [filteredOrders, selectedOrderId]);

  const handlePrintOrderSlip = async (order: MaterialOrder) => {
    let qrDataUrl = '';
    try {
      qrDataUrl = await generateQrCodeDataUrlWithTotLogo(`TOT-ORDER:${order.order_number}`, {
        size: 180,
        margin: 1,
      });
    } catch {
      qrDataUrl = '';
    }
    const bodyHtml = renderOrderReadyLabelSheetHtml(
      {
        order_number: order.order_number,
        site_number: order.site_number || undefined,
        site_name: order.site_name || undefined,
        requester_name: order.requester_name || undefined,
        pickup_zone: order.pickup_zone || undefined,
        depot_name: order.depot_name || undefined,
        items_count: order.items.length,
        qrDataUrl,
      },
      'avery_105x42',
      1
    );
    const docHtml = buildFullPrintableDocumentHtml(
      bodyHtml,
      'avery_105x42',
      `${tr(language, 'Bon Commande', 'Order Slip', 'Bestelbon')} ${order.order_number}`
    );
    await dispatchStationPrintDocument({
      html: docHtml,
      format: 'avery_105x42',
      copies: 1,
    });
  };

  const performCreateOrderSubmit = async (): Promise<boolean> => {
    if (orderCart.length === 0) return false;
    setSubmittingOrder(true);
    try {
      const res = await submitMaterialOrder(
        orderSiteNumber || 'CHANTIER',
        orderDepot || undefined,
        orderNotes || undefined
      );
      if (res.success) {
        setNewOrderOpen(false);
        setOrderNotes('');
      }
      return Boolean(res.success);
    } finally {
      setSubmittingOrder(false);
    }
  };

  const handleCreateOrderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await performCreateOrderSubmit();
  };

  const isNewOrderDirty = Boolean(
    newOrderOpen &&
      (orderCart.length > 0 || orderSiteNumber.trim() !== '' || orderNotes.trim() !== '')
  );

  useRegisterUnsavedForm({
    id: 'desktop-new-order-drawer',
    isDirty: isNewOrderDirty,
    label: tr(language, 'Nouvelle commande matériel', 'New material order', 'Nieuwe materiaalbestelling'),
    onSave: () => performCreateOrderSubmit(),
    onDiscard: () => {
      setNewOrderOpen(false);
      setOrderNotes('');
    },
  });

  const handleCloseNewOrderDrawer = () => {
    requestGuardedNavigation(
      () => {
        setNewOrderOpen(false);
      },
      ['desktop-new-order-drawer']
    );
  };

  const depotCatalogProducts = useMemo(() => {
    const q = catalogQuery.toLowerCase().trim();
    return products
      .filter((p) => {
        if (orderDepot && p.store_name && p.store_name !== orderDepot) return false;
        if (!q) return true;
        return `${p.reference} ${p.brand} ${p.model}`
          .toLowerCase()
          .includes(q);
      })
      .slice(0, 40);
  }, [products, orderDepot, catalogQuery]);

  return (
    <div className="flex h-full min-h-0 bg-slate-50 dark:bg-slate-950">
      {/* Left Column: Orders List */}
      <div className="w-[410px] shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col h-full">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-5 h-5 text-orange-600" />
              <h1 className="text-base font-black text-slate-900 dark:text-white">
                {t('desktop_nav_orders')}
              </h1>
              <span className="px-2 py-0.5 text-[11px] font-mono font-bold rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                {filteredOrders.length}
              </span>
            </div>
            {canCreateOrder && (
              <button
                type="button"
                onClick={() => setNewOrderOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('desktop_new_order')}
              </button>
            )}
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={tr(
                language,
                'N° commande, chantier, demandeur, réf...',
                'Order #, job site, requester, ref...',
                'Bestelnr., werf, aanvrager, ref...'
              )}
              className="w-full pl-9 pr-8 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Filter pills */}
          <div className="flex flex-wrap gap-1 text-[11px] font-bold">
            {(
              [
                ['ALL', tr(language, 'Toutes', 'All', 'Alle')],
                ['WAITING_APPROVAL', tr(language, 'À valider', 'To approve', 'Te valideren')],
                ['PENDING', tr(language, 'À préparer', 'To prepare', 'Te verzamelen')],
                ['PREPARING', tr(language, 'En cours', 'In progress', 'Bezig')],
                ['READY', tr(language, 'Prêtes', 'Ready', 'Klaar')],
                ['COLLECTED', tr(language, 'Retirées', 'Collected', 'Afgehaald')],
              ] as Array<[OrderStatus | 'ALL', string]>
            ).map(([st, label]) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  statusFilter === st
                    ? 'bg-orange-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Orders scrollable list */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-200/70 dark:divide-slate-800">
          {filteredOrders.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              {tr(
                language,
                'Aucune commande trouvée pour ce filtre.',
                'No order found for this filter.',
                'Geen bestellingen gevonden voor dit filter.'
              )}
            </div>
          ) : (
            filteredOrders.map((order) => {
              const isSelected = activeOrder?.id === order.id;
              const badge = getStatusBadge(order.status, language);
              const totalLines = order.items.length;
              const pickedLines = order.items.filter(
                (it) => it.picked || it.unavailable
              ).length;

              return (
                <button
                  key={order.id}
                  type="button"
                  onClick={() => setSelectedOrderId(order.id)}
                  className={`w-full text-left p-4 transition-colors flex flex-col gap-1.5 ${
                    isSelected
                      ? 'bg-orange-50/90 dark:bg-orange-950/40 border-l-4 border-l-orange-600'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-black text-slate-900 dark:text-white">
                      {order.order_number}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${badge.classes}`}
                    >
                      {badge.label}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                    <span className="font-semibold truncate">
                      {order.requester_name} • {order.site_number || '—'}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">
                      {pickedLines}/{totalLines} {tr(language, 'lignes', 'lines', 'regels')}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>{order.depot_name || tr(language, 'Dépôt Principal', 'Main Depot', 'Hoofddepot')}</span>
                    <span className="font-mono">
                      {new Date(order.created_at).toLocaleDateString(locale)}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right Column: Order Detail & Actions */}
      <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
        {!activeOrder ? (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-400">
            {tr(
              language,
              'Sélectionnez une commande dans la liste de gauche pour afficher ses lignes.',
              'Select an order from the left list to view its lines.',
              'Selecteer een bestelling in de lijst links om de regels te bekijken.'
            )}
          </div>
        ) : (
          <>
            {/* Order Header */}
            <div className="px-6 py-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-black font-mono text-slate-900 dark:text-white">
                    {activeOrder.order_number}
                  </h2>
                  <span
                    className={`px-2.5 py-0.5 rounded-md text-xs font-bold ${
                      getStatusBadge(activeOrder.status, language).classes
                    }`}
                  >
                    {getStatusBadge(activeOrder.status, language).label}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {tr(language, 'Demandeur :', 'Requester:', 'Aanvrager:')}{' '}
                  <strong className="text-slate-800 dark:text-slate-200">
                    {activeOrder.requester_name}
                  </strong>{' '}
                  • {tr(language, 'Chantier :', 'Job site:', 'Werf:')}{' '}
                  <strong className="font-mono text-slate-800 dark:text-slate-200">
                    {activeOrder.site_number || '—'}
                  </strong>{' '}
                  • {tr(language, 'Dépôt :', 'Depot:', 'Depot:')}{' '}
                  <strong className="text-slate-800 dark:text-slate-200">
                    {activeOrder.depot_name || tr(language, 'Dépôt Principal', 'Main Depot', 'Hoofddepot')}
                  </strong>
                  {activeOrder.pickup_zone && (
                    <>
                      {' '}
                      • {tr(language, 'Zone retrait :', 'Pickup zone:', 'Afhaalzone:')}{' '}
                      <strong className="font-mono text-emerald-600 dark:text-emerald-400">
                        {activeOrder.pickup_zone}
                      </strong>
                    </>
                  )}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handlePrintOrderSlip(activeOrder)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50"
                >
                  <Printer className="w-3.5 h-3.5 text-orange-500" />
                  {tr(language, 'Imprimer bon', 'Print slip', 'Bon afdrukken')}
                </button>

                {activeOrder.status === 'WAITING_APPROVAL' &&
                  canApproveOrder(activeOrder) && (
                    <>
                      <button
                        type="button"
                        onClick={() => approveOrder(activeOrder.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {tr(language, 'Approuver', 'Approve', 'Goedkeuren')}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          rejectOrder(
                            activeOrder.id,
                            tr(language, 'Refusé depuis le poste bureau', 'Rejected from desktop workstation', 'Geweigerd vanaf desktopwerkstation')
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        {tr(language, 'Refuser', 'Reject', 'Weigeren')}
                      </button>
                    </>
                  )}

                {(activeOrder.status === 'PENDING' ||
                  activeOrder.status === 'PREPARING') &&
                  canPrepOrder &&
                  handlePrepRedirect && (
                    <button
                      type="button"
                      onClick={() => handlePrepRedirect(activeOrder.id)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white"
                    >
                      <ClipboardList className="w-3.5 h-3.5" />
                      {tr(language, 'Ouvrir en préparation (Picking)', 'Open in Picking', 'Openen in Orderpicken')}
                    </button>
                  )}

                {activeOrder.status === 'READY' && canCollectOrder && (
                  <button
                    type="button"
                    onClick={() => markOrderCollected(activeOrder.id)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    <Truck className="w-3.5 h-3.5" />
                    {tr(language, 'Marquer retirée', 'Mark collected', 'Markeer als afgehaald')}
                  </button>
                )}

                {(activeOrder.status === 'PENDING' ||
                  activeOrder.status === 'WAITING_APPROVAL') &&
                  canCancelOrder && (
                    <button
                      type="button"
                      onClick={() => cancelOrder(activeOrder.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {tr(language, 'Annuler', 'Cancel', 'Annuleren')}
                    </button>
                  )}
              </div>
            </div>

            {/* Order Items Table */}
            <div className="flex-1 overflow-auto p-6">
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-100 dark:bg-slate-800/80 text-[11px] font-bold uppercase text-slate-500">
                    <tr>
                      <th className="py-2.5 px-4">{tr(language, 'Référence', 'Reference', 'Referentie')}</th>
                      <th className="py-2.5 px-4">{tr(language, 'Désignation', 'Designation', 'Omschrijving')}</th>
                      <th className="py-2.5 px-3">{tr(language, 'Emplacement', 'Location', 'Locatie')}</th>
                      <th className="py-2.5 px-3 text-right">{tr(language, 'Demandé', 'Requested', 'Gevraagd')}</th>
                      <th className="py-2.5 px-3 text-right">{tr(language, 'Préparé', 'Picked', 'Verzameld')}</th>
                      <th className="py-2.5 px-4">{tr(language, 'Statut ligne', 'Line status', 'Regelstatus')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                    {activeOrder.items.map((it) => {
                      const pickedQty = it.picked_quantity ?? (it.picked ? it.quantity : 0);
                      const isMissing = Boolean(it.unavailable);
                      const isPartial = !isMissing && it.picked && pickedQty > 0 && pickedQty < it.quantity;

                      return (
                        <tr key={String(it.product_id)} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-3 px-4 font-mono font-bold text-orange-600 dark:text-orange-400">
                            {it.product_ref}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-bold text-slate-900 dark:text-white">
                              {it.product_name}
                            </div>
                            {it.substituted && it.substituted_with_ref && (
                              <div className="text-[11px] text-amber-600">
                                {tr(language, 'Remplacé par', 'Replaced with', 'Vervangen door')}{' '}
                                {it.substituted_with_ref} ({it.substituted_with_name})
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3 font-mono text-slate-600 dark:text-slate-300">
                            {it.rack_location || '—'}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold">
                            {it.quantity}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-black text-emerald-600 dark:text-emerald-400">
                            {pickedQty}
                          </td>
                          <td className="py-3 px-4">
                            {isMissing ? (
                              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                                {tr(language, 'Manquant', 'Missing', 'Ontbrekend')}{' '}
                                {it.unavailable_comment ? `(${it.unavailable_comment})` : ''}
                              </span>
                            ) : isPartial ? (
                              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                                {tr(language, 'Partiel', 'Partial', 'Gedeeltelijk')} ({pickedQty}/{it.quantity})
                              </span>
                            ) : it.picked ? (
                              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                                {tr(language, 'Pointé', 'Picked', 'Verzameld')}
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                {tr(language, 'En attente', 'Pending', 'In wachtrij')}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {canViewPrices && activeOrder.total_cost != null && (
                <div className="mt-4 flex justify-end">
                  <div className="px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
                    {tr(language, 'Total estimé HT :', 'Estimated net total:', 'Geschat totaal excl. btw:')}{' '}
                    <strong className="font-mono text-sm text-slate-900 dark:text-white ml-2">
                      {formatCurrency(activeOrder.total_cost)}
                    </strong>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* New Order Drawer */}
      {newOrderOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex justify-end"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseNewOrderDrawer();
          }}
        >
          <div className="w-full max-w-2xl bg-white dark:bg-slate-900 h-full shadow-2xl border-l border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="text-base font-black text-slate-900 dark:text-white">
                {t('desktop_new_order_material')}
              </h2>
              <button
                type="button"
                onClick={handleCloseNewOrderDrawer}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={handleCreateOrderSubmit}
              className="flex-1 overflow-y-auto p-6 space-y-5 text-xs"
            >
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {tr(language, 'Dépôt (mono-dépôt)', 'Depot (single-depot)', 'Depot (één depot)')}
                  </label>
                  <select
                    value={orderDepot}
                    onChange={(e) => setOrderDepot(e.target.value)}
                    disabled={orderCart.length > 0}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-semibold disabled:opacity-60"
                  >
                    {depots.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {tr(language, 'N° Chantier *', 'Job Site # *', 'Werfnr. *')}
                  </label>
                  <input
                    type="text"
                    required
                    list="desktop-order-projects"
                    value={orderSiteNumber}
                    onChange={(e) => setOrderSiteNumber(e.target.value)}
                    placeholder="Ex: CH-2026-01"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                  />
                  <datalist id="desktop-order-projects">
                    {projects.map((p) => (
                      <option key={p.id} value={p.project_number}>
                        {p.project_name}
                      </option>
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {tr(language, 'Département', 'Department', 'Afdeling')}
                  </label>
                  <select
                    value={orderDepartment}
                    onChange={(e) => setOrderDepartment(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  >
                    <option value="">{tr(language, '— Choisir —', '— Select —', '— Kiezen —')}</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Add catalog items */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    {tr(
                      language,
                      `Ajouter des articles du dépôt « ${orderDepot} »`,
                      `Add items from depot "${orderDepot}"`,
                      `Artikelen toevoegen uit depot "${orderDepot}"`
                    )}
                  </span>
                </div>
                <input
                  type="text"
                  value={catalogQuery}
                  onChange={(e) => setCatalogQuery(e.target.value)}
                  placeholder={tr(
                    language,
                    'Filtrer par référence ou désignation...',
                    'Filter by reference or designation...',
                    'Filter op referentie of omschrijving...'
                  )}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
                <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                  {depotCatalogProducts.map((p) => (
                    <div
                      key={p.id}
                      className="py-1.5 flex items-center justify-between gap-2"
                    >
                      <div>
                        <span className="font-mono font-bold text-orange-600 mr-2">
                          {p.reference}
                        </span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {p.brand} {p.model}
                        </span>
                        <span className="ml-2 text-[11px] text-slate-400 font-mono">
                          (Stock: {p.quantity})
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => addToOrderCart(p, 1)}
                        className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-orange-600 hover:text-white font-bold text-[11px] transition-colors"
                      >
                        {tr(language, '+ Ajouter', '+ Add', '+ Toevoegen')}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Current Cart */}
              <div className="space-y-2">
                <div className="font-bold text-slate-800 dark:text-slate-200">
                  {tr(language, 'Panier de la commande', 'Order cart', 'Bestelwagen')} ({orderCart.length}{' '}
                  {tr(language, 'ligne(s)', 'line(s)', 'regel(s)')})
                </div>
                {orderCart.length === 0 ? (
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-center text-slate-400">
                    {tr(language, 'Aucun article sélectionné.', 'No item selected.', 'Geen artikel geselecteerd.')}
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                    {orderCart.map((c) => (
                      <div
                        key={String(c.product_id)}
                        className="p-2.5 flex items-center justify-between gap-3 bg-white dark:bg-slate-900"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-[11px] font-bold text-orange-600">
                            {c.product_ref}
                          </div>
                          <div className="font-semibold truncate text-slate-900 dark:text-white">
                            {c.product_name}
                          </div>
                        </div>
                        <input
                          type="number"
                          min={1}
                          value={c.quantity}
                          onChange={(e) =>
                            updateOrderCartQty(
                              c.product_id,
                              Math.max(1, Number(e.target.value) || 1)
                            )
                          }
                          className="w-20 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-right font-mono font-bold"
                        />
                        <button
                          type="button"
                          onClick={() => removeFromOrderCart(c.product_id)}
                          className="p-1 text-rose-500 hover:bg-rose-50 rounded"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {tr(language, 'Instructions / Notes de préparation', 'Preparation instructions / notes', 'Voorbereidingsinstructies / opmerkingen')}
                </label>
                <textarea
                  rows={2}
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleCloseNewOrderDrawer}
                  className="px-4 py-2 rounded-lg font-bold border border-slate-200 dark:border-slate-700"
                >
                  {t('common_cancel')}
                </button>
                <button
                  type="submit"
                  disabled={orderCart.length === 0 || !orderSiteNumber.trim() || submittingOrder}
                  className="px-5 py-2 rounded-lg font-bold bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white"
                >
                  {submittingOrder
                    ? tr(language, 'Création...', 'Creating...', 'Aanmaken...')
                    : tr(language, 'Envoyer la commande', 'Submit order', 'Bestelling verzenden')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
