import React, { useState } from 'react';
import { tr } from '../i18n/dutchTranslator';
import { useApp } from '../context/AppContext';
import { APP_VERSION, EXPECTED_SCHEMA_VERSION, MIN_SUPPORTED_SCHEMA_VERSION } from '../appVersion';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { buildApkDownloadUrl, fetchApkSha256 } from '../utils/apkDownload';
import {
  DesktopTargetOs,
  detectClientDesktopOs,
  getConfiguredBinaryInstallerUrl,
} from '../utils/desktopInstallerDownload';
import { openExternalUrl } from '../services/desktopBridge';
import { X, Zap, Smartphone, Monitor, ShieldCheck, Mail, Download, Share, Database, RefreshCw, CheckCircle2, AlertTriangle, Copy, Check, BookOpen } from 'lucide-react';

export const AppInfoModal: React.FC = () => {
  const {
    appInfoModalOpen,
    setAppInfoModalOpen,
    setReleaseNotesModalOpen,
    appLogoUrl,
    appCompat,
    recheckAppCompat,
    isSupabaseConnected,
    language,
    t,
  } = useApp();

  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [refreshingCompat, setRefreshingCompat] = useState(false);
  const [apkSha256, setApkSha256] = useState<string | null>(null);
  const [copiedSha, setCopiedSha] = useState(false);
  const [detectedOs] = useState<DesktopTargetOs>(() => detectClientDesktopOs());

  const apkDownloadUrl = buildApkDownloadUrl(appCompat.updateUrl, APP_VERSION);
  const desktopInstallerUrl = getConfiguredBinaryInstallerUrl(detectedOs, appCompat.updateUrl);

  React.useEffect(() => {
    if (appInfoModalOpen) {
      if (isSupabaseConnected) {
        recheckAppCompat().catch(() => {});
      }
      fetchApkSha256().then((hash) => setApkSha256(hash)).catch(() => setApkSha256(null));
    }
  }, [appInfoModalOpen, isSupabaseConnected, recheckAppCompat]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && appInfoModalOpen) {
        setAppInfoModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [appInfoModalOpen, setAppInfoModalOpen]);

  if (!appInfoModalOpen) return null;

  const handleOpenReleaseNotes = () => {
    setAppInfoModalOpen(false);
    setReleaseNotesModalOpen(true);
  };

  const handlePWAInstallClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowInstallGuide((prev) => !prev);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setAppInfoModalOpen(false);
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-3 bg-slate-950/75 backdrop-blur-sm animate-fadeIn"
    >
      <div className="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 text-slate-800 dark:text-slate-100 max-h-[90dvh] sm:max-h-[88vh] flex flex-col overflow-hidden text-center">
        {/* Top-right close button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setAppInfoModalOpen(false);
          }}
          className="absolute top-4 right-4 w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer active:scale-95 shadow-xs shrink-0 z-10"
          title={t('common_close')}
          aria-label="Fermer"
        >
          <X className="w-4 h-4 stroke-[2.5]" />
        </button>

        {/* Logo & Title */}
        <div className="mb-2">
          <div className="w-20 h-20 mx-auto mb-2 rounded-2xl bg-white p-2.5 shadow-md border border-slate-200 flex items-center justify-center">
            <img
              src={appLogoUrl}
              alt="TOT Logo"
              className="brand-logo-img tqt-brand-logo w-full h-full object-contain"
            />
          </div>
          <h3 className="text-base font-extrabold text-orange-600 dark:text-orange-500">
            {t('info_title')}
          </h3>
          <div className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-0.5">
            Version {APP_VERSION} (Pro)
          </div>
        </div>

        {/* Description */}
        <div className="flex-1 overflow-y-auto py-2 space-y-3 text-left">
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed text-justify">
            {t('info_desc')}
          </p>

          {/* État de compatibilité Base de données (public.app_compat) */}
          <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700/80 text-[11px] space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-extrabold text-slate-800 dark:text-slate-100">
                <Database className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                <span>{tr(language, 'Compatibilité Base (app_compat)', 'DB Compatibility (app_compat)')}</span>
              </div>
              {isSupabaseConnected && (
                <button
                  type="button"
                  onClick={async () => {
                    setRefreshingCompat(true);
                    await recheckAppCompat().catch(() => {});
                    setRefreshingCompat(false);
                  }}
                  className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 transition cursor-pointer"
                  title={tr(language, 'Vérifier public.app_compat', 'Check public.app_compat')}
                >
                  <RefreshCw className={`w-3 h-3 ${refreshingCompat ? 'animate-spin text-orange-500' : ''}`} />
                </button>
              )}
            </div>

            <div className="flex items-center justify-between text-[10.5px]">
              <span className="text-slate-500 dark:text-slate-400">
                {tr(language, 'Statut :', 'Status:')}
              </span>
              {appCompat.tableMissing ? (
                <span className="inline-flex items-center gap-1 font-bold text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="w-3 h-3" />
                  {tr(language, 'Installation incomplète', 'Incomplete installation')}
                </span>
              ) : appCompat.compatible && !appCompat.maintenance ? (
                <span className="inline-flex items-center gap-1 font-bold text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-3 h-3" />
                  {tr(language, 'Compatible', 'Compatible')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-bold text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="w-3 h-3" />
                  {appCompat.maintenance
                    ? tr(language, 'Maintenance active', 'Maintenance active')
                    : appCompat.blockingReason || (tr(language, 'Mise à jour requise', 'Update required'))}
                </span>
              )}
            </div>

            <div className="flex items-center justify-between text-[10.5px]">
              <span className="text-slate-500 dark:text-slate-400">
                {tr(language, 'APP_VERSION / Schéma attendu :', 'APP_VERSION / Expected Schema:')}
              </span>
              <span className="font-mono font-bold text-slate-700 dark:text-slate-200">
                v{APP_VERSION} / v{EXPECTED_SCHEMA_VERSION} (min v{MIN_SUPPORTED_SCHEMA_VERSION})
              </span>
            </div>

            <div className="flex items-center justify-between text-[10.5px]">
              <span className="text-slate-500 dark:text-slate-400">
                {tr(language, 'Valeurs en base (schema / min_app) :', 'DB values (schema / min_app):')}
              </span>
              <span className="font-mono font-bold text-slate-700 dark:text-slate-200">
                {appCompat.tableMissing
                  ? tr(language, 'Table absente', 'Table missing')
                  : `v${appCompat.schemaVersion || '—'} (min_schema v${appCompat.minSchemaVersion || '1.0.0'}) / min_app v${appCompat.minAppVersion || '—'}`}
              </span>
            </div>

            {appCompat.message && (
              <div className="mt-1 p-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-[10.5px] text-amber-800 dark:text-amber-200 font-medium">
                {appCompat.message}
              </div>
            )}
          </div>

          <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 text-[11px] space-y-2">
            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
              <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span>
                <strong>{t('info_realtime')}</strong> {t('info_active')}
              </span>
            </div>
            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
              <Smartphone className="w-3.5 h-3.5 text-sky-500 shrink-0" />
              <span>
                <strong>{t('info_access_mode')}</strong> {t('info_access_val')}
              </span>
            </div>
            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              <span>
                <strong>{t('info_security')}</strong> {t('info_security_val')}
              </span>
            </div>
            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
              <Mail className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
              <span>
                <strong>{t('info_email_service')}</strong> {t('info_email_val')}
              </span>
            </div>
          </div>

          {showInstallGuide && (
            <div className="p-3 rounded-2xl bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800/60 text-[11px] text-slate-700 dark:text-slate-200 space-y-1.5 animate-fadeIn">
              <div className="font-extrabold text-orange-600 dark:text-orange-400 flex items-center gap-1.5">
                <Share className="w-3.5 h-3.5" />
                <span>
                  {tr(language, "Installer l'icône TOT sur l'écran d'accueil", 'Install TOT icon on Home Screen')}
                </span>
              </div>
              {isIOS ? (
                <p className="leading-relaxed">
                  {language === 'fr' ? (
                    <>
                      1. Appuyez sur le bouton <strong>Partager</strong> de Safari.<br />
                      2. Choisissez <strong>Sur l&apos;écran d&apos;accueil</strong> pour installer l&apos;application avec le logo officiel TOT.
                    </>
                  ) : (
                    <>
                      1. Tap the <strong>Share</strong> button in Safari.<br />
                      2. Tap <strong>Add to Home Screen</strong> to install the app with the official TOT logo.
                    </>
                  )}
                </p>
              ) : (
                <p className="leading-relaxed">
                  {language === 'fr' ? (
                    <>
                      Ouvrez le menu du navigateur (<strong>⋮</strong>) puis appuyez sur <strong>Installer l&apos;application</strong> ou <strong>Ajouter à l&apos;écran d&apos;accueil</strong>.
                    </>
                  ) : (
                    <>
                      Open the browser menu (<strong>⋮</strong>) and tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.
                    </>
                  )}
                </p>
              )}
            </div>
          )}
          {/* Version Bureau (Windows / Linux / macOS) */}
          <div className="p-3 rounded-2xl bg-orange-50/80 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800/70 text-[11px] space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="font-extrabold text-orange-800 dark:text-orange-300 flex items-center gap-1.5">
                <Monitor className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400 shrink-0" />
                <span>
                  {tr(
                    language,
                    `Version Bureau (v${APP_VERSION})`,
                    `Desktop Version (v${APP_VERSION})`,
                    `Desktopversie (v${APP_VERSION})`
                  )}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1.5 pt-0.5">
              {(
                [
                  { os: 'linux' as DesktopTargetOs, label: 'Linux (.deb)', icon: '🐧' },
                  { os: 'windows' as DesktopTargetOs, label: 'Windows (.exe)', icon: '🪟' },
                  { os: 'mac' as DesktopTargetOs, label: 'macOS (.dmg)', icon: '🍎' },
                ] as const
              ).map((item) => {
                const isCurrentOs = detectedOs === item.os;
                return (
                  <div
                    key={item.os}
                    className={`py-1.5 px-1.5 rounded-xl font-bold text-[10px] flex flex-col items-center justify-center gap-0.5 border ${
                      isCurrentOs
                        ? 'bg-orange-600 text-white border-orange-600 shadow-2xs'
                        : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-orange-200 dark:border-slate-700'
                    }`}
                  >
                    <span className="text-sm leading-none">{item.icon}</span>
                    <span>{item.label}</span>
                    {isCurrentOs && (
                      <span className="text-[9px] font-bold opacity-90">
                        {tr(language, 'Détecté', 'Detected', 'Gedetecteerd')}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {desktopInstallerUrl ? (
              <button
                type="button"
                onClick={() => {
                  openExternalUrl(desktopInstallerUrl);
                }}
                className="w-full py-2 px-3 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs"
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {tr(
                    language,
                    "Télécharger l'installateur",
                    'Download installer',
                    'Installatieprogramma downloaden'
                  )}
                </span>
              </button>
            ) : (
              <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-orange-200 dark:border-slate-700 text-[10.5px] text-slate-600 dark:text-slate-300 space-y-1">
                <p className="font-semibold text-slate-800 dark:text-slate-100">
                  {tr(
                    language,
                    "Les installateurs sont publiés par l'administrateur sur la page des versions du projet.",
                    'Installers are published by the administrator on the project releases page.',
                    'Installatiebestanden worden door de beheerder gepubliceerd op de releasepagina van het project.'
                  )}
                </p>
                <p className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                  <BookOpen className="w-3 h-3 text-orange-600 shrink-0" />
                  <span>
                    {tr(
                      language,
                      'Guide d’installation et de publication :',
                      'Installation and release guide:',
                      'Installatie- en publicatiehandleiding:'
                    )}{' '}
                    <code className="font-mono font-bold text-orange-700 dark:text-orange-400">
                      docs/VERSION_BUREAU.md
                    </code>
                  </span>
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
          {apkDownloadUrl ? (
            <a
              href={apkDownloadUrl}
              download={`tot-stock-v${APP_VERSION}.apk`}
              className="w-full py-2.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-extrabold text-xs shadow-md shadow-emerald-500/20 transition active:scale-[0.98] flex items-center justify-center gap-1.5 cursor-pointer no-underline"
            >
              <Download className="w-4 h-4 stroke-[2.5]" />
              <span>
                {t('info_download_apk')} (v{APP_VERSION})
              </span>
            </a>
          ) : (
            <div className="w-full py-2.5 px-3 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-[11px] flex items-center justify-center gap-1.5 text-center">
              <Download className="w-3.5 h-3.5 shrink-0 text-slate-400" />
              <span>{t('apk_ask_admin_link')}</span>
            </div>
          )}

          {apkSha256 && (
            <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 flex items-center justify-between gap-2 text-[10px] text-left">
              <div className="min-w-0 flex-1">
                <span className="font-bold text-slate-600 dark:text-slate-300 block">
                  {t('apk_sha256_label')}
                </span>
                <code className="font-mono text-[9.5px] text-slate-500 dark:text-slate-400 break-all block">
                  {apkSha256}
                </code>
              </div>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(apkSha256);
                  setCopiedSha(true);
                  setTimeout(() => setCopiedSha(false), 2000);
                }}
                className="px-2 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 font-bold text-[10px] flex items-center gap-1 shrink-0 cursor-pointer"
              >
                {copiedSha ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                <span>
                  {copiedSha
                    ? tr(language, 'Copié !', 'Copied!', 'Gekopieerd!')
                    : tr(language, 'Copier', 'Copy', 'Kopiëren')}
                </span>
              </button>
            </div>
          )}

          {!isInstalled && (
            <button
              type="button"
              onClick={handlePWAInstallClick}
              className="w-full py-2 rounded-2xl bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-extrabold text-xs shadow-md shadow-orange-500/20 transition active:scale-[0.98] flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Smartphone className="w-4 h-4 stroke-[2.5]" />
              <span>
                {tr(language, "Installer sur l'écran d'accueil (iOS / Web)", 'Install on Home Screen (iOS / Web)')}
              </span>
            </button>
          )}

          <button
            onClick={handleOpenReleaseNotes}
            className="w-full py-2 rounded-2xl bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white font-extrabold text-xs shadow-md shadow-indigo-500/20 transition active:scale-[0.98] flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <span>🚀</span> {t('info_whats_new')}
          </button>

          <button
            onClick={() => setAppInfoModalOpen(false)}
            className="w-full py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-bold text-xs hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            {t('common_close')}
          </button>
        </div>
      </div>
    </div>
  );
};
