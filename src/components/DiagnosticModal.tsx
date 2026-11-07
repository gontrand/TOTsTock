import React, { useEffect, useState, useCallback } from 'react';
import { tr } from '../i18n/dutchTranslator';
import { useApp } from '../context/AppContext';
import { APP_VERSION, EXPECTED_SCHEMA_VERSION, MIN_SUPPORTED_SCHEMA_VERSION } from '../appVersion';
import {
  getClientSupabase,
  runDiagnosticInstallation,
  DiagnosticCheckRow,
} from '../services/clientSupabase';
import {
  X,
  Stethoscope,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Copy,
  Check,
  ShieldAlert,
} from 'lucide-react';

export const DiagnosticModal: React.FC = () => {
  const {
    diagnosticModalOpen,
    setDiagnosticModalOpen,
    currentUser,
    supabaseUrl,
    supabaseKey,
    isSupabaseConnected,
    appCompat,
    language,
    t,
  } = useApp();

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<DiagnosticCheckRow[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isAllowedRole = Boolean(
    currentUser && [0, 1, 5].includes(Number(currentUser.role_id))
  );

  const fetchDiagnostic = useCallback(async () => {
    if (!isAllowedRole) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const client = getClientSupabase(supabaseUrl, supabaseKey);
      const res = await runDiagnosticInstallation(client);
      if (!res.success) {
        setErrorMsg(res.error || 'Impossible d\'exécuter le diagnostic.');
        setRows([]);
      } else {
        setRows(res.rows);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erreur lors du diagnostic.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [isAllowedRole, supabaseUrl, supabaseKey]);

  useEffect(() => {
    if (diagnosticModalOpen && isAllowedRole) {
      fetchDiagnostic();
    }
  }, [diagnosticModalOpen, isAllowedRole, fetchDiagnostic]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && diagnosticModalOpen) {
        setDiagnosticModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [diagnosticModalOpen, setDiagnosticModalOpen]);

  if (!diagnosticModalOpen) return null;

  const isSchema100 =
    appCompat?.schemaVersion === '1.0.0' ||
    rows.some(
      (r) =>
        (r.check_key === 'app_compat' || r.check_key === 'schema_version') &&
        r.details.includes('1.0.0') &&
        !r.details.includes('schema_version = 1.1.0') &&
        !r.details.includes('1.1.0 (attendu') &&
        !r.details.includes('schema_version = 1.1.1') &&
        !r.details.includes('1.1.1 (attendu') &&
        !r.details.includes('schema_version = 2.0.0') &&
        !r.details.includes('schema_version=2.0.0')
    );

  const permissiveRlsRow = rows.find(
    (r) => r.check_key === 'permissive_rls_policies' && r.status === 'ERREUR'
  );

  const prefixedTablesErrorRow = rows.find(
    (r) => r.check_key === 'prefixed_tables' && r.status === 'ERREUR'
  );

  const compatViewsWarningRow = rows.find(
    (r) => r.check_key === 'compat_views_present' && r.status === 'ATTENTION'
  );

  const resolveCheckLabel = (row: DiagnosticCheckRow): string => {
    if (row.check_key === 'prefixed_tables') {
      return t('diag_prefixed_tables_label');
    }
    if (row.check_key === 'compat_views_present') {
      return t('diag_compat_views_present_label');
    }
    return row.check_label;
  };

  const buildPlainTextReport = (): string => {
    const nowIso = new Date().toISOString();
    const lines: string[] = [
      '=== RAPPORT DE DIAGNOSTIC INSTALLATION TOT STOCK ===',
      `Date UTC : ${nowIso}`,
      `Version application (APP_VERSION) : ${APP_VERSION}`,
      `Schéma attendu (EXPECTED_SCHEMA_VERSION) : ${EXPECTED_SCHEMA_VERSION}`,
      `Schéma min supporté (MIN_SUPPORTED_SCHEMA_VERSION) : ${MIN_SUPPORTED_SCHEMA_VERSION}`,
      `Base Supabase connectée : ${isSupabaseConnected ? 'OUI' : 'NON'}`,
      '----------------------------------------------------',
    ];

    if (errorMsg) {
      lines.push(`[ERREUR] Exécution RPC diagnostic_installation : ${errorMsg}`);
    } else if (rows.length === 0) {
      lines.push('[ATTENTION] Aucun résultat retourné par public.diagnostic_installation().');
    } else {
      for (const r of rows) {
        lines.push(`[${r.status}] ${resolveCheckLabel(r)} (${r.check_key}) : ${r.details}`);
      }
      if (permissiveRlsRow) {
        lines.push(
          '[ALERTE SÉCURITÉ RLS] Des règles RLS permissives héritées (public/anon USING true) subsistent. Ré-exécutez 02_rls_hardening.sql et 05_rpc_admin_users.sql (ou dist/install.sql) pour les purger.'
        );
      }
      if (prefixedTablesErrorRow) {
        lines.push(`[ERREUR PRÉFIXES] ${t('diag_prefixed_tables_error_hint')}`);
      }
      if (compatViewsWarningRow) {
        lines.push(`[INFO VUES COMPATIBILITÉ] ${t('diag_compat_views_warning_hint')}`);
      }
      if (isSchema100) {
        lines.push(`[INFO] ${t('diag_schema_1_0_0_upgrade_hint')}`);
      }
    }

    lines.push('====================================================');
    return lines.join('\n');
  };

  const handleCopyReport = async () => {
    const report = buildPlainTextReport();
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = report;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const renderStatusBadge = (status: DiagnosticCheckRow['status']) => {
    if (status === 'OK') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-extrabold text-[10px] shrink-0">
          <CheckCircle2 className="w-3 h-3" />
          OK
        </span>
      );
    }
    if (status === 'ATTENTION') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 font-extrabold text-[10px] shrink-0">
          <AlertTriangle className="w-3 h-3" />
          ATTENTION
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30 font-extrabold text-[10px] shrink-0">
        <XCircle className="w-3 h-3" />
        ERREUR
      </span>
    );
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setDiagnosticModalOpen(false);
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-3 bg-slate-950/75 backdrop-blur-sm animate-fadeIn"
    >
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 text-slate-800 dark:text-slate-100 max-h-[92dvh] sm:max-h-[88vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-teal-500/15 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0">
              <Stethoscope className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-extrabold text-slate-900 dark:text-white truncate">
                {tr(language, "Diagnostic d'installation", 'Installation Diagnostic')}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                public.diagnostic_installation() • v{APP_VERSION}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {isAllowedRole && (
              <button
                type="button"
                onClick={fetchDiagnostic}
                disabled={loading}
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition cursor-pointer disabled:opacity-50"
                title={tr(language, 'Relancer le diagnostic', 'Re-run diagnostic')}
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-teal-500' : ''}`} />
              </button>
            )}
            <button
              type="button"
              onClick={() => setDiagnosticModalOpen(false)}
              className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white transition cursor-pointer"
              aria-label="Fermer"
            >
              <X className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto py-3 space-y-2.5">
          {!isAllowedRole ? (
            <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2.5">
              <ShieldAlert className="w-5 h-5 shrink-0" />
              <span>
                {tr(language, 'Accès refusé : cet écran est réservé aux rôles SuperAdmin (0), Administrateur (1) et Auditeur (5).', 'Access denied: restricted to roles 0, 1, and 5.')}
              </span>
            </div>
          ) : loading ? (
            <div className="py-10 text-center space-y-2">
              <RefreshCw className="w-6 h-6 animate-spin text-teal-500 mx-auto" />
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                {tr(language, 'Vérification de la base de données en cours...', 'Running installation checks...')}
              </p>
            </div>
          ) : errorMsg ? (
            <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-xs text-rose-700 dark:text-rose-300 space-y-1.5">
              <div className="font-extrabold flex items-center gap-1.5">
                <XCircle className="w-4 h-4 shrink-0" />
                <span>
                  {tr(language, 'Erreur lors de l’appel à public.diagnostic_installation()', 'Error calling public.diagnostic_installation()')}
                </span>
              </div>
              <p className="text-[11px] font-mono break-words">{errorMsg}</p>
              <p className="text-[11px] text-rose-600/90 dark:text-rose-300/80">
                {tr(
                  language,
                  'Vérifiez que les scripts 07_app_compat.sql et 08_print_jobs.sql (ou dist/install.sql) ont bien été exécutés sur votre base Supabase.',
                  'Verify that scripts 07_app_compat.sql and 08_print_jobs.sql (or dist/install.sql) have been executed on your Supabase database.'
                )}
              </p>
            </div>
          ) : (
            <>
              {permissiveRlsRow && (
                <div
                  data-testid="diag-permissive-rls-alert"
                  className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-800 text-[11px] font-bold text-rose-800 dark:text-rose-200 space-y-1"
                >
                  <div className="flex items-center gap-1.5 font-extrabold">
                    <ShieldAlert className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
                    <span>
                      {tr(
                        language,
                        'Règles RLS permissives détectées (public / anon USING true)',
                        'Permissive RLS policies detected (public / anon USING true)'
                      )}
                    </span>
                  </div>
                  <p className="font-normal">
                    {tr(
                      language,
                      'Des règles RLS anciennes ou trop permissives subsistent sur votre base. Ré-exécutez les scripts 02_rls_hardening.sql et 05_rpc_admin_users.sql (ou dist/install.sql) pour purger toutes les anciennes règles et recréer uniquement les politiques sécurisées.',
                      'Legacy or overly permissive RLS policies remain on your database. Re-run scripts 02_rls_hardening.sql and 05_rpc_admin_users.sql (or dist/install.sql) to purge all legacy policies and recreate only secure policies.'
                    )}
                  </p>
                </div>
              )}
              {prefixedTablesErrorRow && (
                <div
                  data-testid="diag-prefixed-tables-alert"
                  className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-800 text-[11px] font-bold text-rose-800 dark:text-rose-200"
                >
                  {t('diag_prefixed_tables_error_hint')}
                </div>
              )}
              {compatViewsWarningRow && (
                <div
                  data-testid="diag-compat-views-hint"
                  className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-[11px] font-bold text-amber-800 dark:text-amber-200"
                >
                  {t('diag_compat_views_warning_hint')}
                </div>
              )}
              {isSchema100 && (
                <div
                  data-testid="diag-schema-1-0-0-hint"
                  className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-[11px] font-bold text-amber-800 dark:text-amber-200"
                >
                  {t('diag_schema_1_0_0_upgrade_hint')}
                </div>
              )}
              {rows.map((item) => (
                <div
                  key={item.check_key}
                  data-testid={`diag-check-${item.check_key}`}
                  className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
                      {resolveCheckLabel(item)}
                    </span>
                    {renderStatusBadge(item.status)}
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-300 font-mono break-words">
                    {item.details}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2">
          {isAllowedRole && (
            <button
              type="button"
              onClick={handleCopyReport}
              className="flex-1 py-2.5 px-3 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white font-extrabold text-xs shadow-md shadow-teal-500/20 flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>{tr(language, 'Rapport copié !', 'Report copied!')}</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>{tr(language, 'Copier le rapport', 'Copy report')}</span>
                </>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => setDiagnosticModalOpen(false)}
            className="py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            {tr(language, 'Fermer', 'Close')}
          </button>
        </div>
      </div>
    </div>
  );
};
