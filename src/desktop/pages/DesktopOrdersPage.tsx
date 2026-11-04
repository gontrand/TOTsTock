import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Package,
  Plus,
  Printer,
  Search,
  ShoppingCart,
  Trash2,
  X,
  XCircle,
  AlertTriangle,
  ScanBarcode,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { MaterialOrder, MaterialOrderItem, OrderStatus, Product } from '../../types';
import { formatCurrency, isUserAllowedForDepot } from '../../utils/crypto';
import { buildClosedDepotNamesSet } from '../../services/desktopInventoryLogic';
import {
  canUserApproveOrRejectOrder,
  filterOrdersByStatusAndSearch,
} from '../../services/desktopOrdersMovementsLogic';

interface DesktopOrdersPageProps {
  externalSearchQuery?: string;
  selectedDepotFilter: string;
  selectedOrderId?: string | null;
  onSelectOrder?: (id: string | null) => void;
  onOpenPreparationForOrder?: (orderId: string) => void;
  openNewOrderRequested?: boolean;
  onConsumeNewOrderRequest?: () => void;
}

const STATUS_BADGE: Record<
  OrderStatus,
  { label: string; className: string }
> = {
  WAITING_APPROVAL: {
    label: 'À valider',
    className:
      'bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border-purple-200 dark:border-purple-800/60',
  },
  PENDING: {
    label: 'À préparer',
    className:
      'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800/60',
  },
  PREPARING: {
    label: 'En préparation',
    className:
      'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300 border-sky-200 dark:border-sky-800/60',
  },
  READY: {
    label: 'Prête au retrait',
    className:
      'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60',
  },
  COLLECTED: {
    label: 'Retirée',
    className:
      'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700',
  },
  CANCELLED: {
    label: 'Annulée',
    className:
      'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200 dark:border-rose-800/60',
  },
  REJECTED: {
    label: 'Refusée',
    className:
      'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200 dark:border-rose-800/60',
  },
};

