import React from 'react';
import { tr } from '../../i18n/dutchTranslator';
import { useApp } from '../../context/AppContext';
import { DESKTOP_SHORTCUTS_TABLE } from '../../services/desktopInventoryLogic';
import { X, Keyboard } from 'lucide-react';

interface DesktopShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

export const DesktopShortcutsModal: React.FC<DesktopShortcutsModalProps> = ({ open, onClose }) => {
  const { language, t } = useApp();

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('desktop_shortcuts_title')}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/60 backdrop-blur-xs"
    >
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Keyboard className="w-5 h-5 text-orange-600" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {t('desktop_shortcuts_title')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 divide-y divide-slate-200 dark:divide-slate-800 text-xs">
          {DESKTOP_SHORTCUTS_TABLE.map((sc) => (
            <div
              key={sc.action}
              className="py-2.5 flex items-center justify-between gap-4"
            >
              <span className="text-slate-700 dark:text-slate-300">
                {language === 'en'
                  ? sc.descriptionEn
                  : language === 'nl'
                  ? sc.descriptionNl
                  : sc.descriptionFr}
              </span>
              <kbd className="px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-mono font-semibold text-slate-800 dark:text-slate-200 shrink-0">
                {sc.keysLabel}
              </kbd>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-[11px] text-slate-500 dark:text-slate-400">
          {tr(
            language,
            'Les raccourcis clavier sont automatiquement désactivés lorsque le curseur est dans un champ de saisie.',
            'Keyboard shortcuts are automatically disabled while typing inside an input field.',
            'Sneltoetsen worden automatisch uitgeschakeld tijdens het typen in een invoerveld.'
          )}
        </div>
      </div>
    </div>
  );
};
