import React, { useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { EmailSettingsPanel } from './EmailSettingsPanel';

export const SmtpSettingsModal: React.FC = () => {
  const { smtpSettingsModalOpen, setSmtpSettingsModalOpen } = useApp();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && smtpSettingsModalOpen) {
        setSmtpSettingsModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [smtpSettingsModalOpen, setSmtpSettingsModalOpen]);

  if (!smtpSettingsModalOpen) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setSmtpSettingsModalOpen(false);
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-3 bg-slate-950/75 backdrop-blur-sm animate-fadeIn"
    >
      <div className="w-full max-w-3xl bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-3.5 sm:p-5 max-h-[92dvh] sm:max-h-[92vh] overflow-y-auto">
        <EmailSettingsPanel
          embedded={false}
          onClose={() => setSmtpSettingsModalOpen(false)}
        />
      </div>
    </div>
  );
};
