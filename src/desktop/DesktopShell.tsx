import React, { useEffect, useState } from 'react';
import {
  DESKTOP_MENU_COMMANDS,
  DesktopMenuCommandId,
  getDesktopSystemSettings,
  setDesktopMenuLocale,
  setDesktopSystemSettings,
  subscribeDesktopMenuCommand,
} from '../services/desktopBridge';
import { tr } from '../i18n/dutchTranslator';
import { SUPPORTED_LANGUAGES } from '../i18n/translations';
import { useApp } from '../context/AppContext';
import { PLAN_LABELS, normalizeToCanonicalPlan } from '../types';
import { APP_VERSION } from '../appVersion';
import {
  buildInventoryCsvContent,
  matchDesktopShortcut,
} from '../services/desktopInventoryLogic';
import { canUserAccessScannerMode } from '../services/orderPickingLogic';
import {
  buildNotificationKey,
  computeTargetedBellBadgeCount,
  getNotificationCardDescriptor,
  getTargetedOrderNotificationsForUser,
  isUserRecipientForStockAlert,
  shouldAutoDismissOnCardClick,
  shouldShowNotificationBanner,
} from '../services/notificationService';
import {
  DesktopPageId,
  DesktopSettingsSection,
  DESKTOP_GLOBAL_DEPOT_KEY,
  DESKTOP_LAST_PAGE_KEY,
  DESKTOP_SIDEBAR_COLLAPSED_KEY,
} from './types';
import { DesktopDashboardPage } from './pages/DesktopDashboardPage';
import { DesktopInventoryPage } from './pages/DesktopInventoryPage';
import { SearchableSelect } from '../components/SearchableSelect';
import { DesktopReportsPage } from './pages/DesktopReportsPage';
import { DesktopAuditLogPage } from './pages/DesktopAuditLogPage';
import { DesktopTransfersPage } from './pages/DesktopTransfersPage';
import { DesktopCommandPalette } from './components/DesktopCommandPalette';
import { DesktopShortcutsModal } from './components/DesktopShortcutsModal';
import { requestGuardedNavigation } from '../services/unsavedChangesGuard';
import {
  dismissUserPreferencesSyncBanner,
  getSyncBannerState,
  readLocalPreferenceValue,
  setUserPreference,
  subscribeUserPreferences,
  subscribeUserPreferencesSyncBanner,
  UserPreferencesSyncBannerState,
} from '../services/userPreferencesService';
import {
  LayoutDashboard,
  Package,
  ArrowLeftRight,
  ShoppingBag,
  Scan,
  Printer,
  Sliders,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Bell,
  Sun,
  Moon,
  RefreshCw,
  Wifi,
  WifiOff,
  User as UserIcon,
  LogOut,
  Trash2,
  Keyboard,
  ShieldCheck,
  ShieldAlert,
  FileSpreadsheet,
  Users,
  Warehouse,
  FolderTree,
  Building2,
  Mail,
  BookOpen,
  Info,
  AlertCircle,
  ClipboardCheck,
  X,
} from 'lucide-react';

interface DesktopShellProps {
  renderAuditPage?: (props: { globalDepotFilter: string }) => React.ReactNode;
  renderAuditLogPage?: () => React.ReactNode;
  renderMovementsPage?: (props: { globalDepotFilter: string }) => React.ReactNode;
  renderOrdersPage?: (props: {
    selectedOrderId: string | null;
    onSelectOrder: (id: string | null) => void;
    externalNewOrderTrigger: number;
  }) => React.ReactNode;
  renderPreparationPage?: (props: {
    selectedOrderId: string | null;
    f2Trigger: number;
    f4Trigger: number;
    f8Trigger: number;
  }) => React.ReactNode;
  renderPrintStationPage?: () => React.ReactNode;
  renderReportsPage?: (props: { globalDepotFilter: string }) => React.ReactNode;
  renderSettingsPage?: (props: {
    section: DesktopSettingsSection;
    onChangeSection: (s: DesktopSettingsSection) => void;
  }) => React.ReactNode;
  onOpenCsvImportModal?: () => void;
  onOpenQuickMovementDrawer?: () => void;
  onOpenDesktopLabelModal?: () => void;
}

export const DESKTOP_SHELL_RECOGNIZED_COMMANDS: readonly DesktopMenuCommandId[] =
  DESKTOP_MENU_COMMANDS;

