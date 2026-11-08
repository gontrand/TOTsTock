import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ShieldAlert,
  FileSpreadsheet,
  Search,
  RotateCcw,
  Trash2,
  AlertTriangle,
  Info,
  Clock,
  User as UserIcon,
  KeyRound,
  X,
  RefreshCw,
  ChevronRight,
  Lock,
  CheckCircle2,
  Database,
  Globe,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { tr } from '../../i18n/dutchTranslator';
import { getClientSupabase } from '../../services/clientSupabase';
import { SearchableSelect } from '../../components/SearchableSelect';
import {
  AUDIT_CSV_MAX_ROWS,
  AuditPeriodPreset,
  detectRepeatedLoginFailures,
  extractOrderTargetFromAuditRow,
  formatAuditChangesDiff,
  generateAuditLogsCsv,
  generateLoginLogsCsv,
  getAuditEventDisplayLabel,
  logAuditEventServer,
  purgeAuditLogsOnServer,
  PurgeAuditLogsResult,
  searchAuditLogsOnServer,
  searchLoginLogsOnServer,
  ServerAuditLogRow,
  ServerLoginLogRow,
} from '../../services/auditService';

export interface DesktopAuditLogPageProps {
  isModal?: boolean;
  onClose?: () => void;
}

const PAGE_SIZE = 50;

