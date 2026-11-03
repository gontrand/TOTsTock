import React, { useState, useEffect } from 'react';
import { tr } from '../i18n/dutchTranslator';
import DOMPurify from 'dompurify';
import { useApp } from '../context/AppContext';
import { formatDate } from '../utils/crypto';
import { getClientSupabase } from '../services/clientSupabase';
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
    language,
    t,
  } = useApp();

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

  // 1. Weekly User Recap
  const generateWeeklyRecap = () => {
    if (!currentUser || !currentUser.email) {
      alert(
        tr(language, "⚠️ L'utilisateur connecté n'a pas d'adresse e-mail configurée.", '⚠️ The logged-in user does not have an email address configured.')
      );
      return;
    }

    const now = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(now.getDate() - 7);

    const userOuts = movements.filter((m) => {
      if (String(m.user_id) !== String(currentUser.id)) return false;
      if (m.movement_type !== 'OUT') return false;
      if (!m.created_at) return false;
      return new Date(m.created_at) >= sevenDaysAgo;
    });

    const rows = userOuts.map((m) => {
      const d = formatDate(m.created_at);
      return `
        <tr>
          <td style="padding:8px; border:1px solid #cbd5e1;">${d}</td>
          <td style="padding:8px; border:1px solid #cbd5e1; font-weight:bold;">${m.product_ref || ''}</td>
          <td style="padding:8px; border:1px solid #cbd5e1; color:#ef4444; font-weight:bold;">-${m.quantity_changed}</td>
          <td style="padding:8px; border:1px solid #cbd5e1;">${m.site_number || 'N/A'}</td>
        </tr>
      `;
    });

    const html = `
      <div style="font-family:Arial, sans-serif; color:#0f172a; max-width:600px; margin:0 auto; border:1px solid #cbd5e1; border-radius:12px; padding:20px;">
        <h2 style="color:#ea580c; margin-top:0;">📊 ${tr(language, 'Récapitulatif Hebdomadaire des Sorties', 'Weekly Outflow Summary')}</h2>
        <p>${tr(language, 'Bonjour', 'Hello')} <strong>${currentUser.name}</strong>,</p>
        <p>${tr(language, 'Voici le bilan de vos sorties de stock effectuées au cours des 7 derniers jours :', 'Here is the summary of your stock outflows over the last 7 days:')}</p>
        <table style="width:100%; border-collapse:collapse; margin-top:15px; font-size:13px;">
          <thead>
            <tr style="background:#f8fafc; text-align:left;">
              <th style="padding:8px; border:1px solid #cbd5e1;">${tr(language, 'Date', 'Date')}</th>
              <th style="padding:8px; border:1px solid #cbd5e1;">${tr(language, 'Référence', 'Reference')}</th>
              <th style="padding:8px; border:1px solid #cbd5e1;">${tr(language, 'Quantité', 'Quantity')}</th>
              <th style="padding:8px; border:1px solid #cbd5e1;">${tr(language, 'Chantier', 'Site / Project')}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('') || `<tr><td colspan="4" style="padding:10px; text-align:center;">${tr(language, 'Aucune sortie au cours des 7 derniers jours.', 'No outflows in the last 7 days.')}</td></tr>`}
          </tbody>
        </table>
        <p style="font-size:11px; color:#64748b; margin-top:20px;">${tr(language, 'Généré automatiquement par TOT - Inventory & Scan Pro.', 'Generated automatically by TOT - Inventory & Scan Pro.')}</p>
      </div>
    `;

    setPreviewData({
      title: tr(language, 'Mon Récap Hebdomadaire Sorties', 'My Weekly Outflow Summary'),
      recipient: currentUser.email,
      subject: tr(language, '[TOT] Votre récapitulatif hebdomadaire des sorties de stock', '[TOT] Your weekly inventory outflow summary'),
      htmlContent: html,
    });
  };

  // 2. Daily Low Stock Recap
  const generateLowStockRecap = () => {
    const managers = users.filter((u) => {
      const r = roles.find((role) => Number(role.id) === Number(u.role_id));
      return (r?.name.includes('Responsable') || r?.name.includes('Admin')) && u.email;
    });

    const targetEmail = managers.length > 0 ? managers[0].email! : currentUser?.email || 'admin@entreprise.com';
    const lowStockItems = products.filter(
      (p) => (p.quantity || 0) > 0 && (p.quantity || 0) <= (p.min_stock_alert || 2)
    );

    const rows = lowStockItems.map(
      (p) => `
        <tr>
          <td style="padding:8px; border:1px solid #cbd5e1;"><strong>${p.brand} ${p.model}</strong> (${p.reference})</td>
          <td style="padding:8px; border:1px solid #cbd5e1; color:#d97706; font-weight:bold;">${p.quantity}</td>
          <td style="padding:8px; border:1px solid #cbd5e1;">${p.min_stock_alert}</td>
          <td style="padding:8px; border:1px solid #cbd5e1;">${p.store_name} &gt; ${p.shelf_name}</td>
        </tr>
      `
    );

    const html = `
      <div style="font-family:Arial, sans-serif; color:#0f172a; max-width:600px; margin:0 auto; border:1px solid #cbd5e1; border-radius:12px; padding:20px;">
        <h2 style="color:#d97706; margin-top:0;">⚠️ ${tr(language, `Alerte Journalière : Stocks Faibles (${lowStockItems.length})`, `Daily Alert: Low Stock (${lowStockItems.length})`)}</h2>
        <p>${tr(language, 'Bonjour,', 'Hello,')}</p>
        <p>${tr(language, "Les références suivantes ont franchi leur seuil d'alerte critique :", 'The following items have reached or breached their critical low threshold:')}</p>
        <table style="width:100%; border-collapse:collapse; margin-top:15px; font-size:13px;">
          <thead>
            <tr style="background:#f8fafc; text-align:left;">
              <th style="padding:8px; border:1px solid #cbd5e1;">${tr(language, 'Produit', 'Product')}</th>
              <th style="padding:8px; border:1px solid #cbd5e1;">${tr(language, 'Stock Actuel', 'Current Stock')}</th>
              <th style="padding:8px; border:1px solid #cbd5e1;">${tr(language, 'Seuil Min', 'Min Threshold')}</th>
              <th style="padding:8px; border:1px solid #cbd5e1;">${tr(language, 'Emplacement', 'Location')}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('') || `<tr><td colspan="4" style="padding:10px; text-align:center;">${tr(language, 'Aucun produit en stock faible.', 'No low stock items.')}</td></tr>`}
          </tbody>
        </table>
      </div>
    `;

    setPreviewData({
      title: tr(language, 'Alerte Journalière : Stocks Faibles', 'Daily Alert: Low Stock'),
      recipient: targetEmail,
      subject: tr(language, '[TOT Alerte] Produits en stock critique à réapprovisionner', '[TOT Alert] Critical low stock items to restock'),
      htmlContent: html,
    });
  };

  // 3. Daily Out of Stock Recap
  const generateOutStockRecap = () => {
    const targetEmail = currentUser?.email || 'responsable.stock@entreprise.com';
    const outItems = products.filter((p) => (p.quantity || 0) === 0);

    const rows = outItems.map(
      (p) => `
        <tr>
          <td style="padding:8px; border:1px solid #cbd5e1;"><strong>${p.brand} ${p.model}</strong> (${p.reference})</td>
          <td style="padding:8px; border:1px solid #cbd5e1; color:#ef4444; font-weight:bold;">0 (${tr(language, 'RUPTURE', 'OUT')})</td>
          <td style="padding:8px; border:1px solid #cbd5e1;">${p.supplier_1_name || 'N/A'}</td>
        </tr>
      `
    );

    const html = `
      <div style="font-family:Arial, sans-serif; color:#0f172a; max-width:600px; margin:0 auto; border:1px solid #cbd5e1; border-radius:12px; padding:20px;">
        <h2 style="color:#ef4444; margin-top:0;">🚨 ${tr(language, `Alerte Urgente : Ruptures Totales de Stock (${outItems.length})`, `Urgent Alert: Out of Stock (${outItems.length})`)}</h2>
        <p>${tr(language, 'Les articles ci-dessous sont actuellement épuisés en rayon :', 'The following items are currently out of stock:')}</p>
        <table style="width:100%; border-collapse:collapse; margin-top:15px; font-size:13px;">
          <thead>
            <tr style="background:#f8fafc; text-align:left;">
              <th style="padding:8px; border:1px solid #cbd5e1;">${tr(language, 'Produit', 'Product')}</th>
              <th style="padding:8px; border:1px solid #cbd5e1;">${tr(language, 'Statut', 'Status')}</th>
              <th style="padding:8px; border:1px solid #cbd5e1;">${tr(language, 'Fournisseur habituel', 'Supplier')}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('') || `<tr><td colspan="3" style="padding:10px; text-align:center;">${tr(language, 'Aucun produit en rupture.', 'No items out of stock.')}</td></tr>`}
          </tbody>
        </table>
      </div>
    `;

    setPreviewData({
      title: tr(language, 'Alerte Ruptures de Stock', 'Out of Stock Alert'),
      recipient: targetEmail,
      subject: tr(language, '[TOT URGENT] Alerte ruptures de stock immédiates', '[TOT URGENT] Immediate out-of-stock alert'),
      htmlContent: html,
    });
  };

  // 4. Department Project Recap
  const generateDepProjectRecap = () => {
    const userDep = currentUser?.department || 'Plomberie';
    const depProjects = projects.filter((p) => {
      const d = departments.find((dept) => dept.id === p.department_id);
      return d?.name.toLowerCase() === userDep.toLowerCase();
    });

    const projectNumbers = depProjects.map((p) => p.project_number.toLowerCase());
    const projMovements = movements.filter(
      (m) => m.site_number && projectNumbers.includes(m.site_number.toLowerCase())
    );

    const rows = projMovements.slice(0, 10).map((m) => {
      const isOut = m.movement_type === 'OUT';
      return `
        <tr>
          <td style="padding:8px; border:1px solid #cbd5e1;">${formatDate(m.created_at)}</td>
          <td style="padding:8px; border:1px solid #cbd5e1; font-weight:bold; color:${isOut ? '#ef4444' : '#10b981'};">${isOut ? (tr(language, 'SORTIE', 'OUT')) : (tr(language, 'ENTRÉE', 'IN'))}</td>
          <td style="padding:8px; border:1px solid #cbd5e1;">${m.site_number}</td>
          <td style="padding:8px; border:1px solid #cbd5e1;">${m.product_ref}</td>
          <td style="padding:8px; border:1px solid #cbd5e1;">${m.quantity_changed}</td>
        </tr>
      `;
    });

    const html = `
      <div style="font-family:Arial, sans-serif; color:#0f172a; max-width:600px; margin:0 auto; border:1px solid #cbd5e1; border-radius:12px; padding:20px;">
        <h2 style="color:#0284c7; margin-top:0;">🏢 ${tr(language, `Bilan Projets & Chantiers - Département ${userDep}`, `Site Projects Summary - Department ${userDep}`)}</h2>
        <p>${tr(language, 'Synthèse des flux récents sur les chantiers rattachés à votre département :', 'Recent movement summary for projects linked to your department:')}</p>
        <table style="width:100%; border-collapse:collapse; margin-top:15px; font-size:13px;">
          <thead>
            <tr style="background:#f8fafc; text-align:left;">
              <th style="padding:8px; border:1px solid #cbd5e1;">${tr(language, 'Date', 'Date')}</th>
              <th style="padding:8px; border:1px solid #cbd5e1;">${tr(language, 'Sens', 'Type')}</th>
              <th style="padding:8px; border:1px solid #cbd5e1;">${tr(language, 'Projet', 'Project')}</th>
              <th style="padding:8px; border:1px solid #cbd5e1;">${tr(language, 'Réf', 'Ref')}</th>
              <th style="padding:8px; border:1px solid #cbd5e1;">${tr(language, 'Quantité', 'Quantity')}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('') || `<tr><td colspan="5" style="padding:10px; text-align:center;">${tr(language, 'Aucun mouvement récent sur ce département.', 'No recent movements for this department.')}</td></tr>`}
          </tbody>
        </table>
      </div>
    `;

    setPreviewData({
      title: tr(language, `Récapitulatif Projets - Département ${userDep}`, `Projects Summary - Department ${userDep}`),
      recipient: currentUser?.email || 'responsable.departement@entreprise.com',
      subject: tr(language, `[TOT] Flux projets récents - Département ${userDep}`, `[TOT] Recent project flows - Department ${userDep}`),
      htmlContent: html,
    });
  };

  const [isSending, setIsSending] = useState(false);

  const handleSimulatedSend = async () => {
    if (!previewData) return;

    let smtpConfig: any = null;
    try {
      const saved = localStorage.getItem('tot_inv_smtp_config');
      if (saved) smtpConfig = JSON.parse(saved);
    } catch {}

    const senderEmail = (smtpConfig?.from_email || currentUser?.email || '').trim();
    const senderName = (smtpConfig?.from_name || 'TOT Stock Pro - Alertes').trim();

    setIsSending(true);
    try {
      const supabaseUrl = (localStorage.getItem('tot_inv_supabase_url') || '').trim();
      const supabaseKey = (localStorage.getItem('tot_inv_supabase_key') || '').trim();
      const client = getClientSupabase(supabaseUrl, supabaseKey);

      let success = false;
      let errorMsg = '';

      if (client && typeof client.functions?.invoke === 'function') {
        const { data, error } = await client.functions.invoke('send-report-email', {
          body: {
            to: previewData.recipient,
            subject: previewData.subject,
            htmlContent: previewData.htmlContent,
            sender_name: senderName,
            sender_email: senderEmail,
            user_permissions: ['perm_report_view'],
          },
        });

        if (error) {
          errorMsg = error.message;
        } else if (data?.configured === false || data?.status === 'non configuré') {
          try {
            localStorage.setItem('tot_email_service_configured', 'false');
            window.dispatchEvent(new CustomEvent('tot-email-service-status', { detail: { configured: false } }));
          } catch {}
          showToast(
            tr(language, 'ℹ️ Envoi d\'e-mails non configuré (facultatif). La section Rapports e-mail est masquée tant qu\'aucun secret e-mail n\'est défini.', 'ℹ️ Email service not configured (optional). Email reports are hidden until configured.')
          );
          setPreviewData(null);
          setEmailReportsModalOpen(false);
          return;
        } else if (data?.success) {
          try {
            localStorage.setItem('tot_email_service_configured', 'true');
            window.dispatchEvent(new CustomEvent('tot-email-service-status', { detail: { configured: true } }));
          } catch {}
          success = true;
        } else {
          errorMsg = data?.error || 'Échec de transmission';
        }
      } else {
        // Fallback HTTP call to function endpoint
        const endpoint = supabaseUrl ? `${supabaseUrl.replace(/\/$/, '')}/functions/v1/send-report-email` : '/api/send-report-email';
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(supabaseKey ? { Authorization: `Bearer ${supabaseKey}`, apikey: supabaseKey } : {}),
          },
          body: JSON.stringify({
            to: previewData.recipient,
            subject: previewData.subject,
            htmlContent: previewData.htmlContent,
            sender_name: senderName,
            sender_email: senderEmail,
            user_permissions: ['perm_report_view'],
          }),
        });

        const resData = await res.json().catch(() => ({}));
        if (resData?.configured === false || resData?.status === 'non configuré') {
          try {
            localStorage.setItem('tot_email_service_configured', 'false');
            window.dispatchEvent(new CustomEvent('tot-email-service-status', { detail: { configured: false } }));
          } catch {}
          showToast(
            tr(language, 'ℹ️ Envoi d\'e-mails non configuré (facultatif).', 'ℹ️ Email service not configured (optional).')
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
          `🚀 ${
            tr(language, 'Rapport expédié avec succès via l\'Edge Function sécurisée à', 'Report sent successfully via secure Edge Function to')
          } ${previewData.recipient} !`
        );
        setPreviewData(null);
      } else {
        showToast(`⚠️ ${errorMsg || 'Erreur lors de l\'envoi du rapport'}`);
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
                {tr(language, "Génération et expédition d'états de stock", 'Stock status generation and transmission')}
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

          {/* Card 2 */}
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
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

          {/* Card 3 */}
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
            <div>
              <h4 className="font-extrabold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                <AlertOctagon className="w-3.5 h-3.5" />
                {tr(language, 'Alertes Ruptures de Stock', 'Out of Stock Alerts')}
              </h4>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {tr(language, 'Alerte urgente pour articles avec stock = 0', 'Urgent alert for zero-stock catalog items')}
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

          {/* Card 4 */}
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
            <div>
              <h4 className="font-extrabold text-cyan-600 dark:text-cyan-400 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5" />
                {tr(language, 'Récap Projets & Chantiers', 'Site Projects Summary')}
              </h4>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {tr(language, `Flux affectés au département ${currentUser?.department || 'Général'}`, `Outflows assigned to ${currentUser?.department || 'General'}`)}
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
                    {tr(language, 'Destinataire :', 'Recipient:')} <strong>{previewData.recipient}</strong>
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
