import React, { useState, useEffect } from 'react';
import { tr } from '../i18n/dutchTranslator';
import { useApp } from '../context/AppContext';
import { SmtpConfig } from '../types';
import {
  X,
  Sliders,
  CheckCircle,
  AlertTriangle,
  Send,
  HelpCircle,
  ShieldCheck,
  Server,
  Zap,
  Loader2,
  Lock,
  Copy,
  Check,
  Terminal,
} from 'lucide-react';
import { getClientSupabase } from '../services/clientSupabase';

export const SmtpSettingsModal: React.FC = () => {
  const {
    smtpSettingsModalOpen,
    setSmtpSettingsModalOpen,
    language,
    t,
    updateSetting,
    currentUser,
    userHasPermission,
  } = useApp();

  const [config, setConfig] = useState<SmtpConfig>(() => {
    const defaults: SmtpConfig = {
      from_email: '',
      from_name: 'TOT Stock Pro - Alertes',
    };
    try {
      const saved = localStorage.getItem('tot_inv_smtp_config');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Security sanitization: strip any sensitive credentials if previously stored in localStorage
        if (parsed.pass || parsed.password || parsed.user) {
          delete parsed.pass;
          delete parsed.password;
          delete parsed.user;
          localStorage.setItem('tot_inv_smtp_config', JSON.stringify(parsed));
        }
        return {
          from_email: parsed.from_email || defaults.from_email,
          from_name: parsed.from_name || defaults.from_name,
        };
      }
    } catch {}
    return defaults;
  });

  const [testEmail, setTestEmail] = useState('');
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Keyboard shortcut: close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && smtpSettingsModalOpen) {
        setSmtpSettingsModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [smtpSettingsModalOpen, setSmtpSettingsModalOpen]);

  // Clean sensitive keys if re-opening
  useEffect(() => {
    if (smtpSettingsModalOpen) {
      try {
        const saved = localStorage.getItem('tot_inv_smtp_config');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.pass || parsed.password) {
            delete parsed.pass;
            delete parsed.password;
            localStorage.setItem('tot_inv_smtp_config', JSON.stringify(parsed));
          }
          setConfig((prev) => ({
            from_email: parsed.from_email ?? prev.from_email,
            from_name: parsed.from_name ?? prev.from_name,
          }));
        }
      } catch {}
    }
  }, [smtpSettingsModalOpen]);

  if (!smtpSettingsModalOpen) return null;

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    // Only save non-sensitive fields
    const safePayload: SmtpConfig = {
      from_email: config.from_email.trim(),
      from_name: config.from_name.trim(),
    };
    localStorage.setItem('tot_inv_smtp_config', JSON.stringify(safePayload));
    if (updateSetting) {
      updateSetting('smtp_from', safePayload.from_email);
      updateSetting('smtp_from_name', safePayload.from_name);
    }
    setMsg({
      type: 'success',
      text: `✅ ${t('smtp_saved_msg') || 'Paramètres expéditeur enregistrés avec succès.'}`,
    });
    setTimeout(() => setMsg(null), 4000);
  };

  const handleSendTest = async () => {
    const targetEmail = testEmail.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!targetEmail || !emailRegex.test(targetEmail)) {
      setMsg({
        type: 'error',
        text:
          tr(language, 'Veuillez saisir une adresse e-mail destinataire valide pour le test.', 'Please enter a valid recipient email address for testing.'),
      });
      return;
    }

    if (!config.from_email || !emailRegex.test(config.from_email.trim())) {
      setMsg({
        type: 'error',
        text:
          tr(language, 'Veuillez renseigner un "E-mail Expéditeur" valide dans le formulaire (adresse validée sur votre compte Brevo).', 'Please provide a valid "Sender Email" in the form (verified on your Brevo account).'),
      });
      return;
    }

    // Permission check
    const hasReportPerm =
      userHasPermission('perm_report_view') ||
      userHasPermission('perm_config_email') ||
      userHasPermission('perm_email_manual_send') ||
      currentUser?.role_id === 1 ||
      currentUser?.role_id === 0;

    if (!hasReportPerm) {
      setMsg({
        type: 'error',
        text:
          tr(language, 'Permission refusée : Vous devez disposer du droit "perm_report_view" pour expédier des e-mails.', 'Permission denied: "perm_report_view" is required to send emails.'),
      });
      return;
    }

    setIsSendingTest(true);
    setMsg(null);

    try {
      const supabaseUrl = (localStorage.getItem('tot_inv_supabase_url') || '').trim();
      const supabaseKey = (localStorage.getItem('tot_inv_supabase_key') || '').trim();
      const client = getClientSupabase(supabaseUrl, supabaseKey);

      // Invoke server Edge Function send-report-email (Zero secrets in client)
      let responseData: any = null;
      let errorMsg: string | null = null;

      if (client && typeof client.functions?.invoke === 'function') {
        const { data, error } = await client.functions.invoke('send-report-email', {
          body: {
            to: targetEmail,
            subject: tr(language, '✅ Test de transmission sécurisée - TOT Stock PRO', '✅ Secure transmission test - TOT Stock PRO'),
            htmlContent: `
              <div style="font-family:Arial, sans-serif; max-width:600px; margin:0 auto; padding:20px; border:1px solid #e2e8f0; border-radius:12px;">
                <h2 style="color:#10b981; margin-top:0;">🛡️ Transmission Sécurisée Réussie (Phase 3)</h2>
                <p>Bonjour,</p>
                <p>Ce courriel confirme le bon fonctionnement de l'infrastructure d'envoi <strong>TOT Stock PRO</strong> via l'Edge Function Supabase et l'API Brevo.</p>
                <div style="background:#f8fafc; padding:12px; border-radius:8px; border-left:4px solid #10b981; font-size:12px; color:#334155;">
                  <strong>Expéditeur configuré :</strong> ${config.from_name} &lt;${config.from_email}&gt;<br/>
                  <strong>Destinataire :</strong> ${targetEmail}<br/>
                  <strong>Architecture :</strong> Secrets gérés exclusivement côté serveur (zéro clé dans le navigateur).
                </div>
                <p style="font-size:11px; color:#64748b; margin-top:20px;">Généré automatiquement par TOT Stock PRO.</p>
              </div>
            `,
            sender_name: config.from_name.trim(),
            sender_email: config.from_email.trim(),
            user_permissions: ['perm_report_view'],
          },
        });

        if (error) {
          errorMsg = error.message;
        } else {
          responseData = data;
        }
      } else {
        // Fallback direct HTTP to Edge Function endpoint if client not initialized
        const baseEndpoint = supabaseUrl ? `${supabaseUrl.replace(/\/$/, '')}/functions/v1/send-report-email` : '/api/send-report-email';
        const res = await fetch(baseEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(supabaseKey ? { Authorization: `Bearer ${supabaseKey}`, apikey: supabaseKey } : {}),
          },
          body: JSON.stringify({
            to: targetEmail,
            subject: 'Test de transmission sécurisée - TOT Stock PRO',
            htmlContent: `<p>Test d'envoi sécurisé via Edge Function Supabase pour ${targetEmail}.</p>`,
            sender_name: config.from_name.trim(),
            sender_email: config.from_email.trim(),
            user_permissions: ['perm_report_view'],
          }),
        });

        responseData = await res.json().catch(() => ({}));
        if (!res.ok) {
          errorMsg = responseData?.error || `Erreur HTTP ${res.status}`;
        }
      }

      if (errorMsg) {
        setMsg({
          type: 'error',
          text: `⚠️ Échec de transmission : ${errorMsg}. Avez-vous exécuté "npx supabase secrets set BREVO_API_KEY=..." ?`,
        });
      } else {
        setMsg({
          type: 'success',
          text: `🚀 ${tr(language, 'E-mail de test expédié avec succès via l\'Edge Function sécurisée à', 'Test email sent successfully via secure Edge Function to')} ${targetEmail} !`,
        });
      }
    } catch (e: any) {
      setMsg({
        type: 'error',
        text: `⚠️ Erreur réseau : ${e?.message || 'Impossible de joindre l\'Edge Function'}`,
      });
    } finally {
      setIsSendingTest(false);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setSmtpSettingsModalOpen(false);
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-3 bg-slate-950/75 backdrop-blur-sm animate-fadeIn"
    >
      <div className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-3.5 sm:p-5 text-slate-800 dark:text-slate-100 max-h-[92dvh] sm:max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 pb-2.5 sm:pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-cyan-100 dark:bg-cyan-950/60 text-cyan-600 flex items-center justify-center font-bold shrink-0">
              <Sliders className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-white flex items-center gap-1.5 flex-wrap">
                <span className="truncate">{tr(language, 'Configuration Expédition E-mail', 'Email Dispatch Configuration')}</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 shrink-0">
                  Secrets Serveur
                </span>
              </h2>
              <p className="text-[10px] sm:text-[11px] text-slate-400 truncate">
                {tr(language, 'Gestion sécurisée sans stockage de clés ou mot de passe dans le client', 'Secure setup with zero passwords or keys stored in client')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSmtpSettingsModalOpen(false)}
            className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer active:scale-95 shadow-xs"
            title={t('common_close')}
          >
            <X className="w-4 h-4 stroke-[2.5]" />
          </button>
        </div>

        {/* Status Toast */}
        {msg && (
          <div
            className={`mt-3 p-3 rounded-2xl text-xs font-bold flex items-center gap-2 border ${
              msg.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
                : msg.type === 'info'
                ? 'bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300'
                : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400'
            }`}
          >
            {msg.type === 'success' ? (
              <CheckCircle className="w-4 h-4 shrink-0" />
            ) : msg.type === 'info' ? (
              <HelpCircle className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span>{msg.text}</span>
          </div>
        )}

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto py-3 space-y-4 pr-1 text-xs">
          {/* Security Banner */}
          <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 space-y-2">
            <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-extrabold text-xs">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Conformité Sécurité Phase 3 : Zéro Clé Côté Navigateur</span>
            </div>
            <p className="text-[11px] text-emerald-700/90 dark:text-emerald-300/80 leading-relaxed">
              La clé API Brevo et les identifiants SMTP ne sont <strong>plus jamais stockés dans le stockage local</strong> (localStorage) ni exposés dans le navigateur. L'envoi s'effectue via l'Edge Function Supabase <code>send-report-email</code> qui lit la clé directement dans les secrets de l'infrastructure serveur.
            </p>
          </div>

          {/* Revocation Alert Banner */}
          <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 space-y-1.5">
            <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 font-black text-xs">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Rappel de Sécurité : Révoquer l'ancienne clé Brevo</span>
            </div>
            <p className="text-[11px] text-amber-800 dark:text-amber-300/90 leading-relaxed">
              Si vous aviez précédemment saisi ou utilisé une clé API Brevo dans l'application, <strong>elle a pu fuiter côté client</strong>. Rendez-vous sur votre compte <a href="https://app.brevo.com/settings/keys/api" target="_blank" rel="noopener noreferrer" className="underline font-bold text-amber-900 dark:text-amber-100 hover:text-orange-600">Brevo &gt; Clés API</a> pour supprimer/révoquer cette clé et en générer une nouvelle destinée aux secrets serveur.
            </p>
          </div>

          {/* Non-sensitive Sender Configuration Form */}
          <form onSubmit={handleSave} className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-cyan-600" />
                <span>Paramètres d'Expédition (Non Sensibles)</span>
              </h3>
              <span className="text-[10px] text-slate-400">Stockage client sécurisé</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Nom d'affichage expéditeur
                </label>
                <input
                  type="text"
                  value={config.from_name}
                  onChange={(e) => setConfig({ ...config, from_name: e.target.value })}
                  placeholder="TOT Stock - Gestion de Stock"
                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs focus:ring-2 focus:ring-cyan-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Adresse E-mail Expéditeur (validée Brevo)
                </label>
                <input
                  type="email"
                  value={config.from_email}
                  onChange={(e) => setConfig({ ...config, from_email: e.target.value })}
                  placeholder="contact@votre-domaine.fr"
                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs focus:ring-2 focus:ring-cyan-500 outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white font-bold text-xs shadow-md transition cursor-pointer"
              >
                Enregistrer les paramètres
              </button>
            </div>
          </form>

          {/* Server Deployment Instructions & CLI Commands */}
          <div className="p-4 rounded-2xl bg-slate-900 text-slate-200 border border-slate-800 space-y-3 font-mono text-[11px]">
            <div className="flex items-center justify-between text-cyan-400 font-sans font-extrabold text-xs">
              <div className="flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5" />
                <span>Commandes CLI Supabase (Configuration Serveur)</span>
              </div>
            </div>

            <p className="font-sans text-[11px] text-slate-400">
              Définissez la clé Brevo dans les secrets sécurisés Supabase et déployez la fonction <code>send-report-email</code> :
            </p>

            <div className="space-y-2">
              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
                <code className="text-emerald-400 break-all select-all">
                  npx supabase secrets set BREVO_API_KEY=xkeysib-votre-cle-api-v3
                </code>
                <button
                  type="button"
                  onClick={() => handleCopy('npx supabase secrets set BREVO_API_KEY=xkeysib-votre-cle-api-v3', 'cmd1')}
                  className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 shrink-0"
                  title="Copier la commande"
                >
                  {copiedKey === 'cmd1' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
                <code className="text-cyan-400 break-all select-all">
                  npx supabase functions deploy send-report-email
                </code>
                <button
                  type="button"
                  onClick={() => handleCopy('npx supabase functions deploy send-report-email', 'cmd2')}
                  className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 shrink-0"
                  title="Copier la commande"
                >
                  {copiedKey === 'cmd2' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          {/* Test Dispatch Form */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-3">
            <h4 className="font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5 text-purple-600" />
              <span>Tester la transmission via l'Edge Function</span>
            </h4>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="votre-adresse-test@domaine.com"
                className="flex-1 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs focus:ring-2 focus:ring-purple-500 outline-none"
              />
              <button
                type="button"
                disabled={isSendingTest}
                onClick={handleSendTest}
                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md transition disabled:opacity-60 cursor-pointer shrink-0"
              >
                {isSendingTest ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>{isSendingTest ? 'Envoi...' : 'Tester'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end">
          <button
            type="button"
            onClick={() => setSmtpSettingsModalOpen(false)}
            className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs transition cursor-pointer"
          >
            {t('common_close')}
          </button>
        </div>
      </div>
    </div>
  );
};
