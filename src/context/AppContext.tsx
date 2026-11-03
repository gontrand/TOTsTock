import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { tr } from '../i18n/dutchTranslator';
import {
  Product,
  StockMovement,
  Role,
  User,
  Department,
  Project,
  SubCategory,
  Depot,
  BatchCartItem,
  MovementType,
  ReleaseNote,
  LicensePlan,
  LicenseInfo,
  LicenseVerificationResult,
  PLAN_LABELS,
  PLAN_TIERS,
  isRecognizedLicensePlan,
  normalizeToCanonicalPlan,
  getMaxDepotsForPlan,
  MaterialOrder,
  MaterialOrderItem,
  OrderStatus,
  OrderBasket,
  BatchBasket,
} from '../types';
import { ALL_MENU_BUTTON_KEYS } from '../data/permissionMatrix';
import {
  fetchMasterLogo,
  fetchReleaseNotes,
  DEFAULT_LOGO_SVG,
} from '../services/masterSupabase';
import {
  prewarmSmartphoneCameraStream,
  stopSmartphoneCameraStream,
} from '../utils/qrCodeHelper';
import {
  ActivityItem,
  getStoredActivities,
  logActivityEvent,
  clearAllStoredActivities,
} from '../services/activityService';
import {
  getSavedLicense,
  saveLicenseLocally,
  verifyLicenseKey,
  clearSavedLicense,
  provisionServerLicense,
  upgradeServerLicense,
  updateLicenseContactEmail,
  checkAndSync15DaysLicense,
  recoverCompanyLicenseFromServerAndClientDb,
  syncLicenseToClientDatabase,
  LicenseSyncResult,
  getDaysUntilNextCheck,
  isCheckDue,
  getPlanMaxReferences,
  normalizePlanType,
} from '../services/licenseService';
import {
  INITIAL_PRODUCTS,
  INITIAL_MOVEMENTS,
  INITIAL_ROLES,
  INITIAL_USERS,
  INITIAL_DEPARTMENTS,
  INITIAL_PROJECTS,
  INITIAL_SUBCATEGORIES,
  INITIAL_DEPOTS,
  DEFAULT_SUPER_ROLE,
  INITIAL_ORDERS,
  RECOMMENDED_ROLES_SPEC,
} from '../data/initialData';
import {
  verifyLocalDevicePin,
  hasLocalDevicePin,
  saveLocalDevicePin,
  hashPin,
  playScanBeep,
  getActiveCurrency,
  setActiveCurrency,
  isUserAllowedForDepot,
  isDepotClosed,
  canUserBorrowFromDepot,
  canUserEnterStockInDepot,
  playNewOrderBeep,
  formatCurrency,
  validateProductIdentifiersUniqueness,
} from '../utils/crypto';
import {
  adminCreateUser,
  adminUpdateUser,
  adminToggleBlockUser,
  adminDeleteUser,
  adminResetPassword,
  adminClearMustChangePin,
} from '../services/adminUsersService';
import { Language, translations, TranslationKey } from '../i18n/translations';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  getClientSupabase,
  fetchAllClientData,
  fetchLoginDirectory,
  fetchPublicAppSettings,
  formatPostgresErrorMessage,
  pushMovementToSupabase,
  upsertProductToSupabase,
  deleteProductFromSupabase,
  upsertDepartmentToSupabase,
  deleteDepartmentFromSupabase,
  upsertProjectToSupabase,
  deleteProjectFromSupabase,
  upsertRoleToSupabase,
  deleteRoleFromSupabase,
  upsertSubCategoryToSupabase,
  deleteSubCategoryFromSupabase,
  upsertDepotToSupabase,
  deleteDepotFromSupabase,
  upsertOrderToSupabase,
  allocateUniqueOrderNumberFromSupabase,
  computeNextOrderNumber,
  formatOrderDatePrefix,
  deleteOrderFromSupabase,
  fetchLiveOperationalData,
  mergeMaterialOrdersLists,
  syncAllDepotsToSupabase,
  checkDepotTableInSupabase,
  CheckDepotsTableResult,
  normalizeSupabaseUrl,
  normalizeSupabaseKey,
  isNetworkOrFetchError,
  exportAllLocalDataToSupabase,
  testClientSupabaseConnection,
  ConnectionTestResult,
  recordOrderPreparationScanToSupabase,
  recordInventoryAuditToSupabase,
  transitionOrderStatusSupabase,
  syncUserProfileAndDirectoryToSupabase,
  mirrorUsersDirectoryToSettings,
  mergeUserLists,
  normalizeProductRecord,
  normalizeMovementRecord,
  normalizeDepartmentRecord,
  normalizeProjectRecord,
  normalizeDepotRecord,
  normalizeOrderRecord,
  sanitizeUserForDirectory,
  isDefaultDemoEmail,
  fetchUserBasketsFromSupabase,
  pushUserBasketsToSupabase,
  getCanonicalUserBasketKey,
  mergeOrderBasketsForInitialSync,
  UserBasketSyncEntry,
  checkAppCompatibility,
  AppCompatStatus,
} from '../services/clientSupabase';
import {
  APP_VERSION,
  EXPECTED_SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
} from '../appVersion';
import {
  putToStore,
  putManyToStore,
  getAllFromStore,
  enqueueSyncOperation,
  migrateFromLocalStorageToIndexedDb,
} from '../services/offline/indexedDb';
import { processSyncQueue, performIncrementalSync } from '../services/offline/syncEngine';
import {
  verifyDevicePinWithLockout,
  wipeDeviceLocalData,
  verifyUserStatusOnResume,
  resetPinFailedAttempts,
  LAST_ACTIVITY_TS_KEY,
} from '../services/deviceSecurityService';

interface AppContextType {
  currentUser: User | null;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  activeTab: 'home' | 'search' | 'movements' | 'plus';
  setActiveTab: (tab: 'home' | 'search' | 'movements' | 'plus') => void;

  products: Product[];
  movements: StockMovement[];
  roles: Role[];
  users: User[];
  allUsers: User[];
  visibleUsers: User[];
  departments: Department[];
  projects: Project[];
  allProjects: Project[];
  visibleProjects: Project[];
  isDepartmentManagerOrDeputy: boolean;
  canViewCrossDepartment: boolean;
  canUserViewProject: (proj: Project) => boolean;
  canUserViewUser: (targetUser: User) => boolean;
  subCategories: SubCategory[];
  depots: Depot[];
  batchCart: BatchCartItem[];

  // Modals & Navigation triggers
  loginModalOpen: boolean;
  setLoginModalOpen: (open: boolean) => void;
  profileModalOpen: boolean;
  setProfileModalOpen: (open: boolean) => void;
  activeProductId: string | null;
  setActiveProductId: (id: string | null) => void;
  productFormState: { open: boolean; product: Product | null };
  setProductFormState: (state: { open: boolean; product: Product | null }) => void;
  scanState: { open: boolean; mode: 'SEARCH' | 'IN' | 'OUT' | 'CONFIG_SCAN' };
  setScanState: (state: { open: boolean; mode: 'SEARCH' | 'IN' | 'OUT' | 'CONFIG_SCAN' }) => void;
  batchCartModalOpen: boolean;
  setBatchCartModalOpen: (open: boolean) => void;
  actionSheetOpen: boolean;
  setActionSheetOpen: (open: boolean) => void;

  departmentsProjectsModal: { open: boolean; tab: 'deps' | 'projects' };
  setDepartmentsProjectsModal: (state: { open: boolean; tab: 'deps' | 'projects' }) => void;
  usersRolesModal: { open: boolean; tab: 'users' | 'roles' };
  setUsersRolesModal: (state: { open: boolean; tab: 'users' | 'roles' }) => void;
  categoriesModalOpen: boolean;
  setCategoriesModalOpen: (open: boolean) => void;
  depotsModalOpen: boolean;
  setDepotsModalOpen: (open: boolean) => void;
  emailReportsModalOpen: boolean;
  setEmailReportsModalOpen: (open: boolean) => void;
  smtpSettingsModalOpen: boolean;
  setSmtpSettingsModalOpen: (open: boolean) => void;
  companySetupModalOpen: boolean;
  setCompanySetupModalOpen: (open: boolean) => void;
  qrConfigGenModalOpen: boolean;
  setQrConfigGenModalOpen: (open: boolean) => void;
  appInfoModalOpen: boolean;
  setAppInfoModalOpen: (open: boolean) => void;
  releaseNotesModalOpen: boolean;
  setReleaseNotesModalOpen: (open: boolean) => void;
  notificationsModalOpen: boolean;
  setNotificationsModalOpen: (open: boolean) => void;
  printLabelsModal: { open: boolean; initialProductId?: string | null };
  setPrintLabelsModal: (state: { open: boolean; initialProductId?: string | null }) => void;
  printStationModalOpen: boolean;
  setPrintStationModalOpen: (open: boolean) => void;
  inventoryAuditModalOpen: boolean;
  setInventoryAuditModalOpen: (open: boolean) => void;
  diagnosticModalOpen: boolean;
  setDiagnosticModalOpen: (open: boolean) => void;
  inventoryAuditTargetDepot: string | null;
  setInventoryAuditTargetDepot: (depot: string | null) => void;
  openInventoryAuditForDepot: (depotName: string) => void;
  applyInventoryAdjustments: (
    adjustments: {
      productId: string;
      physicalCount: number;
      theoreticalQty: number;
      difference: number;
      reason?: string;
    }[]
  ) => Promise<{ success: boolean; updatedCount: number; message: string }>;

  // Activity Feed & Traceability
  storedActivities: ActivityItem[];
  logActivity: (event: Omit<ActivityItem, 'id' | 'timestamp'> & { timestamp?: string; id?: string }) => ActivityItem;
  clearActivities: () => void;

  // Supabase BYOD Config
  supabaseUrl: string;
  supabaseKey: string;
  supabaseConfig: { url: string; key: string };
  saveSupabaseConfig: (url: string, key: string) => void;
  pendingScannedConfig: { url: string; key: string; license_key?: string } | null;
  setPendingScannedConfig: (cfg: { url: string; key: string; license_key?: string } | null) => void;
  resetToDemoData: () => void;
  isSupabaseConnected: boolean;
  supabaseSyncStatus: 'idle' | 'syncing' | 'connected' | 'error';
  supabaseSyncMessage: string;
  syncFromSupabase: (overrideUrl?: string, overrideKey?: string) => Promise<boolean>;
  exportToSupabase: () => Promise<{ success: boolean; message: string }>;
  testConnection: (url: string, key: string) => Promise<ConnectionTestResult>;

  // Master Supabase Data (Logo & Release Notes)
  appLogoUrl: string;
  releaseNotes: ReleaseNote[];
  refreshReleaseNotes: () => Promise<void>;

  // App Settings
  settings: Record<string, string>;
  updateSetting: (key: string, value: string) => void;

  // Actions
  login: (userId: string | number, pin: string, isLocalUnlock?: boolean) => Promise<{ success: boolean; message?: string; requirePinReset?: boolean; user?: User }>;
  resetUserPinOnLogin: (userId: string | number, newPin: string) => Promise<{ success: boolean; message?: string }>;
  requestPasswordReset: (email: string) => Promise<{ success: boolean; message: string }>;
  verifyPasswordResetOtp: (email: string, token: string, newPassword: string) => Promise<{ success: boolean; message: string }>;
  passwordRecoveryMode: boolean;
  setPasswordRecoveryMode: (open: boolean) => void;
  logout: () => void;
  wipeDeviceAndSignOut: () => Promise<void>;
  updateUserPIN: (oldPin: string, newPin: string, confirmPin: string) => Promise<{ success: boolean; message?: string }>;
  userHasPermission: (permissionKey: string) => boolean;
  canViewPrices: boolean;

  // Product CRUD
  saveProduct: (
    productData: Partial<Product>,
    options?: { isNew?: boolean; editingId?: string | null }
  ) => Promise<boolean>;
  deleteProduct: (productId: string) => Promise<boolean>;

  // Cart & Movements
  addToCart: (product: Product, qty?: number) => void;
  updateCartQty: (productId: string, qty: number) => void;
  removeFromCart: (productId: string) => void;
  clearCart: () => void;
  confirmBatchMovements: (siteNumber?: string) => Promise<{ success: boolean; message?: string }>;

  // Material Orders & Preparation (Click & Collect Drive Chantier)
  orders: MaterialOrder[];
  orderCart: MaterialOrderItem[];
  orderBaskets: OrderBasket[];
  activeOrderBasketId: string;
  setActiveOrderBasketId: (id: string) => void;
  createOrderBasket: (name?: string, depotName?: string, siteNumber?: string) => string;
  deleteOrderBasket: (id: string) => void;
  renameOrderBasket: (id: string, name: string) => void;
  duplicateOrderBasket: (id: string) => void;
  moveOrderBasket: (id: string, direction: 'up' | 'down') => void;
  updateOrderBasketSite: (id: string, siteNumber: string) => void;
  updateOrderBasket: (id: string, updates: Partial<Pick<OrderBasket, 'name' | 'depot_name' | 'site_number' | 'notes'>>) => void;
  switchAndAddOrderBasket: (product: Product, quantity?: number) => { success: boolean; basketId: string };
  addToOrderCart: (
    product: Product,
    quantity?: number,
    targetBasketId?: string
  ) => { success: boolean; conflict?: boolean; currentDepot?: string; productDepot?: string; message?: string; basketId?: string };
  updateOrderCartQty: (productId: string | number, quantity: number) => void;
  removeFromOrderCart: (productId: string | number) => void;
  clearOrderCart: (targetBasketId?: string) => void;
  submitMaterialOrder: (siteNumber?: string, depotName?: string, notes?: string, targetBasketId?: string) => Promise<{ success: boolean; message: string; order?: MaterialOrder }>;
  assignOrderToMe: (orderId: string) => Promise<{ success: boolean; message: string }>;
  markOrderReady: (orderId: string, pickupZone?: string) => Promise<{ success: boolean; message: string }>;
  markOrderCollected: (
    orderId: string,
    options?: { signatureData?: string; proofPhotoUrl?: string }
  ) => Promise<{ success: boolean; message: string }>;
  updateMaterialOrder: (
    orderId: string,
    updates: {
      items?: MaterialOrderItem[];
      site_number?: string;
      site_name?: string;
      notes?: string;
      depot_name?: string;
    }
  ) => Promise<{ success: boolean; message: string }>;
  substituteOrderItem: (
    orderId: string,
    originalProductId: string | number,
    substituteProduct: Product,
    reason?: string
  ) => Promise<{ success: boolean; message: string }>;
  canApproveOrder: (order: MaterialOrder) => boolean;
  approveOrder: (orderId: string, notes?: string) => Promise<{ success: boolean; message: string }>;
  rejectOrder: (orderId: string, reason: string) => Promise<{ success: boolean; message: string }>;
  cancelOrder: (orderId: string, reason?: string) => Promise<{ success: boolean; message: string }>;
  deleteMaterialOrder: (orderId: string) => Promise<{ success: boolean; message: string }>;
  transferOrderPickup: (
    orderId: string,
    delegateUserId: string | number,
    notes?: string
  ) => Promise<{ success: boolean; message: string }>;
  validateOrderItemScanned: (
    orderId: string,
    productId: string | number,
    pickedQuantity: number,
    scannedBarcode: string
  ) => { success: boolean; message: string };
  unpickOrderItem: (orderId: string, productId: string | number) => void;
  toggleOrderItemPicked: (orderId: string, productId: string | number) => void;
  updateOrderItemAvailability: (
    orderId: string,
    productId: string | number,
    unavailable: boolean,
    comment?: string
  ) => void;
  isPreparer: boolean;
  isAdmin: boolean;
  isDepartmentManager: boolean;
  canViewArticleHistory: boolean;
  orderCartModalOpen: boolean;
  setOrderCartModalOpen: (open: boolean) => void;
  preparerOrdersModalOpen: boolean;
  setPreparerOrdersModalOpen: (open: boolean) => void;
  scannerPickingModeOpen: boolean;
  setScannerPickingModeOpen: (open: boolean) => void;
  scannerInitialOrderId: string | null;
  openScannerPickingMode: (orderId?: string | null) => void;

  // Departments CRUD
  saveDepartment: (dep: Partial<Department>) => Promise<boolean>;
  deleteDepartment: (id: number) => Promise<boolean>;

  // Projects CRUD
  saveProject: (proj: Partial<Project>) => Promise<boolean>;
  deleteProject: (id: number) => Promise<boolean>;

  // Roles CRUD
  saveRole: (role: Partial<Role>) => Promise<boolean>;
  deleteRole: (id: number) => Promise<boolean>;
  resetRolesToRecommended: () => Promise<boolean>;

  // Users CRUD
  saveUser: (userData: Partial<User>, rawPin?: string) => Promise<{ success: boolean; message?: string }>;
  deleteUser: (id: string | number) => Promise<boolean>;
  toggleBlockUser: (id: string | number) => Promise<boolean>;

  // Categories CRUD
  saveSubCategory: (name: string, id?: number) => Promise<boolean>;
  deleteSubCategory: (id: number) => Promise<boolean>;

  // Depots / Magasins CRUD
  maxDepots: number;
  saveDepot: (depotData: Partial<Depot> & { name: string }) => Promise<{ success: boolean; message: string; depot?: Depot }>;
  deleteDepot: (id: string | number, reassignToDepotName?: string) => Promise<{ success: boolean; message: string }>;
  toggleDepotStatus: (id: string | number) => Promise<{ success: boolean; message: string; is_active?: boolean }>;
  syncDepotsWithSupabase: () => Promise<{ success: boolean; message: string; count: number; isTableMissing?: boolean; isNetworkError?: boolean }>;
  testSupabaseDepotsTable: () => Promise<CheckDepotsTableResult>;

  // Language / i18n
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: (key: TranslationKey, fallback?: string) => string;

  // Security / Inactivity
  autoLogoutMinutes: number;
  setAutoLogoutMinutes: (minutes: number) => void;

  // Currency selection
  currency: string;
  setCurrency: (code: string) => void;

  // Documentation, Android Studio Guide & Marketing HTML Modal
  documentationModalOpen: { open: boolean; tab: 'manual' | 'android' | 'marketing' | 'supabase' };
  setDocumentationModalOpen: (state: { open: boolean; tab: 'manual' | 'android' | 'marketing' | 'supabase' }) => void;

  // License Management
  license: LicenseInfo;
  verifyLicense: (key: string, overrideUrl?: string, overrideKey?: string) => Promise<LicenseVerificationResult>;
  provisionLicense: (orgName: string, planTypeOrUrl?: string, clientUrl?: string, contactEmail?: string, billingCycle?: 'annual' | 'monthly') => Promise<LicenseVerificationResult>;
  upgradePlan: (targetPlan: LicensePlan, billingCycle?: 'annual' | 'monthly', contactEmail?: string) => Promise<LicenseVerificationResult>;
  updateContactEmail: (email: string) => Promise<{ success: boolean; message: string }>;
  removeLicense: () => void;
  syncLicenseWithServer: (force?: boolean, overrideUrl?: string, overrideKey?: string) => Promise<LicenseSyncResult>;
  daysUntilNextCheck: number;
  licenseNotification: string | null;
  dismissLicenseNotification: () => void;

