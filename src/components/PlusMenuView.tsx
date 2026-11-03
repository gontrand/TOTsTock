import React, { useState, useMemo } from 'react';
import { tr } from '../i18n/dutchTranslator';
import { useApp } from '../context/AppContext';
import {
  User,
  LogOut,
  BarChart3,
  Package,
  ShoppingCart,
  PackageCheck,
  PlusCircle,
  Building2,
  Mail,
  Sliders,
  FolderTree,
  Warehouse,
  Shield,
  Users,
  QrCode,
  Database,
  Info,
  ChevronRight,
  AlertTriangle,
  AlertOctagon,
  FileSpreadsheet,
  Printer,
  ClipboardCheck,
  Coins,
  BookOpen,
  Smartphone,
  Globe,
  Terminal,
  Search,
  X,
  Lock,
  Sparkles,
  Volume2,
  VolumeX,
  Stethoscope,
  Scan,
} from 'lucide-react';
import { APP_VERSION } from '../appVersion';
import { canUserAccessScannerMode } from '../services/orderPickingLogic';
import { SUPPORTED_CURRENCIES } from '../utils/crypto';
import { getClientSupabase, checkEmailServiceConfigured } from '../services/clientSupabase';
import {
  isHapticsEnabled,
  setHapticsEnabled,
  isSoundEnabled,
  setSoundEnabled,
  getHapticIntensity,
  setHapticIntensity,
  HapticIntensity,
  triggerHapticTest,
  triggerSoundTest,
  hapticFeedback,
} from '../utils/haptics';

