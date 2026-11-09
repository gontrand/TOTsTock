import React, { useEffect, useState } from 'react';
import { setupGlobalHapticFeedback } from './utils/haptics';
import { X, AlertTriangle, Download, RefreshCw, Database, ShieldAlert } from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext';
import { compareSemver } from './services/clientSupabase';
import {
  DesktopUpdateStatus,
  getDesktopUpdateStatus,
  isDesktopApp,
  openExternalUrl,
  quitAndInstallDesktopUpdate,
  subscribeDesktopUpdateStatus,
} from './services/desktopBridge';
import { tr, useDutchDomTranslator } from './i18n/dutchTranslator';
import {
  dismissUserPreferencesSyncBanner,
  getSyncBannerState,
  subscribeUserPreferencesSyncBanner,
  UserPreferencesSyncBannerState,
} from './services/userPreferencesService';
import { Header } from './components/Header';
import { BottomNav } from './components/BottomNav';
import { DashboardView } from './components/DashboardView';
import { InventoryView } from './components/InventoryView';
import { MovementsView } from './components/MovementsView';
import { PlusMenuView } from './components/PlusMenuView';

// Modals
import { LoginModal } from './components/LoginModal';
import { ProductDetailModal } from './components/ProductDetailModal';
import { ProductFormModal } from './components/ProductFormModal';
import { ScannerModal } from './components/ScannerModal';
import { BatchCartModal } from './components/BatchCartModal';
import { ActionSheet } from './components/ActionSheet';
import { DepartmentsProjectsModal } from './components/DepartmentsProjectsModal';
import { UsersRolesModal } from './components/UsersRolesModal';
import { CategoriesModal } from './components/CategoriesModal';
import { DepotsModal } from './components/DepotsModal';
import { EmailReportsModal } from './components/EmailReportsModal';
import { SmtpSettingsModal } from './components/SmtpSettingsModal';
import { CompanySetupModal } from './components/CompanySetupModal';
import { QrConfigGenModal } from './components/QrConfigGenModal';
import { ProfileModal } from './components/ProfileModal';
import { NotificationsModal } from './components/NotificationsModal';
import { AppInfoModal } from './components/AppInfoModal';
import { ReleaseNotesModal } from './components/ReleaseNotesModal';
import { PrintLabelsModal } from './components/PrintLabelsModal';
import { PrintStationPanel } from './components/PrintStationPanel';
import { InventoryAuditModal } from './components/InventoryAuditModal';
import { DiagnosticModal } from './components/DiagnosticModal';
import { DocumentationModal } from './components/DocumentationModal';
import { MaterialOrdersModal } from './components/MaterialOrdersModal';
import { OrdersPreparationModal } from './components/OrdersPreparationModal';
import { ScannerPickingMode } from './components/ScannerPickingMode';
import { LoginWelcomeScreen } from './components/LoginWelcomeScreen';
import { useLayoutMode } from './hooks/useLayoutMode';
import { DesktopWorkspace } from './desktop/DesktopWorkspace';
import { UnsavedChangesModal } from './components/UnsavedChangesModal';
import { StockTransferModal } from './components/StockTransferModal';
import { TransfersValidationPanel } from './components/TransfersValidationPanel';

