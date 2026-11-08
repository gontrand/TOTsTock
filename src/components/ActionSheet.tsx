import React from 'react';
import { tr } from '../i18n/dutchTranslator';
import { useApp } from '../context/AppContext';
import { getUserVehicles } from '../utils/crypto';
import { getTargetedOrderNotificationsForUser } from '../services/notificationService';
import {
  X,
  ArrowDownCircle,
  ArrowUpCircle,
  PlusCircle,
  Camera,
  ShoppingCart,
  Package,
  CheckCircle2,
  ArrowLeftRight,
} from 'lucide-react';

export const ActionSheet: React.FC = () => {
  const {
    actionSheetOpen,
    setActionSheetOpen,
    setScanState,
    setProductFormState,
    userHasPermission,
    orders,
    orderCart,
    setOrderCartModalOpen,
    setPreparerOrdersModalOpen,
    isPreparer,
    currentUser,
    depots,
    depotHolders,
    departments,
    projects,
    roles,
    users,
    dismissedNotificationKeys,
    canTransferBetweenDepots,
    openStockTransferModal,
    language,
    t,
  } = useApp();

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && actionSheetOpen) {
        setActionSheetOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [actionSheetOpen, setActionSheetOpen]);

  if (!actionSheetOpen) return null;

  const userVehicles = getUserVehicles(currentUser, depots);
  const hasAssignedVehicle = userVehicles.length > 0;

  const canOut = userHasPermission('perm_mov_out');
  const hasGeneralStockIn = userHasPermission('perm_stock_in');
  const isDeptMgr = departments?.some((d) =>
    (d.manager_id && String(d.manager_id) === String(currentUser?.id)) ||
    (d.deputy_manager_ids && Array.isArray(d.deputy_manager_ids) && d.deputy_manager_ids.some((id) => String(id) === String(currentUser?.id)))
  );
  // Technicians can enter stock specifically into their vehicle, and managers into their department vehicles
  const canIn = hasGeneralStockIn || hasAssignedVehicle || isDeptMgr;
  const canCreate = userHasPermission('perm_action_create_prod') || userHasPermission('perm_prod_edit');
  const canOrderPrep = isPreparer || userHasPermission('perm_menu_order_prep');

  const targetedOrderNotifs = getTargetedOrderNotificationsForUser({
    user: currentUser,
    orders,
    users,
    departments,
    projects,
    depots,
    depotHolders,
    roles,
    dismissedKeys: dismissedNotificationKeys,
  });
  const pendingPrepCount = targetedOrderNotifs.filter(
    (n) => n.notificationType === 'ORDER_PENDING_PREP'
  ).length;
  const userHasReadyOrder = targetedOrderNotifs.some(
    (n) =>
      n.notificationType === 'ORDER_READY' ||
      n.notificationType === 'ORDER_PICKUP_DELEGATED'
  );

  const handleOpenScan = (mode: 'OUT' | 'IN') => {
    setActionSheetOpen(false);
    setScanState({ open: true, mode });
  };

  const handleOpenCreateProduct = () => {
    setActionSheetOpen(false);
    setProductFormState({ open: true, product: null });
  };

  const handleOpenOrderCart = () => {
    setActionSheetOpen(false);
    setOrderCartModalOpen(true);
  };

  const handleOpenOrderPrep = () => {
    setActionSheetOpen(false);
    setPreparerOrdersModalOpen(true);
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setActionSheetOpen(false);
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/75 backdrop-blur-sm animate-fadeIn"
    >
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 pb-[max(env(safe-area-inset-bottom,0px),20px)] sm:pb-5 text-slate-800 dark:text-slate-100 flex flex-col overflow-hidden animate-slideUp">
        {/* Mobile Pull Handle Indicator */}
        <div className="w-10 h-1 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mb-2 sm:hidden shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800 relative overflow-hidden">
          <h2 className="text-sm font-black text-slate-900 dark:text-white min-w-0 flex-1 relative z-10">
            {t('action_title')}
          </h2>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setActionSheetOpen(false);
            }}
            className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer active:scale-95 shadow-xs shrink-0 relative z-20"
            title={t('common_close')}
            aria-label="Fermer"
          >
            <X className="w-4 h-4 stroke-[2.5] shrink-0 relative z-20" />
          </button>
        </div>

        {/* Buttons */}
        <div className="py-4 space-y-2.5">
          {/* Warehouse Order Preparation Button (Storekeeper / Preparer) */}
          {canOrderPrep && (
            <button
              onClick={handleOpenOrderPrep}
              className="w-full p-3.5 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-extrabold text-sm flex items-center justify-between gap-2 shadow-lg shadow-blue-500/25 transition active:scale-[0.98] cursor-pointer relative overflow-hidden"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0 relative z-20">
                  <Package className="w-5 h-5 text-white shrink-0 relative z-20" />
                </div>
                <div className="text-left min-w-0 flex-1 relative z-0 overflow-hidden">
                  <div className="leading-tight flex items-center gap-2 flex-wrap">
                    <span>{tr(language, 'Préparation des Commandes', 'Order Fulfillment')}</span>
                    {pendingPrepCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-orange-500 text-white animate-pulse shrink-0">
                        {pendingPrepCount} {tr(language, 'en attente', 'pending')}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-medium text-blue-100">
                    {tr(language, 'Assignation, pointage bac & mise en prête', 'Pick, pack & ready orders')}
                  </div>
                </div>
              </div>
              <span className="px-2 py-1 rounded-lg bg-white/20 text-white text-[11px] font-bold shrink-0 relative z-20">
                {tr(language, 'Ouvrir', 'Open')}
              </span>
            </button>
          )}

          {/* Material Order Basket & Follow-up Button (Requester) */}
          <button
            onClick={handleOpenOrderCart}
            className={`w-full p-3.5 rounded-2xl font-extrabold text-sm flex items-center justify-between gap-2 transition active:scale-[0.98] cursor-pointer shadow-md relative overflow-hidden ${
              userHasReadyOrder
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-emerald-500/25 ring-2 ring-emerald-400 animate-pulse'
                : 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-orange-500/25'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0 relative z-20">
                <ShoppingCart className="w-5 h-5 text-white shrink-0 relative z-20" />
              </div>
              <div className="text-left min-w-0 flex-1 relative z-0 overflow-hidden">
                <div className="leading-tight flex items-center gap-2 flex-wrap">
                  <span>{tr(language, 'Mon Panier & Suivi Commandes', 'My Orders & Cart')}</span>
                  {userHasReadyOrder ? (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-white text-emerald-700 shrink-0">
                      🎉 {tr(language, 'Prête au retrait !', 'Ready for pickup!')}
                    </span>
                  ) : orderCart.length > 0 ? (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-white text-orange-700 shrink-0">
                      {orderCart.length} {tr(language, 'art.', 'items')}
                    </span>
                  ) : null}
                </div>
                <div className="text-[11px] font-medium text-white/90">
                  {userHasReadyOrder
                    ? tr(language, 'Commande prête à retirer avec QR code', 'Order ready for QR pickup')
                    : tr(language, 'Commander du matériel & suivre mes demandes', 'Request materials & track status')}
                </div>
              </div>
            </div>
            <span className="px-2 py-1 rounded-lg bg-white/20 text-white text-[11px] font-bold shrink-0 relative z-20">
              {tr(language, 'Accéder', 'Go')}
            </span>
          </button>

          {canOut && (
            <button
              onClick={() => handleOpenScan('OUT')}
              className="w-full p-4 rounded-2xl bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white font-extrabold text-sm flex items-center justify-between gap-2 shadow-lg shadow-rose-500/25 transition active:scale-[0.98] cursor-pointer relative overflow-hidden"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0 relative z-20">
                  <ArrowDownCircle className="w-6 h-6 shrink-0 relative z-20" />
                </div>
                <div className="text-left min-w-0 flex-1 relative z-0 overflow-hidden">
                  <div className="leading-tight">{t('action_out_title')}</div>
                  <div className="text-[11px] font-medium text-rose-100">
                    {t('action_out_desc')}
                  </div>
                </div>
              </div>
              <Camera className="w-5 h-5 text-white/80 shrink-0 relative z-20" />
            </button>
          )}

          {canIn && (
            <button
              onClick={() => handleOpenScan('IN')}
              className="w-full p-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white font-extrabold text-sm flex items-center justify-between gap-2 shadow-lg shadow-emerald-500/25 transition active:scale-[0.98] cursor-pointer relative overflow-hidden"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0 relative z-20">
                  <ArrowUpCircle className="w-6 h-6 shrink-0 relative z-20" />
                </div>
                <div className="text-left min-w-0 flex-1 relative z-0 overflow-hidden">
                  <div className="leading-tight flex items-center gap-1.5 flex-wrap">
                    <span>
                      {!hasGeneralStockIn && hasAssignedVehicle
                        ? tr(language, 'Entrée Stock Camionnette', 'Vehicle Stock Entry')
                        : t('action_in_title')}
                    </span>
                    {!hasGeneralStockIn && hasAssignedVehicle && (
                      <span className="px-1.5 py-0.5 rounded-md text-[10px] font-black bg-white/25 text-white shrink-0">
                        🚐 {userVehicles[0].name}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-medium text-emerald-100">
                    {!hasGeneralStockIn && hasAssignedVehicle
                      ? tr(language, `Approvisionnement / retour chantier dans votre véhicule (${userVehicles[0].name})`, `Material return / inflow to your vehicle (${userVehicles[0].name})`)
                      : t('action_in_desc')}
                  </div>
                </div>
              </div>
              <Camera className="w-5 h-5 text-white/80 shrink-0 relative z-20" />
            </button>
          )}

          {canTransferBetweenDepots && (
            <button
              type="button"
              data-testid="action-sheet-transfer-btn"
              onClick={() => {
                setActionSheetOpen(false);
                openStockTransferModal({});
              }}
              className="w-full p-4 rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white font-extrabold text-sm flex items-center justify-between gap-2 shadow-lg shadow-sky-500/25 transition active:scale-[0.98] cursor-pointer relative overflow-hidden"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0 relative z-20">
                  <ArrowLeftRight className="w-6 h-6 shrink-0 relative z-20" />
                </div>
                <div className="text-left min-w-0 flex-1 relative z-0 overflow-hidden">
                  <div className="leading-tight">
                    {tr(
                      language,
                      'Transfert entre dépôts',
                      'Inter-depot transfer',
                      'Overdracht tussen depots'
                    )}
                  </div>
                  <div className="text-[11px] font-medium text-sky-100">
                    {tr(
                      language,
                      'Déplacer un ou plusieurs articles vers un autre magasin ou camionnette',
                      'Move one or more items to another warehouse or vehicle',
                      'Verplaats een of meer artikelen naar een ander magazijn of voertuig'
                    )}
                  </div>
                </div>
              </div>
              <ArrowLeftRight className="w-5 h-5 text-white/80 shrink-0 relative z-20" />
            </button>
          )}

          {canCreate && (
            <button
              onClick={handleOpenCreateProduct}
              className="w-full p-3.5 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-bold text-xs flex items-center gap-3 transition cursor-pointer relative overflow-hidden"
            >
              <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-950 text-blue-600 flex items-center justify-center shrink-0 relative z-20">
                <PlusCircle className="w-4 h-4 shrink-0 relative z-20" />
              </div>
              <div className="text-left min-w-0 flex-1 relative z-10 overflow-hidden">
                <div className="leading-tight font-extrabold">{t('action_create_title')}</div>
                <div className="text-[10px] text-slate-400">{t('action_create_desc')}</div>
              </div>
            </button>
          )}
        </div>

        <button
          onClick={() => setActionSheetOpen(false)}
          className="w-full py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500 font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
        >
          {t('common_cancel')}
        </button>
      </div>
    </div>
  );
};
