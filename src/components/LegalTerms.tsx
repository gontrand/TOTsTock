import React, { useState } from 'react';
import { ShieldAlert, X } from 'lucide-react';
import type { Language } from '../i18n/translations';
import { LEGAL_DOCUMENTS } from '../data/legalTerms';
import { APP_VERSION } from '../appVersion';
import { BETA_CONTRACT_NAME, COPYRIGHT_HOLDER, COPYRIGHT_YEAR } from '../config/distribution';
import { hasAcceptedCurrentLegal, saveLegalAcceptance } from '../services/legalAcceptance';
import { getUserPreference } from '../services/userPreferencesService';

/** Pastille « BETA » affichée à côté du nom de l'application. */
export const BetaBadge: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span
    title={BETA_CONTRACT_NAME}
    className={`inline-flex items-center rounded-md bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300/70 dark:border-amber-500/40 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider leading-none select-none ${className}`}
  >
    Beta
  </span>
);

/** Texte complet des conditions (sans boutons) — réutilisé par l'écran d'acceptation et la fenêtre de relecture. */
export const LegalTermsBody: React.FC<{ language: Language }> = ({ language }) => {
  const doc = LEGAL_DOCUMENTS[language] ?? LEGAL_DOCUMENTS.fr;
  return (
    <div className="space-y-3 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
      <div className="rounded-xl border border-amber-300/70 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 font-bold text-amber-800 dark:text-amber-200">
        {doc.betaNotice}
      </div>
      <p>{doc.intro}</p>
      {doc.sections.map((section) => (
        <section key={section.title} className="space-y-1">
          <h4 className="font-black text-slate-900 dark:text-white">{section.title}</h4>
          {section.body.map((paragraph) => (
            <p key={paragraph.slice(0, 40)}>{paragraph}</p>
          ))}
        </section>
      ))}
      <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
        © {COPYRIGHT_YEAR} {COPYRIGHT_HOLDER} · TOT Stock v{APP_VERSION} Beta
      </p>
    </div>
  );
};

/** Fenêtre de relecture des conditions (depuis « À propos » ou l'écran de connexion). */
export const LegalTermsDialog: React.FC<{ language: Language; onClose: () => void }> = ({ language, onClose }) => {
  const doc = LEGAL_DOCUMENTS[language] ?? LEGAL_DOCUMENTS.fr;
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-xs">
      <div className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h3 className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-white">
            <ShieldAlert className="h-4 w-4 text-amber-500" />
            {doc.heading}
            <BetaBadge />
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={doc.close}
            className="cursor-pointer rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-3">
          <LegalTermsBody language={language} />
        </div>
        <div className="border-t border-slate-200 px-4 py-3 text-right dark:border-slate-700">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-xl bg-slate-900 px-4 py-2 text-xs font-extrabold text-white hover:bg-slate-700 dark:bg-slate-700"
          >
            {doc.close}
          </button>
        </div>
      </div>
    </div>
  );
};

function readStoredLanguage(): Language {
  const v = getUserPreference('language');
  if (v === 'fr' || v === 'en' || v === 'nl') return v;
  const nav = typeof navigator !== 'undefined' ? navigator.language?.slice(0, 2).toLowerCase() : 'fr';
  return nav === 'en' || nav === 'nl' ? (nav as Language) : 'fr';
}

/**
 * Écran bloquant affiché au premier lancement (et après chaque nouvelle version du texte) :
 * l'application n'est utilisable qu'après acceptation des conditions d'utilisation bêta.
 */
export const LegalGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [accepted, setAccepted] = useState<boolean>(() => hasAcceptedCurrentLegal());
  const [language, setLanguage] = useState<Language>(() => readStoredLanguage());
  const [checkTerms, setCheckTerms] = useState(false);
  const [checkTester, setCheckTester] = useState(false);
  const [declined, setDeclined] = useState(false);

  if (accepted) return <>{children}</>;

  const doc = LEGAL_DOCUMENTS[language] ?? LEGAL_DOCUMENTS.fr;
  const canContinue = checkTerms && checkTester;

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-slate-100 p-3 dark:bg-slate-950">
      <div className="flex max-h-[96dvh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h1 className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-white sm:text-base">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            {doc.heading}
            <BetaBadge />
          </h1>
          <div className="flex gap-1 text-[11px] font-bold">
            {(['fr', 'en', 'nl'] as Language[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLanguage(l)}
                className={`cursor-pointer rounded-lg px-2 py-1 uppercase ${
                  language === l
                    ? 'bg-orange-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-y-auto px-4 py-3">
          <LegalTermsBody language={language} />
        </div>

        <div className="space-y-2.5 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
          {declined ? (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              {doc.declinedMessage}
            </p>
          ) : (
            <>
              <label className="flex cursor-pointer items-start gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={checkTerms}
                  onChange={(e) => setCheckTerms(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-orange-600"
                />
                <span>{doc.checkboxAccept}</span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={checkTester}
                  onChange={(e) => setCheckTester(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-orange-600"
                />
                <span>{doc.checkboxTester}</span>
              </label>
              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setDeclined(true)}
                  className="cursor-pointer rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {doc.declineButton}
                </button>
                <button
                  type="button"
                  disabled={!canContinue}
                  onClick={() => {
                    saveLegalAcceptance(APP_VERSION);
                    setAccepted(true);
                  }}
                  className="cursor-pointer rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 px-5 py-2.5 text-xs font-extrabold text-white shadow-md transition disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {doc.acceptButton}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