  // App & Schema Compatibility (public.app_compat)
  appCompat: AppCompatStatus;
  recheckAppCompat: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const LOCAL_PREFIX = 'tot_inv_';

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Theme
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem(`${LOCAL_PREFIX}theme`) as 'light' | 'dark') || 'light';
  });

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      localStorage.setItem(`${LOCAL_PREFIX}theme`, next);
      if (next === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Language / i18n
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem('tqt_language');
    return saved === 'en' || saved === 'nl' || saved === 'fr' ? saved : 'fr';
  });

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('tqt_language', lang);
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguageState((prev) => {
      const next: Language = prev === 'fr' ? 'en' : prev === 'en' ? 'nl' : 'fr';
      localStorage.setItem('tqt_language', next);
      return next;
    });
  }, []);

  const t = useCallback(
    (key: TranslationKey, fallback?: string): string => {
      const dict = translations[language] || translations.fr;
      return dict[key] || fallback || key;
    },
    [language]
  );

  // Active Screen / Tab
  const [activeTab, setActiveTab] = useState<'home' | 'search' | 'movements' | 'plus'>('home');

  // Supabase Config
  const [supabaseUrl, setSupabaseUrl] = useState(() => {
    const raw = localStorage.getItem('tqt_company_url') || '';
    const clean = normalizeSupabaseUrl(raw);
    if (clean && clean !== raw) {
      localStorage.setItem('tqt_company_url', clean);
    }
    return clean;
  });
  const [supabaseKey, setSupabaseKey] = useState(() => {
    const raw = localStorage.getItem('tqt_company_key') || '';
    const clean = normalizeSupabaseKey(raw);
    if (clean && clean !== raw) {
      localStorage.setItem('tqt_company_key', clean);
    }
    return clean;
  });
  const supabaseClientRef = useRef<SupabaseClient | null>(null);

  const isSupabaseConnected = Boolean(supabaseUrl && supabaseKey);
  const supabaseConfig = useMemo(() => ({ url: supabaseUrl, key: supabaseKey }), [supabaseUrl, supabaseKey]);
  const [pendingScannedConfig, setPendingScannedConfig] = useState<{
    url: string;
    key: string;
    license_key?: string;
  } | null>(null);

  // Master Supabase Logo & Release Notes
  const [appLogoUrl, setAppLogoUrl] = useState<string>(
    () => localStorage.getItem('tot_app_logo_url') || DEFAULT_LOGO_SVG
  );
  const [releaseNotes, setReleaseNotes] = useState<ReleaseNote[]>([]);

  const refreshReleaseNotes = useCallback(async () => {
    const notes = await fetchReleaseNotes(supabaseClientRef.current);
    if (notes && notes.length > 0) {
      setReleaseNotes(notes);
    }
  }, []);

  // Fetch logo & release notes on mount or when client changes
  useEffect(() => {
    fetchMasterLogo(supabaseClientRef.current, true).then((url) => {
      if (url) {
        setAppLogoUrl(url);
        try {
          const iconLinks = document.querySelectorAll<HTMLLinkElement>("link[rel*='icon']");
          iconLinks.forEach((link) => {
            link.href = url;
          });
        } catch {}
      }
    });
    refreshReleaseNotes();
  }, [refreshReleaseNotes, supabaseUrl, supabaseKey]);

  const resetToDemoData = useCallback(() => {
    localStorage.removeItem('tqt_company_url');
    localStorage.removeItem('tqt_company_key');
    setSupabaseUrl('');
    setSupabaseKey('');
    setProducts(INITIAL_PRODUCTS);
    setMovements(INITIAL_MOVEMENTS);
    setRoles(INITIAL_ROLES);
    setUsers(INITIAL_USERS);
    setDepartments(INITIAL_DEPARTMENTS);
    setProjects(INITIAL_PROJECTS);
    setSubCategories(INITIAL_SUBCATEGORIES);
    setDepots(INITIAL_DEPOTS);
    clearAllStoredActivities();
    setStoredActivities(getStoredActivities());
  }, []);

  // License Management
  const [license, setLicense] = useState<LicenseInfo>(() => getSavedLicense());
  const [licenseNotification, setLicenseNotification] = useState<string | null>(null);

  const daysUntilNextCheck = useMemo(() => getDaysUntilNextCheck(license), [license]);

  const dismissLicenseNotification = useCallback(() => {
    setLicenseNotification(null);
  }, []);

  const syncLicenseWithServer = useCallback(
    async (force = false, overrideUrl?: string, overrideKey?: string): Promise<LicenseSyncResult> => {
      const effectiveUrl = normalizeSupabaseUrl(overrideUrl || supabaseUrl || localStorage.getItem('tqt_company_url') || '');
      const effectiveKey = normalizeSupabaseKey(overrideKey || supabaseKey || localStorage.getItem('tqt_company_key') || '');
      const client = getClientSupabase(effectiveUrl, effectiveKey);
      const res = await checkAndSync15DaysLicense(license, effectiveUrl, force, client);
      if (res.license) {
        setLicense(res.license);
        if (client && res.license.license_key && res.license.license_key !== 'TOT-STOCK-FREE-COMMUNITY') {
          syncLicenseToClientDatabase(res.license, client).catch(() => {});
        }
      }
      if (res.planChanged) {
        setLicenseNotification(res.message);
      }
      return res;
    },
    [license, supabaseUrl, supabaseKey]
  );

  // 15-Day check & Server plan change detector on startup, interval, and network reconnect
  useEffect(() => {
    // Always force license verification/recovery on launch or when Supabase URL/Key changes
    // so mobile devices immediately pick up the company's active license number
    syncLicenseWithServer(true).catch((e) => console.warn('Sync license init error:', e));

    // Check periodically every hour
    const interval = setInterval(() => {
      syncLicenseWithServer(false).catch((e) => console.warn('Periodic sync license error:', e));
    }, 60 * 60 * 1000);

    const handleOnline = () => {
      syncLicenseWithServer(true).catch((e) => console.warn('Online sync license error:', e));
    };

    window.addEventListener('online', handleOnline);
    return () => {
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
    };
  }, [supabaseUrl, supabaseKey]);

  const verifyLicense = useCallback(
    async (key: string, overrideUrl?: string, overrideKey?: string): Promise<LicenseVerificationResult> => {
      const effectiveUrl = normalizeSupabaseUrl(overrideUrl || supabaseUrl || localStorage.getItem('tqt_company_url') || '');
      const effectiveKey = normalizeSupabaseKey(overrideKey || supabaseKey || localStorage.getItem('tqt_company_key') || '');
      const res = await verifyLicenseKey(key, effectiveUrl);
      if (res.license) {
        saveLicenseLocally(res.license);
        setLicense(res.license);
        const client = getClientSupabase(effectiveUrl, effectiveKey);
        if (client) {
          syncLicenseToClientDatabase(res.license, client).catch((e) =>
            console.warn('Auto client db sync error:', e)
          );
        }
      }
      return res;
    },
    [supabaseUrl, supabaseKey]
  );

  const provisionLicense = useCallback(
    async (
      orgName: string,
      planTypeOrUrl?: string,
      clientUrl?: string,
      contactEmail?: string,
      billingCycle?: 'annual' | 'monthly'
    ): Promise<LicenseVerificationResult> => {
      let resolvedPlan = 'free';
      let resolvedUrl = clientUrl || supabaseUrl;

      if (planTypeOrUrl) {
        if (isRecognizedLicensePlan(planTypeOrUrl)) {
          resolvedPlan = normalizeToCanonicalPlan(planTypeOrUrl);
        } else if (planTypeOrUrl.startsWith('http') || planTypeOrUrl.includes('.')) {
          resolvedUrl = planTypeOrUrl;
        }
      }

      const res = await provisionServerLicense(orgName, resolvedUrl, resolvedPlan, contactEmail, billingCycle);
      if (res.license) {
        setLicense(res.license);
        if (supabaseClientRef.current) {
          syncLicenseToClientDatabase(res.license, supabaseClientRef.current).catch((e) =>
            console.warn('Auto client db sync error:', e)
          );
        }
      }
      return res;
    },
    [supabaseUrl]
  );

  const upgradePlan = useCallback(
    async (
      targetPlan: LicensePlan,
      billingCycle: 'annual' | 'monthly' = 'annual',
      contactEmail?: string
    ): Promise<LicenseVerificationResult> => {
      const res = await upgradeServerLicense(
        targetPlan,
        billingCycle,
        contactEmail || license.contact_email,
        license.organization_name,
        supabaseUrl
      );
      if (res.license) {
        setLicense(res.license);
      }
      return res;
    },
    [license.contact_email, license.organization_name, supabaseUrl]
  );

  const updateContactEmail = useCallback(
    async (email: string): Promise<{ success: boolean; message: string }> => {
      const res = await updateLicenseContactEmail(email);
      if (res.success) {
        setLicense((prev) => ({ ...prev, contact_email: email.trim() }));
      }
      return res;
    },
    []
  );

  const removeLicense = useCallback(() => {
    clearSavedLicense();
    setLicense(getSavedLicense());
  }, []);

  // Settings (strictly sanitize and prevent secrets in app_settings or localStorage)
  const [settings, setSettings] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem(`${LOCAL_PREFIX}settings`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        delete parsed.smtp_pass;
        delete parsed.password;
        delete parsed.brevo_api_key;
        delete parsed.apiKey;
        delete parsed.secret;
        return parsed;
      } catch {}
    }
    return {
      smtp_host: 'api.brevo.com',
      smtp_port: '443',
      smtp_secure_type: 'ssl',
      smtp_from: 'notifications@tot-stock.com',
    };
  });

  const updateSetting = useCallback((key: string, value: string) => {
    // Strictly prevent storing credentials in client-side app_settings or localStorage
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('pass') || lowerKey.includes('secret') || lowerKey.includes('token') || lowerKey.includes('key')) {
      console.warn(`Enregistrement du secret "${key}" bloqué côté client (doit être configuré via Supabase secrets côté serveur).`);
      return;
    }
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      localStorage.setItem(`${LOCAL_PREFIX}settings`, JSON.stringify(next));
      return next;
    });
  }, []);

  // Core Data Collections
  const [products, setProducts] = useState<Product[]>(() => {
    const saved = localStorage.getItem(`${LOCAL_PREFIX}products`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.map(normalizeProductRecord);
      } catch {}
    }
    return INITIAL_PRODUCTS.map(normalizeProductRecord);
  });

  const [movements, setMovements] = useState<StockMovement[]>(() => {
    const saved = localStorage.getItem(`${LOCAL_PREFIX}movements`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.map(normalizeMovementRecord);
      } catch {}
    }
    return INITIAL_MOVEMENTS.map(normalizeMovementRecord);
  });

  const [roles, setRoles] = useState<Role[]>(() => {
    const saved = localStorage.getItem(`${LOCAL_PREFIX}roles`);
    let list: Role[] = saved ? JSON.parse(saved) : INITIAL_ROLES;
    
    // Ensure Super Admin roles always have the full suite of permissions including delete & department/project management
    list = list.map((r) => {
      if (Number(r.id) === 0 || Number(r.id) === 1) {
        const perms = new Set(r.permissions || []);
        ALL_MENU_BUTTON_KEYS.forEach((k) => perms.add(k));
        return { ...r, permissions: Array.from(perms) };
      }
      if (Number(r.id) === 2) {
        const perms = new Set(r.permissions || []);
        INITIAL_ROLES[2]?.permissions?.forEach((k) => perms.add(k));
        return { ...r, permissions: Array.from(perms) };
      }
      if (Number(r.id) === 3) {
        const perms = new Set(r.permissions || []);
        INITIAL_ROLES[3]?.permissions?.forEach((k) => perms.add(k));
        return { ...r, permissions: Array.from(perms) };
      }
      return r;
    });

    // One-time upgrade: ensure initial roles (or roles with finance perms) have price visibility by default
    try {
      const priceMigrated = localStorage.getItem('tot_inv_perm_price_migrated_v1');
      if (!priceMigrated) {
        list = list.map((r) => {
          if (Number(r.id) <= 2 || r.permissions?.includes('perm_dash_finance')) {
            const perms = new Set(r.permissions || []);
            perms.add('perm_prod_view_price');
            return { ...r, permissions: Array.from(perms) };
          }
          return r;
        });
        localStorage.setItem('tot_inv_perm_price_migrated_v1', 'true');
      }
    } catch {}

    if (!list.some((r) => Number(r.id) === 0)) {
      list.unshift(DEFAULT_SUPER_ROLE);
    }
    return list;
  });

  const [users, setUsers] = useState<User[]>(() => {
    let deletedIds: string[] = [];
    try {
      const rawDel = localStorage.getItem('tot_deleted_user_ids');
      if (rawDel) deletedIds = JSON.parse(rawDel);
    } catch {}
    const activeInitial = INITIAL_USERS.filter((u) => !deletedIds.includes(String(u.id)));
    const saved = localStorage.getItem(`${LOCAL_PREFIX}users`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return mergeUserLists(activeInitial, parsed).filter(
            (u) => !(u as any).is_deleted && !deletedIds.includes(String(u.id))
          );
        }
      } catch {}
    }
    return activeInitial;
  });

  const [departments, setDepartments] = useState<Department[]>(() => {
    const saved = localStorage.getItem(`${LOCAL_PREFIX}departments`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.map(normalizeDepartmentRecord);
      } catch {}
    }
    return INITIAL_DEPARTMENTS.map(normalizeDepartmentRecord);
  });

  const [projects, setProjects] = useState<Project[]>(() => {
    const saved = localStorage.getItem(`${LOCAL_PREFIX}projects`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.map(normalizeProjectRecord);
      } catch {}
    }
    return INITIAL_PROJECTS.map(normalizeProjectRecord);
  });

  const [subCategories, setSubCategories] = useState<SubCategory[]>(() => {
    const saved = localStorage.getItem(`${LOCAL_PREFIX}subcategories`);
    return saved ? JSON.parse(saved) : INITIAL_SUBCATEGORIES;
  });

  const [depots, setDepots] = useState<Depot[]>(() => {
    const saved = localStorage.getItem(`${LOCAL_PREFIX}depots`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.map(normalizeDepotRecord);
      } catch {}
    }
    return INITIAL_DEPOTS.map(normalizeDepotRecord);
  });

  // Current Logged In User
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = localStorage.getItem(`${LOCAL_PREFIX}current_user`);
    return saved ? JSON.parse(saved) : null;
  });

  // Trigger license recovery/discovery when an authenticated user logs in and current plan is still free
  useEffect(() => {
    if (currentUser?.id && supabaseUrl && supabaseKey && license.plan_type === 'free') {
      syncLicenseWithServer(false).catch((e) =>
        console.warn('Post-login license discovery/sync error:', e)
      );
    }
  }, [currentUser?.id, supabaseUrl, supabaseKey, license.plan_type, syncLicenseWithServer]);

  // Batch Cart
  const [batchCart, setBatchCart] = useState<BatchCartItem[]>([]);

  // Modals
  const [loginModalOpen, setLoginModalOpen] = useState(!currentUser);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const [productFormState, setProductFormState] = useState<{ open: boolean; product: Product | null }>({
    open: false,
    product: null,
  });
  const [scanState, setScanStateInternal] = useState<{ open: boolean; mode: 'SEARCH' | 'IN' | 'OUT' | 'CONFIG_SCAN' }>({
    open: false,
    mode: 'OUT',
  });

  const setScanState = useCallback(
    (
      stateOrUpdater:
        | { open: boolean; mode: 'SEARCH' | 'IN' | 'OUT' | 'CONFIG_SCAN' }
        | ((prev: { open: boolean; mode: 'SEARCH' | 'IN' | 'OUT' | 'CONFIG_SCAN' }) => {
            open: boolean;
            mode: 'SEARCH' | 'IN' | 'OUT' | 'CONFIG_SCAN';
          })
    ) => {
      if (typeof stateOrUpdater === 'object') {
        if (stateOrUpdater.open) {
          prewarmSmartphoneCameraStream();
        } else {
          stopSmartphoneCameraStream(null, true);
        }
      }
      setScanStateInternal(stateOrUpdater);
    },
    []
  );
  const [batchCartModalOpen, setBatchCartModalOpen] = useState(false);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);

  const [departmentsProjectsModal, setDepartmentsProjectsModal] = useState<{ open: boolean; tab: 'deps' | 'projects' }>({
    open: false,
    tab: 'deps',
  });
  const [usersRolesModal, setUsersRolesModal] = useState<{ open: boolean; tab: 'users' | 'roles' }>({
    open: false,
    tab: 'users',
  });
  const [categoriesModalOpen, setCategoriesModalOpen] = useState(false);
  const [depotsModalOpen, setDepotsModalOpen] = useState(false);
  const [emailReportsModalOpen, setEmailReportsModalOpen] = useState(false);
  const [smtpSettingsModalOpen, setSmtpSettingsModalOpen] = useState(false);
  const [companySetupModalOpen, setCompanySetupModalOpen] = useState(false);
  const [qrConfigGenModalOpen, setQrConfigGenModalOpen] = useState(false);
  const [appInfoModalOpen, setAppInfoModalOpen] = useState(false);
  const [releaseNotesModalOpen, setReleaseNotesModalOpen] = useState(false);
  const [notificationsModalOpen, setNotificationsModalOpen] = useState(false);
  const [printLabelsModal, setPrintLabelsModal] = useState<{ open: boolean; initialProductId?: string | null }>({
    open: false,
  });
  const [printStationModalOpen, setPrintStationModalOpen] = useState(false);
  const [inventoryAuditModalOpen, setInventoryAuditModalOpen] = useState(false);
  const [diagnosticModalOpen, setDiagnosticModalOpen] = useState(false);
  const [inventoryAuditTargetDepot, setInventoryAuditTargetDepot] = useState<string | null>(null);

  const openInventoryAuditForDepot = useCallback((depotName: string) => {
    setInventoryAuditTargetDepot(depotName);
    setInventoryAuditModalOpen(true);
  }, []);
  const [documentationModalOpen, setDocumentationModalOpen] = useState<{
    open: boolean;
    tab: 'manual' | 'android' | 'marketing' | 'supabase';
  }>({
    open: false,
    tab: 'manual',
  });

  // Material Orders & Preparation (Click & Collect Drive Chantier)
  const [orders, setOrders] = useState<MaterialOrder[]>(() => {
    const saved = localStorage.getItem(`${LOCAL_PREFIX}orders`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.map(normalizeOrderRecord);
      } catch {}
    }
    return INITIAL_ORDERS.map(normalizeOrderRecord);
  });

  // Multiple Order Baskets state
  const [orderBaskets, setOrderBaskets] = useState<OrderBasket[]>(() => {
    const saved = localStorage.getItem(`${LOCAL_PREFIX}order_baskets`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {
        console.warn('[Storage] failed parsing order_baskets:', e);
      }
    }
    const legacySaved = localStorage.getItem(`${LOCAL_PREFIX}order_cart`);
    let initialItems: MaterialOrderItem[] = [];
    if (legacySaved) {
      try {
        initialItems = JSON.parse(legacySaved) || [];
      } catch {}
    }
    if (initialItems.length > 0) {
      return [
        {
          id: 'basket-1',
          name: 'Panier 1',
          depot_name: initialItems[0]?.depot_name || undefined,
          items: initialItems,
          created_at: new Date().toISOString(),
        },
      ];
    }
    return [];
  });

  const [activeOrderBasketId, setActiveOrderBasketIdState] = useState<string>(() => {
    return localStorage.getItem(`${LOCAL_PREFIX}active_order_basket_id`) || '';
  });

  const orderBasketsRef = useRef<OrderBasket[]>(orderBaskets);
  const activeOrderBasketIdRef = useRef<string>(activeOrderBasketId);
  const batchCartRef = useRef<BatchCartItem[]>(batchCart);

  useEffect(() => {
    orderBasketsRef.current = orderBaskets;
    localStorage.setItem(`${LOCAL_PREFIX}order_baskets`, JSON.stringify(orderBaskets));
  }, [orderBaskets]);

  useEffect(() => {
    activeOrderBasketIdRef.current = activeOrderBasketId;
    localStorage.setItem(`${LOCAL_PREFIX}active_order_basket_id`, activeOrderBasketId);
  }, [activeOrderBasketId]);

  useEffect(() => {
    batchCartRef.current = batchCart;
  }, [batchCart]);

  const getBasketTsStorageKey = useCallback((u: User | null) => {
    return u ? `${LOCAL_PREFIX}baskets_v2_ts_${getCanonicalUserBasketKey(u)}` : `${LOCAL_PREFIX}baskets_v2_ts_anon`;
  }, []);

  const lastPushedBasketTsRef = useRef<number>(0);

  // Isoler les paniers locaux si un compte différent se connecte sur le même appareil
  useEffect(() => {
    if (!currentUser) return;
    const ownerStorageKey = `${LOCAL_PREFIX}baskets_owner_v2`;
    const canonicalOwner = getCanonicalUserBasketKey(currentUser);
    if (!canonicalOwner || canonicalOwner === 'anon') return;
    try {
      const prevOwner = localStorage.getItem(ownerStorageKey);
      if (prevOwner && prevOwner !== canonicalOwner) {
        orderBasketsRef.current = [];
        activeOrderBasketIdRef.current = '';
        batchCartRef.current = [];
        setOrderBaskets([]);
        setActiveOrderBasketIdState('');
        setBatchCart([]);
        lastPushedBasketTsRef.current = 0;
      }
      localStorage.setItem(ownerStorageKey, canonicalOwner);
    } catch {}
  }, [currentUser]);

  const commitUserBasketsChange = useCallback(
    (
      nextBaskets: OrderBasket[],
      nextActiveBasketId?: string,
      nextBatchCart?: BatchCartItem[]
    ) => {
      const effectiveActiveId = nextActiveBasketId ?? activeOrderBasketIdRef.current;
      const effectiveBatchCart = nextBatchCart ?? batchCartRef.current;

      orderBasketsRef.current = nextBaskets;
      activeOrderBasketIdRef.current = effectiveActiveId;
      batchCartRef.current = effectiveBatchCart;

      setOrderBaskets(nextBaskets);
      if (nextActiveBasketId !== undefined) {
        setActiveOrderBasketIdState(nextActiveBasketId);
      }
      if (nextBatchCart !== undefined) {
        setBatchCart(nextBatchCart);
      }

      const nowTs = Date.now();
      lastPushedBasketTsRef.current = Math.max(lastPushedBasketTsRef.current, nowTs);
      try {
        localStorage.setItem(getBasketTsStorageKey(currentUser), String(nowTs));
      } catch {}

      const client = getClientSupabase(supabaseUrl, supabaseKey);
      if (client && currentUser) {
        pushUserBasketsToSupabase(
          client,
          currentUser,
          nextBaskets,
          effectiveActiveId,
          effectiveBatchCart,
          nowTs
        )
          .then((ok) => {
            if (ok) {
              lastPushedBasketTsRef.current = Math.max(lastPushedBasketTsRef.current, nowTs);
            }
          })
          .catch(() => {});
      }
    },
    [currentUser, supabaseUrl, supabaseKey, getBasketTsStorageKey]
  );

  const setActiveOrderBasketId = useCallback(
    (idOrUpdater: string | ((prev: string) => string)) => {
      const nextId =
        typeof idOrUpdater === 'function' ? idOrUpdater(activeOrderBasketIdRef.current) : idOrUpdater;
      commitUserBasketsChange(orderBasketsRef.current, nextId, batchCartRef.current);
    },
    [commitUserBasketsChange]
  );

  const reconcileUserBasketsWithRemote = useCallback(
    (remoteEntry?: UserBasketSyncEntry | null) => {
      if (!currentUser) return;
      const tsKey = getBasketTsStorageKey(currentUser);
      const localTs = Math.max(
        Number(localStorage.getItem(tsKey)) || 0,
        lastPushedBasketTsRef.current || 0
      );
      const localBaskets = orderBasketsRef.current;
      const localHasItems =
        localBaskets.some((b) => Array.isArray(b.items) && b.items.length > 0) ||
        batchCartRef.current.length > 0;
      const client = getClientSupabase(supabaseUrl, supabaseKey);

      if (remoteEntry && Array.isArray(remoteEntry.baskets)) {
        const remoteTs = Number(remoteEntry.updatedAt) || 0;
        const remoteHasItems =
          remoteEntry.baskets.some((b) => Array.isArray(b.items) && b.items.length > 0) ||
          (Array.isArray(remoteEntry.batchCart) && remoteEntry.batchCart.length > 0);

        if (localTs === 0) {
          // Première synchronisation de cet appareil avec le cloud pour ce compte utilisateur
          if (localHasItems && remoteHasItems) {
            const mergedBaskets = mergeOrderBasketsForInitialSync(localBaskets, remoteEntry.baskets);
            const mergedTs = Math.max(Date.now(), remoteTs + 1);
            orderBasketsRef.current = mergedBaskets;
            setOrderBaskets(mergedBaskets);
            lastPushedBasketTsRef.current = Math.max(lastPushedBasketTsRef.current, mergedTs);
            try {
              localStorage.setItem(tsKey, String(mergedTs));
            } catch {}
            if (client) {
              pushUserBasketsToSupabase(
                client,
                currentUser,
                mergedBaskets,
                activeOrderBasketIdRef.current,
                batchCartRef.current,
                mergedTs
              ).catch(() => {});
            }
          } else if (localHasItems && !remoteHasItems) {
            const mergedTs = Math.max(Date.now(), remoteTs + 1);
            lastPushedBasketTsRef.current = Math.max(lastPushedBasketTsRef.current, mergedTs);
            try {
              localStorage.setItem(tsKey, String(mergedTs));
            } catch {}
            if (client) {
              pushUserBasketsToSupabase(
                client,
                currentUser,
                localBaskets,
                activeOrderBasketIdRef.current,
                batchCartRef.current,
                mergedTs
              ).catch(() => {});
            }
          } else {
            // Appareil local vide : adopter immédiatement les paniers distants du compte
            orderBasketsRef.current = remoteEntry.baskets;
            activeOrderBasketIdRef.current =
              remoteEntry.activeBasketId || remoteEntry.baskets[0]?.id || '';
            setOrderBaskets(remoteEntry.baskets);
            setActiveOrderBasketIdState(activeOrderBasketIdRef.current);
            if (Array.isArray(remoteEntry.batchCart)) {
              batchCartRef.current = remoteEntry.batchCart;
              setBatchCart(remoteEntry.batchCart);
            }
            const adoptedTs = remoteTs || Date.now();
            lastPushedBasketTsRef.current = Math.max(lastPushedBasketTsRef.current, adoptedTs);
            try {
              localStorage.setItem(tsKey, String(adoptedTs));
            } catch {}
          }
        } else if (remoteTs > localTs) {
          // Modification plus récente effectuée sur l'autre support (PC ou Mobile)
          orderBasketsRef.current = remoteEntry.baskets;
          activeOrderBasketIdRef.current =
            remoteEntry.activeBasketId || remoteEntry.baskets[0]?.id || '';
          setOrderBaskets(remoteEntry.baskets);
          setActiveOrderBasketIdState(activeOrderBasketIdRef.current);
          if (Array.isArray(remoteEntry.batchCart)) {
            batchCartRef.current = remoteEntry.batchCart;
            setBatchCart(remoteEntry.batchCart);
          }
          lastPushedBasketTsRef.current = Math.max(lastPushedBasketTsRef.current, remoteTs);
          try {
            localStorage.setItem(tsKey, String(remoteTs));
          } catch {}
        } else if (localTs > remoteTs && client) {
          // Cet appareil a une modification plus récente (ex: suppression de panier) : pousser vers le cloud
          pushUserBasketsToSupabase(
            client,
            currentUser,
            localBaskets,
            activeOrderBasketIdRef.current,
            batchCartRef.current,
            localTs
          ).catch(() => {});
        }
      } else if (localHasItems && client) {
        // Aucun panier dans le cloud pour ce compte, mais cet appareil contient des articles : publier
        const initTs = localTs || Date.now();
        lastPushedBasketTsRef.current = Math.max(lastPushedBasketTsRef.current, initTs);
        try {
          localStorage.setItem(tsKey, String(initTs));
        } catch {}
        pushUserBasketsToSupabase(
          client,
          currentUser,
          localBaskets,
          activeOrderBasketIdRef.current,
          batchCartRef.current,
          initTs
        ).catch(() => {});
      }
    },
    [currentUser, supabaseUrl, supabaseKey, getBasketTsStorageKey]
  );

  const [orderCartModalOpen, setOrderCartModalOpen] = useState(false);
  const [preparerOrdersModalOpen, setPreparerOrdersModalOpen] = useState(false);
  const [scannerPickingModeOpen, setScannerPickingModeOpen] = useState(false);
  const [scannerInitialOrderId, setScannerInitialOrderId] = useState<string | null>(null);

  const openScannerPickingMode = useCallback((orderId?: string | null) => {
    prewarmSmartphoneCameraStream();
    setScannerInitialOrderId(orderId || null);
    setScannerPickingModeOpen(true);
  }, []);

  useEffect(() => {
    localStorage.setItem(`${LOCAL_PREFIX}orders`, JSON.stringify(orders));
    putManyToStore('material_orders', orders).catch((e) => console.warn('[IDB] put orders:', e));
  }, [orders]);

  // Active basket & computed orderCart (maintains full backward compatibility)
  const activeBasket = useMemo(() => {
    if (orderBaskets.length === 0) return null;
    return orderBaskets.find((b) => b.id === activeOrderBasketId) || orderBaskets[0] || null;
  }, [orderBaskets, activeOrderBasketId]);

  const orderCart = activeBasket?.items || [];

  // Auto-sync activeOrderBasketId if out of sync with existing baskets
  useEffect(() => {
    if (activeBasket && activeOrderBasketId !== activeBasket.id) {
      setActiveOrderBasketIdState(activeBasket.id);
    } else if (!activeBasket && activeOrderBasketId !== '') {
      setActiveOrderBasketIdState('');
    }
  }, [activeBasket, activeOrderBasketId]);

  useEffect(() => {
    localStorage.setItem(`${LOCAL_PREFIX}order_cart`, JSON.stringify(orderCart));
  }, [orderCart]);

  // Currency selection state (Restricted to Administrators & Supervisors)
  const [currency, setCurrencyState] = useState<string>(() => getActiveCurrency());
  const setCurrency = useCallback((code: string) => {
    // Permission check: only Administrators (role_id 1, SuperAdmin id 0/role 0, or roles with config permissions)
    const canChange =
      currentUser &&
      (Number(currentUser.id) === 0 ||
        Number(currentUser.role_id) === 0 ||
        Number(currentUser.role_id) === 1 ||
        roles
          .find((r) => Number(r.id) === Number(currentUser.role_id))
          ?.permissions?.some(
            (p) => p === 'perm_config_db' || p === 'perm_config_license' || p === 'perm_manage_roles'
          ));

    if (!canChange) {
      console.warn("Action non autorisée : La modification de la devise d'entreprise est réservée aux administrateurs.");
      return;
    }

    setActiveCurrency(code);
    setCurrencyState(code);
    localStorage.setItem('tot_app_currency', code);

    // Sync company currency to Supabase app_settings
    const client = getClientSupabase(supabaseUrl, supabaseKey);
    if (client) {
      client
        .from('app_settings')
        .upsert([{ key: 'company_currency', value: code, updated_at: new Date().toISOString() }])
        .then(({ error }) => {
          if (error) console.warn('Erreur synchronisation devise Supabase:', error);
        });
    }
  }, [currentUser, roles, supabaseUrl, supabaseKey]);

  // Activity Feed Events state
  const [storedActivities, setStoredActivities] = useState<ActivityItem[]>(() => getStoredActivities());

  const logActivity = useCallback(
    (event: Omit<ActivityItem, 'id' | 'timestamp'> & { timestamp?: string; id?: string }) => {
      const created = logActivityEvent(event);
      setStoredActivities((prev) => [created, ...prev.filter((i) => i.id !== created.id)].slice(0, 150));
      return created;
    },
    []
  );

  const clearActivities = useCallback(() => {
    clearAllStoredActivities();
    setStoredActivities(getStoredActivities());
  }, []);

  // Automatic non-destructive migration from localStorage to IndexedDB on boot (Priority 17)
  useEffect(() => {
    migrateFromLocalStorageToIndexedDb().catch((err) =>
      console.warn('[IndexedDB] Migration notice:', err)
    );
  }, []);

  // Sync to LocalStorage (instant cache) & IndexedDB (offline-first database)
  useEffect(() => {
    localStorage.setItem(`${LOCAL_PREFIX}products`, JSON.stringify(products));
    putManyToStore('products', products).catch((e) => console.warn('[IDB] put prods:', e));
  }, [products]);

  useEffect(() => {
    localStorage.setItem(`${LOCAL_PREFIX}movements`, JSON.stringify(movements));
    putManyToStore('stock_movements', movements).catch((e) => console.warn('[IDB] put movs:', e));
  }, [movements]);

  useEffect(() => {
    localStorage.setItem(`${LOCAL_PREFIX}roles`, JSON.stringify(roles));
    putManyToStore('roles', roles).catch((e) => console.warn('[IDB] put roles:', e));
  }, [roles]);

  useEffect(() => {
    localStorage.setItem(`${LOCAL_PREFIX}users`, JSON.stringify(users));
    putManyToStore('users', users).catch((e) => console.warn('[IDB] put users:', e));
  }, [users]);

  useEffect(() => {
    localStorage.setItem(`${LOCAL_PREFIX}departments`, JSON.stringify(departments));
    putManyToStore('departments', departments).catch((e) => console.warn('[IDB] put depts:', e));
  }, [departments]);

  useEffect(() => {
    localStorage.setItem(`${LOCAL_PREFIX}projects`, JSON.stringify(projects));
    putManyToStore('projects', projects).catch((e) => console.warn('[IDB] put projs:', e));
  }, [projects]);

  useEffect(() => {
    localStorage.setItem(`${LOCAL_PREFIX}subcategories`, JSON.stringify(subCategories));
    putManyToStore('sub_categories', subCategories).catch((e) => console.warn('[IDB] put subs:', e));
  }, [subCategories]);

  useEffect(() => {
    localStorage.setItem(`${LOCAL_PREFIX}depots`, JSON.stringify(depots));
    putManyToStore('depots', depots).catch((e) => console.warn('[IDB] put depots:', e));
  }, [depots]);

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem(`${LOCAL_PREFIX}current_user`, JSON.stringify(currentUser));
    } else {
      localStorage.removeItem(`${LOCAL_PREFIX}current_user`);
    }
  }, [currentUser]);

  // Supabase Client init & sync
  const [supabaseSyncStatus, setSupabaseSyncStatus] = useState<'idle' | 'syncing' | 'connected' | 'error'>('idle');
  const [supabaseSyncMessage, setSupabaseSyncMessage] = useState<string>('');
  const [appCompat, setAppCompat] = useState<AppCompatStatus>({
    checked: false,
    compatible: true,
    maintenance: false,
    appVersion: APP_VERSION,
    expectedSchemaVersion: EXPECTED_SCHEMA_VERSION,
    minSupportedSchemaVersion: MIN_SUPPORTED_SCHEMA_VERSION,
  });

  const recheckAppCompat = useCallback(async () => {
    const effectiveUrl = normalizeSupabaseUrl(supabaseUrl || localStorage.getItem('tqt_company_url') || '');
    const effectiveKey = normalizeSupabaseKey(supabaseKey || localStorage.getItem('tqt_company_key') || '');
    const client = getClientSupabase(effectiveUrl, effectiveKey);
    const res = await checkAppCompatibility(client, true);
    setAppCompat(res);
  }, [supabaseUrl, supabaseKey]);

  const syncFromSupabase = useCallback(async (overrideUrl?: string, overrideKey?: string) => {
    const effectiveUrl = normalizeSupabaseUrl(overrideUrl || supabaseUrl || localStorage.getItem('tqt_company_url') || '');
    const effectiveKey = normalizeSupabaseKey(overrideKey || supabaseKey || localStorage.getItem('tqt_company_key') || '');
    const client = getClientSupabase(effectiveUrl, effectiveKey);
    if (!client) {
      setSupabaseSyncStatus('idle');
      setSupabaseSyncMessage('Mode local hors-ligne (Supabase non configuré).');
      return false;
    }

    supabaseClientRef.current = client;

    // Vérification immédiate de la compatibilité de version (public.app_compat)
    checkAppCompatibility(client)
      .then((compatRes) => setAppCompat(compatRes))
      .catch(() => {});

    // Helper to recover & apply company license whenever DB is connected
    const recoverAndApplyCompanyLicense = async (pubSettings?: Record<string, string>) => {
      try {
        const currentSaved = getSavedLicense();
        const recovered = await recoverCompanyLicenseFromServerAndClientDb(effectiveUrl, client, currentSaved);
        if (recovered && recovered.license_key) {
          saveLicenseLocally(recovered);
          setLicense(recovered);
          syncLicenseToClientDatabase(recovered, client).catch(() => {});
          return;
        }
        if (pubSettings?.company_license_info) {
          try {
            const parsedLic = JSON.parse(pubSettings.company_license_info);
            if (parsedLic && parsedLic.license_key && !String(parsedLic.license_key).toUpperCase().startsWith('TOT-STOCK-FREE')) {
              const pType = normalizePlanType(parsedLic.plan_type || parsedLic.plan || 'free', parsedLic.license_key);
              const normalizedLic: LicenseInfo = {
                ...parsedLic,
                plan_type: pType,
                max_references: Math.max(Number(parsedLic.max_references ?? parsedLic.max_tools) || 0, getPlanMaxReferences(pType)),
                max_depots: Math.max(Number(parsedLic.max_depots) || 0, getMaxDepotsForPlan(pType)),
                status: parsedLic.status || (parsedLic.is_active === false ? 'inactive' : 'valid'),
              };
              saveLicenseLocally(normalizedLic);
              setLicense(normalizedLic);
              syncLicenseToClientDatabase(normalizedLic, client).catch(() => {});
              return;
            }
          } catch {}
        }
        if (currentSaved?.license_key && currentSaved.license_key !== 'TOT-STOCK-FREE-COMMUNITY') {
          syncLicenseToClientDatabase(currentSaved, client).catch(() => {});
        }
      } catch (e) {
        console.warn('Auto license recovery notice:', e);
      }
    };

    // When unauthenticated (on the login screen), load public settings, recover company license,
    // AND load the login directory (users, departments, roles) so the login modal shows the company's users!
    if (!currentUser) {
      try {
        const [pubSettings, loginDir] = await Promise.all([
          fetchPublicAppSettings(client),
          fetchLoginDirectory(client),
        ]);

        if (pubSettings.company_currency) {
          setActiveCurrency(pubSettings.company_currency);
          setCurrencyState(pubSettings.company_currency);
        }

        if (loginDir.users && loginDir.users.length > 0) {
          setUsers(loginDir.users);
        }
        if (loginDir.departments && loginDir.departments.length > 0) {
          setDepartments(loginDir.departments);
        }
        if (loginDir.roles && loginDir.roles.length > 0) {
          setRoles(loginDir.roles);
        }

        await recoverAndApplyCompanyLicense(pubSettings);

        setSupabaseSyncStatus('connected');
        const userCountInfo =
          loginDir.users && loginDir.users.length > 0
            ? ` (${loginDir.users.length} util.)`
            : '';
        setSupabaseSyncMessage(
          (tr(language, 'Prêt pour connexion', 'Ready for sign in')) + userCountInfo
        );
        return true;
      } catch (err: any) {
        console.warn('Erreur lecture réglages publics / annuaire connexion:', err);
        setSupabaseSyncStatus('error');
        setSupabaseSyncMessage(
          isNetworkOrFetchError(err)
            ? (tr(language, 'Serveur Supabase inaccessible ("Failed to fetch"). Projet en veille ou URL erronée.', 'Supabase server unreachable ("Failed to fetch"). Project paused or bad URL.'))
            : (tr(language, 'Erreur de communication Supabase.', 'Supabase communication error.'))
        );
        return false;
      }
    }

    setSupabaseSyncStatus('syncing');
    setSupabaseSyncMessage('Synchronisation des données Supabase...');

    try {
      // 1. Priorité N°5 & 6 : Dépilage de la file d'attente hors-ligne (sync_queue)
      const queueRes = await processSyncQueue(client);
      if (queueRes.conflicts && queueRes.conflicts.length > 0) {
        const firstConflict = queueRes.conflicts[0];
        setLicenseNotification(
          tr(language, `⚠️ Conflit de stock détecté : ${firstConflict.message}`, `⚠️ Stock conflict detected: ${firstConflict.message}`)
        );
      }

      const data = await fetchAllClientData(client);
      const details: string[] = [];

      if (data.products && data.products.length > 0) {
        setProducts(data.products);
        details.push(`${data.products.length} réf.`);
      }
      if (data.movements && data.movements.length > 0) {
        setMovements(data.movements);
        details.push(`${data.movements.length} flux`);
      }

      let deletedIds: string[] = [];
      try {
        const rawDel = localStorage.getItem('tot_deleted_user_ids');
        if (rawDel) deletedIds = JSON.parse(rawDel);
      } catch {}
      const activeInitial = INITIAL_USERS.filter((u) => !deletedIds.includes(String(u.id)));

      let finalSyncUsers: User[] = [];
      setUsers((prev) => {
        const mergedDbUsers = mergeUserLists(
          activeInitial,
          prev,
          data.users || [],
          currentUser ? [currentUser] : []
        ).filter((u) => !(u as any).is_deleted && !deletedIds.includes(String(u.id)));
        finalSyncUsers = mergedDbUsers;
        return mergedDbUsers.length > 0 ? mergedDbUsers : prev;
      });

      if (finalSyncUsers.length > 0) {
        details.push(`${finalSyncUsers.length} util.`);
      }

      if (currentUser && finalSyncUsers.length > 0) {
        syncUserProfileAndDirectoryToSupabase(client, currentUser, finalSyncUsers).catch(() => {});
      }

      if (data.roles && data.roles.length > 0) {
        setRoles(data.roles);
      }
      if (data.departments && data.departments.length > 0) {
        setDepartments(data.departments);
      }
      if (data.projects && data.projects.length > 0) {
        setProjects(data.projects);
      }
      if (data.subCategories && data.subCategories.length > 0) {
        setSubCategories(data.subCategories);
      }
      if (data.depots && data.depots.length > 0) {
        setDepots(data.depots);
        details.push(`${data.depots.length} dépôts`);
      }
      if (data.orders && data.orders.length > 0) {
        setOrders((prev) => mergeMaterialOrdersLists(prev, data.orders));
        details.push(`${data.orders.length} cmd.`);
      }

      if (currentUser) {
        const remoteUserBaskets = await fetchUserBasketsFromSupabase(client, currentUser);
        reconcileUserBasketsWithRemote(remoteUserBaskets);
      }

      // Automatically recover company license from client DB / master server
      await recoverAndApplyCompanyLicense();

      setSupabaseSyncStatus('connected');
      const detailsStr = details.length > 0 ? ` (${details.join(', ')})` : '';
      setSupabaseSyncMessage(`Connecté à Supabase${detailsStr}`);
      return true;
    } catch (err: any) {
      console.error('Erreur syncFromSupabase:', err);
      setSupabaseSyncStatus('error');
      setSupabaseSyncMessage(`Erreur de synchronisation : ${formatPostgresErrorMessage(err)}`);
      return false;
    }
  }, [supabaseUrl, supabaseKey, currentUser, language]);

  // Session persistence and real-time auth state listener
  useEffect(() => {
    const client = getClientSupabase(supabaseUrl, supabaseKey);
    if (!client) return;

    const { data: { subscription } } = client.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        setCurrentUser(null);
        localStorage.removeItem(`${LOCAL_PREFIX}current_user`);
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        if (session.user) {
          let resolvedProfile: any = null;
          try {
            const { data: rpcRes } = await client.rpc('get_or_link_my_profile');
            if (rpcRes?.user) resolvedProfile = rpcRes.user;
          } catch {}

          if (!resolvedProfile) {
            const { data: profile } = await client
              .from('users')
              .select('id, auth_user_id, name, trigram, email, department, role_id, is_blocked, must_change_pin, is_preparer, allowed_depots, created_at, updated_at')
              .eq('auth_user_id', session.user.id)
              .maybeSingle();
            resolvedProfile = profile;
          }

          if (!resolvedProfile && session.user.email) {
            const cleanMail = session.user.email.trim().toLowerCase();
            const { data: byMail } = await client
              .from('users')
              .select('id, auth_user_id, name, trigram, email, department, role_id, is_blocked, must_change_pin, is_preparer, allowed_depots, created_at, updated_at')
              .ilike('email', cleanMail)
              .maybeSingle();
            resolvedProfile = byMail;
          }

          if (!resolvedProfile && session.user.email) {
            const meta = session.user.user_metadata || {};
            resolvedProfile = await syncUserProfileAndDirectoryToSupabase(client, {
              id: session.user.id,
              auth_user_id: session.user.id,
              name: meta.name || session.user.email.split('@')[0],
              trigram: meta.trigram,
              email: session.user.email.trim().toLowerCase(),
              department: meta.department || 'Général',
              role_id: meta.role_id ?? 0,
              is_blocked: false,
              must_change_pin: false,
              allowed_depots: ['*'],
            });
          } else if (resolvedProfile) {
            syncUserProfileAndDirectoryToSupabase(client, resolvedProfile).catch(() => {});
          }

          if (resolvedProfile && !resolvedProfile.is_blocked) {
            const cleanProf = sanitizeUserForDirectory(resolvedProfile);
            setCurrentUser(cleanProf);
            localStorage.setItem(`${LOCAL_PREFIX}current_user`, JSON.stringify(cleanProf));
            let deletedIds: string[] = [];
            try {
              const rawDel = localStorage.getItem('tot_deleted_user_ids');
              if (rawDel) deletedIds = JSON.parse(rawDel);
            } catch {}
            const activeInitial = INITIAL_USERS.filter((u) => !deletedIds.includes(String(u.id)));
            setUsers((prev) =>
              mergeUserLists(activeInitial, prev, [cleanProf]).filter(
                (u) => !(u as any).is_deleted && !deletedIds.includes(String(u.id))
              )
            );
          }
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabaseUrl, supabaseKey]);

  useEffect(() => {
    if (supabaseUrl && supabaseKey) {
      syncFromSupabase();
    } else {
      setSupabaseSyncStatus('idle');
      setSupabaseSyncMessage('Stockage local');
    }
  }, [supabaseUrl, supabaseKey, currentUser, syncFromSupabase]);

  // Synchronisation temps réel multi-appareils (Mobile <-> PC) via WebSocket Realtime + Polling rapide (6s) + Focus
  useEffect(() => {
    if (!supabaseUrl || !supabaseKey) return;
    const client = getClientSupabase(supabaseUrl, supabaseKey);
    if (!client) return;

    let isMounted = true;
    let isPolling = false;

    const runSilentLiveSync = async () => {
      if (!isMounted || isPolling || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
      isPolling = true;
      try {
        const live = await fetchLiveOperationalData(client, currentUser);
        if (!isMounted) return;
        if (live.orders && live.orders.length > 0) {
          setOrders((prev) => mergeMaterialOrdersLists(prev, live.orders));
        }
        if (currentUser) {
          reconcileUserBasketsWithRemote(live.userBaskets);
        }
        if (live.products && live.products.length > 0) {
          setProducts(live.products);
        }
        if (live.movements && live.movements.length > 0) {
          setMovements(live.movements);
        }
        if (live.depots && live.depots.length > 0) {
          setDepots(live.depots);
        }
      } catch {
        // Ignorer silencieusement les erreurs réseau transitoires en arrière-plan
      } finally {
        isPolling = false;
      }
    };

    const channel = client
      .channel('tot-live-multi-device-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_orders' }, () => {
        runSilentLiveSync();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, () => {
        runSilentLiveSync();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => {
        runSilentLiveSync();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_movements' }, () => {
        runSilentLiveSync();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'depots' }, () => {
        runSilentLiveSync();
      })
      .subscribe();

    const intervalId = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        runSilentLiveSync();
      }
    }, 6000);

    // Exécuter immédiatement à la connexion ou au changement de session utilisateur
    const initialTimer = setTimeout(() => {
      runSilentLiveSync();
    }, 300);

    const handleFocusOrVisible = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        runSilentLiveSync();
      }
    };
    window.addEventListener('focus', handleFocusOrVisible);
    window.addEventListener('online', handleFocusOrVisible);
    document.addEventListener('visibilitychange', handleFocusOrVisible);

    return () => {
      isMounted = false;
      clearTimeout(initialTimer);
      clearInterval(intervalId);
      window.removeEventListener('focus', handleFocusOrVisible);
      window.removeEventListener('online', handleFocusOrVisible);
      document.removeEventListener('visibilitychange', handleFocusOrVisible);
      try {
        client.removeChannel(channel);
      } catch {}
    };
  }, [supabaseUrl, supabaseKey, currentUser, reconcileUserBasketsWithRemote]);

  const saveSupabaseConfig = useCallback((url: string, key: string) => {
    const cleanUrl = normalizeSupabaseUrl(url);
    const cleanKey = normalizeSupabaseKey(key);
    setSupabaseUrl(cleanUrl);
    setSupabaseKey(cleanKey);
    localStorage.setItem('tqt_company_url', cleanUrl);
    localStorage.setItem('tqt_company_key', cleanKey);

    // Immediately trigger license recovery & login directory fetch on the new client
    const client = getClientSupabase(cleanUrl, cleanKey);
    if (client) {
      supabaseClientRef.current = client;
      recoverCompanyLicenseFromServerAndClientDb(cleanUrl, client)
        .then((res) => {
          if (res && res.license_key) {
            setLicense(res);
          }
        })
        .catch(() => {});

      fetchLoginDirectory(client)
        .then((dir) => {
          if (dir.users && dir.users.length > 0) setUsers(dir.users);
          if (dir.departments && dir.departments.length > 0) setDepartments(dir.departments);
          if (dir.roles && dir.roles.length > 0) setRoles(dir.roles);
        })
        .catch(() => {});
    }
  }, []);

  const exportToSupabase = useCallback(async () => {
    const client = getClientSupabase(supabaseUrl, supabaseKey);
    if (!client) {
      return { success: false, message: 'Supabase n\'est pas configuré.' };
    }
    return exportAllLocalDataToSupabase(client, {
      products,
      users,
      roles,
      departments,
      projects,
      subCategories,
      depots,
      orders,
      movements,
    });
  }, [supabaseUrl, supabaseKey, products, users, roles, departments, projects, subCategories, depots, orders, movements]);

  const testConnection = useCallback(async (url: string, key: string) => {
    return testClientSupabaseConnection(url, key);
  }, []);

  // Authentication
  const logout = useCallback(async () => {
    if (currentUser) {
      logActivity({
        type: 'USER_ACTION',
        category: 'SYSTEM',
        title: tr(language, 'Déconnexion Utilisateur', 'User Sign-out'),
        description: tr(language, `L'utilisateur ${currentUser.name} (${currentUser.trigram}) s'est déconnecté.`, `User ${currentUser.name} (${currentUser.trigram}) signed out.`),
        user_name: currentUser.name,
        user_trigram: currentUser.trigram,
        badgeText: currentUser.trigram,
        meta: {
          status: 'info',
        },
      });
    }

    const client = getClientSupabase(supabaseUrl, supabaseKey);
    if (client) {
      await client.auth.signOut().catch(() => {});
    }

    localStorage.removeItem(`${LOCAL_PREFIX}current_user`);
    setCurrentUser(null);
    setLoginModalOpen(false);
    setActiveTab('home');
    // Close all open modals when logging out
    setActiveProductId(null);
    setProductFormState({ open: false, product: null });
    setScanState({ open: false, mode: 'OUT' });
    setBatchCartModalOpen(false);
    setActionSheetOpen(false);
    setDepartmentsProjectsModal({ open: false, tab: 'deps' });
    setUsersRolesModal({ open: false, tab: 'users' });
    setCategoriesModalOpen(false);
    setDepotsModalOpen(false);
    setEmailReportsModalOpen(false);
    setSmtpSettingsModalOpen(false);
    setCompanySetupModalOpen(false);
    setQrConfigGenModalOpen(false);
    setProfileModalOpen(false);
    setNotificationsModalOpen(false);
    setAppInfoModalOpen(false);
    setReleaseNotesModalOpen(false);
    setPrintLabelsModal({ open: false });
    setInventoryAuditModalOpen(false);
    setDocumentationModalOpen({ open: false, tab: 'manual' });
  }, [currentUser, logActivity, language, supabaseUrl, supabaseKey]);

  const wipeDeviceAndSignOut = useCallback(async () => {
    const client = getClientSupabase(supabaseUrl, supabaseKey);
    await wipeDeviceLocalData({
      signOutFn: async () => {
        if (client) {
          await client.auth.signOut().catch(() => {});
        }
      },
      shouldReload: true,
    });
    setCurrentUser(null);
    setLoginModalOpen(false);
    setProfileModalOpen(false);
  }, [supabaseUrl, supabaseKey]);

  // Inactivity auto-logout
  const [autoLogoutMinutes, setAutoLogoutMinutesState] = useState<number>(() => {
    const saved = localStorage.getItem(`${LOCAL_PREFIX}auto_logout_minutes`);
    return saved !== null ? Number(saved) : 5; // 5 min default
  });

  const setAutoLogoutMinutes = useCallback((minutes: number) => {
    setAutoLogoutMinutesState(minutes);
    localStorage.setItem(`${LOCAL_PREFIX}auto_logout_minutes`, String(minutes));
  }, []);

  const logoutTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  const resetInactivityTimer = useCallback(() => {
    const now = Date.now();
    lastActivityRef.current = now;
    try {
      localStorage.setItem(LAST_ACTIVITY_TS_KEY, String(now));
    } catch {}
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    if (!currentUser || autoLogoutMinutes <= 0) return;

    logoutTimerRef.current = setTimeout(() => {
      logout();
    }, autoLogoutMinutes * 60 * 1000);
  }, [currentUser, autoLogoutMinutes, logout]);

  useEffect(() => {
    const handleActivity = () => resetInactivityTimer();
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, handleActivity, { passive: true }));
    resetInactivityTimer();

    return () => {
      events.forEach((e) => window.removeEventListener(e, handleActivity));
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    };
  }, [resetInactivityTimer]);

  // Tâche 2.2 : Reprise de l'application au premier plan (visibilitychange / événement resume de Capacitor)
  useEffect(() => {
    if (!currentUser) return;

    let isCheckingResume = false;

    const handleAppResume = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      if (isCheckingResume) return;
      isCheckingResume = true;

      try {
        let storedLastTs = lastActivityRef.current;
        try {
          const rawTs = localStorage.getItem(LAST_ACTIVITY_TS_KEY);
          if (rawTs && Number.isFinite(Number(rawTs))) {
            storedLastTs = Number(rawTs);
          }
        } catch {}

        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
        const client = getClientSupabase(supabaseUrl, supabaseKey);

        await verifyUserStatusOnResume({
          currentUser,
          isOnline,
          isSupabaseConfigured: Boolean(client && supabaseUrl && supabaseKey),
          autoLogoutMinutes,
          lastActivityTimestamp: storedLastTs,
          fetchRemoteProfile: async (user) => {
            if (!client) return { found: true, networkError: true };
            if (Number(user.id) === 0 || user.email === 'admin@tot-stock.app') {
              return { found: true, user };
            }
            try {
              const fullCols =
                'id, auth_user_id, name, trigram, email, department, role_id, is_blocked, must_change_pin, is_preparer, allowed_depots, created_at, updated_at';
              const minCols = 'id, name, trigram, email, department, role_id, is_blocked';

              let row: any = null;
              let hadQueryError = false;

              if (user.auth_user_id) {
                const { data, error } = await client
                  .from('users')
                  .select(fullCols)
                  .eq('auth_user_id', user.auth_user_id)
                  .maybeSingle();
                if (error) {
                  if (isNetworkOrFetchError(error)) return { found: true, networkError: true };
                  const fb = await client
                    .from('users')
                    .select(minCols)
                    .eq('id', user.id)
                    .maybeSingle();
                  if (fb.error) hadQueryError = true;
                  else row = fb.data;
                } else {
                  row = data;
                }
              }

              if (!row && user.email) {
                const cleanEmail = user.email.trim().toLowerCase();
                const { data, error } = await client
                  .from('users')
                  .select(fullCols)
                  .ilike('email', cleanEmail)
                  .maybeSingle();
                if (error) {
                  if (isNetworkOrFetchError(error)) return { found: true, networkError: true };
                  const fb = await client
                    .from('users')
                    .select(minCols)
                    .ilike('email', cleanEmail)
                    .maybeSingle();
                  if (fb.error) hadQueryError = true;
                  else row = fb.data;
                } else {
                  row = data;
                }
              }

              if (!row && user.id !== undefined && user.id !== null) {
                const { data, error } = await client
                  .from('users')
                  .select(fullCols)
                  .eq('id', user.id)
                  .maybeSingle();
                if (error) {
                  if (isNetworkOrFetchError(error)) return { found: true, networkError: true };
                  const fb = await client
                    .from('users')
                    .select(minCols)
                    .eq('id', user.id)
                    .maybeSingle();
                  if (fb.error) hadQueryError = true;
                  else row = fb.data;
                } else {
                  row = data;
                }
              }

              if (row) {
                return { found: true, user: row as User };
              }

              if (hadQueryError) {
                return { found: true, networkError: true };
              }

              // Si l'utilisateur possède une session Supabase Auth active (ex: compte créé dans auth.users), ne pas l'effacer
              const { data: sessionData } = await client.auth.getSession();
              if (sessionData?.session?.user) {
                return { found: true, user };
              }

              return { found: false };
            } catch (err) {
              if (isNetworkOrFetchError(err)) {
                return { found: true, networkError: true };
              }
              return { found: true, networkError: true };
            }
          },
          signOutAndWipe: async () => {
            await wipeDeviceLocalData({
              signOutFn: async () => {
                if (client) await client.auth.signOut().catch(() => {});
              },
              shouldReload: false,
            });
            setCurrentUser(null);
            setLoginModalOpen(false);
            setProfileModalOpen(false);
          },
          lockSession: () => {
            logout();
          },
        });
      } finally {
        isCheckingResume = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleAppResume();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('resume', handleAppResume);
    window.addEventListener('resume', handleAppResume);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('resume', handleAppResume);
      window.removeEventListener('resume', handleAppResume);
    };
  }, [currentUser, supabaseUrl, supabaseKey, autoLogoutMinutes, logout]);

  // Permissions Check
  const userHasPermission = useCallback(
    (permissionKey: string): boolean => {
      if (!currentUser) return false;
      if (
        Number(currentUser.id) === 0 ||
        Number(currentUser.role_id) === 0 ||
        Number(currentUser.role_id) === 1
      ) {
        return true;
      }
      const role = roles.find((r) => Number(r.id) === Number(currentUser.role_id));
      return Boolean(role?.permissions?.includes(permissionKey));
    },
    [currentUser, roles]
  );

  const canViewPrices = useMemo(() => {
    return userHasPermission('perm_prod_view_price');
  }, [userHasPermission]);

  // Preparer eligibility:
  // Everyone is demandeur by default!
  // To be a preparer: Department has is_preparer_dept === true, AND user has is_preparer === true (or SuperAdmin/Admin role 0/1)
  const isPreparer = useMemo(() => {
    if (!currentUser) return false;
    if (
      Number(currentUser.id) === 0 ||
      Number(currentUser.role_id) === 0 ||
      Number(currentUser.role_id) === 1
    ) {
      return true;
    }
    const userDept = departments.find(
      (d) => d.name.toLowerCase().trim() === (currentUser.department || '').toLowerCase().trim()
    );
    const deptAllowsPreparers = Boolean(userDept?.is_preparer_dept);
    if (!deptAllowsPreparers) {
      return false;
    }
    return Boolean(currentUser.is_preparer);
  }, [currentUser, departments]);

  const isAdmin = useMemo(() => {
    if (!currentUser) return false;
    return (
      Number(currentUser.id) === 0 ||
      Number(currentUser.role_id) === 0 ||
      Number(currentUser.role_id) === 1
    );
  }, [currentUser]);

  // Responsables de département et leurs suppléants (accès inter-départements)
  // "seuls les responsables de departement et leurs supleants peuvent voir les chantiers et les utilisateur d'autres départements"
  const isDepartmentManagerOrDeputy = useMemo(() => {
    if (!currentUser) return false;
    // Super Administrateur universel (rôle 0 ou permission '*')
    if (
      Number(currentUser.id) === 0 ||
      Number(currentUser.role_id) === 0 ||
      Number(currentUser.role_id) === 1 ||
      userHasPermission('*')
    ) {
      return true;
    }
    const userIdStr = String(currentUser.id);
    return departments.some((d) => {
      const isMgr = d.manager_id !== null && d.manager_id !== undefined && String(d.manager_id) === userIdStr;
      const isDeputy = Array.isArray(d.deputy_manager_ids) && d.deputy_manager_ids.some((depId) => String(depId) === userIdStr);
      return isMgr || isDeputy;
    });
  }, [currentUser, userHasPermission, departments]);

  const canViewCrossDepartment = useMemo(() => {
    if (!currentUser) return true;
    if (isAdmin || isDepartmentManagerOrDeputy) return true;
    if (
      userHasPermission('perm_users_view') ||
      userHasPermission('perm_users_manage') ||
      userHasPermission('perm_user_add') ||
      userHasPermission('perm_roles_manage') ||
      userHasPermission('perm_dep_edit') ||
      userHasPermission('perm_proj_edit') ||
      userHasPermission('perm_mov_view_all')
    ) {
      return true;
    }
    return true;
  }, [currentUser, isAdmin, isDepartmentManagerOrDeputy, userHasPermission]);

  const isDepartmentManager = useMemo(() => {
    if (!currentUser) return false;
    if (isAdmin || isDepartmentManagerOrDeputy) return true;
    const userDept = (currentUser.department || '').toLowerCase().trim();
    return departments.some((d) => {
      const matchDept = d.name.toLowerCase().trim() === userDept;
      const isMgr = String(d.manager_id) === String(currentUser.id);
      const isDeputy = d.deputy_manager_ids?.some((depId) => String(depId) === String(currentUser.id));
      return matchDept && (isMgr || Boolean(isDeputy));
    });
  }, [currentUser, isAdmin, isDepartmentManagerOrDeputy, departments]);

  const canUserViewProject = useCallback(
    (p: Project): boolean => {
      if (!currentUser) return true;
      if (canViewCrossDepartment) return true;
      const userIdStr = String(currentUser.id);
      // Conducteur de travaux ou suppléant pour ce chantier spécifique
      if (p.manager_id && String(p.manager_id) === userIdStr) return true;
      if (Array.isArray(p.deputy_manager_ids) && p.deputy_manager_ids.some((id) => String(id) === userIdStr)) return true;
      // Appartient au département de l'utilisateur
      const userDeptStr = (currentUser.department || '').toLowerCase().trim();
      if (!userDeptStr) return true;
      const userDeptObj = departments.find(
        (d) => d.name.toLowerCase().trim() === userDeptStr || String(d.id) === userDeptStr
      );
      if (userDeptObj && Number(p.department_id) === Number(userDeptObj.id)) return true;
      return false;
    },
    [currentUser, canViewCrossDepartment, departments]
  );

  const canUserViewUser = useCallback(
    (_targetUser: User): boolean => {
      return true;
    },
    []
  );

  const visibleProjects = useMemo(() => {
    return projects.filter(canUserViewProject);
  }, [projects, canUserViewProject]);

  const visibleUsers = useMemo(() => {
    return users;
  }, [users]);

  const canViewArticleHistory = useMemo(() => {
    if (!currentUser) return false;
    if (isAdmin || isDepartmentManager) return true;
    return userHasPermission('perm_history_view') || userHasPermission('perm_reports_audit');
  }, [currentUser, isAdmin, isDepartmentManager, userHasPermission]);

  // Audio beep for preparers on incoming new orders
  const prevPendingIdsRef = useRef<Set<string>>(new Set());
  const isFirstPendingCheckRef = useRef<boolean>(true);

  useEffect(() => {
    const currentPendingIds = new Set(orders.filter((o) => o.status === 'PENDING').map((o) => o.id));
    if (isFirstPendingCheckRef.current) {
      isFirstPendingCheckRef.current = false;
      prevPendingIdsRef.current = currentPendingIds;
      return;
    }
    let hasNewPending = false;
    for (const id of currentPendingIds) {
      if (!prevPendingIdsRef.current.has(id)) {
        hasNewPending = true;
        break;
      }
    }
    prevPendingIdsRef.current = currentPendingIds;
    if (hasNewPending && isPreparer) {
      playNewOrderBeep();
    }
  }, [orders, isPreparer]);

  // Authentication with Supabase Auth (signInWithPassword) + local PBKDF2 quick unlock
  const [passwordRecoveryMode, setPasswordRecoveryMode] = useState<boolean>(false);

  // Listen for Supabase PASSWORD_RECOVERY events or recovery URL hashes
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash && window.location.hash.includes('type=recovery')) {
      setPasswordRecoveryMode(true);
      setLoginModalOpen(true);
    }
    const client = getClientSupabase(supabaseUrl, supabaseKey);
    if (!client) return;
    const { data: authListener } = client.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecoveryMode(true);
        setLoginModalOpen(true);
      }
    });
    return () => {
      try {
        authListener?.subscription?.unsubscribe();
      } catch {}
    };
  }, [supabaseUrl, supabaseKey]);

  const login = useCallback(
    async (emailOrUserId: string | number, passwordOrPin: string, isLocalUnlock = false) => {
      const cleanInput = String(emailOrUserId).trim().toLowerCase();

      // 1. Quick local unlock (PBKDF2 in browser localStorage, only valid after an active Supabase session)
      if (isLocalUnlock) {
        const u = users.find(
          (x) =>
            String(x.id) === String(emailOrUserId) ||
            (x.email && x.email.trim().toLowerCase() === cleanInput)
        );
        if (!u) return { success: false, message: 'Utilisateur introuvable.' };
        if (u.is_blocked) return { success: false, message: 'Ce compte utilisateur est verrouillé.' };

        // Exige une session Supabase active (auth.getSession) avant setCurrentUser
        const client = getClientSupabase(supabaseUrl, supabaseKey);
        if (client) {
          const { data: sessionData, error: sessionErr } = await client.auth.getSession();
          if (sessionErr || !sessionData?.session?.user) {
            return {
              success: false,
              message: 'Aucune session Supabase active trouvée. Veuillez vous reconnecter avec votre mot de passe pour réactiver le déverrouillage rapide.',
            };
          }
          if (u.auth_user_id && sessionData.session.user.id !== u.auth_user_id) {
            return {
              success: false,
              message: 'La session active correspond à un autre utilisateur. Veuillez vous reconnecter avec vos identifiants.',
            };
          }
        }

        const pinRes = await verifyDevicePinWithLockout({
          userId: u.id,
          pin: passwordOrPin,
          signOutFn: async () => {
            if (client) await client.auth.signOut().catch(() => {});
          },
          wipeFn: async () => {
            await wipeDeviceLocalData({
              signOutFn: async () => {
                if (client) await client.auth.signOut().catch(() => {});
              },
              shouldReload: false,
            });
            setCurrentUser(null);
          },
        });
        if (pinRes.wiped) {
          return {
            success: false,
            message: translations[language].pin_lockout_wiped_error,
          };
        }
        if (pinRes.success) {
          if (u.email) {
            localStorage.setItem('tot_last_login_email', u.email.trim().toLowerCase());
          }
          try {
            localStorage.setItem(LAST_ACTIVITY_TS_KEY, String(Date.now()));
          } catch {}
          setCurrentUser(u);
          setLoginModalOpen(false);
          setActiveTab('home');
          return { success: true };
        }
        return {
          success: false,
          message: translations[language].pin_attempts_remaining_error.replace(
            '{remaining}',
            String(pinRes.remainingAttempts)
          ),
        };
      }

      // 2. Supabase Auth connection
      const client = getClientSupabase(supabaseUrl, supabaseKey);
      if (client) {
        // Resolve email
        let email = String(emailOrUserId).trim().toLowerCase();
        if (!email.includes('@')) {
          const matched = users.find((x) => String(x.id) === String(emailOrUserId));
          if (matched?.email) {
            email = matched.email.trim().toLowerCase();
          } else {
            return {
              success: false,
              message: 'Une adresse e-mail valide est requise pour vous connecter avec Supabase Auth.',
            };
          }
        }

        const cleanEmail = email.trim().toLowerCase();
        const fullUserCols =
          'id, auth_user_id, name, trigram, email, department, role_id, is_blocked, must_change_pin, is_preparer, allowed_depots, created_at, updated_at';
        const minUserCols = 'id, name, trigram, email, department, role_id, is_blocked';

        const fetchProfileByEmail = async (targetEmail: string): Promise<any> => {
          const { data, error } = await client
            .from('users')
            .select(fullUserCols)
            .or(`email.ilike.${targetEmail},email.eq.${targetEmail}`)
            .maybeSingle();
          if (!error && data) return data;
          const fb = await client
            .from('users')
            .select(minUserCols)
            .ilike('email', targetEmail)
            .maybeSingle();
          return fb.data || null;
        };

        const { data: authData, error: authErr } = await client.auth.signInWithPassword({
          email,
          password: passwordOrPin,
        });

        let resolvedAuthUser = authData?.user || null;
        let activeProfile: any = null;

        if (authErr || !resolvedAuthUser) {
          // Allow built-in Demo Super Admin (admin@tot-stock.app / admin1234) fallback if not registered in Supabase Auth
          const isDemoSuperAdmin =
            (String(emailOrUserId) === '0' || email === 'admin@tot-stock.app') &&
            passwordOrPin === 'admin1234';
          if (isDemoSuperAdmin) {
            const defaultAdmin = users.find((u) => Number(u.id) === 0) || {
              id: 0,
              name: 'Super Administrateur',
              trigram: 'ADM',
              role_id: 0,
              email: 'admin@tot-stock.app',
              department: 'Direction',
              allowed_depots: ['ALL'],
              is_blocked: false,
              must_change_pin: false,
            };
            localStorage.setItem('tot_last_login_email', 'admin@tot-stock.app');
            setCurrentUser(defaultAdmin);
            localStorage.setItem(`${LOCAL_PREFIX}current_user`, JSON.stringify(defaultAdmin));
            setLoginModalOpen(false);
            setActiveTab('home');
            return { success: true, user: defaultAdmin };
          }

          const errCode = authErr?.message?.toLowerCase() || '';

          // Vérifier si le compte existe et est actif dans public.users ou dans l'annuaire local
          // (cas où l'utilisateur a été créé sans l'Edge Function admin-users, ou bien si "Confirm email" est actif sur Supabase)
          const existingDbProfile =
            (await fetchProfileByEmail(cleanEmail)) ||
            users.find((u) => u.email && u.email.trim().toLowerCase() === cleanEmail) ||
            null;

          if (existingDbProfile && !existingDbProfile.is_blocked && passwordOrPin.trim().length >= 4) {
            // Tenter d'enregistrer automatiquement le compte dans Supabase Auth s'il n'y figurait pas encore
            if (errCode.includes('invalid login credentials') && passwordOrPin.trim().length >= 6) {
              try {
                const { data: signUpData, error: signUpErr } = await client.auth.signUp({
                  email: cleanEmail,
                  password: passwordOrPin,
                  options: {
                    data: {
                      name: existingDbProfile.name,
                      trigram: existingDbProfile.trigram,
                      department: existingDbProfile.department || 'Général',
                      role_id: existingDbProfile.role_id ?? 4,
                    },
                  },
                });
                if (!signUpErr && signUpData?.user) {
                  resolvedAuthUser = signUpData.user;
                  activeProfile = {
                    ...existingDbProfile,
                    auth_user_id: signUpData.user.id,
                  };
                }
              } catch {}
            }

            // Si l'adresse e-mail est en attente de confirmation sur Supabase Auth ("Email not confirmed")
            // ou si le profil dans public.users n'avait pas encore de auth_user_id lié (créé hors Edge Function)
            if (
              !activeProfile &&
              (errCode.includes('email not confirmed') || !existingDbProfile.auth_user_id)
            ) {
              activeProfile = existingDbProfile;
            }
          }

          if (!activeProfile && !resolvedAuthUser) {
            const isNetErr = isNetworkOrFetchError(authErr);
            let friendlyMsg = tr(
              language,
              'Identifiants de connexion incorrects (e-mail ou mot de passe invalide).',
              'Invalid login credentials (email or password incorrect).'
            );

            if (isNetErr || errCode.includes('failed to fetch') || errCode.includes('fetch failed')) {
              friendlyMsg = tr(
                language,
                'Échec de connexion réseau ("Failed to fetch") : Impossible de joindre votre projet Supabase. Vérifiez si votre projet gratuit est en veille (Paused sur supabase.com), si votre connexion internet fonctionne ou si l\'URL configurée est exacte.',
                'Network error ("Failed to fetch"): Unable to reach your Supabase project. Check if your project is paused on supabase.com or if the URL is correct.'
              );
            } else if (errCode.includes('email not confirmed')) {
              friendlyMsg = tr(
                language,
                'Votre adresse e-mail n\'est pas encore confirmée sur Supabase (désactivez "Confirm email" dans Supabase Authentication > Providers > Email ou confirmez le lien reçu).',
                'Email address not yet confirmed on Supabase.'
              );
            } else if (errCode.includes('invalid login credentials')) {
              friendlyMsg = tr(
                language,
                'Email ou mot de passe incorrect.',
                'Invalid email or password.'
              );
            } else if (authErr?.message) {
              friendlyMsg = authErr.message;
            }
            return { success: false, message: friendlyMsg };
          }
        }

        // Load profile with EXPLICIT column list (never '*', never pin or pin_hash)
        if (!activeProfile && resolvedAuthUser) {
          // 1. Query by auth_user_id
          const { data: profile, error: profErr } = await client
            .from('users')
            .select(fullUserCols)
            .eq('auth_user_id', resolvedAuthUser.id)
            .maybeSingle();
          if (!profErr && profile) {
            activeProfile = profile;
          }
        }

        // 3. Fallback: Query by email (with clean trimmed lowercase)
        if (!activeProfile) {
          const profByEmail = await fetchProfileByEmail(cleanEmail);
          if (profByEmail) {
            activeProfile = profByEmail;
            if (resolvedAuthUser?.id) {
              try {
                await client
                  .from('users')
                  .update({ auth_user_id: resolvedAuthUser.id, updated_at: new Date().toISOString() })
                  .eq('id', profByEmail.id);
              } catch {}
            }
          }
        }

        // 4. Fallback: Check local cached/imported users in state
        if (!activeProfile) {
          const localMatch = users.find(
            (u) =>
              (u.email && u.email.trim().toLowerCase() === cleanEmail) ||
              (resolvedAuthUser?.id && u.auth_user_id && u.auth_user_id === resolvedAuthUser.id)
          );
          if (localMatch) {
            activeProfile = {
              ...localMatch,
              ...(resolvedAuthUser?.id ? { auth_user_id: resolvedAuthUser.id } : {}),
            };
          }
        }

        // 5. Fallback: If STILL not found in DB, auto-provision user profile for this authenticated account!
        if (!activeProfile && resolvedAuthUser) {
          const meta = resolvedAuthUser.user_metadata || {};
          const fallbackName = meta.name || cleanEmail.split('@')[0];
          const fallbackTrigram = meta.trigram || fallbackName.substring(0, 3).toUpperCase();
          activeProfile = {
            id: resolvedAuthUser.id,
            auth_user_id: resolvedAuthUser.id,
            name: fallbackName,
            trigram: fallbackTrigram,
            email: cleanEmail,
            department: meta.department || 'Général',
            role_id: meta.role_id ?? 0, // Super admin by default for primary account
            is_blocked: false,
            must_change_pin: false,
            is_preparer: false,
            allowed_depots: ['*'],
          };
        }

        if (!activeProfile) {
          await client.auth.signOut().catch(() => {});
          return {
            success: false,
            message: 'Profil utilisateur introuvable dans la base TOT Stock pour ce compte.',
          };
        }

        // Persist & mirror profile into public.users + app_settings so mobile and other terminals see this user
        try {
          const persistedProf = await syncUserProfileAndDirectoryToSupabase(
            client,
            {
              ...activeProfile,
              ...(resolvedAuthUser?.id ? { auth_user_id: resolvedAuthUser.id } : {}),
              email: cleanEmail,
            },
            users
          );
          if (persistedProf) {
            activeProfile = persistedProf;
          }
        } catch {}

        if (activeProfile.is_blocked) {
          await client.auth.signOut().catch(() => {});
          return { success: false, message: 'Ce compte utilisateur est verrouillé.' };
        }

        setUsers((prev) => {
          let deletedIds: string[] = [];
          try {
            const rawDel = localStorage.getItem('tot_deleted_user_ids');
            if (rawDel) deletedIds = JSON.parse(rawDel);
          } catch {}
          const activeInitial = INITIAL_USERS.filter((u) => !deletedIds.includes(String(u.id)));
          return mergeUserLists(activeInitial, prev, [activeProfile]).filter(
            (u) => !(u as any).is_deleted && !deletedIds.includes(String(u.id))
          );
        });

        if (activeProfile.must_change_pin) {
          return { success: true, requirePinReset: true, user: activeProfile };
        }

        resetPinFailedAttempts();
        localStorage.setItem('tot_last_login_email', cleanEmail);
        try {
          localStorage.setItem(LAST_ACTIVITY_TS_KEY, String(Date.now()));
        } catch {}
        setCurrentUser(activeProfile);
        localStorage.setItem(`${LOCAL_PREFIX}current_user`, JSON.stringify(activeProfile));
        setLoginModalOpen(false);
        setActiveTab('home');

        // Audit log connection
        logActivity({
          type: 'USER_ACTION',
          category: 'SYSTEM',
          title: tr(language, 'Connexion Utilisateur', 'User Sign-in'),
          description: tr(
            language,
            `L'utilisateur ${activeProfile.name} (${activeProfile.trigram}) s'est connecté via Supabase Auth.`,
            `User ${activeProfile.name} (${activeProfile.trigram}) signed in via Supabase Auth.`
          ),
          user_name: activeProfile.name,
          user_trigram: activeProfile.trigram,
          badgeText: activeProfile.trigram,
          meta: {
            status: 'success',
            details: `Rôle ID: ${activeProfile.role_id} - Auth UID: ${resolvedAuthUser?.id || activeProfile.id}`,
            deviceInfo: 'Terminal Mobile TOT',
          },
        });

        return { success: true, user: activeProfile };
      }

      // Offline demo fallback if no Supabase configured
      const u = users.find(
        (x) =>
          String(x.id) === String(emailOrUserId) ||
          (x.email && x.email.trim().toLowerCase() === cleanInput)
      );
      if (!u) {
        return {
          success: false,
          message:
            tr(language, 'Aucun compte trouvé pour cette adresse e-mail.', 'No account found for this email address.'),
        };
      }
      if (u.email) {
        localStorage.setItem('tot_last_login_email', u.email.trim().toLowerCase());
      }
      setCurrentUser(u);
      setLoginModalOpen(false);
      setActiveTab('home');
      return { success: true, user: u };
    },
    [users, supabaseUrl, supabaseKey, logActivity, language]
  );

  const requestPasswordReset = useCallback(
    async (emailInput: string): Promise<{ success: boolean; message: string }> => {
      const cleanEmail = String(emailInput || '').trim().toLowerCase();
      if (!cleanEmail || !cleanEmail.includes('@')) {
        return {
          success: false,
          message:
            tr(language, 'Veuillez saisir une adresse e-mail valide.', 'Please enter a valid email address.'),
        };
      }

      const client = getClientSupabase(supabaseUrl, supabaseKey);
      if (client) {
        const redirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
        const { error } = await client.auth.resetPasswordForEmail(cleanEmail, {
          ...(redirectTo ? { redirectTo } : {}),
        });

        if (error) {
          const isNetErr = isNetworkOrFetchError(error);
          if (isNetErr) {
            return {
              success: false,
              message:
                tr(language, 'Impossible de joindre le serveur Supabase pour envoyer l\'e-mail de réinitialisation.', 'Unable to reach Supabase server to send reset email.'),
            };
          }
          return {
            success: false,
            message: error.message || (tr(language, 'Erreur lors de la demande de réinitialisation.', 'Error requesting password reset.')),
          };
        }

        logActivity({
          type: 'USER_ACTION',
          category: 'SYSTEM',
          title: tr(language, 'Demande Mot de Passe Oublié', 'Password Reset Requested'),
          description:
            tr(language, `Un lien/code de réinitialisation de mot de passe a été envoyé à ${cleanEmail}.`, `A password reset link/code was sent to ${cleanEmail}.`),
          user_name: cleanEmail,
          user_trigram: 'PWD',
          badgeText: 'PWD',
        });

        return {
          success: true,
          message:
            tr(language, `Un e-mail de réinitialisation a été envoyé à ${cleanEmail}. Cliquez sur le lien reçu par e-mail ou saisissez ci-dessous le code de récupération reçu.`, `A password reset email has been sent to ${cleanEmail}. Click the link in the email or enter the recovery code below.`),
        };
      }

      // Offline / local demo mode
      const matchedUser = users.find((u) => u.email && u.email.trim().toLowerCase() === cleanEmail);
      if (!matchedUser) {
        return {
          success: false,
          message:
            tr(language, 'Aucun compte associé à cette adresse e-mail.', 'No account found with this email address.'),
        };
      }

      return {
        success: true,
        message:
          tr(language, `Mode hors-ligne : Pour le compte ${cleanEmail}, utilisez le code ci-dessous ou contactez votre administrateur pour définir un nouveau mot de passe.`, `Offline mode: For ${cleanEmail}, use the form below or contact your administrator to set a new password.`),
      };
    },
    [supabaseUrl, supabaseKey, users, language, logActivity]
  );

  const verifyPasswordResetOtp = useCallback(
    async (emailInput: string, token: string, newPassword: string): Promise<{ success: boolean; message: string }> => {
      const cleanEmail = String(emailInput || '').trim().toLowerCase();
      const cleanToken = String(token || '').trim();
      if (!cleanEmail || !cleanEmail.includes('@')) {
        return {
          success: false,
          message: tr(language, 'Adresse e-mail invalide.', 'Invalid email address.'),
        };
      }
      if (!newPassword || newPassword.length < 6) {
        return {
          success: false,
          message:
            tr(language, 'Le nouveau mot de passe doit comporter au moins 6 caractères.', 'New password must be at least 6 characters.'),
        };
      }

      const client = getClientSupabase(supabaseUrl, supabaseKey);
      if (client) {
        if (!cleanToken) {
          return {
            success: false,
            message:
              tr(language, 'Veuillez saisir le code de récupération reçu par e-mail (ou cliquez directement sur le lien dans l\'e-mail).', 'Please enter the recovery code from your email (or click the link in the email).'),
          };
        }

        const { data: otpData, error: otpErr } = await client.auth.verifyOtp({
          email: cleanEmail,
          token: cleanToken,
          type: 'recovery',
        });

        if (otpErr) {
          return {
            success: false,
            message:
              tr(language, `Code de récupération invalide ou expiré : ${otpErr.message}`, `Invalid or expired recovery code: ${otpErr.message}`),
          };
        }

        const { error: updateErr } = await client.auth.updateUser({ password: newPassword });
        if (updateErr) {
          return {
            success: false,
            message: updateErr.message,
          };
        }

        const matched = users.find((u) => u.email && u.email.trim().toLowerCase() === cleanEmail);
        if (matched) {
          await adminClearMustChangePin(client, matched.id).catch(() => {});
          const updatedProfile = { ...matched, must_change_pin: false };
          setCurrentUser(updatedProfile);
          localStorage.setItem(`${LOCAL_PREFIX}current_user`, JSON.stringify(updatedProfile));
        } else if (otpData?.user) {
          const fallbackProfile: User = {
            id: otpData.user.id,
            auth_user_id: otpData.user.id,
            name: cleanEmail.split('@')[0],
            trigram: cleanEmail.substring(0, 3).toUpperCase(),
            email: cleanEmail,
            department: 'Général',
            role_id: 4,
            allowed_depots: ['*'],
            is_blocked: false,
            must_change_pin: false,
          };
          setCurrentUser(fallbackProfile);
          localStorage.setItem(`${LOCAL_PREFIX}current_user`, JSON.stringify(fallbackProfile));
        }

        localStorage.setItem('tot_last_login_email', cleanEmail);
        setPasswordRecoveryMode(false);
        setLoginModalOpen(false);
        setActiveTab('home');

        return {
          success: true,
          message:
            tr(language, 'Votre mot de passe a été réinitialisé avec succès.', 'Your password has been reset successfully.'),
        };
      }

      // Offline demo fallback
      const matched = users.find((u) => u.email && u.email.trim().toLowerCase() === cleanEmail);
      if (!matched) {
        return {
          success: false,
          message: tr(language, 'Utilisateur introuvable.', 'User not found.'),
        };
      }
      setCurrentUser(matched);
      setPasswordRecoveryMode(false);
      setLoginModalOpen(false);
      setActiveTab('home');
      return {
        success: true,
        message: tr(language, 'Mot de passe mis à jour.', 'Password updated.'),
      };
    },
    [supabaseUrl, supabaseKey, users, language]
  );

  const resetUserPinOnLogin = useCallback(
    async (userId: string | number, newPassword: string) => {
      const client = getClientSupabase(supabaseUrl, supabaseKey);
      if (client) {
        if (!newPassword || newPassword.length < 6) {
          return {
            success: false,
            message: tr(language, 'Le mot de passe doit comporter au moins 6 caractères.', 'Password must be at least 6 characters.'),
          };
        }

        const { data: updateData, error: updateErr } = await client.auth.updateUser({ password: newPassword });
        if (updateErr) {
          const errMsg = (updateErr.message || '').toLowerCase();
          const isIgnorableAuthErr =
            errMsg.includes('different from the old password') ||
            errMsg.includes('same_password') ||
            errMsg.includes('auth session missing');
          if (!isIgnorableAuthErr) {
            return { success: false, message: updateErr.message };
          }
        }

        // Clear must_change_pin flag via Edge Function admin-users + direct DB update if a specific user ID was passed
        if (userId && userId !== 'RECOVERY') {
          const clearRes = await adminClearMustChangePin(client, userId);
          if (!clearRes.success) {
            console.warn('Erreur effacement drapeau must_change_pin via admin-users:', clearRes.error);
          }

          setUsers((prev) =>
            prev.map((x) => (String(x.id) === String(userId) ? { ...x, must_change_pin: false } : x))
          );
        }

        let resolvedProfile: User | null = null;
        if (currentUser) {
          resolvedProfile = { ...currentUser, must_change_pin: false };
        } else {
          const byId =
            userId && userId !== 'RECOVERY'
              ? users.find((x) => String(x.id) === String(userId))
              : undefined;
          const cleanEmail = updateData?.user?.email?.trim().toLowerCase() || '';
          const byEmail = cleanEmail
            ? users.find((x) => x.email && x.email.trim().toLowerCase() === cleanEmail)
            : undefined;
          const matched = byId || byEmail;
          if (matched) {
            resolvedProfile = { ...matched, must_change_pin: false };
          } else if (userId && userId !== 'RECOVERY') {
            try {
              const { data: dbRow } = await client
                .from('users')
                .select('id, auth_user_id, name, trigram, email, department, role_id, is_blocked, is_preparer, allowed_depots')
                .eq('id', userId)
                .maybeSingle();
              if (dbRow) {
                resolvedProfile = { ...(dbRow as User), must_change_pin: false };
              }
            } catch {}
          }
        }

        if (resolvedProfile) {
          setCurrentUser(resolvedProfile);
          localStorage.setItem(`${LOCAL_PREFIX}current_user`, JSON.stringify(resolvedProfile));
          if (resolvedProfile.email) {
            localStorage.setItem('tot_last_login_email', resolvedProfile.email.trim().toLowerCase());
          }
        }

        if (typeof window !== 'undefined' && window.location.hash && window.location.hash.includes('type=recovery')) {
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }

        setPasswordRecoveryMode(false);
        setLoginModalOpen(false);
        setActiveTab('home');

        return { success: true, message: 'Mot de passe mis à jour avec succès.' };
      }

      setPasswordRecoveryMode(false);
      return { success: true };
    },
    [supabaseUrl, supabaseKey, currentUser, users, language]
  );

  const updateUserPIN = useCallback(
    async (oldPin: string, newPin: string, confirmPin: string) => {
      if (!currentUser) return { success: false, message: 'Non connecté.' };

      if (hasLocalDevicePin(currentUser.id)) {
        const client = getClientSupabase(supabaseUrl, supabaseKey);
        const pinRes = await verifyDevicePinWithLockout({
          userId: currentUser.id,
          pin: oldPin,
          signOutFn: async () => {
            if (client) await client.auth.signOut().catch(() => {});
          },
          wipeFn: async () => {
            await wipeDeviceLocalData({
              signOutFn: async () => {
                if (client) await client.auth.signOut().catch(() => {});
              },
              shouldReload: false,
            });
            setCurrentUser(null);
            setProfileModalOpen(false);
          },
        });
        if (pinRes.wiped) {
          return {
            success: false,
            message: translations[language].pin_lockout_wiped_error,
          };
        }
        if (!pinRes.success) {
          return {
            success: false,
            message: translations[language].pin_attempts_remaining_error.replace(
              '{remaining}',
              String(pinRes.remainingAttempts)
            ),
          };
        }
      }

      if (!/^\d{4}$/.test(newPin)) {
        return { success: false, message: 'Le code PIN de déverrouillage local doit comporter 4 chiffres.' };
      }

      if (newPin !== confirmPin) {
        return { success: false, message: 'La confirmation ne correspond pas au nouveau code.' };
      }

      // Save local device PIN only (PBKDF2 salted in browser localStorage, NEVER written to database)
      await saveLocalDevicePin(currentUser.id, newPin);
      resetPinFailedAttempts();

      return { success: true, message: 'Code de déverrouillage local enregistré sur cet appareil.' };
    },
    [currentUser, supabaseUrl, supabaseKey, language]
  );

  // Cart Management
  const addToCart = useCallback(
    (product: Product, qty: number = 1) => {
      // If movement mode is OUT and depot is closed, strictly prevent adding to cart
      if (scanState.mode === 'OUT' && isDepotClosed(depots, product.store_name)) {
        console.warn(`Tentative de prélèvement bloquée : Le dépôt « ${product.store_name || 'Principal'} » est fermé / inactif.`);
        return;
      }
      const prev = batchCartRef.current;
      const existing = prev.find((item) => item.product.id === product.id);
      const nextCart = existing
        ? prev.map((item) =>
            item.product.id === product.id ? { ...item, qtyActual: item.qtyActual + qty } : item
          )
        : [...prev, { product, qtyActual: qty }];
      commitUserBasketsChange(orderBasketsRef.current, activeOrderBasketIdRef.current, nextCart);
    },
    [scanState.mode, depots, commitUserBasketsChange]
  );

  const updateCartQty = useCallback(
    (productId: string, qty: number) => {
      const nextCart = batchCartRef.current.map((item) =>
        item.product.id === productId ? { ...item, qtyActual: Math.max(0, qty) } : item
      );
      commitUserBasketsChange(orderBasketsRef.current, activeOrderBasketIdRef.current, nextCart);
    },
    [commitUserBasketsChange]
  );

  const removeFromCart = useCallback(
    (productId: string) => {
      const nextCart = batchCartRef.current.filter((item) => item.product.id !== productId);
      commitUserBasketsChange(orderBasketsRef.current, activeOrderBasketIdRef.current, nextCart);
    },
    [commitUserBasketsChange]
  );

  const clearCart = useCallback(() => {
    commitUserBasketsChange(orderBasketsRef.current, activeOrderBasketIdRef.current, []);
  }, [commitUserBasketsChange]);

  // Confirm Movements
  const confirmBatchMovements = useCallback(
    async (siteNumber?: string) => {
      if (batchCart.length === 0) return { success: false, message: 'Le panier est vide.' };
      const mode = scanState.mode as MovementType;

      // Validate stock availability, closed depot check, and depot authorization for OUT
      if (mode === 'OUT') {
        for (const item of batchCart) {
          // 1. Strict check: closed / inactive depot
          if (isDepotClosed(depots, item.product.store_name)) {
            return {
              success: false,
              message:
                tr(language, `Sortie refusée : Le dépôt « ${item.product.store_name || 'Non défini'} » est fermé / inactif. Les sorties de matériel y sont strictement interdites (article ${item.product.reference}).`, `Withdrawal rejected: Depot "${item.product.store_name || 'Undefined'}" is closed/inactive (${item.product.reference}).`),
            };
          }

          // 2. Strict check: vehicle depot borrowing rule (only vehicle user, binômes, and department managers) & allowed depots
          const borrowCheck = canUserBorrowFromDepot(currentUser, item.product.store_name, depots, language, departments, users);
          if (!borrowCheck.allowed) {
            return {
              success: false,
              message: borrowCheck.reason || (tr(language, 'Sortie ou emprunt non autorisé sur ce dépôt.', 'Unauthorized withdrawal from this depot.')),
            };
          }

          // 3. User authorization for depot
          if (!isUserAllowedForDepot(currentUser, item.product.store_name)) {
            return {
              success: false,
              message:
                tr(language, `Prélèvement interdit : vous n'avez pas accès au dépôt « ${item.product.store_name || 'Non défini'} » (article ${item.product.reference}).`, `Withdrawal not allowed: you do not have permission for depot "${item.product.store_name || 'Undefined'}" (${item.product.reference}).`),
            };
          }
          if (item.qtyActual > item.product.quantity) {
            return {
              success: false,
              message: `Stock insuffisant pour "${item.product.brand} ${item.product.model}". En stock : ${item.product.quantity}, demandé : ${item.qtyActual}`,
            };
          }
        }
      }

      // Validate depot authorization for IN (Stock entry)
      if (mode === 'IN') {
        const hasGeneralStockIn = userHasPermission('perm_stock_in');
        for (const item of batchCart) {
          const entryCheck = canUserEnterStockInDepot(currentUser, item.product.store_name, depots, hasGeneralStockIn, language, departments, users);
          if (!entryCheck.allowed) {
            return {
              success: false,
              message: entryCheck.reason || (tr(language, 'Entrée en stock non autorisée sur ce dépôt.', 'Unauthorized stock entry for this depot.')),
            };
          }
        }
      }

      // Determine Department from Project
      let depName = currentUser?.department || '';
      if (mode === 'OUT' && siteNumber) {
        const foundProj = projects.find((p) => p.project_number.toLowerCase() === siteNumber.toLowerCase());
        if (foundProj) {
          const foundDep = departments.find((d) => d.id === foundProj.department_id);
          if (foundDep) depName = foundDep.name;
        }
      }

      const now = new Date().toISOString();
      const newMovements: StockMovement[] = [];
      const updatedProductsMap = new Map<string, number>();

      for (const item of batchCart) {
        const delta = item.qtyActual;
        const currentQty = item.product.quantity;
        const newQty = mode === 'OUT' ? Math.max(0, currentQty - delta) : currentQty + delta;
        updatedProductsMap.set(item.product.id, newQty);

        newMovements.push({
          id: `mov-${Date.now()}-${crypto.randomUUID()}`,
          product_id: item.product.id,
          product_ref: item.product.reference,
          user_id: currentUser ? currentUser.id : null,
          user_name: currentUser ? currentUser.name : 'Inconnu',
          movement_type: mode,
          quantity_changed: delta,
          site_number: siteNumber || null,
          department_name: depName || null,
          total_cost: delta * (item.product.unit_price || 0),
          created_at: now,
        });
      }

      // Update local state
      setProducts((prev) =>
        prev.map((p) => {
          if (updatedProductsMap.has(p.id)) {
            return { ...p, quantity: updatedProductsMap.get(p.id)! };
          }
          return p;
        })
      );

      setMovements((prev) => [...newMovements, ...prev]);
      commitUserBasketsChange(orderBasketsRef.current, activeOrderBasketIdRef.current, []);
      setBatchCartModalOpen(false);
      setScanState((prev) => ({ ...prev, open: false }));

      // Priorité N°4, 5 & 7 : Sauvegarde locale IndexedDB et envoi transactionnel / sync_queue
      const client = getClientSupabase(supabaseUrl, supabaseKey);
      for (const mov of newMovements) {
        const newQty = updatedProductsMap.get(mov.product_id);
        const opId =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : 'mov-op-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);

        // Sauvegarde immédiate dans IndexedDB pour fonctionnement 100% hors-ligne
        putToStore('stock_movements', mov).catch((e) => console.warn('[IDB] put movement:', e));

        const rpcPayload = {
          product_id: mov.product_id,
          depot_name: mov.depot_name || null,
          type: mov.movement_type,
          quantity: mov.quantity_changed,
          reason: mov.site_number ? `Chantier: ${mov.site_number}` : null,
          project_name: mov.site_number || null,
          department: mov.department_name || null,
          metadata: { id: mov.id, product_ref: mov.product_ref },
        };

        if (client) {
          pushMovementToSupabase(client, mov, newQty, currentUser?.id, opId)
            .then((res) => {
              if (!res.success) {
                if (res.conflict) {
                  setLicenseNotification(`⚠️ Conflit de stock sur ${mov.product_ref} : ${res.error}`);
                } else {
                  // Erreur transitoire ou coupure réseau : mise en file d'attente
                  enqueueSyncOperation('stock_movements', 'RPC_STOCK_MOVEMENT', rpcPayload, opId).catch((err) =>
                    console.warn('[SyncQueue] enqueue error:', err)
                  );
                }
              }
            })
            .catch(() => {
              enqueueSyncOperation('stock_movements', 'RPC_STOCK_MOVEMENT', rpcPayload, opId).catch((err) =>
                console.warn('[SyncQueue] enqueue error:', err)
              );
            });
        } else {
          // Mode hors-ligne strict : enregistrement dans la file sync_queue
          enqueueSyncOperation('stock_movements', 'RPC_STOCK_MOVEMENT', rpcPayload, opId).catch((err) =>
            console.warn('[SyncQueue] enqueue error:', err)
          );
        }
      }

      return { success: true, message: `${newMovements.length} mouvement(s) enregistré(s) avec succès !` };
    },
    [batchCart, scanState.mode, currentUser, projects, departments, depots, language, supabaseUrl, supabaseKey, commitUserBasketsChange]
  );

  // Material Orders & Fulfillment (Click & Collect Drive Magasin)
  const createOrderBasket = useCallback(
    (name?: string, depotName?: string, siteNumber?: string): string => {
      const currentList = orderBasketsRef.current;
      const newId = `basket-${Date.now()}`;
      const basketCount = currentList.length + 1;
      const basketName = name?.trim() || `Panier ${basketCount}${depotName ? ` (${depotName})` : ''}`;
      const newBasket: OrderBasket = {
        id: newId,
        name: basketName,
        depot_name: depotName,
        site_number: siteNumber?.trim() || undefined,
        items: [],
        created_at: new Date().toISOString(),
      };
      commitUserBasketsChange([...currentList, newBasket], newId, batchCartRef.current);
      return newId;
    },
    [commitUserBasketsChange]
  );

  const deleteOrderBasket = useCallback(
    (id: string) => {
      const currentList = orderBasketsRef.current;
      const remaining = currentList.filter((b) => b.id !== id);
      if (remaining.length === 0) {
        commitUserBasketsChange([], '', batchCartRef.current);
        return;
      }
      const nextActiveId =
        activeOrderBasketIdRef.current === id ? remaining[0].id : activeOrderBasketIdRef.current;
      commitUserBasketsChange(remaining, nextActiveId, batchCartRef.current);
    },
    [commitUserBasketsChange]
  );

  const moveOrderBasket = useCallback(
    (id: string, direction: 'up' | 'down') => {
      const prev = orderBasketsRef.current;
      const idx = prev.findIndex((b) => b.id === id);
      if (idx === -1) return;
      if (direction === 'up' && idx === 0) return;
      if (direction === 'down' && idx === prev.length - 1) return;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      const next = [...prev];
      const temp = next[idx];
      next[idx] = next[targetIdx];
      next[targetIdx] = temp;
      commitUserBasketsChange(next, activeOrderBasketIdRef.current, batchCartRef.current);
    },
    [commitUserBasketsChange]
  );

  const renameOrderBasket = useCallback(
    (id: string, newName: string) => {
      if (!newName.trim()) return;
      const next = orderBasketsRef.current.map((b) =>
        b.id === id ? { ...b, name: newName.trim() } : b
      );
      commitUserBasketsChange(next, activeOrderBasketIdRef.current, batchCartRef.current);
    },
    [commitUserBasketsChange]
  );

  const updateOrderBasketSite = useCallback(
    (id: string, siteNumber: string) => {
      const next = orderBasketsRef.current.map((b) =>
        b.id === id ? { ...b, site_number: siteNumber.trim() || undefined } : b
      );
      commitUserBasketsChange(next, activeOrderBasketIdRef.current, batchCartRef.current);
    },
    [commitUserBasketsChange]
  );

  const updateOrderBasket = useCallback(
    (id: string, updates: Partial<Pick<OrderBasket, 'name' | 'depot_name' | 'site_number' | 'notes'>>) => {
      const next = orderBasketsRef.current.map((b) => (b.id === id ? { ...b, ...updates } : b));
      commitUserBasketsChange(next, activeOrderBasketIdRef.current, batchCartRef.current);
    },
    [commitUserBasketsChange]
  );

  const duplicateOrderBasket = useCallback(
    (id: string) => {
      const currentList = orderBasketsRef.current;
      const target = currentList.find((b) => b.id === id);
      if (!target) return;
      const newId = `basket-${Date.now()}`;
      const clone: OrderBasket = {
        ...target,
        id: newId,
        name: `${target.name} (copie)`,
        site_number: target.site_number,
        notes: target.notes,
        created_at: new Date().toISOString(),
      };
      commitUserBasketsChange([...currentList, clone], newId, batchCartRef.current);
    },
    [commitUserBasketsChange]
  );

  const addToOrderCart = useCallback(
    (
      product: Product,
      quantity: number = 1,
      targetBasketId?: string
    ): {
      success: boolean;
      conflict?: boolean;
      currentDepot?: string;
      productDepot?: string;
      message?: string;
      basketId?: string;
    } => {
      const currentList = orderBasketsRef.current;
      const productDepot = (product.store_name || '').trim() || (tr(language, 'Dépôt Principal', 'Main Depot'));
      const newItem: MaterialOrderItem = {
        product_id: product.id,
        product_ref: product.reference,
        product_name: `${product.brand} ${product.model}`.trim(),
        quantity,
        unit: 'pièce',
        unit_price: product.unit_price || 0,
        picked: false,
        depot_name: productDepot,
      };

      // Si aucun panier actif n'existe (ex: l'utilisateur a supprimé son dernier panier), en créer un automatiquement
      if (currentList.length === 0) {
        const freshId = `basket-${Date.now()}`;
        const freshBasket: OrderBasket = {
          id: freshId,
          name: tr(language, 'Panier 1', 'Basket 1'),
          depot_name: productDepot,
          items: [newItem],
          created_at: new Date().toISOString(),
        };
        commitUserBasketsChange([freshBasket], freshId, batchCartRef.current);
        return { success: true, basketId: freshId };
      }

      const targetId = targetBasketId || activeOrderBasketIdRef.current;
      const targetBasket = currentList.find((b) => b.id === targetId) || currentList[0];

      // Mono-dépôt verification for the target basket
      if (targetBasket.items.length > 0) {
        const firstCartItem = targetBasket.items[0];
        const currentCartDepot =
          firstCartItem.depot_name ||
          (products.find((p) => String(p.id) === String(firstCartItem.product_id))?.store_name || '').trim() ||
          (tr(language, 'Dépôt Principal', 'Main Depot'));

        if (currentCartDepot.toLowerCase() !== productDepot.toLowerCase()) {
          const existingMatchingBasket = currentList.find(
            (b) =>
              b.id !== targetBasket.id &&
              (b.depot_name?.toLowerCase() === productDepot.toLowerCase() ||
                (b.items.length > 0 && b.items[0].depot_name?.toLowerCase() === productDepot.toLowerCase()))
          );

          const msg =
            tr(language, `Une commande regroupe les articles d'un même dépôt. Votre « ${targetBasket.name} » contient déjà du matériel du « ${currentCartDepot} », alors que cet article se trouve au « ${productDepot} ». Vous pouvez basculer sur un panier dédié au « ${productDepot} » ou en créer un nouveau.`, `An order can only contain items from a single depot. "${targetBasket.name}" contains items from "${currentCartDepot}". This item is in "${productDepot}".`);
          return {
            success: false,
            conflict: true,
            currentDepot: currentCartDepot,
            productDepot,
            basketId: existingMatchingBasket?.id,
            message: msg,
          };
        }
      }

      const nextBaskets = currentList.map((b) => {
        if (b.id !== targetBasket.id) return b;
        const existing = b.items.find((item) => String(item.product_id) === String(product.id));
        const newItems = existing
          ? b.items.map((item) =>
              String(item.product_id) === String(product.id)
                ? { ...item, quantity: item.quantity + quantity, depot_name: productDepot }
                : item
            )
          : [...b.items, newItem];
        return {
          ...b,
          depot_name: productDepot,
          items: newItems,
        };
      });

      commitUserBasketsChange(nextBaskets, targetBasket.id, batchCartRef.current);

      return { success: true, basketId: targetBasket.id };
    },
    [products, language, commitUserBasketsChange]
  );

  const switchAndAddOrderBasket = useCallback(
    (product: Product, quantity: number = 1): { success: boolean; basketId: string } => {
      const currentList = orderBasketsRef.current;
      const productDepot = (product.store_name || '').trim() || (tr(language, 'Dépôt Principal', 'Main Depot'));
      // Find an existing basket dedicated to this depot or an empty one
      let targetBasket = currentList.find(
        (b) =>
          (b.items.length > 0 && b.items[0].depot_name?.toLowerCase() === productDepot.toLowerCase()) ||
          (b.depot_name && b.depot_name.toLowerCase() === productDepot.toLowerCase())
      );
      if (!targetBasket) {
        targetBasket = currentList.find((b) => b.items.length === 0);
      }
      let targetId = targetBasket?.id;
      if (!targetId) {
        const basketCount = currentList.length + 1;
        targetId = `basket-${Date.now()}`;
        const newBasket: OrderBasket = {
          id: targetId,
          name: `Panier ${basketCount} (${productDepot})`,
          depot_name: productDepot,
          items: [],
          created_at: new Date().toISOString(),
        };
        const listWithNew = [...currentList, newBasket];
        orderBasketsRef.current = listWithNew;
        activeOrderBasketIdRef.current = targetId;
      } else {
        activeOrderBasketIdRef.current = targetId;
      }
      addToOrderCart(product, quantity, targetId);
      setActiveOrderBasketIdState(targetId);
      return { success: true, basketId: targetId };
    },
    [language, addToOrderCart]
  );

  const updateOrderCartQty = useCallback(
    (productId: string | number, quantity: number) => {
      const currActiveId = activeOrderBasketIdRef.current;
      const nextBaskets = orderBasketsRef.current.map((b) => {
        if (b.id !== currActiveId) return b;
        const newItems =
          quantity <= 0
            ? b.items.filter((item) => String(item.product_id) !== String(productId))
            : b.items.map((item) =>
                String(item.product_id) === String(productId) ? { ...item, quantity } : item
              );
        return {
          ...b,
          items: newItems,
          depot_name: newItems.length > 0 ? (b.depot_name || newItems[0].depot_name) : undefined,
        };
      });
      commitUserBasketsChange(nextBaskets, currActiveId, batchCartRef.current);
    },
    [commitUserBasketsChange]
  );

  const removeFromOrderCart = useCallback(
    (productId: string | number) => {
      const currActiveId = activeOrderBasketIdRef.current;
      const nextBaskets = orderBasketsRef.current.map((b) => {
        if (b.id !== currActiveId) return b;
        const newItems = b.items.filter((item) => String(item.product_id) !== String(productId));
        return {
          ...b,
          items: newItems,
          depot_name: newItems.length > 0 ? (b.depot_name || newItems[0].depot_name) : undefined,
        };
      });
      commitUserBasketsChange(nextBaskets, currActiveId, batchCartRef.current);
    },
    [commitUserBasketsChange]
  );

  const clearOrderCart = useCallback(
    (targetBasketId?: string) => {
      const targetId = targetBasketId || activeOrderBasketIdRef.current;
      const nextBaskets = orderBasketsRef.current.map((b) =>
        b.id === targetId ? { ...b, items: [], depot_name: undefined } : b
      );
      commitUserBasketsChange(nextBaskets, activeOrderBasketIdRef.current, batchCartRef.current);
    },
    [commitUserBasketsChange]
  );

  const submitMaterialOrder = useCallback(
    async (
      siteNumber?: string,
      depotName?: string,
      notes?: string,
      targetBasketId?: string
    ): Promise<{ success: boolean; message: string; order?: MaterialOrder }> => {
      const currentList = orderBasketsRef.current;
      const basketToSubmit =
        currentList.find((b) => b.id === (targetBasketId || activeOrderBasketIdRef.current)) || activeBasket;
      const itemsToSubmit = basketToSubmit?.items || [];
      if (itemsToSubmit.length === 0) {
        return {
          success: false,
          message: tr(language, 'Le panier de commande est vide.', 'Cart is empty.'),
        };
      }
      const effectiveSite = (siteNumber || basketToSubmit?.site_number || 'CH-00').trim().toUpperCase();
      const cleanSite = effectiveSite;

      const now = new Date();
      const datePrefix = formatOrderDatePrefix(now);
      const client = getClientSupabase(supabaseUrl, supabaseKey);

      // Attribution du numéro de commande unique par le serveur (XXXXXXXX-CMD-YYMMDD-XX)
      // ou avec le suffixe _OFF en mode hors-ligne (XXXXXXXX-CMD-YYMMDD-XX_OFF)
      const allocated = await allocateUniqueOrderNumberFromSupabase(client, cleanSite, orders);
      let orderNumber = allocated.orderNumber;
      let isCreatedOffline = allocated.isOffline;

      const proj = projects.find((p) => p.project_number.toUpperCase() === cleanSite);
      const orderDepot =
        itemsToSubmit[0]?.depot_name ||
        basketToSubmit?.depot_name ||
        depotName ||
        depots[0]?.name ||
        'Dépôt Principal';

      // Calcul du montant total de la commande
      const totalCost = itemsToSubmit.reduce(
        (acc, it) => acc + (Number(it.unit_price) || 0) * (Number(it.quantity) || 1),
        0
      );

      // Vérification du seuil d'approbation hiérarchique débrayable par département
      const projDept = proj ? departments.find((d) => d.id === proj.department_id) : undefined;
      const userDept = currentUser?.department
        ? departments.find((d) => d.name.toLowerCase().trim() === currentUser.department?.toLowerCase().trim())
        : undefined;
      const effectiveDept = projDept || userDept;

      const requiresApproval =
        Boolean(effectiveDept?.require_order_approval) &&
        totalCost >= (Number(effectiveDept?.order_approval_threshold) || 0);

      const initialStatus: OrderStatus = requiresApproval ? 'WAITING_APPROVAL' : 'PENDING';

      let newOrder: MaterialOrder = {
        id: `ord_${Date.now()}_${crypto.randomUUID()}`,
        order_number: orderNumber,
        site_number: cleanSite,
        site_name: proj ? proj.project_name : undefined,
        depot_name: orderDepot,
        requester_id: currentUser ? currentUser.id : 'unknown',
        requester_name: currentUser ? currentUser.name : 'Demandeur Chantier',
        requester_department: currentUser ? currentUser.department : '',
        status: initialStatus,
        total_cost: totalCost,
        items: [...itemsToSubmit],
        notes: notes || basketToSubmit?.notes || undefined,
        approved_by: null,
        approved_at: null,
        rejected_by: null,
        rejected_at: null,
        rejection_reason: null,
        created_at: now.toISOString(),
        assigned_at: null,
        preparer_id: null,
        preparer_name: null,
        ready_at: null,
        collected_at: null,
        collected_by: null,
      };

      // Enregistrement immédiat sur le serveur (avec résolution de collision 23505) ou bascule _OFF si coupure réseau
      if (client && !isCreatedOffline) {
        try {
          const upsertRes = await upsertOrderToSupabase(client, newOrder);
          if (upsertRes.isNetworkError) {
            isCreatedOffline = true;
            orderNumber = orderNumber.endsWith('_OFF')
              ? orderNumber
              : computeNextOrderNumber(
                  cleanSite,
                  datePrefix,
                  orders.map((o) => o.order_number),
                  true
                );
            newOrder = { ...newOrder, order_number: orderNumber };
            enqueueSyncOperation('material_orders', 'INSERT', newOrder, newOrder.id).catch((err) =>
              console.warn('[SyncQueue] enqueue offline order error:', err)
            );
          } else if (upsertRes.orderNumber && upsertRes.orderNumber !== orderNumber) {
            orderNumber = upsertRes.orderNumber;
            newOrder = { ...newOrder, order_number: orderNumber };
          }
        } catch (err) {
          console.warn('Supabase sync order insert error, switching to _OFF:', err);
          isCreatedOffline = true;
          orderNumber = orderNumber.endsWith('_OFF')
            ? orderNumber
            : computeNextOrderNumber(
                cleanSite,
                datePrefix,
                orders.map((o) => o.order_number),
                true
              );
          newOrder = { ...newOrder, order_number: orderNumber };
          enqueueSyncOperation('material_orders', 'INSERT', newOrder, newOrder.id).catch((e) =>
            console.warn('[SyncQueue] enqueue offline order error:', e)
          );
        }
      } else {
        if (!orderNumber.endsWith('_OFF')) {
          orderNumber = `${orderNumber}_OFF`;
          newOrder = { ...newOrder, order_number: orderNumber };
        }
        enqueueSyncOperation('material_orders', 'INSERT', newOrder, newOrder.id).catch((err) =>
          console.warn('[SyncQueue] enqueue offline order error:', err)
        );
      }

      putToStore('material_orders', newOrder).catch((e) => console.warn('[IDB] put order:', e));
      setOrders((prev) => [newOrder, ...prev.filter((o) => o.id !== newOrder.id)]);

      // Remove the submitted basket and switch to the next one (or empty if it was the last basket)
      const submittedBasketId = basketToSubmit?.id || activeOrderBasketIdRef.current;
      const remaining = currentList.filter((b) => b.id !== submittedBasketId);
      const nextActiveIdAfterSubmit = remaining.length > 0 ? remaining[0].id : '';
      commitUserBasketsChange(remaining, nextActiveIdAfterSubmit, batchCartRef.current);

      logActivity({
        type: 'USER_ACTION',
        category: 'MOVEMENTS',
        title: requiresApproval
          ? `Commande Soumise (Validation Requise)${isCreatedOffline ? ' [Hors-Ligne]' : ''}`
          : `Commande Matériel Créée${isCreatedOffline ? ' [Hors-Ligne]' : ''}`,
        description: requiresApproval
          ? `Commande ${orderNumber} (${newOrder.items.length} articles - ${formatCurrency(totalCost)}) en attente de validation hiérarchique (${effectiveDept?.name || 'Département'}).`
          : `Nouvelle commande ${orderNumber} (${newOrder.items.length} articles - ${formatCurrency(totalCost)}) pour le chantier ${cleanSite}`,
        user_name: currentUser?.name || 'Demandeur',
        depot_name: newOrder.depot_name,
        badgeText: isCreatedOffline ? 'Offline (_OFF)' : requiresApproval ? 'À Valider' : 'Commande',
      });

      return {
        success: true,
        message: requiresApproval
          ? tr(language, `Commande ${orderNumber} soumise (${formatCurrency(totalCost)})${isCreatedOffline ? ' en mode hors-ligne (suffixe _OFF)' : ''}. En attente de validation par le chef de service / projet (seuil : ${effectiveDept?.order_approval_threshold || 0} €).`, `Order ${orderNumber} submitted (${formatCurrency(totalCost)})${isCreatedOffline ? ' in offline mode (_OFF)' : ''}. Awaiting manager approval (threshold: ${effectiveDept?.order_approval_threshold || 0} €).`)
          : tr(language, `Commande ${orderNumber} ${isCreatedOffline ? 'enregistrée hors-ligne (suffixe _OFF) et prête à être synchronisée' : 'transmise avec succès au magasin'} (${newOrder.items.length} articles) !`, `Order ${orderNumber} ${isCreatedOffline ? 'saved offline (_OFF)' : 'successfully submitted to warehouse'}!`),
        order: newOrder,
      };
    },
    [orderCart, activeOrderBasketId, orderBaskets, activeBasket, orders, currentUser, projects, departments, depots, language, logActivity, supabaseUrl, supabaseKey, commitUserBasketsChange]
  );

  const assignOrderToMe = useCallback(
    async (orderId: string): Promise<{ success: boolean; message: string }> => {
      const existing = orders.find((o) => o.id === orderId);
      if (existing) {
        if (existing.status === 'WAITING_APPROVAL') {
          return {
            success: false,
            message:
              tr(language, 'Action impossible : Cette commande est en attente de validation hiérarchique et ne peut pas être assignée à la préparation.', 'Action blocked: This order is awaiting hierarchical approval and cannot be assigned.'),
          };
        }
        if (existing.status === 'REJECTED') {
          return {
            success: false,
            message:
              tr(language, 'Action impossible : Cette commande a été refusée.', 'Cannot assign a rejected order.'),
          };
        }
        // Règle d'exclusivité : un préparateur ne peut pas s'assigner ni modifier la commande déjà prise en charge par un autre préparateur
        const isAssignedToOther =
          existing.preparer_id &&
          String(existing.preparer_id) !== String(currentUser?.id) &&
          !(
            Number(currentUser?.id) === 0 ||
            Number(currentUser?.role_id) === 0 ||
            Number(currentUser?.role_id) === 1 ||
            userHasPermission('perm_orders_manage')
          );

        if (isAssignedToOther) {
          return {
            success: false,
            message:
              tr(language, `Action impossible : Cette commande est déjà prise en charge par ${existing.preparer_name || 'un autre préparateur'}. Seul ce préparateur ou un administrateur peut la modifier ou la réassigner.`, `Action blocked: This order is already assigned to ${existing.preparer_name || 'another preparer'}. Only they or an administrator can reassign it.`),
          };
        }
      }

      if (!existing) {
        return {
          success: false,
          message: tr(language, 'Commande introuvable.', 'Order not found.'),
        };
      }

      const now = new Date().toISOString();
      const updated: MaterialOrder = {
        ...existing,
        status: 'PREPARING',
        assigned_at: now,
        preparer_id: currentUser ? currentUser.id : null,
        preparer_name: currentUser ? currentUser.name : 'Magasinier',
        updated_at: now,
      };

      setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));

      logActivity({
        type: 'USER_ACTION',
        category: 'MOVEMENTS',
        title: 'Prise en charge Commande',
        description: `Préparation prise en charge par ${currentUser?.name || 'Magasinier'} pour la commande ${updated.order_number}`,
        user_name: currentUser?.name || 'Magasinier',
        badgeText: 'Préparation',
      });

      const client = getClientSupabase(supabaseUrl, supabaseKey);
      if (client) {
        await upsertOrderToSupabase(client, updated).catch((err) => {
          console.warn('Supabase order assign error:', err);
        });
      }

      return {
        success: true,
        message: tr(language, 'Commande assignée à votre préparation !', 'Order assigned to you!'),
      };
    },
    [orders, currentUser, logActivity, supabaseUrl, supabaseKey, language, userHasPermission]
  );

  const markOrderReady = useCallback(
    async (orderId: string, pickupZone?: string): Promise<{ success: boolean; message: string }> => {
      const targetOrder = orders.find((o) => o.id === orderId);
      if (!targetOrder) {
        return { success: false, message: tr(language, 'Commande introuvable.', 'Order not found.') };
      }

      // Règle d'exclusivité : seul le préparateur assigné (ou un administrateur) peut marquer la commande comme prête
      const isAssignedToOther =
        targetOrder.preparer_id &&
        String(targetOrder.preparer_id) !== String(currentUser?.id) &&
        !(
          Number(currentUser?.id) === 0 ||
          Number(currentUser?.role_id) === 0 ||
          Number(currentUser?.role_id) === 1 ||
          userHasPermission('perm_orders_manage')
        );

      if (isAssignedToOther) {
        return {
          success: false,
          message:
            tr(language, `Action impossible : Cette commande est assignée à ${targetOrder.preparer_name || 'un autre préparateur'}. Seul ce préparateur ou un administrateur peut marquer la commande comme prête.`, `Action blocked: This order is assigned to ${targetOrder.preparer_name || 'another preparer'}.`),
        };
      }

      // Check: tous les articles doivent être confirmés scannés et encodés en quantité ou signalés non disponibles
      const unconfirmed = targetOrder.items.filter((it) => !it.picked && !it.unavailable);
      if (unconfirmed.length > 0) {
        return {
          success: false,
          message:
            tr(language, `Validation impossible : ${unconfirmed.length} article(s) doivent obligatoirement être scannés et encodés en quantité physique réelle, ou signalés non disponibles.`, `Cannot validate: ${unconfirmed.length} item(s) must be verified via barcode scan and quantity encoding or marked unavailable.`),
        };
      }

      // Check: chaque article pointé doit obligatoirement avoir une quantité encodée supérieure à 0
      const invalidQuantityItems = targetOrder.items.filter(
        (it) => it.picked && (!it.picked_quantity || it.picked_quantity <= 0)
      );
      if (invalidQuantityItems.length > 0) {
        return {
          success: false,
          message:
            tr(language, `Validation impossible : ${invalidQuantityItems.length} article(s) pointé(s) n'ont pas de quantité physique encodée valide (> 0).`, `Cannot validate: ${invalidQuantityItems.length} item(s) are missing valid encoded quantity (> 0).`),
        };
      }

      const now = new Date().toISOString();
      const zone = (pickupZone || '').trim() || (tr(language, 'Zone de retrait magasin', 'Store pickup area'));
      const qrPayload = `TOT-ORDER:${targetOrder.order_number}`;

      const updated: MaterialOrder = {
        ...targetOrder,
        status: 'READY',
        ready_at: now,
        pickup_zone: zone,
        ready_qr_code: qrPayload,
        updated_at: now,
      };

      setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));

      logActivity({
        type: 'USER_ACTION',
        category: 'MOVEMENTS',
        title: 'Commande Prête au Retrait',
        description: `Commande ${updated.order_number} PRÊTE dans : ${zone} pour ${updated.requester_name}`,
        user_name: currentUser?.name || 'Magasinier',
        badgeText: 'Prête',
      });

      const client = getClientSupabase(supabaseUrl, supabaseKey);
      if (client) {
        await upsertOrderToSupabase(client, updated).catch((err) => {
          console.warn('Supabase order ready error:', err);
        });
      }

      return {
        success: true,
        message:
          tr(language, `Commande prête au retrait (Zone : ${zone}) ! QR Code généré et alerte envoyée au demandeur.`, `Order ready for pickup (Zone: ${zone})! QR code generated and notification sent.`),
      };
    },
    [orders, currentUser, logActivity, supabaseUrl, supabaseKey, language, userHasPermission]
  );

  const markOrderCollected = useCallback(
    async (
      orderId: string,
      options?: { signatureData?: string; proofPhotoUrl?: string }
    ): Promise<{ success: boolean; message: string }> => {
      const existingOrder = orders.find((o) => o.id === orderId);
      if (!existingOrder) {
        return { success: false, message: tr(language, 'Commande introuvable.', 'Order not found.') };
      }

      const now = new Date().toISOString();
      const order: MaterialOrder = {
        ...existingOrder,
        status: 'COLLECTED',
        collected_at: now,
        collected_by: currentUser ? currentUser.name : existingOrder.requester_name,
        signature_data: options?.signatureData || existingOrder.signature_data || null,
        proof_photo_url: options?.proofPhotoUrl || existingOrder.proof_photo_url || null,
        updated_at: now,
      };

      setOrders((prev) => prev.map((o) => (o.id === orderId ? order : o)));

      // 1. Generate stock outflow movements for each item
      const newMovements: StockMovement[] = [];
      const qtyDeductions = new Map<string, number>();

      for (const it of order.items) {
        if (it.unavailable) continue;
        const targetProdId = it.substituted && it.substituted_with_id ? it.substituted_with_id : it.product_id;
        const targetProdRef = it.substituted && it.substituted_with_ref ? it.substituted_with_ref : it.product_ref;

        const prod = products.find(
          (p) => String(p.id) === String(targetProdId) || p.reference === targetProdRef
        );
        const qty = it.picked_quantity || it.quantity || 1;
        const cost = (it.unit_price || (prod?.unit_price || 0)) * qty;

        newMovements.push({
          id: `mov-cmd-${Date.now()}-${crypto.randomUUID()}`,
          product_id: String(targetProdId),
          product_ref: targetProdRef,
          user_id: currentUser ? currentUser.id : order.requester_id,
          user_name: currentUser ? currentUser.name : order.requester_name,
          movement_type: 'OUT',
          quantity_changed: qty,
          site_number: order.site_number,
          department_name: order.requester_department || null,
          total_cost: cost,
          order_number: order.order_number,
          created_at: now,
        });

        if (prod) {
          qtyDeductions.set(prod.id, (qtyDeductions.get(prod.id) || 0) + qty);
        }
      }

      // 2. Decrement physical stock in products
      setProducts((prev) =>
        prev.map((p) => {
          const deduction = qtyDeductions.get(p.id);
          if (deduction) {
            return { ...p, quantity: Math.max(0, (p.quantity || 0) - deduction) };
          }
          return p;
        })
      );

      // 3. Add to movements list
      setMovements((prev) => [...newMovements, ...prev]);

      // 4. Log activity
      logActivity({
        type: 'STOCK_OUT',
        category: 'MOVEMENTS',
        title: 'Retrait Commande Validé',
        description: `Matériel retiré pour la commande ${order.order_number} (${order.items.length} références)${
          options?.signatureData ? ' [Émargé avec signature]' : ''
        }${options?.proofPhotoUrl ? ' [Photo preuve jointe]' : ''} - Sortie stock validée chantier ${order.site_number}`,
        user_name: currentUser?.name || order.requester_name,
        depot_name: order.depot_name,
        badgeText: 'Retiré',
      });

      // 5. Sync order + stock movements + product quantities to Supabase
      const client = getClientSupabase(supabaseUrl, supabaseKey);
      if (client) {
        await upsertOrderToSupabase(client, order).catch((err) => {
          console.warn('Supabase order collect error:', err);
        });
        for (const mov of newMovements) {
          const prod = products.find((p) => String(p.id) === String(mov.product_id) || p.reference === mov.product_ref);
          const deduction = prod ? qtyDeductions.get(prod.id) || 0 : 0;
          const nextQty = prod ? Math.max(0, (prod.quantity || 0) - deduction) : undefined;
          pushMovementToSupabase(client, mov, nextQty).catch((err) => {
            console.warn('Supabase collect movement sync error:', err);
          });
        }
      }

      return {
        success: true,
        message:
          tr(language, 'Retrait confirmé avec succès ! Les sorties de stock ont été enregistrées.', 'Withdrawal confirmed! Stock outflows recorded.'),
      };
    },
    [orders, currentUser, products, language, logActivity, supabaseUrl, supabaseKey]
  );

  const updateMaterialOrder = useCallback(
    async (
      orderId: string,
      updates: {
        items?: MaterialOrderItem[];
        site_number?: string;
        site_name?: string;
        notes?: string;
        depot_name?: string;
      }
    ): Promise<{ success: boolean; message: string }> => {
      const order = orders.find((o) => o.id === orderId);
      if (!order) {
        return {
          success: false,
          message: tr(language, 'Commande introuvable.', 'Order not found.'),
        };
      }
      if (order.status !== 'PENDING' && order.status !== 'WAITING_APPROVAL') {
        return {
          success: false,
          message:
            tr(language, 'Cette commande est déjà prise en charge ou en cours de préparation par le magasin et ne peut plus être modifiée.', 'This order is already being prepared and cannot be modified.'),
        };
      }

      const nowIso = new Date().toISOString();
      const updatedOrder: MaterialOrder = {
        ...order,
        ...(updates.items ? { items: updates.items } : {}),
        ...(updates.site_number ? { site_number: updates.site_number } : {}),
        ...(updates.site_name ? { site_name: updates.site_name } : {}),
        ...(updates.notes !== undefined ? { notes: updates.notes } : {}),
        ...(updates.depot_name ? { depot_name: updates.depot_name } : {}),
        is_edited: true,
        updated_at: nowIso,
      };

      setOrders((prev) => prev.map((o) => (o.id === orderId ? updatedOrder : o)));

      logActivity({
        type: 'ORDER_MODIFIED',
        category: 'MOVEMENTS',
        title: 'Commande Matériel Modifiée',
        description: `La commande ${order.order_number} (${order.site_number}) a été modifiée par ${currentUser?.name || 'le demandeur'}.`,
        user_name: currentUser?.name || order.requester_name,
        depot_name: updates.depot_name || order.depot_name,
        badgeText: 'Modifiée',
      });

      const client = getClientSupabase(supabaseUrl, supabaseKey);
      if (client) {
        await upsertOrderToSupabase(client, updatedOrder).catch((err) => {
          console.warn('Supabase updateMaterialOrder error:', err);
        });
      }

      return {
        success: true,
        message:
          tr(language, 'Commande modifiée avec succès.', 'Order modified successfully.'),
      };
    },
    [orders, currentUser, language, logActivity, supabaseUrl, supabaseKey]
  );

  const substituteOrderItem = useCallback(
    async (
      orderId: string,
      originalProductId: string | number,
      substituteProduct: Product,
      reason?: string
    ): Promise<{ success: boolean; message: string }> => {
      const existingOrder = orders.find((o) => o.id === orderId);
      if (!existingOrder) {
        return { success: false, message: tr(language, 'Commande introuvable.', 'Order not found.') };
      }
      const isAssignedToOther =
        existingOrder.preparer_id &&
        String(existingOrder.preparer_id) !== String(currentUser?.id) &&
        !(
          Number(currentUser?.id) === 0 ||
          Number(currentUser?.role_id) === 0 ||
          Number(currentUser?.role_id) === 1 ||
          userHasPermission('perm_orders_manage')
        );

      if (isAssignedToOther) {
        return {
          success: false,
          message:
            tr(language, `Action impossible : Cette commande est assignée à ${existingOrder.preparer_name || 'un autre préparateur'}. Vous ne pouvez pas substituer d'article.`, `Action blocked: This order is assigned to ${existingOrder.preparer_name || 'another preparer'}.`),
        };
      }

      const nowIso = new Date().toISOString();
      const updatedItems = existingOrder.items.map((it) => {
        if (String(it.product_id) === String(originalProductId)) {
          return {
            ...it,
            substituted: true,
            substituted_with_id: substituteProduct.id,
            substituted_with_ref: substituteProduct.reference,
            substituted_with_name: `${substituteProduct.brand} ${substituteProduct.model}`.trim(),
            unavailable: false,
            unavailable_comment:
              reason ||
              `Substitué par ${substituteProduct.reference} (${substituteProduct.brand} ${substituteProduct.model})`,
            picked: true,
            scanned_at: nowIso,
          };
        }
        return it;
      });
      const updatedOrder: MaterialOrder = { ...existingOrder, items: updatedItems, updated_at: nowIso };

      setOrders((prev) => prev.map((o) => (o.id === orderId ? updatedOrder : o)));

      logActivity({
        type: 'USER_ACTION',
        category: 'MOVEMENTS',
        title: 'Article Substitué',
        description: `Commande ${updatedOrder.order_number} : substitution par ${substituteProduct.reference} (${substituteProduct.brand} ${substituteProduct.model})`,
        user_name: currentUser?.name || 'Préparateur',
        badgeText: 'Substitution',
      });

      const client = getClientSupabase(supabaseUrl, supabaseKey);
      if (client) {
        await upsertOrderToSupabase(client, updatedOrder).catch((err) => {
          console.warn('Supabase order substitution error:', err);
        });
      }

      return {
        success: true,
        message:
          tr(language, `Article remplacé avec succès par ${substituteProduct.reference} (${substituteProduct.brand} ${substituteProduct.model})`, `Item substituted with ${substituteProduct.reference}`),
      };
    },
    [orders, currentUser, logActivity, supabaseUrl, supabaseKey, language, userHasPermission]
  );

  const cancelOrder = useCallback(
    async (orderId: string, reason?: string): Promise<{ success: boolean; message: string }> => {
      const existing = orders.find((o) => o.id === orderId);
      if (!existing) {
        return { success: false, message: tr(language, 'Commande introuvable.', 'Order not found.') };
      }

      if (existing.status === 'PREPARING' || existing.status === 'READY' || existing.status === 'COLLECTED') {
        return {
          success: false,
          message:
            tr(language, 'Impossible d\'annuler une commande déjà prise en charge en préparation ou terminée.', 'Cannot cancel an order already being prepared or completed.'),
        };
      }

      const targetOrder: MaterialOrder = {
        ...existing,
        status: 'CANCELLED',
        notes: reason ? `${existing.notes || ''} [Annulé: ${reason}]`.trim() : existing.notes,
        updated_at: new Date().toISOString(),
      };

      setOrders((prev) => prev.map((o) => (o.id === orderId ? targetOrder : o)));

      logActivity({
        type: 'USER_ACTION',
        category: 'MOVEMENTS',
        title: 'Commande Annulée',
        description: `Commande ${targetOrder.order_number} annulée`,
        user_name: currentUser?.name || 'Utilisateur',
        badgeText: 'Annulée',
      });

      const client = getClientSupabase(supabaseUrl, supabaseKey);
      if (client) {
        await upsertOrderToSupabase(client, targetOrder).catch((err) => {
          console.warn('Supabase cancel order error:', err);
        });
      }
      return { success: true, message: tr(language, 'Commande annulée avec succès.', 'Order cancelled.') };
    },
    [orders, currentUser, logActivity, language, supabaseUrl, supabaseKey]
  );

  const canApproveOrder = useCallback(
    (order: MaterialOrder): boolean => {
      if (!currentUser) return false;
      const isSuperAdmin = Number(currentUser.role_id) === 0 || Number(currentUser.id) === 0;
      // Règle stricte (PDF Chapitre 5) : Pas d'auto-validation de commande (sauf Super Administrateur)
      if (!isSuperAdmin && order.requester_id && String(order.requester_id) === String(currentUser.id)) {
        return false;
      }
      // Super Admin ou Administrateur (rôle 2) ou détenteur de la permission 'perm_order_approve'
      if (
        isSuperAdmin ||
        Number(currentUser.role_id) === 2 ||
        userHasPermission('perm_order_approve')
      ) {
        return true;
      }
      const userIdStr = String(currentUser.id);

      // 1. Chef de Chantier / Chef de Projet ou Suppléant rattaché au chantier de la commande
      const cleanSite = (order.site_number || '').trim().toUpperCase();
      const cleanSiteName = (order.site_name || '').trim().toLowerCase();
      const proj = projects.find(
        (p) =>
          p.project_number.toUpperCase() === cleanSite ||
          cleanSite.includes(p.project_number.toUpperCase()) ||
          (p.project_name && cleanSiteName && p.project_name.toLowerCase().trim() === cleanSiteName)
      );
      if (proj) {
        if (String(proj.manager_id) === userIdStr) return true;
        if (proj.deputy_manager_ids?.some((id) => String(id) === userIdStr)) return true;
      }

      // 2. Chef de Département ou Suppléant (du département du chantier ou du service demandeur)
      const requesterDeptStr = (order.requester_department || '').trim().toLowerCase();
      for (const d of departments) {
        const isManager = String(d.manager_id) === userIdStr;
        const isDeputy = d.deputy_manager_ids?.some((id) => String(id) === userIdStr);
        if (isManager || isDeputy) {
          // Correspondance avec le chantier
          if (proj && proj.department_id === d.id) return true;
          // Correspondance avec le département du demandeur
          if (
            requesterDeptStr &&
            (d.name.toLowerCase().trim() === requesterDeptStr || String(d.id) === requesterDeptStr)
          ) {
            return true;
          }
          // Correspondance avec le département de l'utilisateur connecté s'il est du même service
          if (
            currentUser.department &&
            requesterDeptStr &&
            currentUser.department.toLowerCase().trim() === requesterDeptStr
          ) {
            return true;
          }
        }
      }

      return false;
    },
    [currentUser, userHasPermission, projects, departments]
  );

  const deleteMaterialOrder = useCallback(
    async (orderId: string): Promise<{ success: boolean; message: string }> => {
      const order = orders.find((o) => o.id === orderId);
      if (!order) {
        return { success: false, message: tr(language, 'Commande introuvable.', 'Order not found.') };
      }

      if (order.status === 'COLLECTED') {
        return {
          success: false,
          message:
            tr(language, 'Impossible de supprimer cette commande : elle a déjà été retirée.', 'Cannot delete this order: it has already been collected.'),
        };
      }

      const isAuthor = Boolean(
        currentUser &&
          (String(order.requester_id) === String(currentUser.id) ||
            ((currentUser as any).auth_user_id &&
              String(order.requester_id) === String((currentUser as any).auth_user_id)) ||
            (order.requester_name &&
              currentUser.name &&
              order.requester_name.trim().toLowerCase() === currentUser.name.trim().toLowerCase()))
      );
      const isManagerOrAdmin =
        Number(currentUser?.id) === 0 ||
        Number(currentUser?.role_id) === 0 ||
        Number(currentUser?.role_id) === 1 ||
        Number(currentUser?.role_id) === 2 ||
        userHasPermission('perm_orders_manage') ||
        canApproveOrder(order);

      if (!isAuthor && !isManagerOrAdmin) {
        return {
          success: false,
          message:
            tr(language, 'Vous n\'êtes pas autorisé à supprimer cette commande.', 'You are not authorized to delete this order.'),
        };
      }

      // Enregistrer l'identifiant supprimé localement pour empêcher toute résurrection lors du polling temps réel
      try {
        const rawDel = localStorage.getItem('tot_deleted_order_ids');
        const list: string[] = rawDel ? JSON.parse(rawDel) : [];
        const nextDel = Array.from(new Set([...list, String(order.id), String(order.order_number || '')])).filter(Boolean);
        localStorage.setItem('tot_deleted_order_ids', JSON.stringify(nextDel));
      } catch {}

      setOrders((prev) => prev.filter((o) => o.id !== orderId));

      logActivity({
        type: 'USER_ACTION',
        category: 'MOVEMENTS',
        title: 'Commande Supprimée',
        description: `Commande ${order.order_number} supprimée par ${currentUser?.name || 'Demandeur'}.`,
        user_name: currentUser?.name || 'Demandeur',
        depot_name: order.depot_name,
        badgeText: 'Supprimée',
      });

      const client = getClientSupabase(supabaseUrl, supabaseKey);
      if (client) {
        deleteOrderFromSupabase(client, orderId).catch((err) => {
          console.warn('Supabase delete order error:', formatPostgresErrorMessage(err));
        });
      }

      return {
        success: true,
        message:
          tr(language, `Commande ${order.order_number} supprimée avec succès.`, `Order ${order.order_number} deleted successfully.`),
      };
    },
    [orders, currentUser, userHasPermission, canApproveOrder, language, logActivity, supabaseUrl, supabaseKey]
  );

  const approveOrder = useCallback(
    async (orderId: string, notes?: string): Promise<{ success: boolean; message: string }> => {
      const order = orders.find((o) => o.id === orderId);
      if (!order) {
        return { success: false, message: tr(language, 'Commande introuvable.', 'Order not found.') };
      }
      // Strict RLS requirement: Pas d'auto-approbation
      if (String(order.requester_id) === String(currentUser?.id)) {
        return {
          success: false,
          message:
            tr(language, 'Accès refusé : L\'auto-approbation d\'une commande par son propre demandeur est strictement interdite.', 'Access denied: Self-approval is strictly forbidden.'),
        };
      }
      // Allowed transition: WAITING_APPROVAL -> PENDING
      if (order.status !== 'WAITING_APPROVAL') {
        return {
          success: false,
          message: `Transition impossible : La commande est en statut "${order.status}". Seules les commandes en attente (WAITING_APPROVAL) peuvent être approuvées.`,
        };
      }
      if (!canApproveOrder(order)) {
        return {
          success: false,
          message:
            tr(language, 'Accès refusé : Seuls les Chefs de Département & Suppléants et les Chefs de Chantier / Chefs de Projet & Suppléants du service rattaché (ou les administrateurs) peuvent valider cette commande.', 'Access denied: Only department heads/deputies and site/project managers/deputies of the service (or administrators) can approve this order.'),
        };
      }

      const updatedOrder: MaterialOrder = {
        ...order,
        status: 'PENDING',
        approved_by: currentUser?.name || 'Chef de Projet/Dept',
        approved_at: new Date().toISOString(),
        notes: notes ? (order.notes ? `${order.notes}\n[Validation: ${notes}]` : `[Validation: ${notes}]`) : order.notes,
        updated_at: new Date().toISOString(),
      };

      setOrders((prev) => prev.map((o) => (o.id === orderId ? updatedOrder : o)));

      logActivity({
        type: 'USER_ACTION',
        category: 'MOVEMENTS',
        title: 'Commande Validée',
        description: `Commande ${order.order_number} (${formatCurrency(order.total_cost || 0)}) validée par ${currentUser?.name || 'Manager'}. Prête pour préparation.`,
        user_name: currentUser?.name || 'Manager',
        depot_name: order.depot_name,
        badgeText: 'Validée',
      });

      const client = getClientSupabase(supabaseUrl, supabaseKey);
      if (client) {
        await upsertOrderToSupabase(client, updatedOrder).catch((err) => {
          console.warn('Supabase sync order approve error:', formatPostgresErrorMessage(err));
        });
      }

      return {
        success: true,
        message:
          tr(language, `Commande ${order.order_number} validée avec succès ! Elle est désormais transmise aux préparateurs.`, `Order ${order.order_number} approved! Now transmitted to warehouse preparers.`),
      };
    },
    [orders, canApproveOrder, currentUser, language, logActivity, supabaseUrl, supabaseKey]
  );

  const rejectOrder = useCallback(
    async (orderId: string, reason: string): Promise<{ success: boolean; message: string }> => {
      const order = orders.find((o) => o.id === orderId);
      if (!order) {
        return { success: false, message: tr(language, 'Commande introuvable.', 'Order not found.') };
      }
      // Allowed transition: WAITING_APPROVAL -> REJECTED
      if (order.status !== 'WAITING_APPROVAL') {
        return {
          success: false,
          message: `Transition impossible : La commande est en statut "${order.status}". Seules les commandes en attente (WAITING_APPROVAL) peuvent être refusées.`,
        };
      }
      if (!canApproveOrder(order)) {
        return {
          success: false,
          message:
            tr(language, 'Accès refusé : Seuls les Chefs de Département & Suppléants et les Chefs de Chantier / Chefs de Projet & Suppléants du service rattaché (ou les administrateurs) peuvent refuser cette commande.', 'Access denied: Only department heads/deputies and site/project managers/deputies of the service (or administrators) can reject this order.'),
        };
      }

      const cleanReason = (reason || '').trim() || 'Non spécifié';
      const updatedOrder: MaterialOrder = {
        ...order,
        status: 'REJECTED',
        rejected_by: currentUser?.name || 'Chef de Projet/Dept',
        rejected_at: new Date().toISOString(),
        rejection_reason: cleanReason,
        notes: order.notes ? `${order.notes}\n[Refus: ${cleanReason}]` : `[Refus: ${cleanReason}]`,
        updated_at: new Date().toISOString(),
      };

      setOrders((prev) => prev.map((o) => (o.id === orderId ? updatedOrder : o)));

      logActivity({
        type: 'USER_ACTION',
        category: 'MOVEMENTS',
        title: 'Commande Refusée',
        description: `Commande ${order.order_number} refusée par ${currentUser?.name || 'Manager'}. Motif : ${cleanReason}`,
        user_name: currentUser?.name || 'Manager',
        depot_name: order.depot_name,
        badgeText: 'Refusée',
      });

      const client = getClientSupabase(supabaseUrl, supabaseKey);
      if (client) {
        await upsertOrderToSupabase(client, updatedOrder).catch((err) => {
          console.warn('Supabase sync order reject error:', err);
        });
      }

      return {
        success: true,
        message:
          tr(language, `Commande ${order.order_number} refusée. Le motif a été consigné pour le demandeur.`, `Order ${order.order_number} rejected.`),
      };
    },
    [orders, canApproveOrder, currentUser, language, logActivity, supabaseUrl, supabaseKey]
  );

  const transferOrderPickup = useCallback(
    async (
      orderId: string,
      delegateUserId: string | number,
      notes?: string
    ): Promise<{ success: boolean; message: string }> => {
      if (!currentUser) {
        return { success: false, message: tr(language, 'Non connecté.', 'Not signed in.') };
      }

      const targetOrder = orders.find((o) => o.id === orderId);
      if (!targetOrder) {
        return { success: false, message: tr(language, 'Commande introuvable.', 'Order not found.') };
      }

      // Check authorization: only the requester or an admin/manager can delegate pickup
      const isRequester =
        String(targetOrder.requester_id) === String(currentUser.id) ||
        (targetOrder.requester_name && targetOrder.requester_name.toLowerCase() === currentUser.name.toLowerCase());
      const isAdminOrManager =
        Number(currentUser.id) === 0 ||
        Number(currentUser.role_id) === 0 ||
        Number(currentUser.role_id) === 1 ||
        userHasPermission('perm_orders_manage');

      if (!isRequester && !isAdminOrManager) {
        return {
          success: false,
          message:
            tr(language, 'Seul le demandeur de la commande ou un responsable peut déléguer le retrait.', 'Only the order requester or a manager can delegate pickup.'),
        };
      }

      const delegateUser = users.find((u) => String(u.id) === String(delegateUserId));
      if (!delegateUser) {
        return {
          success: false,
          message: tr(language, 'Collègue sélectionné introuvable.', 'Colleague not found.'),
        };
      }

      const nowIso = new Date().toISOString();
      const updatedOrder: MaterialOrder = {
        ...targetOrder,
        pickup_delegate_id: delegateUser.id,
        pickup_delegate_name: delegateUser.name,
        pickup_delegate_department: delegateUser.department || targetOrder.requester_department,
        pickup_delegate_at: nowIso,
        pickup_delegate_by: currentUser.name,
        pickup_delegate_notes: notes?.trim() || null,
        updated_at: nowIso,
      };

      setOrders((prev) => prev.map((o) => (o.id === orderId ? updatedOrder : o)));

      // Audit log
      logActivity({
        type: 'USER_ACTION',
        category: 'MOVEMENTS',
        title: tr(language, 'Délégation de Retrait Commande', 'Order Pickup Delegated'),
        description:
          tr(language, `Commande ${targetOrder.order_number} : Retrait transféré à « ${delegateUser.name} » (${delegateUser.department || 'Même département'}).`, `Order ${targetOrder.order_number}: Pickup delegated to "${delegateUser.name}".`),
        user_name: currentUser.name,
        user_trigram: currentUser.trigram,
        badgeText: 'DÉLÉGUÉE',
      });

      const client = getClientSupabase(supabaseUrl, supabaseKey);
      if (client) {
        await upsertOrderToSupabase(client, updatedOrder).catch((err) => {
          console.warn('Supabase sync order delegation error:', err);
        });
      }

      return {
        success: true,
        message:
          tr(language, `Retrait de la commande transféré avec succès à ${delegateUser.name} (${delegateUser.department || 'Département'}). Il est désormais habilité à la retirer.`, `Pickup successfully delegated to ${delegateUser.name}.`),
      };
    },
    [currentUser, orders, users, userHasPermission, language, logActivity, supabaseUrl, supabaseKey]
  );

  const validateOrderItemScanned = useCallback(
    (
      orderId: string,
      productId: string | number,
      pickedQuantity: number,
      scannedBarcode: string
    ): { success: boolean; message: string } => {
      const target = orders.find((o) => o.id === orderId);
      if (!target) {
        return { success: false, message: tr(language, 'Commande introuvable.', 'Order not found.') };
      }

      // Preparer exclusivity check
      if (
        target?.preparer_id &&
        String(target.preparer_id) !== String(currentUser?.id) &&
        !(
          Number(currentUser?.id) === 0 ||
          Number(currentUser?.role_id) === 0 ||
          Number(currentUser?.role_id) === 1 ||
          userHasPermission('perm_orders_manage')
        )
      ) {
        return {
          success: false,
          message:
            tr(language, `Action refusée : Cette commande est assignée à un autre préparateur.`, 'Action blocked: This order is assigned to another preparer.'),
        };
      }

      const item = target.items.find((it) => String(it.product_id) === String(productId));
      if (!item) {
        return { success: false, message: tr(language, 'Article introuvable dans la commande.', 'Item not found in order.') };
      }

      if (pickedQuantity <= 0) {
        return {
          success: false,
          message: tr(language, 'La quantité préparée doit être supérieure à 0.', 'Picked quantity must be > 0.'),
        };
      }

      const nowIso = new Date().toISOString();
      const updatedOrder: MaterialOrder = {
        ...target,
        items: target.items.map((it) =>
          String(it.product_id) === String(productId)
            ? {
                ...it,
                picked: true,
                picked_quantity: pickedQuantity,
                scanned_barcode: scannedBarcode,
                scanned_at: nowIso,
                unavailable: false,
              }
            : it
        ),
        updated_at: nowIso,
      };

      setOrders((prev) => prev.map((o) => (o.id === orderId ? updatedOrder : o)));

      // Play success chime
      playScanBeep(true);

      const client = getClientSupabase(supabaseUrl, supabaseKey);
      if (client) {
        upsertOrderToSupabase(client, updatedOrder).catch((err) => {
          console.warn('Supabase sync scanned order error:', err);
        });
        recordOrderPreparationScanToSupabase(client, {
          order_id: target.id,
          order_number: target.order_number,
          product_id: String(item.product_id),
          product_ref: item.product_ref,
          preparer_id: currentUser ? String(currentUser.id) : null,
          preparer_name: currentUser ? currentUser.name : null,
          picked_quantity: pickedQuantity,
          scanned_barcode: scannedBarcode,
          pickup_zone: target.pickup_zone || undefined,
        }).catch((err) => {
          console.warn('Supabase recordOrderPreparationScan error:', err);
        });
      }

      return {
        success: true,
        message:
          tr(language, `Article ${item.product_ref} validé (Quantité préparée : ${pickedQuantity})`, `Item ${item.product_ref} verified (Picked qty: ${pickedQuantity})`),
      };
    },
    [orders, currentUser, userHasPermission, language, supabaseUrl, supabaseKey]
  );

  const unpickOrderItem = useCallback(
    (orderId: string, productId: string | number) => {
      const target = orders.find((o) => o.id === orderId);
      if (
        target?.preparer_id &&
        String(target.preparer_id) !== String(currentUser?.id) &&
        !(
          Number(currentUser?.id) === 0 ||
          Number(currentUser?.role_id) === 0 ||
          Number(currentUser?.role_id) === 1 ||
          userHasPermission('perm_orders_manage')
        )
      ) {
        return;
      }

      const nowIso = new Date().toISOString();
      const updatedOrder: MaterialOrder = {
        ...target!,
        items: target!.items.map((it) =>
          String(it.product_id) === String(productId)
            ? {
                ...it,
                picked: false,
                picked_quantity: undefined,
                scanned_barcode: undefined,
                scanned_at: undefined,
              }
            : it
        ),
        updated_at: nowIso,
      };

      setOrders((prev) => prev.map((o) => (o.id === orderId ? updatedOrder : o)));

      const client = getClientSupabase(supabaseUrl, supabaseKey);
      if (client) {
        upsertOrderToSupabase(client, updatedOrder).catch((err) => {
          console.warn('Supabase sync unpicked order error:', err);
        });
      }
    },
    [orders, currentUser, userHasPermission, supabaseUrl, supabaseKey]
  );

  const toggleOrderItemPicked = useCallback(
    (orderId: string, productId: string | number) => {
      const target = orders.find((o) => o.id === orderId);
      if (!target) return;
      if (
        target.preparer_id &&
        String(target.preparer_id) !== String(currentUser?.id) &&
        !(
          Number(currentUser?.id) === 0 ||
          Number(currentUser?.role_id) === 0 ||
          Number(currentUser?.role_id) === 1 ||
          userHasPermission('perm_orders_manage')
        )
      ) {
        return;
      }

      const nowIso = new Date().toISOString();
      const updatedOrder: MaterialOrder = {
        ...target,
        items: target.items.map((it) =>
          String(it.product_id) === String(productId)
            ? { ...it, picked: !it.picked, scanned_at: nowIso }
            : it
        ),
        updated_at: nowIso,
      };

      setOrders((prev) => prev.map((o) => (o.id === orderId ? updatedOrder : o)));

      const client = getClientSupabase(supabaseUrl, supabaseKey);
      if (client) {
        upsertOrderToSupabase(client, updatedOrder).catch((err) => {
          console.warn('Supabase toggleOrderItemPicked sync error:', err);
        });
      }
    },
    [orders, currentUser, userHasPermission, supabaseUrl, supabaseKey]
  );

  const updateOrderItemAvailability = useCallback(
    (orderId: string, productId: string | number, unavailable: boolean, comment?: string) => {
      const target = orders.find((o) => o.id === orderId);
      if (!target) return;
      if (
        target.preparer_id &&
        String(target.preparer_id) !== String(currentUser?.id) &&
        !(
          Number(currentUser?.id) === 0 ||
          Number(currentUser?.role_id) === 0 ||
          Number(currentUser?.role_id) === 1 ||
          userHasPermission('perm_orders_manage')
        )
      ) {
        return;
      }

      const nowIso = new Date().toISOString();
      const updatedItems = target.items.map((it) => {
        if (String(it.product_id) === String(productId)) {
          return {
            ...it,
            unavailable,
            unavailable_comment:
              comment !== undefined
                ? comment
                : unavailable
                ? it.unavailable_comment || ''
                : '',
            scanned_at: nowIso,
          };
        }
        return it;
      });
      const updatedOrder: MaterialOrder = {
        ...target,
        items: updatedItems,
        updated_at: nowIso,
      };

      setOrders((prev) => prev.map((o) => (o.id === orderId ? updatedOrder : o)));

      const client = getClientSupabase(supabaseUrl, supabaseKey);
      if (client) {
        upsertOrderToSupabase(client, updatedOrder).catch((err) => {
          console.warn('Supabase updateOrderItemAvailability sync error:', err);
        });
      }
    },
    [orders, currentUser, userHasPermission, supabaseUrl, supabaseKey]
  );

  // Products CRUD
  const saveProduct = useCallback(
    async (
      productData: Partial<Product>,
      options?: { isNew?: boolean; editingId?: string | null }
    ) => {
      const ref = (productData.reference || '').trim();
      if (!ref) return false;

      // Strict RLS requirement: un utilisateur sans droit d'édition ne peut modifier que products.quantity
      const canEditAll =
        Number(currentUser?.id) === 0 ||
        Number(currentUser?.role_id) === 0 ||
        userHasPermission('perm_products_manage') ||
        userHasPermission('perm_products_edit') ||
        userHasPermission('perm_prod_edit');

      const editingId = options?.editingId ?? (options?.isNew ? null : productData.id || null);
      const existingProd = editingId
        ? products.find((p) => String(p.id).toLowerCase() === String(editingId).toLowerCase())
        : options?.isNew
          ? undefined
          : products.find(
              (p) =>
                String(p.id).toLowerCase() === String(productData.id || '').toLowerCase() ||
                String(p.reference).toLowerCase() === ref.toLowerCase()
            );

      const isNew = options?.isNew !== undefined ? options.isNew : !existingProd;

      if (!canEditAll) {
        if (isNew) {
          alert(
            "Accès refusé : Vos privilèges actuels ne vous permettent pas de créer de nouvelles références catalogue."
          );
          return false;
        }
        if (!existingProd) return false;

        const newQty =
          productData.quantity !== undefined ? productData.quantity : existingProd.quantity;
        const updatedProduct: Product = {
          ...existingProd,
          quantity: newQty,
        };

        setProducts((prev) => prev.map((p) => (p.id === updatedProduct.id ? updatedProduct : p)));

        const client = getClientSupabase(supabaseUrl, supabaseKey);
        if (client) {
          const res = await upsertProductToSupabase(client, updatedProduct, false);
          if (!res.success && res.error) {
            alert(res.error);
            return false;
          }
        }
        return true;
      }

      // Vérification stricte de l'unicité : Référence, Code-barres Fabricant, QR Code et Identification Fabricant (OEM)
      const uniqueness = validateProductIdentifiersUniqueness(productData, products, {
        isNew,
        editingId: existingProd?.id ?? editingId,
        language,
      });
      if (!uniqueness.valid) {
        return false;
      }

      // Check if license is expired or inactive
      if (
        license?.status === 'expired' ||
        (license?.expires_at && new Date(license.expires_at).getTime() < Date.now())
      ) {
        alert(
          `Votre licence (${(license?.plan_type || 'Gratuite').toUpperCase()}) est expirée depuis le ${
            license?.expires_at
              ? new Date(license.expires_at).toLocaleDateString('fr-FR')
              : 'terme de la période'
          }.\n\nVous ne pouvez plus créer de nouveaux articles. Vos données existantes restent consultables et exportables. Veuillez renouveler votre licence dans le menu Entreprise.`
        );
        return false;
      }

      if (license?.status === 'inactive') {
        alert(
          `Votre licence a été désactivée par l'administrateur. Veuillez contacter votre gestionnaire ou renouveler votre licence.`
        );
        return false;
      }

      // Quota check: if creating a new product and quota is reached (plafonds via plan_limits(plan))
      const maxAllowed = getPlanMaxReferences(license?.plan_type);
      if (isNew && products.length >= maxAllowed) {
        alert(
          `Limite de catalogue atteinte (${products.length}/${maxAllowed} articles).\n\nVotre forfait actuel (${(license?.plan_type || 'gratuit').toUpperCase()}) est limité à ${maxAllowed} articles.\nVeuillez activer une licence Standard, Pro ou Entreprise dans le menu Entreprise pour ajouter de nouveaux articles.`
        );
        return false;
      }

      const cleanBarcode = productData.barcode?.trim() || undefined;
      const cleanQrCode = productData.qr_code?.trim() || undefined;
      const cleanManufacturerRef = productData.manufacturer_ref?.trim() || '';

      const savedProduct: Product = existingProd
        ? ({
            ...existingProd,
            ...productData,
            reference: ref,
            manufacturer_ref: cleanManufacturerRef,
            barcode: cleanBarcode,
            qr_code: cleanQrCode,
            id: existingProd.id,
          } as Product)
        : {
            id: ref,
            reference: ref,
            brand: productData.brand || '',
            model: productData.model || '',
            manufacturer_ref: cleanManufacturerRef,
            barcode: cleanBarcode,
            qr_code: cleanQrCode,
            sub_category_id: productData.sub_category_id || null,
            unit_price: productData.unit_price || 0,
            description: productData.description || '',
            tags: productData.tags || '',
            supplier_1_name: productData.supplier_1_name || '',
            ref_supplier_1: productData.ref_supplier_1 || '',
            supplier_2_name: productData.supplier_2_name || '',
            ref_supplier_2: productData.ref_supplier_2 || '',
            store_name: productData.store_name || 'Dépôt Principal',
            room_name: productData.room_name || '',
            shelf_name: productData.shelf_name || '',
            quantity: productData.quantity || 0,
            min_stock_alert: productData.min_stock_alert || 2,
            created_at: new Date().toISOString(),
          };

      setProducts((prev) => {
        if (!isNew && existingProd) {
          const existingIdx = prev.findIndex((p) => p.id === existingProd.id);
          if (existingIdx !== -1) {
            const updated = [...prev];
            updated[existingIdx] = savedProduct;
            return updated;
          }
        }
        return [savedProduct, ...prev];
      });

      if (savedProduct) {
        const p = savedProduct;
        const isExisting = Boolean(existingProd && !isNew);
        logActivity({
          type: isExisting ? 'PRODUCT_UPDATED' : 'PRODUCT_CREATED',
          category: 'SYSTEM',
          title: isExisting
            ? tr(language, 'Mise à jour Article', 'Product Updated')
            : tr(language, 'Nouvel Article Créé', 'New Product Created'),
          description: `${p.brand} ${p.model} (${p.reference})`,
          user_name: currentUser?.name || 'Administrateur',
          user_trigram: currentUser?.trigram || 'ADM',
          product_id: p.id,
          product_ref: p.reference,
          depot_name: p.store_name,
          meta: { status: isExisting ? 'info' : 'success' },
        });

        const client = getClientSupabase(supabaseUrl, supabaseKey);
        if (client) {
          let res = await upsertProductToSupabase(client, savedProduct, true);
          if (
            !res.success &&
            res.error &&
            (res.error.toLowerCase().includes('quota') ||
              res.error.toLowerCase().includes('licence') ||
              res.error.toLowerCase().includes('license'))
          ) {
            await syncLicenseToClientDatabase(license, client).catch(() => {});
            res = await upsertProductToSupabase(client, savedProduct, true);
          }
          if (
            !res.success &&
            res.error &&
            !(
              products.length < maxAllowed &&
              (res.error.toLowerCase().includes('quota') ||
                res.error.toLowerCase().includes('licence') ||
                res.error.toLowerCase().includes('license'))
            )
          ) {
            alert(res.error);
          }
        }
      }
      return true;
    },
    [products, license, supabaseUrl, supabaseKey, currentUser, language, logActivity, userHasPermission]
  );

  const deleteProduct = useCallback(async (productId: string) => {
    if (!userHasPermission('perm_prod_delete') && Number(currentUser?.role_id) !== 0) {
      alert("Accès refusé : vous n'avez pas la permission de supprimer des références.");
      return false;
    }
    const targetProd = products.find((p) => p.id === productId);
    setProducts((prev) => prev.filter((p) => p.id !== productId));
    setActiveProductId(null);

    logActivity({
      type: 'PRODUCT_DELETED',
      category: 'SYSTEM',
      title: tr(language, 'Article Supprimé', 'Product Deleted'),
      description: targetProd ? `${targetProd.brand} ${targetProd.model} (${targetProd.reference})` : `Référence ${productId}`,
      user_name: currentUser?.name || 'Administrateur',
      user_trigram: currentUser?.trigram || 'ADM',
      product_id: productId,
      product_ref: targetProd?.reference,
      meta: { status: 'warning' },
    });

    const client = getClientSupabase(supabaseUrl, supabaseKey);
    if (client) {
      deleteProductFromSupabase(client, productId).catch((err) =>
        console.warn('Erreur delete product Supabase:', err)
      );
    }
    return true;
  }, [products, supabaseUrl, supabaseKey, userHasPermission, currentUser, language, logActivity]);

  // Inventory Reconciliation & Stock Adjustments
  const applyInventoryAdjustments = useCallback(
    async (
      adjustments: {
        productId: string;
        physicalCount: number;
        theoreticalQty: number;
        difference: number;
        reason?: string;
      }[]
    ) => {
      // Règle stricte (PDF Chapitre 5) : Séparation entre celui qui compte et celui qui valide les écarts
      const isSuperAdmin = Number(currentUser?.role_id) === 0 || Number(currentUser?.id) === 0;
      if (!isSuperAdmin && !userHasPermission('perm_inventory_validate')) {
        return {
          success: false,
          updatedCount: 0,
          message:
            tr(language, 'Action non autorisée : la validation des écarts et la régularisation de stock sont réservées aux responsables habilités (perm_inventory_validate).', 'Unauthorized: inventory validation and reconciliation is restricted to authorized managers (perm_inventory_validate).'),
        };
      }

      const activeAdjustments = adjustments.filter((a) => a.difference !== 0);
      if (activeAdjustments.length === 0) {
        return { success: true, updatedCount: 0, message: 'Aucun écart à régulariser.' };
      }

      const now = new Date().toISOString();
      const updatedMap = new Map<string, number>();
      const newMovements: StockMovement[] = [];

      for (const adj of activeAdjustments) {
        const prod = products.find((p) => p.id === adj.productId);
        if (!prod) continue;

        const newQty = Math.max(0, adj.physicalCount);
        updatedMap.set(adj.productId, newQty);

        const delta = Math.abs(adj.difference);
        const movType: MovementType = adj.difference > 0 ? 'IN' : 'OUT';

        newMovements.push({
          id: `mov-audit-${Date.now()}-${crypto.randomUUID()}`,
          product_id: adj.productId,
          product_ref: prod.reference,
          user_id: currentUser?.id || null,
          user_name: currentUser?.name || 'Inventaire Physique',
          movement_type: movType,
          quantity_changed: delta,
          site_number: 'INV-REGUL',
          department_name: adj.reason || 'Régularisation Inventaire',
          total_cost: delta * (prod.unit_price || 0),
          created_at: now,
        });
      }

      // Update products state
      setProducts((prev) =>
        prev.map((p) => {
          if (updatedMap.has(p.id)) {
            return { ...p, quantity: updatedMap.get(p.id)! };
          }
          return p;
        })
      );

      // Add movements
      setMovements((prev) => [...newMovements, ...prev]);

      logActivity({
        type: 'INVENTORY_AUDIT',
        category: 'SYSTEM',
        title: tr(language, 'Comptage d\'Inventaire Régularisé', 'Inventory Audit Adjusted'),
        description: `${newMovements.length} article(s) régularisé(s) en base suite au comptage physique`,
        user_name: currentUser?.name || 'Inventaire Physique',
        user_trigram: currentUser?.trigram || 'INV',
        meta: {
          status: 'success',
          difference: newMovements.length,
          reason: 'Régularisation automatique des écarts',
        },
      });

      // Push to Supabase if connected
      const client = getClientSupabase(supabaseUrl, supabaseKey);
      if (client) {
        for (const mov of newMovements) {
          const newQty = updatedMap.get(mov.product_id);
          pushMovementToSupabase(client, mov, newQty).catch((err) =>
            console.warn('Erreur envoi régularisation Supabase:', err)
          );
        }

        recordInventoryAuditToSupabase(client, {
          depot_name: currentUser?.department || 'Inventaire Principal',
          auditor_id: currentUser?.id,
          auditor_name: currentUser?.name || 'Inventaire Physique',
          items_counted: adjustments.length,
          items_with_diff: activeAdjustments.length,
          total_diff_cost: newMovements.reduce((sum, m) => sum + (m.total_cost || 0), 0),
          audit_notes: `${activeAdjustments.length} article(s) régularisé(s)`,
          items: activeAdjustments.map((adj) => {
            const prod = products.find((p) => p.id === adj.productId);
            return {
              product_id: adj.productId,
              product_ref: prod?.reference || adj.productId,
              product_name: prod?.model || prod?.reference,
              theoretical_qty: adj.theoreticalQty,
              physical_count: adj.physicalCount,
              difference: adj.difference,
              unit_price: prod?.unit_price || 0,
              diff_cost: Math.abs(adj.difference) * (prod?.unit_price || 0),
              scanned_barcode: prod?.barcode,
            };
          }),
        }).catch((err) => console.warn('Supabase recordInventoryAudit error:', err));
      }

      return {
        success: true,
        updatedCount: newMovements.length,
        message: `${newMovements.length} article(s) régularisé(s) en stock avec succès !`,
      };
    },
    [products, currentUser, userHasPermission, supabaseUrl, supabaseKey, language, logActivity]
  );

  // Departments CRUD
  const saveDepartment = useCallback(async (dep: Partial<Department>) => {
    const name = dep.name?.trim();
    if (!name) return false;
    const savedDep: Department = {
      ...dep,
      id: dep.id || Date.now(),
      name,
      manager_id: dep.manager_id || null,
      deputy_manager_ids: dep.deputy_manager_ids || [],
      allow_global_kpis: Boolean(dep.allow_global_kpis),
    };
    setDepartments((prev) =>
      dep.id ? prev.map((d) => (d.id === dep.id ? savedDep : d)) : [...prev, savedDep]
    );

    const client = getClientSupabase(supabaseUrl, supabaseKey);
    if (client) {
      upsertDepartmentToSupabase(client, savedDep).catch((err) =>
        console.warn('Erreur upsert department Supabase:', err)
      );
    }
    return true;
  }, [supabaseUrl, supabaseKey]);

  const deleteDepartment = useCallback(async (id: number) => {
    if (!userHasPermission('perm_dep_delete')) {
      console.warn("Accès refusé : vous n'avez pas la permission de supprimer des départements.");
      return false;
    }
    setDepartments((prev) => prev.filter((d) => d.id !== id));
    const client = getClientSupabase(supabaseUrl, supabaseKey);
    if (client) {
      deleteDepartmentFromSupabase(client, id).catch((err) =>
        console.warn('Erreur delete department Supabase:', err)
      );
    }
    return true;
  }, [supabaseUrl, supabaseKey, userHasPermission]);

  // Projects CRUD
  const saveProject = useCallback(async (proj: Partial<Project>) => {
    const project_number = proj.project_number?.trim();
    const project_name = proj.project_name?.trim();
    if (!project_number || !project_name) return false;
    const savedProj: Project = {
      ...proj,
      id: proj.id || Date.now(),
      department_id: proj.department_id || 1,
      project_number,
      project_name,
      manager_id: proj.manager_id || null,
      deputy_manager_ids: proj.deputy_manager_ids || [],
    };
    setProjects((prev) =>
      proj.id ? prev.map((p) => (p.id === proj.id ? savedProj : p)) : [...prev, savedProj]
    );

    const client = getClientSupabase(supabaseUrl, supabaseKey);
    if (client) {
      upsertProjectToSupabase(client, savedProj).catch((err) =>
        console.warn('Erreur upsert project Supabase:', err)
      );
    }
    return true;
  }, [supabaseUrl, supabaseKey]);

  const deleteProject = useCallback(async (id: number) => {
    if (!userHasPermission('perm_proj_delete')) {
      console.warn("Accès refusé : vous n'avez pas la permission de supprimer des chantiers.");
      return false;
    }
    setProjects((prev) => prev.filter((p) => p.id !== id));
    const client = getClientSupabase(supabaseUrl, supabaseKey);
    if (client) {
      deleteProjectFromSupabase(client, id).catch((err) =>
        console.warn('Erreur delete project Supabase:', err)
      );
    }
    return true;
  }, [supabaseUrl, supabaseKey, userHasPermission]);

  // Roles CRUD
  const saveRole = useCallback(async (role: Partial<Role>) => {
    const name = role.name?.trim();
    if (!name) return false;
    const hasId = role.id !== undefined && role.id !== null;
    const savedRole: Role = {
      ...role,
      id: hasId ? role.id! : Date.now(),
      name,
      permissions: role.permissions || [],
    };
    setRoles((prev) =>
      hasId ? prev.map((r) => (r.id === role.id ? savedRole : r)) : [...prev, savedRole]
    );

    const client = getClientSupabase(supabaseUrl, supabaseKey);
    if (client) {
      upsertRoleToSupabase(client, savedRole).catch((err) =>
        console.warn('Erreur upsert role Supabase:', err)
      );
    }
    return true;
  }, [supabaseUrl, supabaseKey]);

  const deleteRole = useCallback(async (id: number) => {
    if (Number(id) === 0) return false; // Prevent super role deletion
    setRoles((prev) => prev.filter((r) => r.id !== id));
    const client = getClientSupabase(supabaseUrl, supabaseKey);
    if (client) {
      deleteRoleFromSupabase(client, id).catch((err) =>
        console.warn('Erreur delete role Supabase:', err)
      );
    }
    return true;
  }, [supabaseUrl, supabaseKey]);

  const resetRolesToRecommended = useCallback(async () => {
    const freshRoles = RECOMMENDED_ROLES_SPEC.map((r) => ({
      ...r,
      permissions: [...r.permissions],
    }));
    setRoles(freshRoles);
    try {
      localStorage.setItem(`${LOCAL_PREFIX}roles`, JSON.stringify(freshRoles));
    } catch (e) {
      console.warn('Erreur localStorage roles:', e);
    }
    const client = getClientSupabase(supabaseUrl, supabaseKey);
    if (client) {
      for (const recRole of freshRoles) {
        await upsertRoleToSupabase(client, recRole).catch((err) =>
          console.warn('Erreur upsert role Supabase:', err)
        );
      }
    }
    logActivity({
      type: 'USER_ACTION',
      category: 'SYSTEM',
      title: tr(language, 'Rôles réinitialisés aux recommandations', 'Roles reset to recommendations'),
      description: 'L\'ensemble des 11 rôles a été rétabli selon les préconisations du document.',
      user_name: currentUser?.name || 'Administrateur',
      user_trigram: currentUser?.trigram || 'ADM',
      meta: { details: `Nombre de rôles: ${freshRoles.length}` },
    });
    return true;
  }, [supabaseUrl, supabaseKey, language, logActivity, currentUser]);

  // Users CRUD via Edge Function admin-users (with direct DB fallback)
  const saveUser = useCallback(
    async (userData: Partial<User>, rawPassword?: string) => {
      if (!userData.name?.trim()) return { success: false, message: 'Le nom est requis.' };

      const client = getClientSupabase(supabaseUrl, supabaseKey);
      if (client) {
        if (userData.id !== undefined && userData.id !== null) {
          // Update user
          const res = await adminUpdateUser(client, {
            id: userData.id,
            name: userData.name,
            trigram: userData.trigram,
            email: userData.email,
            department: userData.department,
            role_id: userData.role_id,
            allowed_depots: userData.allowed_depots,
            is_preparer: userData.is_preparer,
            must_change_pin: userData.must_change_pin,
          });

          if (!res.success) {
            return { success: false, message: res.error || 'Erreur lors de la mise à jour.' };
          }

          setUsers((prev) =>
            prev.map((u) => {
              if (String(u.id) !== String(userData.id)) return u;
              const merged: User = {
                ...u,
                ...(res.user || {}),
                name: userData.name !== undefined ? userData.name.trim() : u.name,
                trigram: userData.trigram !== undefined ? userData.trigram.toUpperCase() : u.trigram,
                email: userData.email !== undefined ? userData.email.trim() : u.email,
                department: userData.department !== undefined ? userData.department : u.department,
                role_id: userData.role_id !== undefined ? Number(userData.role_id) : u.role_id,
                allowed_depots: userData.allowed_depots !== undefined ? userData.allowed_depots : u.allowed_depots,
                is_preparer: userData.is_preparer !== undefined ? Boolean(userData.is_preparer) : u.is_preparer,
                must_change_pin: userData.must_change_pin !== undefined ? Boolean(userData.must_change_pin) : u.must_change_pin,
                binome_id: userData.binome_id !== undefined ? userData.binome_id : u.binome_id,
                binome_name: userData.binome_name !== undefined ? userData.binome_name : u.binome_name,
              };
              if (currentUser && String(currentUser.id) === String(merged.id)) {
                setCurrentUser(merged);
              }
              return merged;
            })
          );
          return { success: true };
        } else {
          // Create user
          if (!userData.email?.trim()) {
            return { success: false, message: 'L\'adresse e-mail est obligatoire pour créer un compte utilisateur.' };
          }
          const res = await adminCreateUser(client, {
            email: userData.email.trim(),
            name: userData.name.trim(),
            trigram: userData.trigram,
            department: userData.department,
            role_id: userData.role_id,
            allowed_depots: userData.allowed_depots,
            is_preparer: userData.is_preparer,
            initialPassword: rawPassword,
          });

          if (!res.success) {
            return { success: false, message: res.error || 'Erreur lors de la création.' };
          }

          if (res.user) {
            const created = res.user;
            setUsers((prev) => [...prev, created]);
          }
          return {
            success: true,
            message: res.temporary_password
              ? `Utilisateur créé avec succès ! Mot de passe temporaire : ${res.temporary_password}`
              : 'Utilisateur créé avec succès.',
          };
        }
      }

      // Demo local fallback
      const savedUser: User = {
        id: userData.id ?? Date.now(),
        name: userData.name!.trim(),
        trigram: userData.trigram || 'USR',
        email: userData.email || '',
        department: userData.department || 'Général',
        role_id: userData.role_id || 3,
        is_blocked: false,
        allowed_depots: userData.allowed_depots || ['*'],
        must_change_pin: Boolean(userData.must_change_pin),
        is_preparer: Boolean(userData.is_preparer),
        binome_id: userData.binome_id !== undefined ? userData.binome_id : null,
        binome_name: userData.binome_name !== undefined ? userData.binome_name : null,
      };
      setUsers((prev) => [...prev.filter((u) => String(u.id) !== String(savedUser.id)), savedUser]);
      return { success: true };
    },
    [supabaseUrl, supabaseKey, currentUser]
  );

  const deleteUser = useCallback(
    async (id: string | number) => {
      if (Number(id) === 0) return false;
      if (!userHasPermission('perm_user_delete')) {
        alert("Accès refusé : vous n'avez pas la permission de supprimer des utilisateurs.");
        return false;
      }
      try {
        const rawDel = localStorage.getItem('tot_deleted_user_ids');
        const list: string[] = rawDel ? JSON.parse(rawDel) : [];
        const nextDel = Array.from(new Set([...list, String(id)]));
        localStorage.setItem('tot_deleted_user_ids', JSON.stringify(nextDel));
      } catch {}

      let nextUsersList: User[] = [];
      setUsers((prev) => {
        nextUsersList = prev.filter((u) => String(u.id) !== String(id));
        return nextUsersList;
      });

      const client = getClientSupabase(supabaseUrl, supabaseKey);
      if (client) {
        adminDeleteUser(client, id).catch(() => {});
        mirrorUsersDirectoryToSettings(client, nextUsersList).catch(() => {});
      }
      return true;
    },
    [supabaseUrl, supabaseKey, userHasPermission]
  );

  const toggleBlockUser = useCallback(
    async (id: string | number) => {
      if (Number(id) === 0) return false;
      const target = users.find((u) => String(u.id) === String(id));
      if (!target) return false;
      const nextBlocked = !target.is_blocked;

      const client = getClientSupabase(supabaseUrl, supabaseKey);
      if (client) {
        const res = await adminToggleBlockUser(client, id, nextBlocked);
        if (!res.success) {
          alert(res.error || 'Erreur blocage utilisateur.');
          return false;
        }
      }

      setUsers((prev) =>
        prev.map((u) => (String(u.id) === String(id) ? { ...u, is_blocked: nextBlocked } : u))
      );
      return true;
    },
    [supabaseUrl, supabaseKey, users]
  );

  // Categories CRUD
  const saveSubCategory = useCallback(async (name: string, id?: number) => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    const catId = id || Date.now();
    const updatedCat: SubCategory = { id: catId, name: trimmed };
    setSubCategories((prev) => {
      const exists = prev.some((s) => s.id === catId);
      if (exists) {
        return prev.map((s) => (s.id === catId ? updatedCat : s));
      }
      return [...prev, updatedCat];
    });
    const client = getClientSupabase(supabaseUrl, supabaseKey);
    if (client) {
      upsertSubCategoryToSupabase(client, updatedCat).catch((err) =>
        console.warn('Erreur upsert subcategory Supabase:', err)
      );
    }
    return true;
  }, [supabaseUrl, supabaseKey]);

  const deleteSubCategory = useCallback(async (id: number) => {
    setSubCategories((prev) => prev.filter((s) => s.id !== id));
    const client = getClientSupabase(supabaseUrl, supabaseKey);
    if (client) {
      deleteSubCategoryFromSupabase(client, id).catch((err) =>
        console.warn('Erreur delete subcategory Supabase:', err)
      );
    }
    return true;
  }, [supabaseUrl, supabaseKey]);

  const maxDepots = useMemo(
    () => Math.max(Number(license?.max_depots) || 0, getMaxDepotsForPlan(license?.plan_type)),
    [license?.max_depots, license?.plan_type]
  );

  const saveDepot = useCallback(
    async (depotData: Partial<Depot> & { name: string }) => {
      const cleanName = depotData.name.trim();
      if (!cleanName) {
        return { success: false, message: 'Le nom du magasin / dépôt est requis.' };
      }

      // Check for duplicate name
      const duplicateName = depots.find(
        (d) =>
          d.name.toLowerCase() === cleanName.toLowerCase() &&
          (depotData.id === undefined || String(d.id) !== String(depotData.id))
      );
      if (duplicateName) {
        return {
          success: false,
          message: `Un magasin ou dépôt portant le nom "${cleanName}" existe déjà.`,
        };
      }

      const existingIndex =
        depotData.id !== undefined
          ? depots.findIndex((d) => String(d.id) === String(depotData.id))
          : -1;

      // If it's a NEW depot (or reactivating an existing inactive one), enforce license quota on ACTIVE depots
      const activeDepotsCount = depots.filter((d) => d.is_active !== false).length;
      const willBeActive = depotData.is_active !== false;
      const isExistingInactive = existingIndex >= 0 && depots[existingIndex].is_active === false;

      if ((existingIndex === -1 || isExistingInactive) && willBeActive && activeDepotsCount >= maxDepots) {
        const planTier = PLAN_TIERS[license?.plan_type || 'free'];
        const planName = planTier?.name || 'actuel';
        return {
          success: false,
          message: `Limite de licence atteinte : votre forfait ${planName} est limité à ${maxDepots} magasin(s)/dépôt(s) actif(s). Mettez à niveau votre licence pour en ajouter plus.`,
        };
      }

      // Check if deactivating a depot is allowed by the license plan
      if (depotData.is_active === false) {
        const plan = normalizeToCanonicalPlan(license?.plan || license?.plan_type, license?.license_key);
        if (plan === 'free') {
          return {
            success: false,
            message:
              `La mise en veille / fermeture temporaire d’un magasin ou dépôt est disponible à partir du forfait ${PLAN_LABELS.sta} (3 dépôts, gestion chantiers). Passez au forfait ${PLAN_LABELS.sta} pour utiliser cette fonctionnalité.`,
          };
        }
      }

      let updatedDepot: Depot;
      if (existingIndex >= 0) {
        const oldDepot = depots[existingIndex];
        updatedDepot = {
          ...oldDepot,
          ...depotData,
          name: cleanName,
          type: depotData.type || oldDepot.type || 'FIXED',
          vehicle_type: depotData.vehicle_type !== undefined ? depotData.vehicle_type : oldDepot.vehicle_type,
          license_plate: depotData.license_plate !== undefined ? depotData.license_plate : oldDepot.license_plate,
          manager_id: depotData.manager_id !== undefined ? depotData.manager_id : oldDepot.manager_id,
          manager_name: depotData.manager_name !== undefined ? depotData.manager_name : oldDepot.manager_name,
          binome_ids: depotData.binome_ids !== undefined ? depotData.binome_ids : oldDepot.binome_ids,
          binome_names: depotData.binome_names !== undefined ? depotData.binome_names : oldDepot.binome_names,
          department_id: depotData.department_id !== undefined ? depotData.department_id : oldDepot.department_id,
          department_name: depotData.department_name !== undefined ? depotData.department_name : oldDepot.department_name,
          is_active: depotData.is_active !== undefined ? depotData.is_active : (oldDepot.is_active ?? true),
          updated_at: new Date().toISOString(),
        };

        // If depot was renamed, update linked products' store_name
        if (oldDepot.name.toLowerCase() !== cleanName.toLowerCase()) {
          const client = getClientSupabase(supabaseUrl, supabaseKey);
          setProducts((prev) =>
            prev.map((p) => {
              if (p.store_name?.toLowerCase() === oldDepot.name.toLowerCase()) {
                const upd = { ...p, store_name: cleanName };
                if (client) {
                  upsertProductToSupabase(client, upd).catch((err) =>
                    console.warn('Erreur renommage dépôt sur produit Supabase:', err)
                  );
                }
                return upd;
              }
              return p;
            })
          );
        }

        setDepots((prev) => prev.map((d, i) => (i === existingIndex ? updatedDepot : d)));
      } else {
        updatedDepot = {
          id: depotData.id || Date.now(),
          name: cleanName,
          code: depotData.code?.trim() || `DEP-${String(depots.length + 1).padStart(2, '0')}`,
          address: depotData.address?.trim() || '',
          description: depotData.description?.trim() || '',
          type: depotData.type || 'FIXED',
          vehicle_type: depotData.vehicle_type?.trim() || undefined,
          license_plate: depotData.license_plate?.trim() || undefined,
          manager_id: depotData.manager_id || null,
          manager_name: depotData.manager_name || null,
          binome_ids: depotData.binome_ids || [],
          binome_names: depotData.binome_names || [],
          department_id: depotData.department_id || null,
          department_name: depotData.department_name || null,
          pickup_zones: depotData.pickup_zones || [],
          is_active: depotData.is_active ?? true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        setDepots((prev) => [...prev, updatedDepot]);
      }

      const client = getClientSupabase(supabaseUrl, supabaseKey);
      let supabaseFeedback = '';

      if (client) {
        let syncRes = await upsertDepotToSupabase(client, updatedDepot);
        if (
          !syncRes.success &&
          syncRes.error &&
          (syncRes.error.toLowerCase().includes('quota') ||
            syncRes.error.toLowerCase().includes('licence') ||
            syncRes.error.toLowerCase().includes('license'))
        ) {
          // Resynchroniser automatiquement la table license_config client avec la licence active puis réessayer
          await syncLicenseToClientDatabase(license, client).catch(() => {});
          syncRes = await upsertDepotToSupabase(client, updatedDepot);
        }

        if (syncRes.success) {
          if (syncRes.inserted && syncRes.inserted.id) {
            const dbId = syncRes.inserted.id;
            updatedDepot.id = dbId;
            setDepots((prev) =>
              prev.map((d) => (d.name.toLowerCase() === cleanName.toLowerCase() ? { ...d, id: dbId } : d))
            );
          }
          supabaseFeedback = ` • Synchro SQL Supabase OK (${syncRes.table})`;
        } else if (
          syncRes.error &&
          (syncRes.error.toLowerCase().includes('quota') ||
            syncRes.error.toLowerCase().includes('licence') ||
            syncRes.error.toLowerCase().includes('license'))
        ) {
          // Si le quota vérifié par la licence de l'entreprise est bien respecté (activeDepotsCount < maxDepots),
          // ne pas bloquer l'utilisateur à cause d'une table license_config ancienne verrouillée en lecture seule
          if (activeDepotsCount >= maxDepots && existingIndex === -1) {
            setDepots((prev) => prev.filter((d) => d.name.toLowerCase() !== cleanName.toLowerCase()));
            return {
              success: false,
              message: `Rejet par la base de données (Modèle B) : ${syncRes.error}`,
            };
          }
          supabaseFeedback = ` • Enregistré (quota licence ${license?.plan_type?.toUpperCase() || 'PRO'} : ${maxDepots} dépôts validé)`;
        } else if (syncRes.isNetworkError) {
          supabaseFeedback = ` • ⚠️ Serveur Supabase inaccessible (Failed to fetch). Dépôt conservé localement.`;
        } else if (syncRes.isTableMissing) {
          supabaseFeedback = ` • ⚠️ Table SQL "${syncRes.table || 'depots'}" inexistante dans Supabase. Exécutez le script SQL fourni dans "Magasins & Dépôts".`;
        } else {
          supabaseFeedback = ` • ⚠️ Note Supabase : ${syncRes.error}`;
        }
      } else {
        supabaseFeedback = ` (Stocké localement - Supabase non connecté)`;
      }

      return {
        success: true,
        message: `Dépôt "${cleanName}" enregistré avec succès !${supabaseFeedback}`,
        depot: updatedDepot,
      };
    },
    [depots, maxDepots, license, supabaseUrl, supabaseKey]
  );

  const deleteDepot = useCallback(
    async (id: string | number, reassignToDepotName?: string) => {
      const target = depots.find((d) => String(d.id) === String(id));
      if (!target) return { success: false, message: 'Dépôt introuvable.' };

      // Check if products are tied to this depot
      const affectedProducts = products.filter(
        (p) => p.store_name?.toLowerCase() === target.name.toLowerCase()
      );

      if (affectedProducts.length > 0 && reassignToDepotName === undefined) {
        return {
          success: false,
          message: `Impossible de supprimer "${target.name}" : ${affectedProducts.length} référence(s) y sont rattachée(s).`,
        };
      }

      // Reassign or detach affected products
      if (affectedProducts.length > 0 && reassignToDepotName !== undefined) {
        const client = getClientSupabase(supabaseUrl, supabaseKey);
        setProducts((prev) =>
          prev.map((p) => {
            if (p.store_name?.toLowerCase() === target.name.toLowerCase()) {
              const updated = { ...p, store_name: reassignToDepotName };
              if (client) {
                upsertProductToSupabase(client, updated).catch((err) =>
                  console.warn('Erreur réassignation produit Supabase:', err)
                );
              }
              return updated;
            }
            return p;
          })
        );
      }

      setDepots((prev) => prev.filter((d) => String(d.id) !== String(id)));
      const client = getClientSupabase(supabaseUrl, supabaseKey);
      if (client) {
        deleteDepotFromSupabase(client, id, target.name).catch((err) =>
          console.warn('Erreur delete depot Supabase:', err)
        );
      }

      return {
        success: true,
        message: `Dépôt "${target.name}" supprimé avec succès.${
          affectedProducts.length > 0
            ? ` (${affectedProducts.length} référence(s) ${reassignToDepotName ? `transférée(s) vers « ${reassignToDepotName} »` : 'détachée(s)'})`
            : ''
        }`,
      };
    },
    [depots, products, supabaseUrl, supabaseKey]
  );

  const toggleDepotStatus = useCallback(
    async (id: string | number) => {
      const target = depots.find((d) => String(d.id) === String(id));
      if (!target) return { success: false, message: 'Magasin / Dépôt introuvable.' };

      const plan = license?.plan_type || 'free';
      const canToggle = plan !== 'free';
      const currentlyActive = target.is_active !== false;
      const nextActive = !currentlyActive;

      // Restrict temporary closure / suspension to Standard, Pro, Entreprise
      if (!nextActive && !canToggle) {
        return {
          success: false,
          message:
            'La fermeture temporaire / mise en veille d’un magasin ou dépôt est disponible à partir du forfait STANDARD (3 dépôts et gestion de chantiers).',
        };
      }

      const res = await saveDepot({
        ...target,
        is_active: nextActive,
      });

      if (res.success) {
        return {
          success: true,
          is_active: nextActive,
          message: nextActive
            ? `Le magasin « ${target.name} » a été réactivé avec succès. Ses outils sont à nouveau disponibles dans la recherche pour tous.`
            : `Le magasin « ${target.name} » est fermé temporairement. Ses outils sont désormais indisponibles dans la recherche pour les utilisateurs standards (opérateurs).`,
        };
      }
      return res;
    },
    [depots, license, saveDepot]
  );

  const syncDepotsWithSupabase = useCallback(async () => {
    const client = getClientSupabase(supabaseUrl, supabaseKey);
    return await syncAllDepotsToSupabase(client, depots);
  }, [supabaseUrl, supabaseKey, depots]);

  const testSupabaseDepotsTable = useCallback(async () => {
    const client = getClientSupabase(supabaseUrl, supabaseKey);
    return await checkDepotTableInSupabase(client);
  }, [supabaseUrl, supabaseKey]);

  const contextValue = useMemo<AppContextType>(
    () => ({
      currentUser,
      theme,
      toggleTheme,
      activeTab,
      setActiveTab,
      products,
      movements,
      roles,
      users: visibleUsers,
      allUsers: users,
      visibleUsers,
      departments,
      projects: visibleProjects,
      allProjects: projects,
      visibleProjects,
      subCategories,
      depots,
      batchCart,
      loginModalOpen,
      setLoginModalOpen,
      profileModalOpen,
      setProfileModalOpen,
      activeProductId,
      setActiveProductId,
      productFormState,
      setProductFormState,
      scanState,
      setScanState,
      batchCartModalOpen,
      setBatchCartModalOpen,
      actionSheetOpen,
      setActionSheetOpen,
      departmentsProjectsModal,
      setDepartmentsProjectsModal,
      usersRolesModal,
      setUsersRolesModal,
      categoriesModalOpen,
      setCategoriesModalOpen,
      depotsModalOpen,
      setDepotsModalOpen,
      emailReportsModalOpen,
      setEmailReportsModalOpen,
      smtpSettingsModalOpen,
      setSmtpSettingsModalOpen,
      companySetupModalOpen,
      setCompanySetupModalOpen,
      qrConfigGenModalOpen,
      setQrConfigGenModalOpen,
      appInfoModalOpen,
      setAppInfoModalOpen,
      releaseNotesModalOpen,
      setReleaseNotesModalOpen,
      notificationsModalOpen,
      setNotificationsModalOpen,
      printLabelsModal,
      setPrintLabelsModal,
      printStationModalOpen,
      setPrintStationModalOpen,
      inventoryAuditModalOpen,
      setInventoryAuditModalOpen,
      diagnosticModalOpen,
      setDiagnosticModalOpen,
      inventoryAuditTargetDepot,
      setInventoryAuditTargetDepot,
      openInventoryAuditForDepot,
      applyInventoryAdjustments,
      storedActivities,
      logActivity,
      clearActivities,
      supabaseUrl,
      supabaseKey,
      supabaseConfig,
      saveSupabaseConfig,
      pendingScannedConfig,
      setPendingScannedConfig,
      resetToDemoData,
      isSupabaseConnected,
      supabaseSyncStatus,
      supabaseSyncMessage,
      syncFromSupabase,
      exportToSupabase,
      testConnection,
      appLogoUrl,
      releaseNotes,
      refreshReleaseNotes,
      settings,
      updateSetting,
      login,
      resetUserPinOnLogin,
      requestPasswordReset,
      verifyPasswordResetOtp,
      passwordRecoveryMode,
      setPasswordRecoveryMode,
      logout,
      wipeDeviceAndSignOut,
      updateUserPIN,
      userHasPermission,
      canViewPrices,
      saveProduct,
      deleteProduct,
      addToCart,
      updateCartQty,
      removeFromCart,
      clearCart,
      confirmBatchMovements,
      orders,
      orderCart,
      orderBaskets,
      activeOrderBasketId,
      setActiveOrderBasketId,
      createOrderBasket,
      deleteOrderBasket,
      renameOrderBasket,
      duplicateOrderBasket,
      moveOrderBasket,
      updateOrderBasketSite,
      updateOrderBasket,
      switchAndAddOrderBasket,
      addToOrderCart,
      updateOrderCartQty,
      removeFromOrderCart,
      clearOrderCart,
      submitMaterialOrder,
      assignOrderToMe,
      markOrderReady,
      markOrderCollected,
      updateMaterialOrder,
      substituteOrderItem,
      canApproveOrder,
      approveOrder,
      rejectOrder,
      cancelOrder,
      deleteMaterialOrder,
      transferOrderPickup,
      validateOrderItemScanned,
      unpickOrderItem,
      toggleOrderItemPicked,
      updateOrderItemAvailability,
      isPreparer,
      isAdmin,
      isDepartmentManager,
      isDepartmentManagerOrDeputy,
      canViewCrossDepartment,
      canUserViewProject,
      canUserViewUser,
      canViewArticleHistory,
      orderCartModalOpen,
      setOrderCartModalOpen,
      preparerOrdersModalOpen,
      setPreparerOrdersModalOpen,
      scannerPickingModeOpen,
      setScannerPickingModeOpen,
      scannerInitialOrderId,
      openScannerPickingMode,
      saveDepartment,
      deleteDepartment,
      saveProject,
      deleteProject,
      saveRole,
      deleteRole,
      resetRolesToRecommended,
      saveUser,
      deleteUser,
      toggleBlockUser,
      saveSubCategory,
      deleteSubCategory,
      maxDepots,
      saveDepot,
      deleteDepot,
      toggleDepotStatus,
      syncDepotsWithSupabase,
      testSupabaseDepotsTable,
      language,
      setLanguage,
      toggleLanguage,
      t,
      autoLogoutMinutes,
      setAutoLogoutMinutes,
      currency,
      setCurrency,
      documentationModalOpen,
      setDocumentationModalOpen,
      license,
      verifyLicense,
      provisionLicense,
      upgradePlan,
      updateContactEmail,
      removeLicense,
      syncLicenseWithServer,
      daysUntilNextCheck,
      licenseNotification,
      dismissLicenseNotification,
      appCompat,
      recheckAppCompat,
    }),
    [
      currentUser,
      pendingScannedConfig,
      autoLogoutMinutes,
      setAutoLogoutMinutes,
      currency,
      setCurrency,
      documentationModalOpen,
      setDocumentationModalOpen,
      license,
      verifyLicense,
      provisionLicense,
      upgradePlan,
      updateContactEmail,
      removeLicense,
      syncLicenseWithServer,
      daysUntilNextCheck,
      licenseNotification,
      dismissLicenseNotification,
      appCompat,
      recheckAppCompat,
      theme,
      toggleTheme,
      activeTab,
      products,
      movements,
      roles,
      users,
      visibleUsers,
      departments,
      projects,
      visibleProjects,
      subCategories,
      depots,
      batchCart,
      loginModalOpen,
      profileModalOpen,
      activeProductId,
      productFormState,
      scanState,
      batchCartModalOpen,
      actionSheetOpen,
      departmentsProjectsModal,
      usersRolesModal,
      categoriesModalOpen,
      depotsModalOpen,
      emailReportsModalOpen,
      smtpSettingsModalOpen,
      companySetupModalOpen,
      setCompanySetupModalOpen,
      qrConfigGenModalOpen,
      setQrConfigGenModalOpen,
      appInfoModalOpen,
      setAppInfoModalOpen,
      releaseNotesModalOpen,
      setReleaseNotesModalOpen,
      notificationsModalOpen,
      setNotificationsModalOpen,
      printLabelsModal,
      setPrintLabelsModal,
      printStationModalOpen,
      setPrintStationModalOpen,
      inventoryAuditModalOpen,
      setInventoryAuditModalOpen,
      diagnosticModalOpen,
      setDiagnosticModalOpen,
      inventoryAuditTargetDepot,
      openInventoryAuditForDepot,
      applyInventoryAdjustments,
      setActiveTab,
      setLoginModalOpen,
      setProfileModalOpen,
      setActiveProductId,
      setProductFormState,
      setScanState,
      setBatchCartModalOpen,
      setActionSheetOpen,
      setDepartmentsProjectsModal,
      setUsersRolesModal,
      setCategoriesModalOpen,
      setDepotsModalOpen,
      setEmailReportsModalOpen,
      setSmtpSettingsModalOpen,
      supabaseUrl,
      supabaseKey,
      supabaseConfig,
      saveSupabaseConfig,
      resetToDemoData,
      isSupabaseConnected,
      supabaseSyncStatus,
      supabaseSyncMessage,
      syncFromSupabase,
      exportToSupabase,
      testConnection,
      appLogoUrl,
      releaseNotes,
      refreshReleaseNotes,
      settings,
      updateSetting,
      login,
      resetUserPinOnLogin,
      requestPasswordReset,
      verifyPasswordResetOtp,
      passwordRecoveryMode,
      setPasswordRecoveryMode,
      logout,
      wipeDeviceAndSignOut,
      updateUserPIN,
      userHasPermission,
      saveProduct,
      deleteProduct,
      addToCart,
      updateCartQty,
      removeFromCart,
      clearCart,
      confirmBatchMovements,
      orders,
      orderCart,
      orderBaskets,
      activeOrderBasketId,
      setActiveOrderBasketId,
      createOrderBasket,
      deleteOrderBasket,
      renameOrderBasket,
      duplicateOrderBasket,
      moveOrderBasket,
      updateOrderBasketSite,
      updateOrderBasket,
      switchAndAddOrderBasket,
      addToOrderCart,
      updateOrderCartQty,
      removeFromOrderCart,
      clearOrderCart,
      submitMaterialOrder,
      assignOrderToMe,
      markOrderReady,
      markOrderCollected,
      updateMaterialOrder,
      substituteOrderItem,
      canApproveOrder,
      approveOrder,
      rejectOrder,
      cancelOrder,
      deleteMaterialOrder,
      transferOrderPickup,
      validateOrderItemScanned,
      unpickOrderItem,
      toggleOrderItemPicked,
      updateOrderItemAvailability,
      isPreparer,
      isAdmin,
      isDepartmentManager,
      isDepartmentManagerOrDeputy,
      canViewCrossDepartment,
      canUserViewProject,
      canUserViewUser,
      canViewArticleHistory,
      orderCartModalOpen,
      setOrderCartModalOpen,
      preparerOrdersModalOpen,
      setPreparerOrdersModalOpen,
      scannerPickingModeOpen,
      setScannerPickingModeOpen,
      scannerInitialOrderId,
      openScannerPickingMode,
      saveDepartment,
      deleteDepartment,
      saveProject,
      deleteProject,
      saveRole,
      deleteRole,
      resetRolesToRecommended,
      saveUser,
      deleteUser,
      toggleBlockUser,
      saveSubCategory,
      deleteSubCategory,
      maxDepots,
      saveDepot,
      deleteDepot,
      toggleDepotStatus,
      syncDepotsWithSupabase,
      testSupabaseDepotsTable,
      language,
      setLanguage,
      toggleLanguage,
      t,
      canViewPrices,
      updateOrderItemAvailability,
      isPreparer,
      storedActivities,
      logActivity,
      clearActivities,
    ]
  );

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>;
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
