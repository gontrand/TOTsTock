import React from 'react';
import { AlertTriangle, Save, RotateCcw, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { tr } from '../i18n/dutchTranslator';
import {
  useUnsavedChangesPromptState,
  confirmSaveAndProceed,
  confirmDiscardAndProceed,
  cancelPendingNavigation,
} from '../services/unsavedChangesGuard';

export const UnsavedChangesModal: React.FC = () => {
  const { language } = useApp();
  const state = useUnsavedChangesPromptState();

  if (!state.open || !state.entry) return null;

  const label = state.entry.label;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tr(
        language,
        'Modifications non enregistrées',
        'Unsaved changes',
        'Niet-opgeslagen wijzigingen'
      )}
      onClick={(e) => {
        if (e.target === e.currentTarget && !state.saving) {
          cancelPendingNavigation();
        }
      }}
      className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs animate-fadeIn"
    >
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-amber-300 dark:border-amber-800 shadow-2xl p-5 text-slate-800 dark:text-slate-100 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-black text-slate-900 dark:text-white">
                {tr(
                  language,
                  'Formulaire en cours de modification',
                  'Form currently being edited',
                  'Formulier wordt momenteel bewerkt'
                )}
              </h3>
              {label && (
                <p className="text-xs font-bold text-orange-600 dark:text-orange-400 mt-0.5">
                  {label}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            disabled={state.saving}
            onClick={cancelPendingNavigation}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
            title={tr(language, 'Continuer la modification', 'Continue editing', 'Verder bewerken')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          {tr(
            language,
            'Vous avez une modification ou une édition en cours dans ce formulaire. Souhaitez-vous enregistrer vos modifications ou les annuler avant de changer de menu ?',
            'You have an active edit or unsaved changes in this form. Would you like to save your changes or discard them before leaving?',
            'U heeft een actieve bewerking of niet-opgeslagen wijzigingen in dit formulier. Wilt u uw wijzigingen opslaan of annuleren voordat u van menu wisselt?'
          )}
        </p>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            disabled={state.saving}
            onClick={cancelPendingNavigation}
            className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold text-xs transition cursor-pointer"
          >
            {tr(language, 'Rester sur le formulaire', 'Stay on form', 'Op formulier blijven')}
          </button>

          <button
            type="button"
            disabled={state.saving}
            onClick={confirmDiscardAndProceed}
            className="px-3.5 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 dark:hover:bg-rose-900/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 shrink-0" />
            <span>
              {tr(language, 'Annuler la modification', 'Discard changes', 'Wijziging annuleren')}
            </span>
          </button>

          <button
            type="button"
            disabled={state.saving}
            onClick={confirmSaveAndProceed}
            className="px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-sm transition cursor-pointer disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5 shrink-0" />
            <span>
              {state.saving
                ? tr(language, 'Enregistrement...', 'Saving...', 'Opslaan...')
                : tr(language, 'Enregistrer', 'Save changes', 'Opslaan')}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