export const PlusMenuView: React.FC = () => {
  const {
    currentUser,
    logout,
    setActiveTab,
    setProfileModalOpen,
    setProductFormState,
    setDepartmentsProjectsModal,
    setEmailReportsModalOpen,
    setSmtpSettingsModalOpen,
    setCategoriesModalOpen,
    setDepotsModalOpen,
    depots,
    departments,
    projects,
    maxDepots,
    setUsersRolesModal,
    setQrConfigGenModalOpen,
    setCompanySetupModalOpen,
    setAppInfoModalOpen,
    setPrintLabelsModal,
    setPrintStationModalOpen,
    setInventoryAuditModalOpen,
    setDiagnosticModalOpen,
    userHasPermission,
    supabaseSyncStatus,
    supabaseSyncMessage,
    license,
    language,
    setLanguage,
    toggleLanguage,
    currency,
    setCurrency,
    setDocumentationModalOpen,
    orders,
    orderCart,
    setOrderCartModalOpen,
    setPreparerOrdersModalOpen,
    openScannerPickingMode,
    isPreparer,
    t,
  } = useApp();

  // Operational buttons
  const canDashboard = userHasPermission('perm_tab_dashboard') || userHasPermission('perm_dash_kpi');
  const canInventory = userHasPermission('perm_tab_inventory') || userHasPermission('perm_prod_view');
  const canEditProduct = userHasPermission('perm_prod_edit');
  const canDepView = userHasPermission('perm_dep_view') || userHasPermission('perm_depproj_menu');
  const canProjView = userHasPermission('perm_proj_view') || userHasPermission('perm_depproj_menu');
  const canDepProj = canDepView || canProjView;
  const canPrintLabels = userHasPermission('perm_menu_print_labels');
  const canInventoryAudit = userHasPermission('perm_menu_inventory_audit');

  // Material Orders & Fulfillment
  const canCreateOrder = true; // Tout le monde est demandeur par défaut !
  const canOrderPrep = isPreparer || userHasPermission('perm_menu_order_prep');
  const canScannerMode = canUserAccessScannerMode(
    currentUser,
    isPreparer,
    userHasPermission('perm_menu_order_prep')
  );

  const pendingPrepCount = orders.filter((o) => o.status === 'PENDING').length;
  const myReadyOrdersCount = orders.filter(
    (o) =>
      (String(o.requester_id) === String(currentUser?.id) ||
        (o.requester_name && o.requester_name.toLowerCase() === currentUser?.name?.toLowerCase())) &&
      o.status === 'READY'
  ).length;

  // Reports
  const canEmail = userHasPermission('perm_config_email');

  // Administration buttons
  const canSmtp = userHasPermission('perm_menu_smtp') || userHasPermission('perm_config_email') || userHasPermission('perm_config_db');
  const canCategories = userHasPermission('perm_manage_categories');
  const canManageDepots = userHasPermission('perm_manage_depots');
  const canUsers = userHasPermission('perm_manage_users');
  const canRoles = userHasPermission('perm_manage_roles');
  const canDbConfig = userHasPermission('perm_config_db');
  const canQrConfig = userHasPermission('perm_menu_qr_config') || canDbConfig;
  const canLicense = userHasPermission('perm_config_license') || canDbConfig;
  const canDiagnostic = Boolean(
    currentUser && [0, 1, 5].includes(Number(currentUser.role_id))
  );

  // Documentation buttons
  const canDocManual = userHasPermission('perm_doc_manual');
  const canDocAndroid = userHasPermission('perm_doc_android');
  const canDocMarketing = userHasPermission('perm_doc_marketing');
  const canDocSupabase = userHasPermission('perm_doc_supabase');

  // Currency
  const canManageCurrency = Boolean(
    currentUser && (
      userHasPermission('perm_manage_currency') ||
      canDbConfig ||
      canLicense ||
      canRoles ||
      Number(currentUser.role_id) === 0 ||
      Number(currentUser.role_id) === 1 ||
      Number(currentUser.id) === 0
    )
  );

  const [menuSearch, setMenuSearch] = useState('');
  const [hapticEnabled, setHapticEnabledState] = useState<boolean>(() => isHapticsEnabled());
  const [soundEnabled, setSoundEnabledState] = useState<boolean>(() => isSoundEnabled());
  const [hapticIntensity, setHapticIntensityState] = useState<HapticIntensity>(() => getHapticIntensity());
  const [testedHaptic, setTestedHaptic] = useState(false);
  const [testedSound, setTestedSound] = useState(false);
  const [emailServiceConfigured, setEmailServiceConfigured] = useState<boolean>(() => {
    try {
      return localStorage.getItem('tot_email_service_configured') !== 'false';
    } catch {
      return true;
    }
  });

  React.useEffect(() => {
    const syncPrefs = () => {
      setHapticEnabledState(isHapticsEnabled());
      setSoundEnabledState(isSoundEnabled());
      setHapticIntensityState(getHapticIntensity());
    };
    const handleEmailStatus = (ev: Event) => {
      const custom = ev as CustomEvent<{ configured?: boolean }>;
      if (typeof custom.detail?.configured === 'boolean') {
        setEmailServiceConfigured(custom.detail.configured);
      }
    };
    window.addEventListener('tot-audio-haptics-changed', syncPrefs);
    window.addEventListener('tot-email-service-status', handleEmailStatus);
    const client = getClientSupabase();
    if (client && canEmail) {
      checkEmailServiceConfigured(client).then((ok) => setEmailServiceConfigured(ok));
    }
    return () => {
      window.removeEventListener('tot-audio-haptics-changed', syncPrefs);
      window.removeEventListener('tot-email-service-status', handleEmailStatus);
    };
  }, [canEmail]);

  // Comprehensive index of all menu actions and destinations for instant search
  const allMenuItems = useMemo(() => {
    return [
      {
        id: 'profile',
        title: tr(language, 'Mon Profil & Code PIN', 'My Profile & PIN'),
        category: tr(language, 'Compte', 'Account'),
        description: tr(language, 'Modifier votre code PIN secret et consulter vos informations', 'Change your PIN code and view profile info'),
        keywords: ['profil', 'pin', 'code', 'mot de passe', 'password', 'compte', 'utilisateur'],
        icon: <User className="w-4 h-4 text-orange-600" />,
        action: () => setProfileModalOpen(true),
        visible: true,
      },
      {
        id: 'sound',
        title: tr(language, 'Sons & Bips Audio (Scans & Alertes)', 'Sound Effects & Audio Beeps'),
        category: tr(language, 'Compte & Mobile', 'Account & Mobile'),
        description: tr(language, 'Activer ou couper le son des bips de scan et alertes indépendamment du vibreur', 'Mute or enable scan beeps and audio alerts independently from vibration'),
        keywords: ['son', 'audio', 'bip', 'muet', 'silencieux', 'volume', 'couper', 'mute', 'sound', 'beep'],
        icon: soundEnabled ? <Volume2 className="w-4 h-4 text-orange-600" /> : <VolumeX className="w-4 h-4 text-slate-500" />,
        action: () => {
          const el = document.getElementById('sound-select-tile');
          if (el) el.scrollIntoView({ behavior: 'smooth' });
          setMenuSearch('');
        },
        badge: soundEnabled ? (tr(language, 'Activé', 'ON')) : (tr(language, 'Muet', 'MUTED')),
        visible: true,
      },
      {
        id: 'haptics',
        title: tr(language, 'Vibreur & Retour Tactile (Haptique)', 'Vibrator & Haptic Feedback'),
        category: tr(language, 'Compte & Mobile', 'Account & Mobile'),
        description: tr(language, 'Activer le vibreur sur les scans QR/code-barres et les boutons, régler la puissance (Léger, Normal, Fort)', 'Enable vibration on scans and buttons, adjust intensity'),
        keywords: ['vibreur', 'vibration', 'haptique', 'tactile', 'scan', 'mobile', 'telephone'],
        icon: <Smartphone className="w-4 h-4 text-orange-600" />,
        action: () => {
          const el = document.getElementById('haptics-select-tile');
          if (el) el.scrollIntoView({ behavior: 'smooth' });
          setMenuSearch('');
          triggerHapticTest();
        },
        badge: hapticEnabled ? (tr(language, 'Actif', 'ON')) : (tr(language, 'Inactif', 'OFF')),
        visible: true,
      },
      {
        id: 'currency',
        title: tr(language, 'Devise de Valorisation (Centralisée Entreprise)', 'Valuation Currency (Centralized Company)'),
        category: tr(language, 'Entreprise & Préférences', 'Company & Preferences'),
        description: tr(language, 'EUR, USD, CHF, GBP, CAD, XOF/CFA, MAD... Synchronisée sur toute l\'entreprise via Supabase', 'EUR, USD, CHF, GBP, CAD, XOF, MAD... Company-wide sync via Supabase'),
        keywords: ['devise', 'monnaie', 'currency', 'euro', 'dollar', 'chf', 'franc', 'cfa', 'mad', 'argent', 'prix', 'valorisation', 'centralisee'],
        icon: <Coins className="w-4 h-4 text-amber-600" />,
        action: () => {
          const el = document.getElementById('currency-select-tile');
          if (el) el.scrollIntoView({ behavior: 'smooth' });
          setMenuSearch('');
        },
        badge: `${currency} (${SUPPORTED_CURRENCIES.find((c) => c.code === currency)?.symbol || '€'})`,
        visible: true,
      },
      {
        id: 'manual',
        title: tr(language, 'Manuel d\'Utilisation Officiel (PDF)', 'Official User Manual (PDF)'),
        category: tr(language, 'Documentation & Guides', 'Documentation & Guides'),
        description: tr(language, 'Guide complet illustré avec captures d\'écran, prise en main, exploitation et export PDF', 'Complete user manual with screenshots and PDF export'),
        keywords: ['manuel', 'guide', 'pdf', 'documentation', 'notice', 'aide', 'tutoriel', 'mode d\'emploi', 'capture'],
        icon: <BookOpen className="w-4 h-4 text-orange-600" />,
        action: () => setDocumentationModalOpen({ open: true, tab: 'manual' }),
        badge: 'PDF A4',
        visible: true,
      },
      {
        id: 'android',
        title: tr(language, 'Procédure Export Android Studio (APK / AAB)', 'Android Studio Export Procedure (APK / AAB)'),
        category: tr(language, 'Documentation & Guides', 'Documentation & Guides'),
        description: tr(language, 'Guide pas à pas pour compiler en application mobile native Android via Capacitor', 'Step-by-step guide to compile native Android app with Capacitor'),
        keywords: ['android', 'apk', 'aab', 'mobile', 'google play', 'studio', 'capacitor', 'smartphone'],
        icon: <Smartphone className="w-4 h-4 text-emerald-600" />,
        action: () => setDocumentationModalOpen({ open: true, tab: 'android' }),
        badge: 'Mobile Native',
        visible: true,
      },
      {
        id: 'marketing',
        title: tr(language, 'Code HTML Site Web Promotionnel', 'Marketing Web Landing Page HTML'),
        category: tr(language, 'Documentation & Guides', 'Documentation & Guides'),
        description: tr(language, 'Code HTML/Tailwind complet à copier/coller pour présenter l\'application sur votre site', 'Full HTML/Tailwind landing page code to promote app on website'),
        keywords: ['html', 'site web', 'vitrine', 'marketing', 'promotion', 'landing page', 'code'],
        icon: <Globe className="w-4 h-4 text-blue-600" />,
        action: () => setDocumentationModalOpen({ open: true, tab: 'marketing' }),
        badge: 'HTML5',
        visible: true,
      },
      {
        id: 'supabase_cli',
        title: tr(language, 'Console Supabase CLI & Migrations SQL', 'Supabase CLI & SQL Migrations'),
        category: tr(language, 'Documentation & Base de données', 'Documentation & Database'),
        description: tr(language, 'Scripts SQL et commandes CLI supabase db push pour synchroniser les tables', 'SQL scripts and CLI supabase db push commands'),
        keywords: ['supabase', 'sql', 'cli', 'migration', 'base', 'database', 'tables', 'terminal'],
        icon: <Terminal className="w-4 h-4 text-purple-600" />,
        action: () => setDocumentationModalOpen({ open: true, tab: 'supabase' }),
        visible: true,
      },
      {
        id: 'diagnostic',
        title: tr(language, "Diagnostic d'installation", 'Installation Diagnostic'),
        category: tr(language, 'Administration', 'Administration'),
        description: tr(language, 'Vérifier les 7 contrôles techniques public.diagnostic_installation() et copier le rapport', 'Run 7 database checks and copy plain-text diagnostic report'),
        keywords: ['diagnostic', 'installation', 'rls', 'compatibilite', 'rapport', 'verification', 'audit'],
        icon: <Stethoscope className="w-4 h-4 text-teal-600" />,
        action: () => setDiagnosticModalOpen(true),
        badge: 'SQL Check',
        visible: canDiagnostic,
      },
      {
        id: 'depots',
        title: tr(language, 'Gestion des Dépôts & Magasins', 'Manage Depots & Warehouses'),
        category: tr(language, 'Logistique', 'Logistics'),
        description: tr(language, 'Ajouter des dépôts, fermer temporairement un dépôt et définir les emplacements', 'Add depots, pause depot activity, define locations'),
        keywords: ['depot', 'depots', 'magasin', 'stockage', 'atelier', 'entrepot', 'multi-depot'],
        icon: <Warehouse className="w-4 h-4 text-orange-600" />,
        action: () => setDepotsModalOpen(true),
        badge: `${depots.length}/${maxDepots}`,
        visible: canManageDepots,
      },
      {
        id: 'projects',
        title: tr(language, 'Chantiers, Conducteurs & Suppléants (+)', 'Sites, Managers & Deputies (+)'),
        category: tr(language, 'Chantiers & Équipes', 'Sites & Teams'),
        description: tr(language, 'Gérer les chantiers, filtrer les conducteurs par département et désigner des suppléants', 'Manage sites, filter managers by department and add deputies'),
        keywords: ['chantier', 'chantiers', 'projet', 'projets', 'conducteur', 'travaux', 'suppleant', 'depute', 'site'],
        icon: <Building2 className="w-4 h-4 text-orange-600" />,
        action: () => setDepartmentsProjectsModal({ open: true, tab: 'projects' }),
        visible: true,
      },
      {
        id: 'departments',
        title: tr(language, 'Départements, Responsables & Droits KPI', 'Departments, Heads & KPI Rights'),
        category: tr(language, 'Organisation', 'Organization'),
        description: tr(language, 'Créer des départements, nommer des suppléants et configurer l\'accès aux KPIs société', 'Create departments, appoint deputies and configure KPI rights'),
        keywords: ['departement', 'departements', 'service', 'services', 'direction', 'plomberie', 'electricite', 'logistique', 'kpi'],
        icon: <FolderTree className="w-4 h-4 text-orange-600" />,
        action: () => setDepartmentsProjectsModal({ open: true, tab: 'deps' }),
        visible: true,
      },
      {
        id: 'users',
        title: tr(language, 'Utilisateurs, Dépôts Autorisés & Forçage PIN', 'Users, Allowed Depots & Forced PIN'),
        category: tr(language, 'Sécurité & Droits', 'Security & Access'),
        description: tr(language, 'Gérer les comptes, accès à 1, 2, 3 dépôts ou tous, forçage réinitialisation PIN', 'Manage accounts, access to 1, 2, 3 depots or all, force PIN reset'),
        keywords: ['utilisateur', 'users', 'collaborateur', 'compte', 'depot autorise', 'reset pin', 'bloquer', 'droits'],
        icon: <Users className="w-4 h-4 text-orange-600" />,
        action: () => setUsersRolesModal({ open: true, tab: 'users' }),
        visible: canUsers,
      },
      {
        id: 'roles',
        title: tr(language, 'Rôles RBAC & Confidentialité des Logs', 'RBAC Roles & Log Privacy'),
        category: tr(language, 'Sécurité & Droits', 'Security & Access'),
        description: tr(language, 'Matrice des permissions fines, droits KPIs, et restriction de visibilité des logs de connexion', 'Permissions matrix, KPI rights, login log visibility control'),
        keywords: ['role', 'roles', 'rbac', 'permission', 'droits', 'logs', 'connexion', 'securite'],
        icon: <Shield className="w-4 h-4 text-orange-600" />,
        action: () => setUsersRolesModal({ open: true, tab: 'roles' }),
        visible: canRoles,
      },
      {
        id: 'inventory_audit',
        title: tr(language, 'Comptage d\'Inventaire & Régularisation', 'Physical Inventory & Adjustment'),
        category: tr(language, 'Inventaire', 'Inventory'),
        description: tr(language, 'Audit physique du stock, calcul des écarts et régularisation automatique', 'Physical stock audit, discrepancy calculation and adjustment'),
        keywords: ['inventaire', 'comptage', 'regularisation', 'ecart', 'audit', 'stock physique'],
        icon: <ClipboardCheck className="w-4 h-4 text-emerald-600" />,
        action: () => setInventoryAuditModalOpen(true),
        visible: canInventoryAudit,
      },
      {
        id: 'print_labels',
        title: tr(language, 'Impression d\'Étiquettes QR Code & Barres', 'Print QR Codes & Barcode Labels'),
        category: tr(language, 'Outils d\'Identification', 'Identification Tools'),
        description: tr(language, 'Générer des planches d\'étiquettes adhésives QR code TOT et codes-barres 1D', 'Generate printable adhesive label sheets for items and bins'),
        keywords: ['etiquette', 'imprimer', 'impression', 'qr code', 'barcode', 'planche', 'stickers'],
        icon: <Printer className="w-4 h-4 text-blue-600" />,
        action: () => setPrintLabelsModal({ open: true }),
        visible: canPrintLabels,
      },
      {
        id: 'print_station',
        title: t('print_station_title'),
        category: tr(language, 'Outils d\'Identification', 'Identification Tools'),
        description: t('print_station_subtitle'),
        keywords: ['poste', 'impression', 'etiquette', 'distance', 'mobile', 'scanner', 'print station', 'thermique', 'avery'],
        icon: <Printer className="w-4 h-4 text-emerald-600" />,
        action: () => setPrintStationModalOpen(true),
        badge: 'PC / Bureau',
        visible: canPrintLabels,
      },
      {
        id: 'categories',
        title: tr(language, 'Catégories & Familles d\'Articles', 'Categories & Subcategories'),
        category: tr(language, 'Catalogue', 'Catalog'),
        description: tr(language, 'Classer votre matériel (Outillage, Consommables, EPI, etc.)', 'Classify tools, consumables, PPE'),
        keywords: ['categorie', 'famille', 'sous-categorie', 'classement', 'rubrique'],
        icon: <Sliders className="w-4 h-4 text-orange-600" />,
        action: () => setCategoriesModalOpen(true),
        visible: canCategories,
      },
      {
        id: 'email_reports',
        title: tr(language, 'Rapports E-mail Automatiques (Brevo)', 'Automated Email Reports (Brevo)'),
        category: tr(language, 'Rapports', 'Reports'),
        description: tr(language, 'Envoi quotidien/hebdomadaire des mouvements et alertes de stock', 'Daily/weekly email summary of movements and alerts'),
        keywords: ['email', 'rapport', 'brevo', 'mail', 'notification', 'alerte'],
        icon: <Mail className="w-4 h-4 text-indigo-600" />,
        action: () => setEmailReportsModalOpen(true),
        visible: canEmail && emailServiceConfigured,
      },
      {
        id: 'smtp_settings',
        title: tr(language, 'Configuration Brevo & SMTP', 'Brevo & SMTP Configuration'),
        category: tr(language, 'Administration & E-mails', 'Administration & Emails'),
        description: tr(language, 'Paramétrer l\'API Brevo ou serveur SMTP (Gmail, Outlook, OVH...) pour l\'envoi réel des alertes', 'Configure Brevo API or SMTP server (Gmail, Outlook, OVH...) for alert delivery'),
        keywords: ['smtp', 'brevo', 'mail', 'email', 'configuration', 'serveur', 'gmail', 'outlook', 'sendinblue', 'api key', 'mot de passe'],
        icon: <Sliders className="w-4 h-4 text-cyan-600" />,
        action: () => setSmtpSettingsModalOpen(true),
        visible: canEmail || canDbConfig,
      },
      {
        id: 'qr_config',
        title: tr(language, 'Partage de Licence QR Code Multi-Appareils', 'Multi-Device QR Code License Sharing'),
        category: tr(language, 'Système & Multi-Postes', 'System & Multi-Device'),
        description: tr(language, 'Scanner ce code sur un second smartphone pour cloner instantanément la configuration', 'Scan to clone company configuration on a new phone'),
        keywords: ['qr code config', 'partage', 'smartphone', 'telephone', 'synchroniser', 'licence qr'],
        icon: <QrCode className="w-4 h-4 text-orange-600" />,
        action: () => setQrConfigGenModalOpen(true),
        visible: true,
      },
      {
        id: 'company_setup',
        title: tr(language, 'Base Supabase & Paramètres Entreprise', 'Supabase Database & Company Settings'),
        category: tr(language, 'Système & Supabase', 'System & Supabase'),
        description: tr(language, 'Connexion BYOD Supabase, synchronisation cloud, devise et licence', 'BYOD Supabase setup, cloud sync, company currency & license'),
        keywords: ['supabase', 'base de donnees', 'cle', 'url', 'entreprise', 'sauvegarde', 'licence'],
        icon: <Database className="w-4 h-4 text-emerald-600" />,
        action: () => setCompanySetupModalOpen(true),
        visible: canDbConfig,
      },
      {
        id: 'scanner_picking_mode',
        title: t('scanner_mode_title'),
        category: tr(language, 'Logistique & Commandes', 'Logistics & Orders'),
        description: t('scanner_mode_subtitle'),
        keywords: ['scanner', 'mode scanner', 'picking', 'magasinier', 'preparation', 'commande', 'mobile'],
        icon: <Scan className="w-4 h-4 text-emerald-600" />,
        action: () => openScannerPickingMode(),
        badge: t('scanner_mode_btn'),
        visible: canScannerMode,
      },
      {
        id: 'app_info',
        title: tr(language, 'À Propos & Version TOT', 'About & Version Info'),
        category: tr(language, 'Informations', 'Information'),
        description: tr(language, 'Version, mentions légales et raccourcis rapides', 'Version, info and legal mentions'),
        keywords: ['a propos', 'version', 'info', 'aide'],
        icon: <Info className="w-4 h-4 text-slate-500" />,
        action: () => setAppInfoModalOpen(true),
        visible: true,
      },
    ];
  }, [
    language,
    t,
    canScannerMode,
    openScannerPickingMode,
    currency,
    depots.length,
    maxDepots,
    canManageDepots,
    canDepProj,
    canUsers,
    canRoles,
    canCategories,
    canEmail,
    emailServiceConfigured,
    canDbConfig,
    setProfileModalOpen,
    setDocumentationModalOpen,
    setDepotsModalOpen,
    setDepartmentsProjectsModal,
    setUsersRolesModal,
    setInventoryAuditModalOpen,
    setPrintLabelsModal,
    setPrintStationModalOpen,
    setCategoriesModalOpen,
    setEmailReportsModalOpen,
    setSmtpSettingsModalOpen,
    setQrConfigGenModalOpen,
    setCompanySetupModalOpen,
    setAppInfoModalOpen,
  ]);

  const searchedItems = useMemo(() => {
    if (!menuSearch.trim()) return [];
    const q = menuSearch.toLowerCase().trim();
    return allMenuItems.filter((item) => {
      if (!item.visible) return false;
      return (
        item.title.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.keywords.some((k) => k.toLowerCase().includes(q))
      );
    });
  }, [allMenuItems, menuSearch]);

  return (
    <div className="space-y-4 pb-28 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-black text-slate-900 dark:text-white">••• {t('menu_general')}</h2>
          <p className="text-[11px] text-slate-400">
            {t('menu_general_desc')}
          </p>
        </div>
      </div>

      {/* Barre de Recherche dans le menu Plus */}
      <div className="relative overflow-hidden">
        <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-20 shrink-0" />
        <input
          type="search"
          value={menuSearch}
          onChange={(e) => setMenuSearch(e.target.value)}
          placeholder={
            tr(language, 'Rechercher un menu (devise, dépôt, chantiers, pdf, pin, rbac, licence...)...', 'Search any menu (currency, depot, sites, pdf, pin, rbac, license...)...')
          }
          className="w-full pl-9 pr-9 py-2.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 transition relative z-10"
        />
        {menuSearch && (
          <button
            onClick={() => setMenuSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 z-20 shrink-0"
            title="Effacer la recherche"
          >
            <X className="w-3.5 h-3.5 shrink-0" />
          </button>
        )}
      </div>

      {/* Affichage des résultats filtrés si recherche active */}
      {menuSearch.trim() ? (
        <div className="space-y-3 animate-fadeIn">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-bold text-orange-600 dark:text-orange-400 uppercase tracking-wider">
              {searchedItems.length}{' '}
              {tr(language, 'résultat(s) trouvé(s)', 'result(s) found')}
            </span>
            <button
              onClick={() => setMenuSearch('')}
              className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 underline"
            >
              {tr(language, 'Réinitialiser la recherche', 'Reset search')}
            </button>
          </div>

          {searchedItems.length === 0 ? (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
              <Search className="w-8 h-8 mx-auto mb-2 text-slate-300 dark:text-slate-600 shrink-0" />
              <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                {tr(language, `Aucun menu correspondant à « ${menuSearch} »`, `No menu matching "${menuSearch}"`)}
              </div>
              <p className="text-[11px] text-slate-400 mt-1 max-w-xs mx-auto">
                {tr(language, 'Essayez des mots-clés comme : devise, dépôt, chantier, pdf, pin, rôle, licence, brevo, audit...', 'Try keywords like: currency, depot, site, pdf, pin, role, license, brevo, audit...')}
              </p>
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 shadow-sm overflow-hidden text-xs">
              {searchedItems.map((item) => (
                <button
                  key={item.id}
                  onClick={item.action}
                  className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-orange-50/50 dark:hover:bg-orange-950/20 transition group cursor-pointer relative overflow-hidden"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
                    <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 group-hover:bg-orange-100 dark:group-hover:bg-orange-950/60 flex items-center justify-center shrink-0 transition relative z-20">
                      {item.icon}
                    </div>
                    <div className="min-w-0 flex-1 relative z-0 overflow-hidden">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 dark:text-white group-hover:text-orange-600 dark:group-hover:text-orange-400 transition">
                          {item.title}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-semibold shrink-0">
                          {item.category}
                        </span>
                        {item.badge && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-orange-100 dark:bg-orange-950/70 text-orange-700 dark:text-orange-300 font-bold shrink-0">
                            {item.badge}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">
                        {item.description}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-orange-500 group-hover:translate-x-0.5 transition shrink-0 relative z-20" />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>

      {/* COMPTE */}
      <div>
        <div className="text-[11px] font-bold text-orange-600 dark:text-orange-400 uppercase tracking-wider mb-1.5 px-1">
          {t('menu_user_account')}
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 shadow-sm overflow-hidden text-xs">
          <button
            onClick={() => setProfileModalOpen(true)}
            className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition relative overflow-hidden"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
              <div className="w-8 h-8 rounded-xl bg-orange-100 dark:bg-orange-950/60 text-orange-600 flex items-center justify-center font-bold shrink-0 relative z-20">
                <User className="w-4 h-4 shrink-0 relative z-20" />
              </div>
              <div className="min-w-0 flex-1 relative z-0 overflow-hidden">
                <div className="font-bold text-slate-800 dark:text-slate-100">
                  {currentUser?.name || 'Mon profil'}
                </div>
                <div className="text-[11px] text-slate-400">
                  {t('menu_change_pin')}
                </div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 relative z-20" />
          </button>

          {/* Independent Sound Effects & Audio Beeps Tile */}
          <div
            id="sound-select-tile"
            className="w-full px-4 py-3 flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition scroll-mt-20 relative overflow-hidden"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold shrink-0 relative z-20 ${
                soundEnabled
                  ? 'bg-orange-100 dark:bg-orange-950/60 text-orange-600'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
              }`}>
                {soundEnabled ? (
                  <Volume2 className="w-4 h-4 shrink-0 relative z-20" />
                ) : (
                  <VolumeX className="w-4 h-4 shrink-0 relative z-20" />
                )}
              </div>
              <div className="min-w-0 flex-1 relative z-0 overflow-hidden">
                <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 flex-wrap">
                  <span>{tr(language, 'Sons & Bips Audio', 'Sound & Audio Beeps')}</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider shrink-0 border ${
                      soundEnabled
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                        : 'bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300 border-rose-300 dark:border-rose-800'
                    }`}
                  >
                    {soundEnabled
                      ? tr(language, 'Son activé', 'Sound ON')
                      : tr(language, 'Son coupé (Muet)', 'Muted')}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400">
                  {tr(language, 'Sons d\'interface et alertes commandes (le bip Scan / Entrée / Sortie reste toujours actif)', 'UI & order alert sounds (Scan / Stock In / Stock Out beep always stays active)')}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 relative z-20">
              <button
                type="button"
                data-haptic="light"
                onClick={() => {
                  if (!soundEnabled) {
                    setSoundEnabledState(true);
                    setSoundEnabled(true);
                  }
                  triggerSoundTest();
                  setTestedSound(true);
                  setTimeout(() => setTestedSound(false), 1200);
                }}
                className="px-2.5 py-1 text-[10px] font-bold rounded-lg bg-orange-100 hover:bg-orange-200 dark:bg-orange-950/60 dark:hover:bg-orange-900/60 text-orange-700 dark:text-orange-300 transition flex items-center gap-1 cursor-pointer shrink-0"
              >
                <Volume2 className="w-3 h-3 shrink-0" />
                <span>{testedSound ? (tr(language, 'Bip !', 'Beep!')) : (tr(language, 'Tester', 'Test'))}</span>
              </button>
              <button
                type="button"
                data-haptic="light"
                onClick={() => {
                  const nextVal = !soundEnabled;
                  setSoundEnabledState(nextVal);
                  setSoundEnabled(nextVal);
                  if (nextVal) {
                    triggerSoundTest();
                  }
                }}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  soundEnabled ? 'bg-orange-500' : 'bg-slate-300 dark:bg-slate-700'
                }`}
                role="switch"
                aria-checked={soundEnabled}
                title={tr(language, 'Couper ou activer le son indépendamment du vibreur', 'Mute or unmute sound independently')}
              >
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    soundEnabled ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Haptic Feedback & Vibrator Tile */}
          <div
            id="haptics-select-tile"
            className="w-full px-4 py-3 flex flex-col gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition scroll-mt-20 relative overflow-hidden"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
                <div className="w-8 h-8 rounded-xl bg-orange-100 dark:bg-orange-950/60 text-orange-600 flex items-center justify-center font-bold shrink-0 relative z-20">
                  <Smartphone className="w-4 h-4 shrink-0 relative z-20" />
                </div>
                <div className="min-w-0 flex-1 relative z-0 overflow-hidden">
                  <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 flex-wrap">
                    <span>{tr(language, 'Vibreur & Retour Tactile', 'Vibrator & Haptics')}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider shrink-0 border ${
                        hapticEnabled
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-300 dark:border-slate-700'
                      }`}
                    >
                      {hapticEnabled ? (tr(language, 'Activé', 'Enabled')) : (tr(language, 'Désactivé', 'Disabled'))}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {tr(language, 'Vibre lors des scans QR/code-barres et de la pression des touches', 'Vibrates on QR/barcode scans and button taps')}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 relative z-20">
                <button
                  type="button"
                  data-haptic="scan"
                  onClick={() => {
                    if (!hapticEnabled) {
                      setHapticEnabledState(true);
                      setHapticsEnabled(true);
                    }
                    triggerHapticTest();
                    setTestedHaptic(true);
                    setTimeout(() => setTestedHaptic(false), 1200);
                  }}
                  className="px-2.5 py-1 text-[10px] font-bold rounded-lg bg-orange-100 hover:bg-orange-200 dark:bg-orange-950/60 dark:hover:bg-orange-900/60 text-orange-700 dark:text-orange-300 transition flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <Sparkles className="w-3 h-3 shrink-0" />
                  <span>{testedHaptic ? (tr(language, 'Vibration !', 'Buzz!')) : (tr(language, 'Tester', 'Test'))}</span>
                </button>
                <button
                  type="button"
                  data-haptic="medium"
                  onClick={() => {
                    const nextVal = !hapticEnabled;
                    setHapticEnabledState(nextVal);
                    setHapticsEnabled(nextVal);
                    if (nextVal) {
                      triggerHapticTest();
                    }
                  }}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    hapticEnabled ? 'bg-orange-500' : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                  role="switch"
                  aria-checked={hapticEnabled}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      hapticEnabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>

            {hapticEnabled && (
              <div className="grid grid-cols-3 gap-1.5 pl-11">
                {(
                  [
                    { id: 'light' as HapticIntensity, label: tr(language, 'Léger', 'Light') },
                    { id: 'normal' as HapticIntensity, label: tr(language, 'Normal', 'Normal') },
                    { id: 'strong' as HapticIntensity, label: tr(language, 'Fort (Chantier)', 'Strong') },
                  ]
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    data-haptic="medium"
                    onClick={() => {
                      setHapticIntensityState(opt.id);
                      setHapticIntensity(opt.id);
                      hapticFeedback.medium();
                    }}
                    className={`py-1 px-2 rounded-lg text-[10px] font-bold border transition cursor-pointer ${
                      hapticIntensity === opt.id
                        ? 'bg-orange-500 text-white border-orange-500 shadow-xs'
                        : 'bg-slate-50 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Language Switch Tile */}
          <div
            onClick={toggleLanguage}
            className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition cursor-pointer relative overflow-hidden"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
              <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 flex items-center justify-center font-bold text-base shrink-0 relative z-20">
                {language === 'fr' ? '🇫🇷' : language === 'en' ? '🇬🇧' : '🇳🇱'}
              </div>
              <div className="min-w-0 flex-1 relative z-0 overflow-hidden">
                <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 flex-wrap">
                  <span>{t('menu_language_title')}</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-300 dark:border-blue-800 shrink-0">
                    {language === 'fr' ? 'Français' : language === 'en' ? 'English' : 'Nederlands'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400">
                  {t('menu_language_desc')}
                </div>
              </div>
            </div>
            <div
              className="flex items-center gap-1 shrink-0 relative z-20"
              onClick={(e) => e.stopPropagation()}
            >
              {(
                [
                  { code: 'fr' as const, label: 'FR 🇫🇷' },
                  { code: 'en' as const, label: 'EN 🇬🇧' },
                  { code: 'nl' as const, label: 'NL 🇳🇱' },
                ]
              ).map((langOpt) => (
                <button
                  key={langOpt.code}
                  type="button"
                  onClick={() => setLanguage(langOpt.code)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                    language === langOpt.code
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {langOpt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Currency Switcher Tile */}
          <div
            id="currency-select-tile"
            className="w-full px-4 py-3 flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition scroll-mt-20 relative overflow-hidden"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
              <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 flex items-center justify-center font-bold text-sm shrink-0 relative z-20">
                <Coins className="w-4 h-4 shrink-0 relative z-20" />
              </div>
              <div className="min-w-0 flex-1 relative z-0 overflow-hidden">
                <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 flex-wrap">
                  <span>{tr(language, 'Devise de Valorisation', 'Valuation Currency')}</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800 shrink-0">
                    {currency} ({SUPPORTED_CURRENCIES.find((c) => c.code === currency)?.symbol || '€'})
                  </span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-bold border border-emerald-200 dark:border-emerald-800 shrink-0">
                    {tr(language, '🏢 Centralisée Entreprise (Supabase)', '🏢 Centralized Company-wide')}
                  </span>
                  {!canManageCurrency && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold border border-slate-200 dark:border-slate-700 flex items-center gap-1 shrink-0">
                      <Lock className="w-3 h-3 text-slate-500 shrink-0" />
                      <span>{tr(language, 'Réservé Administrateur', 'Admin Only')}</span>
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-400">
                  {canManageCurrency
                    ? (tr(language, 'Synchronisée avec toute l\'entreprise & mémorisée localement hors-ligne', 'Synchronized with all company users & cached offline'))
                    : (tr(language, 'Seuls les administrateurs ont le droit de modifier la devise d\'entreprise', 'Only administrators have permission to modify valuation currency'))}
                </div>
              </div>
            </div>
            {canManageCurrency ? (
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="text-xs font-bold py-1.5 px-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 outline-none cursor-pointer shrink-0 relative z-20"
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.flag} {c.code} ({c.symbol})
                  </option>
                ))}
              </select>
            ) : (
              <div
                className="text-xs font-bold py-1.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 cursor-not-allowed select-none shrink-0 relative z-20"
                title={tr(language, 'Modification réservée aux administrateurs', 'Restricted to administrators')}
              >
                <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0 relative z-20" />
                <span>{SUPPORTED_CURRENCIES.find((c) => c.code === currency)?.flag || '🏳️'} {currency}</span>
              </div>
            )}
          </div>

          <button
            onClick={logout}
            className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-rose-50/50 dark:hover:bg-rose-950/20 text-rose-600 dark:text-rose-400 transition relative overflow-hidden"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
              <div className="w-8 h-8 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 flex items-center justify-center font-bold shrink-0 relative z-20">
                <LogOut className="w-4 h-4 shrink-0 relative z-20" />
              </div>
              <div className="font-bold min-w-0 flex-1 relative z-0">{t('header_logout')}</div>
            </div>
            <ChevronRight className="w-4 h-4 text-rose-400 shrink-0 relative z-20" />
          </button>
        </div>
      </div>

      {/* GESTION */}
      <div>
        <div className="text-[11px] font-bold text-orange-600 dark:text-orange-400 uppercase tracking-wider mb-1.5 px-1">
          {t('menu_operational')}
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 shadow-sm overflow-hidden text-xs">
          <button
            onClick={() => setActiveTab('home')}
            className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition relative overflow-hidden"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
              <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 flex items-center justify-center font-bold shrink-0 relative z-20">
                <BarChart3 className="w-4 h-4 shrink-0 relative z-20" />
              </div>
              <div className="font-bold text-slate-800 dark:text-slate-100 min-w-0 flex-1 relative z-0">
                {t('menu_dashboard_tile')}
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 relative z-20" />
          </button>

          <button
            onClick={() => setActiveTab('search')}
            className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition relative overflow-hidden"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
              <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 flex items-center justify-center font-bold shrink-0 relative z-20">
                <Package className="w-4 h-4 shrink-0 relative z-20" />
              </div>
              <div className="font-bold text-slate-800 dark:text-slate-100 min-w-0 flex-1 relative z-0">
                {t('menu_inventory_tile')}
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 relative z-20" />
          </button>

          {canEditProduct && (
            <button
              onClick={() => setProductFormState({ open: true, product: null })}
              className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition relative overflow-hidden"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
                <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center font-bold shrink-0 relative z-20">
                  <PlusCircle className="w-4 h-4 shrink-0 relative z-20" />
                </div>
                <div className="font-bold text-slate-800 dark:text-slate-100 min-w-0 flex-1 relative z-0">
                  {t('menu_create_product_tile')}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 relative z-20" />
            </button>
          )}

          {canDepProj && (
            <>
              {/* Départements & Responsables */}
              <button
                onClick={() => setDepartmentsProjectsModal({ open: true, tab: 'deps' })}
                className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition cursor-pointer relative overflow-hidden"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
                  <div className="w-8 h-8 rounded-xl bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 flex items-center justify-center font-bold shrink-0 relative z-20">
                    <FolderTree className="w-4 h-4 shrink-0 relative z-20" />
                  </div>
                  <div className="min-w-0 flex-1 relative z-0 overflow-hidden">
                    <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 flex-wrap">
                      <span>{tr(language, 'Départements & Responsables', 'Departments & Heads')}</span>
                      <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md bg-indigo-500/10 text-indigo-600 border border-indigo-500/20 shrink-0">
                        {departments.length}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {tr(language, 'Créer des départements, nommer des suppléants et droits KPI', 'Create departments, appoint deputies and configure KPI rights')}
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 relative z-20" />
              </button>

              {/* Chantiers & Conducteurs */}
              <button
                onClick={() => setDepartmentsProjectsModal({ open: true, tab: 'projects' })}
                className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition cursor-pointer relative overflow-hidden"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
                  <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 flex items-center justify-center font-bold shrink-0 relative z-20">
                    <Building2 className="w-4 h-4 shrink-0 relative z-20" />
                  </div>
                  <div className="min-w-0 flex-1 relative z-0 overflow-hidden">
                    <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 flex-wrap">
                      <span>{tr(language, 'Chantiers & Conducteurs de Travaux', 'Job Sites & Site Managers')}</span>
                      <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 border border-amber-500/20 shrink-0">
                        {projects.length}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {tr(language, 'Gérer les chantiers, filtrer les conducteurs et suppléants (+)', 'Manage job sites, filter managers and deputies (+)')}
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 relative z-20" />
              </button>
            </>
          )}

          {/* Planches d'Étiquettes & QR Codes */}
          {canPrintLabels && (
            <>
              <button
                onClick={() => setPrintLabelsModal({ open: true })}
                className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition cursor-pointer relative overflow-hidden"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
                  <div className="w-8 h-8 rounded-xl bg-orange-100 dark:bg-orange-950/60 text-orange-600 flex items-center justify-center font-bold shrink-0 relative z-20">
                    <Printer className="w-4 h-4 shrink-0 relative z-20" />
                  </div>
                  <div className="min-w-0 flex-1 relative z-0 overflow-hidden">
                    <div className="font-bold text-slate-800 dark:text-slate-100">
                      {t('menu_print_labels_tile')}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {t('menu_print_labels_desc')}
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 relative z-20" />
              </button>

              {/* Poste d'impression (PC / Bureau — réception depuis le Mode Scanner) */}
              <button
                type="button"
                onClick={() => setPrintStationModalOpen(true)}
                className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 transition cursor-pointer relative overflow-hidden"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
                  <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center font-bold shrink-0 relative z-20">
                    <Printer className="w-4 h-4 shrink-0 relative z-20" />
                  </div>
                  <div className="min-w-0 flex-1 relative z-0 overflow-hidden">
                    <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 flex-wrap">
                      <span>{t('print_station_title')}</span>
                      <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 shrink-0">
                        PC / Bureau
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {t('print_station_subtitle')}
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 relative z-20" />
              </button>
            </>
          )}

          {/* Comptage d'Inventaire & Audit de Stock */}
          {canInventoryAudit && (
            <button
              onClick={() => setInventoryAuditModalOpen(true)}
              className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition cursor-pointer relative overflow-hidden"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
                <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center font-bold shrink-0 relative z-20">
                  <ClipboardCheck className="w-4 h-4 shrink-0 relative z-20" />
                </div>
                <div className="min-w-0 flex-1 relative z-0 overflow-hidden">
                  <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 flex-wrap">
                    <span>{t('menu_inventory_audit_tile')}</span>
                    <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 shrink-0">
                      Audit
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {t('menu_inventory_audit_desc')}
                  </div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 relative z-20" />
            </button>
          )}
        </div>
      </div>

      {/* COMMANDES MATÉRIEL & PRÉPARATION MAGASIN (DRIVE CHANTIER) */}
      {(canCreateOrder || canOrderPrep) && (
        <div>
          <div className="text-[11px] font-bold text-orange-600 dark:text-orange-400 uppercase tracking-wider mb-1.5 px-1 flex items-center justify-between gap-2">
            <span>{tr(language, 'Commandes Matériel & Préparations', 'Material Orders & Fulfillment')}</span>
            <span className="text-[10px] font-black text-slate-400 uppercase shrink-0">Drive Chantier</span>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 shadow-xs overflow-hidden text-xs">
            {/* Panier & Mes Commandes Chantier (Demandeur) */}
            {canCreateOrder && (
              <button
                type="button"
                onClick={() => setOrderCartModalOpen(true)}
                className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition cursor-pointer relative overflow-hidden"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
                  <div className="w-8 h-8 rounded-xl bg-orange-100 dark:bg-orange-950/60 text-orange-600 flex items-center justify-center font-bold shrink-0 relative z-20">
                    <ShoppingCart className="w-4 h-4 shrink-0 relative z-20" />
                  </div>
                  <div className="min-w-0 flex-1 relative z-0 overflow-hidden">
                    <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 flex-wrap">
                      <span>{tr(language, 'Mon Panier & Suivi Commandes', 'My Cart & Order Tracking')}</span>
                      {myReadyOrdersCount > 0 ? (
                        <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md bg-emerald-500 text-white animate-pulse shrink-0">
                          {myReadyOrdersCount} Prête(s) !
                        </span>
                      ) : orderCart.length > 0 ? (
                        <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md bg-orange-500/10 text-orange-600 border border-orange-500/20 shrink-0">
                          {orderCart.length} article(s)
                        </span>
                      ) : null}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {tr(language, 'Commander du matériel, suivre la préparation et confirmer le retrait', 'Order material, track preparation and confirm pickup')}
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 relative z-20" />
              </button>
            )}

            {/* Préparation des Commandes Magasin (Magasinier) */}
            {canOrderPrep && (
              <button
                type="button"
                onClick={() => setPreparerOrdersModalOpen(true)}
                className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition cursor-pointer relative overflow-hidden"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
                  <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 flex items-center justify-center font-bold shrink-0 relative z-20">
                    <Package className="w-4 h-4 shrink-0 relative z-20" />
                  </div>
                  <div className="min-w-0 flex-1 relative z-0 overflow-hidden">
                    <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 flex-wrap">
                      <span>{tr(language, 'Préparation des Commandes Magasin', 'Warehouse Order Preparation')}</span>
                      {pendingPrepCount > 0 ? (
                        <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md bg-blue-500 text-white shrink-0">
                          {pendingPrepCount} à préparer
                        </span>
                      ) : (
                        <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-600 border border-blue-500/20 shrink-0">
                          Magasinier
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {tr(language, 'Réception des commandes chantiers, assignation, picking et mise à disposition', 'Receive site orders, assign, pick and notify readiness')}
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 relative z-20" />
              </button>
            )}

            {/* Mode Scanner (Préparation mobile plein écran) */}
            {canScannerMode && (
              <button
                type="button"
                onClick={() => openScannerPickingMode()}
                className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-emerald-50/60 dark:hover:bg-emerald-950/30 transition cursor-pointer relative overflow-hidden"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
                  <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center font-bold shrink-0 relative z-20">
                    <Scan className="w-4 h-4 shrink-0 relative z-20" />
                  </div>
                  <div className="min-w-0 flex-1 relative z-0 overflow-hidden">
                    <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 flex-wrap">
                      <span>{t('scanner_mode_btn')}</span>
                      <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md bg-emerald-600 text-white shrink-0">
                        Mobile
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {t('scanner_mode_subtitle')}
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 relative z-20" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* RAPPORTS BREVO MAIL */}
      {canEmail && emailServiceConfigured && (
        <div>
          <div className="text-[11px] font-bold text-orange-600 dark:text-orange-400 uppercase tracking-wider mb-1.5 px-1">
            {t('menu_reports')}
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 shadow-sm overflow-hidden text-xs">
            <button
              onClick={() => setEmailReportsModalOpen(true)}
              className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition relative overflow-hidden"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
                <div className="w-8 h-8 rounded-xl bg-purple-100 dark:bg-purple-950/60 text-purple-600 flex items-center justify-center font-bold shrink-0 relative z-20">
                  <Mail className="w-4 h-4 shrink-0 relative z-20" />
                </div>
                <div className="min-w-0 flex-1 relative z-0 overflow-hidden">
                  <div className="font-bold text-slate-800 dark:text-slate-100">
                    {t('menu_reports_center')}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {t('menu_reports_desc')}
                  </div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 relative z-20" />
            </button>
          </div>
        </div>
      )}

      {/* ADMINISTRATION */}
      <div>
        <div className="text-[11px] font-bold text-orange-600 dark:text-orange-400 uppercase tracking-wider mb-1.5 px-1">
          {t('menu_admin')}
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 shadow-sm overflow-hidden text-xs">
          {(canEmail || canDbConfig) && (
            <button
              type="button"
              onClick={() => setSmtpSettingsModalOpen(true)}
              className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition cursor-pointer active:scale-[0.99] relative overflow-hidden"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
                <div className="w-8 h-8 rounded-xl bg-cyan-100 dark:bg-cyan-950/60 text-cyan-600 flex items-center justify-center font-bold shrink-0 relative z-20">
                  <Sliders className="w-4 h-4 shrink-0 relative z-20" />
                </div>
                <div className="min-w-0 flex-1 relative z-0 overflow-hidden">
                  <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 flex-wrap">
                    <span>{t('smtp_title')}</span>
                    <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md bg-cyan-500/10 text-cyan-600 border border-cyan-500/20 shrink-0">
                      API
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {t('smtp_subtitle')}
                  </div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 relative z-20" />
            </button>
          )}

          {canCategories && (
            <button
              onClick={() => setCategoriesModalOpen(true)}
              className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition relative overflow-hidden"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
                <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 flex items-center justify-center font-bold shrink-0 relative z-20">
                  <FolderTree className="w-4 h-4 shrink-0 relative z-20" />
                </div>
                <div className="font-bold text-slate-800 dark:text-slate-100 min-w-0 flex-1 relative z-0">
                  {t('menu_categories')}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 relative z-20" />
            </button>
          )}

          {canManageDepots && (
            <button
              onClick={() => setDepotsModalOpen(true)}
              className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition relative overflow-hidden"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
                <div className="w-8 h-8 rounded-xl bg-orange-100 dark:bg-orange-950/60 text-orange-600 flex items-center justify-center font-bold shrink-0 relative z-20">
                  <Warehouse className="w-4 h-4 shrink-0 relative z-20" />
                </div>
                <div className="min-w-0 flex-1 relative z-0 overflow-hidden">
                  <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 flex-wrap">
                    <span>{t('menu_depots_management')}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 shrink-0">
                      {depots.length}/{maxDepots >= 99999 ? '∞' : maxDepots}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {t('menu_depots_desc')}
                  </div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 relative z-20" />
            </button>
          )}

          {canRoles && (
            <button
              onClick={() => setUsersRolesModal({ open: true, tab: 'roles' })}
              className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition relative overflow-hidden"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
                <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 flex items-center justify-center font-bold shrink-0 relative z-20">
                  <Shield className="w-4 h-4 shrink-0 relative z-20" />
                </div>
                <div className="font-bold text-slate-800 dark:text-slate-100 min-w-0 flex-1 relative z-0">
                  {t('menu_roles_perms')}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 relative z-20" />
            </button>
          )}

          {canUsers && (
            <button
              onClick={() => setUsersRolesModal({ open: true, tab: 'users' })}
              className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition relative overflow-hidden"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
                <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center font-bold shrink-0 relative z-20">
                  <Users className="w-4 h-4 shrink-0 relative z-20" />
                </div>
                <div className="font-bold text-slate-800 dark:text-slate-100 min-w-0 flex-1 relative z-0">
                  {t('menu_users_teams')}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 relative z-20" />
            </button>
          )}

          {canDbConfig && (
            <button
              onClick={() => setQrConfigGenModalOpen(true)}
              className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition relative overflow-hidden"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
                <div className="w-8 h-8 rounded-xl bg-purple-100 dark:bg-purple-950/60 text-purple-600 flex items-center justify-center font-bold shrink-0 relative z-20">
                  <QrCode className="w-4 h-4 shrink-0 relative z-20" />
                </div>
                <div className="font-bold text-slate-800 dark:text-slate-100 min-w-0 flex-1 relative z-0">
                  {t('menu_qr_config')}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 relative z-20" />
            </button>
          )}

          {canLicense && (
            <button
              onClick={() => setCompanySetupModalOpen(true)}
              className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition cursor-pointer relative overflow-hidden"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
                <div className="w-8 h-8 rounded-xl bg-orange-100 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400 flex items-center justify-center font-bold shrink-0 relative z-20">
                  <Database className="w-4 h-4 shrink-0 relative z-20" />
                </div>
                <div className="min-w-0 flex-1 relative z-0 overflow-hidden">
                  <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 flex-wrap">
                    <span>{t('menu_company_license')}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300 border border-orange-300 dark:border-orange-800 shrink-0">
                      {t('menu_plan')} {license?.plan_type ? license.plan_type.toUpperCase() : t('menu_plan_free')}
                    </span>
                    {supabaseSyncStatus === 'connected' && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 shrink-0">
                        {t('menu_connected')}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {license?.organization_name || t('menu_local_org')} • {license?.max_references || 50} {t('menu_max_refs')}
                  </div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 relative z-20" />
            </button>
          )}

          {canDiagnostic && (
            <button
              type="button"
              onClick={() => setDiagnosticModalOpen(true)}
              className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition cursor-pointer relative overflow-hidden"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
                <div className="w-8 h-8 rounded-xl bg-teal-100 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 flex items-center justify-center font-bold shrink-0 relative z-20">
                  <Stethoscope className="w-4 h-4 shrink-0 relative z-20" />
                </div>
                <div className="min-w-0 flex-1 relative z-0 overflow-hidden">
                  <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 flex-wrap">
                    <span>{tr(language, 'Diagnostic', 'Diagnostic')}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-teal-100 dark:bg-teal-950 text-teal-700 dark:text-teal-300 border border-teal-300 dark:border-teal-800 shrink-0">
                      7 Contrôles
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {tr(language, "Vérification de l'installation (rôles 0, 1, 5) & copie du rapport", 'Installation verification (roles 0, 1, 5) & copy report')}
                  </div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 relative z-20" />
            </button>
          )}
        </div>
      </div>

      {/* DOCUMENTATION, GUIDES PDF & EXPORT */}
      <div>
        <div className="text-[11px] font-bold text-orange-600 dark:text-orange-400 uppercase tracking-wider mb-1.5 px-1 flex items-center justify-between gap-2">
          <span>{tr(language, 'Guides, Manuels PDF & Exports', 'Guides, PDF Manuals & Exports')}</span>
          <span className="text-[10px] text-slate-400 font-semibold shrink-0">PDF • Android • HTML</span>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 shadow-sm overflow-hidden text-xs">
          {/* Manuel d'utilisation PDF */}
          <button
            onClick={() => setDocumentationModalOpen({ open: true, tab: 'manual' })}
            className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition cursor-pointer relative overflow-hidden"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
              <div className="w-8 h-8 rounded-xl bg-orange-100 dark:bg-orange-950/60 text-orange-600 flex items-center justify-center font-bold shrink-0 relative z-20">
                <BookOpen className="w-4 h-4 shrink-0 relative z-20" />
              </div>
              <div className="min-w-0 flex-1 relative z-0 overflow-hidden">
                <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 flex-wrap">
                  <span>{tr(language, "Manuel d'Utilisation Officiel", 'Official User Manual')}</span>
                  <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 text-[10px] font-extrabold shrink-0">PDF</span>
                </div>
                <div className="text-[11px] text-slate-400">
                  {tr(language, 'Guide complet de prise en main, scan & stocks', 'Complete user guide for scans & stock')}
                </div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 relative z-20" />
          </button>

          {/* Guide Export Android Studio PDF */}
          <button
            onClick={() => setDocumentationModalOpen({ open: true, tab: 'android' })}
            className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition cursor-pointer relative overflow-hidden"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
              <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center font-bold shrink-0 relative z-20">
                <Smartphone className="w-4 h-4 shrink-0 relative z-20" />
              </div>
              <div className="min-w-0 flex-1 relative z-0 overflow-hidden">
                <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 flex-wrap">
                  <span>{tr(language, 'Export vers Android Studio', 'Export to Android Studio')}</span>
                  <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-extrabold shrink-0">APK / AAB</span>
                </div>
                <div className="text-[11px] text-slate-400">
                  {tr(language, 'Procédure pas à pas avec Capacitor & Gradle', 'Step-by-step guide with Capacitor & Gradle')}
                </div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 relative z-20" />
          </button>

          {/* Code HTML Promotionnel Site Web */}
          <button
            onClick={() => setDocumentationModalOpen({ open: true, tab: 'marketing' })}
            className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition cursor-pointer relative overflow-hidden"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
              <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 flex items-center justify-center font-bold shrink-0 relative z-20">
                <Globe className="w-4 h-4 shrink-0 relative z-20" />
              </div>
              <div className="min-w-0 flex-1 relative z-0 overflow-hidden">
                <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 flex-wrap">
                  <span>{tr(language, 'Code HTML Présentation Site Web', 'Marketing Web Page HTML')}</span>
                  <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-extrabold shrink-0">HTML5</span>
                </div>
                <div className="text-[11px] text-slate-400">
                  {tr(language, 'Page vitrine responsive pour promouvoir TOT Stock', 'Responsive showcase landing page code')}
                </div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 relative z-20" />
          </button>

          {/* Supabase CLI & Migrations */}
          <button
            onClick={() => setDocumentationModalOpen({ open: true, tab: 'supabase' })}
            className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition cursor-pointer relative overflow-hidden"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
              <div className="w-8 h-8 rounded-xl bg-purple-100 dark:bg-purple-950/60 text-purple-600 flex items-center justify-center font-bold shrink-0 relative z-20">
                <Terminal className="w-4 h-4 shrink-0 relative z-20" />
              </div>
              <div className="min-w-0 flex-1 relative z-0 overflow-hidden">
                <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 flex-wrap">
                  <span>{tr(language, 'Commandes Supabase CLI & SQL', 'Supabase CLI & SQL Scripts')}</span>
                  <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 text-[10px] font-extrabold shrink-0">CLI</span>
                </div>
                <div className="text-[11px] text-slate-400">
                  {tr(language, 'Mise à jour tables, suppléants & droits', 'Update tables, deputies & permissions')}
                </div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 relative z-20" />
          </button>
        </div>
      </div>

      {/* A PROPOS */}
      <div>
        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 px-1">
          {t('menu_about')}
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden text-xs">
          <button
            onClick={() => setAppInfoModalOpen(true)}
            className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition relative overflow-hidden"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1 relative z-10 overflow-hidden">
              <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center font-bold shrink-0 relative z-20">
                <Info className="w-4 h-4 shrink-0 relative z-20" />
              </div>
              <div className="min-w-0 flex-1 relative z-0 overflow-hidden">
                <div className="font-bold text-slate-800 dark:text-slate-100">
                  TOT - Inventory &amp; Scan Pro v{APP_VERSION}
                </div>
                <div className="text-[11px] text-slate-400">
                  {t('menu_about_desc')}
                </div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 relative z-20" />
          </button>
        </div>
      </div>
      </>
      )}
    </div>
  );
};