export const DesktopAuditLogPage: React.FC<DesktopAuditLogPageProps> = ({
  isModal = false,
  onClose,
}) => {
  const { currentUser, users, language, userHasPermission } = useApp();

  const isSuperAdmin = Number(currentUser?.role_id) === 0 || Number(currentUser?.id) === 0;
  const canViewAudit =
    isSuperAdmin ||
    Number(currentUser?.role_id) === 1 ||
    userHasPermission('perm_audit_view');
  const canViewLoginLogs =
    isSuperAdmin ||
    Number(currentUser?.role_id) === 1 ||
    userHasPermission('perm_view_all_login_logs');

  const [activeTab, setActiveTab] = useState<'events' | 'logins'>('events');

  // --- Filters: Events ---
  const [period, setPeriod] = useState<AuditPeriodPreset>('7d');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [userFilter, setUserFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');
  const [textFilter, setTextFilter] = useState<string>('');

  // --- Filters: Logins ---
  const [loginPeriod, setLoginPeriod] = useState<AuditPeriodPreset>('7d');
  const [loginDateFrom, setLoginDateFrom] = useState<string>('');
  const [loginDateTo, setLoginDateTo] = useState<string>('');
  const [loginUserFilter, setLoginUserFilter] = useState<string>('');
  const [loginActionFilter, setLoginActionFilter] = useState<string>('ALL');
  const [loginTextFilter, setLoginTextFilter] = useState<string>('');

  // --- Debounced search states (400 ms) ---
  const [debouncedEventFilters, setDebouncedEventFilters] = useState(() => ({
    period: '7d' as AuditPeriodPreset,
    dateFrom: '',
    dateTo: '',
    category: 'ALL',
    user: '',
    type: '',
    severity: 'ALL',
    text: '',
  }));

  const [debouncedLoginFilters, setDebouncedLoginFilters] = useState(() => ({
    period: '7d' as AuditPeriodPreset,
    dateFrom: '',
    dateTo: '',
    user: '',
    action: 'ALL',
    text: '',
  }));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedEventFilters({
        period,
        dateFrom,
        dateTo,
        category: categoryFilter,
        user: userFilter,
        type: typeFilter,
        severity: severityFilter,
        text: textFilter,
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [period, dateFrom, dateTo, categoryFilter, userFilter, typeFilter, severityFilter, textFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedLoginFilters({
        period: loginPeriod,
        dateFrom: loginDateFrom,
        dateTo: loginDateTo,
        user: loginUserFilter,
        action: loginActionFilter,
        text: loginTextFilter,
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [loginPeriod, loginDateFrom, loginDateTo, loginUserFilter, loginActionFilter, loginTextFilter]);

  // --- Server data states ---
  const [eventRows, setEventRows] = useState<ServerAuditLogRow[]>([]);
  const [eventTotalCount, setEventTotalCount] = useState<number>(0);
  const [eventLoading, setEventLoading] = useState<boolean>(false);
  const [eventLoadingMore, setEventLoadingMore] = useState<boolean>(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<ServerAuditLogRow | null>(null);

  const [loginRows, setLoginRows] = useState<ServerLoginLogRow[]>([]);
  const [loginTotalCount, setLoginTotalCount] = useState<number>(0);
  const [loginLoading, setLoginLoading] = useState<boolean>(false);
  const [loginLoadingMore, setLoginLoadingMore] = useState<boolean>(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [selectedLogin, setSelectedLogin] = useState<ServerLoginLogRow | null>(null);

  // --- Export & Purge states ---
  const [exportingCsv, setExportingCsv] = useState<boolean>(false);
  const [purgeModalOpen, setPurgeModalOpen] = useState<boolean>(false);
  const [purgeDays, setPurgeDays] = useState<number>(90);
  const [purgeConfirmStep, setPurgeConfirmStep] = useState<1 | 2>(1);
  const [purgeConfirmText, setPurgeConfirmText] = useState<string>('');
  const [purging, setPurging] = useState<boolean>(false);
  const [purgeResult, setPurgeResult] = useState<PurgeAuditLogsResult | null>(null);
  const [purgeError, setPurgeError] = useState<string | null>(null);

  const eventAbortRef = useRef<AbortController | null>(null);
  const loginAbortRef = useRef<AbortController | null>(null);
  const eventReqSeqRef = useRef<number>(0);
  const loginReqSeqRef = useRef<number>(0);

  const formatPermissionOrRpcError = useCallback(
    (err: any): string => {
      const msg = String(err?.message || err?.details || err || '');
      const code = String(err?.code || '');
      if (
        code === 'PGRST202' ||
        (msg.toLowerCase().includes('could not find the function') &&
          msg.toLowerCase().includes('in the schema cache')) ||
        msg.includes('install_v54.sql')
      ) {
        return tr(
          language,
          'Script SQL non à jour — exécutez install_v54.sql',
          'SQL script out of date — run install_v54.sql',
          'SQL-script verouderd — voer install_v54.sql uit'
        );
      }
      if (
        code === '42501' ||
        msg.toLowerCase().includes('permission') ||
        msg.toLowerCase().includes('acc') ||
        msg.toLowerCase().includes('refus')
      ) {
        return tr(
          language,
          'Accès refusé : votre rôle ne dispose pas de la permission requise pour consulter ce journal serveur.',
          'Access denied: your role does not have the required permission to view this server log.',
          'Toegang geweigerd: uw rol heeft niet de vereiste toestemming om dit serverlogboek te bekijken.'
        );
      }
      return (
        msg ||
        tr(
          language,
          'Impossible de charger le journal depuis le serveur.',
          'Unable to load the log from the server.',
          'Kan het logboek niet van de server laden.'
        )
      );
    },
    [language]
  );

  const fetchEvents = useCallback(
    async (offset = 0, append = false) => {
      const client = getClientSupabase();
      if (!client) {
        setEventRows([]);
        setEventTotalCount(0);
        setEventError(
          tr(
            language,
            'Base Supabase non connectée : le journal d’audit serveur nécessite une connexion active.',
            'Supabase database not connected: the server audit log requires an active connection.',
            'Supabase-database niet verbonden: het serverauditlogboek vereist een actieve verbinding.'
          )
        );
        return;
      }

      if (eventAbortRef.current) {
        eventAbortRef.current.abort();
      }
      const controller = new AbortController();
      eventAbortRef.current = controller;
      const reqId = ++eventReqSeqRef.current;

      if (append) {
        setEventLoadingMore(true);
      } else {
        setEventLoading(true);
        setEventError(null);
      }

      try {
        const { rows, totalCount } = await searchAuditLogsOnServer(
          client,
          {
            ...debouncedEventFilters,
            limit: PAGE_SIZE,
            offset,
          },
          controller.signal
        );
        if (reqId !== eventReqSeqRef.current) return;
        setEventTotalCount(totalCount);
        setEventRows((prev) => (append ? [...prev, ...rows] : rows));
      } catch (err: any) {
        if (controller.signal.aborted || err?.name === 'AbortError') return;
        if (reqId !== eventReqSeqRef.current) return;
        setEventError(formatPermissionOrRpcError(err));
      } finally {
        if (reqId === eventReqSeqRef.current) {
          setEventLoading(false);
          setEventLoadingMore(false);
        }
      }
    },
    [debouncedEventFilters, formatPermissionOrRpcError, language]
  );

  const fetchLogins = useCallback(
    async (offset = 0, append = false) => {
      if (!canViewLoginLogs) return;
      const client = getClientSupabase();
      if (!client) {
        setLoginRows([]);
        setLoginTotalCount(0);
        setLoginError(
          tr(
            language,
            'Base Supabase non connectée : le journal des connexions nécessite une connexion active.',
            'Supabase database not connected: the login log requires an active connection.',
            'Supabase-database niet verbonden: het aanmeldingslogboek vereist een actieve verbinding.'
          )
        );
        return;
      }

      if (loginAbortRef.current) {
        loginAbortRef.current.abort();
      }
      const controller = new AbortController();
      loginAbortRef.current = controller;
      const reqId = ++loginReqSeqRef.current;

      if (append) {
        setLoginLoadingMore(true);
      } else {
        setLoginLoading(true);
        setLoginError(null);
      }

      try {
        const { rows, totalCount } = await searchLoginLogsOnServer(
          client,
          {
            ...debouncedLoginFilters,
            limit: PAGE_SIZE,
            offset,
          },
          controller.signal
        );
        if (reqId !== loginReqSeqRef.current) return;
        setLoginTotalCount(totalCount);
        setLoginRows((prev) => (append ? [...prev, ...rows] : rows));
      } catch (err: any) {
        if (controller.signal.aborted || err?.name === 'AbortError') return;
        if (reqId !== loginReqSeqRef.current) return;
        setLoginError(formatPermissionOrRpcError(err));
      } finally {
        if (reqId === loginReqSeqRef.current) {
          setLoginLoading(false);
          setLoginLoadingMore(false);
        }
      }
    },
    [canViewLoginLogs, debouncedLoginFilters, formatPermissionOrRpcError, language]
  );

  useEffect(() => {
    if (activeTab === 'events') {
      fetchEvents(0, false);
    }
  }, [activeTab, fetchEvents]);

  useEffect(() => {
    if (activeTab === 'logins' && canViewLoginLogs) {
      fetchLogins(0, false);
    }
  }, [activeTab, canViewLoginLogs, fetchLogins]);

  useEffect(() => {
    return () => {
      eventAbortRef.current?.abort();
      loginAbortRef.current?.abort();
    };
  }, []);

  // Repeated login failures (>= 5 on the period)
  const repeatedFailureAlerts = useMemo(
    () => detectRepeatedLoginFailures(loginRows, 5),
    [loginRows]
  );

  const repeatedFailureSet = useMemo(() => {
    const set = new Set<string>();
    for (const a of repeatedFailureAlerts) {
      set.add(a.identifier.toLowerCase());
    }
    for (const r of loginRows) {
      if ((r.failure_count_for_identifier || 0) >= 5 && r.identifier) {
        set.add(r.identifier.toLowerCase());
      }
    }
    return set;
  }, [repeatedFailureAlerts, loginRows]);

  const handleResetEventFilters = () => {
    setPeriod('7d');
    setDateFrom('');
    setDateTo('');
    setCategoryFilter('ALL');
    setUserFilter('');
    setTypeFilter('');
    setSeverityFilter('ALL');
    setTextFilter('');
  };

  const handleResetLoginFilters = () => {
    setLoginPeriod('7d');
    setLoginDateFrom('');
    setLoginDateTo('');
    setLoginUserFilter('');
    setLoginActionFilter('ALL');
    setLoginTextFilter('');
  };

  const handleExportCsv = async () => {
    const client = getClientSupabase();
    setExportingCsv(true);
    try {
      let csvContent = '';
      let exportedCount = 0;
      let filename = '';

      if (activeTab === 'events') {
        let rowsToExport = eventRows;
        if (client) {
          try {
            const res = await searchAuditLogsOnServer(client, {
              ...debouncedEventFilters,
              limit: AUDIT_CSV_MAX_ROWS,
              offset: 0,
            });
            rowsToExport = res.rows;
          } catch {
            rowsToExport = eventRows;
          }
        }
        exportedCount = rowsToExport.length;
        csvContent = generateAuditLogsCsv(rowsToExport, language);
        filename = `tot_stock_audit_events_${new Date().toISOString().slice(0, 10)}.csv`;

        void logAuditEventServer({
          category: 'EXPORTS',
          type: 'csv_export',
          title: 'Export CSV — Journal d’audit (Événements)',
          description: `${exportedCount} ligne(s) exportée(s)`,
          meta: {
            source: 'desktop_audit_log_events',
            format: 'csv',
            row_count: exportedCount,
            filters: debouncedEventFilters,
          },
        });
      } else {
        let rowsToExport = loginRows;
        if (client) {
          try {
            const res = await searchLoginLogsOnServer(client, {
              ...debouncedLoginFilters,
              limit: AUDIT_CSV_MAX_ROWS,
              offset: 0,
            });
            rowsToExport = res.rows;
          } catch {
            rowsToExport = loginRows;
          }
        }
        exportedCount = rowsToExport.length;
        csvContent = generateLoginLogsCsv(rowsToExport, language);
        filename = `tot_stock_audit_connexions_${new Date().toISOString().slice(0, 10)}.csv`;

        void logAuditEventServer({
          category: 'EXPORTS',
          type: 'csv_export',
          title: 'Export CSV — Journal d’audit (Connexions)',
          description: `${exportedCount} ligne(s) exportée(s)`,
          meta: {
            source: 'desktop_audit_log_logins',
            format: 'csv',
            row_count: exportedCount,
            filters: debouncedLoginFilters,
          },
        });
      }

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      setExportingCsv(false);
    }
  };

  const handleConfirmPurge = async () => {
    const client = getClientSupabase();
    if (!client) return;
    setPurging(true);
    setPurgeError(null);
    try {
      const safeDays = Math.max(90, Number(purgeDays) || 90);
      const res = await purgeAuditLogsOnServer(client, safeDays);
      setPurgeResult(res);
      if (activeTab === 'events') {
        fetchEvents(0, false);
      } else {
        fetchLogins(0, false);
      }
    } catch (err: any) {
      setPurgeError(formatPermissionOrRpcError(err));
    } finally {
      setPurging(false);
    }
  };

  const selectedEventDiffs = useMemo(
    () => (selectedEvent ? formatAuditChangesDiff(selectedEvent.meta) : []),
    [selectedEvent]
  );

  const selectedEventSnapshotEntries = useMemo(() => {
    if (!selectedEvent?.meta?.snapshot || typeof selectedEvent.meta.snapshot !== 'object') {
      return [];
    }
    return Object.entries(selectedEvent.meta.snapshot as Record<string, any>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
  }, [selectedEvent]);

  const renderSeverityBadge = (severityRaw?: string) => {
    const sev = String(severityRaw || 'INFO').toUpperCase();
    if (sev === 'CRITICAL') {
      return (
        <span
          data-testid="audit-severity-badge-CRITICAL"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300 border border-rose-300 dark:border-rose-800"
        >
          <ShieldAlert className="w-3 h-3 shrink-0" />
          CRITICAL
        </span>
      );
    }
    if (sev === 'WARNING') {
      return (
        <span
          data-testid="audit-severity-badge-WARNING"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-800"
        >
          <AlertTriangle className="w-3 h-3 shrink-0" />
          WARNING
        </span>
      );
    }
    return (
      <span
        data-testid="audit-severity-badge-INFO"
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
      >
        <Info className="w-3 h-3 shrink-0" />
        INFO
      </span>
    );
  };

  const renderLoginActionBadge = (actionRaw?: string, isRepeatedFailure?: boolean) => {
    const act = String(actionRaw || '').toUpperCase();
    if (act === 'LOGIN_FAILED') {
      return (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase border ${
            isRepeatedFailure
              ? 'bg-rose-600 text-white border-rose-700'
              : 'bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300 border-rose-300 dark:border-rose-800'
          }`}
        >
          <AlertTriangle className="w-3 h-3 shrink-0" />
          {tr(language, 'Échec connexion', 'Login failed', 'Aanmelding mislukt')}
        </span>
      );
    }
    if (act === 'LOGOUT') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
          {tr(language, 'Déconnexion', 'Logout', 'Afmelding')}
        </span>
      );
    }
    if (act === 'SESSION_RESTORED') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
          {tr(language, 'Session restaurée', 'Session restored', 'Sessie hersteld')}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
        <CheckCircle2 className="w-3 h-3 shrink-0" />
        {tr(language, 'Connexion réussie', 'Login success', 'Aanmelding geslaagd')}
      </span>
    );
  };

  if (!canViewAudit) {
    return (
      <div className="p-8 max-w-xl mx-auto text-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="text-base font-black text-slate-900 dark:text-white">
          {tr(
            language,
            'Accès restreint au Journal d’audit',
            'Restricted access to Audit Log',
            'Beperkte toegang tot het Auditlogboek'
          )}
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {tr(
            language,
            'Votre rôle ne dispose pas de la permission « perm_audit_view » nécessaire pour consulter le journal d’audit serveur.',
            'Your role does not have the "perm_audit_view" permission required to view the server audit log.',
            'Uw rol heeft niet de vereiste "perm_audit_view"-toestemming om het serverauditlogboek te bekijken.'
          )}
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="desktop-audit-log-page"
      className={`flex flex-col h-full bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 ${
        isModal ? 'min-h-[80vh]' : ''
      }`}
    >
      {/* Top Header */}
      <div className="px-5 py-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-2xl bg-orange-100 dark:bg-orange-950/60 text-orange-600 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base font-black tracking-tight text-slate-900 dark:text-white">
                {tr(
                  language,
                  'Journal d’audit serveur',
                  'Server Audit Trail',
                  'Server Auditlogboek'
                )}
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                {tr(language, 'Immuable • Lecture seule', 'Immutable • Read-only', 'Onveranderlijk • Alleen-lezen')}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {tr(
                language,
                'Traçabilité complète côté serveur (triggers PostgreSQL & RPC sécurisées, secrets masqués ***)',
                'Full server-side traceability (PostgreSQL triggers & secure RPCs, secrets masked as ***)',
                'Volledige server-side traceerbaarheid (PostgreSQL-triggers & beveiligde RPC’s, geheimen gemaskeerd als ***)'
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() =>
              activeTab === 'events' ? fetchEvents(0, false) : fetchLogins(0, false)
            }
            className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${
                eventLoading || loginLoading ? 'animate-spin text-orange-500' : ''
              }`}
            />
            <span>{tr(language, 'Actualiser', 'Refresh', 'Vernieuwen')}</span>
          </button>

          <button
            type="button"
            data-testid="audit-export-csv-btn"
            disabled={exportingCsv}
            onClick={handleExportCsv}
            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>
              {exportingCsv
                ? tr(language, 'Export...', 'Exporting...', 'Exporteren...')
                : tr(language, 'Exporter CSV', 'Export CSV', 'CSV exporteren')}
            </span>
          </button>

          {isSuperAdmin && (
            <button
              type="button"
              data-testid="audit-purge-btn"
              onClick={() => {
                setPurgeDays(90);
                setPurgeConfirmStep(1);
                setPurgeConfirmText('');
                setPurgeResult(null);
                setPurgeError(null);
                setPurgeModalOpen(true);
              }}
              className="px-3 py-1.5 rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-rose-700 dark:text-rose-300 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>
                {tr(language, 'Purger l’historique', 'Purge history', 'Geschiedenis wissen')}
              </span>
            </button>
          )}

          {isModal && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 cursor-pointer"
              aria-label={tr(language, 'Fermer', 'Close', 'Sluiten')}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Tabs + Results Counter */}
      <div className="px-5 pt-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="audit-tab-events"
            onClick={() => setActiveTab('events')}
            className={`px-4 py-2 border-b-2 text-xs font-black flex items-center gap-2 transition cursor-pointer ${
              activeTab === 'events'
                ? 'border-orange-600 text-orange-600 dark:text-orange-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>{tr(language, 'Événements', 'Events', 'Gebeurtenissen')}</span>
            <span className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] font-mono">
              {eventTotalCount}
            </span>
          </button>

          {canViewLoginLogs && (
            <button
              type="button"
              data-testid="audit-tab-logins"
              onClick={() => setActiveTab('logins')}
              className={`px-4 py-2 border-b-2 text-xs font-black flex items-center gap-2 transition cursor-pointer ${
                activeTab === 'logins'
                  ? 'border-orange-600 text-orange-600 dark:text-orange-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>{tr(language, 'Connexions', 'Logins', 'Aanmeldingen')}</span>
              <span className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] font-mono">
                {loginTotalCount}
              </span>
              {repeatedFailureAlerts.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-black">
                  !
                </span>
              )}
            </button>
          )}
        </div>

        <div
          data-testid="audit-total-count"
          className="text-xs font-bold text-slate-500 dark:text-slate-400 pb-2"
        >
          {activeTab === 'events' ? eventTotalCount : loginTotalCount}{' '}
          {tr(language, 'résultats', 'results', 'resultaten')}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="px-5 py-3 bg-slate-100/70 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 shrink-0">
        {activeTab === 'events' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2 items-end text-xs">
            {/* Période */}
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                {tr(language, 'Période', 'Period', 'Periode')}
              </label>
              <SearchableSelect
                data-testid="audit-filter-period"
                value={period}
                onChange={(val) => setPeriod(val as AuditPeriodPreset)}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-semibold"
              >
                <option value="7d">{tr(language, '7 derniers jours', 'Last 7 days', 'Laatste 7 dagen')}</option>
                <option value="30d">{tr(language, '30 derniers jours', 'Last 30 days', 'Laatste 30 dagen')}</option>
                <option value="custom">{tr(language, 'Personnalisée', 'Custom', 'Aangepast')}</option>
                <option value="all">{tr(language, 'Toute la base', 'All history', 'Volledige geschiedenis')}</option>
              </SearchableSelect>
            </div>

            {period === 'custom' && (
              <>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                    {tr(language, 'Du', 'From', 'Van')}
                  </label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                    {tr(language, 'Au', 'To', 'Tot')}
                  </label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
              </>
            )}

            {/* Catégorie */}
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                {tr(language, 'Catégorie', 'Category', 'Categorie')}
              </label>
              <SearchableSelect
                data-testid="audit-filter-category"
                value={categoryFilter}
                onChange={(val) => setCategoryFilter(val)}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-semibold"
              >
                <option value="ALL">{tr(language, 'Toutes catégories', 'All categories', 'Alle categorieën')}</option>
                <option value="USERS">USERS</option>
                <option value="CONFIG">CONFIG</option>
                <option value="CATALOG">CATALOG</option>
                <option value="DEPOTS">DEPOTS</option>
                <option value="ORDERS">
                  {tr(language, 'ORDERS (Commandes)', 'ORDERS (Orders)', 'ORDERS (Bestellingen)')}
                </option>
                <option value="MOVEMENTS">MOVEMENTS</option>
                <option value="SECURITY">SECURITY</option>
                <option value="EXPORTS">EXPORTS</option>
                <option value="SYSTEM">SYSTEM</option>
              </SearchableSelect>
            </div>

            {/* Sévérité */}
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                {tr(language, 'Sévérité', 'Severity', 'Ernst')}
              </label>
              <SearchableSelect
                data-testid="audit-filter-severity"
                value={severityFilter}
                onChange={(val) => setSeverityFilter(val)}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-semibold"
              >
                <option value="ALL">{tr(language, 'Toutes sévérités', 'All severities', 'Alle ernstniveaus')}</option>
                <option value="INFO">INFO</option>
                <option value="WARNING">WARNING</option>
                <option value="CRITICAL">CRITICAL</option>
              </SearchableSelect>
            </div>

            {/* Utilisateur */}
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                {tr(language, 'Utilisateur', 'User', 'Gebruiker')}
              </label>
              <input
                type="text"
                list="audit-users-datalist"
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
                placeholder={tr(language, 'Nom ou trigramme...', 'Name or trigram...', 'Naam of trigram...')}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
              <datalist id="audit-users-datalist">
                {users.map((u) => (
                  <option key={u.id} value={u.name}>
                    {u.trigram}
                  </option>
                ))}
              </datalist>
            </div>

            {/* Type */}
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                {tr(language, 'Type d’action', 'Action type', 'Actietype')}
              </label>
              <input
                type="text"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                placeholder="ROW_UPDATE, csv_export..."
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-[11px]"
              />
            </div>

            {/* Recherche texte libre + Reset */}
            <div className="flex items-center gap-1.5 lg:col-span-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  data-testid="audit-filter-text"
                  value={textFilter}
                  onChange={(e) => setTextFilter(e.target.value)}
                  placeholder={tr(
                    language,
                    'Texte libre (titre, détail, réf, table)...',
                    'Free text (title, detail, ref, table)...',
                    'Vrije tekst (titel, detail, ref, tabel)...'
                  )}
                  className="w-full pl-8 pr-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <button
                type="button"
                onClick={handleResetEventFilters}
                title={tr(language, 'Réinitialiser', 'Reset', 'Resetten')}
                className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-semibold flex items-center gap-1 shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden xl:inline">
                  {tr(language, 'Réinitialiser', 'Reset', 'Resetten')}
                </span>
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 items-end text-xs">
            {/* Période Connexions */}
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                {tr(language, 'Période', 'Period', 'Periode')}
              </label>
              <SearchableSelect
                value={loginPeriod}
                onChange={(val) => setLoginPeriod(val as AuditPeriodPreset)}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-semibold"
              >
                <option value="7d">{tr(language, '7 derniers jours', 'Last 7 days', 'Laatste 7 dagen')}</option>
                <option value="30d">{tr(language, '30 derniers jours', 'Last 30 days', 'Laatste 30 dagen')}</option>
                <option value="custom">{tr(language, 'Personnalisée', 'Custom', 'Aangepast')}</option>
                <option value="all">{tr(language, 'Toute la base', 'All history', 'Volledige geschiedenis')}</option>
              </SearchableSelect>
            </div>

            {loginPeriod === 'custom' && (
              <>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                    {tr(language, 'Du', 'From', 'Van')}
                  </label>
                  <input
                    type="date"
                    value={loginDateFrom}
                    onChange={(e) => setLoginDateFrom(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                    {tr(language, 'Au', 'To', 'Tot')}
                  </label>
                  <input
                    type="date"
                    value={loginDateTo}
                    onChange={(e) => setLoginDateTo(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
              </>
            )}

            {/* Action de connexion */}
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                {tr(language, 'Action', 'Action', 'Actie')}
              </label>
              <SearchableSelect
                data-testid="audit-login-filter-action"
                value={loginActionFilter}
                onChange={(val) => setLoginActionFilter(val)}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-semibold"
              >
                <option value="ALL">{tr(language, 'Toutes les actions', 'All actions', 'Alle acties')}</option>
                <option value="LOGIN_SUCCESS">LOGIN_SUCCESS</option>
                <option value="LOGOUT">LOGOUT</option>
                <option value="LOGIN_FAILED">LOGIN_FAILED</option>
                <option value="SESSION_RESTORED">SESSION_RESTORED</option>
              </SearchableSelect>
            </div>

            {/* Utilisateur / Identifiant */}
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                {tr(language, 'Utilisateur / Identifiant', 'User / Identifier', 'Gebruiker / Identificatie')}
              </label>
              <input
                type="text"
                value={loginUserFilter}
                onChange={(e) => setLoginUserFilter(e.target.value)}
                placeholder={tr(language, 'Nom, e-mail, trigramme...', 'Name, email, trigram...', 'Naam, e-mail, trigram...')}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
            </div>

            {/* Recherche libre + Reset */}
            <div className="flex items-center gap-1.5 lg:col-span-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={loginTextFilter}
                  onChange={(e) => setLoginTextFilter(e.target.value)}
                  placeholder={tr(language, 'IP, navigateur, motif...', 'IP, user agent, reason...', 'IP, browser, reden...')}
                  className="w-full pl-8 pr-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <button
                type="button"
                onClick={handleResetLoginFilters}
                className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-semibold flex items-center gap-1 shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{tr(language, 'Réinitialiser', 'Reset', 'Resetten')}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Alert Banner for Repeated Login Failures (>= 5) */}
      {activeTab === 'logins' && repeatedFailureAlerts.length > 0 && (
        <div
          data-testid="repeated-login-failures-alert"
          className="mx-5 mt-3 p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-800 flex items-start gap-3 text-xs text-rose-800 dark:text-rose-200 shrink-0"
        >
          <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-1 flex-1">
            <div className="font-black">
              {tr(
                language,
                'Alerte sécurité : échecs de connexion répétés détectés (≥ 5 tentatives)',
                'Security alert: repeated login failures detected (≥ 5 attempts)',
                'Beveiligingswaarschuwing: herhaalde mislukte aanmeldingen gedetecteerd (≥ 5 pogingen)'
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {repeatedFailureAlerts.map((item) => (
                <span
                  key={item.identifier}
                  className="px-2 py-0.5 rounded-lg bg-rose-600 text-white font-mono text-[11px] font-bold"
                >
                  {item.identifier} ({item.count}×)
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main Split Content (Table + Detail Drawer) */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left Table Area */}
        <div className="flex-1 min-w-0 overflow-y-auto p-5 space-y-3">
          {activeTab === 'events' ? (
            <>
              {eventError && (
                <div
                  role="alert"
                  className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 font-semibold flex items-center gap-2"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{eventError}</span>
                </div>
              )}

              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-[10px] font-black uppercase text-slate-500">
                        <th className="py-2.5 px-3">{tr(language, 'Date / Heure', 'Date / Time', 'Datum / Tijd')}</th>
                        <th className="py-2.5 px-3">{tr(language, 'Sévérité', 'Severity', 'Ernst')}</th>
                        <th className="py-2.5 px-3">{tr(language, 'Catégorie', 'Category', 'Categorie')}</th>
                        <th className="py-2.5 px-3">{tr(language, 'Acteur', 'Actor', 'Actor')}</th>
                        <th className="py-2.5 px-3">{tr(language, 'Événement', 'Event', 'Gebeurtenis')}</th>
                        <th className="py-2.5 px-3">{tr(language, 'Cible / Détail', 'Target / Detail', 'Doel / Detail')}</th>
                        <th className="py-2.5 px-3 w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {eventLoading ? (
                        <tr>
                          <td colSpan={7} className="py-10 text-center text-slate-400">
                            {tr(language, 'Chargement du journal d’audit...', 'Loading audit log...', 'Auditlogboek laden...')}
                          </td>
                        </tr>
                      ) : eventRows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-10 text-center text-slate-400">
                            {tr(
                              language,
                              'Aucun événement trouvé pour ces critères.',
                              'No audit events found for these filters.',
                              'Geen gebeurtenissen gevonden voor deze filters.'
                            )}
                          </td>
                        </tr>
                      ) : (
                        eventRows.map((row) => {
                          const isSelected = selectedEvent?.id === row.id;
                          return (
                            <tr
                              key={row.id}
                              onClick={() => setSelectedEvent(row)}
                              className={`cursor-pointer transition ${
                                isSelected
                                  ? 'bg-orange-50/80 dark:bg-orange-950/30'
                                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                              }`}
                            >
                              <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                                {new Date(row.created_at).toLocaleString()}
                              </td>
                              <td className="py-2.5 px-3 whitespace-nowrap">
                                {renderSeverityBadge(row.severity)}
                              </td>
                              <td className="py-2.5 px-3 whitespace-nowrap">
                                <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[10px] font-bold">
                                  {row.category}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 whitespace-nowrap">
                                <div className="font-bold text-slate-900 dark:text-white">
                                  {row.user_name}
                                </div>
                                {row.user_trigram && (
                                  <div className="text-[10px] font-mono text-slate-400">
                                    {row.user_trigram}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="font-bold text-slate-900 dark:text-white">
                                  {row.title || getAuditEventDisplayLabel(row.type, language)}
                                </div>
                                <div className="text-[10px] font-mono text-slate-400">
                                  {getAuditEventDisplayLabel(row.type, language)} ({row.type})
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 max-w-xs truncate">
                                {(() => {
                                  const orderTarget = extractOrderTargetFromAuditRow(row);
                                  return (
                                    <div className="flex items-center gap-2 truncate">
                                      <span className="truncate">
                                        {row.description || row.table_name || '—'}
                                      </span>
                                      {orderTarget && (
                                        <button
                                          type="button"
                                          data-testid={`audit-order-link-${orderTarget.orderId || orderTarget.orderNumber}`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            window.dispatchEvent(
                                              new CustomEvent('tot-desktop-menu-command', {
                                                detail: {
                                                  command: 'nav-orders',
                                                  orderId: orderTarget.orderId,
                                                  orderNumber: orderTarget.orderNumber,
                                                },
                                              })
                                            );
                                          }}
                                          className="px-2 py-0.5 rounded-md bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300 font-mono text-[10px] font-bold hover:underline shrink-0 cursor-pointer"
                                        >
                                          {orderTarget.orderNumber || `#${orderTarget.orderId}`}
                                        </button>
                                      )}
                                    </div>
                                  );
                                })()}
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                <ChevronRight className="w-4 h-4 text-slate-400 inline" />
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {eventRows.length < eventTotalCount && (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    data-testid="audit-load-more-btn"
                    disabled={eventLoadingMore}
                    onClick={() => fetchEvents(eventRows.length, true)}
                    className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold cursor-pointer"
                  >
                    {eventLoadingMore
                      ? tr(language, 'Chargement...', 'Loading...', 'Laden...')
                      : tr(
                          language,
                          `Charger plus (${eventRows.length} / ${eventTotalCount})`,
                          `Load more (${eventRows.length} / ${eventTotalCount})`,
                          `Meer laden (${eventRows.length} / ${eventTotalCount})`
                        )}
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              {loginError && (
                <div
                  role="alert"
                  className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 font-semibold flex items-center gap-2"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{loginError}</span>
                </div>
              )}

              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-[10px] font-black uppercase text-slate-500">
                        <th className="py-2.5 px-3">{tr(language, 'Date / Heure', 'Date / Time', 'Datum / Tijd')}</th>
                        <th className="py-2.5 px-3">{tr(language, 'Action', 'Action', 'Actie')}</th>
                        <th className="py-2.5 px-3">{tr(language, 'Identifiant / Utilisateur', 'Identifier / User', 'Identificatie / Gebruiker')}</th>
                        <th className="py-2.5 px-3">{tr(language, 'Motif', 'Reason', 'Reden')}</th>
                        <th className="py-2.5 px-3">{tr(language, 'IP', 'IP', 'IP')}</th>
                        <th className="py-2.5 px-3 w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {loginLoading ? (
                        <tr>
                          <td colSpan={6} className="py-10 text-center text-slate-400">
                            {tr(language, 'Chargement des connexions...', 'Loading logins...', 'Aanmeldingen laden...')}
                          </td>
                        </tr>
                      ) : loginRows.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-10 text-center text-slate-400">
                            {tr(
                              language,
                              'Aucune connexion trouvée sur cette période.',
                              'No login events found for this period.',
                              'Geen aanmeldingen gevonden voor deze periode.'
                            )}
                          </td>
                        </tr>
                      ) : (
                        loginRows.map((row) => {
                          const isRepeated =
                            String(row.action).toUpperCase() === 'LOGIN_FAILED' &&
                            repeatedFailureSet.has(
                              String(row.identifier || row.user_name || '').toLowerCase()
                            );
                          const isSelected = selectedLogin?.id === row.id;
                          return (
                            <tr
                              key={row.id}
                              onClick={() => setSelectedLogin(row)}
                              className={`cursor-pointer transition ${
                                isSelected
                                  ? 'bg-orange-50/80 dark:bg-orange-950/30'
                                  : isRepeated
                                  ? 'bg-rose-50/70 dark:bg-rose-950/30 hover:bg-rose-100/60'
                                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                              }`}
                            >
                              <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                                {new Date(row.created_at).toLocaleString()}
                              </td>
                              <td className="py-2.5 px-3 whitespace-nowrap">
                                {renderLoginActionBadge(row.action, isRepeated)}
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                                  <span>{row.identifier || row.user_name}</span>
                                  {isRepeated && (
                                    <span className="px-1.5 py-0.2 rounded bg-rose-600 text-white text-[9px] font-black uppercase">
                                      ≥ 5 échecs
                                    </span>
                                  )}
                                </div>
                                {row.user_trigram && (
                                  <div className="text-[10px] font-mono text-slate-400">
                                    {row.user_name} ({row.user_trigram})
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 font-mono text-[11px]">
                                {row.reason || '—'}
                              </td>
                              <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500">
                                {row.ip_address || '—'}
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                <ChevronRight className="w-4 h-4 text-slate-400 inline" />
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {loginRows.length < loginTotalCount && (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    disabled={loginLoadingMore}
                    onClick={() => fetchLogins(loginRows.length, true)}
                    className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold cursor-pointer"
                  >
                    {loginLoadingMore
                      ? tr(language, 'Chargement...', 'Loading...', 'Laden...')
                      : tr(
                          language,
                          `Charger plus (${loginRows.length} / ${loginTotalCount})`,
                          `Load more (${loginRows.length} / ${loginTotalCount})`,
                          `Meer laden (${loginRows.length} / ${loginTotalCount})`
                        )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Right Detail Side Panel */}
        {activeTab === 'events' && selectedEvent && (
          <aside
            data-testid="audit-event-detail-panel"
            className="w-full max-w-md border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 overflow-y-auto space-y-4 shrink-0 text-xs"
          >
            <div className="flex items-start justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  {renderSeverityBadge(selectedEvent.severity)}
                  <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[10px] font-bold">
                    {selectedEvent.category}
                  </span>
                </div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white">
                  {selectedEvent.title || getAuditEventDisplayLabel(selectedEvent.type, language)}
                </h3>
                <p className="text-[11px] font-mono text-slate-400">
                  {getAuditEventDisplayLabel(selectedEvent.type, language)} ({selectedEvent.type})
                </p>
                {(() => {
                  const orderTarget = extractOrderTargetFromAuditRow(selectedEvent);
                  if (!orderTarget) return null;
                  return (
                    <button
                      type="button"
                      data-testid="audit-detail-open-order-btn"
                      onClick={() => {
                        window.dispatchEvent(
                          new CustomEvent('tot-desktop-menu-command', {
                            detail: {
                              command: 'nav-orders',
                              orderId: orderTarget.orderId,
                              orderNumber: orderTarget.orderNumber,
                            },
                          })
                        );
                      }}
                      className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-[11px] font-bold cursor-pointer"
                    >
                      <span>
                        {tr(
                          language,
                          `Ouvrir la commande ${orderTarget.orderNumber || orderTarget.orderId}`,
                          `Open order ${orderTarget.orderNumber || orderTarget.orderId}`,
                          `Open bestelling ${orderTarget.orderNumber || orderTarget.orderId}`
                        )}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  );
                })()}
              </div>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Metadata summary */}
            <div className="grid grid-cols-2 gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
              <div>
                <div className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-1">
                  <UserIcon className="w-3 h-3" />
                  <span>{tr(language, 'Acteur', 'Actor', 'Actor')}</span>
                </div>
                <div className="font-bold text-slate-900 dark:text-white mt-0.5">
                  {selectedEvent.user_name}{' '}
                  {selectedEvent.user_trigram ? `(${selectedEvent.user_trigram})` : ''}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>{tr(language, 'Horodatage', 'Timestamp', 'Tijdstip')}</span>
                </div>
                <div className="font-mono text-[11px] text-slate-700 dark:text-slate-200 mt-0.5">
                  {new Date(selectedEvent.created_at).toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-1">
                  <Globe className="w-3 h-3" />
                  <span>{tr(language, 'Adresse IP', 'IP Address', 'IP-adres')}</span>
                </div>
                <div className="font-mono text-[11px] text-slate-700 dark:text-slate-200 mt-0.5">
                  {selectedEvent.ip_address || '—'}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase text-slate-400">
                  {tr(language, 'Table / Cible', 'Table / Target', 'Tabel / Doel')}
                </div>
                <div className="font-mono text-[11px] text-slate-700 dark:text-slate-200 mt-0.5 truncate">
                  {selectedEvent.table_name || selectedEvent.meta?.table || '—'}
                  {selectedEvent.record_id ? ` #${selectedEvent.record_id}` : ''}
                </div>
              </div>
            </div>

            {selectedEvent.description && (
              <div>
                <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">
                  {tr(language, 'Description', 'Description', 'Beschrijving')}
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200">
                  {selectedEvent.description}
                </div>
              </div>
            )}

            {/* Diff Table for ROW_UPDATE */}
            {selectedEventDiffs.length > 0 && (
              <div>
                <div className="text-[10px] font-black uppercase text-orange-600 dark:text-orange-400 mb-1.5">
                  {tr(
                    language,
                    'Modifications (Ancienne valeur → Nouvelle valeur)',
                    'Changes (Old value → New value)',
                    'Wijzigingen (Oude waarde → Nieuwe waarde)'
                  )}
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold uppercase text-slate-500">
                        <th className="py-1.5 px-2.5">{tr(language, 'Champ', 'Field', 'Veld')}</th>
                        <th className="py-1.5 px-2.5">{tr(language, 'Ancienne', 'Old', 'Oud')}</th>
                        <th className="py-1.5 px-2.5">{tr(language, 'Nouvelle', 'New', 'Nieuw')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                      {selectedEventDiffs.map((entry) => (
                        <tr key={entry.field}>
                          <td className="py-1.5 px-2.5 font-bold text-slate-800 dark:text-slate-200">
                            {entry.field}
                          </td>
                          <td className="py-1.5 px-2.5 text-rose-600 dark:text-rose-400 break-all">
                            {entry.oldValue}
                          </td>
                          <td className="py-1.5 px-2.5 text-emerald-600 dark:text-emerald-400 break-all">
                            {entry.newValue}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Snapshot Table for INSERT / DELETE */}
            {selectedEventDiffs.length === 0 && selectedEventSnapshotEntries.length > 0 && (
              <div>
                <div className="text-[10px] font-black uppercase text-slate-500 mb-1.5">
                  {tr(
                    language,
                    'Instantané de l’enregistrement (meta.snapshot)',
                    'Record Snapshot (meta.snapshot)',
                    'Record-snapshot (meta.snapshot)'
                  )}
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                  <table className="w-full text-left border-collapse text-[11px] font-mono">
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {selectedEventSnapshotEntries.map(([k, v]) => (
                        <tr key={k}>
                          <td className="py-1.5 px-2.5 font-bold text-slate-700 dark:text-slate-300 bg-slate-50/60 dark:bg-slate-800/40 w-1/3">
                            {k}
                          </td>
                          <td className="py-1.5 px-2.5 text-slate-800 dark:text-slate-200 break-all">
                            {v === null || v === undefined
                              ? '—'
                              : typeof v === 'object'
                              ? JSON.stringify(v)
                              : String(v)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </aside>
        )}

        {activeTab === 'logins' && selectedLogin && (
          <aside className="w-full max-w-md border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 overflow-y-auto space-y-4 shrink-0 text-xs">
            <div className="flex items-start justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <div className="mb-1">{renderLoginActionBadge(selectedLogin.action)}</div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white">
                  {selectedLogin.identifier || selectedLogin.user_name}
                </h3>
                <p className="text-[11px] font-mono text-slate-400">
                  {new Date(selectedLogin.created_at).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLogin(null)}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400 block">
                  {tr(language, 'Utilisateur', 'User', 'Gebruiker')}
                </span>
                <span className="font-bold">
                  {selectedLogin.user_name}{' '}
                  {selectedLogin.user_trigram ? `(${selectedLogin.user_trigram})` : ''}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400 block">
                  {tr(language, 'Adresse IP', 'IP Address', 'IP-adres')}
                </span>
                <span className="font-mono">{selectedLogin.ip_address || '—'}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400 block">
                  {tr(language, 'Motif / Détail', 'Reason / Detail', 'Reden / Detail')}
                </span>
                <span className="font-mono">{selectedLogin.reason || '—'}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400 block">
                  {tr(language, 'Navigateur / Appareil', 'User Agent / Device', 'Browser / Apparaat')}
                </span>
                <span className="font-mono text-[11px] break-all">
                  {selectedLogin.user_agent || '—'}
                </span>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Super Admin Purge Modal (Role 0 only, >= 90 days, double confirmation) */}
      {isSuperAdmin && purgeModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-2xs flex items-center justify-center p-4">
          <div
            data-testid="audit-purge-modal"
            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-5 shadow-2xl space-y-4 text-xs"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">
                    {tr(
                      language,
                      'Purger l’historique d’audit',
                      'Purge audit history',
                      'Auditgeschiedenis wissen'
                    )}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {tr(
                      language,
                      'Réservé au Super Administrateur (rôle 0) • Rétention minimale 90 jours',
                      'Super Admin only (role 0) • Minimum retention 90 days',
                      'Alleen Super Admin (rol 0) • Minimale bewaartermijn 90 dagen'
                    )}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPurgeModalOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {purgeResult ? (
              <div className="space-y-3">
                <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 space-y-1">
                  <div className="font-black">
                    {tr(language, 'Purge effectuée avec succès', 'Purge completed', 'Wissen voltooid')}
                  </div>
                  <div>
                    {tr(
                      language,
                      `${purgeResult.total_deleted} ligne(s) supprimée(s) (${purgeResult.deleted_audit_logs} événements, ${purgeResult.deleted_login_logs} connexions) de plus de ${purgeResult.older_than_days} jours.`,
                      `${purgeResult.total_deleted} row(s) deleted (${purgeResult.deleted_audit_logs} events, ${purgeResult.deleted_login_logs} logins) older than ${purgeResult.older_than_days} days.`,
                      `${purgeResult.total_deleted} rij(en) verwijderd (${purgeResult.deleted_audit_logs} gebeurtenissen, ${purgeResult.deleted_login_logs} aanmeldingen) ouder dan ${purgeResult.older_than_days} dagen.`
                    )}
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setPurgeModalOpen(false)}
                    className="px-4 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold cursor-pointer"
                  >
                    {tr(language, 'Fermer', 'Close', 'Sluiten')}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <label className="block font-bold text-slate-700 dark:text-slate-300">
                    {tr(
                      language,
                      'Supprimer les entrées antérieures à (minimum 90 jours) :',
                      'Delete entries older than (minimum 90 days):',
                      'Verwijder items ouder dan (minimaal 90 dagen):'
                    )}
                  </label>
                  <SearchableSelect
                    data-testid="audit-purge-days-select"
                    value={purgeDays}
                    onChange={(val) => setPurgeDays(Math.max(90, Number(val) || 90))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold"
                  >
                    <option value={90}>90 {tr(language, 'jours (3 mois)', 'days (3 months)', 'dagen (3 maanden)')}</option>
                    <option value={180}>180 {tr(language, 'jours (6 mois)', 'days (6 months)', 'dagen (6 maanden)')}</option>
                    <option value={365}>365 {tr(language, 'jours (1 an)', 'days (1 year)', 'dagen (1 jaar)')}</option>
                    <option value={730}>730 {tr(language, 'jours (2 ans)', 'days (2 years)', 'dagen (2 jaar)')}</option>
                  </SearchableSelect>
                </div>

                {purgeConfirmStep === 1 ? (
                  <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 space-y-2">
                    <div className="font-bold">
                      {tr(
                        language,
                        'Première confirmation : cette opération est irréversible et sera elle-même consignée dans le journal d’audit.',
                        'First confirmation: this operation is irreversible and will itself be recorded in the audit log.',
                        'Eerste bevestiging: deze bewerking is onomkeerbaar en wordt zelf vastgelegd in het auditlogboek.'
                      )}
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setPurgeModalOpen(false)}
                        className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-semibold cursor-pointer"
                      >
                        {tr(language, 'Annuler', 'Cancel', 'Annuleren')}
                      </button>
                      <button
                        type="button"
                        data-testid="audit-purge-step1-next"
                        onClick={() => setPurgeConfirmStep(2)}
                        className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold cursor-pointer"
                      >
                        {tr(language, 'Continuer (Étape 2/2)', 'Continue (Step 2/2)', 'Doorgaan (Stap 2/2)')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 space-y-2.5">
                    <div className="font-bold">
                      {tr(
                        language,
                        'Deuxième confirmation : saisissez « PURGER » ci-dessous pour confirmer la suppression définitive.',
                        'Second confirmation: type "PURGER" below to confirm permanent deletion.',
                        'Tweede bevestiging: typ hieronder "PURGER" om definitieve verwijdering te bevestigen.'
                      )}
                    </div>
                    <input
                      type="text"
                      data-testid="audit-purge-confirm-input"
                      value={purgeConfirmText}
                      onChange={(e) => setPurgeConfirmText(e.target.value)}
                      placeholder="PURGER"
                      className="w-full px-3 py-1.5 rounded-xl border border-rose-300 dark:border-rose-700 bg-white dark:bg-slate-900 font-mono font-bold text-slate-900 dark:text-white"
                    />
                    {purgeError && (
                      <div className="text-rose-600 dark:text-rose-300 font-bold">{purgeError}</div>
                    )}
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setPurgeModalOpen(false)}
                        className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-semibold cursor-pointer"
                      >
                        {tr(language, 'Annuler', 'Cancel', 'Annuleren')}
                      </button>
                      <button
                        type="button"
                        data-testid="audit-purge-confirm-submit"
                        disabled={purging || purgeConfirmText.trim().toUpperCase() !== 'PURGER'}
                        onClick={handleConfirmPurge}
                        className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white font-black cursor-pointer"
                      >
                        {purging
                          ? tr(language, 'Purge en cours...', 'Purging...', 'Wissen...')
                          : tr(
                              language,
                              'Confirmer la purge définitive',
                              'Confirm permanent purge',
                              'Definitief wissen bevestigen'
                            )}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
