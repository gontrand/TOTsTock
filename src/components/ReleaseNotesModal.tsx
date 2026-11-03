import React from 'react';
import { tr } from '../i18n/dutchTranslator';
import { useApp } from '../context/AppContext';
import { Sparkles, Calendar, ArrowLeft, RefreshCw, X } from 'lucide-react';

export const ReleaseNotesModal: React.FC = () => {
  const {
    releaseNotesModalOpen,
    setReleaseNotesModalOpen,
    setAppInfoModalOpen,
    releaseNotes,
    refreshReleaseNotes,
    language,
    t,
  } = useApp();

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && releaseNotesModalOpen) {
        setReleaseNotesModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [releaseNotesModalOpen, setReleaseNotesModalOpen]);

  if (!releaseNotesModalOpen) return null;

  const handleBack = () => {
    setReleaseNotesModalOpen(false);
    setAppInfoModalOpen(true);
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setReleaseNotesModalOpen(false);
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-3 bg-slate-950/75 backdrop-blur-sm animate-fadeIn"
    >
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-3.5 sm:p-5 text-slate-800 dark:text-slate-100 max-h-[88dvh] sm:max-h-[85vh] flex flex-col overflow-hidden text-center">
        {/* Header */}
        <div className="pb-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="text-left flex-1">
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="text-lg">🚀</span> {t('rel_title')}
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {t('rel_subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => refreshReleaseNotes()}
              title={t('rel_refresh')}
              className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition cursor-pointer active:scale-95"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setReleaseNotesModalOpen(false);
              }}
              className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer active:scale-95 shadow-xs"
              title={t('common_close')}
              aria-label="Fermer"
            >
              <X className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>

        {/* Release Notes List */}
        <div className="flex-1 overflow-y-auto py-3 space-y-3 pr-1 text-left">
          {releaseNotes.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-xs">
              <p>{t('rel_loading')}</p>
            </div>
          ) : (
            releaseNotes.map((rel, idx) => {
              const dateStr = rel.release_date
                ? new Date(rel.release_date).toISOString().split('T')[0]
                : rel.date || '';

              const bullets = rel.description
                ? rel.description
                    .split('\n')
                    .filter((line) => line.trim() !== '')
                : [];

              return (
                <div
                  key={rel.id || idx}
                  className="bg-slate-50 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700/80 p-3.5 shadow-xs border-l-4 border-l-sky-600"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-black text-indigo-600 dark:text-indigo-400">
                      v{rel.version}
                    </span>
                    {dateStr && (
                      <span className="text-[10px] font-semibold bg-slate-200/70 dark:bg-slate-700/70 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Calendar className="w-2.5 h-2.5" />
                        {dateStr}
                      </span>
                    )}
                  </div>

                  {rel.title && (
                    <div className="text-xs font-extrabold text-slate-900 dark:text-white mb-1.5">
                      {rel.title}
                    </div>
                  )}

                  <ul className="text-[11px] text-slate-600 dark:text-slate-300 space-y-1 list-disc pl-4 leading-relaxed">
                    {bullets.length > 0 ? (
                      bullets.map((bullet, bIdx) => (
                        <li key={bIdx}>{bullet.replace(/^[•\-\*]\s*/, '')}</li>
                      ))
                    ) : (
                      <li>{rel.description || (tr(language, 'Améliorations de performance et stabilité.', 'Performance and stability improvements.'))}</li>
                    )}
                  </ul>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={handleBack}
            className="w-full py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs hover:bg-slate-50 dark:hover:bg-slate-750 transition flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {tr(language, 'Retour', 'Back')}
          </button>
        </div>
      </div>
    </div>
  );
};
