import React, { useEffect, useMemo, useRef, useState } from 'react';
import { canUserManageMailSettings } from '../../services/mailingService';
import {
  AlertTriangle,
  ArrowDownAZ,
  ArrowUpAZ,
  ArrowUpDown,
  Award,
  Bell,
  BookOpen,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  Database,
  Download,
  Edit3,
  Eye,
  EyeOff,
  Filter,
  FolderTree,
  Info,
  KeyRound,
  Layers,
  Lock,
  Mail,
  Monitor,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Terminal,
  Trash2,
  Unlock,
  UploadCloud,
  User as UserIcon,
  Users,
  Warehouse,
  X,
  XCircle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  Department,
  Depot,
  LicensePlan,
  PLAN_TIERS,
  Project,
  Role,
  User,
  normalizeToCanonicalPlan,
  plan_limits,
} from '../../types';
import { MENU_PERMISSION_GROUPS } from '../../data/permissionMatrix';
import { DesktopSettingsSection } from '../types';
import {
  APP_VERSION,
  EXPECTED_SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
} from '../../appVersion';
import {
  DEFAULT_DESKTOP_SYSTEM_SETTINGS,
  DesktopSystemSettings,
  getDesktopSystemSettings,
  isDesktopApp,
  openExternalUrl,
  setDesktopSystemSettings,
} from '../../services/desktopBridge';
import {
  DesktopTargetOs,
  detectClientDesktopOs,
  getConfiguredBinaryInstallerUrl,
} from '../../utils/desktopInstallerDownload';
import {
  DiagnosticCheckRow,
  getClientSupabase,
  normalizeSupabaseKey,
  normalizeSupabaseUrl,
  runDiagnosticInstallation,
  validateSupabaseAnonKey,
  validateSupabaseServerUrl,
} from '../../services/clientSupabase';
import {
  getLocalCryptoMode,
  isLocalEncryptionEnabled,
  enablePinLocalEncryption,
  disablePinLocalEncryption,
} from '../../services/localCrypto';
import {
  hasLocalDevicePin,
  verifyLocalDevicePin,
  saveLocalDevicePin,
  getUnsynchronizedOperationsCount,
} from '../../services/deviceSecurityService';
import {
  ClientDatabaseLicenseStatus,
  discoverLicenseByProjectUrl,
  enforceSignedLicenseQuotasSync,
  readClientDatabaseLicenseStatus,
  syncLicenseToClientDatabase,
} from '../../services/licenseService';
import { tr } from '../../i18n/dutchTranslator';
import {
  requestGuardedNavigation,
  scrollToAndFocusForm,
  useRegisterUnsavedForm,
} from '../../services/unsavedChangesGuard';
import {
  SQL_MASTER_LICENSES_SCHEMA,
  SQL_SCRIPT_01_AUTH_LINK,
  SQL_SCRIPT_02_RLS_HARDENING,
  SQL_SCRIPT_03_RPC_STOCK_AND_ORDERS,
  SQL_SCRIPT_04_DEPOTS_VEHICULES,
  SQL_SCRIPT_05_RPC_ADMIN_USERS,
  SQL_SCRIPT_06_INSTALL_ADDITIONAL_ROLES,
  SQL_SCRIPT_07_APP_COMPAT,
  SQL_SCRIPT_08_PRINT_JOBS,
  SQL_SCRIPT_09_CORE_PREFIXES,
  SQL_SCRIPT_10_DROP_COMPAT_VIEWS,
  SQL_SCRIPT_11_SUITE_TABLES,
  SQL_SCRIPT_12_USER_PREFERENCES,
  SQL_SCRIPT_13_TRANSFER_STOCK_BATCH,
  SQL_SCRIPT_14_MAILING,
} from '../../constants/supabaseScripts';
import { EdgeFunctionsSetupPanel } from '../../components/EdgeFunctionsSetupPanel';
import { EmailSettingsPanel } from '../../components/SmtpSettingsModal';
import { AboutAppPanel } from '../../components/AboutAppPanel';

interface DesktopSettingsPageProps {
  initialSection?: DesktopSettingsSection;
  onChangeSection?: (section: DesktopSettingsSection) => void;
  onNavigatePrintStation?: () => void;
}

type UserSortColumn = 'trigram' | 'name' | 'email' | 'department' | 'role' | 'status';

const SQL_SCRIPTS_CATALOG = [
  {
    id: '01',
    filename: '01_auth_link.sql',
    title: '01 — Liaison Authentification & Profils',
    description: 'Lie auth.users à public.core_users et crée get_or_link_my_profile().',
    sql: SQL_SCRIPT_01_AUTH_LINK,
  },
  {
    id: '09',
    filename: '09_core_prefixes.sql',
    title: '09 — Préfixes Suite TOT (core_* & stk_*) + Vues de compatibilité',
    description:
      'Renomme de manière idempotente les tables existantes vers core_* et stk_* et crée les vues de compatibilité security_invoker.',
    sql: SQL_SCRIPT_09_CORE_PREFIXES,
  },
  {
    id: '02',
    filename: '02_rls_hardening.sql',
    title: '02 — Durcissement RLS, Colonnes manquantes & Purge des règles héritées',
    description:
      'Alignement automatique des colonnes manquantes sur les bases anciennes, purge des anciennes policies permissives et règles RLS strictes.',
    sql: SQL_SCRIPT_02_RLS_HARDENING,
  },
  {
    id: '03',
    filename: '03_rpc_stock_and_orders.sql',
    title: '03 — Transactions de Stock, Purge des triggers hérités & Commandes RPC',
    description:
      'Purge des déclencheurs hérités (double comptage), conversion id numérique -> texte, process_stock_movement (IN, OUT, TRANSFER, INVENTORY) et commandes.',
    sql: SQL_SCRIPT_03_RPC_STOCK_AND_ORDERS,
  },
  {
    id: '04',
    filename: '04_mouvements_et_depots_vehicules.sql',
    title: '04 — Mouvements & Dépôts / Véhicules',
    description: 'Tables stk_stock_levels multi-dépôts, véhicules et index de performance.',
    sql: SQL_SCRIPT_04_DEPOTS_VEHICULES,
  },
  {
    id: '05',
    filename: '05_rpc_admin_users.sql',
    title: '05 — Administration Utilisateurs & Rôles RPC',
    description: 'Fonctions sécurisées de gestion des comptes, blocage et permissions.',
    sql: SQL_SCRIPT_05_RPC_ADMIN_USERS,
  },
  {
    id: '06',
    filename: '06_install_additional_roles.sql',
    title: '06 — Rôles Métier Recommandés (#0 à #10)',
    description: 'Installation des 11 rôles métier standards et de leur matrice de permissions.',
    sql: SQL_SCRIPT_06_INSTALL_ADDITIONAL_ROLES,
  },
  {
    id: '08',
    filename: '08_print_jobs.sql',
    title: '08 — File de Travaux du Poste d’Impression',
    description: 'Tables public.stk_print_stations / public.stk_print_jobs et RPC associées.',
    sql: SQL_SCRIPT_08_PRINT_JOBS,
  },
  {
    id: '11',
    filename: '11_suite_tables.sql',
    title: 'Script 11 — Tables de la suite TOT et fichiers',
    description:
      'Crée le journal de préparation, les catégories, les lignes de commande et le stockage privé des fichiers (tot-files). À lancer après le script 08 et avant le script 12.',
    sql: SQL_SCRIPT_11_SUITE_TABLES,
  },
  {
    id: '12',
    filename: '12_user_preferences.sql',
    title: 'Script 12 — Préférences utilisateur (core_user_preferences)',
    description:
      'Crée la table public.core_user_preferences (JSONB <= 16 Ko, cascade et 4 politiques RLS) pour synchroniser les préférences entre appareils. À lancer après le script 11 et avant le script 13.',
    sql: SQL_SCRIPT_12_USER_PREFERENCES,
  },
  {
    id: '13',
    filename: '13_transfer_stock_batch.sql',
    title: 'Script 13 — Transfert de matériel entre dépôts par lot (transfer_stock_batch)',
    description:
      'Ajoute perm_stock_transfer à process_stock_movement et crée la RPC transactionnelle et idempotente public.transfer_stock_batch (1 à 200 articles, tout ou rien). À lancer après le script 12 et avant le script 14.',
    sql: SQL_SCRIPT_13_TRANSFER_STOCK_BATCH,
  },
  {
    id: '14',
    filename: '14_mailing.sql',
    title: 'Script 14 — Mailing multi-fournisseurs, Microsoft 365 (Graph) & expéditeurs par application (14_mailing.sql)',
    description:
      'Crée les tables core_mail_accounts (Brevo, Resend, SendGrid, Mailgun, Postmark, Mailjet, Microsoft 365 Graph, SMTP), core_mail_senders (stk, hab, rpt, tools) et core_mail_log, les RPC Vault sécurisées et migre automatiquement la configuration Brevo existante. À lancer après le script 13 et avant le script 07.',
    sql: SQL_SCRIPT_14_MAILING,
  },
  {
    id: '07',
    filename: '07_app_compat.sql',
    title: '07 — Compatibilité Schéma 2.4.1 & Diagnostic SQL',
    description: 'Table public.core_app_compat et fonction RPC public.diagnostic_installation().',
    sql: SQL_SCRIPT_07_APP_COMPAT,
  },
  {
    id: '10',
    filename: '10_drop_compat_views.sql',
    title: '10 — Suppression manuelle des vues de compatibilité (Fin de transition)',
    description:
      'À exécuter manuellement une fois que toutes les applications de la suite TOT utilisent les tables préfixées core_* et stk_*.',
    sql: SQL_SCRIPT_10_DROP_COMPAT_VIEWS,
  },
  {
    id: 'master',
    filename: 'schema_master_licenses.sql',
    title: 'Optionnel — Schéma Serveur Maître Licences',
    description: 'Uniquement pour la base éditeur gérant les licences signées.',
    sql: SQL_MASTER_LICENSES_SCHEMA,
  },
];