export const DesktopOrdersPage: React.FC<DesktopOrdersPageProps> = ({
  externalSearchQuery = '',
  selectedDepotFilter,
  selectedOrderId: controlledOrderId,
  onSelectOrder,
  onOpenPreparationForOrder,
  openNewOrderRequested,
  onConsumeNewOrderRequest,
}) => {
  const {
    orders,
    products,
    depots,
    departments,
    projects,
    currentUser,
    userHasPermission,
    canViewPrices,
    createOrderBasket,
    addToOrderCart,
    updateOrderCartQty,
    submitMaterialOrder,
    markOrderCollected,
    canApproveOrder,
    approveOrder,
    rejectOrder,
    cancelOrder,
    t,
  } = useApp();

  const [statusFilter, setStatusFilter] = useState<'ALL' | OrderStatus>('ALL');
  const [localSearch, setLocalSearch] = useState('');
  const [internalOrderId, setInternalOrderId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectPrompt, setShowRejectPrompt] = useState(false);

  const selectedOrderId =
    controlledOrderId !== undefined ? controlledOrderId : internalOrderId;
  const setSelectedOrderId = (id: string | null) => {
    setInternalOrderId(id);
    onSelectOrder?.(id);
  };

  // 2-column order creation dialog state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [orderDepot, setOrderDepot] = useState<string>('Dépôt Principal');
  const [orderSiteNumber, setOrderSiteNumber] = useState<string>('');
  const [orderNotes, setOrderNotes] = useState<string>('');
  const [cartItems, setCartItems] = useState<MaterialOrderItem[]>([]);
  const [submittingOrder, setSubmittingOrder] = useState(false);

  React.useEffect(() => {
    if (openNewOrderRequested) {
      setShowCreateModal(true);
      onConsumeNewOrderRequest?.();
    }
  }, [openNewOrderRequested, onConsumeNewOrderRequest]);

  const canCreateOrder =
    userHasPermission('perm_orders_create') || userHasPermission('perm_menu_material_orders');
  const canManageOrders =
    userHasPermission('perm_orders_manage') || userHasPermission('perm_menu_order_prep');
  const hasApproveOrderPerm = userHasPermission('perm_order_approve');
  const canViewAllOrders =
    canManageOrders || userHasPermission('perm_orders_view_all') || hasApproveOrderPerm;

  const closedDepotNames = useMemo(() => buildClosedDepotNamesSet(depots), [depots]);

  const filteredOrders = useMemo(() => {
    return filterOrdersByStatusAndSearch(orders, currentUser, {
      statusFilter,
      depotFilter: selectedDepotFilter,
      searchQuery: localSearch || externalSearchQuery,
      canViewAllOrders,
      departments,
      projects,
      hasApproveOrderPerm,
    });
  }, [
    orders,
    currentUser,
    statusFilter,
    selectedDepotFilter,
    localSearch,
    externalSearchQuery,
    canViewAllOrders,
    departments,
    projects,
    hasApproveOrderPerm,
  ]);

  const selectedOrder: MaterialOrder | null = useMemo(() => {
    if (selectedOrderId) {
      const found = filteredOrders.find((o) => o.id === selectedOrderId);
      if (found) return found;
    }
    return filteredOrders[0] || null;
  }, [filteredOrders, selectedOrderId]);

  const canApproveSelected = useMemo(
    () =>
      Boolean(
        selectedOrder &&
          selectedOrder.status === 'WAITING_APPROVAL' &&
          (canApproveOrder(selectedOrder) ||
            canUserApproveOrRejectOrder(
              selectedOrder,
              currentUser,
              departments,
              canManageOrders || hasApproveOrderPerm,
              projects
            ))
      ),
    [
      selectedOrder,
      canApproveOrder,
      currentUser,
      departments,
      canManageOrders,
      hasApproveOrderPerm,
      projects,
    ]
  );

  // Catalog products filtered by selected depot for new order creation
  const catalogProductsForDepot = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    return products
      .filter((p) => {
        const pDepot = (p.store_name || 'Dépôt Principal').trim();
        if (closedDepotNames.has(pDepot.toLowerCase())) return false;
        if (orderDepot && pDepot.toLowerCase() !== orderDepot.toLowerCase()) return false;
        if (!q) return true;
        return `${p.reference} ${p.brand} ${p.model} ${p.description || ''}`
          .toLowerCase()
          .includes(q);
      })
      .slice(0, 80);
  }, [products, catalogSearch, orderDepot, closedDepotNames]);

  const addProductToCart = (prod: Product) => {
    setCartItems((prev) => {
      const existing = prev.find((it) => String(it.product_id) === String(prod.id));
      if (existing) {
        return prev.map((it) =>
          String(it.product_id) === String(prod.id)
            ? { ...it, quantity: it.quantity + 1 }
            : it
        );
      }
      return [
        ...prev,
        {
          product_id: prod.id,
          product_ref: prod.reference,
          product_name: `${prod.brand} ${prod.model}`.trim(),
          quantity: 1,
          unit: 'u',
          unit_price: prod.unit_price,
          brand: prod.brand,
          depot_name: prod.store_name || orderDepot,
          rack_location: prod.rack_location || prod.shelf_name || '',
        },
      ];
    });
  };

  const handleCreateOrderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderSiteNumber.trim() || cartItems.length === 0) return;
    setSubmittingOrder(true);
    try {
      const basketId = createOrderBasket(
        `Cmd ${orderSiteNumber.trim()}`,
        orderDepot,
        orderSiteNumber.trim()
      );
      for (const item of cartItems) {
        const prod = products.find((p) => String(p.id) === String(item.product_id));
        if (prod) {
          addToOrderCart(prod, item.quantity, basketId);
          updateOrderCartQty(prod.id, item.quantity);
        }
      }
      await submitMaterialOrder(
        orderSiteNumber.trim(),
        orderDepot,
        orderNotes.trim() || undefined,
        basketId
      );
      setShowCreateModal(false);
      setCartItems([]);
      setOrderSiteNumber('');
      setOrderNotes('');
    } finally {
      setSubmittingOrder(false);
    }
  };

  const allowedActiveDepots = useMemo(() => {
    return (depots || []).filter(
      (d) =>
        d.is_active !== false &&
        (!currentUser || isUserAllowedForDepot(currentUser, d.name))
    );
  }, [depots, currentUser]);

  return (
    <div className="flex h-full min-h-0 bg-slate-50 dark:bg-slate-950">
      {/* Colonne gauche : liste filtrable des commandes */}
      <div className="w-[420px] shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col min-h-0">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-base font-black text-slate-900 dark:text-white">
                {t('desktop_nav_orders' as any, 'Commandes matériel')}
              </h1>
              <p className="text-[11px] text-slate-500">
                {filteredOrders.length} commande(s)
              </p>
            </div>
            {canCreateOrder && (
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white shadow-xs transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('desktop_new_order' as any, 'Nouvelle commande')}
              </button>
            )}
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              placeholder="N° commande, chantier, demandeur, article..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
            />
          </div>

          <div className="flex flex-wrap gap-1">
            {(
              [
                { id: 'ALL', label: 'Toutes' },
                { id: 'WAITING_APPROVAL', label: 'À valider' },
                { id: 'PENDING', label: 'À préparer' },
                { id: 'PREPARING', label: 'En cours' },
                { id: 'READY', label: 'Prêtes' },
                { id: 'COLLECTED', label: 'Retirées' },
              ] as const
            ).map((st) => (
              <button
                key={st.id}
                type="button"
                onClick={() => setStatusFilter(st.id)}
                className={`px-2 py-1 rounded-md text-[11px] font-bold transition-colors ${
                  statusFilter === st.id
                    ? 'bg-orange-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>
        </div>

        {/* Liste des commandes */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {filteredOrders.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              Aucune commande trouvée.
            </div>
          ) : (
            filteredOrders.map((order) => {
              const badge = STATUS_BADGE[order.status] || STATUS_BADGE.PENDING;
              const isSelected = selectedOrder?.id === order.id;
              return (
                <button
                  key={order.id}
                  type="button"
                  onClick={() => setSelectedOrderId(order.id)}
                  className={`w-full text-left p-3.5 transition-colors flex flex-col gap-1.5 ${
                    isSelected
                      ? 'bg-orange-50/90 dark:bg-orange-950/30 border-l-4 border-l-orange-600'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-black text-slate-900 dark:text-white truncate">
                      {order.order_number}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border shrink-0 ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                    <span className="font-semibold truncate">
                      Chantier : {order.site_number}
                      {order.site_name ? ` (${order.site_name})` : ''}
                    </span>
                    <span className="font-mono text-slate-500">
                      {order.items?.length || 0} réf.
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>
                      {order.requester_name} • {order.depot_name || 'Dépôt Principal'}
                    </span>
                    <span className="font-mono">
                      {order.created_at
                        ? new Date(order.created_at).toLocaleDateString('fr-FR')
                        : ''}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Colonne droite : détail complet de la commande sélectionnée */}
      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto p-6">
        {!selectedOrder ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm">
            <Package className="w-10 h-10 mb-2 opacity-40" />
            Sélectionnez une commande dans la liste à gauche pour afficher ses lignes et actions.
          </div>
        ) : (
          <div className="max-w-5xl mx-auto space-y-5 desktop-printable-order-sheet">
            {/* Carte d'en-tête de commande */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-lg font-black text-slate-900 dark:text-white">
                    {selectedOrder.order_number}
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-md text-xs font-bold border ${
                      (STATUS_BADGE[selectedOrder.status] || STATUS_BADGE.PENDING).className
                    }`}
                  >
                    {(STATUS_BADGE[selectedOrder.status] || STATUS_BADGE.PENDING).label}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Chantier :{' '}
                  <strong className="font-mono">{selectedOrder.site_number}</strong>
                  {selectedOrder.site_name ? ` — ${selectedOrder.site_name}` : ''} • Dépôt :{' '}
                  <strong>{selectedOrder.depot_name || 'Dépôt Principal'}</strong>
                </p>
                <p className="text-xs text-slate-500">
                  Demandeur : <strong>{selectedOrder.requester_name}</strong>
                  {selectedOrder.requester_department
                    ? ` (${selectedOrder.requester_department})`
                    : ''}{' '}
                  • Créée le{' '}
                  {selectedOrder.created_at
                    ? new Date(selectedOrder.created_at).toLocaleString('fr-FR')
                    : '—'}
                </p>
                {selectedOrder.pickup_zone && (
                  <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                    Zone de retrait : {selectedOrder.pickup_zone}
                  </p>
                )}
              </div>

              {/* Actions selon statut et permissions */}
              <div className="flex flex-wrap items-center gap-2 no-print">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Imprimer bon
                </button>

                {canApproveSelected && (
                  <>
                    <button
                      type="button"
                      onClick={() => approveOrder(selectedOrder.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Approuver
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowRejectPrompt(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Refuser
                    </button>
                  </>
                )}

                {(selectedOrder.status === 'PENDING' ||
                  selectedOrder.status === 'PREPARING') &&
                  canManageOrders &&
                  onOpenPreparationForOrder && (
                    <button
                      type="button"
                      onClick={() => onOpenPreparationForOrder(selectedOrder.id)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white shadow-xs"
                    >
                      <ScanBarcode className="w-3.5 h-3.5" />
                      Ouvrir en préparation (Picking)
                    </button>
                  )}

                {selectedOrder.status === 'READY' && canManageOrders && (
                  <button
                    type="button"
                    onClick={() => markOrderCollected(selectedOrder.id)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Marquer retirée
                  </button>
                )}

                {(selectedOrder.status === 'PENDING' ||
                  selectedOrder.status === 'WAITING_APPROVAL') &&
                  (canManageOrders ||
                    String(selectedOrder.requester_id) === String(currentUser?.id)) && (
                    <button
                      type="button"
                      onClick={() => cancelOrder(selectedOrder.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50"
                    >
                      Annuler
                    </button>
                  )}
              </div>
            </div>

            {showRejectPrompt && canApproveSelected && (
              <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-center gap-3 no-print">
                <input
                  type="text"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Motif du refus..."
                  className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-rose-300 bg-white dark:bg-slate-900"
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (!rejectReason.trim()) return;
                    await rejectOrder(selectedOrder.id, rejectReason.trim());
                    setShowRejectPrompt(false);
                    setRejectReason('');
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600 text-white"
                >
                  Confirmer le refus
                </button>
                <button
                  type="button"
                  onClick={() => setShowRejectPrompt(false)}
                  className="px-2 py-1.5 text-xs text-slate-500"
                >
                  Annuler
                </button>
              </div>
            )}

            {/* Tableau des lignes de la commande */}
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <h2 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Lignes de la commande ({selectedOrder.items?.length || 0})
                </h2>
                {canViewPrices && selectedOrder.total_cost !== undefined && (
                  <span className="font-mono text-xs font-black text-slate-900 dark:text-white">
                    Total HT : {formatCurrency(selectedOrder.total_cost)}
                  </span>
                )}
              </div>
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-[11px] font-bold uppercase text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2.5 px-4">Référence</th>
                    <th className="py-2.5 px-4">Désignation</th>
                    <th className="py-2.5 px-4">Emplacement</th>
                    <th className="py-2.5 px-4 text-right">Demandé</th>
                    <th className="py-2.5 px-4 text-right">Préparé</th>
                    <th className="py-2.5 px-4">Statut ligne</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(selectedOrder.items || []).map((it, idx) => {
                    const pickedQty =
                      it.picked_quantity !== undefined
                        ? it.picked_quantity
                        : it.picked
                        ? it.quantity
                        : 0;
                    return (
                      <tr key={`${it.product_id}-${idx}`}>
                        <td className="py-2.5 px-4 font-mono font-bold text-slate-900 dark:text-white">
                          {it.product_ref}
                          {it.substituted && it.substituted_with_ref && (
                            <div className="text-[10px] text-orange-600">
                              Remplacé par : {it.substituted_with_ref}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-slate-700 dark:text-slate-200">
                          {it.product_name}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500">
                          {it.rack_location || '—'}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold">
                          {it.quantity} {it.unit || 'u'}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                          {pickedQty}
                        </td>
                        <td className="py-2.5 px-4">
                          {it.unavailable ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-600">
                              <AlertTriangle className="w-3.5 h-3.5" /> Manquant
                            </span>
                          ) : it.picked ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Pointé
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                              <Clock className="w-3.5 h-3.5" /> En attente
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Fenêtre de création de commande en 2 colonnes (Catalogue à gauche, Panier à droite) */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-6">
          <div className="w-full max-w-5xl h-[82vh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-base font-black text-slate-900 dark:text-white">
                  {t('desktop_new_order' as any, 'Nouvelle commande matériel')}
                </h2>
                <p className="text-xs text-slate-500">
                  Sélectionnez le dépôt et le chantier, puis ajoutez les articles au panier à droite
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-12 divide-x divide-slate-200 dark:divide-slate-800">
              {/* Colonne gauche : recherche dans le catalogue du dépôt */}
              <div className="col-span-7 flex flex-col min-h-0 p-4 gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                      Dépôt de retrait (mono-dépôt)
                    </label>
                    <select
                      value={orderDepot}
                      onChange={(e) => {
                        setOrderDepot(e.target.value);
                        setCartItems([]);
                      }}
                      className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    >
                      <option value="Dépôt Principal">Dépôt Principal</option>
                      {allowedActiveDepots.map((d) => (
                        <option key={String(d.id)} value={d.name}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                      Rechercher un article
                    </label>
                    <input
                      type="text"
                      value={catalogSearch}
                      onChange={(e) => setCatalogSearch(e.target.value)}
                      placeholder="Référence, marque, modèle..."
                      className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800">
                  {catalogProductsForDepot.map((prod) => (
                    <div
                      key={prod.id}
                      className="p-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-mono font-bold text-slate-900 dark:text-white">
                          {prod.reference}
                        </div>
                        <div className="text-slate-600 dark:text-slate-300 truncate">
                          {prod.brand} {prod.model}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Dispo : <span className="font-mono font-bold">{prod.quantity}</span>
                          {prod.rack_location ? ` • Casier ${prod.rack_location}` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => addProductToCart(prod)}
                        className="px-2.5 py-1 rounded-lg text-xs font-bold bg-orange-50 text-orange-700 hover:bg-orange-600 hover:text-white transition-colors shrink-0"
                      >
                        + Ajouter
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Colonne droite : Panier et validation chantier */}
              <form
                onSubmit={handleCreateOrderSubmit}
                className="col-span-5 flex flex-col min-h-0 p-4 gap-3 bg-slate-50/50 dark:bg-slate-950/40"
              >
                <div className="text-xs">
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    N° Chantier / Projet *
                  </label>
                  <input
                    type="text"
                    required
                    list="desktop-order-projects"
                    value={orderSiteNumber}
                    onChange={(e) => setOrderSiteNumber(e.target.value)}
                    placeholder="Ex: CH-2026-04"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                  />
                  <datalist id="desktop-order-projects">
                    {projects.map((p) => (
                      <option key={p.id} value={p.project_number}>
                        {p.project_name}
                      </option>
                    ))}
                  </datalist>
                </div>

                <div className="flex-1 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
                  {cartItems.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-xs text-slate-400 p-6 text-center">
                      <ShoppingCart className="w-8 h-8 mb-2 opacity-40" />
                      Votre panier de commande est vide. Cliquez sur « + Ajouter » à gauche.
                    </div>
                  ) : (
                    cartItems.map((item) => (
                      <div
                        key={String(item.product_id)}
                        className="p-2.5 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-mono font-bold text-slate-900 dark:text-white">
                            {item.product_ref}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {item.product_name}
                          </div>
                        </div>
                        <input
                          type="number"
                          min={1}
                          value={item.quantity}
                          onChange={(e) => {
                            const q = Math.max(1, Number(e.target.value) || 1);
                            setCartItems((prev) =>
                              prev.map((it) =>
                                String(it.product_id) === String(item.product_id)
                                  ? { ...it, quantity: q }
                                  : it
                              )
                            );
                          }}
                          className="w-16 px-2 py-1 text-right font-mono font-bold rounded border border-slate-200 dark:border-slate-700"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setCartItems((prev) =>
                              prev.filter((it) => String(it.product_id) !== String(item.product_id))
                            )
                          }
                          className="p-1 text-slate-400 hover:text-rose-600"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <input
                  type="text"
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                  placeholder="Instructions ou commentaire pour le magasinier..."
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-200"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={cartItems.length === 0 || !orderSiteNumber.trim() || submittingOrder}
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white"
                  >
                    Envoyer la commande ({cartItems.length})
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
