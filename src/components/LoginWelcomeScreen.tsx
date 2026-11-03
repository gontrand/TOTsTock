import React from 'react';
import { useApp } from '../context/AppContext';
import { KeyRound, Building2 } from 'lucide-react';

export const LoginWelcomeScreen: React.FC = () => {
  const { appLogoUrl, setLoginModalOpen, setCompanySetupModalOpen, t } = useApp();

  return (
    <div className="flex-1 flex flex-col justify-between items-center px-4 py-8 pb-[max(env(safe-area-inset-bottom,0px),24px)] h-full min-h-[calc(100dvh-56px)] animate-fadeIn">
      {/* Top / Center Branding */}
      <div className="flex-1 flex flex-col justify-center items-center text-center">
        <div className="w-36 h-36 max-w-[144px] rounded-3xl bg-white p-3 shadow-md border border-slate-200/90 mb-3 flex items-center justify-center transition-transform duration-300 hover:scale-105">
          <img
            src={appLogoUrl}
            alt="TOT Logo"
            className="brand-logo-img tqt-brand-logo w-full h-full object-contain"
          />
        </div>
        <div className="text-xs sm:text-sm font-extrabold text-slate-500 dark:text-slate-400 tracking-wider uppercase mb-6">
          {t('login_edition')}
        </div>
      </div>

      {/* Auth Action Buttons */}
      <div className="w-full max-w-sm flex flex-col gap-3 px-2 mb-6">
        <button
          type="button"
          onClick={() => setLoginModalOpen(true)}
          className="w-full py-4 rounded-[20px] bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-extrabold text-base shadow-lg shadow-orange-500/35 transition-all duration-200 active:scale-[0.98] flex items-center justify-center gap-2.5 cursor-pointer"
        >
          <KeyRound className="w-5 h-5 text-white" />
          <span>{t('login_btn')}</span>
        </button>

        <button
          type="button"
          onClick={() => setCompanySetupModalOpen(true)}
          className="w-full py-3.5 rounded-[20px] bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 font-bold text-xs sm:text-sm shadow-xs transition-all duration-200 active:scale-[0.98] flex items-center justify-center gap-2.5 cursor-pointer"
        >
          <Building2 className="w-4 h-4 text-orange-500" />
          <span>{t('login_company_btn')}</span>
        </button>
      </div>

      {/* Footer Credits */}
      <div className="text-center text-[11px] text-slate-400 dark:text-slate-500 font-semibold pb-2">
        TOT - Inventory &amp; Scan Edition • Version v5.3.0
      </div>
    </div>
  );
};