export const DesktopSettingsPage: React.FC<DesktopSettingsPageProps> = ({
  initialSection = 'profile',
  onChangeSection,
  onNavigatePrintStation,
}) => {
  const {
    currentUser,
    users,
    roles,
    depots,
    products,
    subCategories,
    departments,
    projects,
    settings,
    updateSetting,
    license,
    verifyLicense,
    provisionLicense,
    upgradePlan,
    updateContactEmail,
    removeLicense,
    syncLicenseWithServer,
    daysUntilNextCheck,
    supabaseUrl,
    supabaseKey,
    saveSupabaseConfig,
    isSupabaseConnected,
    supabaseSyncStatus,
    supabaseSyncMessage,
    syncFromSupabase,
    exportToSupabase,
    testConnection,
    resetToDemoData,
    appCompat,
    recheckAppCompat,
    maxDepots,
    userHasPermission,
    saveUser,
    deleteUser,
    toggleBlockUser,
    saveRole,
    deleteRole,
    resetRolesToRecommended,
    saveSubCategory,
    deleteSubCategory,
    saveDepot,
    deleteDepot,
    toggleDepotStatus,
    saveDepartment,
    deleteDepartment,
    saveProject,
    deleteProject,
    wipeDeviceAndSignOut,
    language,
    t,
  } = useApp();

  const [section, setSection] = useState<DesktopSettingsSection>(initialSection);
  const [sysSettings, setSysSettings] = useState<DesktopSystemSettings>(
    DEFAULT_DESKTOP_SYSTEM_SETTINGS
  );
  const [detectedOs] = useState<DesktopTargetOs>(() => detectClientDesktopOs());
  const desktopInstallerUrl = getConfiguredBinaryInstallerUrl(detectedOs, appCompat?.updateUrl);

  // Feedback message
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Local encryption & safe local reset state
  const [cryptoMode, setCryptoMode] = useState(() => getLocalCryptoMode());
  const [cryptoEnabled, setCryptoEnabled] = useState(() => isLocalEncryptionEnabled());
  const [pinForCrypto, setPinForCrypto] = useState('');
  const [showPinCryptoPrompt, setShowPinCryptoPrompt] = useState<'enable' | 'disable' | null>(null);
  const [cryptoBusy, setCryptoBusy] = useState(false);
  const [confirmWipeDevice, setConfirmWipeDevice] = useState(false);
  const [wipingDevice, setWipingDevice] = useState(false);
  const [unsyncedCountBeforeWipe, setUnsyncedCountBeforeWipe] = useState<number>(0);
  const [checkingUnsynced, setCheckingUnsynced] = useState(false);

  // ============================================================================
  // 1. UTILISATEURS & RÔLES — Form, Column Filters & Alphabetical Sort State
  // ============================================================================
  const [usersRolesTab, setUsersRolesTab] = useState<'users' | 'roles'>('users');
  const [editingUserId, setEditingUserId] = useState<string | number | null>(null);
  const [userName, setUserName] = useState('');
  const [userTrigram, setUserTrigram] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userPin, setUserPin] = useState('');
  const [userRoleId, setUserRoleId] = useState<number>(3);
  const [userDepartment, setUserDepartment] = useState('');
  const [userIsPreparer, setUserIsPreparer] = useState(false);
  const [userAllDepots, setUserAllDepots] = useState(true);
  const [userAllowedDepots, setUserAllowedDepots] = useState<string[]>([]);

  // Users Filtering & Column Sorting
  const [userGlobalSearch, setUserGlobalSearch] = useState('');
  const [userColFilterTrigram, setUserColFilterTrigram] = useState('');
  const [userColFilterName, setUserColFilterName] = useState('');
  const [userColFilterEmail, setUserColFilterEmail] = useState('');
  const [userColFilterDept, setUserColFilterDept] = useState('ALL');
  const [userColFilterRole, setUserColFilterRole] = useState('ALL');
  const [userColFilterStatus, setUserColFilterStatus] = useState<'ALL' | 'ACTIVE' | 'BLOCKED' | 'PREPARER'>('ALL');
  const [userSortCol, setUserSortCol] = useState<UserSortColumn>('name');
  const [userSortDir, setUserSortDir] = useState<'asc' | 'desc'>('asc');

  // Roles Form, Filtering & Sorting
  const [editingRoleId, setEditingRoleId] = useState<number | null>(null);
  const [roleName, setRoleName] = useState('');
  const [rolePermissions, setRolePermissions] = useState<string[]>([]);
  const [permSearch, setPermSearch] = useState('');
  const [roleSearch, setRoleSearch] = useState('');
  const [roleSortBy, setRoleSortBy] = useState<'name_asc' | 'name_desc' | 'id_asc' | 'perms_desc'>('name_asc');

  // ============================================================================
  // 2. DÉPÔTS & VÉHICULES — Form, Filters & Alphabetical Sort State
  // ============================================================================
  const [editingDepotId, setEditingDepotId] = useState<string | number | null>(null);
  const [newDepotName, setNewDepotName] = useState('');
  const [newDepotAddress, setNewDepotAddress] = useState('');
  const [newDepotType, setNewDepotType] = useState<'FIXED' | 'VEHICLE' | 'CONTAINER'>('FIXED');
  const [newDepotManagerId, setNewDepotManagerId] = useState<string>('');
  const [newDepotProjectNumber, setNewDepotProjectNumber] = useState<string>('');
  const [newDepotPickupZones, setNewDepotPickupZones] = useState<string>('');
  const [newDepotActive, setNewDepotActive] = useState<boolean>(true);

  const [depotSearch, setDepotSearch] = useState('');
  const [depotTypeFilter, setDepotTypeFilter] = useState<'ALL' | 'FIXED' | 'VEHICLE' | 'CONTAINER'>('ALL');
  const [depotManagerFilter, setDepotManagerFilter] = useState<string>('ALL');
  const [depotStatusFilter, setDepotStatusFilter] = useState<'ALL' | 'OPEN' | 'CLOSED'>('ALL');
  const [depotSortBy, setDepotSortBy] = useState<'name_asc' | 'name_desc' | 'type_asc' | 'status'>('name_asc');

  // ============================================================================
  // 3. CATÉGORIES D'ARTICLES — Form, Search, Alphabetical Sort & Uniqueness
  // ============================================================================
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [editingCatName, setEditingCatName] = useState('');
  const [categorySearch, setCategorySearch] = useState('');
  const [categorySortBy, setCategorySortBy] = useState<'name_asc' | 'name_desc' | 'count_desc' | 'id_asc'>('name_asc');

  // ============================================================================
  // 4. DÉPARTEMENTS & CHANTIERS/PROJETS — Selection, Filters & Uniqueness
  // ============================================================================
  const [editingDeptId, setEditingDeptId] = useState<number | null>(null);
  const [deptName, setDeptName] = useState('');
  const [deptManagerId, setDeptManagerId] = useState<string>('');
  const [deptDeputyIds, setDeptDeputyIds] = useState<string[]>([]);
  const [deptIsPreparer, setDeptIsPreparer] = useState(false);
  const [deptRequireApproval, setDeptRequireApproval] = useState(false);
  const [deptApprovalThreshold, setDeptApprovalThreshold] = useState('300');

  const [deptSearch, setDeptSearch] = useState('');
  const [deptManagerFilter, setDeptManagerFilter] = useState<string>('ALL');
  const [deptSortBy, setDeptSortBy] = useState<'name_asc' | 'name_desc' | 'projects_desc'>('name_asc');

  // "Les chantiers d'un département n'apparaissent que quand on clique sur le département en question.
  //  Un bouton Tous permet d'afficher tous les chantiers/Projets tous départements confondus"
  const [selectedDeptForProjects, setSelectedDeptForProjects] = useState<string>('NONE');

  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [projNumber, setProjNumber] = useState('');
  const [projName, setProjName] = useState('');
  const [projDeptId, setProjDeptId] = useState<string>('');
  const [projManagerId, setProjManagerId] = useState<string>('');
  const [projDeputyIds, setProjDeputyIds] = useState<string[]>([]);

  const [projSearch, setProjSearch] = useState('');
  const [projDeptManagerFilter, setProjDeptManagerFilter] = useState<string>('ALL');
  const [projSiteManagerFilter, setProjSiteManagerFilter] = useState<string>('ALL');
  const [projSortBy, setProjSortBy] = useState<
    'name_asc' | 'name_desc' | 'number_asc' | 'number_desc' | 'dept_asc'
  >('name_asc');

  // ============================================================================
  // 5. ENTREPRISE, E-MAILS SMTP & LICENCE / BASE SQL
  // ============================================================================
  const [companyNameInput, setCompanyNameInput] = useState(
    settings.company_name || license?.organization_name || ''
  );
  const [smtpFromEmail, setSmtpFromEmail] = useState(settings.smtp_from_email || '');
  const [smtpFromName, setSmtpFromName] = useState(settings.smtp_from_name || '');

  // License & SQL sub-tabs
  const [licenseSubTab, setLicenseSubTab] = useState<
    'license' | 'database' | 'sql_diagnostic' | 'edge_functions'
  >('license');
  const [licenseKeyInput, setLicenseKeyInput] = useState('');
  const [orgNameEdit, setOrgNameEdit] = useState(
    license?.organization_name || settings.company_name || ''
  );
  const [contactEmailEdit, setContactEmailEdit] = useState(license?.contact_email || '');
  const [isBusyLicense, setIsBusyLicense] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [dbLicenseStatus, setDbLicenseStatus] = useState<ClientDatabaseLicenseStatus | null>(null);

  // Supabase BYOD form state
  const [dbUrlInput, setDbUrlInput] = useState(supabaseUrl || '');
  const [dbKeyInput, setDbKeyInput] = useState(supabaseKey || '');
  const [showDbKey, setShowDbKey] = useState(false);
  const [isBusyDb, setIsBusyDb] = useState(false);
  const [dbTestSummary, setDbTestSummary] = useState<{
    ok: boolean;
    message: string;
    details?: string;
  } | null>(null);

  const refreshDbLicenseStatus = React.useCallback(
    async (overridePlan?: string) => {
      try {
        const cleanUrl = normalizeSupabaseUrl(dbUrlInput || supabaseUrl || '');
        const cleanKey = normalizeSupabaseKey(dbKeyInput || supabaseKey || '');
        if (!cleanUrl || !cleanKey) {
          setDbLicenseStatus(null);
          return;
        }
        const client = getClientSupabase(cleanUrl, cleanKey);
        if (!client) {
          setDbLicenseStatus(null);
          return;
        }
        const status = await readClientDatabaseLicenseStatus(
          client,
          overridePlan || license?.plan_type || license?.plan
        );
        setDbLicenseStatus(status);
      } catch {}
    },
    [dbUrlInput, dbKeyInput, supabaseUrl, supabaseKey, license?.plan_type, license?.plan]
  );

  useEffect(() => {
    if (section === 'license') {
      refreshDbLicenseStatus();
    }
  }, [section, licenseSubTab, license?.plan_type, license?.license_key, refreshDbLicenseStatus]);

  // SQL Scripts & Diagnostic state
  const [selectedSqlScriptId, setSelectedSqlScriptId] = useState<string>('02');
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagRows, setDiagRows] = useState<DiagnosticCheckRow[]>([]);
  const [diagError, setDiagError] = useState<string | null>(null);

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    if (isDesktopApp()) {
      getDesktopSystemSettings().then(setSysSettings);
    }
  }, []);

  useEffect(() => {
    setOrgNameEdit(license?.organization_name || settings.company_name || '');
    setContactEmailEdit(license?.contact_email || '');
  }, [license?.organization_name, license?.contact_email, settings.company_name]);

  useEffect(() => {
    if (supabaseUrl) setDbUrlInput(supabaseUrl);
    if (supabaseKey) setDbKeyInput(supabaseKey);
  }, [supabaseUrl, supabaseKey]);

  // Form & Input refs for direct scroll + focus on Edit click
  const userFormRef = useRef<HTMLFormElement | null>(null);
  const userNameInputRef = useRef<HTMLInputElement | null>(null);
  const roleFormRef = useRef<HTMLFormElement | null>(null);
  const roleNameInputRef = useRef<HTMLInputElement | null>(null);
  const depotFormRef = useRef<HTMLFormElement | null>(null);
  const depotNameInputRef = useRef<HTMLInputElement | null>(null);
  const catEditInputRef = useRef<HTMLInputElement | null>(null);
  const deptFormRef = useRef<HTMLFormElement | null>(null);
  const deptNameInputRef = useRef<HTMLInputElement | null>(null);
  const projFormRef = useRef<HTMLFormElement | null>(null);
  const projNumberInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingCatId !== null) {
      scrollToAndFocusForm(catEditInputRef.current, catEditInputRef.current);
    }
  }, [editingCatId]);

  // Reset helpers
  const resetUserForm = () => {
    setEditingUserId(null);
    setUserName('');
    setUserTrigram('');
    setUserEmail('');
    setUserPin('');
    setUserRoleId(roles[0]?.id ?? 3);
    setUserDepartment('');
    setUserIsPreparer(false);
    setUserAllDepots(true);
    setUserAllowedDepots([]);
  };

  const startEditUser = (u: User) => {
    setEditingUserId(u.id);
    setUserName(u.name || '');
    setUserTrigram(u.trigram || '');
    setUserEmail(u.email || '');
    setUserPin('');
    setUserRoleId(Number(u.role_id));
    setUserDepartment(u.department || '');
    setUserIsPreparer(Boolean(u.is_preparer));
    const isAll = !u.allowed_depots || u.allowed_depots.length === 0 || u.allowed_depots.includes('*');
    setUserAllDepots(isAll);
    setUserAllowedDepots(isAll ? [] : [...(u.allowed_depots || [])]);
    scrollToAndFocusForm(userFormRef.current, userNameInputRef.current);
  };

  const resetRoleForm = () => {
    setEditingRoleId(null);
    setRoleName('');
    setRolePermissions([]);
  };

  const startEditRole = (r: Role) => {
    setEditingRoleId(r.id);
    setRoleName(r.name || '');
    setRolePermissions([...(r.permissions || [])]);
    scrollToAndFocusForm(roleFormRef.current, roleNameInputRef.current);
  };

  const resetDepotForm = () => {
    setEditingDepotId(null);
    setNewDepotName('');
    setNewDepotAddress('');
    setNewDepotType('FIXED');
    setNewDepotManagerId('');
    setNewDepotProjectNumber('');
    setNewDepotPickupZones('');
    setNewDepotActive(true);
  };

  const startEditDepot = (d: Depot) => {
    setEditingDepotId(d.id);
    setNewDepotName(d.name || '');
    setNewDepotAddress(d.address || '');
    setNewDepotType(d.type || 'FIXED');
    setNewDepotManagerId(
      d.manager_id !== undefined && d.manager_id !== null ? String(d.manager_id) : ''
    );
    setNewDepotProjectNumber(d.project_number || '');
    setNewDepotPickupZones((d.pickup_zones || []).join(', '));
    setNewDepotActive(d.is_active !== false);
    scrollToAndFocusForm(depotFormRef.current, depotNameInputRef.current);
  };

  const resetDeptForm = () => {
    setEditingDeptId(null);
    setDeptName('');
    setDeptManagerId('');
    setDeptDeputyIds([]);
    setDeptIsPreparer(false);
    setDeptRequireApproval(false);
    setDeptApprovalThreshold('300');
  };

  const startEditDept = (d: Department) => {
    setEditingDeptId(d.id);
    setDeptName(d.name || '');
    setDeptManagerId(
      d.manager_id !== undefined && d.manager_id !== null ? String(d.manager_id) : ''
    );
    setDeptDeputyIds((d.deputy_manager_ids || []).map((id) => String(id)));
    setDeptIsPreparer(Boolean(d.is_preparer_dept));
    setDeptRequireApproval(Boolean(d.require_order_approval));
    setDeptApprovalThreshold(String(d.order_approval_threshold ?? 300));
    scrollToAndFocusForm(deptFormRef.current, deptNameInputRef.current);
  };

  const resetProjForm = () => {
    setEditingProjectId(null);
    setProjNumber('');
    setProjName('');
    setProjDeptId(
      selectedDeptForProjects !== 'NONE' && selectedDeptForProjects !== 'ALL'
        ? selectedDeptForProjects
        : departments[0]
          ? String(departments[0].id)
          : ''
    );
    setProjManagerId('');
    setProjDeputyIds([]);
  };

  const startEditProj = (p: Project) => {
    setEditingProjectId(p.id);
    setProjNumber(p.project_number || '');
    setProjName(p.project_name || '');
    setProjDeptId(p.department_id ? String(p.department_id) : '');
    setProjManagerId(
      p.manager_id !== undefined && p.manager_id !== null ? String(p.manager_id) : ''
    );
    setProjDeputyIds((p.deputy_manager_ids || []).map((id) => String(id)));
    scrollToAndFocusForm(projFormRef.current, projNumberInputRef.current);
  };

  const performSaveUser = async (): Promise<boolean> => {
    setSaveMessage(null);
    setErrorMessage(null);
    if (!userName.trim() || !userTrigram.trim()) {
      setErrorMessage('Le nom et le trigramme sont obligatoires.');
      return false;
    }
    const res = await saveUser(
      {
        id: editingUserId ?? undefined,
        name: userName.trim(),
        trigram: userTrigram.trim().toUpperCase(),
        email: userEmail.trim() || undefined,
        role_id: Number(userRoleId),
        department: userDepartment.trim() || undefined,
        is_preparer: userIsPreparer,
        allowed_depots: userAllDepots ? ['*'] : userAllowedDepots,
      },
      userPin.trim() || undefined
    );
    if (res.success) {
      setSaveMessage(
        editingUserId !== null ? 'Utilisateur mis à jour.' : 'Utilisateur créé.'
      );
      resetUserForm();
      return true;
    }
    setErrorMessage(res.message || 'Erreur lors de la sauvegarde.');
    return false;
  };

  const performSaveRole = async (): Promise<boolean> => {
    setSaveMessage(null);
    setErrorMessage(null);
    const cleanRoleName = roleName.trim();
    if (!cleanRoleName) {
      setErrorMessage('Veuillez saisir un nom de rôle.');
      return false;
    }
    const duplicateRole = roles.find(
      (r) =>
        r.name.trim().toLowerCase() === cleanRoleName.toLowerCase() &&
        (editingRoleId === null || r.id !== editingRoleId)
    );
    if (duplicateRole) {
      setErrorMessage(`Un rôle portant le nom « ${cleanRoleName} » existe déjà.`);
      return false;
    }
    const ok = await saveRole({
      id: editingRoleId ?? undefined,
      name: cleanRoleName,
      permissions: rolePermissions,
    });
    if (ok) {
      setSaveMessage(
        editingRoleId !== null ? 'Rôle mis à jour.' : 'Nouveau rôle créé.'
      );
      resetRoleForm();
      return true;
    }
    return false;
  };

  const performSaveDepot = async (): Promise<boolean> => {
    setSaveMessage(null);
    setErrorMessage(null);
    const cleanName = newDepotName.trim();
    if (!cleanName) {
      setErrorMessage('Le nom du dépôt / véhicule est obligatoire.');
      return false;
    }
    const duplicateDepot = depots.find(
      (d) =>
        d.name.trim().toLowerCase() === cleanName.toLowerCase() &&
        (editingDepotId === null || String(d.id) !== String(editingDepotId))
    );
    if (duplicateDepot) {
      setErrorMessage(
        `Un dépôt ou véhicule portant le nom « ${cleanName} » existe déjà (unicité requise).`
      );
      return false;
    }
    const managerUser = users.find(
      (u) => String(u.id) === String(newDepotManagerId)
    );
    const zones = newDepotPickupZones
      .split(',')
      .map((z) => z.trim())
      .filter(Boolean);
    const res = await saveDepot({
      id: editingDepotId ?? undefined,
      name: cleanName,
      address: newDepotAddress.trim(),
      is_active: newDepotActive,
      type: newDepotType,
      manager_id: newDepotManagerId || null,
      manager_name: managerUser ? managerUser.name : null,
      project_number: newDepotProjectNumber || undefined,
      pickup_zones: zones,
    });
    if (res.success) {
      setSaveMessage(
        editingDepotId !== null ? 'Dépôt mis à jour.' : 'Dépôt créé.'
      );
      resetDepotForm();
      return true;
    }
    setErrorMessage(res.message);
    return false;
  };

  const performSaveCategoryEdit = async (): Promise<boolean> => {
    if (editingCatId === null) return true;
    setSaveMessage(null);
    setErrorMessage(null);
    const clean = editingCatName.trim();
    if (!clean) {
      setErrorMessage('Le nom de la catégorie est obligatoire.');
      return false;
    }
    const duplicate = subCategories.some(
      (other) =>
        other.id !== editingCatId &&
        other.name.trim().toLowerCase() === clean.toLowerCase()
    );
    if (duplicate) {
      setErrorMessage(
        `Impossible de renommer : la catégorie « ${clean} » existe déjà.`
      );
      return false;
    }
    const ok = await saveSubCategory(clean, editingCatId);
    if (ok) {
      setSaveMessage('Catégorie renommée.');
      setEditingCatId(null);
      return true;
    }
    setErrorMessage(`La catégorie « ${clean} » existe déjà.`);
    return false;
  };

  const performSaveDept = async (): Promise<boolean> => {
    setSaveMessage(null);
    setErrorMessage(null);
    const cleanDeptName = deptName.trim();
    if (!cleanDeptName) {
      setErrorMessage('Le nom du département est obligatoire.');
      return false;
    }
    const duplicateDept = departments.find(
      (d) =>
        d.name.trim().toLowerCase() === cleanDeptName.toLowerCase() &&
        (editingDeptId === null || d.id !== editingDeptId)
    );
    if (duplicateDept) {
      setErrorMessage(
        `Le département « ${cleanDeptName} » existe déjà. Le nom du département doit être unique.`
      );
      return false;
    }
    const ok = await saveDepartment({
      id: editingDeptId ?? undefined,
      name: cleanDeptName,
      manager_id: deptManagerId || null,
      deputy_manager_ids: deptDeputyIds,
      is_preparer_dept: deptIsPreparer,
      require_order_approval: deptRequireApproval,
      order_approval_threshold: Math.max(0, Number(deptApprovalThreshold) || 0),
    });
    if (ok) {
      setSaveMessage(
        editingDeptId !== null
          ? 'Département mis à jour.'
          : 'Département créé.'
      );
      resetDeptForm();
      return true;
    }
    setErrorMessage(
      `Impossible d'enregistrer « ${cleanDeptName} » : ce nom de département est déjà utilisé.`
    );
    return false;
  };

  const performSaveProj = async (): Promise<boolean> => {
    setSaveMessage(null);
    setErrorMessage(null);
    const cleanNumber = projNumber.trim().toUpperCase();
    const cleanName = projName.trim();
    if (!cleanNumber || !cleanName) {
      setErrorMessage('Le N° de chantier et le nom du chantier sont obligatoires.');
      return false;
    }
    const duplicateNumber = projects.find(
      (p) =>
        p.project_number.trim().toLowerCase() === cleanNumber.toLowerCase() &&
        (editingProjectId === null || p.id !== editingProjectId)
    );
    if (duplicateNumber) {
      setErrorMessage(
        `Un chantier avec le numéro « ${cleanNumber} » existe déjà.`
      );
      return false;
    }
    const targetDeptId = Number(projDeptId) || departments[0]?.id || 1;
    const ok = await saveProject({
      id: editingProjectId ?? undefined,
      project_number: cleanNumber,
      project_name: cleanName,
      department_id: targetDeptId,
      manager_id: projManagerId || null,
      deputy_manager_ids: projDeputyIds,
    });
    if (ok) {
      setSaveMessage(
        editingProjectId !== null ? 'Chantier mis à jour.' : 'Chantier créé.'
      );
      if (selectedDeptForProjects === 'NONE') {
        setSelectedDeptForProjects(String(targetDeptId));
      }
      resetProjForm();
      return true;
    }
    setErrorMessage(
      `Impossible d'enregistrer le chantier « ${cleanNumber} » (doublon détecté).`
    );
    return false;
  };

  const isUserFormDirty =
    section === 'users_roles' &&
    usersRolesTab === 'users' &&
    (editingUserId !== null ||
      Boolean(userName.trim() || userTrigram.trim() || userEmail.trim() || userPin.trim()));

  const isRoleFormDirty =
    section === 'users_roles' &&
    usersRolesTab === 'roles' &&
    (editingRoleId !== null || Boolean(roleName.trim()));

  const isDepotFormDirty =
    section === 'depots' &&
    (editingDepotId !== null || Boolean(newDepotName.trim() || newDepotAddress.trim()));

  const isCategoryFormDirty =
    section === 'categories' && editingCatId !== null;

  const isDeptFormDirty =
    section === 'departments_projects' &&
    (editingDeptId !== null || Boolean(deptName.trim()));

  const isProjFormDirty =
    section === 'departments_projects' &&
    (editingProjectId !== null || Boolean(projNumber.trim() || projName.trim()));

  const isAnySettingsFormDirty =
    isUserFormDirty ||
    isRoleFormDirty ||
    isDepotFormDirty ||
    isCategoryFormDirty ||
    isDeptFormDirty ||
    isProjFormDirty;

  const activeSettingsFormLabel = isUserFormDirty
    ? editingUserId !== null
      ? `Modifier l’utilisateur (${userName || userTrigram})`
      : 'Nouvel utilisateur'
    : isRoleFormDirty
      ? editingRoleId !== null
        ? `Modifier le rôle (${roleName})`
        : 'Nouveau rôle'
      : isDepotFormDirty
        ? editingDepotId !== null
          ? `Modifier le dépôt (${newDepotName})`
          : 'Nouveau dépôt'
        : isCategoryFormDirty
          ? `Renommer la catégorie (${editingCatName})`
          : isDeptFormDirty
            ? editingDeptId !== null
              ? `Modifier le département (${deptName})`
              : 'Nouveau département'
            : isProjFormDirty
              ? editingProjectId !== null
                ? `Modifier le chantier (${projNumber || projName})`
                : 'Nouveau chantier'
              : 'Formulaire Paramètres';

  useRegisterUnsavedForm({
    id: 'desktop-settings-form',
    isDirty: isAnySettingsFormDirty,
    label: activeSettingsFormLabel,
    onSave: async () => {
      if (isUserFormDirty) return await performSaveUser();
      if (isRoleFormDirty) return await performSaveRole();
      if (isDepotFormDirty) return await performSaveDepot();
      if (isCategoryFormDirty) return await performSaveCategoryEdit();
      if (isDeptFormDirty) return await performSaveDept();
      if (isProjFormDirty) return await performSaveProj();
      return true;
    },
    onDiscard: () => {
      if (isUserFormDirty) resetUserForm();
      if (isRoleFormDirty) resetRoleForm();
      if (isDepotFormDirty) resetDepotForm();
      if (isCategoryFormDirty) setEditingCatId(null);
      if (isDeptFormDirty) resetDeptForm();
      if (isProjFormDirty) resetProjForm();
    },
  });

  // ============================================================================
  // COMPUTED LISTS (Memoized Filtering & Sorting)
  // ============================================================================

  // 1. Filtered & Sorted Users
  const filteredAndSortedUsers = useMemo(() => {
    const qGlobal = userGlobalSearch.trim().toLowerCase();
    const qTrig = userColFilterTrigram.trim().toLowerCase();
    const qName = userColFilterName.trim().toLowerCase();
    const qMail = userColFilterEmail.trim().toLowerCase();

    const filtered = users.filter((u) => {
      const roleObj = roles.find((r) => Number(r.id) === Number(u.role_id));
      const roleLabel = (roleObj?.name || `Rôle #${u.role_id}`).toLowerCase();
      const trig = (u.trigram || '').toLowerCase();
      const name = (u.name || '').toLowerCase();
      const email = (u.email || '').toLowerCase();
      const dept = (u.department || '').toLowerCase();

      if (qGlobal) {
        const hit =
          trig.includes(qGlobal) ||
          name.includes(qGlobal) ||
          email.includes(qGlobal) ||
          dept.includes(qGlobal) ||
          roleLabel.includes(qGlobal);
        if (!hit) return false;
      }
      if (qTrig && !trig.includes(qTrig)) return false;
      if (qName && !name.includes(qName)) return false;
      if (qMail && !email.includes(qMail)) return false;
      if (userColFilterDept !== 'ALL') {
        if (userColFilterDept === '__NONE__') {
          if (dept) return false;
        } else if (dept !== userColFilterDept.toLowerCase()) {
          return false;
        }
      }
      if (userColFilterRole !== 'ALL' && String(u.role_id) !== userColFilterRole) {
        return false;
      }
      if (userColFilterStatus === 'ACTIVE' && u.is_blocked) return false;
      if (userColFilterStatus === 'BLOCKED' && !u.is_blocked) return false;
      if (userColFilterStatus === 'PREPARER' && !u.is_preparer) return false;

      return true;
    });

    const mult = userSortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (userSortCol === 'trigram') {
        return (a.trigram || '').localeCompare(b.trigram || '', 'fr', { sensitivity: 'base' }) * mult;
      }
      if (userSortCol === 'name') {
        return (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' }) * mult;
      }
      if (userSortCol === 'email') {
        return (a.email || '').localeCompare(b.email || '', 'fr', { sensitivity: 'base' }) * mult;
      }
      if (userSortCol === 'department') {
        return (a.department || '').localeCompare(b.department || '', 'fr', { sensitivity: 'base' }) * mult;
      }
      if (userSortCol === 'role') {
        const rA = roles.find((r) => Number(r.id) === Number(a.role_id))?.name || '';
        const rB = roles.find((r) => Number(r.id) === Number(b.role_id))?.name || '';
        return rA.localeCompare(rB, 'fr', { sensitivity: 'base' }) * mult;
      }
      if (userSortCol === 'status') {
        const sA = a.is_blocked ? 1 : 0;
        const sB = b.is_blocked ? 1 : 0;
        return (sA - sB) * mult;
      }
      return 0;
    });
  }, [
    users,
    roles,
    userGlobalSearch,
    userColFilterTrigram,
    userColFilterName,
    userColFilterEmail,
    userColFilterDept,
    userColFilterRole,
    userColFilterStatus,
    userSortCol,
    userSortDir,
  ]);

  const toggleUserSortColumn = (col: UserSortColumn) => {
    if (userSortCol === col) {
      setUserSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setUserSortCol(col);
      setUserSortDir('asc');
    }
  };

  // 2. Filtered & Sorted Roles
  const filteredAndSortedRoles = useMemo(() => {
    const q = roleSearch.trim().toLowerCase();
    const list = roles.filter((r) => {
      if (!q) return true;
      return (
        (r.name || '').toLowerCase().includes(q) ||
        String(r.id).includes(q) ||
        `#${r.id}`.includes(q)
      );
    });

    return [...list].sort((a, b) => {
      if (roleSortBy === 'name_asc') {
        return (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' });
      }
      if (roleSortBy === 'name_desc') {
        return (b.name || '').localeCompare(a.name || '', 'fr', { sensitivity: 'base' });
      }
      if (roleSortBy === 'perms_desc') {
        const pA = a.id === 0 ? 9999 : (a.permissions || []).length;
        const pB = b.id === 0 ? 9999 : (b.permissions || []).length;
        return pB - pA;
      }
      return Number(a.id) - Number(b.id);
    });
  }, [roles, roleSearch, roleSortBy]);

  // 3. Filtered & Sorted Depots
  const filteredAndSortedDepots = useMemo(() => {
    const q = depotSearch.trim().toLowerCase();
    const list = depots.filter((d) => {
      if (depotTypeFilter !== 'ALL' && (d.type || 'FIXED') !== depotTypeFilter) {
        return false;
      }
      if (depotManagerFilter !== 'ALL') {
        if (depotManagerFilter === '__NONE__') {
          if (d.manager_id) return false;
        } else if (String(d.manager_id) !== depotManagerFilter) {
          return false;
        }
      }
      if (depotStatusFilter === 'OPEN' && d.is_active === false) return false;
      if (depotStatusFilter === 'CLOSED' && d.is_active !== false) return false;

      if (q) {
        const mgr = users.find((u) => String(u.id) === String(d.manager_id));
        const hay = [
          d.name,
          d.address,
          d.code,
          d.license_plate,
          d.project_number,
          d.manager_name,
          mgr?.name,
          mgr?.trigram,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return [...list].sort((a, b) => {
      if (depotSortBy === 'name_asc') {
        return (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' });
      }
      if (depotSortBy === 'name_desc') {
        return (b.name || '').localeCompare(a.name || '', 'fr', { sensitivity: 'base' });
      }
      if (depotSortBy === 'type_asc') {
        return (a.type || 'FIXED').localeCompare(b.type || 'FIXED', 'fr');
      }
      if (depotSortBy === 'status') {
        const oA = a.is_active !== false ? 0 : 1;
        const oB = b.is_active !== false ? 0 : 1;
        if (oA !== oB) return oA - oB;
        return (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' });
      }
      return 0;
    });
  }, [depots, users, depotSearch, depotTypeFilter, depotManagerFilter, depotStatusFilter, depotSortBy]);

  // 4. Categories — Duplicate detection, Search & Alphabetical Sort
  const categoryDuplicateIds = useMemo(() => {
    const seen = new Map<string, number>();
    const dupIds: number[] = [];
    for (const sc of subCategories) {
      const norm = (sc.name || '').trim().toLowerCase();
      if (!norm) continue;
      if (seen.has(norm)) {
        dupIds.push(sc.id);
      } else {
        seen.set(norm, sc.id);
      }
    }
    return dupIds;
  }, [subCategories]);

  const productCountByCatId = useMemo(() => {
    const map = new Map<number, number>();
    for (const p of products) {
      if (p.sub_category_id != null) {
        const id = Number(p.sub_category_id);
        map.set(id, (map.get(id) || 0) + 1);
      }
    }
    return map;
  }, [products]);

  const filteredAndSortedCategories = useMemo(() => {
    const q = categorySearch.trim().toLowerCase();
    const list = subCategories.filter((sc) => {
      if (!q) return true;
      return (sc.name || '').toLowerCase().includes(q);
    });

    return [...list].sort((a, b) => {
      if (categorySortBy === 'name_asc') {
        return (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' });
      }
      if (categorySortBy === 'name_desc') {
        return (b.name || '').localeCompare(a.name || '', 'fr', { sensitivity: 'base' });
      }
      if (categorySortBy === 'count_desc') {
        const cA = productCountByCatId.get(a.id) || 0;
        const cB = productCountByCatId.get(b.id) || 0;
        if (cB !== cA) return cB - cA;
        return (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' });
      }
      return Number(a.id) - Number(b.id);
    });
  }, [subCategories, categorySearch, categorySortBy, productCountByCatId]);

  const handleDeduplicateCategories = async () => {
    if (categoryDuplicateIds.length === 0) return;
    let removed = 0;
    for (const dupId of categoryDuplicateIds) {
      await deleteSubCategory(dupId);
      removed += 1;
    }
    setSaveMessage(`${removed} catégorie(s) en doublon supprimée(s).`);
  };

  // 5. Departments & Projects — Filtering, Department Click Selection & Alphabetical Sort
  const projectCountByDeptId = useMemo(() => {
    const map = new Map<number, number>();
    for (const p of projects) {
      const dId = Number(p.department_id);
      map.set(dId, (map.get(dId) || 0) + 1);
    }
    return map;
  }, [projects]);

  const filteredAndSortedDepartments = useMemo(() => {
    const q = deptSearch.trim().toLowerCase();
    const list = departments.filter((d) => {
      if (deptManagerFilter !== 'ALL') {
        if (deptManagerFilter === '__NONE__') {
          if (d.manager_id) return false;
        } else if (String(d.manager_id) !== deptManagerFilter) {
          return false;
        }
      }
      if (q) {
        const mgr = users.find((u) => String(u.id) === String(d.manager_id));
        const hay = `${d.name || ''} ${mgr?.name || ''} ${mgr?.trigram || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return [...list].sort((a, b) => {
      if (deptSortBy === 'name_asc') {
        return (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' });
      }
      if (deptSortBy === 'name_desc') {
        return (b.name || '').localeCompare(a.name || '', 'fr', { sensitivity: 'base' });
      }
      if (deptSortBy === 'projects_desc') {
        const cA = projectCountByDeptId.get(a.id) || 0;
        const cB = projectCountByDeptId.get(b.id) || 0;
        if (cB !== cA) return cB - cA;
        return (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' });
      }
      return 0;
    });
  }, [departments, users, deptSearch, deptManagerFilter, deptSortBy, projectCountByDeptId]);

  const filteredAndSortedProjects = useMemo(() => {
    if (selectedDeptForProjects === 'NONE') return [];
    const q = projSearch.trim().toLowerCase();

    const list = projects.filter((p) => {
      // Filtre par département sélectionné (ou 'ALL' via le bouton Tous)
      if (
        selectedDeptForProjects !== 'ALL' &&
        String(p.department_id) !== String(selectedDeptForProjects)
      ) {
        return false;
      }

      const dept = departments.find((d) => Number(d.id) === Number(p.department_id));

      // Filtre par Responsable de département
      if (projDeptManagerFilter !== 'ALL') {
        if (!dept || String(dept.manager_id || '') !== projDeptManagerFilter) {
          return false;
        }
      }

      // Filtre par Chef de chantier
      if (projSiteManagerFilter !== 'ALL') {
        if (projSiteManagerFilter === '__NONE__') {
          if (p.manager_id) return false;
        } else if (String(p.manager_id || '') !== projSiteManagerFilter) {
          return false;
        }
      }

      // Recherche texte (N° chantier, nom chantier, département, chef)
      if (q) {
        const siteMgr = users.find((u) => String(u.id) === String(p.manager_id));
        const deptMgr = dept
          ? users.find((u) => String(u.id) === String(dept.manager_id))
          : undefined;
        const hay = [
          p.project_number,
          p.project_name,
          dept?.name,
          siteMgr?.name,
          siteMgr?.trigram,
          deptMgr?.name,
          deptMgr?.trigram,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });

    return [...list].sort((a, b) => {
      if (projSortBy === 'name_asc') {
        return (a.project_name || '').localeCompare(b.project_name || '', 'fr', {
          sensitivity: 'base',
        });
      }
      if (projSortBy === 'name_desc') {
        return (b.project_name || '').localeCompare(a.project_name || '', 'fr', {
          sensitivity: 'base',
        });
      }
      if (projSortBy === 'number_asc') {
        return (a.project_number || '').localeCompare(b.project_number || '', 'fr', {
          numeric: true,
          sensitivity: 'base',
        });
      }
      if (projSortBy === 'number_desc') {
        return (b.project_number || '').localeCompare(a.project_number || '', 'fr', {
          numeric: true,
          sensitivity: 'base',
        });
      }
      if (projSortBy === 'dept_asc') {
        const dA = departments.find((d) => d.id === a.department_id)?.name || '';
        const dB = departments.find((d) => d.id === b.department_id)?.name || '';
        const cmp = dA.localeCompare(dB, 'fr', { sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        return (a.project_name || '').localeCompare(b.project_name || '', 'fr', {
          sensitivity: 'base',
        });
      }
      return 0;
    });
  }, [
    projects,
    departments,
    users,
    selectedDeptForProjects,
    projSearch,
    projDeptManagerFilter,
    projSiteManagerFilter,
    projSortBy,
  ]);

  // License & Quotas computed info
  const signedQuotas = useMemo(() => {
    if (license?.signed_token) {
      return enforceSignedLicenseQuotasSync(license);
    }
    const canonical = normalizeToCanonicalPlan(
      license?.plan || license?.plan_type || 'free',
      license?.license_key
    );
    const limits = plan_limits(canonical);
    return {
      plan: canonical,
      max_references: limits.max_references,
      max_depots: maxDepots || limits.max_depots,
      modules: license?.modules || limits.default_modules,
      isSignedValidStructure: true,
    };
  }, [license, maxDepots]);
  const activeDepotsCount = useMemo(
    () => depots.filter((d) => d.is_active !== false).length,
    [depots]
  );

  const copyToClipboard = (text: string, keyId: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
      setCopiedKey(keyId);
      setTimeout(() => {
        setCopiedKey((prev) => (prev === keyId ? null : prev));
      }, 2200);
    }
  };

  const handleRunSqlDiagnostic = async () => {
    setDiagLoading(true);
    setDiagError(null);
    try {
      const client = getClientSupabase(
        dbUrlInput.trim() || supabaseUrl,
        dbKeyInput.trim() || supabaseKey
      );
      if (!client) {
        setDiagError('Aucune base Supabase configurée. Renseignez d’abord l’URL et la clé publique dans l’onglet « Base SQL Supabase ».');
        setDiagRows([]);
        return;
      }
      const res = await runDiagnosticInstallation(client);
      if (!res.success) {
        setDiagError(res.error || 'Échec de l’exécution de public.diagnostic_installation().');
        setDiagRows([]);
      } else {
        setDiagRows(res.rows);
      }
      await recheckAppCompat().catch(() => {});
    } catch (err: any) {
      setDiagError(err?.message || 'Erreur inattendue lors du diagnostic SQL.');
      setDiagRows([]);
    } finally {
      setDiagLoading(false);
    }
  };

  const navItems: Array<{
    id: DesktopSettingsSection;
    label: string;
    icon: React.FC<{ className?: string }>;
    visible: boolean;
  }> = [
    {
      id: 'profile',
      label: tr(language, 'Profil et sécurité', 'Profile & Security', 'Profiel & Beveiliging'),
      icon: UserIcon,
      visible: true,
    },
    {
      id: 'users_roles',
      label: tr(language, 'Utilisateurs et rôles', 'Users & Roles', 'Gebruikers & Rollen'),
      icon: Users,
      visible:
        userHasPermission('perm_manage_users') ||
        userHasPermission('perm_manage_roles') ||
        userHasPermission('perm_menu_users') ||
        userHasPermission('perm_config_users'),
    },
    {
      id: 'depots',
      label: tr(language, 'Dépôts & Véhicules', 'Depots & Vehicles', 'Depots & Voertuigen'),
      icon: Warehouse,
      visible:
        userHasPermission('perm_manage_depots') ||
        userHasPermission('perm_depot_create') ||
        userHasPermission('perm_config_depots'),
    },
    {
      id: 'categories',
      label: tr(language, 'Catégories articles', 'Item Categories', 'Artikelcategorieën'),
      icon: FolderTree,
      visible:
        userHasPermission('perm_manage_categories') ||
        userHasPermission('perm_prod_edit') ||
        userHasPermission('perm_config_cats'),
    },
    {
      id: 'departments_projects',
      label: tr(
        language,
        'Départements & Projets',
        'Departments & Projects',
        'Afdelingen & Projecten'
      ),
      icon: Building2,
      visible:
        userHasPermission('perm_depproj_menu') ||
        userHasPermission('perm_dep_edit') ||
        userHasPermission('perm_proj_edit') ||
        userHasPermission('perm_config_depts'),
    },
    {
      id: 'emails_smtp',
      label: tr(
        language,
        'Entreprise & E-mails SMTP',
        'Company & SMTP Emails',
        'Bedrijf & SMTP E-mails'
      ),
      icon: Mail,
      visible: canUserManageMailSettings(currentUser, userHasPermission),
    },
    {
      id: 'license',
      label: tr(language, 'Licence & Base SQL', 'License & SQL Database', 'Licentie & SQL-database'),
      icon: Award,
      visible:
        userHasPermission('perm_header_license_badge') ||
        userHasPermission('perm_config_db') ||
        userHasPermission('perm_config_license'),
    },
    {
      id: 'print_station',
      label: tr(language, "Poste d'impression", 'Print Station', 'Afdrukstation'),
      icon: Printer,
      visible: true,
    },
    {
      id: 'documentation',
      label: tr(language, 'Documentation', 'Documentation', 'Documentatie'),
      icon: BookOpen,
      visible: true,
    },
    {
      id: 'about',
      label: tr(language, 'À propos & Installeurs', 'About & Installers', 'Over & Installatie'),
      icon: Info,
      visible: true,
    },
  ];

  const handleToggleSysSetting = async (
    key: keyof DesktopSystemSettings,
    value: boolean
  ) => {
    const updated = await setDesktopSystemSettings({ [key]: value });
    setSysSettings(updated);
  };

  return (
    <div className="flex h-full min-h-0 bg-slate-50 dark:bg-slate-950">
      <aside className="w-68 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col gap-1 overflow-y-auto">
        <div className="px-3 py-2 text-[11px] font-black uppercase tracking-wider text-slate-400">
          {tr(
            language,
            'Administration & Préférences',
            'Administration & Preferences',
            'Beheer & Voorkeuren'
          )}
        </div>
        {navItems
          .filter((item) => item.visible)
          .map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (item.id === section && item.id !== 'print_station') return;
                  requestGuardedNavigation(() => {
                    if (item.id === 'print_station' && onNavigatePrintStation) {
                      onNavigatePrintStation();
                      return;
                    }
                    setSection(item.id);
                    onChangeSection?.(item.id);
                    setSaveMessage(null);
                    setErrorMessage(null);
                  });
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold transition-colors text-left cursor-pointer ${
                  active
                    ? 'bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
      </aside>

      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto space-y-6 text-xs">
          {saveMessage && (
            <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 font-bold flex items-center justify-between">
              <span className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{saveMessage}</span>
              </span>
              <button
                type="button"
                onClick={() => setSaveMessage(null)}
                className="text-emerald-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 font-bold flex items-center justify-between">
              <span className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{errorMessage}</span>
              </span>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="text-rose-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* ===================================================================== */}
          {/* SECTION : PROFIL & SÉCURITÉ                                           */}
          {/* ===================================================================== */}
          {section === 'profile' && (
            <div className="space-y-5">
              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-orange-600" />
                  {tr(
                    language,
                    'Profil opérateur & Sécurité',
                    'Operator Profile & Security',
                    'Operatorprofiel & Beveiliging'
                  )}
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                    <div className="text-slate-400">
                      {tr(language, 'Nom complet', 'Full name', 'Volledige naam')}
                    </div>
                    <div className="text-sm font-black text-slate-900 dark:text-white mt-0.5">
                      {currentUser?.name || '—'} ({currentUser?.trigram || '—'})
                    </div>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                    <div className="text-slate-400">
                      {tr(
                        language,
                        'Adresse e-mail / Département',
                        'Email address / Department',
                        'E-mailadres / Afdeling'
                      )}
                    </div>
                    <div className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                      {currentUser?.email || tr(language, 'Locale', 'Local', 'Lokaal')} •{' '}
                      {currentUser?.department || tr(language, 'Général', 'General', 'Algemeen')}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-orange-600" />
                  {tr(
                    language,
                    'Intégration système du poste de bureau (Barre système & Notifications)',
                    'Desktop Workstation System Integration (System Tray & Notifications)',
                    'Systeemintegratie bureaubladwerkstation (Systeemvak & Meldingen)'
                  )}
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <label className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between cursor-pointer">
                    <div>
                      <div className="font-bold text-slate-800 dark:text-slate-200">
                        {tr(
                          language,
                          'Garder le poste actif dans la barre système à la fermeture',
                          'Keep workstation active in the system tray when closing',
                          'Werkstation actief houden in het systeemvak bij sluiten'
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {tr(
                          language,
                          "Continue de recevoir et d'imprimer les étiquettes en arrière-plan",
                          'Continues receiving and printing labels in the background',
                          'Blijft op de achtergrond etiketten ontvangen en afdrukken'
                        )}
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={sysSettings.keepInTrayOnClose}
                      onChange={(e) =>
                        handleToggleSysSetting('keepInTrayOnClose', e.target.checked)
                      }
                      className="rounded text-orange-600"
                    />
                  </label>

                  <label className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between cursor-pointer">
                    <div>
                      <div className="font-bold text-slate-800 dark:text-slate-200">
                        {tr(
                          language,
                          'Lancer au démarrage de la session',
                          'Launch at session login',
                          'Starten bij aanmelden'
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {tr(
                          language,
                          'Idéal pour un PC dédié au comptoir magasin (désactivé par défaut)',
                          'Ideal for a dedicated warehouse counter PC (disabled by default)',
                          'Ideaal voor een vaste balie-pc in het magazijn (standaard uitgeschakeld)'
                        )}
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={sysSettings.launchAtLogin}
                      onChange={(e) =>
                        handleToggleSysSetting('launchAtLogin', e.target.checked)
                      }
                      className="rounded text-orange-600"
                    />
                  </label>

                  <label className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between cursor-pointer col-span-2">
                    <div className="flex items-center gap-2.5">
                      <Bell className="w-4 h-4 text-orange-600" />
                      <div>
                        <div className="font-bold text-slate-800 dark:text-slate-200">
                          {tr(
                            language,
                            'Activer les notifications système natives (Windows / macOS / Linux)',
                            'Enable native system notifications (Windows / macOS / Linux)',
                            'Systeemeigen meldingen inschakelen (Windows / macOS / Linux)'
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {tr(
                            language,
                            "Alerte lors d'une commande à valider, d'une commande à préparer, d'un échec d'impression ou d'une rupture",
                            'Alerts when an order needs approval, picking, on print failure or stockout',
                            'Waarschuwt bij een te valideren of klaar te zetten bestelling, afdrukfout of voorraadtekort'
                          )}
                        </div>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={sysSettings.notificationsEnabled}
                      onChange={(e) =>
                        handleToggleSysSetting('notificationsEnabled', e.target.checked)
                      }
                      className="rounded text-orange-600"
                    />
                  </label>
                </div>
              </div>

              {/* Chiffrement des données locales & Réinitialisation sécurisée */}
              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                      <Lock className="w-4 h-4 text-emerald-600" />
                      {tr(
                        language,
                        'Chiffrer les données locales avec mon PIN',
                        'Encrypt local data with my PIN',
                        'Versleutel lokale gegevens met mijn pincode'
                      )}
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-1">
                      {cryptoMode === 'native'
                        ? tr(
                            language,
                            'Chiffrement AES-GCM 256 automatique via le trousseau sécurisé du système (Electron safeStorage / Android Keystore) sans saisie supplémentaire.',
                            'Automatic AES-GCM 256 encryption via OS secure keystore (Electron safeStorage / Android Keystore) without extra prompt.',
                            'Automatische AES-GCM 256-versleuteling via de beveiligde OS-sleutelhanger.'
                          )
                        : tr(
                            language,
                            'Chiffre la session, la clé Supabase, les mouvements et la file hors-ligne avec une clé AES-GCM 256 dérivée de votre PIN (PBKDF2-SHA256 ≥ 600 000 itérations).',
                            'Encrypts session, Supabase key, movements, and offline queue with an AES-GCM 256 key derived from your PIN (PBKDF2-SHA256 ≥ 600,000 iterations).',
                            'Versleutelt sessie, Supabase-sleutel, bewegingen en offline wachtrij met een AES-GCM 256-sleutel afgeleid van uw pincode.'
                          )}
                    </p>
                  </div>

                  {cryptoMode === 'native' ? (
                    <span className="px-3 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-black text-xs shrink-0">
                      {tr(language, 'Trousseau OS actif', 'OS Keystore active', 'OS-sleutelhanger actief')}
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={cryptoBusy}
                      onClick={() => {
                        setSaveMessage(null);
                        setErrorMessage(null);
                        setPinForCrypto('');
                        setShowPinCryptoPrompt(cryptoEnabled ? 'disable' : 'enable');
                      }}
                      className={`px-4 py-2 rounded-xl font-bold text-xs cursor-pointer transition shrink-0 ${
                        cryptoEnabled
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {cryptoEnabled
                        ? tr(language, 'Activé (Désactiver…)', 'Enabled (Disable…)', 'Ingeschakeld (Uitschakelen…)')
                        : tr(language, 'Activer avec mon PIN', 'Enable with my PIN', 'Inschakelen met mijn pincode')}
                    </button>
                  )}
                </div>

                {showPinCryptoPrompt && currentUser && (
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3">
                    <span className="font-bold text-slate-700 dark:text-slate-200">
                      {showPinCryptoPrompt === 'enable'
                        ? tr(
                            language,
                            'Saisissez votre code PIN à 4 chiffres pour chiffrer les données locales :',
                            'Enter your 4-digit PIN to encrypt local data:',
                            'Voer uw 4-cijferige pincode in om lokale gegevens te versleutelen:'
                          )
                        : tr(
                            language,
                            'Saisissez votre code PIN à 4 chiffres pour déchiffrer et désactiver :',
                            'Enter your 4-digit PIN to decrypt and disable:',
                            'Voer uw 4-cijferige pincode in om te ontsleutelen en uit te schakelen:'
                          )}
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="password"
                        inputMode="numeric"
                        maxLength={4}
                        value={pinForCrypto}
                        onChange={(e) => setPinForCrypto(e.target.value.replace(/\D/g, ''))}
                        placeholder="••••"
                        className="w-28 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-center font-bold tracking-widest"
                      />
                      <button
                        type="button"
                        disabled={cryptoBusy || pinForCrypto.length !== 4}
                        onClick={async () => {
                          setCryptoBusy(true);
                          setSaveMessage(null);
                          setErrorMessage(null);
                          try {
                            const uid = String(currentUser.id);
                            if (showPinCryptoPrompt === 'enable') {
                              if (hasLocalDevicePin(uid)) {
                                const valid = await verifyLocalDevicePin(uid, pinForCrypto);
                                if (!valid) {
                                  setErrorMessage('Code PIN local incorrect.');
                                  return;
                                }
                              } else {
                                await saveLocalDevicePin(uid, pinForCrypto);
                              }
                              const res = await enablePinLocalEncryption(pinForCrypto);
                              if (res.ok) {
                                setCryptoMode(getLocalCryptoMode());
                                setCryptoEnabled(true);
                                setShowPinCryptoPrompt(null);
                                setPinForCrypto('');
                                setSaveMessage('Chiffrement local AES-GCM 256 activé avec votre PIN.');
                              } else {
                                setErrorMessage(res.error || "Impossible d'activer le chiffrement local.");
                              }
                            } else {
                              const res = await disablePinLocalEncryption(pinForCrypto);
                              if (res.ok) {
                                setCryptoMode(getLocalCryptoMode());
                                setCryptoEnabled(false);
                                setShowPinCryptoPrompt(null);
                                setPinForCrypto('');
                                setSaveMessage('Chiffrement local désactivé et données restaurées en clair.');
                              } else {
                                setErrorMessage('Code PIN incorrect : déchiffrement refusé (aucune donnée supprimée).');
                              }
                            }
                          } finally {
                            setCryptoBusy(false);
                          }
                        }}
                        className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold disabled:opacity-50 cursor-pointer"
                      >
                        {cryptoBusy ? 'Traitement…' : 'Valider'}
                      </button>
                      <button
                        type="button"
                        disabled={cryptoBusy}
                        onClick={() => {
                          setShowPinCryptoPrompt(null);
                          setPinForCrypto('');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold cursor-pointer"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                )}

                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-bold text-slate-800 dark:text-slate-200">
                      {tr(
                        language,
                        'PIN oublié ou cache illisible : Réinitialiser les données locales',
                        'Forgotten PIN or unreadable cache: Reset local data',
                        'Pincode vergeten of onleesbare cache: Lokale gegevens resetten'
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {tr(
                        language,
                        'Tente une synchronisation préalable, affiche le nombre exact d’opérations hors-ligne non synchronisées et demande votre confirmation avant suppression.',
                        'Attempts prior sync, displays the exact count of unsynchronized offline operations, and asks for confirmation before deletion.',
                        'Probeert eerst te synchroniseren, toont het exacte aantal niet-gesynchroniseerde offline bewerkingen en vraagt om bevestiging.'
                      )}
                    </div>
                  </div>

                  {!confirmWipeDevice ? (
                    <button
                      type="button"
                      disabled={checkingUnsynced}
                      onClick={async () => {
                        setCheckingUnsynced(true);
                        try {
                          if (typeof navigator === 'undefined' || navigator.onLine !== false) {
                            try {
                              await syncFromSupabase();
                            } catch {
                              // Best-effort sync before counting unsynchronized offline operations
                            }
                          }
                          const count = await getUnsynchronizedOperationsCount();
                          setUnsyncedCountBeforeWipe(count);
                          setConfirmWipeDevice(true);
                        } finally {
                          setCheckingUnsynced(false);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 text-rose-700 dark:text-rose-300 font-bold cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>
                        {checkingUnsynced
                          ? 'Vérification…'
                          : tr(
                              language,
                              'Réinitialiser les données locales',
                              'Reset local data',
                              'Lokale gegevens resetten'
                            )}
                      </span>
                    </button>
                  ) : (
                    <div className="w-full p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-800 space-y-2">
                      <p className="font-bold text-rose-800 dark:text-rose-200">
                        {unsyncedCountBeforeWipe > 0
                          ? tr(
                              language,
                              `⚠️ Attention : ${unsyncedCountBeforeWipe} opération(s) hors-ligne non synchronisée(s) seront définitivement perdues si vous confirmez la réinitialisation.`,
                              `⚠️ Warning: ${unsyncedCountBeforeWipe} unsynchronized offline operation(s) will be permanently lost if you confirm reset.`,
                              `⚠️ Waarschuwing: ${unsyncedCountBeforeWipe} niet-gesynchroniseerde offline bewerking(en) gaan definitief verloren.`
                            )
                          : tr(
                              language,
                              '✓ Aucune opération hors-ligne en attente (0 opération perdue). Confirmez-vous la réinitialisation des données locales de ce poste ?',
                              '✓ No pending offline operations (0 operations lost). Confirm resetting local data on this workstation?',
                              '✓ Geen wachtende offline bewerkingen (0 bewerkingen verloren). Bevestigt u het resetten van de lokale gegevens?'
                            )}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={wipingDevice}
                          onClick={() => setConfirmWipeDevice(false)}
                          className="px-3.5 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
                        >
                          {t('common_cancel')}
                        </button>
                        <button
                          type="button"
                          disabled={wipingDevice}
                          onClick={async () => {
                            setWipingDevice(true);
                            await wipeDeviceAndSignOut();
                          }}
                          className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold cursor-pointer disabled:opacity-50"
                        >
                          {wipingDevice
                            ? 'Réinitialisation…'
                            : tr(
                                language,
                                'Confirmer la réinitialisation locale',
                                'Confirm local reset',
                                'Lokale reset bevestigen'
                              )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ===================================================================== */}
          {/* SECTION : UTILISATEURS & RÔLES (Tri alphabétique & Filtres colonnes)   */}
          {/* ===================================================================== */}
          {section === 'users_roles' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (usersRolesTab === 'users') return;
                      requestGuardedNavigation(() => setUsersRolesTab('users'));
                    }}
                    className={`px-4 py-2 rounded-xl font-bold transition cursor-pointer ${
                      usersRolesTab === 'users'
                        ? 'bg-orange-600 text-white'
                        : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    Utilisateurs ({users.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (usersRolesTab === 'roles') return;
                      requestGuardedNavigation(() => setUsersRolesTab('roles'));
                    }}
                    className={`px-4 py-2 rounded-xl font-bold transition cursor-pointer ${
                      usersRolesTab === 'roles'
                        ? 'bg-orange-600 text-white'
                        : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    Rôles & Permissions ({roles.length})
                  </button>
                </div>
              </div>

              {usersRolesTab === 'users' ? (
                <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-black text-slate-900 dark:text-white">
                      {editingUserId !== null ? 'Modifier l’utilisateur' : 'Ajouter un utilisateur'}
                    </h2>
                    {editingUserId !== null && (
                      <button
                        type="button"
                        onClick={resetUserForm}
                        className="px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold cursor-pointer"
                      >
                        Annuler l’édition
                      </button>
                    )}
                  </div>

                  <form
                    ref={userFormRef}
                    onSubmit={async (e) => {
                      e.preventDefault();
                      await performSaveUser();
                    }}
                    className="grid grid-cols-12 gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800"
                  >
                    <div className="col-span-4">
                      <label className="block font-bold mb-1">Nom complet</label>
                      <input
                        ref={userNameInputRef}
                        type="text"
                        value={userName}
                        onChange={(e) => setUserName(e.target.value)}
                        placeholder="Ex: Jean Dupont"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block font-bold mb-1">Trigramme</label>
                      <input
                        type="text"
                        value={userTrigram}
                        onChange={(e) => setUserTrigram(e.target.value.toUpperCase())}
                        placeholder="JDU"
                        maxLength={5}
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono uppercase"
                      />
                    </div>
                    <div className="col-span-3">
                      <label className="block font-bold mb-1">E-mail</label>
                      <input
                        type="email"
                        value={userEmail}
                        onChange={(e) => setUserEmail(e.target.value)}
                        placeholder="jean@entreprise.com"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                      />
                    </div>
                    <div className="col-span-3">
                      <label className="block font-bold mb-1">
                        {editingUserId !== null
                          ? 'Nouveau PIN / Mot de passe (optionnel)'
                          : 'PIN / Mot de passe initial'}
                      </label>
                      <input
                        type="password"
                        value={userPin}
                        onChange={(e) => setUserPin(e.target.value)}
                        placeholder={editingUserId !== null ? 'Laisser vide pour conserver' : 'Ex: 1234'}
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                      />
                    </div>

                    <div className="col-span-4">
                      <label className="block font-bold mb-1">Rôle</label>
                      <select
                        value={userRoleId}
                        onChange={(e) => setUserRoleId(Number(e.target.value))}
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                      >
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} (#{r.id})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-4">
                      <label className="block font-bold mb-1">Département</label>
                      <select
                        value={userDepartment}
                        onChange={(e) => setUserDepartment(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                      >
                        <option value="">— Aucun / Général —</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.name}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-4 flex items-end pb-1">
                      <label className="flex items-center gap-2 font-bold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={userIsPreparer}
                          onChange={(e) => setUserIsPreparer(e.target.checked)}
                          className="rounded text-orange-600"
                        />
                        <span>Préparateur de commandes magasin</span>
                      </label>
                    </div>

                    <div className="col-span-9">
                      <div className="flex items-center gap-3 flex-wrap">
                        <label className="flex items-center gap-1.5 font-bold cursor-pointer">
                          <input
                            type="checkbox"
                            checked={userAllDepots}
                            onChange={(e) => setUserAllDepots(e.target.checked)}
                            className="rounded text-orange-600"
                          />
                          <span>Accès à tous les dépôts (*)</span>
                        </label>
                        {!userAllDepots &&
                          depots.map((d) => {
                            const checked = userAllowedDepots.includes(d.name);
                            return (
                              <label
                                key={String(d.id)}
                                className="flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setUserAllowedDepots((prev) => [...prev, d.name]);
                                    } else {
                                      setUserAllowedDepots((prev) =>
                                        prev.filter((n) => n !== d.name)
                                      );
                                    }
                                  }}
                                  className="rounded text-orange-600"
                                />
                                <span>{d.name}</span>
                              </label>
                            );
                          })}
                      </div>
                    </div>

                    <div className="col-span-3 flex justify-end items-end">
                      <button
                        type="submit"
                        className="px-4 py-2 rounded-lg font-bold bg-orange-600 hover:bg-orange-700 text-white cursor-pointer"
                      >
                        {editingUserId !== null ? 'Enregistrer' : '+ Créer utilisateur'}
                      </button>
                    </div>
                  </form>

                  {/* Barre de recherche globale + Tri alphabétique + Réinitialisation des filtres colonnes */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                    <div className="relative flex-1 min-w-60">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={userGlobalSearch}
                        onChange={(e) => setUserGlobalSearch(e.target.value)}
                        placeholder="Recherche globale (nom, trigramme, e-mail, département, rôle)..."
                        className="w-full pl-8 pr-8 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                      />
                      {userGlobalSearch && (
                        <button
                          type="button"
                          onClick={() => setUserGlobalSearch('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-slate-500">Tri :</span>
                      <select
                        value={`${userSortCol}:${userSortDir}`}
                        onChange={(e) => {
                          const [col, dir] = e.target.value.split(':') as [
                            UserSortColumn,
                            'asc' | 'desc'
                          ];
                          setUserSortCol(col);
                          setUserSortDir(dir);
                        }}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold"
                      >
                        <option value="name:asc">Nom (A → Z)</option>
                        <option value="name:desc">Nom (Z → A)</option>
                        <option value="trigram:asc">Trigramme (A → Z)</option>
                        <option value="trigram:desc">Trigramme (Z → A)</option>
                        <option value="email:asc">E-mail (A → Z)</option>
                        <option value="email:desc">E-mail (Z → A)</option>
                        <option value="department:asc">Département (A → Z)</option>
                        <option value="department:desc">Département (Z → A)</option>
                        <option value="role:asc">Rôle (A → Z)</option>
                        <option value="role:desc">Rôle (Z → A)</option>
                        <option value="status:asc">Statut (Actifs d'abord)</option>
                        <option value="status:desc">Statut (Bloqués d'abord)</option>
                      </select>

                      {(userGlobalSearch ||
                        userColFilterTrigram ||
                        userColFilterName ||
                        userColFilterEmail ||
                        userColFilterDept !== 'ALL' ||
                        userColFilterRole !== 'ALL' ||
                        userColFilterStatus !== 'ALL') && (
                        <button
                          type="button"
                          onClick={() => {
                            setUserGlobalSearch('');
                            setUserColFilterTrigram('');
                            setUserColFilterName('');
                            setUserColFilterEmail('');
                            setUserColFilterDept('ALL');
                            setUserColFilterRole('ALL');
                            setUserColFilterStatus('ALL');
                          }}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-orange-600 font-bold hover:bg-orange-50 dark:hover:bg-orange-950/30 cursor-pointer"
                        >
                          Effacer filtres
                        </button>
                      )}
                      <span className="text-[11px] font-bold text-slate-400">
                        {filteredAndSortedUsers.length} / {users.length}
                      </span>
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-slate-50 dark:bg-slate-800 text-[10px] font-bold uppercase text-slate-500">
                        <tr>
                          <th className="py-2 px-3">
                            <button
                              type="button"
                              onClick={() => toggleUserSortColumn('trigram')}
                              className="inline-flex items-center gap-1 hover:text-orange-600 cursor-pointer uppercase"
                            >
                              <span>Trigramme</span>
                              <ArrowUpDown className="w-3 h-3" />
                            </button>
                          </th>
                          <th className="py-2 px-3">
                            <button
                              type="button"
                              onClick={() => toggleUserSortColumn('name')}
                              className="inline-flex items-center gap-1 hover:text-orange-600 cursor-pointer uppercase"
                            >
                              <span>Nom</span>
                              <ArrowUpDown className="w-3 h-3" />
                            </button>
                          </th>
                          <th className="py-2 px-3">
                            <button
                              type="button"
                              onClick={() => toggleUserSortColumn('email')}
                              className="inline-flex items-center gap-1 hover:text-orange-600 cursor-pointer uppercase"
                            >
                              <span>E-mail</span>
                              <ArrowUpDown className="w-3 h-3" />
                            </button>
                          </th>
                          <th className="py-2 px-3">
                            <button
                              type="button"
                              onClick={() => toggleUserSortColumn('department')}
                              className="inline-flex items-center gap-1 hover:text-orange-600 cursor-pointer uppercase"
                            >
                              <span>Département</span>
                              <ArrowUpDown className="w-3 h-3" />
                            </button>
                          </th>
                          <th className="py-2 px-3">
                            <button
                              type="button"
                              onClick={() => toggleUserSortColumn('role')}
                              className="inline-flex items-center gap-1 hover:text-orange-600 cursor-pointer uppercase"
                            >
                              <span>Rôle</span>
                              <ArrowUpDown className="w-3 h-3" />
                            </button>
                          </th>
                          <th className="py-2 px-3">
                            <button
                              type="button"
                              onClick={() => toggleUserSortColumn('status')}
                              className="inline-flex items-center gap-1 hover:text-orange-600 cursor-pointer uppercase"
                            >
                              <span>Statut</span>
                              <ArrowUpDown className="w-3 h-3" />
                            </button>
                          </th>
                          <th className="py-2 px-3 text-right">Actions</th>
                        </tr>
                        {/* Ligne de filtres par colonne */}
                        <tr className="bg-slate-100/70 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700 normal-case font-normal">
                          <th className="py-1.5 px-2">
                            <input
                              type="text"
                              value={userColFilterTrigram}
                              onChange={(e) => setUserColFilterTrigram(e.target.value)}
                              placeholder="Filtrer trig..."
                              className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-mono"
                            />
                          </th>
                          <th className="py-1.5 px-2">
                            <input
                              type="text"
                              value={userColFilterName}
                              onChange={(e) => setUserColFilterName(e.target.value)}
                              placeholder="Filtrer nom..."
                              className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px]"
                            />
                          </th>
                          <th className="py-1.5 px-2">
                            <input
                              type="text"
                              value={userColFilterEmail}
                              onChange={(e) => setUserColFilterEmail(e.target.value)}
                              placeholder="Filtrer e-mail..."
                              className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-mono"
                            />
                          </th>
                          <th className="py-1.5 px-2">
                            <select
                              value={userColFilterDept}
                              onChange={(e) => setUserColFilterDept(e.target.value)}
                              className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px]"
                            >
                              <option value="ALL">Tous départements</option>
                              <option value="__NONE__">— Sans département —</option>
                              {departments.map((d) => (
                                <option key={d.id} value={d.name}>
                                  {d.name}
                                </option>
                              ))}
                            </select>
                          </th>
                          <th className="py-1.5 px-2">
                            <select
                              value={userColFilterRole}
                              onChange={(e) => setUserColFilterRole(e.target.value)}
                              className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px]"
                            >
                              <option value="ALL">Tous rôles</option>
                              {roles.map((r) => (
                                <option key={r.id} value={String(r.id)}>
                                  {r.name} (#{r.id})
                                </option>
                              ))}
                            </select>
                          </th>
                          <th className="py-1.5 px-2">
                            <select
                              value={userColFilterStatus}
                              onChange={(e) =>
                                setUserColFilterStatus(
                                  e.target.value as 'ALL' | 'ACTIVE' | 'BLOCKED' | 'PREPARER'
                                )
                              }
                              className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px]"
                            >
                              <option value="ALL">Tous statuts</option>
                              <option value="ACTIVE">Actif</option>
                              <option value="BLOCKED">Bloqué</option>
                              <option value="PREPARER">Préparateur</option>
                            </select>
                          </th>
                          <th className="py-1.5 px-2 text-right text-[10px] text-slate-400">
                            Col. filtrées
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {filteredAndSortedUsers.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-6 text-center text-slate-400 font-semibold">
                              Aucun utilisateur ne correspond aux filtres de colonnes sélectionnés.
                            </td>
                          </tr>
                        ) : (
                          filteredAndSortedUsers.map((u) => {
                            const roleNameStr =
                              roles.find((r) => r.id === u.role_id)?.name || `Rôle #${u.role_id}`;
                            const isSuper = Number(u.id) === 0 || Number(u.role_id) === 0;
                            return (
                              <tr key={String(u.id)} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                                <td className="py-2 px-3 font-mono font-bold text-orange-600">
                                  {u.trigram}
                                </td>
                                <td className="py-2 px-3 font-bold text-slate-900 dark:text-white">
                                  {u.name}
                                  {u.is_preparer && (
                                    <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">
                                      Préparateur
                                    </span>
                                  )}
                                </td>
                                <td className="py-2 px-3 font-mono text-slate-500">
                                  {u.email || '—'}
                                </td>
                                <td className="py-2 px-3">{u.department || '—'}</td>
                                <td className="py-2 px-3 font-semibold">{roleNameStr}</td>
                                <td className="py-2 px-3">
                                  {u.is_blocked ? (
                                    <span className="text-rose-600 font-bold">Bloqué</span>
                                  ) : (
                                    <span className="text-emerald-600 font-bold">Actif</span>
                                  )}
                                </td>
                                <td className="py-2 px-3 text-right">
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => startEditUser(u)}
                                      className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
                                      title="Modifier l'utilisateur"
                                    >
                                      <Edit3 className="w-3.5 h-3.5" />
                                    </button>
                                    {!isSuper && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={async () => {
                                            await toggleBlockUser(u.id);
                                          }}
                                          className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-amber-600 cursor-pointer"
                                          title={u.is_blocked ? 'Débloquer' : 'Bloquer'}
                                        >
                                          {u.is_blocked ? (
                                            <Unlock className="w-3.5 h-3.5" />
                                          ) : (
                                            <Lock className="w-3.5 h-3.5" />
                                          )}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={async () => {
                                            await deleteUser(u.id);
                                          }}
                                          className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 cursor-pointer"
                                          title="Supprimer l'utilisateur"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-base font-black text-slate-900 dark:text-white">
                      {editingRoleId !== null
                        ? `Modifier le rôle « ${roleName} » (#${editingRoleId})`
                        : 'Rôles & Matrice des Permissions'}
                    </h2>
                    <div className="flex items-center gap-2">
                      {editingRoleId !== null && (
                        <button
                          type="button"
                          onClick={resetRoleForm}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold cursor-pointer"
                        >
                          + Nouveau rôle
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={async () => {
                          await resetRolesToRecommended();
                          setSaveMessage('Les 11 rôles recommandés ont été rétablis.');
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold cursor-pointer"
                        title="Rétablir les 11 rôles standards"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Rôles recommandés</span>
                      </button>
                    </div>
                  </div>

                  {/* Barre de recherche & tri alphabétique des rôles */}
                  <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                    <div className="relative flex-1 min-w-56">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={roleSearch}
                        onChange={(e) => setRoleSearch(e.target.value)}
                        placeholder="Rechercher un rôle par nom ou #ID..."
                        className="w-full pl-8 pr-8 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                      {roleSearch && (
                        <button
                          type="button"
                          onClick={() => setRoleSearch('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-slate-500">Tri des rôles :</span>
                      <select
                        value={roleSortBy}
                        onChange={(e) =>
                          setRoleSortBy(
                            e.target.value as 'name_asc' | 'name_desc' | 'id_asc' | 'perms_desc'
                          )
                        }
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                      >
                        <option value="name_asc">Ordre alphabétique (A → Z)</option>
                        <option value="name_desc">Ordre alphabétique (Z → A)</option>
                        <option value="id_asc">Par identifiant (#0 → #10)</option>
                        <option value="perms_desc">Par nombre de permissions</option>
                      </select>
                      <span className="text-[11px] font-bold text-slate-400">
                        {filteredAndSortedRoles.length} / {roles.length}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {filteredAndSortedRoles.map((r) => {
                      const assignedUsersCount = users.filter(
                        (u) => Number(u.role_id) === Number(r.id)
                      ).length;
                      return (
                        <div
                          key={r.id}
                          className={`p-3 rounded-xl border flex items-center justify-between ${
                            editingRoleId === r.id
                              ? 'border-orange-500 bg-orange-50/50 dark:bg-orange-950/30'
                              : 'border-slate-200 dark:border-slate-800'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="font-bold text-slate-900 dark:text-white truncate">
                              {r.name} <span className="text-slate-400 font-mono">#{r.id}</span>
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {r.id === 0
                                ? 'Accès intégral (*)'
                                : `${(r.permissions || []).length} permissions`}{' '}
                              • {assignedUsersCount} util.
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => startEditRole(r)}
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
                              title="Modifier ce rôle"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            {r.id !== 0 && (
                              <button
                                type="button"
                                onClick={async () => {
                                  await deleteRole(r.id);
                                  if (editingRoleId === r.id) resetRoleForm();
                                }}
                                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-rose-50 text-rose-600 cursor-pointer"
                                title="Supprimer ce rôle"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <form
                    ref={roleFormRef}
                    onSubmit={async (e) => {
                      e.preventDefault();
                      await performSaveRole();
                    }}
                    className="space-y-4 pt-2 border-t border-slate-200 dark:border-slate-800"
                  >
                    <div className="flex items-end gap-3">
                      <div className="flex-1">
                        <label className="block font-bold mb-1">Nom du rôle</label>
                        <input
                          ref={roleNameInputRef}
                          type="text"
                          value={roleName}
                          onChange={(e) => setRoleName(e.target.value)}
                          placeholder="Ex: Responsable Logistique"
                          className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block font-bold mb-1">Filtrer les permissions</label>
                        <input
                          type="text"
                          value={permSearch}
                          onChange={(e) => setPermSearch(e.target.value)}
                          placeholder={tr(
                            language,
                            'Rechercher une permission...',
                            'Search permission...',
                            'Machtiging zoeken...'
                          )}
                          className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                        />
                      </div>
                      <button
                        type="submit"
                        className="px-4 py-2 rounded-lg font-bold bg-orange-600 hover:bg-orange-700 text-white cursor-pointer"
                      >
                        {editingRoleId !== null
                          ? tr(language, 'Enregistrer le rôle', 'Save role', 'Rol opslaan')
                          : tr(language, '+ Créer le rôle', '+ Create role', '+ Rol aanmaken')}
                      </button>
                    </div>

                    <div className="max-h-96 overflow-y-auto space-y-3 pr-1">
                      {MENU_PERMISSION_GROUPS.map((group) => {
                        const buttons = group.buttons.filter((b) => {
                          if (!permSearch.trim()) return true;
                          const q = permSearch.trim().toLowerCase();
                          return (
                            b.labelFr.toLowerCase().includes(q) ||
                            b.labelEn.toLowerCase().includes(q) ||
                            b.key.toLowerCase().includes(q) ||
                            b.descFr.toLowerCase().includes(q) ||
                            b.descEn.toLowerCase().includes(q)
                          );
                        });
                        if (buttons.length === 0) return null;
                        return (
                          <div
                            key={group.id}
                            className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2"
                          >
                            <div className="font-bold text-slate-800 dark:text-slate-200">
                              {group.icon} {tr(language, group.nameFr, group.nameEn)}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              {buttons.map((btn) => {
                                const checked =
                                  rolePermissions.includes('*') ||
                                  rolePermissions.includes(btn.key);
                                return (
                                  <label
                                    key={btn.key}
                                    className="flex items-start gap-2 p-2 rounded-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setRolePermissions((prev) =>
                                            Array.from(new Set([...prev, btn.key]))
                                          );
                                        } else {
                                          setRolePermissions((prev) =>
                                            prev.filter((k) => k !== btn.key && k !== '*')
                                          );
                                        }
                                      }}
                                      className="mt-0.5 rounded text-orange-600"
                                    />
                                    <div className="min-w-0">
                                      <div className="font-semibold text-slate-900 dark:text-white">
                                        {tr(language, btn.labelFr, btn.labelEn)}
                                      </div>
                                      <div className="text-[10px] font-mono text-slate-400">
                                        {btn.key}
                                      </div>
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* ===================================================================== */}
          {/* SECTION : DÉPÔTS, MAGASINS & VÉHICULES (Filtres, Tri & Unicité)        */}
          {/* ===================================================================== */}
          {section === 'depots' && (
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-black text-slate-900 dark:text-white">
                    Dépôts, Magasins & Véhicules ({depots.length})
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Quota licence : {activeDepotsCount} / {maxDepots} dépôt(s) actif(s)
                  </p>
                </div>
                {editingDepotId !== null && (
                  <button
                    type="button"
                    onClick={resetDepotForm}
                    className="px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold cursor-pointer"
                  >
                    Annuler l’édition
                  </button>
                )}
              </div>

              <form
                ref={depotFormRef}
                onSubmit={async (e) => {
                  e.preventDefault();
                  await performSaveDepot();
                }}
                className="grid grid-cols-12 gap-2.5 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800"
              >
                <div className="col-span-4">
                  <label className="block font-bold mb-1">Nom du dépôt / véhicule (unique)</label>
                  <input
                    ref={depotNameInputRef}
                    type="text"
                    value={newDepotName}
                    onChange={(e) => setNewDepotName(e.target.value)}
                    placeholder="Nom du dépôt..."
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
                <div className="col-span-3">
                  <label className="block font-bold mb-1">Type</label>
                  <select
                    value={newDepotType}
                    onChange={(e) =>
                      setNewDepotType(e.target.value as 'FIXED' | 'VEHICLE' | 'CONTAINER')
                    }
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  >
                    <option value="FIXED">Magasin Fixe (FIXED)</option>
                    <option value="VEHICLE">Véhicule / Camionnette (VEHICLE)</option>
                    <option value="CONTAINER">Conteneur Chantier (CONTAINER)</option>
                  </select>
                </div>
                <div className="col-span-5">
                  <label className="block font-bold mb-1">Adresse / Immatriculation</label>
                  <input
                    type="text"
                    value={newDepotAddress}
                    onChange={(e) => setNewDepotAddress(e.target.value)}
                    placeholder="Adresse ou plaque..."
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>

                <div className="col-span-4">
                  <label className="block font-bold mb-1">Responsable</label>
                  <select
                    value={newDepotManagerId}
                    onChange={(e) => setNewDepotManagerId(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  >
                    <option value="">— Aucun —</option>
                    {users.map((u) => (
                      <option key={String(u.id)} value={String(u.id)}>
                        {u.name} ({u.trigram})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-5">
                  <label className="block font-bold mb-1">Zones de retrait (séparées par virgule)</label>
                  <input
                    type="text"
                    value={newDepotPickupZones}
                    onChange={(e) => setNewDepotPickupZones(e.target.value)}
                    placeholder="Ex: Comptoir A, Casier Extérieur"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
                <div className="col-span-3 flex items-end justify-end gap-2">
                  <button
                    type="submit"
                    className="w-full py-2 px-3 rounded-lg font-bold bg-orange-600 hover:bg-orange-700 text-white cursor-pointer"
                  >
                    {editingDepotId !== null ? 'Enregistrer' : '+ Ajouter'}
                  </button>
                </div>
              </form>

              {/* Barre de filtres et de tri pour les Dépôts */}
              <div className="grid grid-cols-12 gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 items-center">
                <div className="col-span-4 relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={depotSearch}
                    onChange={(e) => setDepotSearch(e.target.value)}
                    placeholder="Rechercher un dépôt, adresse, plaque..."
                    className="w-full pl-8 pr-7 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                  {depotSearch && (
                    <button
                      type="button"
                      onClick={() => setDepotSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="col-span-2">
                  <select
                    value={depotTypeFilter}
                    onChange={(e) =>
                      setDepotTypeFilter(
                        e.target.value as 'ALL' | 'FIXED' | 'VEHICLE' | 'CONTAINER'
                      )
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold"
                  >
                    <option value="ALL">Tous les types</option>
                    <option value="FIXED">Magasins fixes</option>
                    <option value="VEHICLE">Véhicules</option>
                    <option value="CONTAINER">Conteneurs</option>
                  </select>
                </div>

                <div className="col-span-2">
                  <select
                    value={depotManagerFilter}
                    onChange={(e) => setDepotManagerFilter(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold"
                  >
                    <option value="ALL">Tous responsables</option>
                    <option value="__NONE__">— Sans responsable —</option>
                    {users.map((u) => (
                      <option key={String(u.id)} value={String(u.id)}>
                        {u.name} ({u.trigram})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-span-2">
                  <select
                    value={depotStatusFilter}
                    onChange={(e) =>
                      setDepotStatusFilter(e.target.value as 'ALL' | 'OPEN' | 'CLOSED')
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold"
                  >
                    <option value="ALL">Tous statuts</option>
                    <option value="OPEN">Ouverts / Actifs</option>
                    <option value="CLOSED">Fermés</option>
                  </select>
                </div>

                <div className="col-span-2">
                  <select
                    value={depotSortBy}
                    onChange={(e) =>
                      setDepotSortBy(
                        e.target.value as 'name_asc' | 'name_desc' | 'type_asc' | 'status'
                      )
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                  >
                    <option value="name_asc">Tri : A → Z</option>
                    <option value="name_desc">Tri : Z → A</option>
                    <option value="type_asc">Tri : Par type</option>
                    <option value="status">Tri : Par statut</option>
                  </select>
                </div>
              </div>

              {filteredAndSortedDepots.length === 0 ? (
                <div className="p-8 text-center text-slate-400 font-semibold border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  Aucun dépôt ou véhicule ne correspond aux filtres sélectionnés.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {filteredAndSortedDepots.map((d) => {
                    const mgr = users.find((u) => String(u.id) === String(d.manager_id));
                    return (
                      <div
                        key={String(d.id)}
                        className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 dark:text-white truncate">
                            {d.name}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {d.type || 'FIXED'} {d.address ? `• ${d.address}` : ''}
                            {mgr
                              ? ` • Resp: ${mgr.name} (${mgr.trigram})`
                              : d.manager_name
                                ? ` • Resp: ${d.manager_name}`
                                : ''}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={async () => {
                              await toggleDepotStatus(d.id);
                            }}
                            className={`px-2 py-1 rounded text-[10px] font-bold cursor-pointer ${
                              d.is_active !== false
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-slate-200 text-slate-600'
                            }`}
                            title="Basculer Ouvert / Fermé"
                          >
                            {d.is_active !== false ? 'Ouvert' : 'Fermé'}
                          </button>
                          <button
                            type="button"
                            onClick={() => startEditDepot(d)}
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
                            title="Modifier ce dépôt"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const res = await deleteDepot(d.id);
                              if (!res.success) setErrorMessage(res.message);
                            }}
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-rose-50 text-rose-600 cursor-pointer"
                            title="Supprimer ce dépôt"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ===================================================================== */}
          {/* SECTION : CATÉGORIES D'ARTICLES (Recherche, Tri A-Z & Unicité)        */}
          {/* ===================================================================== */}
          {section === 'categories' && (
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-black text-slate-900 dark:text-white">
                    Catégories d'articles ({subCategories.length})
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Unicité stricte du nom de catégorie • Recherche instantanée et tri alphabétique
                  </p>
                </div>

                {categoryDuplicateIds.length > 0 && (
                  <button
                    type="button"
                    onClick={handleDeduplicateCategories}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-100 hover:bg-amber-200 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-bold cursor-pointer border border-amber-300 dark:border-amber-800"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>
                      Supprimer les doublons détectés ({categoryDuplicateIds.length})
                    </span>
                  </button>
                )}
              </div>

              {/* Formulaire d'ajout de catégorie avec contrôle d'unicité */}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setSaveMessage(null);
                  setErrorMessage(null);
                  const clean = newCategoryName.trim();
                  if (!clean) return;
                  const exists = subCategories.some(
                    (sc) => sc.name.trim().toLowerCase() === clean.toLowerCase()
                  );
                  if (exists) {
                    setErrorMessage(
                      `La catégorie « ${clean} » existe déjà. Chaque catégorie doit être unique.`
                    );
                    return;
                  }
                  const ok = await saveSubCategory(clean);
                  if (ok) {
                    setNewCategoryName('');
                    setSaveMessage(`Catégorie « ${clean} » ajoutée.`);
                  } else {
                    setErrorMessage(
                      `Impossible d'ajouter « ${clean} » : cette catégorie existe déjà.`
                    );
                  }
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="Nouvelle catégorie (nom unique)..."
                  className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 px-4 py-2 rounded-lg font-bold bg-orange-600 hover:bg-orange-700 text-white cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Ajouter
                </button>
              </form>

              {/* Barre de recherche et de tri alphabétique des catégories */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                <div className="relative flex-1 min-w-60">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={categorySearch}
                    onChange={(e) => setCategorySearch(e.target.value)}
                    placeholder="Rechercher une catégorie..."
                    className="w-full pl-8 pr-8 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                  {categorySearch && (
                    <button
                      type="button"
                      onClick={() => setCategorySearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setCategorySortBy((prev) =>
                        prev === 'name_asc' ? 'name_desc' : 'name_asc'
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold text-slate-700 dark:text-slate-200 hover:border-orange-500 cursor-pointer"
                  >
                    {categorySortBy === 'name_desc' ? (
                      <ArrowUpAZ className="w-3.5 h-3.5 text-orange-600" />
                    ) : (
                      <ArrowDownAZ className="w-3.5 h-3.5 text-orange-600" />
                    )}
                    <span>{categorySortBy === 'name_desc' ? 'Z → A' : 'A → Z'}</span>
                  </button>

                  <select
                    value={categorySortBy}
                    onChange={(e) =>
                      setCategorySortBy(
                        e.target.value as 'name_asc' | 'name_desc' | 'count_desc' | 'id_asc'
                      )
                    }
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                  >
                    <option value="name_asc">Ordre alphabétique (A → Z)</option>
                    <option value="name_desc">Ordre alphabétique (Z → A)</option>
                    <option value="count_desc">Par nombre d'articles</option>
                    <option value="id_asc">Par ordre d'ajout</option>
                  </select>

                  <span className="text-[11px] font-bold text-slate-400">
                    {filteredAndSortedCategories.length} / {subCategories.length}
                  </span>
                </div>
              </div>

              {filteredAndSortedCategories.length === 0 ? (
                <div className="p-8 text-center text-slate-400 font-semibold border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  Aucune catégorie ne correspond à « {categorySearch} ».
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {filteredAndSortedCategories.map((sc) => {
                    const artCount = productCountByCatId.get(sc.id) || 0;
                    const isDup = categoryDuplicateIds.includes(sc.id);
                    return (
                      <div
                        key={sc.id}
                        className={`p-2.5 rounded-lg border flex items-center justify-between gap-2 ${
                          isDup
                            ? 'border-amber-400 bg-amber-50/40 dark:bg-amber-950/20'
                            : 'border-slate-200 dark:border-slate-800'
                        }`}
                      >
                        {editingCatId === sc.id ? (
                          <div className="flex items-center gap-1 flex-1 min-w-0">
                            <input
                              ref={catEditInputRef}
                              type="text"
                              value={editingCatName}
                              onChange={(e) => setEditingCatName(e.target.value)}
                              className="flex-1 min-w-0 px-2 py-1 rounded border border-orange-400 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                            />
                            <button
                              type="button"
                              onClick={async () => {
                                await performSaveCategoryEdit();
                              }}
                              className="p-1 rounded bg-emerald-600 text-white cursor-pointer"
                              title="Valider"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingCatId(null)}
                              className="p-1 rounded border border-slate-200 dark:border-slate-700 text-slate-500 cursor-pointer"
                              title="Annuler"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold truncate text-slate-900 dark:text-white">
                                {sc.name}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                {artCount} article{artCount > 1 ? 's' : ''}
                                {isDup ? ' • Doublon' : ''}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingCatId(sc.id);
                                  setEditingCatName(sc.name);
                                  scrollToAndFocusForm(catEditInputRef.current, catEditInputRef.current);
                                }}
                                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
                                title="Renommer la catégorie"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteSubCategory(sc.id)}
                                className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                                title="Supprimer la catégorie"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ===================================================================== */}
          {/* SECTION : DÉPARTEMENTS & CHANTIERS/PROJETS                            */}
          {/* ===================================================================== */}
          {section === 'departments_projects' && (
            <div className="space-y-6">
              {/* Départements */}
              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-black text-slate-900 dark:text-white">
                      Départements ({departments.length})
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Cliquez sur un département pour afficher ses chantiers, ou sur « Tous » pour afficher tous les chantiers
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedDeptForProjects((prev) =>
                          prev === 'ALL' ? 'NONE' : 'ALL'
                        )
                      }
                      className={`px-3.5 py-1.5 rounded-xl font-bold transition cursor-pointer ${
                        selectedDeptForProjects === 'ALL'
                          ? 'bg-orange-600 text-white shadow-xs'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-orange-50 dark:hover:bg-orange-950/40'
                      }`}
                    >
                      Tous ({projects.length} chantiers)
                    </button>
                    {editingDeptId !== null && (
                      <button
                        type="button"
                        onClick={resetDeptForm}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold cursor-pointer"
                      >
                        Annuler l’édition
                      </button>
                    )}
                  </div>
                </div>

                <form
                  ref={deptFormRef}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await performSaveDept();
                  }}
                  className="grid grid-cols-12 gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800"
                >
                  <div className="col-span-4">
                    <label className="block font-bold mb-1">Nom du département (unique)</label>
                    <input
                      ref={deptNameInputRef}
                      type="text"
                      value={deptName}
                      onChange={(e) => setDeptName(e.target.value)}
                      placeholder="Ex: Électricité / CVC"
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div className="col-span-4">
                    <label className="block font-bold mb-1">Responsable de département</label>
                    <select
                      value={deptManagerId}
                      onChange={(e) => setDeptManagerId(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    >
                      <option value="">— Aucun —</option>
                      {users.map((u) => (
                        <option key={String(u.id)} value={String(u.id)}>
                          {u.name} ({u.trigram})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-4 flex items-end pb-1">
                    <label className="flex items-center gap-2 font-bold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={deptIsPreparer}
                        onChange={(e) => setDeptIsPreparer(e.target.checked)}
                        className="rounded text-orange-600"
                      />
                      <span>Service Préparateurs Magasin</span>
                    </label>
                  </div>

                  <div className="col-span-5 flex items-center gap-2">
                    <label className="flex items-center gap-2 font-bold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={deptRequireApproval}
                        onChange={(e) => setDeptRequireApproval(e.target.checked)}
                        className="rounded text-orange-600"
                      />
                      <span>Validation hiérarchique dès (€) :</span>
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={deptApprovalThreshold}
                      onChange={(e) => setDeptApprovalThreshold(e.target.value)}
                      disabled={!deptRequireApproval}
                      className="w-24 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono disabled:opacity-50"
                    />
                  </div>

                  <div className="col-span-7 flex justify-end items-center">
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-lg font-bold bg-orange-600 hover:bg-orange-700 text-white cursor-pointer"
                    >
                      {editingDeptId !== null
                        ? 'Enregistrer le département'
                        : '+ Créer département'}
                    </button>
                  </div>
                </form>

                {/* Filtres et tri des départements */}
                <div className="grid grid-cols-12 gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 items-center">
                  <div className="col-span-5 relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={deptSearch}
                      onChange={(e) => setDeptSearch(e.target.value)}
                      placeholder="Rechercher un département ou responsable..."
                      className="w-full pl-8 pr-7 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                    {deptSearch && (
                      <button
                        type="button"
                        onClick={() => setDeptSearch('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="col-span-4">
                    <select
                      value={deptManagerFilter}
                      onChange={(e) => setDeptManagerFilter(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold"
                    >
                      <option value="ALL">Tous les responsables de département</option>
                      <option value="__NONE__">— Sans responsable —</option>
                      {users.map((u) => (
                        <option key={String(u.id)} value={String(u.id)}>
                          {u.name} ({u.trigram})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-3">
                    <select
                      value={deptSortBy}
                      onChange={(e) =>
                        setDeptSortBy(
                          e.target.value as 'name_asc' | 'name_desc' | 'projects_desc'
                        )
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                    >
                      <option value="name_asc">Tri : A → Z</option>
                      <option value="name_desc">Tri : Z → A</option>
                      <option value="projects_desc">Tri : Nb de chantiers</option>
                    </select>
                  </div>
                </div>

                {/* Liste des Départements cliquables */}
                <div className="grid grid-cols-2 gap-3">
                  {filteredAndSortedDepartments.map((d) => {
                    const mgr = users.find((u) => String(u.id) === String(d.manager_id));
                    const countProj = projectCountByDeptId.get(d.id) || 0;
                    const isSelected = String(selectedDeptForProjects) === String(d.id);
                    return (
                      <div
                        key={d.id}
                        onClick={() => {
                          setSelectedDeptForProjects((prev) =>
                            String(prev) === String(d.id) ? 'NONE' : String(d.id)
                          );
                          setProjDeptId(String(d.id));
                        }}
                        className={`p-3.5 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition ${
                          isSelected
                            ? 'border-orange-500 ring-2 ring-orange-500/20 bg-orange-50/40 dark:bg-orange-950/30'
                            : 'border-slate-200 dark:border-slate-800 hover:border-orange-400/60'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5 flex-wrap">
                            <span>{d.name}</span>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                isSelected
                                  ? 'bg-orange-600 text-white'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              {countProj} chantier{countProj > 1 ? 's' : ''}
                            </span>
                            {d.is_preparer_dept && (
                              <span className="px-2 py-0.5 rounded bg-orange-100 text-orange-700 text-[10px] font-bold">
                                Préparateurs
                              </span>
                            )}
                            {d.require_order_approval && (
                              <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-700 text-[10px] font-bold">
                                Seuil {d.order_approval_threshold ?? 0} €
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            Responsable : {mgr ? `${mgr.name} (${mgr.trigram})` : '—'}
                          </div>
                        </div>
                        <div
                          className="flex items-center gap-1 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => startEditDept(d)}
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
                            title="Modifier ce département"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteDepartment(d.id)}
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-rose-50 text-rose-600 cursor-pointer"
                            title="Supprimer ce département"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Chantiers / Projets */}
              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base font-black text-slate-900 dark:text-white">
                      Chantiers / Projets (
                      {selectedDeptForProjects === 'NONE'
                        ? 0
                        : filteredAndSortedProjects.length}{' '}
                      / {projects.length})
                    </h2>
                    {/* Boutons rapides : Tous + par département */}
                    <button
                      type="button"
                      onClick={() => setSelectedDeptForProjects('ALL')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                        selectedDeptForProjects === 'ALL'
                          ? 'bg-orange-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200'
                      }`}
                    >
                      Tous ({projects.length})
                    </button>
                    {departments.map((d) => {
                      const active = String(selectedDeptForProjects) === String(d.id);
                      const c = projectCountByDeptId.get(d.id) || 0;
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => {
                            setSelectedDeptForProjects(String(d.id));
                            setProjDeptId(String(d.id));
                          }}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                            active
                              ? 'bg-orange-600 text-white'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200'
                          }`}
                        >
                          {d.name} ({c})
                        </button>
                      );
                    })}
                  </div>
                  {editingProjectId !== null && (
                    <button
                      type="button"
                      onClick={resetProjForm}
                      className="px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold cursor-pointer"
                    >
                      Annuler l’édition
                    </button>
                  )}
                </div>

                <form
                  ref={projFormRef}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await performSaveProj();
                  }}
                  className="grid grid-cols-12 gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800"
                >
                  <div className="col-span-3">
                    <label className="block font-bold mb-1">N° Chantier (unique)</label>
                    <input
                      ref={projNumberInputRef}
                      type="text"
                      value={projNumber}
                      onChange={(e) => setProjNumber(e.target.value.toUpperCase())}
                      placeholder="CH-2026-01"
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono uppercase"
                    />
                  </div>
                  <div className="col-span-3">
                    <label className="block font-bold mb-1">Nom du chantier</label>
                    <input
                      type="text"
                      value={projName}
                      onChange={(e) => setProjName(e.target.value)}
                      placeholder="Résidence du Parc"
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div className="col-span-3">
                    <label className="block font-bold mb-1">Département</label>
                    <select
                      value={projDeptId}
                      onChange={(e) => setProjDeptId(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    >
                      <option value="">— Choisir —</option>
                      {departments.map((d) => (
                        <option key={d.id} value={String(d.id)}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-3">
                    <label className="block font-bold mb-1">Chef de chantier</label>
                    <select
                      value={projManagerId}
                      onChange={(e) => setProjManagerId(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    >
                      <option value="">— Aucun —</option>
                      {users.map((u) => (
                        <option key={String(u.id)} value={String(u.id)}>
                          {u.name} ({u.trigram})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-12 flex justify-end">
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-lg font-bold bg-orange-600 hover:bg-orange-700 text-white cursor-pointer"
                    >
                      {editingProjectId !== null ? 'Enregistrer le chantier' : '+ Créer chantier'}
                    </button>
                  </div>
                </form>

                {/* Barre de filtres avancés sur les Chantiers / Projets */}
                <div className="grid grid-cols-12 gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 items-center">
                  <div className="col-span-3 relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={projSearch}
                      onChange={(e) => {
                        setProjSearch(e.target.value);
                        if (selectedDeptForProjects === 'NONE') {
                          setSelectedDeptForProjects('ALL');
                        }
                      }}
                      placeholder="N° ou nom du chantier..."
                      className="w-full pl-8 pr-7 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                    {projSearch && (
                      <button
                        type="button"
                        onClick={() => setProjSearch('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="col-span-2">
                    <select
                      value={selectedDeptForProjects}
                      onChange={(e) => setSelectedDeptForProjects(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold"
                    >
                      <option value="NONE">— Choisir département —</option>
                      <option value="ALL">Tous les départements</option>
                      {departments.map((d) => (
                        <option key={d.id} value={String(d.id)}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="col-span-2">
                    <select
                      value={projDeptManagerFilter}
                      onChange={(e) => {
                        setProjDeptManagerFilter(e.target.value);
                        if (selectedDeptForProjects === 'NONE') {
                          setSelectedDeptForProjects('ALL');
                        }
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold"
                    >
                      <option value="ALL">Resp. département : Tous</option>
                      {users.map((u) => (
                        <option key={String(u.id)} value={String(u.id)}>
                          {u.name} ({u.trigram})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="col-span-2">
                    <select
                      value={projSiteManagerFilter}
                      onChange={(e) => {
                        setProjSiteManagerFilter(e.target.value);
                        if (selectedDeptForProjects === 'NONE') {
                          setSelectedDeptForProjects('ALL');
                        }
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold"
                    >
                      <option value="ALL">Chef de chantier : Tous</option>
                      <option value="__NONE__">— Sans chef de chantier —</option>
                      {users.map((u) => (
                        <option key={String(u.id)} value={String(u.id)}>
                          {u.name} ({u.trigram})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="col-span-3">
                    <select
                      value={projSortBy}
                      onChange={(e) =>
                        setProjSortBy(
                          e.target.value as
                            | 'name_asc'
                            | 'name_desc'
                            | 'number_asc'
                            | 'number_desc'
                            | 'dept_asc'
                        )
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                    >
                      <option value="name_asc">Tri : Nom (A → Z)</option>
                      <option value="name_desc">Tri : Nom (Z → A)</option>
                      <option value="number_asc">Tri : N° Chantier (A → Z)</option>
                      <option value="number_desc">Tri : N° Chantier (Z → A)</option>
                      <option value="dept_asc">Tri : Par département (A → Z)</option>
                    </select>
                  </div>
                </div>

                {/* Affichage conditionnel : Tant qu'on n'a pas cliqué sur un département ou sur "Tous" */}
                {selectedDeptForProjects === 'NONE' ? (
                  <div className="p-8 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/30 text-center space-y-3">
                    <Building2 className="w-7 h-7 text-orange-500 mx-auto" />
                    <div className="space-y-1">
                      <p className="font-bold text-slate-800 dark:text-slate-200">
                        Sélectionnez un département ci-dessus pour afficher ses chantiers
                      </p>
                      <p className="text-slate-500">
                        Ou cliquez sur le bouton « Tous » pour afficher tous les chantiers / projets tous départements confondus.
                      </p>
                    </div>
                    <div className="flex items-center justify-center gap-2 flex-wrap pt-1">
                      <button
                        type="button"
                        onClick={() => setSelectedDeptForProjects('ALL')}
                        className="px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold cursor-pointer"
                      >
                        Tous les chantiers ({projects.length})
                      </button>
                      {departments.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => {
                            setSelectedDeptForProjects(String(d.id));
                            setProjDeptId(String(d.id));
                          }}
                          className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-orange-500 font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
                        >
                          {d.name} ({projectCountByDeptId.get(d.id) || 0})
                        </button>
                      ))}
                    </div>
                  </div>
                ) : filteredAndSortedProjects.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 font-semibold border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                    Aucun chantier / projet ne correspond aux critères sélectionnés.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {filteredAndSortedProjects.map((p) => {
                      const dept = departments.find((d) => d.id === p.department_id);
                      const deptMgr = dept
                        ? users.find((u) => String(u.id) === String(dept.manager_id))
                        : undefined;
                      const mgr = users.find((u) => String(u.id) === String(p.manager_id));
                      return (
                        <div
                          key={p.id}
                          className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-orange-600">
                                {p.project_number}
                              </span>
                              <span className="font-bold text-slate-900 dark:text-white truncate">
                                {p.project_name}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 truncate">
                              {dept ? dept.name : '—'}
                              {deptMgr ? ` (Resp. dép: ${deptMgr.trigram})` : ''} • Chef :{' '}
                              {mgr ? `${mgr.name} (${mgr.trigram})` : '—'}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => startEditProj(p)}
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
                              title="Modifier ce chantier"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteProject(p.id)}
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-rose-50 text-rose-600 cursor-pointer"
                              title="Supprimer ce chantier"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===================================================================== */}
          {/* ===================================================================== */}
          {/* SECTION : ENTREPRISE & E-MAILS MULTI-FOURNISSEURS                     */}
          {/* ===================================================================== */}
          {section === 'emails_smtp' && (
            <div className="space-y-5">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (companyNameInput.trim()) {
                    updateSetting('company_name', companyNameInput.trim());
                  }
                  updateSetting('smtp_from_email', smtpFromEmail.trim());
                  updateSetting('smtp_from_name', smtpFromName.trim());
                  setSaveMessage('Paramètres entreprise enregistrés.');
                }}
                className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4"
              >
                <h2 className="text-base font-black text-slate-900 dark:text-white">
                  Identité Entreprise
                </h2>
                <div className="flex flex-wrap items-end gap-4">
                  <div className="flex-1 min-w-[240px]">
                    <label className="block font-bold mb-1">Nom de l'entreprise</label>
                    <input
                      type="text"
                      value={companyNameInput}
                      onChange={(e) => setCompanyNameInput(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg font-bold bg-orange-600 hover:bg-orange-700 text-white cursor-pointer"
                  >
                    Enregistrer
                  </button>
                </div>
              </form>

              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <EmailSettingsPanel embedded={true} />
              </div>
            </div>
          )}

          {/* ===================================================================== */}
          {/* SECTION : LICENCE & BASE SQL (Complet : Licence + Supabase + SQL 01-08) */}
          {/* ===================================================================== */}
          {section === 'license' && (
            <div className="space-y-5">
              {/* Navigation par sous-onglets */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setLicenseSubTab('license')}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold transition cursor-pointer ${
                    licenseSubTab === 'license'
                      ? 'bg-orange-600 text-white shadow-xs'
                      : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <Award className="w-4 h-4" />
                  <span>1. Licence & Abonnement</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLicenseSubTab('database')}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold transition cursor-pointer ${
                    licenseSubTab === 'database'
                      ? 'bg-orange-600 text-white shadow-xs'
                      : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <Database className="w-4 h-4" />
                  <span>2. Connexion Base SQL Supabase (BYOD)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLicenseSubTab('sql_diagnostic')}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold transition cursor-pointer ${
                    licenseSubTab === 'sql_diagnostic'
                      ? 'bg-orange-600 text-white shadow-xs'
                      : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <Terminal className="w-4 h-4" />
                  <span>3. Scripts SQL (01 à 12) & Diagnostic</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLicenseSubTab('edge_functions')}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold transition cursor-pointer ${
                    licenseSubTab === 'edge_functions'
                      ? 'bg-orange-600 text-white shadow-xs'
                      : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <Server className="w-4 h-4" />
                  <span>4. Fonctions Edge</span>
                </button>
              </div>

              {/* SOUS-ONGLET 1 : LICENCE & ABONNEMENT */}
              {licenseSubTab === 'license' && (
                <div className="space-y-5">
                  <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                          <Award className="w-5 h-5 text-orange-600" />
                          Licence & Formule d'abonnement TOT Stock
                        </h2>
                        <p className="text-[11px] text-slate-500">
                          Vérification cryptographique Ed25519 • Quotas appliqués depuis le jeton signé de l'éditeur
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={isBusyLicense}
                          onClick={async () => {
                            setIsBusyLicense(true);
                            setSaveMessage(null);
                            setErrorMessage(null);
                            try {
                              const res = await syncLicenseWithServer(true);
                              setSaveMessage(
                                res.message || 'Synchronisation avec le serveur de licences effectuée.'
                              );
                            } catch (err: any) {
                              setErrorMessage(err?.message || 'Erreur lors de la synchronisation.');
                            } finally {
                              setIsBusyLicense(false);
                            }
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold text-slate-700 dark:text-slate-200 cursor-pointer disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isBusyLicense ? 'animate-spin' : ''}`} />
                          <span>Synchroniser avec le serveur</span>
                        </button>

                        <button
                          type="button"
                          disabled={isBusyLicense}
                          onClick={async () => {
                            const cleanUrl = normalizeSupabaseUrl(dbUrlInput || supabaseUrl || '');
                            const cleanKey = normalizeSupabaseKey(dbKeyInput || supabaseKey || '');
                            if (!cleanUrl || !cleanKey) {
                              setErrorMessage(
                                'Configurez d’abord l’URL et la clé Supabase dans l’onglet « Base SQL Supabase ».'
                              );
                              return;
                            }
                            setIsBusyLicense(true);
                            setSaveMessage(null);
                            setErrorMessage(null);
                            try {
                              const client = getClientSupabase(cleanUrl, cleanKey);
                              const { data: sessionData } = client
                                ? await client.auth.getSession()
                                : { data: { session: null } };
                              const token = sessionData?.session?.access_token || cleanKey;
                              const res = await discoverLicenseByProjectUrl(
                                cleanUrl,
                                cleanKey,
                                token,
                                { force: true }
                              );
                              if (res.status === 'found' && res.license) {
                                let syncOk = true;
                                let syncErrText = '';
                                if (client) {
                                  const syncRes = await syncLicenseToClientDatabase(
                                    res.license,
                                    client
                                  );
                                  syncOk = syncRes.success;
                                  syncErrText = syncRes.message;
                                  if (syncRes.dbLicenseStatus) {
                                    setDbLicenseStatus(syncRes.dbLicenseStatus);
                                  }
                                }
                                await syncLicenseWithServer(true, cleanUrl, cleanKey).catch(
                                  () => {}
                                );
                                await refreshDbLicenseStatus(res.license.plan_type);
                                if (!syncOk) {
                                  setErrorMessage(syncErrText);
                                } else {
                                  setSaveMessage(
                                    `Licence découverte et appliquée : ${res.license.plan_type.toUpperCase()} (${res.license.license_key}).`
                                  );
                                }
                              } else if (res.status === 'function_not_found') {
                                setErrorMessage(
                                  res.message ||
                                    tr(
                                      language,
                                      "Fonction introuvable : vérifiez le nom exact de la fonction Edge maître (APP_TOT-Stock_licenses) ou l'URL de la base maître.",
                                      'Function not found: check the exact name of the master Edge Function (APP_TOT-Stock_licenses) or the master database URL.',
                                      'Functie niet gevonden: controleer de exacte naam van de master Edge Function (APP_TOT-Stock_licenses) of de URL van de masterdatabase.'
                                    )
                                );
                              } else if (res.status === 'denied') {
                                setErrorMessage(
                                  res.message ||
                                    tr(
                                      language,
                                      "Refusé par le serveur : preuve d'appartenance au projet refusée ou permissions insuffisantes.",
                                      'Rejected by server: project ownership proof denied or insufficient permissions.',
                                      'Geweigerd door de server: eigendomsbewijs van het project geweigerd of onvoldoende rechten.'
                                    )
                                );
                              } else if (res.status === 'not_found') {
                                setErrorMessage(
                                  res.message ||
                                    tr(
                                      language,
                                      "Licence non liée : aucune licence active n'est rattachée à cette URL de projet sur le serveur éditeur.",
                                      'Unlinked license: no active license is linked to this project URL on the publisher server.',
                                      'Niet-gekoppelde licentie: er is geen actieve licentie gekoppeld aan deze project-URL op de uitgeversserver.'
                                    )
                                );
                              } else {
                                setErrorMessage(
                                  res.message ||
                                    'Aucune licence active rattachée à cette URL Supabase sur le serveur éditeur.'
                                );
                              }
                            } catch (err: any) {
                              setErrorMessage(
                                err?.message || 'Erreur lors de la découverte automatique.'
                              );
                            } finally {
                              setIsBusyLicense(false);
                            }
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer disabled:opacity-50"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Découvrir la licence du projet</span>
                        </button>
                      </div>
                    </div>

                    {/* Cartes de synthèse de la licence */}
                    <div className="grid grid-cols-4 gap-3">
                      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-800">
                        <div className="text-slate-400">Formule certifiée</div>
                        <div className="text-lg font-black uppercase text-orange-600 mt-1">
                          {signedQuotas.plan.toUpperCase()} (
                          {PLAN_TIERS[license?.plan_type || 'free']?.name || 'Gratuit'})
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          Statut :{' '}
                          <span className="font-bold text-emerald-600 uppercase">
                            {license?.status || 'active'}
                          </span>
                        </div>
                      </div>

                      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-800">
                        <div className="text-slate-400">Quota Magasins & Dépôts</div>
                        <div className="text-lg font-black text-slate-900 dark:text-white mt-1">
                          {activeDepotsCount} / {signedQuotas.max_depots}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          Dépôts ouverts autorisés
                        </div>
                      </div>

                      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-800">
                        <div className="text-slate-400">Quota Références Catalogue</div>
                        <div className="text-lg font-black text-slate-900 dark:text-white mt-1">
                          {products.length} / {signedQuotas.max_references}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          Articles enregistrés
                        </div>
                      </div>

                      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-800">
                        <div className="text-slate-400">Validité & Bail Hors-ligne</div>
                        <div className="text-sm font-black text-slate-900 dark:text-white mt-1">
                          {license?.expires_at
                            ? new Date(license.expires_at).toLocaleDateString('fr-FR')
                            : 'Illimitée (Community)'}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          Prochain contrôle : {daysUntilNextCheck} j
                        </div>
                      </div>
                    </div>

                    {/* LOT 2 v43 : État réel dans la base cliente (core_license_config) + Avertissement rouge si désynchronisé */}
                    {dbLicenseStatus && (
                      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                            <Database className="w-4 h-4 text-orange-600" />
                            <span>
                              {tr(
                                language,
                                'État appliqué dans la base de données (core_license_config)',
                                'Applied status in database (core_license_config)',
                                'Toegepaste status in database (core_license_config)'
                              )}
                            </span>
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={isBusyLicense}
                              onClick={async () => {
                                const cleanUrl = normalizeSupabaseUrl(
                                  dbUrlInput || supabaseUrl || ''
                                );
                                const cleanKey = normalizeSupabaseKey(
                                  dbKeyInput || supabaseKey || ''
                                );
                                const client = getClientSupabase(cleanUrl, cleanKey);
                                if (!client) return;
                                setIsBusyLicense(true);
                                setSaveMessage(null);
                                setErrorMessage(null);
                                try {
                                  const syncRes = await syncLicenseToClientDatabase(
                                    license,
                                    client
                                  );
                                  if (syncRes.dbLicenseStatus) {
                                    setDbLicenseStatus(syncRes.dbLicenseStatus);
                                  } else {
                                    await refreshDbLicenseStatus(license?.plan_type);
                                  }
                                  if (syncRes.success) {
                                    setSaveMessage(syncRes.message);
                                  } else {
                                    setErrorMessage(syncRes.message);
                                  }
                                } finally {
                                  setIsBusyLicense(false);
                                }
                              }}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer disabled:opacity-50"
                            >
                              {tr(
                                language,
                                'Synchroniser dans la base',
                                'Sync to database',
                                'Synchroniseren met database'
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => refreshDbLicenseStatus()}
                              className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-bold cursor-pointer"
                            >
                              {tr(language, 'Relire la base', 'Re-read DB', 'Database herlezen')}
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                          <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                            <div className="text-[11px] text-slate-400">
                              {tr(
                                language,
                                'Forfait selon la base',
                                'Plan according to DB',
                                'Pakket volgens DB'
                              )}
                            </div>
                            <div className="text-sm font-black uppercase text-slate-900 dark:text-white mt-0.5">
                              {dbLicenseStatus.plan.toUpperCase()}
                            </div>
                          </div>
                          <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                            <div className="text-[11px] text-slate-400">
                              {tr(
                                language,
                                'Dépôts autorisés selon la base (plafond appliqué)',
                                'Allowed depots according to DB (applied ceiling)',
                                'Toegestane depots volgens DB (toegepast plafond)'
                              )}
                            </div>
                            <div className="text-sm font-black text-slate-900 dark:text-white mt-0.5">
                              {dbLicenseStatus.max_depots >= 9999
                                ? tr(language, 'Illimité', 'Unlimited', 'Onbeperkt')
                                : dbLicenseStatus.max_depots}
                            </div>
                          </div>
                          <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                            <div className="text-[11px] text-slate-400">
                              {tr(
                                language,
                                'Jeton signé présent',
                                'Signed token present',
                                'Ondertekend token aanwezig'
                              )}
                            </div>
                            <div
                              className={`text-sm font-black mt-0.5 ${
                                dbLicenseStatus.signedTokenPresent
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-rose-600 dark:text-rose-400'
                              }`}
                            >
                              {dbLicenseStatus.signedTokenPresent
                                ? tr(language, 'oui', 'yes', 'ja')
                                : tr(language, 'non', 'no', 'nee')}
                            </div>
                          </div>
                        </div>

                        {dbLicenseStatus.mismatchWarning && (
                          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-bold flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                            <span>
                              {tr(
                                language,
                                `Avertissement : l'application affiche le forfait ${(license?.plan_type || 'PRO').toUpperCase()} alors que la base de données est en FREE (${dbLicenseStatus.max_depots} dépôt autorisé, jeton signé présent : non). Le trigger de quota de la base retombera sur le forfait gratuit et refusera les dépôts supplémentaires (QUOTA_EXCEEDED) tant que la fonction Edge APP_TOT-Stock_licenses_sync-license n'aura pas écrit le jeton signé dans core_license_config.`,
                                `Warning: the application displays the ${(license?.plan_type || 'PRO').toUpperCase()} plan while the database is in FREE (${dbLicenseStatus.max_depots} allowed depot, signed token present: no). The database quota trigger will fall back to the free tier and reject additional depots (QUOTA_EXCEEDED) until the Edge Function APP_TOT-Stock_licenses_sync-license writes the signed token to core_license_config.`,
                                `Waarschuwing: de applicatie toont het abonnement ${(license?.plan_type || 'PRO').toUpperCase()} terwijl de database op FREE staat (${dbLicenseStatus.max_depots} toegestaan depot, ondertekend token aanwezig: nee). De quotatrigger van de database valt terug op het gratis abonnement en weigert extra depots (QUOTA_EXCEEDED) totdat de Edge Function APP_TOT-Stock_licenses_sync-license het ondertekende token naar core_license_config schrijft.`
                              )}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Clé de licence active & Activation d'une nouvelle clé */}
                    <div className="grid grid-cols-12 gap-4 pt-2">
                      <div className="col-span-6 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-2.5">
                        <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center justify-between">
                          <span className="flex items-center gap-1.5">
                            <KeyRound className="w-4 h-4 text-orange-600" />
                            <span>Clé de licence active</span>
                          </span>
                          {license?.license_key &&
                            license.license_key !== 'TOT-STOCK-FREE-COMMUNITY' && (
                              <button
                                type="button"
                                onClick={() => {
                                  removeLicense();
                                  setSaveMessage(
                                    'Licence dissociée. Retour au forfait Gratuit.'
                                  );
                                }}
                                className="text-[11px] text-rose-600 hover:underline font-bold cursor-pointer"
                              >
                                Dissocier la clé
                              </button>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono font-bold text-slate-800 dark:text-slate-200 truncate">
                            {license?.license_key || 'TOT-STOCK-FREE-COMMUNITY'}
                          </code>
                          <button
                            type="button"
                            onClick={() =>
                              copyToClipboard(
                                license?.license_key || 'TOT-STOCK-FREE-COMMUNITY',
                                'active_lic_key'
                              )
                            }
                            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 font-bold inline-flex items-center gap-1 cursor-pointer"
                          >
                            {copiedKey === 'active_lic_key' ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                                <span>Copié</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>Copier</span>
                              </>
                            )}
                          </button>
                        </div>

                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            if (!licenseKeyInput.trim()) return;
                            setIsBusyLicense(true);
                            setSaveMessage(null);
                            setErrorMessage(null);
                            try {
                              const res = await verifyLicense(licenseKeyInput.trim());
                              await refreshDbLicenseStatus(res.license?.plan_type);
                              if (res.success) {
                                setSaveMessage(res.message || 'Clé de licence activée avec succès.');
                                setLicenseKeyInput('');
                              } else {
                                setErrorMessage(res.message || 'Clé de licence invalide.');
                              }
                            } catch (err: any) {
                              setErrorMessage(err?.message || 'Erreur lors de la vérification.');
                            } finally {
                              setIsBusyLicense(false);
                            }
                          }}
                          className="flex gap-2 pt-1"
                        >
                          <input
                            type="text"
                            value={licenseKeyInput}
                            onChange={(e) => setLicenseKeyInput(e.target.value)}
                            placeholder="Saisir une clé officielle (ex: TOT-PRO-XXXX-XXXX)..."
                            className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                          />
                          <button
                            type="submit"
                            disabled={isBusyLicense || !licenseKeyInput.trim()}
                            className="px-4 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-bold cursor-pointer disabled:opacity-50"
                          >
                            Activer la clé
                          </button>
                        </form>
                      </div>

                      {/* Titulaire & E-mail de contact */}
                      <div className="col-span-6 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-2.5">
                        <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                          <Building2 className="w-4 h-4 text-orange-600" />
                          <span>Entreprise titulaire & Contact de licence</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[11px] font-bold text-slate-500 mb-1">
                              Raison sociale / Organisation
                            </label>
                            <input
                              type="text"
                              value={orgNameEdit}
                              onChange={(e) => setOrgNameEdit(e.target.value)}
                              placeholder="Nom de l'entreprise..."
                              className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-500 mb-1">
                              E-mail administrateur licence
                            </label>
                            <input
                              type="email"
                              value={contactEmailEdit}
                              onChange={(e) => setContactEmailEdit(e.target.value)}
                              placeholder="contact@entreprise.com"
                              className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                            />
                          </div>
                        </div>
                        <div className="flex justify-end pt-1">
                          <button
                            type="button"
                            disabled={isBusyLicense}
                            onClick={async () => {
                              setIsBusyLicense(true);
                              setSaveMessage(null);
                              setErrorMessage(null);
                              try {
                                if (orgNameEdit.trim()) {
                                  updateSetting('company_name', orgNameEdit.trim());
                                  await provisionLicense(
                                    orgNameEdit.trim(),
                                    license?.plan_type || 'free',
                                    supabaseUrl || undefined,
                                    contactEmailEdit.trim() || undefined
                                  );
                                }
                                if (contactEmailEdit.trim()) {
                                  await updateContactEmail(contactEmailEdit.trim());
                                }
                                setSaveMessage(
                                  'Informations de l’entreprise titulaire enregistrées et synchronisées.'
                                );
                              } catch (err: any) {
                                setErrorMessage(
                                  err?.message || 'Erreur lors de la mise à jour.'
                                );
                              } finally {
                                setIsBusyLicense(false);
                              }
                            }}
                            className="px-4 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white font-bold cursor-pointer"
                          >
                            Enregistrer le titulaire
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Grille comparative des formules */}
                  <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                    <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                      <Layers className="w-4 h-4 text-orange-600" />
                      Formules d'abonnement & Quotas TOT Stock
                    </h3>
                    <div className="grid grid-cols-4 gap-3">
                      {(
                        [
                          {
                            plan: 'free' as LicensePlan,
                            title: 'Découverte (FREE)',
                            price: '0 € / mois',
                            depots: '1 dépôt actif',
                            refs: '100 références',
                            features: ['Inventaire & Scan', 'Mouvements de base'],
                          },
                          {
                            plan: 'sta' as LicensePlan,
                            title: 'Standard (STA)',
                            price: '39 € HT / mois',
                            depots: '3 dépôts actifs',
                            refs: '500 références',
                            features: [
                              'Multi-dépôts & Véhicules',
                              'Commandes & Chantiers',
                              'Mise en veille de dépôt',
                            ],
                          },
                          {
                            plan: 'pro' as LicensePlan,
                            title: 'Professionnel (PRO)',
                            price: '89 € HT / mois',
                            depots: '10 dépôts actifs',
                            refs: '5 000 références',
                            features: [
                              'Préparation par scan',
                              'Poste d’impression & Zebra ZPL',
                              'Validation hiérarchique (€)',
                            ],
                          },
                          {
                            plan: 'ent' as LicensePlan,
                            title: 'Entreprise (ENT)',
                            price: '199 € HT / mois',
                            depots: 'Dépôts illimités',
                            refs: '50 000 références',
                            features: [
                              'Multi-sites & Flotte complète',
                              'Audit complet & RLS avancé',
                              'Support prioritaire',
                            ],
                          },
                        ] as const
                      ).map((tier) => {
                        const currentCanonical = normalizeToCanonicalPlan(
                          license?.plan || license?.plan_type,
                          license?.license_key
                        );
                        const isCurrent = currentCanonical === tier.plan;
                        return (
                          <div
                            key={tier.plan}
                            className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${
                              isCurrent
                                ? 'border-orange-500 bg-orange-50/40 dark:bg-orange-950/20'
                                : 'border-slate-200 dark:border-slate-800'
                            }`}
                          >
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="font-black text-slate-900 dark:text-white">
                                  {tier.title}
                                </span>
                                {isCurrent && (
                                  <span className="px-2 py-0.5 rounded bg-orange-600 text-white text-[10px] font-bold">
                                    Actif
                                  </span>
                                )}
                              </div>
                              <div className="text-sm font-black text-orange-600">
                                {tier.price}
                              </div>
                              <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                                • {tier.depots}
                                <br />• {tier.refs}
                              </div>
                              <ul className="text-[11px] text-slate-500 space-y-1 pt-1">
                                {tier.features.map((f) => (
                                  <li key={f} className="flex items-center gap-1">
                                    <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                                    <span>{f}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>

                            {!isCurrent && tier.plan !== 'free' && (
                              <button
                                type="button"
                                disabled={isBusyLicense}
                                onClick={async () => {
                                  setIsBusyLicense(true);
                                  setSaveMessage(null);
                                  setErrorMessage(null);
                                  try {
                                    const res = await upgradePlan(
                                      tier.plan,
                                      'annual',
                                      contactEmailEdit.trim() || undefined
                                    );
                                    if (res.success) {
                                      setSaveMessage(res.message);
                                    } else {
                                      setErrorMessage(
                                        res.message ||
                                          'Demande enregistrée. Le serveur éditeur doit signer la clé correspondante.'
                                      );
                                    }
                                  } catch (err: any) {
                                    setErrorMessage(err?.message || 'Erreur serveur.');
                                  } finally {
                                    setIsBusyLicense(false);
                                  }
                                }}
                                className="w-full py-1.5 px-3 rounded-lg bg-slate-900 dark:bg-slate-800 hover:bg-orange-600 text-white font-bold cursor-pointer transition"
                              >
                                Choisir {tier.plan.toUpperCase()}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* SOUS-ONGLET 2 : CONNEXION BASE SQL SUPABASE (BYOD) */}
              {licenseSubTab === 'database' && (
                <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                        <Server className="w-5 h-5 text-orange-600" />
                        Connexion Base de Données SQL Supabase (BYOD)
                      </h2>
                      <p className="text-[11px] text-slate-500">
                        Reliez l'application à votre instance PostgreSQL / Supabase d'entreprise pour la synchronisation temps réel multi-postes
                      </p>
                    </div>
                    <div
                      className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 ${
                        isSupabaseConnected
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          isSupabaseConnected ? 'bg-emerald-500' : 'bg-slate-400'
                        }`}
                      />
                      <span>
                        {isSupabaseConnected
                          ? `Connecté (${supabaseSyncMessage || 'Synchronisé'})`
                          : 'Mode local hors-ligne'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-12 gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                    <div className="col-span-5">
                      <label className="block font-bold mb-1">
                        URL du projet Supabase (HTTPS)
                      </label>
                      <input
                        type="url"
                        value={dbUrlInput}
                        onChange={(e) => setDbUrlInput(e.target.value)}
                        placeholder="https://votre-projet.supabase.co"
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                      />
                    </div>
                    <div className="col-span-7">
                      <label className="block font-bold mb-1">
                        Clé API publique Supabase (anon / publishable key)
                      </label>
                      <div className="relative">
                        <input
                          type={showDbKey ? 'text' : 'password'}
                          value={dbKeyInput}
                          onChange={(e) => setDbKeyInput(e.target.value)}
                          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                          className="w-full pl-3 pr-9 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => setShowDbKey((v) => !v)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                          title={showDbKey ? 'Masquer la clé' : 'Afficher la clé'}
                        >
                          {showDbKey ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="col-span-12 flex flex-wrap items-center justify-between gap-2 pt-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={isBusyDb}
                          onClick={async () => {
                            setSaveMessage(null);
                            setErrorMessage(null);
                            setDbTestSummary(null);
                            const validation = validateSupabaseServerUrl(dbUrlInput);
                            const keyValidation = validateSupabaseAnonKey(dbKeyInput);
                            if (!validation.valid || !keyValidation.valid) {
                              setErrorMessage(
                                (!validation.valid ? validation.errorMessage : keyValidation.errorMessage) ||
                                  "Veuillez renseigner l'URL et la clé publique Supabase."
                              );
                              return;
                            }
                            const cleanKey = keyValidation.normalizedKey;
                            setIsBusyDb(true);
                            try {
                              const res = await testConnection(
                                validation.normalizedUrl,
                                cleanKey
                              );
                              setDbTestSummary({
                                ok: res.success,
                                message: res.message,
                              });
                              if (res.success) {
                                setSaveMessage(`Test de connexion réussi : ${res.message}`);
                              } else {
                                setErrorMessage(`Échec du test : ${res.message}`);
                              }
                            } catch (err: any) {
                              setErrorMessage(err?.message || 'Erreur lors du test.');
                            } finally {
                              setIsBusyDb(false);
                            }
                          }}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 font-bold text-slate-700 dark:text-slate-200 cursor-pointer disabled:opacity-50"
                        >
                          <Stethoscope className="w-4 h-4 text-orange-600" />
                          <span>Tester la connexion</span>
                        </button>

                        <button
                          type="button"
                          disabled={isBusyDb}
                          onClick={async () => {
                            setSaveMessage(null);
                            setErrorMessage(null);
                            const validation = validateSupabaseServerUrl(dbUrlInput);
                            const keyValidation = validateSupabaseAnonKey(dbKeyInput);
                            if (!validation.valid || !keyValidation.valid) {
                              setErrorMessage(
                                (!validation.valid ? validation.errorMessage : keyValidation.errorMessage) ||
                                  "Veuillez renseigner l'URL et la clé publique Supabase."
                              );
                              return;
                            }
                            const cleanKey = keyValidation.normalizedKey;
                            setIsBusyDb(true);
                            try {
                              saveSupabaseConfig(validation.normalizedUrl, cleanKey);
                              const ok = await syncFromSupabase(
                                validation.normalizedUrl,
                                cleanKey
                              );
                              if (ok) {
                                setSaveMessage(
                                  'Base SQL Supabase enregistrée et synchronisée avec succès.'
                                );
                              } else {
                                setErrorMessage(
                                  'Identifiants enregistrés, mais la synchronisation initiale a rencontré un problème.'
                                );
                              }
                            } finally {
                              setIsBusyDb(false);
                            }
                          }}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-bold cursor-pointer disabled:opacity-50"
                        >
                          <Check className="w-4 h-4" />
                          <span>Enregistrer & Connecter la base</span>
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={isBusyDb || !isSupabaseConnected}
                          onClick={async () => {
                            setIsBusyDb(true);
                            setSaveMessage(null);
                            setErrorMessage(null);
                            try {
                              const ok = await syncFromSupabase();
                              if (ok) {
                                setSaveMessage('Données rechargées depuis Supabase.');
                              } else {
                                setErrorMessage('Impossible de synchroniser depuis Supabase.');
                              }
                            } finally {
                              setIsBusyDb(false);
                            }
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 font-bold text-slate-700 dark:text-slate-200 cursor-pointer disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isBusyDb ? 'animate-spin' : ''}`} />
                          <span>Synchroniser depuis Supabase</span>
                        </button>

                        <button
                          type="button"
                          disabled={isBusyDb || !isSupabaseConnected}
                          onClick={async () => {
                            setIsBusyDb(true);
                            setSaveMessage(null);
                            setErrorMessage(null);
                            try {
                              const res = await exportToSupabase();
                              if (res.success) {
                                setSaveMessage(res.message);
                              } else {
                                setErrorMessage(res.message);
                              }
                            } finally {
                              setIsBusyDb(false);
                            }
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 font-bold text-slate-700 dark:text-slate-200 cursor-pointer disabled:opacity-50"
                        >
                          <UploadCloud className="w-3.5 h-3.5 text-indigo-600" />
                          <span>Exporter vers Supabase</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            resetToDemoData();
                            setDbUrlInput('');
                            setDbKeyInput('');
                            setDbTestSummary(null);
                            setSaveMessage(' Stockage local de démonstration rétabli.');
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-rose-200 dark:border-rose-900/50 text-rose-600 hover:bg-rose-50 font-bold cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Mode démo local</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {dbTestSummary && (
                    <div
                      className={`p-3.5 rounded-xl border ${
                        dbTestSummary.ok
                          ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-200'
                          : 'bg-rose-50/70 border-rose-200 text-rose-900 dark:bg-rose-950/30 dark:border-rose-800 dark:text-rose-200'
                      }`}
                    >
                      <div className="font-bold">{dbTestSummary.message}</div>
                      {dbTestSummary.details && (
                        <div className="text-[11px] opacity-80 mt-0.5">{dbTestSummary.details}</div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* SOUS-ONGLET 3 : SCRIPTS SQL (01 À 08) & DIAGNOSTIC */}
              {licenseSubTab === 'sql_diagnostic' && (
                <div className="space-y-5">
                  {/* Bloc Diagnostic SQL */}
                  <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                          <Stethoscope className="w-5 h-5 text-orange-600" />
                          Diagnostic de l'installation SQL (`public.diagnostic_installation`)
                        </h2>
                        <p className="text-[11px] text-slate-500">
                          Vérifie les tables, l'activation RLS, l'absence de règles permissives héritées, les fonctions RPC et la version du schéma (attendu : {EXPECTED_SCHEMA_VERSION}, min : {MIN_SUPPORTED_SCHEMA_VERSION})
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={diagLoading}
                        onClick={handleRunSqlDiagnostic}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${diagLoading ? 'animate-spin' : ''}`} />
                        <span>Lancer le diagnostic SQL</span>
                      </button>
                    </div>

                    {diagError && (
                      <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-bold">
                        {diagError}
                      </div>
                    )}

                    {diagRows.length > 0 && (
                      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                        <table className="w-full text-left border-collapse">
                          <thead className="bg-slate-50 dark:bg-slate-800 text-[10px] font-bold uppercase text-slate-500">
                            <tr>
                              <th className="py-2 px-3">Statut</th>
                              <th className="py-2 px-3">Contrôle</th>
                              <th className="py-2 px-3">Clé</th>
                              <th className="py-2 px-3">Détails</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {diagRows.map((row) => (
                              <tr key={row.check_key}>
                                <td className="py-2 px-3">
                                  {row.status === 'OK' ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                                      <CheckCircle2 className="w-3 h-3" /> OK
                                    </span>
                                  ) : row.status === 'ATTENTION' ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-[10px]">
                                      <AlertTriangle className="w-3 h-3" /> ATTENTION
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold text-[10px]">
                                      <XCircle className="w-3 h-3" /> ERREUR
                                    </span>
                                  )}
                                </td>
                                <td className="py-2 px-3 font-bold text-slate-900 dark:text-white">
                                  {row.check_label}
                                </td>
                                <td className="py-2 px-3 font-mono text-slate-400">
                                  {row.check_key}
                                </td>
                                <td className="py-2 px-3 font-mono text-slate-600 dark:text-slate-300">
                                  {row.details}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Catalogue des scripts SQL 01 à 08 */}
                  <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                          <Terminal className="w-5 h-5 text-orange-600" />
                          Scripts SQL Officiels Supabase (01 à 12)
                        </h3>
                        <p className="text-[11px] text-slate-500">
                          Copiez et exécutez ces scripts dans l’Éditeur SQL Supabase (SQL Editor) pour installer ou mettre à jour votre base
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const orderedIds = ['01', '09', '02', '03', '04', '05', '06', '08', '11', '12', '07'];
                          const allScripts = orderedIds
                            .map((id) => SQL_SCRIPTS_CATALOG.find((s) => s.id === id))
                            .filter((s): s is NonNullable<typeof s> => Boolean(s))
                            .map(
                              (s) =>
                                `-- =====================================================================\n-- ${s.filename} : ${s.title}\n-- =====================================================================\n${s.sql}`
                            )
                            .join('\n\n');
                          copyToClipboard(allScripts, 'sql_all_01_12');
                          setSaveMessage(
                            'Script complet d’installation (01 à 12 assemblés dans l’ordre d’exécution) copié dans le presse-papiers.'
                          );
                        }}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-orange-600 text-white font-bold cursor-pointer transition"
                      >
                        {copiedKey === 'sql_all_01_12' ? (
                          <>
                            <Check className="w-4 h-4 text-emerald-400" />
                            <span>Script complet 01–12 copié !</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            <span>Copier tout le pack SQL (01 à 12)</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200 text-xs font-bold flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      <span>{t('sql_legacy_db_auto_fix_notice')}</span>
                    </div>

                    <div className="grid grid-cols-12 gap-4">
                      <div className="col-span-5 space-y-1.5">
                        {SQL_SCRIPTS_CATALOG.map((item) => {
                          const active = selectedSqlScriptId === item.id;
                          return (
                            <div
                              key={item.id}
                              onClick={() => setSelectedSqlScriptId(item.id)}
                              className={`p-3 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition ${
                                active
                                  ? 'border-orange-500 bg-orange-50/50 dark:bg-orange-950/30'
                                  : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="font-bold text-slate-900 dark:text-white truncate">
                                  {item.title}
                                </div>
                                <div className="text-[10px] font-mono text-slate-400 truncate">
                                  {item.filename}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyToClipboard(item.sql, `sql_${item.id}`);
                                  setSaveMessage(`Script ${item.filename} copié.`);
                                }}
                                className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 font-bold text-[11px] inline-flex items-center gap-1 shrink-0 cursor-pointer"
                              >
                                {copiedKey === `sql_${item.id}` ? (
                                  <>
                                    <Check className="w-3 h-3 text-emerald-600" />
                                    <span>Copié</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3" />
                                    <span>Copier</span>
                                  </>
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      <div className="col-span-7 flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 text-slate-100 overflow-hidden">
                        {(() => {
                          const currentScript =
                            SQL_SCRIPTS_CATALOG.find((s) => s.id === selectedSqlScriptId) ||
                            SQL_SCRIPTS_CATALOG[0];
                          return (
                            <>
                              <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-2">
                                <div>
                                  <div className="font-bold text-white">
                                    {currentScript.filename} — {currentScript.title}
                                  </div>
                                  <div className="text-[11px] text-slate-400">
                                    {currentScript.description}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    copyToClipboard(
                                      currentScript.sql,
                                      `sql_preview_${currentScript.id}`
                                    );
                                    setSaveMessage(`Script ${currentScript.filename} copié.`);
                                  }}
                                  className="px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-bold inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
                                >
                                  {copiedKey === `sql_preview_${currentScript.id}` ? (
                                    <>
                                      <Check className="w-3.5 h-3.5" />
                                      <span>Copié !</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="w-3.5 h-3.5" />
                                      <span>Copier ce script</span>
                                    </>
                                  )}
                                </button>
                              </div>
                              <pre className="p-4 text-[11px] font-mono text-slate-200 overflow-auto max-h-96 leading-relaxed">
                                {currentScript.sql}
                              </pre>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* SOUS-ONGLET 4 : FONCTIONS EDGE */}
              {licenseSubTab === 'edge_functions' && (
                <EdgeFunctionsSetupPanel
                  language={language}
                  supabaseUrl={dbUrlInput || supabaseUrl}
                  supabaseKey={dbKeyInput || supabaseKey}
                  isSuperAdmin={Number(currentUser?.role_id) === 0}
                  settings={settings as unknown as Record<string, string>}
                />
              )}
            </div>
          )}

          {/* ===================================================================== */}
          {/* SECTION : DOCUMENTATION                                               */}
          {/* ===================================================================== */}
          {section === 'documentation' && (
            <div className="space-y-4">
              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                <h2 className="text-base font-black text-slate-900 dark:text-white">
                  Documentation & Guides d'exploitation
                </h2>
                <ul className="space-y-2 text-slate-600 dark:text-slate-300 list-disc pl-5">
                  <li>
                    <strong>Interface Bureau (≥ 1024 px)</strong> : Raccourcis clavier (<code>Ctrl+K</code> palette, <code>/</code> recherche, <code>?</code> aide), douchette USB HID automatique (&lt; 50 ms).
                  </li>
                  <li>
                    <strong>Poste d'impression & Zebra ZPL</strong> : Impression silencieuse sur imprimante système ou envoi ZPL II direct sur port TCP 9100 (<code>docs/INTEGRATION_BUREAU.md</code>).
                  </li>
                  <li>
                    <strong>Import CSV</strong> : Jusqu'à 5 000 articles par lot avec neutralisation des formules tableur et respect du quota de licence.
                  </li>
                </ul>
              </div>

              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                  Sécurité des données (Chiffrement local AES-GCM 256 &amp; Préférences)
                </h3>
                <ul className="space-y-2 text-slate-600 dark:text-slate-300 list-disc pl-5 leading-relaxed">
                  <li>
                    <strong>Ce qui est chiffré localement (AES-GCM 256, IV aléatoire de 12 octets par valeur)</strong> : la session et le profil courant (<code>tot_inv_current_user</code>), l'URL et la clé publique Supabase (<code>tqt_company_key</code>, <code>tot_inv_supabase_key</code>), les jetons d'authentification Supabase Auth (<code>sb-*</code> via l'adaptateur <code>auth.storage</code>), la file d'opérations hors-ligne (<code>sync_queue</code> IndexedDB et <code>tot_scanner_offline_queue_v1</code>), l'historique local des mouvements (<code>stock_movements</code>) et les brouillons d'audit d'inventaire (<code>tot_inventory_audit_*</code>).
                  </li>
                  <li>
                    <strong>Où est stockée la clé de chiffrement</strong> :
                    <ul className="list-circle pl-5 mt-1 space-y-1">
                      <li><strong>APK Android &amp; Application Bureau Electron (mode natif automatique)</strong> : la clé maître 256 bits est protégée par le trousseau matériel/système (<em>Android Keystore AES/GCM/NoPadding</em> ou <em>Electron safeStorage</em> DPAPI / Keychain / libsecret) sans saisie supplémentaire.</li>
                      <li><strong>Navigateur Web / PWA (mode PIN sur activation dans Profil &gt; Sécurité)</strong> : la clé AES-GCM 256 non extractible est dérivée du code PIN via <code>PBKDF2-SHA256</code> (≥ 600 000 itérations, sel aléatoire distinct du sel de vérification du PIN) et conservée uniquement en mémoire vive (effacée dès le verrouillage d'inactivité ou la déconnexion).</li>
                    </ul>
                  </li>
                  <li>
                    <strong>Pourquoi le catalogue reste en clair</strong> : les articles, catégories, dépôts, départements, chantiers, rôles et préférences d'interface restent en clair pour garantir un démarrage hors-ligne et une recherche instantanés sur de gros catalogues sans surcoût CPU/mémoire.
                  </li>
                  <li>
                    <strong>Que faire en cas de PIN oublié ou de cache illisible</strong> : utilisez le bouton <em>« Réinitialiser les données locales »</em> (dans <em>Profil &gt; Sécurité</em> ou sur l'écran de déverrouillage). L'application tente d'abord de synchroniser les opérations en attente, affiche un avertissement indiquant le nombre exact d'opérations hors-ligne non synchronisées qui seraient perdues, et exige une confirmation explicite avant d'effacer le stockage local.
                  </li>
                  <li>
                    <strong>Ce contre quoi le chiffrement local ne protège pas</strong> : le chiffrement au repos protège contre l'inspection du disque ou d'une sauvegarde locale lorsque la session est verrouillée ou fermée ; il <strong>ne protège pas contre un appareil laissé déverrouillé avec une session ouverte</strong> (d'où l'importance du verrouillage automatique d'inactivité). De plus, toute clé secrète <code>service_role</code> ou <code>sb_secret_</code> est systématiquement refusée et purgée au démarrage.
                  </li>
                </ul>
              </div>
            </div>
          )}

          {/* ===================================================================== */}
          {/* SECTION : À PROPOS & INSTALLEURS                                      */}
          {/* ===================================================================== */}
          {section === 'about' && (
            <div className="space-y-4">
              <AboutAppPanel
                onOpenSqlScripts={() => {
                  setSection('license');
                  setLicenseSubTab('database');
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
