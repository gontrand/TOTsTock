import React from 'react';
import { useApp } from '../context/AppContext';
import { Home, Search, ArrowLeftRight, MoreHorizontal, Plus } from 'lucide-react';
import { requestGuardedNavigation } from '../services/unsavedChangesGuard';
import { getTargetedOrderNotificationsForUser } from '../services/notificationService';

export const BottomNav: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    actionSheetOpen,
    setActionSheetOpen,
    userHasPermission,
    currentUser,
    orders,
    orderCart,
    depots,
    depotHolders,
    departments,
    projects,
    roles,
    users,
    dismissedNotificationKeys,
    isPreparer,
    t,
  } = useApp();

  if (!currentUser) return null;

  const handleSelectTab = (tab: typeof activeTab) => {
    if (tab === activeTab) return;
    requestGuardedNavigation(() => {
      setActiveTab(tab);
    });
  };

  const canHomeTab = userHasPermission('perm_tab_dashboard') || userHasPermission('perm_dash_kpi');
  const canSearchTab = userHasPermission('perm_tab_inventory') || userHasPermission('perm_prod_view');
  const canMovementsTab = userHasPermission('perm_tab_movements') || userHasPermission('perm_mov_tabs');
  const canPlusTab = true; // Toujours visible pour permettre l'accès aux options, profil et administration selon les droits
  const showCenterBtn = userHasPermission('perm_btn_center_show');

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
  const showCenterBadge = (isPreparer && pendingPrepCount > 0) || userHasReadyOrder || orderCart.length > 0;

  return (
    <nav className="fixed bottom-0 left-0 right-0 max-w-[480px] mx-auto z-40 bg-white/95 dark:bg-[#1e293b]/95 backdrop-blur-md text-slate-700 dark:text-slate-300 flex items-center justify-around h-[calc(60px+env(safe-area-inset-bottom,0px))] pb-[env(safe-area-inset-bottom,0px)] border-t border-slate-200/90 dark:border-slate-800 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] dark:shadow-[0_-4px_20px_rgba(0,0,0,0.35)] select-none transition-colors duration-200 overflow-visible">
      {/* Home Tab */}
      {!canHomeTab && <div className="flex-1 min-w-0" aria-hidden="true" />}
      {canHomeTab && (
        <button
          type="button"
          onClick={() => handleSelectTab('home')}
          className={`flex flex-col items-center justify-center flex-1 min-w-0 overflow-hidden relative h-full py-1 transition-all cursor-pointer active:scale-95 ${
            activeTab === 'home'
              ? 'text-orange-600 dark:text-orange-500 font-extrabold'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
          }`}
        >
          <div className={`p-1 rounded-xl transition shrink-0 relative z-20 ${activeTab === 'home' ? 'bg-orange-50 dark:bg-orange-950/50' : ''}`}>
            <Home className="w-5 h-5 stroke-[2.2] shrink-0 relative z-20" />
          </div>
          <span className="text-[10px] mt-0.5 font-bold tracking-tight whitespace-nowrap relative z-10">{t('nav_home')}</span>
        </button>
      )}

      {/* Search / Inventory Tab */}
      {!canSearchTab && <div className="flex-1 min-w-0" aria-hidden="true" />}
      {canSearchTab && (
        <button
          type="button"
          onClick={() => handleSelectTab('search')}
          className={`flex flex-col items-center justify-center flex-1 min-w-0 overflow-hidden relative h-full py-1 transition-all cursor-pointer active:scale-95 ${
            activeTab === 'search'
              ? 'text-orange-600 dark:text-orange-500 font-extrabold'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
          }`}
        >
          <div className={`p-1 rounded-xl transition shrink-0 relative z-20 ${activeTab === 'search' ? 'bg-orange-50 dark:bg-orange-950/50' : ''}`}>
            <Search className="w-5 h-5 stroke-[2.2] shrink-0 relative z-20" />
          </div>
          <span className="text-[10px] mt-0.5 font-bold tracking-tight whitespace-nowrap relative z-10">{t('nav_search')}</span>
        </button>
      )}

      {/* Central Quick Action Button */}
      {showCenterBtn ? (
        <div className="flex justify-center items-center flex-1 min-w-0 relative z-30 h-full overflow-visible">
          <div className="relative -mt-5 flex items-center justify-center overflow-visible">
            {/* Halo lumineux animé en arrière-plan */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-2xl bg-orange-500/45 dark:bg-orange-400/40 animate-center-halo"
            />
            <button
              type="button"
              onClick={() =>
                requestGuardedNavigation(() => {
                  setActionSheetOpen(!actionSheetOpen);
                })
              }
              title={t('nav_scan_movement')}
              data-haptic="heavy"
              className={`group relative z-30 shrink-0 w-[52px] h-[52px] rounded-2xl bg-gradient-to-tr from-orange-600 via-orange-500 to-amber-400 hover:from-orange-500 hover:to-amber-300 text-white flex items-center justify-center shadow-lg shadow-orange-500/40 border-[3px] border-white dark:border-[#1e293b] hover:scale-105 active:scale-90 transition-all duration-300 cursor-pointer ring-2 ring-orange-500/25 overflow-visible animate-center-fab ${
                actionSheetOpen ? 'scale-105 from-rose-600 via-orange-600 to-amber-500' : ''
              }`}
            >
              <Plus
                className={`w-6 h-6 text-white stroke-[3.2] shrink-0 relative z-20 transition-transform duration-300 ease-out ${
                  actionSheetOpen ? 'rotate-45 scale-110' : 'group-hover:rotate-90'
                }`}
              />
              {showCenterBadge && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 z-30 pointer-events-none">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    userHasReadyOrder ? 'bg-emerald-400' : 'bg-orange-400'
                  }`} />
                  <span className={`relative inline-flex rounded-full h-4 w-4 border-2 border-white dark:border-[#1e293b] ${
                    userHasReadyOrder ? 'bg-emerald-500' : 'bg-orange-500'
                  }`} />
                </span>
              )}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-w-0" />
      )}

      {/* Movements Tab */}
      {!canMovementsTab && <div className="flex-1 min-w-0" aria-hidden="true" />}
      {canMovementsTab && (
        <button
          type="button"
          onClick={() => handleSelectTab('movements')}
          className={`flex flex-col items-center justify-center flex-1 min-w-0 overflow-hidden relative h-full py-1 transition-all cursor-pointer active:scale-95 ${
            activeTab === 'movements'
              ? 'text-orange-600 dark:text-orange-500 font-extrabold'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
          }`}
        >
          <div className={`p-1 rounded-xl transition shrink-0 relative z-20 ${activeTab === 'movements' ? 'bg-orange-50 dark:bg-orange-950/50' : ''}`}>
            <ArrowLeftRight className="w-5 h-5 stroke-[2.2] shrink-0 relative z-20" />
          </div>
          <span className="text-[10px] mt-0.5 font-bold tracking-tight whitespace-nowrap relative z-10">{t('nav_movements')}</span>
        </button>
      )}

      {/* More Tab */}
      {canPlusTab && (
        <button
          type="button"
          onClick={() => handleSelectTab('plus')}
          className={`flex flex-col items-center justify-center flex-1 min-w-0 overflow-hidden relative h-full py-1 transition-all cursor-pointer active:scale-95 ${
            activeTab === 'plus'
              ? 'text-orange-600 dark:text-orange-500 font-extrabold'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
          }`}
        >
          <div className={`p-1 rounded-xl transition shrink-0 relative z-20 ${activeTab === 'plus' ? 'bg-orange-50 dark:bg-orange-950/50' : ''}`}>
            <MoreHorizontal className="w-5 h-5 stroke-[2.2] shrink-0 relative z-20" />
          </div>
          <span className="text-[10px] mt-0.5 font-bold tracking-tight whitespace-nowrap relative z-10">{t('nav_plus')}</span>
        </button>
      )}
    </nav>
  );
};
