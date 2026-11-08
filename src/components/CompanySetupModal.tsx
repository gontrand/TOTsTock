import React, { useState, useEffect } from 'react';
import { tr } from '../i18n/dutchTranslator';
import { useApp } from '../context/AppContext';
import { generateSecureRandomHex } from '../utils/crypto';
import {
  X,
  Database,
  QrCode,
  CheckCircle,
  RotateCcw,
  AlertCircle,
  RefreshCw,
  Server,
  UploadCloud,
  Check,
  Radio,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
  Building2,
  Calendar,
  Layers,
  Sparkles,
  Zap,
  ArrowUpRight,
  Copy,
  Clock,
  Terminal,
  HelpCircle,
  CreditCard,
  ChevronDown,
  ChevronUp,
  Mail,
  FileText,
  BadgeCheck,
  Printer,
} from 'lucide-react';
import {
  ConnectionTestResult,
  normalizeSupabaseUrl,
  normalizeSupabaseKey,
  getClientSupabase,
  validateSupabaseServerUrl,
  validateSupabaseAnonKey,
  SupabaseUrlValidationResult,
} from '../services/clientSupabase';
import { PLAN_LABELS, PLAN_TIERS, LicensePlan, LicenseInfo, getMaxDepotsForPlan, normalizeToCanonicalPlan, plan_limits } from '../types';
import {
  normalizePlanType,
  getPlanMaxReferences,
  syncLicenseToClientDatabase,
  discoverLicenseByProjectUrl,
  readClientDatabaseLicenseStatus,
  ClientDatabaseLicenseStatus,
} from '../services/licenseService';
import { masterSupabase } from '../services/masterSupabase';
import { generateModelBSqlMigration, syncLicenseTokenToClientDb } from '../services/licenseTokenService';
import {
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
  SQL_SCRIPT_15_SEARCH_ORDERS_MOVEMENTS,
  SQL_SCRIPT_16_AUDIT_TRAIL,
  SQL_MASTER_LICENSES_SCHEMA,
} from '../constants/supabaseScripts';
import { EdgeFunctionsSetupPanel } from './EdgeFunctionsSetupPanel';

