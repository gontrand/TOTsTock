import React, { useState, useEffect } from 'react';
import { tr } from '../i18n/dutchTranslator';
import DOMPurify from 'dompurify';
import { useApp } from '../context/AppContext';
import { getClientSupabase } from '../services/clientSupabase';
import { getResolvedEdgeFunctionName } from '../constants/edgeFunctions';
import { extractEdgeFunctionError } from '../services/mailingService';
import {
  buildDepartmentProjectsReport,
  buildLowStockReport,
  buildOutOfStockReport,
  buildWeeklyUserRecapReport,
} from '../services/reportsService';
import {
  canViewStockLevelsReport,
  mapStockLevelsReportRowsToProducts,
} from '../services/transferService';
import { StockLevelsReportRow } from '../types';
import {
  X,
  Mail,
  Send,
  Eye,
  CheckCircle,
  AlertTriangle,
  AlertOctagon,
  Calendar,
  Building2,
  Loader2,
  Sliders,
} from 'lucide-react';

export const EmailReportsModal: React.FC = () => {
  const {
    emailReportsModalOpen,
    setEmailReportsModalOpen,
    setSmtpSettingsModalOpen,
    currentUser,
    movements,
    products,
    departments,
    projects,
    users,
    roles,
    supabaseUrl,
    supabaseKey,
    userHasPermission,
    language,
    t,
  } = useApp();

  const canViewStockLevels = canViewStockLevelsReport(
    currentUser,
    userHasPermission('perm_report_stock_levels')
  );

  const [previewData, setPreviewData] = useState<{
    title: string;
    recipient: string;
    subject: string;
    htmlContent: string;
  } | null>(null);

  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Keyboard shortcut: close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && emailReportsModalOpen) {
        setEmailReportsModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [emailReportsModalOpen, setEmailReportsModalOpen]);

  if (!emailReportsModalOpen) return null;

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const loadStockLevelProductsFromRpcOrLocal = async () => {
    const url = (supabaseUrl || localStorage.getItem('tot_inv_supabase_url') || '').trim();
    const key = (supabaseKey || localStorage.getItem('tot_inv_supabase_key') || '').trim();
    const client = getClientSupabase(url, key);
    if (client && typeof (client as any).rpc === 'function') {
      try {
        const { data, error } = await (client as any).rpc('get_stock_levels_report', {
          p_depot: null,
          p_only_low: true,
        });
        if (!error && Array.isArray(data)) {
          const rows: StockLevelsReportRow[] = data.map((r: Record<string, unknown>) => ({
            product_id: String(r.product_id ?? ''),
            reference: String(r.reference ?? ''),
            brand: String(r.brand ?? ''),
            model: String(r.model ?? ''),
            sub_category_id:
              r.sub_category_id !== null && r.sub_category_id !== undefined
                ? Number(r.sub_category_id)
                : null,
            depot_name: String(r.depot_name ?? 'Dépôt Principal'),
            rack_location: String(r.rack_location ?? ''),
            quantity: Number(r.quantity ?? 0),
            min_stock_alert: Number(r.min_stock_alert ?? 0),
            unit_price: Number(r.unit_price ?? 0),
            total_value: Number(r.total_value ?? 0),
            in_transit_qty: Number(r.in_transit_qty ?? 0),
            is_low_stock: Boolean(r.is_low_stock),
            is_out_of_stock: Boolean(r.is_out_of_stock),
          }));
          return mapStockLevelsReportRowsToProducts(rows, products);
        }
      } catch {
        // Fallback to local products
      }
    }
    return products;
  };

  // 1. Weekly User Recap (shared generator from reportsService)
  const generateWeeklyRecap = () => {
    if (!currentUser || !currentUser.email) {
      alert(
        tr(
          language,
          "⚠️ L'utilisateur connecté n'a pas d'adresse e-mail configurée.",
          '⚠️ The logged-in user does not have an email address configured.'
        )
      );
      return;
    }

    const report = buildWeeklyUserRecapReport(currentUser, movements, products, language);
    setPreviewData({
      title: report.title,
      recipient: report.defaultRecipient,
      subject: report.subject,
      htmlContent: report.htmlContent,
    });
  };

  // 2. Daily Low Stock Recap (shared generator from reportsService)
  const generateLowStockRecap = async () => {
    if (!canViewStockLevels) return;
    const stockProducts = await loadStockLevelProductsFromRpcOrLocal();
    const report = buildLowStockReport(stockProducts, users, roles, currentUser, language);
    setPreviewData({
      title: report.title,
      recipient: report.defaultRecipient,
      subject: report.subject,
      htmlContent: report.htmlContent,
    });
  };

  // 3. Daily Out of Stock Recap (shared generator from reportsService)
  const generateOutStockRecap = async () => {
    if (!canViewStockLevels) return;
    const stockProducts = await loadStockLevelProductsFromRpcOrLocal();
    const report = buildOutOfStockReport(stockProducts, currentUser, language);
    setPreviewData({
      title: report.title,
      recipient: report.defaultRecipient,
      subject: report.subject,
      htmlContent: report.htmlContent,
    });
  };

  // 4. Department Project Recap (shared generator from reportsService)
  const generateDepProjectRecap = () => {
    const report = buildDepartmentProjectsReport(
      currentUser,
      departments,
      projects,
      movements,
      products,
      language
    );
    setPreviewData({
      title: report.title,
      recipient: report.defaultRecipient,
      subject: report.subject,
      htmlContent: report.htmlContent,
    });
  };

  const [isSending, setIsSending] = useState(false);

  const handleSimulatedSend = async () => {
    if (!previewData) return;

    setIsSending(true);
    try {
      const supabaseUrl = (localStorage.getItem('tot_inv_supabase_url') || '').trim();
      const supabaseKey = (localStorage.getItem('tot_inv_supabase_key') || '').trim();
      const client = getClientSupabase(supabaseUrl, supabaseKey);

      let success = false;
      let errorMsg = '';

      const sendEmailFn = getResolvedEdgeFunctionName('sendReportEmail');
      if (client && typeof client.functions?.invoke === 'function') {
        const { data, error } = await client.functions.invoke(sendEmailFn, {
          body: {
            app_code: 'stk',
            to: previewData.recipient,
            subject: previewData.subject,
            htmlContent: previewData.htmlContent,
            user_permissions: canViewStockLevels
              ? ['perm_report_view', 'perm_report_stock_levels']
              : ['perm_report_view'],
          },
        });

        if (error) {
          const parsed = await extractEdgeFunctionError(error, data);
          errorMsg = parsed.statusCode
            ? `${parsed.message} (HTTP ${parsed.statusCode})`
            : parsed.message;
        } else if (data?.configured === false || data?.status === 'non configuré') {
          try {
            localStorage.setItem('tot_email_service_configured', 'false');
            window.dispatchEvent(
              new CustomEvent('tot-email-service-status', { detail: { configured: false } })
            );
          } catch {}
          showToast(
            tr(
              language,
              "ℹ️ Envoi d'e-mails non configuré (facultatif). La section Rapports e-mail est masquée tant qu'aucun secret e-mail n'est défini.",
              'ℹ️ Email service not configured (optional). Email reports are hidden until configured.'
            )
          );
          setPreviewData(null);
          setEmailReportsModalOpen(false);
          return;
        } else if (data?.success) {
          try {
            localStorage.setItem('tot_email_service_configured', 'true');
            window.dispatchEvent(
              new CustomEvent('tot-email-service-status', { detail: { configured: true } })
            );
          } catch {}
          success = true;
        } else {
          errorMsg = data?.error || 'Échec de transmission';
        }
      } else {
        // Fallback HTTP call to function endpoint
        const endpoint = supabaseUrl
          ? `${supabaseUrl.replace(/\/$/, '')}/functions/v1/${sendEmailFn}`
          : '/api/send-report-email';
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(supabaseKey ? { Authorization: `Bearer ${supabaseKey}`, apikey: supabaseKey } : {}),
          },
          body: JSON.stringify({
            app_code: 'stk',
            to: previewData.recipient,
            subject: previewData.subject,
            htmlContent: previewData.htmlContent,
            user_permissions: canViewStockLevels
              ? ['perm_report_view', 'perm_report_stock_levels']
              : ['perm_report_view'],
          }),
        });

        const resData = await res.json().catch(() => ({}));
        if (resData?.configured === false || resData?.status === 'non configuré') {
          try {
            localStorage.setItem('tot_email_service_configured', 'false');
            window.dispatchEvent(
              new CustomEvent('tot-email-service-status', { detail: { configured: false } })
            );
          } catch {}
          showToast(
            tr(
              language,
              "ℹ️ Envoi d'e-mails non configuré (facultatif).",
              'ℹ️ Email service not configured (optional).'
            )
          );
          setPreviewData(null);
          setEmailReportsModalOpen(false);
          return;
        } else if (res.ok && resData?.success) {
          success = true;
        } else {
          errorMsg = resData?.error || `Erreur serveur (${res.status})`;
        }
      }

      if (success) {
        showToast(
          `🚀 ${tr(
            language,
            "Rapport expédié avec succès via l'Edge Function sécurisée à",
            'Report sent successfully via secure Edge Function to'
          )} ${previewData.recipient} !`
        );
        setPreviewData(null);
      } else {
        showToast(`⚠️ ${errorMsg || "Erreur lors de l'envoi du rapport"}`);
      }
    } catch (e: any) {
      showToast(`⚠️ ${e.message || 'Erreur de communication serveur'}`);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setEmailReportsModalOpen(false);
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-3 bg-slate-950/75 backdrop-blur-sm animate-fadeIn"
    >
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-3.5 sm:p-5 text-slate-800 dark:text-slate-100 max-h-[92dvh] sm:max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-purple-100 dark:bg-purple-950/60 text-purple-600 flex items-center justify-center font-bold">
              <Mail className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-white">
                {t('email_reports_title')}
              </h2>
              <p className="text-[11px] text-slate-400">
                {tr(
                  language,
                  "Génération et expédition d'états de stock",
                  'Stock status generation and transmission'
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                setEmailReportsModalOpen(false);
                setSmtpSettingsModalOpen(true);
              }}
              className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-[11px] flex items-center gap-1.5 transition cursor-pointer active:scale-95"
              title={tr(language, 'Configurer Brevo & SMTP', 'Configure Brevo & SMTP')}
            >
              <Sliders className="w-3.5 h-3.5 text-cyan-600" />
              <span className="hidden sm:inline">Configuration SMTP</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setEmailReportsModalOpen(false);
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
              className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer active:scale-95 shadow-xs shrink-0"
              title={t('common_close')}
              aria-label="Fermer"
            >
              <X className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>

        {toastMsg && (
          <div className="mt-3 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 text-xs font-bold flex items-center gap-2">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>{toastMsg}</span>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto py-3 space-y-3 pr-1 text-xs">
          {/* Card 1 */}
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
            <div>
              <h4 className="font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-purple-500" />
                {t('email_weekly_recap_title')}
              </h4>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {t('email_weekly_recap_desc')}
              </p>
            </div>
            <button
              onClick={generateWeeklyRecap}
              className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold flex items-center gap-1 shadow-sm shrink-0"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>{tr(language, 'Générer', 'Generate')}</span>
            </button>
          </div>

          {/* Card 2 (Stock levels: LOW_STOCK) */}
          {canViewStockLevels && (
            <div
              data-testid="email-report-card-low-stock"
              className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3"
            >
              <div>
                <h4 className="font-extrabold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {t('email_stock_alerts_title')}
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {t('email_stock_alerts_desc')}
                </p>
              </div>
              <button
                onClick={generateLowStockRecap}
                className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold flex items-center gap-1 shadow-sm shrink-0"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>{tr(language, 'Générer', 'Generate')}</span>
              </button>
            </div>
          )}

          {/* Card 3 (Stock levels: OUT_OF_STOCK) */}
          {canViewStockLevels && (
            <div
              data-testid="email-report-card-out-of-stock"
              className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3"
            >
              <div>
                <h4 className="font-extrabold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                  <AlertOctagon className="w-3.5 h-3.5" />
                  {tr(language, 'Alertes Ruptures de Stock', 'Out of Stock Alerts')}
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {tr(
                    language,
                    'Alerte urgente pour articles avec stock = 0',
                    'Urgent alert for zero-stock catalog items'
                  )}
                </p>
              </div>
              <button
                onClick={generateOutStockRecap}
                className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold flex items-center gap-1 shadow-sm shrink-0"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>{tr(language, 'Générer', 'Generate')}</span>
              </button>
            </div>
          )}

          {/* Card 4 */}
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
            <div>
              <h4 className="font-extrabold text-cyan-600 dark:text-cyan-400 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5" />
                {tr(language, 'Récap Projets & Chantiers', 'Site Projects Summary')}
              </h4>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {tr(
                  language,
                  `Flux affectés au département ${currentUser?.department || 'Général'}`,
                  `Outflows assigned to ${currentUser?.department || 'General'}`
                )}
              </p>
            </div>
            <button
              onClick={generateDepProjectRecap}
              className="px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white font-bold flex items-center gap-1 shadow-sm shrink-0"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>{tr(language, 'Générer', 'Generate')}</span>
            </button>
          </div>

          {/* Live Preview Modal Layer */}
          {previewData && (
            <div className="mt-4 p-4 bg-white dark:bg-slate-800 rounded-2xl border-2 border-purple-500/50 shadow-lg space-y-3">
              <div className="flex items-start justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
                <div>
                  <span className="text-[10px] font-bold text-purple-600 uppercase">
                    {t('email_preview_title')}
                  </span>
                  <h3 className="font-extrabold text-slate-900 dark:text-white text-sm">
                    {previewData.title}
                  </h3>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {tr(language, 'Destinataire :', 'Recipient:')}{' '}
                    <strong>{previewData.recipient}</strong>
                  </div>
                </div>
                <button
                  onClick={() => setPreviewData(null)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Render HTML preview sanitized with DOMPurify */}
              <div
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(previewData.htmlContent) }}
                className="max-h-56 overflow-y-auto p-2 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700"
              />

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={() => setPreviewData(null)}
                  className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 hover:bg-slate-100"
                >
                  {t('common_close')}
                </button>
                <button
                  type="button"
                  disabled={isSending}
                  onClick={handleSimulatedSend}
                  className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold flex items-center gap-1.5 shadow-md shadow-purple-500/25 disabled:opacity-60 cursor-pointer"
                >
                  {isSending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  <span>{isSending ? t('email_sending') : t('email_send_now')}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={() => setEmailReportsModalOpen(false)}
            className="w-full py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            {tr(language, 'Retour au Menu', 'Back to Menu')}
          </button>
        </div>
      </div>
    </div>
  );
};
