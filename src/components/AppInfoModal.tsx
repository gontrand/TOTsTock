import React, { useState } from 'react';
import { tr } from '../i18n/dutchTranslator';
import { useApp } from '../context/AppContext';
import { APP_VERSION } from '../appVersion';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { buildApkDownloadUrl, fetchApkSha256 } from '../utils/apkDownload';
import { AboutAppPanel } from './AboutAppPanel';
import {
  X,
  Smartphone,
  Download,
  Share,
  Copy,
  Check,
} from 'lucide-react';

export const AppInfoModal: React.FC = () => {
  const {
    appInfoModalOpen,
    setAppInfoModalOpen,
    setReleaseNotesModalOpen,
    setCompanySetupModalOpen,
    appLogoUrl,
    appCompat,
    recheckAppCompat,
    isSupabaseConnected,
    language,
    t,
  } = useApp();

  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [apkSha256, setApkSha256] = useState<string | null>(null);
  const [copiedSha, setCopiedSha] = useState(false);

  const apkDownloadUrl = buildApkDownloadUrl(appCompat.updateUrl, APP_VERSION);

  React.useEffect(() => {
    if (appInfoModalOpen) {
      if (isSupabaseConnected) {
        recheckAppCompat().catch(() => {});
      }
      fetchApkSha256()
        .then((hash) => setApkSha256(hash))
        .catch(() => setApkSha256(null));
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
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 text-slate-800 dark:text-slate-100 max-h-[92dvh] sm:max-h-[90vh] flex flex-col overflow-hidden">
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

        {/* Header */}
        <div className="flex items-center gap-3 pb-3 border-b border-slate-100 dark:border-slate-800 pr-10">
          <div className="w-12 h-12 rounded-2xl bg-white p-1.5 shadow-sm border border-slate-200 flex items-center justify-center shrink-0">
            <img
              src={appLogoUrl}
              alt="TOT Logo"
              className="brand-logo-img tqt-brand-logo w-full h-full object-contain"
            />
          </div>
          <div className="min-w-0 text-left">
            <h3 className="text-base font-extrabold text-orange-600 dark:text-orange-500 truncate">
              {t('info_title')}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {t('info_desc')}
            </p>
          </div>
        </div>

        {/* Scrollable Content with AboutAppPanel */}
        <div className="flex-1 overflow-y-auto py-3 space-y-3 text-left pr-1">
          <AboutAppPanel
            onOpenSqlScripts={() => {
              setAppInfoModalOpen(false);
              setCompanySetupModalOpen(true);
            }}
          />

          {showInstallGuide && (
            <div className="p-3 rounded-2xl bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800/60 text-[11px] text-slate-700 dark:text-slate-200 space-y-1.5 animate-fadeIn">
              <div className="font-extrabold text-orange-600 dark:text-orange-400 flex items-center gap-1.5">
                <Share className="w-3.5 h-3.5" />
                <span>
                  {tr(
                    language,
                    "Installer l'icône TOT sur l'écran d'accueil",
                    'Install TOT icon on Home Screen'
                  )}
                </span>
              </div>
              {isIOS ? (
                <p className="leading-relaxed">
                  {language === 'fr' ? (
                    <>
                      1. Appuyez sur le bouton <strong>Partager</strong> de Safari.
                      <br />
                      2. Choisissez <strong>Sur l&apos;écran d&apos;accueil</strong> pour installer
                      l&apos;application avec le logo officiel TOT.
                    </>
                  ) : (
                    <>
                      1. Tap the <strong>Share</strong> button in Safari.
                      <br />
                      2. Tap <strong>Add to Home Screen</strong> to install the app with the
                      official TOT logo.
                    </>
                  )}
                </p>
              ) : (
                <p className="leading-relaxed">
                  {language === 'fr' ? (
                    <>
                      Ouvrez le menu du navigateur (<strong>⋮</strong>) puis appuyez sur{' '}
                      <strong>Installer l&apos;application</strong> ou{' '}
                      <strong>Ajouter à l&apos;écran d&apos;accueil</strong>.
                    </>
                  ) : (
                    <>
                      Open the browser menu (<strong>⋮</strong>) and tap{' '}
                      <strong>Install app</strong> or <strong>Add to Home screen</strong>.
                    </>
                  )}
                </p>
              )}
            </div>
          )}

          {apkSha256 && (
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 flex items-center justify-between gap-2 text-[10px]">
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
                {copiedSha ? (
                  <Check className="w-3 h-3 text-emerald-500" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                <span>
                  {copiedSha
                    ? tr(language, 'Copié !', 'Copied!', 'Gekopieerd!')
                    : tr(language, 'Copier', 'Copy', 'Kopiëren')}
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {apkDownloadUrl && (
              <a
                href={apkDownloadUrl}
                download={`tot-stock-v${APP_VERSION}.apk`}
                className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs flex items-center gap-1.5 no-underline"
              >
                <Download className="w-3.5 h-3.5" />
                <span>
                  {t('info_download_apk')} (v{APP_VERSION})
                </span>
              </a>
            )}
            {!isInstalled && (
              <button
                type="button"
                onClick={handlePWAInstallClick}
                className="px-3 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-extrabold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>
                  {tr(
                    language,
                    "Installer sur l'écran d'accueil",
                    'Install on Home Screen',
                    'Op startscherm installeren'
                  )}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={handleOpenReleaseNotes}
              className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <span>🚀</span> {t('info_whats_new')}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setAppInfoModalOpen(false)}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-bold text-xs hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            {t('common_close')}
          </button>
        </div>
      </div>
    </div>
  );
};