const MainLayout: React.FC = () => {
  const layoutMode = useLayoutMode();
  useEffect(() => {
    setupGlobalHapticFeedback();
  }, []);
  const {
    activeTab,
    currentUser,
    licenseNotification,
    dismissLicenseNotification,
    appCompat,
    recheckAppCompat,
    language,
    loginModalOpen,
    setLoginModalOpen,
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
    profileModalOpen,
    notificationsModalOpen,
    appInfoModalOpen,
    releaseNotesModalOpen,
    printLabelsModal,
    printStationModalOpen,
    inventoryAuditModalOpen,
    diagnosticModalOpen,
    documentationModalOpen,
    orderCartModalOpen,
    preparerOrdersModalOpen,
    scannerPickingModeOpen,
    stockTransferModal,
    transfersModalOpen,
    setTransfersModalOpen,
    inactivityWarning,
    stayConnectedFromInactivity,
  } = useApp();

  useDutchDomTranslator(language);

  const [checkingCompat, setCheckingCompat] = useState(false);
  const [dismissedSoftUpdate, setDismissedSoftUpdate] = useState(false);
  const [desktopUpdate, setDesktopUpdate] = useState<DesktopUpdateStatus>({
    enabled: false,
    state: 'idle',
    version: null,
    error: null,
  });
  const [prefsSyncBanner, setPrefsSyncBanner] = useState<UserPreferencesSyncBannerState>(() =>
    getSyncBannerState()
  );

  useEffect(() => {
    return subscribeUserPreferencesSyncBanner(setPrefsSyncBanner);
  }, []);

  useEffect(() => {
    if (!isDesktopApp()) return;
    getDesktopUpdateStatus().then(setDesktopUpdate);
    return subscribeDesktopUpdateStatus(setDesktopUpdate);
  }, []);

  const handleOpenUpdateLink = (e: React.MouseEvent<HTMLAnchorElement>, url?: string | null) => {
    if (!url) return;
    if (isDesktopApp()) {
      e.preventDefault();
      openExternalUrl(url);
    }
  };

  const isRole0Or1 = Boolean(
    currentUser && (Number(currentUser.role_id) === 0 || Number(currentUser.role_id) === 1)
  );
  const isAdminRole = Boolean(
    currentUser && [0, 1, 5].includes(Number(currentUser.role_id))
  );

  // Règles Point 4 :
  // - APP_VERSION < min_app_version (base) : blocage « Mettez l'application à jour »
  // - schema_version (base) < MIN_SUPPORTED_SCHEMA_VERSION : blocage « La base de données doit être mise à jour »
  // - maintenance = true : blocage pour les utilisateurs, simple bandeau pour les rôles 0 et 1
  const isBlockedByCompat = Boolean(
    appCompat.appOutdated ||
      appCompat.dbOutdated ||
      (appCompat.maintenance && !isRole0Or1)
  );

  const hasSoftUpdate =
    !isBlockedByCompat &&
    !dismissedSoftUpdate &&
    Boolean(appCompat.latestVersion) &&
    compareSemver(appCompat.appVersion, appCompat.latestVersion) < 0;

  const handleRecheck = async () => {
    setCheckingCompat(true);
    try {
      await recheckAppCompat();
    } finally {
      setCheckingCompat(false);
    }
  };

  if (layoutMode === 'desktop' && currentUser && !isBlockedByCompat) {
    return (
      <>
        {inactivityWarning?.active && (
          <div
            role="alert"
            data-testid="inactivity-warning-banner"
            className="fixed top-3 left-1/2 -translate-x-1/2 z-[90] max-w-lg w-[92vw] px-4 py-3 rounded-2xl bg-amber-600 text-white shadow-2xl border border-amber-400 flex items-center justify-between gap-3 text-xs font-bold animate-fadeIn"
          >
            <span>
              {tr(
                language,
                `Vous allez être déconnecté pour inactivité dans ${inactivityWarning.remainingSeconds} s.`,
                `You will be signed out due to inactivity in ${inactivityWarning.remainingSeconds} s.`,
                `U wordt over ${inactivityWarning.remainingSeconds} s afgemeld wegens inactiviteit.`
              )}
            </span>
            <button
              type="button"
              data-testid="stay-connected-btn"
              onClick={stayConnectedFromInactivity}
              className="px-3 py-1.5 rounded-xl bg-white text-amber-800 hover:bg-amber-50 font-black text-xs shrink-0 cursor-pointer shadow-xs"
            >
              {tr(language, 'Rester connecté', 'Stay signed in', 'Aangemeld blijven')}
            </button>
          </div>
        )}
        <DesktopWorkspace />
        {activeProductId && <ProductDetailModal />}
        {batchCartModalOpen && <BatchCartModal />}
        {diagnosticModalOpen && <DiagnosticModal />}
        {qrConfigGenModalOpen && <QrConfigGenModal />}
        {stockTransferModal?.open && <StockTransferModal />}
        {transfersModalOpen && (
          <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-5xl h-[90vh] rounded-3xl overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800">
              <TransfersValidationPanel
                isModal
                onClose={() => setTransfersModalOpen(false)}
              />
            </div>
          </div>
        )}
        <UnsavedChangesModal />
      </>
    );
  }

  return (
    <div className="min-h-screen w-full max-w-full bg-slate-200/80 dark:bg-[#0b1120] flex justify-center items-center overflow-x-hidden overflow-y-hidden transition-colors duration-200">
      {/* Mobile-first centered application container */}
      <div
        id="app-container"
        className="w-full max-w-[480px] h-[100dvh] max-h-[100dvh] bg-[#f8fafc] dark:bg-[#0f172a] text-slate-900 dark:text-slate-100 flex flex-col relative overflow-x-hidden overflow-y-hidden shadow-2xl sm:rounded-2xl border-x border-slate-300/80 dark:border-slate-800/80 transition-colors duration-200"
      >
        {/* Top Header Bar */}
        <Header />

        {/* Point 3.6 : Avertissement non intrusif avant déconnexion pour inactivité */}
        {inactivityWarning?.active && (
          <div
            role="alert"
            data-testid="inactivity-warning-banner"
            className="mx-3 mt-2 p-2.5 bg-amber-600 text-white text-xs font-bold rounded-xl shadow-md flex items-center justify-between gap-2 animate-fadeIn"
          >
            <span className="flex-1">
              {tr(
                language,
                `Vous allez être déconnecté (${inactivityWarning.remainingSeconds} s)`,
                `You will be signed out (${inactivityWarning.remainingSeconds} s)`,
                `U wordt afgemeld (${inactivityWarning.remainingSeconds} s)`
              )}
            </span>
            <button
              type="button"
              data-testid="stay-connected-btn"
              onClick={stayConnectedFromInactivity}
              className="px-2.5 py-1 rounded-lg bg-white text-amber-800 font-black text-[11px] shrink-0 cursor-pointer"
            >
              {tr(language, 'Rester connecté', 'Stay signed in', 'Aangemeld blijven')}
            </button>
          </div>
        )}

        {/* Point 4 : Avertissement non bloquant si la table app_compat est absente */}
        {appCompat.tableMissing && (
          <div className="mx-3 mt-2 p-2.5 bg-amber-500/15 border border-amber-500/40 text-amber-800 dark:text-amber-200 text-xs font-bold rounded-xl flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="flex-1">
              {appCompat.warningBanner && language === 'fr'
                ? appCompat.warningBanner
                : tr(
                    language,
                    'installation incomplète, contactez votre administrateur',
                    'incomplete installation, please contact your administrator',
                    'onvolledige installatie, neem contact op met uw beheerder'
                  )}
            </span>
          </div>
        )}

        {/* Point 4 : Simple bandeau de maintenance pour les rôles 0 et 1 */}
        {appCompat.maintenance && isRole0Or1 && (
          <div className="mx-3 mt-2 p-2.5 bg-amber-600 text-white text-xs font-bold rounded-xl shadow-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="flex-1">
              {tr(
                language,
                'Mode maintenance actif (accès autorisé pour votre rôle administrateur 0/1).',
                'Maintenance mode active (access granted for admin role 0/1).',
                'Onderhoudsmodus actief (toegang verleend voor uw beheerdersrol 0/1).'
              )}
            </span>
          </div>
        )}

        {/* Point 4 : Bandeau d'information administrateur si schema_version < EXPECTED_SCHEMA_VERSION mais >= MIN_SUPPORTED_SCHEMA_VERSION */}
        {appCompat.schemaBehindWarning && isAdminRole && (
          <div className="mx-3 mt-2 p-2.5 bg-sky-500/15 border border-sky-500/40 text-sky-800 dark:text-sky-200 text-xs font-bold rounded-xl flex items-center gap-2">
            <Database className="w-4 h-4 shrink-0 text-sky-600 dark:text-sky-400" />
            <span className="flex-1">
              {tr(
                language,
                appCompat.adminBanner ||
                  `Schéma SQL (v${appCompat.schemaVersion}) antérieur au schéma attendu (v${appCompat.expectedSchemaVersion}).`,
                `SQL Schema (v${appCompat.schemaVersion}) older than expected schema (v${appCompat.expectedSchemaVersion}).`,
                `SQL-schema (v${appCompat.schemaVersion}) ouder dan verwacht schema (v${appCompat.expectedSchemaVersion}).`
              )}
            </span>
          </div>
        )}

        {/* LOT 1.3 v48 : Bandeau discret unique si core_user_preferences / script SQL 12 est manquant */}
        {prefsSyncBanner.visible && (
          <div
            role="status"
            className="mx-3 mt-2 p-2.5 bg-violet-500/15 border border-violet-500/40 text-violet-900 dark:text-violet-200 text-xs font-bold rounded-xl flex items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Database className="w-4 h-4 shrink-0 text-violet-600 dark:text-violet-400" />
              <span className="truncate">
                {tr(
                  language,
                  'Préférences non synchronisées (script SQL 12 manquant)',
                  'Preferences not synchronized (SQL script 12 missing)',
                  'Voorkeuren niet gesynchroniseerd (SQL-script 12 ontbreekt)'
                )}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  dismissUserPreferencesSyncBanner();
                  setCompanySetupModalOpen(true);
                }}
                className="px-2 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-extrabold cursor-pointer"
              >
                {tr(language, 'Scripts SQL', 'SQL Scripts', 'SQL-scripts')}
              </button>
              <button
                type="button"
                onClick={dismissUserPreferencesSyncBanner}
                className="p-1 rounded-lg hover:bg-violet-500/20 cursor-pointer"
                aria-label={tr(language, 'Fermer', 'Dismiss', 'Sluiten')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Server License Plan Change Notification Toast */}
        {licenseNotification && (
          <div className="mx-3 mt-2 p-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-xs font-bold rounded-xl shadow-md flex items-center justify-between gap-2 animate-in fade-in slide-in-from-top-2">
            <span className="flex-1">{licenseNotification}</span>
            <button
              onClick={dismissLicenseNotification}
              className="p-1 hover:bg-white/20 rounded-md transition text-white cursor-pointer"
              title={tr(language, 'Fermer', 'Close', 'Sluiten')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Non-blocking Update Available Banner (when compatible but latest_version > appVersion) */}
        {hasSoftUpdate && (
          <div className="mx-3 mt-2 p-2.5 bg-gradient-to-r from-sky-600 to-indigo-600 text-white text-xs font-bold rounded-xl shadow-md flex items-center justify-between gap-2 animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Download className="w-4 h-4 shrink-0" />
              <span className="truncate">
                {tr(
                  language,
                  `Nouvelle version v${appCompat.latestVersion} disponible`,
                  `New version v${appCompat.latestVersion} available`,
                  `Nieuwe versie v${appCompat.latestVersion} beschikbaar`
                )}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {appCompat.updateUrl && (
                <a
                  href={appCompat.updateUrl}
                  download={!isDesktopApp()}
                  onClick={(e) => handleOpenUpdateLink(e, appCompat.updateUrl)}
                  className="px-2.5 py-1 rounded-lg bg-white text-indigo-700 font-extrabold text-[11px] hover:bg-indigo-50 transition"
                >
                  {tr(language, 'Mettre à jour', 'Update', 'Bijwerken')}
                </a>
              )}
              <button
                onClick={() => setDismissedSoftUpdate(true)}
                className="p-1 hover:bg-white/20 rounded-md transition text-white cursor-pointer"
                title={tr(language, 'Fermer', 'Close', 'Sluiten')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Desktop Auto-Update Downloaded Banner */}
        {isDesktopApp() && desktopUpdate.state === 'downloaded' && (
          <div className="mx-3 mt-2 p-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-xs font-bold rounded-xl shadow-md flex items-center justify-between gap-2 animate-in fade-in slide-in-from-top-2">
            <span className="truncate">
              {tr(
                language,
                `Mise à jour bureau téléchargée${desktopUpdate.version ? ` (v${desktopUpdate.version})` : ''}`,
                `Desktop update downloaded${desktopUpdate.version ? ` (v${desktopUpdate.version})` : ''}`,
                `Desktop-update gedownload${desktopUpdate.version ? ` (v${desktopUpdate.version})` : ''}`
              )}
            </span>
            <button
              type="button"
              onClick={() => quitAndInstallDesktopUpdate()}
              className="px-2.5 py-1 rounded-lg bg-white text-indigo-700 font-extrabold text-[11px] hover:bg-indigo-50 transition cursor-pointer shrink-0"
            >
              {tr(
                language,
                'Redémarrer pour mettre à jour',
                'Restart to update',
                'Herstarten om bij te werken'
              )}
            </button>
          </div>
        )}

        {/* Content View */}
        {!currentUser ? (
          <LoginWelcomeScreen />
        ) : (
          <>
            <main className="flex-1 w-full max-w-full overflow-y-auto overflow-x-hidden px-3 pt-2 pb-[calc(76px+env(safe-area-inset-bottom,0px))] bg-[#f8fafc] dark:bg-[#0f172a] transition-colors duration-200 overscroll-contain">
              {activeTab === 'home' && <DashboardView />}
              {activeTab === 'search' && <InventoryView />}
              {activeTab === 'movements' && <MovementsView />}
              {activeTab === 'plus' && <PlusMenuView />}
            </main>

            {/* Persistent Bottom Tab Navigation */}
            <BottomNav />
          </>
        )}

        {/* Blocking Compatibility / Maintenance Alert Modal (public.app_compat) */}
        {isBlockedByCompat && !companySetupModalOpen && !loginModalOpen && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fadeIn">
            <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-amber-500/40 p-6 text-center space-y-4">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-tr from-amber-500 to-red-600 text-white flex items-center justify-center shadow-lg shadow-orange-500/30">
                {appCompat.maintenance && !appCompat.appOutdated && !appCompat.dbOutdated ? (
                  <AlertTriangle className="w-8 h-8" />
                ) : (
                  <ShieldAlert className="w-8 h-8" />
                )}
              </div>

              <div>
                <h2 className="text-lg font-black text-slate-900 dark:text-white">
                  {appCompat.appOutdated
                    ? tr(language, "Mettez l'application à jour", 'Update the application', 'Werk de applicatie bij')
                    : appCompat.dbOutdated
                    ? tr(
                        language,
                        'La base de données doit être mise à jour',
                        'Database must be updated',
                        'De database moet worden bijgewerkt'
                      )
                    : tr(
                        language,
                        'Maintenance de la base en cours',
                        'Database Maintenance in Progress',
                        'Database-onderhoud bezig'
                      )}
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5 leading-relaxed">
                  {appCompat.message && language === 'fr'
                    ? appCompat.message
                    : appCompat.appOutdated
                    ? tr(
                        language,
                        `Votre version actuelle de l'application (v${appCompat.appVersion}) est inférieure à la version minimale requise (v${appCompat.minAppVersion}). Mettez l'application à jour.`,
                        `Your current app version (v${appCompat.appVersion}) is older than the minimum required version (v${appCompat.minAppVersion}). Please update the application.`,
                        `Uw huidige applicatieversie (v${appCompat.appVersion}) is lager dan de minimaal vereiste versie (v${appCompat.minAppVersion}). Werk de applicatie bij.`
                      )
                    : appCompat.dbOutdated
                    ? tr(
                        language,
                        `Le schéma de la base de données (v${appCompat.schemaVersion}) est inférieur au schéma minimal supporté (v${appCompat.minSupportedSchemaVersion}). La base de données doit être mise à jour.`,
                        `The database schema (v${appCompat.schemaVersion}) is older than the minimum supported schema (v${appCompat.minSupportedSchemaVersion}). The database must be updated.`,
                        `Het databaseschema (v${appCompat.schemaVersion}) is lager dan het minimaal ondersteunde schema (v${appCompat.minSupportedSchemaVersion}). De database moet worden bijgewerkt.`
                      )
                    : tr(
                        language,
                        'Une opération de maintenance ou de migration SQL est en cours sur la base de données. Veuillez patienter quelques instants.',
                        'A database maintenance or SQL migration is currently in progress. Please wait a moment.',
                        'Er is momenteel een database-onderhoud of SQL-migratie bezig. Een ogenblik geduld a.u.b.'
                      )}
                </p>
              </div>

              <div className="p-3 rounded-2xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-[11px] space-y-1.5 text-left">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">
                    {tr(language, 'Version installée (APP_VERSION) :', 'Installed version:', 'Geïnstalleerde versie (APP_VERSION):')}
                  </span>
                  <span className="font-mono font-bold text-red-600 dark:text-red-400">
                    v{appCompat.appVersion}
                  </span>
                </div>
                {appCompat.minAppVersion && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">
                      {tr(language, 'Version minimale requise :', 'Minimum required:', 'Minimaal vereiste versie:')}
                    </span>
                    <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      v{appCompat.minAppVersion}
                    </span>
                  </div>
                )}
                {appCompat.schemaVersion && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">
                      {tr(language, 'Schéma SQL (base / attendu) :', 'SQL Schema (DB / expected):', 'SQL-schema (database / verwacht):')}
                    </span>
                    <span className="font-mono font-bold text-sky-600 dark:text-sky-400">
                      v{appCompat.schemaVersion} / v{appCompat.expectedSchemaVersion}
                    </span>
                  </div>
                )}
              </div>

              <div className="space-y-2 pt-1">
                {appCompat.appOutdated &&
                  (appCompat.updateUrl ? (
                    <a
                      href={appCompat.updateUrl}
                      download={!isDesktopApp()}
                      onClick={(e) => handleOpenUpdateLink(e, appCompat.updateUrl)}
                      className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-extrabold text-xs shadow-md shadow-orange-500/25 flex items-center justify-center gap-2 transition active:scale-95"
                    >
                      <Download className="w-4 h-4" />
                      <span>
                        {tr(
                          language,
                          `Télécharger la mise à jour (v${appCompat.latestVersion || appCompat.minAppVersion})`,
                          `Download Update (v${appCompat.latestVersion || appCompat.minAppVersion})`,
                          `Update downloaden (v${appCompat.latestVersion || appCompat.minAppVersion})`
                        )}
                      </span>
                    </a>
                  ) : (
                    <div className="w-full py-2.5 px-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 font-bold text-xs text-center">
                      {tr(
                        language,
                        'Demandez le lien de téléchargement à votre administrateur',
                        'Ask your administrator for the download link',
                        'Vraag de downloadlink aan uw beheerder'
                      )}
                    </div>
                  ))}

                <button
                  type="button"
                  onClick={handleRecheck}
                  disabled={checkingCompat}
                  className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${checkingCompat ? 'animate-spin' : ''}`} />
                  <span>
                    {tr(language, 'Vérifier à nouveau / Actualiser', 'Check Again / Refresh', 'Opnieuw controleren / Vernieuwen')}
                  </span>
                </button>

                {appCompat.maintenance && !currentUser && (
                  <button
                    type="button"
                    onClick={() => setLoginModalOpen(true)}
                    className="w-full py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white text-[11px] font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                  >
                    <span>
                      {tr(
                        language,
                        'Connexion Administrateur (rôles 0 et 1)',
                        'Admin Sign In (roles 0 and 1)',
                        'Aanmelden Beheerder (rollen 0 en 1)'
                      )}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setCompanySetupModalOpen(true)}
                  className="w-full py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <Database className="w-3.5 h-3.5" />
                  <span>
                    {tr(
                      language,
                      'Administration : Configurer la base Supabase',
                      'Admin: Configure Supabase Database',
                      'Beheer: Supabase-database configureren'
                    )}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modals and Overlays rendered conditionally for peak fluency & performance */}
        {loginModalOpen && <LoginModal />}
        {activeProductId !== null && <ProductDetailModal />}
        {productFormState?.open && <ProductFormModal />}
        {scanState?.open && <ScannerModal />}
        {batchCartModalOpen && <BatchCartModal />}
        {actionSheetOpen && <ActionSheet />}
        {departmentsProjectsModal?.open && <DepartmentsProjectsModal />}
        {usersRolesModal?.open && <UsersRolesModal />}
        {categoriesModalOpen && <CategoriesModal />}
        {depotsModalOpen && <DepotsModal />}
        {emailReportsModalOpen && <EmailReportsModal />}
        {smtpSettingsModalOpen && <SmtpSettingsModal />}
        {companySetupModalOpen && <CompanySetupModal />}
        {qrConfigGenModalOpen && <QrConfigGenModal />}
        {profileModalOpen && <ProfileModal />}
        {notificationsModalOpen && <NotificationsModal />}
        {appInfoModalOpen && <AppInfoModal />}
        {releaseNotesModalOpen && <ReleaseNotesModal />}
        {printLabelsModal?.open && <PrintLabelsModal />}
        {printStationModalOpen && <PrintStationPanel />}
        {inventoryAuditModalOpen && <InventoryAuditModal />}
        {diagnosticModalOpen && <DiagnosticModal />}
        {documentationModalOpen?.open && <DocumentationModal />}
        {orderCartModalOpen && <MaterialOrdersModal />}
        {preparerOrdersModalOpen && <OrdersPreparationModal />}
        {scannerPickingModeOpen && <ScannerPickingMode />}
        {stockTransferModal?.open && <StockTransferModal />}
        {transfersModalOpen && (
          <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="w-full max-w-2xl h-[95dvh] sm:h-[90vh] rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800">
              <TransfersValidationPanel
                isModal
                onClose={() => setTransfersModalOpen(false)}
              />
            </div>
          </div>
        )}
        <UnsavedChangesModal />
      </div>
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <MainLayout />
    </AppProvider>
  );
}
