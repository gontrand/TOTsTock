import React, { useEffect, useState } from 'react';
import {
  setDesktopMenuLocale,
  subscribeDesktopMenuCommand,
  subscribeDesktopNavigateRoute,
} from '../services/desktopBridge';
import { tr } from '../i18n/dutchTranslator';
import { SUPPORTED_LANGUAGES } from '../i18n/translations';
import { useApp } from '../context/AppContext';
import { PLAN_LABELS, normalizeToCanonicalPlan } from '../types';
import { APP_VERSION } from '../appVersion';
import { matchDesktopShortcut } from '../services/desktopInventoryLogic';
import { canUserAccessScannerMode } from '../services/orderPickingLogic';
import {
  DesktopPageId,
  DesktopSettingsSection,
  DESKTOP_GLOBAL_DEPOT_KEY,
  DESKTOP_LAST_PAGE_KEY,
  DESKTOP_SIDEBAR_COLLAPSED_KEY,
} from './types';
import { DesktopDashboardPage } from './pages/DesktopDashboardPage';
import { DesktopInventoryPage } from './pages/DesktopInventoryPage';
import { DesktopCommandPalette } from './components/DesktopCommandPalette';
import { DesktopShortcutsModal } from './components/DesktopShortcutsModal';
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
  FileSpreadsheet,
  Users,
  Warehouse,
  FolderTree,
  Building2,
  Mail,
  BookOpen,
  Info,
} from 'lucide-react';

interface DesktopShellProps {
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
  renderSettingsPage?: (props: {
    section: DesktopSettingsSection;
    onChangeSection: (s: DesktopSettingsSection) => void;
  }) => React.ReactNode;
  onOpenCsvImportModal?: () => void;
  onOpenQuickMovementDrawer?: () => void;
  onOpenDesktopLabelModal?: () => void;
}