export const DesktopShell: React.FC<DesktopShellProps> = ({
  renderAuditPage,
  renderAuditLogPage,
  renderMovementsPage,
  renderOrdersPage,
  renderPreparationPage,
  renderPrintStationPage,
  renderReportsPage,
  renderSettingsPage,
  onOpenCsvImportModal,
  onOpenQuickMovementDrawer,
  onOpenDesktopLabelModal,
}) => {
  const {
    currentUser,
    logout,
    wipeDeviceAndSignOut,
    theme,
    toggleTheme,
    language,
    setLanguage,
    t,
    depots,
    departments,
    projects,
    depotHolders,
    transfers,
    products,
    subCategories,
    orders,
    license,
    supabaseSyncStatus,
    syncFromSupabase,
    userHasPermission,
    isPreparer,
    appLogoUrl,
    setActiveProductId,
    activeTab,
    setActiveTab,
    licenseNotification,
    dismissLicenseNotification,
    rejectedSyncOps,
    retryRejectedMovement,
    discardRejectedMovement,
    transferBadgeCount,
    roles,
    users,
    dismissedNotificationKeys,
    dismissNotificationKeys,
    resetMyNotificationDismissals,
  } = useApp();

  // Persisted sidebar collapse state
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      const val = readLocalPreferenceValue('desktop_sidebar_collapsed');
      if (val !== undefined) return val;
      return localStorage.getItem(DESKTOP_SIDEBAR_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [prefsSyncBanner, setPrefsSyncBanner] = useState<UserPreferencesSyncBannerState>(() =>
    getSyncBannerState()
  );

  useEffect(() => {
    const unsubPrefs = subscribeUserPreferences((prefs) => {
      if (prefs.desktop_sidebar_collapsed !== undefined) {
        setSidebarCollapsed(Boolean(prefs.desktop_sidebar_collapsed));
      }
    });
    const unsubBanner = subscribeUserPreferencesSyncBanner((state) => {
      setPrefsSyncBanner(state);
    });
    return () => {
      unsubPrefs();
      unsubBanner();
    };
  }, []);

  // Persisted active desktop page
  const [activePage, setActivePage] = useState<DesktopPageId>(() => {
    try {
      const saved = localStorage.getItem(DESKTOP_LAST_PAGE_KEY) as DesktopPageId | null;
      if (
        saved &&
        [
          'dashboard',
          'inventory',
          'audit',
          'audit_log',
          'movements',
          'transfers',
          'orders',
          'preparation',
          'reports',
          'print_station',
          'settings',
        ].includes(saved)
      ) {
        return saved;
      }
    } catch {
      // Ignore
    }
    if (activeTab === 'search') return 'inventory';
    if (activeTab === 'movements') return 'movements';
    if (activeTab === 'plus') return 'settings';
    return 'dashboard';
  });

  const [settingsSection, setSettingsSection] = useState<DesktopSettingsSection>('profile');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // Global depot selector in top bar
  const [globalDepot, setGlobalDepot] = useState<string>(() => {
    try {
      return localStorage.getItem(DESKTOP_GLOBAL_DEPOT_KEY) || 'ALL';
    } catch {
      return 'ALL';
    }
  });

  // Overlays & Triggers
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [confirmingResetBell, setConfirmingResetBell] = useState(false);
  const [syncQueuePopoverOpen, setSyncQueuePopoverOpen] = useState(false);
  const [confirmWipeOpen, setConfirmWipeOpen] = useState(false);

  const [searchFocusTrigger, setSearchFocusTrigger] = useState(0);
  const [newProductTrigger, setNewProductTrigger] = useState(0);
  const [newOrderTrigger, setNewOrderTrigger] = useState(0);
  const [f2Trigger, setF2Trigger] = useState(0);
  const [f4Trigger, setF4Trigger] = useState(0);
  const [f8Trigger, setF8Trigger] = useState(0);

  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const handleNavigatePage = (page: DesktopPageId, section?: DesktopSettingsSection) => {
    if (page === activePage && (!section || section === settingsSection)) return;
    requestGuardedNavigation(() => {
      setActivePage(page);
      if (section) {
        setSettingsSection(section);
      }
      try {
        localStorage.setItem(DESKTOP_LAST_PAGE_KEY, page);
      } catch {
        // Ignore
      }
      if (page === 'dashboard') setActiveTab('home');
      else if (page === 'inventory') setActiveTab('search');
      else if (page === 'movements') setActiveTab('movements');
      else if (page === 'settings') setActiveTab('plus');
    });
  };

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        setUserPreference('desktop_sidebar_collapsed', next);
      } catch {
        try {
          localStorage.setItem(DESKTOP_SIDEBAR_COLLAPSED_KEY, String(next));
        } catch {}
      }
      return next;
    });
  };

  // Global keyboard shortcuts (never fire inside inputs/textareas/selects)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const action = matchDesktopShortcut(e);
      if (!action) return;

      if (action === 'OPEN_COMMAND_PALETTE') {
        e.preventDefault();
        setCommandPaletteOpen((v) => !v);
      } else if (action === 'OPEN_SHORTCUTS_HELP') {
        e.preventDefault();
        setShortcutsHelpOpen((v) => !v);
      } else if (action === 'FOCUS_SEARCH') {
        e.preventDefault();
        if (activePage !== 'inventory') {
          handleNavigatePage('inventory');
        }
        setSearchFocusTrigger((n) => n + 1);
      } else if (action === 'NEW_ITEM') {
        e.preventDefault();
        if (activePage === 'orders') {
          setNewOrderTrigger((n) => n + 1);
        } else {
          handleNavigatePage('inventory');
          setNewProductTrigger((n) => n + 1);
        }
      } else if (action === 'PRINT_LABELS') {
        e.preventDefault();
        onOpenDesktopLabelModal?.();
      } else if (action === 'CLOSE_PANEL') {
        setCommandPaletteOpen(false);
        setShortcutsHelpOpen(false);
        setUserMenuOpen(false);
        setNotificationsOpen(false);
      } else if (action === 'PICK_QUANTITY_F2' && activePage === 'preparation') {
        e.preventDefault();
        setF2Trigger((n) => n + 1);
      } else if (action === 'PICK_MISSING_F4' && activePage === 'preparation') {
        e.preventDefault();
        setF4Trigger((n) => n + 1);
      } else if (action === 'PICK_READY_F8' && activePage === 'preparation') {
        e.preventDefault();
        setF8Trigger((n) => n + 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePage, onOpenDesktopLabelModal]);

  // Listen to native Electron menu events and notification routes if running in desktop app
  useEffect(() => {
    setDesktopMenuLocale(language);
  }, [language]);

  useEffect(() => {
    const triggerInventoryCsvExport = () => {
      try {
        const canViewPrices = userHasPermission('perm_prod_view_price');
        const csvContent = buildInventoryCsvContent(products, subCategories, canViewPrices);
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute(
          'download',
          `tot_stock_inventaire_${new Date().toISOString().slice(0, 10)}.csv`
        );
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch {
        // Ignore in headless environment
      }
    };

    const execCmd = (cmd: string) => {
      if (cmd === 'new-product') {
        handleNavigatePage('inventory');
        setNewProductTrigger((n) => n + 1);
      } else if (cmd === 'new-movement') {
        onOpenQuickMovementDrawer?.();
      } else if (cmd === 'new-order') {
        handleNavigatePage('orders');
        setNewOrderTrigger((n) => n + 1);
      } else if (cmd === 'import-csv') {
        onOpenCsvImportModal?.();
      } else if (cmd === 'export-csv') {
        triggerInventoryCsvExport();
      } else if (cmd === 'print-labels') {
        onOpenDesktopLabelModal?.();
      } else if (cmd === 'focus-search') {
        handleNavigatePage('inventory');
        setSearchFocusTrigger((n) => n + 1);
      } else if (cmd === 'command-palette') {
        setCommandPaletteOpen(true);
      } else if (cmd === 'refresh-data') {
        syncFromSupabase();
      } else if (cmd === 'toggle-sidebar') {
        toggleSidebar();
      } else if (cmd === 'toggle-print-pause') {
        getDesktopSystemSettings()
          .then((sys) => setDesktopSystemSettings({ printQueuePaused: !sys.printQueuePaused }))
          .then((updated) => {
            window.dispatchEvent(
              new CustomEvent('tot-desktop-print-pause-changed', {
                detail: { paused: updated.printQueuePaused },
              })
            );
          })
          .catch(() => {});
      } else if (cmd === 'open-shortcuts') {
        setShortcutsHelpOpen(true);
      } else if (cmd === 'open-docs') {
        handleNavigatePage('settings', 'documentation');
      } else if (cmd === 'open-about') {
        handleNavigatePage('settings', 'about');
      } else if (cmd === 'nav-dashboard') {
        handleNavigatePage('dashboard');
      } else if (cmd === 'nav-inventory') {
        handleNavigatePage('inventory');
      } else if (cmd === 'nav-movements') {
        handleNavigatePage('movements');
      } else if (cmd === 'nav-orders') {
        handleNavigatePage('orders');
      } else if (cmd === 'nav-preparation') {
        handleNavigatePage('preparation');
      } else if (cmd === 'nav-print-station') {
        handleNavigatePage('print_station');
      } else if (cmd === 'nav-settings') {
        handleNavigatePage('settings', 'profile');
      }
    };

    const handleNativeMenuCommand = (ev: Event) => {
      const custom = ev as CustomEvent<{ command?: string }>;
      const cmd = custom.detail?.command;
      if (cmd) execCmd(cmd);
    };

    const unsubMenu = subscribeDesktopMenuCommand((cmd) => execCmd(cmd));

    window.addEventListener('tot-desktop-menu-command', handleNativeMenuCommand);
    return () => {
      window.removeEventListener('tot-desktop-menu-command', handleNativeMenuCommand);
      unsubMenu();
    };
  }, [
    onOpenDesktopLabelModal,
    onOpenCsvImportModal,
    onOpenQuickMovementDrawer,
    products,
    subCategories,
    syncFromSupabase,
    userHasPermission,
  ]);

  // Permissions (same as PlusMenuView)
  const canDashboard =
    userHasPermission('perm_tab_dashboard') || userHasPermission('perm_dash_kpi');
  const canInventory =
    userHasPermission('perm_tab_inventory') || userHasPermission('perm_prod_view');
  const canInventoryAudit =
    userHasPermission('perm_menu_inventory_audit') || Number(currentUser?.role_id) === 0;
  const canOrderPrep =
    canUserAccessScannerMode(
      currentUser,
      isPreparer,
      userHasPermission('perm_menu_order_prep')
    ) ||
    isPreparer ||
    userHasPermission('perm_menu_order_prep');
  const canPrintLabels = userHasPermission('perm_menu_print_labels');
  const canUsers = userHasPermission('perm_manage_users') || userHasPermission('perm_manage_roles');
  const canManageDepots = userHasPermission('perm_manage_depots');
  const canCategories = userHasPermission('perm_manage_categories');
  const canDepProj =
    userHasPermission('perm_dep_view') ||
    userHasPermission('perm_proj_view') ||
    userHasPermission('perm_depproj_menu');
  const canEmail =
    userHasPermission('perm_config_email') ||
    userHasPermission('perm_menu_smtp') ||
    userHasPermission('perm_config_db');
  const canLicense =
    userHasPermission('perm_config_license') || userHasPermission('perm_config_db');
  const canDocs =
    userHasPermission('perm_doc_manual') ||
    userHasPermission('perm_doc_android') ||
    userHasPermission('perm_doc_marketing') ||
    userHasPermission('perm_doc_supabase');
  const canReports =
    userHasPermission('perm_report_view') ||
    Number(currentUser?.role_id) === 0 ||
    Number(currentUser?.role_id) === 1;
  const canAuditLog =
    userHasPermission('perm_audit_view') ||
    Number(currentUser?.role_id) === 0 ||
    Number(currentUser?.role_id) === 1;

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
  const lowStockProducts = shouldShowNotificationBanner('STOCK_LOW_ALERT', currentUser?.id)
    ? products.filter(
        (p) =>
          (p.quantity || 0) <= (p.min_stock_alert || 2) &&
          isUserRecipientForStockAlert({
            product: p,
            user: currentUser,
            departments,
            depots,
            depotHolders,
            roles,
            dismissedKeys: dismissedNotificationKeys,
            alertStatus: (p.quantity || 0) <= 0 ? 'OUT' : 'LOW',
          })
      )
    : [];
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

  const canonicalPlan = normalizeToCanonicalPlan(
    license?.plan || license?.plan_type,
    license?.license_key
  );
  const planLabel = PLAN_LABELS[canonicalPlan];

  return (
    <div
      id="desktop-workspace-root"
      className="h-screen w-full min-w-[1024px] min-h-[680px] flex overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 select-none"
    >
      {/* Left Collapsible Sidebar */}
      <aside
        aria-label={tr(language, 'Navigation principale', 'Main navigation', 'Hoofdnavigatie')}
        className={`${
          sidebarCollapsed ? 'w-16' : 'w-60'
        } shrink-0 h-full bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between transition-[width] duration-150 no-print`}
      >
        {/* Top Brand + Primary Nav */}
        <div className="flex flex-col min-h-0 flex-1">
          <div className="h-14 px-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              {appLogoUrl && (
                <div className="w-8 h-8 rounded-lg bg-white p-1 border border-slate-200 flex items-center justify-center shrink-0">
                  <img
                    src={appLogoUrl}
                    alt="TOT Stock"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-contain"
                  />
                </div>
              )}
              {!sidebarCollapsed && (
                <span className="text-base font-black tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0">
                  TOT Stock
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={toggleSidebar}
              title={
                sidebarCollapsed
                  ? t('desktop_sidebar_expand')
                  : t('desktop_sidebar_collapse')
              }
              aria-label={
                sidebarCollapsed
                  ? t('desktop_sidebar_expand')
                  : t('desktop_sidebar_collapse')
              }
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer shrink-0"
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* Navigation Groups */}
          <nav className="flex-1 overflow-y-auto p-2.5 space-y-5 text-xs">
            {/* Opérations */}
            <div className="space-y-1">
              {!sidebarCollapsed && (
                <div className="px-2.5 pb-1 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                  {tr(language, 'Opérations', 'Operations', 'Operaties')}
                </div>
              )}

              {canDashboard && (
                <button
                  type="button"
                  onClick={() => handleNavigatePage('dashboard')}
                  title={t('desktop_nav_dashboard')}
                  className={`w-full px-2.5 py-2 rounded-xl font-semibold flex items-center gap-2.5 transition cursor-pointer ${
                    activePage === 'dashboard'
                      ? 'bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <LayoutDashboard className="w-4 h-4 shrink-0" />
                  {!sidebarCollapsed && (
                    <span className="truncate">{t('desktop_nav_dashboard')}</span>
                  )}
                </button>
              )}

              {canInventory && (
                <button
                  type="button"
                  onClick={() => handleNavigatePage('inventory')}
                  title={t('desktop_nav_inventory')}
                  className={`w-full px-2.5 py-2 rounded-xl font-semibold flex items-center gap-2.5 transition cursor-pointer ${
                    activePage === 'inventory'
                      ? 'bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Package className="w-4 h-4 shrink-0" />
                  {!sidebarCollapsed && (
                    <span className="truncate flex-1 text-left">{t('desktop_nav_inventory')}</span>
                  )}
                  {!sidebarCollapsed && (
                    <span className="text-[11px] font-mono tabular-nums text-slate-400">
                      {products.length}
                    </span>
                  )}
                </button>
              )}

              {canInventoryAudit && (
                <button
                  type="button"
                  onClick={() => handleNavigatePage('audit')}
                  title={tr(language, 'Audit', 'Audit', 'Audit')}
                  className={`w-full px-2.5 py-2 rounded-xl font-semibold flex items-center gap-2.5 transition cursor-pointer ${
                    activePage === 'audit'
                      ? 'bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <ClipboardCheck className="w-4 h-4 shrink-0" />
                  {!sidebarCollapsed && (
                    <span className="truncate flex-1 text-left">
                      {tr(language, 'Audit', 'Audit', 'Audit')}
                    </span>
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={() => handleNavigatePage('movements')}
                title={t('desktop_nav_movements')}
                className={`w-full px-2.5 py-2 rounded-xl font-semibold flex items-center gap-2.5 transition cursor-pointer ${
                  activePage === 'movements'
                    ? 'bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <ArrowLeftRight className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && (
                  <span className="truncate">{t('desktop_nav_movements')}</span>
                )}
              </button>

              <button
                type="button"
                data-testid="desktop-nav-transfers"
                onClick={() => handleNavigatePage('transfers')}
                title={tr(language, 'Transferts', 'Transfers', 'Overdrachten')}
                className={`w-full px-2.5 py-2 rounded-xl font-semibold flex items-center gap-2.5 transition cursor-pointer ${
                  activePage === 'transfers'
                    ? 'bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <ArrowLeftRight className="w-4 h-4 shrink-0 text-sky-600 dark:text-sky-400" />
                {!sidebarCollapsed && (
                  <span className="truncate flex-1 text-left">
                    {tr(language, 'Transferts', 'Transfers', 'Overdrachten')}
                  </span>
                )}
                {transferBadgeCount > 0 && (
                  <span
                    data-testid="desktop-transfers-badge"
                    className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-rose-600 text-white"
                  >
                    {transferBadgeCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => handleNavigatePage('orders')}
                title={t('desktop_nav_orders')}
                className={`w-full px-2.5 py-2 rounded-xl font-semibold flex items-center gap-2.5 transition cursor-pointer ${
                  activePage === 'orders'
                    ? 'bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <ShoppingBag className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && (
                  <span className="truncate flex-1 text-left">{t('desktop_nav_orders')}</span>
                )}
                {!sidebarCollapsed && orders.length > 0 && (
                  <span className="text-[11px] font-mono tabular-nums text-slate-400">
                    {orders.length}
                  </span>
                )}
              </button>

              {canOrderPrep && (
                <button
                  type="button"
                  onClick={() => handleNavigatePage('preparation')}
                  title={t('desktop_nav_preparation')}
                  className={`w-full px-2.5 py-2 rounded-xl font-semibold flex items-center gap-2.5 transition cursor-pointer ${
                    activePage === 'preparation'
                      ? 'bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Scan className="w-4 h-4 shrink-0" />
                  {!sidebarCollapsed && (
                    <span className="truncate flex-1 text-left">{t('desktop_nav_preparation')}</span>
                  )}
                  {!sidebarCollapsed && pendingPrepCount > 0 && (
                    <span className="font-mono tabular-nums text-[11px] font-bold text-orange-600 dark:text-orange-400">
                      {pendingPrepCount}
                    </span>
                  )}
                </button>
              )}

              {canReports && (
                <button
                  type="button"
                  data-testid="desktop-nav-reports"
                  onClick={() => handleNavigatePage('reports')}
                  title={tr(language, 'Rapports', 'Reports', 'Rapporten')}
                  className={`w-full px-2.5 py-2 rounded-xl font-semibold flex items-center gap-2.5 transition cursor-pointer ${
                    activePage === 'reports'
                      ? 'bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <FileSpreadsheet className="w-4 h-4 shrink-0" />
                  {!sidebarCollapsed && (
                    <span className="truncate flex-1 text-left">
                      {tr(language, 'Rapports', 'Reports', 'Rapporten')}
                    </span>
                  )}
                </button>
              )}
            </div>

            {/* Étiquettes & Impression */}
            {(canPrintLabels || canOrderPrep) && (
              <div className="space-y-1">
                {!sidebarCollapsed && (
                  <div className="px-2.5 pb-1 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                    {tr(language, 'Étiquettes & Impression', 'Labels & Printing', 'Etiketten & Afdrukken')}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => handleNavigatePage('print_station')}
                  title={t('desktop_nav_print_station')}
                  className={`w-full px-2.5 py-2 rounded-xl font-semibold flex items-center gap-2.5 transition cursor-pointer ${
                    activePage === 'print_station'
                      ? 'bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Printer className="w-4 h-4 shrink-0" />
                  {!sidebarCollapsed && (
                    <span className="truncate">{t('desktop_nav_print_station')}</span>
                  )}
                </button>

                {canPrintLabels && onOpenDesktopLabelModal && (
                  <button
                    type="button"
                    onClick={onOpenDesktopLabelModal}
                    title={tr(language, 'Planches & étiquettes produit', 'Product label sheets', 'Artikeletiketten')}
                    className="w-full px-2.5 py-2 rounded-xl font-semibold flex items-center gap-2.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4 shrink-0" />
                    {!sidebarCollapsed && (
                      <span className="truncate">
                        {tr(language, 'Imprimer des étiquettes', 'Print labels', 'Etiketten afdrukken')}
                      </span>
                    )}
                  </button>
                )}
              </div>
            )}

            {/* Administration & Paramètres (regroupement de l'ancien menu Plus) */}
            <div className="space-y-1">
              {!sidebarCollapsed && (
                <div className="px-2.5 pb-1 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                  {tr(language, 'Administration & Aide', 'Admin & Help', 'Beheer & Hulp')}
                </div>
              )}

              <button
                type="button"
                onClick={() => handleNavigatePage('settings', 'profile')}
                title={t('desktop_nav_settings')}
                className={`w-full px-2.5 py-2 rounded-xl font-semibold flex items-center gap-2.5 transition cursor-pointer ${
                  activePage === 'settings' && settingsSection === 'profile'
                    ? 'bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Sliders className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && (
                  <span className="truncate">{t('desktop_nav_settings')}</span>
                )}
              </button>

              {canAuditLog && (
                <button
                  type="button"
                  data-testid="desktop-nav-audit-log"
                  onClick={() => handleNavigatePage('audit_log')}
                  title={tr(language, "Journal d'audit", 'Audit Log', 'Auditlogboek')}
                  className={`w-full px-2.5 py-2 rounded-xl font-semibold flex items-center gap-2.5 transition cursor-pointer ${
                    activePage === 'audit_log'
                      ? 'bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  {!sidebarCollapsed && (
                    <span className="truncate flex-1 text-left">
                      {tr(language, "Journal d'audit", 'Audit Log', 'Auditlogboek')}
                    </span>
                  )}
                </button>
              )}

              {canUsers && !sidebarCollapsed && (
                <button
                  type="button"
                  onClick={() => handleNavigatePage('settings', 'users_roles')}
                  className={`w-full px-2.5 py-1.5 rounded-xl font-medium flex items-center gap-2.5 transition cursor-pointer ${
                    activePage === 'settings' && settingsSection === 'users_roles'
                      ? 'text-orange-600 dark:text-orange-400 font-semibold'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Users className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    {tr(language, 'Utilisateurs & Rôles', 'Users & Roles', 'Gebruikers & Rollen')}
                  </span>
                </button>
              )}

              {canManageDepots && !sidebarCollapsed && (
                <button
                  type="button"
                  onClick={() => handleNavigatePage('settings', 'depots')}
                  className={`w-full px-2.5 py-1.5 rounded-xl font-medium flex items-center gap-2.5 transition cursor-pointer ${
                    activePage === 'settings' && settingsSection === 'depots'
                      ? 'text-orange-600 dark:text-orange-400 font-semibold'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Warehouse className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    {tr(language, 'Magasins & Dépôts', 'Depots', 'Magazijnen & Depots')}
                  </span>
                </button>
              )}

              {canCategories && !sidebarCollapsed && (
                <button
                  type="button"
                  onClick={() => handleNavigatePage('settings', 'categories')}
                  className={`w-full px-2.5 py-1.5 rounded-xl font-medium flex items-center gap-2.5 transition cursor-pointer ${
                    activePage === 'settings' && settingsSection === 'categories'
                      ? 'text-orange-600 dark:text-orange-400 font-semibold'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <FolderTree className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    {tr(language, 'Catégories', 'Categories', 'Categorieën')}
                  </span>
                </button>
              )}

              {canDepProj && !sidebarCollapsed && (
                <button
                  type="button"
                  onClick={() => handleNavigatePage('settings', 'departments_projects')}
                  className={`w-full px-2.5 py-1.5 rounded-xl font-medium flex items-center gap-2.5 transition cursor-pointer ${
                    activePage === 'settings' && settingsSection === 'departments_projects'
                      ? 'text-orange-600 dark:text-orange-400 font-semibold'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Building2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    {tr(language, 'Départements & Projets', 'Depts & Projects', 'Afdelingen & Projecten')}
                  </span>
                </button>
              )}

              {canEmail && !sidebarCollapsed && (
                <button
                  type="button"
                  onClick={() => handleNavigatePage('settings', 'emails_smtp')}
                  className={`w-full px-2.5 py-1.5 rounded-xl font-medium flex items-center gap-2.5 transition cursor-pointer ${
                    activePage === 'settings' && settingsSection === 'emails_smtp'
                      ? 'text-orange-600 dark:text-orange-400 font-semibold'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Mail className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    {tr(language, 'E-mails & SMTP', 'Emails & SMTP', 'E-mails & SMTP')}
                  </span>
                </button>
              )}

              {canLicense && !sidebarCollapsed && (
                <button
                  type="button"
                  onClick={() => handleNavigatePage('settings', 'license')}
                  className={`w-full px-2.5 py-1.5 rounded-xl font-medium flex items-center gap-2.5 transition cursor-pointer ${
                    activePage === 'settings' && settingsSection === 'license'
                      ? 'text-orange-600 dark:text-orange-400 font-semibold'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    {tr(language, 'Licence & Base SQL', 'License & SQL DB', 'Licentie & SQL-database')}
                  </span>
                </button>
              )}

              {canDocs && !sidebarCollapsed && (
                <button
                  type="button"
                  onClick={() => handleNavigatePage('settings', 'documentation')}
                  className={`w-full px-2.5 py-1.5 rounded-xl font-medium flex items-center gap-2.5 transition cursor-pointer ${
                    activePage === 'settings' && settingsSection === 'documentation'
                      ? 'text-orange-600 dark:text-orange-400 font-semibold'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    {tr(language, 'Documentation', 'Documentation', 'Documentatie')}
                  </span>
                </button>
              )}

              {!sidebarCollapsed && (
                <button
                  type="button"
                  onClick={() => handleNavigatePage('settings', 'about')}
                  className={`w-full px-2.5 py-1.5 rounded-xl font-medium flex items-center gap-2.5 transition cursor-pointer ${
                    activePage === 'settings' && settingsSection === 'about'
                      ? 'text-orange-600 dark:text-orange-400 font-semibold'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Info className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    {tr(language, 'À propos', 'About', 'Over')} (v{APP_VERSION})
                  </span>
                </button>
              )}
            </div>
          </nav>
        </div>

        {/* Bottom Shortcuts Hint */}
        <div className="p-2.5 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setShortcutsHelpOpen(true)}
            title={t('desktop_shortcuts_title')}
            className="w-full px-2.5 py-2 rounded-xl text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between gap-2 cursor-pointer"
          >
            <span className="flex items-center gap-2 truncate">
              <Keyboard className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed && <span className="truncate">{t('desktop_shortcuts_title')}</span>}
            </span>
            {!sidebarCollapsed && (
              <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-mono text-[10px]">
                ?
              </kbd>
            )}
          </button>
        </div>
      </aside>

      {/* Main Content Area (Top Bar + Page Viewport) */}
      <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="h-14 px-5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-4 shrink-0 no-print">
          {/* Left: Global Search / Command Palette Trigger + Depot Filter */}
          <div className="flex items-center gap-3 flex-1 max-w-xl">
            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              className="flex-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-xs text-slate-500 dark:text-slate-400 hover:border-orange-500/60 flex items-center justify-between gap-2 transition cursor-pointer"
            >
              <span className="flex items-center gap-2 truncate">
                <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{t('desktop_search_global_placeholder')}</span>
              </span>
              <kbd className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-[10px] text-slate-500 shrink-0">
                Ctrl+K
              </kbd>
            </button>

            <SearchableSelect
              value={globalDepot}
              onChange={(val) => {
                setGlobalDepot(val);
                try {
                  localStorage.setItem(DESKTOP_GLOBAL_DEPOT_KEY, val);
                } catch {
                  // Ignore
                }
              }}
              recentKey="depots"
              aria-label={tr(language, 'Sélecteur de dépôt global', 'Global depot selector', 'Globaal depotselectie')}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer ${
                globalDepot !== 'ALL' &&
                depots.some(
                  (d) =>
                    d.name.trim().toLowerCase() === globalDepot.trim().toLowerCase() &&
                    d.is_active === false
                )
                  ? 'border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200'
              }`}
            >
              <option value="ALL">
                {tr(language, 'Tous les dépôts', 'All depots', 'Alle depots')}
              </option>
              {depots.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                  {d.is_active === false
                    ? ` (${tr(language, 'en veille', 'on standby', 'stand-by')})`
                    : ''}
                </option>
              ))}
            </SearchableSelect>
            {globalDepot !== 'ALL' &&
              depots.some(
                (d) =>
                  d.name.trim().toLowerCase() === globalDepot.trim().toLowerCase() &&
                  d.is_active === false
              ) && (
                <span
                  role="status"
                  className="px-2.5 py-1 rounded-xl bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 text-[11px] font-bold flex items-center gap-1.5 shrink-0"
                  title={tr(
                    language,
                    `Le dépôt sélectionné « ${globalDepot} » est actuellement en veille.`,
                    `The selected depot "${globalDepot}" is currently on standby.`,
                    `Het geselecteerde depot "${globalDepot}" staat momenteel op stand-by.`
                  )}
                >
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>
                    {tr(
                      language,
                      'Dépôt en veille',
                      'Depot on standby',
                      'Depot op stand-by'
                    )}
                  </span>
                </span>
              )}
          </div>

          {/* Right: Sync Status, License, Notifications, Language, Theme, User Menu */}
          <div className="flex items-center gap-2.5 shrink-0">
            {/* Sync / Offline Indicator + Rejected Queue Popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  if (rejectedSyncOps.length > 0) {
                    setSyncQueuePopoverOpen((v) => !v);
                  } else {
                    syncFromSupabase();
                  }
                }}
                title={tr(
                  language,
                  'Synchroniser avec Supabase',
                  'Sync with Supabase',
                  'Synchroniseren met Supabase'
                )}
                className={`px-2.5 py-1.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 ${
                  rejectedSyncOps.length > 0
                    ? 'border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                    : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {rejectedSyncOps.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-rose-600 text-white text-[10px] font-black">
                    {rejectedSyncOps.length}
                  </span>
                )}
                {!isOnline ? (
                  <>
                    <WifiOff className="w-3.5 h-3.5 text-amber-600" />
                    <span className="text-amber-600 dark:text-amber-400">{t('header_offline')}</span>
                  </>
                ) : supabaseSyncStatus === 'syncing' ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 text-orange-500 animate-spin" />
                    <span>{t('header_syncing')}</span>
                  </>
                ) : supabaseSyncStatus === 'connected' ? (
                  <>
                    <Wifi className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-700 dark:text-emerald-400">{t('header_connected')}</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
                    <span>{t('header_local')}</span>
                  </>
                )}
              </button>

              {syncQueuePopoverOpen && (
                <div className="absolute right-0 mt-2 w-96 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-3.5 z-50 text-xs space-y-2.5">
                  <div className="flex items-center justify-between font-black text-slate-900 dark:text-white">
                    <span className="flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 text-rose-600" />
                      <span>
                        {tr(
                          language,
                          `Mouvements rejetés (${rejectedSyncOps.length})`,
                          `Rejected movements (${rejectedSyncOps.length})`,
                          `Geweigerde bewegingen (${rejectedSyncOps.length})`
                        )}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setSyncQueuePopoverOpen(false)}
                      className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {rejectedSyncOps.length === 0 ? (
                    <div className="py-4 text-center text-slate-500">
                      {tr(language, 'Aucun mouvement rejeté.', 'No rejected movements.', 'Geen geweigerde bewegingen.')}
                    </div>
                  ) : (
                    <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                      {rejectedSyncOps.map((op) => {
                        const p = op.payload || {};
                        const prodRef = p?.metadata?.product_ref || p?.product_id || op.id;
                        const movType = p?.type || op.action;
                        const qty = p?.quantity ?? '';
                        return (
                          <div
                            key={op.id}
                            className="p-2.5 rounded-xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 space-y-1.5"
                          >
                            <div className="flex items-center justify-between font-bold text-slate-900 dark:text-white">
                              <span className="font-mono truncate">
                                {String(prodRef)} • {String(movType)} {qty !== '' ? `(${qty})` : ''}
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[9px] uppercase font-black">
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
                                className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-[10px] transition cursor-pointer"
                              >
                                {tr(language, 'Abandonner', 'Discard', 'Annuleren')}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="pt-1 border-t border-slate-200 dark:border-slate-800 flex justify-end">
                    <button
                      type="button"
                      onClick={() => syncFromSupabase()}
                      className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-[11px] flex items-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>{tr(language, 'Synchroniser maintenant', 'Sync now', 'Nu synchroniseren')}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* License Plan */}
            <button
              type="button"
              onClick={() => handleNavigatePage('settings', 'license')}
              className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer whitespace-nowrap shrink-0"
            >
              {planLabel}
            </button>

            {/* Notifications Bell */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotificationsOpen((v) => !v)}
                aria-label={t('header_notifications')}
                className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer relative"
              >
                <Bell className="w-4 h-4" />
                {targetedBellCount > 0 && (
                  <span
                    data-testid="desktop-bell-badge"
                    className="ml-1 font-mono text-[10px] font-bold text-amber-600"
                  >
                    {targetedBellCount}
                  </span>
                )}
              </button>

              {notificationsOpen && (
                <div className="absolute right-0 mt-2 w-96 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-3.5 z-40 text-xs space-y-2.5">
                  <div className="font-bold text-slate-900 dark:text-white flex items-center justify-between gap-2 pb-1.5 border-b border-slate-100 dark:border-slate-800">
                    <div>
                      <span>{t('header_notifications')}</span>
                      <span
                        aria-live="polite"
                        data-testid="desktop-notifications-active-count"
                        className="ml-2 font-mono text-slate-400"
                      >
                        ({targetedOrderNotifs.length + lowStockProducts.length})
                      </span>
                    </div>
                    <button
                      type="button"
                      data-testid="desktop-mark-all-notifications-read-btn"
                      disabled={targetedOrderNotifs.length + lowStockProducts.length === 0}
                      onClick={() => {
                        const allKeys = [
                          ...targetedOrderNotifs.map((n) => n.notifKey),
                          ...lowStockProducts.map((p) =>
                            buildNotificationKey(
                              'STOCK_LOW_ALERT',
                              p.id,
                              (p.quantity || 0) <= 0 ? 'OUT' : 'LOW'
                            )
                          ),
                        ];
                        if (allKeys.length > 0) {
                          dismissNotificationKeys(allKeys).catch(() => {});
                        }
                      }}
                      className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none text-[11px] font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
                    >
                      {tr(language, 'Tout marquer comme lu', 'Mark all as read', 'Alles als gelezen')}
                    </button>
                  </div>

                  {targetedOrderNotifs.length > 0 && (
                    <div className="max-h-48 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800 border-b border-slate-200 dark:border-slate-800 pb-1">
                      {targetedOrderNotifs.slice(0, 10).map((n) => {
                        const descriptor = getNotificationCardDescriptor(
                          n,
                          (language as 'fr' | 'en' | 'nl') || 'fr'
                        );
                        const isCancelledOrRejected =
                          n.notificationType === 'ORDER_MODIFIED_OR_CANCELLED' ||
                          n.order.status === 'CANCELLED' ||
                          n.order.status === 'REJECTED';
                        return (
                          <div
                            key={n.notifKey}
                            className="py-1.5 flex items-center justify-between gap-2"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                if (
                                  shouldAutoDismissOnCardClick(n.notificationType) ||
                                  shouldAutoDismissOnCardClick(n.order.status)
                                ) {
                                  dismissNotificationKeys([n.notifKey]).catch(() => {});
                                }
                                setNotificationsOpen(false);
                                setSelectedOrderId(n.order.id);
                                handleNavigatePage(
                                  n.notificationType === 'ORDER_PENDING_PREP' ||
                                    n.notificationType === 'ORDER_ASSIGNED'
                                    ? 'preparation'
                                    : 'orders'
                                );
                              }}
                              className="flex-1 min-w-0 text-left hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg p-1 cursor-pointer"
                            >
                              <div
                                className={`truncate font-bold ${
                                  isCancelledOrRejected
                                    ? 'text-rose-600 dark:text-rose-400'
                                    : 'text-orange-600 dark:text-orange-400'
                                }`}
                              >
                                {descriptor.title}
                              </div>
                              {isCancelledOrRejected && (descriptor.reason || descriptor.author) && (
                                <div className="text-[10px] text-rose-600 dark:text-rose-300 truncate">
                                  {descriptor.reason ? `${descriptor.reason} ` : ''}
                                  {descriptor.author ? `(${descriptor.author})` : ''}
                                </div>
                              )}
                              <div className="text-[10px] text-slate-500">
                                {n.order.order_number} • {descriptor.actionLabel}
                              </div>
                            </button>
                            <button
                              type="button"
                              data-testid={`desktop-dismiss-notif-${n.notifKey}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                dismissNotificationKeys([n.notifKey]).catch(() => {});
                              }}
                              className="min-w-[44px] min-h-[44px] rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-slate-800 dark:hover:text-white shrink-0 cursor-pointer"
                              title={tr(language, 'Marquer comme lue', 'Mark as read', 'Markeren als gelezen')}
                              aria-label={tr(language, 'Marquer comme lue', 'Mark as read', 'Markeren als gelezen')}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {lowStockProducts.length === 0 && targetedOrderNotifs.length === 0 ? (
                    <div className="py-4 text-center text-slate-500">
                      {tr(language, 'Aucune notification ciblée.', 'No targeted notifications.', 'Geen gerichte meldingen.')}
                    </div>
                  ) : (
                    lowStockProducts.length > 0 && (
                      <div className="max-h-56 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800">
                        {lowStockProducts.slice(0, 12).map((p) => {
                          const stockKey = buildNotificationKey(
                            'STOCK_LOW_ALERT',
                            p.id,
                            (p.quantity || 0) <= 0 ? 'OUT' : 'LOW'
                          );
                          return (
                            <div
                              key={stockKey}
                              className="py-1 flex items-center justify-between gap-2"
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  dismissNotificationKeys([stockKey]).catch(() => {});
                                  setNotificationsOpen(false);
                                  handleNavigatePage('inventory');
                                  setActiveProductId(p.id);
                                }}
                                className="flex-1 min-w-0 py-1 text-left hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between gap-2 cursor-pointer"
                              >
                                <span className="truncate font-medium">
                                  <span className="font-mono text-slate-500 mr-1">{p.reference}</span>
                                  {p.brand} {p.model}
                                </span>
                                <span className="font-mono tabular-nums font-bold text-amber-600 shrink-0">
                                  {p.quantity ?? 0} / {p.min_stock_alert ?? 2}
                                </span>
                              </button>
                              <button
                                type="button"
                                data-testid={`desktop-dismiss-notif-${stockKey}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  dismissNotificationKeys([stockKey]).catch(() => {});
                                }}
                                className="min-w-[44px] min-h-[44px] rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-slate-800 dark:hover:text-white shrink-0 cursor-pointer"
                                title={tr(language, 'Marquer comme lue', 'Mark as read', 'Markeren als gelezen')}
                                aria-label={tr(language, 'Marquer comme lue', 'Mark as read', 'Markeren als gelezen')}
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )
                  )}

                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                    {!confirmingResetBell ? (
                      <button
                        type="button"
                        data-testid="desktop-reset-my-bell-btn"
                        onClick={() => setConfirmingResetBell(true)}
                        className="w-full text-center text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 py-1 cursor-pointer"
                      >
                        {tr(
                          language,
                          'Réinitialiser ma cloche',
                          'Reset my bell',
                          'Mijn meldingen herstellen'
                        )}
                      </button>
                    ) : (
                      <div className="flex items-center justify-between gap-2 text-[11px] bg-slate-50 dark:bg-slate-800 p-2 rounded-xl">
                        <span className="text-slate-600 dark:text-slate-300">
                          {tr(
                            language,
                            "Cela n'affecte que votre cloche",
                            'This only affects your bell',
                            'Dit heeft alleen invloed op uw eigen bel'
                          )}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => setConfirmingResetBell(false)}
                            className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-600"
                          >
                            {t('common_cancel')}
                          </button>
                          <button
                            type="button"
                            data-testid="desktop-confirm-reset-my-bell-btn"
                            onClick={() => {
                              resetMyNotificationDismissals().catch(() => {});
                              setConfirmingResetBell(false);
                            }}
                            className="px-2 py-0.5 rounded bg-orange-600 text-white font-bold"
                          >
                            {tr(language, 'Confirmer', 'Confirm', 'Bevestigen')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Language Selector */}
            <div className="flex items-center p-0.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-bold">
              {SUPPORTED_LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  onClick={() => setLanguage(l.code)}
                  className={`px-2 py-1 rounded-lg transition cursor-pointer ${
                    language === l.code
                      ? 'bg-white dark:bg-slate-900 text-orange-600 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'
                  }`}
                >
                  {l.shortLabel}
                </button>
              ))}
            </div>

            {/* Theme Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? t('header_theme_light') : t('header_theme_dark')}
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
            </button>

            {/* User Profile Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setUserMenuOpen((v) => !v)}
                className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2 text-xs font-semibold cursor-pointer"
              >
                <span className="w-6 h-6 rounded-lg bg-orange-600 text-white font-bold text-[11px] flex items-center justify-center">
                  {currentUser?.trigram || 'USR'}
                </span>
                <span className="max-w-[120px] truncate">{currentUser?.name}</span>
              </button>

              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-60 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-2 z-40 text-xs space-y-1">
                  <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800">
                    <div className="font-bold text-slate-900 dark:text-white truncate">
                      {currentUser?.name}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {currentUser?.department || '—'}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setUserMenuOpen(false);
                      handleNavigatePage('settings', 'profile');
                    }}
                    className="w-full px-3 py-2 rounded-xl text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 font-medium cursor-pointer"
                  >
                    <UserIcon className="w-3.5 h-3.5 text-orange-600" />
                    <span>{tr(language, 'Mon profil & code PIN', 'Profile & PIN', 'Mijn profiel & pincode')}</span>
                  </button>

                  {!confirmWipeOpen ? (
                    <button
                      type="button"
                      onClick={() => setConfirmWipeOpen(true)}
                      className="w-full px-3 py-2 rounded-xl text-left hover:bg-amber-50 dark:hover:bg-amber-950/30 text-amber-700 dark:text-amber-300 flex items-center gap-2 font-medium cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>
                        {tr(
                          language,
                          'Effacer les données de cet appareil',
                          'Clear device local data',
                          'Gegevens van dit apparaat wissen'
                        )}
                      </span>
                    </button>
                  ) : (
                    <div className="p-2 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 space-y-1.5">
                      <div className="text-[11px] font-semibold text-red-800 dark:text-red-200">
                        {tr(
                          language,
                          'Confirmer la suppression locale ?',
                          'Confirm local data wipe?',
                          'Lokale gegevens wissen bevestigen?'
                        )}
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => wipeDeviceAndSignOut()}
                          className="px-2.5 py-1 rounded bg-red-600 text-white font-semibold cursor-pointer"
                        >
                          {tr(language, 'Effacer', 'Wipe', 'Wissen')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmWipeOpen(false)}
                          className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 cursor-pointer"
                        >
                          {tr(language, 'Annuler', 'Cancel', 'Annuleren')}
                        </button>
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setUserMenuOpen(false);
                      logout();
                    }}
                    className="w-full px-3 py-2 rounded-xl text-left hover:bg-red-50 dark:hover:bg-red-950/30 text-red-600 dark:text-red-400 flex items-center gap-2 font-semibold cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>{t('header_logout')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Global Error / Server Rejection / SQL Readiness Notification Banner on Desktop */}
        {licenseNotification && (
          <div
            role="alert"
            className="px-5 py-2.5 bg-rose-600 text-white text-xs font-bold flex items-center justify-between gap-3 shrink-0 shadow-xs no-print"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="truncate">{licenseNotification}</span>
            </div>
            <button
              type="button"
              onClick={dismissLicenseNotification}
              className="px-2 py-0.5 rounded bg-white/15 hover:bg-white/25 text-white text-[11px] font-black shrink-0 cursor-pointer"
            >
              {tr(language, 'Fermer', 'Dismiss', 'Sluiten')}
            </button>
          </div>
        )}

        {/* LOT 1.3 v48 : Bandeau discret unique si core_user_preferences / script SQL 12 est manquant */}
        {prefsSyncBanner.visible && (
          <div
            role="status"
            className="px-5 py-2 bg-violet-50 dark:bg-violet-950/60 border-b border-violet-200 dark:border-violet-800 text-violet-900 dark:text-violet-200 text-xs font-bold flex items-center justify-between gap-3 shrink-0 no-print"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0" />
              <span className="truncate">
                {tr(
                  language,
                  'Préférences non synchronisées (script SQL 12 manquant)',
                  'Preferences not synchronized (SQL script 12 missing)',
                  'Voorkeuren niet gesynchroniseerd (SQL-script 12 ontbreekt)'
                )}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  dismissUserPreferencesSyncBanner();
                  handleNavigatePage('settings', 'license');
                }}
                className="px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-extrabold cursor-pointer"
              >
                {tr(language, '3. Scripts SQL', '3. SQL Scripts', '3. SQL-scripts')}
              </button>
              <button
                type="button"
                onClick={dismissUserPreferencesSyncBanner}
                className="px-2 py-1 rounded-lg border border-violet-300 dark:border-violet-700 text-[11px] font-bold cursor-pointer"
              >
                {tr(language, 'Fermer', 'Dismiss', 'Sluiten')}
              </button>
            </div>
          </div>
        )}

        {/* LOT 3 v43 : Avertissement quand le dépôt sélectionné dans la barre du haut est en veille */}
        {globalDepot !== 'ALL' &&
          depots.some(
            (d) =>
              d.name.trim().toLowerCase() === globalDepot.trim().toLowerCase() &&
              d.is_active === false
          ) && (
            <div
              role="alert"
              className="px-5 py-2 bg-amber-50 dark:bg-amber-950/60 border-b border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs font-bold flex items-center justify-between gap-3 shrink-0 no-print"
            >
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="truncate">
                  {tr(
                    language,
                    `Attention : le dépôt sélectionné « ${globalDepot} » est en veille (fermé temporairement). Les mouvements de stock vers ou depuis ce dépôt sont bloqués tant qu'il n'est pas réactivé.`,
                    `Warning: the selected depot "${globalDepot}" is on standby (temporarily closed). Stock movements to or from this depot are blocked until it is reactivated.`,
                    `Let op: het geselecteerde depot "${globalDepot}" staat op stand-by (tijdelijk gesloten). Voorraadbewegingen naar of vanuit dit depot zijn geblokkeerd totdat het opnieuw wordt geactiveerd.`
                  )}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setGlobalDepot('ALL');
                  try {
                    localStorage.setItem(DESKTOP_GLOBAL_DEPOT_KEY, 'ALL');
                  } catch {}
                }}
                className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-black shrink-0 cursor-pointer"
              >
                {tr(
                  language,
                  'Afficher tous les dépôts',
                  'Show all depots',
                  'Alle depots tonen'
                )}
              </button>
            </div>
          )}

        {/* Page Viewport */}
        <main className="flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden">
          {activePage === 'dashboard' && (
            <DesktopDashboardPage
              onNavigatePage={(p) => handleNavigatePage(p)}
              onOpenProductDetail={(prodId) => {
                setActiveProductId(prodId);
                handleNavigatePage('inventory');
              }}
            />
          )}

          {activePage === 'inventory' && (
            <DesktopInventoryPage
              externalSearchFocusTrigger={searchFocusTrigger}
              externalNewProductTrigger={newProductTrigger}
              globalDepotFilter={globalDepot}
              onOpenCsvImportModal={onOpenCsvImportModal}
            />
          )}

          {activePage === 'audit' &&
            (renderAuditPage ? renderAuditPage({ globalDepotFilter: globalDepot }) : null)}

          {activePage === 'audit_log' &&
            (renderAuditLogPage ? renderAuditLogPage() : <DesktopAuditLogPage />)}

          {activePage === 'movements' &&
            (renderMovementsPage ? (
              renderMovementsPage({ globalDepotFilter: globalDepot })
            ) : null)}

          {activePage === 'transfers' && <DesktopTransfersPage />}

          {activePage === 'orders' &&
            (renderOrdersPage ? (
              renderOrdersPage({
                selectedOrderId,
                onSelectOrder: setSelectedOrderId,
                externalNewOrderTrigger: newOrderTrigger,
              })
            ) : null)}

          {activePage === 'preparation' &&
            (renderPreparationPage ? (
              renderPreparationPage({
                selectedOrderId,
                f2Trigger,
                f4Trigger,
                f8Trigger,
              })
            ) : null)}

          {activePage === 'print_station' &&
            (renderPrintStationPage ? renderPrintStationPage() : null)}

          {activePage === 'reports' &&
            (renderReportsPage ? (
              renderReportsPage({ globalDepotFilter: globalDepot })
            ) : (
              <DesktopReportsPage selectedDepotFilter={globalDepot} />
            ))}

          {activePage === 'settings' &&
            (renderSettingsPage ? (
              renderSettingsPage({
                section: settingsSection,
                onChangeSection: setSettingsSection,
              })
            ) : null)}
        </main>
      </div>

      {/* Command Palette (Ctrl+K / Cmd+K) */}
      <DesktopCommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onNavigatePage={(p) => handleNavigatePage(p)}
        onSelectProduct={(prodId) => {
          setActiveProductId(prodId);
          handleNavigatePage('inventory');
        }}
        onSelectOrder={(ordId) => {
          setSelectedOrderId(ordId);
          handleNavigatePage('orders');
        }}
        onNewProduct={() => {
          handleNavigatePage('inventory');
          setNewProductTrigger((n) => n + 1);
        }}
        onNewMovement={() => {
          if (onOpenQuickMovementDrawer) {
            onOpenQuickMovementDrawer();
          } else {
            handleNavigatePage('movements');
          }
        }}
        onPrintLabels={() => {
          if (onOpenDesktopLabelModal) {
            onOpenDesktopLabelModal();
          } else {
            handleNavigatePage('print_station');
          }
        }}
      />

      {/* Keyboard Shortcuts Help (? or Ctrl+/) */}
      <DesktopShortcutsModal
        open={shortcutsHelpOpen}
        onClose={() => setShortcutsHelpOpen(false)}
      />
    </div>
  );
};
