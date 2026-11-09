import React, { useState, useEffect } from 'react';
import { tr } from '../i18n/dutchTranslator';
import { useApp } from '../context/AppContext';
import { PLAN_LABELS, normalizeToCanonicalPlan } from '../types';
import {
  computeTargetedBellBadgeCount,
  getTargetedOrderNotificationsForUser,
} from '../services/notificationService';
import { NO_AUTH_SESSION_BANNER_MESSAGE } from '../services/clientSupabase';
import {
  Database,
  RefreshCw,
  AlertCircle,
  LogOut,
  Wifi,
  WifiOff,
  CheckCircle2,
  HardDrive,
  Cloud,
  ShieldCheck,
  X,
  ExternalLink,
  Info,
  Sun,
  Moon,
  Bell,
  ShoppingCart,
  Package,
} from 'lucide-react';

export const Header: React.FC = () => {
  const {
    theme,
    toggleTheme,
    setAppInfoModalOpen,
    setNotificationsModalOpen,
    setCompanySetupModalOpen,
    supabaseSyncStatus,
    supabaseSyncMessage,
    syncFromSupabase,
    products,
    depots,
    departments,
    projects,
    depotHolders,
    transfers,
    movements,
    license,
    userHasPermission,
    currentUser,
    logout,
    language,
    toggleLanguage,
    t,
    orders,
    orderCart,
    setOrderCartModalOpen,
    setPreparerOrdersModalOpen,
    setTransfersModalOpen,
    transfersToReturn,
    isPreparer,
    appLogoUrl,
    rejectedSyncOps,
    retryRejectedMovement,
    discardRejectedMovement,
    roles,
    users,
    dismissedNotificationKeys,
    isSupabaseConnected,
    hasAuthSession,
  } = useApp();

  const canManageConfig = !currentUser || userHasPermission('perm_config_license') || userHasPermission('perm_config_db');

  const targetedBellCount = computeTargetedBellBadgeCount({
    user: currentUser,
    orders,
    transfers,
    products,
    users,
    departments,
    projects,
    depots,
    depotHolders,
    roles,
    hasReceiveAllPerm: userHasPermission('perm_stock_receive_all'),
    dismissedKeys: dismissedNotificationKeys,
  });

  // Real-time network connectivity tracking
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  });

  const [lastSyncTime, setLastSyncTime] = useState<string>(() => {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  });

  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [isManualSyncing, setIsManualSyncing] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (supabaseSyncStatus !== 'idle') {
        syncFromSupabase();
      }
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [supabaseSyncStatus, syncFromSupabase]);

  // Update last sync time when supabase finishes syncing
  useEffect(() => {
    if (supabaseSyncStatus === 'connected') {
      setLastSyncTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }
  }, [supabaseSyncStatus]);

  // Close modal on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isSyncModalOpen) {
        setIsSyncModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSyncModalOpen]);

  const handleManualSync = async () => {
    if (isManualSyncing) return;
    setIsManualSyncing(true);
    try {
      await syncFromSupabase();
      setLastSyncTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } finally {
      setIsManualSyncing(false);
    }
  };

  // Determine current unified status
  const currentStatus = !isOnline
    ? 'offline'
    : supabaseSyncStatus === 'syncing' || isManualSyncing
    ? 'syncing'
    : supabaseSyncStatus === 'connected'
    ? 'connected'
    : supabaseSyncStatus === 'error'
    ? 'error'
    : 'local';

  const canLogout = userHasPermission('perm_header_logout');
  const canAppInfo = !currentUser || userHasPermission('perm_header_app_info');
  const canLang = true;
  const canTheme = true;
  const canNotifications = userHasPermission('perm_header_notifications');
  const canSyncDetails = true;
  const canLicenseBadge = true;

  const canCreateOrder = true; // Tout le monde est demandeur par défaut
  const canOrderPrep = isPreparer || userHasPermission('perm_menu_order_prep');

  const targetedOrderNotifs = getTargetedOrderNotificationsForUser({
    orders,
    user: currentUser,
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

  return (
    <>
    <header className="sticky top-0 z-30 w-full max-w-full overflow-hidden flex items-center justify-between gap-1 px-2.5 sm:px-4 py-2 bg-white dark:bg-[#1e293b] text-slate-800 dark:text-white shadow-sm dark:shadow-md border-b border-slate-200/90 dark:border-slate-800 min-h-[56px] select-none transition-colors duration-200 relative">
      <div className="flex items-center gap-1 sm:gap-2 min-w-0 flex-1 overflow-hidden relative z-10">
        <div className="flex items-center gap-1.5 shrink-0 relative z-20">
          {appLogoUrl && (
            <div className="w-7 h-7 rounded-lg bg-white p-0.5 flex items-center justify-center border border-slate-200 dark:border-slate-300 shadow-2xs shrink-0 overflow-hidden relative z-20">
              <img
                src={appLogoUrl}
                alt="TOT"
                className="w-full h-full object-contain"
              />
            </div>
          )}
          <div className="text-lg sm:text-xl font-black tracking-wider text-slate-900 dark:text-white flex items-center shrink-0 relative z-20">
            TOT<span className="text-orange-500 font-extrabold text-xl sm:text-2xl leading-none">.</span>
          </div>
        </div>

        {/* License Plan Pill */}
        {(() => {
          const canonicalPlan = normalizeToCanonicalPlan(license?.plan || license?.plan_type, license?.license_key);
          const planLabel = PLAN_LABELS[canonicalPlan];
          return canManageConfig && canLicenseBadge ? (
            <button
              type="button"
              onClick={() => setCompanySetupModalOpen(true)}
              title={tr(language, `Forfait ${planLabel} - ${license?.organization_name || 'Organisation Locale'}`, `Plan ${planLabel} - ${license?.organization_name || 'Local Organization'}`)}
              className={`px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-1 border transition cursor-pointer shrink-0 relative z-10 ${
                canonicalPlan === 'sta'
                  ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30 hover:bg-blue-500/25'
                  : canonicalPlan === 'pro'
                  ? 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30 hover:bg-orange-500/25'
                  : canonicalPlan === 'ent'
                  ? 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30 hover:bg-purple-500/25'
                  : 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/25 hover:bg-slate-500/20'
              }`}
            >
              <span className="whitespace-nowrap">{planLabel}</span>
            </button>
          ) : (
            <div
              title={tr(language, `Forfait ${planLabel}`, `Plan ${planLabel}`)}
              className="px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-1 border border-slate-200/60 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 select-none shrink-0 relative z-10"
            >
              <span className="whitespace-nowrap">{planLabel}</span>
            </div>
          );
        })()}

        {/* Synchronization & Data Availability Visual Indicator Badge */}
        {canSyncDetails ? (
          <button
            type="button"
            onClick={() => setIsSyncModalOpen(true)}
            title={
              !isOnline
                ? tr(language, 'Hors-ligne • Stockage local actif (Cliquez pour détails)', 'Offline • Local storage active (Click for details)')
                : currentStatus === 'connected'
                ? tr(language, 'En ligne • Synchronisé avec la base Supabase (Cliquez pour détails)', 'Online • Synced with Supabase database (Click for details)')
                : currentStatus === 'syncing'
                ? tr(language, 'Synchronisation en cours...', 'Syncing in progress...')
                : currentStatus === 'error'
                ? tr(language, 'Erreur de synchronisation (Cliquez pour détails)', 'Sync error (Click for details)')
                : tr(language, 'Mode stockage local (Cliquez pour détails)', 'Local storage mode (Click for details)')
            }
            className={`px-2 sm:px-2.5 py-1 rounded-full text-[10px] sm:text-[11px] font-bold flex items-center gap-1.5 transition-all border cursor-pointer active:scale-95 shadow-2xs min-w-0 overflow-hidden relative z-10 ${
              rejectedSyncOps.length > 0
                ? 'bg-rose-500/15 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/35 hover:bg-rose-500/25'
                : currentStatus === 'connected'
                ? 'bg-emerald-500/15 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/35 hover:bg-emerald-500/25'
                : currentStatus === 'syncing'
                ? 'bg-amber-500/15 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/35 hover:bg-amber-500/25'
                : currentStatus === 'offline'
                ? 'bg-amber-500/15 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                : currentStatus === 'error'
                ? 'bg-rose-500/15 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/35 hover:bg-rose-500/25'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            {rejectedSyncOps.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-rose-600 text-white text-[9px] font-black">
                {rejectedSyncOps.length}
              </span>
            )}
            {/* Beacon Dot & Icon */}
            {currentStatus === 'connected' && (
              <>
                <span className="relative flex h-2 w-2 shrink-0 z-20">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <Wifi className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0 relative z-20" />
                <span className="hidden xs:inline whitespace-nowrap relative z-0">
                  {t('header_sync_online')}
                </span>
              </>
            )}

            {currentStatus === 'syncing' && (
              <>
                <RefreshCw className="w-3 h-3 animate-spin text-amber-600 dark:text-amber-300 shrink-0 relative z-20" />
                <span className="hidden xs:inline whitespace-nowrap relative z-0">
                  {t('header_syncing')}
                </span>
              </>
            )}

            {currentStatus === 'offline' && (
              <>
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0 relative z-20"></span>
                <WifiOff className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0 relative z-20" />
                <span className="font-extrabold whitespace-nowrap relative z-0">
                  {t('header_sync_offline')}
                </span>
              </>
            )}

            {currentStatus === 'error' && (
              <>
                <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0 relative z-20"></span>
                <AlertCircle className="w-3 h-3 text-rose-600 dark:text-rose-300 shrink-0 relative z-20" />
                <span className="hidden xs:inline whitespace-nowrap relative z-0">
                  {t('header_error')}
                </span>
              </>
            )}

            {currentStatus === 'local' && (
              <>
                <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0 relative z-20"></span>
                <Database className="w-3 h-3 text-slate-500 dark:text-slate-400 shrink-0 relative z-20" />
                <span className="hidden xs:inline whitespace-nowrap relative z-0">
                  {t('header_local')}
                </span>
              </>
            )}
          </button>
        ) : (
          <div
            className={`px-2 sm:px-2.5 py-1 rounded-full text-[10px] sm:text-[11px] font-bold flex items-center gap-1.5 border shadow-2xs min-w-0 overflow-hidden select-none relative z-10 ${
              currentStatus === 'connected'
                ? 'bg-emerald-500/15 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/35'
                : currentStatus === 'offline'
                ? 'bg-amber-500/15 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-500/40'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
            }`}
          >
            {currentStatus === 'connected' ? (
              <Wifi className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0 relative z-20" />
            ) : (
              <WifiOff className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0 relative z-20" />
            )}
            <span className="hidden xs:inline whitespace-nowrap relative z-0">
              {currentStatus === 'connected' ? t('header_sync_online') : t('header_sync_offline')}
            </span>
          </div>
        )}
      </div>

      {/* Right Action Icons - Fixed Position & Top Z-Layer */}
      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 relative z-20 bg-white dark:bg-[#1e293b] pl-1">
        {currentUser && canLogout && (
          <button
            type="button"
            onClick={logout}
            title={`${t('header_connected')} : ${currentUser.name}`}
            className="flex items-center gap-1 px-2 py-1.5 rounded-full text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 border border-rose-200 dark:border-rose-900/50 transition cursor-pointer active:scale-95 shrink-0 relative z-20"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0 relative z-20" />
            <span className="hidden md:inline whitespace-nowrap relative z-10">{t('header_logout')}</span>
          </button>
        )}

        {canAppInfo && (
          <button
            type="button"
            onClick={() => setAppInfoModalOpen(true)}
            title={t('header_app_info')}
            className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700 transition active:scale-90 cursor-pointer shadow-2xs shrink-0 relative z-20"
          >
            <Info className="w-3.5 h-3.5 shrink-0 relative z-20" />
          </button>
        )}

        {canLang && (
          <button
            type="button"
            onClick={toggleLanguage}
            title={
              language === 'fr'
                ? 'Switch to English (EN)'
                : language === 'en'
                  ? 'Overschakelen naar Nederlands (NL)'
                  : 'Passer en Français (FR)'
            }
            className="h-8 px-2 rounded-full flex items-center gap-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700 transition text-[11px] font-black active:scale-95 shadow-2xs cursor-pointer shrink-0 relative z-20"
          >
            <span className="text-xs leading-none shrink-0 relative z-20">
              {language === 'fr' ? '🇫🇷' : language === 'en' ? '🇬🇧' : '🇳🇱'}
            </span>
            <span className="text-[10px] font-extrabold uppercase shrink-0 relative z-10">{language}</span>
          </button>
        )}

        {canTheme && (
          <button
            type="button"
            onClick={toggleTheme}
            title={theme === 'dark' ? t('header_theme_light') : t('header_theme_dark')}
            className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700 transition active:scale-90 shadow-2xs cursor-pointer shrink-0 relative z-20"
          >
            {theme === 'dark' ? (
              <Sun className="w-3.5 h-3.5 text-amber-400 shrink-0 relative z-20" />
            ) : (
              <Moon className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400 shrink-0 relative z-20" />
            )}
          </button>
        )}

        {canNotifications && (
          <button
            type="button"
            onClick={() => setNotificationsModalOpen(true)}
            title={t('header_notifications')}
            className="relative w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700 transition active:scale-90 cursor-pointer shadow-2xs shrink-0 z-20"
          >
            <Bell className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300 shrink-0 relative z-20" />
            {targetedBellCount > 0 && (
              <span
                data-testid="header-bell-badge"
                className="absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 bg-red-500 text-white rounded-full text-[9px] font-black flex items-center justify-center border-2 border-white dark:border-[#1e293b] z-30"
              >
                {targetedBellCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Synchronization & Data Availability Details Modal */}
      {isSyncModalOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsSyncModalOpen(false);
            }
          }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-3 bg-slate-950/75 backdrop-blur-xs animate-fadeIn"
        >
          <div
            className="w-full max-w-sm sm:max-w-md bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 pb-[max(1rem,env(safe-area-inset-bottom))] text-slate-800 dark:text-slate-100 max-h-[94dvh] sm:max-h-[92vh] overflow-y-auto flex flex-col space-y-3.5 sm:space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-9 h-9 rounded-2xl flex items-center justify-center font-bold shrink-0 ${
                    currentStatus === 'connected'
                      ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
                      : currentStatus === 'offline'
                      ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400'
                      : currentStatus === 'syncing'
                      ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400'
                      : currentStatus === 'error'
                      ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400'
                      : 'bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400'
                  }`}
                >
                  {currentStatus === 'connected' ? (
                    <Wifi className="w-5 h-5" />
                  ) : currentStatus === 'offline' ? (
                    <WifiOff className="w-5 h-5" />
                  ) : currentStatus === 'syncing' ? (
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  ) : currentStatus === 'error' ? (
                    <AlertCircle className="w-5 h-5" />
                  ) : (
                    <Database className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">
                    {t('header_sync_title')}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {tr(language, 'État de la connexion et disponibilité des données', 'Connection state and data availability')}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsSyncModalOpen(false);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white transition cursor-pointer active:scale-95"
                title={t('common_close')}
                aria-label="Fermer"
              >
                <X className="w-4 h-4 stroke-[2.5]" />
              </button>
            </div>

            {/* Status Pills Grid */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 space-y-1">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {tr(language, 'Connectivité Réseau', 'Network Connectivity')}
                </div>
                <div className="flex items-center gap-1.5 font-black text-slate-800 dark:text-slate-200">
                  {isOnline ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {t('header_sync_online')}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                      <span className="text-amber-600 dark:text-amber-400">
                        {t('header_sync_offline')}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 space-y-1">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {tr(language, 'Synchronisation Cloud', 'Cloud Synchronization')}
                </div>
                <div className="flex items-center gap-1.5 font-black text-slate-800 dark:text-slate-200 truncate">
                  {supabaseSyncStatus === 'connected' ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span className="text-emerald-600 dark:text-emerald-400 truncate">
                        {t('header_sync_cloud_connected')}
                      </span>
                    </>
                  ) : supabaseSyncStatus === 'syncing' || isManualSyncing ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 text-amber-500 animate-spin shrink-0" />
                      <span className="text-amber-600 dark:text-amber-400 truncate">
                        {t('header_sync_syncing')}
                      </span>
                    </>
                  ) : supabaseSyncStatus === 'error' ? (
                    <>
                      <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                      <span className="text-rose-600 dark:text-rose-400 truncate">
                        {t('header_sync_error')}
                      </span>
                    </>
                  ) : (
                    <>
                      <Database className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="text-slate-600 dark:text-slate-400 truncate">
                        {t('header_sync_local_mode')}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Data Availability Explanatory Box */}
            <div
              className={`p-3.5 rounded-2xl border text-xs leading-relaxed space-y-1.5 ${
                !isOnline
                  ? 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200'
                  : currentStatus === 'connected'
                  ? 'bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-200'
                  : currentStatus === 'error'
                  ? 'bg-rose-50/80 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800/60 text-rose-900 dark:text-rose-200'
                  : 'bg-blue-50/80 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800/60 text-blue-900 dark:text-blue-200'
              }`}
            >
              <div className="flex items-center gap-1.5 font-bold">
                <HardDrive className="w-4 h-4 shrink-0" />
                <span>{t('header_sync_availability_title')}</span>
              </div>
              <p className="text-[11px]">
                {!isOnline
                  ? t('header_sync_availability_offline_desc')
                  : currentStatus === 'connected'
                  ? t('header_sync_availability_online_desc')
                  : currentStatus === 'error'
                  ? tr(language, 'La base distante ne répond pas. Vos données restent accessibles en toute sécurité grâce au cache local.', 'The remote database is unreachable. Your data remains safely available through local cache.')
                  : t('header_sync_availability_local_desc')}
              </p>
              {supabaseSyncMessage && (
                <div className="text-[10px] font-mono opacity-80 pt-1 border-t border-current/10">
                  {supabaseSyncMessage}
                </div>
              )}
            </div>

            {/* Local Cache Metrics */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                <div className="text-[9px] text-slate-400 font-bold uppercase">
                  {tr(language, 'Articles', 'Products')}
                </div>
                <div className="text-sm font-black text-slate-800 dark:text-white mt-0.5">
                  {products.length}
                </div>
              </div>
              <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                <div className="text-[9px] text-slate-400 font-bold uppercase">
                  {tr(language, 'Dépôts', 'Depots')}
                </div>
                <div className="text-sm font-black text-slate-800 dark:text-white mt-0.5">
                  {depots.length}
                </div>
              </div>
              <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                <div className="text-[9px] text-slate-400 font-bold uppercase">
                  {tr(language, 'Mouvements', 'Movements')}
                </div>
                <div className="text-sm font-black text-slate-800 dark:text-white mt-0.5">
                  {movements.length}
                </div>
              </div>
            </div>

            {/* Last checked timestamp */}
            <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
              <span>{t('header_sync_last_check')} :</span>
              <span className="font-mono font-bold text-slate-600 dark:text-slate-300">
                {lastSyncTime}
              </span>
            </div>

            {/* LOT 1.1 : Mouvements rejetés par le serveur dans la file de synchronisation */}
            {rejectedSyncOps.length > 0 && (
              <div className="p-3 rounded-2xl bg-rose-50/90 dark:bg-rose-950/35 border border-rose-200 dark:border-rose-800/70 space-y-2">
                <div className="flex items-center justify-between text-xs font-black text-rose-800 dark:text-rose-200">
                  <span className="flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>
                      {tr(
                        language,
                        `Mouvements rejetés (${rejectedSyncOps.length})`,
                        `Rejected movements (${rejectedSyncOps.length})`,
                        `Geweigerde bewegingen (${rejectedSyncOps.length})`
                      )}
                    </span>
                  </span>
                </div>
                <div className="max-h-44 overflow-y-auto space-y-2 pr-1">
                  {rejectedSyncOps.map((op) => {
                    const p = op.payload || {};
                    const prodRef = p?.metadata?.product_ref || p?.product_id || op.id;
                    const movType = p?.type || op.action;
                    const qty = p?.quantity ?? '';
                    return (
                      <div
                        key={op.id}
                        className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-rose-200/80 dark:border-rose-800/60 text-[11px] space-y-1.5"
                      >
                        <div className="flex items-center justify-between font-bold text-slate-800 dark:text-slate-200">
                          <span className="font-mono truncate">
                            {String(prodRef)} • {String(movType)} {qty !== '' ? `(${qty})` : ''}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 text-[9px] uppercase font-black">
                            {tr(language, 'Rejeté', 'Rejected', 'Geweigerd')}
                          </span>
                        </div>
                        <div className="text-rose-700 dark:text-rose-300 text-[11px] leading-snug break-words">
                          {op.last_error ||
                            tr(
                              language,
                              'Mouvement refusé par le serveur.',
                              'Movement rejected by server.',
                              'Beweging geweigerd door de server.'
                            )}
                        </div>
                        <div className="flex items-center justify-end gap-1.5 pt-1">
                          <button
                            type="button"
                            onClick={() => retryRejectedMovement(op.operation_id || op.id || '')}
                            className="px-2.5 py-1 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-bold text-[10px] transition cursor-pointer"
                          >
                            {tr(language, 'Réessayer', 'Retry', 'Opnieuw proberen')}
                          </button>
                          <button
                            type="button"
                            onClick={() => discardRejectedMovement(op.operation_id || op.id || '')}
                            className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold text-[10px] transition cursor-pointer"
                          >
                            {tr(language, 'Abandonner', 'Discard', 'Annuleren')}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="space-y-2 pt-1">
              <button
                type="button"
                disabled={isManualSyncing || !isOnline}
                onClick={handleManualSync}
                className="w-full py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50 active:scale-[0.99] shadow-sm"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isManualSyncing ? 'animate-spin' : ''}`} />
                <span>
                  {isManualSyncing
                    ? t('header_sync_syncing')
                    : t('header_sync_btn_sync_now')}
                </span>
              </button>

              {canManageConfig && (
                <button
                  type="button"
                  onClick={() => {
                    setIsSyncModalOpen(false);
                    setCompanySetupModalOpen(true);
                  }}
                  className="w-full py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer active:scale-[0.99]"
                >
                  <Cloud className="w-3.5 h-3.5 text-orange-500" />
                  <span>
                    {tr(language, 'Paramètres Base de Données Supabase', 'Supabase Database Settings')}
                  </span>
                  <ExternalLink className="w-3 h-3 text-slate-400" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
    {currentUser && isSupabaseConnected && !hasAuthSession && (
      <div
        role="alert"
        data-testid="no-auth-session-banner"
        className="w-full px-3 sm:px-4 py-2 bg-amber-600 text-white text-xs font-bold flex flex-wrap items-center justify-between gap-2 shadow-xs z-20"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{NO_AUTH_SESSION_BANNER_MESSAGE}</span>
        </div>
        <button
          type="button"
          onClick={logout}
          className="px-3 py-1 rounded-lg bg-white text-amber-900 hover:bg-amber-50 font-extrabold text-[11px] shrink-0 cursor-pointer transition"
        >
          Se reconnecter
        </button>
      </div>
    )}
    {currentUser && transfersToReturn.length > 0 && (
      <div
        role="alert"
        data-testid="overdue-transfers-banner"
        className="w-full px-3 sm:px-4 py-2 bg-rose-600 text-white text-xs font-bold flex flex-wrap items-center justify-between gap-2 shadow-xs z-20"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>
            {transfersToReturn.length} transfert(s) non validé(s) depuis plus de 7 jours — remettez les produits en stock
          </span>
        </div>
        <button
          type="button"
          data-testid="open-overdue-transfers-btn"
          onClick={() => setTransfersModalOpen(true)}
          className="px-3 py-1 rounded-lg bg-white text-rose-900 hover:bg-rose-50 font-extrabold text-[11px] shrink-0 cursor-pointer transition"
        >
          Ouvrir les transferts
        </button>
      </div>
    )}
    </>
  );
};