export const DesktopShell: React.FC<DesktopShellProps> = ({
  renderMovementsPage,
  renderOrdersPage,
  renderPreparationPage,
  renderPrintStationPage,
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
    products,
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
  } = useApp();

  // Persisted sidebar collapse state
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DESKTOP_SIDEBAR_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Persisted active desktop page
  const [activePage, setActivePage] = useState<DesktopPageId>(() => {
    try {
      const saved = localStorage.getItem(DESKTOP_LAST_PAGE_KEY) as DesktopPageId | null;
      if (
        saved &&
        [
          'dashboard',
          'inventory',
          'movements',
          'orders',
          'preparation',
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
  };

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(DESKTOP_SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        // Ignore
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
    const execCmd = (cmd: string) => {
      if (cmd === 'toggle-sidebar') toggleSidebar();
      else if (cmd === 'open-shortcuts') setShortcutsHelpOpen(true);
      else if (cmd === 'open-docs') handleNavigatePage('settings', 'documentation');
      else if (cmd === 'open-about') handleNavigatePage('settings', 'about');
      else if (cmd === 'print-labels') onOpenDesktopLabelModal?.();
      else if (cmd === 'import-csv') onOpenCsvImportModal?.();
      else if (cmd === 'new-movement') onOpenQuickMovementDrawer?.();
      else if (cmd === 'new-product') {
        handleNavigatePage('inventory');
        setNewProductTrigger((n) => n + 1);
      } else if (cmd === 'new-order') {
        handleNavigatePage('orders');
        setNewOrderTrigger((n) => n + 1);
      } else if (cmd === 'focus-search') {
        handleNavigatePage('inventory');
        setSearchFocusTrigger((n) => n + 1);
      } else if (cmd === 'command-palette') {
        setCommandPaletteOpen(true);
      } else if (cmd === 'nav-dashboard') handleNavigatePage('dashboard');
      else if (cmd === 'nav-inventory') handleNavigatePage('inventory');
      else if (cmd === 'nav-movements') handleNavigatePage('movements');
      else if (cmd === 'nav-orders') handleNavigatePage('orders');
      else if (cmd === 'nav-preparation') handleNavigatePage('preparation');
      else if (cmd === 'nav-print-station') handleNavigatePage('print_station');
      else if (cmd === 'nav-settings') handleNavigatePage('settings', 'profile');
    };

    const handleNativeMenuCommand = (ev: Event) => {
      const custom = ev as CustomEvent<{ command?: string }>;
      const cmd = custom.detail?.command;
      if (cmd) execCmd(cmd);
    };

    const unsubMenu = subscribeDesktopMenuCommand((cmd) => execCmd(cmd));
    const unsubNav = subscribeDesktopNavigateRoute((route) => {
      const r = route.replace(/^\/+/, '');
      if (
        r === 'dashboard' ||
        r === 'inventory' ||
        r === 'movements' ||
        r === 'orders' ||
        r === 'preparation' ||
        r === 'print_station' ||
        r === 'settings'
      ) {
        handleNavigatePage(r as DesktopPageId);
      }
    });

    window.addEventListener('tot-desktop-menu-command', handleNativeMenuCommand);
    return () => {
      window.removeEventListener('tot-desktop-menu-command', handleNativeMenuCommand);
      unsubMenu();
      unsubNav();
    };
  }, [onOpenDesktopLabelModal, onOpenCsvImportModal, onOpenQuickMovementDrawer]);

  // Permissions (same as PlusMenuView)
  const canDashboard =
    userHasPermission('perm_tab_dashboard') || userHasPermission('perm_dash_kpi');
  const canInventory =
    userHasPermission('perm_tab_inventory') || userHasPermission('perm_prod_view');
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

  const pendingPrepCount = orders.filter(
    (o) => o.status === 'PENDING' || o.status === 'PREPARING'
  ).length;
  const lowStockProducts = products.filter(
    (p) => (p.quantity || 0) <= (p.min_stock_alert || 2)
  );

  const canonicalPlan = normalizeToCanonicalPlan(
    license?.plan || license?.plan_type,
    license?.license_key
  );
  const planLabel = PLAN_LABELS[canonicalPlan];

  return (
    <div
      id="desktop-workspace-root"
      className="h-screen w-screen min-w-[1024px] min-h-[680px] flex overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 select-none"
    >
      {/* Left Collapsible Sidebar */}
      <aside
        aria-label={tr(language, 'Navigation principale', 'Main navigation', 'Hoofdnavigatie')}
        className={`${
          sidebarCollapsed ? 'w-16' : 'w-60'
        } shrink-0 h-full bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between transition-all duration-150 no-print`}
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

            <select
              value={globalDepot}
              onChange={(e) => {
                const val = e.target.value;
                setGlobalDepot(val);
                try {
                  localStorage.setItem(DESKTOP_GLOBAL_DEPOT_KEY, val);
                } catch {
                  // Ignore
                }
              }}
              aria-label={tr(language, 'Sélecteur de dépôt global', 'Global depot selector', 'Globaal depotselectie')}
              className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer"
            >
              <option value="ALL">
                {tr(language, 'Tous les dépôts', 'All depots', 'Alle depots')}
              </option>
              {depots.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          {/* Right: Sync Status, License, Notifications, Language, Theme, User Menu */}
          <div className="flex items-center gap-2.5 shrink-0">
            {/* Sync / Offline Indicator */}
            <button
              type="button"
              onClick={() => syncFromSupabase()}
              title={tr(
                language,
                'Synchroniser avec Supabase',
                'Sync with Supabase',
                'Synchroniseren met Supabase'
              )}
              className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer whitespace-nowrap shrink-0"
            >
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
                {lowStockProducts.length > 0 && (
                  <span className="ml-1 font-mono text-[10px] font-bold text-amber-600">
                    {lowStockProducts.length}
                  </span>
                )}
              </button>

              {notificationsOpen && (
                <div className="absolute right-0 mt-2 w-80 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-3 z-40 text-xs space-y-2">
                  <div className="font-bold text-slate-900 dark:text-white flex items-center justify-between">
                    <span>{t('header_notifications')}</span>
                    <span className="font-mono text-slate-400">{lowStockProducts.length}</span>
                  </div>
                  {lowStockProducts.length === 0 ? (
                    <div className="py-4 text-center text-slate-500">
                      {tr(language, 'Aucune alerte de stock.', 'No stock alerts.', 'Geen voorraadmeldingen.')}
                    </div>
                  ) : (
                    <div className="max-h-64 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800">
                      {lowStockProducts.slice(0, 12).map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setNotificationsOpen(false);
                            handleNavigatePage('inventory');
                            setActiveProductId(p.id);
                          }}
                          className="w-full py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between gap-2 cursor-pointer"
                        >
                          <span className="truncate font-medium">
                            <span className="font-mono text-slate-500 mr-1">{p.reference}</span>
                            {p.brand} {p.model}
                          </span>
                          <span className="font-mono tabular-nums font-bold text-amber-600 shrink-0">
                            {p.quantity ?? 0} / {p.min_stock_alert ?? 2}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
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

          {activePage === 'movements' &&
            (renderMovementsPage ? (
              renderMovementsPage({ globalDepotFilter: globalDepot })
            ) : null)}

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