export const CompanySetupModal: React.FC = () => {
  const {
    companySetupModalOpen,
    setCompanySetupModalOpen,
    supabaseConfig,
    saveSupabaseConfig,
    pendingScannedConfig,
    setPendingScannedConfig,
    resetToDemoData,
    setScanState,
    supabaseSyncStatus,
    supabaseSyncMessage,
    syncFromSupabase,
    exportToSupabase,
    testConnection,
    license,
    verifyLicense,
    provisionLicense,
    upgradePlan,
    updateContactEmail,
    removeLicense,
    syncLicenseWithServer,
    daysUntilNextCheck,
    products,
    depots,
    setDepotsModalOpen,
    userHasPermission,
    currentUser,
    language,
    t,
  } = useApp();

  // Lors de la configuration initiale de l'application (avant connexion), l'accès à la configuration
  // de la base de données doit rester possible pour permettre d'établir la connexion Supabase BYOD.
  const canLicense = !currentUser || userHasPermission('perm_config_license') || userHasPermission('perm_config_db');
  const canDb = !currentUser || userHasPermission('perm_config_db');

  const [activeTab, setActiveTab] = useState<'license' | 'db' | 'architecture' | 'edge_functions'>(() => {
    // Si aucun utilisateur n'est encore connecté, ouvrir directement sur l'onglet 'db' pour configurer Supabase
    if (!currentUser) return 'db';
    if (userHasPermission('perm_config_license') || userHasPermission('perm_config_db')) return 'license';
    return 'db';
  });

  const [copiedModelBSql, setCopiedModelBSql] = useState(false);
  const [isSyncingModelB, setIsSyncingModelB] = useState(false);
  const [modelBSyncResult, setModelBSyncResult] = useState<string | null>(null);

  // Organization & Supabase BYOD state
  const [orgName, setOrgName] = useState(license?.organization_name || '');
  const [isEditingOrg, setIsEditingOrg] = useState(false);
  const [isSavingOrg, setIsSavingOrg] = useState(false);
  const [url, setUrl] = useState(supabaseConfig?.url || '');
  const [key, setKey] = useState(supabaseConfig?.key || '');
  const [showKey, setShowKey] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [pendingServerConfirm, setPendingServerConfirm] = useState<{
    validation: SupabaseUrlValidationResult;
    cleanKey: string;
    pendingLicenseKey?: string;
    mode: 'save' | 'test';
  } | null>(null);
  const [customDomainConfirmed, setCustomDomainConfirmed] = useState(false);

  // License state & 15-day check state
  const [licenseInput, setLicenseInput] = useState('');
  const [isCheckingLicense, setIsCheckingLicense] = useState(false);
  const [isSyncingServer, setIsSyncingServer] = useState(false);
  const [showRlsHelp, setShowRlsHelp] = useState(false);
  const [copiedSql, setCopiedSql] = useState<string | null>(null);
  const [licenseMsg, setLicenseMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  // Contact email inline edit state
  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [emailInput, setEmailInput] = useState(license?.contact_email || '');
  const [isSavingEmail, setIsSavingEmail] = useState(false);

  const handleSaveEmail = async () => {
    const clean = emailInput.trim();
    if (!clean) {
      setLicenseMsg({
        type: 'error',
        text: tr(language, 'Veuillez saisir une adresse email valide.', 'Please enter a valid email address.'),
      });
      return;
    }
    setIsSavingEmail(true);
    try {
      const res = await updateContactEmail(clean);
      setLicenseMsg({ type: res.success ? 'success' : 'error', text: res.message });
      if (res.success) {
        setIsEditingEmail(false);
      }
    } catch (err: any) {
      setLicenseMsg({
        type: 'error',
        text: err?.message || (tr(language, "Erreur lors de la mise à jour de l'email.", "Error updating email.")),
      });
    } finally {
      setIsSavingEmail(false);
    }
  };

  // Subscription Workflow State
  const [subscriptionModalOpen, setSubscriptionModalOpen] = useState(false);
  const [selectedSubPlan, setSelectedSubPlan] = useState<'sta' | 'pro' | 'ent'>('pro');
  const [subBillingCycle, setSubBillingCycle] = useState<'monthly' | 'annual'>('annual');
  const [subCompany, setSubCompany] = useState(license?.organization_name || '');
  const [subEmail, setSubEmail] = useState(license?.contact_email || 'Gontrine.loesa@gmail.com');
  const [subContactName, setSubContactName] = useState('');
  const [isSubmittingSub, setIsSubmittingSub] = useState(false);
  const [subSuccessInfo, setSubSuccessInfo] = useState<{
    plan: string;
    key: string;
    expires: string;
    amount: string;
    invoiceId: string;
  } | null>(null);
  const [showQuoteView, setShowQuoteView] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [copiedSubKey, setCopiedSubKey] = useState(false);
  const [dbLicenseStatus, setDbLicenseStatus] = useState<ClientDatabaseLicenseStatus | null>(null);

  const refreshDbLicenseStatus = React.useCallback(
    async (overridePlan?: string) => {
      try {
        const cleanUrl = normalizeSupabaseUrl(
          url || supabaseConfig?.url || localStorage.getItem('tqt_company_url') || ''
        );
        const cleanKey = normalizeSupabaseKey(
          key || supabaseConfig?.key || localStorage.getItem('tqt_company_key') || ''
        );
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
    [url, key, supabaseConfig?.url, supabaseConfig?.key, license?.plan_type, license?.plan]
  );

  useEffect(() => {
    if (companySetupModalOpen) {
      refreshDbLicenseStatus();
    }
  }, [companySetupModalOpen, activeTab, license?.plan_type, license?.license_key, refreshDbLicenseStatus]);

  const handleOpenSubscription = (plan: 'sta' | 'pro' | 'ent' = 'pro') => {
    setSelectedSubPlan(plan);
    setSubCompany(license?.organization_name || orgName || 'Entreprise Locale');
    setSubEmail(license?.contact_email || currentUser?.email || 'Gontrine.loesa@gmail.com');
    setSubBillingCycle(license?.billing_cycle || 'annual');
    setSubContactName(currentUser?.name || '');
    setSubSuccessInfo(null);
    setShowQuoteView(false);
    setSubscriptionError(null);
    setSubscriptionModalOpen(true);
  };

  const handleSubscribeSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSubmittingSub(true);
    setSubscriptionError(null);

    try {
      const cleanOrg = subCompany.trim() || orgName.trim() || license?.organization_name || (tr(language, 'Entreprise Client', 'Client Company'));
      const cleanEmail = subEmail.trim() || license?.contact_email || undefined;
      const durationDays = subBillingCycle === 'annual' ? 365 : 30;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();

      let activeKey: string | undefined;

      // 1. Demande d'activation certifiée auprès du serveur éditeur
      try {
        const serverResult = await provisionLicense(
          cleanOrg,
          selectedSubPlan,
          supabaseConfig?.url,
          cleanEmail,
          subBillingCycle
        );

        if (
          serverResult.success &&
          serverResult.license &&
          normalizePlanType(serverResult.license.plan_type) === normalizePlanType(selectedSubPlan) &&
          serverResult.license.license_key
        ) {
          activeKey = serverResult.license.license_key;
        }
      } catch (serverErr) {
        console.warn('Erreur appel provisionLicense serveur:', serverErr);
      }

      // 2. Si le serveur éditeur a validé la souscription
      if (activeKey) {
        await verifyLicense(activeKey);

        const priceStr =
          selectedSubPlan === 'sta'
            ? (subBillingCycle === 'annual' ? (tr(language, '390 € HT / an (2 mois offerts)', '€390 excl. VAT / yr (2 months free)')) : (tr(language, '39 € HT / mois', '€39 excl. VAT / mo')))
            : selectedSubPlan === 'pro'
            ? (subBillingCycle === 'annual' ? (tr(language, '890 € HT / an (2 mois offerts)', '€890 excl. VAT / yr (2 months free)')) : (tr(language, '89 € HT / mois', '€89 excl. VAT / mo')))
            : (subBillingCycle === 'annual' ? (tr(language, '1 990 € HT / an (2 mois offerts)', '€1,990 excl. VAT / yr (2 months free)')) : (tr(language, '199 € HT / mois', '€199 excl. VAT / mo')));

        setSubSuccessInfo({
          plan: selectedSubPlan,
          key: activeKey,
          expires: new Date(expiresAt).toLocaleDateString(tr(language, 'fr-FR', 'en-US', 'nl-NL'), { day: '2-digit', month: 'long', year: 'numeric' }),
          amount: priceStr,
          invoiceId: `FAC-TOT-${new Date().getFullYear()}-${generateSecureRandomHex(2)}`,
        });
        setLicenseMsg({
          type: 'success',
          text: tr(language, `Félicitations ! Votre forfait a été validé vers ${selectedSubPlan.toUpperCase()} (${priceStr}) pour "${cleanOrg}".`, `Congratulations! Your plan has been validated to ${selectedSubPlan.toUpperCase()} (${priceStr}) for "${cleanOrg}".`),
        });
      } else {
        // Règle d'Autorité Unique : le client ne génère JAMAIS de fausse licence locale.
        // Affichage du bon de commande / devis proforma pour validation commerciale par l'éditeur.
        setShowQuoteView(true);
        setLicenseMsg({
          type: 'info',
          text: tr(language, `Bon de commande / Devis proforma généré. Seul le serveur éditeur est habilité à émettre votre clé officielle et à débloquer vos quotas.`, `Purchase order / Proforma quote generated. The publisher server is the sole authority to issue the official license key.`),
        });
      }
    } catch (err: any) {
      setSubscriptionError(err?.message || (tr(language, 'Erreur lors de la validation de la souscription.', 'Subscription validation error.')));
    } finally {
      setIsSubmittingSub(false);
    }
  };

  // Keyboard shortcut: close on Escape & auto-sync license when modal opens
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && companySetupModalOpen) {
        setCompanySetupModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [companySetupModalOpen, setCompanySetupModalOpen]);

  useEffect(() => {
    if (companySetupModalOpen) {
      syncLicenseWithServer(true).catch(() => {});
    }
  }, [companySetupModalOpen]);

  useEffect(() => {
    if (!isEditingOrg && license?.organization_name) setOrgName(license.organization_name);
    if (!isEditingEmail && license?.contact_email) setEmailInput(license.contact_email);
  }, [license?.organization_name, license?.contact_email, isEditingOrg, isEditingEmail]);

  // Pre-fill form when returning from QR Code scan (never save automatically!)
  useEffect(() => {
    if (companySetupModalOpen && pendingScannedConfig) {
      setActiveTab('db');
      const rawScannedUrl = pendingScannedConfig.url || '';
      const cleanScannedKey = normalizeSupabaseKey(pendingScannedConfig.key || '');
      const scannedLicenseKey = pendingScannedConfig.license_key?.trim() || undefined;

      setUrl(rawScannedUrl);
      setKey(cleanScannedKey);
      if (scannedLicenseKey) {
        setLicenseInput(scannedLicenseKey);
      }
      setPendingScannedConfig(null);

      const validation = validateSupabaseServerUrl(rawScannedUrl);
      if (!validation.valid) {
        setStatusMsg({
          type: 'error',
          text: validation.errorMessage || tr(language, 'URL du serveur invalide.', 'Invalid server URL.'),
        });
        return;
      }

      setUrl(validation.normalizedUrl);
      setCustomDomainConfirmed(false);
      setPendingServerConfirm({
        validation,
        cleanKey: cleanScannedKey,
        pendingLicenseKey: scannedLicenseKey,
        mode: 'save',
      });
    }
  }, [companySetupModalOpen, pendingScannedConfig, setPendingScannedConfig, language]);

  if (!companySetupModalOpen) return null;

  // Save / Update organization on server
  const handleSaveOrg = async () => {
    const cleanOrg = orgName.trim() || (tr(language, 'Organisation Locale', 'Local Organization'));
    setIsSavingOrg(true);
    try {
      const res = await provisionLicense(cleanOrg, license?.plan_type || 'free', url.trim() || undefined, license?.contact_email);
      if (res.license) {
        setOrgName(res.license.organization_name || '');
        setLicenseMsg({
          type: 'success',
          text: tr(language, `Organisation "${res.license.organization_name || cleanOrg}" enregistrée et synchronisée avec le serveur !`, `Organization "${res.license.organization_name || cleanOrg}" saved and synced with server!`),
        });
        setIsEditingOrg(false);
      } else {
        setLicenseMsg({ type: 'info', text: res.message || (tr(language, 'Organisation mise à jour.', 'Organization updated.')) });
        setIsEditingOrg(false);
      }
    } catch (err: any) {
      setLicenseMsg({
        type: 'error',
        text: tr(language, `Erreur lors de la mise à jour : ${err?.message || 'Serveur indisponible'}`, `Update error: ${err?.message || 'Server unreachable'}`),
      });
    } finally {
      setIsSavingOrg(false);
    }
  };

  // Validation préalable et ouverture de la fenêtre de confirmation du serveur
  const requestServerConfirmation = (mode: 'save' | 'test', e?: React.FormEvent | React.MouseEvent) => {
    if (e) e.preventDefault();
    if (!url.trim() || !key.trim()) {
      setStatusMsg({
        type: 'error',
        text: tr(
          language,
          "Veuillez renseigner l'URL et la clé Supabase.",
          'Please enter both the Supabase URL and key.'
        ),
      });
      return;
    }

    const keyValidation = validateSupabaseAnonKey(key);
    if (!keyValidation.valid) {
      setStatusMsg({
        type: 'error',
        text:
          keyValidation.errorMessage ||
          tr(language, 'Clé Supabase invalide.', 'Invalid Supabase key.'),
      });
      return;
    }
    const cleanKey = keyValidation.normalizedKey;

    const validation = validateSupabaseServerUrl(url);
    if (!validation.valid) {
      setStatusMsg({
        type: 'error',
        text: validation.errorMessage || tr(language, 'URL du serveur invalide.', 'Invalid server URL.'),
      });
      return;
    }

    setUrl(validation.normalizedUrl);
    setKey(cleanKey);
    setCustomDomainConfirmed(false);
    setPendingServerConfirm({
      validation,
      cleanKey,
      pendingLicenseKey: licenseInput.trim() || undefined,
      mode,
    });
  };

  const handleSave = (e?: React.FormEvent | React.MouseEvent) => {
    requestServerConfirmation('save', e);
  };

  const handleTest = () => {
    requestServerConfirmation('test');
  };

  // Exécution effective après confirmation explicite du domaine par l'utilisateur
  const executeConfirmedServerAction = async () => {
    if (!pendingServerConfirm) return;
    const { validation, cleanKey, pendingLicenseKey, mode } = pendingServerConfirm;
    if (validation.requiresCustomDomainConfirmation && !customDomainConfirmed) {
      return;
    }

    const cleanUrl = validation.normalizedUrl;
    setPendingServerConfirm(null);
    setCustomDomainConfirmed(false);
    setUrl(cleanUrl);
    setKey(cleanKey);

    if (mode === 'test') {
      setIsTesting(true);
      setTestResult(null);
      setStatusMsg(null);
      try {
        const res = await testConnection(cleanUrl, cleanKey);
        setTestResult(res);
        if (res.success) {
          saveSupabaseConfig(cleanUrl, cleanKey);
          await Promise.all([
            syncFromSupabase(cleanUrl, cleanKey),
            syncLicenseWithServer(true, cleanUrl, cleanKey).then((licRes) => {
              if (licRes?.license?.organization_name) {
                setOrgName(licRes.license.organization_name);
              }
            }),
          ]).catch(() => {});

          setStatusMsg({
            type: 'success',
            text: tr(
              language,
              `Connexion réussie et base liée : ${res.message}`,
              `Connection successful and database linked: ${res.message}`
            ),
          });
        } else {
          setStatusMsg({
            type: 'error',
            text: tr(language, `Échec du test : ${res.message}`, `Test failed: ${res.message}`),
          });
        }
      } catch (err: any) {
        setStatusMsg({
          type: 'error',
          text: tr(
            language,
            `Erreur inattendue : ${err.message || 'Échec du test'}`,
            `Unexpected error: ${err.message || 'Test failed'}`
          ),
        });
      } finally {
        setIsTesting(false);
      }
      return;
    }

    // Mode 'save'
    saveSupabaseConfig(cleanUrl, cleanKey);
    setIsSyncing(true);
    setStatusMsg({
      type: 'info',
      text: tr(
        language,
        "Enregistrement de la base et synchronisation de la licence de l'entreprise...",
        'Saving database and syncing company license...'
      ),
    });

    const ok = await syncFromSupabase(cleanUrl, cleanKey);

    const cleanOrg =
      orgName.trim() ||
      license?.organization_name ||
      tr(language, 'Organisation Locale', 'Local Organization');
    try {
      if (pendingLicenseKey) {
        await verifyLicense(pendingLicenseKey, cleanUrl, cleanKey);
      } else {
        const syncLicRes = await syncLicenseWithServer(true, cleanUrl, cleanKey);
        if (syncLicRes?.license && syncLicRes.license.license_key !== 'TOT-STOCK-FREE-COMMUNITY') {
          setOrgName(syncLicRes.license.organization_name || cleanOrg);
        } else if (orgName.trim()) {
          const licRes = await provisionLicense(cleanOrg, cleanUrl);
          if (licRes.license) {
            setOrgName(licRes.license.organization_name || cleanOrg);
          }
        }
      }
    } catch (err) {
      console.warn('Erreur lors de la synchronisation de licence serveur:', err);
    }

    setIsSyncing(false);
    if (ok) {
      setStatusMsg({
        type: 'success',
        text: tr(
          language,
          '✅ Base Supabase enregistrée et liée avec succès ! Vos utilisateurs et la licence de la société sont actifs.',
          '✅ Supabase database saved and linked successfully!'
        ),
      });
    } else {
      setStatusMsg({
        type: 'error',
        text: tr(
          language,
          "⚠️ Identifiants enregistrés mais la synchronisation a échoué. Si votre projet est gratuit, vérifiez qu'il n'est pas en veille (Paused sur supabase.com).",
          '⚠️ Credentials saved but synchronization failed. If your project is on the free tier, ensure it is not paused on supabase.com.'
        ),
      });
    }
  };

  const handleForceSync = async () => {
    setIsSyncing(true);
    setStatusMsg({
      type: 'info',
      text: tr(language, 'Chargement des données depuis Supabase...', 'Loading data from Supabase...'),
    });
    const ok = await syncFromSupabase();
    setIsSyncing(false);
    if (ok) {
      setStatusMsg({
        type: 'success',
        text: tr(language, 'Données synchronisées depuis votre Supabase !', 'Data successfully synced from your Supabase!'),
      });
    } else {
      setStatusMsg({
        type: 'error',
        text: tr(language, 'Impossible de synchroniser depuis Supabase.', 'Unable to synchronize from Supabase.'),
      });
    }
  };

  const handleExportToSupabase = async () => {
    if (
      !window.confirm(
        tr(language, 'Voulez-vous envoyer les données actuelles (produits, utilisateurs) vers vos tables Supabase ?', 'Do you want to export current data (products, users) to your Supabase tables?')
      )
    ) {
      return;
    }
    setIsExporting(true);
    setStatusMsg({
      type: 'info',
      text: tr(language, 'Envoi des données vers Supabase en cours...', 'Exporting data to Supabase...'),
    });
    const res = await exportToSupabase();
    setIsExporting(false);
    if (res.success) {
      setStatusMsg({ type: 'success', text: res.message });
    } else {
      setStatusMsg({ type: 'error', text: res.message });
    }
  };

  const handleReset = () => {
    if (
      window.confirm(
        tr(language, 'Réinitialiser vers le stockage local de démonstration ? Vos identifiants Supabase seront effacés de ce navigateur.', 'Reset to demo local storage? Your Supabase credentials will be removed from this browser.')
      )
    ) {
      resetToDemoData();
      setUrl('');
      setKey('');
      setTestResult(null);
      setStatusMsg({
        type: 'info',
        text: tr(language, 'Mode stockage local actif.', 'Local storage mode active.'),
      });
    }
  };

  const handleScanQR = () => {
    setCompanySetupModalOpen(false);
    setScanState({ open: true, mode: 'CONFIG_SCAN' });
  };

  // License Activate Handler
  const handleVerifyLicense = async (keyToTest?: string) => {
    const rawKey = keyToTest || licenseInput;
    if (!rawKey.trim()) {
      setLicenseMsg({
        type: 'error',
        text: tr(language, 'Veuillez saisir une clé de licence valide.', 'Please enter a valid license key.'),
      });
      return;
    }

    setIsCheckingLicense(true);
    setLicenseMsg(null);
    try {
      const res = await verifyLicense(rawKey.trim());
      await refreshDbLicenseStatus(res.license?.plan_type);
      if (res.success) {
        setLicenseMsg({ type: 'success', text: res.message });
        setLicenseInput('');
      } else {
        setLicenseMsg({ type: 'error', text: res.message });
      }
    } catch (err: any) {
      setLicenseMsg({
        type: 'error',
        text: tr(language, `Erreur inattendue : ${err.message || 'Échec de vérification'}`, `Unexpected error: ${err.message || 'Verification failed'}`),
      });
    } finally {
      setIsCheckingLicense(false);
    }
  };

  const handleRemoveLicense = () => {
    if (
      window.confirm(
        tr(language, 'Voulez-vous dissocier cette licence et repasser sur le forfait Gratuit ?', 'Do you want to unlink this license and revert to the Free tier?')
      )
    ) {
      removeLicense();
      setLicenseInput('');
      setLicenseMsg({
        type: 'info',
        text: tr(language, "Licence dissociée. L'application fonctionne en mode Gratuit.", 'License unlinked. The application operates in Free mode.'),
      });
    }
  };

  const handleDiscoverLicenseAutomatically = async () => {
    const cleanUrl = normalizeSupabaseUrl(url || supabaseConfig?.url || localStorage.getItem('tqt_company_url') || '');
    const cleanKey = normalizeSupabaseKey(key || supabaseConfig?.key || localStorage.getItem('tqt_company_key') || '');

    if (!cleanUrl || !cleanKey) {
      setLicenseMsg({
        type: 'error',
        text: t('license_discover_error'),
      });
      return;
    }

    setIsCheckingLicense(true);
    setLicenseMsg({
      type: 'info',
      text: t('license_discover_searching'),
    });

    try {
      const client = getClientSupabase(cleanUrl, cleanKey);
      if (!client || typeof client.auth?.getSession !== 'function') {
        setLicenseMsg({
          type: 'error',
          text: t('license_discover_error'),
        });
        return;
      }

      const { data: sessionData } = await client.auth.getSession();
      const accessToken = sessionData?.session?.access_token || cleanKey;

      const res = await discoverLicenseByProjectUrl(cleanUrl, cleanKey, accessToken, {
        force: true,
      });

      if (res.status === 'found' && res.license) {
        const syncRes = await syncLicenseToClientDatabase(res.license, client);
        await syncLicenseWithServer(true, cleanUrl, cleanKey).catch(() => {});
        await refreshDbLicenseStatus(res.license.plan_type);
        if (res.license.organization_name) {
          setOrgName(res.license.organization_name);
        }
        if (!syncRes.success) {
          setLicenseMsg({
            type: 'error',
            text: syncRes.message,
          });
        } else {
          setLicenseMsg({
            type: 'success',
            text: `${t('license_discover_found')} (${res.license.plan_type.toUpperCase()} — ${res.license.license_key})`,
          });
        }
      } else if (res.status === 'function_not_found') {
        setLicenseMsg({
          type: 'error',
          text:
            res.message ||
            tr(
              language,
              "Fonction introuvable : vérifiez le nom exact de la fonction Edge maître (APP_TOT-Stock_licenses) ou l'URL de la base maître.",
              'Function not found: check the exact name of the master Edge Function (APP_TOT-Stock_licenses) or the master database URL.',
              'Functie niet gevonden: controleer de exacte naam van de master Edge Function (APP_TOT-Stock_licenses) of de URL van de masterdatabase.'
            ),
        });
      } else if (res.status === 'denied') {
        setLicenseMsg({
          type: 'error',
          text:
            res.message ||
            tr(
              language,
              "Refusé par le serveur : preuve d'appartenance au projet refusée ou permissions insuffisantes.",
              'Rejected by server: project ownership proof denied or insufficient permissions.',
              'Geweigerd door de server: eigendomsbewijs van het project geweigerd of onvoldoende rechten.'
            ),
        });
      } else if (res.status === 'not_found') {
        setLicenseMsg({
          type: 'info',
          text:
            res.message ||
            tr(
              language,
              "Licence non liée : aucune licence active n'est rattachée à cette URL de projet sur le serveur éditeur.",
              'Unlinked license: no active license is linked to this project URL on the publisher server.',
              'Niet-gekoppelde licentie: er is geen actieve licentie gekoppeld aan deze project-URL op de uitgeversserver.'
            ),
        });
      } else if (res.status === 'inactive' || res.status === 'expired') {
        setLicenseMsg({
          type: 'error',
          text: t('license_discover_inactive_or_expired'),
        });
      } else {
        setLicenseMsg({
          type: 'error',
          text: `${t('license_discover_error')}${res.message ? ` (${res.message})` : ''}`,
        });
      }
    } catch (err: any) {
      setLicenseMsg({
        type: 'error',
        text: `${t('license_discover_error')} (${err?.message || ''})`,
      });
    } finally {
      setIsCheckingLicense(false);
    }
  };

  // Base Maître Licences : RLS activé en permanence, zéro accès direct pour anon (SQL_MASTER_LICENSES_SCHEMA)

  const SQL_FULL_DATABASE_SCHEMA = `-- =========================================================================
-- SCHÉMA OFFICIEL COMPLET TOT STOCK (PostgreSQL / Supabase)
-- Exécutable dans l'Éditeur SQL Supabase ou via CLI (supabase db push)
-- =========================================================================

-- 1. Table des Magasins & Dépôts (Support Dépôts Fixes & Véhicules d'intervention)
CREATE TABLE IF NOT EXISTS public.depots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  company_id TEXT,
  name TEXT NOT NULL UNIQUE,
  code TEXT,
  address TEXT,
  description TEXT,
  type TEXT DEFAULT 'FIXED', -- 'FIXED' ou 'VEHICLE'
  vehicle_type TEXT DEFAULT NULL, -- 'FOURGON', 'CAMIONNETTE', 'UTILITAIRE', 'POIDS_LOURD', etc.
  license_plate TEXT DEFAULT NULL,
  manager_id TEXT DEFAULT NULL,
  manager_name TEXT DEFAULT NULL,
  department_id TEXT DEFAULT NULL,
  department_name TEXT DEFAULT NULL,
  pickup_zones JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_depots_name ON public.depots (name);
CREATE INDEX IF NOT EXISTS idx_depots_type ON public.depots (type);
CREATE INDEX IF NOT EXISTS idx_depots_manager ON public.depots (manager_id);
CREATE INDEX IF NOT EXISTS idx_depots_license_plate ON public.depots (license_plate);

-- 2. Table des Rôles & Permissions
CREATE TABLE IF NOT EXISTS public.roles (
  id INT PRIMARY KEY,
  name TEXT NOT NULL,
  permissions TEXT[] DEFAULT '{}'
);

-- 3. Table des Départements
CREATE TABLE IF NOT EXISTS public.departments (
  id INT PRIMARY KEY,
  name TEXT NOT NULL,
  manager_id TEXT,
  deputy_manager_ids TEXT[] DEFAULT '{}',
  allow_global_kpis BOOLEAN DEFAULT false,
  is_preparer_dept BOOLEAN DEFAULT false,
  require_order_approval BOOLEAN DEFAULT false,
  order_approval_threshold NUMERIC(10,2) DEFAULT 0
);

-- 4. Table des Chantiers / Projets
CREATE TABLE IF NOT EXISTS public.projects (
  id INT PRIMARY KEY,
  department_id INT,
  project_number TEXT NOT NULL,
  project_name TEXT NOT NULL,
  manager_id TEXT,
  deputy_manager_ids TEXT[] DEFAULT '{}'
);

-- 5. Table des Sous-Catégories
CREATE TABLE IF NOT EXISTS public.sub_categories (
  id INT PRIMARY KEY,
  name TEXT NOT NULL
);

-- 6. Table des Dépôts & Magasins (depots)
CREATE TABLE IF NOT EXISTS public.depots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  company_id TEXT,
  name TEXT NOT NULL UNIQUE,
  code TEXT,
  address TEXT,
  manager TEXT,
  phone TEXT,
  email TEXT,
  description TEXT,
  type TEXT DEFAULT 'FIXED', -- 'FIXED' ou 'VEHICLE'
  vehicle_type TEXT DEFAULT NULL, -- 'FOURGON', 'CAMIONNETTE', 'UTILITAIRE', 'POIDS_LOURD', etc.
  license_plate TEXT DEFAULT NULL,
  manager_id TEXT DEFAULT NULL,
  manager_name TEXT DEFAULT NULL,
  department_id TEXT DEFAULT NULL,
  department_name TEXT DEFAULT NULL,
  pickup_zones JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_depots_name ON public.depots (name);
CREATE INDEX IF NOT EXISTS idx_depots_type ON public.depots (type);
CREATE INDEX IF NOT EXISTS idx_depots_manager ON public.depots (manager_id);
CREATE INDEX IF NOT EXISTS idx_depots_license_plate ON public.depots (license_plate);

-- 7. Table des Utilisateurs & Profils
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trigram TEXT NOT NULL,
  email TEXT,
  department TEXT,
  pin TEXT,
  pin_hash TEXT,
  role_id INT DEFAULT 2,
  is_blocked BOOLEAN DEFAULT false,
  must_change_pin BOOLEAN DEFAULT false,
  is_preparer BOOLEAN DEFAULT false,
  allowed_depots TEXT[] DEFAULT '{*}',
  auth_user_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 8. Table des Produits & Références Catalogue
CREATE TABLE IF NOT EXISTS public.products (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  manufacturer_ref TEXT,
  barcode TEXT,
  qr_code TEXT,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  sub_category_id INT,
  unit_price NUMERIC(12, 2) DEFAULT 0,
  description TEXT,
  tags TEXT,
  supplier_1_name TEXT,
  ref_supplier_1 TEXT,
  supplier_2_name TEXT,
  ref_supplier_2 TEXT,
  store_name TEXT DEFAULT 'Dépôt Principal',
  room_name TEXT,
  shelf_name TEXT,
  quantity INT DEFAULT 0,
  min_stock_alert INT DEFAULT 2,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS qr_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_ref_uniq ON public.products (LOWER(BTRIM(reference)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_uniq ON public.products (LOWER(BTRIM(barcode))) WHERE barcode IS NOT NULL AND BTRIM(barcode) <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_oem_uniq ON public.products (LOWER(BTRIM(manufacturer_ref))) WHERE manufacturer_ref IS NOT NULL AND BTRIM(manufacturer_ref) <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_qr_uniq ON public.products (LOWER(BTRIM(qr_code))) WHERE qr_code IS NOT NULL AND BTRIM(qr_code) <> '';
CREATE INDEX IF NOT EXISTS idx_products_store ON public.products (store_name);

-- 9. Table des Mouvements de Stock (Sorties Chantiers & Entrées)
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  product_ref TEXT,
  user_id TEXT,
  user_name TEXT,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('IN', 'OUT')),
  quantity_changed INT NOT NULL,
  site_number TEXT,
  department_name TEXT,
  total_cost NUMERIC(12, 2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mov_prod_id ON public.stock_movements (product_id);
CREATE INDEX IF NOT EXISTS idx_mov_created_at ON public.stock_movements (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mov_site ON public.stock_movements (site_number);

-- 10. Table des Commandes de Matériel (Drive Chantier & Validation)
CREATE TABLE IF NOT EXISTS public.material_orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  site_number TEXT NOT NULL,
  site_name TEXT,
  depot_name TEXT,
  requester_id TEXT NOT NULL,
  requester_name TEXT NOT NULL,
  requester_department TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('WAITING_APPROVAL', 'PENDING', 'PREPARING', 'READY', 'COLLECTED', 'CANCELLED', 'REJECTED')),
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  total_cost NUMERIC(12, 2) DEFAULT 0,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  rejected_by TEXT,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  pickup_zone TEXT,
  ready_qr_code TEXT,
  signature_data TEXT,
  proof_photo_url TEXT,
  is_edited BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  assigned_at TIMESTAMPTZ,
  preparer_id TEXT,
  preparer_name TEXT,
  ready_at TIMESTAMPTZ,
  collected_at TIMESTAMPTZ,
  collected_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_material_orders_order_number_unique ON public.material_orders (UPPER(TRIM(order_number)));
CREATE INDEX IF NOT EXISTS idx_ord_status ON public.material_orders (status);
CREATE INDEX IF NOT EXISTS idx_ord_site ON public.material_orders (site_number);
CREATE INDEX IF NOT EXISTS idx_ord_cost ON public.material_orders (total_cost);

-- 11. Table du Journal d'Audit & Sécurité (audit_logs)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  type TEXT NOT NULL DEFAULT 'SYSTEM',
  category TEXT NOT NULL DEFAULT 'SYSTEM',
  user_id TEXT,
  user_name TEXT,
  user_trigram TEXT,
  product_id TEXT,
  product_ref TEXT,
  quantity_changed INT,
  site_number TEXT,
  depot_name TEXT,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  badge_text TEXT,
  badgeText TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  action TEXT,
  entity TEXT,
  entity_id TEXT,
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON public.audit_logs (user_name);
CREATE INDEX IF NOT EXISTS idx_audit_category ON public.audit_logs (category);

-- =========================================================================
-- ACTIVATION DES POLITIQUES RLS (Accès sécurisé authenticated / durcissement RLS)
-- =========================================================================
ALTER TABLE public.depots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read depots" ON public.depots FOR SELECT TO authenticated USING (true);

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read roles" ON public.roles FOR SELECT TO authenticated USING (true);

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read departments" ON public.departments FOR SELECT TO authenticated USING (true);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read projects" ON public.projects FOR SELECT TO authenticated USING (true);

ALTER TABLE public.sub_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read sub_categories" ON public.sub_categories FOR SELECT TO authenticated USING (true);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read users" ON public.users;
DROP POLICY IF EXISTS "Login directory read users" ON public.users;
CREATE POLICY "Login directory read users" ON public.users FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated write users" ON public.users;
CREATE POLICY "Authenticated write users" ON public.users FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read products" ON public.products FOR SELECT TO authenticated USING (true);

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read stock_movements" ON public.stock_movements FOR SELECT TO authenticated USING (true);

ALTER TABLE public.material_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read material_orders" ON public.material_orders;
CREATE POLICY "Authenticated read material_orders" ON public.material_orders FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated write material_orders" ON public.material_orders;
CREATE POLICY "Authenticated write material_orders" ON public.material_orders FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read audit_logs" ON public.audit_logs FOR SELECT TO authenticated USING (true);

-- 10. Table des Paramètres de l'Application (Devise, Licence, Annuaire, Options)
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anon public app_settings" ON public.app_settings;
CREATE POLICY "Anon public app_settings" ON public.app_settings FOR SELECT TO anon USING (key IN ('company_currency', 'company_name', 'company_logo', 'app_logo_url', 'company_license_info', 'license_key', 'organization_name', 'company_users_directory', 'company_orders_sync', 'company_user_baskets'));
DROP POLICY IF EXISTS "Authenticated read app_settings" ON public.app_settings;
CREATE POLICY "Authenticated read app_settings" ON public.app_settings FOR SELECT TO authenticated USING (key NOT IN ('smtp_pass', 'brevo_api_key'));
DROP POLICY IF EXISTS "Authenticated write app_settings" ON public.app_settings;
CREATE POLICY "Authenticated write app_settings" ON public.app_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);`;

  const CLI_MIGRATION_COMMANDS = `# =========================================================================
# 1. Installer la CLI Supabase (si nécessaire) et se connecter
# =========================================================================
npx supabase login

# 2. Lier votre projet Supabase distant avec l'identifiant unique (Project ID)
npx supabase link --project-ref <VOTRE_PROJECT_REF>

# 3. Créer une nouvelle migration pour mettre à jour les tables (v5.5)
npx supabase migration new update_tot_stock_approval_workflow

# 4. Pour une base déjà existante, ajouter les colonnes de validation et commandes :
# Exécuter les requêtes suivantes dans supabase/migrations/..._update_tot_stock_approval_workflow.sql :
# ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS require_order_approval BOOLEAN DEFAULT false;
# ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS order_approval_threshold NUMERIC(10,2) DEFAULT 0;
# ALTER TABLE public.material_orders ADD COLUMN IF NOT EXISTS total_cost NUMERIC(10,2) DEFAULT 0;
# ALTER TABLE public.material_orders ADD COLUMN IF NOT EXISTS approved_by TEXT;
# ALTER TABLE public.material_orders ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
# ALTER TABLE public.material_orders ADD COLUMN IF NOT EXISTS rejected_by TEXT;
# ALTER TABLE public.material_orders ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
# ALTER TABLE public.material_orders ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
# ALTER TABLE public.material_orders ADD COLUMN IF NOT EXISTS pickup_delegate_id TEXT;
# ALTER TABLE public.material_orders ADD COLUMN IF NOT EXISTS pickup_delegate_name TEXT;
# ALTER TABLE public.material_orders ADD COLUMN IF NOT EXISTS pickup_delegate_department TEXT;
# ALTER TABLE public.material_orders ADD COLUMN IF NOT EXISTS pickup_delegate_at TIMESTAMPTZ;
# ALTER TABLE public.material_orders ADD COLUMN IF NOT EXISTS pickup_delegate_by TEXT;
# ALTER TABLE public.material_orders ADD COLUMN IF NOT EXISTS pickup_delegate_notes TEXT;

# 5. Déployer la migration sur votre base Supabase distante
npx supabase db push`;

  const SQL_PHASE1_MIGRATION = `-- =========================================================================
-- TOT STOCK PRO - MIGRATION PHASE 1 : SÉCURITÉ, DÉPÔTS & DÉLÉGATION DE RETRAIT
-- Recommandations d'audit & durcissement de l'architecture Supabase
-- Compatible bases neuves & bases existantes (Idempotent: IF NOT EXISTS)
-- =========================================================================

-- 1. TABLE DES DÉPÔTS (depots) & FONCTION RPC DE SÉCURITÉ
CREATE TABLE IF NOT EXISTS public.depots (
  id TEXT PRIMARY KEY,
  company_id TEXT,
  name TEXT NOT NULL UNIQUE,
  code TEXT,
  address TEXT,
  manager TEXT,
  phone TEXT,
  email TEXT,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.depots 
  ADD COLUMN IF NOT EXISTS company_id TEXT,
  ADD COLUMN IF NOT EXISTS code TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS manager TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_depots_name ON public.depots(name);
CREATE INDEX IF NOT EXISTS idx_depots_company ON public.depots(company_id);

ALTER TABLE public.depots ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.check_user_depot_permission(
  p_depot_id TEXT,
  p_required_role INT DEFAULT 1
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_role INT;
  v_allowed_depots TEXT[];
BEGIN
  SELECT role_id, allowed_depots 
  INTO v_user_role, v_allowed_depots
  FROM public.users
  WHERE auth_user_id = auth.uid() OR id::text = auth.uid()::text;

  IF v_user_role = 0 THEN
    RETURN TRUE;
  END IF;

  IF v_user_role IS NOT NULL AND v_user_role > p_required_role THEN
    RETURN FALSE;
  END IF;

  IF v_allowed_depots IS NULL OR array_length(v_allowed_depots, 1) = 0 OR p_depot_id = ANY(v_allowed_depots) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

DROP POLICY IF EXISTS "Secure read depots" ON public.depots;
CREATE POLICY "Secure read depots" ON public.depots
  FOR SELECT TO authenticated, anon
  USING (is_active = true OR public.check_user_depot_permission(id, 1));

DROP POLICY IF EXISTS "Secure write depots" ON public.depots;
CREATE POLICY "Secure write depots" ON public.depots
  FOR ALL TO authenticated
  USING (public.check_user_depot_permission(id, 1))
  WITH CHECK (public.check_user_depot_permission(id, 1));

INSERT INTO public.depots (id, name, code, address, description)
VALUES ('dep-01', 'Dépôt Principal', 'DEP-01', 'Siège / Entrepôt Central', 'Stock central outillage et consommables')
ON CONFLICT (name) DO NOTHING;

-- 2. DÉLÉGATION DE RETRAIT & TRACABILITÉ COMMANDES (material_orders)
ALTER TABLE public.material_orders 
  ADD COLUMN IF NOT EXISTS total_cost NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by TEXT,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS pickup_zone TEXT,
  ADD COLUMN IF NOT EXISTS ready_qr_code TEXT,
  ADD COLUMN IF NOT EXISTS signature_data TEXT,
  ADD COLUMN IF NOT EXISTS proof_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS pickup_delegate_id TEXT,
  ADD COLUMN IF NOT EXISTS pickup_delegate_name TEXT,
  ADD COLUMN IF NOT EXISTS pickup_delegate_department TEXT,
  ADD COLUMN IF NOT EXISTS pickup_delegate_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pickup_delegate_by TEXT,
  ADD COLUMN IF NOT EXISTS pickup_delegate_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_material_orders_delegate ON public.material_orders (pickup_delegate_id);
CREATE INDEX IF NOT EXISTS idx_material_orders_depot ON public.material_orders (depot_name);
CREATE INDEX IF NOT EXISTS idx_material_orders_delegate_dept ON public.material_orders (pickup_delegate_department);

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'orders') THEN
    ALTER TABLE public.orders 
      ADD COLUMN IF NOT EXISTS pickup_delegate_id TEXT,
      ADD COLUMN IF NOT EXISTS pickup_delegate_name TEXT,
      ADD COLUMN IF NOT EXISTS pickup_delegate_department TEXT,
      ADD COLUMN IF NOT EXISTS pickup_delegate_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS pickup_delegate_by TEXT,
      ADD COLUMN IF NOT EXISTS pickup_delegate_notes TEXT;
  END IF;
END $$;

-- 3. JOURNAL D'AUDIT SÉCURISÉ (audit_logs)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  type TEXT NOT NULL DEFAULT 'SYSTEM',
  category TEXT NOT NULL DEFAULT 'SYSTEM',
  user_id TEXT,
  user_name TEXT,
  user_trigram TEXT,
  product_id TEXT,
  product_ref TEXT,
  quantity_changed INT,
  site_number TEXT,
  depot_name TEXT,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  badge_text TEXT,
  badgeText TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  action TEXT,
  entity TEXT,
  entity_id TEXT,
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'SYSTEM',
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'SYSTEM',
  ADD COLUMN IF NOT EXISTS user_id TEXT,
  ADD COLUMN IF NOT EXISTS user_name TEXT,
  ADD COLUMN IF NOT EXISTS user_trigram TEXT,
  ADD COLUMN IF NOT EXISTS product_id TEXT,
  ADD COLUMN IF NOT EXISTS product_ref TEXT,
  ADD COLUMN IF NOT EXISTS quantity_changed INT,
  ADD COLUMN IF NOT EXISTS site_number TEXT,
  ADD COLUMN IF NOT EXISTS depot_name TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS badge_text TEXT,
  ADD COLUMN IF NOT EXISTS badgeText TEXT,
  ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS action TEXT,
  ADD COLUMN IF NOT EXISTS entity TEXT,
  ADD COLUMN IF NOT EXISTS entity_id TEXT,
  ADD COLUMN IF NOT EXISTS details JSONB,
  ADD COLUMN IF NOT EXISTS ip_address TEXT;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read audit_logs" ON public.audit_logs;
CREATE POLICY "Allow read audit_logs" ON public.audit_logs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Allow insert audit_logs" ON public.audit_logs;
CREATE POLICY "Allow insert audit_logs" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (true);`;

  const SQL_PHASE2_MIGRATION = `-- =========================================================================
-- TOT STOCK PRO v5.5 - MIGRATION PHASE 2 : TRAÇABILITÉ PRÉPARATIONS, ZONES & AUDITS
-- =========================================================================

-- 1. ZONES DE RETRAIT DÉPÔT
ALTER TABLE public.depots 
  ADD COLUMN IF NOT EXISTS pickup_zones TEXT[] DEFAULT '{"Casier A1", "Casier A2", "Zone Drive Magasin", "Étagère Retrait 1"}';

-- 2. SESSIONS D'INVENTAIRE PHYSIQUE (inventory_audits)
CREATE TABLE IF NOT EXISTS public.inventory_audits (
  id TEXT PRIMARY KEY,
  depot_name TEXT,
  auditor_id TEXT,
  auditor_name TEXT,
  status TEXT NOT NULL DEFAULT 'COMPLETED',
  items_counted INT NOT NULL DEFAULT 0,
  items_with_diff INT NOT NULL DEFAULT 0,
  total_diff_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  audit_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_audits_depot ON public.inventory_audits (depot_name);
CREATE INDEX IF NOT EXISTS idx_inventory_audits_created ON public.inventory_audits (created_at DESC);

ALTER TABLE public.inventory_audits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read inventory_audits" ON public.inventory_audits;
DROP POLICY IF EXISTS "Allow write inventory_audits" ON public.inventory_audits;
CREATE POLICY "Authenticated read inventory_audits" ON public.inventory_audits FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated write inventory_audits" ON public.inventory_audits FOR ALL TO authenticated
  USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_menu_inventory_audit'))
  WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_menu_inventory_audit'));

-- 3. DÉTAIL PAR ARTICLE DE L'INVENTAIRE (inventory_audit_items)
CREATE TABLE IF NOT EXISTS public.inventory_audit_items (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL REFERENCES public.inventory_audits(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  product_ref TEXT NOT NULL,
  product_name TEXT,
  theoretical_qty NUMERIC(10,2) NOT NULL,
  physical_count NUMERIC(10,2) NOT NULL,
  difference NUMERIC(10,2) NOT NULL,
  unit_price NUMERIC(10,2) DEFAULT 0,
  diff_cost NUMERIC(10,2) DEFAULT 0,
  scanned_barcode TEXT,
  scanned_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_items_audit_id ON public.inventory_audit_items (audit_id);
CREATE INDEX IF NOT EXISTS idx_audit_items_product_id ON public.inventory_audit_items (product_id);

ALTER TABLE public.inventory_audit_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read inventory_audit_items" ON public.inventory_audit_items;
DROP POLICY IF EXISTS "Allow write inventory_audit_items" ON public.inventory_audit_items;
CREATE POLICY "Authenticated read inventory_audit_items" ON public.inventory_audit_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated write inventory_audit_items" ON public.inventory_audit_items FOR ALL TO authenticated
  USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_menu_inventory_audit'))
  WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_menu_inventory_audit'));

-- 4. JOURNAL DES SCANS DE PRÉPARATION (order_preparations_log)
CREATE TABLE IF NOT EXISTS public.order_preparations_log (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  order_number TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_ref TEXT NOT NULL,
  preparer_id TEXT,
  preparer_name TEXT,
  picked_quantity NUMERIC(10,2) NOT NULL,
  scanned_barcode TEXT,
  pickup_zone TEXT,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_prep_order ON public.order_preparations_log (order_id);
CREATE INDEX IF NOT EXISTS idx_order_prep_scanned_at ON public.order_preparations_log (scanned_at DESC);

ALTER TABLE public.order_preparations_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read order_preparations_log" ON public.order_preparations_log;
DROP POLICY IF EXISTS "Allow write order_preparations_log" ON public.order_preparations_log;
CREATE POLICY "Authenticated read order_preparations_log" ON public.order_preparations_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated write order_preparations_log" ON public.order_preparations_log FOR INSERT TO authenticated
  WITH CHECK (preparer_id = public.current_user_id() OR public.current_user_role() = 0);`;

  const SQL_PHASE3_MIGRATION = `-- =========================================================================
-- TOT STOCK PRO v5.5 - MIGRATION PHASE 3 : RAPPORTS, ALERTES & ÉTIQUETTES
-- =========================================================================

-- 1. RAPPORTS PROGRAMMÉS PAR EMAIL (scheduled_reports)
CREATE TABLE IF NOT EXISTS public.scheduled_reports (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  report_type TEXT NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'WEEKLY',
  recipients TEXT[] NOT NULL DEFAULT '{}',
  depot_name TEXT,
  is_active BOOLEAN DEFAULT true,
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_reports_type ON public.scheduled_reports (report_type);
CREATE INDEX IF NOT EXISTS idx_scheduled_reports_active ON public.scheduled_reports (is_active);

ALTER TABLE public.scheduled_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read scheduled_reports" ON public.scheduled_reports;
DROP POLICY IF EXISTS "Allow write scheduled_reports" ON public.scheduled_reports;
CREATE POLICY "Authenticated read scheduled_reports" ON public.scheduled_reports FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write scheduled_reports" ON public.scheduled_reports FOR ALL TO authenticated
  USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_config_email'))
  WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_config_email'));

-- 2. JOURNAL DES ALERTES DE STOCK CRITIQUE (stock_alerts_log)
CREATE TABLE IF NOT EXISTS public.stock_alerts_log (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  product_ref TEXT NOT NULL,
  product_name TEXT,
  depot_name TEXT,
  current_quantity NUMERIC(10,2) NOT NULL,
  min_threshold NUMERIC(10,2) NOT NULL,
  severity TEXT NOT NULL DEFAULT 'WARNING',
  status TEXT NOT NULL DEFAULT 'OPEN',
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_alerts_product ON public.stock_alerts_log (product_id);
CREATE INDEX IF NOT EXISTS idx_stock_alerts_status ON public.stock_alerts_log (status);

ALTER TABLE public.stock_alerts_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read stock_alerts_log" ON public.stock_alerts_log;
DROP POLICY IF EXISTS "Allow write stock_alerts_log" ON public.stock_alerts_log;
CREATE POLICY "Authenticated read stock_alerts_log" ON public.stock_alerts_log FOR SELECT TO authenticated USING (true);

-- 3. MODÈLES D'ÉTIQUETTES THERMIQUES & CASIERS (label_templates)
CREATE TABLE IF NOT EXISTS public.label_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  format_key TEXT NOT NULL UNIQUE,
  width_mm NUMERIC(6,2) NOT NULL DEFAULT 70.0,
  height_mm NUMERIC(6,2) NOT NULL DEFAULT 37.0,
  show_qr BOOLEAN DEFAULT true,
  show_barcode BOOLEAN DEFAULT true,
  show_location BOOLEAN DEFAULT true,
  show_price BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.label_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read label_templates" ON public.label_templates;
DROP POLICY IF EXISTS "Allow write label_templates" ON public.label_templates;
CREATE POLICY "Authenticated read label_templates" ON public.label_templates FOR SELECT TO authenticated USING (true);

INSERT INTO public.label_templates (id, name, format_key, width_mm, height_mm, is_default)
VALUES 
  ('tpl-avery-3x8', 'Planche A4 Avery 3x8 (24 étiquettes 70x37mm)', 'avery_3x8', 70.0, 37.0, true),
  ('tpl-avery-2x7', 'Planche A4 Avery 2x7 (14 grandes étiquettes 105x42mm)', 'avery_2x7', 105.0, 42.0, false),
  ('tpl-thermal-roll', 'Imprimante Thermique Rouleau (50x30mm)', 'thermal', 50.0, 30.0, false),
  ('tpl-bin-rack', 'Étiquettes Casiers & Bacs de Retrait (Grande visibilité)', 'bin_rack', 90.0, 50.0, false)
ON CONFLICT (format_key) DO NOTHING;`;

  const SQL_PHASE4_MIGRATION = `-- =========================================================================
-- TOT STOCK PRO v5.5 - MIGRATION PHASE 4 : LICENCES & QUOTAS EN BASE DE DONNÉES
-- Quotas inviolables appliqués par Triggers PostgreSQL (max_references & max_depots)
-- Jeton signé cryptographique Ed25519 & tolérance hors-ligne 7 jours
-- Compatible bases neuves & bases existantes (Idempotent: IF NOT EXISTS)
-- =========================================================================

-- 1. TABLE DE CONFIGURATION DE LA LICENCE CLIENT (license_config)
CREATE TABLE IF NOT EXISTS public.license_config (
  id TEXT PRIMARY KEY DEFAULT 'active_license',
  license_key TEXT NOT NULL,
  plan_type TEXT NOT NULL DEFAULT 'free',
  max_references INT NOT NULL DEFAULT 30,
  max_depots INT NOT NULL DEFAULT 1,
  organization_name TEXT,
  signed_token TEXT,
  offline_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.license_config ADD COLUMN IF NOT EXISTS max_references INT DEFAULT 30;

ALTER TABLE public.license_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read license_config" ON public.license_config;
DROP POLICY IF EXISTS "Allow write license_config" ON public.license_config;
DROP POLICY IF EXISTS "Authenticated read license_config" ON public.license_config;
DROP POLICY IF EXISTS "Authenticated write license_config" ON public.license_config;
CREATE POLICY "Authenticated read license_config" ON public.license_config FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Authenticated write license_config" ON public.license_config FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.license_config (id, license_key, plan_type, max_references, max_depots, organization_name)
VALUES (
  'active_license',
  '${license?.license_key || 'TOT-STOCK-FREE-INITIAL'}',
  '${license?.plan_type || 'free'}',
  ${Math.max(Number(license?.max_references) || 0, getPlanMaxReferences(license?.plan_type))},
  ${Math.max(Number(license?.max_depots) || 0, getMaxDepotsForPlan(license?.plan_type))},
  '${(license?.organization_name || 'Organisation Locale').replace(/'/g, "''")}'
)
ON CONFLICT (id) DO UPDATE SET
  license_key = EXCLUDED.license_key,
  plan_type = EXCLUDED.plan_type,
  max_references = GREATEST(public.license_config.max_references, EXCLUDED.max_references),
  max_depots = GREATEST(public.license_config.max_depots, EXCLUDED.max_depots),
  organization_name = EXCLUDED.organization_name,
  updated_at = now();

-- 2. TRIGGER POSTGRESQL DE CONTRÔLE STRICT DU QUOTA DE RÉFÉRENCES (max_references)
CREATE OR REPLACE FUNCTION public.enforce_license_max_references_quota()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_count INT;
  v_max_references INT := 30;
  v_app_max_refs INT;
  v_plan_type TEXT := 'free';
  v_app_plan TEXT;
BEGIN
  -- Si l'article existe déjà (cas d'un UPSERT sur un article existant), autoriser la mise à jour
  IF EXISTS (SELECT 1 FROM public.products WHERE id = NEW.id OR reference = NEW.reference) THEN
    RETURN NEW;
  END IF;

  SELECT max_references, plan_type 
  INTO v_max_references, v_plan_type
  FROM public.license_config
  WHERE id = 'active_license';

  BEGIN
    SELECT (value::jsonb->>'max_references')::int, (value::jsonb->>'plan_type')
    INTO v_app_max_refs, v_app_plan
    FROM public.app_settings WHERE key = 'company_license_info' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_app_max_refs := NULL;
  END;

  v_max_references := GREATEST(COALESCE(v_max_references, 30), COALESCE(v_app_max_refs, 30));
  IF v_app_plan IS NOT NULL AND v_app_plan != 'free' THEN
    v_plan_type := v_app_plan;
  END IF;

  -- Forfait Entreprise (illimité)
  IF v_max_references >= 99999 THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_current_count
  FROM public.products
  WHERE id != NEW.id AND reference != NEW.reference;

  IF v_current_count >= v_max_references THEN
    RAISE EXCEPTION 'QUOTA_EXCEEDED: Votre licence TOT Stock (%) est limitée à % références maximum. Vous avez actuellement % références enregistrées. Veuillez mettre à niveau votre forfait.',
      UPPER(COALESCE(v_plan_type, 'GRATUIT')), v_max_references, v_current_count;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_license_max_references ON public.products;
CREATE TRIGGER trg_enforce_license_max_references
  BEFORE INSERT ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_license_max_references_quota();

-- 3. TRIGGER POSTGRESQL DE CONTRÔLE STRICT DU QUOTA DE DÉPÔTS (max_depots)
CREATE OR REPLACE FUNCTION public.enforce_license_max_depots_quota()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_count INT;
  v_max_depots INT := 1;
  v_app_max_depots INT;
  v_plan_type TEXT := 'free';
  v_app_plan TEXT;
BEGIN
  IF NEW.is_active = false THEN
    RETURN NEW;
  END IF;

  -- Si le dépôt existe déjà (cas d'un UPSERT sur un dépôt existant), autoriser la mise à jour
  IF EXISTS (SELECT 1 FROM public.depots WHERE id = NEW.id OR LOWER(name) = LOWER(NEW.name)) THEN
    RETURN NEW;
  END IF;

  SELECT max_depots, plan_type 
  INTO v_max_depots, v_plan_type
  FROM public.license_config
  WHERE id = 'active_license';

  BEGIN
    SELECT (value::jsonb->>'max_depots')::int, (value::jsonb->>'plan_type')
    INTO v_app_max_depots, v_app_plan
    FROM public.app_settings WHERE key = 'company_license_info' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_app_max_depots := NULL;
  END;

  v_max_depots := GREATEST(COALESCE(v_max_depots, 1), COALESCE(v_app_max_depots, 1));
  IF v_app_plan IS NOT NULL AND v_app_plan != 'free' THEN
    v_plan_type := v_app_plan;
  END IF;

  IF v_max_depots >= 99999 THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_current_count
  FROM public.depots
  WHERE is_active = true AND id != NEW.id AND LOWER(name) != LOWER(NEW.name);

  IF v_current_count >= v_max_depots THEN
    RAISE EXCEPTION 'QUOTA_EXCEEDED: Votre licence TOT Stock (%) est limitée à % magasin(s)/dépôt(s) maximum. Veuillez mettre à niveau votre forfait.',
      UPPER(COALESCE(v_plan_type, 'GRATUIT')), v_max_depots;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_license_max_depots ON public.depots;
CREATE TRIGGER trg_enforce_license_max_depots
  BEFORE INSERT ON public.depots
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_license_max_depots_quota();`;

  const SQL_CREATE_DEPOTS_TABLE = `-- Table "depots" pour la gestion des Magasins / Dépôts dans Supabase
CREATE TABLE IF NOT EXISTS public.depots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  company_id TEXT,
  name TEXT NOT NULL UNIQUE,
  code TEXT,
  address TEXT,
  manager TEXT,
  phone TEXT,
  email TEXT,
  description TEXT,
  type TEXT DEFAULT 'FIXED', -- 'FIXED' ou 'VEHICLE'
  vehicle_type TEXT DEFAULT NULL, -- 'FOURGON', 'CAMIONNETTE', 'UTILITAIRE', 'POIDS_LOURD', etc.
  license_plate TEXT DEFAULT NULL,
  manager_id TEXT DEFAULT NULL,
  manager_name TEXT DEFAULT NULL,
  department_id TEXT DEFAULT NULL,
  department_name TEXT DEFAULT NULL,
  pickup_zones JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index pour recherche instantanée
CREATE INDEX IF NOT EXISTS idx_depots_name ON public.depots (name);
CREATE INDEX IF NOT EXISTS idx_depots_type ON public.depots (type);
CREATE INDEX IF NOT EXISTS idx_depots_manager ON public.depots (manager_id);
CREATE INDEX IF NOT EXISTS idx_depots_license_plate ON public.depots (license_plate);
CREATE INDEX IF NOT EXISTS idx_depots_company ON public.depots (company_id);

-- Activation RLS et sécurité basée sur les rôles et permissions
ALTER TABLE public.depots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Depots read access" ON public.depots 
  FOR SELECT TO authenticated, anon 
  USING (is_active = true);

CREATE POLICY "Depots manager write access" ON public.depots 
  FOR ALL TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE (users.auth_user_id = auth.uid() OR users.id::text = auth.uid()::text) 
      AND users.role_id <= 1
    )
  );`;

  const SQL_ADD_EMAIL_COLUMN = `-- 1. Ajouter la colonne contact_email dans la table APP_TOT-Stock-licenses
ALTER TABLE public."APP_TOT-Stock-licenses" 
ADD COLUMN IF NOT EXISTS contact_email TEXT;

-- 2. (Optionnel) Index pour recherche rapide par adresse email
CREATE INDEX IF NOT EXISTS idx_licenses_contact_email 
ON public."APP_TOT-Stock-licenses" (contact_email);

COMMENT ON COLUMN public."APP_TOT-Stock-licenses".contact_email IS 'Adresse email du responsable de compte ou du service facturation';`;

  const SQL_TRIGGER_MONTHLY_ANNUAL = `-- 0. Retirer la contrainte NOT NULL sur client_supabase_url si elle existait
ALTER TABLE public."APP_TOT-Stock-licenses" 
ALTER COLUMN client_supabase_url DROP NOT NULL;
ALTER TABLE public."APP_TOT-Stock-licenses" 
ALTER COLUMN client_supabase_url SET DEFAULT '';

-- 1. Ajouter la colonne billing_cycle si elle n'existe pas encore (défaut: 'annual' ou 'monthly')
ALTER TABLE public."APP_TOT-Stock-licenses" 
ADD COLUMN IF NOT EXISTS billing_cycle TEXT DEFAULT 'annual';

-- 2. Fonction Trigger pour automatiser plan_type, max_references et expires_at (mensuel / annuel / free)
CREATE OR REPLACE FUNCTION public.trg_fn_auto_license_details()
RETURNS TRIGGER AS $$
DECLARE
  v_months INT;
BEGIN
  -- Déterminer le cycle de facturation : 'monthly' (1 mois) ou 'annual' (12 mois)
  IF LOWER(COALESCE(NEW.billing_cycle, 'annual')) IN ('month', 'monthly', 'mensuel') THEN
    v_months := 1;
  ELSE
    v_months := 12;
  END IF;

  -- Déduction automatique selon la clé ou le plan_type
  IF NEW.license_key ILIKE '%-ENT-%' OR LOWER(NEW.plan_type) = 'ent' THEN
    NEW.plan_type := 'ent';
    NEW.max_references := GREATEST(COALESCE(NEW.max_references, 99999), 99999);
    NEW.max_depots := GREATEST(COALESCE(NEW.max_depots, 99999), 99999);
    IF NEW.expires_at IS NULL THEN
      NEW.expires_at := NOW() + (v_months || ' month')::INTERVAL;
    END IF;

  ELSIF NEW.license_key ILIKE '%-PRO-%' OR LOWER(NEW.plan_type) = 'pro' THEN
    NEW.plan_type := 'pro';
    NEW.max_references := GREATEST(COALESCE(NEW.max_references, 1000), 1000);
    NEW.max_depots := GREATEST(COALESCE(NEW.max_depots, 10), 10);
    IF NEW.expires_at IS NULL THEN
      NEW.expires_at := NOW() + (v_months || ' month')::INTERVAL;
    END IF;

  ELSIF NEW.license_key ILIKE '%-STA-%' OR LOWER(NEW.plan_type) = 'sta' THEN
    NEW.plan_type := 'sta';
    NEW.max_references := GREATEST(COALESCE(NEW.max_references, 300), 300);
    NEW.max_depots := GREATEST(COALESCE(NEW.max_depots, 3), 3);
    IF NEW.expires_at IS NULL THEN
      NEW.expires_at := NOW() + (v_months || ' month')::INTERVAL;
    END IF;

  ELSE
    -- Mode Free (15 jours d'essai)
    NEW.plan_type := 'free';
    NEW.max_references := COALESCE(NEW.max_references, 50);
    NEW.max_depots := COALESCE(NEW.max_depots, 1);
    IF NEW.expires_at IS NULL THEN
      NEW.expires_at := NOW() + INTERVAL '15 days';
    END IF;
  END IF;

  NEW.is_active := COALESCE(NEW.is_active, true);
  NEW.client_supabase_url := COALESCE(NEW.client_supabase_url, '');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Attacher le Trigger à la table
DROP TRIGGER IF EXISTS trg_auto_license ON public."APP_TOT-Stock-licenses";
CREATE TRIGGER trg_auto_license
BEFORE INSERT OR UPDATE OF license_key, plan_type, billing_cycle
ON public."APP_TOT-Stock-licenses"
FOR EACH ROW
EXECUTE FUNCTION public.trg_fn_auto_license_details();`;

  const handleCopySql = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSql(label);
    setTimeout(() => setCopiedSql(null), 3000);
  };

  const handleSyncServerNow = async () => {
    setIsSyncingServer(true);
    setLicenseMsg({
      type: 'info',
      text: tr(language, 'Vérification en cours sur la table APP_TOT-Stock-licenses...', 'Checking table APP_TOT-Stock-licenses in progress...'),
    });
    try {
      const res = await syncLicenseWithServer(true);
      if (res.rlsBlocked) {
        setShowRlsHelp(true);
        setLicenseMsg({
          type: 'error',
          text: tr(language, 'Accès sécurisé : La base maître est protégée par RLS. Seules les Edge Functions serveur autorisées peuvent interagir avec les licences.', 'Secure access: Master database is protected by RLS. Only authorized server Edge Functions can interact with licenses.'),
        });
      } else if (res.planChanged && res.license) {
        const refCount = res.license.max_references ?? 0;
        setLicenseMsg({
          type: 'success',
          text: tr(language, `Forfait serveur synchronisé : Votre abonnement est désormais ${res.license.plan_type.toUpperCase()} (${refCount >= 99999 ? 'Illimité' : refCount + ' références'}).`, `Server plan synchronized: Your subscription is now ${res.license.plan_type.toUpperCase()} (${refCount >= 99999 ? 'Unlimited' : refCount + ' items'}).`),
        });
      } else if (res.serverFound) {
        setLicenseMsg({
          type: 'success',
          text: tr(language, `Licence confirmée sur le serveur. Prochaine vérification programmée dans 15 jours.`, `License confirmed on server. Next verification scheduled in 15 days.`),
        });
      } else if (res.updated) {
        setLicenseMsg({
          type: 'success',
          text: res.message || (tr(language, 'Licence enregistrée sur le serveur avec succès !', 'License recorded on server successfully!')),
        });
      } else {
        setLicenseMsg({
          type: 'info',
          text: res.message || (tr(language, 'Contrôle effectué avec succès.', 'Check completed successfully.')),
        });
      }
    } catch (err: any) {
      setLicenseMsg({
        type: 'error',
        text: tr(language, `Erreur lors du contrôle : ${err?.message || 'Serveur indisponible'}`, `Check error: ${err?.message || 'Server unavailable'}`),
      });
    } finally {
      setIsSyncingServer(false);
    }
  };

  const handleCreateOnServer = async () => {
    setIsSyncingServer(true);
    setLicenseMsg({
      type: 'info',
      text: tr(language, 'Création de la ligne de licence dans "APP_TOT-Stock-licenses"...', 'Creating license row in "APP_TOT-Stock-licenses"...'),
    });
    try {
      const cleanOrg = orgName.trim() || license?.organization_name || (tr(language, 'Organisation Client', 'Client Organization'));
      const res = await provisionLicense(cleanOrg, license?.plan_type || 'free', url.trim() || undefined, license?.contact_email);
      if (res.success && res.license) {
        setLicenseMsg({
          type: 'success',
          text: tr(language, `Ligne de licence insérée avec succès dans la table "APP_TOT-Stock-licenses" (${res.license.plan_type.toUpperCase()}) !`, `License row inserted successfully into table "APP_TOT-Stock-licenses" (${res.license.plan_type.toUpperCase()})!`),
        });
      } else if (res.message && res.message.includes('RLS_BLOCKED')) {
        setLicenseMsg({
          type: 'error',
          text: tr(language, 'Écriture directe rejetée par Supabase RLS. Les licences doivent être gérées via les Edge Functions maîtres.', 'Direct write rejected by Supabase RLS. Licenses must be managed via master Edge Functions.'),
        });
      } else {
        setLicenseMsg({
          type: 'info',
          text: res.message,
        });
      }
    } catch (e: any) {
      setLicenseMsg({
        type: 'error',
        text: tr(language, `Erreur : ${e?.message || 'Échec création serveur'}`, `Error: ${e?.message || 'Server creation failed'}`),
      });
    } finally {
      setIsSyncingServer(false);
    }
  };

  const handleSyncClientDb = async () => {
    setIsSyncingServer(true);
    setLicenseMsg({
      type: 'info',
      text: tr(language, 'Synchronisation de la table "license_config" dans votre base Supabase client...', 'Synchronizing "license_config" table in your client Supabase database...'),
    });
    try {
      const client = getClientSupabase(url, key);
      if (!client) {
        setLicenseMsg({
          type: 'error',
          text: tr(language, 'Base client non connectée. Renseignez l\'URL et la clé dans l\'onglet "Base Supabase (BYOD)".', 'Client DB not connected. Fill in URL and key in "Supabase Base (BYOD)" tab.'),
        });
        return;
      }
      const res = await syncLicenseToClientDatabase(license, client);
      if (res.dbLicenseStatus) {
        setDbLicenseStatus(res.dbLicenseStatus);
      } else {
        await refreshDbLicenseStatus(license?.plan_type);
      }
      if (res.success) {
        setLicenseMsg({
          type: 'success',
          text: res.message,
        });
      } else {
        setLicenseMsg({
          type: 'error',
          text: res.message,
        });
      }
    } catch (e: any) {
      setLicenseMsg({
        type: 'error',
        text: `Erreur : ${e?.message || 'Échec synchronisation client'}`,
      });
    } finally {
      setIsSyncingServer(false);
    }
  };

  // Quota calculation (plafonds techniques via plan_limits(plan))
  const productCount = products.length;
  const maxProducts = getPlanMaxReferences(license?.plan_type);
  const quotaPercent = Math.min(100, Math.round((productCount / maxProducts) * 100));
  const maxDepots = Math.max(Number(license?.max_depots) || 0, getMaxDepotsForPlan(license?.plan_type));
  const depotCount = (depots || []).filter((d) => d.is_active !== false).length;
  const depotQuotaPercent = maxDepots >= 9999 ? 10 : Math.min(100, Math.round((depotCount / maxDepots) * 100));

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setCompanySetupModalOpen(false);
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-3 bg-slate-950/75 backdrop-blur-sm animate-fadeIn"
    >
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-3.5 sm:p-5 pb-[max(0.875rem,env(safe-area-inset-bottom))] text-slate-800 dark:text-slate-100 max-h-[94dvh] sm:max-h-[92vh] flex flex-col overflow-hidden">
        
        {/* Top Header */}
        <div className="flex items-center justify-between gap-2 pb-2.5 sm:pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-orange-100 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400 flex items-center justify-center font-bold shrink-0">
              <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-white flex items-center gap-2 truncate">
                {tr(language, 'Entreprise & Licence', 'Company & License')}
              </h2>
              <p className="text-[10px] sm:text-[11px] text-slate-400 truncate">
                {tr(language, 'Souscription client & base de données Supabase', 'Subscription & Supabase database setup')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setCompanySetupModalOpen(false);
            }}
            className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer active:scale-95 shadow-xs shrink-0"
            title={t('common_close')}
            aria-label="Fermer"
          >
            <X className="w-4 h-4 stroke-[2.5]" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-2xl my-2.5 sm:my-3 shrink-0">
          {canLicense && (
            <button
              type="button"
              onClick={() => setActiveTab('license')}
              className={`flex-1 min-w-[110px] py-2 px-2.5 rounded-xl font-extrabold text-[11px] flex items-center justify-center gap-1.5 transition cursor-pointer ${
                activeTab === 'license'
                  ? 'bg-white dark:bg-slate-900 text-orange-600 dark:text-orange-400 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5 shrink-0" />
              <span>{tr(language, 'Licence Client', 'Client License')}</span>
              {license?.license_key && (
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
              )}
            </button>
          )}

          {canDb && (
            <button
              type="button"
              onClick={() => setActiveTab('db')}
              className={`flex-1 min-w-[130px] py-2 px-2.5 rounded-xl font-extrabold text-[11px] flex items-center justify-center gap-1.5 transition cursor-pointer ${
                activeTab === 'db'
                  ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <Database className="w-3.5 h-3.5 shrink-0" />
              <span>{tr(language, 'Base Supabase (BYOD)', 'Supabase DB (BYOD)')}</span>
              {supabaseSyncStatus === 'connected' && (
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveTab('architecture')}
            className={`flex-1 min-w-[130px] py-2 px-2.5 rounded-xl font-extrabold text-[11px] flex items-center justify-center gap-1.5 transition cursor-pointer ${
              activeTab === 'architecture'
                ? 'bg-white dark:bg-slate-900 text-purple-600 dark:text-purple-400 shadow-sm'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-purple-500 shrink-0" />
            <span>{tr(language, 'Architecture & Sécurité', 'Architecture & Security')}</span>
            <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 font-black shrink-0">
              Modèle B
            </span>
          </button>

          {canDb && (
            <button
              type="button"
              onClick={() => setActiveTab('edge_functions')}
              className={`flex-1 min-w-[130px] py-2 px-2.5 rounded-xl font-extrabold text-[11px] flex items-center justify-center gap-1.5 transition cursor-pointer ${
                activeTab === 'edge_functions'
                  ? 'bg-white dark:bg-slate-900 text-orange-600 dark:text-orange-400 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <Server className="w-3.5 h-3.5 text-orange-500 shrink-0" />
              <span>{tr(language, '4. Fonctions Edge', '4. Edge Functions', '4. Edge Functions')}</span>
            </button>
          )}
        </div>

        {/* Access Restriction Notice if neither is allowed */}
        {!canLicense && !canDb && (
          <div className="p-4 my-auto text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
              <KeyRound className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-slate-800 dark:text-slate-200">
              {tr(language, 'Accès Restreint', 'Restricted Access')}
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {tr(language, 'Votre rôle ne dispose pas des autorisations nécessaires pour consulter ou modifier la licence et les paramètres de base de données.', 'Your user role does not have permission to view or modify license and database configuration.')}
            </p>
          </div>
        )}

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-3 pb-2 text-xs">
          
          {/* ======================= TAB 1: LICENCE CLIENT ======================= */}
          {activeTab === 'license' && canLicense && (
            <div className="space-y-3 animate-fadeIn">
              
              {/* Active License Overview Card */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-50 to-orange-50/40 dark:from-slate-800/80 dark:to-orange-950/20 border border-slate-200 dark:border-slate-700/80 space-y-3.5">
                {/* Header: Plan, Status, Billing Cycle & Upgrade Button */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-slate-200/60 dark:border-slate-700/60">
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                        {tr(language, 'Formule & Abonnement :', 'Plan & Subscription:')}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          license?.status === 'valid'
                            ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800'
                            : license?.status === 'expired'
                            ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-400 border border-rose-300 dark:border-rose-800'
                            : license?.status === 'inactive'
                            ? 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-800'
                            : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {license?.status === 'valid'
                          ? (tr(language, '● Actif', '● Active'))
                          : license?.status === 'expired'
                          ? (tr(language, 'Expiré', 'Expired'))
                          : license?.status === 'inactive'
                          ? (tr(language, 'Désactivé', 'Deactivated'))
                          : (tr(language, 'Sans licence', 'No license'))}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800">
                        {license?.billing_cycle === 'annual'
                          ? (tr(language, 'Forfait Annuel (12 mois • -20%)', 'Annual Plan (12 mos • -20%)'))
                          : license?.billing_cycle === 'monthly'
                          ? (tr(language, 'Forfait Mensuel (1 mois)', 'Monthly Plan (1 month)'))
                          : license?.plan_type === 'free'
                          ? (tr(language, 'Période Découverte', 'Trial Period'))
                          : (tr(language, 'Abonnement Actif', 'Active Subscription'))}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-lg font-black text-slate-900 dark:text-white">
                        Plan {PLAN_LABELS[normalizeToCanonicalPlan(license?.plan || license?.plan_type, license?.license_key)]}
                      </span>
                      <span className="text-xs text-slate-500 font-semibold">
                        • {maxProducts >= 9999
                          ? (tr(language, 'Références illimitées', 'Unlimited items'))
                          : `${maxProducts} ${tr(language, 'références max', 'max items')}`}
                      </span>
                    </div>
                  </div>

                  {/* Direct Switch / Upgrade Plan Button */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const nextPlan: 'sta' | 'pro' | 'ent' =
                          license?.plan_type === 'sta' ? 'pro' : license?.plan_type === 'pro' ? 'ent' : 'pro';
                        handleOpenSubscription(nextPlan);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-black text-[11px] flex items-center gap-1.5 shadow-sm shadow-orange-500/20 transition cursor-pointer active:scale-95"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>
                        {license?.plan_type === 'sta'
                          ? (tr(language, `Passer à ${PLAN_LABELS.pro} (Upgrade)`, `Upgrade to ${PLAN_LABELS.pro}`))
                          : license?.plan_type === 'pro'
                          ? (tr(language, `Passer à ${PLAN_LABELS.ent} (Upgrade)`, `Upgrade to ${PLAN_LABELS.ent}`))
                          : license?.plan_type === 'ent'
                          ? (tr(language, 'Gérer / Renouveler', 'Manage / Renew'))
                          : (tr(language, 'Souscrire un Forfait', 'Subscribe to a Plan'))}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Organization Edit Row */}
                <div className="flex items-center justify-between text-[11px] pt-0.5">
                  <span className="text-slate-500 dark:text-slate-400 font-bold flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-orange-500" />
                    {tr(language, 'Organisation / Entreprise :', 'Organization / Company:')}
                  </span>
                  {isEditingOrg ? (
                    <div className="flex items-center gap-1 justify-end">
                      <input
                        type="text"
                        value={orgName}
                        onChange={(e) => setOrgName(e.target.value)}
                        placeholder={tr(language, "Nom de l'entreprise", 'Company name')}
                        className="px-2 py-1 text-[11px] font-bold rounded-lg bg-white dark:bg-slate-900 border border-orange-400 dark:border-orange-600 outline-none text-slate-900 dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={handleSaveOrg}
                        disabled={isSavingOrg}
                        className="px-2 py-1 rounded-lg bg-orange-600 text-white font-bold text-[10px] hover:bg-orange-700 disabled:opacity-50 cursor-pointer"
                      >
                        {isSavingOrg ? '...' : 'OK'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsEditingOrg(false)}
                        className="px-1.5 py-1 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 justify-end">
                      <span className="font-extrabold text-slate-800 dark:text-slate-100 text-xs">
                        {license?.organization_name || (tr(language, 'Organisation Locale', 'Local Organization'))}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setOrgName(license?.organization_name || '');
                          setIsEditingOrg(true);
                        }}
                        className="text-[10px] text-orange-600 dark:text-orange-400 font-bold hover:underline cursor-pointer"
                        title={tr(language, "Modifier le nom de l'organisation et synchroniser avec le serveur", "Edit organization name and sync with server")}
                      >
                        {tr(language, 'Modifier', 'Edit')}
                      </button>
                    </div>
                  )}
                </div>

                {/* Quotas Progress Bars (Références + Dépôts) */}
                <div className="space-y-2.5 pt-1">
                  {/* Quota Références */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] font-bold">
                      <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                        <Layers className="w-3.5 h-3.5 text-orange-500" />
                        {tr(language, 'Quota Catalogue Références', 'Catalog Items Quota')}
                      </span>
                      <span className="font-mono font-black text-slate-900 dark:text-white">
                        {productCount} / {maxProducts >= 9999 ? (tr(language, 'Illimité', 'Unlimited')) : maxProducts}
                      </span>
                    </div>

                    <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          quotaPercent >= 100
                            ? 'bg-red-500'
                            : quotaPercent >= 80
                            ? 'bg-amber-500'
                            : 'bg-gradient-to-r from-orange-500 to-amber-500'
                        }`}
                        style={{ width: `${maxProducts >= 9999 ? 5 : quotaPercent}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium">
                      <span>
                        {maxProducts >= 9999
                          ? (tr(language, 'Références et mouvements illimités', 'Unlimited items and movements'))
                          : `${maxProducts - productCount > 0 ? maxProducts - productCount : 0} ${tr(language, 'référence(s) restante(s)', 'item(s) remaining')}`}
                      </span>
                      <span>{quotaPercent}% {tr(language, 'utilisé', 'used')}</span>
                    </div>
                  </div>

                  {/* Quota Magasins / Dépôts */}
                  <div className="space-y-1 pt-1 border-t border-slate-200/50 dark:border-slate-700/50">
                    <div className="flex items-center justify-between text-[11px] font-bold">
                      <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                        <Building2 className="w-3.5 h-3.5 text-blue-500" />
                        {tr(language, 'Quota Magasins / Dépôts', 'Stores / Depots Quota')}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-black text-slate-900 dark:text-white">
                          {depotCount} / {maxDepots >= 9999 ? (tr(language, 'Illimité', 'Unlimited')) : maxDepots}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setCompanySetupModalOpen(false);
                            setDepotsModalOpen(true);
                          }}
                          className="text-[9.5px] font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          {tr(language, 'Gérer', 'Manage')}
                        </button>
                      </div>
                    </div>

                    <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          depotQuotaPercent >= 100
                            ? 'bg-red-500'
                            : depotQuotaPercent >= 80
                            ? 'bg-amber-500'
                            : 'bg-gradient-to-r from-blue-500 to-indigo-500'
                        }`}
                        style={{ width: `${maxDepots >= 9999 ? 10 : depotQuotaPercent}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium">
                      <span>
                        {maxDepots >= 9999
                          ? (tr(language, 'Dépôts et magasins illimités', 'Unlimited depots and stores'))
                          : `${maxDepots - depotCount > 0 ? maxDepots - depotCount : 0} ${tr(language, 'magasin(s)/dépôt(s) restant(s)', 'store(s)/depot(s) remaining')}`}
                      </span>
                      <span>
                        {license?.plan_type === 'sta'
                          ? `${maxDepots} max (${PLAN_LABELS.sta})`
                          : license?.plan_type === 'pro'
                          ? `${maxDepots} max (${PLAN_LABELS.pro})`
                          : license?.plan_type === 'ent'
                          ? (tr(language, `Illimité (${PLAN_LABELS.ent})`, `Unlimited (${PLAN_LABELS.ent})`))
                          : `${maxDepots} max (${PLAN_LABELS.free})`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Information Forfaits & Autorité du Serveur Éditeur */}
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-orange-500/10 via-amber-500/10 to-orange-500/10 border border-orange-200 dark:border-orange-900/60 shadow-xs space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-orange-600 dark:text-orange-400 shrink-0" />
                      <div>
                        <span className="text-[11.5px] font-black text-slate-900 dark:text-slate-100">
                          {tr(language, 'Changement de Forfait & Quotas', 'Plan Change & Quotas')}
                        </span>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                          {tr(language, 'La délivrance d’une licence et l’attribution des quotas sont exclusivement opérées par le serveur éditeur.', 'License issuance and quota assignment are exclusively operated by the publisher server.')}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleOpenSubscription(license?.plan_type === 'free' ? 'pro' : (license?.plan_type as any || 'pro'))}
                      className="px-3 py-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-black text-[10.5px] transition cursor-pointer flex items-center justify-center gap-1.5 shadow-sm self-start sm:self-auto shrink-0"
                    >
                      <CreditCard className="w-3.5 h-3.5" />
                      <span>{tr(language, 'Souscrire / Devis', 'Subscribe / Quote')}</span>
                    </button>
                  </div>
                </div>

                {/* License Key & Email Details Block */}
                <div className="pt-2.5 border-t border-slate-200/60 dark:border-slate-700/60 space-y-2.5 text-[11px]">
                  {/* Numéro de Licence & 1-Click Copy */}
                  <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900/90 border border-slate-200/90 dark:border-slate-700/80 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10.5px] font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                        <KeyRound className="w-3.5 h-3.5 text-orange-500" />
                        {tr(language, 'Numéro de Licence Actif :', 'Active License Key:')}
                      </span>
                      {license?.license_key && (
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(license.license_key);
                            setCopiedKey(true);
                            setTimeout(() => setCopiedKey(false), 2000);
                          }}
                          className="px-2 py-0.5 rounded-md bg-orange-500/10 hover:bg-orange-500/20 text-orange-600 dark:text-orange-400 font-bold text-[10px] flex items-center gap-1 cursor-pointer transition"
                          title={tr(language, "Copier la clé de licence", "Copy license key")}
                        >
                          <Copy className="w-3 h-3" />
                          <span>{copiedKey ? (tr(language, '✓ Clé copiée !', '✓ Copied!')) : (tr(language, 'Copier', 'Copy'))}</span>
                        </button>
                      )}
                    </div>
                    <div className="font-mono font-black text-slate-800 dark:text-slate-100 text-xs tracking-wide select-all break-all bg-slate-50 dark:bg-slate-800/80 p-1.5 rounded-lg border border-slate-200/60 dark:border-slate-700/60">
                      {license?.license_key || (tr(language, 'Aucune clé active (Mode Découverte)', 'No active key (Discovery Mode)'))}
                    </div>
                  </div>

                  {/* Adresse Email Liée & Inline Edit */}
                  <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900/90 border border-slate-200/90 dark:border-slate-700/80">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10.5px] font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                        <Mail className="w-3.5 h-3.5 text-blue-500" />
                        {tr(language, 'Adresse Email liée (Facturation & Contact) :', 'Linked Email Address (Billing & Contact):')}
                      </span>
                      {!isEditingEmail && (
                        <button
                          type="button"
                          onClick={() => {
                            setEmailInput(license?.contact_email || '');
                            setIsEditingEmail(true);
                          }}
                          className="text-[10px] text-blue-600 dark:text-blue-400 font-bold hover:underline cursor-pointer"
                        >
                          {license?.contact_email ? (tr(language, 'Modifier', 'Edit')) : (tr(language, '+ Associer un email', '+ Link an email'))}
                        </button>
                      )}
                    </div>

                    {isEditingEmail ? (
                      <div className="flex items-center gap-1.5 mt-1">
                        <input
                          type="email"
                          value={emailInput}
                          onChange={(e) => setEmailInput(e.target.value)}
                          placeholder="billing@company.com"
                          className="flex-1 px-2 py-1 text-xs font-semibold rounded-lg bg-slate-50 dark:bg-slate-800 border border-blue-400 dark:border-blue-500 outline-none text-slate-900 dark:text-white"
                        />
                        <button
                          type="button"
                          onClick={handleSaveEmail}
                          disabled={isSavingEmail}
                          className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10.5px] cursor-pointer disabled:opacity-50"
                        >
                          {isSavingEmail ? '...' : (tr(language, 'Enregistrer', 'Save'))}
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsEditingEmail(false)}
                          className="px-2 py-1 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10.5px] cursor-pointer"
                        >
                          {tr(language, 'Annuler', 'Cancel')}
                        </button>
                      </div>
                    ) : (
                      <div className="font-semibold text-slate-800 dark:text-slate-200 text-xs flex items-center gap-1.5">
                        {license?.contact_email ? (
                          <span className="font-bold text-blue-600 dark:text-blue-400">{license.contact_email}</span>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">
                            {tr(language, 'Non renseignée (cliquez sur "+ Associer un email" pour lier une adresse)', 'Not specified (click "+ Link an email" to link an address)')}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Expiration Date & Remaining Days */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900/90 border border-slate-200/90 dark:border-slate-700/80">
                      <span className="text-[10px] text-slate-400 block font-bold">
                        {license?.plan_type === 'free'
                          ? (tr(language, 'Fin Période Découverte', 'Trial End Date'))
                          : (tr(language, "Date d'Échéance / Expiration", 'Due Date / Expiration'))}
                      </span>
                      <span
                        className={`font-black flex items-center gap-1.5 text-xs mt-0.5 ${
                          license?.expires_at && new Date(license.expires_at).getTime() < Date.now()
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-slate-800 dark:text-slate-100'
                        }`}
                      >
                        <Calendar className="w-3.5 h-3.5 text-orange-500" />
                        {license?.expires_at
                          ? new Date(license.expires_at).toLocaleDateString(tr(language, 'fr-FR', 'en-US', 'nl-NL'), {
                              day: '2-digit',
                              month: 'long',
                              year: 'numeric',
                            })
                          : (tr(language, 'Abonnement Actif', 'Active Subscription'))}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900/90 border border-slate-200/90 dark:border-slate-700/80">
                      <span className="text-[10px] text-slate-400 block font-bold">
                        {tr(language, 'Période & Validité restante', 'Period & Remaining Validity')}
                      </span>
                      <div className="mt-0.5 flex items-center gap-1.5 font-bold text-xs">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10.5px] font-black ${
                            !license?.expires_at
                              ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                              : new Date(license.expires_at).getTime() < Date.now()
                              ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300'
                              : 'bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300'
                          }`}
                        >
                          {!license?.expires_at
                            ? (tr(language, 'Illimitée', 'Unlimited'))
                            : new Date(license.expires_at).getTime() < Date.now()
                            ? (tr(language, 'Expirée', 'Expired'))
                            : `${Math.max(
                                0,
                                Math.ceil((new Date(license.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                              )} ${tr(language, 'jours restants', 'days remaining')}`}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 15-Day Automatic Verification & Server Sync */}
                <div className="mt-3 pt-2.5 border-t border-slate-200/60 dark:border-slate-700/60 space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5 font-bold">
                      <Clock className="w-3.5 h-3.5 text-blue-500" />
                      {tr(language, 'Contrôle Serveur (Tous les 15 jours)', 'Server Check (Every 15 days)')}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                      daysUntilNextCheck > 0
                        ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800'
                        : 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-800'
                    }`}>
                      {daysUntilNextCheck > 0
                        ? (tr(language, `Prochain dans ${daysUntilNextCheck} j`, `Next in ${daysUntilNextCheck} d`))
                        : (tr(language, 'Vérification requise', 'Verification required'))}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-slate-400 bg-slate-50 dark:bg-slate-900/50 p-2 rounded-xl border border-slate-200/50 dark:border-slate-800">
                    <div>
                      <span className="block font-medium">{tr(language, 'Dernière vérification :', 'Last verification:')}</span>
                      <span className="font-bold text-slate-600 dark:text-slate-300">
                        {license?.last_verified_at
                          ? new Date(license.last_verified_at).toLocaleDateString(tr(language, 'fr-FR', 'en-US', 'nl-NL'), {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : (tr(language, 'Initiale', 'Initial'))}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={handleSyncServerNow}
                      disabled={isSyncingServer}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 hover:border-blue-500 text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1.5 shadow-xs transition cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${isSyncingServer ? 'animate-spin text-blue-500' : ''}`} />
                      {isSyncingServer
                        ? (tr(language, 'Contrôle...', 'Checking...'))
                        : (tr(language, 'Vérifier maintenant', 'Check now'))}
                    </button>
                  </div>
                </div>
              </div>

              {/* Status feedback message */}
              {licenseMsg && (
                <div
                  className={`p-3 rounded-2xl border text-xs font-bold flex items-start gap-2 ${
                    licenseMsg.type === 'success'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
                      : licenseMsg.type === 'error'
                      ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400'
                      : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400'
                  }`}
                >
                  {licenseMsg.type === 'success' ? (
                    <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <span className="flex-1">{licenseMsg.text}</span>
                </div>
              )}

              {/* LOT 2 v43 : État réel dans la base cliente (core_license_config) + Avertissement rouge si désynchronisé */}
              {dbLicenseStatus && (
                <div className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-black text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5 text-orange-500" />
                      {tr(
                        language,
                        'État appliqué dans la base de données (core_license_config)',
                        'Applied status in database (core_license_config)',
                        'Toegepaste status in database (core_license_config)'
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => refreshDbLicenseStatus()}
                      className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      {tr(language, 'Relire la base', 'Re-read DB', 'Database herlezen')}
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-[11px]">
                    <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                      <span className="text-[10px] text-slate-400 block font-bold">
                        {tr(language, 'Forfait (base)', 'Plan (DB)', 'Pakket (DB)')}
                      </span>
                      <span className="font-black uppercase text-slate-900 dark:text-white">
                        {dbLicenseStatus.plan.toUpperCase()}
                      </span>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                      <span className="text-[10px] text-slate-400 block font-bold">
                        {tr(
                          language,
                          'Dépôts autorisés selon la base',
                          'Allowed depots according to DB',
                          'Toegestane depots volgens DB'
                        )}
                      </span>
                      <span className="font-black text-slate-900 dark:text-white">
                        {dbLicenseStatus.max_depots >= 9999
                          ? tr(language, 'Illimité', 'Unlimited', 'Onbeperkt')
                          : dbLicenseStatus.max_depots}
                      </span>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                      <span className="text-[10px] text-slate-400 block font-bold">
                        {tr(
                          language,
                          'Jeton signé présent',
                          'Signed token present',
                          'Ondertekend token aanwezig'
                        )}
                      </span>
                      <span
                        className={`font-black ${
                          dbLicenseStatus.signedTokenPresent
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {dbLicenseStatus.signedTokenPresent
                          ? tr(language, 'oui', 'yes', 'ja')
                          : tr(language, 'non', 'no', 'nee')}
                      </span>
                    </div>
                  </div>

                  {dbLicenseStatus.mismatchWarning && (
                    <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-[11px] font-bold flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                      <span>
                        {tr(
                          language,
                          `Avertissement : l'application affiche le forfait ${(license?.plan_type || 'PRO').toUpperCase()} alors que la base de données est en FREE (${dbLicenseStatus.max_depots} dépôt autorisé, jeton signé présent : non). Les dépôts supplémentaires seront refusés par le serveur (QUOTA_EXCEEDED) tant que la fonction Edge APP_TOT-Stock_licenses_sync-license n'aura pas écrit le jeton signé dans core_license_config.`,
                          `Warning: the application displays the ${(license?.plan_type || 'PRO').toUpperCase()} plan while the database is in FREE (${dbLicenseStatus.max_depots} allowed depot, signed token present: no). Additional depots will be rejected by the server (QUOTA_EXCEEDED) until the Edge Function APP_TOT-Stock_licenses_sync-license writes the signed token to core_license_config.`,
                          `Waarschuwing: de applicatie toont het abonnement ${(license?.plan_type || 'PRO').toUpperCase()} terwijl de database op FREE staat (${dbLicenseStatus.max_depots} toegestaan depot, ondertekend token aanwezig: nee). Extra depots worden door de server geweigerd (QUOTA_EXCEEDED) totdat de Edge Function APP_TOT-Stock_licenses_sync-license het ondertekende token naar core_license_config schrijft.`
                        )}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Server Table "APP_TOT-Stock-licenses" Management & RLS Troubleshooter */}
              <div className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-800/40 dark:to-slate-800/20 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-blue-500" />
                    {tr(language, 'Table Centrale :', 'Master Table:')} <span className="font-mono text-blue-600 dark:text-blue-400">APP_TOT-Stock-licenses</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowRlsHelp(!showRlsHelp)}
                    className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                    {showRlsHelp
                      ? (tr(language, 'Masquer aide', 'Hide help'))
                      : (tr(language, 'Table vide ?', 'Empty table?'))}
                  </button>
                </div>

                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {tr(language, "La vérification s'effectue automatiquement tous les 15 jours sur cette table. En cas de modification du forfait sur le serveur par l'administrateur, le changement est appliqué instantanément.", 'Verification is performed automatically every 15 days on this table. If the plan is modified on the server by the administrator, changes are applied instantly.')}
                </p>

                <div className="flex items-center gap-2 pt-1 flex-wrap">
                  <button
                    type="button"
                    onClick={handleCreateOnServer}
                    disabled={isSyncingServer}
                    className="flex-1 min-w-[140px] py-1.5 px-3 rounded-xl text-[11px] font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <UploadCloud className="w-3.5 h-3.5" />
                    {tr(language, 'Créer ma licence dans la table', 'Create my license in table')}
                  </button>

                  <button
                    type="button"
                    onClick={handleSyncClientDb}
                    disabled={isSyncingServer || !supabaseConfig?.url}
                    className="py-1.5 px-3 rounded-xl text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    title={tr(language, "Met à jour license_config dans votre base client", "Updates license_config in your client DB")}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncingServer ? 'animate-spin' : ''}`} />
                    {tr(language, 'Sync Base Client', 'Sync Client DB')}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowRlsHelp(!showRlsHelp)}
                    className="py-1.5 px-3 rounded-xl text-[11px] font-bold bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 transition flex items-center gap-1 cursor-pointer"
                  >
                    <Terminal className="w-3.5 h-3.5" />
                    SQL RLS
                  </button>
                </div>

                {/* Explanatory Collapsible Box for Empty Table / RLS */}
                {showRlsHelp && (
                  <div className="mt-3 p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2 text-[11px]">
                    <div className="flex items-center gap-1.5 font-bold text-blue-600 dark:text-blue-400">
                      <ShieldCheck className="w-4 h-4 shrink-0" />
                      {tr(language, 'Architecture Sécurisée Base Maître (RLS Strict)', 'Secure Master Database Architecture (Strict RLS)')}
                    </div>
                    <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                      {tr(language, 'Sur la base maître, la table "APP_TOT-Stock-licenses" a le RLS activé SANS aucune politique pour anon ni authenticated (0 ligne accessible directement). Toutes les opérations passent par les Edge Functions maîtres sécurisées avec service_role.', 'On the master base, table "APP_TOT-Stock-licenses" has RLS enabled WITHOUT any policy for anon or authenticated (0 direct rows accessible). All operations strictly use master Edge Functions with service_role.')}
                    </p>

                    <div className="p-2.5 bg-slate-950 text-slate-100 rounded-lg font-mono text-[10px] space-y-1.5">
                      <div className="flex items-center justify-between text-slate-400 pb-1 border-b border-slate-800 font-sans text-[10px]">
                        <span>{tr(language, 'Schéma SQL Base Maître (schema_master_licenses.sql) :', 'Master DB SQL Schema (schema_master_licenses.sql):')}</span>
                        <button
                          type="button"
                          onClick={() => handleCopySql(SQL_MASTER_LICENSES_SCHEMA, 'master_schema')}
                          className="text-orange-400 hover:text-orange-300 flex items-center gap-1 font-bold cursor-pointer"
                        >
                          <Copy className="w-3 h-3" />
                          {copiedSql === 'master_schema' ? (tr(language, 'Copié !', 'Copied!')) : (tr(language, 'Copier Schéma Maître', 'Copy Master Schema'))}
                        </button>
                      </div>
                      <div className="text-emerald-400 font-bold overflow-x-auto py-1 max-h-24">
                        ALTER TABLE public."APP_TOT-Stock-licenses" ENABLE ROW LEVEL SECURITY;
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5 pt-1 border-t border-slate-100 dark:border-slate-800">
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => handleCopySql(SQL_MASTER_LICENSES_SCHEMA, 'master_schema_btn')}
                          className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 underline cursor-pointer"
                        >
                          {copiedSql === 'master_schema_btn'
                            ? (tr(language, '✓ Schéma Maître copié !', '✓ Master Schema copied!'))
                            : (tr(language, 'Copier schéma complet base maître', 'Copy full master schema'))}
                        </button>
                        <button
                          type="button"
                          onClick={handleSyncServerNow}
                          className="px-2 py-0.5 text-[10px] font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-md cursor-pointer"
                        >
                          {tr(language, "Vérifier avec Edge Function", 'Verify via Edge Function')}
                        </button>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[10px] text-slate-500 font-medium">
                          {tr(language, 'Trigger automatique (Mensuel / Annuel / 15j) :', 'Automatic trigger (Monthly / Annual / 15d):')}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopySql(SQL_TRIGGER_MONTHLY_ANNUAL, 'trigger')}
                          className="px-2 py-1 text-[10px] font-bold bg-orange-500/10 hover:bg-orange-500/20 text-orange-600 dark:text-orange-400 border border-orange-500/30 rounded-lg flex items-center gap-1 cursor-pointer transition"
                        >
                          <Copy className="w-3 h-3" />
                          {copiedSql === 'trigger'
                            ? (tr(language, '✓ Trigger SQL copié !', '✓ SQL trigger copied!'))
                            : (tr(language, 'Copier Trigger SQL Mensuel/Annuel', 'Copy Monthly/Annual SQL Trigger'))}
                        </button>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[10px] text-slate-500 font-medium">
                          {tr(language, 'Colonne Email (contact_email) :', 'Email column (contact_email):')}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopySql(SQL_ADD_EMAIL_COLUMN, 'email_column')}
                          className="px-2 py-1 text-[10px] font-bold bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30 rounded-lg flex items-center gap-1 cursor-pointer transition"
                        >
                          <Copy className="w-3 h-3" />
                          {copiedSql === 'email_column'
                            ? (tr(language, '✓ SQL contact_email copié !', '✓ contact_email SQL copied!'))
                            : (tr(language, 'Copier SQL Colonne Email', 'Copy Email Column SQL'))}
                        </button>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[10px] text-slate-500 font-medium">
                          {tr(language, '1. Base Maître : Créer / Mettre à jour la licence :', '1. Master DB: Insert/Update license:')}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const clientUrlVal = (supabaseConfig?.url || '').trim();
                            const escapedOrg = (license?.organization_name || orgName || 'Mon Entreprise').replace(/'/g, "''");
                            const keyVal = license?.license_key || 'TOT-STOCK-PRO-A1B2C3D4-E5F6G7H8';
                            const planVal = license?.plan_type || 'pro';
                            const maxRefVal = license?.max_references || 500;
                            const maxDepVal = license?.max_depots || 10;
                            const cycleVal = license?.billing_cycle || 'annual';

                            const sqlMaster = `-- 1. Supprimer la contrainte NOT NULL sur client_supabase_url si elle existait
ALTER TABLE public."APP_TOT-Stock-licenses" ALTER COLUMN client_supabase_url DROP NOT NULL;
ALTER TABLE public."APP_TOT-Stock-licenses" ALTER COLUMN client_supabase_url SET DEFAULT '';

-- 2. Activer RLS et autoriser la lecture sécurisée des licences actives par l'application
ALTER TABLE public."APP_TOT-Stock-licenses" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon read active licenses" ON public."APP_TOT-Stock-licenses";
CREATE POLICY "Allow anon read active licenses" 
  ON public."APP_TOT-Stock-licenses" 
  FOR SELECT 
  TO anon, authenticated 
  USING (is_active = true);

-- 3. Fonction RPC d'authentification certifiée
CREATE OR REPLACE FUNCTION public.verify_client_license(
  p_license_key TEXT,
  p_client_supabase_url TEXT DEFAULT ''
)
RETURNS TABLE (
  id UUID,
  license_key TEXT,
  plan_type TEXT,
  max_references INT,
  max_depots INT,
  organization_name TEXT,
  client_supabase_url TEXT,
  contact_email TEXT,
  billing_cycle TEXT,
  is_active BOOLEAN,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_license_key IS NULL OR TRIM(p_license_key) = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 
    l.id,
    l.license_key,
    l.plan_type,
    l.max_references,
    l.max_depots,
    l.organization_name,
    l.client_supabase_url,
    l.contact_email,
    l.billing_cycle,
    l.is_active,
    l.expires_at,
    l.created_at
  FROM public."APP_TOT-Stock-licenses" l
  WHERE UPPER(TRIM(l.license_key)) = UPPER(TRIM(p_license_key))
    AND l.is_active = true
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_client_license(TEXT, TEXT) TO anon, authenticated;

-- 4. Insérer ou actualiser la licence officielle dans la base maître
INSERT INTO public."APP_TOT-Stock-licenses" 
  (license_key, plan_type, max_references, max_depots, organization_name, client_supabase_url, billing_cycle, is_active)
VALUES 
  ('${keyVal}', '${planVal}', ${maxRefVal}, ${maxDepVal}, '${escapedOrg}', '${clientUrlVal}', '${cycleVal}', true)
ON CONFLICT (UPPER(license_key)) DO UPDATE 
  SET plan_type = EXCLUDED.plan_type, 
      max_references = EXCLUDED.max_references, 
      max_depots = EXCLUDED.max_depots, 
      organization_name = EXCLUDED.organization_name,
      client_supabase_url = COALESCE(NULLIF(EXCLUDED.client_supabase_url, ''), public."APP_TOT-Stock-licenses".client_supabase_url, ''),
      billing_cycle = COALESCE(EXCLUDED.billing_cycle, 'annual'),
      is_active = true;`;
                            handleCopySql(sqlMaster, 'master_insert');
                          }}
                          className="px-2 py-1 text-[10px] font-bold bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30 rounded-lg flex items-center gap-1 cursor-pointer transition"
                        >
                          <Copy className="w-3 h-3" />
                          {copiedSql === 'master_insert'
                            ? (tr(language, '✓ SQL Maître copié !', '✓ Master SQL copied!'))
                            : (tr(language, 'Copier SQL Base Maître', 'Copy Master DB SQL'))}
                        </button>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[10px] text-slate-500 font-medium">
                          {tr(language, '2. Base Client : Débloquer quota (license_config) :', '2. Client DB: Unlock quota (license_config):')}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const sqlClient = `ALTER TABLE public.license_config ADD COLUMN IF NOT EXISTS max_references INT DEFAULT 30;

INSERT INTO public.license_config 
  (id, license_key, plan_type, max_references, max_depots, organization_name, updated_at)
VALUES 
  ('active_license', '${license?.license_key || 'TOT-STOCK-PRO-A1B2C3D4-E5F6G7H8'}', '${license?.plan_type || 'pro'}', ${license?.max_references || 500}, ${license?.max_depots || 10}, '${license?.organization_name || 'Mon Entreprise'}', now())
ON CONFLICT (id) DO UPDATE SET
  license_key = EXCLUDED.license_key,
  plan_type = EXCLUDED.plan_type,
  max_references = EXCLUDED.max_references,
  max_depots = EXCLUDED.max_depots,
  updated_at = now();`;
                            handleCopySql(sqlClient, 'client_update');
                          }}
                          className="px-2 py-1 text-[10px] font-bold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 rounded-lg flex items-center gap-1 cursor-pointer transition"
                        >
                          <Copy className="w-3 h-3" />
                          {copiedSql === 'client_update'
                            ? (tr(language, '✓ SQL Client copié !', '✓ Client SQL copied!'))
                            : (tr(language, 'Copier SQL Base Client', 'Copy Client DB SQL'))}
                        </button>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[10px] text-slate-500 font-medium">
                          {tr(language, 'Table Client Magasins / Dépôts (public.depots) :', 'Client Stores / Depots Table (public.depots):')}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopySql(SQL_CREATE_DEPOTS_TABLE, 'depots_table')}
                          className="px-2 py-1 text-[10px] font-bold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 rounded-lg flex items-center gap-1 cursor-pointer transition"
                        >
                          <Copy className="w-3 h-3" />
                          {copiedSql === 'depots_table'
                            ? (tr(language, '✓ SQL table depots copié !', '✓ depots table SQL copied!'))
                            : (tr(language, 'Copier SQL Table Magasins/Dépôts', 'Copy Stores/Depots Table SQL'))}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 4 Plan Tiers Comparison, Guide & Subscription Cards */}
              <div className="space-y-3">
                {/* Guide: Comment souscrire un abonnement */}
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border border-amber-200 dark:border-amber-800/60 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-orange-500 text-white flex items-center justify-center font-bold text-xs shadow-xs">
                        💎
                      </div>
                      <div>
                        <span className="font-extrabold text-xs text-amber-950 dark:text-amber-200">
                          {tr(language, 'Comment souscrire à un abonnement depuis ce menu ?', 'How to subscribe to a plan from this menu?')}
                        </span>
                        <p className="text-[10px] text-amber-800/80 dark:text-amber-300/80">
                          {tr(language, '3 moyens simples et immédiats pour activer votre formule', '3 simple and instant ways to activate your plan')}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleOpenSubscription('pro')}
                      className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-black text-[11px] flex items-center gap-1.5 shadow-md shadow-orange-500/20 transition cursor-pointer active:scale-95"
                    >
                      <CreditCard className="w-3.5 h-3.5" />
                      <span>{tr(language, 'Souscrire en ligne', 'Subscribe online')}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px]">
                    <div className="p-2.5 rounded-xl bg-white/80 dark:bg-slate-900/70 border border-amber-200/70 dark:border-amber-900/40">
                      <div className="font-bold text-orange-600 dark:text-orange-400 flex items-center gap-1 mb-0.5">
                        <span className="w-4 h-4 rounded-full bg-orange-100 dark:bg-orange-950 text-orange-600 flex items-center justify-center text-[10px] font-black">1</span>
                        <span>{tr(language, 'Souscription en 1 clic', '1-Click Subscription')}</span>
                      </div>
                      <p className="text-[10.5px] text-slate-600 dark:text-slate-300 leading-relaxed">
                        {tr(language, `Cliquez sur "💎 Souscrire" sur ${PLAN_LABELS.sta}, ${PLAN_LABELS.pro} ou ${PLAN_LABELS.ent}. Choisissez Mensuel ou Annuel (-20%) et activez immédiatement votre clé.`, `Click "💎 Subscribe" on ${PLAN_LABELS.sta}, ${PLAN_LABELS.pro} or ${PLAN_LABELS.ent}. Choose Monthly or Annual (-20%) and immediately activate your key.`)}
                      </p>
                    </div>

                    <div className="p-2.5 rounded-xl bg-white/80 dark:bg-slate-900/70 border border-amber-200/70 dark:border-amber-900/40">
                      <div className="font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1 mb-0.5">
                        <span className="w-4 h-4 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-600 flex items-center justify-center text-[10px] font-black">2</span>
                        <span>{tr(language, 'Clé déjà reçue (Facture/Devis)', 'Key already received (Invoice/Quote)')}</span>
                      </div>
                      <p className="text-[10.5px] text-slate-600 dark:text-slate-300 leading-relaxed">
                        {tr(language, 'Si vous possédez déjà une clé (ex: TOT-STOCK-PRO-...), collez-la dans le formulaire ci-dessous et cliquez sur "Appliquer".', 'If you already have a key (e.g. TOT-STOCK-PRO-...), paste it into the form below and click "Apply".')}
                      </p>
                    </div>

                    <div className="p-2.5 rounded-xl bg-white/80 dark:bg-slate-900/70 border border-amber-200/70 dark:border-amber-900/40">
                      <div className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mb-0.5">
                        <span className="w-4 h-4 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 flex items-center justify-center text-[10px] font-black">3</span>
                        <span>{tr(language, 'Essai Démo gratuit', 'Free Demo Trial')}</span>
                      </div>
                      <p className="text-[10.5px] text-slate-600 dark:text-slate-300 leading-relaxed">
                        {tr(language, 'Testez gratuitement n\'importe quel palier sans carte bancaire en cliquant sur "⚡ Tester Démo" sur la formule de votre choix.', 'Test any tier for free without a credit card by clicking "⚡ Test Demo" on your chosen plan.')}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="font-black text-slate-800 dark:text-slate-200 text-xs flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-orange-500" />
                    {tr(language, 'Forfaits, Tarifs & Souscription', 'Plans, Pricing & Subscription')}
                  </span>
                  <span className="text-[10px] text-slate-400 font-medium">
                    {tr(language, 'Mise à niveau instantanée sans interruption', 'Instant upgrade without interruption')}
                  </span>
                </div>

                {/* ROI & Professional Value Proposition Banner */}
                <div className="p-3 rounded-2xl bg-amber-500/10 dark:bg-amber-950/30 border border-amber-300/80 dark:border-amber-800/80 flex items-start gap-2.5 text-xs text-amber-950 dark:text-amber-200">
                  <span className="text-base leading-none shrink-0">🛡️</span>
                  <div className="space-y-0.5">
                    <p className="font-extrabold text-[11px] text-amber-900 dark:text-amber-100">
                      {tr(language, 'Rentabilisé dès le 1er outil sauvegardé', 'Pays for itself with the first saved tool')}
                    </p>
                    <p className="text-[10px] text-amber-800/90 dark:text-amber-300/90 leading-relaxed">
                      {tr(language, 'Pour une entreprise du bâtiment, la perte ou le vol d’un seul perforateur ou laser (700€+) dépasse largement le coût de l’abonnement annuel. Vos données restent dans votre propre cloud Supabase (BYOD).', 'For a contractor or SME, avoiding the loss of a single rotary hammer or laser tool (€700+) outweighs the yearly subscription cost. Zero vendor lock-in with your private Supabase cloud (BYOD).')}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {/* FREE */}
                  <div
                    className={`p-3 rounded-2xl border transition-all text-left relative flex flex-col justify-between ${
                      (license?.plan_type || 'free') === 'free'
                        ? 'bg-slate-100 dark:bg-slate-800 border-slate-400 dark:border-slate-500 ring-2 ring-slate-400/40'
                        : 'bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                          {PLAN_LABELS.free.toUpperCase()}
                        </span>
                        {(license?.plan_type || 'free') === 'free' && (
                          <span className="text-[9px] font-black text-emerald-600 dark:text-emerald-400">
                            {tr(language, 'Actif', 'Active')}
                          </span>
                        )}
                      </div>
                      <h4 className="font-extrabold text-slate-900 dark:text-white text-xs">
                        {PLAN_LABELS.free}
                      </h4>
                      <div className="text-[11px] font-black text-slate-600 dark:text-slate-300 mt-0.5">
                        0 € <span className="text-[9px] font-normal text-slate-400">{tr(language, '/ à vie', '/ lifetime')}</span>
                      </div>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                        {tr(language, '50 références • 1 dépôt • Scan QR', '50 items • 1 depot • QR Scan')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveLicense}
                      disabled={(license?.plan_type || 'free') === 'free'}
                      className={`mt-3 w-full py-1.5 rounded-xl text-[10px] font-bold transition cursor-pointer ${
                        (license?.plan_type || 'free') === 'free'
                          ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-default'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-300'
                      }`}
                    >
                      {(license?.plan_type || 'free') === 'free'
                        ? (tr(language, `✓ Forfait ${PLAN_LABELS.free} Actif`, `✓ ${PLAN_LABELS.free} Plan Active`))
                        : (tr(language, `Revenir à ${PLAN_LABELS.free}`, `Revert to ${PLAN_LABELS.free}`))}
                    </button>
                  </div>

                  {/* STA */}
                  <div
                    className={`p-3 rounded-2xl border transition-all text-left relative flex flex-col justify-between ${
                      license?.plan_type === 'sta'
                        ? 'bg-blue-50/70 dark:bg-blue-950/40 border-blue-500 ring-2 ring-blue-500/40'
                        : 'bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:border-blue-300'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                          {PLAN_LABELS.sta}
                        </span>
                        {license?.plan_type === 'sta' && (
                          <span className="text-[9px] font-black text-blue-600 dark:text-blue-400">
                            {tr(language, 'Actif', 'Active')}
                          </span>
                        )}
                      </div>
                      <h4 className="font-extrabold text-slate-900 dark:text-white text-xs">
                        {PLAN_LABELS.sta}
                      </h4>
                      <div className="text-[11px] font-black text-blue-600 dark:text-blue-400 mt-0.5">
                        {tr(language, '39 € HT / mois (ou 390€/an)', '€39 excl. VAT / mo (or €390/yr)')}
                      </div>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                        {tr(language, '300 références • 3 dépôts/camions • Module Stock', '300 items • 3 depots/vans • Stock Module')}
                      </p>
                    </div>

                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => handleOpenSubscription('sta')}
                        className={`w-full py-2 rounded-xl text-[10px] font-black transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs ${
                          license?.plan_type === 'sta'
                            ? 'bg-blue-700 text-white ring-2 ring-blue-400'
                            : 'bg-blue-600 hover:bg-blue-700 text-white'
                        }`}
                      >
                        <CreditCard className="w-3.5 h-3.5" />
                        <span>
                          {license?.plan_type === 'sta'
                            ? (tr(language, `✓ Forfait ${PLAN_LABELS.sta} Actif`, `✓ ${PLAN_LABELS.sta} Plan Active`))
                            : (tr(language, `Souscrire / Devis ${PLAN_LABELS.sta}`, `Subscribe / ${PLAN_LABELS.sta} Quote`))}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* PRO */}
                  <div
                    className={`p-3 rounded-2xl border transition-all text-left relative flex flex-col justify-between ${
                      license?.plan_type === 'pro'
                        ? 'bg-orange-50/70 dark:bg-orange-950/40 border-orange-500 ring-2 ring-orange-500/40'
                        : 'bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:border-orange-300'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800">
                          {PLAN_LABELS.pro}
                        </span>
                        <span className="text-[8px] font-black uppercase text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/80">
                          {tr(language, 'Recommandé', 'Recommended')}
                        </span>
                      </div>
                      <h4 className="font-extrabold text-slate-900 dark:text-white text-xs">
                        {PLAN_LABELS.pro}
                      </h4>
                      <div className="text-[11px] font-black text-orange-600 dark:text-orange-400 mt-0.5">
                        {tr(language, '89 € HT / mois (ou 890€/an)', '€89 excl. VAT / mo (or €890/yr)')}
                      </div>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                        {tr(language, '1 000 références • 10 dépôts/chantiers • Stock, Outils & Rapports', '1,000 items • 10 depots/sites • Stock, Tools & Reports')}
                      </p>
                    </div>

                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => handleOpenSubscription('pro')}
                        className={`w-full py-2 rounded-xl text-[10px] font-black transition flex items-center justify-center gap-1.5 cursor-pointer shadow-md ${
                          license?.plan_type === 'pro'
                            ? 'bg-orange-700 text-white ring-2 ring-orange-400'
                            : 'bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white shadow-orange-500/20'
                        }`}
                      >
                        <CreditCard className="w-3.5 h-3.5" />
                        <span>
                          {license?.plan_type === 'pro'
                            ? (tr(language, `✓ Forfait ${PLAN_LABELS.pro} Actif`, `✓ ${PLAN_LABELS.pro} Plan Active`))
                            : (tr(language, `Souscrire / Devis ${PLAN_LABELS.pro}`, `Subscribe / ${PLAN_LABELS.pro} Quote`))}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* ENT */}
                  <div
                    className={`p-3 rounded-2xl border transition-all text-left relative flex flex-col justify-between ${
                      license?.plan_type === 'ent'
                        ? 'bg-purple-50/70 dark:bg-purple-950/40 border-purple-500 ring-2 ring-purple-500/40'
                        : 'bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:border-purple-300'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                          {PLAN_LABELS.ent}
                        </span>
                        {license?.plan_type === 'ent' && (
                          <span className="text-[9px] font-black text-purple-600 dark:text-purple-400">
                            {tr(language, 'Actif', 'Active')}
                          </span>
                        )}
                      </div>
                      <h4 className="font-extrabold text-slate-900 dark:text-white text-xs">
                        {PLAN_LABELS.ent}
                      </h4>
                      <div className="text-[11px] font-black text-purple-600 dark:text-purple-400 mt-0.5">
                        {tr(language, '199 € HT / mois (ou 1 990€/an)', '€199 excl. VAT / mo (or €1,990/yr)')}
                      </div>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                        {tr(language, 'Illimité • Dépôts illimités • Tous modules • Support', 'Unlimited • Unlimited Sites • All Modules • Support')}
                      </p>
                    </div>

                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => handleOpenSubscription('ent')}
                        className={`w-full py-2 rounded-xl text-[10px] font-black transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs ${
                          license?.plan_type === 'ent'
                            ? 'bg-purple-800 text-white ring-2 ring-purple-400'
                            : 'bg-purple-600 hover:bg-purple-700 text-white'
                        }`}
                      >
                        <CreditCard className="w-3.5 h-3.5" />
                        <span>
                          {license?.plan_type === 'ent'
                            ? (tr(language, `✓ Forfait ${PLAN_LABELS.ent} Actif`, `✓ ${PLAN_LABELS.ent} Plan Active`))
                            : (tr(language, `Souscrire / Devis ${PLAN_LABELS.ent}`, `Subscribe / ${PLAN_LABELS.ent} Quote`))}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Enter or Update License Form */}
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-orange-500" />
                    <h3 className="font-black text-slate-900 dark:text-white text-xs">
                      {tr(language, 'Saisir ou actualiser une clé de licence', 'Enter or update a license key')}
                    </h3>
                  </div>

                  {license?.license_key && (
                    <button
                      type="button"
                      onClick={() => handleVerifyLicense(license.license_key)}
                      disabled={isCheckingLicense}
                      className="text-[11px] font-bold text-orange-600 dark:text-orange-400 hover:underline flex items-center gap-1 cursor-pointer"
                      title={tr(language, "Vérifier si un paiement a mis à niveau votre licence sur le serveur", "Check if payment upgraded your license on server")}
                    >
                      <RefreshCw className={`w-3 h-3 ${isCheckingLicense ? 'animate-spin' : ''}`} />
                      <span>{tr(language, 'Synchroniser serveur', 'Sync with server')}</span>
                    </button>
                  )}
                </div>

                <div>
                  <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                    {tr(language, 'Clé de licence client', 'Client license key')}
                  </label>
                  <input
                    type="text"
                    value={licenseInput}
                    onChange={(e) => setLicenseInput(e.target.value.toUpperCase())}
                    placeholder={license?.license_key || 'TOT-STOCK-FREE-2F28C766-A99D1072'}
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none font-mono font-bold text-xs text-slate-900 dark:text-white tracking-wider"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    {tr(language, 'Format : TOT-STOCK-FREE-2F28C766-A99D1072 (ou STA, PRO, ENT selon la formule).', 'Format: TOT-STOCK-FREE-2F28C766-A99D1072 (or STA, PRO, ENT depending on tier).')}
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleVerifyLicense()}
                    disabled={isCheckingLicense || !licenseInput.trim()}
                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-black text-xs flex items-center justify-center gap-2 shadow-md shadow-orange-500/20 active:scale-95 transition disabled:opacity-50 cursor-pointer"
                  >
                    {isCheckingLicense ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>{tr(language, 'Vérification...', 'Verifying...')}</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        <span>{tr(language, 'Appliquer cette clé', 'Apply this key')}</span>
                      </>
                    )}
                  </button>

                  {license?.license_key && (
                    <button
                      type="button"
                      onClick={handleRemoveLicense}
                      className="py-2.5 px-3 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 font-bold text-xs transition cursor-pointer"
                      title={tr(language, "Dissocier la licence actuelle", "Unlink current license")}
                    >
                      {tr(language, 'Dissocier', 'Unlink')}
                    </button>
                  )}
                </div>

                <div className="pt-1 border-t border-slate-100 dark:border-slate-700/60">
                  <button
                    type="button"
                    onClick={handleDiscoverLicenseAutomatically}
                    disabled={isCheckingLicense}
                    className="w-full py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 font-bold text-xs flex items-center justify-center gap-2 transition disabled:opacity-50 cursor-pointer"
                  >
                    <Sparkles className={`w-3.5 h-3.5 text-orange-500 ${isCheckingLicense ? 'animate-spin' : ''}`} />
                    <span>{t('license_discover_btn')}</span>
                  </button>
                </div>
              </div>

              {/* Informative Security Card */}
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
                <div className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <span>🛡️</span> {tr(language, 'Sécurité & Résilience Hors-ligne', 'Security & Offline Resilience')}
                </div>
                <p>
                  {tr(language, "Les licences sont vérifiées de manière sécurisée auprès du serveur central d'authentification. En cas d'intervention en sous-sol ou zone blanche, une tolérance hors-ligne de 30 jours garantit le fonctionnement ininterrompu de l'inventaire pour vos équipes sur le terrain.", 'Licenses are securely verified against the central authentication server. When working underground or in dead zones, 30-day offline tolerance ensures uninterrupted inventory operations for field teams.')}
                </p>
              </div>
            </div>
          )}

          {/* ======================= TAB 2: BASE SUPABASE BYOD ======================= */}
          {activeTab === 'db' && canDb && (
            <div className="space-y-3 animate-fadeIn">
              
              {/* Live Connection Status Banner */}
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-bold text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {tr(language, 'État actuel de la connexion', 'Current connection status')}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {supabaseSyncStatus === 'connected' && (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        {tr(language, 'Connecté', 'Connected')}
                      </span>
                    )}
                    {supabaseSyncStatus === 'syncing' && (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-800 flex items-center gap-1">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        {tr(language, 'Synchronisation...', 'Syncing...')}
                      </span>
                    )}
                    {supabaseSyncStatus === 'error' && (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-400 border border-rose-300 dark:border-rose-800 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {tr(language, 'Erreur de connexion', 'Connection error')}
                      </span>
                    )}
                    {supabaseSyncStatus === 'idle' && (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center gap-1">
                        <Radio className="w-3 h-3" />
                        {tr(language, 'Stockage local', 'Local storage')}
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-[12px] font-medium text-slate-700 dark:text-slate-200">
                  {supabaseSyncMessage || (supabaseConfig?.url
                    ? (tr(language, 'Connecté à Supabase', 'Connected to Supabase'))
                    : (tr(language, 'Aucune base configurée (stockage local navigateur).', 'No database configured (browser local storage).')))}
                </p>

                {supabaseConfig?.url && (
                  <div className="mt-2.5 pt-2 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleForceSync}
                      disabled={isSyncing}
                      className="flex-1 py-1.5 px-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 font-bold text-[11px] flex items-center justify-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                      <span>{tr(language, 'Recharger depuis Supabase', 'Reload from Supabase')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleExportToSupabase}
                      disabled={isExporting}
                      title={tr(language, "Exporter les produits et utilisateurs locaux vers votre Supabase", "Export local products and users to your Supabase")}
                      className="py-1.5 px-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 font-bold text-[11px] flex items-center justify-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
                    >
                      <UploadCloud className="w-3.5 h-3.5" />
                      <span>{tr(language, 'Exporter vers Supabase', 'Export to Supabase')}</span>
                    </button>
                  </div>
                )}
              </div>

              {statusMsg && (
                <div
                  className={`p-3 rounded-2xl border text-xs font-bold flex items-start gap-2 ${
                    statusMsg.type === 'success'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
                      : statusMsg.type === 'error'
                      ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400'
                      : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400'
                  }`}
                >
                  {statusMsg.type === 'success' ? (
                    <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <span>{statusMsg.text}</span>
                </div>
              )}

              {/* Quick QR Scan Option */}
              <div>
                <button
                  onClick={handleScanQR}
                  className="w-full py-2.5 px-4 rounded-2xl bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-black text-xs flex items-center justify-center gap-2 shadow-md shadow-orange-500/20 active:scale-95 transition cursor-pointer"
                >
                  <QrCode className="w-4 h-4" />
                  <span>{tr(language, 'Scanner le QR Code Configuration Entreprise', 'Scan Company Configuration QR Code')}</span>
                </button>
                <p className="text-[11px] text-center text-slate-400 mt-1">
                  {tr(language, "Permet de configurer instantanément l'appli sans copier/coller d'URL", 'Instantly configure the app without manual copy/pasting')}
                </p>
              </div>

              <div className="relative flex py-1 items-center">
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
                <span className="flex-shrink mx-2 text-[10px] text-slate-400 font-bold uppercase">
                  {tr(language, 'Configuration manuelle', 'Manual configuration')}
                </span>
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
              </div>

              {/* Manual Form */}
              <form onSubmit={handleSave} className="space-y-3">
                <div>
                  <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                    {tr(language, "Nom de l'organisation / Entreprise", 'Organization / Company Name')}
                  </label>
                  <div className="relative">
                    <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="text"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      placeholder={tr(language, "ex: BTP Martin & Fils, SARL Entreprise", "e.g. Acme Corp Ltd")}
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-xs text-slate-900 dark:text-white font-bold"
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {tr(language, 'Génère ou associe automatiquement la licence officielle serveur liée à cette entreprise.', 'Automatically generates or associates the official server license linked to this company.')}
                  </p>
                </div>

                <div>
                  <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                    Supabase Project URL
                  </label>
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://xyzcompany.supabase.co"
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none font-mono text-[11px] text-slate-900 dark:text-white"
                  />
                  {url && (url.includes('/dashboard/project/') || url.includes('@db.')) && (
                    <div className="mt-1 flex items-center justify-between text-[11px] p-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-900/40">
                      <span>{tr(language, '💡 Format Dashboard détecté : Cliquez pour convertir en URL API.', '💡 Dashboard URL detected: Click to convert to API URL.')}</span>
                      <button
                        type="button"
                        onClick={() => setUrl(normalizeSupabaseUrl(url))}
                        className="px-2 py-0.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-[10px] cursor-pointer"
                      >
                        {tr(language, 'Convertir', 'Convert')}
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block font-bold text-slate-600 dark:text-slate-300">
                      Supabase Anon / Publishable Key
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="text-[11px] font-bold text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 flex items-center gap-1 transition cursor-pointer"
                      title={showKey ? (tr(language, "Masquer la clé", "Hide key")) : (tr(language, "Afficher la clé", "Show key"))}
                    >
                      {showKey ? (
                        <>
                          <EyeOff className="w-3.5 h-3.5" />
                          <span>{tr(language, 'Masquer', 'Hide')}</span>
                        </>
                      ) : (
                        <>
                          <Eye className="w-3.5 h-3.5" />
                          <span>{tr(language, 'Afficher la clé', 'Show key')}</span>
                        </>
                      )}
                    </button>
                  </div>
                  <div className="relative">
                    {showKey ? (
                      <textarea
                        rows={3}
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                        placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                        className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none font-mono text-[10px] resize-none text-slate-900 dark:text-white"
                      />
                    ) : (
                      <input
                        type="password"
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                        placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                        className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none font-mono text-[11px] text-slate-900 dark:text-white"
                      />
                    )}
                  </div>
                  {!showKey && key && (
                    <p className="text-[10px] text-slate-400 mt-0.5 italic">
                      {tr(language, '🔒 Clé masquée pour protéger vos accès confidentiels.', '🔒 Key hidden to protect your confidential access.')}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleTest}
                    disabled={isTesting}
                    className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-bold text-xs flex items-center justify-center gap-1.5 transition border border-slate-300 dark:border-slate-700 cursor-pointer"
                  >
                    <Server className="w-3.5 h-3.5" />
                    <span>
                      {isTesting
                        ? (tr(language, 'Test en cours...', 'Testing...'))
                        : (tr(language, 'Tester la connexion', 'Test connection'))}
                    </span>
                  </button>

                  <button
                    type="submit"
                    onClick={handleSave}
                    disabled={isSyncing}
                    className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition shadow cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    <span>
                      {isSyncing
                        ? (tr(language, 'Liaison...', 'Linking...'))
                        : (tr(language, 'Enregistrer & Lier', 'Save & Link'))}
                    </span>
                  </button>
                </div>

                {/* Test Diagnostics output */}
                {testResult && (
                  <div className="mt-2 p-3 rounded-2xl bg-slate-100 dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[11px]">
                        {tr(language, 'Rapport de test de la base :', 'Database test report:')}
                      </span>
                      <span
                        className={`font-black text-[10px] px-2 py-0.5 rounded-full ${
                          testResult.success
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                        }`}
                      >
                        {testResult.success
                          ? (tr(language, 'Serveur accessible', 'Server reachable'))
                          : (tr(language, 'Erreur', 'Error'))}
                      </span>
                    </div>

                    {testResult.tables && (
                      <div className="grid grid-cols-2 gap-1.5 pt-1 text-[11px]">
                        {Object.entries(testResult.tables).map(([table, count]) => (
                          <div
                            key={table}
                            className="px-2 py-1 rounded-lg flex items-center justify-between border bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"
                          >
                            <span className="font-mono">{table}</span>
                            <span className="font-bold">{count ?? 0}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Information Table Client Magasins / Dépôts */}
                <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 space-y-2 text-[11px]">
                  <div className="flex items-center justify-between font-bold text-amber-800 dark:text-amber-200">
                    <span className="flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-amber-600" />
                      {tr(language, 'Table client pour "Magasin / Dépôt" :', 'Client table for "Store / Depot":')} <code className="font-mono text-xs bg-amber-100 dark:bg-amber-900/60 px-1.5 py-0.5 rounded">public.depots</code>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopySql(SQL_CREATE_DEPOTS_TABLE, 'byod_depots')}
                      className="px-2 py-0.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-[10px] flex items-center gap-1 cursor-pointer transition shadow-xs"
                    >
                      <Copy className="w-3 h-3" />
                      <span>{copiedSql === 'byod_depots' ? (tr(language, 'Copié !', 'Copied!')) : (tr(language, 'Copier SQL (public.depots)', 'Copy SQL (public.depots)'))}</span>
                    </button>
                  </div>
                  <p className="text-slate-600 dark:text-slate-300 text-[10.5px] leading-relaxed">
                    {tr(language, `Pour synchroniser vos magasins et dépôts dans votre base Supabase, la table dédiée est public.depots (ou alternativement warehouses ou magasins). Le quota s'applique automatiquement selon votre formule : 1 dépôt (${PLAN_LABELS.free}), 3 dépôts (${PLAN_LABELS.sta}), 10 dépôts (${PLAN_LABELS.pro}) ou Illimité (${PLAN_LABELS.ent}).`, `To synchronize your stores and depots in your Supabase database, the dedicated table is public.depots (or warehouses/magasins). The quota automatically applies based on your tier: 1 depot (${PLAN_LABELS.free}), 3 depots (${PLAN_LABELS.sta}), 10 depots (${PLAN_LABELS.pro}) or Unlimited (${PLAN_LABELS.ent}).`)}
                  </p>
                </div>

                {/* MENTION BASE ANCIENNE (v41) */}
                <div className="p-3 rounded-2xl bg-amber-950/60 border border-amber-500/40 text-amber-100 text-[11px] font-bold flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <span>{t('sql_legacy_db_auto_fix_notice')}</span>
                </div>

                {/* SCRIPT 01 : AUTH LINK */}
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-purple-950 via-slate-900 to-indigo-950 text-white border border-purple-500/40 space-y-2.5 shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-purple-400" />
                      <span className="font-black text-xs text-purple-200">
                        {tr(language, '🔐 Script 01 : Supabase Auth Link (01_auth_link.sql)', '🔐 Script 01: Supabase Auth Link (01_auth_link.sql)')}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-900/60 border border-purple-600 text-purple-300 font-bold">
                      Auth & Sécurité
                    </span>
                  </div>

                  <p className="text-[11px] text-purple-100/90 leading-relaxed">
                    {tr(language, 'Liaison stricte entre auth.users et public.users via auth_user_id, trigger automatique de création de profil, et suppression définitive des colonnes de PIN côté base de données.', 'Strict link between auth.users and public.users via auth_user_id, automatic profile trigger, and permanent removal of database PIN columns.')}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleCopySql(SQL_SCRIPT_01_AUTH_LINK, 'script_01')}
                      className="flex-1 py-1.5 px-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs active:scale-95"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copiedSql === 'script_01' ? (tr(language, 'Script 01 Copié !', 'Script 01 Copied!')) : (tr(language, 'Copier le script 01_auth_link.sql', 'Copy 01_auth_link.sql'))}</span>
                    </button>
                  </div>
                </div>

                {/* SCRIPT 02 : RLS HARDENING */}
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-blue-950 via-slate-900 to-cyan-950 text-white border border-cyan-500/40 space-y-2.5 shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-cyan-400" />
                      <span className="font-black text-xs text-cyan-200">
                        {tr(language, '🛡️ Script 02 : Durcissement RLS & Sécurité (02_rls_hardening.sql)', '🛡️ Script 02: Strict RLS Hardening (02_rls_hardening.sql)')}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950 border border-cyan-600 text-cyan-300 font-bold">
                      Fermeture Anon
                    </span>
                  </div>

                  <p className="text-[11px] text-cyan-100/90 leading-relaxed">
                    {tr(language, 'Alignement automatique des colonnes manquantes sur les bases anciennes, purge des anciennes règles RLS permissives, blocage total de "anon", lecture seule de license_config et isolation des rôles.', 'Automatic missing column alignment on legacy databases, purge of permissive RLS policies, total block of "anon", read-only license_config and role isolation.')}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleCopySql(SQL_SCRIPT_02_RLS_HARDENING, 'script_02')}
                      className="flex-1 py-1.5 px-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs active:scale-95"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copiedSql === 'script_02' ? (tr(language, 'Script 02 Copié !', 'Script 02 Copied!')) : (tr(language, 'Copier le script 02_rls_hardening.sql', 'Copy 02_rls_hardening.sql'))}</span>
                    </button>
                  </div>
                </div>

                {/* SCRIPT 03 : RPC STOCK & COMMANDES */}
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-indigo-950 via-slate-900 to-violet-950 text-white border border-indigo-500/40 space-y-2.5 shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-indigo-400" />
                      <span className="font-black text-xs text-indigo-200">
                        {tr(language, '⚡ Script 03 : RPC Stock & Commandes (03_rpc_stock_and_orders.sql)', '⚡ Script 03: Stock & Orders RPC (03_rpc_stock_and_orders.sql)')}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950 border border-indigo-600 text-indigo-300 font-bold">
                      Atomicité & Quotas
                    </span>
                  </div>

                  <p className="text-[11px] text-indigo-100/90 leading-relaxed">
                    {tr(language, 'Purge des déclencheurs hérités qui comptaient les mouvements en double, conversion automatique des identifiants numériques (bigint -> text), process_stock_movement (verrouillage FOR UPDATE, idempotence operation_id) et transition_order_status.', 'Purge of legacy double-counting triggers, automatic numeric ID conversion (bigint -> text), process_stock_movement (FOR UPDATE locking, operation_id idempotency) and transition_order_status.')}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleCopySql(SQL_SCRIPT_03_RPC_STOCK_AND_ORDERS, 'script_03')}
                      className="flex-1 py-1.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs active:scale-95"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copiedSql === 'script_03' ? (tr(language, 'Script 03 Copié !', 'Script 03 Copied!')) : (tr(language, 'Copier le script 03_rpc_stock_and_orders.sql', 'Copy 03_rpc_stock_and_orders.sql'))}</span>
                    </button>
                  </div>
                </div>

                {/* SCRIPT 04 : MOUVEMENTS ET DÉPÔTS VÉHICULES */}
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-emerald-950 via-slate-900 to-teal-950 text-white border border-emerald-500/40 space-y-2.5 shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-emerald-400" />
                      <span className="font-black text-xs text-emerald-200">
                        {tr(language, '🚚 Script 04 : Dépôts Véhicules & Stock Dédié (04_mouvements_et_depots_vehicules.sql)', '🚚 Script 04: Vehicle Depots & Dedicated Stock (04_mouvements_et_depots_vehicules.sql)')}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 border border-emerald-600 text-emerald-300 font-bold">
                      Multi-Dépôts V4
                    </span>
                  </div>

                  <p className="text-[11px] text-emerald-100/90 leading-relaxed">
                    {tr(language, 'Niveaux de stock par dépôt physique (public.stock_levels), gestion des véhicules d\'intervention, transferts atomiques inter-dépôts (sans altérer store_name de référence) et contrôle d\'accès allowed_depots.', 'Stock levels per physical depot (public.stock_levels), service vehicle tracking, atomic inter-depot transfers (without changing catalog store_name) and allowed_depots access control.')}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleCopySql(SQL_SCRIPT_04_DEPOTS_VEHICULES, 'script_04')}
                      className="flex-1 py-1.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs active:scale-95"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copiedSql === 'script_04' ? (tr(language, 'Script 04 Copié !', 'Script 04 Copied!')) : (tr(language, 'Copier le script 04_mouvements_et_depots_vehicules.sql', 'Copy 04_mouvements_et_depots_vehicules.sql'))}</span>
                    </button>
                  </div>
                </div>

                {/* SCRIPT 05 : RPC GESTION UTILISATEURS */}
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-violet-950 via-slate-900 to-fuchsia-950 text-white border border-fuchsia-500/40 space-y-2.5 shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-fuchsia-400" />
                      <span className="font-black text-xs text-fuchsia-200">
                        {tr(language, '👥 Script 05 : Profils & Visibilité (05_rpc_admin_users.sql)', '👥 Script 05: Profiles & Visibility (05_rpc_admin_users.sql)')}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-fuchsia-950 border border-fuchsia-600 text-fuchsia-300 font-bold">
                      {tr(language, 'Sécurité', 'Security')}
                    </span>
                  </div>

                  <p className="text-[11px] text-fuchsia-100/90 leading-relaxed">
                    {tr(language, 'Liaison sécurisée de profil (get_or_link_my_profile sans auto-création incontrôlée), visibilité inter-départements et suppression propre de la RPC obsolète admin_manage_user.', 'Secure profile linking (get_or_link_my_profile without uncontrolled creation), inter-department visibility and cleanup of deprecated admin_manage_user RPC.')}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleCopySql(SQL_SCRIPT_05_RPC_ADMIN_USERS, 'script_05')}
                      className="flex-1 py-1.5 px-3 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs active:scale-95"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copiedSql === 'script_05' ? (tr(language, 'Script 05 Copié !', 'Script 05 Copied!')) : (tr(language, 'Copier le script 05_rpc_admin_users.sql', 'Copy 05_rpc_admin_users.sql'))}</span>
                    </button>
                  </div>
                </div>

                {/* CARTE SCRIPT 06 : INSTALLATION DES 6 NOUVEAUX RÔLES */}
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-emerald-950 via-teal-900 to-slate-900 text-white border border-emerald-500/40 space-y-2.5 shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <span className="font-black text-xs text-emerald-200">
                        {tr(language, '🛡️ Script 06 : Installation Nouveaux Rôles (06_install_additional_roles.sql)', '🛡️ Script 06: Install Additional Roles (06_install_additional_roles.sql)')}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 border border-emerald-600 text-emerald-300 font-bold">
                      Idempotent
                    </span>
                  </div>

                  <p className="text-[11px] text-emerald-100/90 leading-relaxed">
                    {tr(language, 'Installe les 6 rôles additionnels (IT 5, Logistique 6, Magasin 7, Département 8, Intérimaire 9, Consultation 10) sans modifier les rôles historiques 0 à 4 ni le role_id des utilisateurs existants.', 'Installs the 6 additional roles (IT 5, Logistics 6, Store 7, Department 8, Temp 9, Read-only 10) without modifying existing roles 0-4 or existing user role_ids.')}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleCopySql(SQL_SCRIPT_06_INSTALL_ADDITIONAL_ROLES, 'script_06')}
                      className="flex-1 py-1.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs active:scale-95"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copiedSql === 'script_06' ? (tr(language, 'Script 06 Copié !', 'Script 06 Copied!')) : (tr(language, 'Copier le script 06_install_additional_roles.sql', 'Copy 06_install_additional_roles.sql'))}</span>
                    </button>
                  </div>
                </div>

                {/* CARTE SCRIPT 08 : IMPRESSION D'ÉTIQUETTES À DISTANCE */}
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-orange-950 via-slate-900 to-amber-950 text-white border border-orange-500/40 space-y-2.5 shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Printer className="w-4 h-4 text-orange-400" />
                      <span className="font-black text-xs text-orange-200">
                        {t('sql_script_08_title')}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-orange-950 border border-orange-600 text-orange-300 font-bold">
                      {t('sql_script_08_badge')}
                    </span>
                  </div>

                  <p className="text-[11px] text-orange-100/90 leading-relaxed">
                    {t('sql_script_08_desc')}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleCopySql(SQL_SCRIPT_08_PRINT_JOBS, 'script_08')}
                      className="flex-1 py-1.5 px-3 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs active:scale-95"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copiedSql === 'script_08' ? t('sql_script_08_copied_btn') : t('sql_script_08_copy_btn')}</span>
                    </button>
                  </div>
                </div>

                {/* CARTE SCRIPT 11 : TABLES DE LA SUITE TOT ET FICHIERS */}
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-indigo-950 via-slate-900 to-violet-950 text-white border border-indigo-500/40 space-y-2.5 shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Database className="w-4 h-4 text-indigo-400" />
                      <span className="font-black text-xs text-indigo-200">
                        {t('sql_script_11_title')}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950 border border-indigo-600 text-indigo-300 font-bold">
                      {t('sql_script_11_badge')}
                    </span>
                  </div>

                  <p className="text-[11px] text-indigo-100/90 leading-relaxed">
                    {t('sql_script_11_desc')}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleCopySql(SQL_SCRIPT_11_SUITE_TABLES, 'script_11')}
                      className="flex-1 py-1.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs active:scale-95"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copiedSql === 'script_11' ? t('sql_script_11_copied_btn') : t('sql_script_11_copy_btn')}</span>
                    </button>
                  </div>
                </div>

                {/* CARTE SCRIPT 12 : PRÉFÉRENCES UTILISATEUR (core_user_preferences) */}
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-violet-950 via-slate-900 to-fuchsia-950 text-white border border-violet-500/40 space-y-2.5 shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Database className="w-4 h-4 text-violet-400" />
                      <span className="font-black text-xs text-violet-200">
                        {t('sql_script_12_title')}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-violet-950 border border-violet-600 text-violet-300 font-bold">
                      {t('sql_script_12_badge')}
                    </span>
                  </div>

                  <p className="text-[11px] text-violet-100/90 leading-relaxed">
                    {t('sql_script_12_desc')}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleCopySql(SQL_SCRIPT_12_USER_PREFERENCES, 'script_12')}
                      className="flex-1 py-1.5 px-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs active:scale-95"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copiedSql === 'script_12' ? t('sql_script_12_copied_btn') : t('sql_script_12_copy_btn')}</span>
                    </button>
                  </div>
                </div>

                {/* CARTE SCRIPT 13 : TRANSFERT DE MATÉRIEL ENTRE DÉPÔTS PAR LOT (transfer_stock_batch) */}
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-indigo-950 via-slate-900 to-cyan-950 text-white border border-indigo-500/40 space-y-2.5 shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Database className="w-4 h-4 text-indigo-400" />
                      <span className="font-black text-xs text-indigo-200">
                        {t('sql_script_13_title')}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950 border border-indigo-600 text-indigo-300 font-bold">
                      {t('sql_script_13_badge')}
                    </span>
                  </div>

                  <p className="text-[11px] text-indigo-100/90 leading-relaxed">
                    {t('sql_script_13_desc')}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleCopySql(SQL_SCRIPT_13_TRANSFER_STOCK_BATCH, 'script_13')}
                      className="flex-1 py-1.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs active:scale-95"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copiedSql === 'script_13' ? t('sql_script_13_copied_btn') : t('sql_script_13_copy_btn')}</span>
                    </button>
                  </div>
                </div>

                {/* CARTE SCRIPT 14 : MAILING MULTI-FOURNISSEURS & EXPÉDITEURS PAR APPLICATION */}
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-emerald-950 via-slate-900 to-teal-950 text-white border border-emerald-500/40 space-y-2.5 shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Database className="w-4 h-4 text-emerald-400" />
                      <span className="font-black text-xs text-emerald-200">
                        {t('sql_script_14_title')}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 border border-emerald-600 text-emerald-300 font-bold">
                      {t('sql_script_14_badge')}
                    </span>
                  </div>

                  <p className="text-[11px] text-emerald-100/90 leading-relaxed">
                    {t('sql_script_14_desc')}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleCopySql(SQL_SCRIPT_14_MAILING, 'script_14')}
                      className="flex-1 py-1.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs active:scale-95"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copiedSql === 'script_14' ? t('sql_script_14_copied_btn') : t('sql_script_14_copy_btn')}</span>
                    </button>
                  </div>
                </div>

                {/* CARTE SCRIPT 15 : RECHERCHE SERVEUR COMMANDES & MOUVEMENTS */}
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-indigo-950 via-slate-900 to-violet-950 text-white border border-indigo-500/40 space-y-2.5 shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Database className="w-4 h-4 text-indigo-400" />
                      <span className="font-black text-xs text-indigo-200">
                        {t('sql_script_15_title')}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950 border border-indigo-600 text-indigo-300 font-bold">
                      {t('sql_script_15_badge')}
                    </span>
                  </div>

                  <p className="text-[11px] text-indigo-100/90 leading-relaxed">
                    {t('sql_script_15_desc')}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleCopySql(SQL_SCRIPT_15_SEARCH_ORDERS_MOVEMENTS, 'script_15')}
                      className="flex-1 py-1.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs active:scale-95"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copiedSql === 'script_15' ? t('sql_script_15_copied_btn') : t('sql_script_15_copy_btn')}</span>
                    </button>
                  </div>
                </div>

                {/* CARTE SCRIPT 16 : JOURNAL D'AUDIT SERVEUR COMPLET */}
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-orange-950 via-slate-900 to-amber-950 text-white border border-orange-500/40 space-y-2.5 shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-orange-400" />
                      <span className="font-black text-xs text-orange-200">
                        {t('sql_script_16_title')}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-orange-950 border border-orange-600 text-orange-300 font-bold">
                      {t('sql_script_16_badge')}
                    </span>
                  </div>

                  <p className="text-[11px] text-orange-100/90 leading-relaxed">
                    {t('sql_script_16_desc')}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleCopySql(SQL_SCRIPT_16_AUDIT_TRAIL, 'script_16')}
                      className="flex-1 py-1.5 px-3 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs active:scale-95"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copiedSql === 'script_16' ? t('sql_script_16_copied_btn') : t('sql_script_16_copy_btn')}</span>
                    </button>
                  </div>
                </div>

                {/* CARTE SCRIPT 07 : COMPATIBILITÉ APPLICATION & SCHÉMA */}
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-sky-950 via-slate-900 to-blue-950 text-white border border-sky-500/40 space-y-2.5 shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <BadgeCheck className="w-4 h-4 text-sky-400" />
                      <span className="font-black text-xs text-sky-200">
                        {tr(language, '🔄 Script 07 : Compatibilité App & Schéma (07_app_compat.sql)', '🔄 Script 07: App & Schema Compatibility (07_app_compat.sql)')}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-950 border border-sky-600 text-sky-300 font-bold">
                      Versionnage
                    </span>
                  </div>

                  <p className="text-[11px] text-sky-100/90 leading-relaxed">
                    {tr(language, 'Table singleton public.core_app_compat (id = 1) avec RLS activé et lecture autorisée pour anon/authenticated. Contrôle automatiquement au démarrage que la version de l\'application (Web / APK) est compatible avec min_app_version et schema_version.', 'Singleton table public.core_app_compat (id = 1) with RLS enabled and read access for anon/authenticated. Automatically verifies at startup that the app version (Web / APK) meets min_app_version and schema_version.')}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleCopySql(SQL_SCRIPT_07_APP_COMPAT, 'script_07')}
                      className="flex-1 py-1.5 px-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs active:scale-95"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copiedSql === 'script_07' ? (tr(language, 'Script 07 Copié !', 'Script 07 Copied!')) : (tr(language, 'Copier le script 07_app_compat.sql', 'Copy 07_app_compat.sql'))}</span>
                    </button>
                  </div>
                </div>

                {/* CARTE SCRIPT 09 : PRÉFIXES SUITE TOT (core_ & stk_) */}
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-teal-950 via-slate-900 to-emerald-950 text-white border border-teal-500/40 space-y-2.5 shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Database className="w-4 h-4 text-teal-400" />
                      <span className="font-black text-xs text-teal-200">
                        {t('sql_script_09_title')}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-teal-950 border border-teal-600 text-teal-300 font-bold">
                      {t('sql_script_09_badge')}
                    </span>
                  </div>

                  <p className="text-[11px] text-teal-100/90 leading-relaxed">
                    {t('sql_script_09_desc')}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleCopySql(SQL_SCRIPT_09_CORE_PREFIXES, 'script_09')}
                      className="flex-1 py-1.5 px-3 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs active:scale-95"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copiedSql === 'script_09' ? t('sql_script_09_copied_btn') : t('sql_script_09_copy_btn')}</span>
                    </button>
                  </div>
                </div>

                {/* CARTE SCRIPT 10 : SUPPRESSION DES VUES DE COMPATIBILITÉ */}
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-slate-900 via-zinc-900 to-slate-950 text-white border border-slate-600/50 space-y-2.5 shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-slate-300" />
                      <span className="font-black text-xs text-slate-200">
                        {t('sql_script_10_title')}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 border border-slate-600 text-slate-300 font-bold">
                      {t('sql_script_10_badge')}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    {t('sql_script_10_desc')}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleCopySql(SQL_SCRIPT_10_DROP_COMPAT_VIEWS, 'script_10')}
                      className="flex-1 py-1.5 px-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs active:scale-95"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copiedSql === 'script_10' ? t('sql_script_10_copied_btn') : t('sql_script_10_copy_btn')}</span>
                    </button>
                  </div>
                </div>

                {/* CARTE BASE MAÎTRE : SCHÉMA CENTRAL */}
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-amber-950 via-slate-900 to-rose-950 text-white border border-amber-500/40 space-y-2.5 shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-amber-400" />
                      <span className="font-black text-xs text-amber-200">
                        {tr(language, '🏛️ Base Maître : Schéma Licences (schema_master_licenses.sql)', '🏛️ Master Base: License Schema (schema_master_licenses.sql)')}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950 border border-amber-600 text-amber-300 font-bold">
                      Base Éditeur Uniquement
                    </span>
                  </div>

                  <p className="text-[11px] text-amber-100/90 leading-relaxed">
                    {tr(language, 'À exécuter uniquement sur la base éditeur/centrale : table "APP_TOT-Stock-licenses" avec RLS activé et zéro politique anon/authenticated (écritures et lectures exclusivement via Edge Functions avec service_role et signature Ed25519).', 'To run only on publisher/central base: "APP_TOT-Stock-licenses" with active RLS and zero anon/authenticated policies (operations strictly through Edge Functions with service_role and Ed25519 signature).')}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleCopySql(SQL_MASTER_LICENSES_SCHEMA, 'master_schema_card')}
                      className="flex-1 py-1.5 px-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs active:scale-95"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copiedSql === 'master_schema_card' ? (tr(language, 'Schéma Maître Copié !', 'Master Schema Copied!')) : (tr(language, 'Copier le Schéma Base Maître', 'Copy Master Base Schema'))}</span>
                    </button>
                  </div>
                </div>

                {/* Schéma Complet Supabase & Commandes CLI */}
                <div className="p-3.5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 text-white border border-slate-700 space-y-2.5 shadow-md">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Database className="w-4 h-4 text-emerald-400" />
                      <span className="font-black text-xs">
                        {tr(language, 'Schéma Complet Supabase (CLI & SQL)', 'Full Supabase Schema (CLI & SQL)')}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 border border-emerald-700 text-emerald-400 font-bold">
                      PostgreSQL 15+
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    {tr(language, 'Tables incluses : products, stock_movements, audit_logs (traçabilité), depots, users, roles, departments, projects, sub_categories, licenses avec RLS et indexations.', 'Included tables: products, stock_movements, audit_logs (traceability), depots, users, roles, departments, projects, sub_categories, licenses with RLS and indexes.')}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleCopySql(SQL_FULL_DATABASE_SCHEMA, 'full_schema')}
                      className="flex-1 py-1.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copiedSql === 'full_schema' ? (tr(language, 'SQL Copié !', 'SQL Copied!')) : (tr(language, 'Copier tout le Schéma SQL', 'Copy Full SQL Schema'))}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleCopySql(CLI_MIGRATION_COMMANDS, 'cli_commands')}
                      className="py-1.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                    >
                      <Terminal className="w-3.5 h-3.5 text-orange-400" />
                      <span>{copiedSql === 'cli_commands' ? (tr(language, 'CLI Copié !', 'CLI Copied!')) : (tr(language, 'Commandes CLI', 'CLI Commands'))}</span>
                    </button>
                  </div>
                </div>

                {supabaseConfig?.url && (
                  <button
                    type="button"
                    onClick={handleReset}
                    className="w-full py-2 rounded-xl text-slate-500 hover:text-rose-500 font-bold text-xs flex items-center justify-center gap-1 transition cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{tr(language, 'Revenir au stockage local hors-ligne', 'Revert to local offline storage')}</span>
                  </button>
                )}
              </form>
            </div>
          )}

          {/* ======================= TAB 3: ARCHITECTURE & SÉCURITÉ (MODÈLE B) ======================= */}
          {activeTab === 'architecture' && (
            <div className="space-y-4 animate-fadeIn">
              {/* Header Banner: Clean Separation of Responsibilities */}
              <div className="p-4 rounded-3xl bg-gradient-to-br from-purple-500/10 via-indigo-500/10 to-transparent border border-purple-200 dark:border-purple-800/60 space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-purple-600 text-white flex items-center justify-center font-black">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="font-black text-sm text-slate-950 dark:text-white">
                        {tr(language, 'Architecture Éditeur vs Client (Modèle B)', 'Publisher vs Client Architecture (Model B)')}
                      </h3>
                      <p className="text-[11px] text-purple-700 dark:text-purple-300 font-bold">
                        {tr(language, 'Séparation stricte des responsabilités & Propriété exclusive de votre base', 'Strict separation of concerns & 100% Client Data Ownership')}
                      </p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-200 border border-purple-300 dark:border-purple-800">
                    {tr(language, 'Architecture Recommandée', 'Recommended Architecture')}
                  </span>
                </div>
              </div>

              {/* Visual Schema Cards (matching the specification) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* 1. TOT STOCK / ÉDITEUR */}
                <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2.5">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                    <span className="font-extrabold text-xs text-orange-600 dark:text-orange-400 flex items-center gap-1.5">
                      <Layers className="w-4 h-4" />
                      <span>TOT STOCK / ÉDITEUR</span>
                    </span>
                    <span className="text-[10px] font-mono text-slate-400 font-bold">Serveur Central</span>
                  </div>

                  <p className="text-[11px] text-slate-600 dark:text-slate-300">
                    {tr(language, 'La base éditeur reste volontairement minimaliste et ne contient AUCUNE donnée métier du client.', 'The publisher database remains strictly minimal and NEVER contains client business data.')}
                  </p>

                  <div className="space-y-1 text-xs">
                    <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                      {tr(language, 'Données gérées :', 'Managed data:')}
                    </div>
                    <ul className="text-[11px] text-slate-500 dark:text-slate-400 space-y-0.5 list-disc list-inside">
                      <li>Licences & clés cryptographiques</li>
                      <li>Forfaits & quotas autorisés (dépôts, articles)</li>
                      <li>Validation & émission de jeton hors-ligne (+7j)</li>
                      <li>Mises à jour applicatives & branding</li>
                    </ul>
                  </div>

                  <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-[10.5px] text-rose-800 dark:text-rose-300 font-bold">
                    ⛔ {tr(language, 'Ne stocke JAMAIS : vos articles, stocks, mouvements, commandes, utilisateurs, PINs ou chantiers.', 'NEVER stores: your items, stock, movements, users or PINs.')}
                  </div>
                </div>

                {/* 2. CLIENT (SA DB SUPABASE) */}
                <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2.5">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                    <span className="font-extrabold text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                      <Database className="w-4 h-4" />
                      <span>CLIENT (SA PROPRE DB SUPABASE)</span>
                    </span>
                    <span className="text-[10px] font-mono text-slate-400 font-bold">BYOD Privé</span>
                  </div>

                  <p className="text-[11px] text-slate-600 dark:text-slate-300">
                    {tr(language, 'Le client reste 100% propriétaire de sa base de données et de ses identifiants.', 'The client remains 100% owner of their database, users, and credentials.')}
                  </p>

                  <div className="space-y-1 text-xs">
                    <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                      {tr(language, 'Données métier privées :', 'Private business data:')}
                    </div>
                    <ul className="text-[11px] text-slate-500 dark:text-slate-400 space-y-0.5 list-disc list-inside">
                      <li>Ses utilisateurs & mots de passe / PINs (PBKDF2)</li>
                      <li>Ses dépôts & magasins (table public.depots)</li>
                      <li>Ses articles & références catalogue</li>
                      <li>Ses mouvements de stock & bons de commande</li>
                      <li>Ses projets, départements & traçabilité audit</li>
                    </ul>
                  </div>

                  <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-[10.5px] text-emerald-800 dark:text-emerald-300 font-bold">
                    ✓ {tr(language, 'TOT Stock n’a pas accès à vos données. Vous gérez vos sauvegardes et vos accès.', 'TOT Stock has no access to your data. You manage your backups.')}
                  </div>
                </div>
              </div>

              {/* Active Offline License Token Card (+7 jours) */}
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-purple-600" />
                    <span className="font-black text-xs text-slate-900 dark:text-white">
                      {tr(language, 'Jeton de Licence Hors-Ligne Signé (+7 jours)', 'Signed Offline License Token (+7 days)')}
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300">
                    Ed25519
                  </span>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-300">
                  {tr(language, 'Une fois la licence vérifiée en ligne, l’application conserve une autorisation signée cryptographiquement. L’application continue ainsi à fonctionner sans connexion internet.', 'Once verified online, the app retains a cryptographically signed authorization allowing offline operations.')}
                </p>

                {/* Token claims display */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                    <div className="text-[10px] text-slate-400 uppercase">Forfait</div>
                    <div className="font-black text-slate-900 dark:text-white text-sm uppercase">
                      {PLAN_LABELS[normalizeToCanonicalPlan(license?.plan || license?.plan_type, license?.license_key)]}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                    <div className="text-[10px] text-slate-400 uppercase">Quota Dépôts</div>
                    <div className="font-black text-slate-900 dark:text-white text-sm">
                      {license?.max_depots || getMaxDepotsForPlan(license?.plan_type)}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                    <div className="text-[10px] text-slate-400 uppercase">Quota Références</div>
                    <div className="font-black text-slate-900 dark:text-white text-sm">
                      {((license?.max_references ?? plan_limits(license?.plan_type).max_references) >= 99999)
                        ? 'Illimité'
                        : (license?.max_references ?? plan_limits(license?.plan_type).max_references)}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                    <div className="text-[10px] text-slate-400 uppercase">Autorisé Offline</div>
                    <div className="font-black text-emerald-600 dark:text-emerald-400 text-xs">
                      {license?.offline_until
                        ? new Date(license.offline_until).toLocaleDateString('fr-FR')
                        : '+7 jours'}
                    </div>
                  </div>
                </div>

                {license?.signed_token?.signature && (
                  <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800/50 text-[10px] font-mono text-slate-500 break-all">
                    <span className="font-bold text-slate-700 dark:text-slate-300">Signature : </span>
                    {license.signed_token.signature}
                  </div>
                )}
              </div>

              {/* Modèle B : Contrôle des Quotas côté DB Client */}
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-purple-600" />
                    <span className="font-black text-xs text-slate-900 dark:text-white">
                      {tr(language, 'Modèle B — Quotas vérifiables côté DB Client', 'Model B — Server-enforced Quotas on Client DB')}
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200 border border-purple-300">
                    Anti-Contournement
                  </span>
                </div>

                <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1.5 leading-relaxed">
                  <p>
                    {tr(language, "Dans le Modèle B, votre base Supabase installe la table public.license_config et des triggers PostgreSQL (trg_check_depots_quota et trg_check_products_quota).", "In Model B, your Supabase DB installs public.license_config and triggers to enforce quotas directly inside PostgreSQL.")}
                  </p>
                  <p className="font-bold text-slate-800 dark:text-slate-200">
                    {tr(language, "Même si quelqu'un modifie le frontend web, la base de données refuse d'insérer au-delà du quota autorisé par votre jeton signé !", "Even if client code is modified, the database rejects inserts beyond the authorized quota.")}
                  </p>
                </div>

                {/* Actions: Copy SQL Modèle B & Sync Token */}
                <div className="flex items-center gap-2 pt-1 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      const sql = generateModelBSqlMigration();
                      navigator.clipboard.writeText(sql);
                      setCopiedModelBSql(true);
                      setTimeout(() => setCopiedModelBSql(false), 2500);
                    }}
                    className="py-2 px-3.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-black text-xs flex items-center gap-1.5 transition cursor-pointer shadow-sm active:scale-95"
                  >
                    {copiedModelBSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedModelBSql ? (tr(language, 'Script SQL Copié !', 'SQL Copied!')) : (tr(language, 'Copier Script SQL Modèle B', 'Copy Model B SQL Script'))}</span>
                  </button>

                  {supabaseConfig?.url && (
                    <button
                      type="button"
                      disabled={isSyncingModelB}
                      onClick={async () => {
                        if (!license?.signed_token) {
                          alert(tr(language, 'Aucun jeton de licence actif à synchroniser.', 'No active license token.'));
                          return;
                        }
                        setIsSyncingModelB(true);
                        const client = getClientSupabase(supabaseConfig.url, supabaseConfig.key);
                        if (!client) {
                          setModelBSyncResult('Supabase non initialisé.');
                          setIsSyncingModelB(false);
                          return;
                        }
                        const res = await syncLicenseTokenToClientDb(client, license.signed_token);
                        setIsSyncingModelB(false);
                        setModelBSyncResult(res.message);
                        setTimeout(() => setModelBSyncResult(null), 5000);
                      }}
                      className="py-2 px-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer active:scale-95"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isSyncingModelB ? 'animate-spin' : ''}`} />
                      <span>{tr(language, 'Synchroniser jeton vers Supabase', 'Sync token to Supabase')}</span>
                    </button>
                  )}
                </div>

                {modelBSyncResult && (
                  <div className="p-2.5 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-xs text-purple-900 dark:text-purple-200 font-bold">
                    {modelBSyncResult}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ======================= TAB 4: FONCTIONS EDGE ======================= */}
          {activeTab === 'edge_functions' && canDb && (
            <div className="space-y-3 animate-fadeIn">
              <EdgeFunctionsSetupPanel
                language={language}
                supabaseUrl={url || supabaseConfig?.url}
                supabaseKey={key || supabaseConfig?.key}
                isSuperAdmin={Number(currentUser?.role_id) === 0}
              />
            </div>
          )}

        </div>

        {/* Subscription Modal / Checkout Drawer */}
        {subscriptionModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[94dvh] sm:max-h-[92vh]">
              {/* Header */}
              <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-gradient-to-r from-orange-500/10 via-amber-500/10 to-transparent">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-orange-600 text-white flex items-center justify-center shadow-xs">
                    <CreditCard className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-black text-sm text-slate-900 dark:text-white">
                      {tr(language, 'Souscrire un abonnement TOT Stock', 'Subscribe to TOT Stock')}
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {tr(language, 'Activation immédiate de votre clé & extension des quotas', 'Instant key activation & quota extension')}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSubscriptionModalOpen(false)}
                  className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Body */}
              <div className="p-4 overflow-y-auto space-y-4 text-xs">
                {subSuccessInfo ? (
                  /* Success View */
                  <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 space-y-3 text-center">
                    <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-xs">
                      <CheckCircle className="w-6 h-6" />
                    </div>
                    <div>
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-200 dark:bg-emerald-800 text-emerald-800 dark:text-emerald-200">
                        {tr(language, 'Abonnement Validé & Actif', 'Subscription Verified & Active')}
                      </span>
                      <h4 className="text-base font-black text-slate-900 dark:text-white mt-1.5">
                        {tr(language, `Forfait ${subSuccessInfo.plan.toUpperCase()} Activé !`, `Plan ${subSuccessInfo.plan.toUpperCase()} Activated!`)}
                      </h4>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">
                        {tr(language, "Votre licence est désormais synchronisée et active dans toute l'application.", 'Your license is now synchronized and active across the entire application.')}
                      </p>
                    </div>

                    <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200/80 dark:border-emerald-800/80 text-left space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500">
                          {tr(language, 'Clé de licence générée :', 'Generated license key:')}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(subSuccessInfo.key);
                            setCopiedSubKey(true);
                            setTimeout(() => setCopiedSubKey(false), 2000);
                          }}
                          className="text-[10px] font-bold text-orange-600 hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <Copy className="w-3 h-3" />
                          <span>{copiedSubKey ? (tr(language, '✓ Copié', '✓ Copied')) : (tr(language, 'Copier', 'Copy'))}</span>
                        </button>
                      </div>
                      <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 font-mono text-center font-bold text-xs text-slate-900 dark:text-white select-all">
                        {subSuccessInfo.key}
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1 text-[10.5px] border-t border-slate-100 dark:border-slate-800">
                        <div>
                          <span className="text-slate-400">
                            {tr(language, 'Périodicité / Montant :', 'Billing / Amount:')}
                          </span>
                          <div className="font-bold text-slate-800 dark:text-slate-200">{subSuccessInfo.amount}</div>
                        </div>
                        <div>
                          <span className="text-slate-400">
                            {tr(language, 'Échéance de validité :', 'Expiration Date:')}
                          </span>
                          <div className="font-bold text-slate-800 dark:text-slate-200">{subSuccessInfo.expires}</div>
                        </div>
                        <div>
                          <span className="text-slate-400">
                            {tr(language, 'Réf. Facture / Commande :', 'Invoice / Order Ref:')}
                          </span>
                          <div className="font-bold text-slate-800 dark:text-slate-200">{subSuccessInfo.invoiceId}</div>
                        </div>
                        <div>
                          <span className="text-slate-400">{tr(language, 'Statut :', 'Status:')}</span>
                          <div className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
                            {tr(language, 'Validé & En ligne', 'Verified & Online')}
                          </div>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSubscriptionModalOpen(false)}
                      className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs transition cursor-pointer shadow-md"
                    >
                      {tr(language, 'Terminer et profiter de mon forfait', 'Finish and use my plan')}
                    </button>
                  </div>
                ) : showQuoteView ? (
                  /* Quote / Bon de commande View */
                  <div className="space-y-3">
                    <div className="p-3 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 space-y-2">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        <span className="font-black text-xs text-blue-900 dark:text-blue-200">
                          {tr(language, 'Devis & Bon de Commande Proforma', 'Quote & Proforma Purchase Order')}
                        </span>
                      </div>
                      <p className="text-[11px] text-blue-800/90 dark:text-blue-300/90">
                        {tr(language, `Votre bon de commande a été généré sous la référence `, `Your order has been generated under reference `)}
                        <strong>FAC-TOT-{new Date().getFullYear()}-{generateSecureRandomHex(2)}</strong>.
                      </p>
                      <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 text-[10.5px] space-y-1.5 border border-blue-100 dark:border-blue-900 font-mono">
                        <div className="flex justify-between">
                          <span className="text-slate-500">{tr(language, 'Bénéficiaire :', 'Beneficiary:')}</span>
                          <span className="font-bold">TOT Stock SAS</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">{tr(language, 'IBAN Virement :', 'Bank Transfer IBAN:')}</span>
                          <span className="font-bold">FR76 3000 4001 2345 6789 0123 456</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">BIC / SWIFT :</span>
                          <span className="font-bold">BNPAFRPPXXX</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">{tr(language, 'Objet du virement :', 'Transfer subject:')}</span>
                          <span className="font-bold">LICENCE TOT-{selectedSubPlan.toUpperCase()} {subCompany || orgName}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowQuoteView(false)}
                        className="flex-1 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-200 transition cursor-pointer"
                      >
                        {tr(language, 'Retour', 'Back')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSubscriptionModalOpen(false);
                          setShowQuoteView(false);
                        }}
                        className="flex-1 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-black transition cursor-pointer flex items-center justify-center gap-1.5 shadow-sm text-xs"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        <span>{tr(language, 'Activer ma clé officielle', 'Activate official key')}</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Form View */
                  <form onSubmit={handleSubscribeSubmit} className="space-y-3.5">
                    {subscriptionError && (
                      <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 text-rose-600 text-xs flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{subscriptionError}</span>
                      </div>
                    )}

                    {/* Upgrade Banner if moving from an existing plan */}
                    {license?.plan_type && license.plan_type !== 'free' && license.plan_type !== selectedSubPlan && (
                      <div className="p-3 rounded-2xl bg-gradient-to-r from-orange-500/10 via-amber-500/10 to-orange-500/10 border border-orange-300 dark:border-orange-800 text-orange-950 dark:text-orange-200 text-xs flex items-start gap-2.5">
                        <ShieldCheck className="w-4 h-4 shrink-0 text-orange-500 mt-0.5" />
                        <div className="space-y-0.5">
                          <div className="font-black text-slate-900 dark:text-white">
                            {tr(language, `Mise à niveau : ${PLAN_LABELS[normalizeToCanonicalPlan(license.plan || license.plan_type, license.license_key)]} ➔ ${PLAN_LABELS[selectedSubPlan]}`, `Upgrade request: ${PLAN_LABELS[normalizeToCanonicalPlan(license.plan || license.plan_type, license.license_key)]} ➔ ${PLAN_LABELS[selectedSubPlan]}`)}
                          </div>
                          <p className="text-[11px] text-slate-600 dark:text-slate-300">
                            {tr(language, `Vos références, historiques et dépôts sont 100% conservés. Le nouveau quota de ${selectedSubPlan === 'sta' ? '300' : selectedSubPlan === 'pro' ? '1 000' : 'illimité'} références sera délivré par le serveur éditeur.`, `Your items, history, and depots are 100% preserved. The new quota of ${selectedSubPlan === 'sta' ? '300' : selectedSubPlan === 'pro' ? '1,000' : 'unlimited'} items will be issued by the publisher server.`)}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Step 1: Choix de la formule */}
                    <div>
                      <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1.5">
                        {tr(language, '1. Choisissez votre niveau de formule :', '1. Choose your plan tier:')}
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedSubPlan('sta')}
                          className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                            selectedSubPlan === 'sta'
                              ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-500 ring-2 ring-blue-500/30'
                              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-blue-300'
                          }`}
                        >
                          <div className="font-extrabold text-blue-600 text-xs">{PLAN_LABELS.sta}</div>
                          <div className="text-[10px] font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                            {subBillingCycle === 'annual'
                              ? (tr(language, '390 €/an', '€390/yr'))
                              : (tr(language, '39 €/mois', '€39/mo'))}
                          </div>
                          <div className="text-[9.5px] text-slate-400 mt-1">
                            {tr(language, '300 réf. • 3 dépôts', '300 items • 3 depots')}
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => setSelectedSubPlan('pro')}
                          className={`p-2.5 rounded-xl border text-left transition cursor-pointer relative ${
                            selectedSubPlan === 'pro'
                              ? 'bg-orange-50 dark:bg-orange-950/60 border-orange-500 ring-2 ring-orange-500/30'
                              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-orange-300'
                          }`}
                        >
                          <span className="absolute -top-2 right-2 px-1.5 py-0.2 rounded-full bg-orange-500 text-white font-black text-[8px] uppercase">
                            {tr(language, 'Populaire', 'Popular')}
                          </span>
                          <div className="font-extrabold text-orange-600 text-xs">{PLAN_LABELS.pro}</div>
                          <div className="text-[10px] font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                            {subBillingCycle === 'annual'
                              ? (tr(language, '890 €/an', '€890/yr'))
                              : (tr(language, '89 €/mois', '€89/mo'))}
                          </div>
                          <div className="text-[9.5px] text-slate-400 mt-1">
                            {tr(language, '1 000 réf. • 10 dépôts', '1,000 items • 10 depots')}
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => setSelectedSubPlan('ent')}
                          className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                            selectedSubPlan === 'ent'
                              ? 'bg-purple-50 dark:bg-purple-950/60 border-purple-500 ring-2 ring-purple-500/30'
                              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-purple-300'
                          }`}
                        >
                          <div className="font-extrabold text-purple-600 text-xs">
                            {PLAN_LABELS.ent}
                          </div>
                          <div className="text-[10px] font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                            {subBillingCycle === 'annual'
                              ? (tr(language, '1 990 €/an', '€1,990/yr'))
                              : (tr(language, '199 €/mois', '€199/mo'))}
                          </div>
                          <div className="text-[9.5px] text-slate-400 mt-1">
                            {tr(language, 'Illimité • BYOD Supabase', 'Unlimited • Supabase BYOD')}
                          </div>
                        </button>
                      </div>
                    </div>

                    {/* Step 2: Cycle de facturation */}
                    <div>
                      <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1.5">
                        {tr(language, '2. Périodicité de facturation :', '2. Billing frequency:')}
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setSubBillingCycle('monthly')}
                          className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex items-center justify-between ${
                            subBillingCycle === 'monthly'
                              ? 'bg-slate-100 dark:bg-slate-800 border-slate-500 ring-2 ring-slate-500/20'
                              : 'bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          <div>
                            <div className="font-extrabold text-xs text-slate-900 dark:text-white">
                              {tr(language, 'Mensuel', 'Monthly')}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {tr(language, 'Sans engagement', 'No commitment')}
                            </div>
                          </div>
                          <span className="font-bold text-xs text-slate-700 dark:text-slate-300">
                            {selectedSubPlan === 'sta'
                              ? (tr(language, '39 €/m', '€39/mo'))
                              : selectedSubPlan === 'pro'
                              ? (tr(language, '89 €/m', '€89/mo'))
                              : (tr(language, '199 €/m', '€199/mo'))}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setSubBillingCycle('annual')}
                          className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex items-center justify-between relative ${
                            subBillingCycle === 'annual'
                              ? 'bg-emerald-50/80 dark:bg-emerald-950/50 border-emerald-500 ring-2 ring-emerald-500/30'
                              : 'bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          <div>
                            <div className="font-extrabold text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                              <span>{tr(language, 'Annuel', 'Annual')}</span>
                              <span className="px-1 py-0.2 rounded bg-emerald-200 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200 text-[9px] font-black">
                                -20%
                              </span>
                            </div>
                            <div className="text-[10px] text-emerald-600 dark:text-emerald-400">
                              {tr(language, '2 mois offerts', '2 months free')}
                            </div>
                          </div>
                          <span className="font-black text-xs text-emerald-700 dark:text-emerald-300">
                            {selectedSubPlan === 'sta'
                              ? (tr(language, '390 €/an', '€390/yr'))
                              : selectedSubPlan === 'pro'
                              ? (tr(language, '890 €/an', '€890/yr'))
                              : (tr(language, '1 990 €/an', '€1,990/yr'))}
                          </span>
                        </button>
                      </div>
                    </div>

                    {/* Step 3: Coordonnées de l'entreprise */}
                    <div className="space-y-2">
                      <label className="font-bold text-slate-700 dark:text-slate-300 block">
                        {tr(language, "3. Coordonnées de l'abonné / Établissement :", '3. Subscriber / Company Details:')}
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <span className="text-[10.5px] text-slate-500 block mb-0.5">
                            {tr(language, 'Raison sociale / Entreprise *', 'Company Name *')}
                          </span>
                          <input
                            type="text"
                            required
                            value={subCompany}
                            onChange={(e) => setSubCompany(e.target.value)}
                            placeholder={tr(language, "Ex: Entreprise Martin & Fils", "e.g. Acme Corp Ltd")}
                            className="w-full px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs outline-none focus:border-orange-500"
                          />
                        </div>
                        <div>
                          <span className="text-[10.5px] text-slate-500 block mb-0.5">
                            {tr(language, 'Email de facturation & contact *', 'Billing & Contact Email *')}
                          </span>
                          <input
                            type="email"
                            required
                            value={subEmail}
                            onChange={(e) => setSubEmail(e.target.value)}
                            placeholder="billing@company.com"
                            className="w-full px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs outline-none focus:border-orange-500"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Summary box */}
                    <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1.5">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-600 dark:text-slate-300 font-medium">
                          {tr(language, `Forfait ${selectedSubPlan.toUpperCase()}`, `Plan ${selectedSubPlan.toUpperCase()}`)} ({subBillingCycle === 'annual' ? (tr(language, '12 mois', '12 mos')) : (tr(language, '1 mois', '1 mo'))}) :
                        </span>
                        <span className="font-black text-slate-900 dark:text-white">
                          {selectedSubPlan === 'sta'
                            ? (subBillingCycle === 'annual' ? '390,00 € HT' : '39,00 € HT')
                            : selectedSubPlan === 'pro'
                            ? (subBillingCycle === 'annual' ? '890,00 € HT' : '89,00 € HT')
                            : (subBillingCycle === 'annual' ? '1 990,00 € HT' : '199,00 € HT')}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-[11px] text-slate-400">
                        <span>{tr(language, 'TVA 20% :', 'VAT 20%:')}</span>
                        <span>
                          {selectedSubPlan === 'sta'
                            ? (subBillingCycle === 'annual' ? '78,00 €' : '7,80 €')
                            : selectedSubPlan === 'pro'
                            ? (subBillingCycle === 'annual' ? '178,00 €' : '17,80 €')
                            : (subBillingCycle === 'annual' ? '398,00 €' : '39,80 €')}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs pt-1 border-t border-slate-200 dark:border-slate-700 font-black text-slate-900 dark:text-white">
                        <span>{tr(language, 'Total TTC :', 'Total (incl. VAT):')}</span>
                        <span className="text-orange-600 dark:text-orange-400 text-sm">
                          {selectedSubPlan === 'sta'
                            ? (subBillingCycle === 'annual' ? '468,00 € TTC' : '46,80 € TTC')
                            : selectedSubPlan === 'pro'
                            ? (subBillingCycle === 'annual' ? '1 068,00 € TTC' : '106,80 € TTC')
                            : (subBillingCycle === 'annual' ? '2 388,00 € TTC' : '238,80 € TTC')}
                        </span>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1 pb-[env(safe-area-inset-bottom)]">
                      <button
                        type="button"
                        onClick={() => setShowQuoteView(true)}
                        className="py-2.5 px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>{tr(language, 'Devis / Virement', 'Quote / Wire Transfer')}</span>
                      </button>

                      <button
                        type="submit"
                        disabled={isSubmittingSub}
                        className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-black text-xs transition cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20 active:scale-98"
                      >
                        <Zap className="w-4 h-4 shrink-0" />
                        <span className="truncate">
                          {isSubmittingSub
                            ? (tr(language, 'Activation en cours...', 'Activating...'))
                            : (tr(language, '⚡ Activer mon forfait immédiatement', '⚡ Activate my plan immediately'))}
                        </span>
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ======================= SERVER ADDRESS CONFIRMATION MODAL (Tâche 3) ======================= */}
        {pendingServerConfirm && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
            <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 text-slate-800 dark:text-slate-100">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-xl bg-orange-100 dark:bg-orange-950/60 text-orange-600 flex items-center justify-center">
                    <Server className="w-5 h-5" />
                  </div>
                  <h3 className="text-sm sm:text-base font-black text-slate-900 dark:text-white">
                    {t('server_confirm_title')}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPendingServerConfirm(null);
                    setCustomDomainConfirmed(false);
                  }}
                  className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Domain name in large font */}
              <div className="p-4 rounded-2xl bg-slate-100 dark:bg-slate-800/90 border-2 border-orange-500/50 text-center">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  {tr(language, 'Domaine du serveur', 'Server domain')}
                </div>
                <div
                  data-testid="server-confirm-hostname"
                  className="text-lg sm:text-2xl font-black font-mono text-slate-900 dark:text-white break-all tracking-tight"
                >
                  {pendingServerConfirm.validation.hostname}
                </div>
              </div>

              <p className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200 leading-relaxed text-center">
                {t('server_confirm_msg')}
              </p>

              {/* Warning and explicit second confirmation if domain does not end with .supabase.co */}
              {pendingServerConfirm.validation.requiresCustomDomainConfirmation && (
                <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 space-y-2.5">
                  <div className="flex items-start gap-2 text-amber-800 dark:text-amber-200 text-xs font-bold leading-snug">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                    <span>{t('server_custom_domain_warning')}</span>
                  </div>
                  <label className="flex items-start gap-2.5 pt-1 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={customDomainConfirmed}
                      onChange={(e) => setCustomDomainConfirmed(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded accent-amber-600 cursor-pointer shrink-0"
                    />
                    <span className="text-[11px] font-extrabold text-amber-900 dark:text-amber-100 leading-snug">
                      {t('server_custom_domain_checkbox')}
                    </span>
                  </label>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setPendingServerConfirm(null);
                    setCustomDomainConfirmed(false);
                  }}
                  className="flex-1 py-2.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 font-bold text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  {t('common_cancel')}
                </button>
                <button
                  type="button"
                  disabled={
                    pendingServerConfirm.validation.requiresCustomDomainConfirmation &&
                    !customDomainConfirmed
                  }
                  onClick={executeConfirmedServerAction}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-orange-600 hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black text-xs transition shadow-md cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>{tr(language, 'Confirmer', 'Confirm', 'Bevestigen')}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
